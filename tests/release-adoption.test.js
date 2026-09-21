'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { executionResources, savedResources, validateContext, CONTEXT_ENV } = require('../internal/releases/entry');
const { sessionKey } = require('../internal/releases/registry');
const { readRun } = require('../internal/releases/service');
const { ownsRun } = require('../internal/releases/bootstrap');
const { activate, fixture, packageCopy, refreshPackage, simulatedService } = require('./release-fixtures');

async function setupCase(t, host = 'codex', compatible = true) {
  const value = fixture(t);
  const source = packageCopy(value.root, '1.0.0');
  if (!compatible) {
    fs.appendFileSync(path.join(source, 'internal/runtime/cli.js'), '\nmodule.exports.ADOPTION_PROTOCOL = undefined;\n');
    refreshPackage(source);
  }
  const { service, state } = simulatedService(value, source);
  const original = await service.setup({ host: 'codex', profile: value.profile });
  await activate(service, original.registration, value.project, 'original');
  const selected = await service.resolve(original.registration, { session: 'original', project: value.project, entry: 'ready' });
  const resources = savedResources({ store: service.store, registration: original.registration, session: 'original', identity: selected.bundle.identity });
  const store = new RunStore(value.project, { create: true });
  let run;
  try {
    run = store.create({ controller: { host: 'codex', session: 'original' }, resources, resourceMode: 'bound', objective: 'Adoption fixture', authority: 'fixture authority', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture', outcome: 'Preserve work' } }] });
    run = store.update(run.controller, run.revision, 'stop', current => { current.status = 'stopped'; current.stop = { reason: 'fixture stop' }; });
  } finally { store.close(); }
  service.registry(registry => service.reconcileRunReferences(registry, registry.get('session', sessionKey(original.registration, 'original'))));
  let target = original;
  if (host === 'claude') {
    const profile = path.join(value.root, 'claude-profile');
    fs.mkdirSync(profile);
    target = await service.setup({ host, profile });
  }
  await activate(service, target.registration, value.project, 'target');
  const request = { session: 'target', project: value.project, entry: 'runtime', request: { action: 'adopt', runId: run.id, revision: run.revision, previousController: run.controller, authority: 'Resume this run in the target session' } };
  let launches = 0;
  service.dependencies.runContained = async (executable, args, options) => {
    launches++;
    options.onPrepared({ runnerPid: process.pid });
    options.onStarted({ pid: process.pid, runnerPid: process.pid, contained: true });
    const context = JSON.parse(options.env[CONTEXT_ENV]);
    if (readRun(value.project).controller.session === 'original') {
      const protectedTarget = service.registry(registry => registry.get('session', sessionKey(context.registration, context.session)));
      assert.equal(protectedTarget.runs.find(reference => reference.id === run.id).pendingAdoption, true);
    }
    validateContext(context, path.resolve(args[0], '../../..'), value.project, true);
    const runtimeRequest = JSON.parse(fs.readFileSync(args[2], 'utf8'));
    const result = await require('../internal/runtime/cli').execute(value.project, runtimeRequest, { resourceContext: context });
    const exit = { code: 0, stdout: JSON.stringify(result), stderr: '', descendantsReclaimed: true };
    options.onFinished(exit);
    return exit;
  };
  return { ...value, service, state, original, target, selected, run, request, launches: () => launches };
}

function binding(value, registration, session) {
  return value.service.registry(registry => registry.get('session', sessionKey(registration, session)));
}

function changeRun(value, change) {
  const store = new RunStore(value.project);
  try {
    const run = store.read();
    return store.update(run.controller, run.revision, 'fixture', change);
  } finally { store.close(); }
}

async function rejectedPendingAdoption(value) {
  const execute = value.service.dependencies.runContained;
  value.service.dependencies.runContained = async (executable, args, options) => {
    try { return await execute(executable, args, options); }
    catch (error) {
      const exit = { code: 1, stdout: '', stderr: JSON.stringify({ error: error.code, message: error.message }), descendantsReclaimed: true };
      options.onFinished(exit);
      return exit;
    }
  };
  try {
    const exit = await value.service.run(value.target.registration, { ...value.request, request: { ...value.request.request, revision: value.request.request.revision - 1 } });
    assert.equal(exit.code, 1);
    assert.equal(JSON.parse(exit.stderr).error, 'stale-adoption');
    assert.equal(binding(value, value.target.registration, 'target').runs[0].pendingAdoption, true);
    assert.deepEqual(value.service.registry(registry => registry.list('operation')), []);
  } finally { value.service.dependencies.runContained = execute; }
}

test('execution resources retain the historical fallback without treating explicit null as absent', () => {
  const original = { schema: 1, session: 'original' };
  const target = { schema: 1, session: 'target' };
  assert.equal(executionResources({ resources: original }), original);
  assert.equal(executionResources({ resources: original, executionResources: target }), target);
  assert.equal(executionResources({ resources: original, executionResources: null }), null);
});

for (const host of ['codex', 'claude']) test(`retained adoption to ${host} protects target before transfer and preserves source provenance`, async t => {
  const value = await setupCase(t, host);
  const exit = await value.service.run(value.target.registration, value.request);
  assert.equal(exit.code, 0);
  const run = readRun(value.project);
  assert.deepEqual(run.resources, value.run.resources);
  assert.equal(run.executionResources.session, 'target');
  assert.equal(run.controller.host, host);
  assert.equal(run.status, 'stopped');
  assert.equal(binding(value, value.target.registration, 'target').runs[0].pendingAdoption, undefined);
  assert.equal(binding(value, value.original.registration, 'original').runs[0].historical, true);
  assert.equal(value.launches(), 1);
  const retried = await value.service.run(value.target.registration, value.request);
  assert.equal(JSON.parse(retried.stdout).revision, run.revision);
  assert.equal(readRun(value.project).adoptions.length, 1);
  await assert.rejects(value.service.run(value.original.registration, { session: 'original', project: value.project, entry: 'runtime', request: { action: 'stop', runId: run.id, revision: run.revision } }), error => error.code === 'resource-owner-mismatch');
  const diagnostic = await value.service.run(value.original.registration, { session: 'original', project: value.project, entry: 'runtime', request: { action: 'inspect', runId: run.id } });
  assert.equal(JSON.parse(diagnostic.stdout).controller.session, 'target');
  value.service.retire(value.original.registration, { targetSession: 'original' });
  assert.equal(binding(value, value.original.registration, 'original').state, 'retired');
  value.service.collect();
  assert.ok(fs.existsSync(value.selected.bundle.root));
});

test('adoption requires native activation and honors deliberate hook disablement before binding', async t => {
  const value = await setupCase(t);
  value.service.registry(registry => registry.remove('activation', sessionKey(value.target.registration, 'target')));
  await assert.rejects(value.service.run(value.target.registration, value.request), error => error.code === 'hook-activation-required');
  assert.equal(binding(value, value.target.registration, 'target'), null);
  await activate(value.service, value.target.registration, value.project, 'target');
  value.state.disabled = true;
  await assert.rejects(value.service.run(value.target.registration, value.request), error => error.code === 'nightshift-disabled');
  assert.equal(readRun(value.project).controller.session, 'original');
  assert.equal(value.launches(), 0);
});

test('an older exact release cannot be silently replaced by an adoption-capable release', async t => {
  const value = await setupCase(t, 'codex', false);
  await assert.rejects(value.service.run(value.target.registration, value.request), error => error.code === 'adoption-release-incompatible');
  assert.equal(binding(value, value.target.registration, 'target'), null);
  assert.equal(readRun(value.project).controller.session, 'original');
  assert.equal(value.launches(), 0);
});

test('adoption refuses a different retained store without changing ownership or target references', async t => {
  const value = await setupCase(t);
  const store = new RunStore(value.project);
  try { store.update(value.run.controller, value.run.revision, 'fixture', run => { run.executionResources.store = value.root; }); }
  finally { store.close(); }
  await assert.rejects(value.service.run(value.target.registration, value.request), error => error.code === 'adoption-resource-conflict');
  assert.equal(binding(value, value.target.registration, 'target'), null);
  assert.equal(readRun(value.project).controller.session, 'original');
});

test('a differently bound target cannot silently switch to the run exact release', async t => {
  const value = await setupCase(t);
  value.state.source = packageCopy(value.root, '1.0.1');
  value.state.version = '1.0.1';
  const selected = await value.service.resolve(value.target.registration, { session: 'target', project: value.project, entry: 'ready' });
  assert.notEqual(selected.bundle.identity, value.selected.bundle.identity);
  await assert.rejects(value.service.run(value.target.registration, value.request), error => error.code === 'run-release-conflict');
  assert.equal(binding(value, value.target.registration, 'target').runs.length, 0);
  assert.equal(readRun(value.project).controller.session, 'original');
  assert.equal(value.launches(), 0);
});

test('retired source resources require explicit recovery before adoption', async t => {
  const value = await setupCase(t);
  value.service.retire(value.original.registration, { targetSession: 'original', retireRuns: [value.run.id] });
  await assert.rejects(value.service.run(value.target.registration, value.request), error => error.code === 'adoption-source-retired');
  assert.equal(binding(value, value.target.registration, 'target'), null);
  assert.equal(readRun(value.project).controller.session, 'original');
});

test('adoption admission prevents source retirement while ownership has not committed', async t => {
  const value = await setupCase(t);
  const execute = value.service.dependencies.runContained;
  value.service.dependencies.runContained = async (...args) => {
    assert.throws(() => value.service.retire(value.original.registration, { targetSession: 'original', retireRuns: [value.run.id] }), error => error.code === 'resource-operation-busy');
    return execute(...args);
  };
  await value.service.run(value.target.registration, value.request);
  value.service.retire(value.original.registration, { targetSession: 'original' });
  assert.equal(binding(value, value.original.registration, 'original').state, 'retired');
});

test('bound current resources reject explicit null, partial, empty and noncanonical values', async t => {
  const value = await setupCase(t);
  for (const resources of [null, {}, { ...value.run.resources, schema: 2 }, { ...value.run.resources, session: '' }, { ...value.run.resources, registration: '' }, { ...value.run.resources, identity: '' }, { ...value.run.resources, store: value.service.store + path.sep + '.' }]) {
    assert.throws(() => executionResources({ ...value.run, executionResources: resources }), error => error.code === 'invalid-execution-resources');
  }
  const historical = { ...value.run };
  delete historical.executionResources;
  assert.deepEqual(executionResources(historical), value.run.resources);
});

test('a precommit interruption leaves original ownership and a protected retryable target', async t => {
  const value = await setupCase(t);
  const execute = value.service.dependencies.runContained;
  value.service.dependencies.runContained = async () => { throw new Error('fixture before child launch'); };
  await assert.rejects(value.service.run(value.target.registration, value.request), /fixture before child launch/);
  assert.equal(readRun(value.project).controller.session, 'original');
  assert.equal(binding(value, value.target.registration, 'target').runs[0].pendingAdoption, true);
  assert.throws(() => value.service.retire(value.target.registration, { targetSession: 'target' }), error => error.code === 'resource-operation-busy');
  value.service.registry(registry => {
    for (const { key, value: operation } of registry.list('operation')) {
      operation.pid = 2147483647;
      operation.phase = 'prepared';
      registry.put('operation', key, operation);
    }
  });
  value.service.dependencies.runContained = execute;
  await value.service.run(value.target.registration, value.request);
  assert.equal(readRun(value.project).adoptions.length, 1);
});

test('entry admission refuses adoption without the protected target reference', async t => {
  const value = await setupCase(t);
  const execute = value.service.dependencies.runContained;
  value.service.dependencies.runContained = async (executable, args, options) => {
    const context = JSON.parse(options.env[CONTEXT_ENV]);
    value.service.registry(registry => {
      const target = registry.get('session', sessionKey(context.registration, context.session));
      target.runs = [];
      registry.put('session', sessionKey(context.registration, context.session), target);
    });
    assert.throws(() => validateContext(context, path.resolve(args[0], '../../..'), value.project, true), error => error.code === 'adoption-reference-required');
    throw new Error('fixture protected reference removed');
  };
  await assert.rejects(value.service.run(value.target.registration, value.request), /fixture protected reference removed/);
  assert.equal(readRun(value.project).controller.session, 'original');
  value.service.dependencies.runContained = execute;
});

test('interrupted postcommit attachment reconciles from saved adoption before retrying', async t => {
  const value = await setupCase(t);
  const execute = value.service.dependencies.runContained;
  let interrupt = true;
  value.service.dependencies.runContained = async (...args) => {
    const exit = await execute(...args);
    if (interrupt) {
      interrupt = false;
      value.service.dependencies.readRun = () => { throw new Error('fixture attachment interruption'); };
    }
    return exit;
  };
  await assert.rejects(value.service.run(value.target.registration, value.request), /fixture attachment interruption/);
  assert.equal(readRun(value.project).controller.session, 'target');
  assert.equal(binding(value, value.target.registration, 'target').runs[0].pendingAdoption, true);
  assert.notEqual(binding(value, value.original.registration, 'original').runs[0].historical, true);
  value.service.dependencies.readRun = readRun;
  value.service.registry(registry => {
    for (const { key, value: operation } of registry.list('operation')) {
      operation.pid = 2147483647;
      operation.runnerPid = 2147483647;
      operation.childPid = 2147483647;
      registry.put('operation', key, operation);
    }
  });
  await value.service.run(value.target.registration, value.request);
  assert.equal(readRun(value.project).adoptions.length, 1);
  assert.equal(binding(value, value.target.registration, 'target').runs[0].pendingAdoption, undefined);
  assert.equal(binding(value, value.original.registration, 'original').runs[0].historical, true);
  assert.deepEqual(value.service.registry(registry => registry.list('operation')), []);
});

test('missing adopted target reference blocks retirement and collection, including historical sources', async t => {
  const value = await setupCase(t);
  await value.service.run(value.target.registration, value.request);
  value.service.registry(registry => {
    const target = registry.get('session', sessionKey(value.target.registration, 'target'));
    target.runs = [];
    registry.put('session', sessionKey(value.target.registration, 'target'), target);
  });
  assert.throws(() => value.service.retire(value.original.registration, { targetSession: 'original' }), error => error.code === 'adoption-reference-unavailable');
  assert.throws(() => value.service.collect(), error => error.code === 'adoption-reference-unavailable');
  await assert.rejects(value.service.run(value.target.registration, value.request), error => error.code === 'adoption-reference-unavailable');
  assert.ok(fs.existsSync(value.selected.bundle.root));
});

test('bootstrap recovery identifies current execution registration rather than historical provenance', async t => {
  const value = await setupCase(t, 'claude');
  await value.service.run(value.target.registration, value.request);
  const store = new RunStore(value.project);
  try {
    const run = store.read();
    store.update(run.controller, run.revision, 'fixture', current => { current.status = 'running'; });
  } finally { store.close(); }
  const input = { cwd: value.project, session_id: 'target' };
  assert.equal(ownsRun(input, value.target.registration, value.service.store), true);
  assert.equal(ownsRun(input, value.original.registration, value.service.store), false);
  assert.equal(ownsRun({ ...input, session_id: 'original' }, value.original.registration, value.service.store), false);
});

test('failed pending target can retire after the source completes and retires', async t => {
  const value = await setupCase(t);
  await rejectedPendingAdoption(value);
  changeRun(value, run => { run.status = 'complete'; });
  value.service.retire(value.original.registration, { targetSession: 'original' });
  const before = readRun(value.project);
  assert.throws(() => value.service.retire(value.target.registration, { targetSession: 'target' }), error => error.code === 'adoption-cancellation-required' && /cancelAdoptions/.test(error.message));
  const retired = value.service.retire(value.target.registration, { targetSession: 'target', cancelAdoptions: [value.run.id] });
  assert.deepEqual(retired.cancelledAdoptions, [value.run.id]);
  assert.equal(binding(value, value.target.registration, 'target').state, 'retired');
  assert.deepEqual(binding(value, value.target.registration, 'target').runs, []);
  assert.deepEqual(readRun(value.project), before);
  value.service.collect();
});

test('pending adoption cancellation validates its selection without releasing references', async t => {
  const value = await setupCase(t);
  await rejectedPendingAdoption(value);
  for (const cancelAdoptions of [null, value.run.id, ['', value.run.id], [value.run.id, value.run.id]]) {
    assert.throws(() => value.service.retire(value.target.registration, { targetSession: 'target', cancelAdoptions }), error => error.code === 'invalid-adoption-cancellation');
  }
  assert.equal(binding(value, value.target.registration, 'target').runs[0].pendingAdoption, true);
});

test('recovery of a retired failed target does not revive its cancelled run reference', async t => {
  const value = await setupCase(t);
  await rejectedPendingAdoption(value);
  value.service.retire(value.target.registration, { targetSession: 'target', cancelAdoptions: [value.run.id] });
  await value.service.recover(value.target.registration, { targetSession: 'target' });
  value.service.collect();
  assert.equal(binding(value, value.target.registration, 'target').state, 'bound');
  assert.deepEqual(binding(value, value.target.registration, 'target').runs, []);
  assert.equal(readRun(value.project).controller.session, 'original');
  value.service.retire(value.target.registration, { targetSession: 'target' });
});

test('a losing target can cancel only its unowned proposal after another adopter wins', async t => {
  const value = await setupCase(t);
  await rejectedPendingAdoption(value);
  await activate(value.service, value.target.registration, value.project, 'winner');
  await value.service.run(value.target.registration, { ...value.request, session: 'winner' });
  const before = readRun(value.project);
  assert.equal(before.controller.session, 'winner');
  value.service.retire(value.target.registration, { targetSession: 'target', cancelAdoptions: [value.run.id] });
  assert.deepEqual(readRun(value.project), before);
  assert.equal(binding(value, value.target.registration, 'winner').runs[0].retired, false);
  assert.equal(binding(value, value.original.registration, 'original').runs[0].historical, true);
  await value.service.recover(value.target.registration, { targetSession: 'target' });
  assert.deepEqual(binding(value, value.target.registration, 'target').runs, []);
});

for (const state of ['active', 'uncertain']) test(`pending cancellation refuses ${state} project operations`, async t => {
  const value = await setupCase(t);
  await rejectedPendingAdoption(value);
  value.service.registry(registry => registry.put('operation', randomUUID(), { schema: 1, kind: 'entry', state: 'running', pid: state === 'active' ? process.pid : 2147483647, phase: 'launching', registration: value.original.registration, session: 'original', project: value.project, bundle: value.selected.bundle.key, runtimeAction: 'adopt' }));
  assert.throws(() => value.service.retire(value.target.registration, { targetSession: 'target', cancelAdoptions: [value.run.id] }), error => error.code === 'resource-operation-busy');
  assert.equal(binding(value, value.target.registration, 'target').state, 'bound');
  assert.equal(binding(value, value.target.registration, 'target').runs[0].pendingAdoption, true);
});

test('pending cancellation refuses unknown workers and missing ownership history', async t => {
  const value = await setupCase(t);
  await rejectedPendingAdoption(value);
  changeRun(value, run => { run.workers.push({ id: 'unknown-worker', status: 'unverified' }); });
  const request = { targetSession: 'target', cancelAdoptions: [value.run.id] };
  assert.throws(() => value.service.retire(value.target.registration, request), error => error.code === 'run-resource-state-unavailable');
  changeRun(value, run => { run.workers = []; run.adoption = { revision: run.revision }; });
  assert.throws(() => value.service.retire(value.target.registration, request), error => error.code === 'run-resource-state-unavailable');
  assert.equal(binding(value, value.target.registration, 'target').runs[0].pendingAdoption, true);
});

test('cancellation cannot remove a committed or historical target reference', async t => {
  const value = await setupCase(t);
  await value.service.run(value.target.registration, value.request);
  const request = { targetSession: 'target', cancelAdoptions: [value.run.id] };
  assert.throws(() => value.service.retire(value.target.registration, request), error => error.code === 'adoption-cancellation-unavailable');
  assert.equal(binding(value, value.target.registration, 'target').runs[0].retired, false);
  await activate(value.service, value.target.registration, value.project, 'winner');
  const owned = readRun(value.project);
  await value.service.run(value.target.registration, { ...value.request, session: 'winner', request: { ...value.request.request, revision: owned.revision, previousController: owned.controller } });
  assert.equal(binding(value, value.target.registration, 'target').runs[0].historical, true);
  assert.throws(() => value.service.retire(value.target.registration, request), error => error.code === 'adoption-cancellation-unavailable');
  assert.equal(binding(value, value.target.registration, 'target').runs[0].historical, true);
  assert.equal(readRun(value.project).controller.session, 'winner');
});
