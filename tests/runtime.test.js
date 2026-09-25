'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { snapshot, fresh, verifyCommand } = require('../internal/runtime/evidence');
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
  apply(f, { action: 'validate', findingId: 'repair', validation: { session: 'skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Traced input through the wrong branch' } });
  assert.throws(() => apply(f, { action: 'dispose', findingId: 'repair', disposition: 'skip', reason: 'Too expensive', obligation: { classification: 'required', basis: 'Accepted required outcome' } }), { code: 'required-obligation' });
  apply(f, { action: 'dispose', findingId: 'repair', disposition: 'implement', reason: 'Required outcome', obligation: { classification: 'required', basis: 'Accepted required outcome' } });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'fixed\r\n');
  apply(f, { action: 'repair', findingIds: ['repair'] });
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

test('the accepted runtime actions are exactly the lifecycle transitions and the CLI-only operations', () => {
  const { RUNTIME_ACTIONS, isRuntimeAction } = require('../internal/runtime/actions');
  const source = fs.readFileSync(path.resolve(__dirname, '../internal/runtime/lifecycle.js'), 'utf8');
  const handled = [...source.matchAll(/^ {4}case '([a-z-]+)':/gm)].map(match => match[1]);
  assert.ok(handled.length > 20);
  assert.deepEqual(handled.filter(action => !isRuntimeAction(action)), []);
  const cliOnly = ['adopt', 'create', 'dispatch', 'history', 'inspect', 'probe', 'status', 'wait'];
  assert.deepEqual([...RUNTIME_ACTIONS].filter(action => !handled.includes(action)).sort(), cliOnly);
});
