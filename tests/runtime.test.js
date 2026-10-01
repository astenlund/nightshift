'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { RunStore } = require('../internal/runtime/store');
const { hash, snapshot, fresh, verifyCommand } = require('../internal/runtime/evidence');
const { DIMENSIONS, commitmentsFor, obligationBrief, reviewGate, transition } = require('../internal/runtime/lifecycle');
const { execute } = require('../internal/runtime/cli');

const scratch = path.resolve(__dirname, '../.tmp/runtime-tests');
fs.mkdirSync(scratch, { recursive: true });
const actor = { host: 'codex', session: 'controller' };

function fixture(t, tasks, extra = {}) {
  const root = fs.mkdtempSync(path.join(scratch, 'case-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'subject.txt'), 'original\r\n');
  fs.writeFileSync(path.join(root, 'sibling.txt'), 'related\r\n');
  const input = { controller: actor, authority: 'User confirmed this fixture outcome', objective: 'Deliver verified behavior', tasks: tasks ?? [{ id: 'subject', title: 'Subject change', agreement: { source: 'user message', outcome: 'Both paths behave correctly' } }], ...extra };
  const state = store.create(input);
  return { root, store, state, input };
}

function apply(fixture, request) {
  const findings = fixture.store.read().tasks.find(task => task.id === (request.taskId ?? 'subject'))?.findings ?? [];
  const resolveId = id => findings.findLast(finding => finding.id === id || finding.localId === id)?.id ?? id;
  if (request.findingId) request.findingId = resolveId(request.findingId);
  if (request.findingIds) request.findingIds = request.findingIds.map(resolveId);
  if (request.action === 'validate') request.validation.snapshot = snapshot(fixture.root, ['subject.txt', 'sibling.txt']);
  if (request.action === 'review') {
    const evidence = verifyCommand(fixture.root, { name: 'fixture validation', executable: process.execPath, args: ['--version'], paths: ['subject.txt', 'sibling.txt'] });
    fixture.store.update(actor, fixture.store.read().revision, 'check', state => transition(state, { taskId: 'subject', action: 'check', evidence }));
  }
  return fixture.store.update(actor, fixture.store.read().revision, request.action, state => transition(state, { taskId: 'subject', ...request }));
}

function review(fixture, findings = [], overrides = {}) {
  return { status: 'complete', commitments: commitmentsFor(fixture.store.read().tasks), strength: 'strong', session: 'independent-reviewer', independent: true, broad: true, attributionVerified: true, dimensions: [...DIMENSIONS.code], coverageEvidence: 'Read complete diff and both surrounding paths; checked sibling integration and error handling', snapshot: snapshot(fixture.root, ['subject.txt', 'sibling.txt']), findings, ...overrides };
}

const DOCS_LENS = { kind: 'docs', dimensions: [...DIMENSIONS.docs], session: 'independent-docs-reviewer' };

test('state and history commit together, rollback preserves the previous revision', t => {
  const f = fixture(t);
  assert.throws(() => f.store.update(actor, 0, 'failure', state => { state.objective = 'corrupted'; throw new Error('simulated interruption'); }), /simulated interruption/);
  assert.equal(f.store.read().objective, 'Deliver verified behavior');
  assert.equal(f.store.history(f.state.id).length, 1);
  apply(f, { action: 'start-task' });
  assert.equal(f.store.read().revision, 1);
  assert.equal(f.store.history(f.state.id).at(-1).state.tasks[0].status, 'active');
});

test('a failed rerun supersedes its earlier pass and a successful retry restores the gate', t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, '.tmp'));
  fs.writeFileSync(path.join(f.root, '.tmp/check.cjs'), "process.exitCode = Number(require('node:fs').readFileSync('.tmp/status.txt', 'utf8'));\n");
  const check = () => apply(f, { action: 'check', evidence: verifyCommand(f.root, { name: 'Required behavior', executable: process.execPath, args: ['.tmp/check.cjs'], paths: ['subject.txt', 'sibling.txt'] }) });
  fs.writeFileSync(path.join(f.root, '.tmp/status.txt'), '0');
  check();
  apply(f, { action: 'review', review: review(f) });
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), true);
  fs.writeFileSync(path.join(f.root, '.tmp/status.txt'), '1');
  check();
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), false);
  assert.throws(() => apply(f, { action: 'advance' }), { code: 'review-required' });
  fs.writeFileSync(path.join(f.root, '.tmp/status.txt'), '0');
  check();
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), true);
});

test('dangling links are rejected as linked entries rather than accepted as absent inputs', t => {
  const f = fixture(t);
  fs.symlinkSync(path.join(f.root, 'absent.txt'), path.join(f.root, 'dangling.txt'), 'file');
  assert.equal(fs.existsSync(path.join(f.root, 'dangling.txt')), false);
  assert.throws(() => snapshot(f.root, ['dangling.txt']), { code: 'unsafe-path' });
});

test('overlapping runs, foreign owners and stale writes cannot replace progress', t => {
  const f = fixture(t);
  assert.throws(() => f.store.create(f.input), { code: 'overlapping-run' });
  assert.throws(() => f.store.update({ ...actor, session: 'stranger' }, 0, 'takeover', () => {}), { code: 'wrong-owner' });
  apply(f, { action: 'start-task' });
  assert.throws(() => f.store.update(actor, 0, 'stale', () => {}), { code: 'stale-state' });
});

test('persisted commitments, findings and ownership survive closing and reopening', t => {
  const f = fixture(t);
  apply(f, { action: 'review', review: review(f, [{ id: 'missing-sibling', consequence: 'Sibling path fails', evidence: 'sibling.txt retains original path', required: true }]) });
  const reopened = new RunStore(f.root);
  try {
    const restored = reopened.read();
    assert.deepEqual(restored.controller, actor);
    assert.equal(restored.tasks[0].agreement.outcome, 'Both paths behave correctly');
    assert.equal(restored.tasks[0].findings[0].localId, 'missing-sibling');
    assert.equal(obligationBrief(restored).next[0].unresolvedFindings.length, 1);
    assert.equal(reviewGate(f.root, restored.tasks[0]), false);
  } finally { reopened.close(); }
});

test('dependencies and unresolved substantial spec review prevent dependent implementation', t => {
  const f = fixture(t, [
    { id: 'subject', title: 'Subject', agreement: { source: 'user', outcome: 'A', spec: 'spec.md', specReviewed: false } },
    { id: 'dependent', title: 'Dependent', agreement: { source: 'user', outcome: 'B' }, requires: ['subject'] },
  ]);
  assert.throws(() => apply(f, { action: 'start-task' }), { code: 'spec-review-required' });
  assert.throws(() => apply(f, { action: 'start-task', taskId: 'dependent' }), { code: 'dependency-blocked' });
});

test('missing, narrow, weak and failed reviews do not pass, even without findings', t => {
  const f = fixture(t);
  const task = f.store.read().tasks[0];
  task.checks.push(verifyCommand(f.root, { name: 'fixture validation', executable: process.execPath, args: ['--version'], paths: ['subject.txt', 'sibling.txt'] }));
  assert.equal(reviewGate(f.root, task), false);
  for (const override of [{ strength: 'weak' }, { broad: false }, { status: 'failed' }, { dimensions: ['correctness-integration'] }, { coverageEvidence: '' }]) {
    task.reviews = [review(f, [], override)];
    assert.equal(reviewGate(f.root, task), false);
  }
  task.reviews = [review(f)];
  assert.equal(reviewGate(f.root, task), true);
});

test('a small repair invalidates review until the complete cumulative input is assessed again', t => {
  const f = fixture(t);
  apply(f, { action: 'review', review: review(f, [{ id: 'repair', consequence: 'Wrong result', evidence: 'subject returns original', required: true }]) });
  assert.throws(() => apply(f, { action: 'dispose', findingId: 'repair', disposition: 'implement', reason: 'Correct required behavior' }), { code: 'unvalidated-finding' });
  assert.throws(() => apply(f, { action: 'validate', findingId: 'repair', validation: { session: 'independent-reviewer', attributionVerified: true, verdict: 'confirmed', evidence: 'reproduced' } }), { code: 'skeptic-required' });
  apply(f, { action: 'validate', findingId: 'repair', validation: { session: 'skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Traced input through the wrong branch', repairProposal: 'Take the correct branch for this input' } });
  assert.throws(() => apply(f, { action: 'dispose', findingId: 'repair', disposition: 'skip', reason: 'Too expensive', obligation: { classification: 'required', basis: 'Accepted required outcome' } }), { code: 'required-obligation' });
  apply(f, { action: 'dispose', findingId: 'repair', disposition: 'implement', reason: 'Required outcome', obligation: { classification: 'required', basis: 'Accepted required outcome' } });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'fixed\r\n');
  apply(f, { action: 'repair', findingIds: ['repair'] });
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), false);
  // The raising reviewer's closure ends the pending obligation, but its continued assessment passes no gate on its own.
  const repaired = f.store.read().tasks[0].findings.find(finding => finding.localId === 'repair');
  apply(f, { action: 'review', review: review(f, [], { continues: { kind: 'resumed', requestId: 'earlier', session: 'independent-reviewer' }, closures: [{ id: repaired.id, closed: true, evidence: 'Input now takes the correct branch' }] }) });
  assert.equal(f.store.read().tasks[0].findings.find(finding => finding.id === repaired.id).pendingClosure, undefined);
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), false);
  apply(f, { action: 'review', review: review(f) });
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), true);
  fs.writeFileSync(path.join(f.root, 'sibling.txt'), 'new regression\r\n');
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), false);
});

test('a no-edit refutation can resolve a finding without a ceremonial clean pass', t => {
  const f = fixture(t);
  apply(f, { action: 'review', review: review(f, [{ id: 'claim', consequence: 'Alleged failure', evidence: 'Claimed branch path' }]) });
  apply(f, { action: 'validate', findingId: 'claim', validation: { session: 'skeptic', attributionVerified: true, verdict: 'refuted', evidence: 'Concrete values demonstrate branch is unreachable' } });
  apply(f, { action: 'dispose', findingId: 'claim', disposition: 'refuted', reason: 'Concrete counterexample' });
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), true);
});

test('documentation, retrospective and triage occur in order; unanswered follow-ups survive completion', t => {
  const f = fixture(t);
  apply(f, { action: 'review', review: review(f) });
  apply(f, { action: 'advance' });
  assert.equal(f.store.read().tasks[0].stage, 'documentation');
  assert.throws(() => apply(f, { action: 'advance' }), { code: 'invalid-request' });
  assert.throws(() => apply(f, { action: 'advance', evidence: 'Documentation matches the resulting behavior' }), { code: 'docs-review-required' });
  apply(f, { action: 'review', review: review(f, [], DOCS_LENS) });
  assert.equal(f.store.read().tasks[0].stage, 'review');
  apply(f, { action: 'advance' });
  assert.equal(f.store.read().tasks[0].stage, 'documentation');
  apply(f, { action: 'advance', evidence: 'Documentation matches the resulting behavior' });
  assert.equal(f.store.read().tasks[0].status, 'complete');
  assert.equal(obligationBrief(f.store.read()).closing.stage, 'retrospective');
  assert.throws(() => apply(f, { action: 'triage', evidence: 'Too early' }), { code: 'retrospective-required' });
  apply(f, { action: 'followup', item: { id: 'lesson', context: 'Potential instruction improvement, awaiting approval', recommendation: 'Track after user returns', options: ['fix', 'track', 'skip'] } });
  apply(f, { action: 'retrospective', evidence: 'Retrospective captured worthwhile proposal for user approval' });
  apply(f, { action: 'triage', evidence: 'User AFK; pending decision preserved' });
  apply(f, { action: 'complete' });
  assert.equal(f.store.read().status, 'complete');
  assert.equal(obligationBrief(f.store.read()).followups.length, 1);
});

for (const kind of ['docs', 'lore']) {
  test(`standalone ${kind} retains its work and one session closing sequence`, t => {
    const f = fixture(t, [{ id: 'subject', title: 'Standalone work', kind, agreement: { source: 'User', outcome: 'Complete this standalone operation' } }]);
    if (kind === 'docs') {
      // A docs task has no direct completion path: its complete change needs an independent docs review first.
      assert.throws(() => apply(f, { action: 'advance', evidence: 'Requested standalone work completed without an instruction change' }), { code: 'docs-review-required' });
      apply(f, { action: 'review', review: review(f, [], DOCS_LENS) });
      apply(f, { action: 'advance' });
    }
    apply(f, { action: 'advance', evidence: 'Requested standalone work completed without an instruction change' });
    assert.equal(f.store.read().tasks[0].status, 'complete');
    if (kind === 'docs') apply(f, { action: 'retrospective', evidence: 'No worthwhile instruction proposal' });
    assert.ok(f.store.read().closing.retrospectiveEvidence);
    apply(f, { action: 'triage', evidence: 'No pending user decision' });
    apply(f, { action: 'complete' });
    assert.equal(f.store.read().status, 'complete');
  });
}

test('failed checks and changed inputs cannot count as verification', t => {
  const f = fixture(t);
  const check = verifyCommand(f.root, { name: 'node available', executable: process.execPath, args: ['--version'], paths: ['subject.txt'] });
  assert.equal(check.passed, true);
  assert.equal(fresh(f.root, check.snapshot), true);
  const failed = verifyCommand(f.root, { name: 'missing script', executable: process.execPath, args: ['missing-script.cjs'], paths: ['subject.txt'] });
  assert.equal(failed.passed, false);
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'changed\r\n');
  assert.equal(fresh(f.root, check.snapshot), false);
  assert.throws(() => apply(f, { action: 'check', evidence: check }), { code: 'stale-evidence' });
});

function gitFixture(t) {
  const root = fs.mkdtempSync(path.join(scratch, 'git-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const init = spawnSync('git', ['init', '-q'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt text eol=lf\n');
  fs.writeFileSync(path.join(root, 'subject.txt'), 'original\r\nsecond\r\n');
  return root;
}

test('a line-ending renormalization that leaves Git content unchanged keeps evidence fresh', t => {
  const root = gitFixture(t);
  const evidence = snapshot(root, ['subject.txt']);
  assert.match(evidence.files[0].blob, /^[0-9a-f]{40,64}$/);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'original\nsecond\n');
  assert.equal(fresh(root, evidence), true);
  const withoutBlob = evidence.files.map(({ blob, ...file }) => file);
  assert.equal(fresh(root, { digest: hash(JSON.stringify(withoutBlob)), files: withoutBlob }), false, 'evidence recorded without blob ids keeps the byte comparison');
  const forged = evidence.files.map(file => ({ ...file, blob: '0'.repeat(40) }));
  assert.equal(fresh(root, { ...evidence, files: forged }), false, 'blob ids outside the recorded digest are not trusted');
  fs.writeFileSync(path.join(root, 'subject.txt'), 'changed\nsecond\n');
  assert.equal(fresh(root, evidence), false);
});

test('a blob Git reports for anything but a line-ending normalization of the bytes read is not recorded', t => {
  const root = gitFixture(t);
  fs.writeFileSync(path.join(root, 'mark.cjs'), "'use strict';\nconst chunks = [];\nprocess.stdin.on('data', chunk => chunks.push(chunk)).on('end', () => process.stdout.write(Buffer.concat([...chunks, Buffer.from('marked\\n')])));\n");
  const filter = spawnSync('git', ['config', 'filter.mark.clean', `"${process.execPath.split(path.sep).join('/')}" mark.cjs`], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(filter.status, 0, filter.stderr);
  fs.writeFileSync(path.join(root, '.gitattributes'), '*.txt text eol=lf filter=mark\n');
  const evidence = snapshot(root, ['subject.txt']);
  assert.equal(evidence.files[0].blob, undefined);
  assert.equal(fresh(root, evidence), true);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'original\nsecond\n');
  assert.equal(fresh(root, evidence), false);
});

test('a line-ending rewrite between the raw read and Git hashing binds no second content', t => {
  const evidencePath = JSON.stringify(path.resolve(__dirname, '../internal/runtime/evidence.js'));
  const race = [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const cp = require('node:child_process');",
    'const spawnSync = cp.spawnSync;',
    "const subject = path.join(__dirname, 'subject.txt');",
    'let rewrite = true;',
    "cp.spawnSync = (executable, args, options) => {",
    "  if (rewrite && executable === 'git' && args[0] === 'hash-object') { rewrite = false; fs.writeFileSync(subject, 'original\\nsecond\\n'); }",
    '  return spawnSync(executable, args, options);',
    '};',
    `const { snapshot, fresh } = require(${evidencePath});`,
    "const evidence = snapshot(__dirname, ['subject.txt']);",
    'const freshRewritten = fresh(__dirname, evidence);',
    "fs.writeFileSync(subject, 'original\\r\\nsecond\\r\\n');",
    "process.stdout.write(JSON.stringify({ blob: evidence.files[0].blob ?? null, freshRewritten, freshOriginal: fresh(__dirname, evidence) }));",
  ].join('\n') + '\n';
  for (const attributes of ['*.txt -text\n', '']) {
    const root = gitFixture(t);
    spawnSync('git', ['config', 'core.autocrlf', 'false'], { cwd: root, windowsHide: true });
    fs.writeFileSync(path.join(root, '.gitattributes'), attributes);
    fs.writeFileSync(path.join(root, 'race.cjs'), race);
    const result = spawnSync(process.execPath, ['race.cjs'], { cwd: root, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { blob: null, freshRewritten: false, freshOriginal: true }, `attributes ${JSON.stringify(attributes)}`);
  }
});

test('a check still compares raw bytes, and evidence outside a Git worktree records none', t => {
  const root = gitFixture(t);
  const renormalize = path.join(root, 'renormalize.cjs');
  fs.writeFileSync(renormalize, "require('node:fs').writeFileSync(require('node:path').join(__dirname, 'subject.txt'), 'original\\nsecond\\n');\n");
  const check = verifyCommand(root, { name: 'renormalizing check', executable: process.execPath, args: [renormalize], paths: ['subject.txt'] });
  assert.equal(check.inputsUnchanged, false);
  assert.equal(check.passed, false);
  const outside = fs.mkdtempSync(path.join(scratch, 'plain-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'subject.txt'), 'original\r\n');
  const previous = process.env.GIT_CEILING_DIRECTORIES;
  process.env.GIT_CEILING_DIRECTORIES = scratch;
  t.after(() => { if (previous === undefined) delete process.env.GIT_CEILING_DIRECTORIES; else process.env.GIT_CEILING_DIRECTORIES = previous; });
  const evidence = snapshot(outside, ['subject.txt']);
  assert.equal(evidence.files[0].blob, undefined);
  fs.writeFileSync(path.join(outside, 'subject.txt'), 'original\n');
  assert.equal(fresh(outside, evidence), false);
});

test('independent tasks remain actionable when another item needs the user', t => {
  const agreement = { source: 'user', outcome: 'Agreed work' };
  const f = fixture(t, [{ id: 'subject', title: 'Subject', agreement }, { id: 'independent', title: 'Independent', agreement }]);
  apply(f, { action: 'block', blocker: { kind: 'user-decision', reason: 'Material scope choice', recoveryAttempted: 'Checked prior agreement; decision is not covered' } });
  assert.deepEqual(obligationBrief(f.store.read()).next.map(task => task.id), ['independent']);
  assert.throws(() => apply(f, { action: 'complete' }), { code: 'unfinished-work' });
});

test('database and evidence reject linked input paths', t => {
  const f = fixture(t);
  fs.linkSync(path.join(f.root, 'subject.txt'), path.join(f.root, 'linked.txt'));
  assert.throws(() => snapshot(f.root, ['linked.txt']), { code: 'unsafe-path' });
  assert.throws(() => snapshot(f.root, ['../outside.txt']), { code: 'unsafe-path' });
});

const registerWorker = (f, id) => apply(f, { action: 'worker', worker: { id, session: id + '-session', assignment: 'Assess the change', role: 'reviewer', writes: [] } });
const setWorker = (f, id, change) => f.store.update(actor, f.store.read().revision, 'fixture-worker', state => Object.assign(state.workers.find(worker => worker.id === id), change));
const wait = (f, request, dependencies) => execute(f.root, { action: 'wait', ...request }, dependencies);

test('wait observes a saved worker without recording progress', async t => {
  const f = fixture(t);
  registerWorker(f, 'lead');
  const revision = f.store.read().revision;
  const timedOut = await wait(f, { workerId: 'lead', timeoutMs: 50 });
  assert.deepEqual({ ...timedOut, elapsedMs: null }, { runId: f.state.id, revision, runStatus: 'running', workerId: 'lead', workerStatus: 'running', active: true, runnerAlive: null, receipt: null, evidence: null, elapsedMs: null, reason: 'timeout' });
  assert.ok(timedOut.elapsedMs >= 50);
  assert.equal(f.store.read().revision, revision);
  const pending = wait(f, { workerId: 'lead', runId: f.state.id, timeoutMs: 5000 });
  setTimeout(() => apply(f, { action: 'worker-finished', workerId: 'lead', status: 'complete', evidence: 'Reviewer process exited 0' }), 100);
  const finished = await pending;
  assert.equal(finished.reason, 'worker-result');
  assert.equal(finished.workerStatus, 'complete');
  assert.equal(finished.active, false);
  assert.equal(finished.evidence, 'Reviewer process exited 0');
  assert.equal(finished.revision, revision + 1);
  await assert.rejects(wait(f, { workerId: 'nobody' }), { code: 'unknown-worker' });
  await assert.rejects(wait(f, {}), { code: 'invalid-request' });
  await assert.rejects(wait(f, { workerId: 'lead', timeoutMs: -1 }), { code: 'invalid-request' });
});

test('wait reports uncertain runners, unverified results and stopped runs for reconciliation', async t => {
  const f = fixture(t);
  registerWorker(f, 'runner');
  setWorker(f, 'runner', { runnerPid: 4242 });
  const alive = await wait(f, { workerId: 'runner', timeoutMs: 20 }, { processExists: () => true });
  assert.equal(alive.reason, 'timeout');
  assert.equal(alive.runnerAlive, true);
  const missing = await wait(f, { workerId: 'runner', timeoutMs: 5000 }, { processExists: () => false });
  assert.equal(missing.reason, 'runner-missing');
  assert.equal(missing.active, true);
  assert.equal(missing.runnerAlive, false);
  assert.equal(missing.workerStatus, 'running');
  const raced = await wait(f, { workerId: 'runner', timeoutMs: 5000 }, { processExists: () => { apply(f, { action: 'worker-finished', workerId: 'runner', status: 'complete', evidence: 'Completion committed during the probe' }); return false; } });
  assert.equal(raced.reason, 'worker-result');
  assert.equal(raced.workerStatus, 'complete');
  assert.equal(raced.runnerAlive, false);
  registerWorker(f, 'second');
  setWorker(f, 'second', { status: 'unverified', receipt: path.join(f.root, '.nightshift/runs/reviews/second/receipt.json') });
  const unverified = await wait(f, { workerId: 'second', timeoutMs: 5000 });
  assert.equal(unverified.reason, 'worker-result');
  assert.equal(unverified.active, true);
  assert.equal(unverified.receipt, '.nightshift/runs/reviews/second/receipt.json');
  registerWorker(f, 'third');
  apply(f, { action: 'stop', kind: 'user-stop', reason: 'Fixture stop' });
  const stopped = await wait(f, { workerId: 'third', timeoutMs: 5000 });
  assert.equal(stopped.reason, 'run-stopped');
  assert.equal(stopped.runStatus, 'stopped');
  assert.equal(stopped.active, true);
});

test('wait ends at the run deadline instead of the requested timeout', async t => {
  const f = fixture(t);
  registerWorker(f, 'lead');
  // Setting the deadline after registration keeps fixture setup time from consuming it.
  f.store.update(actor, f.store.read().revision, 'fixture-limits', state => { state.limits = { deadlineUtc: new Date(Date.now() + 400).toISOString() }; });
  const reached = await wait(f, { workerId: 'lead', timeoutMs: 5000 });
  assert.equal(reached.reason, 'deadline');
  assert.ok(reached.elapsedMs < 5000);
  const expired = await wait(f, { workerId: 'lead', timeoutMs: 5000 });
  assert.equal(expired.reason, 'deadline');
  assert.ok(expired.elapsedMs < 1000);
});

test('a missing or unknown request action is refused before any store or ownership check', async t => {
  const empty = fs.mkdtempSync(path.join(scratch, 'case-'));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const refusal = { code: 'invalid-request', message: /request key action .*accepted actions: status, inspect, history, wait, create/ };
  await assert.rejects(execute(empty, { operation: 'status' }), { ...refusal, message: /action is missing/ });
  await assert.rejects(execute(empty, { action: 'statuss' }), { ...refusal, message: /"statuss" is not a runtime action/ });
  assert.equal(fs.existsSync(path.join(empty, '.nightshift')), false);
  const f = fixture(t);
  const revision = f.store.read().revision;
  await assert.rejects(execute(f.root, { action: 'advnce', actor: { host: 'codex', session: 'intruder' }, revision: revision - 1 }), refusal);
  assert.equal(f.store.read().revision, revision);
  assert.throws(() => transition(f.store.read(), { action: 'advnce' }), refusal);
});

// A Git worktree whose governing spec has CRLF endings that Git normalizes, so acceptance evidence records a blob identity.
function specFixture(t, tasks) {
  const root = fs.mkdtempSync(path.join(scratch, 'spec-'));
  const init = spawnSync('git', ['init', '-q'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  fs.writeFileSync(path.join(root, '.gitattributes'), '*.md text eol=lf\n');
  fs.writeFileSync(path.join(root, 'spec.md'), '# Commitments\r\nKeep both paths correct\r\n');
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({ controller: actor, authority: 'User agreed the scope', objective: 'Deliver the governed work', tasks });
  const act = request => store.update(actor, store.read().revision, request.action, state => transition(state, request));
  return { root, store, act };
}

test('spec acceptance is bound to the spec content, idempotent while it holds and replaced after an amendment', t => {
  const f = specFixture(t, [{ id: 'code', title: 'Substantial work', agreement: { source: 'User', outcome: 'Accepted behavior', spec: 'spec.md' } }]);
  const status = () => obligationBrief(f.store.read()).next[0].specAcceptance;
  assert.deepEqual(status(), { recorded: false, current: null });
  const accepted = f.act({ action: 'spec-accepted', taskId: 'code', authority: 'User replied: spec accepted' });
  assert.equal(accepted.tasks[0].specAcceptance.authority, 'User replied: spec accepted');
  assert.equal(accepted.tasks[0].specAcceptance.revision, accepted.revision);
  assert.match(accepted.tasks[0].specAcceptance.snapshot.files[0].blob, /^[0-9a-f]{40,64}$/);
  assert.deepEqual(status(), { recorded: true, current: true });
  const again = f.act({ action: 'spec-accepted', taskId: 'code', authority: 'A later reply' });
  assert.deepEqual(again.tasks[0].specAcceptance, accepted.tasks[0].specAcceptance);
  fs.writeFileSync(path.join(f.root, 'spec.md'), '# Commitments\nKeep both paths correct\n');
  assert.deepEqual(status(), { recorded: true, current: true }, 'a line-ending renormalization keeps the acceptance current');
  fs.writeFileSync(path.join(f.root, 'spec.md'), '# Commitments\nKeep every path correct\n');
  assert.deepEqual(status(), { recorded: true, current: false });
  const amended = f.act({ action: 'spec-accepted', taskId: 'code', authority: 'User replied: amendment accepted' });
  assert.equal(amended.tasks[0].specAcceptance.authority, 'User replied: amendment accepted');
  assert.equal(amended.tasks[0].specAcceptance.revision, amended.revision);
  assert.deepEqual(status(), { recorded: true, current: true });
  fs.rmSync(path.join(f.root, 'spec.md'));
  assert.deepEqual(status(), { recorded: true, current: false });
  assert.throws(() => f.act({ action: 'spec-accepted', taskId: 'code', authority: 'User replied' }), { code: 'missing-spec' });
});

test('recording spec acceptance leaves the bound commitments and an imported assessment current', t => {
  const f = specFixture(t, [{ id: 'code', title: 'Substantial work', agreement: { source: 'User', outcome: 'Accepted behavior', spec: 'spec.md', specReviewed: true } }]);
  f.act({ action: 'start-task', taskId: 'code' });
  f.act({ action: 'check', taskId: 'code', evidence: verifyCommand(f.root, { name: 'fixture validation', executable: process.execPath, args: ['--version'], paths: ['spec.md'] }) });
  const commitments = commitmentsFor(f.store.read().tasks);
  f.act({ action: 'review', taskId: 'code', review: { status: 'complete', commitments, strength: 'strong', session: 'independent-reviewer', independent: true, broad: true, attributionVerified: true, dimensions: [...DIMENSIONS.code], coverageEvidence: 'Read the governing spec and the implementation it governs', snapshot: snapshot(f.root, ['spec.md']), findings: [] } });
  const gate = () => {
    const state = f.store.read();
    return reviewGate(f.root, state.tasks[0], state);
  };
  assert.equal(gate(), true);
  const accepted = f.act({ action: 'spec-accepted', taskId: 'code', authority: 'User replied: spec accepted' });
  assert.deepEqual(commitmentsFor(accepted.tasks), commitments);
  assert.equal(gate(), true);
});

test('spec acceptance needs a governing spec and unfinished work, and is bookkeeping on a blocked task or stopped run', t => {
  const f = specFixture(t, [{ id: 'code', title: 'Substantial work', agreement: { source: 'User', outcome: 'Accepted behavior', spec: 'spec.md' } }, { id: 'notes', title: 'Notes', kind: 'docs', agreement: { source: 'User', outcome: 'Reconciled notes' } }]);
  assert.throws(() => f.act({ action: 'spec-accepted', taskId: 'notes', authority: 'User replied' }), { code: 'missing-spec' });
  assert.throws(() => f.act({ action: 'spec-accepted', taskId: 'code', authority: '  ' }), error => error.code !== undefined);
  assert.throws(() => f.act({ action: 'spec-accepted', taskId: '#closing', authority: 'User replied' }), { code: 'invalid-closing-action' });
  f.act({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Awaiting the user', recoveryAttempted: 'Asked the user' } });
  f.act({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  assert.equal(f.act({ action: 'spec-accepted', taskId: 'code', authority: 'User replied: spec accepted' }).tasks[0].specAcceptance.authority, 'User replied: spec accepted');

  const done = specFixture(t, [{ id: 'notes', title: 'Notes', kind: 'docs', agreement: { source: 'User', outcome: 'Reconciled notes', spec: 'spec.md' } }]);
  done.act({ action: 'advance', taskId: 'notes', evidence: 'Notes match the spec', docsExemption: 'Fixture changes no documentation by judgment' });
  done.act({ action: 'retrospective', evidence: 'Considered' });
  done.act({ action: 'triage', evidence: 'Nothing pending' });
  assert.equal(done.act({ action: 'complete' }).status, 'complete');
  assert.throws(() => done.act({ action: 'spec-accepted', taskId: 'notes', authority: 'User replied' }), { code: 'run-complete' });
});

test('the accepted runtime actions are exactly the lifecycle transitions and the CLI-only operations', () => {
  const { RUNTIME_ACTIONS, isRuntimeAction } = require('../internal/runtime/actions');
  const source = fs.readFileSync(path.resolve(__dirname, '../internal/runtime/lifecycle.js'), 'utf8');
  const handled = [...source.matchAll(/^ {4}case '([a-z-]+)':/gm)].map(match => match[1]);
  assert.ok(handled.length > 20);
  assert.deepEqual(handled.filter(action => !isRuntimeAction(action)), []);
  const cliOnly = ['adopt', 'create', 'dispatch', 'history', 'inspect', 'probe', 'status', 'wait'];
  assert.deepEqual([...RUNTIME_ACTIONS].filter(action => !handled.includes(action)).sort(), cliOnly);
});
