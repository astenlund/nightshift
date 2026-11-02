'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { acquireLock } = require('../unwrap-lock');
const { requireCondition } = require('./errors');
const { CREATE_TABLES, schemaState, verifyTriggers } = require('./legacy-store');
const { COMPACT_VERSION, HISTORY_SQL, HistoryReader, encodeRow } = require('./history-store');
const { safeDirectory } = require('./store');

// The administrative compact-history migration (specs/compact-run-history.md): rewrites one run store into store version 3 in a
// new file beside it, verifies every row against the original, then swaps the two by renaming and keeps the original as a backup
// until a later finish verifies the migrated store against it once more and deletes it.
const STORES = Object.freeze({ delivery: 'state.sqlite', review: 'review-state.sqlite' });
const BUILDING = '.compacting';
const BACKUP = '.pre-compaction';
const SIDECARS = Object.freeze(['-journal', '-wal', '-shm']);
const COPIED_TABLES = Object.freeze(['runs', 'active', 'artifacts', 'accounting_commits', 'discharge_index', 'legacy_retirements']);

const exists = file => Boolean(fs.lstatSync(file, { throwIfNoEntry: false }));

function storePaths(root, store) {
  requireCondition(Object.hasOwn(STORES, store), 'invalid-migration-request', 'Choose the delivery or review store to compact');
  requireCondition(exists(path.join(root, '.nightshift/runs')), 'migration-store-unavailable', 'No run store exists in this project');
  const directory = safeDirectory(root, '.nightshift/runs');
  const file = path.join(directory, STORES[store]);

  return { directory, file, building: file + BUILDING, backup: file + BACKUP };
}

function requireOrdinary(file) {
  const stat = fs.lstatSync(file);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'migration-store-unavailable', `Run database must be an ordinary singly linked file: ${path.basename(file)}`);
}

function removeBuilding(building) {
  for (const candidate of [building, ...SIDECARS.map(suffix => building + suffix)]) fs.rmSync(candidate, { force: true });
}

function open(file, readOnly) {
  const db = new DatabaseSync(file, { readOnly });
  db.exec('PRAGMA busy_timeout=5000');

  return db;
}

function version(db) {
  return db.prepare('PRAGMA user_version').get().user_version;
}

function tableSql(db) {
  return new Map(db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table'").all().map(row => [row.name, row.sql]));
}

function rowsOf(db, table) {
  return db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).iterate();
}

// Every table but history, compared row by row in insertion order, and every history row's exact text, kind and time. The only
// table the migrated store may add is an empty artifacts table, which a version-1 store lacks and version 3 requires.
function differences(source, target) {
  const sourceTables = tableSql(source);
  const targetTables = tableSql(target);
  for (const name of sourceTables.keys()) if (name !== 'history' && !targetTables.has(name)) return `table ${name} is missing from the migrated store`;
  for (const name of targetTables.keys()) {
    if (name === 'history' || sourceTables.has(name)) continue;
    if (name !== 'artifacts' || target.prepare('SELECT 1 FROM artifacts LIMIT 1').get()) return `table ${name} is not in the original`;
  }
  for (const table of COPIED_TABLES.filter(name => sourceTables.has(name))) {
    if (targetTables.get(table) !== sourceTables.get(table)) return `table ${table} has a different definition`;
    const left = rowsOf(source, table);
    const right = rowsOf(target, table);
    for (;;) {
      const a = left.next();
      const b = right.next();
      if (a.done || b.done) {
        if (!a.done || !b.done) return `table ${table} has a different row count`;
        break;
      }
      if (JSON.stringify(a.value) !== JSON.stringify(b.value)) return `table ${table} differs at a row`;
    }
  }
  const counts = db => db.prepare('SELECT count(*) AS n FROM history').get().n;
  if (counts(source) !== counts(target)) return 'history has a different row count';
  let readers = null;
  for (const row of source.prepare('SELECT run_id, revision, kind, recorded_at FROM history ORDER BY run_id, revision').iterate()) {
    if (readers?.runId !== row.run_id) readers = { runId: row.run_id, original: new HistoryReader(source, row.run_id), migrated: new HistoryReader(target, row.run_id) };
    let rebuilt;
    try { rebuilt = readers.migrated.text(row.revision); }
    catch (error) { return `history of ${row.run_id} revision ${row.revision} does not rebuild: ${error.message}`; }
    const original = readers.original.text(row.revision);
    if (!rebuilt || rebuilt.state !== original.state || rebuilt.kind !== row.kind || rebuilt.recordedAt !== row.recorded_at) return `history of ${row.run_id} revision ${row.revision} differs`;
  }

  return null;
}

function build(source, building) {
  const target = open(building, false);
  let writing = false;
  try {
    const definitions = tableSql(source);
    target.exec('BEGIN');
    writing = true;
    for (const table of COPIED_TABLES) {
      if (!definitions.has(table)) continue;
      target.exec(definitions.get(table));
      const columns = source.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
      const insert = target.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
      for (const row of rowsOf(source, table)) insert.run(...columns.map(column => row[column]));
    }
    if (!definitions.has('artifacts')) target.exec(CREATE_TABLES.artifacts);
    target.exec(HISTORY_SQL);
    const insert = target.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const current = new Map(source.prepare('SELECT id, revision FROM runs').all().map(row => [row.id, row.revision]));
    for (const { run_id: runId } of source.prepare('SELECT DISTINCT run_id FROM history ORDER BY run_id').all()) {
      // Descending, so each row's successor is already parsed; a gap or an unparseable successor leaves the row below it full.
      let next = null;
      for (const row of source.prepare('SELECT revision, kind, recorded_at, state FROM history WHERE run_id=? ORDER BY revision DESC').iterate(runId)) {
        let value;
        try { value = JSON.parse(row.state); }
        catch { value = undefined; }
        const successor = next?.revision === row.revision + 1 ? next : null;
        const stored = value === undefined ? encodeRow(row.revision, row.state) : encodeRow(row.revision, row.state, successor, current.get(runId) === row.revision, value);
        insert.run(runId, row.revision, row.kind, row.recorded_at, stored.encoding, stored.bytes, stored.digest, stored.body);
        next = value === undefined ? null : { revision: row.revision, value };
      }
    }
    for (const { sql } of source.prepare("SELECT sql FROM sqlite_master WHERE type IN ('trigger', 'index') AND sql IS NOT NULL ORDER BY type DESC, name").all()) target.exec(sql);
    target.exec(`PRAGMA user_version=${COMPACT_VERSION}`);
    target.exec('COMMIT');
    writing = false;
  } catch (error) {
    if (writing) target.exec('ROLLBACK');
    throw error;
  } finally {
    target.close();
  }
}

function verifyAgainst(originalFile, migratedFile) {
  const original = open(originalFile, true);
  const migrated = open(migratedFile, true);
  try {
    const schema = schemaState(migrated);
    requireCondition(schema.version === COMPACT_VERSION, 'compaction-verification-failed', 'The migrated store is not version 3');
    verifyTriggers(migrated, schema.tables);

    return differences(original, migrated);
  } finally {
    original.close();
    migrated.close();
  }
}

function rename(from, to, state) {
  try { fs.renameSync(from, to); }
  catch (error) { requireCondition(false, 'compaction-swap-incomplete', `The store could not be renamed (${error.code ?? error.message}); close other Nightshift sessions and hooks reading it, then run compact-history again to continue from ${state}`); }
}

// The swapped result, read from the files themselves so that a resumed or repeated run reports the same as the run that swapped.
function swapped(paths) {
  const db = open(paths.file, true);
  let history;
  try {
    history = { full: 0, delta: 0, fullBytes: 0, deltaBytes: 0 };
    for (const row of db.prepare('SELECT encoding, count(*) AS rows, coalesce(sum(length(CAST(body AS BLOB))), 0) AS bytes FROM history GROUP BY encoding').all()) {
      history[row.encoding] = row.rows;
      history[`${row.encoding}Bytes`] = row.bytes;
    }
  } finally { db.close(); }
  const backup = exists(paths.backup);

  return { state: 'swapped', store: path.basename(paths.file), bytes: fs.statSync(paths.file).size, bytesBefore: backup ? fs.statSync(paths.backup).size : null, history, backup: backup ? paths.backup : null };
}

function finish(paths) {
  if (!exists(paths.backup)) return { state: 'nothing-to-finish', store: path.basename(paths.file) };
  requireCondition(exists(paths.file), 'migration-store-unavailable', 'The migrated store is missing; run compact-history again to complete the swap');
  const difference = verifyAgainst(paths.backup, paths.file);
  requireCondition(difference === null, 'compaction-verification-failed', `The migrated store no longer matches its backup: ${difference}`);
  try { fs.rmSync(paths.backup); }
  catch (error) { requireCondition(false, 'compaction-finish-incomplete', `The verified backup could not be deleted (${error.code ?? error.message}); close whatever holds it open and run finish again`); }

  return { state: 'finished', store: path.basename(paths.file), bytes: fs.statSync(paths.file).size };
}

function compact(root, request) {
  const paths = storePaths(root, request.store);
  const lock = acquireLock(paths.directory, { name: 'write-ownership.sqlite', label: 'runtime project', codePrefix: 'runtime-ownership' });
  try {
    if (request.finish === true) return finish(paths);
    // A backup and the new file without a store: the second rename did not happen yet.
    if (!exists(paths.file) && exists(paths.backup) && exists(paths.building)) {
      rename(paths.building, paths.file, 'the half-completed swap');
      return swapped(paths);
    }
    requireCondition(exists(paths.file), 'migration-store-unavailable', exists(paths.backup) ? `Only the pre-compaction backup ${path.basename(paths.backup)} remains; rename it back to ${path.basename(paths.file)} to recover` : 'No run store exists to compact');
    if (exists(paths.backup)) {
      const db = open(paths.file, true);
      let compactStore;
      try { compactStore = version(db) === COMPACT_VERSION; }
      finally { db.close(); }
      requireCondition(compactStore, 'compaction-backup-present', `A pre-compaction backup exists beside an uncompacted store; inspect ${path.basename(paths.backup)} before compacting again`);
      return swapped(paths);
    }
    removeBuilding(paths.building);
    requireOrdinary(paths.file);
    requireCondition(SIDECARS.every(suffix => !exists(paths.file + suffix)), 'compaction-store-busy', 'The store has a pending SQLite journal; open it with the runtime to recover the interrupted transaction first');
    const source = open(paths.file, true);
    try {
      requireCondition(version(source) !== COMPACT_VERSION, 'history-already-compact', 'The store already keeps compact history');
      const schema = schemaState(source);
      verifyTriggers(source, schema.tables);
      requireCondition(!source.prepare("SELECT 1 FROM runs WHERE json_extract(state, '$.status')='running' LIMIT 1").get(), 'compaction-run-active', 'A record in this store is still running; finish or stop it before compacting');
      build(source, paths.building);
    } catch (error) {
      removeBuilding(paths.building);
      throw error;
    } finally {
      source.close();
    }
    let difference;
    try { difference = verifyAgainst(paths.file, paths.building); }
    catch (error) {
      removeBuilding(paths.building);
      throw error;
    }
    if (difference !== null) {
      removeBuilding(paths.building);
      requireCondition(false, 'compaction-verification-failed', `The compacted store does not match the original: ${difference}`);
    }
    rename(paths.file, paths.backup, 'a fresh build');
    rename(paths.building, paths.file, 'the half-completed swap');

    return swapped(paths);
  } finally {
    lock.close();
  }
}

module.exports = { BACKUP, BUILDING, SIDECARS, STORES, compact };
