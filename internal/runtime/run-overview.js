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

function pickup(record, state, context, dependencies) {
  if (record.status === 'complete') return record.report ? { offer: 'present-report' } : { offer: 'none', reason: 'report-unrecorded', message: 'The delivery owes its morning report, but no saved report is recorded' };
  const refusal = routingRefusal(record, state, context);
  if (refusal) return { offer: 'none', ...refusal };
  const verdict = require('./ownership').adoptionEligibility(state, {}, dependencies);

  return verdict.eligible ? { offer: 'adopt' } : { offer: 'none', reason: verdict.code, message: verdict.message };
}

function describe(store, state, current, context, dependencies) {
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
  record.close = closeOffer(record, state, dependencies);

  return record;
}

// Close eligibility as Ready can judge it from the saved record, independently of the pickup's adoption-only routing: the status, the
// adoption-eligibility evidence and, for a delivery, the saved accounting marker. The older-release guard is left to close-manifest.
function closeOffer(record, state, dependencies) {
  if (!['running', 'stopped'].includes(state.status)) return null;
  const verdict = require('./ownership').adoptionEligibility(state, {}, dependencies);
  if (!verdict.eligible) return { offer: 'none', reason: verdict.code, message: verdict.message };
  if (record.store === 'delivery' && state.progress?.status !== 'current') {
    const message = state.status === 'running'
      ? 'Its saved accounting is not current: run close-manifest, whose accounting replay is the authoritative check, or stop it through its own release first'
      : 'Its saved accounting is not current: consult migration inventory, which classifies it; retire it when listed as legacy, otherwise inspect it with raw-inspect and restore its accounting evidence';

    return { offer: 'none', reason: 'close-accounting-unavailable', message };
  }

  return { offer: 'close' };
}

function isOpen(state, current) {
  if (state.status === 'running' || state.status === 'stopped') return true;

  return current && state.status === 'complete' && require('./creation-consistency').reportAwaitsRecipient(state);
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
    for (const state of states) {
      if (retired.has(state.id)) continue;
      const current = definition.store === 'delivery' && state.id === active;
      if (isOpen(state, current)) records.push(describe(definition.store, state, current, context, dependencies));
    }
    result.records.push(...records);
    result.compaction.push(compactionEntry(definition.store, file, version, states));
  } catch (error) {
    // Once the opener has admitted the store, a failure is a read error, even when a state check throws an opener's code.
    result.unavailable.push({ store: definition.store, code: 'run-overview-unavailable', message: error?.message ?? String(error) });
  } finally {
    database.close();
  }
}

// Read-only summary of a project's open delivery runs and review contexts and its run stores' compaction state, for Ready.
// It never reads history, artifacts or accounting tables, and a store it cannot read is listed as unavailable, never as empty.
function overview(root, { context = null, dependencies = {} } = {}) {
  const result = { records: [], compaction: [], unavailable: [] };
  for (const definition of DEFINITIONS) readStore(root, definition, context, dependencies, result);

  return result;
}

module.exports = { overview, parseRunState, runDatabase };
