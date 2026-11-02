'use strict';

// The administrative close of settled records (.nightshift/specs/close-settled-records.md): close-manifest shows what closing drops
// and close records the user's approval, moving each member to the final status `closed` through its store's ordinary save path.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { isDeepStrictEqual } = require('node:util');
const { RunError, requireCondition } = require('./errors');
const { workerIsActive } = require('./workers');
const { isClosed } = require('./statuses');
const { BACKUP, BUILDING, SIDECARS, STORES } = require('./history-compaction');
const { HistoryReader } = require('./history-store');
const { MAX_TARGET_READ_BYTES, targetEntry } = require('./legacy-backlog');
const { MAX_AUTHORITY_BYTES, MAX_CERTIFICATE_BYTES, MAX_MANIFEST_BYTES } = require('./legacy-certificates');
const { validReportDelivery } = require('./report-delivery');
const progress = require('./progress');

// The first release that knows the closed status; sessions and records bound to earlier releases cannot read a closed record.
const CLOSE_SUPPORT_VERSION = '3.3.26';
const MAX_MEMBERS = 20;
const MAX_REASON_BYTES = 1024;
const STORE_ORDER = Object.freeze(['delivery', 'review']);
const WARNED_COST = 'It may be a live session that fails closed on later store-reading operations after the close or, past its run\'s deadline, appends the exhausted-limit stop; end or restart it before replying';

// --- Grammar ------------------------------------------------------------------------------------------------------------------

// One entry check shared by `members` and `acknowledgedRecords`: exactly {store, id}, store delivery or review, nonempty string id.
function validEntry(entry) {
  return Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry) && Object.keys(entry).sort().join(',') === 'id,store' && Object.hasOwn(STORES, entry.store) && typeof entry.id === 'string' && entry.id.length > 0;
}

const entryKey = entry => `${entry.store}\n${entry.id}`;

function validateMembers(members) {
  requireCondition(Array.isArray(members) && members.length > 0 && members.length <= MAX_MEMBERS && members.every(validEntry) && new Set(members.map(entryKey)).size === members.length, 'migration-manifest-unavailable', `Close needs one to ${MAX_MEMBERS} distinct {store, id} members, store delivery or review`);

  return members.map(member => ({ store: member.store, id: member.id }));
}

function validateAcknowledged(list) {
  if (list === undefined) return [];
  requireCondition(Array.isArray(list) && list.every(validEntry) && new Set(list.map(entryKey)).size === list.length, 'migration-decision-unavailable', 'acknowledgedRecords holds distinct {store, id} entries, store delivery or review');

  return list.map(entry => ({ store: entry.store, id: entry.id })).sort((left, right) => entryKey(left) < entryKey(right) ? -1 : entryKey(left) > entryKey(right) ? 1 : 0);
}

// --- Versions and identities --------------------------------------------------------------------------------------------------

function versionOf(identity) {
  const match = typeof identity === 'string' ? /^(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(identity) : null;

  return match ? match.slice(1, 4).map(Number) : null;
}

// True for an identity that names no parseable version, as for development and legacy records: the cautious reading.
function olderThanSupport(identity) {
  const version = versionOf(identity);
  if (!version) return true;
  const floor = versionOf(CLOSE_SUPPORT_VERSION);
  for (let index = 0; index < 3; index++) if (version[index] !== floor[index]) return version[index] < floor[index];

  return false;
}

// The same rule as executionResources() in internal/releases/entry.js: executionResources when the key is present, even when null.
function releaseIdentity(state) {
  const resources = Object.hasOwn(state, 'executionResources') ? state.executionResources : state.resources ?? null;

  return resources?.identity ?? null;
}

// --- Reading the stores -------------------------------------------------------------------------------------------------------

// A store whose file is absent with no sidecars and no compaction leftovers holds no records; any other state that cannot be read is
// unreadable, never empty.
function readStore(root, store) {
  const file = path.join(root, '.nightshift/runs', STORES[store]);
  const exists = candidate => Boolean(fs.lstatSync(candidate, { throwIfNoEntry: false }));
  if (SIDECARS.some(suffix => exists(file + suffix))) return { store, unreadable: 'A SQLite journal, WAL or shared-memory file survives beside the store' };
  if (!exists(file)) {
    if (exists(file + BACKUP) || exists(file + BUILDING)) return { store, unreadable: 'The store file is absent beside a compaction backup or build file: run compact-history to finish the swap, or restore the backup as its message directs' };

    return { store, absent: true, states: [], retired: new Set(), tables: new Set() };
  }
  let database;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return { store, unreadable: 'The store is not an ordinary singly linked file' };
    database = new DatabaseSync(file, { readOnly: true });
    database.exec('PRAGMA busy_timeout=5000');
    const version = database.prepare('PRAGMA user_version').get().user_version;
    if (![1, 2, 3].includes(version)) return { store, unreadable: `Unsupported store version ${version}` };
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    const retired = new Set(tables.has('legacy_retirements') ? database.prepare('SELECT run_id FROM legacy_retirements').all().map(row => row.run_id) : []);
    const states = [];
    for (const row of database.prepare('SELECT id, revision, state FROM runs').all()) {
      const state = JSON.parse(row.state);
      const kindMatches = store === 'review' ? state?.kind === 'review' : state?.kind === undefined || state?.kind === 'delivery';
      if (!(state?.schema === 1 && state.id === row.id && state.revision === row.revision && state.root === root && kindMatches && require('./statuses').isRecordStatus(state.status) && Array.isArray(state.workers))) return { store, unreadable: `Record ${row.id} fails its state check` };
      states.push(state);
    }

    return { store, absent: false, states, retired, tables, file };
  } catch (error) {
    return { store, unreadable: error?.message ?? String(error) };
  } finally {
    database?.close();
  }
}

function historyState(root, store, id, revision) {
  const database = new DatabaseSync(path.join(root, '.nightshift/runs', STORES[store]), { readOnly: true });
  try {
    const row = new HistoryReader(database, id).text(revision);
    requireCondition(row, 'migration-store-unavailable', `History of ${id} lacks revision ${revision}`);

    return JSON.parse(row.state);
  } finally { database.close(); }
}

// --- Projection ---------------------------------------------------------------------------------------------------------------

function findingCounts(state) {
  const { settled } = require('./lifecycle');
  const findings = [...state.tasks.flatMap(task => task.findings ?? []), ...(state.closing?.docs?.findings ?? []), ...(state.closing?.carriedFindings ?? [])];
  const counts = { pendingClosure: 0, pendingRepair: 0, pendingRepairRequired: 0, unverified: 0, pendingDisposition: 0 };
  for (const finding of findings.filter(item => !settled(item) || item.pendingClosure)) {
    if (finding.pendingClosure) counts.pendingClosure++;
    else if (finding.disposition === 'implement' && !finding.repaired) {
      counts.pendingRepair++;
      if (finding.obligation?.classification === 'required') counts.pendingRepairRequired++;
    } else if (!finding.validation || finding.validation.verdict === 'unverified') counts.unverified++;
    else counts.pendingDisposition++;
  }

  return counts;
}

function reportFacts(state) {
  if (!state.handover) return { owed: false, recorded: false, delivered: false, path: null, savedHash: null };
  const evidence = state.closing?.reportEvidence ?? null;
  const delivered = Boolean(evidence) && validReportDelivery(state, evidence.sha256);

  return { owed: require('./creation-consistency').reportAwaitsRecipient(state), recorded: Boolean(evidence), delivered, path: evidence?.path ?? null, savedHash: evidence?.sha256 ?? null };
}

// The authoritative member: exactly these keys. `reconciles` comes from the termination evidence the verdict proved, or for a member
// already closed under the request's hash, from its closure, so a retry's projection needs no liveness evidence.
function projectMember(store, state, reconciles) {
  const member = {
    store, id: state.id, revision: state.revision, status: state.status, objective: state.objective ?? null, stop: state.stop ?? null, hold: state.hold ?? null,
    identity: releaseIdentity(state),
    workers: state.workers.map(worker => ({ id: worker.id ?? null, status: worker.status, active: workerIsActive(worker), reconciles: reconciles.get(worker.id) ?? null })),
    incompleteTasks: state.tasks.filter(task => task.status !== 'complete').map(task => ({ id: task.id, title: task.title ?? null, stage: task.stage ?? null })),
    findings: findingCounts(state),
    followups: (state.followups ?? []).filter(item => item.status !== 'resolved'),
  };
  if (store === 'delivery') {
    const report = reportFacts(state);
    member.closing = { stage: require('./lifecycle').closingStage(state), report: { recorded: report.recorded, delivered: report.delivered, path: report.path } };
  }

  return member;
}

// --- Eligibility --------------------------------------------------------------------------------------------------------------

function sameClosure(state, request) {
  return isClosed(state) && state.closure?.manifestHash === request?.manifestHash && state.closure?.authority === request?.authority && state.closure?.reason === request?.reason;
}

function accountingCurrent(root, state) {
  const file = path.join(root, '.nightshift/runs', STORES.delivery);
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    database.exec('BEGIN');
    const accounting = new (require('./progress-store').ProgressStore)({ db: database, root, kind: 'delivery' });
    try { return accounting.read(state).marker.status === 'current'; }
    catch {
      // Unreadable or unresolved accounting is not current; close refuses rather than committing an undischargeable record.
      return false;
    } finally { database.exec('ROLLBACK'); }
  } finally { database.close(); }
}

function eligibility(root, read, state, ownerAlive) {
  if (state.status === 'complete') return { code: 'close-not-needed', message: `Record ${state.id} is complete; nothing is left to close` };
  if (isClosed(state)) return { code: 'run-closed', message: `Record ${state.id} is already closed` };
  if (read.retired.has(state.id)) return { code: 'retired-run', message: `Delivery ${state.id} is retired` };
  const verdict = require('./ownership').adoptionEligibility(state, {}, { ownerAlive });
  if (!verdict.eligible) {
    const message = verdict.code === 'worker-activity-unknown' ? `${verdict.message.replace(/; reconcile attributable termination before adoption$/, '')}; close accepts no native worker evidence in this release, so reconcile or prove that worker's termination first` : verdict.message.replace(/adoption|adopted/g, 'close');

    return { code: verdict.code, message };
  }
  if (read.store === 'delivery') {
    if (!read.tables.has('accounting_commits') || !read.tables.has('discharge_index')) return { code: 'close-accounting-unavailable', message: `Delivery store lacks the accounting tables; ${state.status === 'running' ? 'a running legacy delivery has no close or retire route in this release: stop it through its own release first, or acknowledge it' : 'retire this stopped legacy record instead'}` };
    if (!accountingCurrent(root, state)) return { code: 'close-accounting-unavailable', message: state.status === 'running' ? 'Its accounting is not current; stop it through its own release first' : 'Its accounting is not current: consult migration inventory; retire it when listed as legacy, otherwise inspect it with raw-inspect and restore its accounting evidence' };
  }

  return { eligible: true, reconciles: new Map(verdict.workers.filter(evidence => workerIsActive(state.workers.find(worker => worker.id === evidence.workerId) ?? {})).map(evidence => [evidence.workerId, evidence])) };
}

// --- Older-release guard ------------------------------------------------------------------------------------------------------

function sessionFindings(root, context, ownerAlive) {
  const { Registry, sessionKey } = require('../releases/registry');
  const refusals = [];
  const warnings = [];
  let registry;
  try {
    registry = new Registry(context.store);
    const canonical = fs.realpathSync.native(root);
    for (const { value: binding } of registry.list('session')) {
      if (binding.state !== 'bound' || !binding.projects.some(project => { try { return fs.realpathSync.native(project) === canonical; } catch { return false; } }) || !olderThanSupport(binding.identity)) continue;
      const named = { session: binding.session, identity: binding.identity };
      if (binding.session === context.session) {
        refusals.push({ ...named, reason: 'The requesting session is bound to an older release; close from a new session on a current release' });
        continue;
      }
      const key = sessionKey(binding.registration, binding.session);
      const activation = registry.get('activation', key);
      if (!activation) {
        warnings.push({ ...named, kind: 'no-activation', note: WARNED_COST });
        continue;
      }
      const registration = registry.get('registration', binding.registration);
      const alive = ownerAlive(activation.owner, registration?.profile ?? root);
      if (alive !== false) {
        refusals.push({ ...named, owner: activation.owner, reason: alive === true ? 'Its activation owner process is alive: exit that host process, or retire its binding, before closing' : 'Its activation owner could not be inspected' });
        continue;
      }
      const failure = registry.get('activation-failure', key);
      if (failure && Date.parse(failure.observedAt) > Date.parse(activation.observedAt)) warnings.push({ ...named, kind: 'newer-activation-failure', note: `Its latest SessionStart failed after the recorded activation, so it may be live in an unrecorded process. ${WARNED_COST}` });
    }
    for (const { value: registration } of registry.list('registration')) {
      if (registration.state !== 'registered') continue;
      const plan = registration.bootstrap ? registration : registration.pending;
      const bundle = plan?.baseBundle ? registry.get('bundle', plan.baseBundle) : null;
      if (bundle && olderThanSupport(bundle.identity)) warnings.push({ registration: registration.key, host: registration.host, identity: bundle.identity, kind: 'older-host-registration', note: 'Every new session on this host binds to that older release until its plugin is updated' });
    }
  } catch (error) {
    refusals.push({ registry: context.store, reason: `The release registry could not be read: ${error?.message ?? String(error)}` });
  } finally { registry?.close(); }

  return { refusals, warnings };
}

// --- Manifest -----------------------------------------------------------------------------------------------------------------

function normalizeChoice(root, member, state, choice, targetBudget) {
  requireCondition(choice && typeof choice === 'object' && !Array.isArray(choice), 'migration-decision-unavailable', `Close choice for ${member.store} ${member.id} is missing`);
  requireCondition(choice.report && typeof choice.report === 'object' && !Array.isArray(choice.report) && typeof choice.report.kind === 'string', 'migration-decision-unavailable', `Report choice for ${member.id} must be retire's {kind} grammar`);
  const report = member.store === 'delivery' ? reportFacts(state) : { owed: false, delivered: false, savedHash: null };
  const valid = member.store === 'review' || !state.handover ? 'none' : report.delivered ? 'already-delivered' : 'waived';
  requireCondition(choice.report.kind === valid, 'migration-decision-unavailable', `Report choice for ${member.id} must be ${valid}`);
  const pending = (state.followups ?? []).filter(item => item.status !== 'resolved');
  const selections = choice.followups ?? [];
  requireCondition(Array.isArray(selections) && selections.length === pending.length && selections.every(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string') && new Set(selections.map(item => item.id)).size === pending.length, 'migration-decision-unavailable', `Pending follow-ups of ${member.id} need distinct dispositions`);
  const followups = pending.map(item => {
    const selected = selections.find(candidate => candidate.id === item.id);
    requireCondition(selected && ['tracked', 'dismissed'].includes(selected.disposition), 'migration-decision-unavailable', `Follow-up ${item.id} lacks a disposition`);
    requireCondition(selected.disposition !== 'dismissed' || selected.destination == null, 'migration-decision-unavailable', `Dismissed follow-up ${item.id} has a destination`);
    const destination = selected.disposition === 'tracked' ? targetEntry(root, selected.destination, targetBudget) : null;

    return { id: item.id, sourceHash: progress.fingerprint(item), disposition: selected.disposition, destination };
  }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

  return { store: member.store, id: member.id, report: { kind: choice.report.kind, sha256: report.savedHash ?? null }, followups };
}

// Computes the manifest from what the stores and registry hold now. `ownerAlive` answers process liveness; close passes one that
// replays results inspected before the write lock, so nothing is inspected while it is held.
function computeManifest(root, request, context, ownerAlive, { requireChoices = false } = {}) {
  const members = validateMembers(request.members);
  const acknowledgedRecords = validateAcknowledged(request.acknowledgedRecords);
  const reads = new Map(STORE_ORDER.map(store => [store, readStore(root, store)]));
  const memberKeys = new Set(members.map(entryKey));
  const records = [];
  const ineligible = [];
  const states = new Map();
  for (const member of members) {
    const read = reads.get(member.store);
    if (read.unreadable) {
      ineligible.push({ ...member, code: 'migration-store-unavailable', message: read.unreadable });
      records.push({ store: member.store, id: member.id });
      continue;
    }
    const state = read.states.find(candidate => candidate.id === member.id);
    if (!state) {
      ineligible.push({ ...member, code: 'migration-run-unavailable', message: `No ${member.store} record ${member.id} exists` });
      records.push({ store: member.store, id: member.id });
      continue;
    }
    if (sameClosure(state, request)) {
      // Already closed by this approval: projected from the revision it was approved at, with reconciles from its own closure.
      const original = historyState(root, member.store, state.id, state.closure.previousRevision);
      const reconciles = new Map((state.closure.reconciledWorkers ?? []).map(entry => [entry.id, entry.evidence]));
      states.set(entryKey(member), { state: original, closed: state });
      records.push(projectMember(member.store, original, new Map([...reconciles].map(([id, evidence]) => [id, evidence?.kind ?? null]))));
      continue;
    }
    const verdict = eligibility(root, read, state, ownerAlive);
    states.set(entryKey(member), { state, verdict });
    if (!verdict.eligible) ineligible.push({ ...member, code: verdict.code, message: verdict.message });
    records.push(projectMember(member.store, state, new Map([...(verdict.reconciles ?? new Map())].map(([id, evidence]) => [id, evidence.kind]))));
  }
  const refusals = [];
  const named = [];
  for (const read of reads.values()) {
    if (read.unreadable) {
      refusals.push({ store: read.store, reason: read.unreadable });
      continue;
    }
    for (const state of read.states) {
      if (memberKeys.has(entryKey({ store: read.store, id: state.id })) || !['running', 'stopped'].includes(state.status) || read.retired.has(state.id) || !olderThanSupport(releaseIdentity(state))) continue;
      const own = eligibility(root, read, state, ownerAlive);
      named.push({ store: read.store, id: state.id, status: state.status, resourceMode: state.resourceMode ?? 'legacy', identity: releaseIdentity(state), risk: 'An older session could resume or write to it and would then fail project-wide', closeEligible: own.eligible === true, closeCode: own.code ?? null });
    }
  }
  const namedKeys = new Set(named.map(entryKey));
  for (const entry of acknowledgedRecords) requireCondition(namedKeys.has(entryKey(entry)), 'migration-decision-unavailable', `acknowledgedRecords names ${entry.store} ${entry.id}, which the older-release guard does not name`);
  const acknowledged = new Set(acknowledgedRecords.map(entryKey));
  for (const record of named) if (!acknowledged.has(entryKey(record))) refusals.push({ ...record, reason: 'Unfinished record bound to an older release; include it, finish or retire it, or acknowledge it by name' });
  const sessions = context ? sessionFindings(root, context, ownerAlive) : { refusals: [{ reason: 'No admitted migration context: the older-release guard cannot read the release registry' }], warnings: [] };
  refusals.push(...sessions.refusals);
  const guard = { named, refusals, warnings: sessions.warnings };
  let choices = null;
  if (request.choices !== undefined || requireChoices) {
    const supplied = request.choices;
    requireCondition(Array.isArray(supplied) && supplied.length === members.length && supplied.every(choice => validEntry({ store: choice?.store, id: choice?.id })) && new Set(supplied.map(choice => entryKey(choice))).size === members.length && members.every(member => supplied.some(choice => entryKey(choice) === entryKey(member))), 'migration-decision-unavailable', 'Close choices must cover each member exactly once');
    const targetBudget = { bytes: 0, maximum: MAX_TARGET_READ_BYTES, cache: new Map() };
    choices = members.map(member => {
      const held = states.get(entryKey(member));
      requireCondition(held, 'migration-decision-unavailable', `Member ${member.id} has no record to choose for`);

      return normalizeChoice(root, member, held.state, supplied.find(choice => entryKey(choice) === entryKey(member)), targetBudget);
    });
  }
  const approval = { schema: 1, members, records, choices, acknowledgedRecords, guard: guard.warnings };
  requireCondition(Buffer.byteLength(JSON.stringify(progress.canonical(approval))) <= MAX_MANIFEST_BYTES, 'migration-manifest-unavailable', 'The close approval exceeds 8 MiB; close fewer records at a time');
  const hash = choices && ineligible.length === 0 && refusals.length === 0 ? progress.fingerprint(approval) : null;

  return { schema: 1, members, records, ineligible, guard, acknowledgedRecords, choices, hash, approval, states, reads };
}

function publicManifest(manifest) {
  const { approval, states, reads, ...visible } = manifest;

  return visible;
}

// --- Close --------------------------------------------------------------------------------------------------------------------

function requireCloseRequest(request, context) {
  requireCondition(typeof request.authority === 'string' && request.authority.trim() && Buffer.byteLength(request.authority) <= MAX_AUTHORITY_BYTES, 'migration-authority-required', 'Close needs the user\'s exact final reply, at most 4 KiB');
  requireCondition(typeof request.reason === 'string' && request.reason.trim() && Buffer.byteLength(request.reason) <= MAX_REASON_BYTES, 'close-reason-required', 'Close needs the user\'s reason in their own words, at most 1 KiB');
  requireCondition(progress.HASH.test(request.manifestHash ?? ''), 'migration-manifest-unavailable', 'Close needs the approved manifest hash');
  requireCondition(context, 'migration-admission-required', 'Close requires current administrative admission, so the older-release guard can read the release registry');
  requireCondition(request.actor?.host === context.host && request.actor?.session === context.session, 'migration-authority-required', 'Close actor differs from the admitted session');
}

// Liveness inspected once before any store transaction, then replayed inside it: an identity not inspected is uncertain (null).
function recordingLiveness(base) {
  const results = new Map();
  const key = owner => JSON.stringify(owner ?? null);

  return {
    inspect: (owner, cwd) => {
      const value = base(owner, cwd);
      results.set(key(owner), value);
      return value;
    },
    replay: owner => (results.has(key(owner)) ? results.get(key(owner)) : null),
  };
}

function storeHandle(root, store) {
  const { RunStore } = require('./store');

  return new RunStore(root, store === 'review' ? { review: true } : {});
}

function closeState(state, closure, reconciles) {
  const closed = structuredClone(state);
  closed.status = 'closed';
  closed.closure = closure;
  for (const worker of closed.workers) if (reconciles.has(worker.id)) worker.status = 'stopped';
  closed.revision = state.revision + 1;
  closed.updatedAt = closure.recordedAt;

  return closed;
}

function writeStore(root, store, request, context, liveness, dependencies) {
  const handle = storeHandle(root, store);
  try {
    return handle.transaction(() => {
      const manifest = computeManifest(root, request, context, liveness.replay, { requireChoices: true });
      requireCondition(manifest.ineligible.length === 0 && manifest.guard.refusals.length === 0, manifest.ineligible[0]?.code ?? 'close-older-release-present', manifest.ineligible[0]?.message ?? `The older-release guard refuses: ${manifest.guard.refusals.map(refusal => refusal.reason).slice(0, 3).join('; ')}`);
      requireCondition(manifest.hash === request.manifestHash, 'migration-manifest-stale', 'The approved manifest differs from the current stores, registry or choices');
      dependencies.afterRecompute?.(store);
      const body = JSON.stringify(progress.canonical(manifest.approval));
      const approval = createHash('sha256').update(body).digest('hex');
      handle.db.prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?)').run(approval, body);
      const closed = [];
      for (const member of manifest.members.filter(entry => entry.store === store).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)) {
        const held = manifest.states.get(entryKey(member));
        if (held.closed) {
          closed.push({ store, id: member.id, closure: held.closed.closure, written: false });
          continue;
        }
        const state = handle.read(member.id);
        requireCondition(state && state.revision === held.state.revision, 'migration-manifest-stale', `Record ${member.id} changed after the manifest was computed`);
        const reconciledWorkers = [...held.verdict.reconciles].map(([id, evidence]) => ({ id, previousStatus: state.workers.find(worker => worker.id === id).status, evidence: { kind: evidence.kind } })).sort((left, right) => left.id < right.id ? -1 : 1);
        const closure = { authority: request.authority, reason: request.reason, manifestHash: request.manifestHash, approval, reconciledWorkers, previousStatus: state.status, previousRevision: state.revision, recordedAt: new Date().toISOString(), actor: { host: context.host, session: context.session } };
        const bytes = Buffer.byteLength(JSON.stringify(progress.canonical(closure)));
        const fixed = bytes - Buffer.byteLength(request.authority) - Buffer.byteLength(request.reason);
        requireCondition(bytes <= MAX_CERTIFICATE_BYTES, 'migration-certificate-bound', fixed + 2 > MAX_CERTIFICATE_BYTES ? `The closure for ${member.id} exceeds 8 KiB even with the shortest reply and reason, so this record cannot be closed in this release; it stays unchanged until a separately authorized limit change` : `The closure for ${member.id} exceeds 8 KiB; give a shorter reply or reason`);
        const next = closeState(state, closure, held.verdict.reconciles);
        handle.save(next, 'close');
        if (store === 'delivery') requireCondition(next.progress?.status === 'current', 'close-accounting-unavailable', `Accounting for ${member.id} is not current at the close revision; nothing was closed in this store`);
        closed.push({ store, id: member.id, closure, written: true });
      }

      return closed;
    });
  } finally { handle.close(); }
}

function close(root, request, context, dependencies = {}) {
  requireCloseRequest(request, context);
  root = fs.realpathSync.native(root);
  const liveness = recordingLiveness(dependencies.ownerAlive ?? require('../releases/processes').ownerAlive);
  // Inspection pass outside the lock; its manifest is not trusted, only the liveness it recorded.
  computeManifest(root, request, context, liveness.inspect, { requireChoices: true });
  const stores = STORE_ORDER.filter(store => request.members.some(member => member?.store === store));
  const results = [];
  const committed = [];
  for (const store of stores) {
    try {
      results.push(...writeStore(root, store, request, context, liveness, dependencies));
      committed.push(store);
    } catch (error) {
      if (committed.length && error instanceof RunError) throw new RunError(error.code, `${error.message}. Already committed: ${committed.join(', ')} store members; retry the identical request, or read each member's status and present a new manifest for the members not yet closed`);
      throw error;
    }
  }

  return { state: 'closed', manifestHash: request.manifestHash, members: results.map(({ written, ...entry }) => entry) };
}

function closeManifest(root, request, context, dependencies = {}) {
  root = fs.realpathSync.native(root);
  const manifest = computeManifest(root, request, context, dependencies.ownerAlive ?? require('../releases/processes').ownerAlive);

  return publicManifest(manifest);
}

module.exports = { CLOSE_SUPPORT_VERSION, close, closeManifest, olderThanSupport, releaseIdentity };
