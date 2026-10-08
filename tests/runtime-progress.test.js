'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { RunStore } = require('../internal/runtime/store');
const { ProgressStore } = require('../internal/runtime/progress-store');
const { handleHook } = require('../internal/runtime/hook');
const { transition } = require('../internal/runtime/lifecycle');
const { achievements, fingerprint, snapshotIdentity, validateFrontier, captureClosingBinding, reminderHash, MAX_CREDITS } = require('../internal/runtime/progress');
const { fixtureContinuation } = require('./fixtures/continuation');
const { fixtureAcknowledgement } = require('./fixtures/acknowledgement');
const { dropFacilityProvenance } = require('./fixtures/legacy-provenance');
const { DIMENSIONS } = require('../internal/runtime/lifecycle');
const { renewAcknowledgement } = require('../internal/runtime/acknowledgement');

function fixture(t, options = {}) {
  const parent = path.resolve(__dirname, '../.tmp/progress-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'run-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const actor = { host: 'codex', session: 'owner' };
  const input = { mechanism: fixtureContinuation(), controller: actor, objective: 'Deliver label change', authority: 'Human handover', ...(options.docsGate === false ? { docsGate: false } : {}), tasks: [{ id: 'label', title: 'Label', kind: options.kind ?? 'code', agreement: { source: 'User', outcome: 'Change the label' } }] };
  store.create(input);
  const read = () => store.read(undefined, { hydrate: false });
  const update = change => store.update(actor, read().revision, 'fixture', change);
  const stop = () => handleHook({ cwd: root, session_id: actor.session, hook_event_name: 'Stop' });
  return { root, store, actor, input, read, update, stop };
}

function snapshot(value = 'a', blob) {
  const files = [{ path: 'LABEL.txt', sha256: createHash('sha256').update(value).digest('hex'), ...(blob ? { blob } : {}) }];
  return { digest: createHash('sha256').update(JSON.stringify(files)).digest('hex'), files };
}

function pass(value = 'a') {
  return { name: 'label bytes', executable: 'node', args: ['verify-label.js'], passed: true, inputsUnchanged: true, exitCode: 0, snapshot: snapshot(value) };
}

function corrupt(f, change, history = false) {
  const state = f.read();
  change(state);
  const body = JSON.stringify(state);
  f.store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, state.id);
  if (history) f.store.db.prepare('UPDATE history SET state=? WHERE run_id=? AND revision=?').run(body, state.id, state.revision);
}

test('handover retries and diagnostic changes never replenish three reminders', t => {
  const f = fixture(t);
  const initial = f.read().progress.token;
  for (let count = 1; count <= 3; count++) {
    f.update(state => transition(state, { action: 'handover', authority: 'Same human handover' }));
    f.update(state => { state.controllerClaim = { observedAt: String(count) }; state.dispatches++; state.continuation = { verified: false, evidence: 'Repeated observation' }; delete state.stopRecovery; state.progress = { token: 'caller token' }; });
    assert.equal(f.stop().decision, 'block');
    assert.equal(f.read().stopRecovery.reminders, count);
    assert.equal(f.read().progress.token, initial);
  }
  const revision = f.read().revision;
  assert.equal(f.stop().continue, false);
  assert.equal(f.read().revision, revision);
});

test('real task start replenishes pressure once, repeated starts do not', t => {
  const f = fixture(t);
  for (let index = 0; index < 3; index++) f.stop();
  const initial = f.read().progress.token;
  f.update(state => transition(state, { action: 'start-task', taskId: 'label' }));
  const started = f.read().progress.token;
  assert.notEqual(started, initial);
  assert.equal(f.stop().decision, 'block');
  assert.equal(f.read().stopRecovery.reminders, 1);
  for (let index = 0; index < 2; index++) {
    f.update(state => transition(state, { action: 'start-task', taskId: 'label' }));
    assert.equal(f.read().progress.token, started);
    assert.equal(f.stop().decision, 'block');
  }
  assert.equal(f.stop().continue, false);
});

test('equivalent pass after pending, deletion, blob metadata or a new attempt earns no credit', t => {
  const f = fixture(t);
  f.update(state => state.tasks[0].checks.push(pass()));
  const token = f.read().progress.token;
  f.stop();
  f.update(state => { state.tasks[0].checks = [{ ...pass(), pending: true, passed: false }]; });
  f.update(state => { state.tasks[0].checks = []; });
  f.update(state => state.tasks[0].checks.push({ ...pass(), name: 'renamed proof label', attemptId: 'new', snapshot: snapshot('a', 'new-blob') }));
  assert.equal(f.read().progress.token, token);
  assert.equal(f.stop().decision, 'block');
  assert.equal(f.read().stopRecovery.reminders, 2);
  f.update(state => state.tasks[0].checks.push(pass('b')));
  assert.notEqual(f.read().progress.token, token);
  f.stop();
  assert.equal(f.read().stopRecovery.reminders, 1);
});

test('failed and pending attempts, workers and probes receive no independent credit', t => {
  const f = fixture(t);
  const token = f.read().progress.token;
  f.update(state => { state.tasks[0].checks.push({ ...pass(), passed: false, exitCode: 1 }); state.workers.push({ id: 'diagnostic', status: 'complete', session: 'new' }); state.tasks[0].probeEvidence = [{ result: 'completed' }]; });
  assert.equal(f.read().progress.token, token);
});

test('closing prose changes and clear/restore preserve cumulative obligations', t => {
  const f = fixture(t);
  let binding;
  f.update(state => { binding = captureClosingBinding(state); state.closing = { retrospectiveEvidence: 'Recorded', reportEvidence: { sha256: 'a'.repeat(64) }, reportDelivery: { sha256: 'a'.repeat(64) }, triageEvidence: 'Pending choices preserved', progressBindings: Object.fromEntries(['retrospective','report','delivery','triage'].map(kind=>[kind,binding])) }; for (const slot of ['retrospective','report','delivery','triage']) require('../internal/runtime/discharge').register(state, slot); });
  const token = f.read().progress.token;
  f.update(state => { state.closing = {}; });
  f.update(state => { state.closing = { retrospectiveEvidence: 'Reworded', reportEvidence: { sha256: 'b'.repeat(64) }, reportDelivery: { sha256: 'b'.repeat(64) }, triageEvidence: 'Reworded triage', progressBindings: Object.fromEntries(['retrospective','report','delivery','triage'].map(kind=>[kind,binding])) }; for (const slot of ['retrospective','report','delivery','triage']) require('../internal/runtime/discharge').register(state, slot); });
  assert.equal(f.read().progress.token, token);
  f.update(state => state.tasks[0].checks.push(pass('new engineering input')));
  assert.notEqual(f.read().progress.token, token);
});

test('central save ignores supplied accounting and encodes references idempotently', t => {
  const f = fixture(t);
  f.update(state => state.tasks[0].checks.push(pass()));
  const before = f.read();
  const count = f.store.db.prepare('SELECT count(*) AS count FROM artifacts').get().count;
  f.store.transaction(() => {
    const state = f.read();
    state.revision++;
    state.progress = { schema: 999, token: 'injected' };
    state.stopRecovery = { reminders: 0 };
    f.store.save(state, 'trusted-direct-save');
  });
  assert.equal(f.read().progress.token, before.progress.token);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM artifacts').get().count, count + 1);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM accounting_commits').get().count, f.read().revision + 1);
  assert.deepEqual(f.store.read().tasks[0].checks[0].snapshot, pass().snapshot);
  assert.equal(fingerprint(achievements(f.read(), value => f.store.hydrate(value))), fingerprint(achievements(f.store.read())));
  assert.throws(() => f.store.save(f.read(), 'outside-transaction'), { code: 'invalid-runtime-transaction' });
});

test('transaction rollback restores frontier, state, history and observations', t => {
  const f = fixture(t);
  const before = JSON.stringify(f.read());
  const artifacts = f.store.db.prepare('SELECT count(*) AS count FROM artifacts').get().count;
  assert.throws(() => f.store.transaction(() => { const state = f.read(); state.revision++; state.tasks[0].checks.push(pass()); f.store.save(state, 'failing-write'); throw new Error('after save'); }), /after save/);
  assert.equal(JSON.stringify(f.read()), before);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM artifacts').get().count, artifacts);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM history').get().count, 1);
  const integrationRecorded = f.store.integrationRecorded;
  assert.throws(() => f.update(() => { throw new Error('change failed'); }), /change failed/);
  assert.equal(f.store.integrationRecorded, integrationRecorded);
});

test('missing or malformed current metadata recovers spent pressure without a credit', t => {
  const f = fixture(t);
  f.stop(); f.stop();
  const token = f.read().progress.token;
  corrupt(f, state => { delete state.progress; delete state.stopRecovery; });
  assert.equal(f.stop().decision, 'block');
  assert.equal(f.read().stopRecovery.reminders, 3);
  assert.equal(f.read().progress.token, token);
  assert.equal(f.stop().continue, false);
});

const metadataDamage = {
  'missing marker': state => { delete state.progress; },
  'null marker': state => { state.progress = null; },
  'wrong-kind marker': state => { state.progress = 'replacement'; },
  'unsupported marker': state => { state.progress.schema = 99; },
  'foreign marker': state => { state.progress.runId = 'foreign'; },
  'stale marker': state => { state.progress.atRevision--; },
  'changed token': state => { state.progress.token = 'f'.repeat(64); },
  'changed frontier reference': state => { state.progress.frontierHash = 'f'.repeat(64); },
  'changed substantive hash field': state => { state.progress.encodedHash = 'f'.repeat(64); },
  'changed reminder hash': state => { state.progress.reminderHash = 'f'.repeat(64); },
  'unavailable marker flag': state => { state.progress.status = 'unavailable'; state.progress.reason = 'injected'; },
  'missing reminder': state => { delete state.stopRecovery; },
  'null reminder': state => { state.stopRecovery = null; },
  'wrong-kind reminder': state => { state.stopRecovery = []; },
  'unsupported reminder': state => { state.stopRecovery.schema = 99; },
  'foreign reminder': state => { state.stopRecovery.runId = 'foreign'; },
  'changed reminder token': state => { state.stopRecovery.token = 'f'.repeat(64); },
  'lowered reminder count': state => { state.stopRecovery.reminders = 0; },
  'future reminder revision': state => { state.stopRecovery.atRevision = 999; },
};

for (const matchingHistory of [false, true]) {
  for (const spent of [2, 3]) {
    test(`independent checkpoint restores every replacement metadata form with spent=${spent}, matchingHistory=${matchingHistory}`, t => {
      for (const [damage, change] of Object.entries(metadataDamage)) {
        const f = fixture(t);
        for (let index = 0; index < spent; index++) f.stop();
        const before = f.read();
        corrupt(f, change, matchingHistory);
        const account = new ProgressStore(f.store).read(f.read());
        assert.equal(account.marker.token, before.progress.token, damage);
        assert.equal(account.reminder.reminders, spent, damage);
        const stop = f.stop();
        if (spent === 2) assert.equal(stop.decision, 'block', damage);
        else { assert.equal(stop.continue, false, damage); assert.equal(f.read().revision, before.revision, damage); }
        f.update(state => { state.diagnostic = 'Authorized reconciliation'; });
        assert.equal(f.read().progress.status, 'current', damage);
        assert.equal(f.read().progress.token, before.progress.token, damage);
        assert.equal(f.read().stopRecovery.reminders, 3, damage);
        assert.equal(f.stop().continue, false, damage);
      }
    });
  }
}

test('legacy false reminder resets accumulate to exhaustion during recovery', t => {
  const f = fixture(t);
  f.store.db.prepare('DELETE FROM history WHERE run_id=?').run(f.read().id);
  const state = f.read();
  delete state.progress;
  for (let revision = 0; revision <= 8; revision++) {
    state.revision = revision;
    if (revision && revision % 2 === 0) state.stopRecovery = { reminders: 1, revision };
    const body = JSON.stringify(state);
    f.store.db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(state.id, revision, revision === 0 ? 'created' : revision % 2 === 0 ? 'continuation-reminder' : 'handover', state.updatedAt, body);
  }
  f.store.db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(state.revision, JSON.stringify(state), state.id);
  assert.equal(f.stop().continue, false);
  assert.equal(f.read().revision, 8);
});

for (const damage of ['missing history', 'foreign history', 'future legacy reminder', 'history limit']) {
  test(`unavailable ${damage} stops pressure and preserves independently admitted work`, t => {
    const f = fixture(t);
    f.stop();
    const state = f.read();
    if (damage === 'missing history') f.store.db.prepare('DELETE FROM history WHERE run_id=?').run(state.id);
    if (damage === 'foreign history') {
      const foreign = structuredClone(state); foreign.root = 'C:/foreign'; delete foreign.progress;
      f.store.db.prepare('UPDATE history SET state=? WHERE run_id=?').run(JSON.stringify(foreign), state.id);
      corrupt(f, value => { delete value.progress; });
    }
    if (damage === 'future legacy reminder') {
      f.store.db.prepare('DELETE FROM accounting_commits WHERE run_id=?').run(state.id);
      corrupt(f, value => { delete value.progress; value.stopRecovery = { reminders: 1, revision: 999 }; }, true);
    }
    if (damage === 'history limit') {
      delete state.progress; delete state.stopRecovery;
      f.store.db.prepare('DELETE FROM history WHERE run_id=?').run(state.id);
      for (let revision = 1; revision <= 257; revision++) { state.revision = revision; f.store.db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(state.id, revision, 'observation', state.updatedAt, JSON.stringify(state)); }
      f.store.db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(state.revision, JSON.stringify(state), state.id);
    }
    const result = f.stop();
    assert.equal(result.continue, false);
    assert.match(result.stopReason, /accounting is unavailable/);
    f.update(value => { value.hold = { authority: 'User hold' }; value.status = 'stopped'; });
    assert.equal(f.read().status, 'stopped');
    assert.equal(f.read().progress.status, 'unavailable');
  });
}

test('revision overflow is refused before change executes', t => {
  const f = fixture(t);
  const state = f.read(); state.revision = Number.MAX_SAFE_INTEGER;
  f.store.db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(state.revision, JSON.stringify(state), state.id);
  let changed = false;
  assert.throws(() => f.update(() => { changed = true; }), { code: 'revision-overflow' });
  assert.equal(changed, false);
});

test('frontier and snapshot grammar reject corruption and overflow', () => {
  assert.deepEqual(snapshotIdentity(snapshot('a', 'old')), snapshotIdentity(snapshot('a', 'new')));
  assert.throws(() => snapshotIdentity({ ...snapshot(), digest: 'f'.repeat(64) }), { code: 'progress-evidence-unavailable' });
  assert.throws(() => validateFrontier({ schema: 2, runId: 'owner', credits: Array(MAX_CREDITS + 1).fill('a'.repeat(64)), closingBasis: [] }, 'owner'), { code: 'progress-frontier-unavailable' });
  assert.throws(() => validateFrontier({ schema: 2, runId: 'foreign', credits: [], closingBasis: [] }, 'owner'), { code: 'progress-frontier-unavailable' });
});

test('stale and foreign reminder issuances cannot race or consume pressure', t => {
  const f = fixture(t);
  const revision = f.read().revision;
  assert.throws(() => f.store.remind({ host: 'codex', session: 'foreign' }, revision, () => true), { code: 'wrong-owner' });
  assert.equal(f.store.remind(f.actor, revision, () => false).issued, false);
  assert.equal(f.store.remind(f.actor, revision, () => true).issued, true);
  assert.throws(() => f.store.remind(f.actor, revision, () => true), { code: 'stale-state' });
  assert.equal(f.read().stopRecovery.reminders, 1);
});

test('ordinary reminders preserve accounting without encoding or reading accumulated proof bodies', t => {
  const f = fixture(t);
  f.update(state => {
    const task = state.tasks[0];
    task.baseline = snapshot('baseline');
    task.docsExemption = { snapshot: snapshot('exemption') };
    for (let index = 0; index < 32; index++) task.checks.push({ ...pass('input-' + index), output: 'large log '.repeat(2000) });
    task.reviews.push({ requestId: 'recorded', session: 'independent', kind: 'code', status: 'complete', strength: 'strong', independent: true, attributionVerified: true, broad: true, coverageEvidence: 'All dimensions', dimensions: DIMENSIONS.code, commitments: { label: { agreement: structuredClone(task.agreement), revision: 0 } }, revision: state.revision + 1, snapshot: snapshot('review'), contextSnapshot: snapshot('context') });
    task.findings.push({ id: 'recorded:F1', raisedBy: { requestId: 'recorded' }, consequence: 'Checked claim', severity: 'important', validation: { attributionVerified: true, verdict: 'refuted', snapshot: snapshot('validation') }, disposition: 'refuted' });
  });
  const before = f.read();
  const frontier = new ProgressStore(f.store).read(before).frontier;
  const methods = [[RunStore.prototype, 'encode'], [RunStore.prototype, 'hydrate'], [ProgressStore.prototype, 'resolve'], [ProgressStore.prototype, 'step']];
  const originals = methods.map(([owner, method]) => owner[method]);
  for (const [owner, method] of methods) owner[method] = function() { throw new Error('Ordinary reminder loaded proof through ' + method); };
  try {
    for (let count = 1; count <= 3; count++) {
      if (count === 2) corrupt(f, state => { state.progress = null; state.stopRecovery = []; }, true);
      assert.equal(f.stop().decision, 'block');
      assert.equal(f.read().stopRecovery.reminders, count);
      assert.equal(f.read().progress.token, before.progress.token);
      assert.deepEqual(new ProgressStore(f.store).read(f.read()).frontier, frontier);
    }
    assert.equal(f.stop().continue, false);
  } finally {
    methods.forEach(([owner, method], index) => { owner[method] = originals[index]; });
  }
  const account = new ProgressStore(f.store);
  const provenance = new (require('../internal/runtime/provenance-store').ProvenanceStore)(account).read(f.read());
  assert.deepEqual(provenance.admissions, []);
  assert.equal(provenance.marker.token, before.progress.token);
  assert.equal(provenance.reminder.reminders, 3);
  assert.equal(f.store.read().tasks[0].checks[0].output.length, 'large log '.repeat(2000).length);
});

test('reminder admission rejects eligibility and post-admission candidate mutations atomically', t => {
  const f = fixture(t);
  const before = JSON.stringify(f.read());
  assert.throws(() => f.store.remind(f.actor, f.read().revision, state => { state.unknownField = { value: 'mutation' }; return true; }), { code: 'invalid-reminder-state' });
  assert.equal(JSON.stringify(f.read()), before);
  const original = RunStore.prototype.save;
  RunStore.prototype.save = function(state, kind, internal) { if (internal) state.unknownField = 'after admission'; return original.call(this, state, kind, internal); };
  try { assert.throws(() => f.store.remind(f.actor, f.read().revision, () => true), { code: 'invalid-reminder-state' }); }
  finally { RunStore.prototype.save = original; }
  assert.equal(JSON.stringify(f.read()), before);
});

test('consumed private reminder capability cannot be replayed in another transaction', t => {
  const f = fixture(t);
  const original = RunStore.prototype.save;
  let capability;
  RunStore.prototype.save = function(state, kind, internal) { if (internal) capability = internal; return original.call(this, state, kind, internal); };
  try { assert.equal(f.stop().decision, 'block'); }
  finally { RunStore.prototype.save = original; }
  const before = JSON.stringify(f.read());
  assert.throws(() => f.store.transaction(() => { const state = f.read(); state.revision++; f.store.save(state, 'continuation-reminder', capability); }), { code: 'invalid-reminder-state' });
  assert.equal(JSON.stringify(f.read()), before);
});

test('forged reminder operation name still performs ordinary evidence encoding', t => {
  const f = fixture(t);
  f.update(state => state.tasks[0].checks.push(pass()));
  const original = f.store.encode;
  let encoded = 0;
  f.store.encode = function(state) { encoded++; return original.call(this, state); };
  f.store.transaction(() => { const state = f.read(); state.revision++; f.store.save(state, 'continuation-reminder'); });
  assert.equal(encoded, 1);
  assert.equal(f.read().progress.status, 'current');
  assert.equal(f.read().stopRecovery, undefined);
});

test('applicable broad assurance and findings deduplicate generated identities and repair revisions', t => {
  const f = fixture(t);
  const review = (state, id, continued = false) => ({ requestId: id, kind: 'code', status: 'complete', strength: 'strong', independent: true, attributionVerified: true, broad: true, coverageEvidence: 'All dimensions assessed', dimensions: DIMENSIONS.code, commitments: { label: { agreement: structuredClone(state.tasks[0].agreement), revision: 0 } }, snapshot: snapshot(), revision: state.revision + 1, continues: continued ? { kind: 'resumed' } : null });
  f.update(state => state.tasks[0].reviews.push(review(state, 'first')));
  const reviewed = f.read().progress.token;
  f.update(state => state.tasks[0].reviews.push(review(state, 'duplicate')));
  assert.equal(f.read().progress.token, reviewed);
  f.update(state => state.tasks[0].findings.push({ id: 'first:F1', consequence: 'Required behavior fails', severity: 'important', required: true, raisedBy: { requestId: 'first' }, validation: { verdict: 'confirmed', attributionVerified: true, snapshot: snapshot() }, disposition: 'implement', obligation: { classification: 'required' }, repaired: true, repairRevision: state.revision + 1, pendingClosure: { revision: state.revision + 1 } }));
  const repaired = f.read().progress.token;
  f.update(state => { const duplicate = structuredClone(state.tasks[0].findings[0]); duplicate.id = 'duplicate:F1'; duplicate.raisedBy.requestId = 'duplicate'; duplicate.repairRevision = state.revision + 1; state.tasks[0].findings.push(duplicate); });
  assert.equal(f.read().progress.token, repaired);
  f.update(state => { const closure = review(state, 'closure', true); state.tasks[0].reviews.push(closure); const finding = state.tasks[0].findings[0]; delete finding.pendingClosure; finding.closures = [{ closed: true, requestId: 'closure', revision: state.revision + 1 }]; });
  assert.notEqual(f.read().progress.token, repaired);
  const closed = f.read().progress.token;
  f.update(state => { state.tasks[0].findings[0].repairRevision++; state.tasks[0].reviews.push(review(state, 'repeat closure', true)); });
  assert.equal(f.read().progress.token, closed);
});

test('acknowledgement capture credits material scope once across outcome renewal', t => {
  const f = fixture(t);
  f.store.acknowledgementObservation = fixtureAcknowledgement(f.store.read());
  f.update(() => {});
  const token = f.read().progress.token;
  f.update(state => renewAcknowledgement(state, state.revision + 1, new Date().toISOString()));
  f.store.acknowledgementObservation = fixtureAcknowledgement(f.store.read());
  f.update(() => {});
  assert.equal(f.read().progress.token, token);
  f.update(state => { state.tasks[0].agreement.decisions = ['Authorized material change']; renewAcknowledgement(state, state.revision + 1, new Date().toISOString()); });
  const changed = f.read().progress.token;
  f.store.acknowledgementObservation = fixtureAcknowledgement(f.store.read());
  f.update(() => {});
  assert.notEqual(f.read().progress.token, changed);
});

test('explicit resume and actual owner transfer progress preserve credited proofs', t => {
  const f = fixture(t);
  f.update(state => { state.tasks[0].checks.push(pass()); state.status = 'stopped'; });
  const stopped = f.read().progress.token;
  f.update(state => transition(state, { action: 'resume', authority: 'Human resume' }));
  assert.notEqual(f.read().progress.token, stopped);
  const resumed = f.read().progress.token;
  f.store.transaction(() => { const state = f.read(); state.controller = { host: 'codex', session: 'new owner' }; state.revision++; f.store.save(state, 'trusted-owner-transfer'); });
  assert.notEqual(f.read().progress.token, resumed);
  const frontier = new ProgressStore(f.store).read(f.read()).frontier;
  assert.ok(frontier.credits.length > 0);
});

test('reopening completed work retains its closing context and exhausted pressure', t => {
  const f = fixture(t, { kind: 'docs', docsGate: false });
  f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
  f.update(state => transition(state, { action: 'retrospective', evidence: 'Observed retrospective' }));
  for (let index = 0; index < 3; index++) f.stop();
  const before = f.read();
  f.update(state => transition(state, { action: 'block', taskId: 'label', blocker: { kind: 'capability', reason: 'Recheck completed work', recoveryAttempted: 'Inspected capability' } }));
  assert.equal(f.read().progress.token, before.progress.token);
  assert.deepEqual(f.read().closing, before.closing);
  f.update(state => transition(state, { action: 'unblock', taskId: 'label', evidence: 'The same capability is available' }));
  assert.equal(f.read().progress.token, before.progress.token);
  assert.equal(f.stop().continue, false);
});

test('partial delivery closing retains its basis through proof loss and restoration', t => {
  const f = fixture(t);
  f.update(state => { state.tasks[0].checks = [pass('a'), pass('b')]; });
  f.update(state => transition(state, { action: 'block', taskId: 'label', blocker: { kind: 'capability', reason: 'Independent capability unavailable', recoveryAttempted: 'Bounded inspection' } }));
  f.update(state => transition(state, { action: 'retrospective', evidence: 'Partial-delivery retrospective' }));
  for (let index = 0; index < 3; index++) f.stop();
  const before = f.read();
  const basis = new ProgressStore(f.store).read(before).frontier.closingBasis;
  f.update(state => { state.tasks[0].checks = [pass('a')]; });
  assert.equal(f.read().progress.token, before.progress.token);
  assert.deepEqual(new ProgressStore(f.store).read(f.read()).frontier.closingBasis, basis);
  assert.equal(f.stop().continue, false);
  f.update(state => { state.tasks[0].checks = [pass('a'), pass('b')]; });
  assert.equal(f.read().progress.token, before.progress.token);
  assert.deepEqual(f.read().closing.progressBindings, before.closing.progressBindings);
});

for (const damage of ['absent', 'lowered']) {
  test(`matching current/history ${damage} reminder cannot establish a new allowance`, t => {
    const f = fixture(t);
    for (let index = 0; index < 3; index++) f.stop();
    f.update(state => { state.diagnostic = 'Observation only'; });
    const before = f.read();
    corrupt(f, state => { if (damage === 'absent') delete state.stopRecovery; else state.stopRecovery.reminders = 1; }, true);
    assert.equal(f.stop().continue, false);
    assert.equal(f.read().revision, before.revision);
    f.update(state => { state.status = 'stopped'; });
    assert.equal(f.read().stopRecovery.reminders, 3);
  });
}

for (const damage of ['missing', 'changed']) {
  test(`complete creation history can reconstruct a ${damage} frontier without replenishing pressure`, t => {
    const f = fixture(t);
    for (let index = 0; index < 3; index++) f.stop();
    const state = f.read();
    if (damage === 'missing') f.store.db.prepare('DELETE FROM artifacts WHERE id=?').run(state.progress.frontierHash);
    else f.store.db.prepare('UPDATE artifacts SET body=? WHERE id=?').run('{}', state.progress.frontierHash);
    assert.equal(f.stop().continue, false);
    f.update(value => { value.status = 'stopped'; });
    assert.equal(f.read().progress.status, 'current');
    assert.equal(f.read().stopRecovery.reminders, 3);
  });
}

test('a legacy reset anchor beyond complete provenance grants no unused remainder', t => {
  const f = fixture(t);
  const state = f.read(); delete state.progress; delete state.stopRecovery;
  f.store.db.prepare('DELETE FROM history WHERE run_id=?').run(state.id);
  for (let revision = 0; revision <= 260; revision++) {
    state.revision = revision;
    let kind = revision === 0 ? 'created' : 'observation';
    if (revision >= 1 && revision <= 3) { state.stopRecovery = { reminders: revision, revision }; kind = 'continuation-reminder'; }
    if (revision === 10) { state.stopRecovery = { reminders: 1, revision }; kind = 'continuation-reminder'; }
    f.store.db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(state.id, revision, kind, state.updatedAt, JSON.stringify(state));
  }
  f.store.db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(state.revision, JSON.stringify(state), state.id);
  const result = f.stop();
  assert.equal(result.continue, false);
  assert.match(result.stopReason, /accounting is unavailable/);
  assert.equal(f.read().revision, 260);
});

for (const slot of ['retrospective', 'report', 'delivery', 'triage']) {
  test(`a corrupt retained ${slot} binding cannot become a new discharge during recovery`, t => {
    const f = fixture(t, { kind: 'docs', docsGate: false });
    f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
    f.update(state => transition(state, { action: 'retrospective', evidence: 'Observed retrospective' }));
    const report = '.nightshift/runs/reports/morning.md';
    fs.mkdirSync(path.dirname(path.join(f.root, report)), { recursive: true });
    fs.writeFileSync(path.join(f.root, report), 'Recorded report.\r\n');
    f.update(state => transition(state, { action: 'report', path: report }));
    f.update(state => transition(state, { action: 'report-delivered', authority: 'Fixture recipient confirmed delivery' }));
    f.update(state => transition(state, { action: 'triage', evidence: 'No pending choices' }));
    for (let index = 0; index < 3; index++) f.stop();
    f.update(state => { state.diagnostic = 'Observation only'; });
    const before = f.read();
    corrupt(f, state => { state.closing.progressBindings[slot].contextHash = 'f'.repeat(64); }, true);
    const result = f.stop();
    assert.equal(result.continue, false);
    assert.match(result.stopReason, /accounting is unavailable/);
    assert.equal(f.read().revision, before.revision);
    assert.equal(f.read().progress.token, before.progress.token);
    assert.equal(f.read().stopRecovery.reminders, 3);
  });
}

test('substitution of another valid historical context cannot rebind retained closing evidence', t => {
  const f = fixture(t, { kind: 'docs', docsGate: false });
  f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
  f.update(state => transition(state, { action: 'retrospective', evidence: 'Initial retrospective' }));
  const historical = f.read().closing.progressBindings.retrospective;
  f.update(state => { state.tasks[0].checks.push(pass('new input')); });
  f.update(state => transition(state, { action: 'retrospective', evidence: 'Retrospective after new engineering' }));
  assert.notDeepEqual(f.read().closing.progressBindings.retrospective, historical);
  for (let index = 0; index < 3; index++) f.stop();
  f.update(state => { state.diagnostic = 'No new discharge'; });
  const before = f.read();
  corrupt(f, state => { state.closing.progressBindings.retrospective = historical; }, true);
  assert.equal(f.stop().continue, false);
  assert.equal(f.read().progress.token, before.progress.token);
  assert.equal(f.read().stopRecovery.reminders, 3);
});

test('otherwise valid inherited bindings must retain their original cycle', t => {
  const f = fixture(t, { kind: 'docs', docsGate: false });
  f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
  f.update(state => transition(state, { action: 'retrospective', evidence: 'Established retrospective' }));
  const token = f.read().progress.token;
  f.update(state => { state.closing.reportEvidence = { sha256: 'a'.repeat(64) }; state.closing.progressBindings.report = { schema: 1, runId: state.id, contextHash: 'f'.repeat(64) }; });
  assert.equal(f.read().progress.status, 'unavailable');
  assert.equal(f.read().progress.token, token);
  assert.equal(f.stop().continue, false);
});

for (const damage of ['metadata-only', 'retained-hash', 'missing-metadata']) {
  test(`independent admission provenance preserves pressure under ${damage} recovery`, t => {
    const f = fixture(t, { kind: 'docs', docsGate: false });
    f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
    f.update(state => transition(state, { action: 'retrospective', evidence: 'Original retrospective' }));
    f.update(state => state.tasks[0].checks.push(pass('new substantive basis')));
    let current;
    f.update(state => { current = captureClosingBinding(state); });
    for (let index = 0; index < 3; index++) f.stop();
    const before = f.read();
    corrupt(f, state => {
      if (damage !== 'metadata-only') state.closing.progressBindings.retrospective = current;
      if (damage !== 'retained-hash') { delete state.progress; delete state.stopRecovery; }
    }, true);
    const result = f.stop();
    assert.equal(result.continue, false);
    assert.equal(f.read().revision, before.revision);
    if (damage === 'metadata-only') {
      const account = new ProgressStore(f.store).read(f.read());
      assert.equal(account.marker.token, before.progress.token);
      assert.equal(account.reminder.reminders, 3);
    } else assert.match(result.stopReason, /accounting is unavailable/);
  });
}

test('genuine same-text retrospective earns its changed context once', t => {
  const f = fixture(t, { kind: 'docs', docsGate: false });
  f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
  const discharge = () => f.update(state => transition(state, { action: 'retrospective', evidence: 'Same retrospective text' }));
  discharge();
  f.update(state => state.tasks[0].checks.push(pass('changed engineering basis')));
  const previous = f.read().progress.token;
  for (let index = 0; index < 3; index++) f.stop();
  discharge();
  const token = f.read().progress.token;
  assert.notEqual(token, previous);
  assert.equal(f.stop().decision, 'block');
  assert.equal(f.read().stopRecovery.reminders, 1);
  discharge();
  assert.equal(f.read().progress.token, token);
  assert.equal(f.stop().decision, 'block');
  assert.equal(f.read().stopRecovery.reminders, 2);
});

test('unsupported direct save cannot admit closing evidence or launder uncertainty', t => {
  const f = fixture(t, { kind: 'docs', docsGate: false });
  f.update(state => { state.closing = { retrospectiveEvidence: 'Forged', progressBindings: { retrospective: captureClosingBinding(state) } }; });
  assert.equal(f.read().progress.status, 'unavailable');
  const token = f.read().progress.token;
  f.update(state => { delete state.closing; });
  assert.equal(f.read().progress.status, 'unavailable');
  assert.equal(f.read().progress.token, token);
  assert.equal(f.stop().continue, false);
});

test('rollback discards admission capabilities and every independent provenance write', t => {
  const f = fixture(t, { kind: 'docs', docsGate: false });
  f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
  const state = JSON.stringify(f.read());
  const rows = f.store.db.prepare('SELECT count(*) AS count FROM accounting_commits').get().count;
  const artifacts = f.store.db.prepare('SELECT count(*) AS count FROM artifacts').get().count;
  let escaped;
  assert.throws(() => f.update(candidate => { escaped = candidate; transition(candidate, { action: 'retrospective', evidence: 'Aborted discharge' }); throw new Error('rollback'); }), /rollback/);
  assert.equal(JSON.stringify(f.read()), state);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM accounting_commits').get().count, rows);
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM artifacts').get().count, artifacts);
  assert.throws(() => require('../internal/runtime/discharge').register(escaped, 'retrospective'), /expired/);
  assert.throws(() => f.update(() => require('../internal/runtime/discharge').register(escaped, 'retrospective')), /expired/);
});

test('missing independent provenance cannot downgrade a new run to legacy trust', t => {
  const f = fixture(t);
  for (let index = 0; index < 3; index++) f.stop();
  const before = f.read();
  f.store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision=?').run(before.id, before.revision);
  assert.equal(f.stop().continue, false);
  assert.equal(f.read().revision, before.revision);
  f.update(state => { state.status = 'stopped'; });
  assert.equal(f.read().progress.status, 'unavailable');
  assert.equal(f.read().stopRecovery.reminders, 3);
});

const REMINDER_LOSS = [['none', 'null'], ['index', 'kept'], ['index', 'null'], ['index', 'first'], ['facility', 'kept'], ['facility', 'first']];
for (const [loss, metadata] of REMINDER_LOSS) {
  test(`spent reminders stay spent after ${loss} provenance loss with ${metadata} reminder metadata`, t => {
    const parent = path.resolve(__dirname, '../.tmp/progress-reminder-loss');
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'case-'));
    const store = new RunStore(root, { create: true });
    t.after(() => { store.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
    const actor = { host: 'codex', session: 'reminder-loss-owner' };
    store.create({ controller: actor, objective: 'Keep spent pressure', authority: 'Fixture handover', mechanism: fixtureContinuation(), tasks: [{ id: 'work', title: 'Work', agreement: { source: 'Fixture', outcome: 'Preserve spent continuation pressure' } }] });
    const stop = () => handleHook({ cwd: root, session_id: actor.session, hook_event_name: 'Stop' });
    assert.equal(stop().decision, 'block');
    const first = structuredClone(store.read().stopRecovery);
    for (let count = 2; count <= 3; count++) assert.equal(stop().decision, 'block');
    assert.equal(stop().continue, false);
    const state = store.read(undefined, { hydrate: false });
    if (loss === 'index') store.db.prepare('DELETE FROM accounting_commits WHERE run_id=?').run(state.id);
    if (loss === 'facility') dropFacilityProvenance(store.db, state.id);
    if (metadata !== 'kept') {
      if (metadata === 'first') state.stopRecovery = first;
      else delete state.stopRecovery;
      state.progress.reminderHash = reminderHash(state.id, state.stopRecovery);
      store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), state.id);
      store.db.prepare('UPDATE history SET state=? WHERE run_id=? AND revision=?').run(JSON.stringify(state), state.id, state.revision);
    }
    assert.equal(stop().continue, false);
    assert.equal(store.read().revision, state.revision);
    if (loss === 'none' || metadata === 'kept') return;
    // A later independent save keeps the accounting unavailable rather than legitimizing a fresh allowance.
    store.update(actor, state.revision, 'fixture-bookkeeping', current => { current.fixtureDiagnostic = 'Independent bookkeeping after the loss'; });
    assert.equal(store.read().progress.status, 'unavailable');
    assert.equal(stop().continue, false);
  });
}

test('a schema-2 run without independent provenance stays unavailable and keeps its evidence through later saves', t => {
  const f = fixture(t, { kind: 'docs', docsGate: false });
  f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
  f.update(state => transition(state, { action: 'retrospective', evidence: 'Retrospective before the loss' }));
  const before = f.read();
  dropFacilityProvenance(f.store.db, before.id);
  f.update(state => { state.diagnostic = 'Bookkeeping after the loss'; });
  assert.equal(f.read().progress.status, 'unavailable');
  assert.deepEqual(f.read().closing.progressBindings, before.closing.progressBindings);
  f.update(state => { state.diagnostic = 'Further bookkeeping'; });
  assert.equal(f.read().progress.status, 'unavailable');
});

for (const lost of [false, true]) {
  test(`a schema-2 run ${lost ? 'without' : 'with'} independent provenance ${lost ? 'grants no' : 'still grants its'} remaining reminders`, t => {
    const f = fixture(t);
    assert.equal(f.stop().decision, 'block');
    if (lost) dropFacilityProvenance(f.store.db, f.read().id);
    const revision = f.read().revision;
    const result = f.stop();
    if (lost) {
      assert.equal(result.continue, false);
      assert.equal(f.read().revision, revision);
    } else {
      assert.equal(result.decision, 'block');
      assert.equal(f.read().stopRecovery.reminders, 2);
    }
  });
}

for (const table of ['artifacts', 'discharge_index', 'accounting_commits', 'runs', 'history']) {
  test(`admission transaction rolls back at the ${table} write boundary`, t => {
    const f = fixture(t, { kind: 'docs', docsGate: false });
    f.update(state => transition(state, { action: 'advance', taskId: 'label', evidence: 'Documentation complete' }));
    const before = JSON.stringify(f.read());
    const counts = () => Object.fromEntries(['artifacts', 'discharge_index', 'accounting_commits', 'history'].map(name => [name, f.store.db.prepare('SELECT count(*) AS count FROM ' + name).get().count]));
    const existing = counts();
    f.store.db.exec("CREATE TRIGGER reject_write BEFORE INSERT ON " + table + " BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");
    assert.throws(() => f.update(state => transition(state, { action: 'retrospective', evidence: 'Actual new discharge' })), /injected write failure/);
    assert.equal(JSON.stringify(f.read()), before);
    assert.deepEqual(counts(), existing);
  });
}
