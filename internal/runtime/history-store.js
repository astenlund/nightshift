'use strict';

const { createHash } = require('node:crypto');
const { requireCondition } = require('./errors');

// Store version 3 keeps most history rows as backward structural deltas, each turning the next revision's state into its own,
// with a full row at every run's current revision and at every multiple of KEYFRAME_INTERVAL; earlier versions keep every row
// full. Every reader goes through this module, which returns the exact text a full row would hold and checks each rebuilt text
// against the byte length and SHA-256 recorded when it was written.
const COMPACT_VERSION = 3;
const KEYFRAME_INTERVAL = 64;
const HISTORY_SQL = 'CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, encoding TEXT NOT NULL, bytes INTEGER NOT NULL, digest TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(run_id, revision))';
const CODE = 'history-unavailable';
const NO_LIMIT = Number.MAX_SAFE_INTEGER;

const sha256 = text => createHash('sha256').update(text).digest('hex');
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function isCompact(db) {
  return db.prepare('PRAGMA user_version').get().user_version >= COMPACT_VERSION;
}

function isKeyframe(revision) {
  return revision % KEYFRAME_INTERVAL === 0;
}

// The change that turns `from` into `to`: undefined when they are equal, otherwise a set, field or item delta.
function diffNode(from, to) {
  if (same(from, to)) return undefined;
  if (Array.isArray(from) && Array.isArray(to)) {
    const items = {};
    for (let index = 0; index < to.length; index += 1) {
      const child = index < from.length ? diffNode(from[index], to[index]) : { set: to[index] };
      if (child !== undefined) items[index] = child;
    }
    return { length: to.length, items };
  }
  if (isObject(from) && isObject(to)) {
    const fields = {};
    for (const key of Object.keys(to)) {
      const child = Object.hasOwn(from, key) ? diffNode(from[key], to[key]) : { set: to[key] };
      if (child !== undefined) fields[key] = child;
    }
    const keys = Object.keys(to);
    return same(Object.keys(from), keys) ? { fields } : { keys, fields };
  }

  return { set: to };
}

function diff(from, to) {
  return diffNode(from, to) ?? null;
}

function invalid(message) {
  requireCondition(false, CODE, message);
}

function applyNode(value, node) {
  if (!isObject(node)) invalid('A history delta has an invalid shape');
  const keys = Object.keys(node);
  if (keys.length === 1 && keys[0] === 'set') return node.set;
  if (keys.length === 2 && Object.hasOwn(node, 'length') && Object.hasOwn(node, 'items')) {
    if (!Array.isArray(value) || !Number.isSafeInteger(node.length) || node.length < 0 || !isObject(node.items)) invalid('A history array delta has an invalid shape');
    for (const index of Object.keys(node.items)) {
      const position = Number(index);
      if (String(position) !== index || !Number.isSafeInteger(position) || position >= node.length || position >= value.length && !(isObject(node.items[index]) && Object.hasOwn(node.items[index], 'set'))) invalid('A history array delta names an invalid index');
    }
    const result = [];
    for (let index = 0; index < node.length; index += 1) {
      if (Object.hasOwn(node.items, index)) result.push(applyNode(value[index], node.items[index]));
      else if (index < value.length) result.push(value[index]);
      else invalid('A history array delta leaves an index unset');
    }
    return result;
  }
  if (Object.hasOwn(node, 'fields') && (keys.length === 1 || keys.length === 2 && Object.hasOwn(node, 'keys'))) {
    if (!isObject(value) || !isObject(node.fields)) invalid('A history object delta has an invalid shape');
    const order = node.keys ?? Object.keys(value);
    if (!Array.isArray(order) || !order.every(key => typeof key === 'string') || new Set(order).size !== order.length) invalid('A history object delta has an invalid key order');
    const listed = new Set(order);
    for (const key of Object.keys(node.fields)) {
      if (!listed.has(key) || !Object.hasOwn(value, key) && !(isObject(node.fields[key]) && Object.hasOwn(node.fields[key], 'set'))) invalid('A history object delta names an invalid field');
    }
    const result = {};
    for (const key of order) {
      if (Object.hasOwn(node.fields, key)) result[key] = applyNode(value[key], node.fields[key]);
      else if (Object.hasOwn(value, key)) result[key] = value[key];
      else invalid('A history object delta leaves a field unset');
    }
    return result;
  }
  invalid('A history delta has an invalid shape');
}

function apply(value, delta) {
  return delta === null ? value : applyNode(value, delta);
}

// The stored form of a row: a delta when one turns the next revision's state back into this row's exact text, otherwise full.
// A caller that has already parsed the text may pass the value to save a second parse; the round-trip check still uses the text.
function encodeRow(revision, text, next = null, current = false, parsed = undefined) {
  const stored = { encoding: 'full', bytes: Buffer.byteLength(text), digest: sha256(text), body: text };
  if (current || next === null || isKeyframe(revision)) return stored;
  let delta;
  try {
    const own = parsed === undefined ? JSON.parse(text) : parsed;
    delta = diff(next.value, own);
    if (JSON.stringify(apply(next.value, delta)) !== text) return stored;
  } catch {
    // A text that does not parse or round-trip is kept full, which is always a valid form.
    return stored;
  }

  return { ...stored, encoding: 'delta', body: JSON.stringify(delta) };
}

function verify(runId, row, text) {
  if (Buffer.byteLength(text) !== row.bytes || sha256(text) !== row.digest) invalid(`History of ${runId} revision ${row.revision} does not match its recorded digest`);

  return text;
}

// Reads one run's history. A reader keeps the states it rebuilt between a full row and the lowest revision reached from it, so a
// walk through consecutive revisions in either direction parses each full row once.
class HistoryReader {
  constructor(db, runId) {
    this.db = db;
    this.runId = runId;
    this.compact = isCompact(db);
    this.block = null;
  }

  meta(revision) {
    return this.compact
      ? this.db.prepare('SELECT revision, kind, recorded_at AS recordedAt, bytes FROM history WHERE run_id=? AND revision=?').get(this.runId, revision)
      : this.db.prepare('SELECT revision, kind, recorded_at AS recordedAt, length(CAST(state AS BLOB)) AS bytes FROM history WHERE run_id=? AND revision=?').get(this.runId, revision);
  }

  // The row's exact text, or undefined when the row is absent or its text exceeds maximumBytes.
  text(revision, maximumBytes = NO_LIMIT) {
    const limit = Number.isFinite(maximumBytes) ? Math.max(0, maximumBytes) : NO_LIMIT;
    if (!this.compact) return this.db.prepare('SELECT revision, kind, recorded_at AS recordedAt, length(CAST(state AS BLOB)) AS bytes, state FROM history WHERE run_id=? AND revision=? AND length(CAST(state AS BLOB))<=?').get(this.runId, revision, limit);
    const row = this.db.prepare('SELECT revision, kind, recorded_at AS recordedAt, encoding, bytes, digest, body FROM history WHERE run_id=? AND revision=?').get(this.runId, revision);
    if (!row || row.bytes > limit) return undefined;
    const { revision: number, kind, recordedAt, bytes } = row;

    return { revision: number, kind, recordedAt, bytes, state: this.rebuild(row) };
  }

  rebuild(row) {
    if (row.encoding === 'full') return verify(this.runId, row, row.body);
    if (row.encoding !== 'delta') invalid(`History of ${this.runId} revision ${row.revision} has an unknown encoding`);

    return verify(this.runId, row, JSON.stringify(this.value(row.revision)));
  }

  value(revision) {
    if (this.block?.values.has(revision)) return this.block.values.get(revision);
    const top = this.db.prepare("SELECT revision, bytes, digest, body FROM history WHERE run_id=? AND revision>? AND encoding='full' ORDER BY revision LIMIT 1").get(this.runId, revision);
    if (!top) invalid(`History of ${this.runId} revision ${revision} has no full row above it`);
    if (this.block?.top !== top.revision) this.block = { top: top.revision, lowest: top.revision, values: new Map([[top.revision, JSON.parse(verify(this.runId, top, top.body))]]) };
    const rows = this.db.prepare('SELECT revision, encoding, body FROM history WHERE run_id=? AND revision>=? AND revision<? ORDER BY revision DESC').all(this.runId, revision, this.block.lowest);
    for (const row of rows) {
      if (row.revision !== this.block.lowest - 1 || row.encoding !== 'delta') invalid(`History of ${this.runId} below revision ${this.block.lowest} is missing or not a delta`);
      let delta;
      try { delta = JSON.parse(row.body); }
      catch { invalid(`History delta of ${this.runId} revision ${row.revision} is unreadable`); }
      let value;
      try { value = apply(this.block.values.get(this.block.lowest), delta); }
      catch (error) { invalid(`History delta of ${this.runId} revision ${row.revision} is invalid: ${error.message}`); }
      this.block.values.set(row.revision, value);
      this.block.lowest = row.revision;
    }
    if (this.block.lowest !== revision) invalid(`History of ${this.runId} revision ${revision} is missing`);

    return this.block.values.get(revision);
  }
}

function metaColumns(db) {
  return isCompact(db) ? 'revision, kind, recorded_at AS recordedAt, bytes' : 'revision, kind, recorded_at AS recordedAt, length(CAST(state AS BLOB)) AS bytes';
}

// A run's history metadata between two revisions, ascending, or descending with an optional count.
function metadata(db, runId, { from = 0, to = NO_LIMIT, descending = false, limit = -1 } = {}) {
  return db.prepare(`SELECT ${metaColumns(db)} FROM history WHERE run_id=? AND revision BETWEEN ? AND ? ORDER BY revision ${descending ? 'DESC' : 'ASC'} LIMIT ?`).all(runId, from, to, limit);
}

// Every revision's revision, kind and time, which every store version holds alike: for one run, or for every run by run and revision.
function transitions(db, runId) {
  return runId === undefined
    ? db.prepare('SELECT run_id, revision, kind, recorded_at FROM history ORDER BY run_id, revision').all()
    : db.prepare('SELECT revision, kind, recorded_at AS recordedAt FROM history WHERE run_id=? ORDER BY revision').all(runId);
}

// The rows of the given kinds across every run, ordered by run and revision, each with its full state text; one reader per run
// rebuilds compact rows, so consecutive rows of a run share its rebuilt states.
function* statesOfKinds(db, kinds) {
  let reader = null;
  for (const row of db.prepare(`SELECT run_id, revision, kind, recorded_at FROM history WHERE kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY run_id, revision`).iterate(...kinds)) {
    if (reader?.runId !== row.run_id) reader = new HistoryReader(db, row.run_id);
    yield { ...row, state: reader.text(row.revision).state };
  }
}

function latestRevision(db, runId) {
  return db.prepare('SELECT max(revision) AS revision FROM history WHERE run_id=?').get(runId)?.revision ?? undefined;
}

function latestRevisionOfKind(db, runId, kind) {
  return db.prepare('SELECT revision FROM history WHERE run_id=? AND kind=? ORDER BY revision DESC LIMIT 1').get(runId, kind)?.revision;
}

function rangeBytes(db, runId, from, to) {
  const size = isCompact(db) ? 'bytes' : 'length(CAST(state AS BLOB))';

  return db.prepare(`SELECT coalesce(sum(${size}), 0) AS bytes FROM history WHERE run_id=? AND revision BETWEEN ? AND ?`).get(runId, from, to).bytes;
}

// The count and total size of the history rows at each run's current revision.
function latestRowStats(db) {
  const size = isCompact(db) ? 'history.bytes' : 'length(CAST(history.state AS BLOB))';

  return db.prepare(`SELECT count(*) AS count, coalesce(sum(${size}), 0) AS bytes FROM runs JOIN history ON history.run_id=runs.id AND history.revision=runs.revision`).get();
}

function hasHistory(db, runId) {
  return Boolean(db.prepare('SELECT 1 FROM history WHERE run_id=? LIMIT 1').get(runId));
}

// Appends a revision. On a compact store the previous revision's row, full while it was current, becomes its backward delta
// unless it is a keyframe or its delta does not rebuild its exact text; both rows change in the caller's transaction.
function appendRevision(db, { runId, revision, kind, recordedAt, text, previous = null }) {
  if (!isCompact(db)) {
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(runId, revision, kind, recordedAt, text);
    return;
  }
  const row = encodeRow(revision, text, null, true);
  db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(runId, revision, kind, recordedAt, row.encoding, row.bytes, row.digest, row.body);
  if (previous === null || isKeyframe(previous.revision)) return;
  const prior = encodeRow(previous.revision, previous.text, { value: JSON.parse(text) });
  if (prior.encoding === 'delta') db.prepare("UPDATE history SET encoding='delta', body=? WHERE run_id=? AND revision=? AND encoding='full' AND digest=?").run(prior.body, runId, previous.revision, prior.digest);
}

module.exports = { COMPACT_VERSION, HISTORY_SQL, KEYFRAME_INTERVAL, HistoryReader, appendRevision, apply, diff, encodeRow, hasHistory, isCompact, latestRevision, latestRevisionOfKind, latestRowStats, metadata, rangeBytes, sha256, statesOfKinds, transitions };
