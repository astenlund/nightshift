'use strict';

const { isDeepStrictEqual } = require('node:util');
const { execute } = require('../../internal/runtime/cli');

function nativeController(host) {
  return { pid: 44001, created: 'fixture-native-controller-incarnation', name: `${host}.exe` };
}

function fixtureControllerClaim(actor) {
  return { controller: { ...actor }, process: nativeController(actor.host), reason: null, revision: 0, observedAt: '2026-09-21T00:00:00.000Z' };
}

// Inject an explicit native observation without creating or refreshing a claim.
// Missing claims, mismatched actors and stale revisions still reach production guards.
function executeWithFixtureController(root, request, overrides = {}) {
  return execute(root, request, {
    nativeOwner: nativeController,
    ownerAlive: observed => ['claude', 'codex'].some(host => isDeepStrictEqual(observed, nativeController(host))) ? true : null,
    information: pid => ({ found: true, pid, created: `fixture-helper-${pid}`, name: 'node.exe' }),
    ...overrides,
  });
}

module.exports = { fixtureControllerClaim, executeWithFixtureController };
