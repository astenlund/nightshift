'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { COMPACT_VERSION, HISTORY_SQL, KEYFRAME_INTERVAL, HistoryReader, appendRevision, apply, diff, encodeRow, latestRowStats, metadata, rangeBytes, sha256 } = require('../internal/runtime/history-store');

const LEGACY_HISTORY_SQL = 'CREATE TABLE history (run_id TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision))';
const unavailable = error => error.code === 'history-unavailable';

function database(version) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL); ${version >= COMPACT_VERSION ? HISTORY_SQL : LEGACY_HISTORY_SQL}; PRAGMA user_version=${version};`);
  return db;
}

// Saves revisions as RunStore.save does: the current row in runs and each revision appended to history.
function record(db, runId, states) {
  const texts = states.map(state => JSON.stringify(state));
  texts.forEach((text, revision) => {
    db.prepare('INSERT INTO runs VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, state=excluded.state').run(runId, revision, text);
    appendRevision(db, { runId, revision, kind: revision === 0 ? 'created' : 'advance', recordedAt: `2026-11-01T00:00:${String(revision % 60).padStart(2, '0')}Z`, text, previous: revision === 0 ? null : { revision: revision - 1, text: texts[revision - 1] } });
  });
  return texts;
}

function stateAt(revision) {
  const workers = Array.from({ length: 1 + (revision % 5) }, (_, index) => ({ id: `w${index}`, phase: revision % 2 ? 'running' : 'finalizing' }));
  return { schema: 1, id: 'run', revision, updatedAt: `t${revision}`, tasks: [{ id: 'task', checks: Array.from({ length: revision % 7 }, (_, index) => ({ name: `check ${index}` })) }], workers, ...(revision % 3 ? { note: 'present' } : {}) };
}

const PAIRS = [
  ['key reorder', { a: 1, b: 2 }, { b: 2, a: 1 }],
  ['added and removed keys', { a: 1, b: 2 }, { a: 1, c: 3 }],
  ['integer-like keys', { 10: 'x', 2: 'y', name: 'z' }, { 2: 'y', 10: 'changed', name: 'z', 1: 'new' }],
  ['array growth', [1, 2], [1, 2, { three: 3 }, [4]]],
  ['array shrinkage', [1, 2, 3, 4], [1, 9]],
  ['nested change', { tasks: [{ checks: [{ output: 'a' }] }] }, { tasks: [{ checks: [{ output: 'b' }, { output: 'c' }] }] }],
  ['Unicode text', { text: 'plain' }, { text: 'caf\u00e9 \u{1F600} \u0000 end' }],
  ['empty values', { a: [], b: {}, c: '' }, { a: {}, b: [], c: null }],
  ['type changes', { a: 1, b: 'two', c: [3] }, { a: '1', b: { two: 2 }, c: 3 }],
  ['identical', { a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }],
];

for (const [name, from, to] of PAIRS) {
  test(`a delta rebuilds the exact text: ${name}`, () => {
    const source = JSON.parse(JSON.stringify(from));
    const target = JSON.stringify(to);
    const delta = diff(source, JSON.parse(target));
    assert.equal(JSON.stringify(apply(source, JSON.parse(JSON.stringify(delta)))), target);
    if (name === 'identical') assert.equal(delta, null);
  });
}

test('an invalid delta shape is refused', () => {
  const cases = [
    [{ a: 1 }, {}],
    [{ a: 1 }, { set: 1, extra: 2 }],
    [[1], { length: -1, items: {} }],
    [[1], { length: 2, items: { '01': { set: 1 } } }],
    [[1], { length: 2, items: { 1: { fields: {} } } }],
    [[1], { length: 2, items: {} }],
    [{ a: 1 }, { keys: ['a'], fields: { b: { set: 2 } } }],
    [{ a: 1 }, { keys: ['a', 'b'], fields: {} }],
    [{ a: 1 }, { keys: ['a', 'a'], fields: {} }],
    [{ a: 1 }, { keys: ['a', 'b'], fields: { b: { fields: {} } } }],
    [[1], { fields: {} }],
    [{ a: 1 }, { length: 1, items: {} }],
    [{ a: 1 }, 'set'],
  ];
  for (const [value, delta] of cases) assert.throws(() => apply(value, delta), unavailable, JSON.stringify(delta));
});

test('a row stays full when it is current, a keyframe, has no successor or does not round-trip', () => {
  const next = { value: { a: 2 } };
  assert.equal(encodeRow(3, '{"a":1}', next).encoding, 'delta');
  assert.equal(encodeRow(3, '{"a":1}', next, true).encoding, 'full');
  assert.equal(encodeRow(KEYFRAME_INTERVAL, '{"a":1}', next).encoding, 'full');
  assert.equal(encodeRow(3, '{"a":1}', null).encoding, 'full');
  assert.equal(encodeRow(3, '{"a": 1}', next).encoding, 'full');
  assert.equal(encodeRow(3, 'not json', next).encoding, 'full');
  const row = encodeRow(3, '{"a":1}', next);
  assert.deepEqual([row.bytes, row.digest], [Buffer.byteLength('{"a":1}'), sha256('{"a":1}')]);
});

test('a compact store keeps current rows and keyframes full and rebuilds every revision exactly', () => {
  const db = database(COMPACT_VERSION);
  const count = KEYFRAME_INTERVAL * 2 + 5;
  const texts = record(db, 'run', Array.from({ length: count }, (_, revision) => stateAt(revision)));
  const encodings = new Map(db.prepare('SELECT revision, encoding FROM history').all().map(row => [row.revision, row.encoding]));
  for (let revision = 0; revision < count; revision++) assert.equal(encodings.get(revision), revision === count - 1 || revision % KEYFRAME_INTERVAL === 0 ? 'full' : 'delta', `revision ${revision}`);
  const descending = new HistoryReader(db, 'run');
  for (let revision = count - 1; revision >= 0; revision--) assert.equal(descending.text(revision).state, texts[revision]);
  const ascending = new HistoryReader(db, 'run');
  for (let revision = 0; revision < count; revision++) assert.equal(ascending.text(revision).state, texts[revision]);
  const fresh = new HistoryReader(db, 'run');
  assert.equal(fresh.text(KEYFRAME_INTERVAL + 7).state, texts[KEYFRAME_INTERVAL + 7]);
  assert.deepEqual({ ...fresh.meta(5) }, { revision: 5, kind: 'advance', recordedAt: '2026-11-01T00:00:05Z', bytes: Buffer.byteLength(texts[5]) });
});

test('a text read respects its byte bound before rebuilding', () => {
  for (const version of [1, 2, COMPACT_VERSION]) {
    const db = database(version);
    const texts = record(db, 'run', Array.from({ length: 4 }, (_, revision) => stateAt(revision)));
    const reader = new HistoryReader(db, 'run');
    assert.equal(reader.text(1, Buffer.byteLength(texts[1]) - 1), undefined);
    assert.equal(reader.text(1, Buffer.byteLength(texts[1])).state, texts[1]);
    assert.equal(reader.text(9), undefined);
  }
});

test('a corrupted delta, a wrong digest or a missing full row fails closed', () => {
  const corrupt = (change, revision) => {
    const db = database(COMPACT_VERSION);
    record(db, 'run', Array.from({ length: 6 }, (_, index) => stateAt(index)));
    db.exec(change);
    assert.throws(() => new HistoryReader(db, 'run').text(revision), unavailable, change);
  };
  corrupt("UPDATE history SET body='{\"fields\":{\"revision\":{\"set\":99}}}' WHERE revision=2", 2);
  corrupt("UPDATE history SET body='not json' WHERE revision=2", 2);
  corrupt("UPDATE history SET digest='0000' WHERE revision=3", 3);
  corrupt("UPDATE history SET digest='0000' WHERE revision=5", 2);
  corrupt('DELETE FROM history WHERE revision=5', 2);
  corrupt('DELETE FROM history WHERE revision=3', 2);
  corrupt("UPDATE history SET encoding='other' WHERE revision=2", 2);
});

test('metadata, range sizes and latest-row totals agree across store versions', () => {
  const results = [1, 2, COMPACT_VERSION].map(version => {
    const db = database(version);
    record(db, 'run', Array.from({ length: 10 }, (_, revision) => stateAt(revision)));
    return { metadata: metadata(db, 'run', { from: 2, to: 6, descending: true, limit: 3 }), range: rangeBytes(db, 'run', 0, 9), latest: latestRowStats(db) };
  });
  for (const result of results.slice(1)) assert.deepEqual(result, results[0]);
  assert.deepEqual(results[1].metadata.map(row => row.revision), [6, 5, 4]);
});
