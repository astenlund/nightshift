'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { Registry } = require('../internal/releases/registry');
const { capture } = require('../internal/releases/bundles');
const { MANIFEST_PATH, loadManifest, validateManifest, verifyBundle } = require('../internal/releases/manifest');
const { validateDependencies } = require('../tools/release-manifest');
const { activate, claudeInspection, fixture, packageCopy, refreshPackage, settingsReader, simulatedService } = require('./release-fixtures');
const { inspectionContext } = require('../internal/releases/host-config');
const { CONTEXT_ENV } = require('../internal/releases/entry');
const { MAX_OPERATION_TIMEOUT_MS } = require('../internal/releases/processes');
const { spawnSync } = require('node:child_process');
const os = require('node:os');

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

test('Ready runs without trusted continuation while dependent operations still require activation', async t => {
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
  const untrustedReady = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  assert.equal(untrustedReady.code, 0, untrustedReady.stderr);
  await assert.rejects(service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create' } }), /not trusted on this host/);
  state.trusted = true; state.enabled = false;
  await assert.rejects(service.run(setup.registration, { session: 'owner', project: value.project, entry: 'ready' }), /disabled fixture plugin/);
});

test('first-use preparation admits the real Ready parser without creating activation', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '3.1.1'), '3.1.1');
  state.trusted = false;
  let writes = 0;
  service.overrides.applyHooks = async () => { writes++; };
  const request = { host: 'codex', profile: value.profile, project: value.project, session: 'owner', entry: 'ready' };
  const prepared = await service.prepare(request);
  const first = await service.run(prepared.registration, request);
  assert.equal(first.code, 0, first.stderr);
  assert.deepEqual(JSON.parse(first.stdout).structuralErrors, []);
  const before = await service.status();
  assert.deepEqual(before.activations, []);
  await assert.rejects(service.run(prepared.registration, { ...request, entry: 'runtime', request: { action: 'create' } }), /not trusted on this host/);
  state.trusted = true;
  await assert.rejects(service.run(prepared.registration, { ...request, entry: 'runtime', request: { action: 'create' } }), /has not observed/);
  assert.deepEqual(await service.prepare(request), prepared);
  const after = await service.status();
  assert.equal(after.sessions[0].identity, before.sessions[0].identity);
  assert.equal(after.registrations.length, 1);
  assert.equal(writes, 1);
});

test('preparation repairs a missing locator without rewriting registered hooks', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  fs.unlinkSync(setup.locator);
  service.overrides.applyHooks = async () => { throw new Error('unexpected configuration write'); };
  const result = await service.prepare({ host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' });
  assert.equal(result.bootstrap, setup.bootstrap);
  assert.equal(JSON.parse(fs.readFileSync(setup.locator, 'utf8')).registration, setup.registration);
});

test('preparation updates administrative routing while existing sessions retain their release', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '3.1.0'), '3.1.0');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  const original = await service.resolve(setup.registration, { session: 'old', project: value.project, entry: 'ready' });
  state.source = packageCopy(value.root, '3.1.1');
  state.version = '3.1.1';
  service.overrides.applyHooks = async () => { throw new Error('upgrade must preserve hooks'); };
  const request = { host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' };
  const prepared = await service.prepare(request);
  assert.equal(prepared.bootstrap, setup.bootstrap);
  const current = await service.resolve(prepared.registration, request);
  assert.equal(current.bundle.version, '3.1.1');
  await service.prepare({ ...request, session: 'old' });
  const old = await service.resolve(prepared.registration, { ...request, session: 'old' });
  assert.equal(old.bundle.identity, original.bundle.identity);
  assert.equal(service.registration(setup.registration).generation, setup.generation);
});

test('automatic preparation respects removal even if the locator was lost', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await service.remove(setup.registration);
  const request = { host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' };
  await assert.rejects(service.prepare(request), /removed/);
  fs.unlinkSync(setup.locator);
  await assert.rejects(service.prepare(request), /removed/);
  assert.equal(service.registration(setup.registration).state, 'removed');
});

test('disabled or unknown installation state never triggers automatic setup', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const request = { host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' };
  state.enabled = false;
  await assert.rejects(service.prepare(request), /disabled fixture plugin/);
  assert.equal(fs.existsSync(value.store), false);
  state.enabled = true;
  service.dependencies.inspectHooks = async () => ({ disabled: true, usable: false, entries: [] });
  await assert.rejects(service.prepare(request), /hooks are disabled/);
  assert.equal(fs.existsSync(value.store), false);
  service.dependencies.inspectHooks = async () => { throw new Error('inspection unavailable'); };
  await assert.rejects(service.prepare(request), /inspection unavailable/);
  assert.equal(fs.existsSync(value.store), false);
  await assert.rejects(service.prepare({ ...request, entry: 'unknown' }), /Choose ready/);
  assert.equal(fs.existsSync(value.store), false);
});

test('Ready refuses explicitly disabled or missing registered hooks', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  // A removed registration and a deliberate opt-out are refused for different reasons and
  // recovered differently, so the read-only view names them separately too.
  const cases = [
    { hooks: { configured: true, disabled: true }, expected: /are disabled; enable them explicitly/ },
    { hooks: { configured: false, disabled: false }, expected: /were removed or changed; reconcile them explicitly/ },
  ];
  for (const { hooks, expected } of cases) {
    service.dependencies.inspectHooks = async () => hooks;
    await assert.rejects(service.run(setup.registration, { session: 'owner', project: value.project, entry: 'ready' }), expected);
  }
  assert.deepEqual((await service.status()).sessions, []);
});

test('a concurrent removal prevents automatic registration from reviving Nightshift', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  const discover = service.dependencies.discover;
  service.dependencies.discover = async (...args) => {
    await service.remove(setup.registration);
    return discover(...args);
  };
  await assert.rejects(service.setup({ host: 'codex', profile: value.profile, automatic: true }), /changed concurrently/);
  assert.equal(service.registration(setup.registration).state, 'removed');
});

test('automatic preparation resumes a first registration with real Claude hook inspection', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  service.overrides.applyHooks = async () => { throw new Error('interrupted before hooks'); };
  await assert.rejects(service.setup({ host: 'claude', profile: value.profile }), /interrupted before hooks/);
  const registration = (await service.status()).registrations[0];
  assert.equal(service.registration(registration.key).definitions, undefined);
  service.dependencies.inspectHooks = claudeInspection(require('../internal/releases/host-config'), settingsReader());
  service.overrides.applyHooks = async current => {
    const hooks = Object.fromEntries(Object.entries(current.definitions).map(([event, definition]) => [event, [{ hooks: [definition] }]]));
    fs.writeFileSync(path.join(value.profile, 'settings.json'), JSON.stringify({ hooks }));
  };
  const prepared = await service.prepare({ host: 'claude', profile: value.profile, project: value.project, session: 'recovery', entry: 'ready' });
  const exit = await service.run(prepared.registration, { session: 'recovery', project: value.project, entry: 'ready' });
  assert.equal(exit.code, 0, exit.stderr);
  assert.equal(service.registration(prepared.registration).pending, null);
});

test('a prepared session survives an older session reverting administrative routing through the bootstrap', async t => {
  const value = fixture(t);
  const first = packageCopy(value.root, '3.1.0');
  const second = packageCopy(value.root, '3.1.1');
  fs.copyFileSync(path.join(__dirname, 'fixtures/releases/bootstrap-3.1.0.cjs'), path.join(first, 'internal/releases/bootstrap.js'));
  for (const [source, version] of [[first, '3.1.0'], [second, '3.1.1']]) {
    fs.writeFileSync(path.join(source, 'internal/releases/launcher.js'), `module.exports.route = async () => process.stdout.write(JSON.stringify({ routedVersion: '${version}' }));\n`);
    refreshPackage(source);
  }
  const { service, state } = simulatedService(value, first, '3.1.0');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  const old = await service.resolve(setup.registration, { session: 'old', project: value.project, entry: 'ready' });
  state.source = second; state.version = '3.1.1';
  const prepared = await service.prepare({ host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' });
  // This is the write the original 3.1.0 bind callback can make after preparation.
  service.registry(registry => {
    const registration = registry.get('registration', setup.registration);
    registration.baseBundle = old.bundle.key;
    registry.put('registration', setup.registration, registration);
  });
  const request = path.join(value.project, 'request.json');
  fs.writeFileSync(request, JSON.stringify({ action: 'resolve', session: 'new', project: value.project, entry: 'ready' }));
  const result = spawnSync(process.execPath, [setup.bootstrap, setup.registration, request], { cwd: value.project, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).routedVersion, '3.1.1');
  assert.equal(prepared.version, '3.1.1');
  assert.equal(service.registration(setup.registration).generation, setup.generation);
});

test('the current launcher applies Ready admission to old bindings while retaining their parser and hooks', async t => {
  const value = fixture(t);
  const first = packageCopy(value.root, '3.1.0');
  const second = packageCopy(value.root, '3.1.1');
  fs.copyFileSync(path.join(__dirname, 'fixtures/releases/bootstrap-3.1.0.cjs'), path.join(first, 'internal/releases/bootstrap.js'));
  refreshPackage(first);
  const { service, state } = simulatedService(value, first, '3.1.0');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  const original = service.registration(setup.registration);
  const old = await service.resolve(setup.registration, { session: 'old', project: value.project, entry: 'ready' });
  state.source = second; state.version = '3.1.1'; state.trusted = false;
  service.overrides.applyHooks = async () => { throw new Error('Compatibility must not rewrite hooks'); };
  const prepared = await service.prepare({ host: 'codex', profile: value.profile, project: value.project, session: 'old', entry: 'ready' });
  const registration = service.registration(setup.registration);
  assert.equal(prepared.identity, old.bundle.identity);
  assert.equal(prepared.root, old.bundle.root);
  assert.notEqual(prepared.bootstrap, setup.bootstrap);
  assert.notEqual(registration.bootstrapHash, original.bootstrapHash);
  assert.equal(registration.generation, original.generation);
  assert.deepEqual(registration.definitions, original.definitions);
  assert.ok(registration.routes.some(route => route.bootstrap === setup.bootstrap));
  let parser;
  const runContained = service.dependencies.runContained;
  service.dependencies.runContained = async (...args) => { parser = args[1][0]; return runContained(...args); };
  const result = await service.run(prepared.registration, { session: 'old', project: value.project, entry: 'ready' });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(parser, path.join(old.bundle.root, 'skills/ready/ready.js'));
  await assert.rejects(service.run(prepared.registration, { session: 'old', project: value.project, entry: 'runtime', request: { action: 'create' } }), /not trusted on this host/);
});

test('preparing runtime resources does not admit runtime work without activation', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  state.trusted = false;
  const request = { host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'runtime', request: { action: 'create' } };
  const prepared = await service.prepare(request);
  assert.ok(prepared.identity);
  // `preparing` is a positional argument of resolve, never a request field: a caller
  // cannot supply it to skip the activation it exempts.
  await assert.rejects(service.run(prepared.registration, { ...request, preparing: true }), /not trusted on this host/);
  state.trusted = true;
  await assert.rejects(service.run(prepared.registration, { ...request, preparing: true, maintenance: true }), /has not observed/);
  assert.deepEqual((await service.status()).activations, []);
});

for (const interruption of ['applied-write', 'no-op']) test(`automatic recovery preserves native configuration after ${interruption}`, async t => {
  const value = fixture(t);
  const first = packageCopy(value.root, '3.1.0');
  const second = packageCopy(value.root, '3.1.1');
  fs.copyFileSync(path.join(__dirname, 'fixtures/releases/bootstrap-3.1.0.cjs'), path.join(first, 'internal/releases/bootstrap.js'));
  refreshPackage(first);
  const { service, state } = simulatedService(value, first, '3.1.0');
  const configuration = require('../internal/releases/host-config');
  const read = settingsReader();
  service.dependencies.inspectHooks = claudeInspection(configuration, read);
  service.overrides.inspectHooks = claudeInspection(configuration, read);
  service.overrides.applyHooks = (registration, cwd, remove, beforeWrite, options = {}) => configuration.applyHooks(registration, cwd, remove, beforeWrite, { ...options, readSettings: read });
  const settings = path.join(value.profile, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ theme: 'preserve', permissions: { deny: ['Bash(private)'] } }));
  if (interruption === 'no-op') await service.setup({ host: 'claude', profile: value.profile });
  service.overrides.applyHooks = async (...args) => {
    await configuration.applyHooks(...args);
    throw new Error('Interrupted after hook application');
  };
  await assert.rejects(service.setup({ host: 'claude', profile: value.profile }), /Interrupted after hook application/);
  const key = (await service.status()).registrations[0].key;
  const pending = structuredClone(service.registration(key).pending);
  assert.equal(!!pending.journal, interruption === 'applied-write');
  const appliedBytes = fs.readFileSync(settings);
  state.source = second; state.version = '3.1.1';
  service.overrides.applyHooks = async () => { throw new Error('Recovery must not rewrite applied native hooks'); };
  const prepared = await service.prepare({ host: 'claude', profile: value.profile, project: value.project, session: 'recovery', entry: 'ready' });
  const recovered = service.registration(key);
  assert.equal(recovered.pending, null);
  assert.equal(recovered.generation, pending.generation);
  assert.deepEqual(recovered.definitions, pending.definitions);
  assert.deepEqual(fs.readFileSync(settings), appliedBytes);
  assert.notEqual(prepared.bootstrap, pending.bootstrap);
  assert.deepEqual((await service.status()).activations, []);
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

test('the launcher refuses an unknown runtime action before launch and passes its operation deadline', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '1.0.0');
  const { service } = simulatedService(value, source);
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const created = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] } });
  assert.equal(created.code, 0, created.stderr);
  const launches = [];
  service.dependencies.runContained = async (executable, args, options) => {
    options.onPrepared({ runnerPid: process.pid });
    options.onStarted({ pid: process.pid, runnerPid: process.pid, contained: true });
    launches.push({ context: JSON.parse(options.env[CONTEXT_ENV]), timeoutMs: options.timeoutMs });
    const exit = { code: 0, stdout: '{}\n', stderr: '', descendantsReclaimed: true };
    options.onFinished(exit);
    return exit;
  };
  const request = runtime => ({ session: 'owner', project: value.project, entry: 'runtime', request: runtime });
  await assert.rejects(service.run(setup.registration, request({ action: 'statuss' })), { code: 'invalid-runtime-request', message: /"statuss" is not a runtime action; accepted actions: status, / });
  await assert.rejects(service.run(setup.registration, request({ operation: 'status' })), { code: 'invalid-runtime-request', message: /action is missing/ });
  assert.equal(launches.length, 0);
  for (const timeoutMs of [undefined, 1500000]) {
    const before = Date.now();
    await service.run(setup.registration, { ...request({ action: 'status' }), timeoutMs });
    const after = Date.now();
    const launch = launches.at(-1);
    const bound = timeoutMs ?? MAX_OPERATION_TIMEOUT_MS;
    assert.equal(launch.timeoutMs, timeoutMs);
    const deadline = Date.parse(launch.context.operationDeadlineUtc);
    assert.ok(deadline >= before + bound && deadline <= after + bound, `${deadline} outside ${before + bound}..${after + bound}`);
  }
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

test('dependent admission resolves host settings against the same project as the Ready view', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'claude', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');

  // Record the resolution context every admission path asks about, so a dependent
  // operation cannot silently consult a different settings scope than Ready.
  // Record the directory the shared resolver actually chooses, rather than restating its
  // rule here: a copy of the rule cannot fail when the rule itself regresses.
  const seen = [];
  service.dependencies.inspectHooks = async (registration, cwd, options = {}) => {
    seen.push(inspectionContext(cwd, options));
    return { configured: true, disabled: false, usable: true, entries: [] };
  };

  await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  const readyContexts = seen.splice(0);
  assert.ok(readyContexts.length > 0);
  assert.ok(readyContexts.every(project => project === value.project), `Ready inspected ${JSON.stringify(readyContexts)}`);

  await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'status' } });
  const dependentContexts = seen.splice(0);
  assert.ok(dependentContexts.length > 0);
  assert.ok(dependentContexts.every(project => project === value.project), `Dependent admission inspected ${JSON.stringify(dependentContexts)}`);
});

test('dependent admission separates a deliberate opt-out from a changed registration and missing trust', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const request = { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create' } };

  // Only one of these three is fixed by reopening the session, so each states its own
  // recovery. A deliberate opt-out and a removed registration share a code and are
  // separated by message; denied trust has its own code.
  state.disabled = true;
  await assert.rejects(service.resolve(setup.registration, request), error => error.code === 'nightshift-disabled' && /enable them explicitly/.test(error.message));

  state.disabled = false;
  state.configured = false;
  await assert.rejects(service.resolve(setup.registration, request), error => error.code === 'nightshift-disabled' && /removed or changed/.test(error.message));

  state.configured = true;
  state.trusted = false;
  await assert.rejects(service.resolve(setup.registration, request), error => error.code === 'hook-activation-required' && /not trusted/.test(error.message));
});

test('the launcher admits only cache-independent actions without a registration and validates the status project', async t => {
  const value = fixture(t);
  const { route } = require('../internal/releases/launcher');
  const base = { host: 'claude', profile: value.profile, store: value.store, session: 'owner', project: value.project };

  await assert.rejects(route({ ...base, action: 'resolve' }), error => error.code === 'retained-launcher-required');
  await assert.rejects(route({ ...base, action: 'hook' }), error => error.code === 'native-hook-required');
  await assert.rejects(route({ ...base, action: 'nonsense' }), error => error.code === 'retained-launcher-required');

  // prepare, setup and status are the cache-independent entries a first invocation uses:
  // they pass this guard and fail later on their own prerequisites, never on it.
  for (const action of ['prepare', 'setup']) {
    await assert.rejects(route({ ...base, action }), error => error.code !== 'retained-launcher-required');
  }

  // Status resolves a project like every admission path, so it validates one like them.
  const file = path.join(value.root, 'not-a-directory');
  fs.writeFileSync(file, 'x');
  await assert.rejects(route({ ...base, action: 'status', project: file }), error => error.code === 'invalid-release-project');
});

test('the current bootstrap routes an old binding by entry: Ready to administrative admission, dependent work and hooks to its bound release', async t => {
  const value = fixture(t);
  const first = packageCopy(value.root, '3.1.0');
  const second = packageCopy(value.root, '3.1.1');
  // The old release carries its historical router; the new one carries the repository's
  // current bootstrap, which is the code under test here.
  fs.copyFileSync(path.join(__dirname, 'fixtures/releases/bootstrap-3.1.0.cjs'), path.join(first, 'internal/releases/bootstrap.js'));
  for (const [source, version] of [[first, '3.1.0'], [second, '3.1.1']]) {
    fs.writeFileSync(path.join(source, 'internal/releases/launcher.js'), `module.exports.route = async () => process.stdout.write(JSON.stringify({ routedVersion: '${version}' }));\n`);
    refreshPackage(source);
  }
  const { service, state } = simulatedService(value, first, '3.1.0');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await service.resolve(setup.registration, { session: 'old', project: value.project, entry: 'ready' });
  state.source = second; state.version = '3.1.1';
  await service.prepare({ host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' });

  const bootstrap = service.registration(setup.registration).bootstrap;
  const request = path.join(value.project, 'request.json');
  const route = (payload, input) => {
    fs.writeFileSync(request, JSON.stringify(payload));
    const args = input === undefined ? [bootstrap, setup.registration, request] : [bootstrap, setup.registration, '--hook'];
    const result = spawnSync(process.execPath, args, { cwd: value.project, windowsHide: true, encoding: 'utf8', timeout: 30000, input });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  // The retained 3.1.0 session reaches current administrative admission for the read-only
  // view, on both actions the exception covers.
  assert.equal(route({ action: 'resolve', session: 'old', project: value.project, entry: 'ready' }).routedVersion, '3.1.1');
  assert.equal(route({ action: 'run', session: 'old', project: value.project, entry: 'ready' }).routedVersion, '3.1.1');

  // Everything else stays on the release that session is bound to.
  assert.equal(route({ action: 'resolve', session: 'old', project: value.project, entry: 'runtime' }).routedVersion, '3.1.0');
  assert.equal(route({ action: 'resolve', session: 'old', project: value.project }).routedVersion, '3.1.0');
  assert.equal(route({}, JSON.stringify({ session_id: 'old', cwd: value.project, hook_event_name: 'SessionStart' })).routedVersion, '3.1.0');
});

test('the native hook path inspects the operating project and falls back to its working directory', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  const seen = [];
  service.dependencies.inspectHooks = async (registration, cwd, options = {}) => {
    seen.push(inspectionContext(cwd, options));
    return { configured: true, disabled: false, usable: true, entries: [] };
  };

  await service.hook(setup.registration, { cwd: value.project, session_id: 'owner', hook_event_name: 'PreCompact' });
  assert.deepEqual(seen, [value.project]);

  // Claude scopes project settings to the working directory, so a directory with no
  // Nightshift project root above it is still inspected as itself, never as the profile.
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'nightshift-bare-'));
  t.after(() => fs.rmSync(bare, { recursive: true, force: true }));
  seen.length = 0;
  await service.hook(setup.registration, { cwd: bare, session_id: 'owner', hook_event_name: 'PreCompact' });
  assert.deepEqual(seen, [bare]);
});

test('preparation reports a bounded busy condition while a live owner holds the registration', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  service.registry(registry => {
    const registration = registry.get('registration', setup.registration);
    registry.put('registration', setup.registration, { ...registration, pending: { ...registration, ownerPid: process.pid, ownerToken: 'live-owner', remove: false, journal: null } });
  });
  // Pinned by preparation's own message: recovery has a sibling owner check that reports
  // the same code later, after native inspection has already been started.
  await assert.rejects(service.prepare({ host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' }), error => error.code === 'release-setup-busy' && /Another Nightshift preparation is still active/.test(error.message));
});

test('preparation refuses malformed and conflicting configuration before writing anything', async t => {
  const value = fixture(t);
  const { registrationKey } = require('../internal/releases/registry');
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const key = registrationKey('codex', fs.realpathSync.native(value.profile));
  const locatorFile = path.join(value.profile, 'nightshift-resources.json');
  const request = { host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' };
  let writes = 0;
  service.overrides.applyHooks = async () => { writes++; };
  const locator = extra => fs.writeFileSync(locatorFile, JSON.stringify({ schema: 1, store: value.store, registration: key, bootstrap: 'C:/store/launchers/hash/bootstrap.js', generation: 'generation', state: 'registered', ...extra }));
  const refused = async (attempt, code, pattern) => {
    await assert.rejects(attempt(), error => error.code === code && pattern.test(error.message), `${code}: ${pattern}`);
    assert.equal(writes, 0, 'a refused preparation never writes host configuration');
  };

  // A request naming a registration other than the one the launcher authenticated.
  await refused(() => service.prepare({ ...request, registration: 'b'.repeat(64) }), 'configuration-conflict', /different registration/);

  // Locator shapes that must be preserved for explicit recovery rather than overwritten.
  locator({ state: 'unrecognized' });
  await refused(() => service.prepare(request), 'configuration-conflict', /unrecognized state/);
  locator({ store: path.join(value.root, 'another-store') });
  await refused(() => service.prepare(request), 'configuration-conflict', /different installation/);
  locator({});
  await refused(() => service.prepare(request), 'configuration-conflict', /saved resources are missing/);
  assert.equal(fs.existsSync(path.join(value.store, 'registry.sqlite')), false, 'a conflicting locator never creates a store');

  // A registry that exists but records no registration for this locator.
  service.registry(() => {}, { create: true });
  await refused(() => service.prepare(request), 'configuration-conflict', /no matching saved registration/);
  fs.unlinkSync(locatorFile);

  // A registration whose recorded installation differs from the one requested.
  await service.setup({ host: 'codex', profile: value.profile });
  writes = 0;
  await refused(() => service.prepare({ ...request, pluginId: 'nightshift@another' }), 'configuration-conflict', /does not match the selected installation/);
});

test('preparation refuses a discovered release without administrative support before registering hooks', async t => {
  const value = fixture(t);
  const legacy = packageCopy(value.root, '3.1.0');
  fs.unlinkSync(path.join(legacy, 'internal/releases/administration.js'));
  const { payloadFiles, makeManifest, encodeManifest, MANIFEST_PATH } = require('../internal/releases/manifest');
  const files = payloadFiles(legacy).filter(file => file !== 'internal/releases/administration.js');
  fs.writeFileSync(path.join(legacy, MANIFEST_PATH), encodeManifest(makeManifest(files, file => fs.readFileSync(path.join(legacy, file)))));
  const { service } = simulatedService(value, legacy, '3.1.0');
  let writes = 0;
  service.overrides.applyHooks = async () => { writes++; };
  await assert.rejects(service.prepare({ host: 'codex', profile: value.profile, project: value.project, session: 'new', entry: 'ready' }), error => error.code === 'preparation-unavailable');
  assert.equal(writes, 0, 'an unsupported release is refused before any hook registration');
  assert.equal(fs.existsSync(path.join(value.profile, 'nightshift-resources.json')), false);
});
