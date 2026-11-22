'use strict';

// Boundary cases of the post-completion closing outcome that its first independent assessment found: each reaches its branch through
// state a production writer or an external loss can create, and asserts the specific outcome, code or route.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execute } = require('../internal/runtime/cli');
const { RunStore } = require('../internal/runtime/store');
const { close, closeManifest } = require('../internal/runtime/close');
const { overview } = require('../internal/runtime/run-overview');
const { BOUNDS, closingDischargedSince } = require('../internal/runtime/creation-consistency');
const { DIMENSIONS } = require('../internal/runtime/lifecycle');
const { RunError } = require('../internal/runtime/errors');
const outcomes = require('../internal/runtime/delivery-outcome');
const { Registry } = require('../internal/releases/registry');
const { completeReflection } = require('./fixtures/completion');

const scratch = path.resolve(__dirname, '../.tmp/runtime-closing-outcome-repairs');
const owner = { host: 'codex', session: 'repair-owner' };
const closer = { host: 'claude', session: 'repair-closer' };
const exitWith = code => async (_executable, _args, options) => {
  options.onFinished({ code, descendantsReclaimed: true });
  return { code, stdout: '', stderr: code === 0 ? '' : 'Simulated failing command', descendantsReclaimed: true };
};
const base = { nativeOwner: () => ({ pid: 12345, created: 'isolated-fixture', name: 'codex.exe' }), ownerAlive: () => true, information: pid => ({ found: true, pid, created: 'fixture-helper', name: 'node.exe' }), runContained: exitWith(0) };
const failing = { ...base, runContained: exitWith(1) };

function project(t) {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(scratch, 'case-')));
  t.after(() => { assert.equal(path.dirname(root), scratch); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'subject.txt'), 'Stable fixture subject\r\n');
  const registry = path.join(root, 'registry');
  new Registry(registry, { create: true }).close();

  return { root, context: { store: registry, host: closer.host, session: closer.session } };
}

const reflection = () => ({ action: 'handover', handoverId: randomUUID(), controller: owner, authority: 'Explicit fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] });

function withStore(root, work) {
  const store = new RunStore(root);
  try { return work(store); } finally { store.close(); }
}

const read = root => withStore(root, store => store.read());
const status = (root, runId = undefined) => execute(root, { action: 'status', ...(runId ? { runId } : {}) }, base);
const select = (root, id) => withStore(root, store => store.db.prepare('UPDATE active SET id=? WHERE singleton=1').run(id));
const closingCheck = (root, name, dependencies) => execute(root, { action: 'check', taskId: '#closing', actor: owner, revision: read(root).revision, check: { name, executable: process.execPath, args: ['--version'], paths: ['subject.txt'], timeoutMs: 5000 } }, dependencies);

async function completed(root, deliver = execute) {
  const request = reflection();
  await execute(root, request, base);
  await completeReflection(root, owner, deliver, base);

  return request;
}

function choicesFor(manifest) {
  return manifest.records.map(record => ({ store: record.store, id: record.id, report: { kind: record.store === 'review' ? 'none' : record.closing.report.delivered ? 'already-delivered' : 'waived' }, followups: record.followups.map(item => ({ id: item.id, disposition: 'dismissed' })) }));
}

function approve(f, members, dependencies = base) {
  const choices = choicesFor(closeManifest(f.root, { members }, f.context, dependencies));
  const manifest = closeManifest(f.root, { members, choices }, f.context, dependencies);

  return { manifest, request: { members, choices, manifestHash: manifest.hash, authority: 'Yes, close them as shown', reason: 'The held closing work is settled', actor: closer } };
}

// A worker an interrupted closing check leaves behind, whose termination nothing proves.
const interruptedWorker = state => state.workers.push({ id: 'interrupted-closing-check', role: 'operation', status: 'unverified', session: null, assignment: 'Closing check', writes: [], startedAt: new Date().toISOString() });

test('a complete delivery whose accounting became unavailable is unavailable and refuses even an exact replay', async t => {
  const f = project(t);
  const original = await completed(f.root);
  const state = read(f.root);
  // Losing the current accounting row, then one ordinary save, leaves an established but non-current checkpoint.
  withStore(f.root, store => {
    store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision=?').run(state.id, state.revision);
    store.update(owner, state.revision, 'fixture-bookkeeping', current => { current.fixtureDiagnostic = 'After accounting loss'; });
  });
  assert.equal(read(f.root).progress.status, 'unavailable');
  const unavailable = await status(f.root);
  assert.equal(unavailable.handoverOutcome.outcome, 'unavailable');
  await assert.rejects(execute(f.root, original, base), { code: 'delivery-consistency-unavailable' });
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(state.id));
});

test('close refuses a record whose lost discharge-index row the creation gate would refuse, leaving it unchanged', async t => {
  const f = project(t);
  await completed(f.root);
  // A stopped record, whose close eligibility reads its accounting marker rather than the closing outcome.
  await execute(f.root, { action: 'stop', actor: owner, revision: read(f.root).revision, kind: 'user-stop', reason: 'Fixture stop after completion' }, base);
  const state = read(f.root);
  assert.equal(state.status, 'stopped');
  withStore(f.root, store => store.db.prepare('DELETE FROM discharge_index WHERE rowid IN (SELECT rowid FROM discharge_index WHERE run_id=? LIMIT 1)').run(state.id));
  const manifest = closeManifest(f.root, { members: [{ store: 'delivery', id: state.id }] }, f.context, base);
  assert.equal(manifest.ineligible[0]?.code, 'close-accounting-unavailable');
  const choices = choicesFor(manifest);
  const request = { members: [{ store: 'delivery', id: state.id }], choices, manifestHash: 'a'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer };
  assert.throws(() => close(f.root, request, f.context, base), { code: 'close-accounting-unavailable' });
  assert.equal(read(f.root).status, 'stopped');
});

test('a current row rolled back behind surviving history reads unavailable on status, Ready and close alike', async t => {
  const f = project(t);
  await completed(f.root);
  const earlier = withStore(f.root, store => store.db.prepare('SELECT revision, state FROM runs').get());
  await closingCheck(f.root, 'post-completion tracking check', failing);
  withStore(f.root, store => store.db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(earlier.revision, earlier.state, JSON.parse(earlier.state).id));
  const id = JSON.parse(earlier.state).id;
  assert.equal((await status(f.root)).handoverOutcome.outcome, 'unavailable');
  assert.equal(overview(f.root, { dependencies: base }).records.find(record => record.id === id).outcome.outcome, 'unavailable');
  assert.equal(closeManifest(f.root, { members: [{ store: 'delivery', id }] }, f.context, base).ineligible[0].code, 'close-accounting-unavailable');
});

test('closing coverage treats an unresolvable snapshot as no coverage rather than failing the judgment', () => {
  const file = sha256 => ({ path: 'README.md', sha256 });
  const record = (checks, reviews) => ({ closing: { docs: { occurrence: 'occurrence', checks, reviews, findings: [] } } });
  const check = (attemptId, files) => ({ attemptId, name: attemptId, passed: true, snapshot: { files } });
  const review = (requestId, revision, files) => ({ requestId, revision, kind: 'docs', status: 'complete', strength: 'strong', independent: true, broad: true, coverageEvidence: 'Assessed the tracking edits', attributionVerified: true, dimensions: [...DIMENSIONS.docs], snapshot: { files } });
  const completedState = record([check('before', [file('a')])], [review('first', 5, [file('a')])]);
  const later = record([...completedState.closing.docs.checks, check('after', [file('b')])], [review('first', 5, [file('a')]), review('second', 9, [file('b')])]);
  const lost = target => value => (value === target ? null : value);
  assert.equal(closingDischargedSince(later, completedState, lost(later.closing.docs.checks[1].snapshot)), false);
  assert.equal(closingDischargedSince(later, completedState, lost(later.closing.docs.reviews[1].snapshot)), false);
});

test('a held delivery whose saved worker refuses close is offered no close on Ready and names no close route on status', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  withStore(f.root, store => store.update(owner, store.read().revision, 'fixture-interrupted-check', interruptedWorker));
  const id = read(f.root).id;
  const record = overview(f.root, { dependencies: base }).records.find(entry => entry.id === id);
  assert.deepEqual([record.close.offer, record.close.reason], ['none', 'worker-activity-unknown']);
  const held = await status(f.root);
  assert.ok(!held.handoverOutcome.routes.some(entry => entry.route === 'close'));
  assert.ok(held.handoverOutcome.routes.some(entry => entry.route === 'none' && entry.code === 'worker-activity-unknown'));
  // The refusal names the record and its outcome, leaving its routes to status.
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'overlapping-run' && error.message.includes(`Delivery ${id} is held.`) && !/Any session/.test(error.message));
});

test('a refusal led by another record still names the selection whose report awaits its recipient', async t => {
  const f = project(t);
  await completed(f.root);
  const first = read(f.root).id;
  const withholdReply = (root, input, dependencies) => (input.action === 'report-delivered' ? execute(root, { action: 'inspect' }, dependencies) : execute(root, input, dependencies));
  await completed(f.root, withholdReply);
  const second = read(f.root).id;
  select(f.root, first);
  withStore(f.root, store => store.update(owner, store.read().revision, 'fixture-closing-replacement', state => { state.closing.docs = { ...state.closing.docs, occurrence: randomUUID() }; }));
  select(f.root, second);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(first) && error.message.includes(second) && /report/.test(error.message));
});

test('status keeps the owner route under the run limits, noting them, for held deliveries built through the runtime', async t => {
  const past = new Date(Date.now() - 60000).toISOString();
  const routes = async root => (await status(root)).handoverOutcome.routes.map(entry => entry.route);
  // A passed deadline and a spent dispatch allowance are not inferred to refuse the owner's work: the route stays with its note.
  const deadline = project(t);
  await completed(deadline.root);
  await closingCheck(deadline.root, 'post-completion tracking check', failing);
  withStore(deadline.root, store => store.update(owner, store.read().revision, 'fixture-deadline', state => { state.limits = { deadlineUtc: past }; }));
  assert.deepEqual(await routes(deadline.root), ['owner', 'close']);
  const spent = project(t);
  await completed(spent.root);
  await closingCheck(spent.root, 'uncovered check', base);
  withStore(spent.root, store => store.update(owner, store.read().revision, 'fixture-allowance', state => { state.limits = { maxDispatches: 0 }; }));
  assert.deepEqual(await routes(spent.root), ['owner', 'close']);
  // A hold whose only cause is a worker: the owner is told to reconcile it, and its unproven termination refuses close.
  const worker = project(t);
  await completed(worker.root);
  withStore(worker.root, store => store.update(owner, store.read().revision, 'fixture-worker', state => { interruptedWorker(state); state.limits = { deadlineUtc: past }; }));
  const held = await status(worker.root);
  assert.deepEqual(held.handoverOutcome.causes.map(entry => entry.concern), ['worker']);
  assert.match(held.handoverOutcome.routes.find(entry => entry.route === 'owner').message, /^The owning session finishes the closing work: reconcile its workers\. The run's deadline/);
  assert.deepEqual(held.handoverOutcome.routes.map(entry => entry.route), ['owner', 'none']);
});

test('a scan that runs out of the shared allowance keeps every record Ready reports today and adds the shortfall notice', async t => {
  const f = project(t);
  await completed(f.root);
  const discharged = read(f.root).id;
  await completed(f.root);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  // A bound the selection's own current state and latest row fit, but no more: the scan runs out on the accounting it reads. The
  // notice alone brings up the run state, since nothing else is listed for these discharged deliveries.
  const selection = withStore(f.root, store => require('../internal/runtime/settled-verdicts').metadataOf(store.db, new Set(['accounting_commits']), store.read().id));
  BOUNDS.input = selection.stateBytes + selection.latestBytes + 1;
  const notice = overview(f.root, { dependencies: base });
  BOUNDS.input = saved;
  assert.deepEqual(notice.records, []);
  assert.deepEqual(notice.notices.map(entry => entry.code), ['closing-outcome-shortfall']);
  assert.deepEqual(notice.unavailable, []);
  assert.ok(discharged);
});

test('a held delivery closed beside a review context reproduces its approved causes on the identical retry after a failed review transaction', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  const id = read(f.root).id;
  const opened = await execute(f.root, { action: 'open-review', reviewContextId: randomUUID(), controller: owner, kind: 'code', authority: 'Explicit standalone revision', objective: 'Fixture review to close', agreement: { source: 'fixture user', outcome: 'Fixture outcome' } }, base);
  const ended = { ...base, ownerAlive: () => false };
  const members = [{ store: 'delivery', id }, { store: 'review', id: opened.id }];
  const { manifest, request } = approve(f, members, ended);
  assert.deepEqual(manifest.ineligible, []);
  let fail = true;
  const failingReview = { ...ended, afterRecompute: store => { if (store === 'review' && fail) { fail = false; throw new RunError('fixture-failure', 'Simulated review transaction failure'); } } };
  assert.throws(() => close(f.root, request, f.context, failingReview), error => error.code === 'fixture-failure' && /Already committed: delivery/.test(error.message));
  assert.equal(read(f.root).status, 'closed');
  const resumed = close(f.root, request, f.context, ended);
  assert.equal(resumed.members.length, 2);
  const approval = withStore(f.root, store => JSON.parse(store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(read(f.root).closure.approval).body));
  assert.equal(approval.records.find(entry => entry.id === id).drops.outcome, 'held');
});

test('an identical close retry refuses when the closed record names a predecessor other than the approved revision', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  const id = read(f.root).id;
  const opened = await execute(f.root, { action: 'open-review', reviewContextId: randomUUID(), controller: owner, kind: 'code', authority: 'Explicit standalone revision', objective: 'Fixture review to close', agreement: { source: 'fixture user', outcome: 'Fixture outcome' } }, base);
  const ended = { ...base, ownerAlive: () => false };
  const members = [{ store: 'delivery', id }, { store: 'review', id: opened.id }];
  const { request } = approve(f, members, ended);
  let fail = true;
  const failingReview = { ...ended, afterRecompute: store => { if (store === 'review' && fail) { fail = false; throw new RunError('fixture-failure', 'Simulated review transaction failure'); } } };
  assert.throws(() => close(f.root, request, f.context, failingReview), { code: 'fixture-failure' });
  // No production writer creates this state: the saved closure points at an earlier revision than the one approved.
  withStore(f.root, store => {
    const saved = JSON.parse(store.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    saved.closure.previousRevision -= 1;
    store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(saved), id);
  });
  assert.throws(() => close(f.root, request, f.context, ended), error => error.code === 'migration-manifest-stale' && error.message.includes(id));
  const review = new RunStore(f.root, { review: true });
  try { assert.notEqual(review.read(opened.id).status, 'closed'); } finally { review.close(); }
});

test('close refuses a nonselected record that fits alone but not beside the selection the creation gate reserves', async t => {
  const f = project(t);
  await completed(f.root);
  const first = read(f.root).id;
  await completed(f.root);
  const second = read(f.root).id;
  select(f.root, first);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, second);
  const members = [{ store: 'delivery', id: first }];
  const { request } = approve(f, members);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  // The smallest bound under which close-manifest, judging the record alone, still admits it.
  const admitted = bound => {
    BOUNDS.input = bound;
    try { return closeManifest(f.root, { members }, f.context, base).ineligible.length === 0; } finally { BOUNDS.input = saved; }
  };
  let low = 1;
  let high = 4 * 1024 * 1024;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (admitted(middle)) high = middle;
    else low = middle;
  }
  BOUNDS.input = high;
  assert.throws(() => close(f.root, request, f.context, base), { code: 'close-bound-unavailable' });
  BOUNDS.input = saved;
  select(f.root, first);
  assert.equal(read(f.root).status, 'complete');
});

test('a complete delivery whose latest history cannot be read is unavailable alone, leaving the other records judged', async t => {
  const f = project(t);
  await completed(f.root);
  const first = read(f.root).id;
  await completed(f.root);
  const second = read(f.root).id;
  select(f.root, first);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, second);
  const latest = read(f.root).revision;
  withStore(f.root, store => store.db.prepare('UPDATE history SET digest=? WHERE run_id=? AND revision=?').run('0'.repeat(64), second, latest));
  const result = overview(f.root, { dependencies: base });
  assert.deepEqual(result.notices, []);
  assert.equal(result.records.find(record => record.id === second).outcome.outcome, 'unavailable');
  assert.equal(result.records.find(record => record.id === first).outcome.outcome, 'held');
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(first) && error.message.includes(second));
});

test('a shortfall keeps the stopped record and the owed report Ready reports, and status still judges each delivery', async t => {
  const f = project(t);
  await completed(f.root);
  const discharged = read(f.root).id;
  const withholdReply = (root, input, dependencies) => (input.action === 'report-delivered' ? execute(root, { action: 'inspect' }, dependencies) : execute(root, input, dependencies));
  await completed(f.root, withholdReply);
  const owing = read(f.root).id;
  // A stopped record beside them, as a delivery stopped after completion is.
  select(f.root, discharged);
  await execute(f.root, { action: 'stop', actor: owner, revision: read(f.root).revision, kind: 'user-stop', reason: 'Fixture stop' }, base);
  select(f.root, owing);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  const selection = withStore(f.root, store => require('../internal/runtime/settled-verdicts').metadataOf(store.db, new Set(['accounting_commits']), owing));
  BOUNDS.input = selection.stateBytes + selection.latestBytes + 1;
  const result = overview(f.root, { dependencies: base });
  BOUNDS.input = saved;
  assert.deepEqual(result.notices.map(entry => entry.code), ['closing-outcome-shortfall']);
  assert.deepEqual(result.unavailable, []);
  assert.equal(result.records.find(record => record.id === discharged).status, 'stopped');
  assert.deepEqual(result.records.find(record => record.id === owing).pickup, { offer: 'present-report' });
  assert.equal((await status(f.root, owing)).handoverOutcome.outcome, 'discharged');
});

test('whenever close commits a nonselected closed record, the next handover under the same bound can count it', async t => {
  const f = project(t);
  await completed(f.root);
  const first = read(f.root).id;
  // A selection whose report is confirmed after completion, so its current revision follows its completion row.
  const withholdReply = (root, input, dependencies) => (input.action === 'report-delivered' ? execute(root, { action: 'inspect' }, dependencies) : execute(root, input, dependencies));
  await completed(f.root, withholdReply);
  const second = read(f.root).id;
  await execute(f.root, { action: 'report-delivered', actor: owner, revision: read(f.root).revision, authority: 'The fixture recipient replied after the report' }, base);
  select(f.root, first);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, second);
  const { request } = approve(f, [{ store: 'delivery', id: first }]);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  // The smallest bound at which close's judgment of the closed record passes; the probe aborts before the commit.
  const probe = { ...base, beforeCommit: () => { throw new RunError('fixture-probe', 'Judgment passed'); } };
  const passes = bound => {
    BOUNDS.input = bound;
    try {
      close(f.root, request, f.context, probe);
      return true;
    } catch (error) {
      if (error.code === 'fixture-probe') return true;
      if (['close-bound-unavailable', 'close-judgment-unavailable', 'close-accounting-unavailable'].includes(error.code)) return false;
      throw error;
    } finally { BOUNDS.input = saved; }
  };
  let low = 1;
  let high = 4 * 1024 * 1024;
  assert.equal(passes(high), true);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (passes(middle)) high = middle;
    else low = middle;
  }
  BOUNDS.input = high;
  close(f.root, request, f.context, base);
  const { creationAssessment } = require('../internal/runtime/creation-consistency');
  assert.doesNotThrow(() => withStore(f.root, store => store.transaction(() => creationAssessment(store))));
  BOUNDS.input = saved;
});

test('an unreadable completion row read after accounting is established is a failure of evidence', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  const id = read(f.root).id;
  // A completion body whose recorded length and digest still match, but which is not JSON.
  withStore(f.root, store => {
    const revision = store.db.prepare("SELECT max(revision) AS revision FROM history WHERE run_id=? AND kind='complete'").get(id).revision;
    const body = '{"not json';
    store.db.prepare("UPDATE history SET body=?, bytes=?, digest=?, encoding='full' WHERE run_id=? AND revision=?").run(body, Buffer.byteLength(body), require('node:crypto').createHash('sha256').update(body).digest('hex'), id, revision);
  });
  const outcome = (await status(f.root)).handoverOutcome;
  assert.equal(outcome.outcome, 'unauthenticated');
  assert.deepEqual(closeManifest(f.root, { members: [{ store: 'delivery', id }] }, f.context, base).ineligible, []);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(id) && /unauthenticated/.test(error.message));
});

test('Ready carries a held delivery\'s outcome and causes with its close offer, leaving routes to status', async t => {
  const spent = project(t);
  await completed(spent.root);
  await closingCheck(spent.root, 'uncovered check', base);
  withStore(spent.root, store => store.update(owner, store.read().revision, 'fixture-allowance', state => { state.limits = { maxDispatches: 0 }; }));
  const [record] = overview(spent.root, { dependencies: base }).records;
  assert.deepEqual(Object.keys(record.outcome).sort(), ['causes', 'outcome']);
  assert.deepEqual([record.outcome.outcome, record.outcome.causes.map(entry => entry.concern)], ['held', ['check']]);
  assert.deepEqual(record.close, { offer: 'close' });
  const worker = project(t);
  await completed(worker.root);
  withStore(worker.root, store => store.update(owner, store.read().revision, 'fixture-worker', interruptedWorker));
  const [held] = overview(worker.root, { dependencies: base }).records;
  assert.deepEqual([held.outcome.outcome, held.close.offer, held.close.reason], ['held', 'none', 'worker-activity-unknown']);
});

test('a shortfall keeps the held outcome judged before it, while the gate keeps its allowance refusal and each record is judged alone', async t => {
  // The scan judges the selection first and the rest in id order: build projects until one held record sorts before another, so the
  // allowance can run out between them. The store also holds a stopped record and a selection whose report awaits its recipient.
  const withholdReply = (root, input, dependencies) => (input.action === 'report-delivered' ? execute(root, { action: 'inspect' }, dependencies) : execute(root, input, dependencies));
  let f;
  let held;
  let later;
  let selection;
  let stopped;
  for (let attempt = 0; attempt < 12 && !f; attempt++) {
    const candidate = project(t);
    const ids = [];
    for (let index = 0; index < 3; index++) {
      await completed(candidate.root);
      ids.push(read(candidate.root).id);
    }
    await completed(candidate.root, withholdReply);
    if (ids[1] < ids[2]) [f, stopped, held, later, selection] = [candidate, ids[0], ids[1], ids[2], read(candidate.root).id];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  select(f.root, stopped);
  await execute(f.root, { action: 'stop', actor: owner, revision: read(f.root).revision, kind: 'user-stop', reason: 'Fixture stop' }, base);
  for (const id of [held, later]) {
    select(f.root, id);
    await closingCheck(f.root, 'post-completion tracking check', failing);
  }
  select(f.root, selection);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  const shown = bound => {
    BOUNDS.input = bound;
    try { return overview(f.root, { dependencies: base }); } finally { BOUNDS.input = saved; }
  };
  // The smallest bound at which the first held record is judged: the later one no longer fits after it.
  const high = smallestBound(bound => shown(bound).records.some(record => record.id === held));
  const result = shown(high);
  assert.equal(result.records.find(record => record.id === held).outcome.outcome, 'held');
  assert.equal(result.records.some(record => record.id === later), false);
  assert.deepEqual(result.notices.map(entry => entry.code), ['closing-outcome-shortfall']);
  assert.deepEqual(result.unavailable, []);
  const stoppedRecord = result.records.find(record => record.id === stopped);
  assert.equal(stoppedRecord.status, 'stopped');
  assert.equal(stoppedRecord.pickup.reason, 'not-current');
  const owing = result.records.find(record => record.id === selection);
  assert.deepEqual(owing.pickup, { offer: 'present-report' });
  // The selection was judged discharged, so it carries no outcome.
  assert.equal(owing.outcome, undefined);
  BOUNDS.input = high;
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && /byte bound/.test(error.message));
  assert.equal((await status(f.root, later)).handoverOutcome.outcome, 'held');
  assert.deepEqual(closeManifest(f.root, { members: [{ store: 'delivery', id: later }] }, f.context, base).ineligible, []);
  BOUNDS.input = saved;
});

// The smallest bound at which `passes` holds, by bisection between 1 and 4 MiB, which must pass.
function smallestBound(passes) {
  let low = 1;
  let high = 4 * 1024 * 1024;
  assert.equal(passes(high), true);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (passes(middle)) high = middle;
    else low = middle;
  }

  return high;
}

test('under a later release\'s verdict protection, close commits only what a full creation pass then counts', async t => {
  // Record ids are random: build projects until a discharged record sorts before both the selection and the closed candidate.
  let f;
  let candidate;
  for (let attempt = 0; attempt < 16 && !f; attempt++) {
    const trial = project(t);
    await completed(trial.root);
    const first = read(trial.root).id;
    await completed(trial.root);
    const second = read(trial.root).id;
    await completed(trial.root);
    const third = read(trial.root).id;
    if (first < second && first < third) [f, candidate] = [trial, second];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  const selection = read(f.root).id;
  select(f.root, candidate);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, selection);
  // A guard this runtime does not recognize marks the protection as a later release's: verdicts are neither accepted nor written.
  withStore(f.root, store => store.db.exec("CREATE TRIGGER verdict_guard_later_release BEFORE DELETE ON runs BEGIN SELECT 1; END"));
  const { request } = approve(f, [{ store: 'delivery', id: candidate }]);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  const probe = { ...base, beforeCommit: () => { throw new RunError('fixture-probe', 'Judgment passed'); } };
  const bound = smallestBound(value => {
    BOUNDS.input = value;
    try {
      close(f.root, request, f.context, probe);
      return true;
    } catch (error) {
      if (error.code === 'fixture-probe') return true;
      if (['close-bound-unavailable', 'close-judgment-unavailable', 'close-accounting-unavailable'].includes(error.code)) return false;
      throw error;
    } finally { BOUNDS.input = saved; }
  });
  BOUNDS.input = bound;
  close(f.root, request, f.context, base);
  const { creationAssessment } = require('../internal/runtime/creation-consistency');
  assert.doesNotThrow(() => withStore(f.root, store => store.transaction(() => creationAssessment(store))));
  BOUNDS.input = saved;
});

test('an unreadable completion row still names the closing work found beside it', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  const id = read(f.root).id;
  withStore(f.root, store => {
    const revision = store.db.prepare("SELECT max(revision) AS revision FROM history WHERE run_id=? AND kind='complete'").get(id).revision;
    const body = '{"not json';
    store.db.prepare("UPDATE history SET body=?, bytes=?, digest=?, encoding='full' WHERE run_id=? AND revision=?").run(body, Buffer.byteLength(body), require('node:crypto').createHash('sha256').update(body).digest('hex'), id, revision);
  });
  const outcome = (await status(f.root)).handoverOutcome;
  assert.equal(outcome.outcome, 'unauthenticated');
  assert.ok(outcome.causes.some(entry => entry.kind === 'work' && entry.subject === 'post-completion tracking check'));
});

test('a damaged store holding only a stopped delivery is refused at store level, and close with choices keeps that refusal', async t => {
  const f = project(t);
  await execute(f.root, reflection(), base);
  const id = read(f.root).id;
  await execute(f.root, { action: 'stop', actor: owner, revision: read(f.root).revision, kind: 'user-stop', reason: 'Fixture stop' }, base);
  // No complete delivery is judged, so the damage check must run on its own in every reader.
  withStore(f.root, store => store.db.exec('DROP TABLE discharge_index'));
  await assert.rejects(status(f.root, id), /damaged as a whole/);
  const ready = overview(f.root, { dependencies: base });
  assert.deepEqual([ready.records.length, ready.unavailable.map(entry => entry.store)], [0, ['delivery']]);
  const members = [{ store: 'delivery', id }];
  const manifest = closeManifest(f.root, { members, choices: [{ store: 'delivery', id, report: { kind: 'none' }, followups: [] }] }, f.context, base);
  assert.deepEqual([manifest.ineligible[0].code, manifest.hash], ['migration-store-unavailable', null]);
  // An acknowledgement the unreadable store cannot confirm is carried unchecked, so the store refusal still leads.
  const acknowledged = closeManifest(f.root, { members, choices: [{ store: 'delivery', id, report: { kind: 'none' }, followups: [] }], acknowledgedRecords: [{ store: 'delivery', id: randomUUID() }] }, f.context, base);
  assert.deepEqual([acknowledged.ineligible[0].code, acknowledged.hash], ['migration-store-unavailable', null]);
  assert.throws(() => close(f.root, { members, choices: [{ store: 'delivery', id, report: { kind: 'none' }, followups: [] }], manifestHash: 'a'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer }, f.context, base), { code: 'migration-store-unavailable' });
});

test('a stored row revision that contradicts its state reads unavailable on Ready', async t => {
  const f = project(t);
  await completed(f.root);
  const id = read(f.root).id;
  withStore(f.root, store => store.db.prepare('UPDATE runs SET revision=revision+1 WHERE id=?').run(id));
  const record = overview(f.root, { dependencies: base }).records.find(entry => entry.id === id);
  assert.equal(record?.outcome?.outcome, 'unavailable');
  // The other surfaces meet the damage in their own reads, as the runtime reference states.
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(id));
  await assert.rejects(status(f.root, id), { code: 'invalid-revision' });
  assert.equal(closeManifest(f.root, { members: [{ store: 'delivery', id }] }, f.context, base).ineligible[0].code, 'migration-store-unavailable');
});

test('close refuses while an earlier record a pass can never vouch for keeps the creation pass short of the closed record', async t => {
  let f;
  let candidate;
  let earlier;
  for (let attempt = 0; attempt < 16 && !f; attempt++) {
    const trial = project(t);
    await completed(trial.root);
    const first = read(trial.root).id;
    await completed(trial.root);
    const second = read(trial.root).id;
    await completed(trial.root);
    const third = read(trial.root).id;
    if (first < second && first < third) [f, earlier, candidate] = [trial, first, second];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  const selection = read(f.root).id;
  select(f.root, candidate);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, selection);
  // A verdict under a rule this runtime does not know is a later release's: every pass leaves it and judges its record in full.
  withStore(f.root, store => {
    const metadata = require('../internal/runtime/settled-verdicts').metadataOf(store.db, new Set(['accounting_commits']), earlier);
    store.db.prepare('DELETE FROM settled_verdicts WHERE run_id=?').run(earlier);
    store.db.prepare('INSERT INTO settled_verdicts (run_id, revision, state_bytes, state_digest, latest_revision, latest_bytes, journal_revision, acceptance, retirement, rule) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)').run(earlier, metadata.revision, metadata.stateBytes, 'a'.repeat(64), metadata.latestRevision, metadata.latestBytes, metadata.journalRevision, 'settled-record-verdict-later');
  });
  const { request } = approve(f, [{ store: 'delivery', id: candidate }]);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  const probe = { ...base, beforeCommit: () => { throw new RunError('fixture-probe', 'Judgment passed'); } };
  const bound = smallestBound(value => {
    BOUNDS.input = value;
    try {
      close(f.root, request, f.context, probe);
      return true;
    } catch (error) {
      if (error.code === 'fixture-probe') return true;
      if (['close-bound-unavailable', 'close-judgment-unavailable', 'close-accounting-unavailable'].includes(error.code)) return false;
      throw error;
    } finally { BOUNDS.input = saved; }
  });
  BOUNDS.input = bound;
  close(f.root, request, f.context, base);
  const { creationAssessment } = require('../internal/runtime/creation-consistency');
  assert.doesNotThrow(() => withStore(f.root, store => store.transaction(() => creationAssessment(store))));
  BOUNDS.input = saved;
});

test('a record refusal that ends the pass still names the held delivery judged before it', async t => {
  let f;
  let held;
  let broken;
  for (let attempt = 0; attempt < 12 && !f; attempt++) {
    const trial = project(t);
    await completed(trial.root);
    const first = read(trial.root).id;
    await completed(trial.root);
    const second = read(trial.root).id;
    await completed(trial.root);
    if (first < second) [f, held, broken] = [trial, first, second];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  const selection = read(f.root).id;
  select(f.root, held);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, selection);
  withStore(f.root, store => {
    store.db.prepare('DELETE FROM settled_verdicts WHERE run_id=?').run(broken);
    store.db.prepare('UPDATE runs SET revision=revision+1 WHERE id=?').run(broken);
  });
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(held) && error.message.includes(broken));
});

test('status identifies a retired complete delivery as retired, with no outcome', async t => {
  const f = project(t);
  await completed(f.root);
  const retired = read(f.root).id;
  await completed(f.root);
  withStore(f.root, store => {
    store.db.exec('CREATE TABLE IF NOT EXISTS legacy_retirements (run_id TEXT PRIMARY KEY REFERENCES runs(id), artifact TEXT NOT NULL)');
    store.db.prepare('INSERT INTO legacy_retirements(run_id, artifact) VALUES (?, ?)').run(retired, 'fixture-certificate');
  });
  assert.deepEqual((await status(f.root, retired)).handoverOutcome, { retired: true });
});

test('a selection past its own bound reads unavailable on Ready, not as a store-level shortfall', async t => {
  let f;
  let sibling;
  for (let attempt = 0; attempt < 12 && !f; attempt++) {
    const trial = project(t);
    await completed(trial.root);
    const first = read(trial.root).id;
    await completed(trial.root);
    if (first < read(trial.root).id) [f, sibling] = [trial, first];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  const selection = read(f.root).id;
  // The sibling is held, so no verdict vouches for it and the scan reaches it.
  select(f.root, sibling);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, selection);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  const metadata = withStore(f.root, store => require('../internal/runtime/settled-verdicts').metadataOf(store.db, new Set(['accounting_commits']), selection));
  BOUNDS.input = metadata.stateBytes + metadata.latestBytes - 1;
  const result = overview(f.root, { dependencies: base });
  BOUNDS.input = saved;
  assert.equal(result.records.find(record => record.id === selection)?.outcome?.outcome, 'unavailable');
});

test('status of a readable nonselected delivery does not depend on a damaged selection', async t => {
  const f = project(t);
  await completed(f.root);
  const first = read(f.root).id;
  await completed(f.root);
  const selection = read(f.root).id;
  // The selection is never vouched for by a verdict, so its row can be damaged directly.
  withStore(f.root, store => store.db.prepare('UPDATE runs SET revision=revision+1 WHERE id=?').run(selection));
  assert.equal((await status(f.root, first)).handoverOutcome.outcome, 'discharged');
});

test('a refusal led by another record does not name a discharged stopped selection as blocking', async t => {
  const f = project(t);
  await completed(f.root);
  const first = read(f.root).id;
  await completed(f.root);
  const second = read(f.root).id;
  await execute(f.root, { action: 'stop', actor: owner, revision: read(f.root).revision, kind: 'user-stop', reason: 'Fixture stop after completion' }, base);
  select(f.root, first);
  withStore(f.root, store => store.update(owner, store.read().revision, 'fixture-closing-replacement', state => { state.closing.docs = { ...state.closing.docs, occurrence: randomUUID() }; }));
  select(f.root, second);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(first) && !/\(selected\) is stopped/.test(error.message));
});

test('a malformed worker entry gives structured refusals on status, close-manifest and the handover', async t => {
  const f = project(t);
  await completed(f.root);
  const id = read(f.root).id;
  // Only the current row is damaged, so the committed history disagrees with it.
  withStore(f.root, store => {
    const state = JSON.parse(store.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.workers.push(null);
    store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), id);
  });
  // The ordinary read refuses the record, so status fails with that structured cause, as for any unreadable record.
  await assert.rejects(status(f.root), { code: 'invalid-state' });
  assert.equal(closeManifest(f.root, { members: [{ store: 'delivery', id }] }, f.context, base).ineligible[0].code, 'close-accounting-unavailable');
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(id));
});

test('a held delivery closed beside an earlier legacy record is judged on its own close row', async t => {
  let f;
  let earlier;
  let candidate;
  for (let attempt = 0; attempt < 16 && !f; attempt++) {
    const trial = project(t);
    const ids = [];
    for (let index = 0; index < 3; index++) {
      await completed(trial.root);
      ids.push(read(trial.root).id);
    }
    if (ids[0] < ids[1]) [f, earlier, candidate] = [trial, ids[0], ids[1]];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  const selection = read(f.root).id;
  select(f.root, candidate);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, selection);
  // The earlier record as a release before schema-2 accounting saved it, whose replay the gate groups as legacy.
  withStore(f.root, store => {
    const { rewriteHistory } = require('./fixtures/history');
    const strip = text => {
      const state = JSON.parse(text);
      delete state.progress;
      delete state.stopRecovery;
      state.closing = { ...state.closing, triageEvidence: null };
      return JSON.stringify(state);
    };
    store.transaction(() => {
      store.db.prepare('DELETE FROM settled_verdicts WHERE run_id=?').run(earlier);
      store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(strip(store.db.prepare('SELECT state FROM runs WHERE id=?').get(earlier).state), earlier);
      rewriteHistory(store.db, strip, { runId: earlier });
      store.db.prepare('DELETE FROM accounting_commits WHERE run_id=?').run(earlier);
      store.db.prepare('DELETE FROM discharge_index WHERE run_id=?').run(earlier);
    });
  });
  // The held record the pass deferred behind the legacy blocker is never judged, so it is not named as a blocker of its own.
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(earlier) && /Legacy delivery consistency/.test(error.message) && !error.message.includes(`Delivery ${candidate} (complete) still has unresolved`));
  const { request } = approve(f, [{ store: 'delivery', id: candidate }]);
  close(f.root, request, f.context, base);
  assert.equal(withStore(f.root, store => store.read(candidate, { hydrate: false })).status, 'closed');
});

test('a workers value that is not a list is refused by the ordinary read', async t => {
  const f = project(t);
  await completed(f.root);
  const id = read(f.root).id;
  withStore(f.root, store => {
    const state = JSON.parse(store.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.workers = { broken: true };
    store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), id);
  });
  await assert.rejects(status(f.root), { code: 'invalid-state' });
});

test('status gives an accounting-unavailable delivery the remedy close gives, retirement for a legacy record included', async t => {
  const f = project(t);
  await completed(f.root);
  const state = read(f.root);
  withStore(f.root, store => store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision=?').run(state.id, state.revision));
  const [recovery] = (await status(f.root)).handoverOutcome.routes;
  assert.equal(recovery.route, 'recovery');
  assert.match(recovery.message, /retire it when listed as legacy/);
});

test('a held selection that owes its report refuses as overlap, replays unchanged and offers the report beside close', async t => {
  const f = project(t);
  const withholdReply = (root, input, dependencies) => (input.action === 'report-delivered' ? execute(root, { action: 'inspect' }, dependencies) : execute(root, input, dependencies));
  const original = reflection();
  await execute(f.root, original, base);
  await completeReflection(f.root, owner, withholdReply, base);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  const held = read(f.root);
  await assert.rejects(execute(f.root, reflection(), base), { code: 'overlapping-run' });
  const rows = withStore(f.root, store => store.db.prepare('SELECT count(*) AS n FROM history').get().n);
  assert.equal((await execute(f.root, original, base)).revision, held.revision);
  assert.equal(withStore(f.root, store => store.db.prepare('SELECT count(*) AS n FROM history').get().n), rows);
  const [record] = overview(f.root, { dependencies: base }).records;
  assert.deepEqual(record.pickup, { offer: 'present-report' });
  assert.deepEqual(record.close, { offer: 'close' });
  // A close the saved worker refuses leaves the report presentable.
  withStore(f.root, store => store.update(owner, store.read().revision, 'fixture-interrupted-check', interruptedWorker));
  const [refused] = overview(f.root, { dependencies: base }).records;
  assert.deepEqual(refused.pickup, { offer: 'present-report' });
  assert.equal(refused.close.reason, 'worker-activity-unknown');
  // So does an unavailable outcome on the same selection.
  const state = read(f.root);
  withStore(f.root, store => store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision=?').run(state.id, state.revision));
  const [unavailable] = overview(f.root, { dependencies: base }).records;
  assert.deepEqual(unavailable.pickup, { offer: 'present-report' });
  assert.equal(unavailable.outcome.outcome, 'unavailable');
  assert.equal(unavailable.close.reason, 'close-accounting-unavailable');
});

test('a held and an unauthenticated delivery in one pass refuse as a consistency failure naming both', async t => {
  const f = project(t);
  await completed(f.root);
  const held = read(f.root).id;
  await completed(f.root);
  const unauthenticated = read(f.root).id;
  await completed(f.root);
  const selection = read(f.root).id;
  select(f.root, held);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, unauthenticated);
  withStore(f.root, store => store.update(owner, store.read().revision, 'fixture-closing-replacement', state => { state.closing.docs = { ...state.closing.docs, occurrence: randomUUID() }; }));
  select(f.root, selection);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(held) && error.message.includes(unauthenticated) && /is held/.test(error.message) && /is unauthenticated/.test(error.message));
});

test('an undischarged nonselected stopped delivery is named by its status, pointing to status and close-manifest', async t => {
  const f = project(t);
  await completed(f.root);
  const stopped = read(f.root).id;
  const original = await completed(f.root);
  const selection = read(f.root).id;
  select(f.root, stopped);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  await execute(f.root, { action: 'stop', actor: owner, revision: read(f.root).revision, kind: 'user-stop', reason: 'Fixture stop after a failed closing check' }, base);
  select(f.root, selection);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(`Delivery ${stopped} (stopped) has unresolved`) && /close-manifest/.test(error.message) && !/post-completion tracking check/.test(error.message));
  // Held as well, the selection no longer refuses its own exact replay, but the stopped delivery still does, under its own code.
  await closingCheck(f.root, 'post-completion tracking check', failing);
  await assert.rejects(execute(f.root, original, base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(`Delivery ${stopped} (stopped) has unresolved`) && error.message.includes(`Delivery ${selection} is held.`));
});

test('a nonselected delivery a current verdict vouches for reads discharged on status, Ready and close-manifest alike', async t => {
  const f = project(t);
  await completed(f.root);
  const first = read(f.root).id;
  await completed(f.root);
  // A creation pass over the store writes the verdict for the settled nonselected record.
  const { creationAssessment } = require('../internal/runtime/creation-consistency');
  withStore(f.root, store => store.transaction(() => creationAssessment(store)));
  const db = outcomes.openStore(f.root);
  try { assert.equal(outcomes.readOutcomes(db, f.root, { ids: [first] }).byId.get(first).verdicted, true); }
  finally { db.close(); }
  // A completion-row bound below the record's row makes a fresh judgment read it unavailable, so each reader below is shown to keep
  // the verdict rather than judge afresh; the ordinary read status uses applies no such bound.
  const saved = BOUNDS.completionRow;
  t.after(() => { BOUNDS.completionRow = saved; });
  BOUNDS.completionRow = 1;
  assert.equal((await status(f.root, first)).handoverOutcome.outcome, 'discharged');
  assert.equal(overview(f.root, { dependencies: base }).records.some(record => record.id === first), false);
  assert.equal(closeManifest(f.root, { members: [{ store: 'delivery', id: first }] }, f.context, base).ineligible[0].code, 'close-not-needed');
  // Control: without its verdict the same record, judged afresh under the same bound, is unavailable.
  withStore(f.root, store => store.db.prepare('DELETE FROM settled_verdicts WHERE run_id=?').run(first));
  assert.equal(overview(f.root, { dependencies: base }).records.find(record => record.id === first)?.outcome.outcome, 'unavailable');
});

test('a standalone review context completed through its lifecycle stays outside the closing-hold flow on every surface', async t => {
  const f = project(t);
  // A committed baseline, as a standalone docs revision is assessed against Git.
  const git = args => assert.equal(require('node:child_process').spawnSync('git', args, { cwd: f.root, windowsHide: true, encoding: 'utf8' }).status, 0);
  fs.writeFileSync(path.join(f.root, 'README.md'), '# Fixture\n\n1.0.0\n');
  git(['init', '--quiet']);
  git(['add', 'README.md', 'subject.txt']);
  git(['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish standalone baseline']);
  fs.writeFileSync(path.join(f.root, 'README.md'), '# Fixture\n\n1.0.1\n');
  const opened = await execute(f.root, { action: 'open-review', reviewContextId: randomUUID(), controller: owner, kind: 'docs', authority: 'Explicit standalone revision', objective: 'Bump the documented version', agreement: { source: 'fixture user', outcome: 'Record the version-only change' } }, base);
  const advanced = await execute(f.root, { action: 'advance', reviewContextId: opened.id, actor: owner, revision: opened.revision, evidence: 'Only the version string changed', docsExemption: 'Purely mechanical version-string update' }, base);
  const done = await execute(f.root, { action: 'complete', reviewContextId: opened.id, actor: owner, revision: advanced.revision }, base);
  assert.equal(done.status, 'complete');
  // Status of the context carries no closing outcome, and Ready neither lists it nor adds a notice.
  const read = await execute(f.root, { action: 'status', reviewContextId: opened.id }, base);
  assert.equal(read.handoverOutcome, undefined);
  const ready = overview(f.root, { dependencies: base });
  assert.equal(ready.records.some(record => record.id === opened.id), false);
  assert.deepEqual(ready.notices, []);
  const members = [{ store: 'review', id: opened.id }];
  assert.equal(closeManifest(f.root, { members }, f.context, base).ineligible[0].code, 'close-not-needed');
  assert.throws(() => close(f.root, { members, choices: [{ store: 'review', id: opened.id, report: { kind: 'none' }, followups: [] }], manifestHash: 'a'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer }, f.context, base), { code: 'close-not-needed' });
  // A delivery handed over beside it is accepted.
  assert.equal((await execute(f.root, reflection(), base)).status, 'running');
});

test('a stopped selection deferred behind an earlier legacy record is not named as a blocker of its own', async t => {
  let f;
  let earlier;
  for (let attempt = 0; attempt < 16 && !f; attempt++) {
    const trial = project(t);
    const ids = [];
    for (let index = 0; index < 3; index++) {
      await completed(trial.root);
      ids.push(read(trial.root).id);
    }
    // The gate judges in id order, so the legacy record must sort before the record that stays selected.
    if (ids[0] < ids[2]) [f, earlier] = [trial, ids[0]];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  const selection = read(f.root).id;
  assert.ok(earlier < selection, 'The legacy record sorts before the selection');
  await closingCheck(f.root, 'post-completion tracking check', failing);
  await execute(f.root, { action: 'stop', actor: owner, revision: read(f.root).revision, kind: 'user-stop', reason: 'Fixture stop after a failed closing check' }, base);
  withStore(f.root, store => {
    const { rewriteHistory } = require('./fixtures/history');
    const strip = text => {
      const state = JSON.parse(text);
      delete state.progress;
      delete state.stopRecovery;
      state.closing = { ...state.closing, triageEvidence: null };
      return JSON.stringify(state);
    };
    store.transaction(() => {
      store.db.prepare('DELETE FROM settled_verdicts WHERE run_id=?').run(earlier);
      store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(strip(store.db.prepare('SELECT state FROM runs WHERE id=?').get(earlier).state), earlier);
      rewriteHistory(store.db, strip, { runId: earlier });
      store.db.prepare('DELETE FROM accounting_commits WHERE run_id=?').run(earlier);
      store.db.prepare('DELETE FROM discharge_index WHERE run_id=?').run(earlier);
    });
  });
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(earlier) && /Legacy delivery consistency/.test(error.message) && !error.message.includes(`Delivery ${selection} (selected) is stopped`));
});

test('an unreadable closing baseline or snapshot body makes the delivery unauthenticated and both close surfaces refuse it naming the bug', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', base);
  const state = withStore(f.root, store => store.read(undefined, { hydrate: false }));
  // The bodies the outcome predicate reads: the closing baseline, or a closing check's or review's snapshot.
  const references = [];
  const walk = (value, at) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$artifact === 'string') { references.push({ at, id: value.$artifact }); return; }
    for (const [key, item] of Object.entries(value)) walk(item, `${at}.${key}`);
  };
  walk(state.closing.docs.baseline, 'baseline');
  for (const [index, check] of state.closing.docs.checks.entries()) walk(check.snapshot, `checks.${index}.snapshot`);
  assert.ok(references.length > 0, 'The closing record stores a baseline or snapshot body');
  withStore(f.root, store => store.db.prepare('DELETE FROM artifacts WHERE id=?').run(references[0].id));
  assert.equal(outcomes.outcomeOf(f.root, state.id).judgment.outcome, 'unauthenticated');
  // Status meets the loss through its ordinary read; Ready still lists the delivery with its outcome.
  await assert.rejects(status(f.root), { code: 'missing-evidence' });
  assert.equal(overview(f.root, { dependencies: base }).records.find(record => record.id === state.id).outcome.outcome, 'unauthenticated');
  const members = [{ store: 'delivery', id: state.id }];
  const manifest = closeManifest(f.root, { members }, f.context, base);
  assert.equal(manifest.ineligible[0].code, 'missing-evidence');
  assert.equal(manifest.ineligible[0].bug, outcomes.BUG);
  let refusal;
  try { close(f.root, { members, choices: choicesFor(manifest), manifestHash: 'a'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer }, f.context, base); }
  catch (error) { refusal = error; }
  assert.deepEqual([refusal?.code, refusal?.message.includes(outcomes.BUG)], ['missing-evidence', true]);
  assert.equal(withStore(f.root, store => store.read(undefined, { hydrate: false })).status, 'complete');
});

test('a store missing a table its records need is refused at store level by every surface, with no record outcome', async t => {
  // External losses no production writer leaves. The last two keep only a surviving accounting row as evidence: no record carries
  // saved accounting, and in the last the row's own record is gone as well.
  const stripProgress = store => { for (const row of store.db.prepare('SELECT id, state FROM runs').all()) { const state = JSON.parse(row.state); delete state.progress; store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), row.id); } };
  const orphan = (store, id) => {
    store.db.exec('PRAGMA foreign_keys=OFF');
    for (const table of ['active', 'history', 'runs']) store.db.prepare(`DELETE FROM ${table} WHERE ${table === 'history' ? 'run_id' : 'id'}=?`).run(id);
  };
  const forms = [['discharge_index'], ['accounting_commits'], ['artifacts'], ['active'], ['discharge_index', stripProgress], ['discharge_index', orphan]];
  for (const [table, extra] of forms) {
    const label = `${table}${extra ? ` with ${extra === orphan ? 'an orphaned accounting row' : 'no saved accounting'}` : ''}`;
    const f = project(t);
    await completed(f.root);
    const id = read(f.root).id;
    withStore(f.root, store => { store.db.exec(`DROP TABLE ${table}`); extra?.(store, id); });
    if (extra === orphan) withStore(f.root, store => assert.ok(store.db.prepare('SELECT 1 FROM accounting_commits WHERE run_id=?').get(id), 'The accounting row outlives its record'));
    await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && /lacks/.test(error.message) && !error.message.includes(`Delivery ${id} is`), label);
    await assert.rejects(status(f.root, id), { code: 'migration-store-unavailable' }, label);
    const ready = overview(f.root, { dependencies: base });
    assert.deepEqual([ready.records.length, ready.unavailable.map(entry => entry.store)], [0, ['delivery']], label);
    const members = [{ store: 'delivery', id }];
    const choices = [{ store: 'delivery', id, report: { kind: 'waived' }, followups: [] }];
    assert.equal(closeManifest(f.root, { members, choices }, f.context, base).ineligible[0].code, 'migration-store-unavailable', label);
    assert.throws(() => close(f.root, { members, choices, manifestHash: 'a'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer }, f.context, base), { code: 'migration-store-unavailable' }, label);
  }
});

test('an interrupted closing check holds the delivery with its pending attempt and worker, refuses close until termination is proven, then closes', async t => {
  const f = project(t);
  await completed(f.root);
  const id = read(f.root).id;
  // The production check writer loses its command's termination evidence, leaving a pending attempt and an unverified worker.
  const lost = { ...base, information: () => ({ found: true, pid: 7101, created: 'helper', name: 'node.exe' }), runContained: async () => { throw new Error('Lost command termination evidence'); } };
  await assert.rejects(closingCheck(f.root, 'interrupted closing check', lost), /Lost command termination evidence/);
  const state = read(f.root);
  const worker = state.workers.at(-1);
  assert.equal(worker.status, 'unverified');
  assert.ok(worker.terminationPath && worker.helperProcess, 'The production writer saves the termination path and helper identity');
  const held = (await status(f.root)).handoverOutcome;
  assert.equal(held.outcome, 'held');
  assert.deepEqual([...new Set(held.causes.map(entry => entry.concern))].sort(), ['check', 'worker']);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'overlapping-run' && error.message.includes(id));
  const [record] = overview(f.root, { dependencies: base }).records;
  assert.deepEqual([record.close.offer, record.close.reason], ['none', 'worker-activity-unknown']);
  const members = [{ store: 'delivery', id }];
  assert.equal(closeManifest(f.root, { members }, f.context, base).ineligible[0].code, 'worker-activity-unknown');
  // Reopened by block as well, the delivery has no owner route, and status names the worker refusal with its remedy and no bug.
  const taskId = read(f.root).tasks[0].id;
  await execute(f.root, { action: 'block', taskId, actor: owner, revision: read(f.root).revision, blocker: { kind: 'user-decision', reason: 'Fixture reopening after completion', recoveryAttempted: 'None' } }, base);
  const reopened = (await status(f.root)).handoverOutcome;
  const none = reopened.routes.find(entry => entry.route === 'none');
  assert.deepEqual([reopened.routes.some(entry => entry.route === 'owner'), none?.code, none?.bug], [false, 'worker-activity-unknown', undefined]);
  // With the helper and owner ended but no termination evidence, close itself refuses and writes nothing.
  const ended = { ...base, ownerAlive: () => false, information: pid => ({ found: false, pid }) };
  const unproven = read(f.root).revision;
  assert.throws(() => close(f.root, { members, choices: choicesFor(closeManifest(f.root, { members }, f.context, ended)), manifestHash: 'a'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer }, f.context, ended), { code: 'worker-activity-unknown' });
  assert.deepEqual([read(f.root).status, read(f.root).revision], ['complete', unproven]);
  // Termination proven: the contained helper's termination file and an ended helper and owner.
  fs.mkdirSync(path.dirname(path.join(f.root, worker.terminationPath)), { recursive: true });
  fs.writeFileSync(path.join(f.root, worker.terminationPath), JSON.stringify({ runId: id, workerId: worker.id, helperProcess: worker.helperProcess, descendantsReclaimed: true, exitCode: 1, observedAt: new Date().toISOString() }));
  const { manifest, request } = approve(f, members, ended);
  assert.deepEqual(manifest.ineligible, []);
  close(f.root, request, f.context, ended);
  const closed = read(f.root);
  assert.equal(closed.status, 'closed');
  // Close reconciled the interrupted worker from its termination evidence, so it no longer blocks the next handover.
  assert.deepEqual(closed.closure.reconciledWorkers, [{ id: worker.id, previousStatus: 'unverified', evidence: { kind: 'contained-termination' } }]);
  assert.equal(closed.workers.find(entry => entry.id === worker.id).status, 'stopped');
  assert.equal((await execute(f.root, reflection(), base)).status, 'running');
});

test('a complete selection over its reserved input bound is named unavailable by the refused handover', async t => {
  const f = project(t);
  await completed(f.root);
  const id = read(f.root).id;
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  BOUNDS.input = 1;
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(`Delivery ${id} is unavailable.`));
});

test('a selection over its reserved bound is named even when an earlier record exhausts the shared allowance', async t => {
  let f;
  let selection;
  for (let attempt = 0; attempt < 16 && !f; attempt++) {
    const trial = project(t);
    await completed(trial.root);
    const earlier = read(trial.root).id;
    await completed(trial.root);
    // The gate judges in id order, so the unverdicted sibling must sort before the selection to run out first.
    if (earlier < read(trial.root).id) [f, selection] = [trial, read(trial.root).id];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  BOUNDS.input = 1;
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && /input exceeds its byte bound/.test(error.message) && error.message.includes(`Delivery ${selection} is unavailable.`));
});

test('an exact replay beside a held delivery refuses as overlap even while the selection owes its report', async t => {
  const f = project(t);
  await completed(f.root);
  const held = read(f.root).id;
  // The selection completes without its recipient's reply, so it owes its morning report.
  const withholdReply = (root, input, deps) => (input.action === 'report-delivered' ? execute(root, { action: 'inspect' }, deps) : execute(root, input, deps));
  const original = await completed(f.root, withholdReply);
  const selection = read(f.root).id;
  select(f.root, held);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, selection);
  // A new handover is refused for the report first; an exact replay, which presenting the report cannot clear, is refused as overlap.
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'report-delivery-pending' && error.message.includes(held));
  await assert.rejects(execute(f.root, original, base), error => error.code === 'overlapping-run' && error.message.includes(held));
});
