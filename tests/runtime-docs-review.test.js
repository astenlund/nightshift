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
const { DIMENSIONS, commitmentsFor, isDocumentationPath, obligationBrief, transition } = require('../internal/runtime/lifecycle');
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
    return { requestId: `${kind}-${sequence}`, kind, session: `${kind}-reviewer-${sequence}`, attributionVerified: true, status: 'complete', strength: 'strong', independent: true, broad: true, dimensions: [...DIMENSIONS[kind]], coverageEvidence: 'Assessed the complete change', coveredTaskIds: covered, commitments: commitmentsFor(coveredTasks), snapshot: inventorySnapshot(root), contextSnapshot: inventorySnapshot(root), findings, ...overrides };
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
  return { id, severity: 'important', required: true, consequence, evidence: 'Concrete passage compared with the change' };
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
    const report = { requestId: options.schema.properties.requestId.enum[0], status: 'complete', coverage: dimensions.map(dimension => ({ dimension, evidence: 'Assessed the change' })), findings, probes: [], summary: 'Assessment complete' };
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
  assert.throws(() => f.act({ action: 'advance', taskId: 'code' }), { code: 'review-required' });
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
  assert.throws(() => exempt.act({ action: 'complete' }), { code: 'docs-review-required', message: /Missing for: docs$/ });
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

test('a docs task that imported a code assessment gains backlog relief from its docs review', t => {
  const f = fixture(t, [{ id: 'docs', title: 'Guide and skill', kind: 'docs', agreement: { source: 'User', outcome: 'Reconcile the guide and the skill' } }]);
  f.review('docs', 'code');
  f.act({ action: 'advance', taskId: 'docs' });
  f.write(BACKLOG, '# Bugs\n\nArchived entry.\n');
  assert.throws(() => f.act({ action: 'advance', taskId: 'docs', evidence: 'Reconciled' }), { code: 'review-required', message: /latest assessment is stale/ });
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

test('a closing review is refused when anything outside the documentation it covers changed since triage, unless the user excluded it', t => {
  const f = fixture(t);
  completeTask(f);
  close(f);
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  f.write(NESTED_DOC, '# Guide\n\nUser work in progress.\n');
  assert.throws(() => f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code']) }), { code: 'closing-scope', message: /docs\/guide\.md/ });
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

  // A change outside the backlog cannot take a closing review; a fresh cumulative task assessment has seen it instead.
  const { f: assessed, baseline: assessedBaseline } = run();
  assessed.write('src.js', 'module.exports = 2;\n');
  assert.throws(() => assessed.act({ action: 'review', taskId: CLOSING_TARGET, review: assessed.assessment('docs', ['lessons']) }), { code: 'closing-scope' });
  assessed.review('lessons', 'code');
  assessed.act({ action: 'advance', taskId: 'lessons' });
  assessed.act({ action: 'retrospective', evidence: 'Retrospective after the assessment' });
  assessed.act({ action: 'triage', evidence: 'Follow-ups triaged after the assessment' });
  assert.notEqual(assessed.store.read().closing.docs.baseline.digest, assessedBaseline);
  assert.equal(assessed.act({ action: 'complete' }).status, 'complete');
});

test('lore assessments gain backlog relief only from the closing review, and spec assessments never do', t => {
  const f = fixture(t, [CODE_TASK, { id: 'lessons', title: 'Lore', kind: 'lore', agreement: { source: 'User', outcome: 'Assessed instruction proposal' } }]);
  completeTask(f);
  f.review('lessons', 'code');
  f.act({ action: 'advance', taskId: 'lessons' });
  f.act({ action: 'advance', taskId: 'lessons', evidence: 'Proposal assessed; no instruction applied' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
  f.write(BACKLOG, '# Bugs\n\nTracked follow-up.\n');
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code']) });
  assert.throws(() => f.act({ action: 'complete' }), { code: 'stale-review' });
  f.act({ action: 'review', taskId: CLOSING_TARGET, review: f.assessment('docs', ['code', 'lessons']) });
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

  // A baseline that could not be captured inside a Git worktree fails closed until triage is recorded again.
  const lost = run();
  lost.store.update(actor, lost.store.read().revision, 'fixture-lost-baseline', state => { state.closing.docs.baseline = null; });
  assert.throws(() => lost.act({ action: 'complete' }), { code: 'closing-review-required' });
  lost.act({ action: 'triage', evidence: 'Triage recorded again' });
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
  assert.throws(() => f.act({ action: 'complete' }), { code: 'closing-review-unresolved' });
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
