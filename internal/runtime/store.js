'use strict';

const { workerIsActive } = require('./workers');

const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

class RunError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RunError';
    this.code = code;
  }
}

function requireCondition(condition, code, message) {
  if (!condition) throw new RunError(code, message);
}

function text(value, name) {
  requireCondition(typeof value === 'string' && value.trim().length > 0, 'invalid-request', `${name} must be nonempty text`);
  return value;
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
    if (options.create && !options.legacy) {
      const legacy = path.join(this.root, '.claude/runs/state.sqlite');
      requireCondition(!fs.existsSync(legacy), 'legacy-run-state', 'Legacy run state exists at .claude/runs/state.sqlite; inspect and migrate it before creating a current run');
    }
    const relative = options.legacy ? '.claude/runs' : '.nightshift/runs';
    const existed = fs.existsSync(path.join(this.root, relative));
    requireCondition(options.create || existed, 'missing-state', 'No Nightshift run database exists');
    this.directory = safeDirectory(this.root, relative, options.create === true);
    if (options.create && !existed) fs.writeFileSync(path.join(this.directory, '.gitignore'), '*\r\n', { flag: 'wx' });
    const database = path.join(this.directory, 'state.sqlite');
    for (const candidate of [database, database + '-journal', database + '-wal', database + '-shm']) {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.lstatSync(candidate);
      requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'unsafe-path', 'Run database must be an ordinary unlinked file');
    }
    requireCondition(options.create || fs.existsSync(database), 'missing-state', 'No Nightshift run database exists');
    this.db = new DatabaseSync(database);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    const version = this.db.prepare('PRAGMA user_version').get().user_version;
    requireCondition([0, 1, 2].includes(version), 'state-version', `Unsupported run database version ${version}`);
    if (version === 0) {
      this.db.exec('BEGIN IMMEDIATE; CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL); CREATE TABLE active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL REFERENCES runs(id)); CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision)); PRAGMA user_version=1; COMMIT;');
    }
    if (version < 2) this.db.exec('BEGIN IMMEDIATE; CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=2; COMMIT;');
  }

  close() { this.db.close(); }

  read(id, options = {}) {
    const row = id === undefined
      ? this.db.prepare('SELECT r.state FROM runs r JOIN active a ON a.id=r.id WHERE a.singleton=1').get()
      : this.db.prepare('SELECT state FROM runs WHERE id=?').get(id);
    if (!row) return null;
    const state = JSON.parse(row.state);
    requireCondition(state.schema === 1 && state.root === this.root, 'wrong-project', 'Run state belongs to a different schema or project');
    return options.hydrate === false ? state : this.hydrate(state);
  }

  hydrate(value) {
    if (value === null || typeof value !== 'object') return value;
    if (value.$artifact) {
      const row = this.db.prepare('SELECT body FROM artifacts WHERE id=?').get(value.$artifact);
      requireCondition(row, 'missing-evidence', 'Referenced immutable evidence is missing');
      requireCondition(createHash('sha256').update(row.body).digest('hex') === value.$artifact, 'changed-evidence', 'Immutable evidence no longer matches its content identity');
      return JSON.parse(row.body);
    }
    if (Array.isArray(value)) return value.map(item => this.hydrate(item));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.hydrate(item)]));
  }

  encode(state) {
    const copy = structuredClone(state);
    const stash = value => {
      const body = JSON.stringify(value);
      const id = createHash('sha256').update(body).digest('hex');
      this.db.prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?)').run(id, body);
      return { $artifact: id };
    };
    for (const task of copy.tasks) {
      for (const check of task.checks) {
        if (check.snapshot) check.snapshot = stash(check.snapshot);
        if (typeof check.output === 'string' && check.output.length > 4096) check.output = stash(check.output);
      }
      for (const review of task.reviews) {
        if (review.snapshot) review.snapshot = stash(review.snapshot);
        if (review.contextSnapshot) review.contextSnapshot = stash(review.contextSnapshot);
      }
      for (const finding of task.findings) if (finding.validation?.snapshot) finding.validation.snapshot = stash(finding.validation.snapshot);
    }
    return copy;
  }

  history(id) {
    return this.db.prepare('SELECT revision, kind, recorded_at AS recordedAt, state FROM history WHERE run_id=? ORDER BY revision').all(id).map(row => ({ ...row, state: this.hydrate(JSON.parse(row.state)) }));
  }

  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  save(state, kind) {
    const bytes = JSON.stringify(this.encode(state));
    this.db.prepare('INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, state=excluded.state').run(state.id, state.revision, bytes);
    this.db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(state.id, state.revision, kind, state.updatedAt, bytes);
  }

  create(input) {
    return this.transaction(() => {
      const previous = this.read();
      requireCondition(!previous || ['complete', 'stopped'].includes(previous.status) && previous.workers.every(worker => !workerIsActive(worker)), 'overlapping-run', 'An unfinished run already owns this checkout; reconcile or resume it');
      text(input.controller?.host, 'controller.host');
      requireCondition(['claude', 'codex'].includes(input.controller.host), 'unsupported-host', 'Use a supported Windows host');
      text(input.controller.session, 'controller.session');
      text(input.authority, 'authority');
      text(input.objective, 'objective');
      require('./limits').validateLimits(input.limits ?? {});
      requireCondition(input.mode === undefined || ['attended', 'unattended'].includes(input.mode), 'invalid-mode', 'Run mode must be attended or unattended');
      requireCondition(Array.isArray(input.tasks) && input.tasks.length > 0, 'empty-queue', 'An authorized finite queue is required');
      const ids = input.tasks.map(task => text(task.id, 'task.id'));
      requireCondition(new Set(ids).size === ids.length, 'invalid-queue', 'Task identities must be unique');
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
      const now = new Date().toISOString();
      const state = { schema: 1, id: randomUUID(), root: this.root, revision: 0, createdAt: now, updatedAt: now, objective: input.objective, authority: input.authority, controller: input.controller, publication: input.publication ?? { authorized: false }, limits: input.limits ?? {}, mode: input.mode ?? 'attended', resourceMode: input.resourceMode ?? 'development', resources: input.resources ?? null, dispatches: 0, status: 'running', tasks, workers: [], followups: [], continuation: null };
      this.save(state, 'created');
      this.db.prepare('INSERT INTO active VALUES (1, ?) ON CONFLICT(singleton) DO UPDATE SET id=excluded.id').run(state.id);
      return state;
    });
  }

  update(actor, revision, kind, change) {
    return this.transaction(() => {
      const state = this.read();
      requireCondition(state !== null, 'missing-state', 'No active run');
      requireCondition(state.revision === revision, 'stale-state', 'Run changed; read current obligations before retrying');
      requireCondition(state.controller.session === actor?.session && state.controller.host === actor?.host, 'wrong-owner', 'Only the owning controller can change this run');
      change(state);
      state.revision++;
      state.updatedAt = new Date().toISOString();
      this.save(state, kind);
      return state;
    });
  }
}

module.exports = { RunStore, RunError, requireCondition, safeDirectory, text };
