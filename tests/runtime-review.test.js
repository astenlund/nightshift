'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { dispatchReview, readReceipt, schemaFor, validateReport } = require('../internal/runtime/review');
const { DIMENSIONS, reviewGate } = require('../internal/runtime/lifecycle');
const { fileIdentity, fresh, hash } = require('../internal/runtime/evidence');
const { runAgent } = require('../internal/runtime/hosts');
const { RunError, RunStore } = require('../internal/runtime/store');
const { fixtureControllerClaim, executeWithFixtureController } = require('./fixtures/controller-claim');

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t) {
  const parent = path.resolve(__dirname, '../.tmp/review-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--quiet']);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'before\r\n');
  git(root, ['add', 'subject.txt']);
  git(root, ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish review baseline']);
  const baseSha = git(root, ['rev-parse', 'HEAD']);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'after\r\n');
  fs.writeFileSync(path.join(root, 'new.txt'), 'new sibling\r\n');
  return { root, baseSha, runId: 'run', taskId: 'task', requirements: 'Change both paths correctly', rules: 'Do not mutate reviewed inputs.', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
}

function validateSchemas(cases, directory) {
  fs.mkdirSync(directory, { recursive: true });
  const manifest = cases.map((item, index) => {
    const schema = path.join(directory, index + '-schema.json');
    const document = path.join(directory, index + '-document.json');
    fs.writeFileSync(schema, JSON.stringify(item.schema) + '\r\n');
    fs.writeFileSync(document, JSON.stringify(item.document) + '\r\n');
    return { name: item.name, schema, document };
  });
  const manifestFile = path.join(directory, 'cases.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest) + '\r\n');
  const checked = spawnSync('pwsh', ['-NoProfile', '-File', path.join(__dirname, 'fixtures/validate-review-schema.ps1'), '-Manifest', manifestFile], { windowsHide: true, encoding: 'utf8', timeout: 30000 });
  assert.equal(checked.status, 0, checked.stderr);
  return JSON.parse(checked.stdout);
}

function assessment(options, dimensions = DIMENSIONS.code, findings = []) {
  return { requestId: options.schema.properties.requestId.enum[0], status: 'complete', coverage: dimensions.map(dimension => ({ dimension, evidence: 'Assessed both concrete paths' })), findings, probes: [], summary: 'Fixture assessment completed' };
}

function mockAgent(options, dimensions = DIMENSIONS.code, { findings = [], session = 'fresh-session' } = {}) {
  fs.mkdirSync(options.artifacts, { recursive: true });
  assert.match(options.prompt, /complete supplied artifact and cumulative change/);
  assert.match(fs.readFileSync(path.join(options.cwd, 'context/diff.patch'), 'utf8'), /new sibling/);
  const report = assessment(options, dimensions, findings);
  if (process.platform === 'win32') assert.deepEqual(validateSchemas([{ name: 'host-report', schema: options.schema, document: report }], path.join(options.artifacts, 'schema-check')), [{ name: 'host-report', valid: true }]);
  const events = options.host === 'codex'
    ? [{ id: 2, result: { thread: { id: session }, model: options.model } }, { method: 'item/completed', params: { threadId: session, item: { type: 'agentMessage', text: JSON.stringify(report) } } }, { method: 'turn/completed', params: { threadId: session, turn: { status: 'completed' } } }]
    : [{ type: 'assistant', session_id: session, message: { model: options.model, content: [] } }, { type: 'result', session_id: session, subtype: 'success', is_error: false, structured_output: report }];
  fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
  return { host: options.host, model: options.model, effort: options.effort, session, attributionVerified: true, status: 'complete', output: report, tokens: 0 };
}

test('skeptic producer schemas bind assigned ids and count while consumer validation remains independent', { skip: process.platform !== 'win32' }, t => {
  const f = fixture(t);
  const directory = path.join(f.root, '.tmp/schema');
  const ids = ['first-request:claim', 'second-request:claim'];
  const verdict = (id, evidence = 'Deciding fixture evidence') => ({ id, verdict: 'confirmed', evidence, value: 'Required behavior assessed independently' });
  const report = findings => ({ requestId: 'schema-request', status: 'complete', coverage: [], findings, probes: [], summary: 'Assigned claims evaluated' });
  const schemas = [0, 1, 2].map(count => schemaFor('skeptic', 'schema-request', ids.slice(0, count).map(id => ({ id }))));
  const duplicate = report([verdict(ids[0]), verdict(ids[0], 'Different evidence for the repeated id')]);
  const blank = report([verdict(ids[0], '')]);
  const probe = { ...report([{ ...verdict(ids[0]), verdict: 'unverified' }]), status: 'incomplete', probes: [{ id: 'deciding-probe', purpose: 'Resolve missing evidence', executable: process.execPath, args: ['--version'], timeoutMs: 10000, files: [] }] };
  const secondsTimeout = { ...probe, probes: [{ ...probe.probes[0], timeoutMs: 240 }] };
  const cases = [
    { name: 'empty-assignment', count: 0, document: report([]), valid: true },
    { name: 'extra-on-empty', count: 0, document: report([verdict('new-claim')]), valid: false },
    { name: 'assigned-only', count: 1, document: report([verdict(ids[0])]), valid: true },
    { name: 'unassigned-observation', count: 1, document: report([verdict(ids[0]), verdict('unassigned-readme-note')]), valid: false },
    { name: 'wrong-id', count: 1, document: report([verdict('unassigned-readme-note')]), valid: false },
    { name: 'omitted-verdict', count: 1, document: report([]), valid: false },
    { name: 'unverified-with-probe', count: 1, document: probe, valid: true },
    { name: 'probe-timeout-in-seconds', count: 1, document: secondsTimeout, valid: false },
    { name: 'complete-batch', count: 2, document: report(ids.map(id => verdict(id))), valid: true },
    { name: 'duplicate-id-needs-consumer-check', count: 2, document: duplicate, valid: true },
    { name: 'blank-evidence-needs-consumer-check', count: 1, document: blank, valid: true },
  ];
  assert.deepEqual(validateSchemas(cases.map(item => ({ ...item, schema: schemas[item.count] })), directory), cases.map(item => ({ name: item.name, valid: item.valid })));
  const request = count => ({ id: 'schema-request', kind: 'skeptic', findings: ids.slice(0, count).map(id => ({ id })), dimensions: DIMENSIONS.code });
  assert.throws(() => validateReport(duplicate, request(2)), { code: 'duplicate-finding' });
  assert.throws(() => validateReport(blank, request(1)), { code: 'invalid-request' });
  assert.equal(validateReport(probe, request(1)).findings[0].verdict, 'unverified');
});

test('injected native observations do not grant a missing or mismatched controller claim', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  let calls = 0;
  const dispatch = dependencies => executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, kind: 'code' } }, { runAgent: () => { calls++; throw new Error('Unexpected model call'); }, ...dependencies });
  try {
    await assert.rejects(dispatch(), { code: 'controller-claim-required' });
    assert.equal(store.read().revision, 0);
    store.update(actor, 0, 'fixture-claim', state => { state.controllerClaim = fixtureControllerClaim(actor); });
    const claimed = store.read();
    await assert.rejects(dispatch({ nativeOwner: () => ({ ...claimed.controllerClaim.process, created: 'different-incarnation' }) }), { code: 'controller-claim-required' });
    await assert.rejects(dispatch({ ownerAlive: () => null }), { code: 'controller-claim-required' });
    assert.deepEqual(store.read(), claimed);
    assert.equal(calls, 0);
    assert.equal(store.read().workers.length, 0);
  } finally { store.close(); }
});

test('invalid skeptic assignments reject before workers or model attempts are created', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  let calls = 0;
  try {
    for (const [findings, code] of [['not-an-array', 'invalid-skeptic-assignment'], [[{ id: 'same' }, { id: 'same' }], 'invalid-skeptic-assignment'], [[{ id: '' }], 'invalid-request']]) {
      await assert.rejects(executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, kind: 'skeptic', findings } }, { runAgent: () => { calls++; throw new Error('Unexpected model call'); } }), { code });
    }
    assert.equal(calls, 0);
    assert.equal(store.read().workers.length, 0);
    assert.equal(fs.existsSync(path.join(f.root, '.nightshift/runs/reviews')), false);
  } finally { store.close(); }
});

for (const adoptionCase of ['historical-import', 'adopter-authored', 'already-imported']) {
  test(`review attribution survives adoption: ${adoptionCase}`, async t => {
    const f = fixture(t);
    const store = new RunStore(f.root, { create: true });
    const actor = { host: 'codex', session: 'controller' };
    const adopter = { host: 'claude', session: adoptionCase === 'historical-import' ? 'adopter' : 'fresh-session' };
    const created = store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', kind: 'docs', agreement: { source: 'User', outcome: f.requirements } }] });
    const act = (request, owner = store.read().controller) => executeWithFixtureController(f.root, { actor: owner, revision: store.read().revision, taskId: f.taskId, ...request });
    try {
      const lead = await executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, kind: 'code' } }, { runAgent: options => mockAgent(options) });
      const receipt = path.relative(f.root, lead.receiptFile).split(path.sep).join('/');
      if (adoptionCase === 'already-imported') await act({ action: 'review', receipt });
      await act({ action: 'stop', kind: 'user-stop', reason: 'User switches host' });
      await act({ action: 'adopt', runId: created.id, previousController: actor, authority: 'User adopts preserved fixture work' }, adopter);
      await act({ action: 'resume', authority: 'User resumes adopted work' });
      if (adoptionCase === 'adopter-authored') {
        await assert.rejects(act({ action: 'review', receipt }), { code: 'wrong-result' });
      } else {
        if (adoptionCase === 'historical-import') await act({ action: 'review', receipt });
        const state = store.read();
        assert.equal(state.tasks[0].reviews.length, 1);
        assert.equal(reviewGate(f.root, state.tasks[0], state), true);
        assert.equal(state.tasks[0].reviews[0].session, 'fresh-session');
      }
      await assert.rejects(executeWithFixtureController(f.root, { action: 'dispatch', actor: adopter, revision: store.read().revision, taskId: f.taskId, review: { ...f, kind: 'code' } }, { runAgent: options => mockAgent(options, DIMENSIONS.code, { session: actor.session }) }), { code: 'nonindependent-worker' });
    } finally { store.close(); }
  });
}

test('receipt maintenance can import produced evidence without acquiring a new engineering claim', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  const relative = result => path.relative(f.root, result.receiptFile).split(path.sep).join('/');
  const invoke = (request, overrides) => executeWithFixtureController(f.root, { actor, revision: store.read().revision, taskId: f.taskId, ...request }, overrides);
  const unavailable = { nativeOwner: () => { throw new Error('Maintenance must not require native controller inspection'); } };
  try {
    const finding = { id: 'fixture-finding', severity: 'minor', required: false, consequence: 'Alleged fixture issue', evidence: 'Concrete fixture claim' };
    const lead = await invoke({ action: 'dispatch', review: { ...f, kind: 'code' } }, { runAgent: options => mockAgent(options, DIMENSIONS.code, { findings: [finding], session: 'lead' }) });
    const claim = store.read().controllerClaim;
    await invoke({ action: 'review', receipt: relative(lead) }, unavailable);
    const assigned = store.read().tasks[0].findings;
    const skeptic = await invoke({ action: 'dispatch', review: { ...f, kind: 'skeptic', findings: assigned } }, { runAgent: options => mockAgent(options, DIMENSIONS.code, { session: 'skeptic', findings: assigned.map(item => ({ id: item.id, verdict: 'refuted', evidence: 'Deciding fixture evidence', value: 'No repair needed' })) }) });
    await invoke({ action: 'validate', receipt: relative(skeptic), findingId: assigned[0].id }, unavailable);
    assert.equal(store.read().tasks[0].findings[0].validation.verdict, 'refuted');
    assert.deepEqual(store.read().controllerClaim, claim);
    await assert.rejects(invoke({ action: 'start-task' }, unavailable), { code: 'controller-claim-required' });
    await assert.rejects(invoke({ action: 'review', receipt: relative(lead), actor: { host: 'codex', session: 'intruder' } }, unavailable), { code: 'stale-owner' });
  } finally { store.close(); }
});

for (const hasFinding of [false, true]) {
  test(`receipt replay preserves imported evidence and progress with findings=${hasFinding}`, async t => {
    const f = fixture(t);
    const store = new RunStore(f.root, { create: true });
    const actor = { host: 'codex', session: 'controller' };
    store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
    const act = request => executeWithFixtureController(f.root, { actor, revision: store.read().revision, taskId: f.taskId, ...request });
    const receiptPath = result => path.relative(f.root, result.receiptFile).split(path.sep).join('/');
    const dispatch = (kind, assigned, output) => executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, kind, findings: assigned } }, { runAgent: options => mockAgent(options, DIMENSIONS.code, { findings: output, session: kind === 'skeptic' ? 'skeptic' : 'lead' }) });
    try {
      const claims = hasFinding ? [{ id: 'boundary', severity: 'minor', required: false, consequence: 'Alleged boundary issue', evidence: 'Concrete claim for validation' }] : [];
      const lead = await dispatch('code', [], claims);
      const review = { action: 'review', receipt: receiptPath(lead) };
      await act(review);
      const imported = store.read();
      const historyCount = store.history(imported.id).length;
      await act(review);
      await act(review);
      assert.deepEqual(store.read(), imported);
      assert.equal(store.history(imported.id).length, historyCount);
      if (hasFinding) {
        const findings = store.read().tasks[0].findings;
        const skeptic = await dispatch('skeptic', findings, findings.map(finding => ({ id: finding.id, verdict: 'refuted', evidence: 'Deciding fixture control refutes the claim', value: 'No repair required' })));
        await act({ action: 'validate', receipt: receiptPath(skeptic), findingId: findings[0].id });
        await act({ action: 'dispose', findingId: findings[0].id, disposition: 'refuted', reason: 'Deciding independent evidence' });
        const resolved = store.read();
        await act(review);
        assert.deepEqual(store.read(), resolved);
        assert.equal(store.read().tasks[0].findings.length, 1);
      }
      const saved = store.read();
      await assert.rejects(act({ ...review, revision: saved.revision - 1 }), { code: 'stale-owner' });
      const bytes = fs.readFileSync(lead.receiptFile);
      const tampered = JSON.parse(bytes);
      tampered.findings.push({ id: 'not-in-native-report' });
      fs.writeFileSync(lead.receiptFile, JSON.stringify(tampered));
      await assert.rejects(act(review), { code: 'changed-result' });
      fs.writeFileSync(lead.receiptFile, bytes);
      fs.writeFileSync(path.join(f.root, 'subject.txt'), 'New unreviewed source\r\n');
      await assert.rejects(act(review), { code: 'invalid-receipt' });
      assert.deepEqual(store.read(), saved);
    } finally { store.close(); }
  });
}

for (const fallback of [false, true]) {
  test(`dispatched leads retain actual identity for matching peer registration with fallback=${fallback}`, async t => {
    const f = fixture(t);
    const store = new RunStore(f.root, { create: true });
    const actor = { host: 'codex', session: 'controller' };
    store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
    try {
      const candidates = fallback ? [{ host: 'codex', model: 'gpt-6-astra', effort: 'medium' }, ...f.candidates] : f.candidates;
      const result = await executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, kind: 'code', candidates, substitutionReason: 'First permitted host unavailable in fixture' } }, { runAgent: options => {
        if (fallback && options.host === 'codex') throw new Error('Fixture host unavailable before process launch');
        return mockAgent(options);
      } });
      const lead = store.read().workers.find(worker => worker.id === result.receipt.requestId);
      assert.equal(lead.host, 'claude');
      assert.equal(lead.model, 'claude-fable-5-1');
      assert.equal(lead.effort, 'high');
      await executeWithFixtureController(f.root, { action: 'worker', actor, revision: store.read().revision, worker: { id: 'peer', session: 'peer-session', role: 'peer', assignment: 'Investigate a bounded part of the assessment', lead: lead.id, host: lead.host, model: lead.model, effort: lead.effort, writes: [] } });
      assert.equal(store.read().workers.at(-1).id, 'peer');
      await assert.rejects(executeWithFixtureController(f.root, { action: 'worker', actor, revision: store.read().revision, worker: { id: 'wrong-peer', session: 'wrong-session', role: 'peer', assignment: 'Different effort', lead: lead.id, model: lead.model, effort: 'low', writes: [] } }), { code: 'peer-mismatch' });
    } finally { store.close(); }
  });
}

test('review receives cumulative tracked and new content; imported result is bound to native evidence and current inventory', async t => {
  const f = fixture(t);
  const { receiptFile, receipt } = await dispatchReview(f.root, f, { runAgent: mockAgent });
  assert.equal(receipt.strength, 'strong');
  const relative = path.relative(f.root, receiptFile).split(path.sep).join('/');
  const state = { id: f.runId, controller: { session: 'controller' } };
  assert.equal(readReceipt(f.root, relative, state, f.taskId).session, 'fresh-session');
  fs.writeFileSync(path.join(f.root, 'late-sibling.txt'), 'unreviewed\r\n');
  assert.throws(() => readReceipt(f.root, relative, state, f.taskId), { code: 'invalid-receipt' });
});

test('the review copy sits one short segment below the run directory while its evidence stays with the dispatch', async t => {
  const f = fixture(t);
  const canonical = fs.realpathSync.native(f.root);
  let workspace;
  const { receiptFile } = await dispatchReview(f.root, f, { runAgent: options => { workspace = path.relative(canonical, options.cwd).split(path.sep).join('/'); return mockAgent(options); } });
  // 27 characters below the project root, against 71 when the copy lived under the dispatch directory.
  assert.match(workspace, /^\.nightshift\/runs\/c\/[0-9a-f]{8}$/);
  const dispatch = path.dirname(receiptFile);
  assert.equal(path.relative(path.join(canonical, '.nightshift/runs/reviews'), dispatch).includes(path.sep), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dispatch, 'request.json'), 'utf8')).workspace, workspace);
  assert.equal(fs.existsSync(path.join(canonical, workspace, 'project')), false);
  assert.equal(fs.existsSync(path.join(canonical, workspace, 'context/diff.patch')), true);
});

test('a receipt cannot change the findings in the native report', async t => {
  const f = fixture(t);
  const { receiptFile, receipt } = await dispatchReview(f.root, f, { runAgent: mockAgent });
  receipt.findings.push({ id: 'fabricated' });
  fs.writeFileSync(receiptFile, JSON.stringify(receipt));
  assert.throws(() => readReceipt(f.root, path.relative(f.root, receiptFile).split(path.sep).join('/'), { id: f.runId, controller: { session: 'controller' } }, f.taskId), { code: 'changed-result' });
});

test('Codex rerouting prevents receipt issuance even after a completed native turn', async t => {
  const f = fixture(t);
  f.candidates = [{ host: 'codex', model: 'gpt-6-astra', effort: 'high' }];
  await assert.rejects(dispatchReview(f.root, f, { runAgent: options => runAgent({ ...options, executable: process.execPath, commandPrefix: [path.join(__dirname, 'fixtures/runtime-host.cjs')], directProcess: false, timeoutMs: 10000, env: { ...process.env, NIGHTSHIFT_TEST_HOST_MODE: 'reroute-back', NIGHTSHIFT_TEST_HOST_REPORT: JSON.stringify(assessment(options)) } }) }), { code: 'unusable-review' });
});

for (const scoped of [true, false]) {
  test(`Codex receipt import independently rejects model rerouting in its own thread: ${scoped}`, async t => {
    const f = fixture(t);
    f.candidates = [{ host: 'codex', model: 'gpt-6-astra', effort: 'high' }];
    const { receiptFile, receipt } = await dispatchReview(f.root, f, { runAgent: mockAgent });
    const eventFile = path.join(f.root, receipt.eventFile);
    const events = fs.readFileSync(eventFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    const session = scoped ? receipt.session : 'unrelated-session';
    const route = (fromModel, toModel) => ({ method: 'model/rerouted', params: { threadId: session, turnId: 'fixture-turn', fromModel, toModel, reason: 'highRiskCyberActivity' } });
    events.splice(1, 0, route('gpt-6-astra', 'other-model'), route('other-model', 'gpt-6-astra'));
    fs.writeFileSync(eventFile, events.map(event => JSON.stringify(event)).join('\n') + '\n');
    receipt.eventHash = hash(fs.readFileSync(eventFile));
    fs.writeFileSync(receiptFile, JSON.stringify(receipt));
    const read = () => readReceipt(f.root, path.relative(f.root, receiptFile).split(path.sep).join('/'), { id: f.runId, controller: { session: 'controller' } }, f.taskId);
    if (scoped) assert.throws(read, { code: 'unattributed-review' });
    else assert.equal(read().session, receipt.session);
  });
}

test('review input writes and stale inputs are rejected without restoring another writer over their changes', async t => {
  const f = fixture(t);
  await assert.rejects(dispatchReview(f.root, f, { runAgent: options => {
    const result = mockAgent(options);
    fs.writeFileSync(path.join(options.cwd, 'project/subject.txt'), 'reviewer wrote input\r\n');
    return result;
  } }), { code: 'review-input-drift' });
  assert.equal(fs.readFileSync(path.join(f.root, 'subject.txt'), 'utf8'), 'after\r\n');
});

test('fallback remains strong, honors explicit model requirements, and records its reason', async t => {
  const f = fixture(t);
  f.candidates.unshift({ host: 'codex', model: 'gpt-6-astra', effort: 'high' });
  f.substitutionReason = 'Counterpart host unavailable; fresh qualified same-host review selected';
  const result = await dispatchReview(f.root, f, { runAgent: options => {
    if (options.host === 'codex') throw new Error('simulated unavailable host');
    return mockAgent(options);
  } });
  assert.equal(result.receipt.substitution, f.substitutionReason);
  assert.equal(result.receipt.attempts[0].status, 'failed');
  await assert.rejects(dispatchReview(f.root, { ...f, requiredModel: 'gpt-6-astra' }, { runAgent: mockAgent }), { code: 'model-requirement' });
  await assert.rejects(dispatchReview(f.root, { ...f, candidates: [{ host: 'codex', model: 'gpt-5.6-luna' }] }, { runAgent: mockAgent }), { code: 'review-strength' });
});

for (const failure of ['returned-failed', 'unattributed', 'malformed', 'thrown-error']) {
  test(`fallback records each candidate once with known or unknown usage: ${failure}`, async t => {
    const f = fixture(t);
    const store = new RunStore(f.root, { create: true });
    const actor = { host: 'codex', session: 'controller' };
    store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
    let calls = 0;
    try {
      const result = await executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: 0, taskId: f.taskId, review: { ...f, candidates: [...f.candidates, { host: 'codex', model: 'gpt-6-astra', effort: 'high' }], substitutionReason: 'First permitted candidate failed' } }, { runAgent: options => {
        calls++;
        if (options.host === 'claude' && failure === 'thrown-error') throw new Error('Host failed without a usage result');
        const response = mockAgent(options, DIMENSIONS.code, { session: options.host + '-session' });
        response.tokens = options.host === 'claude' ? 7 : 11;
        if (options.host === 'claude') {
          if (failure === 'returned-failed') response.status = 'failed';
          else if (failure === 'unattributed') response.attributionVerified = false;
          else response.output = '{invalid';
        }
        return response;
      } });
      assert.equal(calls, 2);
      assert.equal(store.read().dispatches, 2);
      assert.equal(result.receipt.attempts.length, 2);
      assert.deepEqual(result.receipt.attempts.map(attempt => ({ host: attempt.host, status: attempt.status, tokens: attempt.tokens })), [
        { host: 'claude', status: 'failed', tokens: failure === 'thrown-error' ? null : 7 },
        { host: 'codex', status: 'complete', tokens: 11 },
      ]);
      assert.ok(result.receipt.attempts[0].error);
      const relative = path.relative(f.root, result.receiptFile).split(path.sep).join('/');
      await executeWithFixtureController(f.root, { action: 'review', actor, revision: store.read().revision, taskId: f.taskId, receipt: relative });
      assert.equal(store.read().tasks[0].reviews[0].host, 'codex');
    } finally { store.close(); }
  });
}

test('exhausted returned failures retain one failure record per candidate', async t => {
  const f = fixture(t);
  let requestId;
  let calls = 0;
  await assert.rejects(dispatchReview(f.root, { ...f, candidates: [...f.candidates, { host: 'codex', model: 'gpt-6-astra', effort: 'high' }], substitutionReason: 'First permitted candidate failed', onPrepared: request => { requestId = request.id; } }, { runAgent: options => {
    calls++;
    return { ...mockAgent(options), status: 'failed', tokens: 7 };
  } }), { code: 'unusable-review' });
  const directory = path.join(f.root, '.nightshift/runs/reviews', requestId);
  const failure = JSON.parse(fs.readFileSync(path.join(directory, 'failure.json'), 'utf8'));
  assert.equal(calls, 2);
  assert.equal(failure.attempts.length, 2);
  assert.ok(failure.attempts.every(attempt => attempt.status === 'failed' && attempt.tokens === 7 && attempt.error));
  assert.equal(fs.existsSync(path.join(directory, 'receipt.json')), false);
});

test('an attempt ended as an output loop passes to the listed fallback and keeps its evidence', async t => {
  const f = fixture(t);
  const loop = 'Reviewer streamed only whitespace for 120 s (1000 deltas) after its last text at 2026-09-24T00:00:00.000Z; the attempt was ended as an output loop';
  const hosts = [];
  const result = await dispatchReview(f.root, { ...f, candidates: [{ host: 'codex', model: 'gpt-6-astra', effort: 'high' }, ...f.candidates], substitutionReason: 'Preferred candidate ended in an output loop' }, { runAgent: options => {
    hosts.push(options.host);
    if (options.host === 'codex') throw new RunError('output-loop', loop);
    return mockAgent(options);
  } });
  assert.deepEqual(hosts, ['codex', 'claude']);
  assert.deepEqual(result.receipt.attempts.map(attempt => ({ host: attempt.host, status: attempt.status, error: attempt.error })), [
    { host: 'codex', status: 'failed', error: loop },
    { host: 'claude', status: 'complete', error: undefined },
  ]);
});

test('skeptic reports must address every finding; missing evidence stays unverified', () => {
  const request = { id: 'request', kind: 'skeptic', findings: [{ id: 'a' }, { id: 'b' }] };
  const report = { requestId: 'request', status: 'complete', summary: 'Evidence unavailable for one claim', coverage: [], findings: [{ id: 'a', verdict: 'refuted', evidence: 'Concrete counterexample', value: 'Skip false claim' }] };
  assert.throws(() => validateReport(report, request), { code: 'missing-validation' });
  report.findings.push({ id: 'b', verdict: 'unverified', evidence: 'Missing executable dependency', value: 'Need evidence before disposition' });
  assert.equal(validateReport(report, request).findings[1].verdict, 'unverified');
});

test('dispatch is durable before the agent starts, and a skeptic receipt cannot pass as a lead assessment', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User handover', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Review fixture', agreement: { source: 'User', outcome: f.requirements } }] });
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const paused = new Promise(resolve => { release = resolve; });
  try {
    const dispatch = executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: 0, taskId: f.taskId, review: { ...f, kind: 'skeptic', findings: [] } }, { runAgent: async options => {
      started();
      await paused;
      return mockAgent(options);
    } });
    await startedPromise;
    const inFlight = store.read();
    assert.equal(inFlight.workers.length, 1);
    assert.equal(inFlight.workers[0].status, 'starting');
    assert.ok(inFlight.workers[0].snapshotDigest);
    assert.ok(fs.existsSync(path.join(f.root, inFlight.workers[0].artifactDirectory, 'request.json')));
    release();
    const result = await dispatch;
    assert.equal(store.read().workers[0].status, 'complete');
    const phases = store.history(store.read().id).map(entry => entry.state.workers[0]?.phase).filter(Boolean);
    assert.ok(phases.indexOf('preparing') < phases.indexOf('launching'));
    assert.ok(phases.indexOf('finalizing') > phases.indexOf('launching'));
    const relative = path.relative(f.root, result.receiptFile).split(path.sep).join('/');
    await assert.rejects(executeWithFixtureController(f.root, { action: 'review', actor, revision: store.read().revision, taskId: f.taskId, receipt: relative }), { code: 'wrong-review-kind' });
  } finally { release?.(); store.close(); }
});

test('missing required dispatch text is rejected before workers or copies are created', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  try {
    for (const field of ['requirements', 'rules']) await assert.rejects(executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: 0, taskId: f.taskId, review: { ...f, [field]: undefined } }, { runAgent: mockAgent }), { code: 'invalid-request' });
    assert.equal(store.read().workers.length, 0);
    assert.equal(store.read().revision, 0);
    assert.equal(fs.existsSync(path.join(f.root, '.nightshift/runs/reviews')), false);
  } finally { store.close(); }
});

test('a Codex-shaped native receipt imports through the actual controller boundary', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'claude', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  try {
    const result = await executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: 0, taskId: f.taskId, review: { ...f, candidates: [{ host: 'codex', model: 'gpt-6-astra' }] } }, { runAgent: options => {
      assert.equal(options.protectedRoot, fs.realpathSync.native(f.root));
      return mockAgent(options);
    } });
    await executeWithFixtureController(f.root, { action: 'review', actor, revision: store.read().revision, taskId: f.taskId, receipt: path.relative(f.root, result.receiptFile).split(path.sep).join('/') });
    assert.equal(store.read().tasks[0].reviews[0].model, 'gpt-6-astra');
  } finally { store.close(); }
});

test('dispatch allowance counts attempts and prevents an otherwise valid fallback', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), limits: { maxDispatches: 1 }, tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  let calls = 0;
  try {
    await assert.rejects(executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: 0, taskId: f.taskId, review: { ...f, candidates: [{ host: 'codex', model: 'gpt-6-astra' }, ...f.candidates], substitutionReason: 'First host unavailable' } }, { runAgent: () => { calls++; throw new Error('Host unavailable'); } }), { code: 'resource-limit' });
    assert.equal(calls, 1);
    assert.equal(store.read().dispatches, 1);
  } finally { store.close(); }
});

test('fallback prerequisites and the attempt timeout are refused before any worker is reserved', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  const withFallback = [{ host: 'codex', model: 'gpt-6-astra', effort: 'high' }, ...f.candidates];
  let calls = 0;
  try {
    for (const [review, code] of [
      [{ candidates: withFallback }, 'invalid-request'],
      [{ candidates: withFallback, substitutionReason: '  ' }, 'invalid-request'],
      [{ timeoutMs: 0 }, 'invalid-request'],
      [{ timeoutMs: 1.5 }, 'invalid-request'],
      [{ timeoutMs: '600000' }, 'invalid-request'],
      [{ candidates: [null] }, 'invalid-model-selection'],
    ]) {
      await assert.rejects(executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: 0, taskId: f.taskId, review: { ...f, ...review } }, { runAgent: () => { calls++; throw new Error('Unexpected model call'); } }), { code });
    }
    assert.equal(calls, 0);
    assert.equal(store.read().workers.length, 0);
    assert.equal(store.read().revision, 0);
    assert.equal(fs.existsSync(path.join(f.root, '.nightshift/runs/reviews')), false);
  } finally { store.close(); }
});

function boundRun(t, f, operationDeadlineUtc) {
  const directory = fs.mkdtempSync(f.root + '-store-');
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resources = { schema: 1, store: fs.realpathSync.native(directory), registration: 'a'.repeat(64), session: 'controller', identity: '1.0.0-' + 'b'.repeat(64) };
  const actor = { host: 'codex', session: 'controller' };
  const store = new RunStore(f.root, { create: true });
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), resources, resourceMode: 'bound', tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  return { store, actor, context: { ...resources, mode: 'bound', bundle: 'fixture-bundle', operation: 'fixture-operation', operationDeadlineUtc } };
}

test('a dispatch whose attempts cannot fit the launcher operation bound is refused before reservation', async t => {
  const f = fixture(t);
  const { store, actor, context } = boundRun(t, f, new Date(Date.now() + 600000).toISOString());
  const candidates = [{ host: 'codex', model: 'gpt-6-astra', effort: 'high' }, ...f.candidates];
  const timeouts = [];
  const dispatch = timeoutMs => executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, candidates, substitutionReason: 'First host unavailable', timeoutMs } }, { resourceContext: context, runAgent: options => {
    timeouts.push(options.timeoutMs);
    if (options.host === 'codex') throw new Error('Fixture host unavailable before process launch');
    return mockAgent(options);
  } });
  try {
    await assert.rejects(dispatch(300000), { code: 'operation-time-limit', message: /2 attempt\(s\) of up to 300000 ms each, needing 660000 ms including a 60000 ms exit margin/ });
    assert.equal(store.read().workers.length, 0);
    assert.equal(fs.existsSync(path.join(f.root, '.nightshift/runs/reviews')), false);
    assert.deepEqual(timeouts, []);
    const result = await dispatch(240000);
    assert.equal(result.receipt.attempts.length, 2);
    assert.deepEqual(timeouts, [240000, 240000]);
  } finally { store.close(); }
});

test('each attempt ends before the launcher operation deadline and a spent bound stops the fallback', async t => {
  const f = fixture(t);
  const timeouts = [];
  const { receipt } = await dispatchReview(f.root, { ...f, timeoutMs: 900000, operationDeadlineUtc: new Date(Date.now() + 160000).toISOString() }, { runAgent: options => {
    timeouts.push(options.timeoutMs);
    return mockAgent(options);
  } });
  assert.equal(receipt.status, 'complete');
  assert.equal(timeouts.length, 1);
  assert.ok(timeouts[0] <= 100000 && timeouts[0] > 90000, String(timeouts[0]));
  let requestId;
  let calls = 0;
  await assert.rejects(dispatchReview(f.root, { ...f, candidates: [{ host: 'codex', model: 'gpt-6-astra', effort: 'high' }, ...f.candidates], substitutionReason: 'First candidate failed', operationDeadlineUtc: new Date(Date.now() + 30000).toISOString(), onPrepared: request => { requestId = request.id; } }, { runAgent: () => { calls++; throw new Error('Unexpected model call'); } }), { code: 'operation-time-limit' });
  assert.equal(calls, 0);
  const failure = JSON.parse(fs.readFileSync(path.join(f.root, '.nightshift/runs/reviews', requestId, 'failure.json'), 'utf8'));
  assert.equal(failure.attempts.length, 1);
});

test('spec receipt freshness distinguishes pending acceptance from accepted engineering context', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'spec.md'), '# Accepted behavior\n');
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: 'spec', title: 'Spec', kind: 'spec', agreement: { source: 'User', outcome: f.requirements, spec: 'spec.md' } }, { id: 'code', title: 'Code', agreement: { source: 'User', outcome: f.requirements, spec: 'spec.md', specReviewTaskId: 'spec' } }] });
  const act = request => executeWithFixtureController(f.root, { actor, revision: store.read().revision, ...request });
  const dispatch = () => executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: 'spec', review: { ...f, kind: 'spec' } }, { runAgent: options => mockAgent(options, DIMENSIONS.spec) });
  try {
    const stale = await dispatch();
    fs.writeFileSync(path.join(f.root, 'subject.txt'), 'Independent context edit\n');
    await assert.rejects(act({ action: 'review', taskId: 'spec', receipt: path.relative(f.root, stale.receiptFile).split(path.sep).join('/') }), { code: 'invalid-receipt' });
    const current = await dispatch();
    await act({ action: 'review', taskId: 'spec', receipt: path.relative(f.root, current.receiptFile).split(path.sep).join('/') });
    await act({ action: 'advance', taskId: 'spec' });
    assert.equal(store.read().tasks[0].status, 'complete');
    assert.equal(store.read().tasks[0].documentationEvidence, undefined);
    fs.writeFileSync(path.join(f.root, 'subject.txt'), 'Later implementation edit\n');
    await act({ action: 'start-task', taskId: 'code' });
    assert.equal(store.read().tasks[1].status, 'active');
  } finally { store.close(); }
});

for (const interleaved of [true, false]) {
  test(`durable skeptic batches preserve disposition freshness: interleaved=${interleaved}`, async t => {
    const f = fixture(t);
    const store = new RunStore(f.root, { create: true });
    const actor = { host: 'codex', session: 'controller' };
    store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
    const act = request => executeWithFixtureController(f.root, { actor, revision: store.read().revision, taskId: f.taskId, ...request });
    const receiptPath = result => path.relative(f.root, result.receiptFile).split(path.sep).join('/');
    const dispatch = (kind, assigned, output) => executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, kind, findings: assigned } }, { runAgent: options => mockAgent(options, DIMENSIONS.code, { findings: output, session: kind === 'skeptic' ? 'skeptic-session' : 'lead-session' }) });
    try {
      const claims = ['first', 'second'].map(id => ({ id, severity: 'important', required: true, consequence: 'Fixture boundary needs correction', evidence: 'Concrete fixture branch' }));
      const lead = await dispatch('code', [], claims);
      await act({ action: 'review', receipt: receiptPath(lead) });
      const findings = store.read().tasks[0].findings;
      const skeptic = await dispatch('skeptic', findings, findings.map(finding => ({ id: finding.id, verdict: 'confirmed', evidence: 'Fixture counterexample checked', value: 'Required accepted behavior' })));
      for (const finding of findings) await act({ action: 'validate', receipt: receiptPath(skeptic), findingId: finding.id });
      const dispose = finding => act({ action: 'dispose', findingId: finding.id, disposition: 'implement', reason: 'Required accepted behavior', obligation: { classification: 'required', basis: 'The accepted fixture outcome' } });
      await dispose(findings[0]);
      if (interleaved) {
        fs.writeFileSync(path.join(f.root, 'subject.txt'), 'Repair edit\n');
        await assert.rejects(dispose(findings[1]), { code: 'stale-validation' });
        return;
      }
      await dispose(findings[1]);
      fs.writeFileSync(path.join(f.root, 'subject.txt'), 'Repair edit\n');
      await act({ action: 'repair', findingIds: findings.map(finding => finding.id) });
      await act({ action: 'check', check: { name: 'Fixture verification', executable: process.execPath, args: ['--version'], paths: ['subject.txt', 'new.txt'] } });
      const assessed = await dispatch('code', [], []);
      await act({ action: 'review', receipt: receiptPath(assessed) });
      await act({ action: 'advance' });
      await act({ action: 'advance', evidence: 'No additional fixture documentation needed' });
      await act({ action: 'retrospective', evidence: 'Batch ordering considered' });
      await act({ action: 'triage', evidence: 'No pending fixture decisions' });
      await act({ action: 'complete' });
      assert.equal(store.read().status, 'complete');
    } finally { store.close(); }
  });
}

for (const kind of ['spec', 'code', 'skeptic']) {
  test(`explicit ignored artifacts reach ${kind} assessment with complete surrounding context`, async t => {
    const f = fixture(t);
    fs.writeFileSync(path.join(f.root, '.gitignore'), 'private/\r\n.tmp/\r\n');
    fs.mkdirSync(path.join(f.root, 'private'));
    fs.mkdirSync(path.join(f.root, '.tmp'));
    fs.writeFileSync(path.join(f.root, 'private/proposal.md'), 'Complete selected proposal\r\n');
    fs.writeFileSync(path.join(f.root, '.tmp/rationale.md'), 'Selected deciding rationale\r\n');
    fs.writeFileSync(path.join(f.root, 'private/unrelated.txt'), 'Unrelated private input\r\n');
    const artifactPaths = ['private/proposal.md', '.tmp/rationale.md'];
    const result = await dispatchReview(f.root, { ...f, kind, artifactPaths, findings: [] }, { runAgent: options => {
      const copied = path.join(options.cwd, 'project');
      for (const file of [...artifactPaths, 'subject.txt', 'new.txt']) assert.deepEqual(fs.readFileSync(path.join(copied, file)), fs.readFileSync(path.join(f.root, file)));
      assert.equal(fs.existsSync(path.join(copied, 'private/unrelated.txt')), false);
      const manifest = JSON.parse(fs.readFileSync(path.join(options.cwd, 'context/manifest.json'), 'utf8'));
      for (const file of artifactPaths) assert.ok(manifest.files.some(item => item.path === file && item.sha256));
      return mockAgent(options, DIMENSIONS[kind === 'spec' ? 'spec' : 'code']);
    } });
    assert.equal(fresh(f.root, result.receipt.contextSnapshot), true);
    const relative = path.relative(f.root, result.receiptFile).split(path.sep).join('/');
    assert.doesNotThrow(() => readReceipt(f.root, relative, { id: f.runId, controller: { session: 'controller' } }, f.taskId));
    fs.writeFileSync(path.join(f.root, 'private/unrelated.txt'), 'Unrelated private change\r\n');
    assert.equal(fresh(f.root, result.receipt.contextSnapshot), true);
    fs.writeFileSync(path.join(f.root, '.tmp/rationale.md'), 'Changed selected rationale\r\n');
    assert.equal(fresh(f.root, result.receipt.contextSnapshot), false);
    assert.throws(() => readReceipt(f.root, relative, { id: f.runId, controller: { session: 'controller' } }, f.taskId), { code: 'invalid-receipt' });
  });
}

test('explicit artifact selection rejects contradictory or malformed paths before dispatch', async t => {
  const f = fixture(t);
  let calls = 0;
  for (const options of [
    { artifactPaths: ['subject.txt'], excludedPaths: ['subject.txt'] },
    { artifactPaths: 'subject.txt' },
    { artifactPaths: [null] },
    { excludedPaths: 'subject.txt' },
  ]) {
    await assert.rejects(dispatchReview(f.root, { ...f, ...options }, { runAgent: () => { calls++; throw new Error('Unexpected adapter call'); } }), { code: options.artifactPaths?.[0] === 'subject.txt' ? 'conflicting-review-paths' : 'invalid-review-paths' });
  }
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(path.join(f.root, '.nightshift/runs/reviews')), false);
});

test('changing selected ignored material during assessment invalidates the result', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, '.tmp'));
  fs.writeFileSync(path.join(f.root, '.tmp/proposal.md'), 'Original selected proposal\r\n');
  await assert.rejects(dispatchReview(f.root, { ...f, kind: 'spec', artifactPaths: ['.tmp/proposal.md'] }, { runAgent: options => {
    const result = mockAgent(options, DIMENSIONS.spec);
    fs.writeFileSync(path.join(f.root, '.tmp/proposal.md'), 'Changed selected proposal\r\n');
    return result;
  } }), { code: 'review-input-drift' });
});

test('Windows aliases cannot bypass file exclusions or duplicate selected material', { skip: process.platform !== 'win32' }, async t => {
  for (const [selected, excluded] of [[['SUBJECT.TXT'], ['subject.txt']], [['subject.txt'], ['SUBJECT.TXT']]]) {
    const f = fixture(t);
    let calls = 0;
    await assert.rejects(dispatchReview(f.root, { ...f, artifactPaths: selected, excludedPaths: excluded }, { runAgent: () => { calls++; throw new Error('Unexpected adapter call'); } }), { code: 'conflicting-review-paths' });
    assert.equal(calls, 0);
  }
  const excludedFixture = fixture(t);
  await dispatchReview(excludedFixture.root, { ...excludedFixture, excludedPaths: ['SUBJECT.TXT'] }, { runAgent: options => {
    assert.equal(fs.existsSync(path.join(options.cwd, 'project/subject.txt')), false);
    const diff = fs.readFileSync(path.join(options.cwd, 'context/diff.patch'), 'utf8');
    assert.doesNotMatch(diff, /subject\.txt|\+after|\-before/);
    return mockAgent(options);
  } });
  for (const ignored of [false, true]) {
    const f = fixture(t);
    const selected = ignored ? '.tmp/proposal.md' : 'subject.txt';
    if (ignored) {
      fs.mkdirSync(path.join(f.root, '.tmp'));
      fs.writeFileSync(path.join(f.root, selected), 'One selected file\r\n');
    }
    const result = await dispatchReview(f.root, { ...f, artifactPaths: [selected, selected.toUpperCase()] }, { runAgent: options => {
      assert.deepEqual(fs.readFileSync(path.join(options.cwd, 'project', selected)), fs.readFileSync(path.join(f.root, selected)));
      return mockAgent(options);
    } });
    assert.equal(result.receipt.contextSnapshot.files.filter(file => file.path.toUpperCase() === selected.toUpperCase()).length, 1);
  }
});

for (const staged of [false, true]) {
  test(`absent exclusions require exact historical spelling with staged deletion=${staged}`, { skip: process.platform !== 'win32' }, async t => {
    const f = fixture(t);
    fs.unlinkSync(path.join(f.root, 'subject.txt'));
    if (staged) git(f.root, ['add', '--update', 'subject.txt']);
    let calls = 0;
    await assert.rejects(dispatchReview(f.root, { ...f, excludedPaths: ['SUBJECT.TXT'] }, { runAgent: () => { calls++; throw new Error('Unexpected adapter call'); } }), { code: 'unresolved-review-exclusion' });
    assert.equal(calls, 0);
    await dispatchReview(f.root, { ...f, excludedPaths: ['subject.txt'] }, { runAgent: options => {
      assert.equal(fs.existsSync(path.join(options.cwd, 'project/subject.txt')), false);
      assert.doesNotMatch(fs.readFileSync(path.join(options.cwd, 'context/diff.patch'), 'utf8'), /subject\.txt|\-before/);
      return mockAgent(options);
    } });
  });
}

test('directory exclusions are rejected before assessment', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'private'));
  let calls = 0;
  for (const [excluded, code] of [['private', 'invalid-review-paths'], ['private/', 'unsafe-path']]) {
    await assert.rejects(dispatchReview(f.root, { ...f, excludedPaths: [excluded] }, { runAgent: () => { calls++; throw new Error('Unexpected adapter call'); } }), { code });
  }
  assert.equal(calls, 0);
});

test('distinct Unicode filenames do not become aliases through text folding', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.root, 'private'));
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'private/\r\n');
  const excluded = 'private/stra\u00dfe.md';
  const selected = 'private/STRASSE.md';
  fs.writeFileSync(path.join(f.root, excluded), 'Excluded distinct file\r\n');
  fs.writeFileSync(path.join(f.root, selected), 'Selected distinct file\r\n');
  await dispatchReview(f.root, { ...f, artifactPaths: [selected], excludedPaths: [excluded] }, { runAgent: options => {
    assert.equal(fs.existsSync(path.join(options.cwd, 'project', excluded)), false);
    assert.equal(fs.readFileSync(path.join(options.cwd, 'project', selected), 'utf8'), 'Selected distinct file\r\n');
    return mockAgent(options);
  } });
});

test('unavailable filesystem identity is not treated as a distinct safe file', t => {
  const f = fixture(t);
  t.mock.method(fs, 'lstatSync', () => ({ dev: 0n, ino: 0n, isDirectory: () => false }));
  try { assert.throws(() => fileIdentity(f.root, 'subject.txt'), { code: 'file-identity-unavailable' }); }
  finally { t.mock.restoreAll(); }
});

test('a receipt cannot shrink its snapshot after the reviewed files change', async t => {
  const f = fixture(t);
  const { receiptFile, receipt } = await dispatchReview(f.root, f, { runAgent: mockAgent });
  receipt.snapshot.files.pop();
  fs.writeFileSync(receiptFile, JSON.stringify(receipt) + '\n');
  const relative = path.relative(f.root, receiptFile).split(path.sep).join('/');
  assert.throws(() => readReceipt(f.root, relative, { id: f.runId, controller: { session: 'controller' } }, f.taskId), { code: 'changed-assignment' });
});

test('rejected initial bases cannot pin an unusable cumulative scope', async t => {
  const f = fixture(t);
  const store = new RunStore(f.root, { create: true });
  const actor = { host: 'codex', session: 'controller' };
  store.create({ objective: f.requirements, authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Work', agreement: { source: 'User', outcome: f.requirements } }] });
  try {
    for (const baseSha of ['invalid', 'f'.repeat(40)]) {
      await assert.rejects(executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, baseSha } }, { runAgent: mockAgent }));
      assert.equal(store.read().baseSha, undefined);
      assert.equal(store.read().workers.length, 0);
    }
    const result = await executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: f }, { runAgent: mockAgent });
    assert.equal(result.receipt.status, 'complete');
    assert.equal(store.read().baseSha, f.baseSha);
  } finally { store.close(); }
});

for (const changedId of ['current', 'earlier']) {
  test(`an in-flight report cannot accept changed ${changedId} commitments`, async t => {
    const f = fixture(t);
    const store = new RunStore(f.root, { create: true });
    const actor = { host: 'codex', session: 'controller' };
    store.create({ objective: 'Accepted fixture outcomes', authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: ['earlier', 'current'].map(id => ({ id, title: id, agreement: { source: 'User', outcome: 'Original ' + id } })) });
    store.update(actor, store.read().revision, 'fixture-prior-work', state => { state.tasks[0].status = 'complete'; });
    let start;
    let release;
    const started = new Promise(resolve => { start = resolve; });
    const paused = new Promise(resolve => { release = resolve; });
    try {
      const pending = executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: 'current', review: { ...f, kind: 'code' } }, { runAgent: async options => {
        assert.equal(options.prompt.includes('Newly required behavior'), false);
        start();
        await paused;
        return mockAgent(options);
      } });
      await started;
      await executeWithFixtureController(f.root, { action: 'block', actor, revision: store.read().revision, taskId: changedId, blocker: { kind: 'user-decision', reason: 'Consequential behavior needs clarification', recoveryAttempted: 'Inspected actual boundary' } });
      await executeWithFixtureController(f.root, { action: 'unblock', actor, revision: store.read().revision, taskId: changedId, evidence: 'User explicitly confirmed the revised outcome', updatedOutcome: 'Newly required behavior' });
      release();
      const result = await pending;
      await assert.rejects(executeWithFixtureController(f.root, { action: 'review', actor, revision: store.read().revision, taskId: 'current', receipt: path.relative(f.root, result.receiptFile).split(path.sep).join('/') }), { code: 'stale-commitments' });
      assert.equal(store.read().tasks[1].reviews.length, 0);
    } finally { release?.(); store.close(); }
  });
}

for (const kind of ['docs', 'lore']) {
  test(`standalone ${kind} accepts direct assessment and preserves closing on a no-edit refresh`, async t => {
    const f = fixture(t);
    const actor = { host: 'codex', session: 'controller' };
    const store = new RunStore(f.root, { create: true });
    store.create({ objective: 'Assess the standalone artifact', authority: 'User requested standalone maintenance', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: [{ id: f.taskId, title: 'Standalone maintenance', kind, agreement: { source: 'User', outcome: 'Review the requested artifact and retain any instruction approval as pending' } }] });
    const act = request => executeWithFixtureController(f.root, { actor, revision: store.read().revision, taskId: f.taskId, ...request });
    const assess = async () => {
      const result = await executeWithFixtureController(f.root, { action: 'dispatch', actor, revision: store.read().revision, taskId: f.taskId, review: { ...f, kind: 'code' } }, { runAgent: options => mockAgent(options) });
      await act({ action: 'review', receipt: path.relative(f.root, result.receiptFile).split(path.sep).join('/') });
    };
    try {
      await act({ action: 'start-task' });
      await assess();
      await act({ action: 'advance' });
      assert.equal(store.read().tasks[0].stage, kind === 'lore' ? 'retrospective' : 'documentation');
      await act({ action: 'advance', evidence: 'Reviewed maintenance completed without applying instructions' });
      if (kind === 'docs') await act({ action: 'retrospective', evidence: 'No additional instruction proposal' });
      await act({ action: 'followup', item: { id: 'approval', context: 'The reviewed instruction proposal is awaiting the user', recommendation: 'Consider the unchanged reviewed proposal', decisionTerms: ['approve', 'adjust', 'revert'] } });
      await act({ action: 'triage', evidence: 'Original approval terms retained as pending' });
      const closing = store.read().closing;
      await assess();
      assert.equal(store.read().tasks[0].resumeStage, 'complete');
      await act({ action: 'advance' });
      assert.equal(store.read().tasks[0].status, 'complete');
      assert.deepEqual(store.read().closing, closing);
      assert.equal(store.read().followups[0].status, 'pending');
      await act({ action: 'complete' });
      assert.equal(store.read().status, 'complete');
    } finally { store.close(); }
  });
}
