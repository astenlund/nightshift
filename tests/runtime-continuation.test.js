'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { handleHook } = require('../internal/runtime/hook');
const { transition } = require('../internal/runtime/lifecycle');
const { continuationForRequest } = require('../internal/runtime/continuation-health');
const { executeWithFixtureController, fixtureControllerClaim } = require('./fixtures/controller-claim');

const actor = { host: 'codex', session: 'continuation-owner' };
const mechanism = { verified: true, kind: 'goal', evidence: 'Observed active native goal in isolated fixture' };

function fixture(t, options = {}) {
  const parent = path.resolve(__dirname, '../.tmp/continuation-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'run-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  store.create({
    objective: 'Preserve interrupted delivery', authority: 'User agreed the work', controller: actor,
    tasks: [{ id: 'work', title: 'Work', agreement: { source: 'User', outcome: 'Deliver the agreed behavior' } }],
    ...options,
  });
  const act = request => store.update(actor, store.read().revision, request.action, state => transition(state, request));
  const hook = (event = 'Stop', session = actor.session) => handleHook({ cwd: root, session_id: session, hook_event_name: event });
  const block = kind => act({ action: 'block', taskId: 'work', blocker: { kind, reason: 'Fixture boundary', recoveryAttempted: 'Reconciled current evidence' } });
  const handover = () => act({ action: 'handover', authority: 'User handed over agreed work', mechanism });
  const invalidate = (reason = 'Native goal is blocked') => act({ action: 'invalidate-continuation', reason });
  const fail = (reason = 'Native goal inspection failed') => act({ action: 'continuation', mechanism: { verified: false, kind: 'goal', reason } });
  const claim = () => act({ action: 'claim-controller', claim: { controller: actor, process: { pid: 123, created: 'fixture-incarnation', name: 'codex.exe' }, revision: store.read().revision + 1, observedAt: new Date().toISOString() } });

  return { root, store, act, hook, block, handover, invalidate, fail, claim };
}

test('recorded handover keeps Stop protection after continuation invalidation', t => {
  const f = fixture(t);
  f.handover();
  const handover = f.store.read().handover;
  f.invalidate();
  const state = f.store.read();
  assert.equal(state.mode, undefined);
  assert.equal(state.status, 'running');
  assert.deepEqual(state.handover, handover);
  assert.equal(state.continuation.verified, false);
  assert.equal(f.hook().decision, 'block');
  assert.deepEqual(f.hook('Stop', 'former-owner'), {});
});

test('accepted delivery is protected before its continuation outcome is recorded', t => {
  const pending = fixture(t);
  assert.equal(pending.hook().decision, 'block');
  assert.equal(pending.store.read().stopRecovery.reminders, 1);

  const handed = fixture(t);
  handed.act({ action: 'handover', authority: 'User handed over with continuation unavailable' });
  assert.equal(handed.store.read().mode, undefined);
  assert.equal(handed.store.read().continuation, null);
  assert.equal(handed.hook().decision, 'block');
});

test('handover with failed continuation pauses for a user decision after workers finish', t => {
  const f = fixture(t);
  f.handover();
  f.invalidate();
  f.fail();
  f.block('user-decision');
  f.act({ action: 'worker', worker: { id: 'review', session: 'independent-reviewer', role: 'reviewer', assignment: 'Review the cumulative change', writes: [] } });
  assert.equal(f.hook().decision, 'block');
  f.act({ action: 'worker-finished', workerId: 'review', status: 'complete', evidence: 'Observed reviewer process termination' });
  const revision = f.store.read().revision;
  const pause = f.hook();
  assert.equal(pause.decision, undefined);
  assert.match(pause.systemMessage, /paused on user decisions/);
  assert.match(pause.systemMessage, /closing remains due/);
  assert.equal(f.store.read().revision, revision);
});

test('downgraded handover protects all closing stages before yielding blocked work', t => {
  const f = fixture(t);
  f.handover();
  f.invalidate();
  f.block('capability');
  assert.equal(f.hook().decision, 'block');
  f.act({ action: 'retrospective', evidence: 'Completed retrospective with the unresolved capability recorded' });
  assert.equal(f.hook().decision, 'block');
  const reportPath = '.nightshift/runs/reports/continuation.md';
  fs.mkdirSync(path.dirname(path.join(f.root, reportPath)), { recursive: true });
  fs.writeFileSync(path.join(f.root, reportPath), '# Report\n\nCapability remains unavailable.\n');
  f.act({ action: 'report', path: reportPath });
  assert.equal(f.hook().decision, 'block');
  f.act({ action: 'triage', evidence: 'Unanswered decisions preserved for the user' });
  assert.match(f.hook().systemMessage, /unfinished blocked work/);
});

test('claim refreshes and new negative observations cannot evade three Stop reminders', t => {
  const f = fixture(t);
  f.handover();
  f.invalidate();
  for (let reminder = 1; reminder <= 3; reminder++) {
    f.claim();
    f.invalidate(`Native goal remains blocked at observation ${reminder}`);
    assert.equal(f.hook().decision, 'block');
    assert.equal(f.store.read().stopRecovery.reminders, reminder);
  }
  f.claim();
  f.invalidate('Native inspection still reports no active goal');
  const revision = f.store.read().revision;
  const exhausted = f.hook();
  assert.equal(exhausted.continue, false);
  assert.match(exhausted.stopReason, /three reminders/);
  assert.equal(f.store.read().revision, revision);
  assert.equal(f.store.read().status, 'running');
});

test('real task progress resets Stop reminders after a recorded continuation failure', t => {
  const f = fixture(t);
  f.handover();
  f.invalidate();
  f.fail();
  for (let i = 0; i < 3; i++) assert.equal(f.hook().decision, 'block');
  assert.equal(f.hook().continue, false);
  f.act({ action: 'start-task', taskId: 'work' });
  assert.equal(f.hook().decision, 'block');
  assert.equal(f.store.read().stopRecovery.reminders, 1);
  assert.equal(f.store.read().mode, undefined);
});

test('explicit user interruption wins over downgraded handover protection', t => {
  const f = fixture(t);
  f.handover();
  f.invalidate();
  assert.deepEqual(f.hook('Interrupt'), {});
  assert.equal(f.store.read().status, 'stopped');
  assert.equal(f.store.read().stop.kind, 'user-stop');
  assert.deepEqual(f.hook(), {});
});

test('an exhausted deadline stops a handed-over attended run before reminding', t => {
  const f = fixture(t);
  f.handover();
  f.invalidate();
  f.store.update(actor, f.store.read().revision, 'fixture-deadline', state => { state.limits.deadlineUtc = '2000-01-01T00:00:00Z'; });
  const output = f.hook();
  assert.equal(output.continue, false);
  assert.match(output.stopReason, /deadline/);
  assert.equal(f.store.read().status, 'stopped');
  assert.equal(f.store.read().stop.kind, 'resource-limit');
  assert.equal(f.store.read().stopRecovery, undefined);
});

test('invalidation of a stopped run preserves the stop and cannot resume it', t => {
  const f = fixture(t);
  f.handover();
  f.act({ action: 'stop', kind: 'user-stop', reason: 'User paused this work' });
  const stop = f.store.read().stop;
  f.invalidate();
  assert.equal(f.store.read().status, 'stopped');
  assert.equal(f.store.read().mode, undefined);
  assert.deepEqual(f.store.read().stop, stop);
  assert.deepEqual(f.hook(), {});
});

// A delivery created through handover in its own project, for cases that need acceptance identity or the full execute path.
function accepted(t) {
  const parent = path.resolve(__dirname, '../.tmp/continuation-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'accepted-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const owner = { host: 'claude', session: randomUUID() };
  const request = { action: 'handover', controller: owner, authority: 'Explicit fixture handover', objective: 'Continue accepted work', mechanism: { verified: true, kind: 'stop-hook', evidence: 'Simulated native continuation observed' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Honor the acceptance boundary' } }] };

  return { root, owner, request };
}

for (const previous of ['absent', 'failed']) {
  test(`acceptance replay after ${previous} continuation records the observed failure and admits engineering`, async t => {
    const value = accepted(t);
    const input = { ...value.request, handoverId: randomUUID(), controllerClaim: fixtureControllerClaim(value.owner) };
    delete input.mechanism;
    const store = new RunStore(value.root, { create: true });
    try {
      const original = store.create(input);
      if (previous === 'failed') store.update(value.owner, original.revision, 'continuation', current => transition(current, { action: 'continuation', mechanism: { verified: false, kind: 'stop-hook', reason: 'Earlier fixture failure' } }));
      const replayed = store.create({ ...input, integration: { usable: false, cause: 'Changed fixture hook failure during recovery' } });
      assert.equal(replayed.id, original.id);
      assert.equal(replayed.continuation.verified, false);
      await executeWithFixtureController(value.root, { action: 'start-task', actor: value.owner, revision: replayed.revision, taskId: 'work' });
      assert.equal(store.read().tasks[0].status, 'active');
    } finally { store.close(); }
  });
}

for (const bookkeeping of ['observation-cycle', 'claim', 'acceptance-replay']) {
  test(`${bookkeeping} preserves the no-progress count across four yields`, t => {
    const value = accepted(t);
    const input = { ...value.request, handoverId: randomUUID() };
    const store = new RunStore(value.root, { create: true });
    try {
      store.create(input);
      const act = request => store.update(value.owner, store.read().revision, request.action, current => transition(current, request));
      const failure = { action: 'continuation', mechanism: { verified: false, kind: 'stop-hook', operation: 'inspect', reason: 'Unchanged fixture inspection failure' } };
      act(failure);
      const responses = [];
      for (let index = 0; index < 4; index++) {
        if (bookkeeping === 'observation-cycle') { act({ action: 'invalidate-continuation', reason: 'Refresh before yield' }); act(failure); }
        else if (bookkeeping === 'claim') store.update(value.owner, store.read().revision, 'claim-controller', current => { current.controllerClaim = { controller: value.owner, process: null, reason: 'Fixture observation', revision: current.revision + 1 }; });
        else store.create({ ...input, integration: { usable: false, cause: 'Repeated fixture admission failure' } });
        responses.push(handleHook({ cwd: value.root, session_id: value.owner.session, hook_event_name: 'Stop' }));
        if (index < 3) assert.equal(store.read().stopRecovery.reminders, index + 1);
      }
      assert.equal(responses[3].continue, false);
      assert.match(responses[3].stopReason, /three reminders/);
      store.update(value.owner, store.read().revision, 'fixture-substantive-progress', current => { current.tasks[0].status = 'active'; });
      assert.equal(handleHook({ cwd: value.root, session_id: value.owner.session, hook_event_name: 'Stop' }).decision, 'block');
      assert.equal(store.read().stopRecovery.reminders, 1);
    } finally { store.close(); }
  });
}

test('an identical admitted and supplied failure is recorded only once at creation', t => {
  const value = accepted(t);
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
    const value = accepted(t);
    const store = new RunStore(value.root, { create: true });
    try {
      const state = store.create(value.request);
      const before = structuredClone(state);
      assert.throws(() => continuationForRequest(state, { verified: false, kind: 'stop-hook', status, reason: 'An authoritative native hold' }, { usable: false, cause: 'Fixture hook admission failure' }), { code: 'continuation-held' });
      assert.deepEqual(state, before);
    } finally { store.close(); }
  });
}
