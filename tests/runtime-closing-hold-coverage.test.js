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
// A governing spec Git ignores and that lies outside the documentation paths, so only an assessment that selected it saw it.
const SPEC = 'private/spec.md';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

let sessions = 0;

// A fixture host returning a complete report with the given coverage and findings, as native Claude or Codex events.
function fakeAgent(options, { findings = [], dimensions = DIMENSIONS.code } = {}) {
  fs.mkdirSync(options.artifacts, { recursive: true });
  const request = JSON.parse(fs.readFileSync(path.join(options.artifacts, '..', 'request.json'), 'utf8'));
  const report = { requestId: request.id, status: 'complete', coverage: dimensions.map(dimension => ({ dimension, evidence: 'Assessed the change' })), findings, probes: [], summary: 'Fixture report', toolFailure: '' };
  if (request.kind !== 'skeptic') Object.assign(report, { closures: [], applicability: [], positions: [] });
  const session = `session-${++sessions}`;
  const events = options.host === 'codex'
    ? [{ id: 2, result: { thread: { id: session }, model: options.model } }, { method: 'item/completed', params: { threadId: session, item: { type: 'agentMessage', text: JSON.stringify(report) } } }, { method: 'turn/completed', params: { threadId: session, turn: { status: 'completed' } } }]
    : [{ type: 'assistant', session_id: session, message: { model: options.model, content: [] } }, { type: 'result', session_id: session, subtype: 'success', is_error: false, structured_output: report }];
  fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  return { host: options.host, model: options.model, effort: options.effort, session, attributionVerified: true, status: 'complete', output: report, tokens: 0 };
}

// A committed project whose code task is governed by the ignored spec, beside a lore task, with both tasks assessed, completed and
// triaged through the actual runtime boundary.
async function triagedRun(t) {
  const parent = path.resolve(__dirname, '../.tmp/closing-hold-coverage-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  git(root, ['init', '--quiet']);
  fs.writeFileSync(path.join(root, '.gitignore'), 'private/\n');
  fs.writeFileSync(path.join(root, 'subject.txt'), 'before\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish closing hold baseline']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);
  fs.mkdirSync(path.join(root, 'private'));
  fs.writeFileSync(path.join(root, SPEC), '# Governing spec\n');
  fs.writeFileSync(path.join(root, 'subject.txt'), 'after\n');
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({
    mechanism: fixtureContinuation(), objective: 'Deliver the accepted change', authority: 'User agreed the scope', controller: actor, controllerClaim: fixtureControllerClaim(actor),
    tasks: [
      { id: 'code', title: 'Implementation', agreement: { source: 'User', outcome: 'Implement the governed behavior', spec: SPEC, specReviewed: true } },
      { id: 'lessons', title: 'Lore', kind: 'lore', requires: ['code'], agreement: { source: 'User', outcome: 'Assessed instruction proposal' } },
    ],
  });
  const base = { baseSha, requirements: 'Implement the governed behavior', rules: 'Do not mutate reviewed inputs.' };
  // Every dispatch runs the fixture host; one without it would launch a real model, so it fails instead.
  const act = (request, overrides = { runAgent: () => assert.fail('Unexpected dispatch without the fixture host') }) => executeWithFixtureController(root, { actor, revision: store.read().revision, taskId: 'code', ...request }, overrides);
  const receipt = result => path.relative(root, result.receiptFile).split(path.sep).join('/');
  const dispatch = (review, agent = {}, taskId = 'code') => act({ action: 'dispatch', taskId, review: { ...base, ...review } }, { runAgent: options => fakeAgent(options, agent) });
  const imported = async (taskId, review, agent) => {
    const result = await dispatch(review, agent, taskId);
    await act({ action: 'review', taskId, receipt: receipt(result) });
    return result;
  };

  await act({ action: 'start-task' });
  await act({ action: 'check', check: { name: 'Fixture check', executable: process.execPath, args: ['--version'], paths: ['subject.txt'] } });
  const lead = await imported('code', { kind: 'code', candidates: [LEAD] });
  await act({ action: 'advance' });
  await imported('code', { kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs });
  await act({ action: 'advance' });
  await act({ action: 'advance', evidence: 'Documented' });
  const lore = await imported('lessons', { kind: 'code', candidates: [LEAD] });
  await act({ action: 'advance', taskId: 'lessons' });
  await act({ action: 'advance', taskId: 'lessons', evidence: 'Proposal assessed; no instruction applied' });
  await act({ action: 'triage', evidence: 'Follow-ups triaged' });
  const brief = () => obligationBrief(store.read());

  return { root, store, act, dispatch, imported, receipt, lead, lore, brief };
}

test('a code assessment whose scope never held a changed ignored governing spec does not settle the closing hold', async t => {
  // Arrange
  const f = await triagedRun(t);
  assert.equal(f.lore.receipt.snapshot.files.some(file => file.path === SPEC), false, 'the lore assessment did not select the ignored spec');
  assert.equal(f.lead.receipt.snapshot.files.some(file => file.path === SPEC), true, 'the code assessment selected its governing spec');

  // Act
  fs.writeFileSync(path.join(f.root, SPEC), '# Governing spec, edited after triage\n');
  const brief = f.brief();
  const docs = await f.dispatch({ kind: 'docs', candidates: [COUNTERPART] }, { dimensions: DIMENSIONS.docs, findings: [{ id: 'claim', severity: 'important', required: true, consequence: 'The documentation misstates the change', evidence: 'Concrete passage', surfaces: [], basis: [] }] });
  await f.act({ action: 'review', receipt: f.receipt(docs) });
  const claim = f.store.read().tasks[0].findings.at(-1);
  const skeptic = await f.dispatch({ kind: 'skeptic', candidates: [LEAD], findings: [claim] }, { findings: [{ id: claim.id, verdict: 'confirmed', evidence: 'Reproduced', value: 'Worth deciding', repairProposal: 'Restate the claim' }] });
  await f.act({ action: 'validate', receipt: f.receipt(skeptic), findingId: claim.id });
  await f.act({ action: 'dispose', findingId: claim.id, disposition: 'implement', reason: 'Required', obligation: { classification: 'required', basis: 'Claim accuracy' } });
  await f.act({ action: 'repair', findingIds: [claim.id] });
  const after = f.brief();

  // Assert
  const lore = brief.assessmentApplicability.find(item => item.taskId === 'lessons' && item.kind === 'code');
  assert.equal(lore.status, 'applicable');
  assert.deepEqual(brief.closing.docsReview.outsideDocumentation?.changedPaths, [SPEC]);
  const code = brief.assessmentApplicability.find(item => item.taskId === 'code' && item.kind === 'code');
  assert.deepEqual(code.changedPaths, [SPEC]);
  assert.match(code.next, /cannot settle the outside-documentation hold/);
  assert.deepEqual(after.closing.outsideDocumentation?.changedPaths, [SPEC]);
  const target = after.next.find(item => item.id === 'code').review.freshTargets.find(item => item.kind === 'code');
  assert.deepEqual(target.staleChanges.map(change => [change.requestId, change.applicabilityCall]), [[f.lead.receipt.requestId, null]]);
});

test('a code assessment whose scope selected the changed ignored governing spec settles the closing hold', async t => {
  // Arrange
  const f = await triagedRun(t);
  fs.writeFileSync(path.join(f.root, SPEC), '# Governing spec, edited after triage\n');
  assert.deepEqual(f.brief().closing.docsReview.outsideDocumentation?.changedPaths, [SPEC]);

  // Act
  const selected = await f.imported('lessons', { kind: 'code', candidates: [LEAD], artifactPaths: [SPEC] });

  // Assert
  assert.equal(selected.receipt.contextSnapshot.includedPaths.includes(SPEC), true);
  assert.equal(f.store.read().tasks.find(task => task.id === 'lessons').status, 'complete');
  assert.equal(f.brief().closing.docsReview.outsideDocumentation, undefined);
});
