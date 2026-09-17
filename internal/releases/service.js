'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { Registry, registrationKey, sessionKey } = require('./registry');
const bundles = require('./bundles');
const native = require('./native-host');
const configuration = require('./host-config');
const processes = require('./processes');
const { CHANGED_CONCURRENTLY, REMOVED_MESSAGE, ownerFree, pluginIdentity, publishBootstrap, retainedRoutes, supportsPreparation } = require('./administration');
const { CONTEXT_ENV, MODE_ENV } = require('./entry');
const { isReadOnlyAction } = require('../runtime/actions');
const { workerIsActive } = require('../runtime/workers');
const { digest, directory, hostProfile, parseJson, processAlive, projectRoot, readBytes, replaceFile, requireConsistentRunId, requireValue, text, writeNew } = require('./io');

const ENTRIES = Object.freeze({ ready: 'skills/ready/ready.js', unwrap: 'skills/init-backlog/unwrap.js', setup: 'skills/init-backlog/init-backlog.js', runtime: 'internal/runtime/cli.js' });
const MAINTENANCE = new Set(['worker-finished', 'review', 'validate', 'stop']);
// The closed list of entries admitted without observed continuation activation.
const ACTIVATION_EXEMPT = new Set(['ready']);
const ENTRY_CHOICE = 'Choose ready, unwrap, setup or runtime';

function defaultStore() { return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Nightshift'); }

function runDatabase(root) {
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'run-resource-state-unavailable', 'Run database is not an ordinary file');
  return new DatabaseSync(file, { readOnly: true });
}

function parseRunState(row) {
  const value = JSON.parse(row.state);
  requireValue(value?.schema === 1 && typeof value.id === 'string' && value.controller && ['running', 'complete', 'stopped'].includes(value.status) && Array.isArray(value.workers), 'run-resource-state-unavailable', 'Run reference state is unsupported or incomplete');
  return value;
}

function readRun(root, id) {
  const database = runDatabase(root);
  if (!database) return null;
  try {
    const row = id ? database.prepare('SELECT state FROM runs WHERE id=?').get(id) : database.prepare('SELECT r.state FROM runs r JOIN active a ON a.id=r.id WHERE a.singleton=1').get();
    if (!row) return null;
    return parseRunState(row);
  } finally { database.close(); }
}

function readRuns(root, required = false) {
  requireValue(fs.realpathSync.native(root) === root, 'run-resource-state-unavailable', 'Registered project root changed');
  const database = runDatabase(root);
  if (!database) {
    requireValue(!required, 'run-resource-state-unavailable', 'Expected run database is unavailable; provisional resources remain protected');
    return [];
  }
  try {
    const rows = database.prepare('SELECT state FROM runs LIMIT 10001').all();
    requireValue(rows.length <= 10000, 'run-resource-state-unavailable', 'Registered run inventory exceeds the reconciliation bound');
    return rows.map(parseRunState);
  } finally { database.close(); }
}

function activeWorkers(run) { return (run?.workers ?? []).some(workerIsActive); }

function cleanOperationFiles(project, operation) {
  const relative = `.tmp/nightshift/${operation}`;
  const temporary = path.join(project, relative);
  if (!fs.existsSync(temporary)) return;
  directory(project, relative);
  for (const file of fs.readdirSync(temporary)) fs.unlinkSync(path.join(temporary, file));
  fs.rmdirSync(temporary);
}

function configurationFields(value) {
  return Object.fromEntries(['schema', 'key', 'host', 'profile', 'pluginId', 'bootstrap', 'bootstrapHash', 'baseBundle', 'definitions', 'generation'].map(key => [key, value[key]]));
}

function removeActivations(registry, registration) {
  for (const activation of registry.list('activation')) if (activation.value.registration === registration) registry.remove('activation', activation.key);
}

function locatorState(profile) {
  const file = path.join(profile, 'nightshift-resources.json');
  if (!fs.existsSync(file)) return { file, bytes: null, value: null };
  const bytes = readBytes(profile, 'nightshift-resources.json', 65536);
  const value = parseJson(bytes, 'Nightshift host locator');
  requireValue(value?.schema === 1 && typeof value.store === 'string' && path.isAbsolute(value.store) && typeof value.registration === 'string', 'configuration-conflict', 'The host resource locator is not a recognized Nightshift file');
  return { file, bytes, value };
}

class ReleaseService {
  constructor(store = defaultStore(), dependencies = {}, context = {}) {
    this.store = fs.existsSync(store) ? fs.realpathSync.native(store) : path.resolve(store);
    this.overrides = dependencies;
    this.dependencies = { discover: native.discover, isEnabled: dependencies.discover ? async (...args) => { await dependencies.discover(...args); return true; } : native.isEnabled, inspectHooks: configuration.inspectHooks, applyHooks: configuration.applyHooks, recoverClaude: configuration.recoverClaude, reconcileCodexJournal: configuration.reconcileCodexJournal, discardJournal: configuration.discardJournal, nativeOwner: processes.nativeOwner, ownerAlive: processes.ownerAlive, runContained: processes.runContained, readRun, ...dependencies };
    this.context = context;
    // One operation asks the host the same Claude settings question several times. The
    // answer cannot change within it, and each service instance serves a single operation,
    // so it is resolved once instead of starting another native session per call. A Codex
    // snapshot that feeds a configuration write must be re-read across it and so is never
    // memoized; the read-only Codex listings are simply not shared yet.
    this.settingsCache = new Map();
  }

  registry(action, options = {}) {
    const registry = new Registry(this.store, options);
    this.store = registry.root;
    try { return registry.transaction(action); }
    finally { registry.close(); }
  }

  registration(key) {
    return this.registry(registry => {
      const value = registry.get('registration', text(key, 'registration'));
      requireValue(value?.schema === 1 && value.key === key && ['codex', 'claude'].includes(value.host) && path.isAbsolute(value.profile), 'release-setup-required', 'Nightshift host registration is missing or invalid');
      return value;
    });
  }

  publishLocator(registration) {
    const previous = locatorState(registration.profile);
    requireValue(!previous.value || previous.value.store === this.store || previous.value.state === 'removed', 'configuration-conflict', 'This profile points to another retained store; remove that registration before replacing it');
    const value = { schema: 1, store: this.store, registration: registration.key, bootstrap: registration.bootstrap, generation: registration.generation, state: registration.state };
    replaceFile(previous.file, Buffer.from(JSON.stringify(value, null, 2) + '\r\n'), previous.bytes);
    return previous.file;
  }

  async captureCurrent(registration, identity, consume, cwd = registration.profile) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const source = await this.dependencies.discover(registration.host, registration.profile, registration.pluginId, cwd);
        return this.registry(registry => { const bundle = bundles.capture(registry, source.root, { identity, version: source.version }); return consume ? consume(registry, bundle) : bundle; });
      } catch (error) {
        failure = error;
        if (!['ENOENT', 'release-read-failed', 'release-content-mismatch', 'release-inventory-mismatch', 'release-version-mismatch', 'installation-unavailable', 'native-host-request-failed'].includes(error.code)) throw error;
      }
    }
    throw failure;
  }

  async recoverPending(key, project) {
    let registration = this.registration(key);
    if (!registration.pending || !registration.pending.journal && registration.pending.remove) return registration;
    requireValue(['key', 'host', 'profile', 'pluginId'].every(field => registration.pending[field] === registration[field]), 'configuration-conflict', 'Pending Nightshift preparation belongs to a different registration');
    const token = randomUUID();
    registration = this.registry(registry => {
      const value = registry.get('registration', key);
      requireValue(ownerFree(value), 'release-setup-busy', 'Another process owns configuration recovery');
      value.pending.ownerPid = process.pid;
      value.pending.ownerToken = token;
      registry.put('registration', key, value);
      return value;
    });
    const journal = registration.pending.journal;
    try {
      const bundle = this.registry(registry => bundles.verifiedRecord(registry, registration.pending.baseBundle));
      const helper = require(path.join(bundle.root, 'internal/releases/host-config.js'));
      let outcome;
      if (!journal) {
        const pending = registration.pending;
        // The pending definitions were written by the bundle that owns them, so they
        // are compared against that release rather than the current administrative one.
        requireValue(isDeepStrictEqual(pending.definitions, helper.definitions(registration.host, pending.bootstrap, key)), 'invalid-settings-journal', 'Pending Nightshift hook definitions are incomplete or changed');
        const nativeState = await this.dependencies.inspectHooks({ ...registration, ...configurationFields(pending) }, registration.profile, { project, cache: this.settingsCache });
        // A no-op configuration write has no journal. Matching native definitions
        // still prove it can be committed without replacing already-applied hooks.
        outcome = nativeState.configured === true ? 'written' : 'not-written';
      } else if (journal.type === 'claude') { (this.overrides.recoverClaude ?? helper.recoverClaude)(journal, registration.profile); outcome = 'written'; }
      else { requireValue(journal.type === 'codex', 'invalid-settings-journal', 'Unknown host configuration recovery format'); outcome = await (this.overrides.reconcileCodexJournal ?? helper.reconcileCodexJournal)(registration, registration.profile, { project, cache: this.settingsCache }); }
      this.registry(registry => {
        const value = registry.get('registration', key);
        requireValue(value.pending?.ownerToken === token, 'release-setup-conflict', 'Configuration recovery ownership changed');
        if (outcome === 'written') {
          if (value.pending.remove) removeActivations(registry, key);
          registry.put('registration', key, { ...value, ...configurationFields(value.pending), state: value.pending.remove ? 'removed' : 'registered', pending: null });
        }
        else { value.pending.ownerPid = null; registry.put('registration', key, value); }
      });
      if (outcome === 'written') (this.overrides.discardJournal ?? helper.discardJournal)(journal);
    } catch (error) {
      this.registry(registry => { const value = registry.get('registration', key); if (value.pending?.ownerToken === token) { value.pending.ownerPid = null; value.pending.error = error.code ?? 'configuration-recovery-failed'; registry.put('registration', key, value); } });
      throw error;
    }
    return this.registration(key);
  }

  async prepare(request) {
    requireValue(Object.hasOwn(ENTRIES, request.entry), 'unknown-release-entry', ENTRY_CHOICE);
    return require('./preparation').prepare(this, request, locatorState);
  }

  async setup(request) {
    const host = request.host;
    const automatic = request.automatic === true;
    const profile = projectRoot(hostProfile(host, request.profile));
    const key = registrationKey(host, profile);
    const locator = locatorState(profile);
    requireValue(!locator.value || locator.value.store === this.store || locator.value.state === 'removed', 'configuration-conflict', 'This profile is already attached to another retained store');
    const pluginId = pluginIdentity(request);
    this.registry(() => {}, { create: true });
    let current = this.registry(registry => registry.get('registration', key));
    if (automatic) requireValue(locator.value?.state !== 'removed' && current?.state !== 'removed' && current?.pending?.remove !== true, 'nightshift-disabled', REMOVED_MESSAGE);
    requireValue(ownerFree(current), 'release-setup-busy', 'Another host configuration operation is active or unreconciled');
    if (current?.pending?.journal) current = await this.recoverPending(key, request.project);
    const reservation = randomUUID();
    const bundle = await this.captureCurrent({ host, profile, pluginId }, undefined, (registry, captured) => {
      registry.put('operation', reservation, { schema: 1, kind: 'capture', state: 'running', pid: process.pid, registration: key, bundle: captured.key });
      return captured;
    });
    // Automatic preparation must establish that the discovered release supports it before
    // writing host configuration: an older bundle's applyHooks has no deliberate-disabling
    // guard at all, so registering through it would fail open rather than refuse.
    if (automatic) requireValue(supportsPreparation(bundle.root), 'preparation-unavailable', 'The enabled Nightshift release does not support automatic preparation; use its matching installed skill');
    const retainedConfiguration = require(path.join(bundle.root, 'internal/releases/host-config.js'));
    const applyHooks = this.overrides.applyHooks ?? retainedConfiguration.applyHooks;
    const inspectHooks = this.overrides.inspectHooks ?? retainedConfiguration.inspectHooks;
    const nonce = randomUUID();
    const pending = this.registry(registry => {
      const previous = registry.get('registration', key);
      if (automatic) requireValue(JSON.stringify(previous) === JSON.stringify(current), 'release-registration-changed', CHANGED_CONCURRENTLY);
      requireValue(ownerFree(previous), 'release-setup-busy', 'Another host configuration operation owns this registration');
      const { bootstrap, bootstrapHash } = publishBootstrap(registry, bundle);
      const definitions = retainedConfiguration.definitions(host, bootstrap, key);
      const generation = digest(JSON.stringify({ protocol: 1, host, profile, definitions }));
      const value = { schema: 1, key, host, profile, pluginId, bootstrap, bootstrapHash, baseBundle: bundle.key, definitions, generation, ownerPid: process.pid, ownerToken: nonce, remove: false, journal: null };
      registry.put('registration', key, { ...(previous ?? { schema: 1, key, host, profile, pluginId, state: 'preparing' }), routes: retainedRoutes(previous), pending: value });
      registry.remove('operation', reservation);
      return { ...value, automatic, previousDefinitions: [previous?.definitions, previous?.pending?.definitions].filter(Boolean) };
    });
    let journal;
    try {
      await applyHooks(pending, profile, false, value => {
        journal = value;
        this.registry(registry => { const value = registry.get('registration', key); requireValue(value.pending?.ownerToken === nonce, 'release-setup-conflict', 'Host configuration ownership changed'); value.pending.journal = journal; registry.put('registration', key, value); });
      }, { project: request.project, cache: this.settingsCache });
      this.registry(registry => {
        const value = registry.get('registration', key);
        requireValue(value.pending?.ownerToken === nonce, 'release-setup-conflict', 'Host configuration ownership changed');
        registry.put('registration', key, { ...value, ...value.pending, state: 'registered', pending: null, ownerPid: undefined, ownerToken: undefined, journal: undefined, remove: undefined });
      });
      this.dependencies.discardJournal(journal);
    } catch (error) {
      this.registry(registry => { const value = registry.get('registration', key); if (value?.pending?.ownerToken === nonce) { value.pending.ownerPid = null; value.pending.error = error.code ?? 'configuration-failed'; registry.put('registration', key, value); } });
      throw error;
    }
    const registration = this.registration(key);
    const nativeState = await inspectHooks(registration, profile, { project: request.project, cache: this.settingsCache });
    const locatorFile = this.publishLocator(registration);
    return { registration: key, bootstrap: registration.bootstrap, locator: locatorFile, generation: registration.generation, native: nativeState, activationRequired: true, next: configuration.classifyHooks(nativeState).guidance };
  }

  async status(key, session, project) {
    let saved;
    try {
      saved = this.registry(registry => ({ registrations: registry.list('registration').map(entry => ({ key: entry.key, host: entry.value.host, profile: entry.value.profile, state: entry.value.state, bootstrap: entry.value.bootstrap, generation: entry.value.generation, pending: entry.value.pending ? { remove: entry.value.pending.remove, error: entry.value.pending.error, journal: entry.value.pending.journal } : null })), sessions: registry.list('session').map(entry => ({ key: entry.key, ...entry.value })), activations: registry.list('activation').map(entry => ({ key: entry.key, ...entry.value })), operations: registry.list('operation').map(entry => ({ key: entry.key, ...entry.value })), bundles: registry.list('bundle').map(entry => ({ key: entry.key, identity: entry.value.identity, root: entry.value.root })) }));
    } catch (error) {
      if (error.code === 'release-setup-required') return { state: 'not-configured', store: this.store };
      throw error;
    }
    if (key) {
      const registration = this.registration(key);
      const nativeState = await this.dependencies.inspectHooks(registration, registration.profile, { project, cache: this.settingsCache });
      const activation = session ? this.registry(registry => registry.get('activation', sessionKey(key, session))) : null;
      saved.native = nativeState;
      saved.activationUsable = !!activation && activation.generation === registration.generation && this.dependencies.ownerAlive(activation.owner, registration.profile) === true && nativeState.usable;
    }
    return { state: 'configured', store: this.store, ...saved };
  }

  // Dependent admission resolves host settings against the same project as the Ready
  // view, so one session cannot see hooks enabled for one entry and disabled for another.
  async requireActivation(registration, session, skipActivation = false, project) {
    if (skipActivation) return;
    requireValue(registration.state === 'registered' && !registration.pending, 'release-setup-required', 'Complete host setup before starting protected Nightshift work');
    const nativeState = await this.dependencies.inspectHooks(registration, registration.profile, { project, cache: this.settingsCache });
    const verdict = configuration.classifyHooks(nativeState);
    if (verdict.state !== 'usable') requireValue(false, verdict.code, verdict.message);
    const activation = this.registry(registry => registry.get('activation', sessionKey(registration.key, session)));
    requireValue(activation?.generation === registration.generation && activation.session === session && this.dependencies.ownerAlive(activation.owner, registration.profile) === true, 'hook-activation-required', 'This native session has not observed the current Nightshift hook generation; open or reopen it before protected work');
  }

  async resolve(key, request, maintenance = false, preparing = false) {
    requireValue(request.entry === undefined || Object.hasOwn(ENTRIES, request.entry), 'unknown-release-entry', ENTRY_CHOICE);
    const registration = this.registration(key);
    const session = text(request.session, 'native session');
    const project = projectRoot(request.project);
    const skey = sessionKey(key, session);
    const binding = this.registry(registry => registry.get('session', skey));
    requireValue(!binding || binding.state === 'bound', 'retired-release-binding', 'This session was retired; explicitly recover its exact identity before resuming');
    const needsActivation = !maintenance && !preparing && !ACTIVATION_EXEMPT.has(request.entry);
    if (!maintenance && !needsActivation) {
      requireValue(registration.state === 'registered' && !registration.pending, 'release-setup-required', 'Complete host setup before starting protected Nightshift work');
      const hooks = await this.dependencies.inspectHooks(registration, registration.profile, { project, cache: this.settingsCache });
      // The read-only view tolerates untrusted hooks; deliberate disabling and a removed
      // or changed registration keep their own refusal and recovery.
      const verdict = configuration.classifyHooks(hooks);
      if (!['usable', 'untrusted'].includes(verdict.state)) requireValue(false, verdict.code, verdict.message);
    }
    await this.requireActivation(registration, session, !needsActivation, project);
    const requestedRun = request.runId ? this.dependencies.readRun(project, request.runId) : this.dependencies.readRun(project);
    const newRun = request.entry === 'runtime' && request.request?.action === 'create' && !request.runId && ['complete', 'stopped'].includes(requestedRun?.status) && !activeWorkers(requestedRun);
    const relevantRun = !newRun && (request.runId || request.entry === 'runtime' || requestedRun?.controller?.session === session) ? requestedRun : null;
    if (relevantRun && !relevantRun.resources && relevantRun.status !== 'complete') requireValue(false, 'legacy-release-reconciliation', 'This run has no retained release identity; reconcile it explicitly instead of adopting the newest runtime');
    const wanted = relevantRun?.resources?.identity;
    requireValue(!wanted || !binding || binding.identity === wanted, 'run-release-conflict', 'The requested run uses another release; reconcile its binding before resuming');
    const identity = binding?.identity ?? wanted;
    const bundle = identity ? this.registry(registry => bundles.availableIdentity(registry, identity)) : null;
    if (bundle && !maintenance) {
      // Enablement remains a separate condition even when all bound bytes survive.
      await this.dependencies.isEnabled(registration.host, registration.profile, registration.pluginId, project);
    }
    const bind = (registry, selected) => {
      const currentRegistration = registry.get('registration', key);
      requireValue(currentRegistration?.generation === registration.generation && (maintenance || currentRegistration.state === 'registered' && !currentRegistration.pending), 'release-registration-changed', 'Host registration changed during resource acquisition');
      if (needsActivation) requireValue(registry.get('activation', skey)?.generation === registration.generation, 'hook-activation-required', 'Native activation was retired or invalidated during resource acquisition');
      const actual = registry.get('session', skey);
      requireValue(!actual || actual.state === 'bound' && actual.identity === selected.identity, 'release-binding-conflict', 'Session binding changed during resource acquisition');
      bundles.verifiedRecord(registry, selected.key);
      const value = actual ?? { schema: 1, registration: key, session, identity: selected.identity, state: 'bound', projects: [], runs: [], createdAt: new Date().toISOString() };
      value.bundle = selected.key;
      if (!value.projects.includes(project)) value.projects.push(project);
      if (relevantRun && !value.runs.some(run => run.project === project && run.id === relevantRun.id)) value.runs.push({ project, id: relevantRun.id, retired: false });
      registry.put('session', skey, value);
      registry.put('project', digest(project), { schema: 1, root: project });
      // Only a genuinely new selection can advance administration; an existing
      // binding or an explicitly selected run must not demote that shared base.
      if (!identity && digest(readBytes(selected.root, 'internal/releases/bootstrap.js')) === currentRegistration.bootstrapHash) { currentRegistration.baseBundle = selected.key; registry.put('registration', key, currentRegistration); }
      return { binding: value, bundle: selected, registration, project };
    };
    if (bundle) return this.registry(registry => bind(registry, bundle));
    requireValue(!maintenance || identity, 'release-unavailable', 'Maintenance cannot create a new work binding');
    return this.captureCurrent(registration, identity, bind, project);
  }

  reconcileOperations(registry) {
    for (const { key, value } of registry.list('operation')) {
      if (key === this.context.bootstrapOperation || processAlive(value.pid) !== false) continue;
      if (['bootstrap', 'capture'].includes(value.kind) || value.phase === 'prepared' || value.contained === true && processAlive(value.runnerPid) === false && processAlive(value.childPid) === false) {
        if (value.kind === 'entry' && value.phase !== 'prepared') {
          const binding = registry.get('session', sessionKey(value.registration, value.session));
          requireValue(binding, 'run-resource-state-unavailable', 'Terminated operation lost its session reference');
          // Missing action metadata is an older, potentially run-creating lease.
          this.reconcileRunReferences(registry, binding, value.runtimeAction !== null ? value.project : null);
        }
        if (value.kind === 'entry') cleanOperationFiles(value.project, key);
        registry.remove('operation', key);
      }
    }
  }

  reconcileRunReferences(registry, binding, requiredProject = null) {
    // Project admission precedes child execution. Reconcile that provisional
    // reference even when a crash prevented the later run-id attachment.
    for (const project of binding.projects) {
      for (const run of readRuns(project, project === requiredProject || binding.runs.some(reference => reference.project === project))) {
        if (run.resources?.store !== registry.root || run.resources.registration !== binding.registration || run.resources.session !== binding.session) continue;
        requireValue(run.resources.identity === binding.identity, 'run-resource-state-unavailable', 'Registered run and session resource identities differ');
        if (!binding.runs.some(reference => reference.project === project && reference.id === run.id)) binding.runs.push({ project, id: run.id, retired: false });
      }
    }
    registry.put('session', sessionKey(binding.registration, binding.session), binding);
  }

  async run(key, request) {
    requireValue(Object.hasOwn(ENTRIES, request.entry), 'unknown-release-entry', ENTRY_CHOICE);
    requireValue(request.timeoutMs === undefined || Number.isSafeInteger(request.timeoutMs) && request.timeoutMs > 0 && request.timeoutMs <= 3600000, 'invalid-operation-timeout', 'Operation timeout must be a positive integer no greater than one hour');
    if (request.entry === 'runtime') requireValue(request.request && typeof request.request === 'object' && !Array.isArray(request.request) && typeof request.request.action === 'string', 'invalid-runtime-request', 'Supply a runtime request object with action');
    if (request.entry === 'setup') requireValue(request.options === undefined || request.options && typeof request.options === 'object' && !Array.isArray(request.options), 'invalid-setup-options', 'Setup options must be an object');
    if (request.entry === 'unwrap') requireValue((request.target === undefined || typeof request.target === 'string' && request.target.length > 0) && (request.write === undefined || typeof request.write === 'boolean'), 'invalid-unwrap-options', 'Unwrap target and write options have invalid types');
    requireConsistentRunId(request);
    const readOnly = request.entry === 'runtime' && isReadOnlyAction(request.request.action);
    const maintenance = readOnly || request.entry === 'runtime' && MAINTENANCE.has(request.request.action);
    const resolved = await this.resolve(key, { ...request, runId: request.runId ?? request.request?.runId }, maintenance);
    const operation = randomUUID();
    const context = this.registry(registry => {
      this.reconcileOperations(registry);
      requireValue(readOnly || !registry.list('operation').some(entry => entry.value.kind === 'entry' && entry.value.project === resolved.project && !isReadOnlyAction(entry.value.runtimeAction)), 'resource-operation-busy', 'A project operation is active or its termination is uncertain');
      const value = { schema: 1, mode: 'bound', store: registry.root, registration: key, session: request.session, identity: resolved.bundle.identity, bundle: resolved.bundle.key, project: resolved.project, operation };
      registry.put('operation', operation, { ...value, kind: 'entry', state: 'running', phase: 'prepared', pid: process.pid, implementationBundle: this.context.implementationBundle ?? resolved.bundle.key, maintenance, runtimeAction: request.entry === 'runtime' ? request.request.action : null });
      return value;
    });
    let temporary;
    let terminated = false;
    let launchAttempted = false;
    let referencesReconciled = request.entry !== 'runtime';
    try {
      temporary = directory(resolved.project, `.tmp/nightshift/${operation}`, true);
      let args;
      if (request.entry === 'ready') args = [resolved.project];
      else if (request.entry === 'unwrap') {
        const target = path.resolve(resolved.project, request.target ?? '.nightshift');
        const relative = path.relative(resolved.project, target);
        requireValue(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'resource-project-mismatch', 'Unwrap target escaped its admitted project');
        args = [...(request.write === true ? ['--write'] : []), target];
      } else {
        const file = path.join(temporary, 'request.json');
        const value = structuredClone(request.entry === 'runtime' ? request.request : request.options ?? {});
        if (request.entry === 'runtime') {
          requireValue(value && typeof value.action === 'string', 'invalid-runtime-request', 'A runtime request is required');
          const identityField = value.action === 'create' ? 'controller' : !isReadOnlyAction(value.action) ? 'actor' : null;
          if (identityField) {
            const identity = { host: resolved.registration.host, session: request.session };
            const supplied = value[identityField];
            requireValue(supplied === undefined || supplied?.host === identity.host && supplied?.session === identity.session, 'resource-actor-conflict', 'Runtime identity must match the admitted native session');
            value[identityField] = identity;
          }
        }
        writeNew(file, JSON.stringify(value) + '\r\n');
        args = request.entry === 'runtime' ? [resolved.project, file] : [request.setupAction ?? 'inspect', resolved.project, file];
      }
      this.registry(registry => { const value = registry.get('operation', operation); value.phase = 'launching'; registry.put('operation', operation, value); });
      launchAttempted = true;
      const exit = await this.dependencies.runContained(process.execPath, [path.join(resolved.bundle.root, ENTRIES[request.entry]), ...args], {
        cwd: resolved.project, env: { ...process.env, [CONTEXT_ENV]: JSON.stringify(context), [MODE_ENV]: 'bound' }, timeoutMs: request.timeoutMs,
        onPrepared: info => this.registry(registry => { const value = registry.get('operation', operation); value.runnerPid = info.runnerPid; registry.put('operation', operation, value); }),
        onStarted: info => this.registry(registry => { const value = registry.get('operation', operation); value.phase = 'contained'; value.childPid = info.pid; value.runnerPid = info.runnerPid; value.contained = info.contained; registry.put('operation', operation, value); }),
        onFinished: info => { terminated = info.descendantsReclaimed; },
      });
      const run = request.entry === 'runtime' ? this.dependencies.readRun(resolved.project, request.request?.runId) : null;
      if (request.entry === 'runtime' && request.request.action === 'create') readRuns(resolved.project, true);
      if (run?.resources?.identity === resolved.binding.identity) this.registry(registry => {
        const binding = registry.get('session', sessionKey(key, request.session));
        if (!binding.runs.some(item => item.project === resolved.project && item.id === run.id)) binding.runs.push({ project: resolved.project, id: run.id, retired: false });
        registry.put('session', sessionKey(key, request.session), binding);
      });
      referencesReconciled = true;
      return exit;
    } finally {
      if (terminated && referencesReconciled || !launchAttempted) {
        if (temporary) cleanOperationFiles(resolved.project, operation);
        this.registry(registry => registry.remove('operation', operation));
      }
    }
  }

  async hook(key, input) {
    let ownerRun = null;
    let project;
    let registration;
    try {
      project = require('../runtime/hook').projectRoot(input.cwd);
      if (project) ownerRun = this.dependencies.readRun(project);
      const identifiable = ownerRun?.controller?.session === input.session_id && ownerRun.status === 'running';
      registration = this.registration(key);
      if (identifiable && ownerRun.resourceMode === 'development') return {};
      if (registration.state !== 'registered' || registration.pending) return identifiable ? { systemMessage: 'Nightshift host setup is incomplete; saved work remains incomplete.' } : {};
      if (input.hook_event_name === 'SessionStart') {
        const owner = this.dependencies.nativeOwner(registration.host, registration.profile);
        requireValue(owner, 'native-activation-unavailable', 'Native host process identity could not be established');
        this.registry(registry => registry.put('activation', sessionKey(key, input.session_id), { schema: 1, registration: key, session: input.session_id, generation: registration.generation, owner, observedAt: new Date().toISOString() }), { nonblocking: !identifiable });
      }
      const binding = this.registry(registry => registry.get('session', sessionKey(key, input.session_id)), { nonblocking: !identifiable });
      if (!binding) return project && fs.existsSync(path.join(project, '.nightshift')) ? { hookSpecificOutput: input.hook_event_name === 'SessionStart' ? { hookEventName: 'SessionStart', additionalContext: `Nightshift native session: ${input.session_id}. Retained launcher: ${registration.bootstrap}. Registration: ${key}. Resolve resources through this launcher before using Nightshift.` } : undefined } : {};
      requireValue(binding.state === 'bound', 'retired-release-binding', 'This Nightshift session was retired');
      if (identifiable) requireValue(ownerRun.resources?.identity === binding.identity && ownerRun.resources.registration === key, 'legacy-release-reconciliation', 'The owned run does not match this retained resource binding');
      // Claude scopes project settings to the working directory, so an unresolvable
      // Nightshift project root still inspects the actual cwd rather than the profile.
      await this.requireActivation(registration, input.session_id, false, project ?? input.cwd);
      await this.dependencies.isEnabled(registration.host, registration.profile, registration.pluginId, project ?? input.cwd);
      const bundle = this.registry(registry => bundles.availableIdentity(registry, binding.identity));
      requireValue(bundle, 'release-unavailable', 'The session-bound release is unavailable; recover its exact identity');
      const result = require(path.join(bundle.root, 'internal/runtime/hook.js')).handleHook(input);
      if (input.hook_event_name === 'SessionStart') {
        const existing = result.hookSpecificOutput?.additionalContext ?? '';
        result.hookSpecificOutput = { hookEventName: 'SessionStart', additionalContext: `${existing}\nNightshift native session: ${input.session_id}. Bound resources: ${bundle.root}. Retained launcher: ${registration.bootstrap}. Registration: ${key}. Use this binding for all Nightshift work.` };
      }
      return result;
    } catch (error) {
      return ownerRun?.controller?.session === input.session_id && ownerRun.status === 'running' ? { systemMessage: `Nightshift could not reconcile protected resources: ${error.message}. Saved work remains incomplete.${registration ? ` Recovery launcher: ${registration.bootstrap}. Registration: ${key}.` : ''}` } : {};
    }
  }

  async remove(key) {
    let registration = this.registration(key);
    requireValue(ownerFree(registration), 'release-setup-busy', 'Host setup/removal still has an active owner');
    if (!fs.existsSync(registration.profile)) {
      this.registry(registry => {
        const current = registry.get('registration', key);
        requireValue(ownerFree(current), 'release-setup-busy', 'Host configuration ownership changed');
        registry.put('registration', key, { ...current, ...configurationFields({ ...current, ...(current.pending ?? {}) }), state: 'removed', pending: null });
        removeActivations(registry, key);
      });
      return { removed: true, profileAbsent: true };
    }
    if (registration.pending?.journal) registration = await this.recoverPending(key);
    const nonce = randomUUID();
    const pending = this.registry(registry => {
      const current = registry.get('registration', key);
      requireValue(ownerFree(current), 'release-setup-busy', 'Host configuration ownership changed');
      const value = { ...configurationFields({ ...current, ...(current.pending ?? {}) }), remove: true, ownerPid: process.pid, ownerToken: nonce, journal: null };
      registry.put('registration', key, { ...current, pending: value });
      return { ...value, previousDefinitions: [current.definitions, current.pending?.definitions].filter(Boolean) };
    });
    let journal;
    try {
      await this.dependencies.applyHooks(pending, registration.profile, true, value => {
        journal = value;
        this.registry(registry => { const current = registry.get('registration', key); requireValue(current.pending?.ownerToken === nonce, 'release-setup-conflict', 'Host removal ownership changed'); current.pending.journal = value; registry.put('registration', key, current); });
      });
      this.registry(registry => {
        const value = registry.get('registration', key);
        requireValue(value.pending?.ownerToken === nonce, 'release-setup-conflict', 'Host removal ownership changed');
        registry.put('registration', key, { ...value, ...configurationFields(value.pending), state: 'removed', pending: null });
        removeActivations(registry, key);
      });
      this.dependencies.discardJournal(journal);
      this.publishLocator(this.registration(key));
      return { removed: true, storePreserved: true };
    } catch (error) {
      this.registry(registry => { const value = registry.get('registration', key); if (value.pending?.ownerToken === nonce) { value.pending.ownerPid = null; value.pending.error = error.code ?? 'configuration-failed'; registry.put('registration', key, value); } });
      throw error;
    }
  }

  retire(key, request) {
    return this.registry(registry => {
      this.reconcileOperations(registry);
      const target = text(request.targetSession, 'session selected for retirement');
      requireValue(!registry.list('operation').some(entry => entry.key !== this.context.bootstrapOperation && entry.value.registration === key && entry.value.session === target), 'resource-operation-busy', 'The session has active or unreconciled operations');
      const skey = sessionKey(key, target);
      const binding = registry.get('session', skey);
      const activation = registry.get('activation', skey);
      requireValue(binding || activation, 'unknown-release-session', 'No activation or work binding exists for that session');
      if (binding) {
        this.reconcileRunReferences(registry, binding);
        for (const reference of binding.runs) {
          const run = this.dependencies.readRun(reference.project, reference.id);
          requireValue(run && !activeWorkers(run), 'run-resource-state-unavailable', 'Associated run/worker state is missing or active');
          if (run.status !== 'complete' && !reference.retired) requireValue(request.retireRuns?.includes(reference.id) && run.status === 'stopped', 'run-retirement-required', 'Stop and explicitly select unfinished runs before abandoning their retained resources');
          reference.retired = true;
        }
        binding.state = 'retired'; binding.retiredAt = new Date().toISOString();
        registry.put('session', skey, binding);
      }
      registry.remove('activation', skey);
      return { retired: target, resourcesDeleted: false };
    });
  }

  async recover(key, request) {
    const skey = sessionKey(key, request.targetSession);
    const binding = this.registry(registry => registry.get('session', skey));
    requireValue(binding?.state === 'retired', 'recovery-not-required', 'Select a retired work binding for explicit exact-identity recovery');
    const registration = this.registration(key);
    let bundle = this.registry(registry => bundles.availableIdentity(registry, binding.identity));
    if (!bundle) bundle = await this.captureCurrent(registration, binding.identity);
    this.registry(registry => { const actual = registry.get('session', skey); requireValue(actual?.state === 'retired' && actual.identity === binding.identity, 'release-binding-conflict', 'Retired binding changed during recovery'); actual.state = 'bound'; actual.bundle = bundle.key; actual.runs.forEach(run => { run.retired = false; }); registry.put('session', skey, actual); });
    return { recovered: request.targetSession, identity: binding.identity, activationRequired: true };
  }

  collect() {
    const result = this.registry(registry => {
      registry.assertKnownKinds();
      this.reconcileOperations(registry);
      bundles.reconcileOrphans(registry);
      const keep = new Set();
      const keepIdentity = new Set();
      for (const registration of registry.list('registration').map(entry => entry.value)) {
        if (registration.baseBundle) keep.add(registration.baseBundle);
        if (registration.pending?.baseBundle) keep.add(registration.pending.baseBundle);
      }
      for (const operation of registry.list('operation').map(entry => entry.value)) { keep.add(operation.bundle); if (operation.implementationBundle) keep.add(operation.implementationBundle); }
      for (const binding of registry.list('session').map(entry => entry.value)) {
        this.reconcileRunReferences(registry, binding);
        if (binding.state === 'bound') keepIdentity.add(binding.identity);
        for (const reference of binding.runs) {
          const run = this.dependencies.readRun(reference.project, reference.id);
          requireValue(run, 'run-resource-state-unavailable', 'A registered run cannot be read; collection retains all resources');
          if (!reference.retired && (run.status !== 'complete' || activeWorkers(run))) keepIdentity.add(binding.identity);
        }
      }
      const removed = [];
      const retained = [];
      for (const entry of registry.list('bundle')) {
        if (keep.has(entry.key) || keepIdentity.has(entry.value.identity)) { retained.push(entry.key); continue; }
        bundles.removeBundle(registry, entry.key);
        removed.push(entry.key);
      }
      return { removed, retained, stagingRemoved: bundles.collectStaging(registry) };
    });
    this.registry(registry => bundles.finishDeletions(registry));
    return result;
  }
}

module.exports = { ENTRIES, MAINTENANCE, ReleaseService, activeWorkers, defaultStore, locatorState, readRun };
