'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { execute } = require('../internal/runtime/cli');
const { RunStore } = require('../internal/runtime/store');
const { ReviewStore } = require('../internal/runtime/review-store');
const { DIMENSIONS, assertAction, commitmentsFor, transition } = require('../internal/runtime/lifecycle');
const { snapshot } = require('../internal/runtime/evidence');
const { fixtureAcknowledgement } = require('./fixtures/acknowledgement');
const { completeReflection } = require('./fixtures/completion');

const scratch = path.resolve(__dirname, '../.tmp/delivery-tests');
fs.mkdirSync(scratch, { recursive: true });
const actor = { host: 'codex', session: 'delivery-controller' };
const owner = { pid: 12345, created: 'fixture-process', name: 'codex.exe' };
const dependencies = { nativeOwner: () => owner, ownerAlive: () => true, acknowledgementObserver: fixtureAcknowledgement };

function project(t) {
  const root = fs.mkdtempSync(path.join(scratch, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function fixtureAssessment(store, kind, overrides = {}) {
  return store.update(actor, store.read().revision, 'fixture-assessment', state => transition(state, {
    action: 'review', taskId: '#review',
    review: { kind, status: 'complete', strength: 'strong', session: 'independent-' + kind, independent: true, broad: true, attributionVerified: true, coverageEvidence: 'Fixture assessment covers the complete subject', dimensions: [...DIMENSIONS[kind]], commitments: commitmentsFor(state.tasks), snapshot: snapshot(store.root, ['AGENTS.md']), findings: [], ...overrides },
  }));
}

for (const invalid of ['stale', 'incomplete', 'continued']) {
  for (const action of ['advance', 'complete']) {
    test(`standalone docs ${action} preserves its ${invalid} code-assessment obligation`, async t => {
      const root = project(t);
      fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Original instruction\r\n');
      const context = await execute(root, { action: 'open-review', reviewContextId: randomUUID(), controller: actor, authority: 'Explicit revise-docs request', objective: 'Reconcile instruction documentation', kind: 'docs', agreement: { source: 'fixture user', outcome: 'Keep code and docs assurance current' } }, dependencies);
      const store = new ReviewStore(root, { contextId: context.id });
      try {
        fixtureAssessment(store, 'code', invalid === 'incomplete' ? { status: 'incomplete' } : invalid === 'continued' ? { continues: { kind: 'resumed', requestId: 'previous-assessment', session: 'independent-code' } } : {});
        if (invalid === 'stale') fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Changed instruction\r\n');
        fixtureAssessment(store, 'docs');
        // Completion also checks an inherited task that an earlier implementation marked complete.
        if (action === 'complete') store.update(actor, store.read().revision, 'fixture-inherited-completion', state => { state.tasks[0].status = 'complete'; state.tasks[0].stage = 'complete'; });
        await assert.rejects(execute(root, { action, reviewContextId: context.id, actor, revision: store.read().revision, evidence: 'Fresh docs cannot replace code assurance' }, dependencies), { code: 'review-required' });
        assert.notEqual(store.read().status, 'complete');
      } finally { store.close(); }
    });
  }
}

function committedProject(t, files) {
  const root = project(t);
  const git = args => assert.equal(spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).status, 0);
  git(['init', '--quiet']);
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(root, file), content);
  git(['add', '.']);
  git(['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish standalone baseline']);
  return root;
}

test('standalone docs revision completes through a mechanical exemption only while its inventory is unchanged', async t => {
  const root = committedProject(t, { 'README.md': '# Fixture\n\n1.0.0\n' });
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n\n1.0.1\n');
  const open = kind => execute(root, { action: 'open-review', reviewContextId: randomUUID(), controller: actor, authority: `Explicit revise-${kind} request`, objective: 'Bump the documented version', kind, agreement: { source: 'fixture user', outcome: 'Record the version-only change' } }, dependencies);
  const exempt = context => execute(root, { action: 'advance', reviewContextId: context.id, actor, revision: context.revision, evidence: 'Only the version string changed', docsExemption: 'Purely mechanical version-string update' }, dependencies);

  const code = await open('code');
  await assert.rejects(exempt(code), { code: 'invalid-exemption' });
  await execute(root, { action: 'stop', reviewContextId: code.id, actor, revision: code.revision, kind: 'user-stop', reason: 'Fixture moves on to the docs context' }, dependencies);

  const context = await open('docs');
  const advanced = await exempt(context);
  assert.deepEqual(advanced.docsExemptions.map(({ taskId, reason, current }) => ({ taskId, reason, current })), [{ taskId: '#review', reason: 'Purely mechanical version-string update', current: true }]);
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n\n1.0.1, with a judgment edit\n');
  await assert.rejects(execute(root, { action: 'complete', reviewContextId: context.id, actor, revision: advanced.revision }, dependencies), { code: 'docs-review-required' });
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n\n1.0.1\n');
  assert.equal((await execute(root, { action: 'complete', reviewContextId: context.id, actor, revision: advanced.revision }, dependencies)).status, 'complete');

  const reviewed = await open('docs');
  const store = new ReviewStore(root, { contextId: reviewed.id });
  try {
    fixtureAssessment(store, 'docs', { snapshot: snapshot(root, ['README.md']) });
    await assert.rejects(exempt(store.read()), { code: 'invalid-exemption' });
  } finally { store.close(); }
});

test('standalone code preserves an imported docs assessment when code is refreshed', async t => {
  const root = project(t);
  fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Original instruction\r\n');
  const context = await execute(root, { action: 'open-review', reviewContextId: randomUUID(), controller: actor, authority: 'Explicit revise-code request', objective: 'Assess the instruction', kind: 'code', agreement: { source: 'fixture user', outcome: 'Keep imported assurance current' } }, dependencies);
  const store = new ReviewStore(root, { contextId: context.id });
  try {
    fixtureAssessment(store, 'docs');
    fs.writeFileSync(path.join(root, 'AGENTS.md'), 'Changed instruction\r\n');
    fixtureAssessment(store, 'code');
    store.update(actor, store.read().revision, 'fixture-check', state => transition(state, { action: 'check', taskId: '#review', evidence: { name: 'Instruction assertion', passed: true, snapshot: snapshot(root, ['AGENTS.md']), output: 'Fixture instruction checked' } }));
    await assert.rejects(execute(root, { action: 'advance', reviewContextId: context.id, actor, revision: store.read().revision, evidence: 'Code alone cannot replace imported docs assurance' }, dependencies), { code: 'docs-review-required' });
  } finally { store.close(); }
});

test('invalidation and resumption preserve the continuation observation obligation', async t => {
  const root = project(t);
  const accepted = await execute(root, deliveryRequest('handover'), dependencies);
  const reason = 'The goal service could not be inspected';
  let state = await execute(root, { action: 'invalidate-continuation', actor, revision: accepted.revision, reason }, dependencies);
  await assert.rejects(execute(root, { action: 'start-task', taskId: 'subject', actor, revision: state.revision }, dependencies), { code: 'continuation-observation-required' });
  state = await execute(root, { action: 'continuation', actor, revision: state.revision, mechanism: { verified: false, kind: 'goal', reason } }, dependencies);
  state = await execute(root, { action: 'start-task', taskId: 'subject', actor, revision: state.revision }, dependencies);
  state = await execute(root, { action: 'invalidate-continuation', actor, revision: state.revision, reason }, dependencies);
  assert.equal(state.continuation.status, 'unobserved');
  assert.equal(state.followups.length, 1);
  state = await execute(root, { action: 'hold', actor, revision: state.revision, authority: 'Explicit user hold', reason: 'Wait for user' }, dependencies);
  state = await execute(root, { action: 'resume', actor, revision: state.revision, authority: 'Explicit user resume' }, dependencies);
  await assert.rejects(execute(root, { action: 'start-task', taskId: 'subject', actor, revision: state.revision }, dependencies), { code: 'continuation-observation-required' });
  state = await execute(root, { action: 'continuation', actor, revision: state.revision, mechanism: { verified: true, kind: 'goal', evidence: 'Goal observed active after resumption' } }, dependencies);
  assert.equal((await execute(root, { action: 'start-task', taskId: 'subject', actor, revision: state.revision }, dependencies)).status, 'running');
  assert.equal(state.followups.length, 1);
});

test('native goal holds and token limits cannot masquerade as technical continuation failures', async t => {
  const root = project(t);
  const state = await execute(root, deliveryRequest('handover'), dependencies);
  for (const status of ['paused', 'stopped', 'limited', 'usageLimited', 'budgetLimited']) {
    await assert.rejects(execute(root, { action: 'continuation', actor, revision: state.revision, mechanism: { verified: false, kind: 'goal', status, reason: 'An authoritative native stop' } }, dependencies), { code: 'continuation-held' });
  }
});

for (const outcome of ['success', 'failure']) {
  test(`closing execution preserves pending observation and recovers through ${outcome}`, async t => {
    const root = project(t);
    fs.writeFileSync(path.join(root, 'subject.txt'), 'Fixture closing input\r\n');
    const store = new RunStore(root, { create: true });
    try {
      store.create({ ...deliveryRequest('handover'), mechanism: { verified: true, kind: 'goal', evidence: 'Fixture goal active' } });
      const act = request => store.update(actor, store.read().revision, request.action, state => transition(state, request));
      store.update(actor, store.read().revision, 'fixture-closing-record', state => {
        state.closing = { retrospectiveEvidence: 'Fixture reflection', triageEvidence: 'Fixture decisions preserved', docs: { id: '#closing', kind: 'closing', requires: [], agreement: { source: 'Fixture closing', outcome: 'Review closing documentation' }, reviews: [], findings: [], checks: [], baseline: snapshot(root, ['subject.txt']) } };
      });
      act({ action: 'hold', authority: 'Fixture user hold', reason: 'Await resumption' });
      act({ action: 'resume', authority: 'Fixture user resume' });
      for (const action of ['check', 'probe', 'dispatch']) assert.throws(() => assertAction(store.read(), { action, taskId: '#closing' }), { code: 'continuation-observation-required' });
      for (const action of ['review', 'validate', 'dialogue']) assert.doesNotThrow(() => assertAction(store.read(), { action, taskId: '#closing' }));
      act({ action: 'continuation', mechanism: outcome === 'success' ? { verified: true, kind: 'goal', evidence: 'Fixture goal observed after resume' } : { verified: false, kind: 'goal', reason: 'Fixture goal service unavailable after resume' } });
      for (const action of ['check', 'probe', 'dispatch']) assert.doesNotThrow(() => assertAction(store.read(), { action, taskId: '#closing' }));
      store.update(actor, store.read().revision, 'fixture-completed-delivery', state => { state.status = 'complete'; state.continuation = null; });
      assert.doesNotThrow(() => assertAction(store.read(), { action: 'dispatch', taskId: '#closing' }));
    } finally { store.close(); }
  });
}

test('empty review selectors cannot silently target the active delivery', async t => {
  const root = project(t);
  const state = await execute(root, { ...deliveryRequest('handover'), mechanism: { verified: true, kind: 'goal', evidence: 'Fixture goal active' } }, dependencies);
  for (const reviewContextId of ['', null, undefined]) {
    await assert.rejects(execute(root, { action: 'worker', reviewContextId, actor, revision: state.revision, worker: { id: 'writer', session: 'writer', assignment: 'Own a file', role: 'implementer', writes: ['shared.js'] } }, dependencies), { code: 'invalid-review-context' });
  }
  await assert.rejects(execute(root, { action: 'status', runId: null, reviewContextId: randomUUID() }, dependencies), { code: 'invalid-runtime-target' });
  const store = new RunStore(root);
  try { assert.deepEqual(store.read().workers, []); } finally { store.close(); }
});

function deliveryRequest(action) {
  return {
    action,
    controller: actor,
    authority: 'The user agreed an ordinary chat request',
    objective: 'Make the requested edit',
    tasks: [{ id: 'subject', title: 'Requested edit', agreement: { source: 'ordinary chat', outcome: 'Apply the agreed edit' } }],
  };
}

function deliveryRows(store) {
  const tables = store.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return JSON.stringify(Object.fromEntries(tables.map(({ name }) => [name, store.db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()])));
}

function reflectionRequest() {
  return { ...deliveryRequest('handover'), handoverId: randomUUID(), mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] };
}

for (const damage of ['stale-selection', 'contradictory-row', 'matching-contradictory-history', 'rollback', 'missing-journal', 'corrupt-journal', 'missing-frontier']) {
  for (const writes of [[], ['shared.js']]) {
    test(`replacement preserves committed obligations after ${damage} with ${writes.length ? 'writer' : 'reader'}`, async t => {
      const root = project(t);
      const request = reflectionRequest();
      const first = await execute(root, request, dependencies);
      let current = first;
      if (damage === 'stale-selection') {
        await completeReflection(root, actor, execute, dependencies);
        current = await execute(root, reflectionRequest(), dependencies);
      }
      const beforeWorker = current.revision;
      await execute(root, { action: 'worker', actor, revision: current.revision, worker: { id: 'outstanding', session: 'fixture-worker', role: writes.length ? 'implementer' : 'reviewer', assignment: 'Preserve unresolved assessment', writes } }, dependencies);
      const store = new RunStore(root);
      try {
        for (let index = 0; index < 3; index++) assert.equal(store.remind(actor, store.read().revision, () => true).issued, true);
        const outstanding = store.read();
        const raw = store.db.prepare('SELECT state FROM runs WHERE id=?').get(outstanding.id).state;
        if (damage === 'stale-selection') store.db.prepare('UPDATE active SET id=?').run(first.id);
        if (['contradictory-row', 'matching-contradictory-history'].includes(damage)) {
          const changed = JSON.parse(raw);
          changed.status = 'complete';
          changed.workers = [];
          changed.tasks.forEach(task => { task.status = 'complete'; task.stage = 'complete'; });
          store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(changed), outstanding.id);
          if (damage === 'matching-contradictory-history') store.db.prepare('UPDATE history SET state=? WHERE run_id=? AND revision=?').run(JSON.stringify(changed), outstanding.id, outstanding.revision);
        }
        if (damage === 'rollback') {
          const older = store.db.prepare('SELECT state FROM history WHERE run_id=? AND revision=?').get(outstanding.id, beforeWorker).state;
          store.db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(beforeWorker, older, outstanding.id);
        }
        if (damage === 'missing-journal') store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision=?').run(outstanding.id, outstanding.revision);
        if (damage === 'corrupt-journal') {
          const checkpoint = store.db.prepare('SELECT artifact FROM accounting_commits WHERE run_id=? AND revision=?').get(outstanding.id, outstanding.revision).artifact;
          store.db.prepare("UPDATE artifacts SET body=body || ' ' WHERE id=?").run(checkpoint);
        }
        if (damage === 'missing-frontier') store.db.prepare('DELETE FROM artifacts WHERE id=?').run(outstanding.progress.frontierHash);
        const before = deliveryRows(store);
        for (const retry of [reflectionRequest(), damage === 'stale-selection' ? request : { ...request, handoverId: outstanding.acceptance.handoverId }]) {
          await assert.rejects(execute(root, retry, dependencies), { code: 'delivery-consistency-unavailable' });
          assert.equal(deliveryRows(store), before);
        }
        const candidate = { ...structuredClone(outstanding), id: randomUUID(), revision: 0 };
        assert.throws(() => store.transaction(() => store.save(candidate, 'fixture-fresh-identity')), { code: 'delivery-consistency-unavailable' });
        assert.equal(deliveryRows(store), before);
      } finally { store.close(); }
    });
  }
}

test('exact replay preserves independently attested pressure after metadata-only loss', async t => {
  const root = project(t);
  const request = reflectionRequest();
  await execute(root, request, dependencies);
  const store = new RunStore(root);
  try {
    for (let index = 0; index < 3; index++) store.remind(actor, store.read().revision, () => true);
    const row = store.db.prepare('SELECT id, revision, state FROM runs').get();
    const state = JSON.parse(row.state);
    delete state.progress;
    delete state.stopRecovery;
    store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), row.id);
    store.db.prepare('UPDATE history SET state=? WHERE run_id=? AND revision=?').run(JSON.stringify(state), row.id, row.revision);
    const before = deliveryRows(store);
    const replay = await execute(root, request, dependencies);
    assert.equal(replay.id, row.id);
    assert.equal(deliveryRows(store), before);
    assert.equal(store.remind(actor, row.revision, () => true).reason, 'exhausted');
    await assert.rejects(execute(root, reflectionRequest(), dependencies), { code: 'overlapping-run' });
    assert.equal(deliveryRows(store), before);
  } finally { store.close(); }
});

test('admitted reflection completion supports replay and new delivery while preserving history', async t => {
  const root = project(t);
  const request = reflectionRequest();
  const first = await execute(root, request, dependencies);
  await completeReflection(root, actor, execute, dependencies);
  const store = new RunStore(root);
  try {
    const before = deliveryRows(store);
    assert.equal((await execute(root, request, dependencies)).id, first.id);
    assert.equal(deliveryRows(store), before);
    const second = await execute(root, reflectionRequest(), dependencies);
    assert.notEqual(second.id, first.id);
    assert.equal(store.read().id, second.id);
    assert.ok(store.transitions(first.id).some(row => row.kind === 'complete'));
  } finally { store.close(); }
});

for (const loss of ['row', 'pointer', 'both']) {
  for (const acceptance of ['known', 'none', 'missing']) {
    for (const writes of [[], ['shared.js']]) {
      test(`delivery creation preserves ${acceptance} acceptance after ${loss} loss with ${writes.length ? 'writer' : 'reader'} ownership`, async t => {
        const root = project(t);
        const request = { ...deliveryRequest('handover'), ...(acceptance === 'known' ? { handoverId: randomUUID() } : {}), mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' } };
        const created = await execute(root, request, dependencies);
        await execute(root, { action: 'worker', actor, revision: created.revision, worker: { id: 'outstanding', session: 'fixture-worker', role: 'implementer', assignment: 'Retain outstanding ownership', writes } }, dependencies);
        const store = new RunStore(root);
        try {
          if (acceptance === 'missing') store.update(actor, store.read().revision, 'fixture-historical-shape', state => { delete state.acceptance; });
          for (let index = 0; index < 3; index++) assert.equal(store.remind(actor, store.read().revision, () => true).issued, true);
          const original = store.read();
          assert.equal(original.stopRecovery.reminders, 3);
          assert.equal(original.workers[0].id, 'outstanding');
          store.db.exec('PRAGMA foreign_keys=OFF');
          if (loss !== 'pointer') store.db.prepare('DELETE FROM runs WHERE id=?').run(original.id);
          if (loss !== 'row') store.db.exec('DELETE FROM active');
          const before = deliveryRows(store);
          for (const retry of [request, { ...request, handoverId: randomUUID() }, { ...request, runId: original.id }]) {
            await assert.rejects(execute(root, retry, dependencies), error => ['missing-predecessor', 'wrong-run'].includes(error.code));
            assert.equal(deliveryRows(store), before);
          }
          const candidate = { ...structuredClone(original), id: randomUUID(), revision: 0 };
          assert.throws(() => store.transaction(() => store.save(candidate, 'fixture-direct-creation')), { code: 'missing-predecessor' });
          assert.equal(deliveryRows(store), before);
        } finally { store.close(); }
      });
    }
  }
}

for (const retained of ['active', 'runs', 'artifacts', 'accounting_commits', 'discharge_index']) {
  test(`delivery creation refuses isolated surviving ${retained} evidence`, async t => {
    const root = project(t);
    const request = { ...deliveryRequest('handover'), handoverId: randomUUID() };
    const created = await execute(root, request, dependencies);
    const store = new RunStore(root);
    try {
      if (retained === 'discharge_index') store.db.prepare('INSERT INTO discharge_index VALUES (?, ?, ?, ?, ?)').run(created.id, 'fixture-evidence', 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64));
      store.db.exec('PRAGMA foreign_keys=OFF');
      for (const table of ['active', 'runs', 'history', 'artifacts', 'accounting_commits', 'discharge_index']) if (table !== retained) store.db.exec(`DELETE FROM ${table}`);
      assert.ok(store.db.prepare(`SELECT 1 FROM ${retained} LIMIT 1`).get());
      const before = deliveryRows(store);
      await assert.rejects(execute(root, request, dependencies), { code: 'missing-predecessor' });
      assert.equal(deliveryRows(store), before);
    } finally { store.close(); }
  });
}

test('central save cannot replace an unfinished delivery with a fresh identity', async t => {
  const root = project(t);
  await execute(root, deliveryRequest('handover'), dependencies);
  const store = new RunStore(root);
  try {
    const before = deliveryRows(store);
    const candidate = { ...structuredClone(store.read()), id: randomUUID(), revision: 0 };
    assert.throws(() => store.transaction(() => store.save(candidate, 'fixture-direct-creation')), { code: 'overlapping-run' });
    assert.equal(deliveryRows(store), before);
  } finally { store.close(); }
});

test('delivery creation refuses orphaned history behind a valid completed current record', async t => {
  const root = project(t);
  const request = { ...deliveryRequest('handover'), handoverId: randomUUID(), tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without proposals' } }] };
  const first = await execute(root, request, dependencies);
  const store = new RunStore(root);
  try {
    await completeReflection(root, actor, execute, dependencies);
    const second = await execute(root, { ...request, handoverId: randomUUID() }, dependencies);
    await completeReflection(root, actor, execute, dependencies);
    store.db.exec('PRAGMA foreign_keys=OFF');
    store.db.prepare('DELETE FROM runs WHERE id=?').run(first.id);
    const before = deliveryRows(store);
    await assert.rejects(execute(root, { ...request, handoverId: randomUUID() }, dependencies), { code: 'missing-predecessor' });
    assert.equal(deliveryRows(store), before);
  } finally { store.close(); }
});

test('delivery selection refuses a stored identity that contradicts its row', async t => {
  const root = project(t);
  const request = { ...deliveryRequest('handover'), handoverId: randomUUID() };
  await execute(root, request, dependencies);
  const store = new RunStore(root);
  try {
    const current = store.db.prepare('SELECT id, state FROM runs').get();
    const state = JSON.parse(current.state);
    state.id = randomUUID();
    store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), current.id);
    const before = deliveryRows(store);
    await assert.rejects(execute(root, request, dependencies), { code: 'delivery-consistency-unavailable' });
    assert.equal(deliveryRows(store), before);
  } finally { store.close(); }
});

test('delivery acceptance rejects review selectors and standalone creation rejects queues before storage', async t => {
  for (const reviewContextId of [randomUUID(), null, '', undefined]) {
    const root = project(t);
    await assert.rejects(execute(root, { ...deliveryRequest('handover'), reviewContextId }, dependencies), { code: 'invalid-runtime-target' });
    assert.equal(fs.existsSync(path.join(root, '.nightshift/runs/state.sqlite')), false);
    assert.equal(fs.existsSync(path.join(root, '.nightshift/runs/review-state.sqlite')), false);
  }
  const root = project(t);
  const context = await execute(root, { action: 'open-review', reviewContextId: randomUUID(), controller: actor, kind: 'spec', authority: 'Explicit revision', objective: 'Assess a spec', agreement: { source: 'User', outcome: 'Independent assessment' } }, dependencies);
  const store = new ReviewStore(root, { contextId: context.id });
  try {
    const before = JSON.stringify(store.read());
    await assert.rejects(execute(root, { ...deliveryRequest('handover'), reviewContextId: randomUUID() }, dependencies), { code: 'invalid-runtime-target' });
    assert.equal(JSON.stringify(store.read()), before);
    assert.throws(() => store.create(deliveryRequest('handover')), { code: 'invalid-runtime-target' });
  } finally { store.close(); }
});

test('acceptance replay preserves adopted-owner authority and completed records', async t => {
  const root = project(t);
  const request = { ...deliveryRequest('handover'), handoverId: randomUUID(), tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without proposals' } }] };
  const original = await execute(root, request, dependencies);
  const store = new RunStore(root);
  try {
    store.update(actor, original.revision, 'fixture transfer', state => { state.controller = { host: 'codex', session: 'successor' }; state.controllerClaim = null; state.status = 'stopped'; state.continuation = null; });
    const before = JSON.stringify(store.read());
    const history = store.transitions(original.id).length;
    await assert.rejects(execute(root, request, dependencies), { code: 'wrong-owner' });
    assert.equal(JSON.stringify(store.read()), before);
    assert.equal(store.transitions(original.id).length, history);
    store.update({ host: 'codex', session: 'successor' }, store.read().revision, 'fixture restore', state => { state.controller = actor; state.status = 'running'; });
    await completeReflection(root, actor, execute, dependencies);
    const completed = JSON.stringify(store.read());
    const rows = store.transitions(original.id).length;
    await execute(root, request, dependencies);
    assert.equal(JSON.stringify(store.read()), completed);
    assert.equal(store.transitions(original.id).length, rows);
  } finally { store.close(); }
});

test('historical acceptance identity cannot replace another active record', async t => {
  const root = project(t);
  const request = { ...deliveryRequest('handover'), handoverId: randomUUID(), tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without proposals' } }] };
  const first = await execute(root, request, dependencies);
  const store = new RunStore(root);
  try {
    await completeReflection(root, actor, execute, dependencies);
    await execute(root, { ...request, handoverId: randomUUID() }, dependencies);
    const before = JSON.stringify(store.read());
    await assert.rejects(execute(root, request, dependencies), { code: 'handover-identity-conflict' });
    assert.equal(JSON.stringify(store.read()), before);
  } finally { store.close(); }
});

test('a direct create request cannot turn ordinary chat agreement into a delivery run', async t => {
  const root = project(t);
  await assert.rejects(execute(root, deliveryRequest('create'), dependencies), error => error.code === 'invalid-request' || error.code === 'handover-required');
  assert.equal(fs.existsSync(path.join(root, '.nightshift/runs/state.sqlite')), false);
});

test('handover records delivery authority without introducing execution modes', async t => {
  const root = project(t);
  const request = deliveryRequest('handover');
  request.authority = 'The user handed over the confirmed scope';
  const state = await execute(root, request, dependencies);
  assert.equal(state.kind, 'delivery');
  assert.deepEqual(state.handover, { authority: request.authority, revision: 0 });
  assert.equal(Object.hasOwn(state, 'mode'), false);
});

test('a preserved handover identity reconciles lost replies and refuses changed scope', async t => {
  const root = project(t);
  const request = { ...deliveryRequest('handover'), handoverId: randomUUID() };
  const accepted = await execute(root, request, dependencies);
  const repeated = await execute(root, request, dependencies);
  assert.equal(repeated.id, accepted.id);
  assert.equal(repeated.revision, accepted.revision);
  await assert.rejects(execute(root, { ...request, mode: 'attended' }, dependencies), { code: 'invalid-mode' });
  await assert.rejects(execute(root, { ...request, objective: 'Different accepted work' }, dependencies), { code: 'handover-conflict' });
});

test('an explicit hold preserves handover and requires authorized resumption', async t => {
  const root = project(t);
  const accepted = await execute(root, { ...deliveryRequest('handover'), mechanism: { verified: true, kind: 'goal', evidence: 'Fixture goal observed active' } }, dependencies);
  const held = await execute(root, { action: 'hold', actor, revision: accepted.revision, authority: 'The user asked to pause', reason: 'Wait until the user resumes' }, dependencies);
  assert.equal(held.status, 'stopped');
  assert.equal(held.hold.authority, 'The user asked to pause');
  assert.deepEqual(held.handover, accepted.handover);
  await assert.rejects(execute(root, { action: 'start-task', taskId: 'subject', actor, revision: held.revision }, dependencies), { code: 'run-stopped' });
  const resumed = await execute(root, { action: 'resume', actor, revision: held.revision, authority: 'The user explicitly resumed' }, dependencies);
  assert.equal(resumed.status, 'running');
  assert.equal(resumed.hold, null);
  assert.equal(resumed.continuation.verified, false);
  assert.deepEqual(resumed.handover, accepted.handover);
});

test('all removed mode values are rejected without accepted delivery state', async t => {
  const root = project(t);
  for (const mode of ['attended', 'unattended', '', null]) await assert.rejects(execute(root, { ...deliveryRequest('handover'), mode }, dependencies), { code: 'invalid-mode' });
  const store = new RunStore(root);
  try { assert.equal(store.read(), null); } finally { store.close(); }
});

for (const kind of ['code', 'spec', 'docs', 'lore']) {
  test(`standalone ${kind} revision owns review state without creating a delivery database`, async t => {
    const root = project(t);
    const request = { action: 'open-review', reviewContextId: randomUUID(), controller: actor, authority: `The user requested revise-${kind}`, objective: `Assess ${kind}`, kind, agreement: { source: 'explicit revise request', outcome: 'Assess and reconcile the requested scope' } };
    const context = await execute(root, request, dependencies);
    assert.equal(context.kind, 'review');
    assert.equal(context.reviewContextId, request.reviewContextId);
    assert.equal(context.tasks[0].kind, kind);
    assert.equal(Object.hasOwn(context, 'handover'), false);
    assert.equal(Object.hasOwn(context, 'controllerClaim'), false);
    assert.equal(Object.hasOwn(context, 'continuation'), false);
    assert.equal(fs.existsSync(path.join(root, '.nightshift/runs/state.sqlite')), false);
    const repeated = await execute(root, request, dependencies);
    assert.equal(repeated.id, context.id);
    assert.equal(repeated.revision, context.revision);
    await assert.rejects(execute(root, { ...request, agreement: { ...request.agreement, outcome: 'A different scope' } }, dependencies), { code: 'review-context-conflict' });
  });
}

test('a continuation failure records one follow-up and leaves accepted delivery actionable', async t => {
  const root = project(t);
  const state = await execute(root, deliveryRequest('handover'), dependencies);
  await assert.rejects(execute(root, { action: 'start-task', taskId: 'subject', actor, revision: state.revision }, dependencies), { code: 'continuation-observation-required' });
  const mechanism = { verified: false, kind: 'goal', reason: 'The native goal service is unavailable' };
  const failed = await execute(root, { action: 'continuation', actor, revision: state.revision, mechanism }, dependencies);
  assert.equal(failed.status, 'running');
  assert.equal(failed.handover.authority, state.authority);
  assert.equal(failed.followups.length, 1);
  assert.equal(failed.acceptanceCheckpoint.observedContinuation, 'failed');
  assert.match(failed.acceptanceCheckpoint.requiredNextAssistantOutput, /You can leave/);
  assert.match(failed.acceptanceCheckpoint.requiredNextAssistantOutput, /before another engineering tool call/i);
  const stored = new RunStore(root);
  try { assert.equal(Object.hasOwn(stored.read(), 'acceptanceCheckpoint'), false); } finally { stored.close(); }
  const repeated = await execute(root, { action: 'continuation', actor, revision: failed.revision, mechanism }, dependencies);
  assert.equal(repeated.followups.length, 1);
  assert.equal(repeated.followups[0].continuationFailure.occurrences, 2);
  const started = await execute(root, { action: 'start-task', taskId: 'subject', actor, revision: repeated.revision }, dependencies);
  assert.equal(started.next[0].stage, 'implementation');
  assert.equal(Object.hasOwn(started, 'mode'), false);
  const restored = await execute(root, { action: 'continuation', actor, revision: started.revision, mechanism: { verified: true, kind: 'goal', evidence: 'The fixture goal is observed active' } }, dependencies);
  assert.equal(restored.continuation.verified, true);
  assert.equal(restored.followups.length, 1);
  assert.equal(restored.acceptanceCheckpoint, null);
  assert.equal(restored.acknowledgement.current, true);
});

test('standalone revision preserves the existing delivery database and its version', async t => {
  const root = project(t);
  const delivery = await execute(root, deliveryRequest('handover'), dependencies);
  const store = new RunStore(root);
  try {
    const originalVersion = store.db.prepare('PRAGMA user_version').get().user_version;
    const request = { action: 'open-review', reviewContextId: randomUUID(), controller: actor, authority: 'The user requested an independent spec revision', objective: 'Assess the separate spec', kind: 'spec', agreement: { source: 'explicit revise-spec request', outcome: 'Assess the separate scope' } };
    await execute(root, request, dependencies);
    assert.equal(store.read().id, delivery.id);
    assert.equal(store.read().revision, delivery.revision);
    assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, originalVersion);
  } finally { store.close(); }
});

for (const kind of ['code', 'spec', 'docs', 'lore']) {
  test(`standalone ${kind} revision completes its assurance without delivery closing or a controller claim`, async t => {
    const root = project(t);
    fs.writeFileSync(path.join(root, 'subject.txt'), 'The requested subject\r\n');
    const request = { action: 'open-review', reviewContextId: randomUUID(), controller: actor, authority: `The user requested revise-${kind}`, objective: `Assess ${kind}`, kind, agreement: { source: 'explicit revise request', outcome: 'Assess the subject' } };
    const context = await execute(root, request, dependencies);
    const store = new ReviewStore(root, { contextId: context.id });
    try {
      const reviewKind = kind === 'lore' ? 'code' : kind;
      store.update(actor, context.revision, 'fixture-assessment', state => transition(state, {
        action: 'review', taskId: '#review',
        review: { kind: reviewKind, status: 'complete', strength: 'strong', session: 'independent-assessor', independent: true, broad: true, attributionVerified: true, coverageEvidence: 'Fixture assessment covers the complete requested subject', dimensions: [...DIMENSIONS[reviewKind]], commitments: commitmentsFor(state.tasks), snapshot: snapshot(root, ['subject.txt']), findings: [] },
      }));
      if (kind === 'code') {
        await assert.rejects(execute(root, { action: 'advance', reviewContextId: context.id, actor, revision: store.read().revision, evidence: 'Assessment alone is not verification' }, dependencies), { code: 'review-required' });
        store.update(actor, store.read().revision, 'fixture-check', state => transition(state, { action: 'check', taskId: '#review', evidence: { name: 'Fixture subject check', passed: true, snapshot: snapshot(root, ['subject.txt']), output: 'The fixture subject assertion passed' } }));
      }
      const advanced = await execute(root, { action: 'advance', reviewContextId: context.id, actor, revision: store.read().revision, evidence: 'The requested subject has its complete independent assessment' }, dependencies);
      const completed = await execute(root, { action: 'complete', reviewContextId: context.id, actor, revision: advanced.revision }, dependencies);
      assert.equal(completed.status, 'complete');
      assert.equal(Object.hasOwn(completed, 'closing'), false);
      assert.equal(Object.hasOwn(completed, 'controllerClaim'), false);
      assert.equal(store.read().ownerObservation.process.pid, owner.pid);
      assert.equal(fs.existsSync(path.join(root, '.nightshift/runs/state.sqlite')), false);
    } finally { store.close(); }
  });
}
