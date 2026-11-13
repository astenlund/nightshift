'use strict';

const { fixtureReport } = require('./fixtures/report');
const { fixtureContinuation } = require('./fixtures/continuation');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { CLOSING_TARGET } = require('../internal/runtime/actions');
const { DIMENSIONS, commitmentsFor, historicalDischarge, isDocumentationPath, obligationBrief, reviewProgress, transition } = require('../internal/runtime/lifecycle');
const { identity } = require('../internal/runtime/applicability');
const { inventorySnapshot, outsideGitWorktree, snapshot, verifyCommand } = require('../internal/runtime/evidence');
const { awaitWorker } = require('../internal/runtime/wait');
const { fixtureControllerClaim, executeWithFixtureController } = require('./fixtures/controller-claim');

const actor = { host: 'codex', session: 'controller' };
const BACKLOG = '.nightshift/BUGS.md';
// Prose a docs review does not cover alone, because it lies below the project root.
const NESTED_DOC = 'docs/guide.md';
const CODE_TASK = { id: 'code', title: 'Code change', agreement: { source: 'User', outcome: 'Accepted behavior' } };

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// A committed project with code, root and nested prose and backlog files, and a run over the given tasks.
function fixture(t, tasks = [CODE_TASK], options = {}) {
  const parent = path.resolve(__dirname, '../.tmp/docs-review-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  git(root, ['init', '--quiet']);
  write('src.js', 'module.exports = 1;\n');
  write('README.md', '# Project\n');
  write(NESTED_DOC, '# Guide\n');
  write(BACKLOG, '# Bugs\n');
  write('.nightshift/features/idea.md', '# Idea\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish docs review baseline']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({ mechanism: fixtureContinuation(), objective: 'Deliver accepted work', authority: 'User agreed the scope', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks, ...options });
  let sequence = 0;
  const act = request => {
    fixtureReport(store, actor, request);
    return store.update(actor, store.read().revision, request.action, state => transition(state, request));
  };
  const assessment = (kind, covered, findings = [], overrides = {}) => {
    sequence++;
    const coveredTasks = store.read().tasks.filter(task => covered.includes(task.id));
    const inputs = inventorySnapshot(root, [], coveredTasks.map(task => task.agreement.spec).filter(file => typeof file === 'string'));
    return { requestId: `${kind}-${sequence}`, kind, session: `${kind}-reviewer-${sequence}`, attributionVerified: true, status: 'complete', strength: 'strong', independent: true, broad: true, dimensions: [...DIMENSIONS[kind]], coverageEvidence: 'Assessed the complete change', coveredTaskIds: covered, commitments: commitmentsFor(coveredTasks), snapshot: inputs, contextSnapshot: inputs, findings, ...overrides };
  };
  const review = (taskId, kind, covered = [taskId], findings = [], overrides = {}) => act({ action: 'review', taskId, review: assessment(kind, covered, findings, overrides) });
  const check = (taskId, paths = ['src.js'], name = 'Fixture check') => act({ action: 'check', taskId, evidence: verifyCommand(root, { name, executable: process.execPath, args: ['--version'], paths }) });
  const confirm = (taskId, findingId, disposition = 'implement', classification = 'required', extra = {}) => {
    act({ action: 'validate', taskId, findingId, validation: { session: 'skeptic-' + findingId, attributionVerified: true, verdict: 'confirmed', evidence: 'Checked against the change', repairProposal: 'Correct the passage the finding names', snapshot: snapshot(root, ['src.js']) } });
    return act({ action: 'dispose', taskId, findingId, disposition, reason: 'Decided against the accepted scope', obligation: { classification, basis: 'The accepted outcome' }, ...extra });
  };
  const target = id => (id === CLOSING_TARGET ? store.read().closing.docs : store.read().tasks.find(task => task.id === id));
  // The reviewer that raised each repaired finding records its closure in a continued review of its own kind.
  const closeRepairs = (taskId, covered = [taskId]) => {
    const pending = target(taskId).findings.filter(item => item.pendingClosure);
    for (const lineage of new Set(pending.map(item => item.pendingClosure.lineage))) {
      const raised = target(taskId).reviews.find(item => (item.lineage ?? item.requestId) === lineage);
      const closures = pending.filter(item => item.pendingClosure.lineage === lineage).map(item => ({ id: item.id, closed: true, evidence: 'The repair resolves the finding' }));
      review(taskId, raised.kind, covered, [], { continues: { kind: 'resumed', requestId: lineage, session: raised.session }, lineage, session: raised.session, closures });
    }
  };
  const findingId = (localId, owner = 'code') => target(owner).findings.findLast(finding => finding.localId === localId).id;
  const task = (id = 'code') => store.read().tasks.find(item => item.id === id);
  return { root, baseSha, store, act, write, assessment, review, check, confirm, closeRepairs, findingId, task };
}

// Runs work with one environment variable set, restoring its previous value or absence afterwards.
function withEnvironment(name, value, work) {
  const saved = process.env[name];
  process.env[name] = value;
  try {
    return work();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

function finding(id, consequence = 'The documentation misstates the change') {
  return { id, severity: 'important', required: true, consequence, evidence: 'Concrete passage compared with the change', surfaces: [], basis: [] };
}

// Starts, verifies and code-reviews a code task up to its documentation stage.
function toDocumentation(f, id = 'code', checkPaths = ['src.js']) {
  f.act({ action: 'start-task', taskId: id });
  f.check(id, checkPaths);
  f.review(id, 'code');
  f.act({ action: 'advance', taskId: id });
  assert.equal(f.task(id).stage, 'documentation');
}

function completeTask(f, id = 'code', checkPaths) {
  toDocumentation(f, id, checkPaths);
  f.review(id, 'docs');
  f.act({ action: 'advance', taskId: id });
  f.act({ action: 'advance', taskId: id, evidence: 'Documentation reconciled' });
  assert.equal(f.task(id).status, 'complete');
}

function close(f) {
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
}

// A host agent returning a complete report with the given coverage, recorded as native Claude events.
function agent(calls, dimensions, findings = []) {
  return options => {
    calls.push(options);
    fs.mkdirSync(options.artifacts, { recursive: true });
    const request = JSON.parse(fs.readFileSync(path.join(options.artifacts, '..', 'request.json'), 'utf8'));
    // A lead report carries the closures and positions the schema requires, empty unless asked for; a skeptic's has neither.
    const report = { requestId: request.id, status: 'complete', coverage: dimensions.map(dimension => ({ dimension, evidence: 'Assessed the change' })), findings, probes: [], summary: 'Assessment complete', toolFailure: '', ...(request.kind === 'skeptic' ? {} : { closures: [], positions: [] }) };
    const session = `agent-session-${calls.length}`;
    const events = [{ type: 'assistant', session_id: session, message: { model: options.model, content: [] } }, { type: 'result', session_id: session, subtype: 'success', is_error: false, structured_output: report }];
    fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
    return { host: options.host, model: options.model, effort: options.effort, session, attributionVerified: true, status: 'complete', output: report, tokens: 0 };
  };
}

for (const [label, alter, expected] of [
  ['unchanged record whose current accounting row is lost', f => f.store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision=?').run(f.store.read().id, f.store.read().revision), null],
  ['record replaced under the same binding', f => f.store.update(actor, f.store.read().revision, 'fixture-closing-replacement', state => { state.closing.docs.occurrence = 'replacement-occurrence'; }), 'closing-origin-changed'],
  ['earlier record identified by its captured origin', f => f.store.update(actor, f.store.read().revision, 'fixture-earlier-record', state => { delete state.closing.docs.occurrence; delete state.workers.at(-1).closingOccurrence; }), null],
  ['earlier record whose worker captured no origin', f => f.store.update(actor, f.store.read().revision, 'fixture-earlier-record', state => { delete state.closing.docs.occurrence; delete state.workers.at(-1).closingOccurrence; state.workers.at(-1).progressOrigin = null; }), 'closing-origin-changed'],
]) test(`closing review import of the ${label}`, async t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  const run = (request, overrides) => executeWithFixtureController(f.root, { actor, revision: f.store.read().revision, ...request }, overrides);
  const review = { kind: 'docs', baseSha: f.baseSha, requirements: 'Tracking edits after triage', rules: 'Do not edit reviewed inputs.', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
  const dispatched = await run({ action: 'dispatch', taskId: CLOSING_TARGET, review }, { runAgent: agent([], DIMENSIONS.docs) });
  assert.equal(f.store.read().workers.at(-1).closingOccurrence, f.store.read().closing.docs.occurrence);
  alter(f);
  const reviews = f.store.read().closing.docs.reviews.length;
  const imported = run({ action: 'review', taskId: CLOSING_TARGET, receipt: path.relative(f.root, dispatched.receiptFile).split(path.sep).join('/') });
  if (expected) {
    await assert.rejects(imported, { code: expected });
    assert.equal(f.store.read().closing.docs.reviews.length, reviews);
  } else {
    await imported;
    assert.equal(f.store.read().closing.docs.reviews.length, reviews + 1);
  }
});

test('a closing review receives the closing record\'s own checks beside those of the tasks it covers', async t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.check(CLOSING_TARGET, [BACKLOG], 'Ready parser');
  const review = { kind: 'docs', baseSha: f.baseSha, requirements: 'Tracking edits after triage', rules: 'Do not edit reviewed inputs.', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };

  // Act
  const dispatched = await executeWithFixtureController(f.root, { actor, revision: f.store.read().revision, action: 'dispatch', taskId: CLOSING_TARGET, review }, { runAgent: agent([], DIMENSIONS.docs) });

  // Assert
  const checks = JSON.parse(fs.readFileSync(path.join(path.dirname(dispatched.receiptFile), 'request.json'), 'utf8')).checks;
  assert.deepEqual(checks.map(check => [check.taskIds, check.name]), [[[CLOSING_TARGET], 'Ready parser'], [['code'], 'Fixture check']]);
});

test('a task review receives the checks of its completed cumulative siblings and not of open ones', async t => {
  // Arrange
  const task = (id, title) => ({ id, title, agreement: { source: 'User', outcome: `${title} behavior` } });
  const f = fixture(t, [task('done', 'Completed'), task('open', 'Open'), task('current', 'Current')]);
  completeTask(f, 'done');
  f.check('open', ['src.js'], 'Open check');
  f.act({ action: 'start-task', taskId: 'current' });
  f.check('current', ['src.js'], 'Current check');
  const review = { kind: 'code', baseSha: f.baseSha, requirements: 'Current behavior', rules: 'Do not edit reviewed inputs.', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };

  // Act
  const dispatched = await executeWithFixtureController(f.root, { actor, revision: f.store.read().revision, action: 'dispatch', taskId: 'current', review }, { runAgent: agent([], DIMENSIONS.code) });

  // Assert
  const checks = JSON.parse(fs.readFileSync(path.join(path.dirname(dispatched.receiptFile), 'request.json'), 'utf8')).checks;
  assert.deepEqual(checks.map(check => [check.taskIds, check.name]), [[['current'], 'Current check'], [['done'], 'Fixture check']]);
});

test('a docs review is dispatched with the documentation lens, and its skeptic takes that lens', async t => {
  const f = fixture(t);
  const run = (request, overrides) => executeWithFixtureController(f.root, { actor, revision: f.store.read().revision, ...request }, overrides);
  const relative = result => path.relative(f.root, result.receiptFile).split(path.sep).join('/');
  const review = { baseSha: f.baseSha, requirements: 'Accepted behavior and its documentation', rules: 'Do not edit reviewed inputs.', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
  const calls = [];
  await run({ action: 'start-task', taskId: 'code' });
  f.check('code');
  await run({ action: 'review', taskId: 'code', receipt: relative(await run({ action: 'dispatch', taskId: 'code', review: { ...review, kind: 'code' } }, { runAgent: agent(calls, DIMENSIONS.code) })) });
  await run({ action: 'advance', taskId: 'code' });
  const docs = await run({ action: 'dispatch', taskId: 'code', review: { ...review, kind: 'docs' } }, { runAgent: agent(calls, DIMENSIONS.docs, [finding('claim')]) });
  assert.equal(docs.receipt.kind, 'docs');
  assert.deepEqual(docs.receipt.dimensions, DIMENSIONS.docs);
  assert.match(calls[1].prompt, /This is a documentation review/);
  assert.match(calls[1].prompt, /claim-accuracy: Does each changed or affected claim match/);
  assert.match(calls[1].prompt, /operating instructions/);
  assert.doesNotMatch(calls[1].prompt, /requirements-ux/);
  await run({ action: 'review', taskId: 'code', receipt: relative(docs) });
  const saved = f.task().findings.find(item => item.localId === 'claim');
  assert.equal(saved.reviewKind, 'docs');
  assert.equal(f.task().stage, 'review');
  const verdict = { id: saved.id, verdict: 'confirmed', evidence: 'Reproduced the misstatement', value: 'Worth correcting', repairProposal: 'Restate the claim from the changed code' };
  const skeptic = await run({ action: 'dispatch', taskId: 'code', review: { ...review, kind: 'skeptic', findings: [saved] } }, { runAgent: agent(calls, [], [verdict]) });
  assert.match(calls[2].prompt, /claim-accuracy/);
  assert.doesNotMatch(calls[2].prompt, /requirements-ux/);
  await run({ action: 'validate', taskId: 'code', receipt: relative(skeptic), findingId: saved.id });
  assert.equal(f.task().findings.find(item => item.id === saved.id).validation.verdict, 'confirmed');
});

test('a code task needs a current docs review to complete, and a backlog-only docs repair needs only a docs reassessment', t => {
  const f = fixture(t);
  toDocumentation(f);
  assert.throws(() => f.act({ action: 'advance', taskId: 'code', evidence: 'Documentation reconciled' }), { code: 'docs-review-required' });
  f.review('code', 'docs', ['code'], [finding('stale-entry')]);
  assert.equal(f.task().stage, 'review');
  assert.throws(() => f.act({ action: 'advance', taskId: 'code' }), { code: 'docs-review-required' });
  f.confirm('code', f.findingId('stale-entry'));
  f.write(BACKLOG, '# Bugs\n\nCorrected entry.\n');
  f.act({ action: 'repair', taskId: 'code', findingIds: [f.findingId('stale-entry')] });
  // The backlog edit leaves the code assessment current, so only the stale docs review holds the task.
  assert.throws(() => f.act({ action: 'advance', taskId: 'code' }), { code: 'docs-review-required' });
  f.closeRepairs('code');
  f.review('code', 'docs');
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documentation reconciled' });
  assert.equal(f.task().status, 'complete');
  assert.equal(f.task().reviews.filter(review => review.kind === 'code').length, 1);
});

test('a docs repair outside the documentation a docs review covers needs code reassessment, and a code repair needs a fresh docs review too', t => {
  const f = fixture(t);
  toDocumentation(f);
  f.review('code', 'docs', ['code'], [finding('guide')]);
  f.confirm('code', f.findingId('guide'));
  f.write(NESTED_DOC, '# Guide\n\nThe new option.\n');
  f.act({ action: 'repair', taskId: 'code', findingIds: [f.findingId('guide')] });
  f.closeRepairs('code');
  f.review('code', 'docs');
  assert.throws(() => f.act({ action: 'advance', taskId: 'code' }), { code: 'review-required', message: /latest assessment is stale/ });
  f.review('code', 'code', ['code'], [finding('logic', 'The code mishandles the boundary')]);
  f.confirm('code', f.findingId('logic'));
  f.write('src.js', 'module.exports = 2;\n');
  f.act({ action: 'repair', taskId: 'code', findingIds: [f.findingId('logic')] });
  f.check('code');
  f.closeRepairs('code');
  f.review('code', 'code');
  assert.throws(() => f.act({ action: 'advance', taskId: 'code' }), { code: 'docs-review-required', message: /latest docs review is stale/ });
  f.review('code', 'docs');
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documentation reconciled' });
  assert.equal(f.task().status, 'complete');
});

test('documentation a docs review alone covers is the backlog, reports and root Markdown other than host instruction files', () => {
  const covered = ['.nightshift/BUGS.md', '.nightshift/QUICK_WINS_HISTORY.md', '.nightshift/features/idea.md', '.nightshift/patterns/shared.md', '.nightshift/reports/acceptance.md', '.nightshift/reports/campaign/evidence.json', 'README.md', 'CHANGELOG.md', 'VISION.md', 'notes.MD'];
  const uncovered = ['AGENTS.md', 'agents.md', 'AGENTS.override.md', 'CLAUDE.md', 'Claude.md', 'CLAUDE.local.md', '.nightshift/specs/plan.md', '.nightshift/MIGRATION_STATUS.md', '.nightshift/runs/reports/morning.md', NESTED_DOC, 'skills/ready/SKILL.md', 'internal/workflow.md', 'README.txt', 'src.js'];
  for (const file of covered) assert.equal(isDocumentationPath(file), true, file);
  for (const file of uncovered) assert.equal(isDocumentationPath(file), false, file);
});

test('root Markdown and report edits after the code assessment need only the docs review', t => {
  const f = fixture(t);
  toDocumentation(f);
  f.write('README.md', '# Project\n\nDescribes the change.\n');
  f.write('.nightshift/reports/acceptance.md', '# Acceptance\n');
  f.review('code', 'docs');
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documentation reconciled' });
  assert.equal(f.task().status, 'complete');
  assert.equal(f.task().reviews.filter(review => review.kind === 'code').length, 1);
});

test('specs, host instruction files, operating instructions and nested prose stay under code reassessment', t => {
  for (const file of ['.nightshift/specs/plan.md', 'AGENTS.md', 'Claude.md', 'CLAUDE.local.md', 'AGENTS.override.md', 'skills/demo/SKILL.md', NESTED_DOC, 'notes.txt']) {
    const f = fixture(t);
    toDocumentation(f);
    f.write(file, '# Edited after the code assessment\n');
    f.review('code', 'docs');
    assert.throws(() => f.act({ action: 'advance', taskId: 'code' }), { code: 'review-required', message: /latest assessment is stale/ }, file);
  }
});

test('a covering docs review from a later task keeps an earlier completed task current', t => {
  const f = fixture(t, [{ ...CODE_TASK, id: 'first' }, { ...CODE_TASK, id: 'second', requires: ['first'] }]);
  completeTask(f, 'first', ['README.md']);
  f.act({ action: 'start-task', taskId: 'second' });
  f.write('src.js', 'module.exports = 3;\n');
  f.check('second');
  f.review('second', 'code', ['first', 'second']);
  f.act({ action: 'advance', taskId: 'second' });
  f.review('second', 'docs', ['first', 'second']);
  f.act({ action: 'advance', taskId: 'second' });
  f.act({ action: 'advance', taskId: 'second', evidence: 'Documentation reconciled' });
  close(f);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('a mechanical exemption stands in only while its content is unchanged, and reopening clears it', t => {
  const f = fixture(t, [{ id: 'docs', title: 'Version bump', kind: 'docs', agreement: { source: 'User', outcome: 'Bump the version' } }]);
  assert.throws(() => f.act({ action: 'advance', taskId: 'docs', evidence: 'Bumped' }), { code: 'docs-review-required' });
  f.act({ action: 'advance', taskId: 'docs', evidence: 'Bumped', docsExemption: 'Only the version string changed' });
  assert.equal(f.task('docs').status, 'complete');
  const listed = () => obligationBrief(f.store.read()).docsExemptions;
  assert.deepEqual(listed(), [{ taskId: 'docs', reason: 'Only the version string changed', revision: f.task('docs').docsExemption.revision, current: true }]);
  close(f);
  f.write('README.md', '# Project\n\nA judgment edit.\n');
  assert.equal(listed()[0].current, false);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required' });
  f.write('README.md', '# Project\n');
  assert.equal(listed()[0].current, true);
  f.act({ action: 'block', taskId: 'docs', blocker: { kind: 'capability', reason: 'Reopened for a fixture', recoveryAttempted: 'None needed' } });
  assert.equal(f.task('docs').docsExemption, undefined);
  assert.equal(f.task('docs').status, 'active');
});

test('a reopened completed task completes again only through its docs gate, and run completion names a task that lacks one', t => {
  const exempt = fixture(t, [{ id: 'docs', title: 'Version bump', kind: 'docs', agreement: { source: 'User', outcome: 'Bump the version' } }]);
  exempt.act({ action: 'advance', taskId: 'docs', evidence: 'Bumped', docsExemption: 'Only the version string changed' });
  exempt.write('README.md', '# Project\n\nA judgment edit.\n');
  exempt.review('docs', 'code');
  assert.equal(exempt.task('docs').docsExemption, undefined);
  assert.throws(() => exempt.act({ action: 'advance', taskId: 'docs' }), { code: 'docs-review-required' });
  exempt.review('docs', 'docs');
  exempt.act({ action: 'advance', taskId: 'docs' });
  assert.equal(exempt.task('docs').status, 'complete');

  // A task whose gate was met by another task's covering docs review is held the same way once that review is stale.
  const covered = fixture(t, [{ ...CODE_TASK, id: 'first' }, { ...CODE_TASK, id: 'second' }]);
  toDocumentation(covered, 'first');
  toDocumentation(covered, 'second');
  covered.review('second', 'docs', ['first', 'second']);
  covered.act({ action: 'advance', taskId: 'second' });
  for (const id of ['first', 'second']) covered.act({ action: 'advance', taskId: id, evidence: 'Documentation reconciled' });
  assert.equal(covered.task('first').reviews.some(review => review.kind === 'docs'), false);
  covered.write('src.js', 'module.exports = 4;\n');
  covered.check('first');
  covered.review('first', 'code', ['first']);
  assert.throws(() => covered.act({ action: 'advance', taskId: 'first' }), { code: 'docs-review-required', message: /latest docs review is stale/ });
  covered.review('first', 'docs', ['first']);
  covered.act({ action: 'advance', taskId: 'first' });
  assert.equal(covered.task('first').status, 'complete');

  // A completed task can still lose its gate through recorded state; the run-completion refusal then names it.
  exempt.store.update(actor, exempt.store.read().revision, 'fixture-drop-docs-review', state => { state.tasks[0].reviews = state.tasks[0].reviews.filter(review => review.kind !== 'docs'); });
  close(exempt);
  assert.throws(() => exempt.act({ action: 'complete' }), { code: 'docs-review-required', message: /Missing for: docs: unmet assurance$/ });
});

test('repair and a changed agreement clear a mechanical exemption', t => {
  const f = fixture(t, [{ id: 'docs', title: 'Skill wording', kind: 'docs', agreement: { source: 'User', outcome: 'Reword the skill' } }]);
  f.review('docs', 'code', ['docs'], [finding('wording', 'The skill wording changes behavior')]);
  f.confirm('docs', f.findingId('wording', 'docs'));
  f.write('README.md', '# Project\n\nReworded.\n');
  f.act({ action: 'repair', taskId: 'docs', findingIds: [f.findingId('wording', 'docs')] });
  f.closeRepairs('docs');
  f.review('docs', 'code');
  f.act({ action: 'advance', taskId: 'docs' });
  f.act({ action: 'advance', taskId: 'docs', evidence: 'Reworded', docsExemption: 'Fixture treats the rewording as mechanical' });
  assert.ok(f.task('docs').docsExemption);
  f.act({ action: 'repair', taskId: 'docs', findingIds: [f.findingId('wording', 'docs')] });
  assert.equal(f.task('docs').docsExemption, undefined);
  assert.equal(f.task('docs').status, 'active');

  // An exemption can only be recorded as a task completes, so the changed-agreement branch is reached through fixture state.
  f.act({ action: 'block', taskId: 'docs', blocker: { kind: 'user-decision', reason: 'User changes the outcome', recoveryAttempted: 'Asked the user' } });
  f.store.update(actor, f.store.read().revision, 'fixture-exemption', state => { state.tasks[0].docsExemption = { reason: 'Recorded earlier', snapshot: inventorySnapshot(f.root), revision: state.revision }; });
  const before = f.task('docs').requirementsRevision ?? -1;
  f.act({ action: 'unblock', taskId: 'docs', evidence: 'User: reword the other section instead', updatedOutcome: 'Reword the other section' });
  assert.equal(f.task('docs').docsExemption, undefined);
  assert.ok(f.task('docs').requirementsRevision > before);
});

test('a docs task that imported a code assessment keeps it current through a backlog edit its docs review covers', t => {
  const f = fixture(t, [{ id: 'docs', title: 'Guide and skill', kind: 'docs', agreement: { source: 'User', outcome: 'Reconcile the guide and the skill' } }]);
  f.review('docs', 'code');
  f.act({ action: 'advance', taskId: 'docs' });
  f.write(BACKLOG, '# Bugs\n\nArchived entry.\n');
  assert.throws(() => f.act({ action: 'advance', taskId: 'docs', evidence: 'Reconciled' }), { code: 'docs-review-required' });
  f.review('docs', 'docs');
  f.act({ action: 'advance', taskId: 'docs' });
  f.act({ action: 'advance', taskId: 'docs', evidence: 'Reconciled' });
  assert.equal(f.task('docs').status, 'complete');
  assert.equal(f.task('docs').reviews.filter(review => review.kind === 'code').length, 1);
});

test('only code and docs tasks of a run with the docs gate record an exemption, and an ungated run keeps its earlier completion', t => {
  const f = fixture(t, [{ id: 'lessons', title: 'Lore', kind: 'lore', agreement: { source: 'User', outcome: 'Retrospective' } }]);
  assert.throws(() => f.act({ action: 'advance', taskId: 'lessons', evidence: 'Done', docsExemption: 'Not applicable' }), { code: 'invalid-exemption' });
  const legacy = fixture(t, [CODE_TASK], { docsGate: false });
  toDocumentation(legacy);
  assert.throws(() => legacy.act({ action: 'advance', taskId: 'code', evidence: 'Documented', docsExemption: 'Mechanical' }), { code: 'invalid-exemption' });
  legacy.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
  close(legacy);
  assert.equal(legacy.act({ action: 'complete' }).status, 'complete');
});

test('backlog edits after triage need a closing docs review, which keeps closing evidence and completed tasks', t => {
  const f = fixture(t);
  completeTask(f);
  const closingReview = () => f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code']) });
  assert.throws(closingReview, { code: 'closing-review-unavailable' });
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  assert.throws(closingReview, { code: 'closing-review-unavailable' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  const before = f.store.read().closing;
  assert.ok(before.docs.baseline);
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required' });
  closingReview();
  const after = f.store.read();
  assert.equal(after.closing.retrospectiveEvidence, before.retrospectiveEvidence);
  assert.equal(after.closing.triageEvidence, before.triageEvidence);
  assert.equal(after.tasks[0].status, 'complete');
  assert.equal(obligationBrief(after).closing.docsReview.current, true);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('closing findings are validated, repaired and reassessed on the record without reopening tasks', t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code'], [finding('date-order')]) });
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-unresolved' });
  f.confirm(CLOSING_TARGET, f.findingId('date-order', CLOSING_TARGET));
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up, dated correctly.\n');
  f.act({ action: 'repair', taskId: CLOSING_TARGET, findingIds: [f.findingId('date-order', CLOSING_TARGET)] });
  assert.equal(f.task().status, 'complete');
  assert.ok(f.store.read().closing.triageEvidence);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-unresolved' });
  f.closeRepairs(CLOSING_TARGET, ['code']);
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code']) });
  assert.throws(() => f.act({ action: 'advance', taskId: CLOSING_TARGET }), { code: 'invalid-closing-action' });
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('an incomplete closing review neither completes the run nor reads as current', t => {
  const f = fixture(t, [{ id: 'docs', title: 'Version bump', kind: 'docs', agreement: { source: 'User', outcome: 'Bump the version' } }]);
  f.act({ action: 'advance', taskId: 'docs', evidence: 'Bumped', docsExemption: 'Only the version string changed' });
  close(f);
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['docs'], [], { status: 'incomplete', broad: false, dimensions: [], coverageEvidence: '' }) });
  assert.equal(obligationBrief(f.store.read()).closing.docsReview.current, false);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-unresolved', message: /not a complete strong docs assessment/ });
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['docs']) });
  assert.equal(obligationBrief(f.store.read()).closing.docsReview.current, true);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('a closing review imports a change outside the documentation paths, which then holds completion unless the user excluded it', t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  f.write(NESTED_DOC, '# Guide\n\nUser work in progress.\n');
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code']) });
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required', message: /docs\/guide\.md/ });
  const excluded = inventorySnapshot(f.root, [NESTED_DOC]);
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code'], [], { snapshot: excluded, contextSnapshot: excluded }) });
  // The record covers the tracking edits; the task's own gate still sees the change outside the documentation it covers.
  assert.throws(() => f.act({ action: 'complete' }), { code: 'stale-review' });
});

test('a closing review covers report and root Markdown edits made after triage', t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Bugs\n\nArchived entry.\n');
  f.write('.nightshift/reports/acceptance.md', '# Acceptance\n\nLink to the archived entry.\n');
  f.write('README.md', '# Project\n\nLink to the archived entry.\n');
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required' });
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code']) });
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('re-recorded triage starts a new closing record and a retrospective clears it', t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code']) });
  const first = f.store.read().closing.docs;
  f.act({ action: 'triage', evidence: 'A later answer triaged' });
  const second = f.store.read().closing.docs;
  assert.equal(second.reviews.length, 0);
  assert.notEqual(second.baseline.digest, first.baseline.digest);
  f.act({ action: 'retrospective', evidence: 'A new retrospective' });
  assert.equal(f.store.read().closing.docs, undefined);
});

test('recording triage again keeps a baseline whose changes lack review, even after a retrospective clears the record', t => {
  const lore = [{ id: 'lessons', title: 'Retrospective', kind: 'lore', agreement: { source: 'User', outcome: 'Reflect and triage follow-ups without an instruction proposal' } }];
  const run = () => {
    const f = fixture(t, lore);
    f.act({ action: 'advance', taskId: 'lessons', evidence: 'Retrospective completed; no instruction proposal' });
    f.act({ action: 'triage', evidence: 'User chose to track the follow-up in the backlog' });
    f.write(BACKLOG, '# Bugs\n\nUnreviewed tracking edit.\n');
    return { f, baseline: f.store.read().closing.docs.baseline.digest };
  };

  const { f: retriaged, baseline } = run();
  retriaged.act({ action: 'triage', evidence: 'A later follow-up triaged' });
  assert.equal(retriaged.store.read().closing.docs.baseline.digest, baseline);
  assert.throws(() => retriaged.act({ action: 'complete' }), { code: 'closing-review-required' });
  retriaged.act({ action: 'review', taskId: CLOSING_TARGET, review: retriaged.assessment('docs', ['lessons']) });
  // Once a closing review has seen the edits, triage recorded again moves the baseline forward.
  retriaged.act({ action: 'triage', evidence: 'Another follow-up triaged' });
  assert.notEqual(retriaged.store.read().closing.docs.baseline.digest, baseline);
  assert.equal(retriaged.act({ action: 'complete' }).status, 'complete');

  const { f: reset, baseline: resetBaseline } = run();
  reset.act({ action: 'retrospective', evidence: 'A new retrospective' });
  assert.equal(reset.store.read().closing.docs, undefined);
  reset.act({ action: 'triage', evidence: 'Follow-ups triaged again' });
  assert.equal(reset.store.read().closing.docs.baseline.digest, resetBaseline);
  assert.equal(reset.store.read().closing.carriedBaseline, undefined);
  assert.throws(() => reset.act({ action: 'complete' }), { code: 'closing-review-required' });
  reset.act({ action: 'review', taskId: CLOSING_TARGET, review: reset.assessment('docs', ['lessons']) });
  assert.equal(reset.act({ action: 'complete' }).status, 'complete');

  // A change outside the documentation paths takes a closing review but holds the baseline until a fresh task assessment settles it.
  const { f: assessed, baseline: assessedBaseline } = run();
  assessed.write('src.js', 'module.exports = 2;\n');
  assessed.act({ action: 'review', taskId: CLOSING_TARGET, review: assessed.assessment('docs', ['lessons']) });
  assessed.act({ action: 'triage', evidence: 'Follow-ups triaged before the assessment' });
  assert.equal(assessed.store.read().closing.docs.baseline.digest, assessedBaseline);
  assessed.review('lessons', 'code');
  assert.equal(assessed.task('lessons').status, 'complete');
  assessed.act({ action: 'review', taskId: CLOSING_TARGET, review: assessed.assessment('docs', ['lessons']) });
  assessed.act({ action: 'triage', evidence: 'Follow-ups triaged after the assessment' });
  assert.notEqual(assessed.store.read().closing.docs.baseline.digest, assessedBaseline);
  assert.equal(assessed.act({ action: 'complete' }).status, 'complete');
});

test('lore code assessments ignore backlog edits after triage, while spec assessments compare their deciding inputs', t => {
  const f = fixture(t, [CODE_TASK, { id: 'lessons', title: 'Lore', kind: 'lore', agreement: { source: 'User', outcome: 'Assessed instruction proposal' } }]);
  completeTask(f);
  f.review('lessons', 'code');
  f.act({ action: 'advance', taskId: 'lessons' });
  f.act({ action: 'advance', taskId: 'lessons', evidence: 'Proposal assessed; no instruction applied' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code']) });
  assert.equal(obligationBrief(f.store.read()).assessmentApplicability.find(item => item.taskId === 'lessons' && item.kind === 'code').status, 'applicable');
  assert.equal(f.act({ action: 'complete' }).status, 'complete');

  const specPath = '.nightshift/features/idea.md';
  const s = fixture(t, [{ id: 'plan', title: 'Standalone spec', kind: 'spec', agreement: { source: 'User', outcome: 'Assessed plan', spec: specPath } }]);
  s.review('plan', 'spec', ['plan'], [], { snapshot: snapshot(s.root, [specPath]) });
  s.act({ action: 'advance', taskId: 'plan' });
  s.act({ action: 'advance', taskId: 'plan', evidence: 'Spec documented' });
  close(s);
  s.write(specPath, '# Idea\n\nChanged commitments.\n');
  s.act({ action: 'review', taskId: CLOSING_TARGET, review: s.assessment('docs', []) });
  assert.throws(() => s.act({ action: 'complete' }), { code: 'stale-review' });
});

test('tracking edits need a current closing review even when no task gate depends on it', t => {
  const lore = [{ id: 'lessons', title: 'Retrospective', kind: 'lore', agreement: { source: 'User', outcome: 'Reflect and triage follow-ups without an instruction proposal' } }];
  const run = () => {
    const f = fixture(t, lore);
    f.act({ action: 'advance', taskId: 'lessons', evidence: 'Retrospective completed; no instruction proposal' });
    f.act({ action: 'triage', evidence: 'User chose to track the follow-up in the backlog' });
    return f;
  };
  const unchanged = run();
  assert.equal(obligationBrief(unchanged.store.read()).closing.docsReview.satisfied, true);
  assert.equal(unchanged.act({ action: 'complete' }).status, 'complete');

  const tracked = run();
  tracked.write(BACKLOG, '# Bugs\n\nFirst tracking edit.\n');
  assert.equal(obligationBrief(tracked.store.read()).closing.docsReview.satisfied, false);
  assert.throws(() => tracked.act({ action: 'complete' }), { code: 'closing-review-required' });
  tracked.act({ action: 'review', taskId: CLOSING_TARGET, review: tracked.assessment('docs', ['lessons']) });
  tracked.write(BACKLOG, '# Bugs\n\nLatest tracking edit, not yet reviewed.\n');
  assert.throws(() => tracked.act({ action: 'complete' }), { code: 'closing-review-required' });
  tracked.act({ action: 'review', taskId: CLOSING_TARGET, review: tracked.assessment('docs', ['lessons']) });
  assert.equal(tracked.act({ action: 'complete' }).status, 'complete');

  // A baseline that could not be captured inside a Git worktree fails closed: triage recorded again keeps it missing until a fresh
  // task assessment of the whole inventory covers the changes, which a lore task can import for its change.
  const lost = run();
  lost.store.update(actor, lost.store.read().revision, 'fixture-lost-baseline', state => { state.closing.docs.baseline = null; });
  assert.throws(() => lost.act({ action: 'complete' }), { code: 'closing-review-required' });
  lost.act({ action: 'triage', evidence: 'Triage recorded again' });
  assert.equal(lost.store.read().closing.docs.baseline, null);
  assert.throws(() => lost.act({ action: 'complete' }), { code: 'closing-review-required', message: /fresh code assessment of the whole inventory/ });
  lost.review('lessons', 'code');
  assert.equal(lost.task('lessons').status, 'complete');
  lost.act({ action: 'triage', evidence: 'Triage recorded after the assessment' });
  assert.ok(lost.store.read().closing.docs.baseline);
  assert.equal(lost.act({ action: 'complete' }).status, 'complete');
});

test('only a project with no .git entry on its discovery path and no Git redirection counts as outside Git', t => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nightshift-discovery-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const directory = (...parts) => {
    const target = path.join(parent, ...parts);
    fs.mkdirSync(target, { recursive: true });
    return target;
  };
  const genuine = directory('genuine');
  fs.mkdirSync(path.join(directory('empty-git'), '.git'));
  fs.writeFileSync(path.join(directory('broken-pointer'), '.git'), 'gitdir: missing-git-directory\n');
  fs.mkdirSync(path.join(directory('broken-ancestor'), '.git'));
  const nested = directory('broken-ancestor', 'child');
  withEnvironment('GIT_CEILING_DIRECTORIES', parent, () => {
    assert.equal(outsideGitWorktree(genuine), true);
    for (const name of ['empty-git', 'broken-pointer']) assert.equal(outsideGitWorktree(path.join(parent, name)), false, name);
    assert.equal(outsideGitWorktree(nested), false);
    withEnvironment('GIT_DIR', path.join(genuine, 'missing-git-directory'), () => assert.equal(outsideGitWorktree(genuine), false));
  });
});

test('a Git failure never waives closing coverage, and outside Git any documentation change after triage refuses completion', t => {
  const lore = [{ id: 'lessons', title: 'Retrospective', kind: 'lore', agreement: { source: 'User', outcome: 'Reflect without an instruction proposal' } }];
  const broken = fixture(t, lore);
  broken.act({ action: 'advance', taskId: 'lessons', evidence: 'Retrospective completed' });
  withEnvironment('GIT_CONFIG_COUNT', 'invalid-count', () => {
    broken.act({ action: 'triage', evidence: 'Follow-ups triaged' });
    broken.write(BACKLOG, '# Bugs\n\nUnreviewed tracking edit.\n');
    assert.equal(broken.store.read().closing.docs.baseline, null);
    assert.throws(() => broken.act({ action: 'complete' }), { code: 'closing-review-required' });
  });

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nightshift-outside-'));
  const stores = [];
  // One hook, because the stores must close before their folder can be removed.
  t.after(() => {
    for (const store of stores) store.close();
    fs.rmSync(parent, { recursive: true, force: true });
  });
  const outside = name => {
    const root = path.join(parent, name);
    fs.mkdirSync(path.join(root, '.nightshift', 'features'), { recursive: true });
    fs.writeFileSync(path.join(root, '.nightshift', 'QUICK_WINS.md'), '# Quick wins\n');
    fs.writeFileSync(path.join(root, '.nightshift', 'features', 'idea.md'), '# Idea\n');
    const store = new RunStore(root, { create: true });
    stores.push(store);
    store.create({ mechanism: fixtureContinuation(), objective: 'Reflect outside Git', authority: 'User agreed', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: lore });
    const act = request => {
    fixtureReport(store, actor, request);
    return store.update(actor, store.read().revision, request.action, state => transition(state, request));
  };
    act({ action: 'advance', taskId: 'lessons', evidence: 'Retrospective completed' });
    act({ action: 'triage', evidence: 'Follow-ups triaged' });
    return { root, store, act };
  };
  withEnvironment('GIT_CEILING_DIRECTORIES', parent, () => {
    const unchanged = outside('unchanged');
    assert.equal(unchanged.store.read().closing.docs.baseline.backlogOnly, true);
    assert.equal(obligationBrief(unchanged.store.read()).closing.docsReview.satisfied, true);
    assert.equal(obligationBrief(unchanged.store.read()).closing.docsReview.outsideDocumentation, undefined);
    assert.equal(unchanged.act({ action: 'complete' }).status, 'complete');

    const tracked = outside('tracked');
    fs.writeFileSync(path.join(tracked.root, '.nightshift', 'features', 'idea.md'), '# Idea\n\nTracked after triage.\n');
    assert.equal(obligationBrief(tracked.store.read()).closing.docsReview.satisfied, false);
    assert.throws(() => tracked.act({ action: 'complete' }), { code: 'closing-review-required', message: /outside Git/ });
    fs.writeFileSync(path.join(tracked.root, '.nightshift', 'features', 'idea.md'), '# Idea\n');
    assert.equal(tracked.act({ action: 'complete' }).status, 'complete');

    const rooted = outside('rooted');
    fs.writeFileSync(path.join(rooted.root, 'README.md'), '# Added after triage\n');
    assert.throws(() => rooted.act({ action: 'complete' }), { code: 'closing-review-required', message: /outside Git/ });
    fs.rmSync(path.join(rooted.root, 'README.md'));
    assert.equal(rooted.act({ action: 'complete' }).status, 'complete');
  });
});

test('an exempt or unassessed task is covered by the closing review against the triage baseline', t => {
  const f = fixture(t, [{ id: 'docs', title: 'Version bump', kind: 'docs', agreement: { source: 'User', outcome: 'Bump the version' } }, { id: 'lessons', title: 'Lore', kind: 'lore', agreement: { source: 'User', outcome: 'Retrospective' }, requires: ['docs'] }]);
  f.act({ action: 'advance', taskId: 'docs', evidence: 'Bumped', docsExemption: 'Only the version string changed' });
  f.act({ action: 'advance', taskId: 'lessons', evidence: 'No instruction proposal' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required' });
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['docs', 'lessons']) });
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('on a complete run a non-backlog finding is deferred with a route, while a required one stays unresolved', t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
  f.write(BACKLOG, '# Bugs\n\nTracked after the morning report.\n');
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code'], [finding('readme'), finding('guide')]) });
  f.confirm(CLOSING_TARGET, f.findingId('readme', CLOSING_TARGET), 'defer', 'optional', { route: 'Follow-up for new work the user directs' });
  assert.throws(() => f.confirm(CLOSING_TARGET, f.findingId('guide', CLOSING_TARGET), 'defer', 'required', { route: 'Follow-up' }), { code: 'required-obligation' });
  const brief = obligationBrief(f.store.read()).closing.docsReview;
  assert.deepEqual(brief.unresolvedFindings, [f.findingId('guide', CLOSING_TARGET)]);
  assert.equal(brief.current, false);
  assert.equal(f.store.read().status, 'complete');
});

test('closing work is admitted on a complete run without an engineering claim, within recorded limits, and refused on a stopped run', async t => {
  const f = fixture(t, [CODE_TASK], { limits: { maxDispatches: 50 } });
  completeTask(f);
  close(f);
  f.act({ action: 'complete' });
  f.write(BACKLOG, '# Bugs\n\nTracked after the morning report.\n');
  const unavailable = { nativeOwner: () => null };
  const run = (request, overrides = unavailable) => executeWithFixtureController(f.root, { actor, revision: f.store.read().revision, ...request }, overrides);
  const parserCheck = { name: 'Ready parser', executable: process.execPath, args: ['--version'], paths: [BACKLOG] };
  await run({ action: 'check', taskId: CLOSING_TARGET, check: parserCheck });
  assert.equal(f.store.read().closing.docs.checks.at(-1).passed, true);
  await assert.rejects(run({ action: 'check', taskId: 'code', check: parserCheck }), { code: 'run-stopped' });
  const review = { kind: 'docs', baseSha: f.baseSha, requirements: 'Tracking edits', rules: 'Do not edit reviewed inputs.', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
  const calls = [];
  await assert.rejects(run({ action: 'dispatch', taskId: CLOSING_TARGET, review: { ...review, kind: 'code' } }, { runAgent: agent(calls, DIMENSIONS.code) }), { code: 'wrong-review-kind' });
  f.store.update(actor, f.store.read().revision, 'fixture-allowance-spent', state => { state.dispatches = state.limits.maxDispatches; });
  await assert.rejects(run({ action: 'dispatch', taskId: CLOSING_TARGET, review }, { runAgent: agent(calls, DIMENSIONS.docs) }), { code: 'resource-limit' });
  f.store.update(actor, f.store.read().revision, 'fixture-deadline-passed', state => { state.dispatches = 0; state.limits.deadlineUtc = '2020-01-01T00:00:00Z'; });
  await assert.rejects(run({ action: 'check', taskId: CLOSING_TARGET, check: parserCheck }), { code: 'resource-limit' });
  assert.equal(calls.length, 0);

  const stopped = fixture(t);
  completeTask(stopped);
  close(stopped);
  stopped.act({ action: 'stop', kind: 'user-stop', reason: 'User paused the run' });
  assert.throws(() => stopped.act({ action: 'review', taskId: CLOSING_TARGET, review: stopped.assessment('docs', ['code']) }), { code: 'run-stopped' });
});

test('a closing dispatch covers every code, docs and lore task, and a failing closing check blocks completion', async t => {
  const f = fixture(t, [CODE_TASK, { id: 'notes', title: 'Notes', kind: 'docs', agreement: { source: 'User', outcome: 'Notes' } }, { id: 'lessons', title: 'Lore', kind: 'lore', agreement: { source: 'User', outcome: 'Lessons' }, requires: ['code', 'notes'] }]);
  completeTask(f);
  f.act({ action: 'advance', taskId: 'notes', evidence: 'Noted', docsExemption: 'Regenerated file only' });
  f.act({ action: 'advance', taskId: 'lessons', evidence: 'No instruction proposal' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  const calls = [];
  const dispatched = await executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: f.store.read().revision, taskId: CLOSING_TARGET, review: { kind: 'docs', baseSha: f.baseSha, requirements: 'Tracking edits', rules: 'Do not edit reviewed inputs.', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] } }, { runAgent: agent(calls, DIMENSIONS.docs) });
  assert.deepEqual([...dispatched.receipt.coveredTaskIds].sort(), ['code', 'lessons', 'notes']);
  await executeWithFixtureController(f.root, { action: 'review', actor, revision: f.store.read().revision, taskId: CLOSING_TARGET, receipt: path.relative(f.root, dispatched.receiptFile).split(path.sep).join('/') });
  f.act({ action: 'check', taskId: CLOSING_TARGET, evidence: { ...verifyCommand(f.root, { name: 'Ready parser', executable: process.execPath, args: ['--version'], paths: [BACKLOG] }), passed: false, exitCode: 1 } });
  const refused = (() => { try { f.act({ action: 'complete' }); return null; } catch (error) { return error; } })();
  assert.equal(refused.code, 'closing-review-unresolved');
  assert.match(refused.message, /#closing: check "Ready parser" failed/);
  assert.doesNotMatch(refused.message, /not a complete strong docs assessment/, 'a check-only failure names no other cause');
  f.check(CLOSING_TARGET, [BACKLOG], 'Ready parser');
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('wait keeps observing a closing-record worker on a complete run and still ends for other workers', async t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.act({ action: 'complete' });
  f.store.update(actor, f.store.read().revision, 'fixture-workers', state => {
    for (const [id, taskId] of [['closing-reviewer', CLOSING_TARGET], ['task-reviewer', 'code']]) state.workers.push({ id, session: null, role: 'reviewer', assignment: 'Fixture assessment', taskId, writes: [], status: 'running', runnerPid: 4242 });
  });
  const observe = workerId => awaitWorker(f.store, { action: 'wait', workerId, timeoutMs: 0 }, { processExists: () => true, sleep: async () => {} });
  assert.equal((await observe('closing-reviewer')).reason, 'timeout');
  assert.equal((await observe('task-reviewer')).reason, 'run-stopped');
});

test('the closing identity cannot name a queue task', t => {
  const f = fixture(t);
  f.act({ action: 'stop', kind: 'user-stop', reason: 'Make room for a new run' });
  f.store.update(actor, f.store.read().revision, 'fixture-finished-prior-work', state => { for (const task of state.tasks) { task.status = 'complete'; task.stage = 'complete'; } });
  assert.throws(() => f.store.create({ mechanism: fixtureContinuation(), objective: 'Next work', authority: 'User agreed', controller: actor, tasks: [{ ...CODE_TASK, id: CLOSING_TARGET }] }), { code: 'invalid-queue' });
});


test('closing relevance covers its exact final candidate without replacing fresh assessment or historical discharge', t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Bugs: first tracking change');
  f.review(CLOSING_TARGET, 'docs', ['code']);
  const original = f.store.read().closing.docs.reviews.at(-1);
  f.write(BACKLOG, '# Bugs: clarified tracking change');
  const decision = f.assessment('docs', ['code'], [], {
    relevance: { requestId: original.requestId, originalHash: require('../internal/runtime/applicability').identity(original), taskIds: ['code'], originalInputsAvailable: true },
    continues: { kind: 'resumed', requestId: original.requestId, session: original.session }, lineage: original.requestId, session: original.session,
    dimensions: [], broad: false, applicability: [{ id: 'code', outcome: 'preserve', evidence: 'The clarified description preserves the independently assessed tracking decision' }],
  });
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: decision });
  const brief = obligationBrief(f.store.read());
  assert.equal(brief.closing.docsReview.current, true);
  assert.equal(brief.closing.docsReview.satisfied, true);
  assert.equal(f.task().status, 'complete');
  f.act({ action: 'complete' });
  assert.equal(f.store.read().status, 'complete');
  assert.equal(require('../internal/runtime/lifecycle').historicalDischarge(f.store.read(), evidence => Boolean(evidence?.digest)), true);
  const completed = f.store.read();
  f.check(CLOSING_TARGET, [BACKLOG]);
  assert.equal(require('../internal/runtime/creation-consistency').closingDischargedSince(f.store.read(), completed, value => value), true);
});


test('a dispatched governing-spec assessment remains accepted through implementation and closing edits', async t => {
  const specPath = '.nightshift/features/idea.md';
  const f = fixture(t, [
    { id: 'spec', title: 'Governing spec', kind: 'spec', agreement: { source: 'User', outcome: 'Assess the governing artifact', spec: specPath } },
    { ...CODE_TASK, agreement: { ...CODE_TASK.agreement, spec: specPath, specReviewTaskId: 'spec' } },
  ]);
  const dispatched = await executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: f.store.read().revision, taskId: 'spec', review: { kind: 'spec', baseSha: f.baseSha, requirements: 'Assess the governing artifact', rules: 'Read only', candidates: [{ host: 'claude', model: 'claude-opus-5-5', effort: 'high' }] } }, { runAgent: agent([], DIMENSIONS.spec) });
  await executeWithFixtureController(f.root, { action: 'review', actor, revision: f.store.read().revision, taskId: 'spec', receipt: path.relative(f.root, dispatched.receiptFile).split(path.sep).join('/') });
  f.act({ action: 'advance', taskId: 'spec' });
  f.write('src.js', 'module.exports = 2;');
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Bugs: tracking edit after triage');
  f.review(CLOSING_TARGET, 'docs', ['code']);
  assert.equal(obligationBrief(f.store.read()).assessmentApplicability.find(item => item.taskId === 'spec').current, true);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('documentation relief cannot settle changed governing requirements for a code assessment', t => {
  const specPath = '.nightshift/features/idea.md';
  const f = fixture(t, [
    { id: 'spec', title: 'Governing spec', kind: 'spec', agreement: { source: 'User', outcome: 'Assess governing requirements', spec: specPath } },
    { ...CODE_TASK, agreement: { ...CODE_TASK.agreement, spec: specPath, specReviewTaskId: 'spec' } },
  ]);
  f.review('spec', 'spec', ['spec'], [], { snapshot: snapshot(f.root, [specPath]) });
  f.act({ action: 'advance', taskId: 'spec' });
  completeTask(f);
  f.write(specPath, '# Changed governing requirements');
  f.review('spec', 'spec', ['spec'], [], { snapshot: snapshot(f.root, [specPath]) });
  f.act({ action: 'advance', taskId: 'spec' });
  f.act({ action: 'spec-accepted', taskId: 'code', authority: 'User accepted the revised governing requirements' });
  f.review('code', 'docs');
  assert.equal(require('../internal/runtime/lifecycle').reviewGate(f.root, f.task(), f.store.read()), false);
});

test('documentation relief never overrides an independent requirement to reassess code', t => {
  const f = fixture(t);
  completeTask(f);
  const original = f.task().reviews.find(review => review.kind === 'code');
  f.write(BACKLOG, '# Changed ordinary documentation');
  const relevance = f.assessment('code', ['code'], [], { dimensions: [], broad: false, session: original.session, lineage: original.requestId,
    continues: { kind: 'resumed', requestId: original.requestId, session: original.session },
    relevance: { requestId: original.requestId, originalHash: require('../internal/runtime/applicability').identity(original), taskIds: ['code'], originalInputsAvailable: true },
    applicability: [{ id: 'code', outcome: 'reassess', evidence: 'The changed requirement needs independent code assessment' }],
  });
  f.act({ action: 'review', taskId: 'code', review: relevance });
  f.review('code', 'docs');
  assert.equal(require('../internal/runtime/lifecycle').reviewGate(f.root, f.task(), f.store.read()), false);
  assert.equal(obligationBrief(f.store.read()).assessmentApplicability.find(item => item.kind === 'code').status, 'reassess');
});

test('status reports a documentation-only change as applicable, listing it apart, without requesting code reassessment', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);

  // Act
  f.write(BACKLOG, '# Changed ordinary documentation');

  // Assert
  const condition = obligationBrief(f.store.read()).assessmentApplicability.find(item => item.kind === 'code');
  assert.equal(condition.current, true);
  assert.equal(condition.status, 'applicable');
  assert.equal(condition.next, null);
  assert.deepEqual(condition.changedPaths, []);
  assert.deepEqual(condition.documentationPaths, [BACKLOG]);
  assert.equal(obligationBrief(f.store.read()).assessmentApplicability.find(item => item.kind === 'docs').documentationPaths, undefined);
});

test('a run without the docs gate keeps the documentation relief and its applicable-by-docs-review status', t => {
  // Arrange
  const f = fixture(t, [CODE_TASK], { docsGate: false });
  toDocumentation(f);
  f.write(BACKLOG, '# Changed ordinary documentation');
  const condition = () => obligationBrief(f.store.read()).assessmentApplicability.find(item => item.kind === 'code');
  assert.equal(condition().status, 'pending');
  assert.equal(condition().documentationPaths, undefined);

  // Act
  f.review('code', 'docs');

  // Assert
  assert.equal(condition().status, 'applicable-by-docs-review');
  assert.equal(condition().current, true);
  assert.deepEqual(condition().changedPaths, [BACKLOG]);
});


test('unchanged ignored governing inputs remain consistent across triage and closing context', t => {
  const f = fixture(t);
  const governing = '.tmp/governing.md';
  f.write(governing, '# Governing requirements');
  const captured = snapshot(f.root, [governing]);
  f.store.update(actor, f.store.read().revision, 'fixture-governing-input', state => {
    state.tasks[0].agreement = { ...state.tasks[0].agreement, spec: governing, specReviewed: true, specSnapshot: captured };
  });
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Tracking after triage');
  f.review(CLOSING_TARGET, 'docs', ['code']);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});


for (const outcome of ['reassess', 'unresolved']) {
  test('later documentation edits carry a prior ' + outcome + ' relevance obligation forward', t => {
    const f = fixture(t);
    completeTask(f);
    const original = f.task().reviews.find(review => review.kind === 'code');
    f.write(BACKLOG, '# First documentation candidate');
    const decision = f.assessment('code', ['code'], [], { dimensions: [], broad: false, session: original.session, lineage: original.requestId,
      continues: { kind: 'resumed', requestId: original.requestId, session: original.session },
      relevance: { requestId: original.requestId, originalHash: require('../internal/runtime/applicability').identity(original), taskIds: ['code'], originalInputsAvailable: true },
      applicability: [{ id: 'code', outcome, evidence: 'Independent current code applicability is not established' }],
    });
    f.act({ action: 'review', taskId: 'code', review: decision });
    f.write(BACKLOG, '# Later documentation candidate');
    f.review('code', 'docs');
    assert.equal(require('../internal/runtime/lifecycle').reviewGate(f.root, f.task(), f.store.read()), false);
    assert.notEqual(obligationBrief(f.store.read()).assessmentApplicability.find(item => item.kind === 'code').status, 'applicable-by-docs-review');
    const current = f.assessment('code', ['code'], [], { dimensions: [], broad: false, session: original.session, lineage: original.requestId,
      continues: { kind: 'resumed', requestId: decision.requestId, session: original.session },
      relevance: decision.relevance,
      applicability: [{ id: 'code', outcome: 'preserve', evidence: 'The later candidate resolves the earlier coverage gap' }],
    });
    f.act({ action: 'review', taskId: 'code', review: current });
    assert.equal(require('../internal/runtime/lifecycle').reviewGate(f.root, f.task(), f.store.read()), true);
  });
}

test('closing review context-only ignored support does not masquerade as a post-triage code edit', t => {
  // Arrange
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.git/info/exclude'), '.tmp/');
  f.write('.tmp/support.md', '# Supporting rationale');
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Tracking after triage');
  const inputs = inventorySnapshot(f.root, [], ['.tmp/support.md']);
  assert.deepEqual(inputs.includedOnlyPaths, ['.tmp/support.md']);

  // Act
  f.review(CLOSING_TARGET, 'docs', ['code'], [], { snapshot: inputs, contextSnapshot: inputs });

  // Assert
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('closing selected-only provenance cannot hide ordinary edits or malformed scope', t => {
  // Arrange
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, '.git/info/exclude'), '.tmp/');
  f.write('.tmp/support.md', '# Rationale');
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Tracking');
  const inputs = inventorySnapshot(f.root, [], ['.tmp/support.md']);

  // Act and Assert
  for (const includedOnlyPaths of [null, '.tmp/support.md', ['.tmp/support.md', '.tmp/support.md'], ['src.js']]) {
    const malformed = { ...inputs, includedOnlyPaths };
    assert.throws(() => f.review(CLOSING_TARGET, 'docs', ['code'], [], { snapshot: malformed, contextSnapshot: malformed }), { code: 'closing-scope' });
  }
  f.write('src.js', 'module.exports = 2;');
  const changed = inventorySnapshot(f.root, [], ['.tmp/support.md']);
  f.review(CLOSING_TARGET, 'docs', ['code'], [], { snapshot: changed, contextSnapshot: changed });
  assert.deepEqual(obligationBrief(f.store.read()).closing.docsReview.outsideDocumentation.changedPaths, ['src.js']);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required', message: /src\.js/ });
});

// Documentation paths and the closing condition.

const DOCUMENTATION_EDITS = [[BACKLOG, '# Bugs\n\nEdited entry.\n'], ['.nightshift/reports/acceptance.md', '# Acceptance\n'], ['README.md', '# Project\n\nEdited.\n']];
const LORE_TASK = { id: 'lessons', title: 'Lore', kind: 'lore', agreement: { source: 'User', outcome: 'Assessed instruction proposal' } };
const SPEC_PATH = '.nightshift/specs/plan.md';
const SPEC_TASK = { id: 'plan', title: 'Plan', kind: 'spec', agreement: { source: 'User', outcome: 'Assessed plan', spec: SPEC_PATH } };

function condition(f, taskId, kind = 'code') {
  return obligationBrief(f.store.read()).assessmentApplicability.find(item => item.taskId === taskId && item.kind === kind);
}

function closingStatus(f) {
  return obligationBrief(f.store.read()).closing.docsReview;
}

function refusal(work) {
  try {
    work();
  } catch (error) {
    return error;
  }
  return assert.fail('Expected a refusal');
}

// A preserving, reassessing or unresolved applicability decision on a task's code assessment, as a resumed originating reviewer records it.
function decision(f, original, outcome = 'preserve', taskId = 'code') {
  return f.assessment('code', [taskId], [], {
    dimensions: [], broad: false, session: original.session, lineage: original.requestId,
    continues: { kind: 'resumed', requestId: original.requestId, session: original.session },
    relevance: { requestId: original.requestId, originalHash: identity(original), taskIds: [taskId], originalInputsAvailable: true },
    applicability: [{ id: taskId, outcome, evidence: 'Independently examined the change and its interactions' }],
  });
}

// Writes the spec task's governing spec, assesses it and completes the task.
function completeSpecTask(f, id = 'plan') {
  f.write(SPEC_PATH, '# Plan\n');
  f.review(id, 'spec', [id], [], { snapshot: snapshot(f.root, [SPEC_PATH]) });
  f.act({ action: 'advance', taskId: id });
  f.act({ action: 'advance', taskId: id, evidence: 'Spec documented' });
  assert.equal(f.task(id).status, 'complete');
}

// Assesses a lore task's instruction proposal and completes it, which records the retrospective once the run is ready to close.
function completeLoreTask(f, id = 'lessons') {
  f.review(id, 'code');
  f.act({ action: 'advance', taskId: id });
  f.act({ action: 'advance', taskId: id, evidence: 'Proposal assessed; no instruction applied' });
  assert.equal(f.task(id).status, 'complete');
}

for (const [file, content] of DOCUMENTATION_EDITS) {
  test(`a ${file} edit leaves the code assessment applicable with the path listed apart, in review, documentation, completion and lore`, t => {
    // Arrange
    const inReview = fixture(t);
    inReview.act({ action: 'start-task', taskId: 'code' });
    inReview.check('code');
    inReview.review('code', 'code');
    const inDocumentation = fixture(t);
    toDocumentation(inDocumentation);
    const completed = fixture(t);
    completeTask(completed);
    const lore = fixture(t, [LORE_TASK]);
    lore.review('lessons', 'code');

    // Act
    for (const f of [inReview, inDocumentation, completed, lore]) f.write(file, content);

    // Assert
    for (const [f, id] of [[inReview, 'code'], [inDocumentation, 'code'], [completed, 'code'], [lore, 'lessons']]) {
      const reading = condition(f, id);
      assert.deepEqual([reading.status, reading.current, reading.changedPaths, reading.documentationPaths, reading.next], ['applicable', true, [], [file], null]);
    }
    inReview.act({ action: 'advance', taskId: 'code' });
    assert.equal(inReview.task().stage, 'documentation');
    assert.equal(inReview.task().reviews.some(review => review.kind === 'docs'), false);
    assert.equal(refusal(() => inDocumentation.act({ action: 'advance', taskId: 'code', evidence: 'Documented' })).code, 'docs-review-required');
    inDocumentation.review('code', 'docs');
    inDocumentation.act({ action: 'advance', taskId: 'code' });
    inDocumentation.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
    assert.equal(inDocumentation.task().status, 'complete');
    close(completed);
    completed.review(CLOSING_TARGET, 'docs', ['code']);
    assert.equal(completed.act({ action: 'complete' }).status, 'complete');
    lore.act({ action: 'advance', taskId: 'lessons' });
    assert.equal(lore.task('lessons').stage, 'retrospective');
  });
}

test('a repair made only to documentation paths names no fresh code target for a completed task, only the docs review it staled', t => {
  // Arrange
  const f = fixture(t, [{ ...CODE_TASK, id: 'first' }, { ...CODE_TASK, id: 'second' }]);
  completeTask(f, 'first');
  toDocumentation(f, 'second');
  f.review('second', 'code', ['second'], [finding('logic', 'The change describes the boundary wrongly')]);
  f.confirm('second', f.findingId('logic', 'second'));

  // Act
  f.write(BACKLOG, '# Bugs\n\nCorrected entry.\n');
  f.act({ action: 'repair', taskId: 'second', findingIds: [f.findingId('logic', 'second')] });

  // Assert
  const targets = obligationBrief(f.store.read()).next.find(item => item.id === 'second').review.freshTargets;
  assert.deepEqual(targets.map(target => [target.kind, target.taskId, target.covers]), [['docs', 'second', ['first']]]);
  assert.equal(condition(f, 'first').status, 'applicable');
});

test('a feature record that is the task\'s governing spec stays a code-assessment input, unlike another feature record', t => {
  // Arrange
  const spec = '.nightshift/features/idea.md';
  const f = fixture(t, [{ ...CODE_TASK, agreement: { ...CODE_TASK.agreement, spec, specReviewed: true } }]);
  toDocumentation(f);

  // Act
  f.write('.nightshift/features/other.md', '# Another record\n');
  const otherRecord = condition(f, 'code');
  f.write(spec, '# Idea\n\nChanged governing requirements.\n');

  // Assert
  assert.deepEqual([otherRecord.status, otherRecord.documentationPaths], ['applicable', ['.nightshift/features/other.md']]);
  assert.deepEqual([condition(f, 'code').status, condition(f, 'code').changedPaths], ['pending', [spec]]);
  assert.throws(() => f.act({ action: 'advance', taskId: 'code', evidence: 'Documented' }), { code: 'review-required', message: /idea\.md/ });
});

test('a review context keeps the documentation relief and its applicable-by-docs-review status', t => {
  // Arrange
  const f = fixture(t);
  toDocumentation(f);
  f.write(BACKLOG, '# Bugs\n\nEdited entry.\n');

  // Act
  f.review('code', 'docs');
  const reading = obligationBrief({ ...f.store.read(), kind: 'review' }).assessmentApplicability.find(item => item.kind === 'code');

  // Assert
  assert.deepEqual([reading.status, reading.current, reading.changedPaths, reading.documentationPaths], ['applicable-by-docs-review', true, [BACKLOG], undefined]);
});

test('a relevance decision stays applicable by decision through a later documentation edit', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  const original = f.task().reviews.find(review => review.kind === 'code');
  f.write('src.js', 'module.exports = 2;\n');
  f.act({ action: 'review', taskId: 'code', review: decision(f, original) });
  assert.equal(condition(f, 'code').status, 'applicable-by-decision');

  // Act
  f.write(BACKLOG, '# Bugs\n\nEdited after the decision.\n');

  // Assert
  const reading = condition(f, 'code');
  assert.deepEqual([reading.status, reading.current, reading.changedPaths, reading.documentationPaths], ['applicable-by-decision', true, ['src.js'], [BACKLOG]]);
});

test('a run completed with a documentation edit after its code assessment stays historically discharged', t => {
  // Arrange
  const f = fixture(t);
  toDocumentation(f);
  f.write('README.md', '# Project\n\nDocumented change.\n');
  f.review('code', 'docs');
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documentation reconciled' });
  close(f);
  f.act({ action: 'complete' });
  const valid = evidence => Boolean(evidence?.digest);

  // Act
  const discharged = historicalDischarge(f.store.read(), valid);
  f.write(BACKLOG, '# Bugs\n\nTracked after completion.\n');

  // Assert
  assert.equal(discharged, true);
  assert.equal(historicalDischarge(f.store.read(), valid), true);
});

test('a continued reviewer\'s import records its closures through a documentation edit made during its turn, but not through a code edit', t => {
  // Arrange
  const run = edit => {
    const f = fixture(t);
    f.act({ action: 'start-task', taskId: 'code' });
    f.check('code');
    f.review('code', 'code', ['code'], [finding('logic', 'The code mishandles the boundary')]);
    const id = f.findingId('logic');
    f.confirm('code', id);
    f.write('src.js', 'module.exports = 2;\n');
    f.act({ action: 'repair', taskId: 'code', findingIds: [id] });
    f.check('code');
    const lineage = f.task().findings.find(item => item.id === id).pendingClosure.lineage;
    const raised = f.task().reviews.find(item => item.requestId === lineage);
    const continued = f.assessment('code', ['code'], [], { continues: { kind: 'resumed', requestId: lineage, session: raised.session }, lineage, session: raised.session, closures: [{ id, closed: true, evidence: 'The repair resolves the finding' }] });
    edit(f);
    f.act({ action: 'review', taskId: 'code', review: continued });
    return f.task().findings.find(item => item.id === id);
  };

  // Act
  const documented = run(f => f.write(BACKLOG, '# Bugs\n\nEdited during the reviewer\'s turn.\n'));
  const coded = run(f => f.write(NESTED_DOC, '# Guide\n\nEdited during the reviewer\'s turn.\n'));

  // Assert
  assert.equal(documented.pendingClosure, undefined);
  assert.equal(documented.closures.length, 1);
  assert.ok(coded.pendingClosure);
});

test('a stale assessment without a request id names the fresh assessment first and carries no applicability call', t => {
  // Arrange
  const single = fixture(t);
  single.act({ action: 'start-task', taskId: 'code' });
  single.check('code');
  single.review('code', 'code', ['code'], [], { requestId: undefined });
  single.act({ action: 'advance', taskId: 'code' });
  single.review('code', 'docs');
  single.act({ action: 'advance', taskId: 'code' });
  single.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
  const pair = fixture(t, [{ ...CODE_TASK, id: 'first' }, { ...CODE_TASK, id: 'second' }]);
  pair.act({ action: 'start-task', taskId: 'first' });
  pair.check('first');
  pair.review('first', 'code', ['first'], [], { requestId: undefined });
  pair.act({ action: 'advance', taskId: 'first' });
  pair.review('first', 'docs', ['first']);
  pair.act({ action: 'advance', taskId: 'first' });
  pair.act({ action: 'advance', taskId: 'first', evidence: 'Documented' });
  toDocumentation(pair, 'second');
  pair.review('second', 'docs', ['second'], [finding('guide')]);
  pair.confirm('second', pair.findingId('guide', 'second'));

  // Act
  single.write('src.js', 'module.exports = 2;\n');
  pair.write('src.js', 'module.exports = 2;\n');
  pair.act({ action: 'repair', taskId: 'second', findingIds: [pair.findingId('guide', 'second')] });

  // Assert
  assert.match(condition(single, 'code').next, /^Obtain a fresh cumulative assessment/);
  assert.match(refusal(() => single.act({ action: 'complete' })).message, /code: changed inputs: src\.js.*\(way forward: obtain a fresh cumulative assessment/);
  const [target] = obligationBrief(pair.store.read()).next.find(item => item.id === 'second').review.freshTargets;
  assert.deepEqual([target.kind, target.taskId], ['code', 'second']);
  assert.deepEqual(target.staleChanges.find(change => change.requestId === null), { requestId: null, cause: 'changed-inputs', changedPaths: ['src.js'], applicabilityCall: null });
  // An assessment imported without its dispatch has no receipted dispatch to resume either.
  assert.ok(target.staleChanges.every(change => change.applicabilityCall === null));
});

test('a code edit after triage takes a closing review and holds completion until a fresh code assessment or a revert settles it', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  close(f);
  const original = f.task().reviews.find(review => review.kind === 'code');
  f.write('src.js', 'module.exports = 2;\n');
  f.check('code');

  // Act and Assert
  f.review(CLOSING_TARGET, 'docs', ['code']);
  const held = closingStatus(f);
  assert.deepEqual(held.outsideDocumentation.changedPaths, ['src.js']);
  assert.match(held.outsideDocumentation.next, /fresh code assessment on one of the tasks code/);
  assert.match(held.outsideDocumentation.next, /Reverting these paths also settles the hold/);
  assert.equal(held.satisfied, false);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required', message: /src\.js.*Reverting these paths/s });
  f.act({ action: 'review', taskId: 'code', review: decision(f, original) });
  assert.equal(condition(f, 'code').status, 'applicable-by-decision');
  assert.deepEqual(closingStatus(f).outsideDocumentation.changedPaths, ['src.js']);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required', message: /src\.js/ });
  f.review('code', 'code');
  assert.equal(f.task().status, 'complete');
  assert.equal(closingStatus(f).outsideDocumentation, undefined);
  assert.equal(closingStatus(f).satisfied, true);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');

  const reverted = fixture(t);
  completeTask(reverted);
  close(reverted);
  reverted.write('src.js', 'module.exports = 2;\n');
  assert.throws(() => reverted.act({ action: 'complete' }), { code: 'closing-review-required', message: /src\.js/ });
  reverted.write('src.js', 'module.exports = 1;\n');
  assert.equal(closingStatus(reverted).outsideDocumentation, undefined);
  assert.equal(reverted.act({ action: 'complete' }).status, 'complete');
});

test('after a code edit following triage, completion needs the settling code assessment and then a closing docs review covering every task', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  close(f);
  const closing = f.store.read().closing;
  f.write('src.js', 'module.exports = 2;\n');
  f.check('code');
  const next = closingStatus(f).outsideDocumentation.next;

  // Act
  f.review('code', 'code');

  // Assert
  assert.ok(next.indexOf('fresh code assessment') < next.indexOf('closing docs review'), next);
  assert.equal(f.task().status, 'complete');
  assert.deepEqual(f.store.read().closing.triageEvidence, closing.triageEvidence);
  assert.equal(closingStatus(f).outsideDocumentation, undefined);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required', message: /closing docs review/ });
  // A closing review covering no task leaves the task's own docs gate stale.
  f.review(CLOSING_TARGET, 'docs', []);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'docs-review-required', message: /Missing for: code: changed inputs: src\.js/ });
  f.review(CLOSING_TARGET, 'docs', ['code']);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('in a run of only lore tasks, a lore task\'s fresh code assessment settles the hold', t => {
  // Arrange
  const f = fixture(t, [LORE_TASK]);
  completeLoreTask(f);
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write('src.js', 'module.exports = 2;\n');
  assert.match(closingStatus(f).outsideDocumentation.next, /one of the tasks lessons/);

  // Act
  f.review('lessons', 'code');

  // Assert
  assert.equal(f.task('lessons').status, 'complete');
  assert.equal(closingStatus(f).outsideDocumentation, undefined);
  f.review(CLOSING_TARGET, 'docs', ['lessons']);
  assert.equal(f.act({ action: 'complete' }).status, 'complete');
});

test('triage recorded again keeps the earlier baseline while the hold is unsettled, whatever review was imported meanwhile', t => {
  for (const imported of ['closing', 'task']) {
    // Arrange
    const f = fixture(t);
    completeTask(f);
    close(f);
    const baseline = f.store.read().closing.docs.baseline.digest;
    f.write('src.js', 'module.exports = 2;\n');

    // Act
    if (imported === 'closing') f.review(CLOSING_TARGET, 'docs', ['code']);
    else f.review('code', 'docs');
    f.act({ action: 'triage', evidence: 'Triage recorded again' });

    // Assert
    assert.equal(f.task().status, 'complete', imported);
    assert.equal(f.store.read().closing.docs.baseline.digest, baseline, imported);
    assert.deepEqual(closingStatus(f).outsideDocumentation.changedPaths, ['src.js'], imported);
  }
});

test('a held run reports the hold, and triage recorded while stopped keeps the earlier baseline through resumption', t => {
  for (const imported of ['closing', 'task']) {
    // Arrange
    const f = fixture(t);
    completeTask(f);
    close(f);
    const baseline = f.store.read().closing.docs.baseline.digest;
    f.write('src.js', 'module.exports = 2;\n');
    if (imported === 'closing') f.review(CLOSING_TARGET, 'docs', ['code']);
    else f.review('code', 'docs');

    // Act
    f.act({ action: 'hold', authority: 'User paused the run', reason: 'Decide the code edit later' });
    const stopped = closingStatus(f);
    f.act({ action: 'triage', evidence: 'Triage recorded while stopped' });
    f.act({ action: 'resume', authority: 'User resumed the run' });

    // Assert
    assert.deepEqual(stopped.outsideDocumentation.changedPaths, ['src.js'], imported);
    assert.equal(f.store.read().status, 'running', imported);
    assert.equal(f.store.read().closing.docs.baseline.digest, baseline, imported);
    assert.deepEqual(closingStatus(f).outsideDocumentation.changedPaths, ['src.js'], imported);
  }
});

test('in a run of only spec tasks, a fresh whole-spec assessment settles a governing-spec edit, while another edit needs the user\'s decision', t => {
  // Arrange
  const settled = fixture(t, [SPEC_TASK]);
  completeSpecTask(settled);
  close(settled);
  const undecided = fixture(t, [SPEC_TASK]);
  completeSpecTask(undecided);
  close(undecided);

  // Act
  settled.write(SPEC_PATH, '# Plan\n\nChanged after triage.\n');
  undecided.write('src.js', 'module.exports = 2;\n');

  // Assert
  assert.deepEqual(closingStatus(settled).outsideDocumentation.changedPaths, [SPEC_PATH]);
  assert.match(closingStatus(settled).outsideDocumentation.next, /fresh whole-spec assessment on spec task plan/);
  assert.throws(() => settled.act({ action: 'complete' }), { code: 'closing-review-required', message: /plan\.md/ });
  settled.review('plan', 'spec', ['plan'], [], { snapshot: snapshot(settled.root, [SPEC_PATH]) });
  assert.equal(settled.task('plan').status, 'complete');
  assert.equal(closingStatus(settled).outsideDocumentation, undefined);
  settled.review(CLOSING_TARGET, 'docs', []);
  assert.equal(settled.act({ action: 'complete' }).status, 'complete');
  assert.match(closingStatus(undecided).outsideDocumentation.next, /needs the user's decision: hold, stop or the administrative close/);
  undecided.review('plan', 'spec', ['plan'], [], { snapshot: snapshot(undecided.root, [SPEC_PATH, 'src.js']) });
  assert.deepEqual(closingStatus(undecided).outsideDocumentation.changedPaths, ['src.js']);
});

test('in a run with a code task, a spec assessment whose deciding inputs include the edited code file does not settle the hold', t => {
  // Arrange
  const f = fixture(t, [SPEC_TASK, CODE_TASK]);
  completeSpecTask(f);
  completeTask(f);
  close(f);
  f.write('src.js', 'module.exports = 2;\n');

  // Act
  f.review('plan', 'spec', ['plan'], [], { snapshot: snapshot(f.root, [SPEC_PATH, 'src.js']) });

  // Assert
  assert.equal(condition(f, 'plan', 'spec').status, 'applicable');
  assert.deepEqual(closingStatus(f).outsideDocumentation.changedPaths, ['src.js']);
  assert.match(closingStatus(f).outsideDocumentation.next, /one of the tasks code/);
});

test('on a complete run a code edit leaves the hold unevaluated, closing coverage reads as before and a closing review over it is refused', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.act({ action: 'complete' });

  // Act
  f.write('src.js', 'module.exports = 2;\n');

  // Assert
  assert.equal(closingStatus(f).outsideDocumentation, undefined);
  assert.equal(closingStatus(f).satisfied, false);
  assert.throws(() => f.review(CLOSING_TARGET, 'docs', ['code']), { code: 'closing-scope', message: /src\.js/ });
});

test('on a docs-gated run of lore and spec tasks, a documentation edit after triage still needs a closing review after triage is recorded again', t => {
  // Arrange
  const f = fixture(t, [SPEC_TASK, { ...LORE_TASK, requires: ['plan'] }]);
  completeSpecTask(f);
  completeLoreTask(f);
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  const baseline = f.store.read().closing.docs.baseline.digest;

  // Act
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  f.act({ action: 'triage', evidence: 'Triage recorded again' });

  // Assert
  assert.equal(f.store.read().closing.docs.baseline.digest, baseline);
  assert.equal(closingStatus(f).outsideDocumentation, undefined);
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-required' });
});

test('the hold lists first the tasks whose assessment covers the other stale code gates, and a lore gate it leaves stale is reported by stale-review', t => {
  // Arrange
  const f = fixture(t, [{ ...LORE_TASK, requires: ['first', 'second'] }, { ...CODE_TASK, id: 'first' }, { ...CODE_TASK, id: 'second' }]);
  completeTask(f, 'first');
  completeTask(f, 'second');
  completeLoreTask(f);
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write('src.js', 'module.exports = 2;\n');

  // Act
  const next = closingStatus(f).outsideDocumentation.next;
  f.review('first', 'code', ['first', 'second']);
  f.check('first');
  f.check('second');
  f.review(CLOSING_TARGET, 'docs', ['first', 'second', 'lessons']);

  // Assert
  assert.match(next, /one of the tasks first, second, lessons/);
  assert.equal(closingStatus(f).outsideDocumentation, undefined);
  const refused = refusal(() => f.act({ action: 'complete' }));
  assert.equal(refused.code, 'stale-review');
  assert.match(refused.message, /lessons: changed inputs: src\.js/);
  assert.doesNotMatch(refused.message, /(first|second): changed inputs/);
});

test('with freshness verification skipped, the outside-documentation hold and closing satisfaction await reconciliation', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  close(f);

  // Act
  const light = obligationBrief(f.store.read(), f.root, { verifyFreshness: false }).closing.docsReview;

  // Assert
  assert.deepEqual([light.outsideDocumentation, light.satisfied], ['reconcile at acceptance', 'reconcile at acceptance']);
});

test('an outside-documentation set that cannot be computed reports the no-baseline recovery, and triage recorded again keeps or replaces the baseline as before', t => {
  // Arrange
  const failed = fixture(t);
  completeTask(failed);
  close(failed);
  failed.store.update(actor, failed.store.read().revision, 'fixture-corrupt-baseline', state => { state.closing.docs.baseline.digest = 'corrupt'; });
  const missing = fixture(t);
  completeTask(missing);
  close(missing);
  missing.store.update(actor, missing.store.read().revision, 'fixture-lost-baseline', state => { state.closing.docs.baseline = null; });

  // Act
  const failedStatus = closingStatus(failed).outsideDocumentation;
  const missingStatus = closingStatus(missing).outsideDocumentation;
  failed.act({ action: 'triage', evidence: 'Triage recorded again' });
  missing.act({ action: 'triage', evidence: 'Triage recorded again' });

  // Assert
  for (const status of [failedStatus, missingStatus]) {
    assert.equal(status.changedPaths, null);
    assert.match(status.next, /record triage again once Git can inspect the project/);
  }
  assert.equal(failed.store.read().closing.docs.baseline.digest, 'corrupt');
  assert.throws(() => failed.act({ action: 'complete' }), { code: 'closing-review-required', message: /cannot be established/ });
  assert.ok(missing.store.read().closing.docs.baseline);
  assert.equal(closingStatus(missing).outsideDocumentation, undefined);
  assert.equal(missing.act({ action: 'complete' }).status, 'complete');
});

test('a closing review is still refused for a missing baseline, an unestablished difference or malformed selected-only provenance', t => {
  // Arrange
  const missing = fixture(t);
  completeTask(missing);
  close(missing);
  missing.store.update(actor, missing.store.read().revision, 'fixture-lost-baseline', state => { state.closing.docs.baseline = null; });
  const corrupt = fixture(t);
  completeTask(corrupt);
  close(corrupt);
  corrupt.store.update(actor, corrupt.store.read().revision, 'fixture-corrupt-baseline', state => { state.closing.docs.baseline.digest = 'corrupt'; });
  const malformed = fixture(t);
  completeTask(malformed);
  close(malformed);
  const provenance = { ...inventorySnapshot(malformed.root), includedOnlyPaths: ['src.js'] };

  // Act and Assert
  assert.throws(() => missing.review(CLOSING_TARGET, 'docs', ['code']), { code: 'closing-scope', message: /no triage baseline/ });
  assert.throws(() => corrupt.review(CLOSING_TARGET, 'docs', ['code']), { code: 'closing-scope', message: /cannot be established/ });
  assert.throws(() => malformed.review(CLOSING_TARGET, 'docs', ['code'], [], { snapshot: provenance, contextSnapshot: provenance }), { code: 'closing-scope', message: /malformed selected-only/ });
});

test('after triage, a clean current assessment or preserving decision on a completed task leaves it complete with its exemption and the closing evidence intact', t => {
  // Arrange
  const exempt = fixture(t, [{ id: 'docs', title: 'Version bump', kind: 'docs', agreement: { source: 'User', outcome: 'Bump the version' } }]);
  exempt.act({ action: 'advance', taskId: 'docs', evidence: 'Bumped', docsExemption: 'Only the version string changed' });
  close(exempt);
  const closing = exempt.store.read().closing;
  const decided = fixture(t);
  completeTask(decided);
  close(decided);
  const decidedClosing = decided.store.read().closing;
  const original = decided.task().reviews.find(review => review.kind === 'code');
  decided.write('src.js', 'module.exports = 2;\n');

  // Act
  exempt.review('docs', 'code');
  decided.act({ action: 'review', taskId: 'code', review: decision(decided, original) });

  // Assert
  assert.deepEqual([exempt.task('docs').status, exempt.task('docs').stage], ['complete', 'complete']);
  assert.ok(exempt.task('docs').docsExemption);
  assert.deepEqual(exempt.store.read().closing, closing);
  assert.equal(decided.task().status, 'complete');
  assert.deepEqual(decided.store.read().closing, decidedClosing);
});

test('after triage, an import with findings, or an incomplete or continued clean one, reopens a completed task as before', t => {
  const imports = [
    ['findings', {}, [finding('logic', 'The code mishandles the boundary')]],
    ['incomplete', { status: 'incomplete', broad: false, coverageEvidence: '' }, []],
    ['continued', { continues: { kind: 'resumed', requestId: 'earlier', session: 'earlier-session' }, lineage: 'earlier', closures: [] }, []],
  ];
  for (const [label, overrides, findings] of imports) {
    // Arrange
    const f = fixture(t, [{ id: 'docs', title: 'Version bump', kind: 'docs', agreement: { source: 'User', outcome: 'Bump the version' } }]);
    f.act({ action: 'advance', taskId: 'docs', evidence: 'Bumped', docsExemption: 'Only the version string changed' });
    close(f);

    // Act
    f.review('docs', 'code', ['docs'], findings, overrides);

    // Assert
    assert.deepEqual([f.task('docs').status, f.task('docs').stage, f.task('docs').docsExemption], ['active', 'review', undefined], label);
    assert.equal(f.store.read().closing.triageEvidence, null, label);
  }
});

test('the settling code assessment on a completed task after a post-triage code edit keeps it complete while its docs gate is stale', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  close(f);
  const closing = f.store.read().closing;
  f.write('src.js', 'module.exports = 2;\n');
  f.check('code');

  // Act
  f.review('code', 'code');

  // Assert
  assert.equal(f.task().status, 'complete');
  assert.deepEqual(f.store.read().closing, closing);
  assert.equal(condition(f, 'code', 'docs').current, false);
});

test('before triage, the same clean import on a completed task resets closing and reopens it as before', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  f.write('src.js', 'module.exports = 2;\n');
  f.check('code');

  // Act
  f.review('code', 'code');

  // Assert
  assert.equal(f.store.read().closing.retrospectiveEvidence, null);
  assert.deepEqual([f.task().status, f.task().stage, f.task().resumeStage], ['active', 'review', 'complete']);
});

test('a fresh target on a completed task reopens it before triage, and after triage only if its import raises findings', t => {
  // Arrange
  const f = fixture(t);
  f.act({ action: 'start-task', taskId: 'code' });
  f.check('code');
  f.review('code', 'code');
  f.act({ action: 'advance', taskId: 'code' });
  f.review('code', 'docs', ['code'], [finding('entry')]);
  f.confirm('code', f.findingId('entry'));
  f.write(BACKLOG, '# Bugs\n\nCorrected entry.\n');
  f.act({ action: 'repair', taskId: 'code', findingIds: [f.findingId('entry')] });
  f.closeRepairs('code');
  f.review('code', 'docs');
  f.act({ action: 'advance', taskId: 'code' });
  f.act({ action: 'advance', taskId: 'code', evidence: 'Documented' });
  f.write('src.js', 'module.exports = 2;\n');
  const reopens = () => reviewProgress(f.root, f.store.read(), f.task()).freshTargets.map(target => [target.kind, target.taskId, target.reopens]);

  // Act
  const beforeTriage = reopens();
  close(f);
  const afterTriage = reopens();

  // Assert
  assert.deepEqual(beforeTriage, [['code', 'code', true]]);
  assert.deepEqual(afterTriage, [['code', 'code', 'if-findings']]);
});

test('status probing a cache-retained assessment leaves an absent review-input cache absent', t => {
  // Arrange
  const f = fixture(t);
  completeTask(f);
  f.store.update(actor, f.store.read().revision, 'fixture-cache-retained', state => {
    const review = state.tasks[0].reviews.find(item => item.kind === 'code');
    review.retainedInputs = { kind: 'cache-v1', digest: review.contextSnapshot.digest };
  });
  f.write('src.js', 'module.exports = 2;\n');
  const file = path.join(f.root, '.nightshift/runs/review-inputs.sqlite');

  // Act
  const reading = condition(f, 'code');

  // Assert
  assert.match(reading.next, /^Obtain a fresh cumulative assessment/);
  assert.equal(fs.existsSync(file), false);
});
