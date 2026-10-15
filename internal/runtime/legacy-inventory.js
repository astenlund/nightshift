'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');
const { MAX_EXPANDED_BYTES, hydrateArtifact } = require('./artifact-hydration');
const { targetEntry, MAX_TARGET_READ_BYTES } = require('./legacy-backlog');
const { APPROVAL_SCHEMA, MAX_APPROVAL_RECORDS, MAX_CERTIFICATE_BYTES, MAX_CERTIFICATE_CHAIN_BYTES, MAX_HISTORICAL_BYTES, MAX_MANIFEST_BYTES, MAX_MANIFEST_CHAIN_BYTES, approvedStateProjection, savedFollowupsValid, validateCertificate } = require('./legacy-certificates');
const { requireCondition } = require('./errors');
const { reportProjection, MAX_BATCH_REPORT_BYTES } = require('./legacy-report');
const { MAX_ARTIFACT_ID_BYTES, MAX_DELIVERY_RECORDS: MAX_RECORDS, MAX_RUN_ID_BYTES, isRetirementCertificate, readArtifact, readArtifactBody, retirementRows, schemaState, sha256, verifyTriggers } = require('./legacy-store');
const { recordKind } = require('./records');
const progress = require('./progress');
const { ProgressStore } = require('./progress-store');
const { ProvenanceStore } = require('./provenance-store');
const { workerIsActive } = require('./workers');

const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const PAGE_RECORDS = 20;
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const MAX_INVENTORY_RESPONSE_BYTES = 8 * 1024 * 1024;
const WORKER_STATUSES = new Set(['starting', 'running', 'unverified', 'complete', 'failed', 'stopped']);
const DAMAGED_ACCOUNTING_CODES = new Set(['progress-artifact-unavailable', 'progress-history-unavailable', 'progress-reminder-unavailable', 'progress-marker-unavailable', 'progress-evidence-unavailable', 'progress-frontier-unavailable', 'progress-accounting-unavailable']);

function parseState(body, label) {
  try { return JSON.parse(body); }
  catch { requireCondition(false, 'migration-store-unavailable', `${label} is not valid JSON`); }
}

function accountingClass(db, root, state, accounting, discharge, budget) {
  if (state.progress === undefined) return accounting || discharge ? 'damaged-modern' : 'legacy';
  if (state.progress?.schema !== 2) return 'damaged-modern';
  if (!accounting) return 'damaged-modern';
  try {
    const accountingStore = new ProgressStore({ db, root });
    const provenance = new ProvenanceStore(accountingStore);
    const current = provenance.read(state, budget);
    if (current?.status !== 'current') return 'damaged-modern';
    provenance.verify(state, budget);
    const restored = { ...state, progress: current.marker };
    if (current.reminder) restored.stopRecovery = current.reminder;
    else delete restored.stopRecovery;
    accountingStore.checkpoint(restored, budget);

    return 'modern';
  } catch (error) {
    if (error.limitExceeded === true || !DAMAGED_ACCOUNTING_CODES.has(error.code)) requireCondition(false, 'migration-store-unavailable', `Cannot classify delivery ${state.id}: ${error.message}`);

    return 'damaged-modern';
  }
}

class LegacyInventory {
  constructor(root, db) {
    this.root = fs.realpathSync.native(root);
    this.db = db;
    this.schema = schemaState(db);
    this.records = null;
    this.selection = null;
    this.retirements = null;
    this.storeInventoryHash = null;
    this.destinationBudget = { bytes: 0, maximum: MAX_TARGET_READ_BYTES, cache: new Map() };
  }

  load() {
    if (this.records) return this;
    const runStats = this.db.prepare('SELECT count(*) AS count, coalesce(sum(length(CAST(state AS BLOB))), 0) AS bytes, coalesce(max(length(CAST(id AS BLOB))), 0) AS idBytes FROM runs').get();
    requireCondition(runStats.count <= MAX_RECORDS && runStats.bytes <= MAX_INPUT_BYTES && runStats.idBytes <= MAX_RUN_ID_BYTES, 'migration-store-unavailable', 'Delivery identity or state inventory exceeds its bound');
    const latestStats = this.db.prepare('SELECT count(*) AS count, coalesce(sum(length(CAST(history.state AS BLOB))), 0) AS bytes FROM runs JOIN history ON history.run_id=runs.id AND history.revision=runs.revision').get();
    requireCondition(latestStats.count <= MAX_RECORDS && runStats.bytes + latestStats.bytes <= MAX_INPUT_BYTES, 'migration-store-unavailable', 'Delivery current and latest history exceed the inventory read bound');
    if (this.schema.tables.has('artifacts')) {
      const artifactStats = this.db.prepare('SELECT count(*) AS count, coalesce(sum(length(CAST(body AS BLOB))), 0) AS bytes, coalesce(max(length(CAST(id AS BLOB))), 0) AS idBytes FROM artifacts').get();
      requireCondition(artifactStats.count <= progress.MAX_CREDITS && artifactStats.bytes <= MAX_INPUT_BYTES && artifactStats.idBytes <= MAX_ARTIFACT_ID_BYTES, 'migration-store-unavailable', 'Retirement artifact inventory exceeds its bound');
    }
    const rows = this.db.prepare('SELECT id, revision, state FROM runs ORDER BY id LIMIT ?').all(MAX_RECORDS + 1);
    requireCondition(rows.length <= MAX_RECORDS, 'migration-store-unavailable', 'Delivery identity inventory exceeds its bound');
    for (const table of ['history', 'accounting_commits', 'discharge_index'].filter(name => this.schema.tables.has(name))) requireCondition(!this.db.prepare(`SELECT 1 FROM ${table} evidence LEFT JOIN runs saved ON saved.id=evidence.run_id WHERE saved.id IS NULL LIMIT 1`).get(), 'migration-store-unavailable', `${table} has an orphaned delivery owner`);
    const active = this.db.prepare('SELECT id FROM active LIMIT 2').all();
    requireCondition(rows.length === 0 ? active.length === 0 : active.length === 1 && rows.some(row => row.id === active[0].id), 'migration-store-unavailable', 'Delivery selection is absent or contradictory');
    this.selection = active[0]?.id ?? null;
    const retirements = retirementRows(this.db, this.schema.tables);
    verifyTriggers(this.db, this.schema.tables);
    this.retirements = new Map(retirements.map(row => [row.runId, row.artifact]));
    const savedIds = new Set(rows.map(row => row.id));
    requireCondition(this.retirements.size === retirements.length && retirements.every(row => savedIds.has(row.runId)), 'migration-store-unavailable', 'Retirement reference has an unknown or duplicated owner');
    let bytes = 0;
    const evidenceBudget = { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeInput: body => { bytes += Buffer.byteLength(body); requireCondition(bytes <= MAX_INPUT_BYTES, 'migration-store-unavailable', 'Delivery inventory exceeds its byte bound'); }, remainingInput: () => MAX_INPUT_BYTES - bytes };
    this.records = new Map();
    const generation = [];
    for (const row of rows) {
      requireCondition(typeof row.id === 'string' && row.id.length > 0 && Buffer.byteLength(row.id) <= MAX_RUN_ID_BYTES, 'migration-store-unavailable', 'Delivery identity exceeds its supported bound');
      const latestRevision = this.db.prepare('SELECT revision FROM history WHERE run_id=? ORDER BY revision DESC LIMIT 1').get(row.id)?.revision;
      requireCondition(Number.isSafeInteger(row.revision) && row.revision >= 0 && latestRevision === row.revision, 'migration-store-unavailable', `Delivery ${row.id} lacks its matching latest history`);
      const latest = this.db.prepare('SELECT revision, state FROM history WHERE run_id=? AND revision=? AND length(CAST(state AS BLOB))<=?').get(row.id, row.revision, MAX_INPUT_BYTES - bytes - Buffer.byteLength(row.state));
      requireCondition(latest, 'migration-store-unavailable', `Delivery ${row.id} latest history exceeds the inventory read bound`);
      bytes += Buffer.byteLength(row.state) + Buffer.byteLength(latest.state);
      requireCondition(bytes <= MAX_INPUT_BYTES, 'migration-store-unavailable', 'Delivery inventory exceeds its byte bound');
      const state = parseState(row.state, `Delivery ${row.id}`);
      const historical = parseState(latest.state, `History for ${row.id}`);
      requireCondition(state?.schema === 1 && state.id === row.id && state.root === this.root && recordKind(state) === 'delivery' && state.revision === row.revision && ['running', 'stopped', 'complete'].includes(state.status) && ['claude', 'codex'].includes(state.controller?.host) && typeof state.controller.session === 'string' && state.controller.session.length > 0 && Array.isArray(state.tasks) && Array.isArray(state.workers), 'migration-store-unavailable', `Delivery ${row.id} has unsupported identity or state`);
      requireCondition(savedFollowupsValid(state), 'migration-store-unavailable', `Delivery ${row.id} has missing, duplicated or unsupported follow-up identities`);
      requireCondition(historical?.id === row.id && historical.revision === row.revision && progress.encodedHash(historical) === progress.encodedHash(state) && isDeepStrictEqual(historical.progress, state.progress) && isDeepStrictEqual(historical.stopRecovery, state.stopRecovery), 'migration-store-unavailable', `Delivery ${row.id} contradicts its latest history`);
      requireCondition(state.workers.every(worker => WORKER_STATUSES.has(worker.status)), 'migration-store-unavailable', `Delivery ${row.id} has an unknown worker state`);
      const accounting = this.schema.tables.has('accounting_commits') ? this.db.prepare('SELECT count(*) AS count FROM accounting_commits WHERE run_id=?').get(row.id).count : 0;
      const discharge = this.schema.tables.has('discharge_index') ? this.db.prepare('SELECT count(*) AS count FROM discharge_index WHERE run_id=?').get(row.id).count : 0;
      const classification = accountingClass(this.db, this.root, state, accounting, discharge, evidenceBudget);
      const current = { id: row.id, revision: row.revision, rawState: row.state, rawHistory: latest.state, state, classification, accounting, discharge, selected: row.id === this.selection, retirement: this.retirements.get(row.id) ?? null };
      this.records.set(row.id, current);
      generation.push({ id: row.id, revision: row.revision, stateHash: sha256(row.state), historyRevision: latest.revision, historyHash: sha256(latest.state) });
    }
    this.storeInventoryHash = progress.fingerprint({ version: this.schema.version, selected: this.selection, records: generation, retirements });
    const budgets = { chain: { bytes: 0, maximum: MAX_CERTIFICATE_CHAIN_BYTES, visited: new Set() }, manifests: { bytes: 0, maximum: MAX_MANIFEST_CHAIN_BYTES, visited: new Set() }, history: { bytes: 0, maximum: MAX_HISTORICAL_BYTES, cache: new Map() }, targetsByManifest: new Map() };
    for (const record of this.records.values()) {
      if (!record.retirement) {
        record.retirementState = { status: 'none' };
        continue;
      }
      try {
        validateCertificate(this.db, this.root, { id: record.id, revision: record.revision, state: record.rawState }, record.state, { state: record.rawHistory }, record.retirement, budgets);
        record.retirementState = { status: 'valid' };
      } catch (error) {
        record.retirementState = { status: 'unavailable', code: error.code ?? 'migration-evidence-unavailable', reason: error.message };
      }
    }
    const retirementArtifacts = new Map();
    let artifactBytes = 0;
    for (const artifact of this.schema.tables.has('artifacts') ? this.db.prepare('SELECT id, body FROM artifacts').iterate() : []) {
      artifactBytes += Buffer.byteLength(artifact.body);
      requireCondition(artifactBytes <= MAX_INPUT_BYTES, 'migration-store-unavailable', 'Retirement artifact inventory exceeds its byte bound');
      const parsed = parseState(artifact.body, `Artifact ${artifact.id}`);
      if (isRetirementCertificate(parsed)) retirementArtifacts.set(artifact.id, parsed.runId);
    }
    const referencedArtifacts = new Set();
    let chainBytes = 0;
    let everyChainComplete = true;
    for (const retirement of retirements) {
      let artifact = retirement.artifact;
      while (typeof artifact === 'string' && progress.HASH.test(artifact) && !referencedArtifacts.has(artifact)) {
        let body;
        try { body = readArtifactBody(this.db, artifact, MAX_CERTIFICATE_CHAIN_BYTES - chainBytes); }
        catch { everyChainComplete = false; break; }
        chainBytes += Buffer.byteLength(body);
        referencedArtifacts.add(artifact);
        let certificate;
        try { certificate = JSON.parse(body); }
        catch { everyChainComplete = false; break; }
        artifact = certificate?.supersedes;
      }
      if (artifact !== null) everyChainComplete = false;
    }
    const orphan = [...retirementArtifacts].find(([id, runId]) => !referencedArtifacts.has(id) && (everyChainComplete || !this.retirements.has(runId)));
    requireCondition(!orphan, 'migration-evidence-unavailable', `Retirement certificate ${orphan?.[0] ?? 'unknown'} for delivery ${orphan?.[1] ?? 'unknown'} is outside every current reference chain`);

    return this;
  }

  record(id) {
    this.load();
    const record = this.records.get(id);
    requireCondition(record, 'migration-run-unavailable', `Delivery ${id} is absent`);

    return record;
  }

  validateCurrentEvidence() {
    this.load();
    const hydration = { bytes: 0, maximum: MAX_INPUT_BYTES, expansionMaximum: MAX_EXPANDED_BYTES, visited: new Set(), artifactsAvailable: this.schema.tables.has('artifacts') };
    for (const record of this.records.values()) {
      try {
        hydrateArtifact(this.db, record.state, new Set(), hydration);
        hydrateArtifact(this.db, parseState(record.rawHistory, `History for ${record.id}`), new Set(), hydration);
      } catch (error) {
        requireCondition(false, 'migration-store-unavailable', `Delivery ${record.id} has unavailable referenced evidence: ${error.message}`);
      }
    }

    return this;
  }

  summary(record, budget = { bytes: 0, maximum: MAX_BATCH_REPORT_BYTES }, hydration = { bytes: 0, maximum: MAX_INPUT_BYTES, expansionMaximum: MAX_EXPANDED_BYTES, visited: new Set(), artifactsAvailable: this.schema.tables.has('artifacts') }) {
    const state = record.state;
    hydrateArtifact(this.db, state, new Set(), hydration);
    hydrateArtifact(this.db, parseState(record.rawHistory, `History for ${record.id}`), new Set(), hydration);

    return {
      id: record.id,
      revision: record.revision,
      status: state.status,
      ...approvedStateProjection(state),
      classification: record.classification,
      selected: record.selected,
      retirement: record.retirementState,
      stateHash: sha256(record.rawState),
      historyHash: sha256(record.rawHistory),
      report: reportProjection(this.root, state, budget),
    };
  }

  inventory(page = 0) {
    this.validateCurrentEvidence();
    const pages = Math.max(1, Math.ceil(this.records.size / PAGE_RECORDS));
    requireCondition(Number.isSafeInteger(page) && page >= 0 && page < pages, 'migration-inventory-unavailable', 'Inventory page is outside its bounded range');
    const counts = { legacy: 0, modern: 0, damagedModern: 0, retired: 0, unavailableRetirements: 0 };
    for (const record of this.records.values()) {
      if (record.retirementState.status === 'valid') counts.retired++;
      else if (record.retirementState.status === 'unavailable') counts.unavailableRetirements++;
      if (record.classification === 'legacy') counts.legacy++;
      else if (record.classification === 'modern') counts.modern++;
      else counts.damagedModern++;
    }

    const pageRecords = [...this.records.values()].slice(page * PAGE_RECORDS, (page + 1) * PAGE_RECORDS);
    const compact = reason => {
      const fallback = { selected: this.selection, total: this.records.size, counts, storeInventoryHash: this.storeInventoryHash, page, pages, preview: pageRecords.map(record => ({ id: record.id, revision: record.revision, status: record.state.status, retirementStatus: record.retirementState.status })), detailUnavailable: reason };
      requireCondition(Buffer.byteLength(JSON.stringify(fallback)) <= MAX_INVENTORY_RESPONSE_BYTES, 'migration-inventory-bound', 'Inventory ID list exceeds its response bound');

      return fallback;
    };
    const reportBudget = { bytes: 0, maximum: MAX_BATCH_REPORT_BYTES };
    const pageHydration = { bytes: 0, maximum: MAX_INPUT_BYTES, expansionMaximum: MAX_EXPANDED_BYTES, visited: new Set(), artifactsAvailable: this.schema.tables.has('artifacts') };
    let details;
    try { details = pageRecords.map(record => ({ ...this.summary(record, reportBudget, pageHydration), retiredFollowups: this.retiredFollowupsFor(record) })); }
    catch (error) {
      if (!['migration-evidence-bound', 'migration-report-bound'].includes(error.code)) throw error;

      return compact(error.code);
    }
    const result = { selected: this.selection, total: this.records.size, counts, storeInventoryHash: this.storeInventoryHash, page, pages, preview: details };
    if (Buffer.byteLength(JSON.stringify(result)) <= MAX_INVENTORY_RESPONSE_BYTES) return result;

    return compact('inventory-response-bound');
  }

  retiredFollowupsFor(record) {
    const items = [];
    if (!record.retirement) return items;
    let choices = [];
    try {
      const saved = readArtifact(this.db, record.retirement, MAX_CERTIFICATE_BYTES).followups;
      choices = Array.isArray(saved) ? saved : [];
    }
    catch { /* A damaged certificate keeps source follow-ups visible as unresolved. */ }
    for (const item of (record.state.followups ?? []).filter(value => value.status !== 'resolved')) {
      const choice = choices.find(value => value?.id === item.id);
      let destinationStatus = { status: 'none' };
      if (choice?.disposition === 'tracked') {
        if (record.retirementState.status === 'valid') destinationStatus = { status: 'current' };
        else {
          try {
            const observed = targetEntry(this.root, choice.destination, this.destinationBudget);
            destinationStatus = { status: isDeepStrictEqual(observed, choice.destination) ? 'current' : 'drifted' };
          } catch (error) { destinationStatus = { status: 'unavailable', reason: error.code ?? 'migration-followup-target-unavailable' }; }
        }
      } else if (!choice) destinationStatus = { status: 'unavailable', reason: 'migration-evidence-unavailable' };
      items.push({ runId: record.id, id: item.id, title: item.title ?? null, disposition: record.retirementState.status === 'valid' ? choice?.disposition ?? 'unresolved' : 'unavailable', destination: choice?.destination ?? null, destinationStatus, retirement: record.retirementState });
    }

    return items;
  }

  retiredFollowups() {
    this.load();

    return [...this.records.values()].flatMap(record => this.retiredFollowupsFor(record));
  }

  normalizeChoice(record, summary, choice, targetBudget) {
    requireCondition(choice?.runId === record.id && choice.disposition === `retired-${record.state.status}` && ['complete', 'stopped'].includes(record.state.status), 'migration-decision-unavailable', `Retirement choice for ${record.id} is missing or inconsistent`);
    requireCondition(record.classification === 'legacy' && !record.state.workers.some(workerIsActive), 'migration-decision-unavailable', `Delivery ${record.id} cannot be retired`);
    const report = summary.report;
    const reportKind = choice.report?.kind;
    const delivered = report.savedHash !== null && !report.owed;
    const validReport = reportKind === 'none' && !report.owed && report.savedHash === null || reportKind === 'already-delivered' && delivered || reportKind === 'confirmed' && report.owed && report.file.status === 'present' && report.file.sha256 === report.savedHash || reportKind === 'waived' && report.owed;
    requireCondition(validReport, 'migration-decision-unavailable', `Report disposition for ${record.id} is missing or inconsistent`);
    const pending = (record.state.followups ?? []).filter(item => item.status !== 'resolved');
    const selections = choice.followups ?? [];
    requireCondition(Array.isArray(selections) && selections.length === pending.length && selections.every(item => item && typeof item === 'object' && !Array.isArray(item) && typeof item.id === 'string') && new Set(selections.map(item => item.id)).size === pending.length, 'migration-decision-unavailable', `Pending follow-ups of ${record.id} need distinct dispositions`);
    const followups = pending.map(item => {
      const selected = selections.find(candidate => candidate.id === item.id);
      requireCondition(selected && ['tracked', 'dismissed'].includes(selected.disposition), 'migration-decision-unavailable', `Follow-up ${item.id} lacks a disposition`);
      const destination = selected.disposition === 'tracked' ? targetEntry(this.root, selected.destination, targetBudget) : null;
      requireCondition(selected.disposition !== 'dismissed' || selected.destination == null, 'migration-decision-unavailable', `Dismissed follow-up ${item.id} has a destination`);

      return { id: item.id, sourceHash: progress.fingerprint(item), disposition: selected.disposition, destination };
    }).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

    return { runId: record.id, disposition: choice.disposition, report: { kind: reportKind, sha256: report.savedHash }, followups };
  }

  manifest(ids, suppliedChoices, page = 0, includeFull = false) {
    this.validateCurrentEvidence();
    requireCondition(Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_APPROVAL_RECORDS && ids.every(id => typeof id === 'string') && new Set(ids).size === ids.length, 'migration-manifest-unavailable', 'Manifest needs one to 100 distinct delivery IDs');
    requireCondition(Number.isSafeInteger(page) && page >= 0, 'migration-manifest-unavailable', 'Manifest page must be nonnegative');
    const sorted = [...ids].sort();
    const reportBudget = { bytes: 0, maximum: MAX_BATCH_REPORT_BYTES };
    const hydrationBudget = { bytes: 0, maximum: MAX_INPUT_BYTES, expansionMaximum: MAX_EXPANDED_BYTES, visited: new Set(), artifactsAvailable: this.schema.tables.has('artifacts') };
    const targetBudget = { bytes: 0, maximum: MAX_TARGET_READ_BYTES, cache: new Map() };
    const records = sorted.map(id => this.summary(this.record(id), reportBudget, hydrationBudget));
    let choices = null;
    if (suppliedChoices !== undefined) {
      requireCondition(Array.isArray(suppliedChoices) && suppliedChoices.length === records.length && suppliedChoices.every(choice => choice && typeof choice === 'object' && !Array.isArray(choice) && typeof choice.runId === 'string') && new Set(suppliedChoices.map(choice => choice.runId)).size === records.length, 'migration-decision-unavailable', 'Manifest choices must cover each member once');
      choices = records.map(summary => this.normalizeChoice(this.record(summary.id), summary, suppliedChoices.find(choice => choice.runId === summary.id), targetBudget));
    }
    for (const [index, record] of records.entries()) {
      const memberBytes = Buffer.byteLength(JSON.stringify(progress.canonical({ record, choice: choices?.[index] ?? null })));
      requireCondition(memberBytes <= MAX_MANIFEST_BYTES, 'migration-manifest-unavailable', `Delivery ${record.id} cannot fit in an approval manifest`);
    }
    const approval = { schema: APPROVAL_SCHEMA, records, choices, storeInventoryHash: this.storeInventoryHash };
    const bytes = Buffer.byteLength(JSON.stringify(progress.canonical(approval)));
    requireCondition(bytes <= MAX_MANIFEST_BYTES, 'migration-manifest-unavailable', 'Approval manifest exceeds its byte bound');
    const pages = Math.ceil(records.length / PAGE_RECORDS);
    requireCondition(page < pages, 'migration-manifest-unavailable', 'Manifest page exceeds the batch');

    return { hash: choices ? progress.fingerprint(approval) : null, schema: APPROVAL_SCHEMA, storeInventoryHash: this.storeInventoryHash, ...(includeFull ? { approval } : {}), page, pages, members: records.slice(page * PAGE_RECORDS, (page + 1) * PAGE_RECORDS).map(record => ({ record, choice: choices?.find(choice => choice.runId === record.id) ?? null })) };
  }

  rawInspect(id, fromRevision, toRevision, report = false) {
    requireCondition(typeof id === 'string' && id.length > 0, 'migration-run-unavailable', 'Raw inspection needs an exact delivery ID');
    const size = this.db.prepare('SELECT length(CAST(state AS BLOB)) AS bytes FROM runs WHERE id=?').get(id)?.bytes;
    requireCondition(size !== undefined, 'migration-run-unavailable', `Delivery ${id} is absent`);
    requireCondition(size <= MAX_RAW_BYTES, 'migration-raw-bound', 'Raw inspection response exceeds its byte bound');
    const saved = this.db.prepare('SELECT id, revision, state FROM runs WHERE id=? AND length(CAST(state AS BLOB))<=?').get(id, MAX_RAW_BYTES);
    requireCondition(saved && Number.isSafeInteger(saved.revision) && saved.revision >= 0, 'migration-run-unavailable', `Delivery ${id} is absent or has an invalid revision`);
    const record = { id, revision: saved.revision, rawState: saved.state, state: parseState(saved.state, `Delivery ${id}`), retirement: this.schema.tables.has('legacy_retirements') ? this.db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(id)?.artifact ?? null : null };
    if (report) return { id, report: reportProjection(this.root, record.state, { bytes: 0, maximum: MAX_BATCH_REPORT_BYTES }, true) };
    fromRevision ??= record.revision;
    toRevision ??= fromRevision;
    requireCondition(Number.isSafeInteger(fromRevision) && fromRevision >= 0 && Number.isSafeInteger(toRevision) && toRevision >= fromRevision && toRevision - fromRevision < 10, 'invalid-history-range', 'Raw inspection spans at most ten revisions');
    const remaining = MAX_RAW_BYTES - Buffer.byteLength(record.rawState);
    const historyStats = this.db.prepare('SELECT coalesce(sum(length(CAST(state AS BLOB))), 0) AS bytes FROM history WHERE run_id=? AND revision BETWEEN ? AND ?').get(id, fromRevision, toRevision);
    requireCondition(historyStats.bytes <= remaining, 'migration-raw-bound', 'Raw history response exceeds its byte bound');
    const rows = this.db.prepare('SELECT revision, kind, recorded_at AS recordedAt, state FROM history WHERE run_id=? AND revision BETWEEN ? AND ? ORDER BY revision').all(id, fromRevision, toRevision);
    requireCondition(rows.length > 0 && rows[0].revision === fromRevision, 'invalid-history-range', 'Raw history start revision is missing');
    let bytes = Buffer.byteLength(record.rawState);
    requireCondition(bytes <= MAX_RAW_BYTES, 'migration-raw-bound', 'Raw inspection response exceeds its byte bound');
    const inspectState = body => {
      const budget = { bytes: 0, maximum: progress.MAX_FRONTIER_BYTES, visited: new Set(), referenced: new Set(), artifactsAvailable: this.schema.tables.has('artifacts') };
      let evidence = null;
      try { hydrateArtifact(this.db, parseState(body, 'Raw state'), new Set(), budget); }
      catch (error) { evidence = { code: error.code ?? 'invalid-evidence', message: error.message }; }

      return { artifacts: [...budget.referenced].sort(), evidence };
    };
    const current = { revision: record.revision, state: record.rawState, ...inspectState(record.rawState) };
    const history = rows.map(row => {
      bytes += Buffer.byteLength(row.state);
      requireCondition(bytes <= MAX_RAW_BYTES, 'migration-raw-bound', 'Raw history response exceeds its byte bound');
      return { ...row, ...inspectState(row.state) };
    });
    const chain = [];
    const seen = new Set();
    let previous = record.retirement;
    while (previous !== null) {
      const artifact = typeof previous === 'string' ? previous : null;
      try {
        requireCondition(progress.HASH.test(previous) && !seen.has(previous) && seen.size < progress.MAX_CREDITS, 'migration-raw-bound', 'Retirement inspection chain is malformed or exceeds its bound');
        seen.add(previous);
        const body = readArtifactBody(this.db, previous, Math.min(MAX_CERTIFICATE_BYTES, MAX_RAW_BYTES - bytes));
        bytes += Buffer.byteLength(body);
        const certificate = JSON.parse(body);
        chain.push({ artifact: previous, certificate });
        previous = certificate.supersedes;
      } catch (error) {
        chain.push({ artifact, reference: previous ?? null, diagnostic: { code: error.code ?? 'migration-evidence-unavailable', message: error.message } });
        break;
      }
    }

    const result = { id, current, retirement: record.retirement, chain, history };
    requireCondition(Buffer.byteLength(JSON.stringify(result)) <= MAX_RAW_BYTES, 'migration-raw-bound', 'Raw inspection response exceeds its byte bound');

    return result;
  }
}

module.exports = { LegacyInventory, MAX_INPUT_BYTES, MAX_MANIFEST_BYTES, MAX_RAW_BYTES, PAGE_RECORDS };
