'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { digest, requireValue, text } = require('./io');

const KINDS = new Set(['registration', 'activation', 'session', 'bundle', 'operation', 'project']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const IDENTITY = /^\d+\.\d+\.\d+-[a-f0-9]{64}$/;

function validateRecord(kind, key, value, root) {
  requireValue(value?.schema === 1 && typeof value === 'object' && !Array.isArray(value), 'invalid-release-record', `Unsupported ${kind} record`);
  if (kind === 'bundle') requireValue(value.key === key && UUID.test(key) && IDENTITY.test(value.identity) && HASH.test(value.manifestDigest) && path.relative(root, value.root) === path.join('bundles', key), 'invalid-release-record', 'Invalid retained bundle record');
  if (kind === 'registration') {
    requireValue(HASH.test(key) && value.key === key && ['codex', 'claude'].includes(value.host) && path.isAbsolute(value.profile) && ['preparing', 'registered', 'removed'].includes(value.state), 'invalid-release-record', 'Invalid host registration');
    const plan = value.bootstrap ? value : value.pending;
    requireValue(plan && UUID.test(plan.baseBundle) && HASH.test(plan.bootstrapHash) && HASH.test(plan.generation) && typeof plan.bootstrap === 'string' && path.relative(root, plan.bootstrap).split(path.sep).join('/').startsWith('launchers/'), 'invalid-release-record', 'Registration has no safe administrative resources');
  }
  if (kind === 'session') requireValue(HASH.test(value.registration) && typeof value.session === 'string' && key === sessionKey(value.registration, value.session) && ['bound', 'retired'].includes(value.state) && IDENTITY.test(value.identity) && UUID.test(value.bundle) && Array.isArray(value.projects) && value.projects.every(item => typeof item === 'string' && path.isAbsolute(item)) && Array.isArray(value.runs) && value.runs.every(item => item && typeof item.id === 'string' && typeof item.project === 'string' && path.isAbsolute(item.project) && typeof item.retired === 'boolean'), 'invalid-release-record', 'Invalid session binding or reference inventory');
  if (kind === 'activation') requireValue(HASH.test(value.registration) && typeof value.session === 'string' && key === sessionKey(value.registration, value.session) && HASH.test(value.generation) && Number.isSafeInteger(value.owner?.pid) && typeof value.owner.created === 'string', 'invalid-release-record', 'Invalid native activation');
  if (kind === 'operation') requireValue(UUID.test(key) && ['bootstrap', 'capture', 'entry'].includes(value.kind) && value.state === 'running' && Number.isSafeInteger(value.pid) && value.pid > 0 && UUID.test(value.bundle), 'invalid-release-record', 'Invalid active-operation inventory');
  if (kind === 'project') requireValue(typeof value.root === 'string' && path.isAbsolute(value.root) && key === digest(value.root), 'invalid-release-record', 'Invalid registered project');
  return value;
}

function registrationKey(host, profile) {
  requireValue(['codex', 'claude'].includes(host), 'unsupported-release-host', 'Host must be codex or claude');
  const canonical = fs.realpathSync.native(text(profile, 'host profile'));
  return digest(JSON.stringify([host, process.platform === 'win32' ? canonical.toUpperCase() : canonical]));
}

function sessionKey(registration, session) { return digest(JSON.stringify([registration, text(session, 'native session')])); }

class Registry {
  constructor(root, options = {}) {
    requireValue(path.isAbsolute(text(root, 'retained store')), 'invalid-release-store', 'Retained store must be absolute');
    if (options.create) fs.mkdirSync(root, { recursive: true });
    requireValue(fs.existsSync(root), 'release-setup-required', 'Nightshift host setup has not created the retained store');
    this.root = fs.realpathSync.native(root);
    this.file = path.join(this.root, 'registry.sqlite');
    requireValue(options.create || fs.existsSync(this.file), 'release-setup-required', 'Nightshift host setup has not created its registry');
    for (const file of [this.file, this.file + '-wal', this.file + '-shm', this.file + '-journal']) {
      if (!fs.existsSync(file)) continue;
      const stat = fs.lstatSync(file);
      requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'unsafe-release-store', 'Retained registry files must be ordinary unlinked files');
    }
    this.db = new DatabaseSync(this.file);
    try {
      this.db.exec(`PRAGMA busy_timeout=${options.nonblocking ? 0 : 5000}; PRAGMA synchronous=FULL;`);
      const version = this.db.prepare('PRAGMA user_version').get().user_version;
      requireValue(version === 1 || version === 0 && options.create, 'unsupported-release-store', 'Retained registry schema is unsupported');
      if (version === 0) this.db.exec('BEGIN IMMEDIATE; CREATE TABLE records (kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,key)); PRAGMA user_version=1; COMMIT;');
    } catch (error) { this.db.close(); throw error; }
  }

  close() { this.db.close(); }

  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(this); requireValue(!result?.then, 'invalid-release-transaction', 'Registry transactions must not cross asynchronous boundaries'); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  get(kind, key) {
    requireValue(KINDS.has(kind), 'invalid-release-record', 'Unknown retained record kind');
    const row = this.db.prepare('SELECT value FROM records WHERE kind=? AND key=?').get(kind, text(key, 'record key'));
    requireValue(!row || Buffer.byteLength(row.value) <= 4 * 1024 * 1024, 'invalid-release-record', 'Saved retained record exceeds its bound');
    return row ? validateRecord(kind, key, JSON.parse(row.value), this.root) : null;
  }

  list(kind) {
    requireValue(KINDS.has(kind), 'invalid-release-record', 'Unknown retained record kind');
    const rows = this.db.prepare('SELECT key,value FROM records WHERE kind=? ORDER BY key LIMIT 100001').all(kind);
    requireValue(rows.length <= 100000, 'release-inventory-limit', 'Retained inventory exceeds the supported check bound; preserve resources');
    return rows.map(row => { requireValue(Buffer.byteLength(row.value) <= 4 * 1024 * 1024, 'invalid-release-record', 'Saved retained record exceeds its bound'); return { key: row.key, value: validateRecord(kind, row.key, JSON.parse(row.value), this.root) }; });
  }

  put(kind, key, value) {
    requireValue(KINDS.has(kind), 'invalid-release-record', 'Unknown retained record kind');
    validateRecord(kind, key, value, this.root);
    const encoded = JSON.stringify(value);
    requireValue(encoded && Buffer.byteLength(encoded) <= 4 * 1024 * 1024, 'invalid-release-record', 'Retained record exceeds its size bound');
    this.db.prepare('INSERT INTO records(kind,key,value) VALUES(?,?,?) ON CONFLICT(kind,key) DO UPDATE SET value=excluded.value').run(kind, text(key, 'record key'), encoded);
  }

  remove(kind, key) {
    requireValue(KINDS.has(kind), 'invalid-release-record', 'Unknown retained record kind');
    this.db.prepare('DELETE FROM records WHERE kind=? AND key=?').run(kind, text(key, 'record key'));
  }

  assertKnownKinds() { requireValue(this.db.prepare('SELECT DISTINCT kind FROM records').all().every(row => KINDS.has(row.kind)), 'unsupported-release-store', 'Unknown retained reference kinds prevent safe collection'); }
}

module.exports = { Registry, registrationKey, sessionKey };
