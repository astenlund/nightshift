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
const { Registry } = require('../internal/releases/registry');
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

test('a closed record refuses every lifecycle action and store write, reports a closed brief and owes no notice or checkpoint', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'followup', item: { id: 'later', context: 'Pending decision', recommendation: 'Ask later' } });
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const { request } = approve(f, [{ store: 'delivery', id: created.id }]);
  close(f.root, request, f.context, f.dependencies);
  for (const action of [{ action: 'followup', item: { id: 'x', context: 'c', recommendation: 'r' } }, { action: 'resolve-followup', followupId: 'later', evidence: 'done' }, { action: 'hold', authority: 'a', reason: 'r' }, { action: 'stop', kind: 'user-stop', reason: 'r' }, { action: 'resume', authority: 'a' }, { action: 'retrospective', evidence: 'e' }]) {
    await assert.rejects(f.call(action), { code: 'run-closed' });
  }
  const state = readState(f.root, 'delivery', created.id);
  assert.equal(reportNotice(state), null);
  const handle = new RunStore(f.root);
  try { assert.throws(() => handle.update(owner, state.revision, 'probe', () => {}), { code: 'run-closed' }); } finally { handle.close(); }
  const status = await execute(f.root, { action: 'status' }, f.dependencies);
  assert.equal(status.status, 'closed');
  assert.deepEqual(status.next, []);
  assert.equal(status.closure.reason, 'The work is settled');
  assert.equal(status.acceptanceCheckpoint, null);
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
  // An older runtime has no closed guard: load a copy of the store whose statuses module treats nothing as closed, and append a
  // status-preserving follow-up revision after the close row, as such a runtime would.
  const storePath = require.resolve('../internal/runtime/store');
  const statusesPath = require.resolve('../internal/runtime/statuses');
  const saved = { store: require.cache[storePath], statuses: require.cache[statusesPath] };
  delete require.cache[storePath];
  require.cache[statusesPath] = { id: statusesPath, filename: statusesPath, loaded: true, exports: { ...require(statusesPath), isClosed: () => false, isFinished: state => state?.status === 'complete' } };
  let OlderStore;
  try { OlderStore = require(storePath).RunStore; } finally {
    require.cache[storePath] = saved.store;
    require.cache[statusesPath] = saved.statuses;
  }
  const older = new OlderStore(f.root);
  try {
    const state = older.read();
    older.update(owner, state.revision, 'followup', current => { current.followups.push({ id: 'older', context: 'Older runtime write', recommendation: 'None', status: 'pending' }); });
  } finally { older.close(); }
  const reread = readState(f.root, 'delivery', created.id);
  assert.equal(reread.status, 'closed');
  assert.notEqual(historyOf(f.root, 'delivery', created.id).at(-1).kind, 'close');
  const after = new RunStore(f.root);
  try { assert.equal(after.transaction(() => creationAssessment(after)).replaceable, true); } finally { after.close(); }
  const next = await delivery(f, { objective: 'A new delivery after the close' });
  assert.equal(next.status, 'running');
});

test('the creation gate refuses a closed status without its close row', async t => {
  const f = fixture(t);
  const created = await delivery(f);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  close(f.root, approve(f, [{ store: 'delivery', id: created.id }]).request, f.context, f.dependencies);
  const db = new DatabaseSync(path.join(f.root, '.nightshift/runs/state.sqlite'));
  try {
    const row = db.prepare('SELECT state FROM runs WHERE id=?').get(created.id);
    const state = JSON.parse(row.state);
    state.closure = { ...state.closure, reason: 'Edited without a close row' };
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), created.id);
  } finally { db.close(); }
  const handle = new RunStore(f.root);
  try { assert.throws(() => handle.transaction(() => creationAssessment(handle))); } finally { handle.close(); }
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
