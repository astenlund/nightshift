'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { CLOSING_TARGET } = require('../internal/runtime/actions');
const { DIMENSIONS, commitmentsFor, completeAssessment, obligationBrief, reviewGate, reviewProgress, transition } = require('../internal/runtime/lifecycle');
const { RunError, RunStore } = require('../internal/runtime/store');
const { fresh, hash, inventorySnapshot, snapshot, verifyCommand } = require('../internal/runtime/evidence');
const { dispatchReview, readReceipt } = require('../internal/runtime/review');
const { runAgent } = require('../internal/runtime/hosts');
const { artifactFailure } = require('./fixtures/artifact-failure');
const { writeJson } = require('../internal/runtime/artifacts');
const { fixtureControllerClaim, executeWithFixtureController } = require('./fixtures/controller-claim');

const actor = { host: 'codex', session: 'controller' };
const LEAD = { host: 'claude', model: 'claude-fable-5-1', effort: 'high' };
const COUNTERPART = { host: 'codex', model: 'gpt-6-astra', effort: 'high' };

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function finding(id, severity = 'important') {
  return { id, severity, required: severity !== 'minor', consequence: 'The fixture boundary fails', evidence: 'Concrete branch through the boundary' };
}

function verdict(id, outcome = 'confirmed', repairProposal = outcome === 'confirmed' ? 'Correct the boundary where both branches meet' : '') {
  return { id, verdict: outcome, evidence: 'Reproduced against the change', value: 'Worth deciding', repairProposal };
}

let sessions = 0;

// A fixture host that returns the report fields a test chooses, as native Claude events. A resumed attempt continues the session it
// was asked to resume; a continued lead closes every pending finding unless told otherwise; a lead's dialogue turn maintains each.
// A launched one reports a host process, as a real runner does, and its proven termination.
function fakeAgent(options, { findings = [], closures, positions, status = 'complete', session, dimensions = DIMENSIONS.code, calls, during, launched = false, threadTokens } = {}) {
  calls?.push(options);
  if (launched) options.onProcess(999999);
  fs.mkdirSync(options.artifacts, { recursive: true });
  const properties = options.schema.properties;
  const report = { requestId: properties.requestId.enum[0], status, coverage: dimensions.map(dimension => ({ dimension, evidence: 'Assessed the change' })), findings, probes: [], summary: 'Fixture report' };
  if (properties.closures) report.closures = closures ?? (properties.closures.items.properties.id.enum ?? []).map(id => ({ id, closed: true, evidence: 'The repair resolves it' }));
  if (properties.positions) report.positions = positions ?? properties.positions.items.properties.id.enum.map(id => ({ id, position: 'maintain', evidence: 'The finding still holds' }));
  const actual = options.session ?? session ?? `session-${++sessions}`;
  const events = options.host === 'codex'
    ? [{ id: 2, result: { thread: { id: actual }, model: options.model } }, { method: 'item/completed', params: { threadId: actual, item: { type: 'agentMessage', text: JSON.stringify(report) } } }, { method: 'turn/completed', params: { threadId: actual, turn: { status: 'completed' } } }]
    : [{ type: 'assistant', session_id: actual, message: { model: options.model, content: [] } }, { type: 'result', session_id: actual, subtype: 'success', is_error: false, structured_output: report }];
  fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  during?.(options);
  return { host: options.host, model: options.model, effort: options.effort, session: actual, attributionVerified: true, status: 'complete', output: report, tokens: 0, ...(threadTokens === undefined ? {} : { threadTokens }), ...(launched ? { exit: { descendantsReclaimed: true } } : {}) };
}

// A committed project with an uncommitted change, and a run whose operations go through the actual runtime boundary.
function fixture(t, tasks = [{ id: 'task', title: 'Work', agreement: { source: 'User', outcome: 'Change both paths correctly' } }]) {
  const parent = path.resolve(__dirname, '../.tmp/resume-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  git(root, ['init', '--quiet']);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'before\r\n');
  fs.writeFileSync(path.join(root, 'README.md'), '# Project\r\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish resume baseline']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'after\r\n');
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({ objective: 'Deliver the accepted change', authority: 'User agreed the scope', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks });
  const base = { baseSha, requirements: 'Change both paths correctly', rules: 'Do not mutate reviewed inputs.' };
  const act = (request, overrides) => executeWithFixtureController(root, { actor, revision: store.read().revision, taskId: 'task', ...request }, overrides);
  const receipt = result => path.relative(root, result.receiptFile).split(path.sep).join('/');
  const dispatch = (review, agent = {}, taskId = 'task') => act({ action: 'dispatch', taskId, review: { ...base, ...review } }, { runAgent: options => fakeAgent(options, agent) });
  const task = (id = 'task') => store.read().tasks.find(item => item.id === id);
  const brief = (id = 'task') => obligationBrief(store.read()).next.find(item => item.id === id);
  const check = (taskId = 'task') => act({ action: 'check', taskId, check: { name: 'Fixture check', executable: process.execPath, args: ['--version'], paths: ['subject.txt'] } });
  return { root, store, base, act, receipt, dispatch, task, brief, check };
}

// A fresh lead raises findings, a fresh skeptic confirms them with a repair proposal, and the controller repairs them.
async function raise(f, ids = ['boundary']) {
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] }, { findings: ids.map(id => finding(id)) });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  const findings = f.task().findings.filter(item => item.raisedBy.requestId === lead.receipt.requestId);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings }, { findings: findings.map(item => verdict(item.id)) });
  for (const item of findings) await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: item.id });
  return { lead, skeptic, findings };
}

// Rewrites a collected Claude receipt and its native events consistently, so that only the guard under test can refuse it.
function rewriteReceipt(f, result, edit) {
  const saved = JSON.parse(fs.readFileSync(result.receiptFile, 'utf8'));
  const eventFile = path.join(f.root, saved.eventFile);
  const events = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  edit(saved, events);
  const bytes = events.map(event => JSON.stringify(event)).join('\n') + '\n';
  fs.writeFileSync(eventFile, bytes);
  fs.writeFileSync(result.receiptFile, JSON.stringify({ ...saved, eventHash: hash(Buffer.from(bytes)) }, null, 2) + '\n');
}

async function raiseAndRepair(f, ids) {
  const raised = await raise(f, ids);
  for (const item of raised.findings) await f.act({ action: 'dispose', findingId: item.id, disposition: 'implement', reason: 'Required outcome', obligation: { classification: 'required', basis: 'The accepted outcome' } });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'repaired\r\n');
  await f.act({ action: 'repair', findingIds: raised.findings.map(item => item.id) });
  await f.check();
  return raised;
}

test('the raising reviewer resumes in a new copy to record closure, and only a fresh assessment then passes the gate', async t => {
  // Arrange
  const f = fixture(t);
  const { lead, findings } = await raiseAndRepair(f);
  const calls = [];

  // Act
  const before = f.brief().review;
  const resumed = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId }, { calls });
  await f.act({ action: 'review', receipt: f.receipt(resumed) });
  const afterClosure = f.brief().review;
  const refused = await f.act({ action: 'advance' }).then(() => null, error => error);
  const fresh = await f.dispatch({ kind: 'code', candidates: [LEAD], acknowledgements: ['The boundary repair is settled by the user'] }, { calls });
  await f.act({ action: 'review', receipt: f.receipt(fresh) });

  // Assert
  assert.deepEqual({ next: before.next, targets: before.resumeTargets.map(item => [item.requestId, item.reason]) }, { next: 'resume', targets: [[lead.receipt.requestId, 'pending-closure']] });
  assert.equal(calls[0].session, lead.receipt.session);
  assert.match(calls[0].prompt, /continuing your own earlier work as the strong lead reviewer in this session/);
  assert.match(calls[0].prompt, /stale; do not read them/);
  assert.ok(calls[0].prompt.includes(findings[0].id));
  const workspaces = [lead, resumed].map(result => JSON.parse(fs.readFileSync(path.join(path.dirname(result.receiptFile), 'request.json'), 'utf8')).workspace);
  assert.notEqual(workspaces[0], workspaces[1]);
  assert.equal(calls[0].cwd, path.join(fs.realpathSync.native(f.root), workspaces[1]));
  assert.ok(calls[0].prompt.includes(`new private copy of the project at ${calls[0].cwd}`));
  assert.match(calls[1].prompt, /probes and summary\. Use an empty probes array/);
  assert.deepEqual(resumed.receipt.continues, { kind: 'resumed', requestId: lead.receipt.requestId, session: lead.receipt.session });
  assert.equal(resumed.receipt.lineage, lead.receipt.requestId);
  assert.equal(resumed.receipt.session, lead.receipt.session);
  const closed = f.task().findings.find(item => item.id === findings[0].id);
  assert.equal(closed.pendingClosure, undefined);
  assert.equal(closed.closures.at(-1).closed, true);
  assert.deepEqual({ next: afterClosure.next, freshDue: afterClosure.freshDue }, { next: 'fresh-assessment', freshDue: ['code'] });
  assert.equal(refused?.code, 'review-required');
  assert.equal(reviewGate(f.root, f.task(), f.store.read()), true);
  const request = JSON.parse(fs.readFileSync(path.join(path.dirname(fresh.receiptFile), 'request.json'), 'utf8'));
  assert.deepEqual(request.acknowledgements, ['The boundary repair is settled by the user']);
  assert.match(calls[1].prompt, /Recorded acknowledgements[^]*The boundary repair is settled by the user/);
  assert.match(calls[1].prompt, /^You are a fresh independent strong lead reviewer/);
});

test('a resume is refused for unknown, foreign, incomplete, sessionless, superseded, held, malformed and runtime-field requests', async t => {
  // Arrange
  const f = fixture(t, ['task', 'other'].map(id => ({ id, title: id, agreement: { source: 'User', outcome: 'Change both paths correctly' } })));
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  const failed = await f.dispatch({ kind: 'code', candidates: [LEAD] }, { during: () => { throw new Error('Host failed'); } }).then(() => null, error => error);
  const failedId = f.store.read().workers.findLast(worker => worker.status === 'failed').id;
  const resume = (review, agent) => f.dispatch({ kind: 'code', resume: lead.receipt.requestId, ...review }, agent);
  const codes = {};
  const attempt = async (name, work) => { codes[name] = await work().then(() => 'accepted', error => error.code); };

  // Act
  await attempt('unknown', () => resume({ resume: randomUUID() }));
  await attempt('candidates', () => resume({ candidates: [LEAD] }));
  await attempt('both', () => resume({ replaces: lead.receipt.requestId }));
  await attempt('suppliedContinuation', () => resume({ continuation: {}, candidates: [LEAD] }));
  await attempt('suppliedContext', () => resume({ continuationContext: {} }));
  await attempt('kind', () => resume({ kind: 'docs' }));
  await attempt('model', () => resume({ requiredModel: 'gpt-6-astra' }));
  await attempt('foreign', () => f.dispatch({ kind: 'code', resume: lead.receipt.requestId }, {}, 'other'));
  await attempt('incomplete', () => resume({ resume: failedId }));
  let release;
  const paused = new Promise(resolve => { release = resolve; });
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const inFlight = f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: async options => {
    started();
    await paused;
    return fakeAgent(options);
  } });
  await running;
  await attempt('held', () => resume({}));
  release();
  const first = await inFlight;
  await attempt('superseded', () => resume({}));
  f.store.update(actor, f.store.read().revision, 'fixture-unverified-worker', state => { state.workers.push({ id: randomUUID(), role: 'reviewer', taskId: 'task', host: LEAD.host, session: first.receipt.session, status: 'unverified', writes: [] }); });
  await attempt('unverified', () => f.dispatch({ kind: 'code', resume: first.receipt.requestId }));
  // The receipt, not the worker record, supplies the session a resume continues.
  fs.writeFileSync(lead.receiptFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(lead.receiptFile, 'utf8')), session: null }, null, 2) + '\n');
  await attempt('sessionless', () => resume({}));

  // Assert
  assert.equal(failed?.message, 'Host failed');
  assert.deepEqual(codes, {
    unknown: 'unknown-dispatch', candidates: 'invalid-continuation', both: 'invalid-continuation', suppliedContinuation: 'invalid-continuation', suppliedContext: 'invalid-continuation', kind: 'wrong-review-kind', model: 'model-requirement',
    foreign: 'foreign-dispatch', incomplete: 'incomplete-dispatch', held: 'session-held', superseded: 'superseded-dispatch', unverified: 'session-held', sessionless: 'sessionless-dispatch',
  });
});

test('a session failure is resume-failed without fallback, other failures keep their codes, and unproven termination holds the session', async t => {
  // Arrange
  const f = fixture(t);
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  const resume = agent => f.dispatch({ kind: 'code', resume: lead.receipt.requestId }, agent).then(() => null, error => error);
  let calls = 0;

  // A started host's own failure, after its process tree was reclaimed.
  const hostFailure = (options, message, extra = {}) => {
    options.onProcess(999999);
    throw Object.assign(new Error(message), { descendantsReclaimed: true }, extra);
  };

  // Act
  const lost = await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: options => { calls++; return hostFailure(options, 'No conversation found with that session'); } }).then(() => null, error => error);
  const beforeLaunch = await resume({ during: () => { throw new Error('No trusted executable was found'); } });
  const filesystem = await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: options => hostFailure(options, 'ENOSPC: no space left on device, write', { code: 'ENOSPC', errno: -4055 }) }).then(() => null, error => error);
  const switched = await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: options => ({ ...fakeAgent(options), session: 'another-session' }) }).then(() => null, error => error);
  const drift = await resume({ during: () => fs.writeFileSync(path.join(f.root, 'subject.txt'), 'edited during the resume\r\n') });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'after\r\n');
  const unproven = await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: options => {
    options.onProcess(999999);
    const error = new Error('The host vanished');
    error.descendantsReclaimed = false;
    throw error;
  } }).then(() => null, error => error);
  const held = await resume({});

  // Assert
  assert.equal(lost?.code, 'resume-failed');
  assert.match(lost.message, new RegExp(`Resuming session ${lead.receipt.session} failed: No conversation found`));
  assert.equal(calls, 1);
  assert.equal(beforeLaunch?.code, undefined);
  assert.equal(beforeLaunch?.message, 'No trusted executable was found');
  assert.equal(filesystem?.code, 'ENOSPC');
  assert.equal(switched?.code, 'resume-failed');
  assert.equal(drift?.code, 'review-input-drift');
  assert.equal(unproven?.code, 'termination-unverified');
  assert.equal(f.store.read().workers.at(-1).status, 'unverified');
  assert.equal(held?.code, 'session-held');
});

test('an artifact write failure in a real runner keeps its operating-system error through a resumed dispatch on both hosts', { skip: process.platform !== 'win32' }, async t => {
  // Arrange
  const f = fixture(t);
  const leads = { claude: await f.dispatch({ kind: 'code', candidates: [LEAD] }), codex: await f.dispatch({ kind: 'code', candidates: [COUNTERPART] }) };
  const inject = artifactFailure(t, 'stderr.txt');
  // The fixture host stays running until the stderr artifact fails as a full disk would, inside an actual Windows job.
  const failingRunner = options => runAgent({
    ...options, executable: process.execPath, commandPrefix: [path.join(__dirname, 'fixtures/runtime-host.cjs')], directProcess: false, timeoutMs: 60000,
    env: { ...(options.env ?? process.env), NIGHTSHIFT_TEST_HOST_MODE: 'timeout' },
    onProcess: pid => {
      options.onProcess(pid);
      inject();
    },
  });
  const failures = {};

  // Act
  for (const [host, lead] of Object.entries(leads)) {
    failures[host] = await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: failingRunner }).then(() => null, error => error);
  }

  // Assert
  for (const host of Object.keys(leads)) assert.equal(failures[host]?.code, 'ENOSPC', host);
  assert.deepEqual(f.store.read().workers.slice(-2).map(worker => worker.status), ['failed', 'failed']);
});

test('controller bookkeeping failures during a resumed dispatch keep their own codes', async t => {
  // Arrange
  const f = fixture(t);
  const continuation = { kind: 'resumed', requestId: randomUUID(), lineage: 'earlier', session: 'earlier-session' };
  const dispatch = hooks => dispatchReview(f.root, { ...f.base, runId: 'run', taskId: 'task', candidates: [LEAD], continuation, ...hooks }, { runAgent: options => fakeAgent(options) }).then(() => null, error => error.code);

  // Act
  const stopped = await dispatch({ onAttempt: () => { throw new RunError('run-stopped', 'The run is stopped'); } });
  const stale = await dispatch({ onFinalizing: () => { throw new RunError('stale-state', 'Another writer changed the run'); } });
  const unattributed = await dispatchReview(f.root, { ...f.base, runId: 'run', taskId: 'task', candidates: [LEAD], continuation }, { runAgent: options => ({ ...fakeAgent(options), session: 'another-session' }) }).then(() => null, error => error.code);

  // Assert
  assert.deepEqual({ stopped, stale, unattributed }, { stopped: 'run-stopped', stale: 'stale-state', unattributed: 'resume-failed' });
});

test('a resume reuses the receipt\'s thread total until a later attempt launches a host on the session', async t => {
  // Arrange
  const f = fixture(t);
  const lead = await f.dispatch({ kind: 'code', candidates: [COUNTERPART] }, { threadTokens: 500 });
  const priors = [];
  const resume = runner => f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: options => { priors.push(options.priorThreadTokens); return runner(options); } }).then(() => null, error => error.code);

  // Act
  const unlaunched = await resume(() => { throw new RunError('host-start-failed', 'Agent host failed to start: fixture'); });
  const drifted = await resume(options => fakeAgent(options, { launched: true, during: () => fs.writeFileSync(path.join(f.root, 'subject.txt'), 'edited during the resume\r\n') }));
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'after\r\n');
  await resume(options => fakeAgent(options));

  // Assert
  assert.deepEqual({ unlaunched, drifted }, { unlaunched: 'host-start-failed', drifted: 'review-input-drift' });
  assert.deepEqual(priors, [500, 500, null]);
});

test('a resumed Claude reviewer, chained or not, and a resumed Claude skeptic start from the thread total their receipt recorded', async t => {
  // Arrange
  const f = fixture(t);
  const priors = [];
  const resume = (review, agent) => f.act({ action: 'dispatch', review: { ...f.base, ...review } }, { runAgent: options => { priors.push(options.priorThreadTokens); return fakeAgent(options, agent); } });
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] }, { findings: [finding('boundary')], threadTokens: 200 });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  const saved = f.task().findings[0];
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [LEAD], findings: [saved] }, { findings: [verdict(saved.id)], threadTokens: 300 });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: saved.id });

  // Act
  const first = await resume({ kind: 'code', resume: lead.receipt.requestId }, { threadTokens: 350 });
  await resume({ kind: 'code', resume: first.receipt.requestId, dialogue: { findingIds: [saved.id], message: 'Does the boundary fail for zero?' } }, { dimensions: [], threadTokens: 420 });
  await resume({ kind: 'skeptic', resume: skeptic.receipt.requestId, dialogue: { findingIds: [saved.id], message: 'Confirm your verdict' } }, { findings: [verdict(saved.id)], threadTokens: 380 });

  // Assert
  assert.deepEqual({ lead: lead.receipt.threadTokens, first: first.receipt.threadTokens }, { lead: 200, first: 350 });
  assert.deepEqual(priors, [200, 350, 300]);
});

test('a replacement receives the reviewer\'s record, inherits its pending closures and continues its lineage', async t => {
  // Arrange
  const f = fixture(t);
  const { lead, findings } = await raiseAndRepair(f);
  const calls = [];

  // Act
  const skepticRefused = await f.dispatch({ kind: 'skeptic', replaces: f.store.read().workers.find(worker => worker.role === 'skeptic').id, candidates: [COUNTERPART] }).then(() => null, error => error.code);
  const replacement = await f.dispatch({ kind: 'code', replaces: lead.receipt.requestId, candidates: [COUNTERPART] }, { calls });
  await f.act({ action: 'review', receipt: f.receipt(replacement) });
  const resumedReplacement = await f.dispatch({ kind: 'code', resume: replacement.receipt.requestId });

  // Assert
  assert.equal(skepticRefused, 'invalid-continuation');
  assert.match(calls[0].prompt, new RegExp(`standing in for the strong lead reviewer of request ${lead.receipt.requestId}`));
  assert.match(calls[0].prompt, /The record of the reviewer you stand in for/);
  assert.equal(calls[0].session, undefined);
  const request = JSON.parse(fs.readFileSync(path.join(path.dirname(replacement.receiptFile), 'request.json'), 'utf8'));
  assert.equal(request.continuationContext.replacedFindings[0].pendingClosure, true);
  assert.deepEqual(request.pendingClosures, [{ id: findings[0].id, localId: 'boundary' }]);
  assert.deepEqual(replacement.receipt.continues, { kind: 'replacement', requestId: lead.receipt.requestId });
  assert.equal(replacement.receipt.lineage, lead.receipt.requestId);
  assert.notEqual(replacement.receipt.session, lead.receipt.session);
  assert.equal(f.task().findings.find(item => item.id === findings[0].id).pendingClosure, undefined);
  assert.equal(reviewGate(f.root, f.task(), f.store.read()), false);
  assert.equal(resumedReplacement.receipt.lineage, lead.receipt.requestId);
  assert.equal(resumedReplacement.receipt.session, replacement.receipt.session);
});

test('closures name each pending finding once, and a finding left open is reported again and stays pending', async t => {
  // Arrange
  const f = fixture(t);
  const { lead, findings } = await raiseAndRepair(f);
  const resume = agent => f.dispatch({ kind: 'code', resume: lead.receipt.requestId }, agent);

  // Act
  const missing = await resume({ closures: [] }).then(() => null, error => error);
  const unmatched = await resume({ closures: [{ id: findings[0].id, closed: false, evidence: 'The repair misses one branch' }] }).then(() => null, error => error);
  const open = await resume({ closures: [{ id: findings[0].id, closed: false, evidence: 'The repair misses one branch' }], findings: [finding('boundary')] });
  await f.act({ action: 'review', receipt: f.receipt(open) });

  // Assert
  assert.equal(missing?.code, 'resume-failed');
  assert.match(missing.message, /exactly one closure per finding pending closure/);
  assert.equal(unmatched?.code, 'resume-failed');
  assert.match(unmatched.message, /reported again as finding boundary/);
  const original = f.task().findings.find(item => item.id === findings[0].id);
  assert.equal(original.pendingClosure.lineage, lead.receipt.requestId);
  assert.equal(original.closures.at(-1).closed, false);
  const reported = f.task().findings.at(-1);
  assert.deepEqual(reported.relatedTo, [findings[0].id]);
  assert.equal(reviewGate(f.root, f.task(), f.store.read()), false);
});

test('a clean fresh assessment after a repair does not stand in for the raising reviewer\'s closure', async t => {
  // Arrange
  const f = fixture(t);
  const { lead, findings } = await raiseAndRepair(f);

  // Act
  const fresh = await f.dispatch({ kind: 'code', candidates: [COUNTERPART] });
  await f.act({ action: 'review', receipt: f.receipt(fresh) });
  const blocked = reviewGate(f.root, f.task(), f.store.read());
  const progress = f.brief().review;
  const resumed = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId });
  await f.act({ action: 'review', receipt: f.receipt(resumed) });
  const second = await f.dispatch({ kind: 'code', candidates: [COUNTERPART] });
  await f.act({ action: 'review', receipt: f.receipt(second) });

  // Assert
  assert.equal(blocked, false);
  assert.deepEqual({ next: progress.next, targets: progress.resumeTargets.map(item => item.requestId) }, { next: 'resume', targets: [lead.receipt.requestId] });
  assert.equal(f.task().findings.find(item => item.id === findings[0].id).pendingClosure, undefined);
  assert.equal(reviewGate(f.root, f.task(), f.store.read()), true);
});

test('pending closure survives an incomplete report, a dialogue reply, a failed import, re-validation and a later disposition', async t => {
  // Arrange
  const f = fixture(t);
  const { lead, findings } = await raiseAndRepair(f);
  const id = findings[0].id;
  const pending = () => f.task().findings.find(item => item.id === id).pendingClosure?.lineage;

  // Act
  const incomplete = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId }, { status: 'incomplete' });
  await f.act({ action: 'review', receipt: f.receipt(incomplete) });
  const afterIncomplete = pending();
  const dialogue = await f.dispatch({ kind: 'code', resume: incomplete.receipt.requestId, dialogue: { findingIds: [id], message: 'The skeptic asks whether the repair covers both branches' } }, { dimensions: [] });
  await f.act({ action: 'dialogue', receipt: f.receipt(dialogue) });
  const afterDialogue = pending();
  const stale = await f.dispatch({ kind: 'code', resume: dialogue.receipt.requestId });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'changed before import\r\n');
  const failedImport = await f.act({ action: 'review', receipt: f.receipt(stale) }).then(() => null, error => error.code);
  const afterImport = pending();
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings: [f.task().findings.find(item => item.id === id)] }, { findings: [verdict(id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: id });
  const afterValidation = pending();
  await f.act({ action: 'dispose', findingId: id, disposition: 'implement', reason: 'Still required', obligation: { classification: 'required', basis: 'The accepted outcome' } });
  const afterDisposition = pending();

  // Assert
  for (const lineage of [afterIncomplete, afterDialogue, afterImport, afterValidation, afterDisposition]) assert.equal(lineage, lead.receipt.requestId);
  assert.equal(failedImport, 'invalid-receipt');
  assert.equal(f.task().findings.find(item => item.id === id).dialogue[0].position, 'maintain');
  assert.equal(obligationBrief(f.store.read()).next[0].unresolvedFindings.find(item => item.id === id).pendingClosure, true);
});

test('after a repair batch the resume set names only the raising reviewer, and the docs review the code repair made stale is due a fresh assessment', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  await f.act({ action: 'advance' });
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs });
  await f.act({ action: 'review', receipt: f.receipt(docs) });

  // Act
  const lightBeforeRepair = obligationBrief(f.store.read(), f.root, { verifyFreshness: false }).next[0].review;
  const { lead: second } = await raiseAndRepair(f);
  const progress = f.brief().review;
  const light = obligationBrief(f.store.read(), f.root, { verifyFreshness: false }).next[0].review;

  // Assert
  assert.equal(progress.next, 'resume');
  assert.deepEqual(progress.resumeTargets.map(item => [item.requestId, item.reason]), [[second.receipt.requestId, 'pending-closure']]);
  assert.deepEqual(progress.freshTargets, [{ kind: 'docs', taskId: 'task', covers: ['task'], staleAssessments: [docs.receipt.requestId], reopens: false }]);
  // A lightweight brief evaluates no freshness, so it lists the closures owed and marks the fresh targets unevaluated.
  assert.deepEqual({ targets: light.resumeTargets.map(item => item.requestId), fresh: light.freshTargets }, { targets: [second.receipt.requestId], fresh: 'reconcile at acceptance' });
  assert.deepEqual(lightBeforeRepair.freshTargets, []);
});

test('a completed task\'s stale review of another kind is due a fresh assessment on the open task that covers it, not a resume, through the re-validation of a repaired finding', async t => {
  // Arrange
  const f = fixture(t, ['done', 'task'].map(id => ({ id, title: id, agreement: { source: 'User', outcome: 'Change both paths correctly' } })));
  await f.check('done');
  const doneLead = await f.dispatch({ kind: 'code', candidates: [LEAD] }, {}, 'done');
  await f.act({ action: 'review', taskId: 'done', receipt: f.receipt(doneLead) });
  await f.act({ action: 'advance', taskId: 'done' });
  const doneDocs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs }, 'done');
  await f.act({ action: 'review', taskId: 'done', receipt: f.receipt(doneDocs) });
  await f.act({ action: 'advance', taskId: 'done' });
  await f.act({ action: 'advance', taskId: 'done', evidence: 'Documented' });
  const targets = () => {
    const review = f.brief().review;
    return { resume: review.resumeTargets.map(item => [item.requestId, item.taskId, item.reason]), fresh: review.freshTargets };
  };

  // Act
  const { lead, findings } = await raiseAndRepair(f);
  const afterRepair = targets();
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings: [f.task().findings.find(item => item.id === findings[0].id)] }, { findings: [verdict(findings[0].id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: findings[0].id });
  const afterRevalidation = targets();

  // Assert
  // The finished task's code lead is the repaired kind, which the raising reviewer reassesses cumulatively. Its docs review has nothing
  // to close, and a docs review dispatched on the open task covers the finished task, so resuming its reviewer would reopen it needlessly.
  const expected = { resume: [[lead.receipt.requestId, 'task', 'pending-closure']], fresh: [{ kind: 'docs', taskId: 'task', covers: ['done'], staleAssessments: [doneDocs.receipt.requestId], reopens: false }] };
  assert.deepEqual(afterRepair, expected);
  assert.equal(f.task().findings.find(item => item.id === findings[0].id).repaired, false);
  assert.deepEqual(afterRevalidation, expected);
  assert.equal(f.task('done').status, 'complete');
});

test('a docs repair makes a fresh code assessment due where it made the code assessment stale', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  await f.act({ action: 'advance' });
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs, findings: [finding('readme')] });
  await f.act({ action: 'review', receipt: f.receipt(docs) });
  const claim = f.task().findings.at(-1);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [LEAD], findings: [claim] }, { findings: [verdict(claim.id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: claim.id });
  await f.act({ action: 'dispose', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Claim accuracy' } });

  // Act
  fs.writeFileSync(path.join(f.root, 'README.md'), '# Project\r\n\r\nCorrected claim.\r\n');
  await f.act({ action: 'repair', findingIds: [claim.id] });

  // Assert
  assert.deepEqual(f.brief().review.resumeTargets.map(item => [item.requestId, item.reason]), [[docs.receipt.requestId, 'pending-closure']]);
  assert.deepEqual(f.brief().review.freshTargets, [{ kind: 'code', taskId: 'task', covers: ['task'], staleAssessments: [lead.receipt.requestId], reopens: false }]);
});

test('the resume set leaves out a later lead of the repaired kind, which the raising reviewer\'s reassessment covers', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const { lead, findings } = await raise(f);
  await f.act({ action: 'dispose', findingId: findings[0].id, disposition: 'implement', reason: 'Required outcome', obligation: { classification: 'required', basis: 'The accepted outcome' } });
  const later = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(later) });

  // Act
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'repaired\r\n');
  await f.act({ action: 'repair', findingIds: [findings[0].id] });

  // Assert
  assert.equal(fresh(f.root, f.task().reviews.find(review => review.requestId === later.receipt.requestId).snapshot), false);
  assert.deepEqual(f.brief().review.resumeTargets.map(item => [item.requestId, item.reason]), [[lead.receipt.requestId, 'pending-closure']]);
});

test('the resume set leaves out an assessment imported after the repair that a later edit made stale', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const { lead } = await raiseAndRepair(f);
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs });
  await f.act({ action: 'review', receipt: f.receipt(docs) });

  // Act
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'edited after the repair\r\n');

  // Assert
  assert.equal(fresh(f.root, f.task().reviews.find(review => review.requestId === docs.receipt.requestId).snapshot), false);
  assert.deepEqual(f.brief().review.resumeTargets.map(item => [item.requestId, item.reason]), [[lead.receipt.requestId, 'pending-closure']]);
});

test('a covering assessment that several tasks\' gates read is due one fresh assessment', async t => {
  // Arrange
  const f = fixture(t, ['done', 'task'].map(id => ({ id, title: id, agreement: { source: 'User', outcome: 'Change both paths correctly' } })));
  await f.check('done');
  const doneLead = await f.dispatch({ kind: 'code', candidates: [LEAD] }, {}, 'done');
  await f.act({ action: 'review', taskId: 'done', receipt: f.receipt(doneLead) });
  await f.act({ action: 'advance', taskId: 'done' });
  const doneDocs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs }, 'done');
  await f.act({ action: 'review', taskId: 'done', receipt: f.receipt(doneDocs) });
  await f.act({ action: 'advance', taskId: 'done' });
  await f.act({ action: 'advance', taskId: 'done', evidence: 'Documented' });
  await f.act({ action: 'start-task' });
  await f.check();
  const covering = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(covering) });
  await f.act({ action: 'advance' });
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs, findings: [finding('readme')] });
  await f.act({ action: 'review', receipt: f.receipt(docs) });
  const claim = f.task().findings.at(-1);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [LEAD], findings: [claim] }, { findings: [verdict(claim.id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: claim.id });
  await f.act({ action: 'dispose', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Claim accuracy' } });

  // Act
  fs.writeFileSync(path.join(f.root, 'README.md'), '# Project\r\n\r\nCorrected claim.\r\n');
  await f.act({ action: 'repair', findingIds: [claim.id] });

  // Assert
  assert.deepEqual(f.store.read().tasks.find(item => item.id === 'task').reviews.find(review => review.requestId === covering.receipt.requestId).coveredTaskIds, ['done', 'task']);
  assert.deepEqual(f.brief().review.resumeTargets.map(item => [item.requestId, item.taskId, item.reason]), [[docs.receipt.requestId, 'task', 'pending-closure']]);
  assert.deepEqual(f.brief().review.freshTargets, [{ kind: 'code', taskId: 'task', covers: ['task', 'done'], staleAssessments: [covering.receipt.requestId], reopens: false }]);
});

test('another kind\'s stale review stays due a fresh assessment after the raising finding is re-validated, refuted and closed, until one is imported', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const initial = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(initial) });
  await f.act({ action: 'advance' });
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs });
  await f.act({ action: 'review', receipt: f.receipt(docs) });
  const raised = await raiseAndRepair(f);
  const id = raised.findings[0].id;
  const targets = () => {
    const review = f.brief().review;
    return { resume: review.resumeTargets.map(item => item.requestId), fresh: review.freshTargets.map(item => item.staleAssessments) };
  };

  // Act
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings: [f.task().findings.find(item => item.id === id)] }, { findings: [verdict(id, 'refuted')] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: id });
  await f.act({ action: 'dispose', findingId: id, disposition: 'refuted', reason: 'The repaired input no longer shows the failure' });
  const resumed = await f.dispatch({ kind: 'code', resume: raised.lead.receipt.requestId });
  await f.act({ action: 'review', receipt: f.receipt(resumed) });
  const afterClosure = targets();
  const freshDocs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs });
  await f.act({ action: 'review', receipt: f.receipt(freshDocs) });

  // Assert
  assert.equal(f.task().findings.find(item => item.id === id).pendingClosure, undefined);
  assert.deepEqual(afterClosure, { resume: [], fresh: [[docs.receipt.requestId]] });
  assert.deepEqual(targets(), { resume: [], fresh: [] });
});

test('a later code repair makes a fresh docs assessment due where it changed a continued docs review\'s inputs', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const initial = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(initial) });
  await f.act({ action: 'advance' });
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs });
  await f.act({ action: 'review', receipt: f.receipt(docs) });
  const raised = await raiseAndRepair(f);
  const docsResumed = await f.dispatch({ kind: 'docs', resume: docs.receipt.requestId }, { dimensions: DIMENSIONS.docs });
  await f.act({ action: 'review', receipt: f.receipt(docsResumed) });
  const leadResumed = await f.dispatch({ kind: 'code', resume: raised.lead.receipt.requestId }, { findings: [finding('adjacent')] });
  await f.act({ action: 'review', receipt: f.receipt(leadResumed) });
  const adjacent = f.task().findings.at(-1);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings: [adjacent] }, { findings: [verdict(adjacent.id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: adjacent.id });
  await f.act({ action: 'dispose', findingId: adjacent.id, disposition: 'implement', reason: 'Required outcome', obligation: { classification: 'required', basis: 'The accepted outcome' } });

  // Act
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'repaired again\r\n');
  await f.act({ action: 'repair', findingIds: [adjacent.id] });
  const progress = f.brief().review;

  // Assert
  assert.deepEqual(progress.resumeTargets.map(item => [item.requestId, item.reason]), [[leadResumed.receipt.requestId, 'pending-closure']]);
  assert.deepEqual(progress.freshTargets, [{ kind: 'docs', taskId: 'task', covers: ['task'], staleAssessments: [docsResumed.receipt.requestId], reopens: false }]);
  assert.deepEqual(progress.freshDue, ['code', 'docs']);
});

test('a docs repair makes a fresh code assessment due where it changed a continued code review\'s inputs', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const raised = await raiseAndRepair(f);
  const leadResumed = await f.dispatch({ kind: 'code', resume: raised.lead.receipt.requestId });
  await f.act({ action: 'review', receipt: f.receipt(leadResumed) });
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs, findings: [finding('readme')] });
  await f.act({ action: 'review', receipt: f.receipt(docs) });
  const claim = f.task().findings.at(-1);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [LEAD], findings: [claim] }, { findings: [verdict(claim.id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: claim.id });
  await f.act({ action: 'dispose', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Claim accuracy' } });

  // Act
  fs.writeFileSync(path.join(f.root, 'README.md'), '# Project\r\n\r\nCorrected claim.\r\n');
  await f.act({ action: 'repair', findingIds: [claim.id] });

  // Assert
  assert.deepEqual(f.brief().review.resumeTargets.map(item => [item.requestId, item.reason]), [[docs.receipt.requestId, 'pending-closure']]);
  assert.deepEqual(f.brief().review.freshTargets, [{ kind: 'code', taskId: 'task', covers: ['task'], staleAssessments: [leadResumed.receipt.requestId], reopens: false }]);
});

test('a code repair makes a fresh docs assessment due where it outdated an incomplete docs report', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const initial = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(initial) });
  await f.act({ action: 'advance' });
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs, status: 'incomplete' });
  await f.act({ action: 'review', receipt: f.receipt(docs) });

  // Act
  const { lead } = await raiseAndRepair(f);

  // Assert
  assert.equal(f.task().reviews.find(review => review.requestId === docs.receipt.requestId).status, 'incomplete');
  assert.deepEqual(f.brief().review.resumeTargets.map(item => [item.requestId, item.reason]), [[lead.receipt.requestId, 'pending-closure']]);
  assert.deepEqual(f.brief().review.freshTargets, [{ kind: 'docs', taskId: 'task', covers: ['task'], staleAssessments: [docs.receipt.requestId], reopens: false }]);
});

test('a docs repair makes a fresh code assessment due where it outdated an incomplete code report', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] }, { status: 'incomplete' });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs, findings: [finding('readme')] });
  await f.act({ action: 'review', receipt: f.receipt(docs) });
  const claim = f.task().findings.at(-1);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [LEAD], findings: [claim] }, { findings: [verdict(claim.id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: claim.id });
  await f.act({ action: 'dispose', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Claim accuracy' } });

  // Act
  fs.writeFileSync(path.join(f.root, 'README.md'), '# Project\r\n\r\nCorrected claim.\r\n');
  await f.act({ action: 'repair', findingIds: [claim.id] });

  // Assert
  assert.deepEqual(f.brief().review.resumeTargets.map(item => [item.requestId, item.reason]), [[docs.receipt.requestId, 'pending-closure']]);
  assert.deepEqual(f.brief().review.freshTargets, [{ kind: 'code', taskId: 'task', covers: ['task'], staleAssessments: [lead.receipt.requestId], reopens: false }]);
});

test('a resumed dispatch keeps its reserved session when its host fails with unproven termination', async t => {
  // Arrange
  const f = fixture(t);
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  let offered;

  // Act
  const failure = await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: options => {
    offered = options.onSession;
    options.onProcess(999999);
    throw Object.assign(new Error('The host stopped responding'), { descendantsReclaimed: false });
  } }).then(() => null, error => error.code);
  const unresolved = f.store.read().workers.at(-1);
  const retry = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId }).then(() => 'accepted', error => error.code);

  // Assert
  assert.equal(offered, undefined);
  assert.equal(failure, 'termination-unverified');
  assert.deepEqual({ session: unresolved.session, status: unresolved.status }, { session: lead.receipt.session, status: 'unverified' });
  assert.equal(retry, 'session-held');
});

test('a resumed worker reconciled as complete without a receipt does not supersede the dispatch whose receipt it continued', async t => {
  // Arrange
  const f = fixture(t);
  const { lead } = await raiseAndRepair(f);
  await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: options => {
    options.onProcess(999999);
    throw Object.assign(new Error('The host stopped responding'), { descendantsReclaimed: false });
  } }).then(() => null, error => error.code);
  const unverified = f.store.read().workers.at(-1);

  // Act
  await f.act({ action: 'worker-finished', workerId: unverified.id, status: 'complete', evidence: 'The process tree was confirmed ended after the attempt' });
  const target = f.brief().review.resumeTargets[0]?.requestId;
  const resumed = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId });
  await f.act({ action: 'review', receipt: f.receipt(resumed) });

  // Assert
  assert.equal(target, lead.receipt.requestId);
  assert.equal(resumed.receipt.session, lead.receipt.session);
  assert.equal(f.task().findings[0].pendingClosure, undefined);
});

test('a dispatch whose final bookkeeping failed after its receipt was written can still be resumed to close its findings', async t => {
  // Arrange
  const f = fixture(t);
  await f.act({ action: 'start-task' });
  await f.check();
  const original = RunStore.prototype.update;
  let injected = false;
  t.mock.method(RunStore.prototype, 'update', function (actor, revision, kind, change) {
    return original.call(this, actor, revision, kind, state => {
      change(state);
      if (!injected && kind === 'dispatch-progress' && state.workers.at(-1)?.status === 'complete') {
        injected = true;
        throw new RunError('stale-state', 'Injected conflict while recording the completed worker');
      }
    });
  });
  const failed = await f.dispatch({ kind: 'code', candidates: [LEAD] }, { findings: [finding('boundary')] }).then(() => null, error => error.code);
  t.mock.restoreAll();
  const worker = f.store.read().workers.at(-1);
  await f.act({ action: 'review', receipt: `${worker.artifactDirectory}/receipt.json` });
  const claim = f.task().findings[0];
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings: [claim] }, { findings: [verdict(claim.id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: claim.id });
  await f.act({ action: 'dispose', findingId: claim.id, disposition: 'implement', reason: 'Required outcome', obligation: { classification: 'required', basis: 'The accepted outcome' } });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'repaired\r\n');
  await f.act({ action: 'repair', findingIds: [claim.id] });
  await f.check();

  // Act
  const target = f.brief().review.resumeTargets[0]?.requestId;
  const resumed = await f.dispatch({ kind: 'code', resume: worker.id });
  await f.act({ action: 'review', receipt: f.receipt(resumed) });
  const fresh = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(fresh) });

  // Assert
  assert.deepEqual({ failed, injected, status: worker.status }, { failed: 'stale-state', injected: true, status: 'failed' });
  assert.equal(target, worker.id);
  assert.deepEqual({ host: resumed.receipt.host, model: resumed.receipt.model }, { host: LEAD.host, model: LEAD.model });
  assert.equal(f.task().findings.find(item => item.id === claim.id).pendingClosure, undefined);
  assert.equal(reviewGate(f.root, f.task(), f.store.read()), true);
});

for (const [name, content] of [['a partial', '{\r\n  "requestId": "'], ['an empty', '']]) {
  test(`${name} receipt left by an interrupted write is no receipt, so status and the earlier dispatch's resume keep working`, async t => {
    // Arrange
    const f = fixture(t);
    const { lead } = await raiseAndRepair(f);
    await f.act({ action: 'dispatch', review: { ...f.base, kind: 'code', resume: lead.receipt.requestId } }, { runAgent: options => {
      options.onProcess(999999);
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', errno: -4055, descendantsReclaimed: true });
    } }).then(() => null, error => error.code);
    const interrupted = f.store.read().workers.at(-1);
    fs.writeFileSync(path.join(f.root, interrupted.artifactDirectory, 'receipt.json'), content);

    // Act
    const target = f.brief().review.resumeTargets[0]?.requestId;
    const resumed = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId });
    await f.act({ action: 'review', receipt: f.receipt(resumed) });

    // Assert
    assert.equal(interrupted.status, 'failed');
    assert.equal(target, lead.receipt.requestId);
    assert.equal(f.task().findings[0].pendingClosure, undefined);
  });
}

test('an artifact write that fails leaves neither a partial file nor its temporary sibling, and keeps the earlier version whole', t => {
  // Arrange
  const parent = path.resolve(__dirname, '../.tmp/resume-tests');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'artifact-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'receipt.json');
  writeJson(file, { version: 1 });
  const original = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (target, content, ...rest) => {
    original(target, String(content).slice(0, 5), ...rest);
    throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC', errno: -4055 });
  });

  // Act
  const failure = (() => { try { writeJson(file, { version: 2 }); return null; } catch (error) { return error.code; } })();
  t.mock.restoreAll();

  // Assert
  assert.equal(failure, 'ENOSPC');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { version: 1 });
  assert.deepEqual(fs.readdirSync(directory), ['receipt.json']);
});

test('a skeptic is assigned each finding\'s claim, not the saved record with its validation snapshot', async t => {
  // Arrange
  const f = fixture(t);
  const { skeptic } = await raise(f);
  const saved = f.task().findings[0];
  const calls = [];

  // Act
  const turn = await f.dispatch({ kind: 'skeptic', resume: skeptic.receipt.requestId, dialogue: { findingIds: [saved.id], message: 'Confirm your verdict' } }, { findings: [verdict(saved.id)], calls });
  const request = JSON.parse(fs.readFileSync(path.join(path.dirname(turn.receiptFile), 'request.json'), 'utf8'));

  // Assert
  assert.ok(saved.validation.snapshot.digest);
  assert.deepEqual(Object.keys(request.findings[0]).sort(), ['consequence', 'evidence', 'id', 'localId', 'relatedTo', 'required', 'severity']);
  assert.equal(calls[0].prompt.includes(saved.validation.snapshot.digest), false);
});

test('dialogue turns relay between the reviewer and the skeptic, through resumes or replacements, and record each reply', async t => {
  // Arrange
  const f = fixture(t);
  const { lead, skeptic, findings } = await raise(f);
  const id = findings[0].id;
  const message = 'The skeptic doubts that the boundary fails for negative inputs';
  const calls = [];

  // Act
  const reply = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId, dialogue: { findingIds: [id], message } }, { dimensions: [], positions: [{ id, position: 'revise', evidence: 'It fails only for zero' }], calls });
  const asReview = await f.act({ action: 'review', receipt: f.receipt(reply) }).then(() => null, error => error.code);
  await f.act({ action: 'dialogue', receipt: f.receipt(reply) });
  const answer = await f.dispatch({ kind: 'skeptic', resume: skeptic.receipt.requestId, dialogue: { findingIds: [id], message: 'The reviewer revised the finding to zero inputs' } }, { findings: [verdict(id)], calls });
  const asDialogue = await f.act({ action: 'dialogue', receipt: f.receipt(answer) }).then(() => null, error => error.code);
  await f.act({ action: 'validate', receipt: f.receipt(answer), findingId: id });
  const leadStandIn = await f.dispatch({ kind: 'code', replaces: reply.receipt.requestId, candidates: [COUNTERPART], dialogue: { findingIds: [id], message: 'Confirm the revised scope' } }, { dimensions: [], calls });
  await f.act({ action: 'dialogue', receipt: f.receipt(leadStandIn) });
  const skepticStandIn = await f.dispatch({ kind: 'skeptic', replaces: answer.receipt.requestId, candidates: [LEAD], dialogue: { findingIds: [id], message: 'Confirm the verdict on the revised scope' } }, { findings: [verdict(id)], calls });
  await f.act({ action: 'validate', receipt: f.receipt(skepticStandIn), findingId: id });
  const other = await f.dispatch({ kind: 'code', candidates: [COUNTERPART] }, { findings: [finding('elsewhere')] });
  await f.act({ action: 'review', receipt: f.receipt(other) });
  const foreign = await f.dispatch({ kind: 'code', resume: other.receipt.requestId, dialogue: { findingIds: [id], message } }, { dimensions: [] }).then(() => null, error => error.code);

  // Assert
  assert.match(calls[0].prompt, /This is a dialogue turn, not a new assessment/);
  assert.ok(calls[0].prompt.includes(message));
  assert.equal(calls[0].schema.properties.findings.maxItems, 0);
  assert.equal(asReview, 'dialogue-receipt');
  assert.equal(asDialogue, 'dialogue-receipt-required');
  assert.match(calls[2].prompt, /standing in for the strong lead reviewer/);
  assert.match(calls[2].prompt, /It fails only for zero/);
  assert.equal(calls[3].session, undefined);
  const recorded = f.task().findings.find(item => item.id === id);
  assert.deepEqual(recorded.dialogue.map(entry => [entry.role, entry.position ?? entry.verdict]), [['reviewer', 'revise'], ['skeptic', 'confirmed'], ['reviewer', 'maintain'], ['skeptic', 'confirmed']]);
  assert.equal(recorded.validation.requestId, skepticStandIn.receipt.requestId);
  assert.equal(recorded.disposition, null);
  assert.equal(foreign, 'foreign-finding');
});

test('a repair needs the skeptic\'s proposal, which a dialogue turn supplies when the controller implements against a refutation', async t => {
  // Arrange
  const f = fixture(t);
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] }, { findings: [finding('boundary')] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  const id = f.task().findings[0].id;
  const missing = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings: [f.task().findings[0]] }, { findings: [verdict(id, 'confirmed', '')] }).then(() => null, error => error);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings: [f.task().findings[0]] }, { findings: [verdict(id, 'refuted')] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: id });
  await f.act({ action: 'dispose', findingId: id, disposition: 'implement', reason: 'The controller repairs the boundary anyway' });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'repaired\r\n');

  // Act
  const refused = await f.act({ action: 'repair', findingIds: [id] }).then(() => null, error => error.code);
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'after\r\n');
  const proposal = await f.dispatch({ kind: 'skeptic', resume: skeptic.receipt.requestId, dialogue: { findingIds: [id], message: 'The controller will repair anyway; propose the approach' } }, { findings: [verdict(id, 'refuted', 'Guard the zero input before the branch')] });
  await f.act({ action: 'validate', receipt: f.receipt(proposal), findingId: id });
  await f.act({ action: 'dispose', findingId: id, disposition: 'implement', reason: 'The controller repairs the boundary anyway' });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'repaired\r\n');
  await f.act({ action: 'repair', findingIds: [id] });

  // Assert
  assert.equal(missing?.code, 'invalid-request');
  assert.match(missing.message, /repairProposal/);
  assert.equal(refused, 'repair-proposal-required');
  const repaired = f.task().findings[0];
  assert.equal(repaired.validation.repairProposal, 'Guard the zero input before the branch');
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.pendingClosure.lineage, lead.receipt.requestId);
});

test('a confirmed verdict without a repair proposal, as an earlier release recorded it, is refused at import and by the transition', async t => {
  // Arrange
  const f = fixture(t);
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] }, { findings: [finding('boundary')] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  const claim = f.task().findings[0];
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [LEAD], findings: [claim] }, { findings: [verdict(claim.id)] });
  const withoutProposal = findings => findings.map(({ repairProposal, ...rest }) => rest);
  rewriteReceipt(f, skeptic, (receipt, events) => {
    receipt.findings = withoutProposal(receipt.findings);
    const result = events.find(event => event.type === 'result');
    result.structured_output.findings = withoutProposal(result.structured_output.findings);
  });
  const direct = lifecycleFixture(t, [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } }]);
  direct.review('code', direct.assessment('code', ['code'], { findings: [finding('boundary')] }));
  const directClaim = direct.task('code').findings[0];

  // Act
  const imported = await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: claim.id }).then(() => null, error => error.code);
  const transitioned = (() => { try { direct.act({ action: 'validate', taskId: 'code', findingId: directClaim.id, validation: { session: 'skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Reproduced', snapshot: snapshot(direct.root, ['src.js']) } }); return null; } catch (error) { return error.code; } })();

  // Assert
  assert.equal(imported, 'missing-repair-proposal');
  assert.equal(transitioned, 'missing-repair-proposal');
  assert.equal(f.task().findings[0].validation, null);
});

test('a resumed receipt whose native result comes from another session is refused at import', async t => {
  // Arrange
  const f = fixture(t);
  const lead = await f.dispatch({ kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'review', receipt: f.receipt(lead) });
  const resumed = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId });
  rewriteReceipt(f, resumed, (receipt, events) => {
    receipt.session = 'another-session';
    for (const event of events) event.session_id = 'another-session';
  });

  // Act
  const refused = await f.act({ action: 'review', receipt: f.receipt(resumed) }).then(() => null, error => error);

  // Assert
  assert.equal(refused?.code, 'unattributed-review');
  assert.match(refused.message, /session it resumed/);
});

test('a reviewer\'s dialogue reply is imported as receipt maintenance without a new engineering claim', async t => {
  // Arrange
  const f = fixture(t);
  const { lead, findings } = await raise(f);
  const id = findings[0].id;
  const reply = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId, dialogue: { findingIds: [id], message: 'The skeptic asks whether both branches fail' } }, { dimensions: [] });
  const claim = f.store.read().controllerClaim;
  const unavailable = { nativeOwner: () => { throw new Error('Maintenance must not require native controller inspection'); } };

  // Act
  await f.act({ action: 'dialogue', receipt: f.receipt(reply) }, unavailable);
  const engineering = await f.act({ action: 'start-task' }, unavailable).then(() => null, error => error.code);

  // Assert
  assert.equal(f.task().findings.find(item => item.id === id).dialogue[0].position, 'maintain');
  assert.deepEqual(f.store.read().controllerClaim, claim);
  assert.equal(engineering, 'controller-claim-required');
});

test('repairs come first, and the fresh lead follows once important findings of a continued assessment are settled without an edit', async t => {
  // Arrange
  const f = fixture(t);
  const { lead } = await raiseAndRepair(f);
  const resumed = await f.dispatch({ kind: 'code', resume: lead.receipt.requestId }, { findings: [finding('adjacent')] });
  await f.act({ action: 'review', receipt: f.receipt(resumed) });
  const adjacent = f.task().findings.at(-1);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [COUNTERPART], findings: [adjacent] }, { findings: [verdict(adjacent.id)] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: adjacent.id });

  // Act
  const undecided = f.brief().review.next;
  await f.act({ action: 'dispose', findingId: adjacent.id, disposition: 'implement', reason: 'Worth doing', obligation: { classification: 'optional', basis: 'Within the repair authority' } });
  const repairFirst = f.brief().review.next;
  await f.act({ action: 'dispose', findingId: adjacent.id, disposition: 'skip', reason: 'An accepted tradeoff', obligation: { classification: 'optional', basis: 'Within the repair authority' } });
  const settled = f.brief().review;

  // Assert
  assert.equal(undecided, 'validate-and-dispose');
  assert.equal(repairFirst, 'repair');
  assert.deepEqual({ next: settled.next, freshDue: settled.freshDue }, { next: 'fresh-assessment', freshDue: ['code'] });
  assert.equal(reviewGate(f.root, f.task(), f.store.read()), false);
});

// Direct lifecycle transitions over assessments built in place, as earlier releases and the docs-review tests record them.
function lifecycleFixture(t, tasks) {
  const parent = path.resolve(__dirname, '../.tmp/resume-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'lifecycle-'));
  git(root, ['init', '--quiet']);
  for (const [file, content] of [['src.js', 'module.exports = 1;\n'], ['spec.md', '# Spec\n'], ['.nightshift/BUGS.md', '# Bugs\n']]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish lifecycle baseline']);
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({ objective: 'Deliver accepted work', authority: 'User agreed the scope', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks });
  let sequence = 0;
  const act = request => store.update(actor, store.read().revision, request.action, state => transition(state, request));
  const assessment = (kind, covered, overrides = {}) => {
    sequence++;
    const coveredTasks = store.read().tasks.filter(task => covered.includes(task.id));
    const inventory = inventorySnapshot(root);
    return { requestId: `${kind}-${sequence}`, kind, session: `${kind}-reviewer-${sequence}`, attributionVerified: true, status: 'complete', strength: 'strong', independent: true, broad: true, dimensions: [...DIMENSIONS[kind]], coverageEvidence: 'Assessed the complete change', coveredTaskIds: covered, commitments: commitmentsFor(coveredTasks), snapshot: kind === 'spec' ? snapshot(root, ['spec.md']) : inventory, contextSnapshot: inventory, findings: [], ...overrides };
  };
  const continued = (kind, covered, overrides = {}) => assessment(kind, covered, { continues: { kind: 'resumed', requestId: 'earlier', session: 'earlier-session' }, lineage: 'earlier', closures: [], ...overrides });
  const review = (taskId, review) => act({ action: 'review', taskId, review });
  const check = taskId => act({ action: 'check', taskId, evidence: verifyCommand(root, { name: 'Fixture check', executable: process.execPath, args: ['--version'], paths: ['src.js'] }) });
  const write = (file, content) => fs.writeFileSync(path.join(root, file), content);
  const task = id => store.read().tasks.find(item => item.id === id);
  return { root, store, act, assessment, continued, review, check, write, task };
}

test('a continued assessment satisfies no gate or coverage condition, while fresh and earlier-release assessments do', t => {
  // Arrange
  const code = { id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } };
  const later = { id: 'later', title: 'Later code', requires: ['code'], agreement: { source: 'User', outcome: 'Later behavior' } };
  const spec = { id: 'spec', title: 'Spec', kind: 'spec', agreement: { source: 'User', outcome: 'Accepted behavior', spec: 'spec.md' } };
  const f = lifecycleFixture(t, [code, later, spec]);
  const gate = id => reviewGate(f.root, f.task(id), f.store.read());
  const fresh = f.assessment('code', ['code']);
  const results = {};

  // Act
  results.earlierRelease = completeAssessment(fresh);
  results.continuedShape = completeAssessment({ ...fresh, continues: { kind: 'replacement', requestId: 'earlier' } });
  f.check('code');
  f.review('code', f.continued('code', ['code']));
  results.codeContinued = gate('code');
  f.review('code', f.assessment('code', ['code']));
  results.codeFresh = gate('code');
  f.review('spec', f.continued('spec', ['spec']));
  results.specContinued = gate('spec');
  f.review('spec', f.assessment('spec', ['spec']));
  results.specFresh = gate('spec');
  f.act({ action: 'advance', taskId: 'code' });
  f.review('code', f.continued('docs', ['code']));
  results.docsContinued = (() => { try { f.act({ action: 'advance', taskId: 'code' }); return 'advanced'; } catch (error) { return error.code; } })();
  f.review('code', f.assessment('docs', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
  f.act({ action: 'start-task', taskId: 'later' });
  f.check('later');
  f.write('src.js', 'module.exports = 2;\n');
  f.check('later');
  f.check('code');
  f.review('later', f.continued('code', ['code', 'later']));
  results.coveredContinued = gate('code');
  f.review('later', f.assessment('code', ['code', 'later']));
  results.coveredFresh = gate('code');

  // Assert
  assert.deepEqual(results, { earlierRelease: true, continuedShape: false, codeContinued: false, codeFresh: true, specContinued: false, specFresh: true, docsContinued: 'docs-review-required', coveredContinued: false, coveredFresh: true });
});

test('a code repair that leaves the governing spec unchanged does not name the continued spec reviewer', t => {
  // Arrange
  const code = { id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } };
  const spec = { id: 'spec', title: 'Spec', kind: 'spec', agreement: { source: 'User', outcome: 'Accepted behavior', spec: 'spec.md' } };
  const f = lifecycleFixture(t, [code, spec]);
  f.review('spec', f.continued('spec', ['spec']));
  f.check('code');
  f.review('code', f.assessment('code', ['code'], { findings: [finding('boundary')] }));
  const claim = f.task('code').findings[0];
  f.act({ action: 'validate', taskId: 'code', findingId: claim.id, validation: { session: 'code-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Reproduced', repairProposal: 'Guard the boundary', snapshot: snapshot(f.root, ['src.js']) } });
  f.act({ action: 'dispose', taskId: 'code', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'The accepted outcome' } });

  // Act
  f.write('src.js', 'module.exports = 2;\n');
  f.act({ action: 'repair', taskId: 'code', findingIds: [claim.id] });
  const progress = reviewProgress(f.root, f.store.read(), f.task('code'));

  // Assert
  assert.deepEqual(progress.resumeTargets.map(item => [item.taskId, item.reason]), [['code', 'pending-closure']]);
});

test('a docs review does not count while a repaired docs finding awaits its reviewer\'s closure, even when it is fresh and clean', t => {
  // Arrange
  const f = lifecycleFixture(t, [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } }]);
  f.check('code');
  f.review('code', f.assessment('code', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.review('code', f.assessment('docs', ['code'], { findings: [finding('claim')] }));
  const docsFinding = f.task('code').findings.at(-1);
  f.act({ action: 'validate', taskId: 'code', findingId: docsFinding.id, validation: { session: 'docs-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'The claim is stale', repairProposal: 'Restate the claim', snapshot: snapshot(f.root, ['src.js']) } });
  f.act({ action: 'dispose', taskId: 'code', findingId: docsFinding.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Claim accuracy' } });
  f.write('.nightshift/BUGS.md', '# Bugs\n\nRestated claim.\n');
  f.act({ action: 'repair', taskId: 'code', findingIds: [docsFinding.id] });
  const attempt = () => { try { f.act({ action: 'advance', taskId: 'code' }); return 'advanced'; } catch (error) { return error.code; } };

  // Act
  f.review('code', f.assessment('docs', ['code']));
  const relievedBeforeClosure = reviewGate(f.root, f.task('code'), f.store.read());
  const beforeClosure = attempt();
  f.review('code', f.continued('docs', ['code'], { lineage: docsFinding.raisedBy.lineage, closures: [{ id: docsFinding.id, closed: true, evidence: 'The claim is restated' }] }));
  f.review('code', f.assessment('docs', ['code']));
  const afterClosure = attempt();

  // Assert
  // The backlog repair staled the code assessment, which is relieved only by a current docs review; the pending closure withholds it.
  assert.equal(relievedBeforeClosure, false);
  assert.equal(beforeClosure, 'review-required');
  assert.equal(afterClosure, 'advanced');
});

test('a code assessment that a current docs review relieves after a backlog-only docs repair is not a resume target', t => {
  // Arrange
  const f = lifecycleFixture(t, [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } }]);
  f.check('code');
  f.review('code', f.assessment('code', ['code']));
  const lead = f.task('code').reviews.at(-1);
  f.act({ action: 'advance', taskId: 'code' });
  f.review('code', f.assessment('docs', ['code'], { findings: [finding('claim')] }));
  const claim = f.task('code').findings.at(-1);
  f.act({ action: 'validate', taskId: 'code', findingId: claim.id, validation: { session: 'docs-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'The claim is stale', repairProposal: 'Restate the claim', snapshot: snapshot(f.root, ['src.js']) } });
  f.act({ action: 'dispose', taskId: 'code', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Claim accuracy' } });
  f.write('.nightshift/BUGS.md', '# Bugs\n\nRestated claim.\n');
  f.act({ action: 'repair', taskId: 'code', findingIds: [claim.id] });

  // Act
  f.review('code', f.continued('docs', ['code'], { lineage: claim.raisedBy.lineage, closures: [{ id: claim.id, closed: true, evidence: 'The claim is restated' }] }));
  f.review('code', f.assessment('docs', ['code']));
  const progress = reviewProgress(f.root, f.store.read(), f.task('code'));

  // Assert
  // The repair left the code assessment's inputs changed, but only on a backlog path a current docs review covers.
  assert.equal(fresh(f.root, lead.snapshot), false);
  assert.equal(reviewGate(f.root, f.task('code'), f.store.read()), true);
  assert.deepEqual(progress.resumeTargets, []);
});

test('a completed task\'s stale review that no open task can cover is due a fresh assessment on that task, marked as reopening it', t => {
  // Arrange
  const f = lifecycleFixture(t, [{ id: 'done', title: 'Done', agreement: { source: 'User', outcome: 'Accepted behavior' } }, { id: 'lore', title: 'Lore', kind: 'lore', agreement: { source: 'User', outcome: 'Accepted retrospective' } }]);
  f.check('done');
  f.review('done', f.assessment('code', ['done']));
  f.act({ action: 'advance', taskId: 'done' });
  f.review('done', f.assessment('docs', ['done']));
  const doneDocs = f.task('done').reviews.at(-1);
  f.act({ action: 'advance', taskId: 'done' });
  f.act({ action: 'advance', taskId: 'done', evidence: 'Documented' });
  f.review('lore', f.assessment('code', ['lore'], { findings: [finding('proposal')] }));
  const claim = f.task('lore').findings[0];
  f.act({ action: 'validate', taskId: 'lore', findingId: claim.id, validation: { session: 'lore-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Reproduced', repairProposal: 'Narrow the proposal', snapshot: snapshot(f.root, ['src.js']) } });
  f.act({ action: 'dispose', taskId: 'lore', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'The accepted outcome' } });

  // Act
  f.write('src.js', 'module.exports = 2;\n');
  f.act({ action: 'repair', taskId: 'lore', findingIds: [claim.id] });
  const progress = reviewProgress(f.root, f.store.read(), f.task('lore'));

  // Assert
  // A lore task shares no cumulative assessment, so only a docs review dispatched on the finished task itself can cover its stale gate.
  assert.equal(f.task('done').status, 'complete');
  assert.deepEqual(progress.resumeTargets.map(item => [item.taskId, item.reason]), [['lore', 'pending-closure']]);
  assert.deepEqual(progress.freshTargets, [{ kind: 'docs', taskId: 'done', covers: ['done'], staleAssessments: [doneDocs.requestId], reopens: true }]);
});

test('the closing record and the triage baseline accept only fresh assessments, and closing findings pending closure survive record replacement', t => {
  // Arrange
  const f = lifecycleFixture(t, [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } }]);
  f.check('code');
  f.review('code', f.assessment('code', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.review('code', f.assessment('docs', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write('.nightshift/BUGS.md', '# Bugs\n\nTracked follow-up.\n');
  const firstBaseline = f.store.read().closing.docs.baseline.digest;
  const outcomes = {};
  // Importing a review reopens its task, so a completed run never reaches triage with a continued review as its only fresh one;
  // the state is seeded directly to show the baseline test refuses it while accepting the same assessment when fresh.
  const seed = review => f.store.update(actor, f.store.read().revision, 'fixture-task-assessment', state => { state.tasks[0].reviews.push({ ...review, revision: state.revision + 1 }); });

  // Act
  seed(f.continued('code', ['code']));
  f.act({ action: 'triage', evidence: 'A later follow-up triaged' });
  outcomes.baselineKept = f.store.read().closing.docs.baseline.digest === firstBaseline;
  seed(f.assessment('code', ['code']));
  f.act({ action: 'triage', evidence: 'Triaged after a fresh assessment' });
  outcomes.baselineMoved = f.store.read().closing.docs.baseline.digest !== firstBaseline;
  f.review(CLOSING_TARGET, f.continued('docs', ['code']));
  outcomes.continuedClosing = (() => { try { f.act({ action: 'complete' }); return 'complete'; } catch (error) { return error.code; } })();
  f.review(CLOSING_TARGET, f.assessment('docs', ['code'], { findings: [finding('date-order')] }));
  const closingFinding = f.store.read().closing.docs.findings.at(-1);
  f.act({ action: 'validate', taskId: CLOSING_TARGET, findingId: closingFinding.id, validation: { session: 'closing-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Dates are out of order', repairProposal: 'Order the entries by date', snapshot: snapshot(f.root, ['.nightshift/BUGS.md']) } });
  f.act({ action: 'dispose', taskId: CLOSING_TARGET, findingId: closingFinding.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Backlog conventions' } });
  f.write('.nightshift/BUGS.md', '# Bugs\n\nTracked follow-up, dated.\n');
  f.act({ action: 'repair', taskId: CLOSING_TARGET, findingIds: [closingFinding.id] });
  // A closing repair reopens no task, so it resumes only the reviewer that raised the repaired finding.
  outcomes.closingTargets = obligationBrief(f.store.read()).closing.docsReview.review.resumeTargets.map(item => [item.taskId, item.reason]);
  f.act({ action: 'triage', evidence: 'Triage recorded again' });
  outcomes.carriedByTriage = f.store.read().closing.docs.findings.some(item => item.id === closingFinding.id && item.pendingClosure);
  f.act({ action: 'retrospective', evidence: 'A new retrospective' });
  outcomes.carriedByReset = obligationBrief(f.store.read()).closing.carriedFindings;
  // With no closing record to fail first, completion names the carried finding itself.
  outcomes.pendingAfterReset = (() => { try { f.act({ action: 'complete' }); return 'complete'; } catch (error) { return error.code; } })();
  f.act({ action: 'triage', evidence: 'Triaged after the reset' });
  outcomes.restored = f.store.read().closing.docs.findings.some(item => item.id === closingFinding.id && item.pendingClosure);
  outcomes.refused = (() => { try { f.act({ action: 'complete' }); return 'complete'; } catch (error) { return error.code; } })();
  const lineage = closingFinding.raisedBy.lineage;
  f.review(CLOSING_TARGET, f.continued('docs', ['code'], { lineage, closures: [{ id: closingFinding.id, closed: true, evidence: 'Dates are ordered' }] }));
  outcomes.closedButContinued = (() => { try { f.act({ action: 'complete' }); return 'complete'; } catch (error) { return error.code; } })();
  f.review(CLOSING_TARGET, f.assessment('docs', ['code']));
  outcomes.completed = f.act({ action: 'complete' }).status;

  // Assert
  assert.deepEqual(outcomes, { baselineKept: true, baselineMoved: true, continuedClosing: 'closing-review-unresolved', closingTargets: [[CLOSING_TARGET, 'pending-closure']], carriedByTriage: true, carriedByReset: [closingFinding.id], pendingAfterReset: 'closure-pending', restored: true, refused: 'closing-review-unresolved', closedButContinued: 'closing-review-unresolved', completed: 'complete' });
  assert.equal(f.store.read().closing.docs.findings.find(item => item.id === closingFinding.id).pendingClosure, undefined);
});

test('a closing finding carried across a reset record keeps its validation snapshot as stored evidence', t => {
  // Arrange
  const f = lifecycleFixture(t, [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } }]);
  f.check('code');
  f.review('code', f.assessment('code', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.review('code', f.assessment('docs', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write('.nightshift/BUGS.md', '# Bugs\n\nTracked follow-up.\n');
  f.review(CLOSING_TARGET, f.assessment('docs', ['code'], { findings: [finding('date-order')] }));
  const claim = f.store.read().closing.docs.findings.at(-1);
  const validationSnapshot = snapshot(f.root, ['.nightshift/BUGS.md']);
  f.act({ action: 'validate', taskId: CLOSING_TARGET, findingId: claim.id, validation: { session: 'closing-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Dates are out of order', repairProposal: 'Order the entries by date', snapshot: validationSnapshot } });
  f.act({ action: 'dispose', taskId: CLOSING_TARGET, findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Backlog conventions' } });
  f.write('.nightshift/BUGS.md', '# Bugs\n\nTracked follow-up, dated.\n');
  f.act({ action: 'repair', taskId: CLOSING_TARGET, findingIds: [claim.id] });

  // Act
  f.act({ action: 'retrospective', evidence: 'A new retrospective' });
  const saved = JSON.parse(f.store.db.prepare('SELECT state FROM runs').get().state);

  // Assert
  assert.deepEqual(Object.keys(saved.closing.carriedFindings[0].validation.snapshot), ['$artifact']);
  assert.deepEqual(f.store.read().closing.carriedFindings[0].validation.snapshot, validationSnapshot);
});

test('a reviewer\'s dialogue reply is recorded on a closing-record finding its lineage raised', t => {
  // Arrange
  const f = lifecycleFixture(t, [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } }]);
  f.check('code');
  f.review('code', f.assessment('code', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.review('code', f.assessment('docs', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write('.nightshift/BUGS.md', '# Bugs\n\nTracked follow-up.\n');
  f.review(CLOSING_TARGET, f.assessment('docs', ['code'], { findings: [finding('date-order')] }));
  const claim = f.store.read().closing.docs.findings.at(-1);
  const reply = { requestId: 'closing-dialogue', lineage: claim.raisedBy.lineage, session: 'closing-reviewer', message: 'The skeptic asks whether the order matters', positions: [{ id: claim.id, position: 'maintain', evidence: 'Readers scan by date' }], snapshot: snapshot(f.root, ['.nightshift/BUGS.md']) };

  // Act
  f.act({ action: 'dialogue', taskId: CLOSING_TARGET, reply });

  // Assert
  const recorded = f.store.read().closing.docs.findings.find(item => item.id === claim.id);
  assert.deepEqual(recorded.dialogue.map(entry => [entry.role, entry.position]), [['reviewer', 'maintain']]);
  assert.equal(f.task('code').status, 'complete');
});

for (const reset of [false, true]) {
  test(`a closing record whose repaired tracking edit restored the baseline needs no further review after triage again, reset=${reset}`, t => {
    // Arrange
    const f = lifecycleFixture(t, [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } }]);
    f.check('code');
    f.review('code', f.assessment('code', ['code']));
    f.act({ action: 'advance', taskId: 'code' });
    f.review('code', f.assessment('docs', ['code']));
    f.act({ action: 'advance', taskId: 'code' });
    f.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
    f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
    f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
    const baseline = fs.readFileSync(path.join(f.root, '.nightshift/BUGS.md'), 'utf8');
    f.write('.nightshift/BUGS.md', baseline + '\nAn incorrectly tracked entry.\n');
    f.review(CLOSING_TARGET, f.assessment('docs', ['code'], { findings: [finding('incorrect-entry')] }));
    const claim = f.store.read().closing.docs.findings.at(-1);
    f.act({ action: 'validate', taskId: CLOSING_TARGET, findingId: claim.id, validation: { session: 'closing-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'The new entry is incorrect', repairProposal: 'Remove the incorrect entry', snapshot: snapshot(f.root, ['.nightshift/BUGS.md']) } });
    f.act({ action: 'dispose', taskId: CLOSING_TARGET, findingId: claim.id, disposition: 'implement', reason: 'Remove inaccurate tracking', obligation: { classification: 'required', basis: 'Backlog accuracy' } });
    f.write('.nightshift/BUGS.md', baseline);
    f.act({ action: 'repair', taskId: CLOSING_TARGET, findingIds: [claim.id] });
    f.review(CLOSING_TARGET, f.continued('docs', ['code'], { lineage: claim.raisedBy.lineage, closures: [{ id: claim.id, closed: true, evidence: 'The inaccurate entry was removed' }] }));
    const complete = () => { try { return f.act({ action: 'complete' }).status; } catch (error) { return error.code; } };
    const beforeTriage = complete();

    // Act
    if (reset) f.act({ action: 'retrospective', evidence: 'Retrospective re-recorded after the correction' });
    f.act({ action: 'triage', evidence: 'Triage re-recorded after the correction' });

    // Assert
    // The continued closing review is never accepted: with every tracking edit reverted, nothing remains that a closing review must cover.
    assert.equal(beforeTriage, 'closing-review-unresolved');
    assert.equal(complete(), 'complete');
  });

  test(`an unsettled closing finding survives the closing record's replacement and completion waits for its disposition, reset=${reset}`, t => {
    // Arrange
    const { f, unsettled, complete } = closingWithUnsettledFinding(t);

    // Act
    if (reset) f.act({ action: 'retrospective', evidence: 'Retrospective re-recorded after the correction' });
    const carried = reset ? obligationBrief(f.store.read()).closing.carriedFindings : null;
    f.act({ action: 'triage', evidence: 'Triage re-recorded after the correction' });
    const beforeDisposition = complete();
    f.act({ action: 'validate', taskId: CLOSING_TARGET, findingId: unsettled.id, validation: { session: 'closing-skeptic-2', attributionVerified: true, verdict: 'refuted', evidence: 'The reverted entry left nothing untracked', repairProposal: null, snapshot: snapshot(f.root, ['.nightshift/BUGS.md']) } });
    f.act({ action: 'dispose', taskId: CLOSING_TARGET, findingId: unsettled.id, disposition: 'refuted', reason: 'The skeptic refuted it' });

    // Assert
    if (reset) assert.deepEqual(carried, [unsettled.id]);
    assert.ok(f.store.read().closing.docs.findings.some(item => item.id === unsettled.id));
    assert.equal(beforeDisposition, 'closing-review-unresolved');
    assert.equal(complete(), 'complete');
  });

  test(`a closing review imported again after its record was replaced is refused rather than duplicating its carried finding, reset=${reset}`, t => {
    // Arrange
    const { f, unsettled, continued } = closingWithUnsettledFinding(t);
    if (reset) f.act({ action: 'retrospective', evidence: 'Retrospective re-recorded after the correction' });
    f.act({ action: 'triage', evidence: 'Triage re-recorded after the correction' });

    // Act
    const retried = (() => { try { f.review(CLOSING_TARGET, continued); return null; } catch (error) { return error.code; } })();

    // Assert
    assert.equal(retried, 'duplicate-review');
    assert.equal(f.store.read().closing.docs.findings.filter(item => item.id === unsettled.id).length, 1);
  });
}

// A completed run whose closing record holds a repaired tracking edit, reverted and closed by a continued review that raised a further
// finding, which is still unsettled.
function closingWithUnsettledFinding(t) {
  const f = lifecycleFixture(t, [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior' } }]);
  f.check('code');
  f.review('code', f.assessment('code', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.review('code', f.assessment('docs', ['code']));
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  const baseline = fs.readFileSync(path.join(f.root, '.nightshift/BUGS.md'), 'utf8');
  f.write('.nightshift/BUGS.md', baseline + '\nAn incorrectly tracked entry.\n');
  f.review(CLOSING_TARGET, f.assessment('docs', ['code'], { findings: [finding('incorrect-entry')] }));
  const claim = f.store.read().closing.docs.findings.at(-1);
  f.act({ action: 'validate', taskId: CLOSING_TARGET, findingId: claim.id, validation: { session: 'closing-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'The new entry is incorrect', repairProposal: 'Remove the incorrect entry', snapshot: snapshot(f.root, ['.nightshift/BUGS.md']) } });
  f.act({ action: 'dispose', taskId: CLOSING_TARGET, findingId: claim.id, disposition: 'implement', reason: 'Remove inaccurate tracking', obligation: { classification: 'required', basis: 'Backlog accuracy' } });
  f.write('.nightshift/BUGS.md', baseline);
  f.act({ action: 'repair', taskId: CLOSING_TARGET, findingIds: [claim.id] });
  const continued = f.continued('docs', ['code'], { lineage: claim.raisedBy.lineage, findings: [finding('follow-up-untracked')], closures: [{ id: claim.id, closed: true, evidence: 'The inaccurate entry was removed' }] });
  f.review(CLOSING_TARGET, continued);
  const unsettled = f.store.read().closing.docs.findings.find(item => item.localId === 'follow-up-untracked');
  const complete = () => { try { return f.act({ action: 'complete' }).status; } catch (error) { return error.code; } };
  return { f, unsettled, continued, complete };
}

test('a receipt from an earlier release reads as a fresh dispatch of its own lineage', async t => {
  // Arrange
  const f = fixture(t);
  const { receiptFile } = await dispatchReview(f.root, { ...f.base, runId: 'run', taskId: 'task', candidates: [LEAD] }, { runAgent: options => fakeAgent(options) });
  const requestFile = path.join(path.dirname(receiptFile), 'request.json');
  const strip = (file, fields) => {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const field of fields) delete saved[field];
    fs.writeFileSync(file, JSON.stringify(saved, null, 2) + '\n');
  };

  // Act
  strip(requestFile, ['continues', 'lineage', 'pendingClosures', 'dialogue', 'acknowledgements', 'continuationContext']);
  strip(receiptFile, ['continues', 'lineage', 'dialogue', 'closures', 'positions', 'threadTokens']);
  const read = readReceipt(f.root, path.relative(f.root, receiptFile).split(path.sep).join('/'), { id: 'run', controller: { session: 'controller' } }, 'task');

  // Assert
  assert.equal(read.continues, undefined);
  assert.equal(completeAssessment({ ...read, revision: 1 }), true);
});
