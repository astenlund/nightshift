'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { acceptanceCheckpoint } = require('../internal/runtime/acceptance-checkpoint');
const { readAcknowledgementFromProfile } = require('../internal/runtime/native-acknowledgement');
const { recordAcknowledgement } = require('../internal/runtime/acknowledgement');
const { executeWithFixtureController } = require('./fixtures/controller-claim');

const scratch = path.resolve(__dirname, '../.tmp/acceptance-checkpoint-tests');
fs.mkdirSync(scratch, { recursive: true });

function fixture(t, host = 'claude') {
  const directory = fs.mkdtempSync(path.join(scratch, 'case-'));
  const root = path.join(directory, 'project');
  const profile = path.join(directory, 'profile');
  fs.mkdirSync(root);
  fs.mkdirSync(profile);
  const actor = { host, session: randomUUID() };
  const store = new RunStore(root, { create: true });
  const state = store.create({ action: 'handover', controller: actor, authority: 'Fixture scope confirmation', objective: 'Inspect acknowledgement without discharging it', mechanism: { verified: false, kind: host === 'claude' ? 'stop-hook' : 'goal', operation: 'inspect', reason: 'Fixture continuation unavailable' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Preserve acknowledgement and admission' } }] });
  state.acknowledgement.renewedAt = new Date(Date.now() - 1000).toISOString();
  state.acknowledgement.requiredAfter = state.acknowledgement.renewedAt;
  state.stopRecovery = { reminders: 2, revision: state.revision };
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const text = 'Handover accepted: The fixture scope and limits. You can leave. Automatic continuation is unavailable; the failure is recorded. Resume if the session stops.';
  const file = host === 'claude' ? path.join(profile, 'projects', state.root.replace(/[^a-zA-Z0-9]/g, '-'), actor.session + '.jsonl') : path.join(profile, 'sessions/2026/10/07', 'rollout-fixture-' + actor.session + '.jsonl');
  const write = (type = 'text', content = text) => {
    const timestamp = new Date().toISOString();
    const row = host === 'claude' ? { type: 'assistant', sessionId: actor.session, cwd: state.root, uuid: randomUUID(), timestamp, message: { role: 'assistant', model: 'fixture-model', content: [{ type, [type === 'thinking' ? 'thinking' : 'text']: content }] } } : { type: 'response_item', timestamp, payload: { type: 'message', id: randomUUID(), role: 'assistant', phase: type === 'thinking' ? 'analysis' : 'commentary', content: [{ type: 'output_text', text: content }] } };
    const rows = host === 'codex' ? [{ type: 'session_meta', payload: { id: actor.session, cwd: state.root } }, row] : [row];
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  };
  const observe = current => readAcknowledgementFromProfile(current, fs.realpathSync.native(profile));
  return { root, profile, actor, store, state, file, text, write, observe };
}

for (const host of ['claude', 'codex']) {
  test(`${host} read-only checkpoint distinguishes missing text from available evidence without progress`, t => {
    const value = fixture(t, host);
    value.write('text', 'Introductory ordinary text before a read-only tool');
    const before = structuredClone(value.state);
    const missing = acceptanceCheckpoint(value.state, value.actor, null, value.observe);
    assert.equal(missing.inspection.status, 'missing');
    assert.equal(missing.nextStep, 'emit-text-then-status');
    value.write();
    const available = acceptanceCheckpoint(value.state, value.actor, null, value.observe);
    assert.equal(available.inspection.status, 'available');
    assert.equal(available.nextStep, 'request-engineering');
    assert.equal(available.inspection.reason, null);
    assert.equal(available.observedContinuation, 'failed');
    assert.deepEqual(value.state, before);
    assert.equal(value.state.acknowledgement.status, 'pending');
  });

  test(`${host} thinking and tool output never become available acknowledgement evidence`, t => {
    const value = fixture(t, host);
    value.write('thinking');
    assert.equal(acceptanceCheckpoint(value.state, value.actor, null, value.observe).inspection.status, 'missing');
    value.write('text', 'Tool receipt: ' + value.text);
    assert.equal(acceptanceCheckpoint(value.state, value.actor, null, value.observe).inspection.status, 'missing');
    assert.equal(value.state.acknowledgement.status, 'pending');
  });
}

for (const variant of ['absent', 'malformed', 'oversized']) {
  test(`${variant} history remains unavailable rather than missing or available`, t => {
    const value = fixture(t);
    if (variant === 'malformed') { value.write(); fs.appendFileSync(value.file, '{broken}\n'); }
    const observer = variant === 'oversized' ? () => { throw new Error('Native history discovery exceeded its entry bound'); } : value.observe;
    const before = structuredClone(value.state);
    const checkpoint = acceptanceCheckpoint(value.state, value.actor, null, observer);
    assert.equal(checkpoint.inspection.status, 'unavailable');
    assert.equal(checkpoint.nextStep, 'recover-history');
    assert.deepEqual(value.state, before);
  });
}

test('pending or stale outcome boundaries require recording before native inspection', t => {
  const value = fixture(t);
  const noRead = () => { throw new Error('No native read before a current outcome'); };
  for (const mutate of [state => { state.continuation = { verified: false, status: 'pending' }; }, state => { state.acknowledgement.requiredAfter = null; }, state => { state.acknowledgement.outcomeIdentity = '0'.repeat(64); }]) {
    const state = structuredClone(value.state);
    mutate(state);
    assert.equal(acceptanceCheckpoint(state, value.actor, null, noRead).inspection.status, 'awaiting-outcome');
  }
});

test('fresh admitted failure drift is projected without changing saved failure history or reminders', t => {
  const value = fixture(t);
  const before = structuredClone(value.state);
  const checkpoint = acceptanceCheckpoint(value.state, value.actor, { session: value.actor.session, integration: { usable: false, cause: 'Different current admission failure' } }, () => { throw new Error('Must reconcile the changed outcome first'); });
  assert.equal(checkpoint.inspection.status, 'awaiting-outcome');
  assert.deepEqual(value.state, before);
});

test('stale obligation or an invalid observer result preserves the duty as unavailable', t => {
  const value = fixture(t);
  const state = structuredClone(value.state);
  state.acknowledgement.scopeHash = '0'.repeat(64);
  assert.equal(acceptanceCheckpoint(state, value.actor, null, value.observe).inspection.status, 'unavailable');
  assert.equal(acceptanceCheckpoint(value.state, value.actor, null, () => ({ verified: true })).inspection.status, 'unavailable');
  assert.equal(value.state.acknowledgement.status, 'pending');
});

test('foreign views and records without a duty never inspect another native history', t => {
  const value = fixture(t);
  const noRead = () => { throw new Error('Unexpected native read'); };
  assert.equal(acceptanceCheckpoint(value.state, { ...value.actor, session: randomUUID() }, null, noRead), null);
  assert.equal(acceptanceCheckpoint(value.state, value.actor, { session: randomUUID() }, noRead), null);
  assert.equal(acceptanceCheckpoint(value.state, null, null, noRead), null);
  for (const kind of [undefined, 'review']) assert.equal(acceptanceCheckpoint({ ...value.state, kind }, value.actor, null, noRead), null);
});

test('current captured evidence survives removed history without another diagnostic read', t => {
  const value = fixture(t);
  value.write();
  recordAcknowledgement(value.state, value.observe(value.state));
  fs.rmSync(value.file);
  assert.equal(acceptanceCheckpoint(value.state, value.actor, null, () => { throw new Error('Captured evidence must not reread'); }), null);
});

test('CLI status inspection cannot discharge acknowledgement or grant an engineering transition', async t => {
  const value = fixture(t);
  await executeWithFixtureController(value.root, { action: 'claim-controller', actor: value.actor, revision: value.store.read().revision });
  await new Promise(resolve => setTimeout(resolve, 20));
  value.write();
  const before = value.store.read();
  const dependencies = { acknowledgementObserver: value.observe };
  const status = await executeWithFixtureController(value.root, { action: 'status', runId: before.id, actor: value.actor }, dependencies);
  assert.equal(status.acceptanceCheckpoint.inspection.status, 'available');
  assert.deepEqual(value.store.read(), before);
  await assert.rejects(executeWithFixtureController(value.root, { action: 'start-task', actor: value.actor, revision: before.revision, taskId: 'work' }, { acknowledgementObserver: () => null }), { code: 'acknowledgement-required' });
  assert.equal(value.store.read().tasks[0].status, 'pending');
});
