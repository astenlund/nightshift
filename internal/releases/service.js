'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { HOOK_LOCK_WAIT_MS, Registry, registrationKey, sessionKey } = require('./registry');
const bundles = require('./bundles');
const native = require('./native-host');
const configuration = require('./host-config');
const processes = require('./processes');
const { CHANGED_CONCURRENTLY, REMOVED_MESSAGE, ownerFree, pluginIdentity, publishBootstrap, retainedRoutes, supportsPreparation } = require('./administration');
const { CONTEXT_ENV, MODE_ENV, executionResources } = require('./entry');
const { isCreationRequest, requiresOwnershipInventory, isReadOnlyAction, isRuntimeAction, unknownActionMessage } = require('../runtime/actions');
const { workerIsActive } = require('../runtime/workers');
const { RUN_STORE_WAIT_MS, STORE_VERSIONS } = require('../runtime/store');
const { referenceId, reviewId, requestedReferenceId, readReviewStore, readReviewReference } = require('../runtime/review-inventory');
const { acceptsRuntimeAction, continuationOptional, admitReady, admitResolved } = require('./admission');
const { digest, directory, hostProfile, normalizeRuntimeTarget, parseJson, processAlive, projectRoot, readBytes, replaceFile, requireConsistentRunId, requireValue, text, writeNew } = require('./io');

const ENTRIES = Object.freeze({ ready: 'skills/ready/ready.js', unwrap: 'skills/init-backlog/unwrap.js', setup: 'skills/init-backlog/init-backlog.js', runtime: 'internal/runtime/cli.js' });
const MAINTENANCE = new Set(['worker-finished', 'review', 'validate', 'dialogue', 'stop']);
const ENTRY_CHOICE = 'Choose ready, unwrap, setup or runtime';
const MISSING_ACTIVATION = 'This native session has not observed the current Nightshift hook generation; open or reopen it before protected work';

function defaultStore() { return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Nightshift'); }

// A run store commit keeps readers out while it writes. Launcher operations wait for it as the runtime's own store connections
// do; a hook's preliminary read, made before it knows whether the session owns a run, passes no wait and keeps its earlier bound.
function runDatabase(root, waitMs = RUN_STORE_WAIT_MS) {
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'run-resource-state-unavailable', 'Run database is not an ordinary file');
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    database.exec(`PRAGMA busy_timeout=${waitMs};`);
    // Only formats whose records the runtime reads can be inventoried; anything else holds retirement and collection back.
    const version = database.prepare('PRAGMA user_version').get().user_version;
    requireValue(version > 0 && STORE_VERSIONS.includes(version), 'run-resource-state-unavailable', `Unsupported run database version ${version}`);
  } catch (error) {
    database.close();
    throw error;
  }

  return database;
}

function parseRunState(row, root) {
  const value = JSON.parse(row.state);
  requireValue(value?.schema === 1 && (value.kind === undefined || value.kind === 'delivery') && value.root === root && typeof value.id === 'string' && value.id === row.id && value.controller && ['running', 'complete', 'stopped'].includes(value.status) && Array.isArray(value.workers), 'run-resource-state-unavailable', 'Run reference state is unsupported or incomplete');
  return value;
}

function readRun(root, id, waitMs = RUN_STORE_WAIT_MS) {
  if (id !== undefined) requireValue(typeof id === 'string' && id.length > 0, 'run-resource-state-unavailable', 'Record selection cannot be empty or null');
  if (reviewId(id)) return readReviewReference(root, id, waitMs);
  const database = runDatabase(root, waitMs);
  if (!database) return null;
  try {
    const row = id !== undefined ? database.prepare('SELECT id, state FROM runs WHERE id=?').get(id) : database.prepare('SELECT r.id, r.state FROM runs r JOIN active a ON a.id=r.id WHERE a.singleton=1').get();
    if (!row) return null;
    return parseRunState(row, root);
  } finally { database.close(); }
}

// Every saved run of a project, or null when the project has no run database.
function readRunStore(root) {
  requireValue(fs.realpathSync.native(root) === root, 'run-resource-state-unavailable', 'Registered project root changed');
  const reviews = readReviewStore(root);
  const database = runDatabase(root);
  if (!database) return reviews;
  try {
    const rows = database.prepare('SELECT id, state FROM runs LIMIT 10001').all();
    requireValue(rows.length <= 10000, 'run-resource-state-unavailable', 'Registered run inventory exceeds the reconciliation bound');
    const records = [...rows.map(row => parseRunState(row, root)), ...(reviews ?? [])];
    requireValue(records.length <= 10000, 'run-resource-state-unavailable', 'Registered activity inventory exceeds the reconciliation bound');
    return records;
  } finally { database.close(); }
}

function presentRuns(runs, required) {
  requireValue(runs || !required, 'run-resource-state-unavailable', 'Expected run database is unavailable; provisional resources remain protected');
  return runs ?? [];
}

function readRuns(root, required = false) {
  return presentRuns(readRunStore(root), required);
}

// The saved run a binding reference names, taken from a registry transaction's shared run inventory, or null.
function referencedRun(runs, reference) {
  return runs(reference.project, true).find(run => referenceId(run) === reference.id) ?? null;
}

function activeWorkers(run) { return (run?.workers ?? []).some(workerIsActive); }

function operationEnded(value) {
  return processAlive(value.pid) === false && (value.phase === 'prepared' || value.contained === true && processAlive(value.runnerPid) === false && processAlive(value.childPid) === false);
}

function projectOperationActive(registry, project, ignoreEnded = false) {
  return registry.list('operation').some(entry => entry.value.kind === 'entry' && entry.value.project === project && !isReadOnlyAction(entry.value.runtimeAction) && (!ignoreEnded || !operationEnded(entry.value)));
}

function matchesBinding(resources, binding, store) {
  return resources?.schema === 1 && resources.store === store && resources.registration === binding.registration && resources.session === binding.session && resources.identity === binding.identity;
}

// Recording the recipient's reply to the project's completed delivery report is the one mutation another admitted session may
// make, because a completed delivery cannot be adopted and its owning session may be gone. The confirming session keeps its own
// binding and payload; the run's recorded ownership and resources stay unchanged.
function completedReportConfirmation(request, run, host, session) {
  return request.entry === 'runtime' && request.request?.action === 'report-delivered' && Boolean(run) && (run.kind ?? 'delivery') === 'delivery' && run.status === 'complete' && !(run.controller?.host === host && run.controller?.session === session);
}

function requireConfirmableReport(run, current, store) {
  requireValue(run.id === current?.id && run.resourceMode === 'bound' && executionResources(run)?.store === store, 'report-confirmation-unavailable', 'Another session can confirm only the report of the project\'s current completed delivery in this retained store');
}

function historicalBinding(run, binding, store) {
  return (run.adoptions ?? []).some(adoption => matchesBinding(adoption.previousExecutionResources, binding, store));
}

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
  for (const kind of ['activation', 'activation-failure']) for (const entry of registry.list(kind)) if (entry.value.registration === registration) registry.remove(kind, entry.key);
}

function sameOwner(left, right) {
  return left?.pid === right?.pid && left?.created === right?.created && left?.name === right?.name;
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
    this.dependencies = { discover: native.discover, isEnabled: dependencies.discover ? async (...args) => { await dependencies.discover(...args); return true; } : native.isEnabled, inspectHooks: configuration.inspectHooks, applyHooks: configuration.applyHooks, recoverClaude: configuration.recoverClaude, reconcileCodexJournal: configuration.reconcileCodexJournal, discardJournal: configuration.discardJournal, nativeOwner: processes.nativeOwner, ownerAlive: processes.ownerAlive, runContained: processes.runContained, readRun, readRunStore, ...dependencies };
    this.context = context;
    // One operation asks the host the same Claude settings question several times. The
    // answer cannot change within it, and each service instance serves a single operation,
    // so it is resolved once instead of starting another native session per call. A Codex
    // snapshot that feeds a configuration write must be re-read across it and so is never
    // memoized; the read-only Codex listings are simply not shared yet.
    this.settingsCache = new Map();
  }

  // Process inspection options for this operation: a registered hook keeps the shorter budget that fits its host timeout,
  // unless the caller names another, as SessionStart's owner lookup does.
  inspection(onFailure, budgetMs = this.context.nativeHook ? processes.HOOK_INSPECTION_BUDGET_MS : processes.INSPECTION_BUDGET_MS) {
    return { budgetMs, onFailure };
  }

  // Run references are reconciled inside registry write transactions, so the store parse they need is paid while the
  // registry is locked. One transaction shares each project's parsed runs among every binding that lists the project,
  // instead of parsing the store again for each binding.
  runInventory() {
    const stores = new Map();
    return (project, required) => {
      if (!stores.has(project)) stores.set(project, this.dependencies.readRunStore(project));
      return presentRuns(stores.get(project), required);
    };
  }

  registry(action, options = {}) {
    const registry = new Registry(this.store, this.context.nativeHook && !options.nonblocking ? { ...options, busyTimeoutMs: HOOK_LOCK_WAIT_MS } : options);
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

  async captureCurrent(registration, identity, consume, cwd, options = {}) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const source = await this.dependencies.discover(registration.host, registration.profile, registration.pluginId, cwd ?? registration.profile, { profileScoped: cwd === undefined, project: options.project ?? cwd });
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
      else { requireValue(journal.type === 'codex', 'invalid-settings-journal', 'Unknown host configuration recovery format'); outcome = await (this.overrides.reconcileCodexJournal ?? helper.reconcileCodexJournal)(registration, registration.profile, { project, cache: this.settingsCache, readSnapshot: (profile, context) => configuration.codexSnapshot(profile, context, { project }) }); }
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
    const project = request.project === undefined ? undefined : projectRoot(request.project);
    const key = registrationKey(host, profile);
    const locator = locatorState(profile);
    requireValue(!locator.value || locator.value.store === this.store || locator.value.state === 'removed', 'configuration-conflict', 'This profile is already attached to another retained store');
    const pluginId = pluginIdentity(request);
    this.registry(() => {}, { create: true });
    let current = this.registry(registry => registry.get('registration', key));
    if (automatic) requireValue(locator.value?.state !== 'removed' && current?.state !== 'removed' && current?.pending?.remove !== true, 'nightshift-disabled', REMOVED_MESSAGE);
    requireValue(ownerFree(current), 'release-setup-busy', 'Another host configuration operation is active or unreconciled');
    if (current?.pending?.journal) current = await this.recoverPending(key, project);
    const reservation = randomUUID();
    const bundle = await this.captureCurrent({ host, profile, pluginId }, undefined, (registry, captured) => {
      registry.put('operation', reservation, { schema: 1, kind: 'capture', state: 'running', pid: process.pid, registration: key, bundle: captured.key });
      return captured;
    }, undefined, { project });
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
    const optional = automatic && request.optionalContinuation === true && continuationOptional(bundle, 'runtime');
    try {
      let apply = true;
      if (optional) {
        try {
          const observed = await inspectHooks(pending, profile, { project, cache: this.settingsCache });
          apply = observed.disabled !== true;
        } catch { apply = false; }
      }
      if (apply) await applyHooks(pending, profile, false, value => {
        journal = value;
        this.registry(registry => { const value = registry.get('registration', key); requireValue(value.pending?.ownerToken === nonce, 'release-setup-conflict', 'Host configuration ownership changed'); value.pending.journal = journal; registry.put('registration', key, value); });
      }, { project, cache: this.settingsCache });
      this.registry(registry => {
        const value = registry.get('registration', key);
        requireValue(value.pending?.ownerToken === nonce, 'release-setup-conflict', 'Host configuration ownership changed');
        registry.put('registration', key, { ...value, ...value.pending, state: 'registered', pending: null, ownerPid: undefined, ownerToken: undefined, journal: undefined, remove: undefined });
      });
      this.dependencies.discardJournal(journal);
    } catch (error) {
      if (optional && !journal) {
        this.registry(registry => {
          const value = registry.get('registration', key);
          requireValue(value?.pending?.ownerToken === nonce, 'release-setup-conflict', 'Resource registration ownership changed');
          registry.put('registration', key, { ...value, ...value.pending, state: 'registered', pending: null, ownerPid: undefined, ownerToken: undefined, journal: undefined, remove: undefined, integrationFailure: { cause: error.message } });
        });
      } else {
      this.registry(registry => { const value = registry.get('registration', key); if (value?.pending?.ownerToken === nonce) { value.pending.ownerPid = null; value.pending.error = error.code ?? 'configuration-failed'; registry.put('registration', key, value); } });
      throw error;
      }
    }
    const registration = this.registration(key);
    let nativeState;
    try { nativeState = await inspectHooks(registration, profile, { project, cache: this.settingsCache }); }
    catch (error) {
      if (!optional) throw error;
      nativeState = { configured: false, disabled: false, usable: false, cause: error.message, entries: [] };
    }
    const locatorFile = this.publishLocator(registration);
    return { registration: key, bootstrap: registration.bootstrap, locator: locatorFile, generation: registration.generation, native: nativeState, activationRequired: true, next: configuration.classifyHooks(nativeState).guidance };
  }

  async status(key, session, project) {
    let saved;
    try {
      saved = this.registry(registry => ({ registrations: registry.list('registration').map(entry => ({ key: entry.key, host: entry.value.host, profile: entry.value.profile, state: entry.value.state, bootstrap: entry.value.bootstrap, generation: entry.value.generation, pending: entry.value.pending ? { remove: entry.value.pending.remove, error: entry.value.pending.error, journal: entry.value.pending.journal } : null })), sessions: registry.list('session').map(entry => ({ key: entry.key, ...entry.value })), activations: registry.list('activation').map(entry => ({ key: entry.key, ...entry.value })), activationFailures: registry.list('activation-failure').map(entry => ({ key: entry.key, ...entry.value })), operations: registry.list('operation').map(entry => ({ key: entry.key, ...entry.value })), bundles: registry.list('bundle').map(entry => ({ key: entry.key, identity: entry.value.identity, root: entry.value.root })) }));
    } catch (error) {
      if (error.code === 'release-setup-required') return { state: 'not-configured', store: this.store };
      throw error;
    }
    if (key) {
      const registration = this.registration(key);
      const nativeState = await this.dependencies.inspectHooks(registration, registration.profile, { project, cache: this.settingsCache });
      const activation = session ? this.registry(registry => registry.get('activation', sessionKey(key, session))) : null;
      saved.native = nativeState;
      saved.activationUsable = !!activation && activation.generation === registration.generation && this.dependencies.ownerAlive(activation.owner, registration.profile, this.inspection()) === true && nativeState.usable;
    }
    return { state: 'configured', store: this.store, ...saved };
  }

  // Dependent admission resolves host settings against the same project as the Ready
  // view, so one session cannot see hooks enabled for one entry and disabled for another.
  // observedOwner is the owner SessionStart has just found among its own ancestors; an activation recording exactly that owner needs no second inspection.
  async requireActivation(registration, session, skipActivation = false, project, observedOwner = null) {
    if (skipActivation) return;
    requireValue(registration.state === 'registered' && !registration.pending, 'release-setup-required', 'Complete host setup before starting protected Nightshift work');
    const nativeState = await this.dependencies.inspectHooks(registration, registration.profile, { project, cache: this.settingsCache });
    const verdict = configuration.classifyHooks(nativeState);
    if (verdict.state !== 'usable') requireValue(false, verdict.code, verdict.message);
    const skey = sessionKey(registration.key, session);
    const { activation, failure } = this.registry(registry => ({ activation: registry.get('activation', skey), failure: registry.get('activation-failure', skey) }));
    // A failed SessionStart keeps any earlier activation, so its saved cause belongs on every refusal below, not only a missing activation's.
    const cause = failure?.generation === registration.generation ? `. SessionStart at ${failure.observedAt} could not record an activation: ${failure.cause}` : '';
    requireValue(activation?.generation === registration.generation && activation.session === session, 'hook-activation-required', MISSING_ACTIVATION + cause);
    if (observedOwner && sameOwner(activation.owner, observedOwner)) return;
    let inspectionFailure = null;
    const alive = this.dependencies.ownerAlive(activation.owner, registration.profile, this.inspection(reason => { inspectionFailure = reason; }));
    // An unknown owner is refused either way, but a failed inspection is not evidence that the activation is missing.
    requireValue(alive === true || inspectionFailure === null, 'hook-activation-required', `This native session's recorded activation could not be confirmed because process inspection failed (${inspectionFailure}); that does not show the activation is missing, so retry the request before reopening the session${cause}`);
    requireValue(alive === true, 'hook-activation-required', MISSING_ACTIVATION + cause);
  }

  async resolve(key, request, maintenance = false, preparing = false) {
    request = normalizeRuntimeTarget(request);
    requireConsistentRunId(request);
    requireValue(request.entry === undefined || Object.hasOwn(ENTRIES, request.entry), 'unknown-release-entry', ENTRY_CHOICE);
    const registration = this.registration(key);
    const session = text(request.session, 'native session');
    const project = projectRoot(request.project);
    const skey = sessionKey(key, session);
    const adoption = request.entry === 'runtime' && request.request?.action === 'adopt';
    if (adoption) {
      requireValue(!maintenance && !preparing, 'adoption-admission-required', 'Adoption requires current authenticated runtime admission');
      requireValue(typeof requestedReferenceId(request.request) === 'string' && Number.isSafeInteger(request.request.revision) && request.request.revision >= 0, 'invalid-adoption-request', 'Adoption must identify its record and observed revision');
      text(request.request.authority, 'adoption authority');
    }
    const binding = this.registry(registry => registry.get('session', skey));
    requireValue(!binding || binding.state === 'bound', 'retired-release-binding', 'This session was retired; explicitly recover its exact identity before resuming');
    requireValue(maintenance || registration.state === 'registered' && !registration.pending, 'release-setup-required', 'Complete host setup and resource registration before Nightshift work');
    const readyAdmissionObserved = !maintenance && request.entry === 'ready';
    if (readyAdmissionObserved) await admitReady(this, registration, project);
    const runId = requestedReferenceId(request.request) ?? request.runId;
    const requestedRun = request.entry === 'ready' ? null : runId ? this.dependencies.readRun(project, runId) : this.dependencies.readRun(project);
    const creating = request.entry === 'runtime' && (isCreationRequest(request.request) || request.request?.action === 'create');
    const replaceable = requestedRun?.status === 'complete' || requestedRun?.status === 'stopped' && requestedRun.tasks?.every(task => task.status === 'complete');
    const newRun = creating && (!requestedRun || !runId && replaceable && !activeWorkers(requestedRun));
    const relevantRun = !newRun && (runId || request.entry === 'runtime' || requestedRun?.controller?.session === session) ? requestedRun : null;
    const runResources = relevantRun ? executionResources(relevantRun) : null;
    if (relevantRun && !runResources && relevantRun.status !== 'complete') requireValue(false, 'legacy-release-reconciliation', 'This run has no retained release identity; reconcile it explicitly instead of adopting the newest runtime');
    if (adoption) {
      const current = relevantRun?.kind === 'review' ? this.dependencies.readRun(project, referenceId(relevantRun)) : this.dependencies.readRun(project);
      requireValue(relevantRun && relevantRun.id === current?.id && relevantRun.status !== 'complete', 'adoption-run-unavailable', 'Only a current unfinished record can be adopted');
      requireValue(relevantRun.resourceMode === 'bound' && runResources?.store === this.store, 'adoption-resource-conflict', 'Adoption requires the same retained store and bound resource mode');
      this.registry(registry => this.requireAdoptionSource(registry, project, relevantRun));
    }
    const confirming = completedReportConfirmation(request, relevantRun, registration.host, session);
    if (confirming) requireConfirmableReport(relevantRun, this.dependencies.readRun(project), this.store);
    // A confirming session executes its own binding, or the current release when it has none, never the owner's payload.
    const wanted = confirming ? undefined : runResources?.identity;
    requireValue(!wanted || !binding || binding.identity === wanted, 'run-release-conflict', 'The requested run uses another release; reconcile its binding before resuming');
    const identity = binding?.identity ?? wanted;
    const bundle = identity ? this.registry(registry => bundles.availableIdentity(registry, identity)) : null;
    const activationAdmissionObserved = Boolean(bundle) && !maintenance && !preparing && request.entry !== 'ready' && !continuationOptional(bundle, request.entry);
    if (activationAdmissionObserved) await this.requireActivation(registration, session, false, project);
    if (bundle && !maintenance) {
      // Enablement remains a separate condition even when all bound bytes survive.
      await this.dependencies.isEnabled(registration.host, registration.profile, registration.pluginId, project);
    }
    const bind = (registry, selected) => {
      const currentRegistration = registry.get('registration', key);
      requireValue(currentRegistration?.generation === registration.generation && (maintenance || currentRegistration.state === 'registered' && !currentRegistration.pending), 'release-registration-changed', 'Host registration changed during resource acquisition');
      if (activationAdmissionObserved) requireValue(registry.get('activation', skey)?.generation === registration.generation, 'hook-activation-required', 'Native activation changed during resource acquisition');
      const actual = registry.get('session', skey);
      requireValue(!actual || actual.state === 'bound' && actual.identity === selected.identity, 'release-binding-conflict', 'Session binding changed during resource acquisition');
      bundles.verifiedRecord(registry, selected.key);
      if (adoption) requireValue(require(path.join(selected.root, ENTRIES.runtime)).ADOPTION_PROTOCOL === 1, 'adoption-release-incompatible', 'The exact retained runtime does not support adoption; older runs cannot be silently upgraded');
      const value = actual ?? { schema: 1, registration: key, session, identity: selected.identity, state: 'bound', projects: [], runs: [], createdAt: new Date().toISOString() };
      value.bundle = selected.key;
      if (!value.projects.includes(project)) value.projects.push(project);
      if (relevantRun && (adoption || matchesBinding(runResources, value, registry.root)) && !value.runs.some(run => run.project === project && run.id === referenceId(relevantRun))) {
        requireValue(!relevantRun.adoptions?.length || !matchesBinding(runResources, value, registry.root), 'adoption-reference-unavailable', 'Committed adoption lost its protected target reference; reconcile retained state before dependent work');
        value.runs.push({ project, id: referenceId(relevantRun), retired: false, ...(adoption ? { pendingAdoption: true } : {}) });
      }
      registry.put('session', skey, value);
      registry.put('project', digest(project), { schema: 1, root: project });
      // Only a genuinely new selection can advance administration; an existing
      // binding or an explicitly selected run must not demote that shared base.
      if (!identity && digest(readBytes(selected.root, 'internal/releases/bootstrap.js')) === currentRegistration.bootstrapHash) { currentRegistration.baseBundle = selected.key; registry.put('registration', key, currentRegistration); }
      return { binding: value, bundle: selected, registration, project, readyAdmissionObserved, activationAdmissionObserved };
    };
    if (bundle) return admitResolved(this, this.registry(registry => bind(registry, bundle)), request, maintenance, preparing);
    requireValue(!maintenance || identity, 'release-unavailable', 'Maintenance cannot create a new work binding');
    return admitResolved(this, await this.captureCurrent(registration, identity, bind, project), request, maintenance, preparing);
  }

  reconcileOperations(registry, runs = this.runInventory(), selection = undefined) {
    for (const { key, value } of registry.list('operation')) {
      if (key === this.context.bootstrapOperation || processAlive(value.pid) !== false) continue;
      if (['bootstrap', 'capture'].includes(value.kind) || value.phase === 'prepared' || value.contained === true && processAlive(value.runnerPid) === false && processAlive(value.childPid) === false) {
        if (value.kind === 'entry' && value.phase !== 'prepared') {
          if (selection !== undefined && (!selection.run || value.project !== selection.project || value.runId !== referenceId(selection.run) || ['create', 'handover', 'open-review'].includes(value.runtimeAction))) continue;
          const binding = registry.get('session', sessionKey(value.registration, value.session));
          requireValue(binding, 'run-resource-state-unavailable', 'Terminated operation lost its session reference');
          // Missing action metadata is an older, potentially run-creating lease.
          if (selection === undefined) this.reconcileRunReferences(registry, binding, value.runtimeAction !== null ? value.project : null, { runs });
          else this.reconcileSelectedReference(registry, binding, selection.project, selection.run);
        }
        if (value.kind === 'entry') cleanOperationFiles(value.project, key);
        registry.remove('operation', key);
      }
    }
  }

  reconcileSelectedReference(registry, binding, project, run) {
    if (!run) return;
    const resources = executionResources(run);
    const owns = matchesBinding(resources, binding, registry.root);
    const historical = !owns && historicalBinding(run, binding, registry.root);
    if (!owns && !historical) return;
    let reference = binding.runs.find(reference => reference.project === project && reference.id === referenceId(run));
    if (!reference) {
      requireValue(!owns || !run.adoptions?.length, 'adoption-reference-unavailable', 'Committed adoption lost its protected target reference; retain resources until reconciled');
      reference = { project, id: referenceId(run), retired: false };
      binding.runs.push(reference);
    }
    if (historical) this.reconcileAdoptedTarget(registry, project, run);
    reference.historical = historical;
    delete reference.pendingAdoption;
    registry.put('session', sessionKey(binding.registration, binding.session), binding);
  }

  // `only` limits reconciliation to the one project an operation could have changed; `runs` shares a transaction's parsed run stores.
  reconcileRunReferences(registry, binding, requiredProject = null, { only = null, runs = this.runInventory() } = {}) {
    // Project admission precedes child execution. Reconcile that provisional
    // reference even when a crash prevented the later run-id attachment.
    for (const project of only === null ? binding.projects : [only]) {
      for (const run of runs(project, project === requiredProject || binding.runs.some(reference => reference.project === project))) {
        this.reconcileSelectedReference(registry, binding, project, run);
      }
    }
    registry.put('session', sessionKey(binding.registration, binding.session), binding);
  }

  requireProjectOwnershipInventory(registry, project, runs) {
    const records = runs(project, false);
    const references = new Set(records.map(referenceId));
    for (const { value: binding } of registry.list('session')) {
      for (const reference of binding.runs.filter(reference => reference.project === project)) {
        requireValue(references.has(reference.id), 'run-resource-state-unavailable', 'Known project ownership state is missing; preserve its references and reconcile it before canonical work');
      }
    }
  }

  reconcileAdoptedTarget(registry, project, run) {
    const resources = executionResources(run);
    requireValue(resources?.store === registry.root, 'adoption-reference-unavailable', 'Adopted run current resources are missing or belong to another store');
    const target = registry.get('session', sessionKey(resources.registration, resources.session));
    requireValue(target && matchesBinding(resources, target, registry.root) && target.projects.includes(project), 'adoption-reference-unavailable', 'Adopted run target session is missing or incompatible; retain its source references');
    const reference = target.runs.find(reference => reference.project === project && reference.id === referenceId(run));
    requireValue(reference && (target.state === 'bound' && !reference.retired || target.state === 'retired' && reference.retired), 'adoption-reference-unavailable', 'Adopted run target reference is incomplete; retain its source references');
    reference.historical = false;
    delete reference.pendingAdoption;
    registry.put('session', sessionKey(target.registration, target.session), target);
  }

  requireAdoptionSource(registry, project, run, runs = this.runInventory()) {
    const resources = executionResources(run);
    const source = registry.get('session', sessionKey(resources.registration, resources.session));
    requireValue(source?.state === 'bound' && matchesBinding(resources, source, registry.root), 'adoption-source-retired', 'The current execution binding is missing or retired; recover its exact resources before adoption');
    this.reconcileRunReferences(registry, source, project, { runs });
    requireValue(source.runs.some(reference => reference.project === project && reference.id === referenceId(run) && !reference.retired), 'adoption-source-retired', 'The current run reference was retired; recover its exact resources before adoption');
  }

  requireUnownedAdoption(registry, binding, reference, run) {
    requireValue(run && run.resourceMode === 'bound' && !activeWorkers(run), 'run-resource-state-unavailable', 'Pending adoption cancellation requires readable bound run state and reconciled workers');
    requireValue(!projectOperationActive(registry, reference.project), 'resource-operation-busy', 'A project operation may still commit or depend on the pending adoption');
    requireValue(run.adoptions === undefined || Array.isArray(run.adoptions), 'run-resource-state-unavailable', 'Adoption history is unavailable or unsupported');
    const history = run.adoptions ?? [];
    requireValue(history.every(adoption => adoption && typeof adoption === 'object' && !Array.isArray(adoption)), 'run-resource-state-unavailable', 'Adoption history contains an unsupported record');
    requireValue(history.length ? isDeepStrictEqual(run.adoption, history.at(-1)) : run.adoption === undefined, 'run-resource-state-unavailable', 'Current adoption and ownership history do not agree');
    const registration = registry.get('registration', binding.registration);
    requireValue(registration, 'run-resource-state-unavailable', 'The pending target registration is unavailable');
    const controllers = [run.controller, ...history.flatMap(adoption => [adoption.previousController, adoption.controller])];
    requireValue(controllers.every(controller => ['claude', 'codex'].includes(controller?.host) && typeof controller.session === 'string' && controller.session.length > 0), 'run-resource-state-unavailable', 'Ownership history has missing controller attribution');
    const resources = [run.resources, executionResources(run), ...history.flatMap(adoption => [adoption.previousExecutionResources, adoption.executionResources])];
    for (const resource of resources) {
      const checked = executionResources({ resourceMode: 'bound', executionResources: resource });
      requireValue(checked.store === registry.root && checked.identity === binding.identity, 'run-resource-state-unavailable', 'Ownership history has incompatible retained resources');
    }
    let previousResources = run.resources;
    const originalRegistration = registry.get('registration', previousResources.registration);
    let previousController = { host: originalRegistration?.host, session: previousResources.session };
    for (const adoption of history) {
      requireValue(isDeepStrictEqual(adoption.previousExecutionResources, previousResources) && isDeepStrictEqual(adoption.previousController, previousController), 'run-resource-state-unavailable', 'Adoption ownership history is incomplete');
      previousResources = adoption.executionResources;
      previousController = adoption.controller;
    }
    requireValue(isDeepStrictEqual(previousResources, executionResources(run)) && isDeepStrictEqual(previousController, run.controller), 'run-resource-state-unavailable', 'Current ownership is not explained by its saved history');
    requireValue(!resources.some(resource => matchesBinding(resource, binding, registry.root)) && !controllers.some(controller => controller.host === registration.host && controller.session === binding.session), 'adoption-cancellation-owned', 'A current or historical owner reference cannot be cancelled as an uncommitted adoption');
  }

  async run(key, request) {
    request = normalizeRuntimeTarget(request, true);
    requireValue(Object.hasOwn(ENTRIES, request.entry), 'unknown-release-entry', ENTRY_CHOICE);
    requireValue(request.timeoutMs === undefined || Number.isSafeInteger(request.timeoutMs) && request.timeoutMs > 0 && request.timeoutMs <= processes.MAX_OPERATION_TIMEOUT_MS, 'invalid-operation-timeout', 'Operation timeout must be a positive integer no greater than one hour');
    if (request.entry === 'runtime') {
      requireValue(request.request && typeof request.request === 'object' && !Array.isArray(request.request), 'invalid-runtime-request', 'Supply a runtime request object with action');
      const known = this.registry(registry => registry.get('session', sessionKey(key, request.session)));
      const bound = known ? this.registry(registry => bundles.availableIdentity(registry, known.identity)) : null;
      requireValue(bound ? acceptsRuntimeAction(bound, request.request.action) : isRuntimeAction(request.request.action), 'invalid-runtime-request', unknownActionMessage(request.request.action));
    }
    if (request.entry === 'setup') requireValue(request.options === undefined || request.options && typeof request.options === 'object' && !Array.isArray(request.options), 'invalid-setup-options', 'Setup options must be an object');
    if (request.entry === 'unwrap') requireValue((request.target === undefined || typeof request.target === 'string' && request.target.length > 0) && (request.write === undefined || typeof request.write === 'boolean'), 'invalid-unwrap-options', 'Unwrap target and write options have invalid types');
    requireConsistentRunId(request);
    const readOnly = request.entry === 'runtime' && isReadOnlyAction(request.request.action);
    const maintenance = readOnly || request.entry === 'runtime' && MAINTENANCE.has(request.request.action);
    const canonical = request.entry === 'runtime' ? requiresOwnershipInventory(request.request) : request.entry === 'unwrap' && request.write === true || request.entry === 'setup';
    const resolved = await this.resolve(key, request, maintenance);
    const operation = randomUUID();
    const context = this.registry(registry => {
      const runs = this.runInventory();
      const run = request.entry === 'runtime' ? this.dependencies.readRun(resolved.project, requestedReferenceId(request.request)) : null;
      this.reconcileOperations(registry, runs, canonical ? undefined : { project: resolved.project, run });
      requireValue(readOnly || !projectOperationActive(registry, resolved.project, !canonical), 'resource-operation-busy', 'A project operation is active or its termination is uncertain');
      if (canonical) this.requireProjectOwnershipInventory(registry, resolved.project, runs);
      const binding = registry.get('session', sessionKey(key, request.session));
      if (canonical) this.reconcileRunReferences(registry, binding, null, { runs });
      else this.reconcileSelectedReference(registry, binding, resolved.project, run);
      if (request.entry === 'runtime' && request.request.action === 'adopt') {
        requireValue(run && referenceId(run) === requestedReferenceId(request.request), 'adoption-run-unavailable', 'The current record changed during adoption admission');
        this.requireAdoptionSource(registry, resolved.project, run, runs);
      }
      if (!readOnly && request.entry === 'runtime' && !isCreationRequest(request.request) && !['create', 'adopt'].includes(request.request.action) && run) {
        if (completedReportConfirmation(request, run, resolved.registration.host, request.session)) requireConfirmableReport(run, this.dependencies.readRun(resolved.project), registry.root);
        else requireValue(matchesBinding(executionResources(run), binding, registry.root) && run.controller.host === resolved.registration.host && run.controller.session === request.session, 'resource-owner-mismatch', 'Only the current execution binding and controller can mutate this run');
      }
      if (request.entry === 'runtime' && isCreationRequest(request.request) && run?.acceptance?.handoverId && run.acceptance.handoverId === request.request.handoverId) {
        requireValue(matchesBinding(executionResources(run), binding, registry.root) && run.controller.host === resolved.registration.host && run.controller.session === request.session, 'resource-owner-mismatch', 'Only the current owner can reconcile an existing acceptance');
      }
      if (!readOnly && run?.adoptions?.length && matchesBinding(executionResources(run), binding, registry.root)) this.reconcileAdoptedTarget(registry, resolved.project, run);
      // Taken before the contained launch starts its timer, so the runtime sees a deadline no later than the actual one.
      const operationDeadlineUtc = new Date(Date.now() + (request.timeoutMs ?? processes.MAX_OPERATION_TIMEOUT_MS)).toISOString();
      const value = { schema: 1, mode: 'bound', store: registry.root, registration: key, session: request.session, identity: resolved.bundle.identity, bundle: resolved.bundle.key, project: resolved.project, operation, operationDeadlineUtc, ...(resolved.integration ? { integration: resolved.integration } : {}) };
      registry.put('operation', operation, { ...value, kind: 'entry', state: 'running', phase: 'prepared', pid: process.pid, implementationBundle: this.context.implementationBundle ?? resolved.bundle.key, maintenance, runtimeAction: request.entry === 'runtime' ? request.request.action : null, runId: requestedReferenceId(request.request) ?? null });
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
          const identityField = isCreationRequest(value) || value.action === 'create' ? 'controller' : !isReadOnlyAction(value.action) ? 'actor' : null;
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
      const run = request.entry === 'runtime' ? this.dependencies.readRun(resolved.project, requestedReferenceId(request.request)) : null;
      if (request.entry === 'runtime' && (isCreationRequest(request.request) || request.request.action === 'create')) readRuns(resolved.project, true);
      // The child could change only its own project's runs, so each binding naming that project reconciles that project alone.
      if (run && matchesBinding(executionResources(run), resolved.binding, this.store)) this.registry(registry => {
        const runs = this.runInventory();
        for (const { value: binding } of registry.list('session')) {
          if (binding.projects.includes(resolved.project)) {
            if (canonical) this.reconcileRunReferences(registry, binding, resolved.project, { only: resolved.project, runs });
            else this.reconcileSelectedReference(registry, binding, resolved.project, run);
          }
        }
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

  // SessionStart's activation depends on this owner lookup alone: before it the hook waits for the registry at most
  // HOOK_LOCK_WAIT_MS in the bootstrap and as long again for its registration read, and a later failure is caught once the
  // activation is saved. So the lookup takes the launcher's full inspection budget inside the host's 60-second hook timeout.
  // Every session's later work depends on the activation, so its write, like the failure record, waits the hook's registry
  // bound whether or not the session owns a run. The hook stays silent for a session that owns no running run, so a failed
  // lookup leaves its cause where status and dependent admission can show it; one that cannot be saved is lost.
  recordActivation(key, registration, session) {
    const skey = sessionKey(key, session);
    let inspectionFailure = null;
    const owner = this.dependencies.nativeOwner(registration.host, registration.profile, this.inspection(cause => { inspectionFailure = cause; }, processes.INSPECTION_BUDGET_MS));
    if (!owner) {
      const cause = 'Native host process identity could not be established' + (inspectionFailure === null ? '' : ` because process inspection failed (${inspectionFailure})`);
      try { this.registry(registry => registry.put('activation-failure', skey, { schema: 1, registration: key, session, generation: registration.generation, cause, observedAt: new Date().toISOString() })); }
      catch { /* The hook stays silent without the record, as it was before the record existed. */ }
      requireValue(false, 'native-activation-unavailable', cause);
    }
    this.registry(registry => {
      registry.put('activation', skey, { schema: 1, registration: key, session, generation: registration.generation, owner, observedAt: new Date().toISOString() });
      registry.remove('activation-failure', skey);
    });
    return owner;
  }

  async hook(key, input) {
    let ownerRun = null;
    let ownerResources = null;
    let project;
    let registration;
    try {
      project = require('../runtime/hook').projectRoot(input.cwd);
      if (project) ownerRun = this.dependencies.readRun(project, undefined, 0);
      if (ownerRun) ownerResources = Object.hasOwn(ownerRun, 'executionResources') ? ownerRun.executionResources : ownerRun.resources;
      registration = this.registration(key);
      const identifiable = ownerRun?.controller?.host === registration.host && ownerRun.controller.session === input.session_id && ownerRun.status === 'running';
      if (identifiable && ownerRun.resourceMode === 'development') return {};
      if (registration.state !== 'registered' || registration.pending) return identifiable ? { systemMessage: 'Nightshift host setup is incomplete; saved work remains incomplete.' } : {};
      const observedOwner = input.hook_event_name === 'SessionStart' ? this.recordActivation(key, registration, input.session_id) : null;
      const binding = this.registry(registry => registry.get('session', sessionKey(key, input.session_id)), { nonblocking: !identifiable });
      if (!binding) return project && fs.existsSync(path.join(project, '.nightshift')) ? { hookSpecificOutput: input.hook_event_name === 'SessionStart' ? { hookEventName: 'SessionStart', additionalContext: `Nightshift native session: ${input.session_id}. Retained launcher: ${registration.bootstrap}. Registration: ${key}. Resolve resources through this launcher before using Nightshift.` } : undefined } : {};
      requireValue(binding.state === 'bound', 'retired-release-binding', 'This Nightshift session was retired');
      if (identifiable) {
        requireValue(matchesBinding(executionResources(ownerRun), binding, this.store), 'legacy-release-reconciliation', 'The owned run does not match this retained resource binding');
        if (ownerRun.adoptions?.length) this.registry(registry => this.reconcileAdoptedTarget(registry, project, ownerRun));
      }
      // Claude scopes project settings to the working directory, so an unresolvable
      // Nightshift project root still inspects the actual cwd rather than the profile.
      await this.requireActivation(registration, input.session_id, false, project ?? input.cwd, observedOwner);
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
      return ownerRun?.controller?.session === input.session_id && ownerRun.status === 'running' && ownerResources?.registration === key && (!registration || ownerRun.controller.host === registration.host) ? { systemMessage: `Nightshift could not reconcile protected resources: ${error.message}. Saved work remains incomplete.${registration ? ` Recovery launcher: ${registration.bootstrap}. Registration: ${key}.` : ''}` } : {};
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
      const runs = this.runInventory();
      this.reconcileOperations(registry, runs);
      const target = text(request.targetSession, 'session selected for retirement');
      const cancellations = request.cancelAdoptions === undefined ? [] : request.cancelAdoptions;
      requireValue(Array.isArray(cancellations) && cancellations.every(id => typeof id === 'string' && id.trim().length > 0) && new Set(cancellations).size === cancellations.length, 'invalid-adoption-cancellation', 'cancelAdoptions must list unique pending run identities');
      requireValue(!registry.list('operation').some(entry => entry.key !== this.context.bootstrapOperation && entry.value.registration === key && entry.value.session === target), 'resource-operation-busy', 'The session has active or unreconciled operations');
      const skey = sessionKey(key, target);
      const binding = registry.get('session', skey);
      const activation = registry.get('activation', skey);
      const failure = registry.get('activation-failure', skey);
      requireValue(binding || activation || failure, 'unknown-release-session', 'No activation, recorded activation failure or work binding exists for that session');
      const cancelled = new Set();
      if (binding) {
        this.reconcileRunReferences(registry, binding, null, { runs });
        requireValue(cancellations.every(id => binding.runs.some(reference => reference.id === id && reference.pendingAdoption === true)), 'adoption-cancellation-unavailable', 'Select only pending adoptions that have not become current or historical ownership');
        for (const reference of binding.runs) {
          const run = referencedRun(runs, reference);
          if (reference.pendingAdoption) {
            requireValue(cancellations.includes(reference.id), 'adoption-cancellation-required', 'Explicitly select the failed pending run in cancelAdoptions to abandon its uncommitted target reference');
            this.requireUnownedAdoption(registry, binding, reference, run);
            cancelled.add(reference);
            continue;
          }
          if (reference.historical) {
            requireValue(run && historicalBinding(run, binding, registry.root), 'run-resource-state-unavailable', 'Historical source ownership cannot be verified');
            this.reconcileAdoptedTarget(registry, reference.project, run);
            reference.retired = true;
            continue;
          }
          requireValue(!projectOperationActive(registry, reference.project), 'resource-operation-busy', 'A project operation may still depend on this current run reference');
          requireValue(run && !activeWorkers(run), 'run-resource-state-unavailable', 'Associated run/worker state is missing or active');
          if (run.status !== 'complete' && !reference.retired) requireValue(request.retireRuns?.includes(reference.id) && run.status === 'stopped', 'run-retirement-required', 'Stop and explicitly select unfinished runs before abandoning their retained resources');
          reference.retired = true;
        }
        // Cancelled attempts never owned this run. Removing their provisional
        // references prevents ordinary session recovery from reviving them.
        binding.runs = binding.runs.filter(reference => !cancelled.has(reference));
        binding.state = 'retired'; binding.retiredAt = new Date().toISOString();
        registry.put('session', skey, binding);
      } else requireValue(cancellations.length === 0, 'adoption-cancellation-unavailable', 'Activation-only sessions have no pending adoptions to cancel');
      registry.remove('activation', skey);
      registry.remove('activation-failure', skey);
      return { retired: target, resourcesDeleted: false, ...(cancelled.size ? { cancelledAdoptions: [...cancelled].map(reference => reference.id) } : {}) };
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
      const runs = this.runInventory();
      this.reconcileOperations(registry, runs);
      bundles.reconcileOrphans(registry);
      const keep = new Set();
      const keepIdentity = new Set();
      for (const registration of registry.list('registration').map(entry => entry.value)) {
        if (registration.baseBundle) keep.add(registration.baseBundle);
        if (registration.pending?.baseBundle) keep.add(registration.pending.baseBundle);
      }
      for (const operation of registry.list('operation').map(entry => entry.value)) { keep.add(operation.bundle); if (operation.implementationBundle) keep.add(operation.implementationBundle); }
      for (const binding of registry.list('session').map(entry => entry.value)) {
        this.reconcileRunReferences(registry, binding, null, { runs });
        if (binding.state === 'bound') keepIdentity.add(binding.identity);
        for (const reference of binding.runs) {
          const run = referencedRun(runs, reference);
          requireValue(run, 'run-resource-state-unavailable', 'A registered run cannot be read; collection retains all resources');
          if (reference.historical) {
            requireValue(historicalBinding(run, binding, registry.root), 'run-resource-state-unavailable', 'Historical source ownership cannot be verified');
            this.reconcileAdoptedTarget(registry, reference.project, run);
            continue;
          }
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

module.exports = { ENTRIES, MAINTENANCE, ReleaseService, activeWorkers, defaultStore, locatorState, readRun, readRunStore };
