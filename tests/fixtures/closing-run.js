'use strict';

// A committed fixture project with a delivery run, driven through the lifecycle transition, for closing-hold tests.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { RunStore } = require('../../internal/runtime/store');
const { DIMENSIONS, commitmentsFor, obligationBrief, transition } = require('../../internal/runtime/lifecycle');
const { inventorySnapshot, snapshot, verifyCommand } = require('../../internal/runtime/evidence');
const { fixtureContinuation } = require('./continuation');
const { fixtureControllerClaim } = require('./controller-claim');
const { fixtureReport } = require('./report');

const actor = { host: 'codex', session: 'controller' };
const SPEC_PATH = '.nightshift/specs/plan.md';
const SPEC_TASK = { id: 'plan', title: 'Plan', kind: 'spec', agreement: { source: 'User', outcome: 'Assessed plan', spec: SPEC_PATH } };
const CODE_TASK = { id: 'code', title: 'Code change', agreement: { source: 'User', outcome: 'Accepted behavior' } };

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  return result.stdout.trim();
}

function closingRun(t, tasks, scratch) {
  const parent = path.resolve(__dirname, '../../.tmp', scratch);
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  const remove = file => fs.rmSync(path.join(root, file), { force: true });
  git(root, ['init', '--quiet']);
  write('src.js', 'module.exports = 1;\n');
  write('README.md', '# Project\n');
  write('.nightshift/BUGS.md', '# Bugs\n');
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish closing baseline']);
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({ mechanism: fixtureContinuation(), objective: 'Deliver accepted work', authority: 'User agreed the scope', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks });
  let sequence = 0;
  const act = request => {
    fixtureReport(store, actor, request);

    return store.update(actor, store.read().revision, request.action, state => transition(state, request));
  };
  const assessment = (kind, covered, overrides = {}) => {
    sequence++;
    const coveredTasks = store.read().tasks.filter(task => covered.includes(task.id));
    const inputs = inventorySnapshot(root, [], coveredTasks.map(task => task.agreement.spec).filter(file => typeof file === 'string'));

    return { requestId: `${kind}-${sequence}`, kind, session: `${kind}-reviewer-${sequence}`, attributionVerified: true, status: 'complete', strength: 'strong', independent: true, broad: true, dimensions: [...DIMENSIONS[kind]], coverageEvidence: 'Assessed the complete change', coveredTaskIds: covered, commitments: commitmentsFor(coveredTasks), snapshot: inputs, contextSnapshot: inputs, findings: [], ...overrides };
  };
  const review = (taskId, kind, covered = [taskId], overrides = {}) => act({ action: 'review', taskId, review: assessment(kind, covered, overrides) });
  const check = (taskId, paths = ['src.js']) => act({ action: 'check', taskId, evidence: verifyCommand(root, { name: 'Fixture check', executable: process.execPath, args: ['--version'], paths }) });
  const task = id => store.read().tasks.find(item => item.id === id);
  const brief = () => obligationBrief(store.read());
  const hold = () => brief().closing.docsReview?.outsideDocumentation;

  return { root, store, act, write, remove, assessment, review, check, task, brief, hold };
}

// Writes the spec task's governing spec, assesses it and completes the task.
function completeSpecTask(f, id = 'plan') {
  f.write(SPEC_PATH, '# Plan\n');
  f.review(id, 'spec', [id], { snapshot: snapshot(f.root, [SPEC_PATH]) });
  f.act({ action: 'advance', taskId: id });
  f.act({ action: 'advance', taskId: id, evidence: 'Spec documented' });
  assert.equal(f.task(id).status, 'complete');
}

// Verifies, assesses and completes a code task.
function completeCodeTask(f, id = 'code') {
  f.act({ action: 'start-task', taskId: id });
  f.check(id);
  f.review(id, 'code');
  f.act({ action: 'advance', taskId: id });
  f.review(id, 'docs');
  f.act({ action: 'advance', taskId: id });
  f.act({ action: 'advance', taskId: id, evidence: 'Documentation reconciled' });
  assert.equal(f.task(id).status, 'complete');
}

function closeOut(f) {
  f.act({ action: 'retrospective', evidence: 'Retrospective recorded' });
  f.act({ action: 'triage', evidence: 'Follow-ups triaged' });
}

module.exports = { CODE_TASK, SPEC_PATH, SPEC_TASK, actor, closeOut, closingRun, completeCodeTask, completeSpecTask, git };
