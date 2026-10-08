'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { transition } = require('../internal/runtime/lifecycle');
const { fixtureAcknowledgement } = require('./fixtures/acknowledgement');
const { executeWithFixtureController, fixtureControllerClaim } = require('./fixtures/controller-claim');
const { acknowledgementText, acknowledged, establishAcknowledgement, observationCurrent, recordAcknowledgement, renewAcknowledgement, scopeHash } = require('../internal/runtime/acknowledgement');
const { readAcknowledgementFromProfile } = require('../internal/runtime/native-acknowledgement');
const { handleHook } = require('../internal/runtime/hook');
const { continuationForRequest } = require('../internal/runtime/continuation-health');

const scratch = path.resolve(__dirname, '../.tmp/acknowledgement-tests');
fs.mkdirSync(scratch, { recursive: true });

function fixture(t, host = 'codex') {
  const directory = fs.mkdtempSync(path.join(scratch, 'case-'));
  const root = path.join(directory, 'project');
  const profile = path.join(directory, 'profile');
  fs.mkdirSync(root);
  fs.mkdirSync(profile);
  const actor = { host, session: randomUUID() };
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, root, profile, actor, request: { action: 'handover', controller: actor, authority: 'Explicit fixture handover', objective: 'Observe acknowledgement before engineering', mechanism: { verified: true, kind: host === 'claude' ? 'stop-hook' : 'goal', evidence: 'Simulated native continuation observed' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Honor the acceptance boundary' } }] } };
}

function nativeFile(value, state, overrides = {}) {
  const timestamp = new Date().toISOString();
  const text = 'Handover accepted: Honor the fixture scope and its limits. You can leave.';
  const row = value.actor.host === 'claude'
    ? { type: 'assistant', sessionId: value.actor.session, cwd: state.root, uuid: randomUUID(), timestamp, isSidechain: false, message: { role: 'assistant', model: 'fixture-model', content: [{ type: 'text', text }] }, ...overrides }
    : { type: 'response_item', timestamp, payload: { type: 'message', id: randomUUID(), role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text }] }, ...overrides };
  const file = value.actor.host === 'claude'
    ? path.join(value.profile, 'projects', state.root.replace(/[^a-zA-Z0-9]/g, '-'), value.actor.session + '.jsonl')
    : path.join(value.profile, 'sessions/2026/10/07', 'rollout-fixture-' + value.actor.session + '.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const rows = value.actor.host === 'codex' ? [{ type: 'session_meta', payload: { id: value.actor.session, cwd: state.root } }, row] : [row];
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

for (const host of ['claude', 'codex']) {
  test(`${host} native visible output supplies attributed acknowledgement evidence`, t => {
    const value = fixture(t, host);
    const store = new RunStore(value.root, { create: true });
    try {
      const state = store.create(value.request);
      const earlier = new Date(Date.now() - 1000).toISOString();
      state.acknowledgement.renewedAt = earlier;
      state.acknowledgement.requiredAfter = earlier;
      nativeFile(value, state);
      const observation = readAcknowledgementFromProfile(state, fs.realpathSync.native(value.profile));
      assert.equal(observationCurrent(state, observation), true);
      recordAcknowledgement(state, observation);
      assert.equal(acknowledged(state), true);
      fs.rmSync(observation.source.path);
      assert.equal(establishAcknowledgement(state, null, () => { throw new Error('Historical evidence must not reread a removed source'); }), null);
    } finally { store.close(); }
  });
}

for (const variant of ['user', 'analysis', 'quoted', 'synthetic', 'sidechain']) {
  test(`native ${variant} output cannot discharge the acknowledgement obligation`, t => {
    const host = ['synthetic', 'sidechain'].includes(variant) ? 'claude' : 'codex';
    const value = fixture(t, host);
    const store = new RunStore(value.root, { create: true });
    try {
      const state = store.create(value.request);
      const earlier = new Date(Date.now() - 1000).toISOString();
      state.acknowledgement.renewedAt = earlier;
      state.acknowledgement.requiredAfter = earlier;
      const text = 'Handover accepted: Fixture scope. You can leave.';
      const overrides = variant === 'synthetic' ? { message: { role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text }] } }
        : variant === 'sidechain' ? { isSidechain: true }
        : { payload: { type: 'message', role: variant === 'user' ? 'user' : 'assistant', phase: variant === 'analysis' ? 'analysis' : 'commentary', content: [{ type: 'output_text', text: variant === 'quoted' ? 'Example: ' + text : text }] } };
      nativeFile(value, state, overrides);
      assert.equal(readAcknowledgementFromProfile(state, fs.realpathSync.native(value.profile)), null);
      assert.equal(state.acknowledgement.status, 'pending');
    } finally { store.close(); }
  });
}

test('runtime engineering refuses a missing message while hold remains available', async t => {
  const value = fixture(t);
  const accepted = await executeWithFixtureController(value.root, value.request);
  const dependencies = { acknowledgementObserver: () => null };
  await assert.rejects(executeWithFixtureController(value.root, { action: 'start-task', actor: value.actor, revision: accepted.revision, taskId: 'work' }, dependencies), { code: 'acknowledgement-required' });
  const held = await executeWithFixtureController(value.root, { action: 'hold', actor: value.actor, revision: accepted.revision, authority: 'Explicit user pause', reason: 'Wait for acknowledgement evidence' }, dependencies);
  assert.equal(held.status, 'stopped');
  const store = new RunStore(value.root);
  try { assert.equal(store.read().acknowledgement.status, 'pending'); assert.equal(store.read().workers.length, 0); } finally { store.close(); }
});

test('acknowledgement and dependent transition commit together or both roll back', t => {
  const value = fixture(t);
  const store = new RunStore(value.root, { create: true });
  try {
    const state = store.create(value.request);
    store.acknowledgementObservation = fixtureAcknowledgement(state);
    assert.throws(() => store.update(value.actor, state.revision, 'fixture-failure', () => { throw new Error('Dependent transition failed'); }), /Dependent transition failed/);
    assert.equal(store.read().acknowledgement.status, 'pending');
    assert.equal(store.read().revision, state.revision);
    const started = store.update(value.actor, state.revision, 'start-task', current => transition(current, { action: 'start-task', taskId: 'work' }));
    assert.equal(started.acknowledgement.status, 'observed');
    assert.equal(started.tasks[0].status, 'active');
  } finally { store.close(); }
});

test('an unchanged-outcome material decision renews the binding and rejects prior output', t => {
  const value = fixture(t);
  const store = new RunStore(value.root, { create: true });
  try {
    const state = store.create(value.request);
    const previous = fixtureAcknowledgement(state);
    recordAcknowledgement(state, previous);
    const originalHash = scopeHash(state);
    state.tasks[0].agreement.decisions = ['Do not export credentials'];
    state.tasks[0].requirementsRevision = 4;
    renewAcknowledgement(state, 4, new Date(Date.parse(previous.emittedAt) + 1).toISOString());
    assert.notEqual(scopeHash(state), originalHash);
    assert.equal(observationCurrent(state, previous), false);
    const current = fixtureAcknowledgement(state);
    assert.equal(observationCurrent(state, current), true);
    recordAcknowledgement(state, current);
    assert.equal(acknowledged(state), true);
  } finally { store.close(); }
});

test('failed continuation acknowledgement must disclose its consequences', () => {
  assert.equal(acknowledgementText('Handover accepted: The agreed scope. You can leave.', true), false);
  assert.equal(acknowledgementText('Handover accepted: The agreed scope. You can leave. Automatic continuation is unavailable; the failure is recorded. Resume this session if it stops.', true), true);
});

for (const variant of ['missing', 'bom', 'malformed', 'wrong-session']) {
  test(`native ${variant} history remains unavailable evidence`, t => {
    const value = fixture(t);
    const store = new RunStore(value.root, { create: true });
    try {
      const state = store.create(value.request);
      if (variant !== 'missing') {
        const file = nativeFile(value, state);
        if (variant === 'bom') fs.writeFileSync(file, Buffer.concat([Buffer.from([239, 187, 191]), fs.readFileSync(file)]));
        if (variant === 'malformed') fs.appendFileSync(file, '{broken}\n');
        if (variant === 'wrong-session') fs.writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: randomUUID(), cwd: state.root } }) + '\n');
      }
      assert.throws(() => readAcknowledgementFromProfile(state, fs.realpathSync.native(value.profile)), { code: 'acknowledgement-source-unavailable' });
      assert.equal(state.acknowledgement.status, 'pending');
    } finally { store.close(); }
  });
}

for (const previous of ['absent', 'failed']) {
  test(`acceptance replay reconciles acknowledgement after ${previous} continuation`, async t => {
    const value = fixture(t, 'claude');
    const input = { ...value.request, handoverId: randomUUID(), controllerClaim: fixtureControllerClaim(value.actor) };
    delete input.mechanism;
    const store = new RunStore(value.root, { create: true });
    try {
      const original = store.create(input);
      if (previous === 'failed') store.update(value.actor, original.revision, 'continuation', current => transition(current, { action: 'continuation', mechanism: { verified: false, kind: 'stop-hook', reason: 'Earlier fixture failure' } }));
      const replayed = store.create({ ...input, integration: { usable: false, cause: 'Changed fixture hook failure during recovery' } });
      assert.equal(replayed.id, original.id);
      assert.equal(replayed.acknowledgement.requiredAfter, replayed.continuation.observedAt);
      const boundary = replayed.acknowledgement.requiredAfter;
      const repeated = store.create({ ...input, integration: { usable: false, cause: 'Changed fixture hook failure during recovery' } });
      assert.equal(repeated.acknowledgement.requiredAfter, boundary);
      const admitted = await executeWithFixtureController(value.root, { action: 'start-task', actor: value.actor, revision: repeated.revision, taskId: 'work' });
      assert.equal(admitted.acknowledgement.current, true);
      assert.equal(store.read().tasks[0].status, 'active');
    } finally { store.close(); }
  });
}

for (const bookkeeping of ['observation-cycle', 'claim', 'acceptance-replay']) {
  test(`${bookkeeping} preserves the no-progress count across four yields`, t => {
    const value = fixture(t, 'claude');
    const input = { ...value.request, handoverId: randomUUID() };
    const store = new RunStore(value.root, { create: true });
    try {
      store.create(input);
      const act = request => store.update(value.actor, store.read().revision, request.action, current => transition(current, request));
      const failure = { action: 'continuation', mechanism: { verified: false, kind: 'stop-hook', operation: 'inspect', reason: 'Unchanged fixture inspection failure' } };
      act(failure);
      const responses = [];
      for (let index = 0; index < 4; index++) {
        if (bookkeeping === 'observation-cycle') { act({ action: 'invalidate-continuation', reason: 'Refresh before yield' }); act(failure); }
        else if (bookkeeping === 'claim') store.update(value.actor, store.read().revision, 'claim-controller', current => { current.controllerClaim = { controller: value.actor, process: null, reason: 'Fixture observation', revision: current.revision + 1 }; });
        else store.create({ ...input, integration: { usable: false, cause: 'Repeated fixture admission failure' } });
        responses.push(handleHook({ cwd: value.root, session_id: value.actor.session, hook_event_name: 'Stop' }));
        if (index < 3) assert.equal(store.read().stopRecovery.reminders, index + 1);
      }
      assert.equal(responses[3].continue, false);
      assert.match(responses[3].stopReason, /three reminders/);
      store.update(value.actor, store.read().revision, 'fixture-substantive-progress', current => { current.tasks[0].status = 'active'; });
      assert.equal(handleHook({ cwd: value.root, session_id: value.actor.session, hook_event_name: 'Stop' }).decision, 'block');
      assert.equal(store.read().stopRecovery.reminders, 1);
    } finally { store.close(); }
  });
}

test('an identical admitted and supplied failure is recorded only once at creation', t => {
  const value = fixture(t, 'claude');
  const reason = 'Fixture hook admission is unavailable';
  const store = new RunStore(value.root, { create: true });
  try {
    const state = store.create({ ...value.request, integration: { usable: false, cause: reason }, mechanism: { verified: false, kind: 'stop-hook', operation: 'hook-admission', reason } });
    assert.equal(state.followups.length, 1);
    assert.equal(state.followups[0].continuationFailure.occurrences, 1);
    assert.equal(state.continuation.operation, 'hook-admission');
  } finally { store.close(); }
});

for (const status of ['paused', 'stopped', 'limited', 'usageLimited', 'budgetLimited']) {
  test(`fresh unusable integration cannot reinterpret a ${status} native mechanism`, t => {
    const value = fixture(t, 'claude');
    const store = new RunStore(value.root, { create: true });
    try {
      const state = store.create(value.request);
      const before = structuredClone(state);
      assert.throws(() => continuationForRequest(state, { verified: false, kind: 'stop-hook', status, reason: 'An authoritative native hold' }, { usable: false, cause: 'Fixture hook admission failure' }), { code: 'continuation-held' });
      assert.deepEqual(state, before);
    } finally { store.close(); }
  });
}
