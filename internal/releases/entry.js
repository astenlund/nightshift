'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseJson, processAlive, requireValue } = require('./io');

const CONTEXT_ENV = 'NIGHTSHIFT_RESOURCE_CONTEXT';
const MODE_ENV = 'NIGHTSHIFT_EXECUTION_MODE';
const WORKER_ENV = 'NIGHTSHIFT_WORKER_BINDING';

function validateContext(context, executingRoot, target, exactProject = false) {
  requireValue(context?.schema === 1 && context.mode === 'bound', 'resource-context-required', 'Use the retained Nightshift launcher to invoke installed operations');
  const { Registry, sessionKey } = require('./registry');
  const { verifiedRecord } = require('./bundles');
  const registry = new Registry(context.store);
  try {
    return registry.transaction(() => {
      const registration = registry.get('registration', context.registration);
      const binding = registry.get('session', sessionKey(context.registration, context.session));
      const operation = registry.get('operation', context.operation);
      requireValue((registration?.state === 'registered' || operation?.maintenance === true) && binding?.state === 'bound' && operation?.kind === 'entry' && operation.state === 'running' && processAlive(operation.pid) === true, 'resource-context-expired', 'Nightshift operation context is absent, stale or retired');
      requireValue(operation.registration === context.registration && operation.session === context.session && operation.bundle === context.bundle && operation.project === context.project && operation.identity === context.identity && binding.identity === context.identity && binding.registration === context.registration && binding.session === context.session, 'resource-context-mismatch', 'Nightshift operation does not match its bound session');
      const bundle = verifiedRecord(registry, context.bundle);
      requireValue(bundle.identity === context.identity && fs.realpathSync.native(executingRoot) === bundle.root, 'resource-root-mismatch', 'Execute this operation from the verified bound bundle, not a plugin cache or another checkout');
      if (target) {
        const requested = fs.realpathSync.native(target);
        const relative = path.relative(context.project, requested);
        requireValue(relative === '' || !exactProject && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'resource-project-mismatch', 'Operation target escaped or differs from its admitted project');
      }
      return context;
    });
  } finally { registry.close(); }
}

function contextFromEnvironment() {
  const raw = process.env[CONTEXT_ENV];
  return raw ? parseJson(Buffer.from(raw), 'Nightshift operation context') : null;
}

function admitEntry(executingRoot, args, targetIndex, options = {}) {
  if (args[0] === '--development') {
    delete process.env[CONTEXT_ENV];
    process.env[MODE_ENV] = 'development';
    return { args: args.slice(1), mode: 'development', context: null };
  }
  const context = contextFromEnvironment();
  if (!context && options.diagnostic === true) return { args, mode: 'diagnostic', context: null };
  requireValue(context, 'resource-context-required', 'Installed Nightshift operations require the retained launcher; use --development only for deliberately selected checkout/fixture work');
  validateContext(context, executingRoot, args[targetIndex], options.exactProject === true);
  process.env[MODE_ENV] = 'bound';
  return { args, mode: 'bound', context };
}

function helperArguments(args) {
  if (contextFromEnvironment()) {
    requireValue(process.env[MODE_ENV] !== 'development', 'resource-mode-conflict', 'Development mode cannot carry a bound operation context');
    return args;
  }
  requireValue(!process.env[MODE_ENV] || process.env[MODE_ENV] === 'development', 'resource-context-required', 'A bound helper lost its operation context');
  // Direct library consumers are development surfaces; installed parents carry
  // their admitted context through the inherited environment instead of this flag.
  return ['--development', ...args];
}

function savedResources(context) {
  return context ? { schema: 1, store: context.store, registration: context.registration, session: context.session, identity: context.identity } : null;
}

function unboundEnvironment() {
  const env = { ...process.env };
  delete env[CONTEXT_ENV];
  delete env[MODE_ENV];
  delete env[WORKER_ENV];
  return env;
}

function verificationEnvironment(mode = 'inherit') {
  requireValue(['inherit', 'development'].includes(mode), 'invalid-check-resource-mode', 'Check resourceMode must be inherit or development');
  if (mode === 'inherit') return { ...process.env };
  const env = unboundEnvironment();
  env[MODE_ENV] = 'development';
  return env;
}

function workerEnvironment(context) {
  const env = unboundEnvironment();
  if (context) env[WORKER_ENV] = JSON.stringify({ ...savedResources(context), bundle: context.bundle, operation: context.operation, role: 'read-only-worker' });
  return env;
}

module.exports = { CONTEXT_ENV, MODE_ENV, WORKER_ENV, admitEntry, contextFromEnvironment, helperArguments, savedResources, validateContext, verificationEnvironment, workerEnvironment };
