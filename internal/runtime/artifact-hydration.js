'use strict';

const { createHash } = require('node:crypto');
const { requireCondition } = require('./errors');

const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;

function hydrateArtifact(db, value, seen = new Set(), budget = null) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.hasOwn(value, '$artifact')) {
    const id = value.$artifact;
    if (budget?.referenced && typeof id === 'string') budget.referenced.add(id);
    requireCondition(Object.keys(value).length === 1 && /^[a-f0-9]{64}$/.test(id) && !seen.has(id), 'invalid-evidence', 'Immutable evidence envelope is malformed or recursive');
    if (budget?.artifactsAvailable === false) requireCondition(false, 'missing-evidence', 'Referenced immutable evidence is missing');
    const cached = budget?.cache?.get(id);
    if (cached) {
      budget.expandedBytes = (budget.expandedBytes ?? 0) + cached.bytes;
      requireCondition(budget.expandedBytes <= (budget.expansionMaximum ?? budget.maximum), 'migration-evidence-bound', 'Expanded referenced evidence exceeds the migration read bound');

      return hydrateArtifact(db, cached.value, new Set([...seen, id]), budget);
    }
    if (budget) requireCondition(!budget.visited.has(id), 'migration-evidence-bound', 'A previous referenced evidence read failed');
    const remaining = budget ? budget.maximum - budget.bytes : null;
    if (remaining !== null) {
      const size = db.prepare('SELECT length(CAST(body AS BLOB)) AS bytes FROM artifacts WHERE id=?').get(id)?.bytes;
      requireCondition(size !== undefined, 'missing-evidence', 'Referenced immutable evidence is missing');
      requireCondition(size <= remaining, 'migration-evidence-bound', 'Referenced evidence exceeds the migration read bound');
    }
    const row = remaining === null ? db.prepare('SELECT body FROM artifacts WHERE id=?').get(id) : db.prepare('SELECT body FROM artifacts WHERE id=? AND length(CAST(body AS BLOB))<=?').get(id, remaining);
    requireCondition(row, remaining === null ? 'missing-evidence' : 'migration-evidence-bound', remaining === null ? 'Referenced immutable evidence is missing' : 'Referenced evidence changed during the bounded read');
    requireCondition(createHash('sha256').update(row.body).digest('hex') === id, 'changed-evidence', 'Immutable evidence no longer matches its content identity');
    if (budget) {
      const size = Buffer.byteLength(row.body);
      budget.bytes += size;
      budget.visited.add(id);
      requireCondition(budget.bytes <= budget.maximum, 'migration-evidence-bound', 'Referenced evidence exceeds the migration read bound');
      budget.expandedBytes = (budget.expandedBytes ?? 0) + size;
      requireCondition(budget.expandedBytes <= (budget.expansionMaximum ?? budget.maximum), 'migration-evidence-bound', 'Expanded referenced evidence exceeds the migration read bound');
    }
    const parsed = JSON.parse(row.body);
    if (budget) {
      budget.cache ??= new Map();
      budget.cache.set(id, { bytes: Buffer.byteLength(row.body), value: parsed });
    }

    return hydrateArtifact(db, parsed, new Set([...seen, id]), budget);
  }
  if (Array.isArray(value)) return value.map(item => hydrateArtifact(db, item, seen, budget));

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrateArtifact(db, item, seen, budget)]));
}

module.exports = { MAX_EXPANDED_BYTES, hydrateArtifact };
