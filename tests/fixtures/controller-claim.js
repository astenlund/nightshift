'use strict';

const { isDeepStrictEqual } = require('node:util');
const { execute } = require('../../internal/runtime/cli');
const { RunStore } = require('../../internal/runtime/store');
const { fixtureReport } = require('./report');
const { fixtureAcknowledgement } = require('./acknowledgement');

function nativeController(host) {
  return { pid: 44001, created: 'fixture-native-controller-incarnation', name: `${host}.exe` };
}

function fixtureControllerClaim(actor) {
  return { controller: { ...actor }, process: nativeController(actor.host), reason: null, revision: 0, observedAt: '2026-09-21T00:00:00.000Z' };
}

// Inject explicit process and assistant-output observations without refreshing a claim.
// Missing claims, mismatched actors and stale revisions still reach production guards.
function executeWithFixtureController(root, request, overrides = {}) {
  if (request.action === 'triage' && !request.reviewContextId) {
    const store = new RunStore(root);
    try {
      const state = store.read();
      if (state && state.revision === request.revision && isDeepStrictEqual(state.controller, request.actor)) {
        fixtureReport(store, request.actor, request);
        request = { ...request, revision: store.read().revision };
      }
    } finally { store.close(); }
  }
  return execute(root, request, {
    nativeOwner: nativeController,
    ownerAlive: observed => ['claude', 'codex'].some(host => isDeepStrictEqual(observed, nativeController(host))) ? true : null,
    information: pid => ({ found: true, pid, created: `fixture-helper-${pid}`, name: 'node.exe' }),
    acknowledgementObserver: fixtureAcknowledgement,
    ...overrides,
  });
}

module.exports = { fixtureControllerClaim, executeWithFixtureController };
