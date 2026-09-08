'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { RunStore } = require('../internal/runtime/store');
const { handleHook } = require('../internal/runtime/hook');
const { transition } = require('../internal/runtime/lifecycle');

test('malformed hook input reports unverified completion without claiming a clean state', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../internal/runtime/hook.js')], { input: '{invalid', windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(JSON.parse(result.stdout).systemMessage, /Completion is unverified/);
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
  assert.equal(handleHook({ cwd: root, session_id: actor.session, hook_event_name: 'Stop' }).decision, undefined);
  const update = request => store.update(actor, store.read().revision, request.action, state => transition(state, request));
  const implementer = { id: 'writer', session: 'writer-session', assignment: 'Repair component', role: 'implementer', writes: ['src/component'] };
  update({ action: 'worker', worker: implementer });
  assert.throws(() => update({ action: 'worker', worker: { ...implementer, id: 'conflict', writes: ['src/component/child.js'] } }), { code: 'writer-conflict' });
  assert.throws(() => update({ action: 'worker', worker: { ...implementer, id: 'reviewer', role: 'reviewer' } }), { code: 'reviewer-write' });
  update({ action: 'worker', worker: { id: 'lead', session: 'lead-session', assignment: 'Broad review', role: 'reviewer', writes: [], model: 'claude-fable-5-1', effort: 'high' } });
  assert.throws(() => update({ action: 'worker', worker: { id: 'peer', session: 'peer-session', assignment: 'Review sibling', role: 'peer', lead: 'lead', writes: [], model: 'claude-opus-4-7', effort: 'high' } }), { code: 'peer-mismatch' });
  assert.throws(() => store.update({ host: 'claude', session: 'supervisor' }, store.read().revision, 'accept', state => { state.status = 'complete'; }), { code: 'wrong-owner' });
});
