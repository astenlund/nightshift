'use strict';

// The post-completion closing outcome (.nightshift/specs/post-completion-closing-hold.md): what holds a complete delivery back from
// discharge, the routes that apply to it, and the read-only judgment that status, Ready and the administrative close share with the
// creation gate, which judges through the same establishAccounting and judgeCompletion.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { RunError, requireSharedBound } = require('./errors');
const { isClosed } = require('./statuses');

const DISCHARGED = 'discharged';
const HELD = 'held';
const UNAUTHENTICATED = 'unauthenticated';
const UNAVAILABLE = 'unavailable';

const CLOSE_ROUTE = 'Any session can drop it through the administrative close on the user\'s authority: run the migration entry\'s close-manifest for it, present that manifest and run close with the user\'s reply and reason';
const BUG = 'A modern record with unreadable evidence has no administrative route';

function resourceLimit(error) {
  return error?.limitExceeded === true || ['progress-history-limit', 'migration-evidence-bound', 'migration-target-bound'].includes(error?.code);
}

// A cause that is not closing work: `evidence` makes the outcome unauthenticated, `accounting` and `bound` unavailable.
function cause(kind, subject, message, code = null) {
  return { kind, concern: kind, subject, message, needs: [], ...(code ? { code } : {}) };
}

// The cause a thrown refusal stands for: a bound whenever it is a resource limit, otherwise `fallback`.
function causeOf(error, fallback) {
  return cause(resourceLimit(error) ? 'bound' : fallback, null, error?.message ?? String(error), error?.code ?? null);
}

function judgment(causes) {
  const kinds = new Set(causes.map(entry => entry.kind));
  const outcome = kinds.has('accounting') || kinds.has('bound') ? UNAVAILABLE : kinds.has('evidence') ? UNAUTHENTICATED : kinds.has('work') ? HELD : DISCHARGED;

  return { outcome, causes };
}

// Why the owner cannot discharge a held delivery itself, or null while it can: runtime mutations reach only the current selection, a
// reopened task cannot be unblocked on a complete record, a passed deadline refuses every closing-record action and a spent dispatch
// allowance refuses only a new dispatch. Worker reconciliation is bookkeeping, which neither limit refuses.
function ownerBlocked(state, { causes }, { current, now }) {
  if (!current) return 'only the current selection can be changed by its owner';
  if (causes.some(entry => entry.needs.includes('unroutable'))) return 'a task reopened after completion cannot be unblocked on a complete record';
  const deadline = state.limits?.deadlineUtc;
  if (deadline && now >= Date.parse(deadline) && causes.some(entry => entry.needs.includes('closing'))) return 'the run deadline has passed, which refuses every closing-record action';
  const max = state.limits?.maxDispatches;
  if (max !== undefined && (state.dispatches ?? 0) >= max && causes.some(entry => entry.needs.includes('dispatch'))) return 'the dispatch allowance is spent and the hold needs a new dispatch';

  return null;
}

// The routes that apply to a delivery now, from its outcome and saved state: `owner`, `close`, `recovery`, or `none` naming the close
// eligibility refusal (`closeRefusal`, {code, message}) that leaves no route until it is resolved. `ownerUnavailable` says why a held
// delivery has no owner route.
function routes(state, value, { current = false, now = Date.now(), closeRefusal = null } = {}) {
  if (value.outcome === UNAVAILABLE) {
    const accounting = value.causes.some(entry => entry.kind === 'accounting');

    return { list: [{ route: 'recovery', message: accounting ? 'Consult migration inventory, which classifies it, and restore its accounting evidence; close refuses it with close-accounting-unavailable until then' : 'Inspect it with raw-inspect or restore store capacity; close refuses it until it fits its bounds' }], ownerUnavailable: 'its judgment is unavailable' };
  }
  if (![HELD, UNAUTHENTICATED].includes(value.outcome)) return { list: [], ownerUnavailable: null };
  const blocked = value.outcome === HELD ? ownerBlocked(state, value, { current, now }) : 'its evidence could not be authenticated';
  const list = [];
  if (!blocked) list.push({ route: 'owner', message: 'The owning session finishes the closing work: rerun each closing check until it passes, settle the closing findings and closures, reconcile its workers and obtain a fresh complete closing docs review' });
  if (closeRefusal) list.push({ route: 'none', code: closeRefusal.code, message: closeRefusal.message, ...(closeRefusal.bug ? { bug: closeRefusal.bug } : {}) });
  else list.push({ route: 'close', message: CLOSE_ROUTE });

  return { list, ownerUnavailable: blocked };
}

function describe(id, value, { list, ownerUnavailable }, { provisional = false } = {}) {
  const verb = value.outcome === UNAUTHENTICATED ? 'unauthenticated (its evidence could not be authenticated)' : value.outcome;
  const causes = value.causes.map(entry => entry.message).join('; ');
  const owner = ownerUnavailable && value.outcome === HELD ? ` No owner route: ${ownerUnavailable}.` : '';
  const named = list.map(entry => (entry.route === 'none' ? `none until ${entry.code} is resolved: ${entry.message}` : `${entry.route}: ${entry.message}`)).join('; ');

  return `Delivery ${id} is ${verb}: ${causes}.${owner} Routes${provisional ? ' (provisional until the record is read in full)' : ''}: ${named || 'none'}.`;
}

// The status brief's reading of a judged delivery: its outcome, causes and routes, and its way forward, which is never null while it
// is held or unauthenticated.
function brief(id, value, routed) {
  return {
    outcome: value.outcome,
    causes: value.causes.map(({ kind, concern, subject, message, code }) => ({ kind, concern, subject, message, ...(code ? { code } : {}) })),
    routes: routed.list,
    ownerUnavailable: routed.ownerUnavailable,
    next: value.outcome === DISCHARGED ? null : describe(id, value, routed),
  };
}

// The refusal close gives for an unreadable referenced evidence body, naming the tracked bug.
function unreadableRefusal(error) {
  return { code: error.code, message: `${error.message}; close saves through the ordinary read, which needs every referenced evidence body, so this record has no administrative route in this release (tracked as the bug "${BUG}")`, bug: BUG };
}

// Opens the delivery store read-only, or returns null when it is absent.
function openStore(root) {
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000');

  return db;
}

// Judges complete, unretired deliveries read-only, writing nothing, through the creation gate's own accounting and completion checks.
// `ids` limits the judgment to those records; `shared` charges every record to one input allowance, as a creation pass does, and
// stops at its end with `shortfall` set, leaving the rest unjudged; otherwise each record gets an allowance of its own. A nonselected
// record carrying a current settled-record verdict reads discharged without being judged. Returns {byId, shortfall}, where each entry
// is {retired: true}, or {judgment, verdicted?}.
function readOutcomes(db, root, { ids = null, shared = false } = {}) {
  const consistency = require('./creation-consistency');
  const verdicts = require('./settled-verdicts');
  const { schemaState, retirementRows, MAX_DELIVERY_RECORDS } = require('./legacy-store');
  const { HistoryReader } = require('./history-store');
  const { ProgressStore } = require('./progress-store');
  const { ProvenanceStore } = require('./provenance-store');
  const progress = require('./progress');
  const byId = new Map();
  let shortfall = false;
  db.exec('BEGIN');
  try {
    const tables = schemaState(db).tables;
    const retired = new Set(retirementRows(db, tables).map(row => row.runId));
    const selected = tables.has('active') ? db.prepare('SELECT id FROM active LIMIT 1').get()?.id ?? null : null;
    const saved = verdicts.protectionState(db) === 'own' ? verdicts.readVerdicts(db, MAX_DELIVERY_RECORDS) : null;
    const store = { db, root, kind: 'delivery' };
    const accounting = new ProgressStore(store);
    const provenance = new ProvenanceStore(accounting);
    const fresh = () => {
      const tracker = { bytes: 0, reserved: 0 };
      const chargeInput = body => {
        const next = tracker.bytes + Buffer.byteLength(body);
        requireSharedBound(next + tracker.reserved <= consistency.BOUNDS.input, 'delivery-consistency-unavailable', 'Delivery consistency input exceeds its byte bound');
        tracker.bytes = next;
      };
      tracker.chargeInput = chargeInput;
      tracker.remainingInput = () => consistency.BOUNDS.input - tracker.bytes - tracker.reserved;
      return tracker;
    };
    let tracker = fresh();
    const rows = db.prepare('SELECT id, state FROM runs ORDER BY id').all().filter(row => !ids || ids.includes(row.id));
    for (const row of rows) {
      const state = JSON.parse(row.state);
      if (state.status !== 'complete' || isClosed(state) || (state.kind ?? 'delivery') !== 'delivery') continue;
      if (retired.has(state.id)) {
        byId.set(state.id, { retired: true });
        continue;
      }
      const verdict = saved?.byRun.get(state.id);
      if (state.id !== selected && verdict?.wellFormed && verdict.current && verdicts.matches(verdict, verdicts.metadataOf(db, tables, state.id), null)) {
        byId.set(state.id, { judgment: judgment([]), verdicted: true });
        continue;
      }
      if (!shared) tracker = fresh();
      try {
        byId.set(state.id, { judgment: judgeStored({ db, tables, accounting, provenance, state, row, tracker, selected: state.id === selected, consistency, progress, HistoryReader }) });
      } catch (error) {
        if (error.sharedAllowance && shared) {
          shortfall = true;
          break;
        }
        if (error.sharedAllowance) {
          byId.set(state.id, { judgment: judgment([cause('bound', null, error.message, error.code)]) });
          continue;
        }
        throw error;
      }
    }
  } finally { db.exec('ROLLBACK'); }

  return { byId, shortfall };
}

function judgeStored({ db, tables, accounting, provenance, state, row, tracker, selected, consistency, progress, HistoryReader }) {
  if (!['artifacts', 'accounting_commits', 'discharge_index'].every(table => tables.has(table))) return judgment([cause('accounting', null, 'The delivery store lacks the accounting tables, so this record has no independent accounting')]);
  const history = new HistoryReader(db, state.id);
  const latest = history.meta(state.revision)?.bytes;
  if (latest === undefined) return judgment([cause('accounting', null, 'Its current state lacks matching history')]);
  const stateBytes = Buffer.byteLength(row.state);
  if (selected && stateBytes + latest > consistency.BOUNDS.input) return judgment([cause('bound', null, `Selected delivery ${state.id} current and latest-history input exceeds its bound`)]);
  tracker.chargeInput(row.state);
  requireSharedBound(latest <= tracker.remainingInput(), 'delivery-consistency-unavailable', 'Current delivery history exceeds its read bound');
  const historical = history.text(state.revision, tracker.remainingInput());
  if (!historical) return judgment([cause('accounting', null, 'Its latest history row cannot be read')]);
  tracker.chargeInput(historical.state);
  const latestState = JSON.parse(historical.state);
  if (progress.encodedHash(latestState) !== progress.encodedHash(state)) return judgment([cause('accounting', null, 'Its current state contradicts its committed state')]);
  const budget = { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeArtifacts: true, sharedInput: true, chargeInput: tracker.chargeInput, remainingInput: tracker.remainingInput };
  let established;
  try { established = consistency.establishAccounting(accounting, provenance, state, budget); }
  catch (error) {
    if (error.sharedAllowance || !(error instanceof RunError)) throw error;

    return judgment([causeOf(error, 'accounting')]);
  }
  if (established.legacy) return judgment([cause('accounting', null, `Its accounting replay is unavailable (${established.legacy})`)]);
  if (!established.account) return judgment([cause('accounting', null, 'Its accounting cannot be established')]);
  const evidence = { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeInput: tracker.chargeInput, remainingInput: tracker.remainingInput };

  return consistency.judgeCompletion({ db, accounting, provenance, history, state, budget, evidence, convert: true });
}

// One complete delivery's outcome, judged alone, or null for a record that gets none (not a complete delivery) and {retired: true}
// for a retired one.
function outcomeOf(root, id) {
  const db = openStore(root);
  if (!db) return null;
  try { return readOutcomes(db, root, { ids: [id] }).byId.get(id) ?? null; }
  finally { db.close(); }
}

module.exports = { BUG, DISCHARGED, HELD, UNAUTHENTICATED, UNAVAILABLE, brief, cause, causeOf, describe, judgment, openStore, outcomeOf, readOutcomes, routes, unreadableRefusal };
