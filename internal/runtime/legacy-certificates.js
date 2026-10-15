'use strict';

const { isDeepStrictEqual } = require('node:util');
const { requireBound, requireCondition } = require('./errors');
const { targetEntry, MAX_TARGET_READ_BYTES } = require('./legacy-backlog');
const approvalV1 = require('./legacy-approval-v1');
const { readArtifact, sha256 } = require('./legacy-store');
const progress = require('./progress');

const MAX_CERTIFICATE_BYTES = 8 * 1024;
const MAX_AUTHORITY_BYTES = 4 * 1024;
const MAX_CERTIFICATE_CHAIN_BYTES = 8 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_APPROVAL_RECORDS = 100;
const MAX_HISTORICAL_BYTES = 64 * 1024 * 1024;
const MAX_MANIFEST_CHAIN_BYTES = 64 * 1024 * 1024;
const APPROVAL_SCHEMA = 1;

function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function approvalFormat(schema) {
  if (schema === 1) return approvalV1;

  return null;
}

function approvedStateProjection(state, schema = APPROVAL_SCHEMA) {
  const format = approvalFormat(schema);
  requireCondition(format, 'migration-evidence-unavailable', `Unsupported approval projection schema ${schema}`);

  return format.projection(state);
}

function chargedArtifact(db, id, maximum, budget) {
  budget.cache ??= new Map();
  if (budget.cache.has(id)) return budget.cache.get(id);
  requireCondition(!budget.visited.has(id), 'migration-evidence-unavailable', `Migration artifact ${id} failed an earlier bounded read`);
  const remaining = budget.maximum - budget.bytes;
  const size = db.prepare('SELECT length(CAST(body AS BLOB)) AS bytes FROM artifacts WHERE id=?').get(id)?.bytes;
  requireCondition(Number.isSafeInteger(size), 'migration-evidence-unavailable', `Migration artifact ${id} is absent`);
  requireBound(size <= maximum && size <= remaining, 'migration-evidence-unavailable', `Migration artifact ${id} exceeds its read bound`);
  budget.bytes += size;
  budget.visited.add(id);
  const value = readArtifact(db, id, maximum);
  budget.cache.set(id, value);

  return value;
}

function savedFollowupsValid(state) {
  const items = state.followups === undefined ? [] : state.followups;
  return Array.isArray(items) && items.every(item => item && typeof item.id === 'string' && item.id.trim().length > 0 && ['pending', 'resolved'].includes(item.status)) && new Set(items.map(item => item.id)).size === items.length;
}

function followupsValid(root, state, choices, member, format, budget) {
  if (!format.followupsShape(state, choices, member)) return false;
  for (const choice of choices) {
    if (choice.disposition !== 'tracked') continue;
    const actual = targetEntry(root, choice.destination, budget);
    if (!isDeepStrictEqual(actual, choice.destination)) return false;
  }

  return true;
}

function validateMember(db, row, state, latest, certificate, manifests, historical = false) {
  requireCondition(exactKeys(certificate, ['schema', 'runId', 'revision', 'stateHash', 'historyHash', 'manifestHash', 'status', 'disposition', 'report', 'followups', 'authority', 'recordedAt', 'supersedes']), 'migration-certificate-stale', `Retirement certificate for ${row.id} has unsupported fields`);
  requireCondition(certificate?.schema === 1 && certificate.runId === row.id && certificate.revision === row.revision && progress.HASH.test(certificate.stateHash) && (historical || certificate.stateHash === sha256(row.state)) && certificate.historyHash === sha256(latest.state) && certificate.status === state.status && certificate.disposition === `retired-${state.status}` && ['complete', 'stopped'].includes(state.status) && typeof certificate.authority === 'string' && certificate.authority.trim() && Buffer.byteLength(certificate.authority) <= MAX_AUTHORITY_BYTES && typeof certificate.recordedAt === 'string' && !Number.isNaN(Date.parse(certificate.recordedAt)) && Array.isArray(certificate.followups) && (certificate.supersedes === null || typeof certificate.supersedes === 'string') && typeof certificate.manifestHash === 'string', 'migration-certificate-stale', `Retirement certificate for ${row.id} is stale or malformed`);
  const manifest = chargedArtifact(db, certificate.manifestHash, MAX_MANIFEST_BYTES, manifests);
  requireCondition(exactKeys(manifest, ['schema', 'records', 'choices', 'storeInventoryHash']) && progress.HASH.test(manifest.storeInventoryHash) && Array.isArray(manifest.records) && manifest.records.length > 0 && manifest.records.length <= MAX_APPROVAL_RECORDS && Array.isArray(manifest.choices) && manifest.choices.length === manifest.records.length, 'migration-evidence-unavailable', `Approved manifest for ${row.id} is malformed`);
  const format = approvalFormat(manifest.schema);
  requireCondition(format, 'migration-evidence-unavailable', `Approved manifest for ${row.id} has an unsupported projection schema`);
  for (let index = 0; index < manifest.records.length; index++) {
    const approved = manifest.records[index];
    const selected = manifest.choices[index];
    requireCondition(exactKeys(approved, format.MEMBER_KEYS) && exactKeys(selected, ['runId', 'disposition', 'report', 'followups']) && typeof approved.id === 'string' && approved.id.length > 0 && (index === 0 || manifest.records[index - 1].id < approved.id) && selected.runId === approved.id && Number.isSafeInteger(approved.revision) && approved.revision >= 0 && ['complete', 'stopped'].includes(approved.status) && approved.classification === 'legacy' && typeof approved.selected === 'boolean' && progress.HASH.test(approved.stateHash) && progress.HASH.test(approved.historyHash), 'migration-evidence-unavailable', `Approved manifest for ${row.id} has unsupported members`);
  }
  const members = manifest.records.filter(member => member.id === row.id);
  const choices = manifest.choices.filter(choice => choice.runId === row.id);
  requireCondition(members.length === 1 && choices.length === 1, 'migration-evidence-unavailable', `Approved manifest for ${row.id} has ambiguous membership`);
  const member = members[0];
  const choice = choices[0];
  requireCondition(member.revision === row.revision && member.stateHash === certificate.stateHash && member.historyHash === certificate.historyHash && member.status === state.status && choice.disposition === certificate.disposition && isDeepStrictEqual(choice.report, certificate.report) && isDeepStrictEqual(choice.followups, certificate.followups), 'migration-certificate-stale', `Approved manifest for ${row.id} contradicts its certificate`);
  requireCondition(format.matches(state, member) && format.reportValid(state, certificate.report, member) && format.followupsShape(state, certificate.followups, member), 'migration-certificate-stale', `Retirement disposition for ${row.id} is unsupported`);

  return { member, format };
}

function validateCertificate(db, root, row, state, latest, artifact, budgets = {}) {
  const chain = budgets.chain ??= { bytes: 0, maximum: MAX_CERTIFICATE_CHAIN_BYTES, visited: new Set(), cache: new Map() };
  const manifests = budgets.manifests ??= { bytes: 0, maximum: MAX_MANIFEST_BYTES, visited: new Set(), cache: new Map() };
  const history = budgets.history ?? { bytes: 0, maximum: MAX_HISTORICAL_BYTES, cache: new Map() };
  const certificate = chargedArtifact(db, artifact, MAX_CERTIFICATE_BYTES, chain);
  requireCondition(certificate && typeof certificate === 'object' && !Array.isArray(certificate), 'migration-certificate-stale', `Retirement certificate for ${row.id} is malformed`);
  const targetBudgets = budgets.targetsByManifest ?? new Map();
  if (!targetBudgets.has(certificate.manifestHash)) targetBudgets.set(certificate.manifestHash, { bytes: 0, maximum: MAX_TARGET_READ_BYTES, cache: new Map() });
  const targets = targetBudgets.get(certificate.manifestHash);
  const { member, format } = validateMember(db, row, state, latest, certificate, manifests);
  let historical;
  try { historical = JSON.parse(latest.state); }
  catch { requireCondition(false, 'migration-certificate-stale', `Retired delivery ${row.id} has unreadable latest history`); }
  requireCondition(state.progress === undefined && historical.progress === undefined && isDeepStrictEqual(state.stopRecovery, historical.stopRecovery) && !db.prepare('SELECT 1 FROM accounting_commits WHERE run_id=? LIMIT 1').get(row.id) && !db.prepare('SELECT 1 FROM discharge_index WHERE run_id=? LIMIT 1').get(row.id), 'migration-certificate-stale', `Retired delivery ${row.id} is no longer legacy`);
  requireCondition(followupsValid(root, state, certificate.followups, member, format, targets), 'migration-certificate-stale', `Pending follow-ups of ${row.id} changed or lost their tracking destination`);
  const seen = new Set([artifact]);
  let previous = certificate.supersedes;
  while (previous !== null) {
    requireCondition(progress.HASH.test(previous) && !seen.has(previous) && seen.size < progress.MAX_CREDITS, 'migration-evidence-unavailable', `Retirement history for ${row.id} is malformed`);
    seen.add(previous);
    const earlier = chargedArtifact(db, previous, MAX_CERTIFICATE_BYTES, chain);
    const key = `${row.id}:${earlier.revision}`;
    let saved = history.cache.get(key);
    if (!saved) {
      const remaining = history.maximum - history.bytes;
      const historicalSize = db.prepare('SELECT length(CAST(state AS BLOB)) AS bytes FROM history WHERE run_id=? AND revision=?').get(row.id, earlier.revision)?.bytes;
      requireCondition(historicalSize !== undefined, 'migration-evidence-unavailable', `Earlier history for retired delivery ${row.id} is missing`);
      requireBound(historicalSize <= remaining, 'migration-evidence-unavailable', `Earlier history for retired delivery ${row.id} exceeds its read bound`);
      const historicalRow = db.prepare('SELECT state FROM history WHERE run_id=? AND revision=? AND length(CAST(state AS BLOB))<=?').get(row.id, earlier.revision, remaining);
      requireCondition(historicalRow, 'migration-evidence-unavailable', `Earlier history for retired delivery ${row.id} changed during its bounded read`);
      history.bytes += Buffer.byteLength(historicalRow.state);
      let historicalState;
      try { historicalState = JSON.parse(historicalRow.state); }
      catch { requireCondition(false, 'migration-evidence-unavailable', `Earlier history for retired delivery ${row.id} is unreadable`); }
      requireCondition(historicalState?.id === row.id && historicalState.root === root && historicalState.revision === earlier.revision && Array.isArray(historicalState.tasks) && Array.isArray(historicalState.workers) && historicalState.progress === undefined, 'migration-evidence-unavailable', `Earlier history for retired delivery ${row.id} has unsupported state`);
      saved = { body: historicalRow.state, state: historicalState };
      history.cache.set(key, saved);
    }
    validateMember(db, { id: row.id, revision: earlier.revision, state: saved.body }, saved.state, { state: saved.body }, earlier, manifests, true);
    previous = earlier.supersedes;
  }

  return certificate;
}

module.exports = { APPROVAL_SCHEMA, MAX_APPROVAL_RECORDS, MAX_AUTHORITY_BYTES, MAX_CERTIFICATE_BYTES, MAX_CERTIFICATE_CHAIN_BYTES, MAX_HISTORICAL_BYTES, MAX_MANIFEST_BYTES, MAX_MANIFEST_CHAIN_BYTES, approvedStateProjection, savedFollowupsValid, validateCertificate };
