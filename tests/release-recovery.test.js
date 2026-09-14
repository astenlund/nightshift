'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { activate, fixture, packageCopy, repository, simulatedService } = require('./release-fixtures');
const { readRun } = require('../internal/releases/service');
const { Registry } = require('../internal/releases/registry');
const bundles = require('../internal/releases/bundles');
const { processAlive } = require('../internal/releases/io');
const { RunStore } = require('../internal/runtime/store');

function holdFirstOperation(service, observeLater = async () => {}) {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let calls = 0;
  service.dependencies.runContained = async (executable, args, options) => {
    options.onPrepared?.({ runnerPid: process.pid });
    options.onStarted?.({ pid: process.pid, runnerPid: process.pid, contained: true });
    if (++calls === 1) { entered(); await held; }
    else await observeLater();
    const exit = { code: 0, stdout: '{}', stderr: '', descendantsReclaimed: true };
    options.onFinished?.(exit);
    return exit;
  };
  return { started, release };
}

test('retirement preserves a running run after interrupted registry attachment', async t => {
  const value = fixture(t);
  const first = packageCopy(value.root, '1.0.0');
  const second = packageCopy(value.root, '1.0.1');
  const { service, state } = simulatedService(value, first);
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const original = await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });

  const originalRunContained = service.dependencies.runContained;
  const originalReadRun = service.dependencies.readRun;
  let failNextRead = false;
  service.dependencies.runContained = async (...args) => {
    const exit = await originalRunContained(...args);
    assert.equal(exit.code, 0, exit.stderr);
    failNextRead = true;
    return exit;
  };
  service.dependencies.readRun = (...args) => {
    if (failNextRead) {
      failNextRead = false;
      throw new Error('injected post-child state read failure');
    }
    return originalReadRun(...args);
  };
  try {
    await assert.rejects(service.run(setup.registration, {
      session: 'owner', project: value.project, entry: 'runtime',
      request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] }
    }), /injected post-child state read failure/);
  } finally {
    service.dependencies.runContained = originalRunContained;
    service.dependencies.readRun = originalReadRun;
  }

  const savedRun = readRun(value.project);
  assert.equal(savedRun.status, 'running');
  const before = await service.status();
  const binding = before.sessions.find(item => item.session === 'owner');
  assert.ok(binding);

  state.source = second;
  state.version = '1.0.1';
  await activate(service, setup.registration, value.project, 'new-session');
  await service.resolve(setup.registration, { session: 'new-session', project: value.project, entry: 'ready' });

  let retirementError = null;
  try { service.retire(setup.registration, { targetSession: 'owner' }); }
  catch (error) { retirementError = error.code ?? error.message; }
  if (!retirementError) {
    service.collect();
  }
  const retained = fs.existsSync(original.bundle.root);
  assert.equal(binding.runs.length, 0);
  assert.equal(before.operations.length, 1);
  assert.ok(retirementError, 'Retirement must refuse an associated running run even when post-child attachment failed');
  assert.equal(retained, true, 'The running run must retain its exact resources');
});

test('collection retries after a partially successful filesystem deletion', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  await service.setup({ host: 'codex', profile: value.profile });
  const extras = [packageCopy(value.root, '1.0.1'), packageCopy(value.root, '1.0.2')];
  const registry = new Registry(value.store);
  try {
    for (const source of extras) registry.transaction(() => bundles.capture(registry, source));
  } finally { registry.close(); }

  const originalRemove = bundles.removeBundle;
  let removals = 0;
  let deletedKey = null;
  let firstError = null;
  bundles.removeBundle = (currentRegistry, key) => {
    removals++;
    if (removals === 2) throw Object.assign(new Error('injected transient deletion failure'), { code: 'EACCES' });
    const result = originalRemove(currentRegistry, key);
    deletedKey = key;
    return result;
  };
  try { service.collect(); }
  catch (error) { firstError = error.code ?? error.message; }
  finally { bundles.removeBundle = originalRemove; }
  assert.equal(firstError, 'EACCES', 'The injected failure must occur after one successful deletion');
  assert.ok(deletedKey);

  const afterFailure = await service.status();
  const restoredRecord = afterFailure.bundles.find(item => item.key === deletedKey);
  const recordPointsToMissingDirectory = !!restoredRecord && !fs.existsSync(restoredRecord.root);
  let retryError = null;
  try { service.collect(); }
  catch (error) { retryError = error.code ?? error.message; }
  assert.equal(removals, 2);
  assert.equal(recordPointsToMissingDirectory, true);
  assert.equal(retryError, null, 'Collection must reconcile its own partially persisted deletion and permit retry');
  assert.deepEqual(fs.readdirSync(path.join(value.store, 'deletions')), []);
});

test('provisional project references protect a running run omitted by older bookkeeping', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const created = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] } });
  assert.equal(created.code, 0, created.stderr);
  const original = await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  state.source = packageCopy(value.root, '1.0.1');
  state.version = '1.0.1';
  await activate(service, setup.registration, value.project, 'new-session');
  await service.resolve(setup.registration, { session: 'new-session', project: value.project, entry: 'ready' });
  const registry = new Registry(value.store);
  try {
    registry.transaction(current => {
      const entry = current.list('session').find(entry => entry.value.session === 'owner');
      entry.value.runs = [];
      entry.value.state = 'retired';
      current.put('session', entry.key, entry.value);
    });
  } finally { registry.close(); }
  service.collect();
  assert.equal(fs.existsSync(original.bundle.root), true);
  const saved = (await service.status()).sessions.find(entry => entry.session === 'owner');
  assert.equal(saved.runs[0].id, readRun(value.project).id);
  assert.equal(saved.runs[0].retired, false);
});

test('cleanup intent recovers a partial directory but arbitrary corruption is preserved', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  await service.setup({ host: 'codex', profile: value.profile });
  const source = packageCopy(value.root, '1.0.1');
  const registry = new Registry(value.store);
  let victim;
  try { victim = registry.transaction(() => bundles.capture(registry, source)); }
  finally { registry.close(); }
  const remove = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (target === victim.root) {
      fs.unlinkSync(path.join(target, '.codex-plugin/plugin.json'));
      throw Object.assign(new Error('interrupted recursive deletion'), { code: 'EACCES' });
    }
    return remove(target, options);
  };
  try { assert.throws(() => service.collect(), /interrupted recursive deletion/); }
  finally { fs.rmSync = remove; }
  assert.equal(service.collect().removed.includes(victim.key), true);
  assert.equal(fs.existsSync(victim.root), false);
  const current = new Registry(value.store);
  let damaged;
  try { damaged = current.transaction(() => bundles.capture(current, source)); }
  finally { current.close(); }
  fs.appendFileSync(path.join(damaged.root, 'skills/ready/ready.js'), 'damaged');
  assert.throws(() => service.collect(), /failed verification/);
  assert.equal(fs.existsSync(damaged.root), true);
});

for (const host of ['codex', 'claude']) test('bundled notices follow a usable custom store for ' + host, async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host, profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const created = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] } });
  assert.equal(created.code, 0, created.stderr);
  const { handleNotice } = require('../internal/releases/notice');
  const dependencies = { profile: value.profile, createService: store => { assert.equal(store, value.store); return service; } };
  const input = { cwd: value.project, session_id: 'owner', hook_event_name: 'SessionStart' };
  assert.deepEqual(await handleNotice(input, host, dependencies), {});
  state.trusted = false;
  assert.match((await handleNotice(input, host, dependencies)).systemMessage, /activation is unavailable/);
  assert.deepEqual(await handleNotice({ ...input, session_id: 'unrelated' }, host, dependencies), {});
});

for (const legacy of [false, true]) test('missing post-launch run state keeps its lease with legacy=' + legacy, async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const original = await service.resolve(setup.registration, { session: 'owner', project: value.project });
  const file = path.join(value.project, '.nightshift/runs/state.sqlite');
  const parked = path.join(value.root, 'parked-state.sqlite');
  const execute = service.dependencies.runContained;
  service.dependencies.runContained = async (...args) => {
    const result = await execute(...args);
    assert.equal(result.code, 0, result.stderr);
    fs.renameSync(file, parked);
    return result;
  };
  try {
    await assert.rejects(service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] } }), /Expected run database is unavailable/);
    const deadPid = 2147483647;
    assert.equal(processAlive(deadPid), false);
    const registry = new Registry(value.store);
    try {
      registry.transaction(current => {
        const operation = current.list('operation').find(entry => entry.value.kind === 'entry');
        assert.equal(operation.value.runtimeAction, 'create');
        Object.assign(operation.value, { pid: deadPid, runnerPid: deadPid, childPid: deadPid });
        if (legacy) delete operation.value.runtimeAction;
        current.put('operation', operation.key, operation.value);
      });
    } finally { registry.close(); }
    assert.throws(() => service.collect(), /Expected run database is unavailable/);
    assert.throws(() => service.retire(setup.registration, { targetSession: 'owner' }), /Expected run database is unavailable/);
    assert.equal((await service.status()).operations.length, 1);
    assert.equal(fs.existsSync(original.bundle.root), true);
  } finally {
    service.dependencies.runContained = execute;
    if (fs.existsSync(parked)) fs.renameSync(parked, file);
  }
  service.collect();
  const recovered = await service.status();
  assert.equal(recovered.operations.length, 0);
  assert.equal(recovered.sessions.find(entry => entry.session === 'owner').runs[0].id, readRun(value.project).id);
  assert.throws(() => service.retire(setup.registration, { targetSession: 'owner' }), /Stop and explicitly select/);
});

test('Ready-only project retirement does not require a nonexistent run database', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  assert.equal((await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'ready' })).code, 0);
  assert.equal(fs.existsSync(path.join(value.project, '.nightshift/runs/state.sqlite')), false);
  assert.equal(service.retire(setup.registration, { targetSession: 'owner' }).retired, 'owner');
});

test('development verification is explicit and genuine bound helpers still inherit context', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const created = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] } });
  assert.equal(created.code, 0, created.stderr);
  fs.writeFileSync(path.join(value.project, 'subject.txt'), 'Stable check input\n');
  const resultFile = path.join(value.root, 'development-result.json');
  const child = path.join(repository, 'tests/fixtures/releases/development-check.cjs');
  const checked = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'check', taskId: 'work', revision: readRun(value.project).revision, check: { name: 'Development fixture', executable: process.execPath, args: [child, repository, path.join(value.root, 'development-project'), resultFile], paths: ['subject.txt'], resourceMode: 'development' } } });
  assert.equal(checked.code, 0, checked.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(resultFile, 'utf8')), { inheritedBinding: false, executionMode: 'development', failure: null });
  assert.equal(readRun(value.project).tasks[0].checks.at(-1).passed, true);
  const bound = await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  const inherited = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'check', taskId: 'work', revision: readRun(value.project).revision, check: { name: 'Bound ready helper', executable: process.execPath, args: [path.join(bound.bundle.root, 'skills/ready/ready.js'), value.project], paths: ['subject.txt'] } } });
  assert.equal(inherited.code, 0, inherited.stderr);
  const recorded = readRun(value.project).tasks[0].checks.at(-1);
  assert.equal(recorded.resourceMode, 'inherit');
  assert.equal(recorded.passed, true, recorded.output);
});

test('private probes isolate controller bindings and preserve the parent environment', t => {
  const value = fixture(t);
  fs.writeFileSync(path.join(value.project, 'subject.txt'), 'Probe input\n');
  const { runProbe } = require('../internal/runtime/probes');
  const { snapshot } = require('../internal/runtime/evidence');
  const { randomUUID } = require('node:crypto');
  const { CONTEXT_ENV, MODE_ENV, WORKER_ENV } = require('../internal/releases/entry');
  const keys = [CONTEXT_ENV, MODE_ENV, WORKER_ENV];
  const saved = new Map(keys.map(key => [key, process.env[key]]));
  process.env[CONTEXT_ENV] = 'controller-capability';
  process.env[MODE_ENV] = 'bound';
  process.env[WORKER_ENV] = 'worker-reference';
  try {
    const receipt = { requestId: randomUUID(), runId: 'fixture', taskId: 'work', snapshot: snapshot(value.project, ['subject.txt']) };
    const reference = runProbe(value.project, receipt, { id: 'environment', purpose: 'Observe private verification environment', executable: process.execPath, args: ['probe.cjs'], files: [{ path: 'probe.cjs', content: "console.log(JSON.stringify({ context: process.env.NIGHTSHIFT_RESOURCE_CONTEXT ?? null, mode: process.env.NIGHTSHIFT_EXECUTION_MODE ?? null, worker: process.env.NIGHTSHIFT_WORKER_BINDING ?? null }));" }] });
    const result = JSON.parse(fs.readFileSync(path.join(value.project, reference.path), 'utf8'));
    assert.equal(result.resourceMode, 'development');
    assert.equal(result.exitCode, 0, result.output);
    assert.deepEqual(JSON.parse(result.output), { context: null, mode: 'development', worker: null });
    assert.equal(process.env[CONTEXT_ENV], 'controller-capability');
    assert.equal(process.env[MODE_ENV], 'bound');
  } finally {
    for (const key of keys) {
      if (saved.get(key) === undefined) delete process.env[key];
      else process.env[key] = saved.get(key);
    }
  }
});

test('configuration written before registration commit can be reconciled on setup retry', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  service.overrides.applyHooks = async (plan, profile, remove, record) => {
    record({ type: 'codex', marker: 'written-before-commit' });
    throw new Error('after configuration write');
  };
  await assert.rejects(service.setup({ host: 'codex', profile: value.profile }), /after configuration write/);
  const pending = (await service.status()).registrations[0];
  assert.equal(pending.state, 'preparing');
  assert.equal(pending.pending.journal.marker, 'written-before-commit');
  await assert.rejects(service.resolve(pending.key, { session: 'owner', project: value.project }), /Complete host setup/);
  let recovered = false;
  service.overrides.reconcileCodexJournal = async registration => { assert.equal(registration.pending.journal.marker, 'written-before-commit'); recovered = true; return 'written'; };
  service.overrides.applyHooks = async () => {};
  const result = await service.setup({ host: 'codex', profile: value.profile });
  assert.equal(recovered, true);
  assert.equal((await service.status()).registrations[0].state, 'registered');
  assert.equal(JSON.parse(fs.readFileSync(result.locator, 'utf8')).state, 'registered');
});

test('a failed locator publication preserves registration and is repaired by setup retry', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const publish = service.publishLocator;
  service.publishLocator = () => { throw new Error('locator unavailable'); };
  await assert.rejects(service.setup({ host: 'codex', profile: value.profile }), /locator unavailable/);
  assert.equal((await service.status()).registrations[0].state, 'registered');
  assert.equal(fs.existsSync(path.join(value.profile, 'nightshift-resources.json')), false);
  service.publishLocator = publish;
  const result = await service.setup({ host: 'codex', profile: value.profile });
  assert.equal(JSON.parse(fs.readFileSync(result.locator, 'utf8')).registration, result.registration);
});

for (const retry of ['remove', 'setup']) test('interrupted removal invalidates old activation when recovered through ' + retry, async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  const apply = service.dependencies.applyHooks;
  service.dependencies.applyHooks = async (plan, profile, remove, record) => {
    assert.equal(remove, true);
    record({ type: 'codex', marker: 'removed-before-commit' });
    throw new Error('after hook removal');
  };
  await assert.rejects(service.remove(setup.registration), /after hook removal/);
  service.dependencies.applyHooks = apply;
  service.overrides.reconcileCodexJournal = async registration => { assert.equal(registration.pending.remove, true); return 'written'; };
  if (retry === 'remove') await service.remove(setup.registration);
  else await service.setup({ host: 'codex', profile: value.profile });
  assert.equal((await service.status()).activations.length, 0, 'A removed generation cannot preserve its old native activation');
  if (retry === 'setup') await assert.rejects(service.resolve(setup.registration, { session: 'owner', project: value.project }), /has not observed/);
});

test('removing an absent profile also retires its activation records', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  assert.equal(path.dirname(fs.realpathSync.native(value.profile)), value.root);
  fs.rmSync(value.profile, { recursive: true });
  const result = await service.remove(setup.registration);
  assert.equal(result.profileAbsent, true);
  assert.equal((await service.status()).activations.length, 0);
});

test('new-session creation selects the current release after a completed run', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'previous');
  const original = await service.resolve(setup.registration, { session: 'previous', project: value.project, entry: 'ready' });
  service.dependencies.readRun = () => ({ id: 'completed-run', controller: { session: 'previous' }, status: 'complete', workers: [], resources: { identity: original.binding.identity } });
  state.source = packageCopy(value.root, '1.0.1');
  state.version = '1.0.1';
  await activate(service, setup.registration, value.project, 'next');
  const next = await service.resolve(setup.registration, { session: 'next', project: value.project, entry: 'ready' });
  assert.notEqual(next.binding.identity, original.binding.identity);
  const created = await service.resolve(setup.registration, { session: 'next', project: value.project, entry: 'runtime', request: { action: 'create' } });
  assert.equal(created.binding.identity, next.binding.identity);
  assert.deepEqual(created.binding.runs, []);
});

test('bound runtime observations remain admitted while a dispatch holds its lease', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  const held = holdFirstOperation(service);
  const dispatch = service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'dispatch' } });
  await held.started;
  try {
    for (const action of ['status', 'inspect', 'history', 'wait']) {
      const result = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action } });
      assert.equal(result.code, 0);
    }
    await assert.rejects(service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'advance' } }), error => error.code === 'resource-operation-busy');
  } finally { held.release(); await dispatch; }
});

test('new-run selection preserves live ownership, explicit run identity and session pinning', async t => {
  for (const scenario of [
    { name: 'fresh creation after completion', status: 'complete', session: 'next', changed: true },
    { name: 'fresh creation after stop', status: 'stopped', session: 'next', changed: true },
    { name: 'same-session creation after completion', status: 'complete', session: 'previous', changed: false },
    { name: 'running owner remains pinned', status: 'running', session: 'next', changed: false },
    { name: 'uncertain stopped worker remains pinned', status: 'stopped', session: 'next', workers: [{ status: 'unverified' }], changed: false },
    { name: 'unrecognized stopped worker remains pinned', status: 'stopped', session: 'next', workers: [{ status: 'future-status' }], changed: false },
    { name: 'missing stopped worker status remains pinned', status: 'stopped', session: 'next', workers: [{}], changed: false },
    { name: 'explicit completed run remains pinned', status: 'complete', session: 'next', runId: 'previous-run', changed: false }
  ]) {
    await t.test(scenario.name, async t => {
      const value = fixture(t);
      const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
      const setup = await service.setup({ host: 'codex', profile: value.profile });
      await activate(service, setup.registration, value.project, 'previous');
      const original = await service.resolve(setup.registration, { session: 'previous', project: value.project, entry: 'ready' });
      service.dependencies.readRun = () => ({ id: 'previous-run', controller: { session: 'previous' }, status: scenario.status, workers: scenario.workers ?? [], resources: { identity: original.binding.identity } });
      state.source = packageCopy(value.root, '1.0.1');
      state.version = '1.0.1';
      await activate(service, setup.registration, value.project, scenario.session);
      const selected = await service.resolve(setup.registration, { session: scenario.session, project: value.project, entry: 'runtime', runId: scenario.runId, request: { action: 'create' } });
      assert.equal(selected.binding.identity !== original.binding.identity, scenario.changed);
    });
  }
});

test('a waiting observer does not prevent a later writer and both retain leases', async t => {
  const value = fixture(t);
  const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'owner');
  await service.resolve(setup.registration, { session: 'owner', project: value.project, entry: 'ready' });
  const held = holdFirstOperation(service, async () => {
    const operations = (await service.status()).operations;
    assert.equal(operations.length, 2);
    assert.ok(operations.every(operation => operation.bundle));
  });
  const wait = service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'wait' } });
  await held.started;
  try {
    const mutation = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'advance' } });
    assert.equal(mutation.code, 0);
  } finally { held.release(); await wait; }
  assert.deepEqual((await service.status()).operations, []);
});

test('bound creation after a stopped run saves the new release without changing history', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'previous');
  const create = { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] };
  const first = await service.run(setup.registration, { session: 'previous', project: value.project, entry: 'runtime', request: create });
  assert.equal(first.code, 0, first.stderr);
  const original = readRun(value.project);
  const stopped = await service.run(setup.registration, { session: 'previous', project: value.project, entry: 'runtime', request: { action: 'stop', kind: 'user-stop', reason: 'fixture completed its scope', revision: original.revision } });
  assert.equal(stopped.code, 0, stopped.stderr);
  state.source = packageCopy(value.root, '1.0.1');
  state.version = '1.0.1';
  await activate(service, setup.registration, value.project, 'next');
  const next = await service.resolve(setup.registration, { session: 'next', project: value.project, entry: 'ready' });
  const second = await service.run(setup.registration, { session: 'next', project: value.project, entry: 'runtime', request: create });
  assert.equal(second.code, 0, second.stderr);
  const current = readRun(value.project);
  assert.notEqual(current.id, original.id);
  assert.equal(current.resources.identity, next.binding.identity);
  assert.notEqual(current.resources.identity, original.resources.identity);
  assert.deepEqual(readRun(value.project, original.id).resources, original.resources);
});

test('uncertain saved worker statuses retain session and run resources', async t => {
  for (const worker of [{ id: 'unknown', status: 'future-status' }, { id: 'missing' }]) {
    await t.test(worker.id, async t => {
      const value = fixture(t);
      const { service } = simulatedService(value, packageCopy(value.root, '1.0.0'));
      const setup = await service.setup({ host: 'codex', profile: value.profile });
      await activate(service, setup.registration, value.project, 'owner');
      const created = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] } });
      assert.equal(created.code, 0, created.stderr);
      const run = readRun(value.project);
      const store = new RunStore(value.project);
      try { store.update(run.controller, run.revision, 'fixture-uncertain-worker', state => { state.status = 'stopped'; state.workers = [worker]; }); }
      finally { store.close(); }
      assert.throws(() => service.retire(setup.registration, { targetSession: 'owner', retireRuns: [run.id] }), error => error.code === 'run-resource-state-unavailable');
      const binding = (await service.status()).sessions.find(entry => entry.session === 'owner');
      assert.equal(binding.state, 'bound');
      assert.equal(binding.runs.find(reference => reference.id === run.id).retired, false);
    });
  }
});

test('collection protects unreconciled workers discovered under a retired session', async t => {
  const value = fixture(t);
  const { service, state } = simulatedService(value, packageCopy(value.root, '1.0.0'));
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, setup.registration, value.project, 'previous');
  const created = await service.run(setup.registration, { session: 'previous', project: value.project, entry: 'runtime', request: { action: 'create', objective: 'fixture', authority: 'test', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'test', outcome: 'fixture' } }] } });
  assert.equal(created.code, 0, created.stderr);
  const run = readRun(value.project);
  const original = (await service.status()).bundles.find(bundle => bundle.identity === run.resources.identity);
  const store = new RunStore(value.project);
  try { store.update(run.controller, run.revision, 'fixture-uncertain-worker', current => { current.status = 'complete'; current.workers = [{ id: 'worker', status: 'future-status' }]; }); }
  finally { store.close(); }
  state.source = packageCopy(value.root, '1.0.1');
  state.version = '1.0.1';
  await activate(service, setup.registration, value.project, 'next');
  await service.resolve(setup.registration, { session: 'next', project: value.project, entry: 'ready' });
  const registry = new Registry(value.store);
  try {
    registry.transaction(current => {
      const entry = current.list('session').find(entry => entry.value.session === 'previous');
      entry.value.state = 'retired';
      entry.value.runs = [];
      current.put('session', entry.key, entry.value);
    });
  } finally { registry.close(); }
  const collected = service.collect();
  assert.ok(collected.retained.includes(original.key));
  assert.ok(fs.existsSync(original.root));
  const reconciled = (await service.status()).sessions.find(entry => entry.session === 'previous');
  assert.equal(reconciled.runs.find(reference => reference.id === run.id).retired, false);
});
