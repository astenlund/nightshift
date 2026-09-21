'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { fixtureControllerClaim, executeWithFixtureController: execute } = require('./fixtures/controller-claim');
const { DIMENSIONS, commitmentsFor, obligationBrief, reviewGate, transition } = require('../internal/runtime/lifecycle');
const { fresh, snapshot, verifyCommand } = require('../internal/runtime/evidence');
const { handleHook } = require('../internal/runtime/hook');
const { remainingTime } = require('../internal/runtime/limits');

const actor = { host: 'codex', session: 'controller' };

test('imported prior spec assessment requires existing artifact bytes and preserves state on rejection', async t => {
  const f = fixture(t);
  f.act({ action: 'stop', kind: 'user-stop', reason: 'User authorized the next fixture run' });
  const previous = f.store.read();
  const request = spec => ({ action: 'create', controller: actor, authority: 'User accepted the governing spec', objective: 'Substantial work', tasks: [{ id: 'code', title: 'Code', agreement: { source: 'User', outcome: 'Accepted behavior', spec, specReviewed: true } }] });
  for (const spec of ['missing.md', 'missing-parent/design.md']) {
    await assert.rejects(execute(f.root, request(spec)), { code: 'missing-spec' });
    assert.deepEqual(f.store.read(), previous);
  }
  for (const spec of ['', null, '   ']) {
    await assert.rejects(execute(f.root, request(spec)), { code: 'invalid-request' });
    assert.deepEqual(f.store.read(), previous);
  }
  const state = await execute(f.root, request('a.txt'));
  await execute(f.root, { action: 'start-task', taskId: 'code', actor, revision: state.revision });
  assert.equal(f.store.read().tasks[0].status, 'active');
  fs.unlinkSync(path.join(f.root, 'a.txt'));
  await assert.rejects(execute(f.root, { action: 'start-task', taskId: 'code', actor, revision: f.store.read().revision }), { code: 'spec-review-required' });
});

test('persisted absent spec approvals cannot pass while deleted-code snapshots remain meaningful', async t => {
  const f = fixture(t);
  const missing = snapshot(f.root, ['missing.md']);
  f.store.update(actor, f.store.read().revision, 'legacy-approval-fixture', state => {
    Object.assign(state.tasks[0].agreement, { spec: 'missing.md', specReviewed: true, specSnapshot: missing });
  });
  await assert.rejects(execute(f.root, { action: 'start-task', taskId: 'a', actor, revision: f.store.read().revision }), { code: 'spec-review-required' });
  assert.equal(fresh(f.root, missing), true);
  for (const spec of ['', null]) {
    f.store.update(actor, f.store.read().revision, 'legacy-empty-spec-fixture', state => { state.tasks[0].agreement.spec = spec; });
    await assert.rejects(execute(f.root, { action: 'start-task', taskId: 'a', actor, revision: f.store.read().revision }), { code: 'spec-review-required' });
  }
});

for (const mutation of ['changed', 'deleted']) {
  test(`later cumulative code review cannot replace an earlier ${mutation} governing-spec assessment`, t => {
    const f = fixture(t, { tasks: [
      { id: 'a', title: 'Substantial A', agreement: { source: 'User', outcome: 'Accepted A', spec: 'spec.md', specReviewed: true } },
      { id: 'b', title: 'Later B', requires: ['a'], agreement: { source: 'User', outcome: 'Accepted B' } },
    ] }, root => fs.writeFileSync(path.join(root, 'spec.md'), '# Accepted governing commitments\r\n'));
    f.check('a');
    f.review('a');
    f.finish('a');
    f.act({ action: 'start-task', taskId: 'b' });
    if (mutation === 'changed') fs.writeFileSync(path.join(f.root, 'spec.md'), 'Changed governing commitments\r\n');
    else fs.unlinkSync(path.join(f.root, 'spec.md'));
    f.check('b');
    f.review('b', ['a', 'b'], [], ['a.txt', 'b.txt', 'spec.md']);
    f.finish('b');
    f.act({ action: 'retrospective', evidence: 'Engineering retrospectively assessed' });
    f.act({ action: 'triage', evidence: 'Follow-ups retained' });
    const state = f.store.read();
    assert.equal(reviewGate(f.root, state.tasks[0], state), true);
    assert.equal(reviewGate(f.root, state.tasks[1], state), true);
    assert.throws(() => f.act({ action: 'complete' }), { code: 'spec-review-required' });
    assert.equal(f.store.read().status, 'running');
  });
}

test('command timeouts remain inside the authorized remaining deadline', t => {
  const now = Date.parse('2026-09-08T00:00:00Z');
  t.mock.method(Date, 'now', () => now);
  const state = { limits: { deadlineUtc: new Date(now + 1000).toISOString() } };
  assert.equal(remainingTime(state, 5000), 1000);
  assert.equal(remainingTime(state, 500), 500);
  state.limits.deadlineUtc = new Date(now - 1).toISOString();
  assert.throws(() => remainingTime(state, 500), { code: 'resource-limit' });
});

test('another spec assessment cannot refresh changed governing commitments', t => {
  const tasks = ['a', 'b'].map(id => ({ id, title: id, kind: 'spec', agreement: { source: 'User', outcome: id, spec: id + '.txt' } }));
  const f = fixture(t, { tasks });
  for (const id of ['a', 'b']) {
    f.act({ action: 'review', taskId: id, review: { kind: 'spec', session: 'reviewer-' + id, attributionVerified: true, status: 'complete', strength: 'strong', independent: true, broad: true, dimensions: DIMENSIONS.spec, coverageEvidence: 'Complete governing artifact assessed', coveredTaskIds: ['a', 'b'], snapshot: snapshot(f.root, [id + '.txt']), findings: [] } });
    f.finish(id);
  }
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'Changed commitments\n');
  assert.equal(reviewGate(f.root, f.store.read().tasks[0], f.store.read()), false);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'stale-review' });
});

test('controller authority is distinct from reviewer obligation assessment', t => {
  const f = fixture(t);
  f.review('a', ['a'], [{ id: 'scope', required: true, consequence: 'Real pre-existing behavior', evidence: 'Concrete case' }]);
  const findingId = f.store.read().tasks[0].findings[0].id;
  f.act({ action: 'validate', taskId: 'a', findingId, validation: { session: 'skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Reproduced existing behavior', snapshot: snapshot(f.root, ['a.txt', 'b.txt']) } });
  const dispose = { action: 'dispose', taskId: 'a', findingId, reason: 'Outside accepted behavior and repair authority' };
  assert.throws(() => f.act({ ...dispose, disposition: 'skip' }), { code: 'missing-authority-assessment' });
  assert.throws(() => f.act({ ...dispose, disposition: 'implement', obligation: { classification: 'out-of-scope', basis: 'Accepted scope excludes this behavior' } }), { code: 'unauthorized-repair' });
  assert.throws(() => f.act({ ...dispose, disposition: 'skip', obligation: { classification: 'required', basis: 'Accepted behavior requires it' } }), { code: 'required-obligation' });
  f.act({ ...dispose, disposition: 'skip', obligation: { classification: 'out-of-scope', basis: 'Accepted scope excludes this behavior' } });
  const finding = f.store.read().tasks[0].findings[0];
  assert.equal(finding.required, true);
  assert.equal(finding.obligation.classification, 'out-of-scope');
  assert.equal(finding.disposition, 'skip');
});

test('missing run state yields the same precise diagnosis with absent and empty actors', async t => {
  const f = fixture(t);
  f.store.db.exec('DELETE FROM active');
  for (const owner of [undefined, {}, { session: '', host: '' }]) await assert.rejects(execute(f.root, { action: 'start-task', taskId: 'a', actor: owner, revision: 0 }), { code: 'missing-state' });
});

function fixture(t, options = {}, prepare) {
  const parent = path.resolve(__dirname, '../.tmp/runtime-regressions');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  for (const file of ['a.txt', 'b.txt']) fs.writeFileSync(path.join(root, file), file + '\r\n');
  prepare?.(root);
  store.create({ objective: 'Deliver both accepted tasks', authority: 'User handover', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: ['a', 'b'].map(id => ({ id, title: id, agreement: { source: 'User', outcome: 'Required ' + id }, requires: id === 'b' ? ['a'] : [] })), ...options });
  const act = request => {
    if (request.action === 'review') request.review.commitments ??= commitmentsFor(store.read().tasks);
    return store.update(actor, store.read().revision, request.action, state => transition(state, request));
  };
  const check = id => act({ action: 'check', taskId: id, evidence: verifyCommand(root, { name: 'Fixture evidence', executable: process.execPath, args: ['--version'], paths: [id + '.txt'] }) });
  const review = (id, coveredTaskIds = [id], findings = [], paths = ['a.txt', 'b.txt']) => act({ action: 'review', taskId: id, review: { requestId: 'request-' + store.read().revision, taskId: id, coveredTaskIds, kind: 'code', session: 'reviewer', attributionVerified: true, strength: 'strong', independent: true, broad: true, status: 'complete', dimensions: [...DIMENSIONS.code], coverageEvidence: 'Assessed both paths and their integration', snapshot: snapshot(root, paths), findings } });
  const finish = id => {
    while (store.read().tasks.find(task => task.id === id).status !== 'complete') act({ action: 'advance', taskId: id, evidence: 'Observed closing obligation satisfied' });
  };
  return { root, store, act, check, review, finish };
}

for (const [kind, assessed] of [['docs', false], ['lore', false], ['docs', true], ['lore', true], ['spec', true]]) {
  test(`standalone ${kind} enforces registered checks independently of assessment=${assessed}`, t => {
    const f = fixture(t, { tasks: [{ id: 'a', title: 'Registered maintenance checks', kind, agreement: { source: 'User', outcome: 'Complete the authorized artifact with its applicable checks' } }] });
    const fail = () => f.act({ action: 'check', taskId: 'a', evidence: verifyCommand(f.root, { name: 'Fixture evidence', executable: process.execPath, args: ['missing-check.cjs'], paths: ['a.txt'] }) });
    const assess = () => f.act({ action: 'review', taskId: 'a', review: { kind: kind === 'spec' ? 'spec' : 'code', session: 'reviewer', attributionVerified: true, status: 'complete', strength: 'strong', independent: true, broad: true, dimensions: DIMENSIONS[kind === 'spec' ? 'spec' : 'code'], coverageEvidence: 'Whole maintenance artifact assessed', snapshot: snapshot(f.root, ['a.txt', 'b.txt']), findings: [] } });
    f.check('a');
    fail();
    if (assessed) assess();
    assert.throws(() => f.finish('a'), { code: assessed ? 'review-required' : 'verification-required' });
    assert.equal(f.store.read().tasks[0].status === 'complete', false);
    f.check('a');
    fs.writeFileSync(path.join(f.root, 'a.txt'), 'Changed after passing verification\r\n');
    if (assessed) assess();
    assert.throws(() => f.finish('a'), { code: assessed ? 'review-required' : 'verification-required' });
    f.check('a');
    f.finish('a');
    if (kind !== 'lore') f.act({ action: 'retrospective', evidence: 'Considered applicable checks and maintenance outcome' });
    f.act({ action: 'triage', evidence: 'No implied instruction approval' });
    fail();
    assert.throws(() => f.act({ action: 'complete' }), { code: assessed ? 'stale-review' : 'verification-required' });
    f.check('a');
    f.act({ action: 'complete' });
    assert.equal(f.store.read().status, 'complete');
  });
}

for (const kind of ['docs', 'lore']) {
  test(`standalone ${kind} repairs return to their own closing work and retain cumulative assurance`, t => {
    const f = fixture(t, { tasks: [{ id: 'a', title: 'Standalone maintenance', kind, agreement: { source: 'User', outcome: 'Prepare the reviewed artifact without applying instructions' } }] });
    f.review('a', ['a'], [{ id: 'draft', consequence: 'The proposed artifact omits an agreed boundary', evidence: 'Concrete missing boundary in the draft' }]);
    const findingId = f.store.read().tasks[0].findings[0].id;
    f.act({ action: 'validate', taskId: 'a', findingId, validation: { session: 'skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Independent boundary reproduction', snapshot: snapshot(f.root, ['a.txt', 'b.txt']) } });
    f.act({ action: 'dispose', taskId: 'a', findingId, disposition: 'implement', reason: 'Repair the authorized draft', obligation: { classification: 'required', basis: 'The accepted draft must cover this boundary' } });
    fs.writeFileSync(path.join(f.root, 'a.txt'), 'Draft boundary repaired\r\n');
    f.act({ action: 'repair', taskId: 'a', findingIds: [findingId] });
    f.check('a');
    assert.throws(() => f.act({ action: 'advance', taskId: 'a' }), { code: 'review-required' });
    f.review('a');
    f.act({ action: 'advance', taskId: 'a' });
    assert.equal(f.store.read().tasks[0].stage, kind === 'lore' ? 'retrospective' : 'documentation');
    f.finish('a');
    if (kind === 'docs') f.act({ action: 'retrospective', evidence: 'Maintenance considered' });
    f.act({ action: 'triage', evidence: 'No instruction application authorized' });
    f.act({ action: 'complete' });
    assert.equal(f.store.read().status, 'complete');
  });

  test(`standalone reviewed ${kind} cannot finish with changed assessment inputs`, t => {
    const f = fixture(t, { tasks: [{ id: 'a', title: 'Standalone maintenance', kind, agreement: { source: 'User', outcome: 'Complete the reviewed artifact' } }] });
    f.review('a');
    f.act({ action: 'advance', taskId: 'a' });
    fs.writeFileSync(path.join(f.root, 'a.txt'), 'Changed after review\r\n');
    assert.throws(() => f.act({ action: 'advance', taskId: 'a', evidence: 'Cannot complete stale work' }), { code: 'review-required' });
    f.review('a');
    f.finish('a');
    if (kind === 'docs') f.act({ action: 'retrospective', evidence: 'Maintenance considered' });
    f.act({ action: 'triage', evidence: 'No pending decisions' });
    fs.writeFileSync(path.join(f.root, 'b.txt'), 'Changed after task completion\r\n');
    assert.throws(() => f.act({ action: 'complete' }), { code: 'stale-review' });
    assert.equal(f.store.read().status, 'running');
  });
}

test('lore resumes a previously persisted repair at retrospective instead of documentation', t => {
  const f = fixture(t, { tasks: [{ id: 'a', title: 'Reviewed proposal', kind: 'lore', agreement: { source: 'User', outcome: 'Prepare a reviewed instruction proposal' } }] });
  f.review('a');
  f.store.update(actor, f.store.read().revision, 'prior-repair-state', state => { state.tasks[0].resumeStage = 'documentation'; });
  f.act({ action: 'advance', taskId: 'a' });
  assert.equal(f.store.read().tasks[0].stage, 'retrospective');
  f.finish('a');
  assert.ok(f.store.read().closing.retrospectiveEvidence);
});

test('a later integrated cumulative review covers earlier completed work without demoting historical tasks', t => {
  const f = fixture(t);
  f.check('a');
  f.review('a');
  f.finish('a');
  assert.equal(f.store.read().closing?.retrospectiveEvidence, null);
  assert.throws(() => f.act({ action: 'retrospective', evidence: 'Premature session closing' }), { code: 'closing-before-work' });
  f.act({ action: 'start-task', taskId: 'b' });
  fs.writeFileSync(path.join(f.root, 'b.txt'), 'implemented B\r\n');
  assert.equal(reviewGate(f.root, f.store.read().tasks[0]), false);
  f.check('b');
  f.review('b', ['a', 'b']);
  f.finish('b');
  f.act({ action: 'retrospective', evidence: 'Whole queue considered once' });
  f.act({ action: 'triage', evidence: 'Pending follow-ups reconciled' });
  f.act({ action: 'complete' });
  const state = f.store.read();
  assert.equal(state.status, 'complete');
  assert.equal(state.tasks[0].reviews.length, 1);
  assert.equal(state.tasks[0].status, 'complete');
});

test('refreshing assurance preserves completed documentation, retrospective and triage', t => {
  const f = fixture(t, { tasks: [{ id: 'a', title: 'A', agreement: { source: 'User', outcome: 'A' } }] });
  f.check('a');
  f.review('a');
  f.finish('a');
  f.act({ action: 'retrospective', evidence: 'Session findings considered' });
  f.act({ action: 'triage', evidence: 'No pending decisions' });
  const closing = f.store.read().closing;
  const previous = f.store.read().tasks[0];
  f.review('a');
  assert.equal(f.store.read().tasks[0].resumeStage, 'complete');
  f.act({ action: 'advance', taskId: 'a' });
  const updated = f.store.read().tasks[0];
  assert.equal(updated.status, 'complete');
  assert.equal(updated.documentationEvidence, previous.documentationEvidence);
  assert.deepEqual(f.store.read().closing, closing);
});

test('dependency and explicit-stop prerequisites apply before launching commands, even without start-task', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'writer.cjs'), "require('node:fs').writeFileSync('ran.txt', 'unexpected');\n");
  const request = { action: 'check', taskId: 'b', actor, revision: 0, check: { name: 'must not run', executable: process.execPath, args: ['writer.cjs'], paths: ['b.txt'] } };
  await assert.rejects(execute(f.root, request), { code: 'dependency-blocked' });
  assert.equal(fs.existsSync(path.join(f.root, 'ran.txt')), false);
  f.act({ action: 'stop', kind: 'user-stop', reason: 'User explicitly stopped' });
  await assert.rejects(execute(f.root, { ...request, taskId: 'a', revision: f.store.read().revision }), { code: 'run-stopped' });
  assert.equal(fs.existsSync(path.join(f.root, 'ran.txt')), false);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'run-stopped' });
  f.act({ action: 'resume', authority: 'User explicitly requested resumption' });
  assert.equal(f.store.read().status, 'running');
});

test('repeated review-local finding names retain both paid reports, and revalidation reopens repair obligations', t => {
  const f = fixture(t);
  const finding = { id: 'same-name', consequence: 'Wrong behavior', evidence: 'Concrete branch path', required: true };
  f.check('a');
  f.review('a', ['a'], [finding]);
  const first = f.store.read().tasks[0].findings[0];
  f.act({ action: 'validate', taskId: 'a', findingId: first.id, validation: { session: 'skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Concrete reproduction', snapshot: snapshot(f.root, ['a.txt', 'b.txt']) } });
  f.act({ action: 'dispose', taskId: 'a', findingId: first.id, disposition: 'implement', reason: 'Required behavior', obligation: { classification: 'required', basis: 'Accepted required behavior' } });
  f.act({ action: 'repair', taskId: 'a', findingIds: [first.id] });
  f.review('a', ['a'], [finding]);
  let state = f.store.read();
  assert.equal(state.tasks[0].reviews.length, 2);
  assert.notEqual(state.tasks[0].findings[0].id, state.tasks[0].findings[1].id);
  assert.deepEqual(state.tasks[0].findings[1].relatedTo, [first.id]);
  f.act({ action: 'validate', taskId: 'a', findingId: first.id, validation: { session: 'new-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'New evidence reopens the earlier issue', snapshot: snapshot(f.root, ['a.txt', 'b.txt']) } });
  state = f.store.read();
  assert.equal(state.tasks[0].findings[0].repaired, false);
  assert.equal(reviewGate(f.root, state.tasks[0]), false);
});

test('large immutable logs are stored once rather than copied into every history revision', t => {
  const f = fixture(t);
  f.act({ action: 'check', taskId: 'a', evidence: { name: 'Large test log', passed: true, snapshot: snapshot(f.root, ['a.txt']), output: 'x'.repeat(1024 * 1024) } });
  for (let index = 0; index < 20; index++) f.act({ action: 'followup', item: { id: 'item-' + index, context: 'Observed issue', recommendation: 'Discuss after the run' } });
  const historyBytes = f.store.db.prepare('SELECT sum(length(state)) AS bytes FROM history').get().bytes;
  assert.ok(historyBytes < 200000, 'Small transitions should not repeat megabyte evidence');
  assert.equal(f.store.read().tasks[0].checks[0].output.length, 1024 * 1024);
  assert.ok(fs.statSync(path.join(f.root, '.nightshift/runs/state.sqlite')).size < 3 * 1024 * 1024);
});

test('focused restoration excludes inventory payloads, and final reconciliation remains actionable', t => {
  const f = fixture(t, { mode: 'unattended' });
  const state = f.store.read();
  state.tasks[0].findings.push({ id: 'finding', consequence: 'Concrete defect', evidence: 'Evidence summary', validation: { verdict: 'confirmed', snapshot: { files: Array.from({ length: 1000 }, (_, index) => ({ path: 'file-' + index, sha256: 'a'.repeat(64) })) } } });
  const brief = obligationBrief(state, f.root, { verifyFreshness: false });
  assert.ok(JSON.stringify(brief).length < 5000);
  assert.equal(JSON.stringify(brief).includes('sha256'), false);
  f.store.update(actor, 0, 'fixture-completed-stages', current => { current.tasks.forEach(task => { task.status = 'complete'; task.stage = 'complete'; }); });
  assert.equal(handleHook({ cwd: f.root, session_id: actor.session, hook_event_name: 'Stop' }).decision, 'block');
});

test('deadlines stop owned work, while unsupported limits cannot be silently accepted', t => {
  const f = fixture(t, { limits: { deadlineUtc: '2000-01-01T00:00:00Z' } });
  assert.throws(() => f.act({ action: 'start-task', taskId: 'a' }), { code: 'resource-limit' });
  const output = handleHook({ cwd: f.root, session_id: actor.session, hook_event_name: 'Stop' });
  assert.equal(output.continue, false);
  assert.equal(f.store.read().stop.kind, 'resource-limit');
  assert.throws(() => f.store.create({ objective: 'More', authority: 'User', controller: actor, limits: { unknown: 4 }, tasks: [] }), { code: 'unsupported-limit' });
});

test('follow-up resolution preserves the actual user decision and does not require further prompts', t => {
  const f = fixture(t);
  f.act({ action: 'followup', item: { id: 'idea', context: 'Concrete pending proposal', recommendation: 'Track it' } });
  f.act({ action: 'resolve-followup', followupId: 'idea', decision: 'track', authority: 'User explicitly chose track', route: '.nightshift/FEATURES.md#idea' });
  assert.equal(obligationBrief(f.store.read()).followups.length, 0);
  assert.equal(f.store.read().followups[0].authority, 'User explicitly chose track');
});

test('a linked database is rejected before SQLite opens it', t => {
  const f = fixture(t);
  fs.linkSync(path.join(f.root, '.nightshift/runs/state.sqlite'), path.join(f.root, 'linked.sqlite'));
  assert.throws(() => new RunStore(f.root), { code: 'unsafe-path' });
});

test('unattended execution requires verified continuation but attended work remains available', t => {
  const f = fixture(t, { mode: 'unattended' });
  assert.throws(() => f.act({ action: 'start-task', taskId: 'a' }), { code: 'unverified-continuation' });
  f.act({ action: 'continuation', mechanism: { verified: true, evidence: 'Fixture native continuation receipt' } });
  f.act({ action: 'start-task', taskId: 'a' });
  assert.equal(f.store.read().tasks[0].status, 'active');
});

test('blocked sessions can record closing work without claiming unfinished engineering complete', t => {
  const f = fixture(t, { mode: 'unattended' });
  f.act({ action: 'block', taskId: 'a', blocker: { kind: 'capability', reason: 'Continuation could not be verified', recoveryAttempted: 'Checked the actual host mechanism' } });
  assert.equal(obligationBrief(f.store.read()).closing.ready, true);
  f.act({ action: 'retrospective', evidence: 'Capability limitation captured without inventing delivered work' });
  assert.equal(obligationBrief(f.store.read()).closing.stage, 'report');
  fs.mkdirSync(path.join(f.root, '.nightshift/runs/reports'), { recursive: true });
  fs.writeFileSync(path.join(f.root, '.nightshift/runs/reports/blocked.md'), '# Morning report\n');
  f.act({ action: 'report', path: '.nightshift/runs/reports/blocked.md' });
  f.act({ action: 'triage', evidence: 'Await the user decision; preserve both tasks' });
  assert.equal(obligationBrief(f.store.read()).closing.stage, 'complete');
  assert.notEqual(f.store.read().status, 'complete');
  assert.throws(() => f.act({ action: 'complete' }), { code: 'unverified-continuation' });
});

test('substantial work can complete its governing spec review before implementation without code changes invalidating that spec', t => {
  const f = fixture(t, { tasks: [{ id: 'code', title: 'Substantial work', agreement: { source: 'User confirmed commitments', outcome: 'Agreed behavior', spec: 'spec.md', specReviewed: false } }] });
  fs.writeFileSync(path.join(f.root, 'spec.md'), '# Agreed behavior\n');
  assert.throws(() => f.act({ action: 'start-task', taskId: 'code' }), { code: 'spec-review-required' });
  assert.equal(obligationBrief(f.store.read()).next[0].stage, 'governing-spec-review');
  f.act({ action: 'add-spec-review', taskId: 'code' });
  const specId = f.store.read().tasks[0].agreement.specReviewTaskId;
  f.act({ action: 'start-task', taskId: specId });
  f.act({ action: 'advance', taskId: specId });
  f.act({ action: 'review', taskId: specId, review: { requestId: 'spec-assessment', kind: 'spec', session: 'spec-reviewer', attributionVerified: true, status: 'complete', strength: 'strong', independent: true, broad: true, dimensions: [...DIMENSIONS.spec], coverageEvidence: 'Whole governing spec and project context examined', snapshot: snapshot(f.root, ['spec.md']), contextSnapshot: snapshot(f.root, ['spec.md', 'a.txt', 'b.txt']), findings: [] } });
  f.finish(specId);
  f.act({ action: 'start-task', taskId: 'code' });
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'implementation changes\n');
  assert.doesNotThrow(() => f.act({ action: 'check', taskId: 'code', evidence: verifyCommand(f.root, { name: 'Implementation check', executable: process.execPath, args: ['--version'], paths: ['a.txt'] }) }));
  fs.writeFileSync(path.join(f.root, 'spec.md'), '# Changed governing spec\n');
  assert.throws(() => f.act({ action: 'start-task', taskId: 'code' }), { code: 'spec-review-required' });
});
