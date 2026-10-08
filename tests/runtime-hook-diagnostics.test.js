'use strict';

const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { classifyHooks } = require('../internal/releases/host-config');
const { hookAdmissionAliases } = require('../internal/releases/hook-diagnostics');
const { observeIntegration, verifiedContinuation, continuationOutcomeCurrent, continuationForRequest } = require('../internal/runtime/continuation-health');

const conditions = [
  { state: 'disabled', native: { disabled: true, configured: true, usable: false }, legacy: 'Nightshift hooks are disabled; enable them explicitly before using Nightshift' },
  { state: 'unconfigured', native: { disabled: false, configured: false, usable: false }, legacy: 'Nightshift hooks were removed or changed; reconcile them explicitly before using Nightshift' },
  { state: 'untrusted', native: { disabled: false, configured: true, usable: false }, legacy: 'Nightshift hooks are not trusted on this host; restore native trust and reopen the session' },
];

function state(host) {
  return { kind: 'delivery', id: randomUUID(), controller: { host, session: randomUUID() }, followups: [] };
}

for (const host of ['claude', 'codex']) {
  for (const condition of conditions) {
    test(`${host} ${condition.state} wording changes preserve the existing failure episode`, () => {
      const value = state(host);
      observeIntegration(value, { usable: false, state: condition.state, cause: condition.legacy });
      const original = structuredClone(value.followups[0]);
      if (host === 'codex') value.continuation = verifiedContinuation(value, { verified: true, kind: 'goal', evidence: 'Independently observed native goal' });
      const goal = structuredClone(value.continuation);
      const verdict = classifyHooks(condition.native, { continuationOptional: true });
      for (const reason of hookAdmissionAliases(verdict.message)) {
        observeIntegration(value, { usable: false, state: condition.state, cause: reason });
        assert.equal(continuationOutcomeCurrent(value), true);
      }
      assert.equal(value.followups.length, 1);
      assert.equal(value.followups[0].id, original.id);
      assert.equal(value.followups[0].continuationFailure.key, original.continuationFailure.key);
      assert.equal(value.followups[0].context, original.context);
      assert.equal(value.followups[0].evidence, original.evidence);
      assert.equal(value.followups[0].status, 'pending');
      assert.equal(value.followups[0].continuationFailure.occurrences, 4);
      assert.match(verdict.message, /hook integration is unavailable/);
      assert.doesNotMatch(verdict.message, /automatic continuation is unavailable/);
      if (host === 'codex') assert.deepEqual(value.continuation, goal);
      else assert.equal(value.continuation.followupId, original.id);
    });
  }
}

test('hook failure aliases do not merge distinct causes, operations or arbitrary errors', () => {
  const value = state('claude');
  const disabled = classifyHooks(conditions[0].native, { continuationOptional: true }).message;
  observeIntegration(value, { usable: false, cause: disabled });
  const first = value.followups[0].id;
  observeIntegration(value, { usable: false, cause: disabled + '; distinct transport context' });
  observeIntegration(value, { usable: false, cause: classifyHooks(conditions[2].native, { continuationOptional: true }).message });
  continuationForRequest(value, { verified: false, kind: 'stop-hook', operation: 'native-observation', reason: disabled });
  assert.equal(value.followups.length, 4);
  assert.equal(value.followups[0].id, first);
  assert.equal(value.followups[0].continuationFailure.occurrences, 1);
});

test('resolved historical episodes stay resolved and a recurrence retains their key lineage', () => {
  const value = state('claude');
  observeIntegration(value, { usable: false, cause: conditions[0].legacy });
  const original = structuredClone(value.followups[0]);
  value.followups[0].status = 'resolved';
  observeIntegration(value, { usable: false, cause: classifyHooks(conditions[0].native, { continuationOptional: true }).message });
  assert.equal(value.followups.length, 2);
  assert.equal(value.followups[0].status, 'resolved');
  assert.equal(value.followups[1].status, 'pending');
  assert.equal(value.followups[1].continuationFailure.key, original.continuationFailure.key);
  assert.equal(value.followups[1].id, original.id + '-2');
  assert.equal(continuationOutcomeCurrent(value), true);
});

test('failure episode aliases retain run and controller attribution boundaries', () => {
  const value = state('claude');
  observeIntegration(value, { usable: false, cause: conditions[0].legacy });
  const original = structuredClone(value.followups[0]);
  value.controller = { host: 'claude', session: randomUUID() };
  assert.equal(continuationOutcomeCurrent(value), false);
  observeIntegration(value, { usable: false, cause: classifyHooks(conditions[0].native, { continuationOptional: true }).message });
  assert.equal(value.followups.length, 2);
  assert.equal(value.followups[0].id, original.id);
  assert.notEqual(value.followups[1].id, original.id);
  value.id = randomUUID();
  assert.equal(continuationOutcomeCurrent(value), false);
});
