'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { RunError, requireBound, requireCondition } = require('./errors');
const { recordKind } = require('./records');
const { MAX_EXPANDED_BYTES, hydrateArtifact } = require('./artifact-hydration');
const { validReportDelivery } = require('./report-delivery');
const { workerIsActive } = require('./workers');
const progress = require('./progress');
const { ProgressStore } = require('./progress-store');
const { ProvenanceStore } = require('./provenance-store');
const { validateCertificate, MAX_CERTIFICATE_CHAIN_BYTES, MAX_HISTORICAL_BYTES, MAX_MANIFEST_CHAIN_BYTES } = require('./legacy-certificates');
const { MAX_ARTIFACT_ID_BYTES, MAX_DELIVERY_RECORDS: MAX_RECORDS, MAX_RUN_ID_BYTES, isRetirementCertificate, retirementRows, schemaState, verifyTriggers } = require('./legacy-store');

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const TABLES = ['runs', 'active', 'history', 'artifacts', 'accounting_commits', 'discharge_index'];
const CODE = 'delivery-consistency-unavailable';

// A handed-over delivery's morning report stays owed to its recipient until report-delivered binds that exact report.
function reportAwaitsRecipient(state) {
  const report = state.closing?.reportEvidence;

  return Boolean(state.handover) && !validReportDelivery(state, report?.sha256);
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

function legacyRefusal(records) {
  const grouped = new Map();
  for (const record of records) {
    const key = `${record.status}:${record.reason}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record.id);
  }
  const details = [...grouped.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([reason, ids]) => `${reason} (${ids.length}): ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ` and ${ids.length - 10} more` : ''}`);

  return `Legacy delivery consistency is unavailable for ${records.length} record(s): ${details.join('; ')}. Inspect completed or stopped records with migration inventory; reconcile running work directly`;
}

function resourceLimit(error) {
  return error.limitExceeded === true || ['progress-history-limit', 'migration-evidence-bound', 'migration-target-bound'].includes(error.code);
}

function assessment(store, options = {}) {
  requireCondition(store.writing && store.kind === 'delivery', CODE, 'Delivery consistency requires its current transaction');
  let inputBytes = 0;
  let mandatoryTotal = 0;
  let mandatoryCharged = 0;
  const chargeInput = (body, mandatory = false) => {
    const size = Buffer.byteLength(body);
    const next = inputBytes + size;
    const reserved = mandatoryTotal - mandatoryCharged - (mandatory ? size : 0);
    requireBound(next + reserved <= MAX_INPUT_BYTES, CODE, 'Delivery consistency input exceeds its byte bound');
    inputBytes = next;
    if (mandatory) mandatoryCharged += size;
  };
  const budget = { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeInput, remainingInput: () => MAX_INPUT_BYTES - inputBytes - (mandatoryTotal - mandatoryCharged) };
  const parse = (body, mandatory = false) => {
    chargeInput(body, mandatory);
    return JSON.parse(body);
  };
  const runStats = store.db.prepare('SELECT count(*) AS count, coalesce(sum(length(CAST(state AS BLOB))), 0) AS bytes, coalesce(max(length(CAST(id AS BLOB))), 0) AS idBytes FROM runs').get();
  requireCondition(runStats.count <= MAX_RECORDS && runStats.idBytes <= MAX_RUN_ID_BYTES, CODE, 'Delivery identity inventory exceeds its bound');
  const latestStats = store.db.prepare('SELECT count(*) AS count, coalesce(sum(length(CAST(history.state AS BLOB))), 0) AS bytes FROM runs JOIN history ON history.run_id=runs.id AND history.revision=runs.revision').get();
  mandatoryTotal = runStats.bytes + latestStats.bytes;
  if (mandatoryTotal > MAX_INPUT_BYTES) {
    const ids = store.db.prepare('SELECT id FROM runs ORDER BY id LIMIT 10').all().map(row => row.id);
    requireCondition(false, CODE, `Delivery current and latest-history input for ${runStats.count} records exceeds its bound: ${ids.join(', ')}${runStats.count > ids.length ? ` and ${runStats.count - ids.length} more` : ''}. Inspect bounded raw states or restore store capacity; migration inventory cannot fit this store`);
  }
  const rows = store.db.prepare('SELECT id, revision, state FROM runs LIMIT ?').all(MAX_RECORDS + 1);
  requireCondition(rows.length <= MAX_RECORDS, CODE, 'Delivery identity inventory exceeds its bound');
  const tables = schemaState(store.db).tables;
  const retirements = retirementRows(store.db, tables);
  verifyTriggers(store.db, tables);
  const retiredById = new Map(retirements.map(row => [row.runId, row.artifact]));
  requireCondition(retirements.length <= MAX_RECORDS && retiredById.size === retirements.length, CODE, 'Retirement reference inventory is unsupported');
  const selections = store.db.prepare('SELECT id FROM active LIMIT 2').all();
  if (!rows.length) {
    requireCondition([...TABLES, ...(tables.has('legacy_retirements') ? ['legacy_retirements'] : [])].filter(table => tables.has(table)).every(table => !store.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()), 'missing-predecessor', 'Known delivery evidence is not empty-store creation');
    return { current: null, replaceable: true };
  }
  requireCondition(selections.length === 1 && rows.some(row => row.id === selections[0].id), 'missing-predecessor', 'Delivery selection is absent or dangling');
  const ids = new Set(rows.map(row => row.id));
  requireCondition(retirements.every(row => ids.has(row.runId)), CODE, 'Retirement reference has no saved delivery');
  for (const table of ['history', 'accounting_commits', 'discharge_index'].filter(table => tables.has(table))) requireCondition(!store.db.prepare(`SELECT 1 FROM ${table} evidence LEFT JOIN runs saved ON saved.id=evidence.run_id WHERE saved.id IS NULL LIMIT 1`).get(), 'missing-predecessor', 'Surviving delivery evidence has no stored owner');
  const artifactStats = tables.has('artifacts') ? store.db.prepare('SELECT count(*) AS count, coalesce(sum(length(cast(body AS BLOB))), 0) AS bytes, coalesce(max(length(CAST(id AS BLOB))), 0) AS idBytes FROM artifacts').get() : { count: 0, bytes: 0, idBytes: 0 };
  requireCondition(artifactStats.count <= progress.MAX_CREDITS && artifactStats.bytes <= MAX_INPUT_BYTES && artifactStats.idBytes <= MAX_ARTIFACT_ID_BYTES, CODE, 'Artifact identity scan exceeds its bound');
  const retirementArtifacts = new Set();
  for (const artifact of tables.has('artifacts') ? store.db.prepare('SELECT id, body FROM artifacts').iterate() : []) {
    const value = JSON.parse(artifact.body);
    if (isRetirementCertificate(value)) retirementArtifacts.add(artifact.id);
    if (value && typeof value === 'object' && Object.hasOwn(value, 'runId')) {
      requireCondition(typeof value.runId === 'string' && ids.has(value.runId) && createHash('sha256').update(artifact.body).digest('hex') === artifact.id, CODE, 'Run-bound artifact has an unknown owner or corrupt identity');
    }
  }
  requireCondition(retirements.length > 0 || retirementArtifacts.size === 0, CODE, 'Retirement certificate artifacts have no current reference');
  const accounting = new ProgressStore(store);
  const provenance = new ProvenanceStore(accounting);
  const records = [];
  const acceptances = new Set();
  const legacyUnavailable = [];
  const certificateBudgets = { chain: { bytes: 0, maximum: MAX_CERTIFICATE_CHAIN_BYTES, visited: new Set() }, manifests: { bytes: 0, maximum: MAX_MANIFEST_CHAIN_BYTES, visited: new Set() }, history: { bytes: 0, maximum: MAX_HISTORICAL_BYTES, cache: new Map() }, targetsByManifest: new Map() };
  const retirementHydration = { bytes: 0, maximum: MAX_INPUT_BYTES, expansionMaximum: MAX_EXPANDED_BYTES, visited: new Set(), artifactsAvailable: tables.has('artifacts') };
  for (const row of rows) {
    const state = parse(row.state, true);
    requireCondition(state?.schema === 1 && typeof state.id === 'string' && state.id.length > 0 && state.id === row.id && state.root === store.root && recordKind(state) === 'delivery' && state.revision === row.revision && Number.isSafeInteger(row.revision) && row.revision >= 0 && ['running', 'stopped', 'complete'].includes(state.status) && ['claude', 'codex'].includes(state.controller?.host) && typeof state.controller.session === 'string' && state.controller.session.length > 0 && Array.isArray(state.tasks) && Array.isArray(state.workers), CODE, 'Delivery identity, shape or revision is unsupported');
    const latest = store.db.prepare('SELECT max(revision) AS revision FROM history WHERE run_id=?').get(state.id);
    const journal = tables.has('accounting_commits') ? store.db.prepare('SELECT max(revision) AS revision FROM accounting_commits WHERE run_id=?').get(state.id) : { revision: null };
    requireCondition(latest.revision === state.revision && (journal.revision === null || journal.revision === state.revision), CODE, 'Current delivery was rolled back behind surviving revision evidence');
    const historicalSize = store.db.prepare('SELECT length(CAST(state AS BLOB)) AS bytes FROM history WHERE run_id=? AND revision=?').get(state.id, state.revision)?.bytes;
    requireCondition(historicalSize !== undefined, CODE, 'Current delivery lacks matching history');
    requireBound(historicalSize <= MAX_INPUT_BYTES - inputBytes, CODE, 'Current delivery history exceeds its read bound');
    const historical = store.db.prepare('SELECT state FROM history WHERE run_id=? AND revision=? AND length(CAST(state AS BLOB))<=?').get(state.id, state.revision, MAX_INPUT_BYTES - inputBytes);
    const latestState = historical ? parse(historical.state, true) : null;
    requireCondition(latestState && progress.encodedHash(latestState) === progress.encodedHash(state) && isDeepStrictEqual(latestState.progress, state.progress) && isDeepStrictEqual(latestState.stopRecovery, state.stopRecovery), CODE, 'Current delivery contradicts its committed state');
    const acceptance = state.acceptance?.handoverId;
    if (acceptance !== undefined && acceptance !== null) {
      requireCondition(typeof acceptance === 'string' && !acceptances.has(acceptance), CODE, 'Acceptance identity is ambiguous');
      acceptances.add(acceptance);
    }
    const retired = retiredById.get(state.id);
    if (retiredById.has(state.id)) {
      hydrateArtifact(store.db, state, new Set(), retirementHydration);
      hydrateArtifact(store.db, latestState, new Set(), retirementHydration);
      try { validateCertificate(store.db, store.root, row, state, historical, retired, certificateBudgets); }
      catch (error) {
        if (!options.resourceOnly || options.requiredRetirements?.has(state.id) || resourceLimit(error) || !(error instanceof RunError)) throw error;
      }
      records.push({ state, discharged: true, closingOpen: false, retired: true });
      continue;
    }
    if (!options.resourceOnly && legacyUnavailable.length > 0) {
      if (state.progress === undefined) legacyUnavailable.push({ id: state.id, status: state.status, reason: 'replay-deferred-after-blocker' });
      records.push({ state, discharged: false, closingOpen: false });
      continue;
    }
    if (!['artifacts', 'accounting_commits', 'discharge_index'].every(table => tables.has(table))) {
      requireCondition(state.progress === undefined, CODE, `Delivery ${state.id} has unsupported accounting without its required tables`);
      legacyUnavailable.push({ id: state.id, status: state.status, reason: 'no-independent-accounting' });
      records.push({ state, discharged: false, closingOpen: false });
      continue;
    }
    if (options.resourceOnly && state.progress === undefined) {
      hydrateArtifact(store.db, state, new Set(), retirementHydration);
      hydrateArtifact(store.db, latestState, new Set(), retirementHydration);
      records.push({ state, discharged: false, closingOpen: false });
      continue;
    }
    try {
      const independent = provenance.read(state, budget);
      requireCondition(independent !== null || state.progress?.schema !== 2, CODE, `Delivery ${state.id} has schema-2 accounting without independent provenance`);
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
        try { account = accounting.read(state, budget); }
        catch (error) {
          legacyUnavailable.push({ id: state.id, status: state.status, reason: resourceLimit(error) ? 'legacy-replay-bound' : 'legacy-replay-unavailable' });
          records.push({ state, discharged: false, closingOpen: false });
          continue;
        }
      }
      if (account) {
        requireCondition(account.marker.status === 'current', CODE, 'Delivery accounting is unavailable');
        const completionRevision = store.db.prepare("SELECT revision FROM history WHERE run_id=? AND kind='complete' ORDER BY revision DESC LIMIT 1").get(state.id)?.revision;
        if (completionRevision !== undefined) {
          const completionSize = store.db.prepare('SELECT length(CAST(state AS BLOB)) AS bytes FROM history WHERE run_id=? AND revision=?').get(state.id, completionRevision)?.bytes;
          requireCondition(completionSize !== undefined, CODE, 'Completion history is missing');
          requireBound(completionSize <= budget.remainingInput(), CODE, `Delivery ${state.id} completion history exceeds the delivery read bound`);
        }
        const completion = completionRevision === undefined ? null : store.db.prepare("SELECT revision, state FROM history WHERE run_id=? AND revision=? AND kind='complete' AND length(CAST(state AS BLOB))<=?").get(state.id, completionRevision, budget.remainingInput());
        requireCondition(completionRevision === undefined || completion, CODE, `Delivery ${state.id} completion history exceeds the delivery read bound`);
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
      if (independent === null && !discharged) legacyUnavailable.push({ id: state.id, status: state.status, reason: 'discharge-unresolved' });
    } catch (error) {
      if (!options.resourceOnly && state.progress?.schema === 2 && resourceLimit(error)) requireCondition(false, CODE, `Delivery ${state.id} exceeds a verification bound: ${error.message}`);
      if (!options.resourceOnly || resourceLimit(error) || !(error instanceof RunError)) throw error;
      records.push({ state, discharged: false, closingOpen: false });
    }
  }
  if (!options.resourceOnly) requireCondition([...retirementArtifacts].every(id => certificateBudgets.chain.visited.has(id)), CODE, 'Retirement certificate artifact is outside every current reference chain');
  if (options.resourceOnly) return { inputBytes, artifactCount: artifactStats.count, artifactBytes: artifactStats.bytes };
  requireCondition(legacyUnavailable.length === 0, CODE, legacyRefusal(legacyUnavailable));
  const selected = records.find(record => record.state.id === selections[0].id);
  requireCondition(selected && records.every(record => record === selected || record.discharged), CODE, 'Another surviving delivery still has unresolved or unavailable obligations');
  // Closing work recorded after the selected completion is unfinished work to reconcile, not a contradiction in its evidence.
  requireCondition(selected.state.status !== 'complete' || selected.discharged || selected.closingOpen, CODE, 'Selected completion lacks authenticated lifecycle discharge');
  // Replacement would detach the selected delivery's unconfirmed report from its notice and confirmation route. A delivery
  // replaced under an earlier release has no such route left, so only the selected one can hold replacement back.
  const reportPending = !selected.retired && selected.discharged && reportAwaitsRecipient(selected.state);

  return { current: selected.state, replaceable: selected.discharged && !reportPending && !records.some(record => record.state.workers.some(workerIsActive)), reportPending };
}

function creationAssessment(store, options = {}) {
  try { return assessment(store, options); }
  catch (error) {
    if (error.code === 'missing-predecessor' || error.code === CODE) throw error;
    requireCondition(false, CODE, 'Delivery consistency cannot be established: ' + error.message);
  }
}

module.exports = { closingDischargedSince, creationAssessment };
