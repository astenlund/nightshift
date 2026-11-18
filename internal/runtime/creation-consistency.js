'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { RunError, requireBound, requireCondition, requireSharedBound } = require('./errors');
const { recordKind } = require('./records');
const { isClosed, isRecordStatus } = require('./statuses');
const { verificationPass, verifyArtifacts } = require('./artifact-hydration');
const { validReportDelivery } = require('./report-delivery');
const { workerIsActive } = require('./workers');
const progress = require('./progress');
const { ProgressStore } = require('./progress-store');
const { ProvenanceStore } = require('./provenance-store');
const { HistoryReader, latestRevision, latestRevisionOfKind } = require('./history-store');
const verdicts = require('./settled-verdicts');
const { validateCertificate, MAX_CERTIFICATE_CHAIN_BYTES, MAX_HISTORICAL_BYTES, MAX_MANIFEST_CHAIN_BYTES } = require('./legacy-certificates');
const { MAX_DELIVERY_RECORDS: MAX_RECORDS, MAX_RUN_ID_BYTES, isRetirementCertificate, retirementRows, runBoundArtifacts, schemaState, verifyTriggers } = require('./legacy-store');

// Read at call time so fixtures can narrow them for one assessment. `input` is the allowance shared across the whole pass, which
// records confirmed by a settled-record verdict are not charged to; `completionRow` bounds each completed record's completion row on
// its own.
const BOUNDS = { input: 64 * 1024 * 1024, completionRow: 64 * 1024 * 1024 };
const TABLES = ['runs', 'active', 'history', 'artifacts', 'accounting_commits', 'discharge_index'];
const CODE = 'delivery-consistency-unavailable';

// A handed-over delivery's morning report stays owed to its recipient until report-delivered binds that exact report.
function reportAwaitsRecipient(state) {
  const report = state.closing?.reportEvidence;

  return Boolean(state.handover) && !validReportDelivery(state, report?.sha256);
}

// A completion discharges the closing record as it stood then. A record opened after it, by renewed triage or a closing reset, stays
// undischarged until the delivery completes again. The latest invocation of each named closing check recorded on the same record after
// completion must match the latest closing assessment in recorded dispatch order when available, the one historical discharge qualifies and orders repairs against: it must be a fresh, strong,
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
  const latest = require('./applicability').latestEntry(now.reviews.filter(review => !review.relevance).map(review => ({ review })), current)?.review;
  if (!(latest?.kind === 'docs' && completeAssessment(latest) && latest.attributionVerified === true && DIMENSIONS.docs.every(dimension => latest.dimensions?.includes(dimension)))) return false;
  const covered = (current.tasks ?? []).filter(task => latest.coveredTaskIds?.includes(task.id));
  const candidates = [resolve(latest.snapshot), ...require('./applicability').preservedSnapshots(latest, now, covered, resolve, current)];
  const seen = candidates.map(candidate => new Map(candidate.files.map(file => [file.path, file.sha256 ?? null])));
  const absent = sha256 => sha256 === null || sha256 === undefined;

  return later.every(check => seen.some(candidate => resolve(check.snapshot).files.every(file => (absent(file.sha256) ? absent(candidate.get(file.path)) : candidate.get(file.path) === file.sha256))));
}

// A closed delivery is discharged by its own close row: the revision right after closure.previousRevision is kind close and holds the
// same closure. Anchoring on that row, not on the latest one, keeps a hand-edited status without a close row failing while a later
// status-preserving revision appended by an older runtime cannot undo the discharge.
function closeRowDischarges(history, state, budget) {
  const closure = state.closure;
  if (!closure || typeof closure !== 'object' || !Number.isSafeInteger(closure.previousRevision) || closure.previousRevision < 0 || !progress.HASH.test(closure.manifestHash ?? '')) return false;
  const revision = closure.previousRevision + 1;
  const size = history.meta(revision)?.bytes;
  if (size === undefined) return false;
  requireSharedBound(size <= budget.remainingInput(), CODE, `Delivery ${state.id} close history exceeds the delivery read bound`);
  const row = history.text(revision, budget.remainingInput());
  if (row?.kind !== 'close') return false;
  const closed = JSON.parse(row.state);

  return closed.id === state.id && closed.status === 'closed' && isDeepStrictEqual(closed.closure, closure);
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
    requireSharedBound(next + reserved <= BOUNDS.input, CODE, 'Delivery consistency input exceeds its byte bound');
    inputBytes = next;
    if (mandatory) mandatoryCharged += size;
  };
  const remainingInput = () => BOUNDS.input - inputBytes - (mandatoryTotal - mandatoryCharged);
  // A record judged in full charges its accounting and provenance artifacts to an 8 MiB allowance of its own and counts them against
  // the one 64 MiB input allowance; its completion evidence has a further budget of its own, not counted there.
  const accountingBudget = () => ({ bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeArtifacts: true, sharedInput: true, chargeInput, remainingInput });
  const evidenceBudget = () => ({ bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeInput, remainingInput });
  const parse = (body, mandatory = false) => {
    chargeInput(body, mandatory);
    return JSON.parse(body);
  };
  const runStats = store.db.prepare('SELECT count(*) AS count, coalesce(max(length(CAST(id AS BLOB))), 0) AS idBytes FROM runs').get();
  requireCondition(runStats.count <= MAX_RECORDS && runStats.idBytes <= MAX_RUN_ID_BYTES, CODE, 'Delivery identity inventory exceeds its bound');
  const rows = store.db.prepare('SELECT id, revision FROM runs ORDER BY id LIMIT ?').all(MAX_RECORDS + 1);
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
  const selectedId = selections[0].id;
  // Only the selected delivery is judged in full at every pass whatever metadata says, so its current state and latest row are
  // reserved up front; every other record is charged as it is read, until the allowance is reached.
  const selectedMetadata = verdicts.metadataOf(store.db, tables, selectedId);
  mandatoryTotal = selectedMetadata.stateBytes + (selectedMetadata.latestBytes ?? 0);
  requireCondition(mandatoryTotal <= BOUNDS.input, CODE, `Selected delivery ${selectedId} current and latest-history input exceeds its bound. Inspect bounded raw states or restore store capacity`);
  const ids = new Set(rows.map(row => row.id));
  requireCondition(retirements.every(row => ids.has(row.runId)), CODE, 'Retirement reference has no saved delivery');
  for (const table of ['history', 'accounting_commits', 'discharge_index'].filter(table => tables.has(table))) requireCondition(!store.db.prepare(`SELECT 1 FROM ${table} evidence LEFT JOIN runs saved ON saved.id=evidence.run_id WHERE saved.id IS NULL LIMIT 1`).get(), 'missing-predecessor', 'Surviving delivery evidence has no stored owner');
  const retirementArtifacts = new Set();
  for (const artifact of tables.has('artifacts') ? runBoundArtifacts(store.db, CODE) : []) {
    if (isRetirementCertificate(artifact.value)) retirementArtifacts.add(artifact.id);
    requireCondition(typeof artifact.value.runId === 'string' && ids.has(artifact.value.runId) && createHash('sha256').update(artifact.body).digest('hex') === artifact.id, CODE, 'Run-bound artifact has an unknown owner or corrupt identity');
  }
  requireCondition(retirements.length > 0 || retirementArtifacts.size === 0, CODE, 'Retirement certificate artifacts have no current reference');
  // The retirement preflight neither accepts nor writes verdicts, and a later release's protection or verdicts are left as they are,
  // so either judges every record in full with nothing written.
  const protection = options.resourceOnly ? 'ignored' : verdicts.protectionState(store.db);
  const saved = ['own', 'missing'].includes(protection) ? verdicts.readVerdicts(store.db, MAX_RECORDS) : null;
  // A verdict table holding more rows than the store can hold records under intact protection was not written by this runtime, so
  // like a later release's protection it is left as it is, every record judged in full and nothing written. Missing protection is
  // reinstalled with every verdict removed, a later release's included, since all their rows were unprotected meanwhile.
  const surplus = protection === 'own' && saved === null;
  const writable = ['own', 'missing', 'absent'].includes(protection) && !surplus;
  const accepting = protection === 'own' && !surplus;
  const writes = { reinstall: protection === 'missing', upserts: new Map(), deletes: new Set() };
  // An orphaned verdict settles nothing and is removed, unless a later release wrote it, whose verdicts stay as they are.
  if (accepting) for (const verdict of saved.rows) if (!(typeof verdict.run_id === 'string' && ids.has(verdict.run_id)) && !verdict.later) writes.deletes.add(verdict.rowid);
  const accounting = new ProgressStore(store);
  const provenance = new ProvenanceStore(accounting);
  const records = [];
  const acceptances = new Set();
  const legacyUnavailable = [];
  const certificateBudgets = { chain: { bytes: 0, maximum: MAX_CERTIFICATE_CHAIN_BYTES, visited: new Set() }, manifests: { bytes: 0, maximum: MAX_MANIFEST_CHAIN_BYTES, visited: new Set() }, history: { bytes: 0, maximum: MAX_HISTORICAL_BYTES, cache: new Map() }, targetsByManifest: new Map() };
  const retirementEvidence = verificationPass(tables.has('artifacts'));
  const accept = acceptance => {
    if (acceptance === undefined || acceptance === null) return;
    requireCondition(typeof acceptance === 'string' && !acceptances.has(acceptance), CODE, 'Acceptance identity is ambiguous');
    acceptances.add(acceptance);
  };
  // Judges one record in full and returns what the pass needs of it; currentAccounting marks a modern record whose independent
  // accounting is current, which with a validated retirement is what a verdict may vouch for.
  const judge = row => {
    const stateText = store.db.prepare('SELECT state FROM runs WHERE id=?').get(row.id).state;
    const mandatory = row.id === selectedId;
    const state = parse(stateText, mandatory);
    requireCondition(state?.schema === 1 && typeof state.id === 'string' && state.id.length > 0 && state.id === row.id && state.root === store.root && recordKind(state) === 'delivery' && state.revision === row.revision && Number.isSafeInteger(row.revision) && row.revision >= 0 && isRecordStatus(state.status) && ['claude', 'codex'].includes(state.controller?.host) && typeof state.controller.session === 'string' && state.controller.session.length > 0 && Array.isArray(state.tasks) && Array.isArray(state.workers), CODE, 'Delivery identity, shape or revision is unsupported');
    const record = { id: state.id, state, stateText, discharged: false, closingOpen: false, currentAccounting: false };
    const history = new HistoryReader(store.db, state.id);
    const latest = latestRevision(store.db, state.id);
    const journal = tables.has('accounting_commits') ? store.db.prepare('SELECT max(revision) AS revision FROM accounting_commits WHERE run_id=?').get(state.id) : { revision: null };
    requireCondition(latest === state.revision && (journal.revision === null || journal.revision === state.revision), CODE, 'Current delivery was rolled back behind surviving revision evidence');
    const historicalSize = history.meta(state.revision)?.bytes;
    requireCondition(historicalSize !== undefined, CODE, 'Current delivery lacks matching history');
    requireSharedBound(historicalSize <= BOUNDS.input - inputBytes, CODE, 'Current delivery history exceeds its read bound');
    const historical = history.text(state.revision, BOUNDS.input - inputBytes);
    const latestState = historical ? parse(historical.state, mandatory) : null;
    requireCondition(latestState && progress.encodedHash(latestState) === progress.encodedHash(state) && isDeepStrictEqual(latestState.progress, state.progress) && isDeepStrictEqual(latestState.stopRecovery, state.stopRecovery), CODE, 'Current delivery contradicts its committed state');
    accept(state.acceptance?.handoverId);
    const retired = retiredById.get(state.id);
    if (retiredById.has(state.id)) {
      verifyArtifacts(store.db, state, retirementEvidence);
      verifyArtifacts(store.db, latestState, retirementEvidence);
      try { validateCertificate(store.db, store.root, { id: row.id, revision: row.revision, state: stateText }, state, historical, retired, certificateBudgets); }
      catch (error) {
        if (!options.resourceOnly || options.requiredRetirements?.has(state.id) || resourceLimit(error) || !(error instanceof RunError)) throw error;
      }
      return { ...record, discharged: true, retired: true };
    }
    if (!options.resourceOnly && legacyUnavailable.length > 0) {
      if (state.progress === undefined) legacyUnavailable.push({ id: state.id, status: state.status, reason: 'replay-deferred-after-blocker' });
      return record;
    }
    if (!['artifacts', 'accounting_commits', 'discharge_index'].every(table => tables.has(table))) {
      requireCondition(state.progress === undefined, CODE, `Delivery ${state.id} has unsupported accounting without its required tables`);
      legacyUnavailable.push({ id: state.id, status: state.status, reason: 'no-independent-accounting' });
      return record;
    }
    if (options.resourceOnly && state.progress === undefined) {
      verifyArtifacts(store.db, state, retirementEvidence);
      verifyArtifacts(store.db, latestState, retirementEvidence);
      return record;
    }
    const budget = accountingBudget();
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
          if (error.sharedAllowance) throw error;
          legacyUnavailable.push({ id: state.id, status: state.status, reason: resourceLimit(error) ? 'legacy-replay-bound' : 'legacy-replay-unavailable' });
          return record;
        }
      }
      if (account && isClosed(state)) {
        requireCondition(account.marker.status === 'current', CODE, 'Delivery accounting is unavailable');
        // The user dropped the remaining lifecycle, so it is never replayed; the close row itself is the discharge evidence.
        discharged = closeRowDischarges(history, state, budget);
      } else if (account) {
        requireCondition(account.marker.status === 'current', CODE, 'Delivery accounting is unavailable');
        // The completion row is bounded on its own rather than charged to the input allowance shared across the store: every
        // completed record has one, so charging them there would refuse every new delivery once enough runs had completed.
        const completionRevision = latestRevisionOfKind(store.db, state.id, 'complete');
        if (completionRevision !== undefined) {
          const completionSize = history.meta(completionRevision)?.bytes;
          requireCondition(completionSize !== undefined, CODE, 'Completion history is missing');
          requireBound(completionSize <= BOUNDS.completionRow, CODE, `Delivery ${state.id} completion history exceeds its own read bound`);
        }
        const completionRow = completionRevision === undefined ? undefined : history.text(completionRevision, BOUNDS.completionRow);
        const completion = completionRevision === undefined ? null : completionRow?.kind === 'complete' ? completionRow : undefined;
        requireCondition(completionRevision === undefined || completion, CODE, `Delivery ${state.id} completion history exceeds its own read bound`);
        if (completion) {
          const completed = JSON.parse(completion.state);
          requireCondition(completed.id === state.id && completed.revision === completion.revision && completed.status === 'complete', CODE, 'Recorded completion identity is contradictory');
          provenance.read(completed, budget);
          // The completion discharge check hydrates the assurance snapshots and closing evidence of the completed state. Those
          // bodies are charged to a budget of this record's own, so completed records do not accumulate against an allowance
          // shared across the store, which would refuse every new delivery once enough runs had completed.
          const evidence = evidenceBudget();
          const snapshotValid = (value, empty = false) => {
            const resolved = accounting.resolve(value, evidence);
            if (Array.isArray(resolved?.files) && resolved.files.length === 0) return empty && resolved.digest === createHash('sha256').update('[]').digest('hex');
            progress.snapshotIdentity(resolved);
            return true;
          };
          const target = value => ({ ...value, checks: value.checks.map(check => ({ ...check, snapshot: accounting.resolve(check.snapshot, evidence) })), reviews: value.reviews.map(review => ({ ...review, snapshot: accounting.resolve(review.snapshot, evidence), ...(review.contextSnapshot ? { contextSnapshot: accounting.resolve(review.contextSnapshot, evidence) } : {}) })), ...(value.docsExemption ? { docsExemption: { ...value.docsExemption, snapshot: accounting.resolve(value.docsExemption.snapshot, evidence) } } : {}) });
          const historicalState = { ...state, tasks: state.tasks.map(target), closing: { ...state.closing, ...(state.closing?.docs ? { docs: { ...target(state.closing.docs), baseline: accounting.resolve(state.closing.docs.baseline, evidence) } } : {}) } };
          closingOpen = !closingDischargedSince(state, completed, value => accounting.resolve(value, evidence));
          discharged = !closingOpen && require('./lifecycle').historicalDischarge(historicalState, snapshotValid);
        }
      }
      if (independent === null && !discharged) legacyUnavailable.push({ id: state.id, status: state.status, reason: 'discharge-unresolved' });
      return { ...record, discharged, closingOpen, currentAccounting: independent?.status === 'current' };
    } catch (error) {
      if (error.sharedAllowance) throw error;
      if (!options.resourceOnly && state.progress?.schema === 2 && resourceLimit(error)) requireCondition(false, CODE, `Delivery ${state.id} exceeds a verification bound: ${error.message}`);
      if (!options.resourceOnly || resourceLimit(error) || !(error instanceof RunError)) throw error;
      return record;
    }
  };
  // A pass the shared allowance refuses keeps the verdict and protection writes it established, every check it completed having
  // passed, so successive handovers re-judge the store a part at a time; any other refusal writes nothing.
  const refuseForAllowance = error => {
    if (legacyUnavailable.length > 0) requireCondition(false, CODE, legacyRefusal(legacyUnavailable));
    // The kept-verdicts clause tells a refusal a retried handover progresses past from one it does not; a failed persist replaces it.
    const refusal = new RunError(CODE, writes.upserts.size > 0 ? `${error.message}; the ${writes.upserts.size} settled record(s) this pass judged keep their verdicts, so a later handover judges less` : error.message);
    refusal.unkeptMessage = error.message;
    refusal.limitExceeded = true;
    refusal.sharedAllowance = true;
    if (writable) refusal.persistAfterRollback = db => verdicts.applyWrites(db, tables, writes);
    throw refusal;
  };
  for (const row of rows) {
    const verdict = saved?.byRun.get(row.id);
    const retirement = retiredById.get(row.id) ?? null;
    const metadata = verdict || writable ? verdicts.metadataOf(store.db, tables, row.id) : null;
    if (accepting && row.id !== selectedId && verdict?.wellFormed && verdict.current && verdicts.matches(verdict, metadata, retirement)) {
      accept(verdict.acceptance);
      // The verdict vouches for the certificate checks that read only this record's frozen rows; the chain walk, the manifest and
      // the tracked destinations in project files are checked again.
      if (retirement !== null) validateCertificate(store.db, store.root, { id: row.id, revision: row.revision, state: null }, null, null, retirement, certificateBudgets);
      records.push({ id: row.id, state: null, discharged: true, closingOpen: false, retired: retirement !== null, verdicted: true });
      continue;
    }
    let record;
    try { record = judge(row); }
    catch (error) {
      if (!options.resourceOnly && error.sharedAllowance) refuseForAllowance(error);
      throw error;
    }
    records.push(record);
    if (!writable) continue;
    const qualifies = row.id !== selectedId && record.discharged && !record.closingOpen && !record.state.workers.some(workerIsActive) && (record.retired === true || record.currentAccounting);
    // A verdict under a rule this runtime does not know is a later release's, and stays as it is whatever its other values.
    if (verdict?.later) continue;
    if (qualifies) writes.upserts.set(row.id, verdicts.verdictFor(record.state, record.stateText, metadata, retirement));
    else if (verdict) writes.deletes.add(verdict.rowid);
  }
  if (!options.resourceOnly) requireCondition([...retirementArtifacts].every(id => certificateBudgets.chain.visited.has(id)), CODE, 'Retirement certificate artifact is outside every current reference chain');
  if (options.resourceOnly) return { inputBytes };
  // inputBytes is diagnostic: it reports the shared allowance this pass charged, which callers do not act on.
  requireCondition(legacyUnavailable.length === 0, CODE, legacyRefusal(legacyUnavailable));
  const selected = records.find(record => record.id === selectedId);
  requireCondition(selected && records.every(record => record === selected || record.discharged), CODE, 'Another surviving delivery still has unresolved or unavailable obligations');
  // Closing work recorded after the selected completion is unfinished work to reconcile, not a contradiction in its evidence.
  requireCondition(selected.state.status !== 'complete' || selected.discharged || selected.closingOpen, CODE, 'Selected completion lacks authenticated lifecycle discharge');
  // Replacement would detach the selected delivery's unconfirmed report from its notice and confirmation route. A delivery
  // replaced under an earlier release has no such route left, so only the selected one can hold replacement back.
  const reportPending = !selected.retired && !isClosed(selected.state) && selected.discharged && reportAwaitsRecipient(selected.state);
  if (writable) verdicts.applyWrites(store.db, tables, writes);

  return { current: selected.state, replaceable: selected.discharged && !reportPending && !records.some(record => record.state?.workers.some(workerIsActive)), reportPending, inputBytes };
}

function creationAssessment(store, options = {}) {
  try { return assessment(store, options); }
  catch (error) {
    if (error.code === 'missing-predecessor' || error.code === CODE) throw error;
    requireCondition(false, CODE, 'Delivery consistency cannot be established: ' + error.message);
  }
}

module.exports = { BOUNDS, closingDischargedSince, creationAssessment, reportAwaitsRecipient };
