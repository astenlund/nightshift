'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { registrationKey, sessionKey } = require('./registry');
const { projectRoot, requireConsistentRunId, requireValue, text } = require('./io');
const { CHANGED_CONCURRENTLY, REMOVED_MESSAGE, ownerFree, pluginIdentity, publishBootstrap, retainedRoutes, supportsPreparation } = require('./administration');
const { classifyHooks } = require('./host-config');

async function prepare(service, request, locatorState) {
  const profile = fs.realpathSync.native(text(request.profile, 'host profile'));
  const project = projectRoot(request.project);
  const session = text(request.session, 'native session');
  const key = registrationKey(request.host, profile);
  // A retained bootstrap authenticates the registration before dispatching here; a request
  // naming a different installation must not be prepared under the authenticated lease.
  requireValue(!request.registration || request.registration === key, 'configuration-conflict', 'The request names a different registration than the one this launcher authenticated');
  const pluginId = pluginIdentity(request);
  requireConsistentRunId(request);
  const locator = locatorState(profile).value;
  requireValue(!locator || ['registered', 'removed'].includes(locator.state), 'configuration-conflict', 'Nightshift configuration has an unrecognized state; preserve it for recovery');
  requireValue(!locator || locator.store === service.store && locator.registration === key, 'configuration-conflict', 'Nightshift configuration points to a different installation; reconcile it before continuing');
  requireValue(locator?.state !== 'removed', 'nightshift-disabled', REMOVED_MESSAGE);
  const exists = fs.existsSync(path.join(service.store, 'registry.sqlite'));
  requireValue(exists || !locator, 'configuration-conflict', 'Nightshift configuration exists but its saved resources are missing; recover them before continuing');
  let current = exists ? service.registry(registry => registry.get('registration', key)) : null;
  requireValue(!locator || current, 'configuration-conflict', 'Nightshift configuration has no matching saved registration; reconcile it before continuing');
  requireValue(current?.state !== 'removed' && current?.pending?.remove !== true, 'nightshift-disabled', REMOVED_MESSAGE);
  requireValue(!current || current.host === request.host && current.profile === profile && current.pluginId === pluginId, 'configuration-conflict', 'Nightshift registration does not match the selected installation');
  requireValue(ownerFree(current), 'release-setup-busy', 'Another Nightshift preparation is still active or needs recovery; retry after it finishes');
  const binding = exists ? service.registry(registry => registry.get('session', sessionKey(key, session))) : null;
  requireValue(!binding || binding.state === 'bound', 'retired-release-binding', 'This session was retired; explicitly recover its exact identity before resuming');
  await service.dependencies.isEnabled(request.host, profile, pluginId, project);
  const inspect = async registration => {
    const inspection = registration ? { ...registration, definitions: registration.definitions ?? registration.pending?.definitions ?? {} } : { host: request.host, profile, definitions: {} };
    const hooks = await service.dependencies.inspectHooks(inspection, project, { cache: service.settingsCache });
    const verdict = classifyHooks(hooks);
    if (verdict.state === 'disabled') requireValue(false, verdict.code, verdict.message);
    return verdict;
  };
  let verdict = await inspect(current);
  if (current?.pending) {
    current = await service.recoverPending(key, project);
    verdict = await inspect(current);
  }
  if (!current || current.pending || current.state === 'preparing') {
    await service.setup({ host: request.host, profile, pluginId, automatic: true, project });
    current = service.registration(key);
  } else {
    if (verdict.state === 'unconfigured') requireValue(false, verdict.code, verdict.message);
  }
  await service.captureCurrent(current, undefined, (registry, bundle) => {
    requireValue(supportsPreparation(bundle.root), 'preparation-unavailable', 'The enabled Nightshift release does not support automatic preparation; use its matching installed skill');
    const saved = registry.get('registration', key);
    requireValue(saved?.state === 'registered' && !saved.pending && saved.generation === current.generation, 'release-registration-changed', CHANGED_CONCURRENTLY);
    const bootstrap = publishBootstrap(registry, bundle);
    // Keep the actual hook definitions and their generation. Existing native
    // hooks still enter through their retained route without renewed trust.
    registry.put('registration', key, { ...saved, ...bootstrap, baseBundle: bundle.key, routes: retainedRoutes(saved) });
  }, project);
  // Bind before returning the launcher: an older session can change its shared
  // administrative fallback, but cannot redirect a session with an exact binding.
  const resolved = await service.resolve(key, { ...request, project, runId: request.runId ?? request.request?.runId }, false, true);
  const registration = service.registration(key);
  requireValue(registration.state === 'registered' && !registration.pending, 'release-registration-changed', CHANGED_CONCURRENTLY);
  service.publishLocator(registration);
  return { state: 'prepared', registration: key, bootstrap: registration.bootstrap, root: resolved.bundle.root, identity: resolved.bundle.identity, version: resolved.bundle.version };
}

module.exports = { prepare };
