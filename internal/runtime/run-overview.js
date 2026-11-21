'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { requireValue } = require('../releases/io');
const { RUN_STORE_WAIT_MS, STORE_VERSIONS } = require('./store');
const { COMPACT_VERSION } = require('./history-store');
const { BACKUP, SIDECARS, STORES } = require('./history-compaction');
const { parseReviewState, reviewDatabase } = require('./review-inventory');

const MAX_STATE_BYTES = 64 * 1024 * 1024;
const COMPACTION_FLOOR_BYTES = 64 * 1024 * 1024;
const OPENER_CODES = new Set(['run-resource-state-unavailable', 'review-resource-state-unavailable']);
const BUSY_MESSAGE = 'A SQLite journal, WAL or shared-memory file survives beside the store';
const BOUND_MESSAGE = 'Current run states exceed the 64 MiB overview bound';

// A run store commit keeps readers out while it writes. Launcher operations wait for it as the runtime's own store connections
// do; a hook's preliminary read, made before it knows whether the session owns a run, passes no wait and keeps its earlier bound.
function runDatabase(root, waitMs = RUN_STORE_WAIT_MS) {
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  if (!fs.existsSync(file)) return null;
  const stat = fs.lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'run-resource-state-unavailable', 'Run database is not an ordinary file');
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    database.exec(`PRAGMA busy_timeout=${waitMs};`);
    // Only formats whose records the runtime reads can be inventoried; anything else holds retirement and collection back.
    const version = database.prepare('PRAGMA user_version').get().user_version;
    requireValue(version > 0 && STORE_VERSIONS.includes(version), 'run-resource-state-unavailable', `Unsupported run database version ${version}`);
  } catch (error) {
    database.close();
    throw error;
  }

  return database;
}

function parseRunState(row, root) {
  const value = JSON.parse(row.state);
  requireValue(value?.schema === 1 && (value.kind === undefined || value.kind === 'delivery') && value.root === root && typeof value.id === 'string' && value.id === row.id && value.controller && require('./statuses').isRecordStatus(value.status) && Array.isArray(value.workers), 'run-resource-state-unavailable', 'Run reference state is unsupported or incomplete');
  return value;
}

const DEFINITIONS = Object.freeze([
  { store: 'delivery', file: STORES.delivery, open: root => runDatabase(root, RUN_STORE_WAIT_MS), parse: parseRunState },
  { store: 'review', file: STORES.review, open: root => reviewDatabase(root, RUN_STORE_WAIT_MS), parse: parseReviewState },
]);

function shorten(value) {
  if (typeof value !== 'string') return value ?? null;

  return value.length > 200 ? value.slice(0, 197) + '...' : value;
}

function sameSession(context, controller) {
  return Boolean(context && controller && context.host === controller.host && context.session === controller.session);
}

function routingRefusal(record, state, context) {
  if (record.store === 'delivery' && !record.current) return { reason: 'not-current', message: 'Only the project\'s current unfinished delivery run can be adopted' };
  if (sameSession(context, state.controller)) return { reason: 'owned-by-this-session', message: 'This session already owns the record' };
  if (context && state.resourceMode !== 'bound') return { reason: 'no-retained-release', message: 'The record has no retained release this session could adopt it through' };
  if (!context && state.resourceMode !== 'development') return { reason: 'not-development', message: 'Only a development-mode record can be adopted without a bound context' };

  return null;
}

// A complete delivery's pickup is the report it owes, and only the current selection owes one; any other complete delivery Ready lists,
// for its closing outcome alone, gets none.
function pickup(record, state, context, dependencies) {
  if (record.status === 'complete') {
    if (!reportOwed(state, record.current)) return null;

    return record.report ? { offer: 'present-report' } : { offer: 'none', reason: 'report-unrecorded', message: 'The delivery owes its morning report, but no saved report is recorded' };
  }
  const refusal = routingRefusal(record, state, context);
  if (refusal) return { offer: 'none', ...refusal };
  const verdict = require('./ownership').adoptionEligibility(state, {}, dependencies);

  return verdict.eligible ? { offer: 'adopt' } : { offer: 'none', reason: verdict.code, message: verdict.message };
}

function describe(store, state, current, context, dependencies, outcome = null) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const record = {
    store,
    id: state.id,
    kind: state.kind ?? 'delivery',
    status: state.status,
    objective: shorten(state.objective),
    updatedAt: state.updatedAt,
    current,
    stop: state.stop ? { kind: state.stop.kind ?? null, reason: shorten(state.stop.reason) } : null,
    tasks: { complete: tasks.filter(task => task?.status === 'complete').length, total: tasks.length },
    report: null,
    pickup: null,
    close: null,
  };
  if (state.status === 'complete') record.report = state.closing?.reportEvidence?.path ?? null;
  record.pickup = pickup(record, state, context, dependencies);
  const outcomes = require('./delivery-outcome');
  if (state.status === 'complete') {
    // A complete delivery the hold scan judged not discharged is offered close from its outcome and the shared worker verdict alone,
    // the same verdict its routes name, since the outcome already established its accounting; one it did not judge, or judged
    // discharged, keeps today's value. Readability and the older-release guard are left to close-manifest.
    if (outcome && outcome.outcome !== outcomes.DISCHARGED) {
      const { routed, verdict } = outcomes.routesFor(state, outcome, { current, dependencies });
      record.outcome = { ...outcomes.brief(state.id, outcome, routed), provisional: true };
      // An unavailable outcome has no worker verdict; close's own refusal for its cause stands in.
      const refusal = verdict ?? require('./close').closeVerdict(state, dependencies, outcome);
      record.close = refusal.eligible ? { offer: 'close' } : { offer: 'none', reason: refusal.code, message: refusal.message };
    }
    return record;
  }
  record.close = closeOffer(record, state, dependencies);

  return record;
}

// Close eligibility as Ready can judge it from a running or stopped record, independently of the pickup's adoption-only routing: the
// status, the adoption-eligibility evidence and, for a delivery, the saved accounting marker. The older-release guard is left to
// close-manifest.
function closeOffer(record, state, dependencies) {
  const { accountingRemedy, closeVerdict } = require('./close');
  if (!['running', 'stopped'].includes(state.status)) return null;
  const verdict = closeVerdict(state, dependencies);
  if (!verdict.eligible) return { offer: 'none', reason: verdict.code, message: verdict.message };
  if (record.store === 'delivery' && state.progress?.status !== 'current') return { offer: 'none', reason: 'close-accounting-unavailable', message: `Its saved accounting is not current: ${accountingRemedy(state.status, { saved: true })}` };

  return { offer: 'close' };
}

function reportOwed(state, current) {
  return current && state.status === 'complete' && require('./creation-consistency').reportAwaitsRecipient(state);
}

// A complete delivery is open while it owes the current selection's report or its closing outcome is not discharged.
function isOpen(state, current, outcome = null) {
  if (state.status === 'running' || state.status === 'stopped') return true;

  return reportOwed(state, current) || state.status === 'complete' && Boolean(outcome) && outcome.outcome !== require('./delivery-outcome').DISCHARGED;
}

// The closing outcome of every complete, unretired delivery that has no current settled-record verdict, judged read-only within one
// shared input allowance; a shortfall leaves the rest unjudged and becomes a store-level notice, as a failed scan does.
function scanOutcomes(database, root, result) {
  try {
    const { byId, shortfall } = require('./delivery-outcome').readOutcomes(database, root, { shared: true, inTransaction: true });
    if (shortfall) result.notices.push({ store: 'delivery', code: 'closing-outcome-shortfall', message: 'Some complete deliveries could not be judged within the shared input allowance, so whether they hold back the next handover is unknown' });

    return byId;
  } catch (error) {
    result.notices.push({ store: 'delivery', code: 'closing-outcome-unavailable', message: `The closing outcomes of complete deliveries could not be judged: ${error?.message ?? String(error)}` });

    return new Map();
  }
}

// An opener refusal keeps the opener's code; anything else that stops the opener, such as a busy timeout, is a read error.
function unavailableFrom(store, error) {
  return { store, code: OPENER_CODES.has(error?.code) ? error.code : 'run-overview-unavailable', message: error?.message ?? String(error) };
}

function compactionEntry(store, file, version, rows) {
  const bytes = fs.statSync(file).size;
  const backup = fs.existsSync(file + BACKUP);
  const due = version < COMPACT_VERSION && bytes >= COMPACTION_FLOOR_BYTES && !backup;
  const blockedBy = !due ? [] : rows === null ? null : rows.filter(state => state.status === 'running').map(state => state.id);

  return { store, version, bytes, backup, due, finishDue: version === COMPACT_VERSION && backup, blockedBy };
}

function readStore(root, definition, context, dependencies, result) {
  const file = path.join(root, '.nightshift/runs', definition.file);
  if (SIDECARS.some(suffix => fs.existsSync(file + suffix))) {
    result.unavailable.push({ store: definition.store, code: 'run-overview-busy', message: BUSY_MESSAGE });
    return;
  }
  if (!fs.existsSync(file)) return;
  let database;
  try {
    database = definition.open(root);
  } catch (error) {
    result.unavailable.push(unavailableFrom(definition.store, error));
    return;
  }
  if (!database) return;
  try {
    // One read transaction holds every row a record is built from, the closing-outcome scan's included, so they share one snapshot.
    database.exec('BEGIN');
    const version = database.prepare('PRAGMA user_version').get().user_version;
    const total = database.prepare('SELECT coalesce(sum(length(CAST(state AS BLOB))), 0) AS bytes FROM runs').get().bytes;
    if (total > MAX_STATE_BYTES) {
      result.unavailable.push({ store: definition.store, code: 'run-overview-bound', message: BOUND_MESSAGE });
      result.compaction.push(compactionEntry(definition.store, file, version, null));
      return;
    }
    const states = database.prepare('SELECT id, state FROM runs').all().map(row => definition.parse(row, root));
    const active = definition.store === 'delivery' ? database.prepare('SELECT id FROM active WHERE singleton=1').get()?.id ?? null : null;
    const retirements = definition.store === 'delivery' && database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_retirements'").get();
    const retired = new Set(retirements ? database.prepare('SELECT run_id FROM legacy_retirements').all().map(row => row.run_id) : []);
    const records = [];
    const judged = definition.store === 'delivery' && states.some(state => state.status === 'complete' && !retired.has(state.id)) ? scanOutcomes(database, root, result) : new Map();
    for (const state of states) {
      if (retired.has(state.id)) continue;
      const current = definition.store === 'delivery' && state.id === active;
      const outcome = judged.get(state.id)?.judgment ?? null;
      if (isOpen(state, current, outcome)) records.push(describe(definition.store, state, current, context, dependencies, outcome));
    }
    result.records.push(...records);
    result.compaction.push(compactionEntry(definition.store, file, version, states));
  } catch (error) {
    // Once the opener has admitted the store, a failure is a read error, even when a state check throws an opener's code.
    result.unavailable.push({ store: definition.store, code: 'run-overview-unavailable', message: error?.message ?? String(error) });
  } finally {
    if (database.isTransaction) database.exec('ROLLBACK');
    database.close();
  }
}

// Read-only summary of a project's open delivery runs and review contexts and its run stores' compaction state, for Ready. Only the
// closing-outcome scan of complete deliveries reads history, artifacts and accounting tables, in a read-only transaction that writes
// no verdict; a store it cannot read is listed as unavailable, never as empty, and a store-level scan shortfall is a notice.
function overview(root, { context = null, dependencies = {} } = {}) {
  const result = { records: [], compaction: [], unavailable: [], notices: [] };
  for (const definition of DEFINITIONS) readStore(root, definition, context, dependencies, result);

  return result;
}

module.exports = { overview, parseRunState, runDatabase };
