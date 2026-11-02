'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { activate, fixture, packageCopy, simulatedService } = require('./release-fixtures');
const { sessionKey } = require('../internal/releases/registry');
const { readRun } = require('../internal/releases/service');

const agreement = { source: 'Fixture user', outcome: 'Leave work unfinished before an upgrade' };

function handoverRequest() {
  return { action: 'handover', handoverId: randomUUID(), authority: 'Explicit fixture handover', objective: 'Leave work unfinished', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture goal' }, tasks: [{ id: 'work', title: 'Work', agreement }] };
}

// Rewrites one saved delivery state in place, the way a record looks after the runtime's close action wrote it.
function rewriteRun(project, id, change) {
  const database = new DatabaseSync(path.join(project, '.nightshift/runs/state.sqlite'));
  try {
    const row = database.prepare('SELECT state FROM runs WHERE id=?').get(id);
    const state = JSON.parse(row.state);
    change(state);
    database.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), id);
  } finally { database.close(); }
}

function close(state) {
  state.closure = { authority: 'Fixture user approved closing', reason: 'Fixture obligations dropped', manifestHash: 'a'.repeat(64), approval: null, reconciledWorkers: [], previousStatus: state.status, previousRevision: state.revision, recordedAt: new Date().toISOString(), actor: { host: 'codex', session: 'owner' } };
  state.status = 'closed';
}

// A stopped delivery with an incomplete task, made on 3.3.10 by session `owner`, followed by an installed 3.3.11.
async function stoppedThenUpgraded(t) {
  const value = fixture(t);
  const { service, state: native } = simulatedService(value, packageCopy(value.root, '3.3.10'), '3.3.10');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  const call = async request => {
    const result = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request });
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  let run = await call(handoverRequest());
  run = await call({ action: 'hold', revision: run.revision, authority: 'Fixture user hold', reason: 'Pause before the upgrade' });
  assert.equal(run.status, 'stopped');
  assert.ok(readRun(value.project).tasks.some(task => task.status !== 'complete'));
  const owner = (await service.status()).sessions.find(session => session.session === 'owner');
  native.source = packageCopy(value.root, '3.3.11');
  native.version = '3.3.11';
  await service.setup({ host: 'codex', profile: value.profile });
  return { value, service, registration: setup.registration, run, oldBundle: owner.bundle, oldIdentity: owner.identity };
}

for (const variant of ['bound to an older release', 'without retained resources']) {
  test(`a closed current selection ${variant} admits a current-bound session's handover`, async t => {
    const { value, service, registration, run, oldIdentity } = await stoppedThenUpgraded(t);
    await activate(service, registration, value.project, 'fresh');
    const ready = await service.resolve(registration, { session: 'fresh', project: value.project, entry: 'ready' });
    assert.notEqual(ready.bundle.identity, oldIdentity);
    rewriteRun(value.project, run.id, state => {
      close(state);
      if (variant === 'without retained resources') { delete state.executionResources; delete state.resources; delete state.resourceMode; }
    });
    const admitted = await service.resolve(registration, { session: 'fresh', project: value.project, entry: 'runtime', request: handoverRequest() });
    assert.equal(admitted.bundle.identity, ready.bundle.identity);
  });
}

for (const status of ['closed', 'stopped']) {
  test(`collection ${status === 'closed' ? 'drops' : 'keeps'} a bundle whose only reference is a ${status} record`, async t => {
    const { value, service, registration, run, oldBundle } = await stoppedThenUpgraded(t);
    service.retire(registration, { targetSession: 'owner', retireRuns: [run.id] });
    // A retired binding regains an unretired reference when collection reconciles a run it owns but no longer lists, as after an
    // interruption between project admission and run attachment; only the record's own status then decides retention.
    service.registry(registry => {
      const key = sessionKey(registration, 'owner');
      const binding = registry.get('session', key);
      binding.runs = binding.runs.filter(reference => reference.id !== run.id);
      registry.put('session', key, binding);
    });
    if (status === 'closed') rewriteRun(value.project, run.id, close);
    const collected = service.collect();
    const owner = (await service.status()).sessions.find(session => session.session === 'owner');
    assert.deepEqual(owner.runs.map(reference => [reference.id, reference.retired]), [[run.id, false]]);
    if (status === 'closed') {
      assert.ok(collected.removed.includes(oldBundle));
    } else {
      assert.ok(collected.retained.includes(oldBundle));
    }
  });
}
