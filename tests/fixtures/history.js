'use strict';

const { HistoryReader, isCompact, sha256 } = require('../../internal/runtime/history-store');

// Raw history access for tests that build, read or damage rows directly, in the format of whichever store version they hold. A
// row these helpers write to a compact store is always full, which is a valid form for any revision.

function historyText(db, runId, revision) {
  return new HistoryReader(db, runId).text(revision)?.state;
}

function putHistory(db, runId, revision, kind, recordedAt, text) {
  if (!isCompact(db)) {
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?) ON CONFLICT(run_id, revision) DO UPDATE SET kind=excluded.kind, recorded_at=excluded.recorded_at, state=excluded.state').run(runId, revision, kind, recordedAt, text);
    return;
  }
  db.prepare("INSERT INTO history VALUES (?, ?, ?, ?, 'full', ?, ?, ?) ON CONFLICT(run_id, revision) DO UPDATE SET kind=excluded.kind, recorded_at=excluded.recorded_at, encoding='full', bytes=excluded.bytes, digest=excluded.digest, body=excluded.body").run(runId, revision, kind, recordedAt, Buffer.byteLength(text), sha256(text), text);
}

// Replaces the text of every matching row by transform(text), leaving every other row's text as it was. In a compact store a
// delta row depends on the row above it, so every row of each affected run is first written out full; damage to one row then
// stays confined to that row, as it would in an earlier store.
function rewriteHistory(db, transform, { runId, revision } = {}) {
  const filters = [runId === undefined ? null : 'run_id=?', revision === undefined ? null : 'revision=?'].filter(Boolean);
  const selected = db.prepare(`SELECT run_id, revision FROM history${filters.length ? ` WHERE ${filters.join(' AND ')}` : ''}`).all(...[runId, revision].filter(value => value !== undefined));
  const chosen = new Set(selected.map(row => `${row.run_id}:${row.revision}`));
  const runs = [...new Set(selected.map(row => row.run_id))];
  for (const run of runs) {
    const reader = new HistoryReader(db, run);
    const rows = db.prepare('SELECT run_id, revision, kind, recorded_at FROM history WHERE run_id=? ORDER BY revision').all(run);
    const texts = rows.map(row => reader.text(row.revision).state);
    rows.forEach((row, index) => {
      const text = chosen.has(`${row.run_id}:${row.revision}`) ? transform(texts[index]) : texts[index];
      if (chosen.has(`${row.run_id}:${row.revision}`) || isCompact(db)) putHistory(db, row.run_id, row.revision, row.kind, row.recorded_at, text);
    });
  }
}

function setHistoryText(db, runId, revision, text) {
  rewriteHistory(db, () => text, { runId, revision });
}

function storedHistoryBytes(db) {
  return db.prepare(`SELECT coalesce(sum(length(${isCompact(db) ? 'body' : 'state'})), 0) AS bytes FROM history`).get().bytes;
}

module.exports = { historyText, putHistory, rewriteHistory, setHistoryText, storedHistoryBytes };
