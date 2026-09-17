'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { digest, directory, processAlive, readBytes, requireValue, writeNew } = require('./io');

const PLUGIN_IDENTITY = /^nightshift@[A-Za-z0-9_.-]+$/;
const CHANGED_CONCURRENTLY = 'Nightshift preparation changed concurrently; retry the request';
const REMOVED_MESSAGE = 'Nightshift was removed from this profile or its removal is in progress; restore it explicitly before using it';

function publishBootstrap(registry, bundle) {
  const bytes = readBytes(bundle.root, 'internal/releases/bootstrap.js');
  const bootstrapHash = digest(bytes);
  let folder = directory(registry.root, `launchers/${bootstrapHash}`, true);
  if (fs.existsSync(path.join(folder, 'bootstrap.js')) && !readBytes(folder, 'bootstrap.js').equals(bytes)) folder = directory(registry.root, `launchers/${bootstrapHash}-${randomUUID()}`, true);
  const bootstrap = path.join(folder, 'bootstrap.js');
  if (!fs.existsSync(bootstrap)) writeNew(bootstrap, bytes);
  return { bootstrap, bootstrapHash };
}

function pluginIdentity(request) {
  const pluginId = request.pluginId ?? 'nightshift@astenlund';
  requireValue(PLUGIN_IDENTITY.test(pluginId), 'invalid-plugin-identity', 'Select the exact installed Nightshift marketplace identity');
  return pluginId;
}

// Automatic preparation depends on the administrative module this release introduced; an
// older bundle's applyHooks has no deliberate-disabling guard at all.
function supportsPreparation(bundleRoot) {
  return fs.existsSync(path.join(bundleRoot, 'internal/releases/administration.js'));
}

// A live or unknown pending owner is never displaced; only a dead one can be recovered.
function ownerFree(record) {
  return !record?.pending?.ownerPid || processAlive(record.pending.ownerPid) === false;
}

function retainedRoutes(previous) {
  const routes = [...(previous?.routes ?? []), ...(previous?.bootstrap ? [{ bootstrap: previous.bootstrap, bootstrapHash: previous.bootstrapHash }] : [])];
  return routes.filter((route, index) => routes.findIndex(other => other.bootstrap === route.bootstrap) === index);
}

module.exports = { CHANGED_CONCURRENTLY, REMOVED_MESSAGE, ownerFree, pluginIdentity, publishBootstrap, retainedRoutes, supportsPreparation };
