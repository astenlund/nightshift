'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const { acquireLock } = require('../unwrap-lock');
const { validateContext } = require('../releases/entry');
const { creationAssessment } = require('./creation-consistency');
const { MAX_TARGET_READ_BYTES, targetEntry } = require('./legacy-backlog');
const { requireCondition } = require('./errors');
const { MAX_AUTHORITY_BYTES, MAX_CERTIFICATE_BYTES, MAX_CERTIFICATE_CHAIN_BYTES, MAX_HISTORICAL_BYTES, MAX_MANIFEST_BYTES, MAX_MANIFEST_CHAIN_BYTES, validateCertificate } = require('./legacy-certificates');
const { LegacyInventory } = require('./legacy-inventory');
const { MAX_BATCH_REPORT_BYTES, reportProjection } = require('./legacy-report');
const { createSupport, readArtifact, sha256, verifyTriggers, writeArtifact } = require('./legacy-store');
const progress = require('./progress');

function databaseFile(root) {
  root = fs.realpathSync.native(root);
  const absent = () => {
    const legacy = path.join(root, '.claude/runs/state.sqlite');
    try { requireCondition(!fs.lstatSync(legacy, { throwIfNoEntry: false }), 'legacy-run-state', 'A legacy run store remains under .claude; complete setup migration before delivery retirement'); }
    catch (error) {
      if (error.code === 'legacy-run-state') throw error;
      requireCondition(false, 'migration-store-unavailable', `Cannot inspect the earlier run store: ${error.message}`);
    }

    return null;
  };
  let directory = root;
  for (const segment of ['.nightshift', 'runs']) {
    directory = path.join(directory, segment);
    let current;
    try { current = fs.lstatSync(directory, { throwIfNoEntry: false }); }
    catch (error) { requireCondition(false, 'migration-store-unavailable', `Cannot inspect delivery directory: ${error.message}`); }
    if (!current) return absent();
    requireCondition(current.isDirectory() && !current.isSymbolicLink() && fs.realpathSync.native(directory) === directory, 'migration-store-unavailable', `Delivery directory is linked or unsupported: ${directory}`);
  }
  const file = path.join(directory, 'state.sqlite');
  let metadata;
  try { metadata = fs.lstatSync(file, { throwIfNoEntry: false }); }
  catch (error) { requireCondition(false, 'migration-store-unavailable', `Cannot inspect the delivery store: ${error.message}`); }
  if (!metadata) {
    requireCondition(!['-journal', '-wal', '-shm'].some(suffix => fs.lstatSync(file + suffix, { throwIfNoEntry: false })), 'migration-store-unavailable', 'Delivery database is missing while SQLite sidecars survive');

    return absent();
  }
  requireCondition(metadata.isFile() && !metadata.isSymbolicLink() && metadata.nlink === 1, 'migration-store-unavailable', 'Run database must be an ordinary singly linked file');
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const sidecar = fs.lstatSync(file + suffix, { throwIfNoEntry: false });
    requireCondition(!sidecar || sidecar.isFile() && !sidecar.isSymbolicLink() && sidecar.nlink === 1, 'migration-store-unavailable', 'Run database sidecar must be an ordinary singly linked file');
  }

  return { root, file, directory };
}

function openDatabase(file, readOnly) {
  const db = new DatabaseSync(file, { readOnly });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    if (readOnly) db.exec('BEGIN');
    else db.exec('PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL');
  } catch (error) {
    db.close();
    throw error;
  }

  return db;
}

function requireAuthority(request, context) {
  requireCondition(typeof request.authority === 'string' && request.authority.trim() && Buffer.byteLength(request.authority) <= MAX_AUTHORITY_BYTES, 'migration-authority-required', 'Retirement needs a bounded exact user approval reply');
  requireCondition(progress.HASH.test(request.manifestHash), 'migration-manifest-unavailable', 'Retirement needs the approved manifest identity');
  requireCondition(request.actor && ['codex', 'claude'].includes(request.actor.host) && typeof request.actor.session === 'string' && request.actor.session.length > 0, 'migration-authority-required', 'Retirement needs its authenticated host session');
  if (context) requireCondition(request.actor.host === context.host && request.actor.session === context.session, 'migration-authority-required', 'Retirement actor differs from the admitted session');
}

function retryChoiceProjection(choices) {
  if (!Array.isArray(choices)) return null;
  const projected = [];
  for (const choice of choices) {
    const suppliedFollowups = choice?.followups ?? [];
    if (!choice || typeof choice.runId !== 'string' || !Array.isArray(suppliedFollowups)) return null;
    const followups = [];
    for (const item of suppliedFollowups) {
      if (!item || typeof item.id !== 'string') return null;
      followups.push({ id: item.id, disposition: item.disposition, destination: item.disposition === 'tracked' ? { path: item.destination?.path, anchor: item.destination?.anchor } : null });
    }
    projected.push({ runId: choice.runId, disposition: choice.disposition, reportKind: choice.report?.kind, followups: followups.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0) });
  }

  return projected.sort((left, right) => left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0);
}

function existingRetry(db, inventory, request) {
  if (!inventory.schema.tables.has('legacy_retirements')) return null;
  if (!Array.isArray(request.ids) || request.ids.length === 0 || new Set(request.ids).size !== request.ids.length) return null;
  verifyTriggers(db, inventory.schema.tables);
  const certificates = [];
  const budgets = { chain: { bytes: 0, maximum: MAX_CERTIFICATE_CHAIN_BYTES, visited: new Set() }, manifests: { bytes: 0, maximum: MAX_MANIFEST_CHAIN_BYTES, visited: new Set() }, history: { bytes: 0, maximum: MAX_HISTORICAL_BYTES, cache: new Map() }, targetsByManifest: new Map() };
  let originalManifest = null;
  for (const id of request.ids) {
    const row = db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(id);
    if (!row) return null;
    const certificate = readArtifact(db, row.artifact, MAX_CERTIFICATE_BYTES);
    if (certificate.runId !== id || certificate.manifestHash !== request.manifestHash || certificate.authority !== request.authority) return null;
    if (originalManifest === null) originalManifest = readArtifact(db, certificate.manifestHash, MAX_MANIFEST_BYTES);
    const record = inventory.record(id);
    validateCertificate(db, inventory.root, { id, revision: record.revision, state: record.rawState }, record.state, { state: record.rawHistory }, row.artifact, budgets);
    certificates.push({ runId: id, artifact: row.artifact });
  }
  if (!isDeepStrictEqual([...request.ids].sort(), originalManifest.records?.map(record => record.id)) || !isDeepStrictEqual(retryChoiceProjection(request.choices), retryChoiceProjection(originalManifest.choices))) return null;

  return { state: 'already-retired', manifestHash: request.manifestHash, certificates };
}

function resourcePreflight(db, root, requiredRetirements) {
  return creationAssessment({ db, root, kind: 'delivery', writing: true }, { resourceOnly: true, requiredRetirements: new Set(requiredRetirements) });
}

function fixtureRetirementAllowed(root, inventory, dependencies) {
  if (dependencies.fixtureRetirement !== true) return false;
  const fixtures = path.resolve(__dirname, '../../.tmp/runtime-legacy-migration');
  const relative = path.relative(fixtures, root);

  return relative.length > 0 && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && [...inventory.records.values()].every(record => record.state.resourceMode === 'development' && !record.state.resources && !record.state.executionResources);
}

function retire(root, db, request, context, dependencies = {}) {
  requireAuthority(request, context);
  if (!context) requireCondition(fixtureRetirementAllowed(root, new LegacyInventory(root, db).load(), dependencies), 'migration-admission-required', 'Retirement requires current administrative admission; only isolated deterministic fixtures may use the development core');
  const lock = acquireLock(path.join(root, '.nightshift/runs'), { name: 'write-ownership.sqlite', label: 'runtime project', codePrefix: 'runtime-ownership' });
  try {
    db.exec('BEGIN IMMEDIATE');
    try {
      const inventory = new LegacyInventory(root, db).load();
      requireCondition(context || fixtureRetirementAllowed(root, inventory, dependencies), 'migration-admission-required', 'Retirement requires current administrative admission; only isolated deterministic fixtures may use the development core');
      const retry = existingRetry(db, inventory, request);
      if (retry) {
        db.exec('ROLLBACK');

        return retry;
      }
      const proposed = inventory.manifest(request.ids, request.choices, 0, true);
      requireCondition(proposed.hash === request.manifestHash, 'migration-manifest-stale', 'The approved manifest differs from the current delivery store or its proposed choices');
      dependencies.afterManifest?.();
      const approval = proposed.approval;
      createSupport(db, inventory.schema);
      const manifestHash = writeArtifact(db, approval);
      requireCondition(manifestHash === request.manifestHash, 'migration-manifest-stale', 'The saved approval manifest changed during retirement');
      const certificates = [];
      for (const choice of approval.choices) {
        const record = inventory.record(choice.runId);
        const previous = inventory.retirements.get(choice.runId) ?? null;
        if (previous) readArtifact(db, previous, MAX_CERTIFICATE_BYTES);
        const certificate = { schema: 1, runId: record.id, revision: record.revision, stateHash: sha256(record.rawState), historyHash: sha256(record.rawHistory), manifestHash, status: record.state.status, disposition: choice.disposition, report: choice.report, followups: choice.followups, authority: request.authority, recordedAt: new Date().toISOString(), supersedes: previous };
        const certificateBytes = Buffer.byteLength(JSON.stringify(progress.canonical(certificate)));
        requireCondition(certificateBytes <= MAX_CERTIFICATE_BYTES, 'migration-certificate-bound', `Retirement certificate for ${record.id} exceeds 8 KiB; obtain a shorter exact approval reply. If it still cannot fit, keep the run unretired until a separately authorized certificate-limit change is delivered`);
        const artifact = writeArtifact(db, certificate, MAX_CERTIFICATE_BYTES);
        db.prepare('INSERT INTO legacy_retirements VALUES (?, ?) ON CONFLICT(run_id) DO UPDATE SET artifact=excluded.artifact').run(record.id, artifact);
        certificates.push({ runId: record.id, artifact });
      }
      resourcePreflight(db, root, approval.choices.map(choice => choice.runId));
      dependencies.afterResourcePreflight?.();
      const reportBudget = { bytes: 0, maximum: MAX_BATCH_REPORT_BYTES };
      for (const member of approval.records) {
        const observed = reportProjection(root, inventory.record(member.id).state, reportBudget);
        requireCondition(isDeepStrictEqual(observed, member.report), 'migration-manifest-stale', `Saved report for ${member.id} changed before retirement committed`);
      }
      const targetBudget = { bytes: 0, maximum: MAX_TARGET_READ_BYTES, cache: new Map() };
      for (const choice of approval.choices) {
        for (const followup of choice.followups) {
          if (followup.disposition !== 'tracked') continue;
          const observed = targetEntry(root, followup.destination, targetBudget);
          requireCondition(isDeepStrictEqual(observed, followup.destination), 'migration-manifest-stale', `Tracked follow-up destination for ${choice.runId} changed before retirement committed`);
        }
      }
      lock.validate();
      db.exec('COMMIT');

      return { state: 'retired', manifestHash, certificates };
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally { lock.close(); }
}

function execute(project, request, context = null, dependencies = {}) {
  if (request.action === 'retire' && !context && dependencies.fixtureRetirement !== true) requireCondition(false, 'migration-admission-required', 'Retirement requires current administrative admission');
  if (context) {
    requireCondition(context.administrative === true, 'migration-admission-required', 'Migration requires current administrative admission');
    validateContext(context, path.resolve(__dirname, '../..'), project, true, { action: request.action, hash: sha256(Buffer.from(JSON.stringify(request))) });
  }
  const located = databaseFile(project);
  if (!located) {
    requireCondition(request.action === 'inventory', 'migration-store-unavailable', 'No delivery store exists in this project');

    return { state: 'no-delivery-store', total: 0, counts: { legacy: 0, modern: 0, damagedModern: 0, retired: 0, unavailableRetirements: 0 } };
  }
  const readOnly = request.action !== 'retire';
  const db = openDatabase(located.file, readOnly);
  try {
    const inventory = new LegacyInventory(located.root, db);
    if (request.action === 'inventory') return inventory.inventory(request.page ?? 0);
    if (request.action === 'manifest') return inventory.manifest(request.ids, request.choices, request.page ?? 0);
    if (request.action === 'raw-inspect') return inventory.rawInspect(request.runId, request.fromRevision, request.toRevision, request.report === true);
    if (request.action === 'retire') return retire(located.root, db, request, context, dependencies);
    requireCondition(false, 'invalid-migration-request', 'Unknown migration action');
  } finally {
    if (readOnly) db.exec('ROLLBACK');
    db.close();
  }
}

module.exports = { execute };
