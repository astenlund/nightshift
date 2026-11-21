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
const outcomes = require('./delivery-outcome');
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
  return closingSince(current, completed, resolve).causes.length === 0;
}

// The closing work recorded since completion, as discharge causes (see dischargeCauses in lifecycle.js), and `covered(check)`, which
// says whether the latest qualifying closing assessment saw a check's inputs; it is false while no assessment qualifies.
function closingSince(current, completed, resolve) {
  const now = current.closing?.docs ?? null;
  const then = completed.closing?.docs ?? null;
  const uncovered = () => false;
  const replaced = { causes: [{ kind: 'evidence', concern: 'evidence', subject: null, message: 'The closing record was replaced after completion', needs: [] }], covered: uncovered };
  if ((now?.occurrence ?? null) !== (then?.occurrence ?? null)) return replaced;
  if (isDeepStrictEqual(now, then)) return { causes: [], covered: uncovered };
  if (!now || !then) return replaced;
  const { DIMENSIONS, completeAssessment } = require('./lifecycle');
  const latest = require('./applicability').latestEntry(now.reviews.filter(review => !review.relevance).map(review => ({ review })), current)?.review;
  const qualifies = latest?.kind === 'docs' && completeAssessment(latest) && latest.attributionVerified === true && DIMENSIONS.docs.every(dimension => latest.dimensions?.includes(dimension));
  let seen = null;
  const absent = sha256 => sha256 === null || sha256 === undefined;
  // An unresolvable snapshot is no coverage: the resolver has already recorded its failure as a cause of its own.
  const filesOf = value => (Array.isArray(value?.files) ? value.files : null);
  const covered = check => {
    if (!qualifies) return false;
    if (seen === null) {
      const tasks = (current.tasks ?? []).filter(task => latest.coveredTaskIds?.includes(task.id));
      const candidates = [resolve(latest.snapshot), ...require('./applicability').preservedSnapshots(latest, now, tasks, resolve, current)];
      seen = candidates.map(filesOf).filter(Boolean).map(files => new Map(files.map(file => [file.path, file.sha256 ?? null])));
    }
    const checked = filesOf(resolve(check.snapshot));
    return checked !== null && seen.some(candidate => checked.every(file => (absent(file.sha256) ? absent(candidate.get(file.path)) : candidate.get(file.path) === file.sha256)));
  };
  const identity = check => check.attemptId ?? JSON.stringify(check);
  const earlierChecks = new Set(then.checks.map(identity));
  // As the lifecycle's check gates do, a later invocation of a named check supersedes an earlier one.
  const later = [...new Map(now.checks.map(check => [check.name, check])).values()].filter(check => !earlierChecks.has(identity(check)));
  const causes = later.filter(check => !covered(check)).map(check => ({ kind: 'work', concern: 'check', subject: check.name, message: `Closing check "${check.name}" was recorded after completion and the latest closing assessment has not seen its files`, needs: ['closing', 'dispatch'] }));

  return { causes, covered };
}

// A closed delivery is discharged by its own close row: the revision right after closure.previousRevision is kind close and holds the
// same closure. Anchoring on that row, not on the latest one, keeps a hand-edited status without a close row failing while a later
// status-preserving revision appended by an older runtime cannot undo the discharge. When the close row is the record's latest row, the
// latest-row read the pass already charged (reserved, for the selection) is reused rather than charged again.
function closeRowDischarges(history, state, budget, latest = null) {
  const closure = state.closure;
  if (!closure || typeof closure !== 'object' || !Number.isSafeInteger(closure.previousRevision) || closure.previousRevision < 0 || !progress.HASH.test(closure.manifestHash ?? '')) return false;
  const revision = closure.previousRevision + 1;
  let row = latest?.revision === revision ? latest : null;
  if (!row) {
    const size = history.meta(revision)?.bytes;
    if (size === undefined) return false;
    requireSharedBound(size <= budget.remainingInput(), CODE, `Delivery ${state.id} close history exceeds the delivery read bound`);
    row = history.text(revision, budget.remainingInput());
  }
  if (row?.kind !== 'close') return false;
  const closed = JSON.parse(row.state);

  return closed.id === state.id && closed.status === 'closed' && isDeepStrictEqual(closed.closure, closure);
}

// Establishes a record's accounting as the gate requires before it reads a completion or close row: current independent provenance
// with its checkpoint, bindings and discharge-index entries verified, or for a delivery saved by an earlier release without schema-2
// accounting, a bounded replay from its creation. A schema-2 record without independent provenance has lost it. `legacy` names why a
// replay could not be established, `unavailable` why present independent provenance is not current; any other failure throws.
function establishAccounting(accounting, provenance, state, budget) {
  const independent = provenance.read(state, budget);
  requireCondition(independent !== null || state.progress?.schema !== 2, CODE, `Delivery ${state.id} has schema-2 accounting without independent provenance`);
  let account = null;
  if (independent?.status === 'current') {
    const restored = { ...state, progress: independent.marker };
    if (independent.reminder) restored.stopRecovery = independent.reminder;
    else delete restored.stopRecovery;
    account = accounting.checkpoint(restored, budget);
    provenance.verify(state, budget);
  } else if (independent === null && ['complete', 'stopped'].includes(state.status)) {
    try { account = accounting.read(state, budget); }
    catch (error) {
      if (error.sharedAllowance) throw error;

      return { independent, account: null, legacy: resourceLimit(error) ? 'legacy-replay-bound' : 'legacy-replay-unavailable' };
    }
  }
  if (account) requireCondition(account.marker.status === 'current', CODE, 'Delivery accounting is unavailable');
  const unavailable = independent && independent.status !== 'current' ? `Its independent accounting is ${independent.status ?? 'not current'}` : null;

  return { independent, account, legacy: null, unavailable };
}

// Why a record's current row cannot be judged as its present state, or null: it was rolled back behind surviving history or accounting
// revisions. The gate and the read-only judgment share these two checks.
function rollbackProblem(db, tables, state) {
  const latest = latestRevision(db, state.id);
  const journal = tables.has('accounting_commits') ? db.prepare('SELECT max(revision) AS revision FROM accounting_commits WHERE run_id=?').get(state.id) : { revision: null };

  return latest === state.revision && (journal.revision === null || journal.revision === state.revision) ? null : 'Current delivery was rolled back behind surviving revision evidence';
}

// Why a record's current row contradicts its latest history row, or null.
function agreementProblem(state, latestState) {
  return latestState && progress.encodedHash(latestState) === progress.encodedHash(state) && isDeepStrictEqual(latestState.progress, state.progress) && isDeepStrictEqual(latestState.stopRecovery, state.stopRecovery) ? null : 'Current delivery contradicts its committed state';
}

// Judges a recorded completion, once its accounting is established, into the outcome of .nightshift/specs/post-completion-closing-hold.md
// commitment 1. The completion row is bounded on its own rather than charged to the input allowance shared across the store: every
// completed record has one, so charging them there would refuse every new delivery once enough runs had completed. The completion
// discharge check hydrates the assurance snapshots and closing evidence of the completed state, charged to `evidence`, a budget of this
// record's own for the same reason. With `convert`, a failure to read that evidence becomes a cause, a bound making the outcome
// unavailable and any other failure unauthenticated; without it, as for a stopped record, the failure throws as it always has.
function judgeCompletion({ db, accounting, provenance, history, state, budget, evidence, convert }) {
  const failures = [];
  const convertible = error => convert && error instanceof RunError && !error.sharedAllowance;
  try {
    const completionRevision = latestRevisionOfKind(db, state.id, 'complete');
    if (completionRevision === undefined) return outcomes.judgment([outcomes.cause('evidence', null, 'The record is complete but has no recorded completion row')]);
    const completionSize = history.meta(completionRevision)?.bytes;
    requireCondition(completionSize !== undefined, CODE, 'Completion history is missing');
    requireBound(completionSize <= BOUNDS.completionRow, CODE, `Delivery ${state.id} completion history exceeds its own read bound`);
    const completion = history.text(completionRevision, BOUNDS.completionRow);
    if (completion?.kind !== 'complete') {
      if (convert) return outcomes.judgment([outcomes.cause('bound', null, `Delivery ${state.id} completion history exceeds its own read bound`)]);
      requireCondition(false, CODE, `Delivery ${state.id} completion history exceeds its own read bound`);
    }
    // An unreadable completion body is a failure of the evidence the judgment reads, never an unexpected error.
    let completed;
    try { completed = JSON.parse(completion.state); }
    catch { requireCondition(false, CODE, `Delivery ${state.id} recorded completion row is unreadable`); }
    requireCondition(completed && typeof completed === 'object' && completed.id === state.id && completed.revision === completion.revision && completed.status === 'complete', CODE, 'Recorded completion identity is contradictory');
    provenance.read(completed, budget);
    // Each failed read is kept as a cause and judged invalid, so the closing work found beside it is still named.
    const resolve = value => {
      try { return accounting.resolve(value, evidence); }
      catch (error) {
        if (!convertible(error) || resourceLimit(error)) throw error;
        failures.push(error.message);

        return null;
      }
    };
    const snapshotValid = (value, empty = false) => {
      const resolved = resolve(value);
      if (Array.isArray(resolved?.files) && resolved.files.length === 0) return empty && resolved.digest === createHash('sha256').update('[]').digest('hex');
      try { progress.snapshotIdentity(resolved); }
      catch (error) {
        if (!convertible(error)) throw error;

        return false;
      }
      return true;
    };
    const target = value => ({ ...value, checks: value.checks.map(check => ({ ...check, snapshot: resolve(check.snapshot) })), reviews: value.reviews.map(review => ({ ...review, snapshot: resolve(review.snapshot), ...(review.contextSnapshot ? { contextSnapshot: resolve(review.contextSnapshot) } : {}) })), ...(value.docsExemption ? { docsExemption: { ...value.docsExemption, snapshot: resolve(value.docsExemption.snapshot) } } : {}) });
    const historicalState = { ...state, tasks: state.tasks.map(target), closing: { ...state.closing, ...(state.closing?.docs ? { docs: { ...target(state.closing.docs), baseline: resolve(state.closing.docs.baseline) } } : {}) } };
    const since = closingSince(state, completed, resolve);
    const discharge = require('./lifecycle').dischargeCauses(historicalState, snapshotValid, { closingCovered: since.covered });
    // A failed or pending later check is named once, by dischargeCauses, whose needs already ask whether its rerun wants a fresh review.
    const failing = new Set(historicalState.closing?.docs ? require('./lifecycle').latestChecks(historicalState.closing.docs).filter(check => check.pending || !check.passed).map(check => check.name) : []);
    const causes = [...since.causes.filter(entry => !failing.has(entry.subject)), ...discharge];
    for (const message of new Set(failures)) causes.push(outcomes.cause('evidence', null, `Referenced evidence could not be read: ${message}`));

    return outcomes.judgment(causes);
  } catch (error) {
    if (!convertible(error)) throw error;

    return outcomes.judgment([...[...new Set(failures)].map(message => outcomes.cause('evidence', null, `Referenced evidence could not be read: ${message}`)), outcomes.causeOf(error, 'evidence')]);
  }
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
    const record = { id: state.id, state, stateText, discharged: false, currentAccounting: false };
    const history = new HistoryReader(store.db, state.id);
    accept(state.acceptance?.handoverId);
    // For a complete delivery that is not retired, a failure of these record-local reads is its Unavailable outcome, named beside the
    // other blockers; every other record keeps its refusal.
    const outcomeOnFailure = state.status === 'complete' && !options.resourceOnly && !retiredById.has(state.id);
    let historical;
    let latestState;
    try {
      const rolledBack = rollbackProblem(store.db, tables, state);
      requireCondition(rolledBack === null, CODE, rolledBack);
      const historicalSize = history.meta(state.revision)?.bytes;
      requireCondition(historicalSize !== undefined, CODE, 'Current delivery lacks matching history');
      requireSharedBound(historicalSize <= BOUNDS.input - inputBytes, CODE, 'Current delivery history exceeds its read bound');
      historical = history.text(state.revision, BOUNDS.input - inputBytes);
      latestState = historical ? parse(historical.state, mandatory) : null;
      const contradicted = agreementProblem(state, latestState);
      requireCondition(contradicted === null, CODE, contradicted);
    } catch (error) {
      if (!outcomeOnFailure || error.sharedAllowance || !(error instanceof RunError || error instanceof SyntaxError)) throw error;

      return { ...record, outcome: outcomes.judgment([outcomes.causeOf(error, 'accounting')]) };
    }
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
    // A complete delivery's failure to establish its accounting or judge its completion is its outcome, named in the refusal beside
    // every other blocker, rather than a refusal of its own; a running or stopped record keeps its refusal.
    const judged = state.status === 'complete' && !options.resourceOnly;
    try {
      const established = establishAccounting(accounting, provenance, state, budget);
      const { independent, account } = established;
      if (established.legacy) {
        legacyUnavailable.push({ id: state.id, status: state.status, reason: established.legacy });
        return { ...record, ...(judged ? { outcome: outcomes.judgment([outcomes.cause('accounting', null, `Its accounting replay is unavailable (${established.legacy})`)]) } : {}) };
      }
      // Present independent provenance that is not current leaves a complete delivery unavailable, whether or not it is selected.
      if (judged && established.unavailable) return { ...record, outcome: outcomes.judgment([outcomes.cause('accounting', null, established.unavailable)]) };
      let discharged = false;
      let outcome;
      if (account && isClosed(state)) {
        // The user dropped the remaining lifecycle, so it is never replayed; the close row itself is the discharge evidence.
        discharged = closeRowDischarges(history, state, budget, historical);
      } else if (account) {
        outcome = judgeCompletion({ db: store.db, accounting, provenance, history, state, budget, evidence: evidenceBudget(), convert: judged });
        discharged = outcome.outcome === outcomes.DISCHARGED;
      }
      if (independent === null && !discharged) legacyUnavailable.push({ id: state.id, status: state.status, reason: 'discharge-unresolved' });
      return { ...record, discharged, ...(judged ? { outcome } : {}), currentAccounting: independent?.status === 'current' };
    } catch (error) {
      if (error.sharedAllowance) throw error;
      if (judged && error instanceof RunError) return { ...record, outcome: outcomes.judgment([outcomes.causeOf(error, 'accounting')]) };
      if (error.sharedAllowance) throw error;
      if (!options.resourceOnly && state.progress?.schema === 2 && resourceLimit(error)) requireCondition(false, CODE, `Delivery ${state.id} exceeds a verification bound: ${error.message}`);
      if (!options.resourceOnly || resourceLimit(error) || !(error instanceof RunError)) throw error;
      return record;
    }
  };
  // A pass the shared allowance refuses keeps the verdict and protection writes it established, every check it completed having
  // passed, so successive handovers re-judge the store a part at a time; any other refusal writes nothing.
  // Every blocker the records judged so far establish, as {record, code, text}, in the order they were judged: a complete delivery by its
  // outcome, any other record that is not discharged other than the selection (a record the legacy group names is left to that group),
  // then the selection's own blockers and every active worker. Each refusal exit names the same list, so code precedence never hides a
  // blocker the pass established. Routes come from saved state alone: no process is inspected while the transaction is held.
  const establishedBlockers = () => {
    const now = Date.now();
    const selected = records.find(record => record.id === selectedId) ?? null;
    const legacy = new Set(legacyUnavailable.map(entry => entry.id));
    const list = [];
    for (const record of records) {
      if (record.outcome) {
        if (record.outcome.outcome === outcomes.DISCHARGED) continue;
        const { routed } = outcomes.routesFor(record.state, record.outcome, { current: record === selected, now, inspect: false });
        list.push({ record, code: record.outcome.outcome === outcomes.HELD ? 'overlapping-run' : CODE, text: outcomes.describe(record.id, record.outcome, routed, { provisional: true }) });
      } else if (record !== selected && !record.discharged && !legacy.has(record.id)) list.push({ record, code: CODE, text: `Delivery ${record.id} (${record.state?.status ?? 'unknown'}) still has unresolved or unavailable obligations.` });
    }
    const own = [];
    if (selected?.state) {
      if (!selected.retired && !isClosed(selected.state) && selected.discharged && reportAwaitsRecipient(selected.state)) own.push({ record: selected, code: 'report-delivery-pending', text: `Delivery ${selected.id} (selected) owes its morning report to its recipient: present the saved report and record report-delivered with the user's reply.` });
      if (['running', 'stopped'].includes(selected.state.status)) own.push({ record: selected, code: 'overlapping-run', text: `Delivery ${selected.id} (selected) is ${selected.state.status}: reconcile, resume or explicitly finish it.` });
    }
    const named = new Set(list.map(entry => entry.record));
    for (const record of records.filter(entry => entry.state?.workers.some(workerIsActive) && !named.has(entry))) own.push({ record, code: 'overlapping-run', text: `Delivery ${record.id} has an active or uncertain worker to reconcile.` });

    return { list, own, text: [...list, ...own].length ? `. Blocking: ${[...list, ...own].map(entry => entry.text).join(' ')}` : '' };
  };
  const refuseForAllowance = error => {
    const { text } = establishedBlockers();
    if (legacyUnavailable.length > 0) requireCondition(false, CODE, `${legacyRefusal(legacyUnavailable)}${text}`);
    // The kept-verdicts clause tells a refusal a retried handover progresses past from one it does not; a failed persist replaces it.
    const refusal = new RunError(CODE, `${writes.upserts.size > 0 ? `${error.message}; the ${writes.upserts.size} settled record(s) this pass judged keep their verdicts, so a later handover judges less` : error.message}${text}`);
    refusal.unkeptMessage = `${error.message}${text}`;
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
      records.push({ id: row.id, state: null, discharged: true, retired: retirement !== null, verdicted: true });
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
    const qualifies = row.id !== selectedId && record.discharged && !record.state.workers.some(workerIsActive) && (record.retired === true || record.currentAccounting);
    // A verdict under a rule this runtime does not know is a later release's, and stays as it is whatever its other values.
    if (verdict?.later) continue;
    if (qualifies) writes.upserts.set(row.id, verdicts.verdictFor(record.state, record.stateText, metadata, retirement));
    else if (verdict) writes.deletes.add(verdict.rowid);
  }
  if (!options.resourceOnly) requireCondition([...retirementArtifacts].every(id => certificateBudgets.chain.visited.has(id)), CODE, 'Retirement certificate artifact is outside every current reference chain');
  if (options.resourceOnly) return { inputBytes };
  // inputBytes is diagnostic: it reports the shared allowance this pass charged, which callers do not act on.
  const established = establishedBlockers();
  // The grouped refusal keeps its precedence and names every other blocker the pass established before its first legacy record.
  if (legacyUnavailable.length > 0) requireCondition(false, CODE, `${legacyRefusal(legacyUnavailable)}${established.text}`);
  const selected = records.find(record => record.id === selectedId);
  requireCondition(selected, CODE, 'Delivery selection was not judged');
  // Replacement would detach the selected delivery's unconfirmed report from its notice and confirmation route. A delivery
  // replaced under an earlier release has no such route left, so only the selected one can hold replacement back.
  const reportPending = established.own.some(entry => entry.code === 'report-delivery-pending');
  // Closing work held on the selection is unfinished work to reconcile, as an unfinished selection is, so it alone neither refuses an
  // exact replay nor turns the refusal into a consistency failure.
  const blockers = established.list;
  const consistency = blockers.some(blocker => blocker.code === CODE);
  const named = established.text;
  // Precedence follows today's order: a consistency failure, then the selection's pending report, then held work.
  if (blockers.some(blocker => blocker.record !== selected || blocker.code === CODE)) {
    const code = consistency ? CODE : reportPending ? 'report-delivery-pending' : 'overlapping-run';
    const refusal = new RunError(code, `${code === CODE ? 'Another surviving delivery still has unresolved or unavailable obligations' : code === 'report-delivery-pending' ? REPORT_PENDING : 'A surviving delivery still holds closing work'}${named}`);
    refusal.creationBlocker = true;
    throw refusal;
  }
  if (writable) verdicts.applyWrites(store.db, tables, writes);

  return { current: selected.state, replaceable: selected.discharged && !reportPending && !records.some(record => record.state?.workers.some(workerIsActive)), reportPending, blocking: named, inputBytes };
}

// The refusal for a selection whose morning report awaits its recipient, shared with the store's replaceability check.
const REPORT_PENDING = 'The latest delivery\'s morning report awaits its recipient: present the saved report, record report-delivered with the user\'s reply, then accept the new delivery';

function creationAssessment(store, options = {}) {
  try { return assessment(store, options); }
  catch (error) {
    if (error.code === 'missing-predecessor' || error.code === CODE || error.creationBlocker) throw error;
    requireCondition(false, CODE, 'Delivery consistency cannot be established: ' + error.message);
  }
}

module.exports = { BOUNDS, REPORT_PENDING, agreementProblem, closeRowDischarges, closingDischargedSince, creationAssessment, establishAccounting, judgeCompletion, reportAwaitsRecipient, rollbackProblem };
