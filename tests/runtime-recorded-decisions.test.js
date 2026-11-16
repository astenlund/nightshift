'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { CLOSING_TARGET } = require('../internal/runtime/actions');
const { CLOSING_COVERAGE, assertAction, closingCoverageText, historicalDischarge, obligationBrief } = require('../internal/runtime/lifecycle');
const { snapshot } = require('../internal/runtime/evidence');
const { CODE_TASK, SPEC_PATH, SPEC_TASK, actor, closeOut, closingRun, completeCodeTask, completeSpecTask, git } = require('./fixtures/closing-run');
const { executeWithFixtureController } = require('./fixtures/controller-claim');
const { assertControllerClaim } = require('../internal/runtime/ownership');

const SCRATCH = 'recorded-decisions-tests';

// A run of only spec tasks, completed and triaged, so a later code edit raises the hold no task assessment can settle.
function specRun(t) {
  const f = closingRun(t, [SPEC_TASK], SCRATCH);
  completeSpecTask(f);
  closeOut(f);

  return f;
}

// Records the user's decision on the hold status currently reports, unless the request names its own condition.
function decide(f, overrides = {}) {
  const condition = overrides.condition ?? { kind: 'closing-hold', identity: f.hold().identity };

  return f.act({ action: 'record-decision', authority: 'User: "accept the code edit as it stands"', reason: 'The edit is the user\'s own', ...overrides, condition });
}

function refusal(work) {
  try {
    work();
  } catch (error) {
    return error;
  }

  return assert.fail('Expected a refusal');
}

function decisions(f) {
  return f.brief().userDecisions;
}

test('a decision settles the hold, reopens for a path whose content changes and stands through an unrelated change', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  assert.deepEqual(f.hold().changedPaths, ['src.js']);

  // Act
  decide(f);
  const settled = f.brief();
  f.write('other.js', 'module.exports = 3;\n');
  const unrelated = f.brief();
  f.write('src.js', 'module.exports = 4;\n');
  const reopened = f.brief();

  // Assert
  assert.equal(settled.closing.docsReview.outsideDocumentation, undefined);
  assert.deepEqual(settled.userDecisions.map(entry => [entry.state, entry.settledPaths, entry.settledCount]), [['applies', ['src.js'], 1]]);
  assert.deepEqual(unrelated.closing.docsReview.outsideDocumentation.changedPaths, ['other.js']);
  assert.equal(unrelated.userDecisions[0].state, 'applies');
  assert.deepEqual(reopened.closing.docsReview.outsideDocumentation.changedPaths, ['other.js', 'src.js']);
  assert.equal(reopened.userDecisions[0].state, 'lapsed');
});

test('a path an earlier decision recorded and that changed again joins the next decision\'s inputs and identity', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.write('src.js', 'module.exports = 3;\n');
  const identity = f.hold().identity;

  // Act
  decide(f);

  // Assert
  const recorded = f.store.read().userDecisions;
  assert.equal(recorded.length, 2);
  assert.deepEqual(recorded[1].inputs.files.map(file => file.path), ['src.js']);
  assert.equal(recorded[1].inputs.digest, identity);
  assert.deepEqual(decisions(f).map(entry => entry.state), ['lapsed', 'applies']);
  assert.equal(f.hold(), undefined);
});

test('decisions settle in part and combine, and a malformed decision fails closed without unsettling the others', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.write('other.js', 'module.exports = 3;\n');
  const partial = f.hold().changedPaths;

  // Act
  decide(f);
  f.store.update(actor, f.store.read().revision, 'fixture-malformed-decision', state => {
    state.userDecisions.push({ id: 'malformed', condition: { kind: 'closing-hold' }, inputs: { files: [{ path: 'src.js', sha256: 'f'.repeat(64) }], digest: 'not-the-digest' } });
  });

  // Assert
  assert.deepEqual(partial, ['other.js']);
  assert.equal(f.hold(), undefined);
  assert.deepEqual(decisions(f).map(entry => [entry.id === 'malformed' ? 'malformed' : 'recorded', entry.state]), [['recorded', 'applies'], ['recorded', 'applies'], ['malformed', 'structural-failure']]);
  assert.deepEqual(decisions(f)[2].settledPaths, []);
});

test('a decision over the whole set lapses once it settles no current path and applies again when the recorded content returns', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);

  // Act
  f.write('src.js', 'module.exports = 3;\n');
  const changed = decisions(f)[0].state;
  f.write('src.js', 'module.exports = 1;\n');
  const reverted = decisions(f)[0].state;
  f.write('src.js', 'module.exports = 2;\n');
  const returned = f.brief();

  // Assert
  assert.equal(changed, 'lapsed');
  assert.equal(reverted, 'lapsed');
  assert.equal(returned.userDecisions[0].state, 'applies');
  assert.equal(returned.closing.docsReview.outsideDocumentation, undefined);
});

test('the hold\'s way forward and complete refusal on a run of only spec tasks name record-decision and then the closing docs review', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');

  // Act
  const hold = f.hold();
  const refused = refusal(() => f.act({ action: 'complete' }));

  // Assert
  assert.match(hold.next, /record it with record-decision on condition kind closing-hold and the identity status reports for the hold, then a complete closing docs review \(task #closing\)/);
  assert.match(hold.next, /hold, stop or the administrative close/);
  assert.equal(typeof hold.identity, 'string');
  assert.equal(refused.code, 'closing-review-required');
  assert.match(refused.message, /until the user's recorded decision settles them or they are reverted: src\.js/);
  assert.doesNotMatch(refused.message, /fresh task assessment covers/);
});

test('once a decision settles every path, complete no longer refuses for the hold and satisfied reads true', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);

  // Act
  const unreviewed = refusal(() => f.act({ action: 'complete' }));
  f.review(CLOSING_TARGET, 'docs', []);
  const satisfied = f.brief().closing.docsReview.satisfied;
  const completed = obligationBrief(f.act({ action: 'complete' }));

  // Assert
  assert.equal(unreviewed.code, 'closing-review-required');
  assert.doesNotMatch(unreviewed.message, /src\.js/);
  assert.equal(satisfied, true);
  assert.equal(completed.status, 'complete');
  assert.deepEqual(completed.userDecisions.map(entry => [entry.state, entry.settledPaths]), [['applies', ['src.js']]]);
});

test('a re-recorded triage keeps the earlier baseline while a path is settled only by a decision', t => {
  // Arrange
  const f = specRun(t);
  const baseline = f.store.read().closing.docs.baseline.digest;
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  // A current closing review leaves the decision as the only reason to keep the baseline.
  f.review(CLOSING_TARGET, 'docs', []);
  const satisfied = f.brief().closing.docsReview.satisfied;

  // Act
  f.act({ action: 'triage', evidence: 'Follow-ups triaged again' });

  // Assert
  assert.equal(satisfied, true);
  assert.equal(f.store.read().closing.docs.baseline.digest, baseline);
  assert.equal(decisions(f)[0].state, 'applies');
  assert.equal(f.hold(), undefined);
});

test('a spec assessment settles an unsettled remainder whose paths are all its governing artifacts, and no decision is admitted for it', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.write(SPEC_PATH, '# Plan\n\nChanged after triage.\n');

  // Act
  const remainder = f.hold();
  const refused = refusal(() => decide(f, { condition: { kind: 'closing-hold', identity: 'anything' } }));
  f.review('plan', 'spec', ['plan'], { snapshot: snapshot(f.root, [SPEC_PATH]) });

  // Assert
  assert.deepEqual(remainder.changedPaths, [SPEC_PATH]);
  assert.equal(remainder.identity, undefined);
  assert.match(remainder.next, /fresh whole-spec assessment on spec task plan/);
  assert.equal(refused.code, 'not-settleable');
  assert.match(refused.message, /A task assessment can settle the closing hold/);
  assert.equal(f.hold(), undefined);
});

test('on a complete run, closing coverage and a closing review imported after completion honour a decision recorded before it', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.review(CLOSING_TARGET, 'docs', []);
  f.act({ action: 'complete' });

  // Act
  const coverage = f.brief().closing.docsReview.satisfied;
  f.review(CLOSING_TARGET, 'docs', []);

  // Assert
  assert.equal(coverage, true);
  assert.equal(f.store.read().closing.docs.reviews.length, 2);
});

test('the closing-scope check after completion matches a decision against the review\'s snapshot entry, not disk', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.review(CLOSING_TARGET, 'docs', []);
  f.act({ action: 'complete' });
  f.write('src.js', 'module.exports = 3;\n');
  const assessed = f.assessment('docs', []);
  f.write('src.js', 'module.exports = 2;\n');

  // Act
  const refused = refusal(() => f.act({ action: 'review', taskId: CLOSING_TARGET, review: assessed }));

  // Assert
  assert.equal(decisions(f)[0].state, 'applies');
  assert.equal(refused.code, 'closing-scope');
  assert.match(refused.message, /src\.js/);
});

test('record-decision refuses closed records and review contexts first, then malformed requests', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  const request = { action: 'record-decision', condition: { kind: 'other' } };
  const closed = { ...f.store.read(), status: 'closed' };
  const review = { ...f.store.read(), kind: 'review' };

  // Act
  const closedRefusal = refusal(() => assertAction(closed, request));
  const reviewRefusal = refusal(() => assertAction(review, request));
  const otherKind = refusal(() => decide(f, { condition: { kind: 'unusable-spec', identity: f.hold().identity } }));
  const missingIdentity = refusal(() => decide(f, { condition: { kind: 'closing-hold' } }));

  // Assert
  assert.equal(closedRefusal.code, 'run-closed');
  assert.equal(reviewRefusal.code, 'delivery-required');
  assert.equal(otherKind.code, 'invalid-request');
  assert.match(otherKind.message, /condition\.kind must be closing-hold/);
  assert.equal(missingIdentity.code, 'invalid-request');
  assert.match(missingIdentity.message, /condition\.identity/);
});

test('record-decision refuses no-condition on a completed delivery and with nothing unsettled', t => {
  // Arrange
  const quiet = specRun(t);
  const completed = specRun(t);
  completed.review(CLOSING_TARGET, 'docs', []);
  completed.act({ action: 'complete' });

  // Act
  const nothing = refusal(() => decide(quiet, { condition: { kind: 'closing-hold', identity: 'anything' } }));
  const done = refusal(() => decide(completed, { condition: { kind: 'closing-hold', identity: 'anything' } }));
  const malformedOnCompleted = refusal(() => decide(completed, { condition: { kind: 'closing-hold' } }));

  // Assert
  assert.equal(malformedOnCompleted.code, 'invalid-request');
  assert.equal(nothing.code, 'no-condition');
  assert.match(nothing.message, /No path of the closing hold is unsettled/);
  assert.equal(done.code, 'no-condition');
  assert.match(done.message, /completed delivery/);
});

test('record-decision refuses not-settleable for a hold a code assessment can settle and for one whose set cannot be computed', t => {
  // Arrange
  const coded = closingRun(t, [CODE_TASK], SCRATCH);
  completeCodeTask(coded);
  closeOut(coded);
  coded.write('src.js', 'module.exports = 2;\n');
  const uncomputable = specRun(t);
  uncomputable.store.update(actor, uncomputable.store.read().revision, 'fixture-unusable-baseline', state => { state.closing.docs.baseline.digest = 'damaged'; });

  // Act
  const settleable = refusal(() => decide(coded, { condition: { kind: 'closing-hold', identity: 'anything' } }));
  const unknown = refusal(() => decide(uncomputable, { condition: { kind: 'closing-hold', identity: 'anything' } }));

  // Assert
  assert.equal(coded.hold().identity, undefined);
  assert.equal(settleable.code, 'not-settleable');
  assert.match(settleable.message, /fresh code assessment on one of the tasks code/);
  assert.equal(unknown.code, 'not-settleable');
  assert.match(unknown.message, /cannot be established, and a recorded decision does not settle that/);
});

test('record-decision refuses condition-changed when an unsettled path changes between the status reading and the request', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  const identity = f.hold().identity;
  f.write('src.js', 'module.exports = 3;\n');

  // Act
  const refused = refusal(() => decide(f, { condition: { kind: 'closing-hold', identity } }));

  // Assert
  assert.equal(refused.code, 'condition-changed');
  assert.match(refused.message, /changed since status reported it/);
  assert.equal(f.store.read().userDecisions, undefined);
});

test('a decision over more than twenty paths records every path while status and refusals name twenty with a count of the rest', t => {
  // Arrange
  const f = specRun(t);
  const files = Array.from({ length: 25 }, (_, index) => `src/file-${String(index).padStart(2, '0')}.js`);
  for (const file of files) f.write(file, 'module.exports = 2;\n');
  const identity = f.hold().identity;
  f.write(files[0], 'module.exports = 3;\n');
  const changed = refusal(() => decide(f, { condition: { kind: 'closing-hold', identity } }));
  const completion = refusal(() => f.act({ action: 'complete' }));

  // Act
  decide(f);

  // Assert
  assert.match(changed.message, /and 5 more$/);
  assert.match(completion.message, /src\/file-19\.js and 5 more\./);
  assert.equal(f.store.read().userDecisions[0].inputs.files.length, 25);
  assert.equal(decisions(f)[0].settledPaths.length, 20);
  assert.equal(decisions(f)[0].settledCount, 25);
});

test('a stopped run records a decision from a session holding no controller claim', async t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  f.act({ action: 'stop', kind: 'user-stop', reason: 'User paused the run' });
  const identity = f.hold().identity;
  const unclaimed = { nativeOwner: () => null, ownerAlive: () => null };
  const request = { actor, revision: f.store.read().revision, condition: { kind: 'closing-hold', identity }, authority: 'User: "accept it"', reason: 'Accepted while paused' };

  // Act
  // The claim check itself, which a non-exempt action meets after the run-stopped refusal would otherwise end it.
  const claimRefusal = refusal(() => assertControllerClaim(f.store.read(), { ...request, action: 'start-task', taskId: 'plan' }, unclaimed));
  const exempt = assertControllerClaim(f.store.read(), { ...request, action: 'record-decision' }, unclaimed);
  const result = await executeWithFixtureController(f.root, { ...request, action: 'record-decision' }, unclaimed);

  // Assert
  assert.equal(claimRefusal.code, 'controller-claim-required');
  assert.equal(exempt, undefined);
  assert.equal(result.status, 'stopped');
  assert.deepEqual(result.userDecisions.map(entry => entry.state), ['applies']);
});

test('the no-baseline way forward on a run of only spec tasks names the user decision, adding that the baseline stands only for a valid Git baseline whose comparison fails', t => {
  // Arrange
  const valid = specRun(t);
  fs.rmSync(path.join(valid.root, 'src.js'));
  valid.write('src.js/inner.js', 'module.exports = 2;\n');
  const damaged = specRun(t);
  damaged.store.update(actor, damaged.store.read().revision, 'fixture-unusable-baseline', state => { state.closing.docs.baseline.digest = 'damaged'; });
  const missing = specRun(t);
  missing.store.update(actor, missing.store.read().revision, 'fixture-missing-baseline', state => { state.closing.docs.baseline = null; });
  const coded = closingRun(t, [CODE_TASK], SCRATCH);
  completeCodeTask(coded);
  closeOut(coded);
  coded.store.update(actor, coded.store.read().revision, 'fixture-unusable-baseline', state => { state.closing.docs.baseline.digest = 'damaged'; });
  const outsideGit = { backlogOnly: true, files: [], digest: 'x' };

  // Act
  const readings = [valid, damaged, missing].map(f => f.hold().next);
  const refused = refusal(() => valid.act({ action: 'complete' }));

  // Assert
  for (const next of readings) assert.match(next, /needs the user's decision: hold, stop or the administrative close/);
  assert.match(readings[0], /The recorded baseline stands until the comparison can be made\.$/);
  assert.doesNotMatch(readings[1], /stands until/);
  assert.doesNotMatch(readings[2], /stands until/);
  assert.match(refused.message, /stands until the comparison can be made/);
  assert.doesNotMatch(closingCoverageText(valid.store.read(), 'no-baseline', outsideGit), /stands until/);
  assert.equal(coded.hold().next, CLOSING_COVERAGE['no-baseline']);
});

test('userDecisions reads reconcile at acceptance, closed, and empty for a record without the field', t => {
  // Arrange
  const f = specRun(t);
  const empty = f.brief().userDecisions;
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);

  // Act
  const skipped = obligationBrief(f.store.read(), f.root, { verifyFreshness: false });
  const closed = obligationBrief({ ...f.store.read(), status: 'closed' });

  // Assert
  assert.deepEqual(empty, []);
  assert.deepEqual(skipped.userDecisions.map(entry => entry.state), ['reconcile at acceptance']);
  assert.equal(skipped.closing.docsReview.outsideDocumentation, 'reconcile at acceptance');
  assert.deepEqual(closed.userDecisions.map(entry => entry.state), ['closed']);
  assert.equal(closed.userDecisions[0].authority, 'User: "accept the code edit as it stands"');
});

test('a closing reset keeps the recorded decisions, which keep settling against the carried baseline', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  const recorded = f.store.read().userDecisions;

  const finding = { id: 'gap', severity: 'important', required: true, consequence: 'The plan omits a case', evidence: 'Compared with the agreement', surfaces: [], basis: [] };

  // Act
  f.review('plan', 'spec', ['plan'], { snapshot: snapshot(f.root, [SPEC_PATH, 'README.md']), findings: [finding] });

  // Assert
  assert.equal(f.store.read().closing.docs, undefined);
  assert.ok(f.store.read().closing.carriedBaseline);
  assert.deepEqual(f.store.read().userDecisions, recorded);
  assert.equal(decisions(f)[0].state, 'applies');
  assert.equal(f.brief().closing.outsideDocumentation, undefined);
});

test('the completion result carries an applying, a lapsed and a structurally failing decision', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.write('src.js', 'module.exports = 3;\n');
  decide(f);
  f.store.update(actor, f.store.read().revision, 'fixture-malformed-decision', state => { state.userDecisions.push({ id: 'malformed', condition: { kind: 'closing-hold' } }); });
  f.review(CLOSING_TARGET, 'docs', []);

  // Act
  const result = obligationBrief(f.act({ action: 'complete' }));

  // Assert
  assert.deepEqual(result.userDecisions.map(entry => entry.state), ['lapsed', 'applies', 'structural-failure']);
});

test('a run completed through a decision stays historically discharged', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.review(CLOSING_TARGET, 'docs', []);
  f.act({ action: 'complete' });

  // Act
  const discharged = historicalDischarge(f.store.read(), evidence => Boolean(evidence?.digest));

  // Assert
  assert.equal(discharged, true);
});

test('a nested repository added after triage leaves the set uncomputable, with no identity, and record-decision refuses not-settleable', t => {
  // Arrange
  const f = specRun(t);
  f.write('vendor/lib/index.js', 'module.exports = 2;\n');
  git(path.join(f.root, 'vendor/lib'), ['init', '--quiet']);

  // Act
  const hold = f.hold();
  const refused = refusal(() => decide(f, { condition: { kind: 'closing-hold', identity: 'anything' } }));

  // Assert
  assert.equal(hold.changedPaths, null);
  assert.equal(hold.identity, undefined);
  assert.match(hold.next, /needs the user's decision: hold, stop or the administrative close/);
  assert.equal(refused.code, 'not-settleable');
  assert.match(refused.message, /cannot be established, and a recorded decision does not settle that/);
});

for (const [shape, prepare, remove] of [
  ['deleted from the worktree only', () => {}, f => fs.rmSync(path.join(f.root, 'src.js'))],
  ['removed with git rm', () => {}, f => git(f.root, ['rm', '--quiet', 'src.js'])],
  ['deleted in a commit after triage', () => {}, f => {
    git(f.root, ['rm', '--quiet', 'src.js']);
    git(f.root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): delete src.js']);
  }],
  ['untracked at triage and deleted after it', f => f.write('extra.js', 'module.exports = 5;\n'), f => fs.rmSync(path.join(f.root, 'extra.js'))],
]) test(`a decided deletion of a file ${shape} stays settled for a closing review imported after completion`, t => {
  // Arrange
  const f = closingRun(t, [SPEC_TASK], SCRATCH);
  prepare(f);
  completeSpecTask(f);
  closeOut(f);
  remove(f);
  decide(f);
  f.review(CLOSING_TARGET, 'docs', []);
  f.act({ action: 'complete' });

  // Act
  f.review(CLOSING_TARGET, 'docs', []);

  // Assert
  assert.equal(decisions(f)[0].state, 'applies');
  assert.equal(f.store.read().closing.docs.reviews.length, 2);
});

test('a decided path that can no longer be read as a regular file reads structural-failure, not lapsed', t => {
  // Arrange
  const f = specRun(t);
  f.write('gen/out.js', 'module.exports = 1;\n');
  decide(f);

  // Act
  fs.rmSync(path.join(f.root, 'gen/out.js'));
  f.write('gen/out.js/inner.js', 'module.exports = 2;\n');
  const reading = decisions(f)[0];

  // Assert
  assert.equal(reading.state, 'structural-failure');
  assert.deepEqual(reading.settledPaths, []);
});

test('a hold whose paths cannot be read as regular files names their replacement, not record-decision, and the operation refuses with that way forward', t => {
  // Arrange
  const f = specRun(t);
  f.write('linked-a.js', 'module.exports = 1;\n');
  fs.linkSync(path.join(f.root, 'linked-a.js'), path.join(f.root, 'linked-b.js'));

  // Act
  const hold = f.hold();
  const completion = refusal(() => f.act({ action: 'complete' }));
  const refused = refusal(() => decide(f, { condition: { kind: 'closing-hold', identity: 'anything' } }));

  // Assert
  assert.ok(hold.changedPaths.length > 0);
  assert.equal(hold.identity, undefined);
  assert.doesNotMatch(hold.next, /record-decision/);
  assert.match(hold.next, /cannot be read as regular files/);
  assert.match(hold.next, /hold, stop or the administrative close/);
  assert.doesNotMatch(completion.message, /record-decision|recorded decision settles them/);
  assert.equal(refused.code, 'not-settleable');
  assert.match(refused.message, /cannot be read as regular files/);
  assert.match(refused.message, /hold, stop or the administrative close/);
});

test('a recorded decision carries the identity of the hold the user was briefed on', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  const identity = f.hold().identity;

  // Act
  decide(f);

  // Assert
  assert.deepEqual(f.store.read().userDecisions[0].condition, { kind: 'closing-hold', identity });
  assert.deepEqual(decisions(f)[0].condition, { kind: 'closing-hold', identity });
});

test('while the hold set cannot be computed a decision reads structural-failure, and applies again once it can', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.write('vendor/lib/index.js', 'module.exports = 1;\n');
  git(path.join(f.root, 'vendor/lib'), ['init', '--quiet']);

  // Act
  const uncomputable = decisions(f)[0];
  fs.rmSync(path.join(f.root, 'vendor'), { recursive: true, force: true });
  const restored = decisions(f)[0];

  // Assert
  assert.equal(uncomputable.state, 'structural-failure');
  assert.deepEqual(uncomputable.settledPaths, []);
  assert.equal(restored.state, 'applies');
});

test('a null entry reads structural-failure and leaves the other decisions applying', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  f.store.update(actor, f.store.read().revision, 'fixture-null-decision', state => { state.userDecisions.push(null); });

  // Act
  const reading = decisions(f);

  // Assert
  assert.deepEqual(reading.map(entry => entry.state), ['applies', 'structural-failure']);
  assert.equal(reading[1].id, null);
  assert.equal(f.hold(), undefined);
});

test('a userDecisions value that is not a list reads as one structural failure, settles nothing and refuses record-decision', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  const identity = f.hold().identity;
  f.store.update(actor, f.store.read().revision, 'fixture-unreadable-decisions', state => { state.userDecisions = { damaged: true }; });

  // Act
  const reading = decisions(f);
  const refused = refusal(() => decide(f, { condition: { kind: 'closing-hold', identity } }));

  // Assert
  assert.deepEqual(reading.map(entry => entry.state), ['structural-failure']);
  assert.deepEqual(f.hold().changedPaths, ['src.js']);
  assert.equal(refused.code, 'decisions-unreadable');
  assert.deepEqual(f.store.read().userDecisions, { damaged: true });
});

test('status writes nothing', t => {
  // Arrange
  const f = specRun(t);
  f.write('src.js', 'module.exports = 2;\n');
  decide(f);
  const before = f.store.read();
  const rows = f.store.history(before.id).length;

  // Act
  f.brief();

  // Assert
  assert.equal(f.store.read().revision, before.revision);
  assert.equal(f.store.history(before.id).length, rows);
});
