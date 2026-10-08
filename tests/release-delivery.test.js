'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { activate, fixture, packageCopy, refreshPackage, simulatedService } = require('./release-fixtures');
const { ReviewStore } = require('../internal/runtime/review-store');
const { referenceId, readReviewReference, readReviewStore } = require('../internal/runtime/review-inventory');
const { readRun, readRunStore } = require('../internal/releases/service');
const { completeReflection } = require('./fixtures/completion');
const { acceptsRuntimeAction } = require('../internal/releases/admission');
const { classifyHooks } = require('../internal/releases/host-config');

for (const operation of ['prepare', 'resolve']) {
  test(`resource-only ${operation} preserves delivery, review and default selection`, async t => {
    const value = fixture(t);
    const source = packageCopy(value.root, '3.3.10');
    const { service } = simulatedService(value, source, '3.3.10');
    const { registration } = await service.setup({ host: 'codex', profile: value.profile });
    const base = { host: 'codex', profile: value.profile, session: 'owner', project: value.project, entry: 'runtime' };
    const create = async request => {
      const result = await service.run(registration, { ...base, request });
      assert.equal(result.code, 0, result.stderr);
      return JSON.parse(result.stdout);
    };
    const delivery = await create({ action: 'handover', handoverId: randomUUID(), authority: 'Explicit fixture handover', objective: 'Select retained resources', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture goal' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'Fixture user', outcome: 'Preserve selection and admission' } }] });
    const review = await create({ action: 'open-review', reviewContextId: randomUUID(), kind: 'spec', authority: 'Explicit fixture revision', objective: 'Assess separately', agreement: { source: 'Fixture user', outcome: 'Preserve independent context' } });
    const invoke = request => operation === 'prepare' ? service.prepare(request) : service.resolve(registration, request);
    const state = () => ({ delivery: readRun(value.project), reviews: readReviewStore(value.project) });
    for (const selector of [{ runId: delivery.id }, { runId: referenceId(review) }, {}]) {
      const control = await invoke({ ...base, ...selector, request: { action: 'status' } });
      const before = state();
      const selected = await invoke({ ...base, ...selector });
      assert.equal(selected.identity ?? selected.bundle.identity, control.identity ?? control.bundle.identity);
      assert.deepEqual(state(), before);
      await assert.rejects(service.run(registration, { ...base, ...selector }), { code: 'invalid-runtime-request' });
      await assert.rejects(service.run(registration, { ...base, ...selector, request: {} }), { code: 'invalid-runtime-request' });
      assert.deepEqual(state(), before);
    }
    const before = state();
    for (const request of [null, [], 'status', undefined]) await assert.rejects(invoke({ ...base, runId: delivery.id, request }), { code: 'invalid-runtime-request' });
    for (const runId of [null, '', undefined, 'not-a-record']) await assert.rejects(invoke({ ...base, runId }), { code: 'resource-run-conflict' });
    await assert.rejects(invoke({ ...base, runId: delivery.id, request: { action: 'status', reviewContextId: review.id } }), { code: 'resource-run-conflict' });
    assert.deepEqual(state(), before);
  });
}

test('retained acceptance replay cannot mutate an adopted delivery', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.10');
  const { service } = simulatedService(value, source, '3.3.10');
  const { registration } = await service.setup({ host:'codex',profile:value.profile });
  const invoke = (session, request) => service.run(registration,{session,project:value.project,entry:'runtime',request});
  const accepted = async (session,request) => {const result=await invoke(session,request);assert.equal(result.code,0,result.stderr);return JSON.parse(result.stdout);};
  const request={action:'handover',handoverId:randomUUID(),authority:'Explicit fixture handover',objective:'Preserve ownership',mechanism:{verified:true,kind:'goal',evidence:'Simulated fixture observation'},tasks:[{id:'work',title:'Work',agreement:{source:'User',outcome:'Protect delivery duties'}}]};
  const original=await accepted('original',request);
  const held=await accepted('original',{action:'hold',revision:original.revision,authority:'User hold',reason:'Prepare transfer'});
  await accepted('successor',{action:'adopt',runId:original.id,revision:held.revision,previousController:{host:'codex',session:'original'},authority:'User authorized transfer'});
  const before=readRun(value.project);
  await assert.rejects(invoke('original',request),error=>error.code==='resource-owner-mismatch');
  assert.deepEqual(readRun(value.project),before);
});

test('retained creation and envelope targets preserve delivery and review domains', async t => {
  const value=fixture(t);
  const source=packageCopy(value.root,'3.3.10');
  const {service}=simulatedService(value,source,'3.3.10');
  const {registration}=await service.setup({host:'codex',profile:value.profile});
  const invoke=request=>service.run(registration,{session:'owner',project:value.project,entry:'runtime',...request});
  const contextId=randomUUID();
  const opened=await invoke({request:{action:'open-review',reviewContextId:contextId,kind:'spec',authority:'Explicit revision',objective:'Assess spec',agreement:{source:'User',outcome:'Review independently'}}});
  assert.equal(opened.code,0,opened.stderr);
  const before=readRun(value.project,'review:'+contextId);
  const handover={action:'handover',authority:'Explicit handover',objective:'Deliver safely',tasks:[{id:'work',title:'Work',agreement:{source:'User',outcome:'Preserve obligations'}}]};
  await assert.rejects(invoke({request:{...handover,reviewContextId:randomUUID()}}),error=>error.code==='invalid-runtime-target');
  assert.equal(readRun(value.project),null);
  assert.deepEqual(readRun(value.project,'review:'+contextId),before);
  for(const runId of [null,'',undefined]) await assert.rejects(invoke({runId,request:{action:'status'}}),error=>error.code==='resource-run-conflict');
  const selected=await invoke({runId:'review:'+contextId,request:{action:'status'}});
  assert.equal(selected.code,0,selected.stderr);
  assert.equal(JSON.parse(selected.stdout).id,contextId);
  await assert.rejects(invoke({runId:'review:'+randomUUID(),request:{action:'status',reviewContextId:contextId}}),error=>error.code==='resource-run-conflict');
  assert.deepEqual(readRun(value.project,'review:'+contextId),before);
});

for (const domain of ['review', 'delivery']) {
  for (const loss of ['database', 'row']) {
    test(`missing known ${domain} ${loss} cannot discharge retained writer ownership`, async t => {
      const value = fixture(t);
      const source = packageCopy(value.root, '3.3.10');
      const { service } = simulatedService(value, source, '3.3.10');
      const setup = await service.setup({ host: 'codex', profile: value.profile });
      const contextId = randomUUID();
      const request = domain === 'review'
        ? { action: 'open-review', reviewContextId: contextId, kind: 'code', authority: 'Explicit revision', objective: 'Own a component', agreement: { source: 'fixture user', outcome: 'Preserve writer ownership' } }
        : { action: 'handover', authority: 'Explicit handover', objective: 'Own a component', mechanism: { verified: true, kind: 'goal', evidence: 'Fixture goal active' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Preserve writer ownership' } }] };
      const run = async (session, request) => {
        const exit = await service.run(setup.registration, { session, project: value.project, entry: 'runtime', request });
        assert.equal(exit.code, 0, exit.stderr);
        return JSON.parse(exit.stdout);
      };
      const original = await run('original', request);
      await run('original', { action: 'worker', ...(domain === 'review' ? { reviewContextId: contextId } : {}), revision: original.revision, worker: { id: 'writer', session: 'writer-session', role: 'implementer', assignment: 'Own shared component', writes: ['shared.js'] } });
      const file = path.join(value.project, '.nightshift/runs', domain === 'review' ? 'review-state.sqlite' : 'state.sqlite');
      if (loss === 'database') fs.renameSync(file, file + '.preserved');
      else {
        fs.copyFileSync(file, file + '.preserved');
        const database = new DatabaseSync(file);
        try { database.exec('PRAGMA foreign_keys=OFF'); database.prepare('DELETE FROM runs WHERE id=?').run(original.id); } finally { database.close(); }
      }
      await assert.rejects(service.run(setup.registration, { session: 'other', project: value.project, entry: 'runtime', request: { action: 'handover', authority: 'Another explicit handover', objective: 'Own the same component', tasks: [{ id: 'other', title: 'Other', agreement: { source: 'fixture user', outcome: 'Preserve ownership' } }] } }), { code: 'run-resource-state-unavailable' });
      const reference = (await service.status()).sessions.find(binding => binding.session === 'original').runs.find(reference => reference.id === (domain === 'review' ? 'review:' + contextId : original.id));
      assert.equal(reference.retired, false);
      assert.ok(fs.existsSync(file + '.preserved'));
    });
  }
}

for (const loss of ['database', 'row', 'corrupt', 'unsupported']) {
  test(`unavailable sibling review ${loss} preserves hold, stop and Ready admission`, async t => {
    const value = fixture(t);
    const source = packageCopy(value.root, '3.3.10');
    const { service } = simulatedService(value, source, '3.3.10');
    const setup = await service.setup({ host: 'codex', profile: value.profile });
    await activate(service, setup.registration, value.project, 'delivery');
    const call = async (session, request, entry = 'runtime') => {
      const exit = await service.run(setup.registration, { session, project: value.project, entry, ...(request ? { request } : {}) });
      assert.equal(exit.code, 0, exit.stderr);
      return JSON.parse(exit.stdout);
    };
    const delivery = await call('delivery', { action: 'handover', authority: 'Explicit handover', objective: 'Honor user suspension', mechanism: { verified: true, kind: 'goal', evidence: 'Fixture goal active' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Preserve authority' } }] });
    const contextId = randomUUID();
    await call('review', { action: 'open-review', reviewContextId: contextId, kind: 'spec', authority: 'Explicit standalone revision', objective: 'Assess the separate subject', agreement: { source: 'fixture user', outcome: 'Preserve independent evidence' } });
    await call('reader', null, 'ready');
    const file = path.join(value.project, '.nightshift/runs/review-state.sqlite');
    if (loss === 'database') fs.renameSync(file, file + '.preserved');
    else if (loss === 'corrupt') {
      fs.copyFileSync(file, file + '.preserved');
      fs.writeFileSync(file, 'Unreadable private fixture database.\r\n');
    } else {
      fs.copyFileSync(file, file + '.preserved');
      const database = new DatabaseSync(file);
      try {
        if (loss === 'row') {
          database.exec('PRAGMA foreign_keys=OFF');
          database.prepare('DELETE FROM runs WHERE id=?').run(contextId);
        } else {
          const state = JSON.parse(database.prepare('SELECT state FROM runs WHERE id=?').get(contextId).state);
          state.kind = 'unsupported-fixture-kind';
          database.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), contextId);
        }
      } finally { database.close(); }
    }
    const held = await call('delivery', { action: 'hold', revision: delivery.revision, authority: 'User explicitly paused', reason: 'Reconcile sibling state safely' });
    assert.equal(held.status, 'stopped');
    const stopped = await call('delivery', { action: 'stop', revision: held.revision, kind: 'user-stop', reason: 'User explicitly stopped' });
    assert.equal(stopped.status, 'stopped');
    assert.equal(stopped.id, delivery.id);
    await call('reader', null, 'ready');
    const collectionCode = loss === 'corrupt' ? 'ERR_SQLITE_ERROR' : loss === 'unsupported' ? 'review-resource-state-unavailable' : 'run-resource-state-unavailable';
    assert.throws(() => service.collect(), { code: collectionCode });
    const protection = (await service.status()).sessions.find(session => session.session === 'review').runs.find(reference => reference.id === 'review:' + contextId);
    assert.equal(protection.retired, false);
  });
}

for (const sibling of ['delivery', 'review']) {
  test(`selected review suspension ignores an unsupported sibling ${sibling}`, async t => {
    const value = fixture(t);
    const source = packageCopy(value.root, '3.3.10');
    const { service } = simulatedService(value, source, '3.3.10');
    const setup = await service.setup({ host: 'codex', profile: value.profile });
    const call = async (session, request, entry = 'runtime') => {
      const exit = await service.run(setup.registration, { session, project: value.project, entry, ...(request ? { request } : {}) });
      assert.equal(exit.code, 0, exit.stderr);
      return JSON.parse(exit.stdout);
    };
    const targetId = randomUUID();
    const target = await call('target', { action: 'open-review', reviewContextId: targetId, kind: 'spec', authority: 'Explicit standalone revision', objective: 'Preserve selected suspension', agreement: { source: 'fixture user', outcome: 'Suspend the intact selected record' } });
    const unrelated = sibling === 'delivery'
      ? await call('sibling', { action: 'handover', authority: 'Explicit fixture handover', objective: 'Separate delivery', tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Preserve separate obligations' } }] })
      : await call('sibling', { action: 'open-review', reviewContextId: randomUUID(), kind: 'spec', authority: 'Explicit separate revision', objective: 'Separate subject', agreement: { source: 'fixture user', outcome: 'Preserve separate obligations' } });
    const file = path.join(value.project, '.nightshift/runs', sibling === 'delivery' ? 'state.sqlite' : 'review-state.sqlite');
    const database = new DatabaseSync(file);
    try {
      const state = JSON.parse(database.prepare('SELECT state FROM runs WHERE id=?').get(unrelated.id).state);
      state.kind = 'unsupported-fixture-kind';
      database.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), unrelated.id);
    } finally { database.close(); }
    const held = await call('target', { action: 'hold', reviewContextId: targetId, revision: target.revision, authority: 'User paused selected revision', reason: 'Reconcile sibling state independently' });
    assert.equal(held.status, 'stopped');
    const stopped = await call('target', { action: 'stop', reviewContextId: targetId, revision: held.revision, kind: 'user-stop', reason: 'User stopped selected revision' });
    assert.equal(stopped.id, targetId);
    assert.equal(stopped.status, 'stopped');
    await call('new-reader', null, 'ready');
    assert.throws(() => service.collect(), { code: sibling === 'delivery' ? 'run-resource-state-unavailable' : 'review-resource-state-unavailable' });
    const protection = (await service.status()).sessions.find(session => session.session === 'sibling').runs.find(reference => reference.id === (sibling === 'delivery' ? unrelated.id : 'review:' + unrelated.id));
    assert.equal(protection.retired, false);
  });
}

test('runtime admission tolerates disabled hooks while leaving plugin enablement authoritative', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.10');
  const { service, state } = simulatedService(value, source, '3.3.10');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  state.disabled = true;
  state.trusted = false;
  const request = { session: 'controller', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } };
  const resolved = await service.resolve(setup.registration, request);
  assert.equal(resolved.integration.usable, false);
  assert.equal(resolved.integration.state, 'disabled');
  assert.match(resolved.integration.cause, /hook integration is unavailable, but authorized work may continue/);
  assert.doesNotMatch(resolved.integration.cause, /enable them explicitly before using Nightshift/);
  assert.equal(state.disabled, true);
  assert.equal(state.trusted, false);
  state.enabled = false;
  await assert.rejects(service.resolve(setup.registration, request), { code: 'installation-unavailable' });
});

for (const host of ['claude', 'codex']) {
  for (const condition of [
    { state: 'disabled', native: { disabled: true, configured: true, usable: false }, cause: 'Nightshift hooks are disabled', recovery: /enable them explicitly before using Nightshift/ },
    { state: 'unconfigured', native: { disabled: false, configured: false, usable: false }, cause: 'Nightshift hooks were removed or changed', recovery: /reconcile them explicitly before using Nightshift/ },
    { state: 'untrusted', native: { disabled: false, configured: true, usable: false }, cause: 'Nightshift hooks are not trusted on this host', recovery: /restore native trust and reopen the session/ },
  ]) {
    test(`${host} ${condition.state} diagnostics distinguish optional continuation from mandatory admission`, async t => {
      const value = fixture(t);
      const source = packageCopy(value.root, '3.3.10');
      const { service } = simulatedService(value, source, '3.3.10');
      const setup = await service.setup({ host, profile: value.profile });
      service.dependencies.inspectHooks = async () => ({ ...condition.native, entries: [] });
      const resolved = await service.resolve(setup.registration, { session: 'controller', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } });
      assert.equal(resolved.integration.usable, false);
      assert.equal(resolved.integration.state, condition.state);
      assert.ok(resolved.integration.cause.startsWith(condition.cause + ';'));
      assert.match(resolved.integration.cause, /authorized work may continue in this active turn under valid ownership and operation permissions/);
      assert.match(resolved.integration.cause, /hook integration is unavailable/);
      assert.doesNotMatch(resolved.integration.cause, /automatic continuation is unavailable/);
      assert.doesNotMatch(resolved.integration.cause, condition.recovery);
      const mandatory = classifyHooks(condition.native);
      assert.equal(mandatory.state, condition.state);
      assert.match(mandatory.message, condition.recovery);
    });
  }
}

test('a hook inspection failure is reported as unavailable rather than denying new runtime work', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.10');
  const { service } = simulatedService(value, source, '3.3.10');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  service.dependencies.inspectHooks = async () => { throw new Error('Native hook inspection failed'); };
  const resolved = await service.resolve(setup.registration, { session: 'controller', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } });
  assert.deepEqual(resolved.integration, { usable: false, state: 'unavailable', cause: 'Native hook inspection failed' });
});

test('a retained old runtime keeps its own action surface and activation requirements', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.9');
  const runtime = path.join(source, 'internal/runtime/cli.js');
  fs.writeFileSync(runtime, "module.exports = { ADOPTION_PROTOCOL: 1 };\n");
  fs.writeFileSync(path.join(source, 'internal/runtime/actions.js'), "module.exports = { isRuntimeAction: action => ['create', 'status'].includes(action) };\n");
  refreshPackage(source);
  const { service } = simulatedService(value, source, '3.3.9');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  const resolved = await service.resolve(setup.registration, { session: 'controller', project: value.project, entry: 'ready' });
  assert.equal(acceptsRuntimeAction(resolved.bundle, 'create'), true);
  assert.equal(acceptsRuntimeAction(resolved.bundle, 'open-review'), false);
  await assert.rejects(service.resolve(setup.registration, { session: 'controller', project: value.project, entry: 'runtime', request: { action: 'create' } }), { code: 'hook-activation-required' });
});

test('review references select separate state and cannot collide with a delivery UUID', t => {
  const value = fixture(t);
  const contextId = randomUUID();
  const store = new ReviewStore(value.project, { create: true, contextId });
  try {
    const context = store.create({ controller: { host: 'codex', session: 'owner' }, authority: 'Explicit revise request', objective: 'Assess a subject', tasks: [{ id: '#review', title: 'Subject', kind: 'spec', agreement: { source: 'user', outcome: 'Assess the subject' } }] });
    const reference = referenceId(context);
    assert.equal(reference, `review:${contextId}`);
    assert.notEqual(reference, contextId);
    assert.equal(readRun(value.project, reference).id, contextId);
    assert.equal(readRun(value.project), null);
    assert.equal(readReviewStore(value.project).length, 1);
  } finally { store.close(); }
});

test('bound standalone review creation protects its exact payload and refuses unsafe retirement', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.10');
  const { service } = simulatedService(value, source, '3.3.10');
  const setup = await service.setup({ host: 'codex', profile: value.profile });
  const contextId = randomUUID();
  const envelope = { session: 'review-owner', project: value.project, entry: 'runtime', request: { action: 'open-review', reviewContextId: contextId, kind: 'spec', authority: 'Explicit revise-spec', objective: 'Assess a subject', agreement: { source: 'user', outcome: 'Assess the subject' } } };
  const exit = await service.run(setup.registration, envelope);
  assert.equal(exit.code, 0, exit.stderr);
  const context = JSON.parse(exit.stdout);
  assert.equal(context.kind, 'review');
  const saved = await service.status();
  const owner = saved.sessions.find(session => session.session === 'review-owner');
  assert.ok(owner.runs.some(reference => reference.id === `review:${contextId}`));
  assert.equal(fs.existsSync(path.join(value.project, '.nightshift/runs/state.sqlite')), false);
  assert.throws(() => service.retire(setup.registration, { targetSession: 'review-owner' }), { code: 'run-retirement-required' });
  assert.ok(service.collect().retained.includes(owner.bundle));
  const inspected = await service.run(setup.registration, { ...envelope, request: { action: 'inspect', reviewContextId: contextId } });
  assert.equal(inspected.code, 0, inspected.stderr);
  assert.equal(JSON.parse(inspected.stdout).id, contextId);
});

test('runtime preparation preserves deliberately disabled hooks for new continuation-optional delivery', async t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '3.3.10');
  const { service, state } = simulatedService(value, source, '3.3.10');
  await service.setup({ host: 'codex', profile: value.profile });
  state.disabled = true;
  const prepared = await service.prepare({ host: 'codex', profile: value.profile, session: 'controller', project: value.project, entry: 'runtime', request: { action: 'handover', tasks: [] } });
  assert.equal(prepared.state, 'prepared');
  assert.equal(state.disabled, true);
});

for (const host of ['claude', 'codex']) {
  test(`${host} admission reconciles a later hook failure without revoking delivery`, async t => {
    const value = fixture(t);
    const source = packageCopy(value.root, '3.3.10');
    const { service, state: native } = simulatedService(value, source, '3.3.10');
    const setup = await service.setup({ host, profile: value.profile });
    await activate(service, setup.registration, value.project, 'owner');
    const run = async request => {
      const exit = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request });
      assert.equal(exit.code, 0, exit.stderr);
      return JSON.parse(exit.stdout);
    };
    const acceptingRequest = { action: 'handover', handoverId: randomUUID(), authority: 'Explicit fixture handover', objective: 'Observe continuation', mechanism: { verified: true, kind: host === 'claude' ? 'stop-hook' : 'goal', evidence: 'Deterministic host observation' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Preserve observed health and failures' } }] };
    const accepted = await run(acceptingRequest);
    native.disabled = true;
    const claimed = await run({ action: 'claim-controller', revision: accepted.revision });
    const state = await run({ action: 'inspect' });
    assert.equal(state.hookIntegration.verified, false);
    assert.equal(state.continuation.verified, host === 'codex');
    assert.equal(state.followups.length, 1);
    assert.equal(state.followups[0].continuationFailure.runId, state.id);
    const started = await run({ action: 'start-task', revision: claimed.revision, taskId: 'work' });
    assert.equal(started.status, 'running');
    assert.equal(started.followups.length, 1);
    assert.equal(started.followups[0].continuationFailure.occurrences, 2);
    const repeated = await run(acceptingRequest);
    assert.equal(repeated.id, accepted.id);
    assert.equal(repeated.continuation.verified, host === 'codex');
    assert.equal(repeated.followups.length, 1);
    assert.equal(repeated.followups[0].continuationFailure.occurrences, 3);
  });
}

for (const host of ['claude', 'codex']) {
  for (const action of ['continuation', 'handover']) {
    test(`${host} ${action} preserves freshly unusable hooks over an earlier success`, async t => {
      const value = fixture(t);
      const source = packageCopy(value.root, '3.3.10');
      const { service, state: native } = simulatedService(value, source, '3.3.10');
      const setup = await service.setup({ host, profile: value.profile });
      await activate(service, setup.registration, value.project, 'owner');
      const call = async request => {
        const exit = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request });
        assert.equal(exit.code, 0, exit.stderr);
        return JSON.parse(exit.stdout);
      };
      const mechanism = { verified: true, kind: host === 'claude' ? 'stop-hook' : 'goal', evidence: 'Observed before hooks became unusable' };
      const accepted = await call({ action: 'handover', handoverId: randomUUID(), authority: 'Explicit fixture handover', objective: 'Preserve current integration truth', mechanism, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Report current continuation truthfully' } }] });
      native.disabled = true;
      const refreshed = await call({ action, revision: accepted.revision, mechanism, ...(action === 'handover' ? { authority: 'User renews existing handover' } : {}) });
      const state = await call({ action: 'inspect' });
      assert.equal(state.hookIntegration.verified, false);
      assert.equal(state.continuation.verified, host === 'codex');
      assert.equal(refreshed.acceptanceCheckpoint.observedContinuation, host === 'codex' ? 'available' : 'failed');
      assert.equal(state.followups.length, 1);
      assert.equal(state.followups[0].continuationFailure.occurrences, 1);
      assert.equal(state.acknowledgement.requiredAfter, host === 'claude' ? state.continuation.observedAt : accepted.continuation.observedAt);
    });
  }
}

for (const host of ['claude', 'codex']) {
  test(`${host} retains distinct continuation failures alongside unusable hooks`, async t => {
    const value = fixture(t);
    const source = packageCopy(value.root, '3.3.10');
    const { service, state: native } = simulatedService(value, source, '3.3.10');
    const setup = await service.setup({ host, profile: value.profile });
    await activate(service, setup.registration, value.project, 'owner');
    const call = async request => {
      const exit = await service.run(setup.registration, { session: 'owner', project: value.project, entry: 'runtime', request });
      assert.equal(exit.code, 0, exit.stderr);
      return JSON.parse(exit.stdout);
    };
    const kind = host === 'claude' ? 'stop-hook' : 'goal';
    let current = await call({ action: 'handover', handoverId: randomUUID(), authority: 'Explicit fixture handover', objective: 'Preserve every failure episode', mechanism: { verified: true, kind, evidence: 'Fixture mechanism initially active' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'fixture user', outcome: 'Preserve distinct failure causes' } }] });
    native.disabled = true;
    const mechanism = { verified: false, kind, operation: 'native-observation', reason: 'A distinct fixture transport timeout' };
    for (let index = 0; index < 2; index++) current = await call({ action: 'continuation', revision: current.revision, mechanism });
    const state = await call({ action: 'inspect' });
    assert.equal(state.followups.length, 2);
    for (const item of state.followups) assert.equal(item.continuationFailure.occurrences, 2);
    assert.ok(state.followups.some(item => item.continuationFailure.operation === mechanism.operation && item.context === mechanism.reason));
    assert.equal(state.continuation.operation, host === 'claude' ? 'hook-admission' : 'native-observation');
    native.disabled = false;
    const recovered = await call({ action: 'continuation', revision: current.revision, mechanism: { verified: true, kind, evidence: 'Fixture mechanism observed after recovery' } });
    assert.equal(recovered.continuation.verified, true);
    assert.equal(recovered.followups.length, 2);
  });
}

// A completed delivery or standalone revision whose database then holds an unsupported format, under a retained release that a
// newer release replaces, with the version change made before or after the owning session's retirement.
for (const kind of ['review', 'delivery']) {
  for (const [version, retireFirst] of [[2, false], [99, false], [99, true]]) {
    test(`${kind} database version ${version} ${retireFirst ? 'after retirement' : 'before retirement'} governs payload release`, async t => {
      const value = fixture(t);
      const { service, state: native } = simulatedService(value, packageCopy(value.root, '3.3.10'), '3.3.10');
      const setup = await service.setup({ host: 'codex', profile: value.profile });
      const session = 'format-owner';
      const call = async request => {
        const result = await service.run(setup.registration, { session, project: value.project, entry: 'runtime', request });
        assert.equal(result.code, 0, result.stderr);
        return JSON.parse(result.stdout);
      };
      const agreement = { source: 'Fixture user', outcome: 'Reflect without instruction proposals' };
      let current;
      if (kind === 'review') {
        current = await call({ action: 'open-review', reviewContextId: randomUUID(), kind: 'lore', authority: 'Explicit fixture reflection', objective: 'Reflect without proposals', agreement });
        current = await call({ action: 'advance', reviewContextId: current.id, revision: current.revision, evidence: 'Reflection found no worthwhile proposal' });
        current = await call({ action: 'complete', reviewContextId: current.id, revision: current.revision });
      } else {
        await call({ action: 'handover', handoverId: randomUUID(), authority: 'Explicit fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture goal' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement }] });
        current = await completeReflection(value.project, { host: 'codex', session }, (_root, request) => call(request));
      }
      assert.equal(current.status, 'complete');
      const status = await service.status();
      const bundle = status.sessions.find(item => item.session === session).bundle;
      const payload = status.bundles.find(item => item.key === bundle).root;
      native.source = packageCopy(value.root, '3.3.11');
      native.version = '3.3.11';
      await service.setup({ host: 'codex', profile: value.profile });
      if (retireFirst) service.retire(setup.registration, { targetSession: session });
      const file = path.join(value.project, '.nightshift/runs', kind === 'review' ? 'review-state.sqlite' : 'state.sqlite');
      const database = new DatabaseSync(file);
      try { database.exec(`PRAGMA user_version=${version}`); } finally { database.close(); }
      if (version === 2) {
        assert.equal(readRunStore(value.project).length, 1);
        service.retire(setup.registration, { targetSession: session });
        assert.equal(service.collect().removed.includes(bundle), true);
        assert.equal(fs.existsSync(payload), false);
        return;
      }
      const code = kind === 'review' ? 'review-resource-state-unavailable' : 'run-resource-state-unavailable';
      const bytes = fs.readFileSync(file);
      const protection = () => JSON.stringify(service.registry(registry => registry.list('session')));
      const beforeProtection = protection();
      assert.throws(() => readRunStore(value.project), { code });
      assert.throws(() => readRun(value.project, kind === 'review' ? referenceId({ kind, id: current.id }) : undefined), { code });
      if (kind === 'review') assert.throws(() => readReviewReference(value.project, referenceId({ kind, id: current.id })), { code });
      if (!retireFirst) assert.throws(() => service.retire(setup.registration, { targetSession: session }), { code });
      assert.throws(() => service.collect(), { code });
      assert.equal(protection(), beforeProtection);
      assert.deepEqual(fs.readFileSync(file), bytes);
      assert.equal(fs.existsSync(payload), true);
    });
  }
}
