'use strict';

const { createHash } = require('node:crypto');
const { requireCondition } = require('./errors');
const { recordKind } = require('./records');
const progress = require('./progress');

function unavailable(state, previous, reason) {
  return {
    marker: { schema: 2, runId: state.id, atRevision: state.revision, token: progress.HASH.test(previous?.marker?.token) ? previous.marker.token : null, frontierHash: progress.HASH.test(previous?.marker?.frontierHash) ? previous.marker.frontierHash : null, encodedHash: progress.encodedHash(state), reminderHash: progress.HASH.test(previous?.marker?.reminderHash) ? previous.marker.reminderHash : null, status: 'unavailable', reason },
    reminder: previous?.reminder,
  };
}

class ProgressStore {
  constructor(store) { this.store = store; }

  artifact(id, budget) {
    requireCondition(progress.HASH.test(id), 'progress-artifact-unavailable', 'Accounting artifact identity is malformed');
    const row = this.store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(id);
    requireCondition(row && createHash('sha256').update(row.body).digest('hex') === id, 'progress-artifact-unavailable', 'Accounting artifact is missing or changed');
    if (budget) {
      if (!budget.artifacts.has(id)) {
        budget.bytes += Buffer.byteLength(row.body);
        budget.artifacts.add(id);
      }
      // Every access rechecks the allowance, so an exhausted budget cannot be reused by revisiting an artifact already charged.
      requireCondition(budget.bytes <= (budget.artifactLimit ?? progress.MAX_RECOVERY_BYTES), 'progress-history-limit', 'Accounting recovery exceeded its byte bound');
    }
    return JSON.parse(row.body);
  }

  resolve(value, budget, seen = new Set()) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, '$artifact')) return value;
    requireCondition(Object.keys(value).length === 1 && !seen.has(value.$artifact), 'progress-artifact-unavailable', 'Accounting evidence envelope is malformed or recursive');
    seen.add(value.$artifact);
    return this.resolve(this.artifact(value.$artifact, budget), budget, seen);
  }

  frontier(state, budget) {
    return progress.validateFrontier(this.artifact(state.progress.frontierHash, budget), state.id);
  }

  identity(state, revision) {
    requireCondition(state?.schema === 1 && state.id && state.root === this.store.root && recordKind(state) === 'delivery' && state.revision === revision && Number.isSafeInteger(revision) && revision >= 0, 'progress-history-unavailable', 'Accounting row identity or revision is invalid');
  }

  committed(state) {
    const row = this.store.db.prepare('SELECT revision, kind, state FROM history WHERE run_id=? AND revision=?').get(state.id, state.revision);
    requireCondition(row, 'progress-history-unavailable', 'Accounting predecessor history is missing');
    const recorded = JSON.parse(row.state);
    this.identity(recorded, row.revision);
    requireCondition(progress.encodedHash(recorded) === progress.encodedHash(state), 'progress-history-unavailable', 'Accounting predecessor contradicts its committed history');
    return { ...row, state: recorded };
  }

  reminderProvenance(state, budget) {
    const reminder = state.stopRecovery;
    requireCondition(state.progress.reminderHash === progress.reminderHash(state.id, reminder), 'progress-reminder-unavailable', 'Reminder presence or absence differs from its established binding');
    if (!reminder) return undefined;
    requireCondition(progress.validReminder(reminder, state), 'progress-reminder-unavailable', 'Accounting reminder is malformed');
    const row = this.store.db.prepare('SELECT revision, kind, state FROM history WHERE run_id=? AND revision=?').get(state.id, reminder.atRevision);
    requireCondition(row?.kind === 'continuation-reminder', 'progress-reminder-unavailable', 'Accounting reminder has no committed issuance');
    if (budget) {
      if (budget.chargeInput) budget.chargeInput(row.state);
      else {
        budget.bytes += Buffer.byteLength(row.state);
        requireCondition(budget.bytes <= progress.MAX_RECOVERY_BYTES, 'progress-history-limit', 'Accounting recovery exceeded its byte bound');
      }
    }
    const issuing = JSON.parse(row.state);
    this.identity(issuing, row.revision);
    const provenance = new (require('./provenance-store').ProvenanceStore)(this).read(issuing, budget);
    if (provenance?.status === 'current') {
      issuing.progress = provenance.marker;
      if (provenance.reminder) issuing.stopRecovery = provenance.reminder;
      else delete issuing.stopRecovery;
    }
    const legacy = issuing.stopRecovery;
    const recoveredLegacy = legacy && !Object.hasOwn(legacy, 'schema') && legacy.revision === row.revision && Number.isSafeInteger(legacy.reminders) && legacy.reminders >= 1 && legacy.reminders <= reminder.reminders;
    requireCondition(recoveredLegacy || progress.validMarker(issuing) && issuing.progress.reminderHash === progress.reminderHash(state.id, reminder) && issuing.progress.token === reminder.token, 'progress-reminder-unavailable', 'Accounting reminder does not match its issuance');
    return structuredClone(reminder);
  }

  checkpoint(state, budget) {
    requireCondition(progress.validMarker(state), 'progress-marker-unavailable', 'Accounting marker is absent, stale or malformed');
    return { marker: structuredClone(state.progress), frontier: this.frontier(state, budget), reminder: this.reminderProvenance(state, budget) };
  }

  initial(state, budget) {
    const facts = progress.semanticFacts(state, value => this.resolve(value, budget));
    const frontier = progress.validateFrontier({ schema: 2, runId: state.id, ...facts }, state.id);
    return { marker: { schema: 2, runId: state.id, atRevision: state.revision, token: progress.fingerprint({ schema: 1, runId: state.id, initial: facts.credits }), frontierHash: null, encodedHash: progress.encodedHash(state), reminderHash: progress.reminderHash(state.id, null), status: 'current', reason: null }, frontier, reminder: undefined };
  }

  step(previousState, state, account, budget, registrations) {
    progress.validateClosingTransition(previousState, state, account.frontier);
    const provenance = new (require('./provenance-store').ProvenanceStore)(this).resolve(previousState, state, account, registrations, budget);
    const facts = progress.semanticFacts(state, value => this.resolve(value, budget));
    const known = new Set(account.frontier.credits);
    const added = facts.credits.filter(credit => !known.has(credit));
    const delta = [...added, ...progress.controlDelta(previousState, state).map(progress.fingerprint)];
    const frontier = progress.validateFrontier({ schema: 2, runId: state.id, credits: [...new Set([...known, ...added])].sort(), closingBasis: [...new Set([...account.frontier.closingBasis, ...facts.closingBasis])].sort() }, state.id);
    const token = delta.length ? progress.fingerprint({ previous: account.marker.token, delta: delta.sort() }) : account.marker.token;
    return { marker: { schema: 2, runId: state.id, atRevision: state.revision, token, frontierHash: null, encodedHash: progress.encodedHash(state), reminderHash: account.marker.reminderHash, status: 'current', reason: null }, frontier, reminder: account.reminder, provenance };
  }

  // A caller supplying its own input allowance, as creation does, has replayed history charged there while one record's replay
  // still stays within the recovery byte bound; otherwise history and artifacts share one combined recovery budget.
  recover(state, budget = { bytes: 0, artifacts: new Set() }) {
    const rows = this.store.db.prepare('SELECT revision, kind, length(CAST(state AS BLOB)) AS bytes FROM history WHERE run_id=? AND revision<=? ORDER BY revision DESC LIMIT ?').all(state.id, state.revision, progress.MAX_RECOVERY_REVISIONS);
    requireCondition(rows.length && rows[0].revision === state.revision, 'progress-history-unavailable', 'Accounting history has no current row');
    let anchor;
    let account;
    let replayed = 0;
    const ordered = [];
    for (const metadata of rows) {
      if (budget.chargeInput) replayed += metadata.bytes;
      else budget.bytes += metadata.bytes;
      requireCondition((budget.chargeInput ? replayed : budget.bytes) <= progress.MAX_RECOVERY_BYTES, 'progress-history-limit', 'Accounting recovery exceeded its byte bound');
      const row = { ...metadata, ...this.store.db.prepare('SELECT state FROM history WHERE run_id=? AND revision=?').get(state.id, metadata.revision) };
      if (budget.chargeInput) budget.chargeInput(row.state);
      const value = JSON.parse(row.state);
      this.identity(value, row.revision);
      const provenance = new (require('./provenance-store').ProvenanceStore)(this).read(value, budget);
      requireCondition(!provenance || provenance.status === 'current', 'progress-evidence-unavailable', 'Accounting history contains unresolved discharge provenance');
      if (provenance) {
        value.progress = structuredClone(provenance.marker);
        if (provenance.reminder) value.stopRecovery = structuredClone(provenance.reminder);
        else delete value.stopRecovery;
      }
      if (value.progress && Object.hasOwn(value.progress, 'encodedHash')) {
        requireCondition(progress.HASH.test(value.progress.encodedHash) && value.progress.encodedHash === progress.encodedHash(value), 'progress-history-unavailable', 'Accounting history contradicts its substantive-state binding');
      }
      requireCondition(value.id === state.id, 'progress-history-unavailable', 'Accounting history has a foreign run');
      if (ordered.length) requireCondition(row.revision + 1 === ordered.at(-1).revision, 'progress-history-unavailable', 'Accounting history contains a gap');
      ordered.push({ ...row, state: value });
      if (progress.validMarker(value)) {
        try {
          account = this.checkpoint(value, budget);
          anchor = value;
          break;
        } catch (error) {
          if (error.code === 'progress-history-limit') throw error;
          // A damaged checkpoint is not a new baseline; earlier complete provenance may still be usable.
        }
      }
      const old = value.stopRecovery;
      if (old && !Object.hasOwn(old, 'schema')) {
        requireCondition(Number.isSafeInteger(old.reminders) && old.reminders >= 1 && old.reminders <= 3 && Number.isSafeInteger(old.revision) && old.revision >= 0 && old.revision <= value.revision, 'progress-reminder-unavailable', 'Legacy reminder anchor is malformed or future');
      }
      if (row.revision === 0) {
        requireCondition(row.kind === 'created', 'progress-history-unavailable', 'Accounting has no creation provenance');
        account = this.initial(value, budget);
        anchor = value;
        break;
      }
    }
    requireCondition(anchor, 'progress-history-limit', 'Accounting recovery found no trustworthy bounded anchor');
    let prior = anchor;
    for (const row of ordered.slice(0, -1).reverse()) {
      const next = this.step(prior, row.state, account, budget);
      if (row.kind === 'continuation-reminder') {
        const spent = account.reminder?.token === next.marker.token ? account.reminder.reminders : 0;
        next.reminder = { schema: 2, runId: state.id, token: next.marker.token, reminders: Math.min(3, spent + 1), atRevision: row.revision };
      }
      next.marker.reminderHash = progress.reminderHash(state.id, next.reminder);
      account = next;
      prior = row.state;
    }
    requireCondition(progress.encodedHash(prior) === progress.encodedHash(state), 'progress-history-unavailable', 'Accounting recovery contradicts current substantive state');
    return account;
  }

  read(state, budget) {
    const provenance = new (require('./provenance-store').ProvenanceStore)(this).read(state, budget);
    if (provenance) {
      requireCondition(provenance.status === 'current', 'progress-evidence-unavailable', 'Discharge provenance is unresolved');
      this.committed(state);
      const restored = { ...state, progress: provenance.marker };
      if (provenance.reminder) restored.stopRecovery = provenance.reminder;
      else delete restored.stopRecovery;
      try { return this.checkpoint(restored, budget); }
      catch (error) {
        if (error.code !== 'progress-artifact-unavailable') throw error;
        return this.recover(state, budget);
      }
    }
    let recorded;
    try {
      recorded = this.committed(state).state;
      requireCondition(progress.fingerprint(recorded.progress) === progress.fingerprint(state.progress) && progress.fingerprint(recorded.stopRecovery) === progress.fingerprint(state.stopRecovery), 'progress-marker-unavailable', 'Accounting differs from its committed metadata');
      if (progress.validMarker(state)) return this.checkpoint(state, budget);
    } catch (error) {
      // An exhausted allowance is terminal: recovery would spend the same budget again.
      if (error.code === 'progress-history-limit' || !(error instanceof require('./errors').RunError) && !(error instanceof SyntaxError)) throw error;
    }
    return this.recover(state, budget);
  }

  derive(previous, state, registrations) {
    let account;
    try {
      if (!previous) return this.initial(state);
      account = this.read(previous);
      const provenance = new (require('./provenance-store').ProvenanceStore)(this);
      if (!provenance.read(previous) && progress.validMarker(previous)) provenance.establishLegacy(previous, account);
      return this.step(previous, state, account, undefined, registrations);
    } catch (error) {
      const lower = account ?? (previous && { marker: previous.progress, reminder: previous.stopRecovery });
      return unavailable(state, lower, ['progress-frontier-unavailable', 'progress-history-limit', 'progress-history-unavailable', 'progress-reminder-unavailable', 'progress-marker-unavailable', 'progress-artifact-unavailable', 'progress-evidence-unavailable'].includes(error.code) ? error.code : 'progress-evidence-unavailable');
    }
  }

  reminder(previous, state, established) {
    const account = this.read(previous);
    requireCondition(progress.fingerprint(account.marker) === progress.fingerprint(established.marker) && progress.fingerprint(account.frontier) === progress.fingerprint(established.frontier) && progress.fingerprint(account.reminder) === progress.fingerprint(established.reminder), 'progress-accounting-unavailable', 'Reminder accounting changed after admission');
    const provenance = new (require('./provenance-store').ProvenanceStore)(this);
    if (!provenance.read(previous)) {
      const restored = structuredClone(previous);
      this.persist(restored, account);
      provenance.establishLegacy(restored, account);
    }
    const bindings = provenance.verify(previous);
    const count = account.reminder?.token === account.marker.token ? account.reminder.reminders : 0;
    requireCondition(count < 3, 'progress-accounting-unavailable', 'Reminder allowance is exhausted');
    account.marker = { ...account.marker, atRevision: state.revision, encodedHash: progress.encodedHash(state) };
    account.reminder = { schema: 2, runId: state.id, token: account.marker.token, reminders: count + 1, atRevision: state.revision };
    account.provenance = { bindings, admissions: [] };
    return account;
  }

  persist(state, account) {
    if (account.frontier) {
      const body = JSON.stringify(account.frontier);
      const id = createHash('sha256').update(body).digest('hex');
      const existing = this.store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(id);
      if (existing && existing.body !== body) this.store.db.prepare('UPDATE artifacts SET body=? WHERE id=?').run(body, id);
      else this.store.db.prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?)').run(id, body);
      account.marker.frontierHash = id;
    }
    if (account.marker.status === 'current') account.marker.reminderHash = progress.reminderHash(state.id, account.reminder);
    state.progress = account.marker;
    if (account.reminder) state.stopRecovery = account.reminder;
    else delete state.stopRecovery;
  }
}

module.exports = { ProgressStore };
