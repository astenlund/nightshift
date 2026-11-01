'use strict';

const { fixtureContinuation } = require('./fixtures/continuation');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { execute } = require('../internal/runtime/cli');
const { overview } = require('../internal/runtime/run-overview');
const { fixtureAcknowledgement } = require('./fixtures/acknowledgement');

const scratch = path.resolve(__dirname, '../.tmp/run-overview-tests');
const owner = { host: 'codex', session: 'original-owner' };
const ownerProcess = { pid: 5101, created: '100', name: 'codex.exe' };
const MIB = 1024 * 1024;

function project(t) {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(scratch, 'case-')));
  t.after(() => { assert.equal(path.dirname(root), scratch); fs.rmSync(root, { recursive: true, force: true }); });
  fs.mkdirSync(path.join(root, '.nightshift/runs'), { recursive: true });

  return root;
}

async function delivery(t) {
  const root = project(t);
  const live = new Set([ownerProcess.pid]);
  const dependencies = { nativeOwner: () => ownerProcess, ownerAlive: process => live.has(process.pid), acknowledgementObserver: fixtureAcknowledgement };
  const created = await execute(root, { action: 'handover', mechanism: fixtureContinuation(), objective: 'Report open work in Ready', authority: 'User agreed fixture delivery', controller: owner, limits: { maxDispatches: 5 }, tasks: [{ id: 'change', title: 'Change', agreement: { source: 'fixture user', outcome: 'Report open work' } }] }, dependencies);
  const call = request => execute(root, { actor: owner, revision: readState(root, created.id).revision, ...request }, dependencies);

  return { root, id: created.id, live, dependencies, call };
}

function database(root, file = 'state.sqlite') {
  return new DatabaseSync(path.join(root, '.nightshift/runs', file));
}

function readState(root, id, file = 'state.sqlite') {
  const db = database(root, file);
  try { return JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state); } finally { db.close(); }
}

// Writes a copy of a saved state under a new ID, as a record the overview reads but the runtime never selected.
function copyState(root, id, change = () => {}) {
  const state = { ...readState(root, id), id: randomUUID() };
  change(state);
  const db = database(root);
  try { db.prepare('INSERT INTO runs(id, revision, state) VALUES (?, ?, ?)').run(state.id, state.revision, JSON.stringify(state)); } finally { db.close(); }

  return state.id;
}

function replaceState(root, id, change) {
  const state = readState(root, id);
  change(state);
  const db = database(root);
  try { db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), id); } finally { db.close(); }
}

// A review store built by hand at a chosen store version; overview reads only its runs table and header.
function reviewStore(root, { version = 2, states = [], padBytes = 0 } = {}) {
  const db = database(root, 'review-state.sqlite');
  try {
    db.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL)');
    for (const state of states) db.prepare('INSERT INTO runs(id, revision, state) VALUES (?, 0, ?)').run(state.id ?? randomUUID(), typeof state === 'string' ? state : JSON.stringify(state));
    if (padBytes) db.exec(`CREATE TABLE pad (body BLOB); INSERT INTO pad VALUES (zeroblob(${padBytes}));`);
    db.exec(`PRAGMA user_version=${version}`);
  } finally { db.close(); }
}

function reviewState(root, overrides = {}) {
  return { schema: 1, kind: 'review', id: randomUUID(), root, revision: 0, updatedAt: '2026-10-19T12:00:00.000Z', objective: 'Assess a fixture change', controller: owner, status: 'running', resourceMode: 'development', workers: [], tasks: [{ id: 'review', status: 'pending' }], ...overrides };
}

const only = (result, store) => result.records.filter(record => record.store === store);

test('a running current delivery is reported and offered for adoption only once its former controller has ended', async t => {
  const f = await delivery(t);
  const live = overview(f.root, { dependencies: f.dependencies });
  assert.deepEqual(live.unavailable, []);
  const [record] = only(live, 'delivery');
  assert.deepEqual({ ...record, updatedAt: undefined }, { store: 'delivery', id: f.id, kind: 'delivery', status: 'running', objective: 'Report open work in Ready', updatedAt: undefined, current: true, stop: null, tasks: { complete: 0, total: 1 }, report: null, pickup: { offer: 'none', reason: 'controller-not-inactive', message: 'The exact former controller process is live or its inactivity is unknown' } });
  assert.equal(typeof record.updatedAt, 'string');
  f.live.delete(ownerProcess.pid);
  assert.deepEqual(only(overview(f.root, { dependencies: f.dependencies }), 'delivery')[0].pickup, { offer: 'adopt' });
  assert.equal(only(overview(f.root, { dependencies: { ownerAlive: () => null } }), 'delivery')[0].pickup.reason, 'controller-not-inactive');
  replaceState(f.root, f.id, state => { delete state.controllerClaim; });
  assert.deepEqual(only(overview(f.root, { dependencies: f.dependencies }), 'delivery')[0].pickup, { offer: 'none', reason: 'controller-activity-unknown', message: 'The running source has no usable controller claim; stop it through its owner or preserve the blocked run' });
});

test('a worker with active or uncertain work blocks the offer until saved termination evidence accounts for it', async t => {
  const f = await delivery(t);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused the fixture' });
  const helperProcess = { pid: 7101, created: '300', name: 'node.exe' };
  const terminationPath = '.nightshift/runs/fixture-worker-termination.json';
  replaceState(f.root, f.id, state => { state.workers = [{ id: 'worker', role: 'lead', status: 'running', phase: 'contained', helperProcess, terminationPath }]; state.tasks[0].status = 'complete'; });
  const live = new Set([helperProcess.pid]);
  const dependencies = { ownerAlive: process => live.has(process.pid) };
  const [active] = only(overview(f.root, { dependencies }), 'delivery');
  assert.deepEqual(active.tasks, { complete: 1, total: 1 });
  assert.deepEqual(active.pickup, { offer: 'none', reason: 'worker-activity-unknown', message: 'Worker worker has active or uncertain work; reconcile attributable termination before adoption' });
  live.delete(helperProcess.pid);
  assert.equal(only(overview(f.root, { dependencies }), 'delivery')[0].pickup.reason, 'worker-activity-unknown');
  fs.writeFileSync(path.join(f.root, terminationPath), JSON.stringify({ runId: f.id, workerId: 'worker', helperProcess, descendantsReclaimed: true, exitCode: 0, observedAt: '2026-11-01T12:00:00.000Z' }));
  assert.deepEqual(only(overview(f.root, { dependencies }), 'delivery')[0].pickup, { offer: 'adopt' });
});

test('routing names a record owned by this session and one no bound context can adopt', async t => {
  const f = await delivery(t);
  f.live.delete(ownerProcess.pid);
  const owned = only(overview(f.root, { context: owner, dependencies: f.dependencies }), 'delivery')[0];
  assert.deepEqual(owned.pickup, { offer: 'none', reason: 'owned-by-this-session', message: 'This session already owns the record' });
  const other = only(overview(f.root, { context: { host: 'claude', session: 'another' }, dependencies: f.dependencies }), 'delivery')[0];
  assert.equal(other.pickup.reason, 'no-retained-release');
  replaceState(f.root, f.id, state => { state.resourceMode = 'bound'; });
  assert.equal(only(overview(f.root, { dependencies: f.dependencies }), 'delivery')[0].pickup.reason, 'not-development');
});

test('every stopped record is reported with its stop, a non-current one without pickup, and a retired one never', async t => {
  const f = await delivery(t);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused the fixture' });
  const stale = copyState(f.root, f.id);
  const retired = copyState(f.root, f.id);
  const db = database(f.root);
  try {
    db.exec('CREATE TABLE IF NOT EXISTS legacy_retirements (run_id TEXT PRIMARY KEY REFERENCES runs(id), artifact TEXT NOT NULL)');
    db.prepare('INSERT INTO legacy_retirements(run_id, artifact) VALUES (?, ?)').run(retired, 'fixture-certificate');
  } finally { db.close(); }
  const records = only(overview(f.root, { dependencies: f.dependencies }), 'delivery');
  assert.deepEqual(records.map(record => record.id).sort(), [f.id, stale].sort());
  const current = records.find(record => record.id === f.id);
  assert.deepEqual(current.stop, { kind: 'user-stop', reason: 'User paused the fixture' });
  assert.deepEqual(current.pickup, { offer: 'adopt' });
  assert.deepEqual(records.find(record => record.id === stale).pickup, { offer: 'none', reason: 'not-current', message: 'Only the project\'s current unfinished delivery run can be adopted' });
});

test('a retired current record is left out whatever its status', async t => {
  for (const status of ['running', 'stopped', 'complete']) {
    const f = await delivery(t);
    const retired = copyState(f.root, f.id, state => {
      state.status = status;
      if (status === 'complete') { state.handover = { authority: 'User handed over' }; state.closing = { ...state.closing, reportEvidence: { path: '.nightshift/runs/reports/morning-report.md', sha256: 'a'.repeat(64) }, reportDelivery: null }; }
    });
    const db = database(f.root);
    try {
      db.prepare('UPDATE active SET id=? WHERE singleton=1').run(retired);
      db.exec('CREATE TABLE IF NOT EXISTS legacy_retirements (run_id TEXT PRIMARY KEY REFERENCES runs(id), artifact TEXT NOT NULL)');
      db.prepare('INSERT INTO legacy_retirements(run_id, artifact) VALUES (?, ?)').run(retired, 'fixture-certificate');
    } finally { db.close(); }
    const records = only(overview(f.root, { dependencies: f.dependencies }), 'delivery');
    assert.deepEqual(records.map(record => [record.id, record.current, record.pickup.reason]), [[f.id, false, 'not-current']], status);
  }
});

test('a completed current delivery is reported only while its report awaits its recipient, and is offered that report', async t => {
  const f = await delivery(t);
  const report = '.nightshift/runs/reports/morning-report.md';
  replaceState(f.root, f.id, state => { state.status = 'complete'; state.handover = { authority: 'User handed over' }; state.closing = { ...state.closing, reportEvidence: { path: report, sha256: 'a'.repeat(64) }, reportDelivery: null }; });
  for (const context of [null, owner]) {
    const [record] = only(overview(f.root, { context, dependencies: f.dependencies }), 'delivery');
    assert.equal(record.status, 'complete');
    assert.equal(record.report, report);
    assert.deepEqual(record.pickup, { offer: 'present-report' });
  }
  replaceState(f.root, f.id, state => { delete state.closing.reportEvidence; });
  const [unrecorded] = only(overview(f.root, { dependencies: f.dependencies }), 'delivery');
  assert.equal(unrecorded.report, null);
  assert.deepEqual(unrecorded.pickup, { offer: 'none', reason: 'report-unrecorded', message: 'The delivery owes its morning report, but no saved report is recorded' });
  replaceState(f.root, f.id, state => { delete state.handover; });
  assert.deepEqual(only(overview(f.root, { dependencies: f.dependencies }), 'delivery'), []);
});

test('objectives and stop reasons are shortened as excerpts are, every stop kind is reported, and an absent task list counts as empty', async t => {
  const f = await delivery(t);
  for (const kind of ['resource-limit', 'adopted']) {
    replaceState(f.root, f.id, state => { state.objective = 'o'.repeat(201); state.status = 'stopped'; state.stop = { kind, reason: 'r'.repeat(200) }; delete state.tasks; });
    const [record] = only(overview(f.root, { dependencies: f.dependencies }), 'delivery');
    assert.equal(record.objective, 'o'.repeat(197) + '...');
    assert.deepEqual(record.stop, { kind, reason: 'r'.repeat(200) });
    assert.deepEqual(record.tasks, { complete: 0, total: 0 });
  }
  replaceState(f.root, f.id, state => { state.stop.reason = 'r'.repeat(201); });
  assert.equal(only(overview(f.root, { dependencies: f.dependencies }), 'delivery')[0].stop.reason, 'r'.repeat(197) + '...');
});

test('compaction is due for a large uncompacted store, blocked by its running records, and finish is due beside a compacted store', async t => {
  const root = project(t);
  const running = reviewState(root);
  reviewStore(root, { states: [running, reviewState(root, { status: 'complete' })], padBytes: 64 * MIB });
  const result = overview(root);
  assert.deepEqual(only(result, 'review').map(record => [record.id, record.kind, record.current, record.pickup.reason]), [[running.id, 'review', false, 'controller-activity-unknown']]);
  const [entry] = result.compaction;
  assert.deepEqual({ ...entry, bytes: undefined }, { store: 'review', version: 2, bytes: undefined, backup: false, due: true, finishDue: false, blockedBy: [running.id] });
  assert.ok(entry.bytes >= 64 * MIB);
  fs.writeFileSync(path.join(root, '.nightshift/runs/review-state.sqlite.pre-compaction'), 'backup');
  assert.deepEqual(overview(root).compaction.map(item => [item.due, item.finishDue, item.backup, item.blockedBy]), [[false, false, true, []]]);
  const db = database(root, 'review-state.sqlite');
  try { db.exec('PRAGMA user_version=3'); } finally { db.close(); }
  assert.deepEqual(overview(root).compaction.map(item => [item.due, item.finishDue]), [[false, true]]);
});

test('a small uncompacted store is not due', async t => {
  const root = project(t);
  reviewStore(root, { states: [reviewState(root)] });
  assert.deepEqual(overview(root).compaction.map(item => [item.version, item.due, item.finishDue]), [[2, false, false]]);
});

test('a store with a surviving sidecar is unavailable as busy, even when the store itself is missing', async t => {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const root = project(t);
    reviewStore(root, { states: [reviewState(root)] });
    fs.writeFileSync(path.join(root, '.nightshift/runs/review-state.sqlite' + suffix), '');
    assert.deepEqual(overview(root), { records: [], compaction: [], unavailable: [{ store: 'review', code: 'run-overview-busy', message: 'A SQLite journal, WAL or shared-memory file survives beside the store' }] });
    fs.rmSync(path.join(root, '.nightshift/runs/review-state.sqlite'));
    assert.deepEqual(overview(root).unavailable.map(item => item.code), ['run-overview-busy']);
  }
});

test('a missing store is left out, and unreadable stores are unavailable with their cause, never empty', async t => {
  const empty = project(t);
  assert.deepEqual(overview(empty), { records: [], compaction: [], unavailable: [] });
  const future = project(t);
  reviewStore(future, { version: 99, states: [reviewState(future)] });
  assert.deepEqual(overview(future).unavailable.map(item => [item.code, item.message]), [['review-resource-state-unavailable', 'Unsupported review database version 99']]);
  for (const bad of [() => 'not json', root => JSON.stringify(reviewState(root, { status: 'paused' }))]) {
    const corrupt = project(t);
    reviewStore(corrupt, { states: [reviewState(corrupt), bad(corrupt)] });
    const result = overview(corrupt);
    assert.deepEqual([result.records, result.compaction, result.unavailable.map(item => item.code)], [[], [], ['run-overview-unavailable']]);
  }
});

test('current states over the read bound leave the store unavailable but keep its compaction entry with unknown blockers', async t => {
  const root = project(t);
  reviewStore(root, { states: ['x'.repeat(65 * MIB)] });
  const result = overview(root);
  assert.deepEqual(result.records, []);
  assert.deepEqual(result.unavailable, [{ store: 'review', code: 'run-overview-bound', message: 'Current run states exceed the 64 MiB overview bound' }]);
  assert.deepEqual(result.compaction.map(item => [item.due, item.blockedBy]), [[true, null]]);
});
