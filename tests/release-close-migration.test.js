'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { activate, fixture, packageCopy, simulatedService } = require('./release-fixtures');
const { completeReflection } = require('./fixtures/completion');
const { HistoryReader } = require('../internal/runtime/history-store');
const { acquireLock } = require('../internal/unwrap-lock');

const OLDER = '3.3.12';
const CURRENT = '3.3.26';
const CLAIMS_RUNNER = path.join(__dirname, 'fixtures/releases/runtime-with-claims.cjs');
const closer = { host: 'codex', session: 'closer' };

// Starts its arguments as a child and exits with it. A runtime started through it records this relay as its native owner, so the
// recorded owner process has ended by the time anything inspects it.
const RELAY_SOURCE = [
  "'use strict';",
  "const { spawnSync } = require('node:child_process');",
  "const result = spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit', windowsHide: true });",
  'process.exitCode = result.status ?? 1;',
  '',
].join('\n');

function reviewStoreFile(project) { return path.join(project, '.nightshift/runs/review-state.sqlite'); }

// Rewrites the review store as a version-2 store, as releases before compact history wrote it: the same runs, active and artifacts
// rows, and every history revision's full state text, kind and time in the uncompacted history table.
function asVersionTwo(project) {
  const file = reviewStoreFile(project);
  const source = new DatabaseSync(file, { readOnly: true });
  let saved;
  try {
    assert.equal(source.prepare('PRAGMA user_version').get().user_version, 3);
    const history = source.prepare('SELECT run_id, revision FROM history ORDER BY run_id, revision').all().map(row => {
      const text = new HistoryReader(source, row.run_id).text(row.revision);
      return [row.run_id, row.revision, text.kind, text.recordedAt, text.state];
    });
    saved = {
      runs: source.prepare('SELECT id, revision, state FROM runs ORDER BY rowid').all().map(row => [row.id, row.revision, row.state]),
      active: source.prepare('SELECT singleton, id FROM active').all().map(row => [row.singleton, row.id]),
      artifacts: source.prepare('SELECT id, body FROM artifacts ORDER BY rowid').all().map(row => [row.id, row.body]),
      history,
    };
  } finally { source.close(); }
  fs.rmSync(file);
  const target = new DatabaseSync(file);
  try {
    target.exec('CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL); CREATE TABLE active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL REFERENCES runs(id)); CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision)); CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=2;');
    for (const row of saved.runs) target.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(...row);
    for (const row of saved.active) target.prepare('INSERT INTO active VALUES (?, ?)').run(...row);
    for (const row of saved.history) target.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(...row);
    for (const row of saved.artifacts) target.prepare('INSERT INTO artifacts VALUES (?, ?)').run(...row);
  } finally { target.close(); }
}

function reviewStates(project) {
  const db = new DatabaseSync(reviewStoreFile(project), { readOnly: true });
  try {
    return {
      version: db.prepare('PRAGMA user_version').get().user_version,
      states: new Map(db.prepare('SELECT id, state FROM runs').all().map(row => [row.id, JSON.parse(row.state)])),
    };
  } finally { db.close(); }
}

// A project with a completed delivery and two running review contexts, all made on the older release, whose review owners have
// ended; the review store is then version 2. The installed release is the current one and session `closer` is admitted to migration.
async function settledOnOlderRelease(t) {
  const value = fixture(t);
  const { service, state: native } = simulatedService(value, packageCopy(value.root, OLDER), OLDER);
  const { registration } = await service.setup({ host: 'codex', profile: value.profile });
  const call = async (session, request) => {
    const result = await service.run(registration, { session, project: value.project, entry: 'runtime', request });
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const agreement = { source: 'Fixture user', outcome: 'Reflect without instruction proposals' };
  await call('owner', { action: 'handover', handoverId: randomUUID(), authority: 'Explicit fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture goal' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement }] });
  const delivery = await completeReflection(value.project, { host: 'codex', session: 'owner' }, (_root, request) => call('owner', request));
  assert.equal(delivery.status, 'complete');
  const relay = path.join(value.root, 'relay.js');
  fs.writeFileSync(relay, RELAY_SOURCE);
  const runContained = service.dependencies.runContained;
  service.dependencies.runContained = (executable, args, options) => runContained(executable, path.basename(args[0]) === 'cli.js' ? [relay, CLAIMS_RUNNER, ...args] : args, options);
  const reviews = [];
  for (const session of ['reviewer-a', 'reviewer-b']) {
    reviews.push(await call(session, { action: 'open-review', reviewContextId: randomUUID(), kind: 'code', authority: 'Explicit standalone revision', objective: `Fixture review by ${session}`, agreement: { source: 'Fixture user', outcome: 'Assess the subject' } }));
  }
  service.dependencies.runContained = runContained;
  asVersionTwo(value.project);
  const before = reviewStates(value.project);
  assert.equal(before.version, 2);
  for (const review of reviews) {
    const saved = before.states.get(review.id);
    assert.equal(saved.status, 'running');
    assert.equal(saved.resourceMode, 'bound');
    assert.match(saved.executionResources.identity, new RegExp(`^${OLDER.replaceAll('.', '[.]')}-[a-f0-9]{64}$`));
    assert.notEqual(saved.ownerObservation.process.pid, process.pid);
    assert.throws(() => process.kill(saved.ownerObservation.process.pid, 0), { code: 'ESRCH' });
  }
  native.source = packageCopy(value.root, CURRENT);
  native.version = CURRENT;
  await service.setup({ host: 'codex', profile: value.profile });
  const prepared = await service.prepare({ host: 'codex', profile: value.profile, session: closer.session, project: value.project, entry: 'migration' });
  assert.equal(prepared.version, CURRENT);
  await activate(service, registration, value.project, closer.session);
  const migrate = request => service.run(registration, { session: closer.session, project: value.project, entry: 'migration', request });
  const invoke = async request => {
    const result = await migrate(request);
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const members = reviews.map(review => ({ store: 'review', id: review.id }));

  return { value, reviews, members, migrate, invoke };
}

function refusalCode(result) {
  assert.notEqual(result.code, 0);
  // Node's experimental-feature warnings share stderr with the entry's one-line JSON refusal.
  return JSON.parse(result.stderr.split(/\r?\n/).filter(line => line.startsWith('{')).at(-1)).error;
}

async function approvedClose(invoke, members) {
  const proposal = await invoke({ action: 'close-manifest', members });
  const choices = proposal.records.map(record => ({ store: record.store, id: record.id, report: { kind: 'none' }, followups: record.followups.map(item => ({ id: item.id, disposition: 'dismissed' })) }));
  const manifest = await invoke({ action: 'close-manifest', members, choices });

  return { manifest, request: { action: 'close', members, choices, manifestHash: manifest.hash, authority: 'Yes, close both review contexts as shown', reason: 'Their owners ended and the reviews are settled', actor: closer } };
}

test('close through the migration entry closes two ended older-bound review contexts, after which their version-2 store compacts', async t => {
  const { value, reviews, members, migrate, invoke } = await settledOnOlderRelease(t);
  assert.equal(refusalCode(await migrate({ action: 'compact-history', store: 'review' })), 'compaction-run-active');
  assert.equal(reviewStates(value.project).version, 2);

  const { manifest, request } = await approvedClose(invoke, members);
  assert.deepEqual(manifest.records.map(record => [record.store, record.id, record.status]), reviews.map(review => ['review', review.id, 'running']));
  assert.deepEqual(manifest.ineligible, []);
  assert.deepEqual(manifest.guard.refusals, []);
  assert.deepEqual(manifest.guard.named, []);
  assert.deepEqual(manifest.guard.warnings.map(warning => [warning.session, warning.kind]).sort(), [['owner', 'no-activation'], ['reviewer-a', 'no-activation'], ['reviewer-b', 'no-activation']]);
  assert.match(manifest.hash, /^[a-f0-9]{64}$/);

  const closed = await invoke(request);
  assert.equal(closed.state, 'closed');
  assert.equal(closed.manifestHash, manifest.hash);
  assert.deepEqual(closed.members.map(member => [member.store, member.id]).sort(), members.map(member => [member.store, member.id]).sort());
  const after = reviewStates(value.project);
  assert.equal(after.version, 2);
  for (const review of reviews) {
    const saved = after.states.get(review.id);
    assert.equal(saved.status, 'closed');
    assert.equal(saved.closure.reason, request.reason);
    assert.equal(saved.closure.authority, request.authority);
    assert.equal(saved.closure.manifestHash, manifest.hash);
    assert.equal(saved.closure.previousStatus, 'running');
    assert.deepEqual(saved.closure.actor, closer);
  }

  const compacted = await invoke({ action: 'compact-history', store: 'review' });
  assert.equal(compacted.state, 'swapped');
  assert.equal(reviewStates(value.project).version, 3);
});

test('close through the migration entry refuses while another connection holds the project write-ownership mutex', async t => {
  const { value, reviews, members, migrate, invoke } = await settledOnOlderRelease(t);
  const { request } = await approvedClose(invoke, members);
  const lock = acquireLock(path.join(value.project, '.nightshift/runs'), { name: 'write-ownership.sqlite', label: 'runtime project', codePrefix: 'runtime-ownership' });
  try { assert.equal(refusalCode(await migrate(request)), 'runtime-ownership-busy'); } finally { lock.close(); }
  for (const review of reviews) assert.equal(reviewStates(value.project).states.get(review.id).status, 'running');
  assert.equal((await invoke(request)).state, 'closed');
});
