'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { applicability, differences, identity } = require('../internal/runtime/applicability');
const { inventorySnapshot, snapshot } = require('../internal/runtime/evidence');
const { validateReport } = require('../internal/runtime/review');

function fixture(t) {
  const parent = path.resolve(__dirname, '../.tmp/applicability-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = spawnSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true });
  assert.equal(git.status, 0);
  fs.writeFileSync(path.join(root, 'source.txt'), 'original source');
  fs.writeFileSync(path.join(root, 'context.txt'), 'original context');
  const tasks = ['first', 'second'].map(id => ({ id, agreement: { source: 'User', outcome: id } }));
  const commitments = Object.fromEntries(tasks.map(task => [task.id, { agreement: structuredClone(task.agreement), revision: 0 }]));
  const review = { requestId: 'original', kind: 'code', snapshot: inventorySnapshot(root, ['context.txt']), contextSnapshot: inventorySnapshot(root, ['context.txt']), commitments, coveredTaskIds: tasks.map(task => task.id) };
  const owner = { kind: 'code', reviews: [review] };
  const decide = (outcomes, overrides = {}) => {
    const decision = { requestId: 'decision', revision: owner.reviews.length + 1, relevance: { requestId: review.requestId, originalHash: identity(review), taskIds: Object.keys(outcomes) }, snapshot: inventorySnapshot(root, ['context.txt']), contextSnapshot: inventorySnapshot(root, ['context.txt']), commitments: structuredClone(commitments), attributionVerified: true, independent: true, strength: 'strong', status: 'complete', applicability: Object.entries(outcomes).map(([id, outcome]) => ({ id, outcome, evidence: 'Independently examined the change and interactions' })), ...overrides };
    owner.reviews.push(decision);
    return decision;
  };
  return { root, tasks, review, owner, decide, current: task => applicability(root, review, task ?? tasks[0], owner) };
}

test('scope preserves exclusions, detects inventory additions and removals, and rejects corrupt or unsafe evidence', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'context.txt'), 'excluded change');
  assert.equal(f.current().current, true);
  fs.writeFileSync(path.join(f.root, 'added.txt'), 'new file');
  assert.deepEqual(f.current().changedPaths, ['added.txt']);
  fs.unlinkSync(path.join(f.root, 'source.txt'));
  assert.deepEqual(f.current().changedPaths, ['added.txt', 'source.txt']);
  assert.equal(differences(f.root, { ...f.review.snapshot, digest: 'corrupt' }), null);
  fs.mkdirSync(path.join(f.root, 'source.txt'));
  assert.equal(f.current().status, 'structural-failure');
});

test('declared artifacts also depend on the context actually supplied to their assessment', t => {
  const f = fixture(t);
  f.review.snapshot = snapshot(f.root, ['source.txt']);
  f.review.contextSnapshot = inventorySnapshot(f.root);
  fs.writeFileSync(path.join(f.root, 'context.txt'), 'changed requirement context');
  assert.deepEqual(f.current().changedPaths, ['context.txt']);
  assert.equal(f.current().current, false);
});

test('shared decisions apply per task, exact later inputs and commitments, preserving superseded history', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'later source');
  f.decide({ first: 'preserve', second: 'unresolved' });
  assert.equal(f.current(f.tasks[0]).current, true);
  assert.equal(f.current(f.tasks[1]).current, false);
  f.decide({ second: 'reassess' }, { requestId: 'second-decision' });
  assert.equal(f.current(f.tasks[1]).status, 'reassess');
  f.decide({ second: 'preserve' }, { requestId: 'third-decision' });
  assert.equal(f.current(f.tasks[1]).current, true);
  f.tasks[1].agreement.outcome = 'new commitment';
  assert.equal(f.current(f.tasks[1]).current, false);
  assert.equal(f.current(f.tasks[1]).commitmentsChanged, true);
  assert.equal(f.owner.reviews.length, 4);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'another later source');
  assert.equal(f.current(f.tasks[0]).current, false);
});

test('relevance report validation refuses missing, duplicate, unsupported or evidence-free answers and closures', t => {
  const request = { id: 'request', kind: 'code', continues: { kind: 'resumed' }, relevance: { requestId: 'original', taskIds: ['first', 'second'], originalInputsAvailable: true } };
  const answer = id => ({ id, outcome: 'preserve', evidence: 'Concrete applicability evidence' });
  const report = { requestId: 'request', status: 'complete', toolFailure: '', summary: 'Independent decision', findings: [], coverage: [], closures: [], positions: [], probes: [], applicability: ['first', 'second'].map(answer) };
  assert.equal(validateReport(report, request), report);
  for (const answers of [[answer('first')], [answer('first'), answer('first')], [answer('first'), { ...answer('second'), outcome: 'unknown' }], [answer('first'), { ...answer('second'), evidence: '' }]]) {
    assert.throws(() => validateReport({ ...report, applicability: answers }, request));
  }
  assert.throws(() => validateReport({ ...report, closures: [{ id: 'finding', closed: true, evidence: 'Closed' }] }, request), { code: 'invalid-result' });
  assert.throws(() => validateReport(report, { ...request, relevance: { ...request.relevance, originalInputsAvailable: false } }), { code: 'missing-assessment-inputs' });
});

test('a malformed persisted decision cannot preserve applicability through string task bindings', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'later source');
  const decision = f.decide({ first: 'preserve' });
  decision.relevance.taskIds = 'first';
  assert.equal(f.current().status, 'structural-failure');
  assert.equal(f.current().current, false);
});

test('late applicability imports use dispatch order and cannot revive a superseded preserving answer', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'later source');
  const older = f.decide({ first: 'preserve' }, { requestId: 'older' });
  const newer = f.decide({ first: 'reassess' }, { requestId: 'newer' });
  f.owner.reviews = [f.review, newer, { ...older, revision: newer.revision + 1 }];
  const state = { workers: [{ id: 'older' }, { id: 'newer' }] };
  assert.equal(applicability(f.root, f.review, f.tasks[0], f.owner, state).status, 'reassess');
  assert.deepEqual(require('../internal/runtime/applicability').preservedSnapshots(f.review, f.owner, [f.tasks[0]], value => value, state), []);
});

test('conflicting duplicate decision identities fail closed', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'later source');
  const decision = f.decide({ first: 'preserve' });
  f.owner.reviews.push({ ...decision, applicability: [{ id: 'first', outcome: 'reassess', evidence: 'Conflicting persisted answer' }] });
  assert.equal(f.current().status, 'structural-failure');
  assert.equal(f.current().current, false);
});


test('review progress uses the same complete-set ordering when dispatch history is mixed', () => {
  const reviews = [
    { requestId: 'A', kind: 'code', revision: 10 },
    { requestId: 'B', kind: 'code', revision: 20 },
    { requestId: 'C', kind: 'code', revision: 15, continues: { kind: 'resumed' } },
  ];
  const task = { id: 'task', kind: 'code', reviews, findings: [], checks: [] };
  const state = { tasks: [task], workers: [{ id: 'B' }, { id: 'A' }] };
  assert.deepEqual(require('../internal/runtime/lifecycle').reviewProgress('', state, task).freshDue, []);
});


test('a spec assessment that omitted its configured governing artifact never supplies assurance', t => {
  const f = fixture(t);
  f.review.kind = 'spec';
  f.tasks[0].agreement.spec = 'source.txt';
  f.review.commitments.first.agreement.spec = 'source.txt';
  f.review.snapshot = snapshot(f.root, ['context.txt']);
  const current = f.current();
  assert.equal(current.current, false);
  assert.equal(current.status, 'structural-failure');
});

test('an absent-at-capture spec artifact cannot supply assurance for its continued absence', t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, 'source.txt'));
  f.review.kind = 'spec';
  f.tasks[0].agreement.spec = 'source.txt';
  f.review.commitments.first.agreement.spec = 'source.txt';
  f.review.snapshot = snapshot(f.root, ['source.txt']);
  assert.equal(f.current().current, false);
});

test('a newer preserving decision settles old negative history without approving subsequent changes', t => {
  // Arrange
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'candidate A');
  f.decide({ first: 'reassess' }, { requestId: 'negative' });
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'candidate B');
  f.decide({ first: 'preserve' }, { requestId: 'preserving' });
  assert.equal(f.current().status, 'applicable-by-decision');

  // Act
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'candidate C');

  // Assert
  assert.equal(f.current().status, 'pending');
  assert.equal(f.current().current, false);
  f.decide({ first: 'unresolved' }, { requestId: 'new-negative' });
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'candidate D');
  assert.equal(f.current().status, 'unresolved');
});

test('ambiguous decision ordering fails closed and a unique later successor can settle it', t => {
  // Arrange
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'changed');
  f.decide({ first: 'reassess' }, { requestId: 'one', revision: 10 });
  f.decide({ first: 'preserve' }, { requestId: 'two', revision: 10 });

  // Act and Assert
  assert.equal(f.current().status, 'conflicting-decisions');
  assert.equal(f.current().current, false);
  assert.deepEqual(require('../internal/runtime/applicability').preservedSnapshots(f.review, f.owner, [f.tasks[0]], value => value), []);
  f.decide({ first: 'preserve' }, { requestId: 'successor', revision: 11 });
  assert.equal(f.current().status, 'applicable-by-decision');
});

test('an exact-current negative decision outranks original inputs while exact original reversion can restore coverage', t => {
  // Arrange
  const current = fixture(t);
  current.decide({ first: 'reassess' });
  const reverted = fixture(t);
  fs.writeFileSync(path.join(reverted.root, 'source.txt'), 'edited');
  reverted.decide({ first: 'unresolved' });

  // Act
  fs.writeFileSync(path.join(reverted.root, 'source.txt'), 'original source');

  // Assert
  assert.equal(current.current().status, 'reassess');
  assert.equal(reverted.current().status, 'applicable');
});

test('comparison reuse is bounded to one evaluation and cannot hide subsequent file changes', t => {
  // Arrange
  const f = fixture(t);
  const { withEvidenceComparisons, changedPaths } = require('../internal/runtime/evidence');
  const originalRead = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function (file, ...args) {
    if (file === path.join(f.root, 'source.txt')) reads++;
    return originalRead.call(this, file, ...args);
  };
  t.after(() => { fs.readFileSync = originalRead; });

  // Act and Assert
  withEvidenceComparisons(() => {
    assert.deepEqual(changedPaths(f.root, f.review.snapshot), []);
    assert.deepEqual(changedPaths(f.root, structuredClone(f.review.snapshot)), []);
  });
  assert.equal(reads, 1);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'later');
  assert.deepEqual(withEvidenceComparisons(() => changedPaths(f.root, f.review.snapshot)), ['source.txt']);
});

test('private-copy integrity accepts directory casing aliases but refuses duplicate identities and additions', t => {
  // Arrange
  const f = fixture(t);
  const { privateInputsCurrent, hash } = require('../internal/runtime/evidence');
  const directory = path.join(f.root, 'Docs');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'a.md'), 'a');
  fs.writeFileSync(path.join(directory, 'b.md'), 'b');
  const inputs = inventorySnapshot(f.root);
  if (process.platform === 'win32') {
    const file = inputs.files.find(file => file.path === 'Docs/b.md');
    file.path = 'docs/b.md';
    inputs.digest = hash(JSON.stringify(inputs.files));
  }

  // Act and Assert
  assert.equal(privateInputsCurrent(f.root, inputs), false);
  // The fixture's .git directory is not part of a real private copy.
  fs.rmSync(path.join(f.root, '.git'), { recursive: true, force: true });
  assert.equal(privateInputsCurrent(f.root, inputs), true);
  const duplicate = structuredClone(inputs);
  duplicate.files.push({ ...duplicate.files.find(file => file.path === 'Docs/a.md') });
  duplicate.digest = hash(JSON.stringify(duplicate.files));
  assert.equal(privateInputsCurrent(f.root, duplicate), false);
  fs.writeFileSync(path.join(directory, 'added.md'), 'added');
  assert.equal(privateInputsCurrent(f.root, inputs), false);
});

test('missing legacy original worker metadata permits nonpreserving relevance answers', t => {
  // Arrange
  const f = fixture(t);
  const { resolveRelevance, validateRelevanceReport } = require('../internal/runtime/relevance');
  const state = { tasks: f.tasks, workers: [] };
  const requested = { requestId: f.review.requestId, taskIds: ['first'] };

  // Act and Assert
  for (const retainedInputs of [undefined, false, true]) {
    f.review.retainedInputs = retainedInputs;
    for (const worker of [null, { artifactDirectory: null }, { artifactDirectory: 17 }, { artifactDirectory: '../outside' }]) {
      state.workers = worker ? [{ id: f.review.requestId, ...worker }] : [];
      const relevance = resolveRelevance(f.root, state, f.owner, requested);
      assert.equal(relevance.originalInputsAvailable, false);
      assert.equal(relevance.source, null);
      assert.ok(relevance.originalInputsReason);
      for (const outcome of ['unresolved', 'reassess']) validateRelevanceReport({ status: 'complete', coverage: [], applicability: [{ id: 'first', outcome, evidence: 'Original source unavailable' }] }, { relevance });
      assert.throws(() => validateRelevanceReport({ status: 'complete', coverage: [], applicability: [{ id: 'first', outcome: 'preserve', evidence: 'Unsupported preservation' }] }, { relevance }), { code: 'missing-assessment-inputs' });
    }
  }
});

test('shared cached original source remains usable without its original worker registration', t => {
  // Arrange
  const f = fixture(t);
  const { resolveRelevance } = require('../internal/runtime/relevance');
  const source = path.join(f.root, '.tmp', 'original');
  fs.mkdirSync(source, { recursive: true });
  for (const file of f.review.contextSnapshot.files) {
    if (file.sha256 === null) continue;
    const target = path.join(source, file.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(f.root, file.path), target);
  }
  Object.assign(f.review, require('../internal/runtime/review-inputs').retain(f.root, source, f.review.contextSnapshot));
  assert.equal(f.review.retainedInputs.kind, 'cache-v1');

  // Act
  const relevance = resolveRelevance(f.root, { tasks: f.tasks, workers: [] }, f.owner, { requestId: f.review.requestId, taskIds: ['first'] });

  // Assert
  assert.equal(relevance.originalInputsAvailable, true);
  assert.equal(relevance.source, null);
  assert.equal(relevance.originalInputsReason, null);
});

test('registered legacy source remains available only while its private bytes match', t => {
  // Arrange
  const f = fixture(t);
  const { resolveRelevance } = require('../internal/runtime/relevance');
  const source = path.join(f.root, '.tmp/legacy/inputs');
  fs.mkdirSync(source, { recursive: true });
  for (const file of f.review.contextSnapshot.files) fs.copyFileSync(path.join(f.root, file.path), path.join(source, file.path));
  f.review.retainedInputs = true;
  const state = { tasks: f.tasks, workers: [{ id: f.review.requestId, artifactDirectory: '.tmp/legacy' }] };
  const requested = { requestId: f.review.requestId, taskIds: ['first'] };

  // Act and Assert
  assert.equal(resolveRelevance(f.root, state, f.owner, requested).originalInputsAvailable, true);
  fs.writeFileSync(path.join(source, 'source.txt'), 'Changed private input');
  const unavailable = resolveRelevance(f.root, state, f.owner, requested);
  assert.equal(unavailable.originalInputsAvailable, false);
  assert.equal(unavailable.source, null);
});

for (const outcome of ['preserve', 'reassess', 'unresolved']) {
  test('corrupt ' + outcome + ' decision evidence reports structural failure before original reversion', t => {
    // Arrange
    const f = fixture(t);
    const decision = f.decide({ first: outcome });
    decision.snapshot.digest = 'corrupt';

    // Act
    const result = f.current();

    // Assert
    assert.equal(result.status, 'structural-failure');
    assert.equal(result.current, false);
    assert.equal(result.changedPaths, null);
  });
}

test('decision comparison failures remain scoped and cannot be hidden by a later current answer', t => {
  // Arrange
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'later');
  const broken = f.decide({ first: 'preserve' }, { requestId: 'broken' });
  broken.contextSnapshot.digest = 'corrupt';
  f.decide({ first: 'preserve' }, { requestId: 'later-valid' });

  // Act and Assert
  assert.equal(f.current().status, 'structural-failure');
  assert.equal(f.current(f.tasks[1]).status, 'pending');
});

test('relevance report validation rejects malformed task bindings with a coded diagnosis', () => {
  // Arrange
  const { validateRelevanceReport } = require('../internal/runtime/relevance');
  const report = { status: 'complete', coverage: [], applicability: [{ id: 'task', outcome: 'unresolved', evidence: 'Missing input' }] };

  // Act and Assert
  for (const taskIds of [undefined, null, 'task', [], ['task', 'task'], [null], [' '], Array(1), ['task', ...Array(1)]]) {
    assert.throws(() => validateRelevanceReport(report, { relevance: { requestId: 'original', taskIds } }), { code: 'invalid-relevance' });
  }
});

test('historical preserved snapshots reject malformed task bindings without dereferencing them', t => {
  // Arrange
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'changed');
  const decision = f.decide({ first: 'preserve' });

  // Act and Assert
  for (const taskIds of [null, 17, 'first', [], ['first', 'first']]) {
    decision.relevance.taskIds = taskIds;
    assert.deepEqual(require('../internal/runtime/applicability').preservedSnapshots(f.review, f.owner, [f.tasks[0]], value => value), []);
  }
});

test('historical retained coverage requires the same unique decision selection as live coverage', t => {
  // Arrange
  const f = fixture(t);
  const { DIMENSIONS, commitmentsFor, historicalDischarge } = require('../internal/runtime/lifecycle');
  const task = f.tasks[0];
  Object.assign(task, { kind: 'lore', status: 'complete', checks: [], findings: [], requirementsRevision: 2 });
  Object.assign(f.review, { revision: 1, status: 'complete', strength: 'strong', independent: true, broad: true, coverageEvidence: 'Whole change', attributionVerified: true, dimensions: DIMENSIONS.code });
  task.agreement = { ...task.agreement, outcome: 'Amended accepted outcome' };
  task.reviews = f.owner.reviews;
  const preserving = f.decide({ first: 'preserve' }, { requestId: 'preserving', revision: 3, commitments: commitmentsFor([task]) });
  const state = { root: f.root, status: 'complete', tasks: [task], workers: [], closing: { retrospectiveEvidence: 'Recorded', triageEvidence: 'Recorded' } };
  assert.equal(historicalDischarge(state, () => true), true);
  const negative = { ...structuredClone(preserving), applicability: [{ id: 'first', outcome: 'reassess', evidence: 'Conflicting answer' }] };

  // Act and Assert
  for (const pair of [[preserving, negative], [negative, preserving]]) {
    task.reviews = [f.review, ...pair];
    assert.equal(historicalDischarge(state, () => true), false);
  }
  task.reviews = [f.review, preserving, { ...negative, requestId: 'tied' }];
  assert.equal(historicalDischarge(state, () => true), false);
});

test('missing declared spec inputs name restoration or revised-scope reassessment instead of relevance', t => {
  // Arrange
  const f = fixture(t);
  f.review.kind = 'spec';
  f.tasks[0].kind = 'spec';
  f.tasks[0].agreement.spec = 'source.txt';
  f.review.commitments.first.agreement = structuredClone(f.tasks[0].agreement);
  fs.unlinkSync(path.join(f.root, 'source.txt'));

  // Act
  const result = f.current();

  // Assert
  assert.equal(result.current, false);
  assert.deepEqual(result.missingPaths, ['source.txt']);
  assert.ok(result.next.includes('Restore'));
  assert.ok(result.next.includes('fresh assessment'));
  assert.equal(result.next.includes('resume or replace'), false);
  assert.throws(() => require('../internal/runtime/relevance').resolveRelevance(f.root, { tasks: f.tasks, workers: [] }, f.owner, { requestId: 'original', taskIds: ['first'] }), { code: 'missing-spec' });
});

test('missing spec diagnostics preserve a negative obligation and refresh after restoration', t => {
  // Arrange
  const f = fixture(t);
  const { commitmentsFor } = require('../internal/runtime/lifecycle');
  f.review.kind = 'spec';
  f.tasks[0].kind = 'spec';
  f.tasks[0].agreement.spec = 'source.txt';
  f.review.commitments.first.agreement = structuredClone(f.tasks[0].agreement);
  f.decide({ first: 'reassess' }, { kind: 'spec', commitments: commitmentsFor([f.tasks[0]]) });
  fs.unlinkSync(path.join(f.root, 'source.txt'));

  // Act and Assert
  const missing = f.current();
  assert.equal(missing.status, 'reassess');
  assert.equal(missing.current, false);
  assert.deepEqual(missing.missingPaths, ['source.txt']);
  fs.writeFileSync(path.join(f.root, 'source.txt'), 'original source');
  const restored = f.current();
  assert.equal(restored.status, 'reassess');
  assert.equal(restored.missingPaths, undefined);
});
