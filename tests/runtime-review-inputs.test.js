'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { spawn } = require('node:child_process');
const { snapshot, hash } = require('../internal/runtime/evidence');
const { CACHE_PATH, LIMITS, cached, load, restore, retain } = require('../internal/runtime/review-inputs');

function fixture(t) {
  const parent = path.resolve(__dirname, '../.tmp/review-inputs-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const write = value => fs.writeFileSync(path.join(source, 'subject.txt'), value);
  write('original');
  const capture = () => snapshot(source, ['subject.txt']);
  return { root, source, write, capture };
}

test('retention deduplicates exact original snapshots and restores verified bytes', t => {
  const f = fixture(t);
  const captured = f.capture();
  const first = retain(f.root, f.source, captured);
  const second = retain(f.root, f.source, captured);
  assert.deepEqual(first, second);
  const db = new DatabaseSync(path.join(f.root, CACHE_PATH));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM inputs').get().count, 1);
  db.close();
  const destination = path.join(f.root, 'restored');
  assert.equal(restore(f.root, first.retainedInputs, captured, destination).available, true);
  assert.equal(fs.readFileSync(path.join(destination, 'subject.txt'), 'utf8'), 'original');
});

test('retention evicts old originals at its count bound and preserves the newest', t => {
  const f = fixture(t);
  const captured = f.capture();
  const first = retain(f.root, f.source, captured);
  let latest;
  let current;
  for (let index = 0; index < LIMITS.entries; index++) {
    f.write('candidate ' + index);
    current = f.capture();
    latest = retain(f.root, f.source, current);
  }
  assert.equal(load(f.root, first.retainedInputs, captured).available, false);
  assert.equal(load(f.root, latest.retainedInputs, current).available, true);
  const db = new DatabaseSync(path.join(f.root, CACHE_PATH));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM inputs').get().count, LIMITS.entries);
  db.close();
});

test('retention enforces source and aggregate stored-byte limits', t => {
  const f = fixture(t);
  f.write(Buffer.alloc(LIMITS.sourceBytes + 1));
  const oversized = retain(f.root, f.source, f.capture());
  assert.equal(oversized.retainedInputs, false);
  assert.match(oversized.retainedInputsReason, /limit/);
  f.write('small original');
  const captured = f.capture();
  retain(f.root, f.source, captured);
  const db = new DatabaseSync(path.join(f.root, CACHE_PATH));
  db.exec('DELETE FROM inputs');
  const body = 'x'.repeat(LIMITS.entryBytes);
  for (let index = 0; index < LIMITS.cacheBytes / LIMITS.entryBytes; index++) db.prepare('INSERT INTO inputs VALUES (?, ?, ?, ?)').run('filler-' + index, body, hash(body), index);
  db.close();
  const retained = retain(f.root, f.source, captured);
  assert.equal(load(f.root, retained.retainedInputs, captured).available, true);
  const measured = new DatabaseSync(path.join(f.root, CACHE_PATH));
  assert.ok(measured.prepare('SELECT SUM(length(CAST(body AS BLOB))) AS bytes FROM inputs').get().bytes <= LIMITS.cacheBytes);
  measured.close();
});

test('missing, corrupt and unsupported cache state cannot grant original input availability', t => {
  const f = fixture(t);
  const captured = f.capture();
  assert.equal(load(f.root, { kind: 'cache-v1', digest: captured.digest }, captured).available, false);
  const retained = retain(f.root, f.source, captured);
  const db = new DatabaseSync(path.join(f.root, CACHE_PATH));
  db.prepare('UPDATE inputs SET body=? WHERE digest=?').run('corrupt', captured.digest);
  db.close();
  assert.equal(load(f.root, retained.retainedInputs, captured).available, false);
  assert.equal(load(f.root, { ...retained.retainedInputs, digest: 'wrong' }, captured).available, false);
  const wrong = new DatabaseSync(path.join(f.root, CACHE_PATH));
  wrong.exec('PRAGMA user_version=99');
  wrong.close();
  assert.equal(retain(f.root, f.source, captured).retainedInputs, false);
});

test('a missing cache database with surviving sidecars stays unavailable without reinitialization', t => {
  const f = fixture(t);
  const target = path.join(f.root, CACHE_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + '-journal', 'preserved orphan');
  const retained = retain(f.root, f.source, f.capture());
  assert.equal(retained.retainedInputs, false);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(target + '-journal', 'utf8'), 'preserved orphan');
});

test('concurrent captures recover a positively empty interrupted cache initialization', async t => {
  const f = fixture(t);
  const target = path.join(f.root, CACHE_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, '', { flag: 'wx' });
  const request = path.join(f.root, 'capture.json');
  fs.writeFileSync(request, JSON.stringify({ root: f.root, source: f.source, snapshot: f.capture() }));
  const capture = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'fixtures/capture-review-inputs.cjs'), request], { windowsHide: true });
    let output = '';
    let errors = '';
    child.stdout.on('data', bytes => { output += bytes; });
    child.stderr.on('data', bytes => { errors += bytes; });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) { reject(new Error(errors)); return; }
      try { resolve(JSON.parse(output)); } catch (error) { reject(error); }
    });
  });
  const results = await Promise.allSettled([capture(), capture()]);
  for (const result of results) {
    assert.equal(result.status, 'fulfilled');
    assert.equal(result.value.retainedInputs.kind, 'cache-v1', result.value.retainedInputsReason);
  }
  const db = new DatabaseSync(target);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM inputs').get().count, 1);
  db.close();
});

test('unsupported initialization with residual pages is preserved instead of reset', t => {
  const f = fixture(t);
  const target = path.join(f.root, CACHE_PATH);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('CREATE TABLE previous (value TEXT); DROP TABLE previous');
  assert.ok(db.prepare('PRAGMA page_count').get().page_count > 1);
  db.close();
  const before = fs.readFileSync(target);
  assert.equal(retain(f.root, f.source, f.capture()).retainedInputs, false);
  assert.deepEqual(fs.readFileSync(target), before);
});

test('cache restore preserves a colliding destination and returns unavailable source', t => {
  // Arrange
  const f = fixture(t);
  const captured = f.capture();
  const retained = retain(f.root, f.source, captured);
  const destination = path.join(f.root, 'occupied');
  fs.mkdirSync(destination);
  fs.writeFileSync(path.join(destination, 'keep.txt'), 'Keep existing bytes');

  // Act
  const result = restore(f.root, retained.retainedInputs, captured, destination);

  // Assert
  assert.equal(result.available, false);
  assert.ok(result.reason);
  assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'Keep existing bytes');
});

test('legacy source materialization uses exclusive creation and preserves an existing destination', t => {
  // Arrange
  const f = fixture(t);
  const { restoreLegacy } = require('../internal/runtime/review-inputs');
  const captured = f.capture();
  const destination = path.join(f.root, 'legacy-original');

  // Act and Assert
  assert.equal(restoreLegacy(f.source, captured, destination).available, true);
  assert.equal(fs.readFileSync(path.join(destination, 'subject.txt'), 'utf8'), 'original');
  fs.writeFileSync(path.join(destination, 'keep.txt'), 'Existing destination');
  assert.equal(restoreLegacy(f.source, captured, destination).available, false);
  assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'Existing destination');
});

test('failed owned source materialization removes only its own partial directory', t => {
  // Arrange
  const f = fixture(t);
  const captured = f.capture();
  const retained = retain(f.root, f.source, captured);
  const destination = path.join(f.root, 'partial');
  const write = fs.writeFileSync;
  fs.writeFileSync = function (file, ...args) {
    if (file === path.join(destination, 'subject.txt')) throw new Error('Fixture copy failure');
    return write.call(this, file, ...args);
  };
  t.after(() => { fs.writeFileSync = write; });

  // Act
  const result = restore(f.root, retained.retainedInputs, captured, destination);

  // Assert
  assert.equal(result.available, false);
  assert.equal(fs.existsSync(destination), false);
  assert.equal(load(f.root, retained.retainedInputs, captured).available, true);
});

test('source cleanup preserves a replaced destination with a different directory identity', t => {
  // Arrange
  const f = fixture(t);
  const captured = f.capture();
  const retained = retain(f.root, f.source, captured);
  const destination = path.join(f.root, 'replaced');
  const moved = path.join(f.root, 'owned-before-replacement');
  const write = fs.writeFileSync;
  fs.writeFileSync = function (file, ...args) {
    if (file === path.join(destination, 'subject.txt')) {
      fs.renameSync(destination, moved);
      fs.mkdirSync(destination);
      write(path.join(destination, 'keep.txt'), 'Replacement belongs to someone else');
      throw new Error('Fixture replacement');
    }
    return write.call(this, file, ...args);
  };
  t.after(() => { fs.writeFileSync = write; });

  // Act
  const result = restore(f.root, retained.retainedInputs, captured, destination);

  // Assert
  assert.equal(result.available, false);
  assert.ok(result.reason.includes('identity changed'));
  assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'Replacement belongs to someone else');
  assert.equal(fs.existsSync(moved), true);
});

test('the status probe reads the cache without writing it, and an absent, evicted, unbound or locked entry reads as not cached', t => {
  // Arrange
  const f = fixture(t);
  const captured = f.capture();
  const file = path.join(f.root, CACHE_PATH);
  const absent = cached(f.root, { kind: 'cache-v1', digest: captured.digest }, captured);
  const absentAfterProbe = fs.existsSync(file);
  const { retainedInputs } = retain(f.root, f.source, captured);
  const before = { bytes: fs.readFileSync(file), modified: fs.statSync(file).mtimeMs };
  f.write('a later candidate');
  const later = f.capture();

  // Act
  const present = cached(f.root, retainedInputs, captured);
  const after = { bytes: fs.readFileSync(file), modified: fs.statSync(file).mtimeMs };
  const evicted = cached(f.root, { kind: 'cache-v1', digest: later.digest }, later);
  const unbound = cached(f.root, retainedInputs, later);
  const lock = new DatabaseSync(file);
  lock.exec('BEGIN EXCLUSIVE');
  const locked = cached(f.root, retainedInputs, captured);
  lock.exec('ROLLBACK');
  lock.close();

  // Assert
  assert.deepEqual([absent, absentAfterProbe], [false, false]);
  assert.equal(present, true);
  assert.deepEqual(after, before);
  assert.deepEqual([evicted, unbound, locked], [false, false, false]);
  assert.equal(cached(f.root, retainedInputs, captured), true);
});
