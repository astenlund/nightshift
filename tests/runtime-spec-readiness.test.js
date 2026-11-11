'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fixtureContinuation } = require('./fixtures/continuation');
const { fixtureControllerClaim } = require('./fixtures/controller-claim');
const { fixtureReport } = require('./fixtures/report');
const { RunStore } = require('../internal/runtime/store');
const { DIMENSIONS, assertAction, commitmentsFor, historicalDischarge, obligationBrief, transition } = require('../internal/runtime/lifecycle');const { identity } = require('../internal/runtime/applicability');
const { acknowledged, scopeHash } = require('../internal/runtime/acknowledgement');
const { executeWithFixtureController: execute } = require('./fixtures/controller-claim');
const { requirementContext } = require('../internal/runtime/progress');
const { samePath } = require('../internal/runtime/spec-readiness');
const { snapshot, verifyCommand } = require('../internal/runtime/evidence');

const actor = { host: 'codex', session: 'controller' };
const SPEC = 'spec.md';
const code = (id, agreement = {}, extra = {}) => ({ id, title: id, agreement: { source: 'User', outcome: 'Implement ' + id, spec: SPEC, ...agreement }, ...extra });
const specTask = (id, spec = SPEC, extra = {}) => ({ id, title: id, kind: 'spec', agreement: { source: 'User', outcome: 'Assess ' + id, spec }, ...extra });
const structural = value => Array.isArray(value?.files) && value.files.length > 0;

function parentDirectory() {
  const parent = path.resolve(__dirname, '../.tmp/runtime-spec-readiness');
  fs.mkdirSync(parent, { recursive: true });

  return parent;
}

function project(t, files = {}) {
  const root = fs.mkdtempSync(path.join(parentDirectory(), 'case-'));
  for (const [file, content] of Object.entries({ [SPEC]: '# Governing spec\n', 'a.txt': 'a\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  const store = new RunStore(root, { create: true });
  t.after(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  return { root, store };
}

function handover(store, tasks) {
  return store.create({ mechanism: fixtureContinuation(), objective: 'Deliver the accepted work', authority: 'User handover', controller: actor, controllerClaim: fixtureControllerClaim(actor), docsGate: false, tasks });
}

function fixture(t, tasks, files) {
  const { root, store } = project(t, files);
  handover(store, tasks);
  let counter = 0;
  const act = request => {
    fixtureReport(store, actor, request);
    if (request.action === 'review') request.review.commitments ??= commitmentsFor(store.read().tasks);
    return store.update(actor, store.read().revision, request.action, state => transition(state, request));
  };
  const task = id => store.read().tasks.find(item => item.id === id);
  const write = (file, content) => fs.writeFileSync(path.join(root, file), content);
  const check = (id, paths = ['a.txt']) => act({ action: 'check', taskId: id, evidence: verifyCommand(root, { name: 'Fixture check', executable: process.execPath, args: ['--version'], paths }) });
  const review = (id, kind, paths, overrides = {}) => act({ action: 'review', taskId: id, review: { requestId: `${kind}-${++counter}`, kind, coveredTaskIds: [id], session: 'reviewer', attributionVerified: true, strength: 'strong', independent: true, broad: true, status: 'complete', dimensions: [...DIMENSIONS[kind]], coverageEvidence: 'Examined the whole change', snapshot: snapshot(root, paths), findings: [], ...overrides } });
  const specReview = (id, overrides) => review(id, 'spec', [task(id).agreement.spec], overrides);
  const codeReview = (id, overrides) => review(id, 'code', ['a.txt', task(id).agreement.spec], overrides);
  // The originating spec reviewer's applicability call on the latest spec assessment after the spec changed.
  const relevance = (id, outcome = 'preserve') => {
    const original = [...task(id).reviews].reverse().find(item => !item.relevance && item.kind === 'spec');
    return act({ action: 'review', taskId: id, review: { requestId: `relevance-${++counter}`, kind: 'spec', lineage: original.requestId, relevance: { requestId: original.requestId, originalHash: identity(original), taskIds: [id], originalInputsAvailable: true }, applicability: [{ id, outcome, evidence: 'Examined the edit against the assessment' }], session: 'reviewer', attributionVerified: true, strength: 'strong', independent: true, status: 'complete', dimensions: [], coverageEvidence: 'Applicability only', snapshot: snapshot(root, [task(id).agreement.spec]), findings: [] } });
  };
  const advance = id => act({ action: 'advance', taskId: id, evidence: 'Fixture stage evidence' });
  const advanceTo = (id, stage) => {
    while (task(id).stage !== stage) advance(id);
  };
  const completeSpec = id => {
    if (task(id).status === 'pending') act({ action: 'start-task', taskId: id });
    specReview(id);
    advanceTo(id, 'complete');
  };
  // Implementation, check and code review, leaving the code task at documentation, one step short of completion.
  const toDocumentation = id => {
    if (task(id).status === 'pending') act({ action: 'start-task', taskId: id });
    check(id);
    advanceTo(id, 'review');
    codeReview(id);
    advanceTo(id, 'documentation');
  };
  const readiness = id => obligationBrief(store.read()).specReadiness.find(entry => entry.taskId === id);
  const finishRun = () => {
    act({ action: 'retrospective', evidence: 'Retrospective recorded' });
    act({ action: 'triage', evidence: 'Follow-ups triaged' });
    return act({ action: 'complete' });
  };

  return { root, store, act, task, write, check, review, specReview, codeReview, relevance, advance, advanceTo, completeSpec, toDocumentation, readiness, finishRun };
}

function finding(id, file = 'a.txt') {
  return { id, severity: 'important', consequence: 'A defect in ' + file, evidence: 'Observed in ' + file, surfaces: [{ path: file, location: 'line 1', evidence: 'The defect is here' }], basis: [] };
}

function validation(f, findingId) {
  const recorded = f.task('code').findings.find(item => item.id === findingId);
  return { session: 'skeptic-' + findingId, attributionVerified: true, verdict: 'confirmed', evidence: 'Reproduced the defect', repairProposal: 'Repair the line', surfaces: recorded.surfaces.map(surface => ({ path: surface.path, location: surface.location, verdict: 'confirmed', evidence: 'Present' })), snapshot: snapshot(f.root, recorded.scope) };
}

const DISPOSE = { disposition: 'implement', reason: 'Required by the agreement', obligation: { classification: 'required', basis: 'Accepted outcome' } };

test('every formerly refused action proceeds on an unready code task, and a declared dependency on the spec task still holds', t => {
  const f = fixture(t, [code('code')]);
  assert.equal(f.readiness('code').ready, false);
  f.act({ action: 'start-task', taskId: 'code' });
  f.check('code');
  for (const action of ['dispatch', 'probe', 'validate', 'dialogue', 'dispose', 'repair']) assert.doesNotThrow(() => assertAction(f.store.read(), { action, taskId: 'code' }));
  f.advanceTo('code', 'review');
  f.codeReview('code', { findings: [finding('defect')] });
  const [raised] = f.task('code').findings;
  f.act({ action: 'validate', taskId: 'code', findingId: raised.id, validation: validation(f, raised.id) });
  f.act({ action: 'dispose', taskId: 'code', findingId: raised.id, ...DISPOSE });
  f.act({ action: 'repair', taskId: 'code', findingIds: [raised.id] });
  assert.equal(f.task('code').findings[0].repaired, true);

  const g = fixture(t, [specTask('spec'), code('code', {}, { requires: ['spec'] })]);
  assert.throws(() => g.act({ action: 'start-task', taskId: 'code' }), { code: 'dependency-blocked' });
});

test('completion refuses with the named cause on both completing paths, and run completion likewise', t => {
  const f = fixture(t, [code('code')]);
  f.toDocumentation('code');
  assert.throws(() => f.advance('code'), { code: 'spec-review-required', message: /code: no assessment route: no link, no reviewed snapshot and no queued spec task over this spec\. Next: Run add-spec-review on code/ });
  assert.equal(f.task('code').stage, 'documentation');

  const g = fixture(t, [code('code', { specReviewed: true })]);
  g.toDocumentation('code');
  g.advance('code');
  assert.equal(g.task('code').status, 'complete');
  g.write(SPEC, '# Edited governing spec\n');
  assert.throws(() => g.act({ action: 'complete' }), { code: 'spec-review-required', message: /Run completion requires every governing spec to be ready\. code: no assessment route: no link, a stale reviewed snapshot/ });
  g.codeReview('code');
  assert.equal(g.task('code').resumeStage, 'complete');
  assert.throws(() => g.advance('code'), { code: 'spec-review-required', message: /a stale reviewed snapshot/ });
  assert.equal(g.task('code').stage, 'review');
});

for (const outcome of ['preserve', 'reassess', 'unresolved', null]) {
  test(`a compatible spec edit after the spec task completed is ${outcome === 'preserve' ? 'settled' : 'held'} by ${outcome ?? 'an absent'} applicability call`, t => {
    const f = fixture(t, [specTask('spec'), code('code')]);
    f.completeSpec('spec');
    assert.deepEqual(f.readiness('code'), { taskId: 'code', ready: true, specTaskId: 'spec', cause: null, next: null, specAcceptance: { recorded: false, current: null } });
    f.write(SPEC, '# Governing spec, compatibly corrected\n');
    assert.equal(f.readiness('code').ready, false);
    assert.match(f.readiness('code').cause, /the assessment of spec awaits the reviewer's applicability call after changes to spec\.md/);
    if (outcome) f.relevance('spec', outcome);
    const reading = f.readiness('code');
    assert.equal(reading.ready, outcome === 'preserve');
    if (outcome && outcome !== 'preserve') assert.match(reading.cause, new RegExp(`answered ${outcome}`));
    if (outcome === 'preserve') {
      f.toDocumentation('code');
      f.advance('code');
      assert.equal(f.task('code').status, 'complete');
    }
  });
}

test('an unsettled spec finding and a structural comparison failure hold completion', t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  f.act({ action: 'start-task', taskId: 'spec' });
  f.specReview('spec', { findings: [finding('gap', SPEC)] });
  assert.equal(f.readiness('code').ready, false);
  assert.match(f.readiness('code').cause, /spec task spec is not complete/);

  const g = fixture(t, [specTask('spec'), code('code')]);
  g.completeSpec('spec');
  g.store.update(actor, g.store.read().revision, 'fixture-corrupt-assessment', state => {
    state.tasks[0].reviews[0].snapshot.digest = '0'.repeat(64);
  });
  assert.match(g.readiness('code').cause, /the assessment comparison of spec failed structurally/);
  g.toDocumentation('code');
  assert.throws(() => g.advance('code'), { code: 'spec-review-required' });
});

test('add-spec-review records its link beside the agreement, leaving validations current, and a spec edit stales only spec-bound validations', t => {
  const f = fixture(t, [code('code')]);
  f.act({ action: 'start-task', taskId: 'code' });
  f.check('code');
  f.advanceTo('code', 'review');
  f.codeReview('code', { findings: [finding('first'), finding('second')] });
  const [first, second] = f.task('code').findings;
  for (const item of [first, second]) f.act({ action: 'validate', taskId: 'code', findingId: item.id, validation: validation(f, item.id) });
  const scopeBefore = scopeHash(f.store.read());
  f.act({ action: 'add-spec-review', taskId: 'code' });
  const linked = f.task('code');
  assert.equal(linked.specReviewTaskId, 'code-governing-spec');
  assert.equal(Object.hasOwn(linked.agreement, 'specReviewTaskId'), false);
  assert.equal(Object.hasOwn(linked.agreement, 'specReviewed'), false);
  assert.equal(scopeHash(f.store.read()), scopeBefore);
  assert.equal(requirementContext(linked).specTask, 'code-governing-spec');
  assert.equal(obligationBrief(f.store.read()).next.find(item => item.id === 'code').agreement.specReviewTaskId, 'code-governing-spec');
  f.act({ action: 'dispose', taskId: 'code', findingId: first.id, ...DISPOSE });
  f.write(SPEC, '# Governing spec, edited from the code task\n');
  assert.throws(() => f.act({ action: 'dispose', taskId: 'code', findingId: second.id, ...DISPOSE }), { code: 'stale-validation' });
  f.act({ action: 'repair', taskId: 'code', findingIds: [first.id] });
  f.act({ action: 'validate', taskId: 'code', findingId: second.id, validation: validation(f, second.id) });
  f.act({ action: 'dispose', taskId: 'code', findingId: second.id, ...DISPOSE });
  assert.equal(f.task('code').findings[1].disposition, 'implement');
  // The linked spec task leaves review straight for completion, without a documentation stage.
  f.act({ action: 'start-task', taskId: 'code-governing-spec' });
  f.specReview('code-governing-spec');
  f.advance('code-governing-spec');
  assert.equal(f.task('code-governing-spec').status, 'complete');
  assert.equal(f.readiness('code').ready, true);
});

test('a completed code task reaches readiness through the spec task add-spec-review creates, and that run stays historically discharged', t => {
  const f = fixture(t, [code('code')]);
  f.toDocumentation('code');
  f.act({ action: 'add-spec-review', taskId: 'code' });
  f.completeSpec('code-governing-spec');
  f.advance('code');
  assert.equal(f.task('code').status, 'complete');
  assert.equal(f.finishRun().status, 'complete');
  assert.equal(historicalDischarge(f.store.read(), structural), true);
});

test('add-spec-review refuses while a unique queued spec task governs, and does nothing for a task linked in either place', t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  assert.throws(() => f.act({ action: 'add-spec-review', taskId: 'code' }), { code: 'duplicate-task', message: /Queued spec task spec already governs this task/ });
  assert.match(f.readiness('code').next, /Complete spec/);
  assert.doesNotMatch(f.readiness('code').next, /add-spec-review/);

  const g = fixture(t, [specTask('spec'), code('code', { specReviewTaskId: 'spec' })]);
  const before = g.store.read().tasks.length;
  g.act({ action: 'add-spec-review', taskId: 'code' });
  assert.equal(g.store.read().tasks.length, before);
  g.store.update(actor, g.store.read().revision, 'fixture-link-beside', state => {
    delete state.tasks[1].agreement.specReviewTaskId;
    state.tasks[1].specReviewTaskId = 'spec';
  });
  g.act({ action: 'add-spec-review', taskId: 'code' });
  assert.equal(g.store.read().tasks.length, before);
});

test('add-spec-review on a task ready through a fresh reviewed snapshot links a new task that then governs', t => {
  const f = fixture(t, [code('code', { specReviewed: true })]);
  assert.equal(f.readiness('code').ready, true);
  f.act({ action: 'add-spec-review', taskId: 'code' });
  assert.equal(f.task('code').agreement.specReviewed, true);
  assert.equal(f.readiness('code').ready, false);
  assert.equal(f.readiness('code').specTaskId, 'code-governing-spec');
});

test('links resolve from either place, the one beside the agreement first', t => {
  const f = fixture(t, [specTask('old'), specTask('new'), code('code', { specReviewTaskId: 'old' })]);
  assert.equal(f.readiness('code').specTaskId, 'old');
  f.store.update(actor, f.store.read().revision, 'fixture-both-links', state => {
    state.tasks[2].specReviewTaskId = 'new';
  });
  assert.equal(f.readiness('code').specTaskId, 'new');
  assert.equal(obligationBrief(f.store.read()).next.find(item => item.id === 'code').agreement.specReviewTaskId, 'new');
});

test('unusable spec values have a structural cause and add-spec-review refuses them', t => {
  for (const value of ['', '   ', 42, null, '../outside.md']) {
    const f = fixture(t, [code('code')]);
    f.store.update(actor, f.store.read().revision, 'fixture-legacy-spec', state => {
      state.tasks[0].agreement.spec = value;
    });
    const reading = f.readiness('code');
    assert.equal(reading.ready, false);
    assert.match(reading.cause, /spec value .* is unusable/);
    assert.match(reading.next, /block code with kind user-decision/);
    assert.throws(() => f.act({ action: 'add-spec-review', taskId: 'code' }), { code: 'missing-spec' });
  }
});

test('one queued spec task governs several code tasks, and an amendment on one holds the other', t => {
  const f = fixture(t, [specTask('spec'), code('one'), code('two')]);
  f.completeSpec('spec');
  assert.equal(f.readiness('one').ready, true);
  assert.equal(f.readiness('two').ready, true);
  f.act({ action: 'start-task', taskId: 'one' });
  f.act({ action: 'block', taskId: 'one', blocker: { kind: 'user-decision', reason: 'The outcome changes', recoveryAttempted: 'Asked the user' } });
  f.act({ action: 'unblock', taskId: 'one', evidence: 'User amended the outcome', updatedOutcome: 'An amended outcome' });
  assert.equal(f.task('spec').status, 'pending');
  assert.equal(f.task('spec').requirementsRevision, f.task('one').requirementsRevision);
  assert.equal(f.readiness('two').ready, false);
  assert.match(f.readiness('two').cause, /spec task spec is not complete/);
});

test('a queued spec task that requires the code task, directly or through another task, does not govern it', t => {
  for (const tasks of [
    [code('code'), specTask('after', SPEC, { requires: ['code'] })],
    [code('code'), { id: 'middle', title: 'middle', kind: 'docs', requires: ['code'], agreement: { source: 'User', outcome: 'Docs' } }, specTask('after', SPEC, { requires: ['middle'] })],
  ]) {
    const f = fixture(t, tasks);
    const reading = f.readiness('code');
    assert.equal(reading.specTaskId, null);
    assert.match(reading.cause, /after, excluded because it requires this task/);
    assert.match(reading.next, /add-spec-review/);
  }
});

test('a spec task linked by another code task or by a docs task is not queued', t => {
  const f = fixture(t, [specTask('spec'), code('linker', { specReviewTaskId: 'spec' }), code('sibling')]);
  assert.equal(f.readiness('sibling').specTaskId, null);
  assert.match(f.readiness('sibling').cause, /no queued spec task over this spec/);

  const g = fixture(t, [specTask('spec'), { id: 'docs', title: 'docs', kind: 'docs', agreement: { source: 'User', outcome: 'Docs', specReviewTaskId: 'spec' } }, code('code')]);
  assert.equal(g.readiness('code').specTaskId, null);
  g.act({ action: 'start-task', taskId: 'spec' });
  g.specReview('spec');
  g.advance('spec');
  assert.equal(g.task('spec').stage, 'documentation');
});

test('missing and ambiguous queued routes name add-spec-review; an inferred task leaves the agreement echo null', t => {
  const f = fixture(t, [specTask('first'), specTask('second'), code('code')]);
  assert.match(f.readiness('code').cause, /several queued spec tasks over this spec \(first, second\)/);
  assert.match(f.readiness('code').next, /add-spec-review on code/);

  const g = fixture(t, [specTask('spec'), code('code')]);
  assert.equal(g.readiness('code').specTaskId, 'spec');
  assert.equal(obligationBrief(g.store.read()).next.find(item => item.id === 'code').agreement.specReviewTaskId, null);
});

test('a spec path matches another spelling of the same file, and an identity that cannot be established is no match', t => {
  const f = fixture(t, [specTask('spec', 'SPEC.md'), code('code')]);
  const caseInsensitive = fs.existsSync(path.join(f.root, 'SPEC.md'));
  if (!caseInsensitive) {
    t.diagnostic('Case-sensitive filesystem: the alternate spelling names another file');
    return;
  }
  assert.equal(f.readiness('code').specTaskId, 'spec');
  assert.equal(samePath(f.root, 'SPEC.md', 'missing.md'), false);
  assert.equal(samePath(f.root, 'missing.md', 'MISSING.md'), false);
  assert.equal(samePath(f.root, '../spec.md', SPEC), false);

  const { store } = project(t);
  handover(store, [specTask('spec', 'SPEC.md'), code('code', { specReviewTaskId: 'spec' })]);
  assert.equal(store.read().tasks.length, 2);
});

test('a deleted spec file is its own cause, an amendment leaves it in place, and restoring it clears it', t => {
  const f = fixture(t, [specTask('spec', 'SPEC.md'), code('code', { specReviewTaskId: 'spec' })]);
  if (!fs.existsSync(path.join(f.root, 'SPEC.md'))) return;
  f.completeSpec('spec');
  assert.equal(f.readiness('code').ready, true);
  fs.unlinkSync(path.join(f.root, SPEC));
  assert.match(f.readiness('code').cause, /the governing spec file spec\.md is missing/);
  assert.match(f.readiness('code').next, /^Restore spec\.md; otherwise ask the user to decide on the run/);
  f.act({ action: 'start-task', taskId: 'code' });
  f.act({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Spec removed', recoveryAttempted: 'Checked history' } });
  f.act({ action: 'unblock', taskId: 'code', evidence: 'User asked to continue' });
  assert.match(f.readiness('code').cause, /is missing/);
  fs.writeFileSync(path.join(f.root, SPEC), '# Governing spec\n');
  assert.equal(f.readiness('code').specTaskId, 'spec');
  assert.doesNotMatch(f.readiness('code').cause ?? '', /missing/);
  // The amendment could not reopen the spec task while the spellings could not be matched, yet it still needs a fresh assessment.
  assert.equal(f.task('spec').status, 'complete');
  assert.match(f.readiness('code').cause, /the assessment of spec predates the amendment of code/);
  f.specReview('spec');
  f.advanceTo('spec', 'complete');
  assert.equal(f.readiness('code').ready, true);
});

test('malformed assessment evidence and an unclosed finding on a completed spec task leave the code task unready', t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  f.completeSpec('spec');
  f.store.update(actor, f.store.read().revision, 'fixture-no-dimensions', state => {
    delete state.tasks[0].reviews[0].dimensions;
  });
  assert.match(f.readiness('code').cause, /the assessment of spec is missing the dimensions/);

  const g = fixture(t, [specTask('spec'), code('code')]);
  g.completeSpec('spec');
  g.store.update(actor, g.store.read().revision, 'fixture-unclosed-finding', state => {
    const review = state.tasks[0].reviews[0];
    state.tasks[0].findings.push({ id: 'spec-gap', localId: 'gap', reviewKind: 'spec', reviewRevision: review.revision, consequence: 'Gap', evidence: 'Gap', validation: { verdict: 'confirmed' }, disposition: 'implement', repaired: true, repairRevision: review.revision + 1, pendingClosure: { lineage: review.requestId, requestId: review.requestId, revision: review.revision + 1 } });
  });
  assert.match(g.readiness('code').cause, /spec findings remain unsettled or unclosed: spec-gap/);

  for (const damage of [{ dimensions: 'not a list' }, { coverageEvidence: 42 }, { coverageEvidence: {} }]) {
    const h = fixture(t, [specTask('spec'), code('code')]);
    h.completeSpec('spec');
    h.store.update(actor, h.store.read().revision, 'fixture-malformed-assessment', state => {
      Object.assign(state.tasks[0].reviews[0], damage);
    });
    const reading = h.readiness('code');
    assert.equal(reading.ready, false, JSON.stringify(damage));
    assert.equal(typeof reading.cause, 'string');
  }
});

test('malformed spec assessment evidence beside a repaired code task leaves status readable', t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  f.completeSpec('spec');
  f.store.update(actor, f.store.read().revision, 'fixture-malformed-with-repair', state => {
    Object.assign(state.tasks[0].reviews[0], { coverageEvidence: 42, dimensions: 'not a list' });
    state.tasks[1].lastRepair = { revision: state.revision, kinds: ['code'] };
  });
  assert.doesNotThrow(() => obligationBrief(f.store.read()));
  assert.equal(f.readiness('code').ready, false);
});

test('a reviewed snapshot with a corrupted digest is malformed, not stale', t => {
  const f = fixture(t, [code('code', { specReviewed: true })]);
  f.store.update(actor, f.store.read().revision, 'fixture-corrupt-digest', state => {
    state.tasks[0].agreement.specSnapshot.digest = '0'.repeat(64);
  });
  assert.match(f.readiness('code').cause, /a malformed reviewed snapshot/);
});

test('a code task completed through its reviewed snapshot regains readiness through add-spec-review after a spec edit while it stays complete', t => {
  const f = fixture(t, [code('code', { specReviewed: true })]);
  f.toDocumentation('code');
  f.advance('code');
  f.write(SPEC, '# Edited after completion\n');
  assert.equal(f.readiness('code').ready, false);
  f.act({ action: 'add-spec-review', taskId: 'code' });
  f.completeSpec('code-governing-spec');
  assert.equal(f.task('code').status, 'complete');
  assert.equal(f.readiness('code').ready, true);
});

test('an amendment that could not reopen a shared queued spec task holds every code task it governs', t => {
  const f = fixture(t, [specTask('spec', 'SPEC.md'), code('one'), code('two')]);
  if (!fs.existsSync(path.join(f.root, 'SPEC.md'))) return;
  f.completeSpec('spec');
  assert.equal(f.readiness('two').ready, true);
  fs.unlinkSync(path.join(f.root, SPEC));
  f.act({ action: 'start-task', taskId: 'one' });
  f.act({ action: 'block', taskId: 'one', blocker: { kind: 'user-decision', reason: 'Scope changes', recoveryAttempted: 'Asked the user' } });
  f.act({ action: 'unblock', taskId: 'one', evidence: 'User amended the outcome', updatedOutcome: 'Amended outcome' });
  fs.writeFileSync(path.join(f.root, SPEC), '# Governing spec\n');
  assert.equal(f.task('spec').status, 'complete');
  for (const id of ['one', 'two']) assert.match(f.readiness(id).cause, /the assessment of spec predates the amendment of one/);
  f.specReview('spec');
  f.advanceTo('spec', 'complete');
  for (const id of ['one', 'two']) assert.equal(f.readiness(id).ready, true);
});

test('an assessment dispatched before an amendment and imported after it still predates the amendment', t => {
  const f = fixture(t, [specTask('spec', 'SPEC.md'), code('code', { specReviewTaskId: 'spec' })]);
  if (!fs.existsSync(path.join(f.root, 'SPEC.md'))) return;
  f.completeSpec('spec');
  const original = snapshot(f.root, ['SPEC.md']);
  f.store.update(actor, f.store.read().revision, 'fixture-dispatch', state => {
    state.workers.push({ id: 'late-spec', registeredRevision: state.revision + 1, role: 'reviewer', session: 'reviewer', taskId: 'spec', writes: [], status: 'complete' });
  });
  fs.unlinkSync(path.join(f.root, SPEC));
  f.act({ action: 'start-task', taskId: 'code' });
  f.act({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Scope changes', recoveryAttempted: 'Asked the user' } });
  f.act({ action: 'unblock', taskId: 'code', evidence: 'User amended the outcome', updatedOutcome: 'Amended outcome' });
  fs.writeFileSync(path.join(f.root, SPEC), '# Governing spec\n');
  f.specReview('spec', { requestId: 'late-spec', snapshot: original });
  f.advanceTo('spec', 'complete');
  assert.match(f.readiness('code').cause, /the assessment of spec predates the amendment of code/);
  // A dispatch record without a usable registration revision cannot date the assessment after the amendment either.
  f.store.update(actor, f.store.read().revision, 'fixture-legacy-dispatch', state => {
    delete state.workers.find(worker => worker.id === 'late-spec').registeredRevision;
  });
  assert.match(f.readiness('code').cause, /the assessment of spec predates the amendment of code/);
});

test('a run completed through a queued spec task stays historically discharged after its spec file is deleted', t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  f.completeSpec('spec');
  f.toDocumentation('code');
  f.advance('code');
  assert.equal(f.finishRun().status, 'complete');
  assert.equal(historicalDischarge(f.store.read(), structural), true);
  fs.unlinkSync(path.join(f.root, SPEC));
  assert.equal(historicalDischarge(f.store.read(), structural), true);
});

test('a material amendment is not covered by a preserving relevance decision on the old spec assessment', t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  f.completeSpec('spec');
  f.act({ action: 'start-task', taskId: 'code' });
  f.act({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Scope changes', recoveryAttempted: 'Asked the user' } });
  f.act({ action: 'unblock', taskId: 'code', evidence: 'User amended the spec', updatedOutcome: 'Amended outcome' });
  f.write(SPEC, '# Amended governing spec\n');
  f.act({ action: 'start-task', taskId: 'spec' });
  f.relevance('spec', 'preserve');
  // The spec task's own gate accepts the decision, but readiness keeps the acceptable-assessment check beside it.
  f.advanceTo('spec', 'complete');
  assert.equal(f.readiness('code').ready, false);
  assert.match(f.readiness('code').cause, /the assessment of spec predates its requirements revision/);
  f.specReview('spec');
  f.advanceTo('spec', 'complete');
  assert.equal(f.readiness('code').ready, true);
});

test('an amendment reopens a linked spec task while the code task keeps working, and a declared dependency on it waits', t => {
  const f = fixture(t, [specTask('spec'), code('code', { specReviewTaskId: 'spec' }), code('after', { specReviewTaskId: 'spec' }, { requires: ['spec'] })]);
  f.completeSpec('spec');
  f.act({ action: 'start-task', taskId: 'code' });
  f.act({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Scope changes', recoveryAttempted: 'Asked the user' } });
  f.act({ action: 'unblock', taskId: 'code', evidence: 'User amended the outcome' });
  assert.equal(f.task('spec').status, 'pending');
  assert.equal(f.task('code').agreement.specReviewed, false);
  f.check('code');
  assert.throws(() => f.act({ action: 'start-task', taskId: 'after' }), { code: 'dependency-blocked' });
});

test('an amendment on a code task governed by an inferred spec task reopens it and renews the acknowledgement after the change', t => {
  for (const agreement of [{}, { specReviewed: true }]) {
    const f = fixture(t, [specTask('spec'), code('code', agreement)]);
    f.completeSpec('spec');
    f.act({ action: 'start-task', taskId: 'code' });
    f.act({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Scope changes', recoveryAttempted: 'Asked the user' } });
    f.act({ action: 'unblock', taskId: 'code', evidence: 'User amended the outcome' });
    const state = f.store.read();
    assert.equal(f.task('spec').status, 'pending');
    assert.equal(f.task('code').agreement.specReviewed, false);
    assert.equal(f.readiness('code').ready, false);
    assert.equal(state.acknowledgement.scopeHash, scopeHash(state));
  }
});

test('structural links are left untouched by an amendment and name the user decision', t => {
  const cases = {
    'names no task in the run': [code('code', { specReviewTaskId: 'absent' })],
    'names a task that is not a spec task': [{ id: 'docs', title: 'docs', kind: 'docs', agreement: { source: 'User', outcome: 'Docs' } }, code('code', { specReviewTaskId: 'docs' })],
    'names a spec task over a different spec': [specTask('other', 'other.md'), code('code', { specReviewTaskId: 'other' })],
  };
  for (const [cause, tasks] of Object.entries(cases)) {
    const { root, store } = project(t, { 'other.md': '# Other\n' });
    assert.throws(() => handover(store, tasks), { code: 'invalid-queue' });
    handover(store, tasks.map(item => item.id === 'code' ? code('code') : item));
    store.update(actor, store.read().revision, 'fixture-legacy-link', state => {
      state.tasks.find(item => item.id === 'code').agreement.specReviewTaskId = tasks.find(item => item.id === 'code').agreement.specReviewTaskId;
    });
    const act = request => store.update(actor, store.read().revision, request.action, state => transition(state, request));
    const reading = () => obligationBrief(store.read()).specReadiness[0];
    assert.match(reading().cause, new RegExp(`an unresolvable link: .* ${cause}`));
    assert.match(reading().next, /^Ask the user to decide on the run: block code with kind user-decision.*hold, stop, or close the run administratively once stopped/);
    const before = structuredClone(store.read().tasks.filter(item => item.id !== 'code'));
    act({ action: 'start-task', taskId: 'code' });
    act({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Broken link', recoveryAttempted: 'Inspected' } });
    act({ action: 'unblock', taskId: 'code', evidence: 'User decided to continue' });
    assert.deepEqual(store.read().tasks.filter(item => item.id !== 'code'), before);
    assert.match(reading().cause, /unresolvable link/);
    assert.ok(root);
  }
});

test('a structural cause on a completed code task names the user decision without the block', t => {
  const f = fixture(t, [code('code', { specReviewed: true })]);
  f.toDocumentation('code');
  f.advance('code');
  f.store.update(actor, f.store.read().revision, 'fixture-legacy-link', state => {
    state.tasks[0].agreement.specReviewTaskId = 'absent';
  });
  const reading = f.readiness('code');
  assert.match(reading.cause, /unresolvable link/);
  assert.match(reading.next, /^Ask the user to decide on the run: until the recorded-decision operation ships/);
});

test('handover refuses links that cannot govern and links outside the agreement, and accepts falsy and unchecked links', t => {
  const refused = [
    [specTask('spec', SPEC, { requires: ['code'] }), code('code', { specReviewTaskId: 'spec' })],
    [specTask('spec', SPEC, { requires: ['middle'] }), { id: 'middle', title: 'middle', kind: 'docs', requires: ['code'], agreement: { source: 'User', outcome: 'Docs' } }, code('code', { specReviewTaskId: 'spec' })],
    [specTask('spec'), { ...code('code'), specReviewTaskId: 'spec' }],
    [specTask('spec'), { ...code('code'), specReviewTaskId: '' }],
  ];
  for (const tasks of refused) {
    const { store } = project(t);
    assert.throws(() => handover(store, tasks), { code: 'invalid-queue' });
  }
  for (const link of ['', null, false, 0]) {
    const { root, store } = project(t);
    handover(store, [code('code', { specReviewTaskId: link })]);
    const reading = obligationBrief(store.read()).specReadiness[0];
    assert.match(reading.cause, /no assessment route: no link/);
    assert.ok(root);
  }
  const { store } = project(t);
  handover(store, [{ id: 'docs', title: 'docs', kind: 'docs', agreement: { source: 'User', outcome: 'Docs', specReviewTaskId: 'absent' } }, { id: 'nospec', title: 'nospec', agreement: { source: 'User', outcome: 'No spec', specReviewTaskId: 'absent' } }]);
  assert.equal(store.read().tasks.length, 2);
});

test('handover refuses two code tasks whose governing spec tasks each require the other code task, and an older record reports the cycle', t => {
  const linked = [specTask('s1', 'one.md', { requires: ['c2'] }), specTask('s2', 'two.md', { requires: ['c1'] }), code('c1', { spec: 'one.md', specReviewTaskId: 's1' }), code('c2', { spec: 'two.md', specReviewTaskId: 's2' })];
  const queued = [specTask('s1', 'one.md', { requires: ['c2'] }), specTask('s2', 'two.md', { requires: ['c1'] }), code('c1', { spec: 'one.md' }), code('c2', { spec: 'two.md' })];
  for (const tasks of [linked, queued]) {
    const { store } = project(t, { 'one.md': '# One\n', 'two.md': '# Two\n' });
    assert.throws(() => handover(store, tasks), { code: 'invalid-queue', message: /cycle/ });
  }
  for (const [shape, tasks] of [['linked', linked], ['queued', queued]]) {
    const { store } = project(t, { 'one.md': '# One\n', 'two.md': '# Two\n' });
    handover(store, tasks.map(item => ({ ...item, requires: [] })));
    store.update(actor, store.read().revision, 'fixture-legacy-cycle', state => {
      state.tasks[0].requires = ['c2'];
      state.tasks[1].requires = ['c1'];
    });
    const reading = obligationBrief(store.read()).specReadiness.find(entry => entry.taskId === 'c1');
    assert.equal(reading.specTaskId, null);
    assert.match(reading.cause, shape === 'linked' ? /unresolvable link: "s1" names a spec task on a cycle/ : /s1, excluded because it lies on a cycle/);
  }
});

test('a blocked governing spec task, or one held by incomplete upstream work, names that in the way forward', t => {
  const f = fixture(t, [{ id: 'first', title: 'first', kind: 'docs', agreement: { source: 'User', outcome: 'Docs' } }, specTask('spec', SPEC, { requires: ['first'] }), code('code')]);
  assert.match(f.readiness('code').cause, /spec task spec is held by incomplete upstream work: first/);
  assert.match(f.readiness('code').next, /^Complete first, then spec/);
  f.act({ action: 'block', taskId: 'spec', blocker: { kind: 'capability', reason: 'No reviewer', recoveryAttempted: 'Tried each tier' } });
  assert.match(f.readiness('code').cause, /spec task spec is blocked \(capability: No reviewer\)/);
  assert.match(f.readiness('code').next, /^Resolve the recorded blocker on spec/);
});

test('a fresh reviewed snapshot is ready beside a pending queued spec task, and a stale, missing or malformed one falls through', t => {
  const f = fixture(t, [specTask('spec'), code('code', { specReviewed: true })]);
  assert.deepEqual([f.readiness('code').ready, f.readiness('code').specTaskId], [true, 'spec']);
  for (const [mutation, applied] of [['stale', null], ['missing', agreement => delete agreement.specSnapshot], ['malformed', agreement => { agreement.specSnapshot = { files: [] }; }]]) {
    for (const queuedTask of [true, false]) {
      const g = fixture(t, queuedTask ? [specTask('spec'), code('code', { specReviewed: true })] : [code('code', { specReviewed: true })]);
      if (applied) g.store.update(actor, g.store.read().revision, 'fixture-snapshot', state => applied(state.tasks.at(-1).agreement));
      else g.write(SPEC, '# Edited\n');
      const reading = g.readiness('code');
      assert.equal(reading.ready, false);
      if (queuedTask) assert.match(reading.cause, /spec task spec is not complete/);
      else assert.match(reading.cause, new RegExp(`a ${mutation} reviewed snapshot and no queued spec task`));
    }
  }
});

test('a user-decision unblock on a docs task keeps its earlier effects', t => {
  const f = fixture(t, [specTask('spec'), { id: 'docs', title: 'docs', kind: 'docs', agreement: { source: 'User', outcome: 'Docs', spec: SPEC, specReviewTaskId: 'spec' } }]);
  f.completeSpec('spec');
  f.act({ action: 'block', taskId: 'docs', blocker: { kind: 'user-decision', reason: 'Scope changes', recoveryAttempted: 'Asked' } });
  f.act({ action: 'unblock', taskId: 'docs', evidence: 'User amended the docs' });
  assert.equal(f.task('spec').status, 'pending');
  assert.equal(Object.hasOwn(f.task('docs').agreement, 'specReviewed'), false);
});

test('a failing check on a complete spec task holds neither the code task nor its completion, only the run', t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  f.act({ action: 'start-task', taskId: 'spec' });
  f.check('spec', [SPEC]);
  f.specReview('spec');
  f.advanceTo('spec', 'complete');
  f.write(SPEC, '# Governing spec, compatibly corrected\n');
  f.relevance('spec', 'preserve');
  assert.equal(f.readiness('code').ready, true);
  f.toDocumentation('code');
  f.advance('code');
  assert.equal(f.task('code').status, 'complete');
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  assert.throws(() => f.act({ action: 'complete' }), { code: 'verification-required', message: /spec: check "Fixture check" inputs-changed/ });
});

test('a completed task reports its spec acceptance before and after spec-accepted on amended content, still held', t => {
  const f = fixture(t, [code('code', { specReviewed: true })]);
  f.toDocumentation('code');
  f.advance('code');
  f.write(SPEC, '# Amended\n');
  assert.deepEqual(f.readiness('code').specAcceptance, { recorded: false, current: null });
  f.act({ action: 'spec-accepted', taskId: 'code', authority: 'User accepted the amended spec' });
  assert.deepEqual(f.readiness('code').specAcceptance, { recorded: true, current: true });
  assert.equal(f.readiness('code').ready, false);
});

test('a spec edit after the code task completed is reported while the next list is empty, on both routes', t => {
  for (const route of ['spec-task', 'reviewed']) {
    const f = fixture(t, route === 'spec-task' ? [specTask('spec'), code('code')] : [code('code', { specReviewed: true })]);
    if (route === 'spec-task') f.completeSpec('spec');
    f.toDocumentation('code');
    f.advance('code');
    f.write(SPEC, '# Edited after completion\n');
    const brief = obligationBrief(f.store.read());
    assert.deepEqual(brief.next, []);
    assert.equal(brief.specReadiness[0].ready, false);
    assert.equal(f.task('code').status, 'complete');
  }
});

test('status fields with and without freshness verification, and none in a review context or a closed record', t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  const brief = obligationBrief(f.store.read());
  assert.equal(brief.specReadiness.length, 1);
  assert.equal(brief.next.find(item => item.id === 'code').stage, 'implementation');
  assert.equal(obligationBrief(f.store.read(), f.root, { verifyFreshness: false }).specReadiness, 'reconcile at acceptance');
  assert.equal(Object.hasOwn(obligationBrief({ ...f.store.read(), kind: 'review' }), 'specReadiness'), false);
  assert.equal(Object.hasOwn(obligationBrief({ ...f.store.read(), status: 'closed' }), 'specReadiness'), false);
});

const SIMULATED = { runContained: async (_executable, _args, options) => {
  options.onFinished({ code: 0, descendantsReclaimed: true });
  return { code: 0, stdout: 'Simulated passing command', stderr: '', descendantsReclaimed: true };
} };
const CHECK = { name: 'Fixture check', executable: process.execPath, args: ['--version'], paths: ['a.txt'], timeoutMs: 5000 };

function executed(t, tasks) {
  const { root, store } = project(t);
  const run = request => execute(root, { actor, revision: store.read()?.revision, ...request }, SIMULATED);
  const handoverRequest = queue => ({ action: 'handover', mechanism: fixtureContinuation(), controller: actor, authority: 'User handover', objective: 'Deliver the accepted work', tasks: queue });

  return { root, store, run, handover: (queue = tasks) => execute(root, handoverRequest(queue), SIMULATED) };
}

test('on the full execute path a link beside the agreement keeps the acknowledgement current and a later check passes', async t => {
  const f = executed(t, [code('code')]);
  await f.handover();
  await f.run({ action: 'start-task', taskId: 'code' });
  await f.run({ action: 'add-spec-review', taskId: 'code' });
  const state = f.store.read();
  assert.equal(state.tasks[0].specReviewTaskId, 'code-governing-spec');
  assert.equal(acknowledged(state), true);
  await f.run({ action: 'check', taskId: 'code', check: CHECK });
  assert.equal(f.store.read().tasks[0].checks.at(-1).passed, true);
});

test('on the full execute path an amendment reopening an inferred spec task renews the acknowledgement, and a later check passes once it is observed', async t => {
  const f = executed(t, [specTask('spec'), code('code')]);
  await f.handover();
  await f.run({ action: 'start-task', taskId: 'code' });
  await f.run({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Scope changes', recoveryAttempted: 'Asked the user' } });
  await f.run({ action: 'unblock', taskId: 'code', evidence: 'User amended the outcome', updatedOutcome: 'An amended outcome' });
  let state = f.store.read();
  assert.equal(state.tasks[0].requirementsRevision, state.tasks[1].requirementsRevision);
  assert.equal(state.acknowledgement.status, 'pending');
  assert.equal(state.acknowledgement.scopeHash, scopeHash(state));
  await f.run({ action: 'check', taskId: 'code', check: CHECK });
  state = f.store.read();
  assert.equal(acknowledged(state), true);
  assert.equal(state.tasks[1].checks.at(-1).passed, true);
});

test('a run completed through a queued spec task lets a later delivery be created', async t => {
  const f = fixture(t, [specTask('spec'), code('code')]);
  f.completeSpec('spec');
  f.toDocumentation('code');
  f.advance('code');
  assert.equal(f.finishRun().status, 'complete');
  f.act({ action: 'report-delivered', authority: 'User read the report' });
  const later = await execute(f.root, { action: 'handover', mechanism: fixtureContinuation(), controller: actor, authority: 'User handover', objective: 'Later work', tasks: [{ id: 'later', title: 'later', agreement: { source: 'User', outcome: 'Later' } }] }, SIMULATED);
  assert.equal(later.tasks[0].id, 'later');
});

test('an existing record whose link names a spec task requiring its code task reads as an unresolvable link an amendment leaves alone', t => {
  const f = fixture(t, [code('code'), specTask('spec', SPEC, { requires: ['code'] })]);
  f.store.update(actor, f.store.read().revision, 'fixture-legacy-link', state => {
    state.tasks[0].agreement.specReviewTaskId = 'spec';
  });
  assert.match(f.readiness('code').cause, /unresolvable link: "spec" names a spec task that requires this task/);
  f.act({ action: 'start-task', taskId: 'code' });
  f.act({ action: 'block', taskId: 'code', blocker: { kind: 'user-decision', reason: 'Link broken', recoveryAttempted: 'Inspected' } });
  f.act({ action: 'unblock', taskId: 'code', evidence: 'User decided' });
  assert.equal(f.task('spec').requirementsRevision, undefined);
  assert.equal(f.task('spec').status, 'pending');
});
