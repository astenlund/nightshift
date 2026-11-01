'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { execute: migrationExecute } = require('../internal/runtime/legacy-migration');
const { HistoryReader, KEYFRAME_INTERVAL } = require('../internal/runtime/history-store');
const { RunStore } = require('../internal/runtime/store');
const { acquireLock } = require('../internal/unwrap-lock');
const { CREATE_TABLES } = require('../internal/runtime/legacy-store');

const compact = (root, request = {}, dependencies = { fixtureCompaction: true }) => migrationExecute(root, { action: 'compact-history', store: 'delivery', ...request }, null, dependencies);
const refused = code => error => error.code === code;

// A version 2 delivery store, written as earlier releases wrote it, with runs of many revisions whose states change a little at a
// time; a version 1 store lacks the artifacts table.
function fixture(t, { runs = 2, revisions = KEYFRAME_INTERVAL + 9, status = 'complete', version = 2, name = 'state.sqlite' } = {}) {
  const parent = path.resolve(__dirname, '../.tmp/runtime-history-compaction');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(parent, 'case-')));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const directory = path.join(root, '.nightshift/runs');
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, name));
  db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL); CREATE TABLE active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL REFERENCES runs(id)); CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision));' + (version >= 2 ? ' CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL);' : '') + ` PRAGMA user_version=${version};`);
  const ids = [];
  for (let run = 0; run < runs; run++) {
    const id = randomUUID();
    ids.push(id);
    db.prepare("INSERT INTO runs VALUES (?, 0, '{}')").run(id);
    let state;
    for (let revision = 0; revision < revisions; revision++) {
      state = { schema: 1, kind: 'delivery', id, root, revision, status: revision === revisions - 1 ? status : 'running', controller: { host: 'codex', session: 'fixture-owner' }, resourceMode: 'development', tasks: [{ id: 'task', checks: Array.from({ length: revision % 6 }, (_, index) => ({ name: `check ${index}`, output: 'x'.repeat(200) })) }], workers: Array.from({ length: 1 + revision % 4 }, (_, index) => ({ id: `w${index}`, status: 'complete', phase: revision % 2 ? 'running' : 'finalizing' })), followups: [], createdAt: '2026-11-01T00:00:00.000Z', updatedAt: `2026-11-01T00:${String(revision % 60).padStart(2, '0')}:00.000Z` };
      db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(id, revision, revision === 0 ? 'created' : 'operation-progress', state.updatedAt, JSON.stringify(state));
    }
    db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(state.revision, JSON.stringify(state), id);
  }
  db.prepare('INSERT INTO active VALUES (1, ?)').run(ids.at(-1));
  db.close();

  return { root, ids, file: path.join(directory, name) };
}

function snapshot(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const history = db.prepare('SELECT run_id, revision, kind, recorded_at FROM history ORDER BY run_id, revision').all().map(row => ({ ...row, state: new HistoryReader(db, row.run_id).text(row.revision).state }));
    return { runs: db.prepare('SELECT * FROM runs ORDER BY id').all(), active: db.prepare('SELECT * FROM active').all(), history };
  } finally { db.close(); }
}

test('compaction rewrites a store byte-exactly into compact history, keeps a backup and finishes', t => {
  const { root, file } = fixture(t);
  const before = snapshot(file);
  const result = compact(root);
  assert.equal(result.state, 'swapped');
  assert.equal(result.backup, file + '.pre-compaction');
  assert.ok(result.history.delta > 0 && result.history.full > 0);
  assert.ok(result.bytes < result.bytesBefore);
  assert.deepEqual(snapshot(file), before);
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
    for (const row of db.prepare('SELECT history.revision, history.encoding, runs.revision AS current FROM history JOIN runs ON runs.id=history.run_id').all()) {
      assert.equal(row.encoding, row.revision === row.current || row.revision % KEYFRAME_INTERVAL === 0 ? 'full' : 'delta');
    }
  } finally { db.close(); }
  assert.equal(compact(root).state, 'swapped');
  assert.equal(compact(root, { finish: true }).state, 'finished');
  assert.equal(fs.existsSync(file + '.pre-compaction'), false);
  assert.equal(compact(root, { finish: true }).state, 'nothing-to-finish');
  assert.throws(() => compact(root), refused('history-already-compact'));
  assert.deepEqual(snapshot(file), before);
});

test('a version-1 store without artifacts, and a row that is not JSON, compact byte-exactly', t => {
  const { root, file, ids } = fixture(t, { runs: 1, revisions: 8, version: 1 });
  const db = new DatabaseSync(file);
  try { db.prepare("UPDATE history SET state='not json at all' WHERE run_id=? AND revision=3").run(ids[0]); }
  finally { db.close(); }
  const before = snapshot(file);
  const result = compact(root);
  assert.equal(result.state, 'swapped');
  assert.deepEqual(snapshot(file), before);
  const migrated = new DatabaseSync(file, { readOnly: true });
  try {
    assert.deepEqual(migrated.prepare('SELECT revision FROM history WHERE encoding=? ORDER BY revision').all('full').map(row => row.revision), [0, 2, 3, 7]);
    assert.equal(migrated.prepare('SELECT count(*) AS n FROM artifacts').get().n, 0);
  } finally { migrated.close(); }
});

test('the runtime reads and extends a compacted store', t => {
  const { root, file, ids } = fixture(t, { runs: 1, revisions: 5 });
  const before = snapshot(file);
  compact(root);
  compact(root, { finish: true });
  const store = new RunStore(root);
  try {
    assert.deepEqual(store.history(ids[0]).map(entry => entry.state.revision), [0, 1, 2, 3, 4]);
    assert.equal(JSON.stringify(store.read(ids[0], { hydrate: false })), before.runs[0].state);
  } finally { store.close(); }
});

test('compaction refuses without admission, for an unknown store, a running record or a pending journal', t => {
  const { root, file } = fixture(t, { status: 'running' });
  assert.throws(() => compact(root, {}, {}), refused('migration-admission-required'));
  assert.throws(() => compact(root, { store: 'other' }), refused('invalid-migration-request'));
  assert.throws(() => compact(root), refused('compaction-run-active'));
  const second = fixture(t);
  fs.writeFileSync(second.file + '-journal', '');
  assert.throws(() => compact(second.root), refused('compaction-store-busy'));
  const misshapen = fixture(t);
  const db = new DatabaseSync(misshapen.file);
  try { db.exec('ALTER TABLE runs ADD COLUMN extra TEXT'); }
  finally { db.close(); }
  assert.throws(() => compact(misshapen.root), refused('migration-store-unavailable'));
  const unprotected = fixture(t);
  const retirements = new DatabaseSync(unprotected.file);
  try { retirements.exec(CREATE_TABLES.legacy_retirements); }
  finally { retirements.close(); }
  assert.throws(() => compact(unprotected.root), refused('migration-protection-unavailable'));
  const locked = fixture(t);
  const lock = acquireLock(path.dirname(locked.file), { name: 'write-ownership.sqlite', label: 'runtime project', codePrefix: 'runtime-ownership' });
  try { assert.throws(() => compact(locked.root), refused('runtime-ownership-busy')); }
  finally { lock.close(); }
  for (const candidate of [file, second.file, misshapen.file, unprotected.file, locked.file]) assert.equal(fs.existsSync(candidate + '.compacting'), false);
});

test('a review store compacts as the delivery store does', t => {
  const { root, file } = fixture(t, { name: 'review-state.sqlite' });
  const before = snapshot(file);
  const result = compact(root, { store: 'review' });
  assert.deepEqual([result.state, result.store], ['swapped', 'review-state.sqlite']);
  assert.ok(result.history.delta > 0);
  assert.deepEqual(snapshot(file), before);
  assert.equal(compact(root, { store: 'review', finish: true }).state, 'finished');
});

test('verification catches a table the migrated store would drop, and finish before a swap has nothing to do', t => {
  const { root, file } = fixture(t, { runs: 1, revisions: 4 });
  assert.equal(compact(root, { finish: true }).state, 'nothing-to-finish');
  const db = new DatabaseSync(file);
  try { db.exec("CREATE TABLE notes (body TEXT); INSERT INTO notes VALUES ('kept')"); }
  finally { db.close(); }
  assert.throws(() => compact(root), error => error.code === 'compaction-verification-failed' && /notes/.test(error.message));
  assert.equal(fs.existsSync(file + '.compacting'), false);
  assert.equal(fs.existsSync(file + '.pre-compaction'), false);
});

test('compaction resumes from every durable state it can leave', t => {
  const stale = fixture(t);
  fs.writeFileSync(stale.file + '.compacting', 'an earlier partial build');
  assert.equal(compact(stale.root).state, 'swapped');

  const halfSwapped = fixture(t);
  const before = snapshot(halfSwapped.file);
  const first = compact(halfSwapped.root);
  fs.renameSync(halfSwapped.file, halfSwapped.file + '.compacting');
  const resumed = compact(halfSwapped.root);
  assert.equal(resumed.state, 'swapped');
  assert.deepEqual(resumed, first);
  assert.deepEqual(snapshot(halfSwapped.file), before);
  assert.equal(compact(halfSwapped.root, { finish: true }).state, 'finished');

  const backupBeside = fixture(t);
  fs.copyFileSync(backupBeside.file, backupBeside.file + '.pre-compaction');
  assert.throws(() => compact(backupBeside.root), refused('compaction-backup-present'));

  const onlyBackup = fixture(t);
  fs.renameSync(onlyBackup.file, onlyBackup.file + '.pre-compaction');
  assert.throws(() => compact(onlyBackup.root), error => error.code === 'migration-store-unavailable' && /sqlite.pre-compaction remains/.test(error.message));
});

test('finish refuses when the migrated store no longer matches its backup', t => {
  const { root, file, ids } = fixture(t, { runs: 1, revisions: 6 });
  compact(root);
  const db = new DatabaseSync(file);
  try { db.prepare("UPDATE runs SET state=json_set(state, '$.status', 'stopped') WHERE id=?").run(ids[0]); }
  finally { db.close(); }
  assert.throws(() => compact(root, { finish: true }), refused('compaction-verification-failed'));
  assert.equal(fs.existsSync(file + '.pre-compaction'), true);
});

test('a swap blocked by another open handle stops without losing the store and resumes', { skip: process.platform !== 'win32' }, t => {
  const { root, file } = fixture(t);
  const before = snapshot(file);
  const holder = new DatabaseSync(file, { readOnly: true });
  try { assert.throws(() => compact(root), refused('compaction-swap-incomplete')); }
  finally { holder.close(); }
  assert.deepEqual(snapshot(file), before);
  assert.equal(compact(root).state, 'swapped');
  assert.deepEqual(snapshot(file), before);
});
