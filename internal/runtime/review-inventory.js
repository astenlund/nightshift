'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { UUID } = require('./record-ids');
const { RUN_STORE_WAIT_MS, STORE_VERSIONS } = require('./store');
const { requireCondition } = require('./errors');

const REVIEW_REFERENCE_PREFIX = 'review:';
// Formats whose records the inventory can read; anything else, including a future format, is unsupported state that holds
// retirement and collection back rather than being read as an inventory.
const READABLE_VERSIONS = Object.freeze(STORE_VERSIONS.filter(version => version > 0));

function referenceId(record) {
  return record.kind === 'review' ? REVIEW_REFERENCE_PREFIX + record.id : record.id;
}

function reviewId(reference) {
  if (typeof reference !== 'string' || !reference.startsWith(REVIEW_REFERENCE_PREFIX)) return null;
  const id = reference.slice(REVIEW_REFERENCE_PREFIX.length);
  requireCondition(UUID.test(id), 'review-resource-state-unavailable', 'Review resource references require a namespaced UUID');
  return id;
}

function requestedReferenceId(request) {
  return require('./targets').runtimeTarget(request).reference;
}

function reviewDatabase(root, waitMs) {
  const file = path.join(root, '.nightshift/runs/review-state.sqlite');
  if (!fs.existsSync(file)) return null;
  requireCondition(fs.realpathSync.native(root) === root, 'review-resource-state-unavailable', 'Review project root changed');
  const stat = fs.lstatSync(file);
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'review-resource-state-unavailable', 'Review database must be an ordinary unlinked file');
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    database.exec(`PRAGMA busy_timeout=${waitMs};`);
    const version = database.prepare('PRAGMA user_version').get().user_version;
    requireCondition(READABLE_VERSIONS.includes(version), 'review-resource-state-unavailable', `Unsupported review database version ${version}`);
  } catch (error) {
    database.close();
    throw error;
  }

  return database;
}

function parseReviewState(row, root) {
  const state = JSON.parse(row.state);
  requireCondition(state?.schema === 1 && state.kind === 'review' && state.root === root && state.id === row.id && UUID.test(state.id) && state.controller && ['running', 'complete', 'stopped'].includes(state.status) && Array.isArray(state.workers), 'review-resource-state-unavailable', 'Review reference state is unsupported or incomplete');
  return state;
}

function readReviewStore(root, waitMs = RUN_STORE_WAIT_MS) {
  const database = reviewDatabase(root, waitMs);
  if (!database) return null;
  try {
    const rows = database.prepare('SELECT id, state FROM runs LIMIT 10001').all();
    requireCondition(rows.length <= 10000, 'review-resource-state-unavailable', 'Review inventory exceeds the reconciliation bound');
    return rows.map(row => parseReviewState(row, root));
  } finally { database.close(); }
}

function readReviewReference(root, reference, waitMs = RUN_STORE_WAIT_MS) {
  const id = reviewId(reference);
  requireCondition(id, 'review-resource-state-unavailable', 'Expected a review resource reference');
  const database = reviewDatabase(root, waitMs);
  if (!database) return null;
  try {
    const row = database.prepare('SELECT id, state FROM runs WHERE id=?').get(id);
    return row ? parseReviewState(row, root) : null;
  } finally { database.close(); }
}

module.exports = { REVIEW_REFERENCE_PREFIX, referenceId, reviewId, requestedReferenceId, readReviewStore, readReviewReference };
