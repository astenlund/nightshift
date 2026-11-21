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

test('a held delivery whose saved worker refuses close names no close route on Ready, status or the refusal', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  withStore(f.root, store => store.update(owner, store.read().revision, 'fixture-interrupted-check', interruptedWorker));
  const id = read(f.root).id;
  const record = overview(f.root, { dependencies: base }).records.find(entry => entry.id === id);
  assert.equal(record.close.reason, 'worker-activity-unknown');
  assert.ok(!record.outcome.routes.some(entry => entry.route === 'close'));
  assert.ok(record.outcome.routes.some(entry => entry.route === 'none' && entry.code === 'worker-activity-unknown'));
  const held = await status(f.root);
  assert.ok(!held.handoverOutcome.routes.some(entry => entry.route === 'close'));
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'overlapping-run' && /worker-activity-unknown/.test(error.message) && !/close: Any session/.test(error.message));
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

test('limits decide the routes status names for held deliveries built through the runtime', async t => {
  const past = new Date(Date.now() - 60000).toISOString();
  const routes = async root => (await status(root)).handoverOutcome.routes.map(entry => entry.route);
  // A failed closing check needs a closing-record action, which a passed deadline refuses.
  const deadline = project(t);
  await completed(deadline.root);
  await closingCheck(deadline.root, 'post-completion tracking check', failing);
  withStore(deadline.root, store => store.update(owner, store.read().revision, 'fixture-deadline', state => { state.limits = { deadlineUtc: past }; }));
  assert.deepEqual(await routes(deadline.root), ['close']);
  // An uncovered passing check needs a fresh closing review, which a spent dispatch allowance refuses.
  const spent = project(t);
  await completed(spent.root);
  await closingCheck(spent.root, 'uncovered check', base);
  withStore(spent.root, store => store.update(owner, store.read().revision, 'fixture-allowance', state => { state.limits = { maxDispatches: 0 }; }));
  assert.deepEqual(await routes(spent.root), ['close']);
  // A hold whose only cause is a worker keeps the owner's reconciliation route after the deadline; its unproven termination refuses close.
  const worker = project(t);
  await completed(worker.root);
  withStore(worker.root, store => store.update(owner, store.read().revision, 'fixture-worker', state => { interruptedWorker(state); state.limits = { deadlineUtc: past }; }));
  const held = await status(worker.root);
  assert.deepEqual(held.handoverOutcome.causes.map(entry => entry.concern), ['worker']);
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

test('a collected result the hold cannot use leaves only the administrative close at a spent dispatch allowance', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'uncovered check', base);
  const collect = role => withStore(f.root, store => store.update(owner, store.read().revision, `fixture-collected-${role}`, state => {
    state.limits = { maxDispatches: 0 };
    state.workers.push({ id: `collected-closing-${role}`, role, taskId: '#closing', status: 'complete', closingOccurrence: state.closing.docs.occurrence, receipt: `.nightshift/runs/reviews/collected-closing-${role}/receipt.json`, session: `collected-${role}`, assignment: 'Closing assessment', writes: [] });
  }));
  // A skeptic result cannot serve as the closing docs review the uncovered check needs; a collected reviewer result opens only a
  // conditional owner route, since only its import shows whether it covers the hold.
  collect('skeptic');
  assert.deepEqual((await status(f.root)).handoverOutcome.routes.map(entry => entry.route), ['close']);
  collect('reviewer');
  const [ownerRoute] = (await status(f.root)).handoverOutcome.routes;
  assert.deepEqual([ownerRoute.route, ownerRoute.conditional, ownerRoute.collected], ['owner', true, ['collected-closing-reviewer']]);
});

test('Ready derives the limit routes from runtime state as status does', async t => {
  const spent = project(t);
  await completed(spent.root);
  await closingCheck(spent.root, 'uncovered check', base);
  withStore(spent.root, store => store.update(owner, store.read().revision, 'fixture-allowance', state => { state.limits = { maxDispatches: 0 }; }));
  assert.deepEqual(overview(spent.root, { dependencies: base }).records[0].outcome.routes.map(entry => entry.route), ['close']);
  const worker = project(t);
  await completed(worker.root);
  const past = new Date(Date.now() - 60000).toISOString();
  withStore(worker.root, store => store.update(owner, store.read().revision, 'fixture-worker', state => { interruptedWorker(state); state.limits = { deadlineUtc: past }; }));
  assert.deepEqual(overview(worker.root, { dependencies: base }).records[0].outcome.routes.map(entry => entry.route), ['owner', 'none']);
});

test('a shortfall keeps the held outcome judged before it, while the gate keeps its allowance refusal and each record is judged alone', async t => {
  // Record ids are random, and the scan judges in id order: build projects until the held record sorts before the selection.
  // The store also holds a stopped record and a selection whose morning report awaits its recipient.
  const withholdReply = (root, input, dependencies) => (input.action === 'report-delivered' ? execute(root, { action: 'inspect' }, dependencies) : execute(root, input, dependencies));
  let f;
  let held;
  let selection;
  let stopped;
  for (let attempt = 0; attempt < 12 && !f; attempt++) {
    const candidate = project(t);
    await completed(candidate.root);
    const first = read(candidate.root).id;
    await completed(candidate.root);
    const second = read(candidate.root).id;
    await completed(candidate.root, withholdReply);
    const third = read(candidate.root).id;
    if (second < third) [f, stopped, held, selection] = [candidate, first, second, third];
  }
  assert.ok(f, 'No fixture ordered its records as the case needs');
  select(f.root, stopped);
  await execute(f.root, { action: 'stop', actor: owner, revision: read(f.root).revision, kind: 'user-stop', reason: 'Fixture stop' }, base);
  select(f.root, held);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  select(f.root, selection);
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  const shown = bound => {
    BOUNDS.input = bound;
    try { return overview(f.root, { dependencies: base }); } finally { BOUNDS.input = saved; }
  };
  // The smallest bound at which the held record is judged: the selection's accounting no longer fits after it.
  let low = 1;
  let high = 4 * 1024 * 1024;
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (shown(middle).records.some(record => record.id === held)) high = middle;
    else low = middle;
  }
  const result = shown(high);
  assert.equal(result.records.find(record => record.id === held).outcome.outcome, 'held');
  assert.deepEqual(result.notices.map(entry => entry.code), ['closing-outcome-shortfall']);
  assert.deepEqual(result.unavailable, []);
  const stoppedRecord = result.records.find(record => record.id === stopped);
  assert.equal(stoppedRecord.status, 'stopped');
  assert.equal(stoppedRecord.pickup.reason, 'not-current');
  const owing = result.records.find(record => record.id === selection);
  assert.deepEqual(owing.pickup, { offer: 'present-report' });
  // The shortfall left the selection unjudged: it shows no outcome rather than an unavailable one.
  assert.equal(owing.outcome, undefined);
  BOUNDS.input = high;
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && /byte bound/.test(error.message));
  assert.equal((await status(f.root, held)).handoverOutcome.outcome, 'held');
  assert.deepEqual(closeManifest(f.root, { members: [{ store: 'delivery', id: held }] }, f.context, base).ineligible, []);
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

test('a stored row revision that contradicts its state reads unavailable on Ready', async t => {
  const f = project(t);
  await completed(f.root);
  const id = read(f.root).id;
  withStore(f.root, store => store.db.prepare('UPDATE runs SET revision=revision+1 WHERE id=?').run(id));
  const record = overview(f.root, { dependencies: base }).records.find(entry => entry.id === id);
  assert.equal(record?.outcome?.outcome, 'unavailable');
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

test('a collected result already recorded through dialogue opens no conditional owner route', () => {
  const work = { kind: 'work', concern: 'closure', subject: 'F1', message: 'Fixture closure owed', needs: ['closing', 'dispatch'] };
  const worker = { id: 'reviewer-dialogue', role: 'reviewer', taskId: '#closing', status: 'complete', closingOccurrence: 'occurrence', receipt: '.nightshift/runs/reviews/reviewer-dialogue/receipt.json' };
  const state = finding => ({ limits: { maxDispatches: 0 }, dispatches: 0, workers: [worker], closing: { docs: { occurrence: 'occurrence', reviews: [], findings: [finding] } } });
  const names = value => outcomes.routes(value, outcomes.judgment([work]), { current: true }).list.map(entry => entry.route);
  assert.deepEqual(names(state({ id: 'F1', pendingClosure: { lineage: 'x' } })), ['owner', 'close']);
  assert.deepEqual(names(state({ id: 'F1', pendingClosure: { lineage: 'x' }, dialogue: [{ requestId: 'reviewer-dialogue' }] })), ['close']);
});

test('Ready names only the administrative close for a held delivery past its deadline', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  const past = new Date(Date.now() - 60000).toISOString();
  withStore(f.root, store => store.update(owner, store.read().revision, 'fixture-deadline', state => { state.limits = { deadlineUtc: past }; }));
  const [record] = overview(f.root, { dependencies: base }).records;
  assert.deepEqual(record.outcome.routes.map(entry => entry.route), ['close']);
  assert.match(record.outcome.ownerUnavailable, /deadline/);
});
