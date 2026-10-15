'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { stableOpenFile } = require('../filesystem-primitives');
const { relativePath } = require('../releases/io');
const { projectFile } = require('./evidence');
const { requireCondition } = require('./errors');
const { HASH } = require('./progress');
const { validReportDelivery } = require('./report-delivery');

const REPORT_DIRECTORY = '.nightshift/runs/reports/';
const MAX_REPORT_BYTES = 1024 * 1024;
const MAX_BATCH_REPORT_BYTES = 16 * 1024 * 1024;

function unavailable(reason, savedHash, owed) {
  return { owed, savedHash, file: { status: 'unavailable', sha256: null, reason } };
}

function savedReportHash(evidence) {
  return typeof evidence?.sha256 === 'string' && HASH.test(evidence.sha256) ? evidence.sha256 : null;
}

function reportProjection(root, state, budget = { bytes: 0, maximum: MAX_BATCH_REPORT_BYTES }, includeText = false) {
  root = fs.realpathSync.native(root);
  const evidence = state.closing?.reportEvidence ?? null;
  const savedHash = savedReportHash(evidence);
  const delivered = validReportDelivery(state, savedHash);
  const owed = (Boolean(state.handover) || evidence !== null) && !delivered;
  if (evidence === null) return { owed, savedHash: null, file: { status: 'none', sha256: null, reason: null } };
  if (typeof evidence.path !== 'string') return unavailable('unsafe-path', savedHash, owed);
  let target;
  try {
    relativePath(evidence.path);
    requireCondition(evidence.path.startsWith(REPORT_DIRECTORY) && evidence.path.endsWith('.md'), 'unsafe-path', 'Saved report path is outside the report directory');
    projectFile(root, path.posix.dirname(evidence.path));
    target = path.join(root, evidence.path);
  } catch (error) {
    return unavailable(['unsafe-path', 'unsafe-release-path'].includes(error.code) ? 'unsafe-path' : 'read-error', savedHash, owed);
  }
  let metadata;
  try { metadata = fs.lstatSync(target, { throwIfNoEntry: false }); }
  catch { return unavailable('read-error', savedHash, owed); }
  if (metadata?.isSymbolicLink() || metadata && metadata.nlink !== 1) return unavailable('linked', savedHash, owed);
  if (metadata && !metadata.isFile()) return unavailable('special', savedHash, owed);
  try { target = projectFile(root, evidence.path); }
  catch { return unavailable('unsafe-path', savedHash, owed); }
  if (!metadata) return { owed, savedHash, file: { status: 'missing', sha256: null, reason: 'missing' } };
  if (metadata.size > MAX_REPORT_BYTES) return unavailable('oversized', savedHash, owed);
  requireCondition(budget.bytes + metadata.size <= budget.maximum, 'migration-report-bound', 'Report-file reads exceed the manifest byte bound');
  let opened;
  try { opened = stableOpenFile(root, target, { requireSingleLink: true, maxBytes: MAX_REPORT_BYTES }); }
  catch (error) {
    if (error.code === 'file-too-large') return unavailable('oversized', savedHash, owed);
    return unavailable(error.code === 'identity-changed' ? 'changed-during-read' : 'read-error', savedHash, owed);
  }
  requireCondition(budget.bytes + opened.bytes.length <= budget.maximum, 'migration-report-bound', 'Report-file reads exceed the manifest byte bound');
  budget.bytes += opened.bytes.length;
  const projection = { owed, savedHash, file: { status: 'present', sha256: opened.rawSha256, reason: null } };
  if (includeText && opened.rawSha256 === savedHash) {
    try { projection.text = new TextDecoder('utf-8', { fatal: true }).decode(opened.bytes); }
    catch { return unavailable('read-error', savedHash, owed); }
  }

  return projection;
}

module.exports = { MAX_BATCH_REPORT_BYTES, MAX_REPORT_BYTES, reportProjection, savedReportHash };
