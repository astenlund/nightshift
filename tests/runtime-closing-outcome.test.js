'use strict';

// The post-completion closing outcome (.nightshift/specs/post-completion-closing-hold.md): one predicate read by the creation gate,
// status, Ready and the administrative close, the refusal naming every blocker, and close as the route that drops the held work.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execute } = require('../internal/runtime/cli');
const { RunStore } = require('../internal/runtime/store');
const { close, closeManifest } = require('../internal/runtime/close');
const { overview } = require('../internal/runtime/run-overview');
const { BOUNDS } = require('../internal/runtime/creation-consistency');
const outcomes = require('../internal/runtime/delivery-outcome');
const { Registry } = require('../internal/releases/registry');
const { completeReflection } = require('./fixtures/completion');

const scratch = path.resolve(__dirname, '../.tmp/runtime-closing-outcome');
const owner = { host: 'codex', session: 'outcome-owner' };
const closer = { host: 'claude', session: 'outcome-closer' };
const exitWith = code => async (_executable, _args, options) => {
  options.onFinished({ code, descendantsReclaimed: true });
  return { code, stdout: code === 0 ? 'Simulated passing command' : '', stderr: code === 0 ? '' : 'Simulated failing command', descendantsReclaimed: true };
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

const reflection = (limits = undefined) => ({ action: 'handover', handoverId: randomUUID(), controller: owner, authority: 'Explicit fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, ...(limits ? { limits } : {}), tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] });

function withStore(root, work) {
  const store = new RunStore(root);
  try { return work(store); } finally { store.close(); }
}

const read = root => withStore(root, store => store.read());
const revisions = root => withStore(root, store => store.db.prepare('SELECT count(*) AS n FROM history').get().n);

async function completed(root, request = reflection()) {
  await execute(root, request, base);
  await completeReflection(root, owner, execute, base);

  return request;
}

const closingCheck = (root, name, dependencies) => execute(root, { action: 'check', taskId: '#closing', actor: owner, revision: read(root).revision, check: { name, executable: process.execPath, args: ['--version'], paths: ['subject.txt'], timeoutMs: 5000 } }, dependencies);

const status = (root, runId = undefined) => execute(root, { action: 'status', ...(runId ? { runId } : {}) }, base);

function choicesFor(manifest) {
  return manifest.records.map(record => ({ store: record.store, id: record.id, report: { kind: record.closing.report.delivered ? 'already-delivered' : record.closing.report.recorded || record.closing ? 'waived' : 'none' }, followups: record.followups.map(item => ({ id: item.id, disposition: 'dismissed' })) }));
}

function approve(f, members) {
  const proposal = closeManifest(f.root, { members }, f.context, base);
  const choices = choicesFor(proposal);
  const manifest = closeManifest(f.root, { members, choices }, f.context, base);

  return { manifest, request: { members, choices, manifestHash: manifest.hash, authority: 'Yes, close it as shown', reason: 'The held closing work is settled', actor: closer } };
}

test('a delivery held by a failed closing check reads held everywhere, refuses a new handover as overlap and closes as settled', async t => {
  const f = project(t);
  const original = await completed(f.root);
  const discharged = await status(f.root);
  assert.equal(discharged.handoverOutcome.outcome, 'discharged');
  assert.equal(discharged.handoverOutcome.next, null);
  const id = read(f.root).id;
  assert.equal(closeManifest(f.root, { members: [{ store: 'delivery', id }] }, f.context, base).ineligible[0].code, 'close-not-needed');
  assert.deepEqual(overview(f.root, { dependencies: base }).records, []);

  await closingCheck(f.root, 'post-completion tracking check', failing);
  const held = await status(f.root);
  assert.equal(held.handoverOutcome.outcome, 'held');
  assert.deepEqual(held.handoverOutcome.causes.map(entry => [entry.kind, entry.concern, entry.subject]), [['work', 'check', 'post-completion tracking check']]);
  assert.deepEqual(held.handoverOutcome.routes.map(entry => entry.route), ['owner', 'close']);
  assert.match(held.handoverOutcome.next, /is held/);

  // The refusal names the record, its cause and its routes; an exact replay of the held selection still returns it unchanged.
  const rows = revisions(f.root);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'overlapping-run' && error.message.includes(id) && /failed/.test(error.message) && /provisional/.test(error.message));
  assert.equal((await execute(f.root, original, base)).revision, held.revision);
  assert.equal(revisions(f.root), rows);

  const [record] = overview(f.root, { dependencies: base }).records;
  assert.equal(record.id, id);
  assert.equal(record.outcome.outcome, 'held');
  assert.equal(record.pickup, null);
  assert.deepEqual(record.close, { offer: 'close' });

  const { manifest, request } = approve(f, [{ store: 'delivery', id }]);
  assert.deepEqual(manifest.ineligible, []);
  assert.equal(manifest.records[0].drops.outcome, 'held');
  assert.match(manifest.records[0].drops.causes[0], /post-completion tracking check/);
  const result = close(f.root, request, f.context, base);
  assert.equal(result.members[0].closure.previousStatus, 'complete');
  assert.equal(read(f.root).status, 'closed');
  // An identical retry returns the closure without writing, projecting the member from its approval.
  const after = revisions(f.root);
  assert.deepEqual(close(f.root, request, f.context, base).members, result.members);
  assert.equal(revisions(f.root), after);
  await execute(f.root, reflection(), base);
  assert.equal(read(f.root).status, 'running');
});

test('an uncovered closing check holds the selection while a passing check a closing review saw would not', async t => {
  const f = project(t);
  const original = await completed(f.root);
  await closingCheck(f.root, 'uncovered check', base);
  const held = await status(f.root);
  assert.equal(held.handoverOutcome.outcome, 'held');
  assert.match(held.handoverOutcome.causes[0].message, /has not seen its files/);
  await assert.rejects(execute(f.root, reflection(), base), { code: 'overlapping-run' });
  assert.equal((await execute(f.root, original, base)).revision, held.revision);
});

test('a task reopened by block holds the delivery with no owner route, leaving the administrative close', async t => {
  const f = project(t);
  await completed(f.root);
  await execute(f.root, { action: 'block', taskId: 'reflection', actor: owner, revision: read(f.root).revision, blocker: { kind: 'user-decision', reason: 'Fixture reopening', recoveryAttempted: 'None; the fixture reopens the task deliberately' } }, base);
  const held = await status(f.root);
  assert.equal(held.handoverOutcome.outcome, 'held');
  assert.ok(held.handoverOutcome.causes.some(entry => entry.concern === 'task' && entry.subject === 'reflection'));
  assert.deepEqual(held.handoverOutcome.routes.map(entry => entry.route), ['close']);
  assert.match(held.handoverOutcome.ownerUnavailable, /cannot be unblocked/);
  await assert.rejects(execute(f.root, reflection(), base), { code: 'overlapping-run' });
});

test('a closing record replaced after completion is unauthenticated: consistency refusal, close admitted with the failure named', async t => {
  const f = project(t);
  const original = await completed(f.root);
  withStore(f.root, store => store.update(owner, store.read().revision, 'fixture-closing-replacement', state => { state.closing.docs = { ...state.closing.docs, occurrence: randomUUID() }; }));
  const unauthenticated = await status(f.root);
  assert.equal(unauthenticated.handoverOutcome.outcome, 'unauthenticated');
  assert.deepEqual(unauthenticated.handoverOutcome.routes.map(entry => entry.route), ['close']);
  assert.notEqual(unauthenticated.handoverOutcome.next, null);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'delivery-consistency-unavailable' && /replaced after completion/.test(error.message));
  // An exact replay of an unauthenticated selection still refuses.
  await assert.rejects(execute(f.root, original, base), { code: 'delivery-consistency-unavailable' });
  const id = read(f.root).id;
  const { manifest, request } = approve(f, [{ store: 'delivery', id }]);
  assert.deepEqual(manifest.ineligible, []);
  assert.equal(manifest.records[0].drops.outcome, 'unauthenticated');
  assert.match(manifest.records[0].drops.note, /could not be authenticated/);
  // The close write itself admits it, recording the completion it drops.
  const result = close(f.root, request, f.context, base);
  assert.equal(result.members[0].closure.previousStatus, 'complete');
  assert.equal(read(f.root).status, 'closed');
  await execute(f.root, reflection(), base);
  assert.equal(read(f.root).status, 'running');
});

test('a complete delivery whose accounting is not current is unavailable and refused by close with its cause', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  const state = read(f.root);
  withStore(f.root, store => store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision=?').run(state.id, state.revision));
  const unavailable = await status(f.root);
  assert.equal(unavailable.handoverOutcome.outcome, 'unavailable');
  assert.deepEqual(unavailable.handoverOutcome.routes.map(entry => entry.route), ['recovery']);
  const manifest = closeManifest(f.root, { members: [{ store: 'delivery', id: state.id }] }, f.context, base);
  assert.equal(manifest.ineligible[0].code, 'close-accounting-unavailable');
  const [record] = overview(f.root, { dependencies: base }).records;
  assert.equal(record.outcome.outcome, 'unavailable');
  assert.equal(record.close.offer, 'none');
  assert.equal(record.close.reason, 'close-accounting-unavailable');
});

test('a discharged delivery whose stored check output cannot be read still hands over', async t => {
  const f = project(t);
  await execute(f.root, reflection(), base);
  // A passing closing check, with output long enough to be stored on its own, recorded after triage and before completion.
  const noisy = { ...base, runContained: async (_executable, _args, options) => {
    options.onFinished({ code: 0, descendantsReclaimed: true });
    return { code: 0, stdout: 'o'.repeat(8192), stderr: '', descendantsReclaimed: true };
  } };
  const beforeComplete = async (root, input, dependencies) => {
    if (input.action === 'complete') await closingCheck(root, 'pre-completion tracking check', noisy);
    return execute(root, { ...input, revision: read(root).revision }, dependencies);
  };
  await completeReflection(f.root, owner, beforeComplete, base);
  const state = withStore(f.root, store => store.read(undefined, { hydrate: false }));
  assert.equal(state.status, 'complete');
  const output = state.closing.docs.checks.at(-1).output?.$artifact;
  assert.ok(output, 'The long check output is stored as an artifact');
  withStore(f.root, store => store.db.prepare('DELETE FROM artifacts WHERE id=?').run(output));
  await execute(f.root, reflection(), base);
  assert.equal(read(f.root).status, 'running');
});

test('a held delivery whose referenced evidence cannot be read is refused by close naming the tracked bug, while Ready still offers close', async t => {
  const f = project(t);
  const original = await completed(f.root);
  // Output past 4 KiB is stored as an evidence body of its own, which the closing predicate does not read.
  const noisy = { ...base, runContained: async (_executable, _args, options) => {
    options.onFinished({ code: 1, descendantsReclaimed: true });
    return { code: 1, stdout: '', stderr: 'e'.repeat(8192), descendantsReclaimed: true };
  } };
  await closingCheck(f.root, 'post-completion tracking check', noisy);
  const state = withStore(f.root, store => store.read(undefined, { hydrate: false }));
  const output = state.closing.docs.checks.at(-1).output?.$artifact;
  assert.ok(output, 'The long check output is stored as an artifact');
  withStore(f.root, store => store.db.prepare('DELETE FROM artifacts WHERE id=?').run(output));
  await assert.rejects(status(f.root), { code: 'missing-evidence' });
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'overlapping-run' && /provisional/.test(error.message));
  // An exact replay reads and returns the saved record, so it meets the missing body.
  await assert.rejects(execute(f.root, original, base), { code: 'missing-evidence' });
  const members = [{ store: 'delivery', id: state.id }];
  const manifest = closeManifest(f.root, { members }, f.context, base);
  assert.equal(manifest.ineligible[0].code, 'missing-evidence');
  assert.equal(manifest.ineligible[0].bug, outcomes.BUG);
  // The close entry refuses at the same evidence check, writing nothing.
  const choices = choicesFor(closeManifest(f.root, { members }, f.context, base));
  assert.throws(() => close(f.root, { members, choices, manifestHash: 'a'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer }, f.context, base), error => error.code === 'missing-evidence' && error.message.includes(outcomes.BUG));
  assert.equal(withStore(f.root, store => store.read(undefined, { hydrate: false })).status, 'complete');
  const [record] = overview(f.root, { dependencies: base }).records;
  assert.deepEqual(record.close, { offer: 'close' });
  assert.equal(record.outcome.provisional, true);
});

test('a nonselected held delivery refuses a new handover as overlap and is offered close without a pickup', async t => {
  const f = project(t);
  await completed(f.root);
  const first = read(f.root).id;
  await completed(f.root);
  const second = read(f.root).id;
  // The first delivery becomes the selection again for its post-completion closing check, then gives the selection back.
  const select = id => withStore(f.root, store => store.db.prepare('UPDATE active SET id=? WHERE singleton=1').run(id));
  select(first);
  await closingCheck(f.root, 'nonselected tracking check', failing);
  select(second);
  await assert.rejects(execute(f.root, reflection(), base), error => error.code === 'overlapping-run' && error.message.includes(first));
  const nonselected = await status(f.root, first);
  assert.equal(nonselected.handoverOutcome.outcome, 'held');
  assert.deepEqual(nonselected.handoverOutcome.routes.map(entry => entry.route), ['close']);
  assert.match(nonselected.handoverOutcome.ownerUnavailable, /current selection/);
  const record = overview(f.root, { dependencies: base }).records.find(entry => entry.id === first);
  assert.equal(record.current, false);
  assert.equal(record.pickup, null);
  assert.deepEqual(record.close, { offer: 'close' });
});

test('the creation gate reuses a closed selection\'s close row as its latest row, and close refuses a closed record past the bound', async t => {
  const f = project(t);
  await completed(f.root);
  await closingCheck(f.root, 'post-completion tracking check', failing);
  const id = read(f.root).id;
  const members = [{ store: 'delivery', id }];
  const { request } = approve(f, members);
  // The longest reply and reason close accepts enlarge the closed state and its close row the most.
  const enlarged = { ...request, authority: 'y'.repeat(4096), reason: 'r'.repeat(1024) };
  const saved = BOUNDS.input;
  t.after(() => { BOUNDS.input = saved; });
  const metadata = () => withStore(f.root, store => require('../internal/runtime/settled-verdicts').metadataOf(store.db, new Set(['accounting_commits']), id));
  // The smallest input bound under which the held record is still judged, so close admits it before writing.
  const admitted = bound => {
    BOUNDS.input = bound;
    try { return closeManifest(f.root, { members }, f.context, base).ineligible.length === 0; } finally { BOUNDS.input = saved; }
  };
  let low = metadata().stateBytes;
  let high = 4 * 1024 * 1024;
  assert.equal(admitted(high), true);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (admitted(middle)) high = middle;
    else low = middle;
  }
  BOUNDS.input = high;
  assert.throws(() => close(f.root, enlarged, f.context, base), { code: 'close-bound-unavailable' });
  BOUNDS.input = saved;
  assert.equal(read(f.root).status, 'complete');
  close(f.root, request, f.context, base);
  // At the smallest bound the closed selection is judged within, its close row, which is its latest row, is not charged again: the
  // slack left there is smaller than that row.
  const { creationAssessment } = require('../internal/runtime/creation-consistency');
  const creates = bound => {
    BOUNDS.input = bound;
    try {
      withStore(f.root, store => store.transaction(() => creationAssessment(store)));
      return true;
    } catch (error) {
      if (error.code !== 'delivery-consistency-unavailable') throw error;
      return false;
    } finally { BOUNDS.input = saved; }
  };
  low = metadata().stateBytes;
  high = 4 * 1024 * 1024;
  assert.equal(creates(high), true);
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (creates(middle)) high = middle;
    else low = middle;
  }
  const closed = metadata();
  assert.ok(high - closed.stateBytes - closed.latestBytes < closed.latestBytes, 'The close row is charged once, as the latest row');
  BOUNDS.input = high;
  await execute(f.root, reflection(), base);
  BOUNDS.input = saved;
  assert.equal(read(f.root).status, 'running');
});

test('routes follow the limits: a passed deadline leaves worker reconciliation, a spent allowance only refuses dispatch', () => {
  const work = (needs, concern = 'check') => ({ kind: 'work', concern, subject: 'x', message: 'Fixture cause', needs });
  const past = new Date(Date.now() - 60000).toISOString();
  const names = (state, causes) => outcomes.routes(state, outcomes.judgment(causes), { current: true }).list.map(entry => entry.route);
  assert.deepEqual(names({ limits: { deadlineUtc: past } }, [work(['closing'])]), ['close']);
  assert.deepEqual(names({ limits: { deadlineUtc: past } }, [work(['bookkeeping'], 'worker')]), ['owner', 'close']);
  assert.deepEqual(names({ limits: { maxDispatches: 1 }, dispatches: 1 }, [work(['closing', 'dispatch'])]), ['close']);
  assert.deepEqual(names({ limits: { maxDispatches: 1 }, dispatches: 1 }, [work(['closing'])]), ['owner', 'close']);
  assert.deepEqual(names({ limits: {} }, [work(['unroutable'], 'task')]), ['close']);
  assert.deepEqual(outcomes.routes({}, outcomes.judgment([work(['closing'])]), { current: false }).list.map(entry => entry.route), ['close']);
  const refused = outcomes.routes({}, outcomes.judgment([work(['bookkeeping'], 'worker')]), { current: false, closeRefusal: { code: 'worker-activity-unknown', message: 'Fixture refusal' } });
  assert.deepEqual(refused.list, [{ route: 'none', code: 'worker-activity-unknown', message: 'Fixture refusal' }]);
  assert.equal(outcomes.judgment([work(['closing']), outcomes.cause('evidence', null, 'Fixture evidence failure')]).outcome, 'unauthenticated');
  assert.equal(outcomes.judgment([outcomes.cause('bound', null, 'Fixture bound'), outcomes.cause('evidence', null, 'Fixture evidence failure')]).outcome, 'unavailable');
  assert.equal(outcomes.judgment([]).outcome, 'discharged');
});
