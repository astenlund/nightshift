'use strict';

// Replaces a package copy's internal/releases/launcher.js so the real retained bootstrap can route a native hook into the copy's
// real release service. A test process has no host ancestry or host settings to inspect, so the native observations match the
// in-process simulated service: the test process named by NIGHTSHIFT_FIXTURE_OWNER_PID is the live host.
const { ReleaseService } = require('./service');

const owner = { found: true, pid: Number(process.env.NIGHTSHIFT_FIXTURE_OWNER_PID), created: 'fixture-process', name: 'codex.exe' };

async function route(request, context = {}) {
  const service = new ReleaseService(context.store, {
    discover: async () => ({}),
    inspectHooks: async () => ({ configured: true, disabled: false, usable: true, entries: [] }),
    nativeOwner: () => owner,
    ownerAlive: candidate => candidate?.pid === owner.pid,
  }, context);
  process.stdout.write(JSON.stringify(await service.hook(context.registration, request.hookInput)) + '\n');
}

module.exports = { route };
