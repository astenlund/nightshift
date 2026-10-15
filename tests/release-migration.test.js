'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { activate, fixture, packageCopy, refreshPackage, simulatedService } = require('./release-fixtures');

function legacyDelivery(project, resources, options = {}) {
  const root = fs.realpathSync.native(project);
  const directory = path.join(root, '.nightshift/runs');
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'state.sqlite'));
  const id = randomUUID();
  const now = new Date().toISOString();
  const state = { schema: 1, kind: 'delivery', id, root, revision: 0, status: options.status ?? 'complete', controller: { host: 'codex', session: 'owner' }, resourceMode: 'bound', resources, executionResources: resources, tasks: options.tasks ?? [], workers: [], followups: [], createdAt: now, updatedAt: now };
  const body = JSON.stringify(state);
  try {
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL); CREATE TABLE active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL REFERENCES runs(id)); CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision)); PRAGMA user_version=1;');
    db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(id, 0, body);
    db.prepare('INSERT INTO active VALUES (?, ?)').run(1, id);
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(id, 0, state.status, now, body);
  } finally { db.close(); }

  return id;
}

test('an older bound session can use the current administrative migration entry without changing its run binding', async t => {
  const value = fixture(t);
  const oldSource = packageCopy(value.root, '3.3.10');
  fs.unlinkSync(path.join(oldSource, 'internal/runtime/migration-cli.js'));
  refreshPackage(oldSource);
  const { service, state } = simulatedService(value, oldSource, '3.3.10');
  const { registration } = await service.setup({ host: 'codex', profile: value.profile });
  const old = await service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime' });
  const resources = { schema: 1, store: service.store, registration, session: 'owner', identity: old.bundle.identity };
  const id = legacyDelivery(value.project, resources);
  const currentSource = packageCopy(value.root, '3.3.11');
  state.source = currentSource;
  state.version = '3.3.11';
  const prepared = await service.prepare({ host: 'codex', profile: value.profile, session: 'owner', project: value.project, entry: 'migration' });
  assert.equal(prepared.version, '3.3.11');
  const invoke = async request => {
    const result = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request });
    assert.equal(result.code, 0, result.stderr);

    return JSON.parse(result.stdout);
  };
  const inventory = await invoke({ action: 'inventory' });
  assert.equal(inventory.counts.legacy, 1);
  await activate(service, registration, value.project, 'owner');
  const choice = { runId: id, disposition: 'retired-complete', report: { kind: 'none' }, followups: [] };
  const manifest = await invoke({ action: 'manifest', ids: [id], choices: [choice] });
  const retired = await invoke({ action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the exact fixture manifest' });
  assert.equal(retired.state, 'retired');
  const bindings = (await service.status()).sessions.filter(binding => binding.session === 'owner');
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].identity, old.bundle.identity);
  const db = new DatabaseSync(path.join(value.project, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('SELECT count(*) AS count FROM legacy_retirements').get().count, 1); }
  finally { db.close(); }
});

test('a retired selected stopped delivery routes a new session to the current runtime', async t => {
  const value = fixture(t);
  const oldSource = packageCopy(value.root, '3.3.10');
  fs.unlinkSync(path.join(oldSource, 'internal/runtime/migration-cli.js'));
  refreshPackage(oldSource);
  const { service, state } = simulatedService(value, oldSource, '3.3.10');
  const { registration } = await service.setup({ host: 'codex', profile: value.profile });
  const old = await service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime' });
  const resources = { schema: 1, store: service.store, registration, session: 'owner', identity: old.bundle.identity };
  const id = legacyDelivery(value.project, resources, { status: 'stopped', tasks: [{ id: 'unfinished', title: 'Unfinished work', status: 'active' }] });
  state.source = packageCopy(value.root, '3.3.11');
  state.version = '3.3.11';
  await service.prepare({ host: 'codex', profile: value.profile, session: 'owner', project: value.project, entry: 'migration' });
  await activate(service, registration, value.project, 'owner');
  const choice = { runId: id, disposition: 'retired-stopped', report: { kind: 'none' }, followups: [] };
  const preview = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'manifest', ids: [id], choices: [choice] } });
  assert.equal(preview.code, 0, preview.stderr);
  const retired = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'retire', ids: [id], choices: [choice], manifestHash: JSON.parse(preview.stdout).hash, authority: 'Approve this stopped fixture work' } });
  assert.equal(retired.code, 0, retired.stderr);
  await assert.rejects(service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } }), { code: 'migration-new-session-required' });
  await assert.rejects(service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', runId: id, tasks: [] } }), { code: 'migration-new-session-required' });
  await assert.rejects(service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime', runId: id, request: { action: 'handover', tasks: [] } }), { code: 'migration-new-session-required' });
  const next = await service.run(registration, { session: 'successor', project: value.project, entry: 'runtime', request: { action: 'handover', handoverId: randomUUID(), authority: 'Approve new fixture work', objective: 'New delivery', mechanism: { verified: true, kind: 'goal', evidence: 'Fixture continuation' }, tasks: [{ id: 'new-work', title: 'New work', agreement: { source: 'Fixture', outcome: 'New delivery' } }] } });
  assert.equal(next.code, 0, next.stderr);
  assert.notEqual(JSON.parse(next.stdout).id, id);
});

test('retirement between resolution and operation registration cannot launch an old handover', async t => {
  const value = fixture(t);
  const oldSource = packageCopy(value.root, '3.3.10');
  fs.unlinkSync(path.join(oldSource, 'internal/runtime/migration-cli.js'));
  refreshPackage(oldSource);
  const { service, state } = simulatedService(value, oldSource, '3.3.10');
  const { registration } = await service.setup({ host: 'codex', profile: value.profile });
  const old = await service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime' });
  const resources = { schema: 1, store: service.store, registration, session: 'owner', identity: old.bundle.identity };
  const id = legacyDelivery(value.project, resources);
  state.source = packageCopy(value.root, '3.3.11');
  state.version = '3.3.11';
  await service.prepare({ host: 'codex', profile: value.profile, session: 'owner', project: value.project, entry: 'migration' });
  await activate(service, registration, value.project, 'owner');
  const choice = { runId: id, disposition: 'retired-complete', report: { kind: 'none' }, followups: [] };
  const preview = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'manifest', ids: [id], choices: [choice] } });
  assert.equal(preview.code, 0, preview.stderr);
  const manifestHash = JSON.parse(preview.stdout).hash;
  const originalResolve = service.resolve.bind(service);
  let raced = false;
  service.resolve = async (...args) => {
    const resolved = await originalResolve(...args);
    if (!raced && args[1]?.entry === 'runtime' && args[1].request?.action === 'handover') {
      raced = true;
      const retired = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'retire', ids: [id], choices: [choice], manifestHash, authority: 'Approve the interleaved fixture record' } });
      assert.equal(retired.code, 0, retired.stderr);
    }

    return resolved;
  };
  await assert.rejects(service.run(registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', runId: id, handoverId: randomUUID(), tasks: [] } }), { code: 'migration-new-session-required' });
  assert.equal(raced, true);
});

test('an older binding cannot hand over while a nonselected delivery is retired', async t => {
  // Arrange
  const value = fixture(t);
  const oldSource = packageCopy(value.root, '3.3.10');
  fs.unlinkSync(path.join(oldSource, 'internal/runtime/migration-cli.js'));
  const oldServiceFile = path.join(oldSource, 'internal/releases/service.js');
  const oldService = fs.readFileSync(oldServiceFile, 'utf8');
  const resolutionLine = '    request = normalizeRuntimeTarget(request);';
  assert.ok(oldService.includes(resolutionLine));
  fs.writeFileSync(oldServiceFile, oldService.replace(resolutionLine, resolutionLine + String.fromCharCode(10) + "    if (request.entry === 'runtime' && ['handover', 'create'].includes(request.request?.action)) throw new Error('old-service-handover-chosen');"));
  const oldActionsFile = path.join(oldSource, 'internal/runtime/actions.js');
  fs.appendFileSync(oldActionsFile, String.fromCharCode(10) + "const oldIsRuntimeAction = module.exports.isRuntimeAction; module.exports.isRuntimeAction = action => action === 'create' || oldIsRuntimeAction(action);" + String.fromCharCode(10));
  refreshPackage(oldSource);
  const { service, state } = simulatedService(value, oldSource, '3.3.10');
  const { registration } = await service.setup({ host: 'codex', profile: value.profile });
  const old = await service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime' });
  const resources = { schema: 1, store: service.store, registration, session: 'owner', identity: old.bundle.identity };
  const selected = legacyDelivery(value.project, resources);
  const other = randomUUID();
  const db = new DatabaseSync(path.join(value.project, '.nightshift/runs/state.sqlite'));
  try {
    const original = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(selected).state);
    const cloned = { ...original, id: other, controller: { host: 'codex', session: 'other-owner' } };
    const body = JSON.stringify(cloned);
    db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(other, 0, body);
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(other, 0, 'complete', cloned.updatedAt, body);
  } finally { db.close(); }
  state.source = packageCopy(value.root, '3.3.11');
  state.version = '3.3.11';
  await service.prepare({ host: 'codex', profile: value.profile, session: 'owner', project: value.project, entry: 'migration' });
  await activate(service, registration, value.project, 'owner');
  const beforeRetirementRequest = path.join(value.root, 'before-retirement-resolve.json');
  fs.writeFileSync(beforeRetirementRequest, JSON.stringify({ action: 'resolve', session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } }));
  const beforeRetirement = spawnSync(process.execPath, [service.registration(registration).bootstrap, registration, beforeRetirementRequest], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(beforeRetirement.status, null, beforeRetirement.stderr);
  assert.doesNotMatch(beforeRetirement.stderr, /old-service-handover-chosen/);
  const choice = { runId: other, disposition: 'retired-complete', report: { kind: 'none' }, followups: [] };
  const preview = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'manifest', ids: [other], choices: [choice] } });
  assert.equal(preview.code, 0, preview.stderr);
  const retired = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'retire', ids: [other], choices: [choice], manifestHash: JSON.parse(preview.stdout).hash, authority: 'Approve the other fixture record' } });
  assert.equal(retired.code, 0, retired.stderr);

  // Act
  const handover = () => service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } });

  // Assert
  await assert.rejects(handover, { code: 'migration-new-session-required' });
  await assert.rejects(service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', runId: selected, handoverId: randomUUID(), tasks: [] } }), { code: 'migration-new-session-required' });
  await assert.rejects(service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime', runId: randomUUID(), request: { action: 'handover', handoverId: randomUUID(), tasks: [] } }), { code: 'migration-new-session-required' });
  const replayId = randomUUID();
  const replayDb = new DatabaseSync(path.join(value.project, '.nightshift/runs/state.sqlite'));
  try {
    const selectedState = JSON.parse(replayDb.prepare('SELECT state FROM runs WHERE id=?').get(selected).state);
    selectedState.acceptance = { handoverId: replayId };
    const body = JSON.stringify(selectedState);
    replayDb.prepare('UPDATE runs SET state=? WHERE id=?').run(body, selected);
    replayDb.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, selected);
  } finally { replayDb.close(); }
  const replay = await service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', runId: selected, handoverId: replayId, tasks: [] } });
  assert.equal(replay.bundle.identity, old.bundle.identity);
  const requestFile = path.join(value.root, 'older-handover-request.json');
  fs.writeFileSync(requestFile, JSON.stringify({ action: 'run', session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } }));
  const launch = spawnSync(process.execPath, [service.registration(registration).bootstrap, registration, requestFile], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(launch.status, 0);
  assert.match(launch.stderr, /migration-new-session-required/);
  assert.doesNotMatch(launch.stderr, /old-service-handover-chosen/);
  fs.writeFileSync(requestFile, JSON.stringify({ action: 'run', session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', tasks: [] } }));
  const legacyCreate = spawnSync(process.execPath, [service.registration(registration).bootstrap, registration, requestFile], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(legacyCreate.status, 0);
  assert.match(legacyCreate.stderr, /migration-new-session-required/);
  assert.doesNotMatch(legacyCreate.stderr, /old-service-handover-chosen/);
  const storeFile = path.join(value.project, '.nightshift/runs/state.sqlite');
  fs.renameSync(storeFile, storeFile + '.saved');
  fs.mkdirSync(storeFile);
  fs.writeFileSync(requestFile, JSON.stringify({ action: 'run', session: 'owner', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } }));
  const uncertain = spawnSync(process.execPath, [service.registration(registration).bootstrap, registration, requestFile], { encoding: 'utf8', timeout: 30000 });
  assert.notEqual(uncertain.status, 0);
  assert.match(uncertain.stderr, /Run database is not an ordinary file/);
  assert.doesNotMatch(uncertain.stderr, /old-service-handover-chosen/);
});

test('migration admission gives a new session a usable retained bundle binding', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.11');
  const { service } = simulatedService(value, source, '3.3.11');
  const { registration } = await service.setup({ host: 'codex', profile: value.profile });
  await service.prepare({ host: 'codex', profile: value.profile, session: 'new-session', project: value.project, entry: 'migration' });
  const binding = (await service.status()).sessions.find(item => item.session === 'new-session');
  assert.equal(typeof binding.bundle, 'string');
  const request = path.join(value.root, 'bootstrap-request.json');
  fs.writeFileSync(request, JSON.stringify({ action: 'status', session: 'new-session' }));
  const launch = spawnSync(process.execPath, [service.registration(registration).bootstrap, registration, request], { encoding: 'utf8', timeout: 30000 });
  assert.equal(launch.status, 0, launch.stderr);
});

test('a migration operation context cannot admit an ordinary runtime request', async t => {
  // Arrange
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.11');
  const { service } = simulatedService(value, source, '3.3.11');
  const { registration } = await service.setup({ host: 'codex', profile: value.profile });
  await service.prepare({ host: 'codex', profile: value.profile, session: 'owner', project: value.project, entry: 'migration' });
  const original = service.dependencies.runContained;
  service.dependencies.runContained = (executable, args, options) => {
    const request = path.join(value.root, 'ordinary-request.json');
    fs.writeFileSync(request, JSON.stringify({ action: 'status' }));

    return original(executable, [path.join(path.dirname(args[0]), 'cli.js'), args[1], request], options);
  };

  // Act
  const attempted = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'inventory' } });

  // Assert
  assert.notEqual(attempted.code, 0);
  assert.match(attempted.stderr, /migration-request-mismatch/);
});

test('a changed migration request cannot turn read-only admission into retirement', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.11');
  const { service } = simulatedService(value, source, '3.3.11');
  const { registration } = await service.setup({ host: 'codex', profile: value.profile });
  const resolved = await service.resolve(registration, { session: 'owner', project: value.project, entry: 'runtime' });
  const resources = { schema: 1, store: service.store, registration, session: 'owner', identity: resolved.bundle.identity };
  const id = legacyDelivery(value.project, resources);
  await service.prepare({ host: 'codex', profile: value.profile, session: 'owner', project: value.project, entry: 'migration' });
  const choice = { runId: id, disposition: 'retired-complete', report: { kind: 'none' }, followups: [] };
  const preview = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'manifest', ids: [id], choices: [choice] } });
  assert.equal(preview.code, 0, preview.stderr);
  const manifest = JSON.parse(preview.stdout);
  const originalRun = service.dependencies.runContained;
  service.dependencies.runContained = (executable, args, options) => {
    if (path.basename(args[0]) === 'migration-cli.js') fs.writeFileSync(args[2], JSON.stringify({ action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Tampered request', actor: { host: 'codex', session: 'owner' } }));

    return originalRun(executable, args, options);
  };
  const attempted = await service.run(registration, { session: 'owner', project: value.project, entry: 'migration', request: { action: 'inventory' } });
  assert.notEqual(attempted.code, 0);
  assert.match(attempted.stderr, /migration-request-mismatch/);
  const db = new DatabaseSync(path.join(value.project, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='legacy_retirements'").get().count, 0); }
  finally { db.close(); }
});
