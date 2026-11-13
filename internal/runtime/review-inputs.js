'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hash, privateInputsCurrent, projectFile } = require('./evidence');
const { safeDirectory } = require('./store');

const CACHE_PATH = '.nightshift/runs/review-inputs.sqlite';
const LIMITS = Object.freeze({ sourceBytes: 32 * 1024 * 1024, entryBytes: 48 * 1024 * 1024, cacheBytes: 192 * 1024 * 1024, entries: 32, files: 4096 });
const MAX_DATABASE_BYTES = 256 * 1024 * 1024;
const APPLICATION_ID = 0x4e534943;

// Optional, content-addressed source evidence for fresh lead originals. SQLite serializes capture/eviction and makes each cache
// mutation atomic. Entries share an exact manifest digest, have fixed byte/count bounds and evict least recently used entries.
// Missing, evicted, corrupt or unavailable cache state never erases an assessment or grants relevance: original source is then
// unavailable and preserving applicability is refused. Status only probes this cache read-only, through cached, and never writes it,
// decodes an entry or waits for a lock. Legacy input folders are read
// separately and never deleted here. An interrupted cache write rolls back; an orphan after a failed dispatch remains bounded.
function openCache(root) {
  safeDirectory(root, '.nightshift/runs', true);
  const target = projectFile(root, CACHE_PATH);
  const existing = fs.statSync(target, { throwIfNoEntry: false });
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const sidecar = fs.statSync(projectFile(root, CACHE_PATH + suffix), { throwIfNoEntry: false });
    if (sidecar && (!sidecar.isFile() || sidecar.size > MAX_DATABASE_BYTES * 2)) throw new Error('Review input cache sidecar has unsupported size or kind');
    if (sidecar && !fs.existsSync(target)) throw new Error('Review input cache database is missing with surviving sidecars');
  }
  if (existing && (!existing.isFile() || existing.size > MAX_DATABASE_BYTES)) throw new Error('Review input cache has unsupported size or kind');
  const db = new DatabaseSync(target);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    transaction(db, () => {
      if (db.prepare('PRAGMA page_size').get().page_size !== 4096) throw new Error('Review input cache page size is unsupported');
      const version = db.prepare('PRAGMA user_version').get().user_version;
      const owner = db.prepare('PRAGMA application_id').get().application_id;
      if (![0, APPLICATION_ID].includes(owner)) throw new Error('Review input cache belongs to another application');
      if (version === 0) {
        const objects = db.prepare('SELECT COUNT(*) AS count FROM sqlite_schema').get().count;
        const pages = db.prepare('PRAGMA page_count').get().page_count;
        const unused = db.prepare('PRAGMA freelist_count').get().freelist_count;
        if (objects !== 0 || pages > 1 || unused !== 0) throw new Error('Review input cache initialization is not positively empty');
        db.exec('CREATE TABLE inputs (digest TEXT PRIMARY KEY, body TEXT NOT NULL, checksum TEXT NOT NULL, accessed INTEGER NOT NULL); PRAGMA user_version=1');
      } else if (version !== 1) throw new Error('Review input cache schema is unavailable');
      const columns = db.prepare('PRAGMA table_info(inputs)').all().map(column => column.name);
      if (JSON.stringify(columns) !== JSON.stringify(['digest', 'body', 'checksum', 'accessed'])) throw new Error('Review input cache schema is invalid');
      if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') throw new Error('Review input cache journal mode is unsupported');
      db.exec(`PRAGMA application_id=${APPLICATION_ID}`);
    });
    db.exec('PRAGMA max_page_count=65536');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function nextAccess(db) {
  const next = db.prepare('SELECT COALESCE(MAX(accessed), 0) + 1 AS next FROM inputs').get().next;
  if (!Number.isSafeInteger(next) || next < 1) throw new Error('Review input cache access sequence is invalid');
  return next;
}

function transaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {
      // SQLite can already have rolled back a failed write, including a full database.
    }
    throw error;
  }
}

function retain(root, source, snapshot) {
  let db;
  try {
    if (!Array.isArray(snapshot?.files) || snapshot.files.length > LIMITS.files || hash(JSON.stringify(snapshot.files)) !== snapshot.digest) throw new Error('Review source manifest is unsupported');
    let size = 0;
    for (const file of snapshot.files) {
      if (file.sha256 === null) continue;
      const metadata = fs.statSync(projectFile(source, file.path));
      if (!metadata.isFile() || (size += metadata.size) > LIMITS.sourceBytes) throw new Error('Review source exceeds the cache capture limit');
    }
    size = 0;
    const entries = snapshot.files.map(file => {
      const bytes = file.sha256 === null ? null : fs.readFileSync(projectFile(source, file.path));
      if ((size += bytes?.length ?? 0) > LIMITS.sourceBytes) throw new Error('Review source exceeds the cache capture limit');
      return { path: file.path, sha256: file.sha256, content: bytes?.toString('base64') ?? null };
    });
    const body = JSON.stringify(entries);
    if (Buffer.byteLength(body) > LIMITS.entryBytes || !privateInputsCurrent(source, snapshot)) throw new Error('Review source changed or exceeds the cache entry limit');
    db = openCache(root);
    transaction(db, () => {
      const accessed = nextAccess(db);
      db.prepare('INSERT OR REPLACE INTO inputs VALUES (?, ?, ?, ?)').run(snapshot.digest, body, hash(body), accessed);
      for (;;) {
        const totals = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(body AS BLOB))), 0) AS bytes FROM inputs').get();
        if (totals.count <= LIMITS.entries && totals.bytes <= LIMITS.cacheBytes) break;
        db.exec('DELETE FROM inputs WHERE digest = (SELECT digest FROM inputs ORDER BY accessed, digest LIMIT 1)');
      }
    });
    return { retainedInputs: { kind: 'cache-v1', digest: snapshot.digest }, retainedInputsReason: null };
  } catch (error) {
    return { retainedInputs: false, retainedInputsReason: error.message };
  } finally {
    db?.close();
  }
}

// Whether the cache positively holds a well-sized entry for these original inputs, judged for status without writing, waiting or
// decoding: the database is opened read-only, and a missing, foreign, busy, locked or unreadable cache reads as not cached. Dispatch
// still verifies the entry's bytes through load before any relevance relies on it.
function cached(root, descriptor, snapshot) {
  let db;
  try {
    if (descriptor?.kind !== 'cache-v1' || descriptor.digest !== snapshot?.digest || !Array.isArray(snapshot.files) || snapshot.files.length > LIMITS.files || hash(JSON.stringify(snapshot.files)) !== snapshot.digest) return false;
    const target = projectFile(root, CACHE_PATH);
    const existing = fs.statSync(target, { throwIfNoEntry: false });
    if (!existing?.isFile() || existing.size > MAX_DATABASE_BYTES) return false;
    // A surviving journal means an unfinished write, which only a writer may roll back.
    if (fs.existsSync(projectFile(root, CACHE_PATH + '-journal'))) return false;
    db = new DatabaseSync(target, { readOnly: true });
    if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID || db.prepare('PRAGMA user_version').get().user_version !== 1) return false;
    const row = db.prepare('SELECT length(CAST(body AS BLOB)) AS bytes, checksum FROM inputs WHERE digest=?').get(descriptor.digest);
    return Boolean(row) && row.bytes > 0 && row.bytes <= LIMITS.entryBytes && /^[a-f0-9]{64}$/.test(row.checksum);
  } catch {
    // A cache that cannot be read without writing or waiting is no positive evidence of retained inputs.
    return false;
  } finally {
    db?.close();
  }
}

function load(root, descriptor, snapshot, { touch = false } = {}) {
  let db;
  try {
    if (descriptor?.kind !== 'cache-v1' || descriptor.digest !== snapshot?.digest || !Array.isArray(snapshot.files) || snapshot.files.length > LIMITS.files || hash(JSON.stringify(snapshot.files)) !== snapshot.digest) throw new Error('Original input cache binding is invalid');
    if (!fs.existsSync(projectFile(root, CACHE_PATH))) throw new Error('Original inputs are not cached');
    db = openCache(root);
    return transaction(db, () => {
      const size = db.prepare('SELECT length(CAST(body AS BLOB)) AS bytes FROM inputs WHERE digest=?').get(descriptor.digest);
      if (!size || size.bytes > LIMITS.entryBytes) throw new Error('Original inputs were evicted or have unsupported size');
      const row = db.prepare('SELECT body, checksum FROM inputs WHERE digest=?').get(descriptor.digest);
      if (hash(row.body) !== row.checksum) throw new Error('Original input cache checksum is invalid');
      const entries = JSON.parse(row.body);
      if (!Array.isArray(entries) || entries.length !== snapshot.files.length) throw new Error('Original input cache manifest is invalid');
      let bytes = 0;
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const expected = snapshot.files[index];
        if (entry?.path !== expected.path || entry.sha256 !== expected.sha256 || (expected.sha256 === null ? entry.content !== null : typeof entry.content !== 'string')) throw new Error('Original input cache entry differs from its assignment');
        if (entry.content === null) continue;
        const decoded = Buffer.from(entry.content, 'base64');
        if ((bytes += decoded.length) > LIMITS.sourceBytes || decoded.toString('base64') !== entry.content || hash(decoded) !== expected.sha256) throw new Error('Original input bytes differ from their assignment');
      }
      if (touch) db.prepare('UPDATE inputs SET accessed=? WHERE digest=?').run(nextAccess(db), descriptor.digest);
      return { available: true, entries, reason: null };
    });
  } catch (error) {
    return { available: false, entries: null, reason: error.message };
  } finally {
    db?.close();
  }
}

function directoryIdentity(directory) {
  const metadata = fs.lstatSync(directory, { bigint: true, throwIfNoEntry: false });
  return metadata?.isDirectory() && !metadata.isSymbolicLink() && metadata.ino !== 0n ? String(metadata.dev) + ':' + String(metadata.ino) : null;
}

// Only a directory created by this materialization and still holding its identity may be removed on failure.
function materialize(snapshot, destination, copy) {
  let created = null;
  try {
    fs.mkdirSync(destination);
    created = directoryIdentity(destination);
    if (!created) throw new Error('Original input destination identity is unavailable');
    copy();
    if (directoryIdentity(destination) !== created || !privateInputsCurrent(destination, snapshot)) throw new Error('Restored original inputs differ from the assignment or changed identity');
    return { available: true, reason: null };
  } catch (error) {
    let reason = error.message;
    if (created) {
      try {
        const metadata = fs.lstatSync(destination, { throwIfNoEntry: false });
        if (metadata && directoryIdentity(destination) === created) fs.rmSync(destination, { recursive: true, force: true });
        else if (metadata) reason += '; cleanup skipped because destination identity changed';
      } catch (cleanupError) {
        reason += '; cleanup remains pending: ' + cleanupError.message;
      }
    }
    return { available: false, reason };
  }
}

function restoreLegacy(source, snapshot, destination) {
  if (!privateInputsCurrent(source, snapshot)) return { available: false, reason: 'Original legacy source changed or is unavailable' };
  return materialize(snapshot, destination, () => fs.cpSync(source, destination, { recursive: true, force: false, errorOnExist: true }));
}

function restore(root, descriptor, snapshot, destination) {
  const result = load(root, descriptor, snapshot, { touch: true });
  if (!result.available) return result;
  return materialize(snapshot, destination, () => {
    for (const entry of result.entries) {
      if (entry.content === null) continue;
      const target = projectFile(destination, entry.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(entry.content, 'base64'), { flag: 'wx' });
    }
  });
}

module.exports = { restoreLegacy, CACHE_PATH, LIMITS, cached, load, restore, retain };
