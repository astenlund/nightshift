'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Registry } = require('../internal/releases/registry');
const { capture } = require('../internal/releases/bundles');
const { MANIFEST_PATH, loadManifest, validateManifest, verifyBundle } = require('../internal/releases/manifest');
const { validateDependencies } = require('../tools/release-manifest');
const { activate, fixture, packageCopy, simulatedService } = require('./release-fixtures');

test('manifest validation rejects omissions, alias paths and stale bytes', t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '1.0.0');
  const { manifest } = loadManifest(source);
  const omitted = structuredClone(manifest);
  omitted.files = omitted.files.filter(file => file.path !== 'skills/ready/ready.js');
  assert.throws(() => validateManifest(omitted), /Missing required/);
  const alias = structuredClone(manifest);
  alias.files.push({ ...alias.files[0], path: alias.files[0].path.toUpperCase() });
  assert.throws(() => validateManifest(alias), /Unexpected or duplicate/);
  assert.throws(() => validateDependencies(['internal/a.js'], () => Buffer.from("require('../outside.js')")), /outside the declared payload/);
  const registry = new Registry(value.store, { create: true });
  const bundle = registry.transaction(() => capture(registry, source));
  fs.appendFileSync(path.join(bundle.root, 'skills/ready/ready.js'), '\nchanged');
  assert.throws(() => verifyBundle(bundle.root, bundle.identity), /failed verification/);
  registry.close();
});

test('deletion during copying never publishes a partial bundle', t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '1.0.0');
  const registry = new Registry(value.store, { create: true });
  try {
    assert.throws(() => registry.transaction(() => capture(registry, source, { afterCopy: file => { if (file === '.claude-plugin/plugin.json') fs.unlinkSync(path.join(source, '.codex-plugin/plugin.json')); } })), /Cannot read complete/);
    assert.equal(registry.list('bundle').length, 0);
    assert.equal(fs.existsSync(path.join(value.store, 'bundles')), false);
  } finally { registry.close(); }
});

test('old work keeps its release and retired work never silently upgrades', async t => {
  const value = fixture(t);
  const first = packageCopy(value.root, '1.0.0');
  const second = packageCopy(value.root, '1.0.1');
  const { service, state } = simulatedService(value, first);
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'old');
  const original = await service.resolve(setup.registration, { session: 'old', project: value.project, entry: 'ready' });
  fs.rmSync(first, { recursive: true });
  state.source = second; state.version = '1.0.1';
  const stillOld = await service.resolve(setup.registration, { session: 'old', project: value.project, entry: 'ready' });
  assert.equal(stillOld.bundle.identity, original.bundle.identity);
  await activate(service, setup.registration, value.project, 'new');
  const current = await service.resolve(setup.registration, { session: 'new', project: value.project, entry: 'ready' });
  assert.notEqual(current.bundle.identity, original.bundle.identity);
  service.collect();
  assert.ok(fs.existsSync(original.bundle.root));
  service.retire(setup.registration, { targetSession: 'old' });
  service.collect();
  assert.equal(fs.existsSync(original.bundle.root), false);
  await assert.rejects(service.resolve(setup.registration, { session: 'old', project: value.project, entry: 'ready' }), /retired/);
  await assert.rejects(service.recover(setup.registration, { targetSession: 'old' }), /not the release bound/);
});

test('setup and observed activation are required before bound operations', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '1.0.0');
  const { service, state } = simulatedService(value, source);
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await assert.rejects(service.resolve(setup.registration, { session: 'owner', project: value.project }), /has not observed/);
  await activate(service, setup.registration, value.project, 'owner');
  const exit = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  assert.equal(exit.code, 0, exit.stderr);
  assert.deepEqual(JSON.parse(exit.stdout).structuralErrors, []);
  state.trusted = false;
  await assert.rejects(service.run(setup.registration, { session: 'owner', project: value.project, entry: 'ready' }), /disabled, changed or untrusted/);
  state.trusted = true; state.enabled = false;
  await assert.rejects(service.run(setup.registration, { session: 'owner', project: value.project, entry: 'ready' }), /disabled fixture plugin/);
});

test('bound runtime state carries identity and blocks development mutations', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '1.0.0');
  const { service } = simulatedService(value, source);
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  await assert.rejects(service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', controller: { host: 'codex', session: 'different-owner' } } }), /must match the admitted native session/);
  const created = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] } });
  assert.equal(created.code, 0, created.stderr);
  const run = JSON.parse(created.stdout);
  assert.equal(run.resourceMode, 'bound');
  assert.equal(run.resources.session, 'owner');
  const { execute } = require('../internal/runtime/cli');
  await assert.rejects(execute(value.project, { action: 'start-task', taskId: 'work', actor: run.controller, revision: run.revision }), /exact retained resource binding/);
  assert.throws(() => service.retire(setup.registration, { targetSession: 'owner' }), /Stop and explicitly select/);
});

test('initial capture may select a newer complete release after a missing-file failure', async t => {
  const value = fixture(t);
  const first = packageCopy(value.root, '1.0.0');
  const broken = packageCopy(value.root, '1.0.1');
  const current = packageCopy(value.root, '1.0.2');
  const { service } = simulatedService(value, first);
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  fs.unlinkSync(path.join(broken, 'skills/ready/ready.js'));
  let attempts = 0;
  service.dependencies.discover = async () => ++attempts === 1 ? { root: broken, version: '1.0.1' } : { root: current, version: '1.0.2' };
  const result = await service.resolve(setup.registration, { session: 'owner', project: value.project });
  assert.equal(attempts, 2);
  assert.equal(result.bundle.version, '1.0.2');
  assert.ok(fs.existsSync(path.join(result.bundle.root, MANIFEST_PATH)));
});

test('removed registration preserves existing resources and prevents new admission', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const original = await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  await service.remove(setup.registration);
  assert.equal(JSON.parse(fs.readFileSync(setup.locator, 'utf8')).state, 'removed');
  await assert.rejects(service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' }), /Complete host setup/);
  service.collect();
  assert.ok(fs.existsSync(original.bundle.root));
});

test('a conflicting host locator is preserved before setup writes anything', async t => {
  const value = fixture(t);
  const file = path.join(value.profile, 'nightshift-resources.json');
  const original = JSON.stringify({ schema: 1, store: path.join(value.root, 'other-store'), registration: 'another-registration', state: 'registered' });
  fs.writeFileSync(file, original);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  await assert.rejects(service.setup({ host: 'codex', profile: value.profile }), /already attached to another/);
  assert.equal(fs.readFileSync(file, 'utf8'), original);
  assert.equal(fs.existsSync(value.store), false);
});

test('unknown registry state prevents collection of otherwise unreferenced bundles', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  const extra = packageCopy(value.root, '1.0.1');
  const registry = new Registry(value.store);
  let bundle;
  try {
    bundle = registry.transaction(() => capture(registry, extra));
    registry.db.prepare('INSERT INTO records (kind, key, value) VALUES (?, ?, ?)').run('future-owner', 'owner', '{}');
  } finally { registry.close(); }
  assert.throws(() => service.collect(), /Unknown/);
  assert.ok(fs.existsSync(bundle.root));
  assert.ok(fs.existsSync(setup.bootstrap));
});
