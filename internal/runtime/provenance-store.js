'use strict';

const { createHash } = require('node:crypto');
const { requireCondition } = require('./errors');
const progress = require('./progress');
const discharge = require('./discharge');

class ProvenanceStore {
  constructor(accounting) { this.accounting = accounting; this.store = accounting.store; }

  artifact(value) {
    const body = JSON.stringify(progress.canonical(value));
    requireCondition(Buffer.byteLength(body) <= progress.MAX_FRONTIER_BYTES, 'progress-evidence-unavailable', 'Provenance artifact exceeds its bound');
    const id = createHash('sha256').update(body).digest('hex');
    const existing = this.store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(id);
    requireCondition(!existing || existing.body === body, 'progress-artifact-unavailable', 'Existing provenance artifact is corrupt');
    this.store.db.prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?)').run(id, body);
    return id;
  }

  read(state, budget) {
    const row = this.store.db.prepare('SELECT artifact FROM accounting_commits WHERE run_id=? AND revision=?').get(state.id, state.revision);
    if (!row) {
      requireCondition(!this.store.db.prepare('SELECT 1 FROM accounting_commits WHERE run_id=? LIMIT 1').get(state.id), 'progress-history-unavailable', 'An established run has a missing independent provenance revision');
      this.requireLegacy(state);
      return null;
    }
    const record = this.accounting.artifact(row.artifact, budget);
    requireCondition(record.schema === 1 && record.runId === state.id && record.revision === state.revision && record.predecessor === (state.revision === 0 ? null : state.revision - 1) && record.encodedHash === progress.encodedHash(state), 'progress-history-unavailable', 'Independent accounting provenance contradicts the substantive state');
    requireCondition(['current', 'unavailable'].includes(record.status) && Array.isArray(record.admissions) && record.admissions.length <= progress.MAX_CREDITS && record.bindings && typeof record.bindings === 'object' && !Array.isArray(record.bindings) && Object.keys(record.bindings).length <= progress.MAX_CREDITS, 'progress-evidence-unavailable', 'Independent accounting provenance is malformed');
    return record;
  }

  // Independent provenance ships with schema-2 accounting, so only a record saved by an earlier release, without schema-2
  // accounting, is legacy. A schema-2 record or surviving discharge provenance without independent provenance rows means
  // those rows were lost, and the accounting stays unavailable whatever the remaining metadata claims.
  requireLegacy(state) {
    requireCondition(state.progress?.schema !== 2, 'progress-history-unavailable', 'A run saved with schema-2 accounting lost its independent provenance rows');
    requireCondition(!this.store.db.prepare('SELECT 1 FROM discharge_index WHERE run_id=? LIMIT 1').get(state.id), 'progress-history-unavailable', 'A run with surviving discharge provenance lost its independent provenance rows');
  }

  known(reference, fact, runId, budget) {
    const record = this.accounting.artifact(reference, budget);
    requireCondition(record.schema === 1 && record.runId === runId && Number.isSafeInteger(record.revision) && record.revision >= 0 && record.occurrence === fact.occurrence && record.evidenceHash === fact.evidenceHash && progress.fingerprint(record.binding) === progress.fingerprint(fact.binding), 'progress-evidence-unavailable', 'Closing evidence differs from its original discharge');
    requireCondition(fact.source === null || record.parent === fact.source, 'progress-evidence-unavailable', 'Collected evidence contradicts its originating record');
    return record;
  }

  resolve(previous, state, account, registrations = new Map(), budget) {
    const old = previous ? this.read(previous, budget) : null;
    requireCondition(!old || old.status === 'current', 'progress-evidence-unavailable', 'Unresolved provenance cannot become trusted through another save');
    const facts = discharge.inventory(state);
    requireCondition(facts.size <= progress.MAX_CREDITS, 'progress-evidence-unavailable', 'Closing admission inventory exceeds its bound');
    const bindings = {};
    const admissions = [];
    const records = new Map();
    for (const [occurrence, fact] of facts) {
      requireCondition(progress.validClosingBinding(fact.binding, state.id), 'progress-evidence-unavailable', 'Closing evidence lacks a valid original binding');
      const prior = old?.bindings[occurrence];
      if (registrations.has(occurrence)) {
        const parent = fact.parent === null ? null : bindings[fact.parent] ?? old?.bindings[fact.parent];
        requireCondition(fact.source === null || fact.source === parent, 'progress-evidence-unavailable', 'Collected discharge belongs to another originating record');
        requireCondition(fact.parent === null || progress.HASH.test(parent), 'progress-evidence-unavailable', 'Admitted closing evidence has no proven parent');
        const expected = parent ? (records.get(parent) ?? this.accounting.artifact(parent, budget)).binding : progress.closingBinding(state.id, account.frontier.closingBasis);
        requireCondition(progress.fingerprint(expected) === progress.fingerprint(fact.binding), 'progress-evidence-unavailable', 'Admitted closing evidence contradicts its parent context');
        const record = { schema: 1, runId: state.id, revision: state.revision, occurrence, evidenceHash: fact.evidenceHash, binding: fact.binding, parent };
        const id = createHash('sha256').update(JSON.stringify(progress.canonical(record))).digest('hex');
        records.set(id, record);
        bindings[occurrence] = id;
        admissions.push(id);
      } else if (prior) {
        this.known(prior, fact, state.id, budget);
        bindings[occurrence] = prior;
      } else {
        const candidates = this.store.db.prepare('SELECT artifact FROM discharge_index WHERE run_id=? AND occurrence=? AND evidence_hash=? AND binding_hash=? LIMIT 2').all(state.id, occurrence, fact.evidenceHash, progress.fingerprint(fact.binding));
        requireCondition(candidates.length === 1, 'progress-evidence-unavailable', 'Retained evidence has no unambiguous original discharge');
        this.known(candidates[0].artifact, fact, state.id, budget);
        bindings[occurrence] = candidates[0].artifact;
      }
    }
    return { bindings, admissions: [...new Set(admissions)].sort(), records };
  }

  establishLegacy(state, account) {
    const bindings = {};
    for (const [occurrence, fact] of discharge.inventory(state)) {
      requireCondition(progress.validClosingBinding(fact.binding, state.id), 'progress-evidence-unavailable', 'Legacy checkpoint has unknown closing provenance');
      const parent = fact.parent === null ? null : bindings[fact.parent];
      requireCondition(fact.parent === null || progress.HASH.test(parent), 'progress-evidence-unavailable', 'Legacy checkpoint has unknown carried ancestry');
      const record = { schema: 1, runId: state.id, revision: state.revision, occurrence, evidenceHash: fact.evidenceHash, binding: fact.binding, parent };
      const id = this.artifact(record);
      this.store.db.prepare('INSERT OR IGNORE INTO discharge_index VALUES (?, ?, ?, ?, ?)').run(state.id, occurrence, fact.evidenceHash, progress.fingerprint(fact.binding), id);
      bindings[occurrence] = id;
    }
    this.persist(state, account, { bindings, admissions: [] });
  }

  verify(state, budget) {
    const checkpoint = this.read(state, budget);
    requireCondition(checkpoint?.status === 'current', 'progress-evidence-unavailable', 'Compact reminder has no independent checkpoint');
    const facts = discharge.inventory(state);
    const visited = new Map();
    let bytes = 0;
    const ancestry = (reference, depth = 0, chain = new Set()) => {
      requireCondition(progress.HASH.test(reference) && depth < 128 && !chain.has(reference), 'progress-evidence-unavailable', 'Discharge ancestry is malformed or recursive');
      if (visited.has(reference)) return visited.get(reference);
      const record = this.accounting.artifact(reference, budget);
      bytes += Buffer.byteLength(JSON.stringify(record));
      requireCondition(bytes <= progress.MAX_FRONTIER_BYTES && visited.size < progress.MAX_CREDITS && record.schema === 1 && record.runId === state.id && Number.isSafeInteger(record.revision) && record.revision >= 0 && record.revision <= state.revision && progress.HASH.test(record.evidenceHash) && typeof record.occurrence === 'string' && progress.validClosingBinding(record.binding, state.id), 'progress-evidence-unavailable', 'Discharge ancestry is unsupported, foreign or exceeds its bound');
      if (record.parent !== null) {
        const parent = ancestry(record.parent, depth + 1, new Set([...chain, reference]));
        requireCondition(progress.fingerprint(parent.binding) === progress.fingerprint(record.binding), 'progress-evidence-unavailable', 'Discharge ancestry changes its original context');
      } else requireCondition(record.occurrence === 'retrospective', 'progress-evidence-unavailable', 'Only retrospective can root a closing cycle');
      visited.set(reference, record);
      return record;
    };
    requireCondition(Object.keys(checkpoint.bindings).length === facts.size, 'progress-evidence-unavailable', 'Independent binding inventory differs from current evidence');
    for (const [occurrence, fact] of facts) {
      const reference = checkpoint.bindings[occurrence];
      this.known(reference, fact, state.id, budget);
      ancestry(reference);
    }
    return structuredClone(checkpoint.bindings);
  }

  persist(state, account, provenance) {
    if (account.marker.status === 'current') {
      for (const [expected, discharge] of provenance?.records ?? []) {
        const id = this.artifact(discharge);
        requireCondition(id === expected, 'progress-evidence-unavailable', 'Discharge changed before commit');
        this.store.db.prepare('INSERT OR IGNORE INTO discharge_index VALUES (?, ?, ?, ?, ?)').run(state.id, discharge.occurrence, discharge.evidenceHash, progress.fingerprint(discharge.binding), id);
      }
    }
    const record = { schema: 1, runId: state.id, revision: state.revision, predecessor: state.revision === 0 ? null : state.revision - 1, encodedHash: progress.encodedHash(state), status: account.marker.status, reason: account.marker.reason, bindings: provenance?.bindings ?? {}, admissions: provenance?.admissions ?? [], marker: account.marker, reminder: account.reminder ?? null };
    const artifact = this.artifact(record);
    this.store.db.prepare('INSERT INTO accounting_commits VALUES (?, ?, ?)').run(state.id, state.revision, artifact);
  }
}

module.exports = { ProvenanceStore };
