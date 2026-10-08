'use strict';

const { workerIsActive } = require('./workers');
const { CLOSING_TARGET } = require('./actions');
const { RunError, requireCondition, text } = require('./errors');
const { recordKind } = require('./records');
const { acceptanceInput, replayAcceptance } = require('./delivery-acceptance');

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// How long a connection to a project's run store waits for another process's commit before failing with "database is locked".
const RUN_STORE_WAIT_MS = 5000;
// The database formats a run store opens; version 0 is a fresh file this runtime initializes, so only later ones hold records.
const STORE_VERSIONS = Object.freeze([0, 1, 2]);
const REMINDER_WRITES = new WeakMap();
function requireReplaceableDelivery(context) {
  requireCondition(!context.reportPending, 'report-delivery-pending', 'The latest delivery\'s morning report awaits its recipient: present the saved report, record report-delivered with the user\'s reply, then accept the new delivery');
  requireCondition(context.replaceable, 'overlapping-run', 'A surviving delivery still has unresolved obligations; reconcile, resume or explicitly finish it');
}

function reminderContent(state) {
  const { progress, stopRecovery, revision, updatedAt, ...content } = state;
  return require('./progress').fingerprint(content);
}

function nextRevision(state) {
  requireCondition(Number.isSafeInteger(state.revision) && state.revision >= 0 && state.revision < Number.MAX_SAFE_INTEGER, 'revision-overflow', 'Run revision cannot be safely advanced');
  return state.revision + 1;
}

function safeDirectory(root, relative, create = false) {
  const canonical = fs.realpathSync.native(root);
  let current = canonical;
  for (const segment of relative.split('/')) {
    requireCondition(segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\'), 'unsafe-path', 'Invalid runtime directory');
    current = path.join(current, segment);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync.native(current) === current, 'unsafe-path', `Runtime directory is linked or not a directory: ${current}`);
  }
  return current;
}

class RunStore {
  constructor(root, options = {}) {
    this.root = fs.realpathSync.native(root);
    this.kind = options.review === true ? 'review' : 'delivery';
    this.contextId = options.review === true ? options.contextId : undefined;
    if (options.create && !options.legacy) {
      const legacy = path.join(this.root, '.claude/runs/state.sqlite');
      requireCondition(!fs.existsSync(legacy), 'legacy-run-state', 'Legacy run state exists at .claude/runs/state.sqlite; inspect and migrate it before creating a current run');
    }
    const relative = options.legacy ? '.claude/runs' : '.nightshift/runs';
    const existed = fs.existsSync(path.join(this.root, relative));
    requireCondition(options.create || existed, 'missing-state', 'No Nightshift run database exists');
    this.directory = safeDirectory(this.root, relative, options.create === true);
    if (options.create && !existed) fs.writeFileSync(path.join(this.directory, '.gitignore'), '*\r\n', { flag: 'wx' });
    const database = path.join(this.directory, options.review === true ? 'review-state.sqlite' : 'state.sqlite');
    for (const candidate of [database, database + '-journal', database + '-wal', database + '-shm']) {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.lstatSync(candidate);
      requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'unsafe-path', 'Run database must be an ordinary unlinked file');
    }
    requireCondition(options.create || fs.existsSync(database), 'missing-state', 'No Nightshift run database exists');
    this.db = new DatabaseSync(database);
    this.db.exec(`PRAGMA busy_timeout=${RUN_STORE_WAIT_MS}; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;`);
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    requireCondition(STORE_VERSIONS.includes(version), 'state-version', `Unsupported run database version ${version}`);
    if (version === 0) {
      this.db.exec('BEGIN IMMEDIATE; CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL); CREATE TABLE active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL REFERENCES runs(id)); CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision)); PRAGMA user_version=1; COMMIT;');
    }
    if (version < 2) this.db.exec('BEGIN IMMEDIATE; CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=2; COMMIT;');
    if (this.kind === 'delivery') this.db.exec('BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS accounting_commits (run_id TEXT NOT NULL, revision INTEGER NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, revision)); CREATE TABLE IF NOT EXISTS discharge_index (run_id TEXT NOT NULL, occurrence TEXT NOT NULL, evidence_hash TEXT NOT NULL, binding_hash TEXT NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, occurrence, evidence_hash, binding_hash, artifact)); COMMIT;');
  }

  close() { this.db.close(); }

  read(id, options = {}) {
    id ??= this.contextId;
    const row = id === undefined
      ? this.db.prepare('SELECT r.id, r.revision, r.state FROM runs r JOIN active a ON a.id=r.id WHERE a.singleton=1').get()
      : this.db.prepare('SELECT id, revision, state FROM runs WHERE id=?').get(id);
    if (!row) return null;
    const state = JSON.parse(row.state);
    requireCondition(state.id === row.id, 'invalid-state', 'Stored record identity does not match its selection');
    requireCondition(state.schema === 1 && state.root === this.root && recordKind(state) === this.kind, 'wrong-project', 'Runtime state belongs to a different schema, project or record kind');
    requireCondition(Number.isSafeInteger(row.revision) && row.revision >= 0 && state.revision === row.revision, 'invalid-revision', 'Runtime state has an invalid or contradictory revision');
    return options.hydrate === false ? state : this.hydrate(state);
  }

  hydrate(value, seen = new Set()) {
    if (value === null || typeof value !== 'object') return value;
    if (Object.hasOwn(value, '$artifact')) {
      requireCondition(Object.keys(value).length === 1 && /^[a-f0-9]{64}$/.test(value.$artifact) && !seen.has(value.$artifact), 'invalid-evidence', 'Immutable evidence envelope is malformed or recursive');
      const row = this.db.prepare('SELECT body FROM artifacts WHERE id=?').get(value.$artifact);
      requireCondition(row, 'missing-evidence', 'Referenced immutable evidence is missing');
      requireCondition(createHash('sha256').update(row.body).digest('hex') === value.$artifact, 'changed-evidence', 'Immutable evidence no longer matches its content identity');
      return this.hydrate(JSON.parse(row.body), new Set([...seen, value.$artifact]));
    }
    if (Array.isArray(value)) return value.map(item => this.hydrate(item, seen));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.hydrate(item, seen)]));
  }

  encode(state) {
    const copy = structuredClone(state);
    const stash = value => {
      if (value && typeof value === 'object' && Object.hasOwn(value, '$artifact')) {
        this.hydrate(value);
        return value;
      }
      const body = JSON.stringify(value);
      const id = createHash('sha256').update(body).digest('hex');
      this.db.prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?)').run(id, body);
      return { $artifact: id };
    };
    const stashFindings = findings => {
      for (const finding of findings) if (finding.validation?.snapshot) finding.validation.snapshot = stash(finding.validation.snapshot);
    };
    const closing = copy.closing?.docs;
    for (const target of closing ? [...copy.tasks, closing] : copy.tasks) {
      for (const check of target.checks) {
        if (check.snapshot) check.snapshot = stash(check.snapshot);
        if (typeof check.output === 'string' && check.output.length > 4096) check.output = stash(check.output);
      }
      for (const review of target.reviews) {
        if (review.snapshot) review.snapshot = stash(review.snapshot);
        if (review.contextSnapshot) review.contextSnapshot = stash(review.contextSnapshot);
      }
      stashFindings(target.findings);
      if (target.docsExemption?.snapshot) target.docsExemption.snapshot = stash(target.docsExemption.snapshot);
    }
    stashFindings(copy.closing?.carriedFindings ?? []);
    if (closing?.baseline) closing.baseline = stash(closing.baseline);
    if (copy.closing?.carriedBaseline) copy.closing.carriedBaseline = stash(copy.closing.carriedBaseline);
    return copy;
  }

  // Each saved transition without its state: every state expands the immutable evidence it references, so a long run's
  // states together can exceed what one response holds.
  transitions(id) {
    return this.db.prepare('SELECT revision, kind, recorded_at AS recordedAt FROM history WHERE run_id=? ORDER BY revision').all(id);
  }

  history(id, { fromRevision = 0, toRevision = Number.MAX_SAFE_INTEGER } = {}) {
    return this.db.prepare('SELECT revision, kind, recorded_at AS recordedAt, state FROM history WHERE run_id=? AND revision BETWEEN ? AND ? ORDER BY revision').all(id, fromRevision, toRevision).map(row => ({ ...row, state: this.hydrate(JSON.parse(row.state)) }));
  }

  transaction(action) {
    const lock = require('../unwrap-lock').acquireLock(this.directory, { name: 'write-ownership.sqlite', label: 'runtime project', codePrefix: 'runtime-ownership' });
    try {
      this.db.exec('BEGIN IMMEDIATE');
      this.writing = true;
      this.writeCapability = Symbol('runtime transaction');
      try {
        const result = action();
        requireCondition(!result?.then, 'invalid-runtime-transaction', 'Runtime transactions cannot cross asynchronous boundaries');
        lock.validate();
        this.db.exec('COMMIT');
        this.writing = false;
        this.writeCapability = null;
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        this.writing = false;
        this.writeCapability = null;
        throw error;
      }
    } finally {
      lock.close();
    }
  }

  save(state, kind, internal) {
    requireCondition(this.writing, 'invalid-runtime-transaction', 'Saving a run requires the project transaction');
    requireCondition(state.schema === 1 && state.root === this.root && recordKind(state) === this.kind && Number.isSafeInteger(state.revision) && state.revision >= 0, 'invalid-state', 'Saved state identity or revision is invalid');
    const row = this.db.prepare('SELECT revision, state FROM runs WHERE id=?').get(state.id);
    const previous = row ? JSON.parse(row.state) : null;
    if (previous) {
      requireCondition(previous.revision === row.revision && previous.root === this.root && recordKind(previous) === this.kind && previous.id === state.id, 'invalid-state', 'Committed predecessor identity or revision is invalid');
      requireCondition(state.revision === nextRevision(previous), 'stale-state', 'Saved state must immediately follow its committed predecessor');
    } else {
      requireCondition(state.revision === 0 && !this.db.prepare('SELECT 1 FROM history WHERE run_id=? LIMIT 1').get(state.id), 'missing-predecessor', 'Missing current state with surviving history is not creation');
      if (this.kind === 'delivery') requireReplaceableDelivery(require('./creation-consistency').creationAssessment(this));
    }
    const reminder = internal && REMINDER_WRITES.get(internal);
    if (reminder) {
      REMINDER_WRITES.delete(internal);
      requireCondition(reminder.store === this && reminder.transaction === this.writeCapability && reminder.candidate === state && previous && reminder.predecessorHash === require('./progress').encodedHash(previous) && reminderContent(state) === reminder.contentHash, 'invalid-reminder-state', 'Reminder capability is stale, foreign, replayed or its candidate changed');
    } else requireCondition(internal === undefined, 'invalid-reminder-state', 'Unknown internal save capability');
    const encoded = reminder ? structuredClone(state) : this.encode(state);
    if (this.kind === 'delivery') {
      const accounting = new (require('./progress-store').ProgressStore)(this);
      const account = reminder ? accounting.reminder(previous, encoded, reminder.account) : accounting.derive(previous, encoded, require('./discharge').registrations(state, encoded));
      accounting.persist(encoded, account);
      new (require('./provenance-store').ProvenanceStore)(accounting).persist(encoded, account, account.provenance);
      state.progress = structuredClone(encoded.progress);
      if (encoded.stopRecovery) state.stopRecovery = structuredClone(encoded.stopRecovery);
      else delete state.stopRecovery;
    }
    const bytes = JSON.stringify(encoded);
    this.db.prepare('INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, state=excluded.state').run(state.id, state.revision, bytes);
    this.db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(state.id, state.revision, kind, state.updatedAt, bytes);
  }

  remind(actor, revision, eligible) {
    return this.transaction(() => {
      const state = this.read(undefined, { hydrate: false });
      requireCondition(state && state.revision === revision, 'stale-state', 'Run changed before reminder issuance');
      requireCondition(this.kind === 'delivery' && state.controller.host === actor?.host && state.controller.session === actor?.session, 'wrong-owner', 'Only the owning delivery controller can receive a reminder');
      const captured = structuredClone(state);
      const eligibility = eligible(state);
      requireCondition(require('./progress').fingerprint(state) === require('./progress').fingerprint(captured), 'invalid-reminder-state', 'Eligibility inspection changed the reminder candidate');
      if (!eligibility) return { issued: false, reason: 'ineligible', state };
      const accounting = new (require('./progress-store').ProgressStore)(this);
      let account;
      try { account = accounting.read(state); }
      catch (error) { return { issued: false, reason: 'unavailable', diagnostic: error.code ?? 'progress-evidence-unavailable', state }; }
      if (account.marker.status !== 'current') return { issued: false, reason: 'unavailable', diagnostic: account.marker.reason, state };
      const previous = account.reminder;
      const count = previous?.token === account.marker.token ? previous.reminders : 0;
      if (count >= 3) return { issued: false, reason: 'exhausted', state };
      state.revision = nextRevision(state);
      state.updatedAt = new Date().toISOString();
      const capability = {};
      REMINDER_WRITES.set(capability, { store: this, transaction: this.writeCapability, candidate: state, predecessorHash: require('./progress').encodedHash(captured), contentHash: reminderContent(captured), account: structuredClone(account) });
      this.save(state, 'continuation-reminder', capability);
      return { issued: true, state };
    });
  }

  create(input) {
    return this.transaction(() => {
      requireCondition(this.kind === 'delivery' || input.tasks?.length === 1 && input.tasks[0].id === '#review' && input.handoverId === undefined && input.mechanism === undefined, 'invalid-runtime-target', 'Delivery acceptance cannot create a standalone review record');
      requireCondition(!Object.hasOwn(input, 'mode'), 'invalid-mode', 'Delivery has no attended or unattended mode');
      const context = this.kind === 'delivery' ? require('./creation-consistency').creationAssessment(this) : null;
      let previous = context ? context.current : this.read();
      if (this.kind === 'delivery' && input.handoverId !== undefined) {
        const identities = this.db.prepare("SELECT id FROM runs WHERE json_extract(state, '$.acceptance.handoverId')=? LIMIT 2").all(input.handoverId);
        requireCondition(identities.length <= 1 && (!identities.length || identities[0].id === previous?.id), 'handover-identity-conflict', 'Known historical acceptance cannot create or mutate another active delivery');
      }
      if (this.kind === 'delivery' && replayAcceptance(previous, input)) {
        previous = this.read();
        requireCondition(require('node:util').isDeepStrictEqual(previous.controller, input.controller), 'wrong-owner', 'Only the current owner can reconcile an existing handover');
        requireCondition(require('node:util').isDeepStrictEqual(previous.executionResources ?? previous.resources ?? null, input.resources ?? null), 'bound-runtime-required', 'Acceptance replay requires the current execution resource binding');
        if (previous.status === 'complete') return previous;
        const health = require('./continuation-health');
        const changedProcess = input.controllerClaim && !require('node:util').isDeepStrictEqual(previous.controllerClaim?.process, input.controllerClaim.process);
        if (previous.status === 'running') require('./project-ownership').assertCanonicalWriteScope(previous);
        if (changedProcess || input.integration !== undefined) {
          const revision = nextRevision(previous);
          if (changedProcess) {
            previous.controllerClaim = input.controllerClaim;
            health.invalidateContinuation(previous, 'The controller process changed during acceptance recovery; observe native continuation');
          }
          health.observeIntegration(previous, input.integration);
          require('./acknowledgement').refreshAcknowledgementOutcome(previous);
          previous.revision = revision;
          previous.updatedAt = new Date().toISOString();
          this.save(previous, 'acceptance-reconciled');
        }
        return previous;
      }
      text(input.controller?.host, 'controller.host');
      requireCondition(['claude', 'codex'].includes(input.controller.host), 'unsupported-host', 'Use a supported Windows host');
      text(input.controller.session, 'controller.session');
      text(input.authority, 'authority');
      text(input.objective, 'objective');
      require('./limits').validateLimits(input.limits ?? {});
      requireCondition(Array.isArray(input.tasks) && input.tasks.length > 0, 'empty-queue', 'An authorized finite queue is required');
      const ids = input.tasks.map(task => text(task.id, 'task.id'));
      requireCondition(new Set(ids).size === ids.length, 'invalid-queue', 'Task identities must be unique');
      requireCondition(!ids.includes(CLOSING_TARGET), 'invalid-queue', `The task identity ${CLOSING_TARGET} is reserved for the closing record`);
      const tasks = input.tasks.map(task => {
        text(task.title, 'task.title');
        text(task.agreement?.source, 'task.agreement.source');
        text(task.agreement?.outcome, 'task.agreement.outcome');
        const requires = task.requires ?? [];
        requireCondition(Array.isArray(requires) && requires.every(id => ids.includes(id) && id !== task.id), 'invalid-queue', 'Dependency is absent or self-referential');
        const kind = task.kind ?? 'code';
        requireCondition(['code', 'spec', 'docs', 'lore'].includes(kind), 'invalid-queue', 'Unknown task kind');
        const agreement = structuredClone(task.agreement);
        if (Object.hasOwn(agreement, 'spec')) require('./evidence').projectFile(this.root, text(agreement.spec, 'agreement.spec'));
        if (kind === 'code' && agreement.spec && agreement.specReviewed === true) {
          agreement.specSnapshot = require('./evidence').snapshot(this.root, [agreement.spec]);
          requireCondition(agreement.specSnapshot.files.every(file => file.sha256 !== null), 'missing-spec', 'A previously reviewed governing spec must exist');
        }
        return { id: task.id, title: task.title, agreement, requires, kind, status: 'pending', stage: kind === 'docs' ? 'documentation' : kind === 'lore' ? 'retrospective' : 'implementation', checks: [], reviews: [], findings: [], blocker: null };
      });
      const remaining = new Map(tasks.map(task => [task.id, task.requires.length]));
      const dependents = new Map(tasks.map(task => [task.id, []]));
      tasks.forEach(task => task.requires.forEach(dependency => dependents.get(dependency).push(task.id)));
      const available = tasks.filter(task => task.requires.length === 0).map(task => task.id);
      for (let index = 0; index < available.length; index++) {
        for (const dependent of dependents.get(available[index])) {
          remaining.set(dependent, remaining.get(dependent) - 1);
          if (remaining.get(dependent) === 0) available.push(dependent);
        }
      }
      requireCondition(available.length === tasks.length, 'invalid-queue', 'Queue contains a dependency cycle');
      if (context) requireReplaceableDelivery(context);
      else requireCondition(!previous || previous.status === 'complete' && previous.workers.every(worker => !workerIsActive(worker)), 'overlapping-run', 'An unfinished review context cannot be replaced');
      const now = new Date().toISOString();
      const state = { schema: 1, kind: this.kind, id: this.contextId ?? randomUUID(), root: this.root, revision: 0, createdAt: now, updatedAt: now, objective: input.objective, authority: input.authority, controller: input.controller, publication: input.publication ?? { authorized: false }, limits: input.limits ?? {}, resourceMode: input.resourceMode ?? 'development', resources: input.resources ?? null, executionResources: input.resources ?? null, controllerClaim: input.controllerClaim ?? null, operationReservations: 1, dispatches: 0, status: 'running', docsGate: this.kind === 'delivery' && input.docsGate !== false, tasks, workers: [], followups: [], continuation: null };
      if (this.kind === 'delivery') {
        require('./project-ownership').assertCanonicalWriteScope(state);
        state.handover = { authority: input.authority, revision: state.revision };
        state.acceptance = structuredClone(acceptanceInput(input));
      }
      else {
        delete state.controllerClaim;
        delete state.continuation;
        state.ownerObservation = input.ownerObservation;
        state.opening = { authority: input.authority, objective: input.objective, kind: input.tasks[0].kind, agreement: structuredClone(input.tasks[0].agreement), limits: structuredClone(input.limits ?? {}), resources: structuredClone(input.resources ?? null) };
      }
      const health = require('./continuation-health');
      health.observeIntegration(state, input.integration);
      if (this.kind === 'delivery' && input.mechanism !== undefined) state.continuation = health.continuationForRequest(state, input.mechanism, input.integration);
      if (this.kind === 'delivery') require('./acknowledgement').renewAcknowledgement(state, state.revision, state.createdAt);
      this.save(state, 'created');
      this.db.prepare('INSERT INTO active VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id').run(state.id);
      return state;
    });
  }

  update(actor, revision, kind, change, { recipientConfirmation = false } = {}) {
    const updated = this.transaction(() => {
      const state = this.read();
      requireCondition(state !== null, 'missing-state', 'No active run');
      requireCondition(state.revision === revision, 'stale-state', 'Run changed; read current obligations before retrying');
      const owner = state.controller.session === actor?.session && state.controller.host === actor?.host;
      // Only the recipient's confirmation of a completed delivery's morning report may come from another admitted session.
      const confirming = recipientConfirmation && this.kind === 'delivery' && state.status === 'complete' && kind === 'report-delivered';
      requireCondition(owner || confirming, 'wrong-owner', 'Only the owning controller can change this run');
      const next = nextRevision(state);
      if (this.kind === 'delivery') {
        const capability = this.writeCapability;
        let bindings = {};
        try {
          const accounting = new (require('./progress-store').ProgressStore)(this);
          bindings = new (require('./provenance-store').ProvenanceStore)(accounting).read(this.read(undefined, { hydrate: false }))?.bindings ?? {};
        } catch {
          // Unresolved provenance supplies no source capability; independently admitted work remains available.
        }
        require('./discharge').begin(state, candidate => this.encode(candidate), () => this.writing === true && this.writeCapability === capability, bindings);
        try {
          const accounting = new (require('./progress-store').ProgressStore)(this).read(this.read(undefined, { hydrate: false }));
          require('./progress').establishClosingContext(state, accounting.frontier);
        } catch {
          // Unknown accounting cannot supply closing provenance; otherwise admitted work retains its authority.
        }
      }
      const health = require('./continuation-health');
      if (!this.integrationRecorded) {
        health.observeIntegration(state, this.integration);
      }
      const acknowledgement = require('./acknowledgement');
      acknowledgement.refreshAcknowledgementOutcome(state);
      if (this.acknowledgementObservation) acknowledgement.recordAcknowledgement(state, this.acknowledgementObservation);
      change(state, this.integration);
      require('./acknowledgement').refreshAcknowledgementOutcome(state);
      state.revision = next;
      state.updatedAt = new Date().toISOString();
      this.save(state, kind);
      return state;
    });
    this.acknowledgementObservation = null;
    this.integrationRecorded = true;

    return updated;
  }

  adopt(request, resources, dependencies) {
    return this.transaction(() => {
      const state = this.read();
      requireCondition(state, 'missing-state', 'No current run is available to adopt');
      const last = state.adoption;
      if (state.id === request.runId && state.controller.host === request.actor?.host && state.controller.session === request.actor?.session && last?.observedRevision === request.revision && last.previousController.host === request.previousController?.host && last.previousController.session === request.previousController?.session && last.authority === request.authority) return state;
      const revision = nextRevision(state);
      require('./ownership').adoptState(state, request, resources, dependencies);
      state.revision = revision;
      state.updatedAt = new Date().toISOString();
      this.save(state, 'adopt');

      return state;
    });
  }
}

module.exports = { RUN_STORE_WAIT_MS, STORE_VERSIONS, RunStore, RunError, requireCondition, safeDirectory, text };
