'use strict';

const { createHash } = require('node:crypto');
const progress = require('./progress');
const { HistoryReader, latestRevision } = require('./history-store');

// Settled-record verdicts (specs/settled-record-verdicts.md): the creation gate records, for each record it judged settled, the
// metadata of the revision it judged, and a later gate confirms the record from that metadata instead of judging it again. Freeze
// triggers refuse rewriting or deleting a verdicted revision's rows in place, so a matching verdict still describes what was judged.

// `rule` changes whenever a check whose result a verdict vouches for accepts or refuses differently: the record's identity and shape,
// the agreement of its state with its latest history row, its discharge, and the retired-record checks the verdict stands in for.
// `earlier` lists the identities earlier releases wrote, whose verdicts this runtime treats as stale and judges again; any other
// identity is a later release's and is left unchanged. No earlier release wrote verdicts. Read at call time so fixtures can stand in
// for a release that changes the identity.
const IDENTITY = { rule: 'settled-record-verdict-1', earlier: [] };
const TABLE = 'settled_verdicts';
const TABLE_SQL = 'CREATE TABLE settled_verdicts (run_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_bytes INTEGER NOT NULL, state_digest TEXT NOT NULL, latest_revision INTEGER NOT NULL, latest_bytes INTEGER NOT NULL, journal_revision INTEGER, acceptance TEXT, retirement TEXT, rule TEXT NOT NULL)';
const PREFIX = 'verdict_guard_';

function trigger(table, event, when) {
  const name = `${PREFIX}${table}_${event.toLowerCase()}`;

  return { name, sql: `CREATE TRIGGER ${name} BEFORE ${event} ON ${table} WHEN ${when} BEGIN SELECT RAISE(ABORT, 'verdicted-run'); END` };
}

// A run's rows are frozen while its verdict names the revision the run is at. A save first moves the run to its next revision, which
// the runs guard admits, and only then rewrites the previous history row on a compact store, which the verdict no longer covers.
const CURRENT_VERDICT = 'EXISTS(SELECT 1 FROM settled_verdicts verdict JOIN runs saved ON saved.id=verdict.run_id WHERE verdict.run_id=OLD.run_id AND verdict.revision=saved.revision)';
// A run row under an id that has a verdict only ever moves to a higher revision under the same id, as a save moves it: no writer
// rewrites a revision in place, lowers it, renames a run, deletes one or inserts one again. Refusing everything else, whatever revision
// the verdict names, keeps a verdicted run from being brought back to its verdicted revision after rows were edited at a later one.
// The insert guard fires before conflict resolution, so it also covers a replacing insert, whose implicit delete fires no trigger: it
// refuses one at or below the verdict's revision or the revision the row is at, while a save's upsert moves to the next revision.
const hasVerdict = id => `EXISTS(SELECT 1 FROM settled_verdicts verdict WHERE verdict.run_id=${id})`;
const TRIGGERS = Object.freeze([
  // IS and IS NOT keep the comparisons defined for a NULL id, so renaming a verdicted run to or from NULL is refused as well.
  trigger('runs', 'UPDATE', `${hasVerdict('OLD.id')} AND NOT (NEW.id IS OLD.id AND NEW.revision>OLD.revision) OR NEW.id IS NOT OLD.id AND ${hasVerdict('NEW.id')}`),
  trigger('runs', 'DELETE', hasVerdict('OLD.id')),
  trigger('runs', 'INSERT', `${hasVerdict('NEW.id')} AND (EXISTS(SELECT 1 FROM settled_verdicts verdict WHERE verdict.run_id=NEW.id AND NEW.revision<=verdict.revision) OR EXISTS(SELECT 1 FROM runs saved WHERE saved.id=NEW.id AND NEW.revision<=saved.revision))`),
  // An update is guarded on both sides, so a replacing update from another run's row onto a frozen key is refused as well; no writer
  // moves a row into a run whose verdict names its current revision.
  ...['history', 'accounting_commits', 'discharge_index'].flatMap(table => [
    trigger(table, 'UPDATE', `${CURRENT_VERDICT} OR ${CURRENT_VERDICT.split('OLD.').join('NEW.')}`),
    trigger(table, 'DELETE', CURRENT_VERDICT),
  ]),
  // A replacing insert rewrites a frozen row without firing its delete guard, so an insert that collides with an existing row of a run
  // whose verdict names its current revision is refused. Saves insert only new revisions, before the runs upsert that stales the
  // verdict, so they never collide; a discharge-index row's key spans every column, so replacing one cannot change it.
  ...['history', 'accounting_commits'].map(table => trigger(table, 'INSERT', `${CURRENT_VERDICT.split('OLD.').join('NEW.')} AND EXISTS(SELECT 1 FROM ${table} existing WHERE existing.run_id=NEW.run_id AND existing.revision=NEW.revision)`)),
]);

const sha256 = text => createHash('sha256').update(text).digest('hex');

// own: this runtime's table and every guard; missing: this runtime's table or guards, each present one exactly its own, with some
// absent; absent: no table and no guard; later: anything else, taken to be a later release's. No earlier release defined this
// protection; a release that changes the definition recognizes this one as an earlier runtime's, replacing it and keeping its verdicts.
function protectionState(db) {
  const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(TABLE)?.sql;
  const guards = new Map(db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND substr(name, 1, ?)=?").all(PREFIX.length, PREFIX).map(row => [row.name, row.sql]));
  const own = new Map(TRIGGERS.map(guard => [guard.name, guard.sql]));
  const foreign = [...guards].some(([name, sql]) => own.get(name) !== sql);
  if (foreign || table !== undefined && table !== TABLE_SQL) return 'later';
  if (table === undefined) return guards.size === 0 ? 'absent' : 'missing';

  return guards.size === own.size ? 'own' : 'missing';
}

const integer = value => Number.isSafeInteger(value) && value >= 0;

function wellFormed(row) {
  return typeof row.run_id === 'string' && row.run_id.length > 0 && integer(row.revision) && integer(row.state_bytes) && progress.HASH.test(row.state_digest ?? '') && integer(row.latest_revision) && integer(row.latest_bytes) && (row.journal_revision === null || integer(row.journal_revision)) && (row.acceptance === null || typeof row.acceptance === 'string') && (row.retirement === null || progress.HASH.test(row.retirement)) && typeof row.rule === 'string' && row.rule.length > 0;
}

// Every saved verdict row with its own rowid, and a lookup by run of the rows keyed by a run id, or null when the table holds more rows
// than the store can hold records, which no runtime writes. Each row is classified and removed by its rowid, so no row's handling
// depends on another row sharing its key, as several rows keyed by NULL can.
function readVerdicts(db, maximum) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(TABLE)) return { rows: [], byRun: new Map() };
  if (db.prepare('SELECT count(*) AS count FROM settled_verdicts').get().count > maximum) return null;

  // Integers are read as BigInt, so a stored value past what a JavaScript number represents cannot fail the read; a safe one becomes a
  // number again and any other stays a BigInt, which the shape checks reject.
  const statement = db.prepare('SELECT rowid, * FROM settled_verdicts');
  statement.setReadBigInts(true);
  const decoded = row => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value]));
  // A later release's rule identity takes precedence over this runtime's shape checks, which a later release's values need not meet.
  const rows = statement.all().map(decoded).map(row => ({ ...row, wellFormed: wellFormed(row), current: row.rule === IDENTITY.rule, later: typeof row.rule === 'string' && row.rule.length > 0 && row.rule !== IDENTITY.rule && !IDENTITY.earlier.includes(row.rule) }));

  // The primary key keeps text run ids unique, so the lookup holds every row keyed by one.
  return { rows, byRun: new Map(rows.filter(row => typeof row.run_id === 'string').map(row => [row.run_id, row])) };
}

// What a verdict binds, read from metadata alone: the run's revision and state length, its latest history row and its journal.
function metadataOf(db, tables, id) {
  const run = db.prepare('SELECT revision, length(CAST(state AS BLOB)) AS stateBytes FROM runs WHERE id=?').get(id);
  if (!run) return null;
  const latest = latestRevision(db, id);
  const latestBytes = latest === undefined ? undefined : new HistoryReader(db, id).meta(latest)?.bytes;
  const journal = tables.has('accounting_commits') ? db.prepare('SELECT max(revision) AS revision FROM accounting_commits WHERE run_id=?').get(id).revision : null;

  return { revision: run.revision, stateBytes: run.stateBytes, latestRevision: latest, latestBytes, journalRevision: journal ?? null };
}

function matches(verdict, metadata, retirement) {
  return Boolean(metadata) && verdict.revision === metadata.revision && verdict.state_bytes === metadata.stateBytes && verdict.latest_revision === metadata.latestRevision && verdict.latest_bytes === metadata.latestBytes && verdict.journal_revision === metadata.journalRevision && verdict.retirement === retirement;
}

function verdictFor(state, stateText, metadata, retirement) {
  return { run_id: state.id, revision: metadata.revision, state_bytes: metadata.stateBytes, state_digest: sha256(stateText), latest_revision: metadata.latestRevision, latest_bytes: metadata.latestBytes, journal_revision: metadata.journalRevision, acceptance: state.acceptance?.handoverId ?? null, retirement, rule: IDENTITY.rule };
}

function install(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(TABLE)) db.exec(TABLE_SQL);
  for (const guard of TRIGGERS) if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(guard.name)) db.exec(guard.sql);
}

// The guards name the verdict table, so with it dropped beneath them every write that fires one fails, every save of a run included.
// Every save of this runtime therefore recreates it, empty, first, through ensureSchema, as a creation pass that writes does through
// install: an empty table vouches for nothing, and the next gate pass judges in full.
function restoreTable(db) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(TABLE)) return;
  if (protectionState(db) === 'missing') db.exec(TABLE_SQL);
}

// Applies one pass's verdict and protection writes together. Reinstalling protection removes every verdict written before it, since
// the rows those verdicts vouch for were unprotected meanwhile. A verdict is written only while the record still carries the metadata
// it was judged at, so writes replayed in a fresh transaction after a refused pass cannot vouch for a record changed in between.
function applyWrites(db, tables, writes) {
  if (!writes.reinstall && writes.upserts.size === 0 && writes.deletes.size === 0) return;
  if (writes.reinstall || writes.upserts.size > 0) install(db);
  if (writes.reinstall) db.exec('DELETE FROM settled_verdicts');
  // Deletions name rows by rowid, so a row keyed by NULL is removed alone and another sharing its key is left as it is.
  const remove = db.prepare('DELETE FROM settled_verdicts WHERE rowid=?');
  for (const id of writes.deletes) remove.run(id);
  const insert = db.prepare('INSERT OR REPLACE INTO settled_verdicts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const verdict of writes.upserts.values()) {
    const retirement = tables.has('legacy_retirements') ? db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(verdict.run_id)?.artifact ?? null : null;
    if (!matches(verdict, metadataOf(db, tables, verdict.run_id), retirement)) continue;
    insert.run(verdict.run_id, verdict.revision, verdict.state_bytes, verdict.state_digest, verdict.latest_revision, verdict.latest_bytes, verdict.journal_revision, verdict.acceptance, verdict.retirement, verdict.rule);
  }
}

module.exports = { IDENTITY, TABLE, TABLE_SQL, TRIGGERS, applyWrites, matches, metadataOf, protectionState, readVerdicts, restoreTable, verdictFor };
