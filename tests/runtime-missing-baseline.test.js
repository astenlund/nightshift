'use strict';

const { fixtureContinuation } = require('./fixtures/continuation');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { DIMENSIONS, obligationBrief } = require('../internal/runtime/lifecycle');
const { RunStore } = require('../internal/runtime/store');
const { fixtureControllerClaim, executeWithFixtureController } = require('./fixtures/controller-claim');

const actor = { host: 'codex', session: 'controller' };
const LEAD = { host: 'claude', model: 'claude-fable-5-1', effort: 'high' };
const COUNTERPART = { host: 'codex', model: 'gpt-6-astra', effort: 'high' };

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

let sessions = 0;

// A fixture host returning a complete report with the given coverage, findings and applicability, as native Claude or Codex events.
function fakeAgent(options, { findings = [], dimensions = DIMENSIONS.code, applicability } = {}) {
  fs.mkdirSync(options.artifacts, { recursive: true });
  const request = JSON.parse(fs.readFileSync(path.join(options.artifacts, '..', 'request.json'), 'utf8'));
  const report = { requestId: request.id, status: 'complete', coverage: dimensions.map(dimension => ({ dimension, evidence: 'Assessed the change' })), findings, probes: [], summary: 'Fixture report', toolFailure: '' };
  if (request.kind !== 'skeptic') Object.assign(report, { closures: [], applicability: [], positions: [] });
  if (request.relevance) Object.assign(report, { coverage: [], applicability: applicability ?? request.relevance.taskIds.map(id => ({ id, outcome: 'preserve', evidence: 'The change leaves the assessment standing' })) });
  // A resumed attempt continues the session it was asked to resume.
  const session = options.session ?? `session-${++sessions}`;
  const events = options.host === 'codex'
    ? [{ id: 2, result: { thread: { id: session }, model: options.model } }, { method: 'item/completed', params: { threadId: session, item: { type: 'agentMessage', text: JSON.stringify(report) } } }, { method: 'turn/completed', params: { threadId: session, turn: { status: 'completed' } } }]
    : [{ type: 'assistant', session_id: session, message: { model: options.model, content: [] } }, { type: 'result', session_id: session, subtype: 'success', is_error: false, structured_output: report }];
  fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  return { host: options.host, model: options.model, effort: options.effort, session, attributionVerified: true, status: 'complete', output: report, tokens: 0 };
}

// A committed project with an uncommitted change and a docs-gated run over the given code tasks, driven through the actual runtime
// boundary with the fixture host only.
function fixture(t, ids = ['code']) {
  const parent = path.resolve(__dirname, '../.tmp/missing-baseline-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  git(root, ['init', '--quiet']);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'before\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish missing baseline case']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'after\n');
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({ mechanism: fixtureContinuation(), objective: 'Deliver the accepted change', authority: 'User agreed the scope', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: ids.map(id => ({ id, title: id, agreement: { source: 'User', outcome: 'Change the subject correctly' } })) });
  const base = { baseSha, requirements: 'Change the subject correctly', rules: 'Do not mutate reviewed inputs.' };
  // Every dispatch runs the fixture host; one without it would launch a real model, so it fails instead.
  const act = (request, overrides = { runAgent: () => assert.fail('Unexpected dispatch without the fixture host') }) => executeWithFixtureController(root, { actor, revision: store.read().revision, taskId: ids[0], ...request }, overrides);
  const receipt = result => path.relative(root, result.receiptFile).split(path.sep).join('/');
  const dispatch = (taskId, review, agent = {}) => act({ action: 'dispatch', taskId, review: { ...base, ...review } }, { runAgent: options => fakeAgent(options, agent) });
  const imported = async (taskId, review, agent) => {
    const result = await dispatch(taskId, review, agent);
    await act({ action: 'review', taskId, receipt: receipt(result) });
    return result;
  };
  const task = id => store.read().tasks.find(item => item.id === id);
  const brief = () => obligationBrief(store.read());
  const edit = content => fs.writeFileSync(path.join(root, 'subject.txt'), content);
  const loseBaseline = () => store.update(actor, store.read().revision, 'fixture-lost-baseline', state => { state.closing.docs.baseline = null; });

  return { root, store, act, dispatch, imported, receipt, task, brief, edit, loseBaseline };
}

async function startWithLead(f, id) {
  await f.act({ action: 'start-task', taskId: id });
  await f.act({ action: 'check', taskId: id, check: { name: 'Fixture check', executable: process.execPath, args: ['--version'], paths: ['subject.txt'] } });
  const lead = await f.imported(id, { kind: 'code', candidates: [LEAD] });
  await f.act({ action: 'advance', taskId: id });

  return lead;
}

async function complete(f, id) {
  const lead = await startWithLead(f, id);
  await f.imported(id, { kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs });
  await f.act({ action: 'advance', taskId: id });
  await f.act({ action: 'advance', taskId: id, evidence: 'Documented' });
  assert.equal(f.task(id).status, 'complete');

  return lead;
}

async function triagedWithLostBaseline(t) {
  const f = fixture(t);
  await complete(f, 'code');
  await f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  await f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.loseBaseline();

  return f;
}

const refusalOf = promise => promise.then(() => assert.fail('Expected a refusal'), error => error);

test('triage recorded again over a missing baseline keeps it missing while no fresh whole-inventory task assessment covers the changes', async t => {
  // Arrange
  const f = await triagedWithLostBaseline(t);
  f.edit('edited while the baseline was missing\n');

  // Act
  await f.act({ action: 'triage', evidence: 'Triage recorded again' });
  const refused = await refusalOf(f.act({ action: 'complete' }));

  // Assert
  assert.equal(f.store.read().closing.docs.baseline, null);
  assert.equal(f.brief().closing.docsReview.outsideDocumentation?.changedPaths, null);
  assert.equal(refused.code, 'closing-review-required');
});

test('triage recorded again over a missing baseline takes the inventory once a fresh whole-inventory task assessment covers the changes', async t => {
  // Arrange
  const f = await triagedWithLostBaseline(t);
  f.edit('edited while the baseline was missing\n');
  await f.imported('code', { kind: 'code', candidates: [LEAD] });
  assert.equal(f.task('code').status, 'complete');

  // Act
  await f.act({ action: 'triage', evidence: 'Triage recorded again' });

  // Assert
  assert.ok(f.store.read().closing.docs.baseline);
  assert.equal(f.brief().closing.docsReview.outsideDocumentation, undefined);
});

test('a closing reset over a missing baseline keeps the outside-documentation condition unsettled with no computable set', async t => {
  // Arrange
  const f = await triagedWithLostBaseline(t);
  // A changed input makes the reopening import clear the closing evidence.
  f.edit('edited while the baseline was missing\n');

  // Act
  await f.imported('code', { kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs, findings: [{ id: 'claim', severity: 'important', required: true, consequence: 'The documentation misstates the change', evidence: 'Concrete passage', surfaces: [], basis: [] }] });

  // Assert
  assert.equal(f.store.read().closing.docs, undefined);
  assert.equal(f.task('code').status, 'active');
  const closing = f.brief().closing;
  assert.ok(closing.outsideDocumentation, 'the condition is still evaluated after the reset');
  assert.equal(closing.outsideDocumentation.changedPaths, null);
});

test('a stale change covering two tasks names in its applicability call only the task without a current reassess answer', async t => {
  // Arrange
  const f = fixture(t, ['done', 'open']);
  await complete(f, 'done');
  const lead = await startWithLead(f, 'open');
  assert.deepEqual([...f.task('open').reviews.find(review => review.requestId === lead.receipt.requestId).coveredTaskIds].sort(), ['done', 'open']);
  f.edit('edited after the covering assessment\n');
  await f.imported('open', { kind: 'code', resume: lead.receipt.requestId, relevance: { requestId: lead.receipt.requestId, taskIds: ['done'] } }, { applicability: [{ id: 'done', outcome: 'reassess', evidence: 'The edit needs a new assessment' }] });
  const docs = await f.imported('open', { kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs, findings: [{ id: 'claim', severity: 'important', required: true, consequence: 'The documentation misstates the change', evidence: 'Concrete passage', surfaces: [], basis: [] }] });
  const claim = f.task('open').findings.find(finding => finding.raisedBy.requestId === docs.receipt.requestId);
  const skeptic = await f.dispatch('open', { kind: 'skeptic', candidates: [LEAD], findings: [claim] }, { findings: [{ id: claim.id, verdict: 'confirmed', evidence: 'Reproduced', value: 'Worth deciding', repairProposal: 'Restate the claim' }] });
  await f.act({ action: 'validate', taskId: 'open', receipt: f.receipt(skeptic), findingId: claim.id });
  await f.act({ action: 'dispose', taskId: 'open', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Claim accuracy' } });

  // Act
  await f.act({ action: 'repair', taskId: 'open', findingIds: [claim.id] });

  // Assert
  const target = f.brief().next.find(item => item.id === 'open').review.freshTargets.find(item => item.kind === 'code');
  const change = target.staleChanges.find(item => item.requestId === lead.receipt.requestId);
  assert.deepEqual([...target.covers].sort(), ['done', 'open']);
  assert.deepEqual(change.applicabilityCall?.taskIds, ['open']);
});
