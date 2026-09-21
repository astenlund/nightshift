'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { execute } = require('../internal/runtime/cli');
const { RunStore } = require('../internal/runtime/store');
const { workerTermination } = require('../internal/runtime/ownership');
const { reservedOperation } = require('../internal/runtime/operations');

const scratch = path.resolve(__dirname, '../.tmp/adoption-tests');
const source = { host: 'codex', session: 'original-owner' };
const target = { host: 'claude', session: 'adopting-owner' };
const originalProcess = { pid: 4101, created: '100', name: 'codex.exe' };
const targetProcess = { pid: 4102, created: '200', name: 'claude.exe' };

async function fixture(t, overrides = {}) {
  fs.mkdirSync(scratch, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratch, 'case-'));
  let store;
  t.after(() => { store?.close(); assert.equal(path.dirname(root), scratch); fs.rmSync(root, { recursive: true, force: true }); });
  const live = new Set([originalProcess.pid, targetProcess.pid]);
  const dependencies = { nativeOwner: host => host === 'codex' ? originalProcess : targetProcess, ownerAlive: process => live.has(process.pid) };
  const input = { action: 'create', objective: 'Preserve authorized work through adoption', authority: 'User agreed fixture delivery', controller: source, limits: { maxDispatches: 5 }, tasks: [{ id: 'change', title: 'Change', agreement: { source: 'fixture user', outcome: 'Preserve work' } }], ...overrides };
  const created = await execute(root, input, dependencies);
  store = new RunStore(root);
  const call = (request, actor = store.read().controller, overrides = {}) => execute(root, { actor, revision: store.read().revision, ...request }, { ...dependencies, ...overrides });
  const adopt = overrides => call({ action: 'adopt', runId: created.id, previousController: source, authority: 'User directs adoption of this exact run', ...overrides }, target);

  return { root, store, call, adopt, live, dependencies, input, created };
}

test('stopped open-chat adoption preserves work and fences the former owner', async t => {
  const f = await fixture(t);
  await f.call({ action: 'followup', item: { id: 'keep', context: 'Preserve pending decision', recommendation: 'Ask later' } });
  await f.call({ action: 'handover', authority: 'User hands over fixture' });
  await f.call({ action: 'stop', kind: 'resource-limit', reason: 'Preserve original stop reason' });
  const before = f.store.read();
  const adopted = await f.adopt();
  const after = f.store.read();
  assert.equal(adopted.id, before.id);
  assert.deepEqual(after.controller, target);
  assert.equal(after.mode, 'attended');
  assert.equal(after.status, 'stopped');
  assert.equal(after.controllerClaim, null);
  assert.equal(after.continuation, null);
  for (const field of ['tasks', 'followups', 'limits', 'handover', 'stop', 'authority', 'resources', 'publication']) assert.deepEqual(after[field], before[field]);
  await assert.rejects(f.call({ action: 'resume', authority: 'Old owner tries to resume' }, source), { code: 'stale-owner' });
  assert.equal((await f.call({ action: 'resume', authority: 'User resumes adopted run' })).controllerReady, true);
  assert.deepEqual(f.store.read().controllerClaim.controller, target);
  assert.equal(f.store.history(before.id).filter(entry => entry.kind === 'adopt').length, 1);
});

test('running adoption needs the exact former claimed process to be confirmed ended', async t => {
  const f = await fixture(t);
  await assert.rejects(f.adopt(), { code: 'controller-not-inactive' });
  f.live.delete(originalProcess.pid);
  const before = f.store.read();
  const adopted = await f.adopt();
  assert.equal(adopted.status, 'stopped');
  assert.deepEqual(adopted.adoption.eligibility.controller, before.controllerClaim);
  assert.equal(adopted.adoption.observedRevision, before.revision);
});

test('unknown liveness and missing historical claims preserve ownership', async t => {
  const f = await fixture(t);
  const state = f.store.read();
  await assert.rejects(f.call({ action: 'adopt', runId: state.id, previousController: source, authority: 'User directs adoption' }, target, { ownerAlive: () => null }), { code: 'controller-not-inactive' });
  f.store.update(source, state.revision, 'fixture-old-state', current => { delete current.controllerClaim; });
  await assert.rejects(f.adopt(), { code: 'controller-activity-unknown' });
  assert.deepEqual(f.store.read().controller, source);
});

test('adoption retries are idempotent and competing or stale observations cannot transfer ownership', async t => {
  const f = await fixture(t);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User stopped run' });
  const before = f.store.read();
  const request = { action: 'adopt', runId: before.id, revision: before.revision, previousController: source, authority: 'User directs adoption' };
  await f.call(request, target);
  const revision = f.store.read().revision;
  await f.call(request, target);
  assert.equal(f.store.read().revision, revision);
  await assert.rejects(f.call(request, { host: 'codex', session: 'second-adopter' }), { code: 'stale-adoption' });
  await assert.rejects(f.call({ ...request, revision, previousController: target }, target), { code: 'self-adoption' });
});

test('failed create leaves no active run and failed resume stays stopped with an unavailable claim', async t => {
  const f = await fixture(t);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  const before = f.store.read();
  await assert.rejects(execute(f.root, f.input, { ...f.dependencies, nativeOwner: () => null }), { code: 'controller-claim-unavailable' });
  assert.equal(f.store.read().revision, before.revision);
  const response = await f.call({ action: 'resume', authority: 'User resumes' }, source, { nativeOwner: () => null });
  assert.equal(response.controllerReady, false);
  assert.equal(response.status, 'stopped');
  assert.equal(f.store.read().controllerClaim.process, null);
});

test('claim refresh fences an old process and a failed refresh cannot reuse the old grant', async t => {
  const f = await fixture(t);
  const replacement = { ...originalProcess, created: 'replacement-incarnation' };
  await assert.rejects(f.call({ action: 'start-task', taskId: 'change' }, source, { nativeOwner: () => replacement }), { code: 'controller-claim-required' });
  const claimed = await f.call({ action: 'claim-controller' }, source, { nativeOwner: () => replacement });
  assert.equal(claimed.controllerReady, true);
  await f.call({ action: 'start-task', taskId: 'change' }, source, { nativeOwner: () => replacement });
  assert.equal((await f.call({ action: 'claim-controller' }, source, { nativeOwner: () => null })).controllerReady, false);
  await assert.rejects(f.call({ action: 'start-task', taskId: 'change' }, source, { nativeOwner: () => replacement }), { code: 'controller-claim-required' });
  assert.equal(Object.hasOwn(await f.call({ action: 'status' }), 'controllerReady'), false);
});

test('active and unknown helpers block adoption, while attributable terminated work is reconciled after transfer', async t => {
  const f = await fixture(t);
  const helper = { pid: 6001, created: 'helper-incarnation', name: 'node.exe', found: true };
  f.live.add(helper.pid);
  await f.call({ action: 'worker', worker: { id: 'helper', session: 'helper-session', assignment: 'Fixture work', role: 'implementer', writes: [] } });
  f.store.update(source, f.store.read().revision, 'fixture-helper', state => { Object.assign(state.workers[0], { helperProcess: helper, phase: 'reserved' }); });
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User stopped controller' });
  await assert.rejects(f.adopt(), { code: 'worker-activity-unknown' });
  f.live.delete(helper.pid);
  await f.adopt();
  await assert.rejects(f.call({ action: 'resume', authority: 'User resumes' }), { code: 'active-workers' });
  await f.call({ action: 'worker-finished', workerId: 'helper', status: 'failed', evidence: 'Saved adoption evidence proves helper ended before launch; no result fabricated' });
  assert.equal((await f.call({ action: 'resume', authority: 'User resumes' })).controllerReady, true);
});

test('legacy development adoption requires factual operation quiescence and retains missing provenance', async t => {
  const f = await fixture(t);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  f.store.update(source, f.store.read().revision, 'fixture-legacy-development', state => { delete state.operationReservations; delete state.executionResources; });
  await assert.rejects(f.adopt(), { code: 'invalid-request' });
  await f.adopt({ quiescenceEvidence: 'Operator inspected all legacy commands and confirms every command has terminated' });
  assert.equal(f.store.read().resources, null);
  assert.equal(f.store.read().executionResources, null);
});

test('a terminated child without whole-operation evidence is not proof of quiescence', async t => {
  const f = await fixture(t);
  const worker = { id: 'uncertain', role: 'operation', status: 'unverified', phase: 'contained', helperProcess: { pid: 91, created: '1', name: 'node.exe' }, childProcess: { pid: 92, created: '2', name: 'node.exe' } };
  assert.equal(workerTermination(f.root, worker, f.store.read(), { ownerAlive: () => false }), null);
});

test('new review staff cannot include any former controller after adoption', async t => {
  const f = await fixture(t);
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused' });
  await f.adopt();
  await f.call({ action: 'resume', authority: 'User resumes' });
  await assert.rejects(f.call({ action: 'worker', worker: { id: 'former', session: source.session, assignment: 'Independent review', role: 'reviewer', writes: [] } }), { code: 'nonindependent-worker' });
  await f.call({ action: 'worker', worker: { id: 'fresh', session: 'fresh-reviewer', assignment: 'Independent review', role: 'reviewer', writes: [] } });
});

test('a check reservation blocks takeover and commits its result with terminal worker state', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'input\n');
  let finish;
  const command = new Promise(resolve => { finish = resolve; });
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const helper = { found: true, pid: 7101, created: 'helper', name: 'node.exe' };
  f.live.add(helper.pid);
  const check = f.call({ action: 'check', taskId: 'change', check: { name: 'Required command', executable: process.execPath, args: ['--version'], paths: ['subject.txt'], resourceMode: 'development' } }, source, {
    information: () => helper,
    runContained: async (executable, args, options) => {
      options.onPrepared({ runnerPid: 7102 });
      options.onStarted({ pid: 7103, runnerPid: 7102 });
      started();
      await command;
      const result = { code: 0, stdout: 'passed', stderr: '', descendantsReclaimed: true };
      options.onFinished(result);

      return result;
    },
  });
  await ready;
  assert.equal(f.store.read().tasks[0].checks.at(-1).passed, false);
  assert.equal(f.store.read().workers.at(-1).role, 'operation');
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'Pause while command finishes' });
  await assert.rejects(f.adopt(), { code: 'worker-activity-unknown' });
  finish();
  await check;
  const completed = f.store.read();
  assert.equal(completed.tasks[0].checks.at(-1).passed, true);
  assert.equal(completed.workers.at(-1).status, 'complete');
  const transition = f.store.history(completed.id).at(-1);
  assert.equal(transition.kind, 'operation-completed');
  assert.equal(transition.state.tasks[0].checks.at(-1).passed, true);
  assert.equal(transition.state.workers.at(-1).status, 'complete');
  f.live.delete(helper.pid);
  await f.adopt();
});

test('interrupted execution retains uncertainty and a pending check cannot reveal an older pass', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'input\n');
  f.store.update(source, f.store.read().revision, 'fixture-prior-pass', state => { state.tasks[0].checks.push({ name: 'Required command', passed: true }); });
  await assert.rejects(f.call({ action: 'check', taskId: 'change', check: { name: 'Required command', executable: process.execPath, args: ['--version'], paths: ['subject.txt'] } }, source, {
    information: () => ({ found: true, pid: 7101, created: 'helper', name: 'node.exe' }),
    runContained: async () => { throw new Error('Lost command termination evidence'); },
  }), /Lost command termination evidence/);
  assert.equal(f.store.read().tasks[0].checks.at(-1).passed, false);
  assert.equal(f.store.read().workers.at(-1).status, 'unverified');
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User stops uncertain operation' });
  await assert.rejects(f.adopt(), { code: 'worker-activity-unknown' });
});

test('an older check finishing last cannot mask a newer failed invocation', async t => {
  const f = await fixture(t, { tasks: [{ id: 'change', title: 'Docs', kind: 'docs', agreement: { source: 'User', outcome: 'Checked docs' } }] });
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'input\n');
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const request = { action: 'check', taskId: 'change', check: { name: 'Required command', executable: process.execPath, args: ['--version'], paths: ['subject.txt'] } };
  const dependencies = code => ({
    information: () => ({ found: true, pid: 7101, created: 'helper', name: 'node.exe' }),
    runContained: async (executable, args, options) => {
      if (code === 0) await waiting;
      const result = { code, stdout: '', stderr: '', descendantsReclaimed: true };
      options.onFinished(result);

      return result;
    },
  });
  const older = f.call(request, source, dependencies(0));
  await f.call(request, source, dependencies(1));
  finish();
  await older;
  const checks = f.store.read().tasks[0].checks;
  assert.deepEqual(checks.map(check => check.passed), [true, false]);
  assert.equal(new Set(checks.map(check => check.attemptId)).size, 2);
  await assert.rejects(f.call({ action: 'advance', taskId: 'change', evidence: 'Older command passed' }), { code: 'verification-required' });
});

test('preparation and finalization cannot inherit the contained command termination proof', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'input\n');
  const helper = { found: true, pid: 7101, created: 'helper', name: 'node.exe' };
  const request = { action: 'check', actor: source, revision: f.store.read().revision, taskId: 'change', check: { name: 'Phase check', executable: process.execPath, args: ['--version'], paths: ['subject.txt'] } };
  await reservedOperation(f.store, request, async run => {
    let worker = f.store.read().workers.at(-1);
    assert.equal(worker.phase, 'preparing');
    assert.equal(workerTermination(f.root, worker, f.store.read(), { ownerAlive: () => false }), null);
    await run(f.root, request.check);
    worker = f.store.read().workers.at(-1);
    assert.equal(worker.phase, 'finalizing');
    assert.equal(workerTermination(f.root, worker, f.store.read(), { ownerAlive: () => false }), null);
    assert.equal(workerTermination(f.root, { ...worker, phase: 'contained' }, f.store.read(), { ownerAlive: () => false }).kind, 'contained-termination');

    return { name: request.check.name, passed: true };
  }, {
    information: () => helper,
    runContained: async (executable, args, options) => {
      const result = { code: 0, stdout: '', stderr: '', descendantsReclaimed: true };
      options.onFinished(result);

      return result;
    },
  });
});

test('real contained check produces attributable termination evidence', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, 'subject.txt'), 'input\n');
  await f.call({ action: 'check', taskId: 'change', check: { name: 'Native contained command', executable: process.execPath, args: ['--version'], paths: ['subject.txt'], resourceMode: 'development', timeoutMs: 15000 } });
  const state = f.store.read();
  const worker = state.workers.at(-1);
  assert.equal(state.tasks[0].checks.at(-1).passed, true);
  assert.equal(worker.status, 'complete');
  assert.equal(worker.terminationEvidence.descendantsReclaimed, true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, worker.terminationPath), 'utf8')).workerId, worker.id);
});

test('resumption preserves handover but cannot reuse a previously verified continuation observation', async t => {
  const f = await fixture(t);
  await f.call({ action: 'handover', authority: 'User hands over fixture', mechanism: { verified: true, evidence: 'Earlier native mechanism observation' } });
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User pauses host' });
  const before = f.store.read();
  const resumed = await f.call({ action: 'resume', authority: 'User resumes same work' });
  assert.equal(resumed.controllerReady, true);
  assert.equal(resumed.mode, 'attended');
  assert.equal(resumed.continuation.verified, false);
  assert.deepEqual(resumed.handover, before.handover);
});

for (const adopted of [false, true]) {
  test(`closed report bookkeeping needs ownership but no new engineering grant: adopted=${adopted}`, async t => {
    const f = await fixture(t, { tasks: [{ id: 'docs', title: 'Docs', kind: 'docs', agreement: { source: 'User', outcome: 'Preserve reports' } }] });
    await f.call({ action: 'handover', authority: 'User hands over documentation' });
    await f.call({ action: 'advance', taskId: 'docs', evidence: 'Fixture documentation completed' });
    await f.call({ action: 'retrospective', evidence: 'Fixture retrospective completed' });
    const report = '.nightshift/runs/reports/fixture.md';
    fs.mkdirSync(path.dirname(path.join(f.root, report)), { recursive: true });
    fs.writeFileSync(path.join(f.root, report), '# Fixture report\n');
    await f.call({ action: 'report', path: report });
    await f.call({ action: 'triage', evidence: 'No optional fixture decisions' });
    await f.call(adopted ? { action: 'stop', kind: 'user-stop', reason: 'User stopped fixture' } : { action: 'complete' });
    if (adopted) await f.adopt();
    const state = f.store.read();
    const unavailable = { nativeOwner: () => null };
    const owner = state.controller;
    fs.writeFileSync(path.join(f.root, report), '# Repaired fixture report\n');
    await f.call({ action: 'report', path: report }, owner, unavailable);
    await f.call({ action: 'report-delivered', authority: 'User acknowledged the repaired report' }, owner, unavailable);
    if (adopted) await f.call({ action: 'triage', evidence: 'Pending answers remain deferred' }, owner, unavailable);
    else await assert.rejects(f.call({ action: 'triage', evidence: 'No new closing cycle on a completed run' }, owner, unavailable), { code: 'retrospective-required' });
    assert.equal(f.store.read().status, state.status);
    assert.deepEqual(f.store.read().controllerClaim, state.controllerClaim);
    assert.equal(f.store.read().closing.reportDelivery.sha256, f.store.read().closing.reportEvidence.sha256);
    await assert.rejects(f.call({ action: 'claim-controller' }, owner, unavailable), { code: 'run-stopped' });
    await assert.rejects(f.call({ action: 'report-delivered', authority: 'Wrong owner' }, { host: 'codex', session: 'intruder' }, unavailable), { code: 'stale-owner' });
  });
}

function nativeEvents(host, state, worker) {
  const report = { runId: state.id, requestId: worker.id };
  if (host === 'claude') {
    return [
      { type: 'assistant', session_id: worker.session, message: { model: worker.model, content: [] } },
      { type: 'result', session_id: worker.session, subtype: 'success', is_error: false, structured_output: report },
    ];
  }

  return [
    { id: 2, result: { thread: { id: worker.session }, model: worker.model } },
    { method: 'item/completed', params: { threadId: worker.session, turnId: 'native-turn', item: { type: 'agentMessage', text: JSON.stringify(report) } } },
    { method: 'turn/completed', params: { threadId: worker.session, turn: { id: 'native-turn', status: 'completed' } } },
  ];
}

async function nativeWorkerFixture(t, host) {
  const f = await fixture(t);
  const worker = { id: 'native-helper', host, session: 'native-helper-session', model: host === 'claude' ? 'claude-fable-5-1' : 'gpt-6-astra', assignment: 'One bounded helper assignment', role: 'implementer', writes: [] };
  await f.call({ action: 'worker', worker });
  await f.call({ action: 'stop', kind: 'user-stop', reason: 'User paused the source while its chat remains open' });
  const relative = '.nightshift/runs/worker-evidence/native-helper.jsonl';
  fs.mkdirSync(path.dirname(path.join(f.root, relative)), { recursive: true });
  const save = events => fs.writeFileSync(path.join(f.root, relative), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  const evidence = [{ workerId: worker.id, path: relative }];

  return { ...f, worker, save, evidence, events: nativeEvents(host, f.store.read(), worker) };
}

for (const host of ['claude', 'codex']) {
  test(`native terminal evidence permits in-host reconciliation after adoption: ${host}`, async t => {
    const f = await nativeWorkerFixture(t, host);
    assert.equal(f.store.read().workers[0].helperProcess, undefined);
    await assert.rejects(f.adopt(), { code: 'worker-activity-unknown' });
    f.save(f.events);
    await f.adopt({ workerEvidence: f.evidence });
    const state = f.store.read();
    assert.equal(state.workers[0].status, 'running');
    assert.equal(state.adoption.eligibility.workers[0].kind, 'native-terminal-result');
    assert.equal(state.adoption.eligibility.workers[0].host, host);
    assert.match(state.adoption.eligibility.workers[0].sha256, /^[a-f0-9]{64}$/);
    await assert.rejects(f.call({ action: 'resume', authority: 'User resumes' }), { code: 'active-workers' });
    await f.call({ action: 'worker-finished', workerId: f.worker.id, status: 'stopped', evidence: 'Adoption saved a verified native terminal result; no engineering success is inferred' });
    await f.call({ action: 'resume', authority: 'User resumes after reconciliation' });
    assert.equal(f.store.read().status, 'running');
  });
}

test('native helper evidence rejects missing, foreign, stale, active and conflicting results without changing ownership', async t => {
  const f = await nativeWorkerFixture(t, 'codex');
  const variants = [
    [],
    f.events.slice(0, -1),
    f.events.map(event => event.result ? { ...event, result: { ...event.result, model: '' } } : event),
    f.events.map(event => event.params?.threadId ? { ...event, params: { ...event.params, threadId: 'other-session' } } : event),
    f.events.map(event => event.params?.item ? { ...event, params: { ...event.params, item: { ...event.params.item, text: JSON.stringify({ runId: 'another-run', requestId: f.worker.id }) } } } : event),
    f.events.map(event => event.params?.item ? { ...event, params: { ...event.params, item: { ...event.params.item, text: JSON.stringify({ runId: f.created.id, requestId: 'another-assignment' }) } } } : event),
    [...f.events, { method: 'turn/started', params: { threadId: f.worker.session, turn: { id: 'later-turn' } } }],
    [...f.events, { method: 'thread/goal/updated', params: { threadId: f.worker.session, goal: { status: 'active' } } }],
    ...['active', 'systemError', 'unknown', undefined].map(type => [...f.events, { method: 'thread/status/changed', params: { threadId: f.worker.session, status: { type, activeFlags: [] } } }]),
  ];
  const before = f.store.read();
  for (const events of variants) {
    f.save(events);
    await assert.rejects(f.adopt({ workerEvidence: f.evidence }), { code: 'worker-activity-unknown' });
    assert.deepEqual(f.store.read(), before);
  }
  f.save(f.events);
  await assert.rejects(f.adopt({ workerEvidence: [...f.evidence, ...f.evidence] }), { code: 'invalid-worker-evidence' });
  await assert.rejects(f.adopt({ workerEvidence: [{ ...f.evidence[0], workerId: 'unknown-worker' }] }), { code: 'invalid-worker-evidence' });
  f.store.update(source, f.store.read().revision, 'fixture-missing-native-host', state => { delete state.workers[0].host; });
  await assert.rejects(f.adopt({ workerEvidence: f.evidence }), { code: 'worker-activity-unknown' });
});

for (const type of ['idle', 'notLoaded']) {
  test(`Codex terminal evidence permits a later inactive status: ${type}`, async t => {
    const f = await nativeWorkerFixture(t, 'codex');
    f.save([...f.events, { method: 'thread/status/changed', params: { threadId: f.worker.session, status: { type } } }]);
    await f.adopt({ workerEvidence: f.evidence });
    assert.deepEqual(f.store.read().controller, target);
  });
}

test('Claude native exports need attribution and a terminal assignment result, not only a completion label', async t => {
  const f = await nativeWorkerFixture(t, 'claude');
  const variants = [
    f.events.slice(1),
    f.events.map(event => event.type === 'result' ? { ...event, session_id: 'different-helper' } : event),
    f.events.map(event => event.type === 'assistant' ? { ...event, message: { ...event.message, model: '<synthetic>' } } : event),
    f.events.map(event => event.type === 'result' ? { ...event, structured_output: { runId: f.created.id, requestId: 'old-assignment' } } : event),
    [...f.events, { type: 'assistant', session_id: f.worker.session, message: { model: f.worker.model, content: [] } }],
  ];
  for (const events of variants) {
    f.save(events);
    await assert.rejects(f.adopt({ workerEvidence: f.evidence }), { code: 'worker-activity-unknown' });
  }
});
