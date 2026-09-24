'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { RunStore } = require('../internal/runtime/store');
const { handleHook } = require('../internal/runtime/hook');
const { transition } = require('../internal/runtime/lifecycle');

const REPORT_PATH = '.nightshift/runs/reports/morning.md';

function writeReport(root, content = '# Morning report\n') {
  fs.mkdirSync(path.join(root, path.dirname(REPORT_PATH)), { recursive: true });
  fs.writeFileSync(path.join(root, REPORT_PATH), content);
  return REPORT_PATH;
}

test('malformed bundled-notice input stays silent without an identifiable owner', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../internal/runtime/hook.js')], { input: '{invalid', windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {});
});

test('hooks recover obligations after compaction and premature yield without taking over other sessions', t => {
  const parent = path.resolve(__dirname, '../.tmp/hook-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'run-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const actor = { host: 'codex', session: 'owner' };
  store.create({ objective: 'Deliver accepted work', authority: 'User handover', mode: 'unattended', controller: actor, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'User', outcome: 'Preserve the selection' } }] });
  const input = { cwd: root, session_id: 'owner', hook_event_name: 'Stop' };
  assert.equal(handleHook(input).decision, 'block');
  assert.deepEqual(handleHook({ ...input, session_id: 'reviewer' }), {});
  const compact = handleHook({ ...input, hook_event_name: 'SessionStart', source: 'compact' });
  assert.match(compact.hookSpecificOutput.additionalContext, /Preserve the selection/);
  assert.equal(handleHook({ ...input, stop_hook_active: true }).decision, 'block');
  assert.equal(handleHook({ ...input, stop_hook_active: true }).decision, 'block');
  assert.equal(handleHook({ ...input, stop_hook_active: true }).continue, false);
  assert.equal(store.read().status, 'running');
  store.update(actor, store.read().revision, 'recovered-continuation', state => transition(state, { action: 'continuation', mechanism: { verified: true, evidence: 'Actual recovery observed in fixture' } }));
  assert.equal(handleHook(input).decision, 'block');
  handleHook({ ...input, hook_event_name: 'Interrupt' });
  assert.equal(store.read().status, 'stopped');
  assert.deepEqual(handleHook(input), {});
});

test('delegation preserves writes, reviewer strength and controller judgment', t => {
  const parent = path.resolve(__dirname, '../.tmp/hook-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'workers-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const actor = { host: 'claude', session: 'owner' };
  store.create({ objective: 'Work', authority: 'User', controller: actor, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'User', outcome: 'Behavior' } }] });
  assert.deepEqual(handleHook({ cwd: root, session_id: actor.session, hook_event_name: 'Stop' }), {});
  assert.match(handleHook({ cwd: root, session_id: actor.session, hook_event_name: 'PreCompact' }).systemMessage, /Reconcile it after compaction/);
  const update = request => store.update(actor, store.read().revision, request.action, state => transition(state, request));
  const implementer = { id: 'writer', session: 'writer-session', assignment: 'Repair component', role: 'implementer', writes: ['src/component'] };
  update({ action: 'worker', worker: implementer });
  assert.throws(() => update({ action: 'worker', worker: { ...implementer, id: 'conflict', writes: ['src/component/child.js'] } }), { code: 'writer-conflict' });
  assert.throws(() => update({ action: 'worker', worker: { ...implementer, id: 'reviewer', role: 'reviewer' } }), { code: 'reviewer-write' });
  update({ action: 'worker', worker: { id: 'lead', session: 'lead-session', assignment: 'Broad review', role: 'reviewer', writes: [], model: 'claude-fable-5-1', effort: 'high' } });
  assert.throws(() => update({ action: 'worker', worker: { id: 'peer', session: 'peer-session', assignment: 'Review sibling', role: 'peer', lead: 'lead', writes: [], model: 'claude-opus-4-7', effort: 'high' } }), { code: 'peer-mismatch' });
  assert.throws(() => store.update({ host: 'claude', session: 'supervisor' }, store.read().revision, 'accept', state => { state.status = 'complete'; }), { code: 'wrong-owner' });
});

test('unattended Stop permits a pause on user decisions and keeps resisting every other state', t => {
  const parent = path.resolve(__dirname, '../.tmp/hook-tests');
  fs.mkdirSync(parent, { recursive: true });
  const actor = { host: 'claude', session: 'owner' };
  const agreement = { source: 'User', outcome: 'Behavior' };
  const open = ids => {
    const root = fs.mkdtempSync(path.join(parent, 'pause-'));
    const store = new RunStore(root, { create: true });
    t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
    store.create({ objective: 'Work', authority: 'User handover', mode: 'unattended', controller: actor, tasks: ids.map(id => ({ id, title: id, agreement, requires: id === 'follow' ? ['work'] : [] })) });
    const update = request => store.update(actor, store.read().revision, request.action, state => transition(state, request));
    update({ action: 'continuation', mechanism: { verified: true, evidence: 'Actual recovery observed in fixture' } });
    return { store, update, report: () => update({ action: 'report', path: writeReport(root) }), stop: () => handleHook({ cwd: root, session_id: actor.session, hook_event_name: 'Stop' }) };
  };
  const block = (run, taskId, kind) => run.update({ action: 'block', taskId, blocker: { kind, reason: 'Fixture blocker', recoveryAttempted: 'Checked prior agreement' } });

  const paused = open(['work']);
  block(paused, 'work', 'user-decision');
  const revision = paused.store.read().revision;
  const pause = paused.stop();
  assert.equal(pause.decision, undefined);
  assert.match(pause.systemMessage, /paused on user decisions for work/);
  assert.match(pause.systemMessage, /Session closing remains due/);
  assert.equal(paused.store.read().revision, revision);
  assert.equal(paused.store.read().stopRecovery, undefined);
  paused.update({ action: 'retrospective', evidence: 'Retrospective recorded before the pause' });
  assert.equal(paused.stop().decision, undefined);
  assert.equal(paused.store.read().closing.retrospectiveEvidence, 'Retrospective recorded before the pause');
  assert.throws(() => paused.update({ action: 'triage', evidence: 'Too early' }), { code: 'report-required' });
  paused.report();
  assert.equal(paused.stop().decision, undefined);
  paused.update({ action: 'triage', evidence: 'Triage recorded' });
  assert.doesNotMatch(paused.stop().systemMessage, /closing remains due/);

  const dependents = open(['work', 'follow']);
  block(dependents, 'work', 'user-decision');
  assert.equal(dependents.stop().decision, undefined);

  const independent = open(['work', 'other']);
  block(independent, 'work', 'user-decision');
  assert.equal(independent.stop().decision, 'block');

  const capability = open(['work']);
  block(capability, 'work', 'capability');
  assert.equal(capability.stop().decision, 'block');
  capability.update({ action: 'retrospective', evidence: 'Retrospective recorded' });
  assert.equal(capability.stop().decision, 'block');
  capability.report();
  assert.equal(capability.stop().decision, 'block');
  capability.update({ action: 'triage', evidence: 'Triage recorded' });
  assert.match(capability.stop().systemMessage, /unfinished blocked work/);

  const resource = open(['work']);
  block(resource, 'work', 'resource');
  assert.equal(resource.stop().decision, 'block');

  const mixed = open(['work', 'other']);
  block(mixed, 'work', 'user-decision');
  block(mixed, 'other', 'dependency');
  assert.equal(mixed.stop().decision, 'block');

  const staffed = open(['work']);
  block(staffed, 'work', 'user-decision');
  staffed.update({ action: 'worker', worker: { id: 'lead', session: 'lead-session', assignment: 'Broad review', role: 'reviewer', writes: [] } });
  assert.equal(staffed.stop().decision, 'block');
  staffed.update({ action: 'worker-finished', workerId: 'lead', status: 'complete', evidence: 'Reviewer process exited 0' });
  assert.equal(staffed.stop().decision, undefined);
});
