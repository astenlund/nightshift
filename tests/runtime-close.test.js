'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { execute } = require('../internal/runtime/cli');
const { RunStore } = require('../internal/runtime/store');
const { close, closeManifest, olderThanSupport } = require('../internal/runtime/close');
const { overview } = require('../internal/runtime/run-overview');
const { reportNotice } = require('../internal/runtime/lifecycle');
const { creationAssessment } = require('../internal/runtime/creation-consistency');
const { Registry, sessionKey } = require('../internal/releases/registry');
const { assertAction } = require('../internal/runtime/lifecycle');
const { handleHook } = require('../internal/runtime/hook');
const { awaitWorker } = require('../internal/runtime/wait');
const { assertQuiescent } = require('../internal/setup');
const { fixtureAcknowledgement } = require('./fixtures/acknowledgement');
const { fixtureContinuation } = require('./fixtures/continuation');

const scratch = path.resolve(__dirname, '../.tmp/runtime-close');
const owner = { host: 'codex', session: 'former-owner' };
const ownerProcess = { pid: 7101, created: '100', name: 'codex.exe' };
const closer = { host: 'claude', session: 'closing-session' };

function fixture(t) {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(scratch, 'case-')));
  t.after(() => { assert.equal(path.dirname(root), scratch); fs.rmSync(root, { recursive: true, force: true }); });
  const live = new Set([ownerProcess.pid]);
  const dependencies = { nativeOwner: () => ownerProcess, ownerAlive: process => live.has(process?.pid), acknowledgementObserver: fixtureAcknowledgement };
  const registryRoot = path.join(root, 'registry');
  new Registry(registryRoot, { create: true }).close();
  const context = { store: registryRoot, host: closer.host, session: closer.session };
  const call = async (request, selector = {}) => {
    const store = new RunStore(root, selector.reviewContextId ? { review: true } : {});
    try {
      const state = store.read(selector.reviewContextId);
      return await execute(root, { actor: state.controller, revision: state.revision, ...selector, ...request }, dependencies);
    } finally { store.close(); }
  };

  return { root, live, dependencies, context, call };
}

async function delivery(f, overrides = {}) {
  return execute(f.root, { action: 'handover', mechanism: fixtureContinuation(), objective: 'Fixture delivery to close', authority: 'User agreed fixture delivery', controller: owner, tasks: [{ id: 'change', title: 'Change', agreement: { source: 'fixture user', outcome: 'Fixture outcome' } }], ...overrides }, f.dependencies);
}

async function review(f) {
  return execute(f.root, { action: 'open-review', reviewContextId: randomUUID(), controller: owner, kind: 'code', authority: 'Explicit standalone revision', objective: 'Fixture review to close', agreement: { source: 'fixture user', outcome: 'Fixture outcome' } }, f.dependencies);
}

function readState(root, store, id) {
  const handle = new RunStore(root, store === 'review' ? { review: true } : {});
  try { return handle.read(id, { hydrate: false }); } finally { handle.close(); }
}

function historyOf(root, store, id) {
  const handle = new RunStore(root, store === 'review' ? { review: true } : {});
  try { return handle.history(id); } finally { handle.close(); }
}

// Every member's single valid choice: the report kind its record allows and every pending follow-up dismissed.
function choicesFor(manifest) {
  return manifest.records.map(record => ({ store: record.store, id: record.id, report: { kind: record.store === 'review' ? 'none' : record.closing.report.delivered ? 'already-delivered' : 'waived' }, followups: record.followups.map(item => ({ id: item.id, disposition: 'dismissed' })) }));
}

function approve(f, members, extra = {}) {
  const proposal = closeManifest(f.root, { members, ...extra }, f.context, f.dependencies);
  const choices = choicesFor(proposal);
  const manifest = closeManifest(f.root, { members, choices, ...extra }, f.context, f.dependencies);

  return { manifest, request: { members, choices, ...extra, manifestHash: manifest.hash, authority: 'Yes, close them as shown', reason: 'The work is settled', actor: closer } };
}

const without = (state, keys) => Object.fromEntries(Object.entries(state).filter(([key]) => !keys.includes(key)));

// A store write through the ordinary update path, so history and accounting stay consistent.
function update(f, change, store = 'delivery', id = undefined) {
  const handle = new RunStore(f.root, store === 'review' ? { review: true } : {});
  try {
    const state = handle.read(id);
    return handle.update(state.controller, state.revision, 'fixture', change);
  } finally { handle.close(); }
}

// A copy of RunStore as a runtime without the closed guard would load it: its statuses module treats nothing as closed.
function olderRunStore() {
  const storePath = require.resolve('../internal/runtime/store');
  const statusesPath = require.resolve('../internal/runtime/statuses');
  const saved = { store: require.cache[storePath], statuses: require.cache[statusesPath] };
  delete require.cache[storePath];
  require.cache[statusesPath] = { id: statusesPath, filename: statusesPath, loaded: true, exports: { ...require(statusesPath), isClosed: () => false, isFinished: state => state?.status === 'complete' } };
  try { return require(storePath).RunStore; } finally {
    require.cache[storePath] = saved.store;
    require.cache[statusesPath] = saved.statuses;
  }
}

function olderUpdate(f, change) {
  const OlderStore = olderRunStore();
  const older = new OlderStore(f.root);
  try {
    const state = older.read();
    older.update(owner, state.revision, 'followup', change);
  } finally { older.close(); }
}

function assess(f) {
  const handle = new RunStore(f.root);
  try { return handle.transaction(() => creationAssessment(handle)); } finally { handle.close(); }
}

const OLDER_IDENTITY = `3.3.12-${'b'.repeat(64)}`;
const OLDER_REGISTRATION = 'a'.repeat(64);

function seedRegistry(f, records) {
  const registry = new Registry(f.context.store);
  try { registry.transaction(handle => { for (const [kind, key, value] of records) handle.put(kind, key, value); }); } finally { registry.close(); }
}

// A session binding to an older release in this project, optionally with its activation and a later or earlier activation failure.
function olderBinding(f, session, { activation, failure } = {}) {
  const key = sessionKey(OLDER_REGISTRATION, session);
  const records = [['session', key, { schema: 1, registration: OLDER_REGISTRATION, session, state: 'bound', identity: OLDER_IDENTITY, bundle: randomUUID(), projects: [f.root], runs: [] }]];
  if (activation) records.push(['activation', key, { schema: 1, registration: OLDER_REGISTRATION, session, generation: 'c'.repeat(64), owner: activation.owner, observedAt: activation.observedAt }]);
  if (failure) records.push(['activation-failure', key, { schema: 1, registration: OLDER_REGISTRATION, session, generation: 'd'.repeat(64), cause: 'Fixture SessionStart failure', observedAt: failure.observedAt }]);
  seedRegistry(f, records);

  return key;
}

function olderHostRegistration(f) {
  const bundle = randomUUID();
  const key = 'f'.repeat(64);
  seedRegistry(f, [
    ['bundle', bundle, { schema: 1, key: bundle, identity: OLDER_IDENTITY, manifestDigest: '1'.repeat(64), root: path.join(f.context.store, 'bundles', bundle) }],
    ['registration', key, { schema: 1, key, host: 'claude', profile: f.root, state: 'registered', bootstrap: path.join(f.context.store, 'launchers', 'bootstrap.js'), bootstrapHash: '2'.repeat(64), baseBundle: bundle, generation: '3'.repeat(64) }],
  ]);
}

// Writes a registry row that fails its record check, as a damaged or foreign registry would hold.
function rawRegistryRow(f, kind, key) {
  const db = new DatabaseSync(path.join(f.context.store, 'registry.sqlite'));
  try { db.prepare('INSERT INTO records(kind, key, value) VALUES (?, ?, ?)').run(kind, key, JSON.stringify({ schema: 2 })); } finally { db.close(); }

  return () => {
    const cleanup = new DatabaseSync(path.join(f.context.store, 'registry.sqlite'));
    try { cleanup.prepare('DELETE FROM records WHERE kind=? AND key=?').run(kind, key); } finally { cleanup.close(); }
  };
}

function rawState(f, id, change, file = 'state.sqlite') {
  const db = new DatabaseSync(path.join(f.root, '.nightshift/runs', file));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    change(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), id);
  } finally { db.close(); }
}

test('a stopped delivery closes with one close revision, an approval artifact and unchanged content; an identical retry writes nothing', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'followup', item: { id: 'later', context: 'Pending decision', recommendation: 'Ask later' } });
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const before = readState(f.root, 'delivery', created.id);
  const { manifest, request } = approve(f, [{ store: 'delivery', id: created.id }]);
  assert.equal(manifest.ineligible.length, 0);
  assert.ok(manifest.hash);
  assert.deepEqual(Object.keys(manifest.records[0]).sort(), ['closing', 'findings', 'followups', 'hold', 'id', 'identity', 'incompleteTasks', 'objective', 'revision', 'status', 'stop', 'store', 'workers']);
  const result = close(f.root, request, f.context, f.dependencies);
  assert.equal(result.state, 'closed');
  const after = readState(f.root, 'delivery', created.id);
  assert.equal(after.status, 'closed');
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.updatedAt, after.closure.recordedAt);
  assert.equal(after.progress.status, 'current');
  assert.equal(after.closure.previousStatus, 'stopped');
  assert.equal(after.closure.previousRevision, before.revision);
  assert.deepEqual(after.closure.actor, closer);
  const removed = ['status', 'closure', 'revision', 'updatedAt', 'progress', 'stopRecovery'];
  assert.deepEqual(without(after, removed), without(before, removed));
  const entries = historyOf(f.root, 'delivery', created.id);
  assert.equal(entries.filter(entry => entry.kind === 'close').length, 1);
  const db = new DatabaseSync(path.join(f.root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try { assert.ok(db.prepare('SELECT 1 FROM artifacts WHERE id=?').get(after.closure.approval)); } finally { db.close(); }
  const again = close(f.root, request, f.context, f.dependencies);
  assert.equal(again.state, 'closed');
  assert.equal(readState(f.root, 'delivery', created.id).revision, after.revision);
});

test('a running review context with an ended owner closes and no longer blocks compaction of its store', async t => {
  const f = fixture(t);
  const opened = await review(f);
  f.live.delete(ownerProcess.pid);
  const { request } = approve(f, [{ store: 'review', id: opened.id }]);
  close(f.root, request, f.context, f.dependencies);
  const after = readState(f.root, 'review', opened.id);
  assert.equal(after.status, 'closed');
  assert.equal(after.closure.previousStatus, 'running');
  // compact-history refuses only while a record is running (status 'running' in its SQL check), which Ready reports as blockedBy.
  const db = new DatabaseSync(path.join(f.root, '.nightshift/runs/review-state.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare("SELECT 1 FROM runs WHERE json_extract(state, '$.status')='running' LIMIT 1").get(), undefined); } finally { db.close(); }
});

test('a manifest spanning both stores closes in one call, and resumes by identical retry after a failed review transaction', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const opened = await review(f);
  f.live.delete(ownerProcess.pid);
  const members = [{ store: 'delivery', id: created.id }, { store: 'review', id: opened.id }];
  const { request } = approve(f, members);
  let fail = true;
  const failing = { ...f.dependencies, afterRecompute: store => { if (store === 'review' && fail) { fail = false; throw new (require('../internal/runtime/errors').RunError)('fixture-failure', 'Simulated review transaction failure'); } } };
  assert.throws(() => close(f.root, request, f.context, failing), error => error.code === 'fixture-failure' && /Already committed: delivery/.test(error.message));
  assert.equal(readState(f.root, 'delivery', created.id).status, 'closed');
  assert.equal(readState(f.root, 'review', opened.id).status, 'running');
  const resumed = close(f.root, request, f.context, f.dependencies);
  assert.equal(resumed.members.length, 2);
  assert.equal(readState(f.root, 'review', opened.id).status, 'closed');
  const spanning = closeManifest(f.root, { members, choices: request.choices }, f.context, f.dependencies);
  assert.equal(spanning.ineligible.length, 2);
});

test('close refuses complete, closed, absent and malformed members with their codes', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const absent = closeManifest(f.root, { members: [{ store: 'delivery', id: 'no-such-record' }, { store: 'review', id: created.id }] }, f.context, f.dependencies);
  assert.deepEqual(absent.ineligible.map(item => item.code), ['migration-run-unavailable', 'migration-run-unavailable']);
  assert.equal(absent.hash, null);
  for (const members of [[], [{ store: 'other', id: 'x' }], [{ store: 'delivery', id: '' }], [{ store: 'delivery', id: created.id }, { store: 'delivery', id: created.id }], [{ store: 'delivery', id: created.id, extra: 1 }]]) {
    assert.throws(() => closeManifest(f.root, { members }, f.context, f.dependencies), { code: 'migration-manifest-unavailable' });
  }
  const { request } = approve(f, [{ store: 'delivery', id: created.id }]);
  assert.throws(() => close(f.root, { ...request, reason: '' }, f.context, f.dependencies), { code: 'close-reason-required' });
  assert.throws(() => close(f.root, { ...request, reason: 'x'.repeat(1025) }, f.context, f.dependencies), { code: 'close-reason-required' });
  assert.throws(() => close(f.root, { ...request, authority: '' }, f.context, f.dependencies), { code: 'migration-authority-required' });
  assert.throws(() => close(f.root, { ...request, authority: 'x'.repeat(4097) }, f.context, f.dependencies), { code: 'migration-authority-required' });
  assert.throws(() => close(f.root, request, null, f.dependencies), { code: 'migration-admission-required' });
  // A 4 KiB reply of quotes doubles when serialized, so the closure exceeds its 8 KiB bound; a shorter reply would fit.
  assert.throws(() => close(f.root, { ...request, authority: '"'.repeat(4096) }, f.context, f.dependencies), error => error.code === 'migration-certificate-bound' && /shorter reply or reason/.test(error.message));
  assert.equal(readState(f.root, 'delivery', created.id).status, 'stopped');
  assert.throws(() => closeManifest(f.root, { members: request.members, choices: [{ ...request.choices[0], report: 'waived' }] }, f.context, f.dependencies), { code: 'migration-decision-unavailable' });
  assert.throws(() => closeManifest(f.root, { members: request.members, choices: [{ ...request.choices[0], report: { kind: 'none' } }] }, f.context, f.dependencies), { code: 'migration-decision-unavailable' });
  assert.throws(() => closeManifest(f.root, { members: request.members, choices: [] }, f.context, f.dependencies), { code: 'migration-decision-unavailable' });
  close(f.root, request, f.context, f.dependencies);
  const closed = closeManifest(f.root, { members: request.members }, f.context, f.dependencies);
  assert.equal(closed.ineligible[0].code, 'run-closed');
  assert.throws(() => close(f.root, { ...request, reason: 'A different reason' }, f.context, f.dependencies), { code: 'run-closed' });
});

test('a member of an unreadable store and an oversized approval are refused with their own codes', async t => {
  const f = fixture(t);
  const opened = await review(f);
  const large = await execute(f.root, { action: 'open-review', reviewContextId: randomUUID(), controller: owner, kind: 'code', authority: 'Explicit standalone revision', objective: 'x'.repeat(8 * 1024 * 1024 + 1), agreement: { source: 'fixture user', outcome: 'Fixture outcome' } }, f.dependencies);
  const sidecar = path.join(f.root, '.nightshift/runs/review-state.sqlite-journal');
  fs.writeFileSync(sidecar, '');
  try {
    const blocked = closeManifest(f.root, { members: [{ store: 'review', id: opened.id }] }, f.context, f.dependencies);
    assert.equal(blocked.ineligible[0].code, 'migration-store-unavailable');
    assert.ok(blocked.guard.refusals.some(refusal => refusal.store === 'review'));
  } finally { fs.rmSync(sidecar); }
  assert.throws(() => closeManifest(f.root, { members: [{ store: 'review', id: large.id }], acknowledgedRecords: [{ store: 'review', id: opened.id }] }, f.context, f.dependencies), { code: 'migration-manifest-unavailable' });
});

test('a changed member revision stales the approval', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const { request } = approve(f, [{ store: 'delivery', id: created.id }]);
  await f.call({ action: 'followup', item: { id: 'new', context: 'Arrived after approval', recommendation: 'Decide' } });
  assert.throws(() => close(f.root, request, f.context, f.dependencies), { code: 'migration-decision-unavailable' });
  const refreshed = approve(f, [{ store: 'delivery', id: created.id }]).request;
  await f.call({ action: 'hold', authority: 'User holds', reason: 'Hold' });
  assert.throws(() => close(f.root, refreshed, f.context, f.dependencies), { code: 'migration-manifest-stale' });
});

// Saves a morning report file and records it on the active delivery, optionally with the recipient's delivery.
function savedReport(f, { delivered = false } = {}) {
  const report = '.nightshift/runs/reports/fixture.md';
  fs.mkdirSync(path.join(f.root, '.nightshift/runs/reports'), { recursive: true });
  fs.writeFileSync(path.join(f.root, report), '# Fixture report\n');
  update(f, current => { for (const task of current.tasks) task.status = 'complete'; });
  return (async () => {
    await f.call({ action: 'retrospective', evidence: 'Fixture retrospective' });
    await f.call({ action: 'report', path: report });
    if (delivered) await f.call({ action: 'report-delivered', authority: 'User read it' });
  })();
}

const hook = (f, event) => handleHook({ cwd: f.root, session_id: owner.session, hook_event_name: event });

test('a closed delivery with a saved report owes no notice, and SessionStart, Stop and Interrupt write nothing', async t => {
  for (const delivered of [false, true]) {
    const f = fixture(t);
    const created = await delivery(f);
    await f.call({ action: 'followup', item: { id: 'later', context: 'Pending decision', recommendation: 'Ask later' } });
    await savedReport(f, { delivered });
    await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
    const stopped = readState(f.root, 'delivery', created.id);
    assert.notEqual(reportNotice(stopped), null);
    const { manifest, request } = approve(f, [{ store: 'delivery', id: created.id }]);
    assert.equal(manifest.choices[0].report.kind, delivered ? 'already-delivered' : 'waived');
    close(f.root, request, f.context, f.dependencies);
    const closed = readState(f.root, 'delivery', created.id);
    assert.equal(reportNotice(closed), null);
    const start = hook(f, 'SessionStart');
    assert.doesNotMatch(start.hookSpecificOutput.additionalContext, /morning report/);
    assert.deepEqual(hook(f, 'Stop'), {});
    assert.deepEqual(hook(f, 'Interrupt'), {});
    assert.equal(readState(f.root, 'delivery', created.id).revision, closed.revision);
  }
});

test('a closing-record import on a closed delivery with triage evidence is refused by the lifecycle check, and wait returns on a closed run', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  close(f.root, approve(f, [{ store: 'delivery', id: created.id }]).request, f.context, f.dependencies);
  const state = readState(f.root, 'delivery', created.id);
  state.closing = { ...state.closing, triageEvidence: 'Fixture triage' };
  for (const action of ['review', 'validate']) assert.throws(() => assertAction(state, { action, taskId: '#closing' }), { code: 'run-closed' });
  const polling = { ...state, workers: [{ id: 'polling', role: 'lead', status: 'running', taskId: 'change' }] };
  const observed = await awaitWorker({ root: f.root, read: () => polling }, { workerId: 'polling', timeoutMs: 0 });
  assert.equal(observed.reason, 'run-stopped');
});

test('a closed record refuses every lifecycle action and store write, reports a closed brief and owes no notice or checkpoint', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'followup', item: { id: 'later', context: 'Pending decision', recommendation: 'Ask later' } });
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const { request } = approve(f, [{ store: 'delivery', id: created.id }]);
  close(f.root, request, f.context, f.dependencies);
  await assert.rejects(f.call({ action: 'adopt', authority: 'a', previousController: owner, actor: closer }), { code: 'run-closed' });
  for (const action of [{ action: 'followup', item: { id: 'x', context: 'c', recommendation: 'r' } }, { action: 'resolve-followup', followupId: 'later', evidence: 'done' }, { action: 'hold', authority: 'a', reason: 'r' }, { action: 'stop', kind: 'user-stop', reason: 'r' }, { action: 'resume', authority: 'a' }, { action: 'retrospective', evidence: 'e' }]) {
    await assert.rejects(f.call(action), { code: 'run-closed' });
  }
  const state = readState(f.root, 'delivery', created.id);
  assert.equal(reportNotice(state), null);
  const handle = new RunStore(f.root);
  try { assert.throws(() => handle.update(owner, state.revision, 'probe', () => {}), { code: 'run-closed' }); } finally { handle.close(); }
  const status = await execute(f.root, { action: 'status', actor: owner }, f.dependencies);
  assert.equal(status.status, 'closed');
  assert.deepEqual(status.next, []);
  assert.equal(status.closure.reason, 'The work is settled');
  assert.equal(status.acceptanceCheckpoint, null);
  // From the owner's view, with the acknowledgement still pending, a closed delivery asks for none, while its stopped form would.
  const { acceptanceCheckpoint } = require('../internal/runtime/acceptance-checkpoint');
  const pending = { ...state, acknowledgement: undefined };
  assert.notEqual(acceptanceCheckpoint({ ...pending, status: 'stopped' }, owner, undefined, () => null), null);
  assert.equal(acceptanceCheckpoint(pending, owner, undefined, () => null), null);
  assert.throws(() => require('../internal/runtime/ownership').adoptState(state, { actor: closer, previousController: owner, authority: 'Adopt it', runId: state.id, revision: state.revision }, null), { code: 'run-closed' });
});

test('the creation gate counts a closed selection discharged and replaceable, also after a later status-preserving revision', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  close(f.root, approve(f, [{ store: 'delivery', id: created.id }]).request, f.context, f.dependencies);
  const handle = new RunStore(f.root);
  try {
    const gate = handle.transaction(() => creationAssessment(handle));
    assert.equal(gate.replaceable, true);
    assert.equal(gate.reportPending, false);
  } finally { handle.close(); }
  // An older runtime has no closed guard: it appends a status-preserving follow-up revision after the close row.
  olderUpdate(f, current => { current.followups.push({ id: 'older', context: 'Older runtime write', recommendation: 'None', status: 'pending' }); });
  const reread = readState(f.root, 'delivery', created.id);
  assert.equal(reread.status, 'closed');
  assert.notEqual(historyOf(f.root, 'delivery', created.id).at(-1).kind, 'close');
  assert.equal(assess(f).replaceable, true);
  const next = await delivery(f, { objective: 'A new delivery after the close' });
  assert.equal(next.status, 'running');
});

test('the creation gate does not count a closed status discharged without its matching close row', async t => {
  // A closed status written by an ordinary consistent revision, with no close row at closure.previousRevision + 1.
  const f = fixture(t);
  await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  olderUpdate(f, current => {
    current.closure = { authority: 'Hand-written', reason: 'No close row', manifestHash: 'e'.repeat(64), approval: 'f'.repeat(64), reconciledWorkers: [], previousStatus: 'stopped', previousRevision: current.revision - 1, recordedAt: current.updatedAt, actor: closer };
    current.status = 'closed';
  });
  assert.equal(assess(f).replaceable, false);

  // A close row whose closure differs from the current one.
  const g = fixture(t);
  const second = await delivery(g);
  await g.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  close(g.root, approve(g, [{ store: 'delivery', id: second.id }]).request, g.context, g.dependencies);
  assert.equal(assess(g).replaceable, true);
  olderUpdate(g, current => { current.closure = { ...current.closure, reason: 'Changed after the close row' }; });
  assert.equal(readState(g.root, 'delivery', second.id).status, 'closed');
  assert.equal(assess(g).replaceable, false);
});

test('the older-release guard names other unfinished older-bound records until they are acknowledged by name', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const opened = await review(f);
  const members = [{ store: 'delivery', id: created.id }];
  const blocked = closeManifest(f.root, { members }, f.context, f.dependencies);
  assert.deepEqual(blocked.guard.named.map(record => record.id), [opened.id]);
  assert.ok(blocked.guard.refusals.some(refusal => refusal.id === opened.id));
  const proposal = closeManifest(f.root, { members, acknowledgedRecords: [{ store: 'review', id: opened.id }] }, f.context, f.dependencies);
  assert.equal(proposal.guard.refusals.length, 0);
  const choices = choicesFor(proposal);
  const shuffled = closeManifest(f.root, { members, choices, acknowledgedRecords: [{ store: 'review', id: opened.id }] }, f.context, f.dependencies);
  assert.ok(shuffled.hash);
  assert.throws(() => closeManifest(f.root, { members, acknowledgedRecords: [{ store: 'review', id: opened.id }, { store: 'review', id: opened.id }] }, f.context, f.dependencies), { code: 'migration-decision-unavailable' });
  assert.throws(() => closeManifest(f.root, { members, acknowledgedRecords: [{ store: 'delivery', id: 'unnamed' }] }, f.context, f.dependencies), { code: 'migration-decision-unavailable' });
  assert.throws(() => closeManifest(f.root, { members, acknowledgedRecords: [{ store: 'review', id: opened.id, note: 'extra' }] }, f.context, f.dependencies), { code: 'migration-decision-unavailable' });
  assert.throws(() => closeManifest(f.root, { members, acknowledgedRecords: [{ store: 'review', id: '' }] }, f.context, f.dependencies), { code: 'migration-decision-unavailable' });
  const request = { members, choices, acknowledgedRecords: [{ store: 'review', id: opened.id }], manifestHash: shuffled.hash, authority: `Yes, and I acknowledge ${opened.id}`, reason: 'Settled', actor: closer };
  assert.throws(() => close(f.root, { ...request, acknowledgedRecords: [] }, f.context, f.dependencies), { code: 'close-older-release-present' });
  close(f.root, request, f.context, f.dependencies);
  assert.equal(readState(f.root, 'delivery', created.id).status, 'closed');
  assert.equal(olderThanSupport(null), true);
  assert.equal(olderThanSupport('3.3.25-abc'), true);
  assert.equal(olderThanSupport('3.3.26-abc'), false);
});

test('Ready omits closed records and offers close beside a pickup refusal', async t => {
  const f = fixture(t);
  const opened = await review(f);
  f.live.delete(ownerProcess.pid);
  const before = overview(f.root, { dependencies: f.dependencies });
  const record = before.records.find(item => item.id === opened.id);
  assert.deepEqual(record.close, { offer: 'close' });
  close(f.root, approve(f, [{ store: 'review', id: opened.id }]).request, f.context, f.dependencies);
  const after = overview(f.root, { dependencies: f.dependencies });
  assert.equal(after.records.some(item => item.id === opened.id), false);
  assert.deepEqual(after.compaction.find(entry => entry.store === 'review')?.blockedBy ?? [], []);
});

test('the guard refuses older-bound sessions with a live or uninspectable owner by name, warns on unrecorded ones, and close names every refusal', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const members = [{ store: 'delivery', id: created.id }];
  const aliveOwner = { pid: 9101, created: '1', name: 'claude.exe' };
  const unknownOwner = { pid: 9102, created: '2', name: 'codex.exe' };
  const endedOwner = { pid: 9103, created: '3', name: 'claude.exe' };
  const earlier = '2026-11-01T10:00:00.000Z';
  const later = '2026-11-01T11:00:00.000Z';
  f.live.add(aliveOwner.pid);
  const inspection = { ...f.dependencies, ownerAlive: process => process?.pid === unknownOwner.pid ? null : f.live.has(process?.pid) };
  olderBinding(f, 'alive-session', { activation: { owner: aliveOwner, observedAt: earlier } });
  olderBinding(f, 'alive-failed-session', { activation: { owner: aliveOwner, observedAt: earlier }, failure: { observedAt: later } });
  olderBinding(f, 'unknown-session', { activation: { owner: unknownOwner, observedAt: earlier } });
  olderBinding(f, 'ended-session', { activation: { owner: endedOwner, observedAt: earlier } });
  olderBinding(f, 'failed-session', { activation: { owner: endedOwner, observedAt: earlier }, failure: { observedAt: later } });
  olderBinding(f, 'stale-failure-session', { activation: { owner: endedOwner, observedAt: later }, failure: { observedAt: earlier } });
  olderBinding(f, 'unstarted-session');
  const blocked = closeManifest(f.root, { members }, f.context, inspection);
  const reasons = Object.fromEntries(blocked.guard.refusals.map(refusal => [refusal.session, refusal.reason]));
  assert.deepEqual(Object.keys(reasons).sort(), ['alive-failed-session', 'alive-session', 'unknown-session']);
  assert.match(reasons['alive-session'], /^Session alive-session is bound to older release 3[.]3[.]12-b+; its activation owner host process claude[.]exe [(]pid 9101[)] is alive: exit that host process, or retire the old session binding, before closing$/);
  assert.match(reasons['unknown-session'], /codex[.]exe [(]pid 9102[)] could not be inspected, so it may be alive: exit that host process, or retire the old session binding/);
  assert.deepEqual(blocked.guard.warnings.map(warning => [warning.session, warning.kind]).sort(), [['failed-session', 'newer-activation-failure'], ['unstarted-session', 'no-activation']]);
  const request = { members, choices: choicesFor(blocked), manifestHash: 'e'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer };
  assert.throws(() => close(f.root, request, f.context, inspection), error => error.code === 'close-older-release-present' && ['alive-session', 'alive-failed-session', 'unknown-session', 'pid 9101', 'pid 9102'].every(text => error.message.includes(text)));
  f.live.delete(aliveOwner.pid);
  const { manifest, request: approved } = approve(f, members);
  assert.deepEqual(manifest.guard.refusals, []);
  assert.deepEqual(manifest.guard.warnings.map(warning => warning.session).sort(), ['alive-failed-session', 'failed-session', 'unstarted-session']);
  assert.ok(manifest.hash);
  close(f.root, approved, f.context, f.dependencies);
  assert.equal(readState(f.root, 'delivery', created.id).status, 'closed');
});

test('the guard refuses an older-bound requesting session, warns on an older host registration and names an unreadable registry record', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const members = [{ store: 'delivery', id: created.id }];
  olderBinding(f, closer.session);
  olderHostRegistration(f);
  const manifest = closeManifest(f.root, { members }, f.context, f.dependencies);
  assert.deepEqual(manifest.guard.refusals.map(refusal => refusal.session), [closer.session]);
  assert.match(manifest.guard.refusals[0].reason, /^Session closing-session is bound to older release .* and is the session requesting close; close from a new session on a current release$/);
  assert.deepEqual(manifest.guard.warnings.map(warning => warning.kind), ['older-host-registration']);
  const request = { members, choices: choicesFor(manifest), manifestHash: 'e'.repeat(64), authority: 'Yes, close it', reason: 'Settled', actor: closer };
  assert.throws(() => close(f.root, request, f.context, f.dependencies), error => error.code === 'close-older-release-present' && error.message.includes('closing-session'));
  const other = olderBinding(f, 'other-session');
  for (const [kind, key, label] of [['session', 'not-a-session-key', 'session'], ['activation', other, 'activation'], ['registration', 'e'.repeat(64), 'registration']]) {
    const restore = rawRegistryRow(f, kind, key);
    try {
      const unreadable = closeManifest(f.root, { members }, f.context, f.dependencies);
      const refusal = unreadable.guard.refusals.find(item => item.registry === f.context.store);
      assert.ok(refusal, kind);
      assert.ok(refusal.reason.startsWith(`The release registry at ${f.context.store} could not be read:`), refusal.reason);
      assert.match(refusal.reason, new RegExp(label, 'i'));
    } finally { restore(); }
  }
  assert.deepEqual(closeManifest(f.root, { members }, null, f.dependencies).guard.refusals.map(refusal => refusal.reason), ['No admitted migration context: the older-release guard cannot read the release registry']);
});

test('a contained worker with a valid termination file is reconciled by close, after which the delivery is replaceable and setup is quiescent', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const helperProcess = { pid: 7201, created: '300', name: 'node.exe' };
  const terminationPath = '.nightshift/runs/fixture-worker-termination.json';
  update(f, current => { current.workers.push({ id: 'worker', role: 'lead', status: 'running', phase: 'contained', helperProcess, terminationPath }); });
  const members = [{ store: 'delivery', id: created.id }];
  f.live.add(helperProcess.pid);
  const active = closeManifest(f.root, { members }, f.context, f.dependencies);
  assert.equal(active.ineligible[0].code, 'worker-activity-unknown');
  assert.match(active.ineligible[0].message, /close accepts no native worker evidence in this release/);
  assert.doesNotMatch(active.ineligible[0].message, /adoption/);
  const offered = overview(f.root, { dependencies: f.dependencies }).records.find(item => item.id === created.id);
  assert.equal(offered.close.reason, 'worker-activity-unknown');
  assert.equal(offered.close.message, active.ineligible[0].message);
  assert.throws(() => assertQuiescent(f.root), { code: 'active-writer' });
  f.live.delete(helperProcess.pid);
  fs.writeFileSync(path.join(f.root, terminationPath), JSON.stringify({ runId: created.id, workerId: 'worker', helperProcess, descendantsReclaimed: true, exitCode: 0, observedAt: '2026-11-01T12:00:00.000Z' }));
  const { manifest, request } = approve(f, members);
  assert.equal(manifest.records[0].workers[0].reconciles, 'contained-termination');
  const before = readState(f.root, 'delivery', created.id);
  close(f.root, request, f.context, f.dependencies);
  const after = readState(f.root, 'delivery', created.id);
  assert.deepEqual(after.closure.reconciledWorkers, [{ id: 'worker', previousStatus: 'running', evidence: { kind: 'contained-termination' } }]);
  assert.equal(after.workers[0].status, 'stopped');
  const removed = ['status', 'closure', 'revision', 'updatedAt', 'progress', 'stopRecovery'];
  assert.deepEqual(without({ ...after, workers: after.workers.map(worker => ({ ...worker, status: undefined })) }, removed), without({ ...before, workers: before.workers.map(worker => ({ ...worker, status: undefined })) }, removed));
  assert.equal(assess(f).replaceable, true);
  assert.doesNotThrow(() => assertQuiescent(f.root));
  // A retry projects the closed member from its closure, without inspecting the worker again.
  const retry = closeManifest(f.root, { members, choices: request.choices }, f.context, { ...f.dependencies, ownerAlive: () => { throw new Error('No liveness inspection on a retry'); } });
  assert.equal(retry.records[0].workers[0].reconciles, null);
});

test('delivery accounting: close refuses records whose accounting is not current or whose store lacks it, and rolls back a save that leaves it not current', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const members = [{ store: 'delivery', id: created.id }];
  const { request } = approve(f, members);
  const save = RunStore.prototype.save;
  RunStore.prototype.save = function (state, kind, ...rest) {
    const saved = save.call(this, state, kind, ...rest);
    if (kind === 'close') state.progress = { ...state.progress, status: 'pending' };
    return saved;
  };
  try { assert.throws(() => close(f.root, request, f.context, f.dependencies), { code: 'close-accounting-unavailable' }); } finally { RunStore.prototype.save = save; }
  assert.equal(readState(f.root, 'delivery', created.id).status, 'stopped');
  assert.equal(historyOf(f.root, 'delivery', created.id).some(entry => entry.kind === 'close'), false);
  rawState(f, created.id, state => { state.objective = 'Changed outside the accounting'; });
  const stale = closeManifest(f.root, { members }, f.context, f.dependencies);
  assert.equal(stale.ineligible[0].code, 'close-accounting-unavailable');
  assert.match(stale.ineligible[0].message, /^Its accounting is not current: consult migration inventory/);
  const db = new DatabaseSync(path.join(f.root, '.nightshift/runs/state.sqlite'));
  try { db.exec('DROP TABLE discharge_index'); } finally { db.close(); }
  const legacy = closeManifest(f.root, { members }, f.context, f.dependencies);
  assert.equal(legacy.ineligible[0].code, 'close-accounting-unavailable');
  assert.match(legacy.ineligible[0].message, /retire this stopped legacy record instead/);
});

test('Ready names the accounting remedy for its status when a delivery marker is absent or not current', async t => {
  for (const status of ['running', 'stopped']) {
    for (const marker of ['absent', 'pending']) {
      const f = fixture(t);
      const created = await delivery(f);
      if (status === 'stopped') await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
      f.live.delete(ownerProcess.pid);
      rawState(f, created.id, state => { if (marker === 'absent') delete state.progress; else state.progress = { ...state.progress, status: 'pending' }; });
      const record = overview(f.root, { dependencies: f.dependencies }).records.find(item => item.id === created.id);
      assert.equal(record.close.offer, 'none');
      assert.equal(record.close.reason, 'close-accounting-unavailable');
      assert.match(record.close.message, status === 'running' ? /^Its saved accounting is not current: run close-manifest/ : /^Its saved accounting is not current: consult migration inventory/);
    }
  }
});

test('close refuses complete and retired members and a mismatched actor', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const members = [{ store: 'delivery', id: created.id }];
  const { request } = approve(f, members);
  assert.throws(() => close(f.root, { ...request, actor: { host: 'codex', session: closer.session } }, f.context, f.dependencies), { code: 'migration-authority-required' });
  assert.throws(() => close(f.root, { ...request, actor: owner }, f.context, f.dependencies), { code: 'migration-authority-required' });
  update(f, current => { current.status = 'complete'; });
  assert.equal(closeManifest(f.root, { members }, f.context, f.dependencies).ineligible[0].code, 'close-not-needed');
  const g = fixture(t);
  const second = await delivery(g);
  await g.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const db = new DatabaseSync(path.join(g.root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('CREATE TABLE IF NOT EXISTS legacy_retirements (run_id TEXT PRIMARY KEY REFERENCES runs(id), artifact TEXT NOT NULL)');
    db.prepare('INSERT INTO legacy_retirements VALUES (?, ?)').run(second.id, 'a'.repeat(64));
  } finally { db.close(); }
  assert.equal(closeManifest(g.root, { members: [{ store: 'delivery', id: second.id }] }, g.context, g.dependencies).ineligible[0].code, 'retired-run');
});
