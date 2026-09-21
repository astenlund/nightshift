'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { comparableIdentity, stableOpenFile } = require('./filesystem-primitives');

const LOCK_NAME = '.nightshift-unwrap-lock.sqlite';
const MAX_LOCK_BYTES = 64 * 1024;
const isLockName = name => process.platform === 'win32' ? name.toLowerCase() === LOCK_NAME : name === LOCK_NAME;

function lockError(file, cause) {
  const error = new Error(`Cannot establish unwrap writer ownership at ${file}: ${cause.message}`, { cause });
  error.code = /database is locked/.test(cause.message) ? 'unwrap-busy' : 'unwrap-lock-invalid';
  return error;
}

function parentIdentity(parent) {
  const metadata = fs.lstatSync(parent, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || fs.realpathSync.native(parent) !== parent) throw new Error('Parent is not a canonical directory');
  return comparableIdentity(metadata);
}

function rejectSidecars(file) {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    try { fs.lstatSync(file + suffix); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    throw new Error('Unexpected SQLite sidecar; preserve it and reconcile ownership');
  }
}

function readOwnership(database) {
  const objects = database.prepare("SELECT name, type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
  if (objects.length !== 1 || objects[0].name !== 'ownership' || objects[0].type !== 'table') throw new Error('Unrecognized lock schema');
  const rows = database.prepare('SELECT format, parent, parent_id, file_id FROM ownership').all();
  if (rows.length !== 1 || rows[0].format !== 1) throw new Error('Unrecognized lock ownership');
  return rows[0];
}

function inspectLock(parent) {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(parent, LOCK_NAME);
  try {
    rejectSidecars(file);
    const parentId = parentIdentity(parent);
    const snapshot = stableOpenFile(parent, file, { requireSingleLink: true, maxBytes: MAX_LOCK_BYTES });
    const database = new DatabaseSync(file, { readOnly: true });
    let ownership;
    try { ownership = readOwnership(database); } finally { database.close(); }
    const after = stableOpenFile(parent, file, { requireSingleLink: true, maxBytes: MAX_LOCK_BYTES });
    if (snapshot.identity !== after.identity || snapshot.rawSha256 !== after.rawSha256 || parentIdentity(parent) !== parentId
      || ownership.parent !== parent || ownership.parent_id !== parentId || ownership.file_id !== snapshot.identity) throw new Error('Lock ownership changed');
    return { file, parent, parentId, ...snapshot };
  } catch (cause) { throw lockError(file, cause); }
}

function acquireLock(parent, { create = true } = {}) {
  const { DatabaseSync } = require('node:sqlite');
  const file = path.join(parent, LOCK_NAME);
  let database;
  try {
    const parentId = parentIdentity(parent);
    rejectSidecars(file);
    let exists = true;
    try { fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
    if (!exists) {
      if (!create) return null;
      const descriptor = fs.openSync(file, 'wx', 0o600);
      const identity = comparableIdentity(fs.fstatSync(descriptor, { bigint: true }));
      fs.closeSync(descriptor);
      if (parentIdentity(parent) !== parentId || comparableIdentity(fs.lstatSync(file, { bigint: true })) !== identity) throw new Error('Lock changed during creation');
      database = new DatabaseSync(file);
      database.exec('PRAGMA journal_mode=MEMORY; PRAGMA synchronous=FULL; CREATE TABLE ownership (format INTEGER NOT NULL, parent TEXT NOT NULL, parent_id TEXT NOT NULL, file_id TEXT NOT NULL);');
      database.prepare('INSERT INTO ownership VALUES (1, ?, ?, ?)').run(parent, parentId, identity);
      database.close();
      database = null;
      const handle = fs.openSync(file, 'r+');
      try { fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    }
    const snapshot = inspectLock(parent);
    database = new DatabaseSync(file);
    database.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');
    const validate = () => {
      const current = stableOpenFile(parent, file, { requireSingleLink: true, maxBytes: MAX_LOCK_BYTES });
      if (parentIdentity(parent) !== snapshot.parentId || current.identity !== snapshot.identity || current.rawSha256 !== snapshot.rawSha256) throw lockError(file, new Error('Lock identity or content changed'));
    };
    validate();
    const held = database;
    database = null;
    return { validate, close() { try { held.exec('ROLLBACK'); } finally { held.close(); } } };
  } catch (cause) {
    database?.close();
    throw cause.code?.startsWith('unwrap-') ? cause : lockError(file, cause);
  }
}

module.exports = { LOCK_NAME, isLockName, acquireLock, inspectLock };
