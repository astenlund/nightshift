'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { main } = require('./fixtures/creation-budget.cjs');
const { RunStore } = require('../internal/runtime/store');
const { ProgressStore } = require('../internal/runtime/progress-store');
const progress = require('../internal/runtime/progress');
const { execute } = require('../internal/runtime/cli');
const { DIMENSIONS, reportNotice, transition } = require('../internal/runtime/lifecycle');
const { inventorySnapshot, snapshot, verifyCommand } = require('../internal/runtime/evidence');
const { closingDischargedSince } = require('../internal/runtime/creation-consistency');
const { fixtureAcknowledgement } = require('./fixtures/acknowledgement');
const { completeReflection } = require('./fixtures/completion');
const { dropFacilityProvenance } = require('./fixtures/legacy-provenance');

test('creation shares an eight MiB distinct-artifact allowance across completed records', main);

test('an unconfirmed morning report holds replacement until any admitted session records its recipient\'s reply', async t => {
  const parent = path.resolve(__dirname, '../.tmp/creation-report-delivery');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const owner = { host: 'codex', session: 'report-owner' };
  const successor = { host: 'claude', session: 'report-successor' };
  const dependencies = { nativeOwner: () => ({ pid: 12345, created: 'isolated-fixture', name: 'codex.exe' }), ownerAlive: () => true, acknowledgementObserver: fixtureAcknowledgement };
  const handover = controller => ({ action: 'handover', handoverId: randomUUID(), controller, authority: 'Explicit fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] });
  const tables = () => {
    const store = new RunStore(root);
    try { return ['runs', 'active', 'history'].map(table => store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n); } finally { store.close(); }
  };

  const original = handover(owner);
  await execute(root, original, dependencies);
  const withholdReply = (project, input, deps) => (input.action === 'report-delivered' ? execute(project, { action: 'inspect' }, deps) : execute(project, input, deps));
  const completed = await completeReflection(root, owner, withholdReply, dependencies);
  assert.equal(completed.status, 'complete');
  assert.equal(completed.closing.reportDelivery, null);

  const before = tables();
  await assert.rejects(execute(root, handover(successor), dependencies), { code: 'report-delivery-pending' });
  assert.deepEqual(tables(), before);
  assert.equal((await execute(root, original, dependencies)).revision, completed.revision);
  assert.equal(reportNotice(completed).delivered, false);

  // The successor may confirm the completed report, and only that: its other bookkeeping still needs the owner.
  await assert.rejects(execute(root, { action: 'report', path: completed.closing.reportEvidence.path, actor: successor, revision: completed.revision }, dependencies), { code: 'stale-owner' });
  const confirmed = await execute(root, { action: 'report-delivered', actor: successor, revision: completed.revision, authority: 'The user replied after the saved report was presented' }, dependencies);
  assert.equal(confirmed.report.delivered, true);
  const store = new RunStore(root);
  try { assert.deepEqual(store.read().closing.reportDelivery.recordedBy, successor); } finally { store.close(); }

  // Recording the report again owes a fresh confirmation before replacement.
  await execute(root, { action: 'report', path: completed.closing.reportEvidence.path, actor: owner, revision: confirmed.revision }, dependencies);
  await assert.rejects(execute(root, handover(successor), dependencies), { code: 'report-delivery-pending' });
  const rerecorded = new RunStore(root);
  let revision;
  try { revision = rerecorded.read().revision; } finally { rerecorded.close(); }
  await execute(root, { action: 'report-delivered', actor: owner, revision, authority: 'The user replied to the rewritten report' }, dependencies);
  const next = await execute(root, handover(successor), dependencies);
  assert.notEqual(next.id, completed.id);
  assert.equal(next.status, 'running');
});

function isolatedProject(t, label) {
  const parent = path.resolve(__dirname, '../.tmp/creation-legacy');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, label + '-'));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}

const legacyOwner = { host: 'codex', session: 'legacy-owner' };
const legacyDependencies = { nativeOwner: () => ({ pid: 12345, created: 'isolated-fixture', name: 'codex.exe' }), ownerAlive: () => true, information: pid => ({ found: true, pid, created: 'fixture-helper', name: 'node.exe' }), acknowledgementObserver: fixtureAcknowledgement, runContained: async (_executable, _args, options) => { options.onFinished({ code: 0, descendantsReclaimed: true }); return { code: 0, stdout: 'Simulated passing command', stderr: '', descendantsReclaimed: true }; } };
const reflection = () => ({ action: 'handover', handoverId: randomUUID(), controller: legacyOwner, authority: 'Explicit fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] });

function withStore(root, work) {
  const store = new RunStore(root);
  try { return work(store); } finally { store.close(); }
}

test('creation accepts an authenticated completion and refuses delivery records it cannot authenticate', async t => {
  // A schema-2 record without its independent provenance has lost it; only a record without schema-2 accounting is legacy.
  const halfway = (store, id) => dropFacilityProvenance(store.db, id);
  const preSchema2 = (store, id) => {
    halfway(store, id);
    store.db.exec("UPDATE runs SET state=json_remove(state, '$.progress'); UPDATE history SET state=json_remove(state, '$.progress')");
  };
  const forms = {
    intact: () => {},
    halfway,
    'lost-index': (store, id) => store.db.exec(`DELETE FROM accounting_commits WHERE run_id='${id}'; DELETE FROM discharge_index WHERE run_id='${id}'`),
    'pre-schema-2': preSchema2,
    'history-gap': (store, id) => {
      preSchema2(store, id);
      store.db.prepare('DELETE FROM history WHERE revision=(SELECT max(revision) / 2 FROM history)').run();
    },
    // The current state and its committed history row rewritten together no longer match the checkpoint's substantive binding.
    substituted: (store, id) => {
      halfway(store, id);
      store.db.exec("UPDATE runs SET state=json_set(state, '$.objective', 'Substituted objective'); UPDATE history SET state=json_set(state, '$.objective', 'Substituted objective') WHERE revision=(SELECT max(revision) FROM history)");
    },
  };
  const outcomes = {};
  for (const [form, damage] of Object.entries(forms)) {
    const root = isolatedProject(t, form);
    await execute(root, reflection(), legacyDependencies);
    const completed = await completeReflection(root, legacyOwner, execute, legacyDependencies);
    withStore(root, store => damage(store, completed.id));
    const tables = () => withStore(root, store => ['runs', 'active', 'history', 'artifacts', 'accounting_commits', 'discharge_index'].map(table => store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n));
    const before = tables();
    try {
      outcomes[form] = (await execute(root, reflection(), legacyDependencies)).id !== completed.id ? 'accepted' : 'replayed';
    } catch (error) {
      outcomes[form] = `${error.code}: ${error.message}`;
      assert.deepEqual(tables(), before, form);
    }
  }
  assert.equal(outcomes.intact, 'accepted');
  // A completed record that predates schema-2 markers has closing evidence without recorded discharge admissions, so it stays
  // unavailable until earlier records can be migrated.
  for (const form of ['halfway', 'lost-index', 'pre-schema-2', 'history-gap', 'substituted']) assert.match(outcomes[form], /^delivery-consistency-unavailable/, form);
});

test('a closing record opened after completion holds replacement until the delivery completes again', async t => {
  const git = (root, ...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
  };
  const edit = root => fs.appendFileSync(path.join(root, 'README.md'), '\nTracked after delivery.\n');
  const scenario = async (label, reopen) => {
    const root = isolatedProject(t, label);
    fs.writeFileSync(path.join(root, '.gitignore'), '/.nightshift/runs/\n');
    fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
    git(root, 'init', '--quiet');
    git(root, 'add', '.gitignore', 'README.md');
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=.disabled-hooks', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
    await execute(root, reflection(), legacyDependencies);
    const completed = await completeReflection(root, legacyOwner, execute, legacyDependencies);
    const call = request => execute(root, { ...request, actor: legacyOwner, revision: withStore(root, store => store.read().revision) }, legacyDependencies);
    await reopen(root, call, completed);
    try {
      const next = await execute(root, reflection(), legacyDependencies);

      return next.id !== completed.id ? 'replaced' : 'replayed';
    } catch (error) {
      return error.code;
    }
  };
  const hold = call => call({ action: 'hold', authority: 'The fixture user asked for a hold', reason: 'Reconsider follow-up tracking' });

  // Later drift alone keeps the historical completion.
  assert.equal(await scenario('drift', async root => edit(root)), 'replaced');
  // A held completion triaged again after a tracking edit owes its new closing record a review.
  assert.equal(await scenario('edited', async (root, call) => { await hold(call); edit(root); await call({ action: 'triage', evidence: 'A follow-up was tracked after delivery' }); }), 'overlapping-run');
  assert.equal(await scenario('reset', async (root, call, completed) => {
    await hold(call);
    edit(root);
    await call({ action: 'retrospective', evidence: 'Renewed reflection' });
    await call({ action: 'report', path: completed.closing.reportEvidence.path });
    await call({ action: 'report-delivered', authority: 'The fixture recipient acknowledged the renewed report' });
    await call({ action: 'triage', evidence: 'Renewed triage' });
  }), 'overlapping-run');
  // Without a tracking edit the reopened record still awaits the transition that discharges it: completing again.
  assert.equal(await scenario('unchanged', async (root, call) => { await hold(call); await call({ action: 'triage', evidence: 'No tracking edit' }); }), 'overlapping-run');
  assert.equal(await scenario('recompleted', async (root, call) => {
    await hold(call);
    await call({ action: 'triage', evidence: 'No tracking edit' });
    await call({ action: 'resume', authority: 'The fixture user resumed the delivery' });
    await call({ action: 'continuation', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture goal' } });
    assert.equal((await call({ action: 'complete' })).status, 'complete');
    edit(root);
  }), 'replaced');
  // A passing closing check recorded on the completed record after a tracking edit owes that record its closing review.
  const contained = { ...legacyDependencies, runContained: async (executable, args, options) => {
    const result = spawnSync(executable, args, { cwd: options.cwd, encoding: 'utf8', windowsHide: true, timeout: 5000 });
    options.onFinished({ code: result.status, descendantsReclaimed: true });

    return { code: result.status, stdout: result.stdout, stderr: result.stderr, descendantsReclaimed: true };
  } };
  assert.equal(await scenario('checked', async root => {
    edit(root);
    const revision = withStore(root, store => store.read().revision);
    await execute(root, { action: 'check', taskId: '#closing', actor: legacyOwner, revision, check: { name: 'post-delivery tracking check', executable: process.execPath, args: ['--version'], paths: ['README.md'], timeoutMs: 5000 } }, contained);
    assert.equal(withStore(root, store => store.read().closing.docs.checks.at(-1).passed), true);
  }), 'overlapping-run');
});

test('a closing check recorded after completion needs a fresh docs review that saw the content it checked', () => {
  const file = (sha256, filePath = 'README.md') => ({ path: filePath, sha256 });
  const record = (checks = [], reviews = [], occurrence = 'occurrence') => ({ closing: { docs: { occurrence, checks, reviews, findings: [] } } });
  const check = (attemptId, files, name = attemptId) => ({ attemptId, name, passed: true, snapshot: { files } });
  const review = (requestId, revision, files, overrides = {}) => ({ requestId, revision, kind: 'docs', status: 'complete', strength: 'strong', independent: true, broad: true, coverageEvidence: 'Assessed the tracking edits', attributionVerified: true, dimensions: [...DIMENSIONS.docs], snapshot: { files }, ...overrides });
  const resolve = value => value;
  const first = review('first', 5, [file('a')]);
  const completed = record([check('before', [file('a')])], [first]);

  // Unchanged closing state keeps the completion; a replaced or missing record does not.
  assert.equal(closingDischargedSince(completed, completed, resolve), true);
  assert.equal(closingDischargedSince(record([], [], 'later'), completed, resolve), false);
  assert.equal(closingDischargedSince({ closing: {} }, completed, resolve), false);
  assert.equal(closingDischargedSince({ closing: {} }, { closing: {} }, resolve), true);
  // A check of changed content needs the latest assessment to have seen it, never an older one or a continued or partial latest one.
  const changed = [...completed.closing.docs.checks, check('after', [file('b')])];
  assert.equal(closingDischargedSince(record(changed, [first]), completed, resolve), false);
  assert.equal(closingDischargedSince(record(changed, [first, review('second', 9, [file('b')])]), completed, resolve), true);
  assert.equal(closingDischargedSince(record(changed, [first, review('second', 9, [file('c')])]), completed, resolve), false);
  assert.equal(closingDischargedSince(record(changed, [review('second', 9, [file('c')]), review('third', 12, [file('b')], { continues: { kind: 'resumed', requestId: 'second', session: 'reviewer' } })]), completed, resolve), false);
  assert.equal(closingDischargedSince(record(changed, [first, review('second', 9, [file('b')], { dimensions: ['claim-accuracy'] })]), completed, resolve), false);
  // Content a superseded assessment saw stays uncovered once a later assessment saw other bytes.
  const restored = [...completed.closing.docs.checks, check('restored', [file('a')])];
  assert.equal(closingDischargedSince(record(restored, [first, review('second', 9, [file('b')])]), completed, resolve), false);
  // A rerun of a named check supersedes its earlier attempt, while a check of another name keeps its own obligation.
  const rerun = [...completed.closing.docs.checks, check('draft', [file('b')], 'tracking'), check('final', [file('c')], 'tracking')];
  assert.equal(closingDischargedSince(record(rerun, [first, review('second', 9, [file('c')])]), completed, resolve), true);
  const distinct = [...completed.closing.docs.checks, check('draft', [file('b')], 'draft-check'), check('final', [file('c')], 'final-check')];
  assert.equal(closingDischargedSince(record(distinct, [first, review('second', 9, [file('c')])]), completed, resolve), false);
  // A check of content the latest assessment saw adds no debt, and a path absent at check time matches one that also lacks it.
  assert.equal(closingDischargedSince(record([...completed.closing.docs.checks, check('again', [file('a')])], [first]), completed, resolve), true);
  assert.equal(closingDischargedSince(record([...completed.closing.docs.checks, check('after', [file(null, 'NOTES.md')])], [first]), completed, resolve), true);
});

test('a closing check restoring content a superseded assessment saw holds replacement back, unlike one the latest assessment saw', async t => {
  const git = (root, ...args) => {
    const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 0, result.stderr);
  };
  const defective = '# Fixture\nThe runtime always permits replacement of unfinished deliveries.\n';
  const repaired = '# Fixture\nThe runtime refuses replacement of unfinished deliveries.\n';
  const scenario = async (label, mode) => {
    const root = isolatedProject(t, label);
    const write = content => fs.writeFileSync(path.join(root, 'README.md'), content);
    fs.writeFileSync(path.join(root, '.gitignore'), '/.nightshift/runs/\n');
    write('# Baseline\n');
    git(root, 'init', '--quiet');
    git(root, 'add', '.gitignore', 'README.md');
    git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=.disabled-hooks', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
    await execute(root, reflection(), legacyDependencies);
    // Closing is reviewed before completion here, so completion is the owner's own step below.
    const withoutCompletion = (project, request, deps) => execute(project, request.action === 'complete' ? { action: 'inspect' } : request, deps);
    await completeReflection(root, legacyOwner, withoutCompletion, legacyDependencies);
    const read = () => withStore(root, store => store.read());
    const act = request => withStore(root, store => store.update(legacyOwner, store.read().revision, request.action, state => transition(state, request)));
    const assessment = (requestId, findings, extra = {}) => ({ requestId, kind: 'docs', session: requestId + '-session', attributionVerified: true, status: 'complete', strength: 'strong', independent: true, broad: true, dimensions: [...DIMENSIONS.docs], coverageEvidence: 'Assessed the tracking edits', coveredTaskIds: ['reflection'], snapshot: inventorySnapshot(root), findings, ...extra });
    write(defective);
    act({ action: 'review', taskId: '#closing', review: assessment('finding-review', [{ id: 'F1', severity: 'important', required: false, consequence: 'The text permits replacing unfinished deliveries', evidence: 'The fixture requirement forbids it' }]) });
    const findingId = read().closing.docs.findings[0].id;
    act({ action: 'validate', taskId: '#closing', findingId, validation: { session: 'fixture-skeptic', attributionVerified: true, verdict: 'confirmed', evidence: 'Compared with the requirement', repairProposal: 'State that the replacement is refused', snapshot: snapshot(root, ['README.md']) } });
    act({ action: 'dispose', taskId: '#closing', findingId, disposition: 'implement', reason: 'Correct the documentation', obligation: { classification: 'required', basis: 'The fixture requires accurate documentation' } });
    write(repaired);
    act({ action: 'repair', taskId: '#closing', findingIds: [findingId] });
    act({ action: 'review', taskId: '#closing', review: assessment('repair-closure', [], { session: 'finding-review-session', lineage: 'finding-review', continues: { kind: 'resumed', requestId: 'finding-review', session: 'finding-review-session' }, closures: [{ id: findingId, closed: true, evidence: 'The statement is now accurate' }] }) });
    act({ action: 'review', taskId: '#closing', review: assessment('fresh-review', []) });
    await execute(root, { action: 'complete', actor: legacyOwner, revision: read().revision }, legacyDependencies);
    const completed = read();
    assert.equal(completed.status, 'complete');
    const check = () => act({ action: 'check', taskId: '#closing', evidence: verifyCommand(root, { name: 'post-completion closing check', executable: process.execPath, args: ['--version'], paths: ['README.md'], timeoutMs: 5000 }) });
    if (mode === 'restored') write(defective);
    // A draft checked and then put back to the reviewed content is superseded by the rerun of the same named check.
    if (mode === 'superseded') {
      write('# Fixture\nA draft that was never reviewed.\n');
      check();
      write(repaired);
    }
    check();
    const tables = () => withStore(root, store => ['runs', 'active', 'history'].map(table => store.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n));
    const before = tables();
    try {
      const next = await execute(root, reflection(), legacyDependencies);

      return next.id !== completed.id ? 'replaced' : 'replayed';
    } catch (error) {
      assert.deepEqual(tables(), before);

      return error.code;
    }
  };

  assert.equal(await scenario('equivalent', 'equivalent'), 'replaced');
  assert.equal(await scenario('superseded', 'superseded'), 'replaced');
  assert.equal(await scenario('restored', 'restored'), 'overlapping-run');
});

// The aggregate bound across completed records is exercised through intact provenance by the eight MiB fixture above.
test('an exhausted artifact allowance stays exhausted when an artifact already charged is read again', async t => {
  const root = isolatedProject(t, 'exhausted-budget');
  await execute(root, reflection(), legacyDependencies);
  withStore(root, store => {
    const state = store.read(undefined, { hydrate: false });
    const accounting = new ProgressStore(store);
    const fresh = { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES };
    accounting.artifact(state.progress.frontierHash, fresh);
    assert.equal(fresh.artifacts.has(state.progress.frontierHash), true);
    const spent = { bytes: progress.MAX_FRONTIER_BYTES + 1, artifacts: new Set([state.progress.frontierHash]), artifactLimit: progress.MAX_FRONTIER_BYTES };
    assert.throws(() => accounting.artifact(state.progress.frontierHash, spent), { code: 'progress-history-limit' });
  });
});

test('closing checks are collected on an unchanged record while accounting is unavailable, never on a replaced one', async t => {
  const root = isolatedProject(t, 'closing');
  await execute(root, reflection(), legacyDependencies);
  const keepRunning = (project, input, deps) => (input.action === 'complete' ? execute(project, { action: 'inspect' }, deps) : execute(project, input, deps));
  await completeReflection(root, legacyOwner, keepRunning, legacyDependencies);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'Stable fixture subject\r\n');
  const read = () => withStore(root, store => store.read());
  const check = (name, dependencies = legacyDependencies) => execute(root, { action: 'check', taskId: '#closing', actor: legacyOwner, revision: read().revision, check: { name, executable: process.execPath, args: ['--version'], paths: ['subject.txt'], timeoutMs: 5000 } }, dependencies);
  await check('healthy-control');
  const healthy = read();
  withStore(root, store => {
    store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision=?').run(healthy.id, healthy.revision);
    store.update(legacyOwner, healthy.revision, 'fixture-independent-bookkeeping', state => { state.fixtureDiagnostic = 'Preserve otherwise valid work after accounting loss'; });
  });
  assert.equal(read().progress.status, 'unavailable');
  await check('degraded-accounting');
  const collected = read().closing.docs.checks.at(-1);
  assert.equal(collected.name, 'degraded-accounting');
  assert.equal(collected.passed, true);
  assert.equal(collected.pending, undefined);
  assert.equal(read().progress.status, 'unavailable');

  // A closing record replaced while the check runs, under the same context and binding, mints a new occurrence identity.
  const replacing = { ...legacyDependencies, runContained: async (executable, args, options) => {
    withStore(root, store => store.update(legacyOwner, store.read().revision, 'fixture-closing-replacement', state => { state.closing.docs = { ...state.closing.docs, occurrence: randomUUID() }; }));
    return legacyDependencies.runContained(executable, args, options);
  } };
  const occurrence = read().closing.docs.occurrence;
  await assert.rejects(check('replaced-record', replacing), { code: 'closing-origin-changed' });
  assert.notEqual(read().closing.docs.occurrence, occurrence);
});

test('creation charges reminder history separately and preserves default recovery accounting', t => {
  const parent = path.resolve(__dirname, '../.tmp/creation-history-budget');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const actor = { host: 'codex', session: 'budget-owner' };
  store.create({ controller: actor, authority: 'Explicit fixture handover', objective: 'Keep pressure', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated goal' }, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'Fixture user', outcome: 'Preserve pressure' } }] });
  store.remind(actor, store.read().revision, () => true);
  const state = store.read(undefined, { hydrate: false });
  const history = store.db.prepare('SELECT state FROM history WHERE run_id=? AND revision=?').get(state.id, state.stopRecovery.atRevision).state;
  const accounting = new ProgressStore(store);
  let inputBytes = 0;
  const creation = { bytes: 0, artifacts: new Set(), artifactLimit: progress.MAX_FRONTIER_BYTES, chargeInput: body => { inputBytes += Buffer.byteLength(body); } };
  assert.deepEqual(accounting.reminderProvenance(state, creation), state.stopRecovery);
  assert.equal(inputBytes, Buffer.byteLength(history));
  const artifactBytes = [...creation.artifacts].reduce((sum, id) => sum + Buffer.byteLength(store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(id).body), 0);
  assert.equal(creation.bytes, artifactBytes);
  const recovery = { bytes: 0, artifacts: new Set() };
  accounting.reminderProvenance(state, recovery);
  assert.equal(recovery.bytes, artifactBytes + Buffer.byteLength(history));
  const exhausted = { bytes: progress.MAX_RECOVERY_BYTES - Buffer.byteLength(history) + 1, artifacts: new Set() };
  assert.throws(() => accounting.reminderProvenance(state, exhausted), { code: 'progress-history-limit' });
});

test('default artifact recovery retains its combined sixteen MiB bound', t => {
  const parent = path.resolve(__dirname, '../.tmp/default-artifact-budget');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const store = new RunStore(root, { create: true });
  t.after(() => { store.close(); assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const body = JSON.stringify('x'.repeat(9 * 1024 * 1024));
  const id = createHash('sha256').update(body).digest('hex');
  store.db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(id, body);
  const accounting = new ProgressStore(store);
  const recovery = { bytes: 0, artifacts: new Set() };
  accounting.artifact(id, recovery);
  assert.equal(recovery.bytes, Buffer.byteLength(body));
  const full = { bytes: progress.MAX_RECOVERY_BYTES - Buffer.byteLength(body), artifacts: new Set() };
  accounting.artifact(id, full);
  assert.equal(full.bytes, progress.MAX_RECOVERY_BYTES);
  const beyond = { bytes: progress.MAX_RECOVERY_BYTES - Buffer.byteLength(body) + 1, artifacts: new Set() };
  assert.throws(() => accounting.artifact(id, beyond), { code: 'progress-history-limit' });
});
