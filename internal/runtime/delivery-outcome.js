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
const MISSING_TABLES = 'The delivery store lacks the accounting tables, so this record has no independent accounting';
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

// Why the owner cannot discharge a held delivery itself, as {reason}, or null while it can: runtime mutations reach only the current
// selection, and a reopened task cannot be unblocked on a complete record. Whether the run's limits or Git will refuse some of the
// owner's work is not inferred: the route notes that they may, and the owner's own actions decide it.
function ownerBlocked({ causes }, { current }) {
  if (!current) return { reason: 'only the current selection can be changed by its owner' };
  if (causes.some(entry => entry.needs.includes('unroutable'))) return { reason: 'a task reopened after completion cannot be unblocked on a complete record' };

  return null;
}

const LIMITS_NOTE = 'The run\'s deadline and dispatch allowance, and the working Git checkout an assessment dispatch needs, may refuse some of that work; the owner\'s own actions decide whether they do';

// The owner's closing work named from the hold's causes, so the route never prescribes an action no cause needs.
function ownerWork(causes) {
  const concerns = new Set(causes.map(entry => entry.concern));
  const steps = [
    ...(causes.some(entry => entry.needs.includes('rerun')) ? ['rerun each failed or pending closing check until it passes'] : []),
    ...(concerns.has('finding') || concerns.has('closure') ? ['settle the closing findings and closures'] : []),
    ...(concerns.has('worker') ? ['reconcile its workers'] : []),
    ...(causes.some(entry => entry.needs.includes('review')) || concerns.has('review') ? ['obtain a fresh complete closing docs review'] : []),
  ];
  const work = steps.length > 0 ? steps : ['settle what the causes name'];

  return work.length === 1 ? work[0] : `${work.slice(0, -1).join(', ')} and ${work.at(-1)}`;
}

// The routes that apply to a delivery now, from its outcome and saved state: `owner`, `close`, `recovery`, or `none` naming the close
// eligibility refusal (`closeRefusal`, {code, message}) that leaves no route until it is resolved. `ownerUnavailable` says why a held
// delivery has no owner route.
function routes(state, value, { current = false, closeRefusal = null } = {}) {
  if (value.outcome === UNAVAILABLE) {
    const accounting = value.causes.some(entry => entry.kind === 'accounting');

    return { list: [{ route: 'recovery', message: accounting ? `${require('./close').accountingRemedy('complete', { saved: false }).replace(/^consult/, 'Consult')}; close refuses it with close-accounting-unavailable until then` : 'Inspect it with raw-inspect or restore store capacity; close refuses it with close-judgment-unavailable until it fits its bounds' }], ownerUnavailable: 'its judgment is unavailable' };
  }
  if (![HELD, UNAUTHENTICATED].includes(value.outcome)) return { list: [], ownerUnavailable: null };
  const blocked = value.outcome === HELD ? ownerBlocked(value, { current }) : { reason: 'its evidence could not be authenticated' };
  const list = [];
  if (!blocked) list.push({ route: 'owner', message: `The owning session finishes the closing work: ${ownerWork(value.causes)}. ${LIMITS_NOTE}` });
  if (closeRefusal) list.push({ route: 'none', code: closeRefusal.code, message: closeRefusal.message, ...(closeRefusal.bug ? { bug: closeRefusal.bug } : {}) });
  else list.push({ route: 'close', message: CLOSE_ROUTE });

  return { list, ownerUnavailable: blocked?.reason ?? null };
}

function describe(id, value, { list, ownerUnavailable }) {
  const verb = value.outcome === UNAUTHENTICATED ? 'unauthenticated (its evidence could not be authenticated)' : value.outcome;
  const causes = value.causes.map(entry => entry.message).join('; ');
  const owner = ownerUnavailable && value.outcome === HELD ? ` No owner route: ${ownerUnavailable}.` : '';
  const named = list.map(entry => (entry.route === 'none' ? `none until ${entry.code} is resolved: ${entry.message}` : `${entry.route}: ${entry.message}`)).join('; ');

  return `Delivery ${id} is ${verb}: ${causes}.${owner} Routes: ${named || 'none'}.`;
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

// The routes that apply to a delivery, which status alone computes, together with the saved workers' close verdict that qualifies them:
// a held or unauthenticated delivery whose workers the shared adoption-eligibility check refuses names that refusal in place of the
// close route. `verdict` is null for any other outcome.
function routesFor(state, value, { current = false, dependencies = {} } = {}) {
  const verdict = [HELD, UNAUTHENTICATED].includes(value.outcome) ? require('./close').closeVerdict(state, dependencies, value) : null;
  const closeRefusal = verdict && !verdict.eligible ? { code: verdict.code, message: verdict.message } : null;

  return { routed: routes(state, value, { current, closeRefusal }), verdict };
}

// Opens the delivery store read-only, or returns null when it is absent.
function openStore(root) {
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly: true });
  db.exec('PRAGMA busy_timeout=5000');

  return db;
}

// The creation gate's runtime pieces over one connection, loaded lazily since the gate requires this module.
function context(db, root) {
  const { requireAccountingTables, schemaState } = require('./legacy-store');
  const { ProgressStore } = require('./progress-store');
  const { ProvenanceStore } = require('./provenance-store');
  const accounting = new ProgressStore({ db, root, kind: 'delivery' });
  const { tables } = schemaState(db);
  requireAccountingTables(db, tables);

  return { db, tables, accounting, provenance: new ProvenanceStore(accounting) };
}

// The input a creation pass reserves up front for the selection: its current state and latest history row.
function reservation(env, selected) {
  const metadata = selected ? require('./settled-verdicts').metadataOf(env.db, env.tables, selected) : null;

  return metadata ? metadata.stateBytes + (metadata.latestBytes ?? 0) : 0;
}

// An input allowance like the creation pass's: `reserved` bytes stay set aside, as the pass reserves the selection's current state and
// latest row, until `release` charges them.
function allowance(reserved = 0) {
  const { BOUNDS } = require('./creation-consistency');
  const tracker = { bytes: 0, reserved };
  tracker.chargeInput = body => {
    const next = tracker.bytes + Buffer.byteLength(body);
    requireSharedBound(next + tracker.reserved <= BOUNDS.input, 'delivery-consistency-unavailable', 'Delivery consistency input exceeds its byte bound');
    tracker.bytes = next;
  };
  tracker.release = bytes => { tracker.reserved = Math.max(0, tracker.reserved - bytes); };
  tracker.remainingInput = () => BOUNDS.input - tracker.bytes - tracker.reserved;

  return tracker;
}

// Reads a record's current state and latest history row as the creation pass does, charging both to `tracker`: the shared rollback
// and agreement checks, and for the selection, its own reserved bound. Returns {state, history, historical} or {problem}, a cause.
function readCurrent(env, row, tracker, selected) {
  const consistency = require('./creation-consistency');
  const { HistoryReader } = require('./history-store');
  const state = JSON.parse(row.state);
  if (state.revision !== row.revision) return { problem: cause('accounting', null, 'Its stored revision contradicts its saved state') };
  const rolledBack = consistency.rollbackProblem(env.db, env.tables, state);
  if (rolledBack) return { problem: cause('accounting', null, rolledBack) };
  const history = new HistoryReader(env.db, state.id);
  const latest = history.meta(state.revision)?.bytes;
  if (latest === undefined) return { problem: cause('accounting', null, 'Its current state lacks matching history') };
  const stateBytes = Buffer.byteLength(row.state);
  if (selected && stateBytes + latest > consistency.BOUNDS.input) return { problem: cause('bound', null, `Selected delivery ${state.id} current and latest-history input exceeds its bound`) };
  if (selected) tracker.release(stateBytes + latest);
  tracker.chargeInput(row.state);
  requireSharedBound(latest <= tracker.remainingInput(), 'delivery-consistency-unavailable', 'Current delivery history exceeds its read bound');
  const historical = history.text(state.revision, tracker.remainingInput());
  if (!historical) return { problem: cause('accounting', null, 'Its latest history row cannot be read') };
  tracker.chargeInput(historical.state);
  const contradicted = consistency.agreementProblem(state, JSON.parse(historical.state));
  if (contradicted) return { problem: cause('accounting', null, contradicted) };

  return { state, history, historical };
}

function accountingBudget(tracker) {
  const progress = require('./progress');

  return { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeArtifacts: true, sharedInput: true, chargeInput: tracker.chargeInput, remainingInput: tracker.remainingInput };
}

// Establishes a record's accounting as the gate requires, or returns the cause that leaves it unavailable.
function establish(env, state, budget) {
  try {
    const established = require('./creation-consistency').establishAccounting(env.accounting, env.provenance, state, budget);
    if (established.legacy) return { problem: cause('accounting', null, `Its accounting replay is unavailable (${established.legacy})`) };
    if (established.unavailable) return { problem: cause('accounting', null, established.unavailable) };
    if (!established.account) return { problem: cause('accounting', null, 'Its accounting cannot be established') };

    return { established };
  } catch (error) {
    if (error.sharedAllowance || !(error instanceof RunError)) throw error;

    return { problem: causeOf(error, 'accounting') };
  }
}

function judgeStored(env, row, tracker, selected) {
  if (!['artifacts', 'accounting_commits', 'discharge_index'].every(table => env.tables.has(table))) return judgment([cause('accounting', null, MISSING_TABLES)]);
  const current = readCurrent(env, row, tracker, selected);
  if (current.problem) return judgment([current.problem]);
  const budget = accountingBudget(tracker);
  const accounted = establish(env, current.state, budget);
  if (accounted.problem) return judgment([accounted.problem]);
  const progress = require('./progress');
  const evidence = { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeInput: tracker.chargeInput, remainingInput: tracker.remainingInput };

  return require('./creation-consistency').judgeCompletion({ db: env.db, accounting: env.accounting, provenance: env.provenance, history: current.history, state: current.state, budget, evidence, convert: true });
}

// Judges complete, unretired deliveries read-only, writing nothing, through the creation gate's own record, accounting and completion
// checks. `ids` limits the judgment to those records, reading only their rows; `shared` charges every record to one input allowance
// with the selection's current state and latest row reserved, as a creation pass does, and stops at its end with `shortfall` set,
// leaving the rest unjudged; otherwise each record gets an allowance of its own. A nonselected record carrying a current settled-record
// verdict reads discharged without being judged. `inTransaction` says the caller already holds the read transaction, so every row it
// read belongs to the same snapshot. Returns {byId, shortfall}, where each entry is {retired: true} or {judgment, verdicted?}.
function readOutcomes(db, root, { ids = null, shared = false, inTransaction = false } = {}) {
  const verdicts = require('./settled-verdicts');
  const { retirementRows, MAX_DELIVERY_RECORDS } = require('./legacy-store');
  const byId = new Map();
  let shortfall = false;
  if (!inTransaction) db.exec('BEGIN');
  try {
    const env = context(db, root);
    const retired = new Set(retirementRows(db, env.tables).map(row => row.runId));
    const selected = env.tables.has('active') ? db.prepare('SELECT id FROM active LIMIT 1').get()?.id ?? null : null;
    const saved = verdicts.protectionState(db) === 'own' ? verdicts.readVerdicts(db, MAX_DELIVERY_RECORDS) : null;
    // A selection past the bound on its own is its Unavailable outcome, so it reserves nothing; the shared scan judges it first, so
    // its own bound is never mistaken for a pass-level shortfall.
    const reserved = shared ? reservation(env, selected) : 0;
    let tracker = allowance(reserved <= require('./creation-consistency').BOUNDS.input ? reserved : 0);
    const everyRow = () => {
      const ordered = db.prepare('SELECT id, revision, state FROM runs ORDER BY id').all();
      return [...ordered.filter(row => row.id === selected), ...ordered.filter(row => row.id !== selected)];
    };
    const rows = ids ? ids.map(id => db.prepare('SELECT id, revision, state FROM runs WHERE id=?').get(id)).filter(Boolean) : everyRow();
    for (const row of rows) {
      const state = JSON.parse(row.state);
      if (state.status !== 'complete' || isClosed(state) || (state.kind ?? 'delivery') !== 'delivery') continue;
      if (retired.has(state.id)) {
        byId.set(state.id, { retired: true });
        continue;
      }
      const verdict = saved?.byRun.get(state.id);
      if (state.id !== selected && verdict?.wellFormed && verdict.current && verdicts.matches(verdict, verdicts.metadataOf(db, env.tables, state.id), null)) {
        byId.set(state.id, { judgment: judgment([]), verdicted: true });
        continue;
      }
      if (!shared) tracker = allowance();
      // The judgment of one record is total: any failure of its own reads is its Unavailable outcome, and only running out of the
      // allowance shared across a pass is a pass-level shortfall.
      try {
        byId.set(state.id, { judgment: judgeStored(env, row, tracker, state.id === selected) });
      } catch (error) {
        if (error.sharedAllowance && shared) {
          shortfall = true;
          break;
        }
        byId.set(state.id, { judgment: judgment([causeOf(error, error.sharedAllowance ? 'bound' : 'accounting')]) });
      }
    }
  } finally {
    if (!inTransaction) db.exec('ROLLBACK');
  }

  return { byId, shortfall };
}

// One complete delivery's outcome, judged alone, or null for a record that gets none (not a complete delivery) and {retired: true}
// for a retired one.
function outcomeOf(root, id) {
  const db = openStore(root);
  if (!db) return null;
  try { return readOutcomes(db, root, { ids: [id] }).byId.get(id) ?? null; }
  finally { db.close(); }
}

module.exports = { BUG, DISCHARGED, HELD, MISSING_TABLES, UNAUTHENTICATED, UNAVAILABLE, brief, cause, causeOf, describe, judgment, openStore, outcomeOf, readOutcomes, routes, routesFor, unreadableRefusal };
