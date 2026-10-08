'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { fork } = require('node:child_process');
const { execute } = require('../internal/runtime/cli');
const { RunStore } = require('../internal/runtime/store');
const { ReviewStore } = require('../internal/runtime/review-store');
const { fixtureAcknowledgement } = require('./fixtures/acknowledgement');
const { shortLeaf } = require('./fixtures/short-name');

const parent = path.resolve(__dirname, '../.tmp/ownership-tests');
const dependencies = { nativeOwner: () => ({ pid: 12345, created: 'fixture-process', name: 'codex.exe' }), ownerAlive: () => true, acknowledgementObserver: fixtureAcknowledgement };
fs.mkdirSync(parent, { recursive: true });
function fixture(t) {
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const actor = session => ({ host: 'codex', session });
async function review(root, session) {
  return execute(root, { action: 'open-review', reviewContextId: randomUUID(), controller: actor(session), kind: 'code', authority: 'Explicit standalone revision', objective: 'Revise the component', agreement: { source: 'fixture user', outcome: 'Keep safe write ownership' } }, dependencies);
}
async function delivery(root, session) {
  return execute(root, { action: 'handover', controller: actor(session), authority: 'Explicit delivery handover', objective: 'Deliver the component', mechanism: { verified: true, kind: 'goal', evidence: 'Fixture goal active' }, tasks: [{ id: 'work', title: 'Component', agreement: { source: 'fixture user', outcome: 'Keep safe write ownership' } }] }, dependencies);
}
async function worker(root, state, session, writes = ['shared.js']) {
  return execute(root, { action: 'worker', ...(state.kind === 'review' ? { reviewContextId: state.id } : {}), actor: state.controller, revision: state.revision, worker: { id: session, session, assignment: 'Own the component', role: writes.length ? 'implementer' : 'reviewer', writes } }, dependencies);
}

test('review contexts serialize overlapping writers and permit isolated read-only work', async t => {
  const root = fixture(t);
  const first = await review(root, 'first');
  const second = await review(root, 'second');
  await worker(root, first, 'first-worker');
  await assert.rejects(worker(root, second, 'second-worker'), { code: 'writer-conflict' });
  const assessed = await worker(root, second, 'read-only-worker', []);
  assert.equal(assessed.workers[0].writes.length, 0);
});

test('Windows write ownership refuses trailing-dot, trailing-space, stream, drive-relative and device spellings, new or stored', { skip: process.platform !== 'win32' }, async t => {
  for (const alias of ['shared.js.', 'shared.js ', 'dir./shared.js', 'dir /shared.js', 'shared.js::$DATA', 'shared.js:', 'shared.js:stream', 'shared.js:stream:$DATA', 'dir::$INDEX_ALLOCATION/shared.js', 'C:shared.js', 'NUL', 'nul.txt', 'COM\u00b9', 'dir/CONOUT$']) {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, 'dir'));
    const canonical = alias.startsWith('dir') ? 'dir/shared.js' : 'shared.js';
    const workers = state => {
      const store = new ReviewStore(root, { contextId: state.id });
      try { return store.read().workers.length; } finally { store.close(); }
    };
    let first = await review(root, 'first');
    const second = await review(root, 'second');
    await assert.rejects(worker(root, second, 'alias-first', [alias]), { code: 'unsafe-path' }, alias);
    first = await worker(root, first, 'canonical-owner', [canonical]);
    await assert.rejects(worker(root, second, 'alias-second', [alias]), { code: 'unsafe-path' }, alias);
    await assert.rejects(worker(root, first, 'alias-same-record', [alias]), { code: 'unsafe-path' }, alias);
    await assert.rejects(worker(root, second, 'case-variant', [canonical.toUpperCase()]), { code: 'writer-conflict' }, alias);
    assert.equal(workers(first), 1);
    assert.equal(workers(second), 0);

    // A reservation stored with an alias spelling, as an earlier release could have saved, fails closed for every writer.
    const store = new ReviewStore(root, { contextId: first.id });
    try { first = store.update(first.controller, store.read().revision, 'fixture-stored-alias', state => { state.workers.push({ id: 'stored-alias', session: 'stored-alias', role: 'implementer', assignment: 'Earlier reservation', writes: [alias], status: 'running' }); }); }
    finally { store.close(); }
    await assert.rejects(worker(root, second, 'distinct-writer', ['other.js']), { code: 'writer-state-unavailable' }, alias);
    await assert.rejects(worker(root, first, 'same-record-writer', ['other.js']), { code: 'writer-state-unavailable' }, alias);
    assert.equal((await worker(root, second, 'read-only-assessor', [])).workers.length, 1);
    // Read-only staff stays registrable in the record holding the stored reservation, which itself stays in place.
    for (const [id, role, extra] of [['same-record-reviewer', 'reviewer', {}], ['same-record-skeptic', 'skeptic', {}], ['same-record-supervisor', 'supervisor', {}], ['same-record-peer', 'peer', { lead: 'same-record-reviewer' }]]) {
      const current = new ReviewStore(root, { contextId: first.id });
      let revision;
      try { revision = current.read().revision; } finally { current.close(); }
      await execute(root, { action: 'worker', reviewContextId: first.id, actor: first.controller, revision, worker: { id, session: id, assignment: 'Assess the component', role, writes: [], ...extra } }, dependencies);
    }
    const reopened = new ReviewStore(root, { contextId: first.id });
    try { assert.deepEqual(reopened.read().workers.find(entry => entry.id === 'stored-alias').writes, [alias]); } finally { reopened.close(); }
  }
});

test('Windows write ownership refuses 8.3 short spellings of existing files and directories, new or stored', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'Long Directory Example'));
  fs.writeFileSync(path.join(root, 'Long Filename Example.txt'), 'original');
  const file = shortLeaf(path.join(root, 'Long Filename Example.txt'));
  const directory = shortLeaf(path.join(root, 'Long Directory Example'));
  if (!file || !directory) {
    t.skip('This volume reports no distinct 8.3 short names, so short-name aliasing is not exercised');

    return;
  }
  let first = await review(root, 'first');
  const second = await review(root, 'second');
  // A missing child under a short-named directory aliases the long-named directory's child once it is created.
  for (const alias of [file, `${directory}/owned.txt`, `${directory}/not-created.txt`]) {
    await assert.rejects(worker(root, first, 'same-record-alias', [alias]), { code: 'unsafe-path' }, alias);
    await assert.rejects(worker(root, second, 'cross-record-alias', [alias]), { code: 'unsafe-path' }, alias);
  }
  first = await worker(root, first, 'long-owner', ['Long Filename Example.txt', 'Long Directory Example/owned.txt']);
  await assert.rejects(worker(root, second, 'case-variant', ['long filename example.txt']), { code: 'writer-conflict' });

  // A reservation stored with a short spelling, as an earlier release could have saved, fails closed for every writer.
  const store = new ReviewStore(root, { contextId: first.id });
  try { first = store.update(first.controller, store.read().revision, 'fixture-stored-short', state => { state.workers.push({ id: 'stored-short', session: 'stored-short', role: 'implementer', assignment: 'Earlier reservation', writes: [`${directory}/not-created.txt`], status: 'unverified' }); }); }
  finally { store.close(); }
  await assert.rejects(worker(root, second, 'distinct-writer', ['other.js']), { code: 'writer-state-unavailable' });
  await assert.rejects(worker(root, first, 'same-record-writer', ['other.js']), { code: 'writer-state-unavailable' });
  assert.equal((await worker(root, second, 'read-only-assessor', [])).workers.length, 1);
  assert.equal((await worker(root, first, 'same-record-reviewer', [])).workers.length, 3);
});

test('actual review writers prevent delivery ownership without replacing the review context', async t => {
  const root = fixture(t);
  const context = await review(root, 'review-owner');
  await worker(root, context, 'review-worker');
  await assert.rejects(delivery(root, 'delivery-owner'), { code: 'writer-conflict' });
  const store = new ReviewStore(root, { contextId: context.id });
  try { assert.equal(store.read().workers[0].status, 'running'); } finally { store.close(); }
});

test('a delivery owner permits another standalone assessment but refuses its canonical writer', async t => {
  const root = fixture(t);
  const run = await delivery(root, 'delivery-owner');
  await worker(root, run, 'delivery-worker');
  const context = await review(root, 'review-owner');
  await assert.rejects(worker(root, context, 'review-worker'), { code: 'review-write-conflict' });
  await worker(root, context, 'review-assessor', []);
});

test('delivery worker registration checks a same-owner review context and its path aliases', async t => {
  const root = fixture(t);
  const run = await delivery(root, 'owner');
  const context = await review(root, 'owner');
  await worker(root, context, 'review-worker');
  await assert.rejects(worker(root, run, 'delivery-worker', [process.platform === 'win32' ? 'SHARED.js' : 'shared.js']), { code: 'writer-conflict' });
});

test('uncertain writers remain protected even on a completed context', async t => {
  const root = fixture(t);
  const context = await review(root, 'first');
  await worker(root, context, 'uncertain-worker');
  const store = new ReviewStore(root, { contextId: context.id });
  try { store.update(context.controller, store.read().revision, 'fixture-uncertain-history', state => { state.status = 'complete'; state.workers[0].status = 'unverified'; }); } finally { store.close(); }
  await assert.rejects(delivery(root, 'second'), { code: 'writer-conflict' });
});

test('unsupported inventory kinds fail canonical ownership closed', async t => {
  const root = fixture(t);
  const run = await delivery(root, 'owner');
  const context = await review(root, 'other');
  const store = new ReviewStore(root, { contextId: context.id });
  try {
    const malformed = store.read();
    malformed.kind = 'delivery';
    store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(malformed), context.id);
  } finally { store.close(); }
  await assert.rejects(worker(root, run, 'writer'), { code: 'review-resource-state-unavailable' });
  const deliveryStore = new RunStore(root);
  try { assert.deepEqual(deliveryStore.read().workers, []); } finally { deliveryStore.close(); }
});

test('simultaneous processes cannot reserve the same canonical path in separate contexts', { timeout: 15000 }, async t => {
  const root = fixture(t);
  const contexts = await Promise.all([review(root, 'first'), review(root, 'second')]);
  const children = contexts.map(context => {
    const child = fork(path.join(__dirname, 'fixtures/runtime-owner-worker.cjs'), [root, context.id, context.controller.session], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let ready;
    let result;
    const opened = new Promise(resolve => { ready = resolve; });
    const recorded = new Promise(resolve => { result = resolve; });
    const ended = new Promise(resolve => child.once('exit', code => resolve(code)));
    child.on('message', message => { if (message.ready) ready(); else result(message); });
    t.after(() => { if (child.exitCode === null) child.kill(); });
    return { child, opened, recorded, ended };
  });
  await Promise.all(children.map(child => child.opened));
  children.forEach(({ child }) => child.send('begin'));
  const results = await Promise.all(children.map(child => child.recorded));
  assert.equal(results.filter(result => result.accepted).length, 1, JSON.stringify(results));
  assert.equal(results.find(result => !result.accepted).code, 'writer-conflict');
  assert.deepEqual(await Promise.all(children.map(child => child.ended)), [0, 0]);
});
