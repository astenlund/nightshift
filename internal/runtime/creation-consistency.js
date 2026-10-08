'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { requireCondition } = require('./errors');
const { recordKind } = require('./records');
const progress = require('./progress');
const { ProgressStore } = require('./progress-store');
const { ProvenanceStore } = require('./provenance-store');

const MAX_RECORDS = 10000;
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const TABLES = ['runs', 'active', 'history', 'artifacts', 'accounting_commits', 'discharge_index'];
const CODE = 'delivery-consistency-unavailable';

// A handed-over delivery's morning report stays owed to its recipient until report-delivered binds that exact report.
function reportAwaitsRecipient(state) {
  const report = state.closing?.reportEvidence;

  return Boolean(state.handover) && !(report && state.closing.reportDelivery?.sha256 === report.sha256);
}

// A completion discharges the closing record as it stood then. A record opened after it, by renewed triage or a closing reset, stays
// undischarged until the delivery completes again. The latest invocation of each named closing check recorded on the same record after
// completion must match the latest closing assessment by revision, the one historical discharge qualifies and orders repairs against: it must be a fresh, strong,
// independent and complete docs assessment whose snapshot holds the content of every file the check recorded. An older assessment
// never stands in, so restored content a superseded assessment saw stays uncovered, while a check of content the latest one saw adds
// no debt whether recorded before or after it. Findings, repairs, closures and check results stay with historical discharge, and
// files changed without recorded closing work are later drift that keeps the completion. resolve turns a stored snapshot reference
// into its {files} content.
function closingDischargedSince(current, completed, resolve) {
  const now = current.closing?.docs ?? null;
  const then = completed.closing?.docs ?? null;
  if ((now?.occurrence ?? null) !== (then?.occurrence ?? null)) return false;
  if (isDeepStrictEqual(now, then)) return true;
  if (!now || !then) return false;
  const identity = check => check.attemptId ?? JSON.stringify(check);
  const earlierChecks = new Set(then.checks.map(identity));
  // As the lifecycle's check gates do, a later invocation of a named check supersedes an earlier one.
  const later = [...new Map(now.checks.map(check => [check.name, check])).values()].filter(check => !earlierChecks.has(identity(check)));
  if (later.length === 0) return true;
  const { DIMENSIONS, completeAssessment } = require('./lifecycle');
  const latest = now.reviews.reduce((found, review) => (!found || review.revision > found.revision ? review : found), null);
  if (!(latest?.kind === 'docs' && completeAssessment(latest) && latest.attributionVerified === true && DIMENSIONS.docs.every(dimension => latest.dimensions?.includes(dimension)))) return false;
  const seen = new Map(resolve(latest.snapshot).files.map(file => [file.path, file.sha256 ?? null]));
  const absent = sha256 => sha256 === null || sha256 === undefined;

  return later.every(check => resolve(check.snapshot).files.every(file => (absent(file.sha256) ? absent(seen.get(file.path)) : seen.get(file.path) === file.sha256)));
}

function assessment(store) {
  requireCondition(store.writing && store.kind === 'delivery', CODE, 'Delivery consistency requires its current transaction');
  let inputBytes = 0;
  const chargeInput = body => {
    inputBytes += Buffer.byteLength(body);
    requireCondition(inputBytes <= MAX_INPUT_BYTES, CODE, 'Delivery consistency input exceeds its byte bound');
  };
  const budget = { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeInput };
  const parse = body => {
    chargeInput(body);
    return JSON.parse(body);
  };
  const rows = store.db.prepare('SELECT id, revision, state FROM runs LIMIT ?').all(MAX_RECORDS + 1);
  requireCondition(rows.length <= MAX_RECORDS, CODE, 'Delivery identity inventory exceeds its bound');
  const selections = store.db.prepare('SELECT id FROM active LIMIT 2').all();
  if (!rows.length) {
    requireCondition(TABLES.every(table => !store.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()), 'missing-predecessor', 'Known delivery evidence is not empty-store creation');
    return { current: null, replaceable: true };
  }
  requireCondition(selections.length === 1 && rows.some(row => row.id === selections[0].id), 'missing-predecessor', 'Delivery selection is absent or dangling');
  const ids = new Set(rows.map(row => row.id));
  for (const table of ['history', 'accounting_commits', 'discharge_index']) requireCondition(!store.db.prepare(`SELECT 1 FROM ${table} evidence LEFT JOIN runs saved ON saved.id=evidence.run_id WHERE saved.id IS NULL LIMIT 1`).get(), 'missing-predecessor', 'Surviving delivery evidence has no stored owner');
  const artifactStats = store.db.prepare('SELECT count(*) AS count, coalesce(sum(length(cast(body AS BLOB))), 0) AS bytes FROM artifacts').get();
  requireCondition(artifactStats.count <= progress.MAX_CREDITS && artifactStats.bytes <= MAX_INPUT_BYTES - inputBytes, CODE, 'Artifact identity scan exceeds its bound');
  for (const artifact of store.db.prepare('SELECT id, body FROM artifacts').iterate()) {
    const value = parse(artifact.body);
    if (value && typeof value === 'object' && Object.hasOwn(value, 'runId')) {
      requireCondition(typeof value.runId === 'string' && ids.has(value.runId) && createHash('sha256').update(artifact.body).digest('hex') === artifact.id, CODE, 'Run-bound artifact has an unknown owner or corrupt identity');
    }
  }
  const accounting = new ProgressStore(store);
  const provenance = new ProvenanceStore(accounting);
  const records = [];
  const acceptances = new Set();
  for (const row of rows) {
    const state = parse(row.state);
    requireCondition(state?.schema === 1 && typeof state.id === 'string' && state.id.length > 0 && state.id === row.id && state.root === store.root && recordKind(state) === 'delivery' && state.revision === row.revision && Number.isSafeInteger(row.revision) && row.revision >= 0 && ['running', 'stopped', 'complete'].includes(state.status) && ['claude', 'codex'].includes(state.controller?.host) && typeof state.controller.session === 'string' && state.controller.session.length > 0 && Array.isArray(state.tasks) && Array.isArray(state.workers), CODE, 'Delivery identity, shape or revision is unsupported');
    const latest = store.db.prepare('SELECT max(revision) AS revision FROM history WHERE run_id=?').get(state.id);
    const journal = store.db.prepare('SELECT max(revision) AS revision FROM accounting_commits WHERE run_id=?').get(state.id);
    requireCondition(latest.revision === state.revision && (journal.revision === null || journal.revision === state.revision), CODE, 'Current delivery was rolled back behind surviving revision evidence');
    const historical = store.db.prepare('SELECT state FROM history WHERE run_id=? AND revision=?').get(state.id, state.revision);
    requireCondition(historical && progress.encodedHash(parse(historical.state)) === progress.encodedHash(state), CODE, 'Current delivery contradicts its committed substantive state');
    const acceptance = state.acceptance?.handoverId;
    if (acceptance !== undefined && acceptance !== null) {
      requireCondition(typeof acceptance === 'string' && !acceptances.has(acceptance), CODE, 'Acceptance identity is ambiguous');
      acceptances.add(acceptance);
    }
    const independent = provenance.read(state, budget);
    let discharged = false;
    let closingOpen = false;
    let account = null;
    if (independent?.status === 'current') {
      const restored = { ...state, progress: independent.marker };
      if (independent.reminder) restored.stopRecovery = independent.reminder;
      else delete restored.stopRecovery;
      account = accounting.checkpoint(restored, budget);
      provenance.verify(state, budget);
    } else if (independent === null && ['complete', 'stopped'].includes(state.status)) {
      // A delivery saved by an earlier release, without schema-2 accounting, is judged by bounded replay from its creation; a
      // schema-2 record without independent provenance has lost it. Recovery that cannot be established refuses creation rather
      // than counting the delivery discharged.
      account = accounting.read(state, budget);
    }
    if (account) {
      requireCondition(account.marker.status === 'current', CODE, 'Delivery accounting is unavailable');
      const completion = store.db.prepare("SELECT revision, state FROM history WHERE run_id=? AND kind='complete' ORDER BY revision DESC LIMIT 1").get(state.id);
      if (completion) {
        const completed = parse(completion.state);
        requireCondition(completed.id === state.id && completed.revision === completion.revision && completed.status === 'complete', CODE, 'Recorded completion identity is contradictory');
        provenance.read(completed, budget);
        const snapshotValid = (value, empty = false) => {
          const resolved = accounting.resolve(value, budget);
          if (Array.isArray(resolved?.files) && resolved.files.length === 0) return empty && resolved.digest === createHash('sha256').update('[]').digest('hex');
          progress.snapshotIdentity(resolved);
          return true;
        };
        const target = value => ({ ...value, checks: value.checks.map(check => ({ ...check, snapshot: accounting.resolve(check.snapshot, budget) })), reviews: value.reviews.map(review => ({ ...review, snapshot: accounting.resolve(review.snapshot, budget) })), ...(value.docsExemption ? { docsExemption: { ...value.docsExemption, snapshot: accounting.resolve(value.docsExemption.snapshot, budget) } } : {}) });
        const historicalState = { ...state, tasks: state.tasks.map(target), closing: { ...state.closing, ...(state.closing?.docs ? { docs: { ...target(state.closing.docs), baseline: accounting.resolve(state.closing.docs.baseline, budget) } } : {}) } };
        closingOpen = !closingDischargedSince(state, completed, value => accounting.resolve(value, budget));
        discharged = !closingOpen && require('./lifecycle').historicalDischarge(historicalState, snapshotValid);
      }
    }
    records.push({ state, discharged, closingOpen });
  }
  const selected = records.find(record => record.state.id === selections[0].id);
  requireCondition(selected && records.every(record => record === selected || record.discharged), CODE, 'Another surviving delivery still has unresolved or unavailable obligations');
  // Closing work recorded after the selected completion is unfinished work to reconcile, not a contradiction in its evidence.
  requireCondition(selected.state.status !== 'complete' || selected.discharged || selected.closingOpen, CODE, 'Selected completion lacks authenticated lifecycle discharge');
  // Replacement would detach the selected delivery's unconfirmed report from its notice and confirmation route. A delivery
  // replaced under an earlier release has no such route left, so only the selected one can hold replacement back.
  const reportPending = selected.discharged && reportAwaitsRecipient(selected.state);

  return { current: selected.state, replaceable: selected.discharged && !reportPending, reportPending };
}

function creationAssessment(store) {
  try { return assessment(store); }
  catch (error) {
    if (error.code === 'missing-predecessor' || error.code === CODE) throw error;
    requireCondition(false, CODE, 'Delivery consistency cannot be established: ' + error.message);
  }
}

module.exports = { closingDischargedSince, creationAssessment };
