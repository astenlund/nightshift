'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { requireValue } = require('./io');

function runtimeActions(bundle) {
  const file = path.join(bundle.root, 'internal/runtime/actions.js');
  return fs.existsSync(file) ? require(file) : null;
}

function acceptsRuntimeAction(bundle, action) {
  const actions = runtimeActions(bundle);
  return actions ? actions.isRuntimeAction(action) : action === 'create';
}

function continuationOptional(bundle, entry) {
  if (entry !== 'runtime') return false;
  return require(path.join(bundle.root, 'internal/runtime/cli.js')).CONTINUATION_OPTIONAL_ADMISSION === true;
}

async function admitReady(service, registration, project) {
  const hooks = await service.dependencies.inspectHooks(registration, registration.profile, { project, cache: service.settingsCache });
  const verdict = require('./host-config').classifyHooks(hooks);
  if (!['usable', 'untrusted'].includes(verdict.state)) requireValue(false, verdict.code, verdict.message);
}

async function admitResolved(service, resolved, request, maintenance, preparing) {
  const optional = continuationOptional(resolved.bundle, request.entry);
  const needsActivation = !maintenance && !preparing && request.entry !== 'ready' && !optional;
  if (!maintenance && !needsActivation && !optional && !resolved.readyAdmissionObserved) {
    const hooks = await service.dependencies.inspectHooks(resolved.registration, resolved.registration.profile, { project: resolved.project, cache: service.settingsCache });
    const verdict = require('./host-config').classifyHooks(hooks);
    if (!['usable', 'untrusted'].includes(verdict.state)) requireValue(false, verdict.code, verdict.message);
  }
  if (!resolved.activationAdmissionObserved) await service.requireActivation(resolved.registration, request.session, !needsActivation, resolved.project);
  if (needsActivation) service.registry(registry => {
    const current = registry.get('registration', resolved.registration.key);
    const activation = registry.get('activation', require('./registry').sessionKey(resolved.registration.key, request.session));
    requireValue(current?.generation === resolved.registration.generation && activation?.generation === current.generation, 'hook-activation-required', 'Native activation changed during resource acquisition');
  });
  if (optional && !maintenance) {
    try {
      const hooks = await service.dependencies.inspectHooks(resolved.registration, resolved.registration.profile, { project: resolved.project, cache: service.settingsCache });
      const verdict = require('./host-config').classifyHooks(hooks, { continuationOptional: true });
      resolved.integration = { usable: verdict.state === 'usable', state: verdict.state, cause: verdict.message };
      if (resolved.integration.usable) {
        const activation = service.registry(registry => registry.get('activation', require('./registry').sessionKey(resolved.registration.key, request.session)));
        if (!activation || activation.generation !== resolved.registration.generation) resolved.integration = { usable: false, state: 'unobserved', cause: 'This session has not observed the registered hook generation' };
        else if (service.dependencies.ownerAlive(activation.owner, resolved.registration.profile, service.inspection()) !== true) resolved.integration = { usable: false, state: 'unavailable', cause: 'The hook activation owner could not be positively observed alive' };
      }
    } catch (error) {
      resolved.integration = { usable: false, state: 'unavailable', cause: error.message };
    }
  }
  return resolved;
}

module.exports = { acceptsRuntimeAction, continuationOptional, admitReady, admitResolved };
