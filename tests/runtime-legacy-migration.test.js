'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { execute: migrationExecute } = require('../internal/runtime/legacy-migration');
const { execute: runtimeExecute } = require('../internal/runtime/cli');
const { TRIGGERS, readArtifact, sha256 } = require('../internal/runtime/legacy-store');
const { validateCertificate } = require('../internal/runtime/legacy-certificates');
const { hydrateArtifact } = require('../internal/runtime/artifact-hydration');
const { reportProjection } = require('../internal/runtime/legacy-report');
const { targetEntry } = require('../internal/runtime/legacy-backlog');
const { creationAssessment } = require('../internal/runtime/creation-consistency');
const { RunStore } = require('../internal/runtime/store');
const { ProgressStore } = require('../internal/runtime/progress-store');
const { ProvenanceStore } = require('../internal/runtime/provenance-store');
const { fixtureAcknowledgement } = require('./fixtures/acknowledgement');
const { completeReflection } = require('./fixtures/completion');

const execute = (root, request, context = null, dependencies = {}) => migrationExecute(root, request, context, { ...dependencies, fixtureRetirement: true });

function fixture(t, options = {}) {
  const parent = path.resolve(__dirname, '../.tmp/runtime-legacy-migration');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const canonical = fs.realpathSync.native(root);
  const directory = path.join(canonical, '.nightshift/runs');
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'state.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL); CREATE TABLE active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL REFERENCES runs(id)); CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision)); PRAGMA user_version=1;');
  const id = randomUUID();
  const state = { schema: 1, kind: 'delivery', id, root: canonical, revision: 0, status: options.status ?? 'complete', controller: { host: 'codex', session: 'fixture-owner' }, resourceMode: 'development', tasks: [], workers: [], followups: options.followups ?? [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  if (options.report) {
    const relative = options.report.path ?? '.nightshift/runs/reports/old.md';
    if (options.report.bytes) {
      const reportFile = path.join(canonical, relative);
      fs.mkdirSync(path.dirname(reportFile), { recursive: true });
      fs.writeFileSync(reportFile, options.report.bytes);
    }
    state.handover = { authority: 'Fixture handover' };
    state.closing = { reportEvidence: { path: relative, sha256: options.report.savedHash ?? sha256(options.report.bytes ?? '') }, reportDelivery: null };
  }
  const body = JSON.stringify(state);
  db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(id, 0, body);
  db.prepare('INSERT INTO active VALUES (?, ?)').run(1, id);
  db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(id, 0, state.status, state.updatedAt, body);
  db.close();

  return { root: canonical, id };
}

const choiceFor = id => ({ runId: id, disposition: 'retired-complete', report: { kind: 'none' }, followups: [] });

function addCompletedRun(root, originalId) {
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const original = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(originalId).state);
    const second = { ...original, id: randomUUID(), controller: { host: 'codex', session: 'another-owner' } };
    const body = JSON.stringify(second);
    db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(second.id, 0, body);
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(second.id, 0, 'complete', second.updatedAt, body);

    return second.id;
  } finally { db.close(); }
}

function replaceApprovalManifest(root, runId, change) {
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const currentId = db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(runId).artifact;
    const current = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(currentId).body);
    const manifest = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(current.manifestHash).body);
    const changedManifest = JSON.stringify(change(structuredClone(manifest)));
    const changedManifestId = sha256(changedManifest);
    const changedCertificate = JSON.stringify({ ...current, manifestHash: changedManifestId, supersedes: currentId });
    const changedCertificateId = sha256(changedCertificate);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(changedManifestId, changedManifest);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(changedCertificateId, changedCertificate);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(changedCertificateId, runId);
  } finally { db.close(); }
}

test('retirement of a version-one completed delivery is atomic, repeatable and protects its old state', async t => {
  const { root, id } = fixture(t);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  const choice = choiceFor(id);
  const before = execute(root, { action: 'inventory' });
  assert.equal(before.counts.legacy, 1);
  const preview = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  assert.match(preview.hash, /^[a-f0-9]{64}$/);
  assert.equal(preview.schema, 1);
  assert.equal(preview.storeInventoryHash, before.storeInventoryHash);

  const request = { action: 'retire', ids: [id], choices: [choice], manifestHash: preview.hash, authority: 'Approve the exact fixture manifest', actor: { host: 'codex', session: 'fixture-owner' } };
  const retired = execute(root, request);
  assert.equal(retired.state, 'retired');
  assert.equal(execute(root, request).state, 'already-retired');
  assert.equal(execute(root, { ...request, choices: [{ runId: id, disposition: 'retired-complete', report: { kind: 'none' } }] }).state, 'already-retired');
  const db = new DatabaseSync(file);
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(db.prepare('SELECT count(*) AS count FROM legacy_retirements').get().count, 1);
    assert.throws(() => db.prepare('UPDATE runs SET revision=1 WHERE id=?').run(id), /retired-run/);
  } finally { db.close(); }
  const store = new RunStore(root);
  try {
    assert.equal(store.transaction(() => creationAssessment(store)).replaceable, true);
    assert.throws(() => store.update({ host: 'codex', session: 'fixture-owner' }, 0, 'hold', () => {}), { code: 'retired-run' });
  }
  finally { store.close(); }
  const next = await runtimeExecute(root, { action: 'handover', handoverId: randomUUID(), controller: { host: 'codex', session: 'new-owner' }, authority: 'Fixture approval for new work', objective: 'New delivery', tasks: [{ id: 'new-work', title: 'New work', agreement: { source: 'Fixture', outcome: 'New delivery' } }] }, { nativeOwner: () => ({ pid: 12345, created: 'fixture', name: 'codex.exe' }), ownerAlive: () => true });
  assert.notEqual(next.id, id);
  assert.equal(next.status, 'running');
});

test('a missing decision leaves a version-one store untouched', t => {
  const { root, id } = fixture(t);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  assert.throws(() => execute(root, { action: 'retire', ids: [id], choices: [], manifestHash: 'a'.repeat(64), authority: 'Incomplete', actor: { host: 'codex', session: 'fixture-owner' } }), { code: 'migration-decision-unavailable' });
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='artifacts' OR name='legacy_retirements'").get().count, 0);
  } finally { db.close(); }
});

test('malformed approval choices report a decision error', t => {
  // Arrange
  const { root, id } = fixture(t);
  const pending = fixture(t, { followups: [{ id: 'question', status: 'pending' }] });

  // Act
  const nullChoice = () => execute(root, { action: 'manifest', ids: [id], choices: [null] });
  const nullFollowup = () => execute(pending.root, { action: 'manifest', ids: [pending.id], choices: [{ ...choiceFor(pending.id), followups: [null] }] });

  // Assert
  assert.throws(nullChoice, { code: 'migration-decision-unavailable' });
  assert.throws(nullFollowup, { code: 'migration-decision-unavailable' });
});

test('development admission cannot retire even an old unbound record', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const request = { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Caller supplied approval', actor: { host: 'codex', session: 'fixture-owner' } };
  assert.throws(() => migrationExecute(root, request), { code: 'migration-admission-required' });
  assert.equal(fs.existsSync(path.join(root, '.nightshift/runs/write-ownership.sqlite')), false);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1); }
  finally { db.close(); }
});

test('a refused handover leaves a version-one delivery store at its original schema', async t => {
  const { root } = fixture(t);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  const request = { action: 'handover', handoverId: randomUUID(), controller: { host: 'codex', session: 'new-owner' }, authority: 'Fixture handover', objective: 'New work', tasks: [{ id: 'work', title: 'New work', agreement: { source: 'Fixture', outcome: 'New work' } }] };
  const dependencies = { nativeOwner: () => ({ pid: 12345, created: 'fixture', name: 'codex.exe' }), ownerAlive: () => true };
  await assert.rejects(runtimeExecute(root, request, dependencies), { code: 'delivery-consistency-unavailable' });
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='artifacts' OR name='accounting_commits' OR name='discharge_index'").get().count, 0);
  } finally { db.close(); }
});

test('legacy provenance reads work without adding accounting tables to a version-one store', t => {
  // Arrange
  const { root } = fixture(t);
  const store = new RunStore(root);

  // Act
  let provenance;
  try { provenance = new ProvenanceStore(new ProgressStore(store)).read(store.read(undefined, { hydrate: false })); }
  finally { store.close(); }

  // Assert
  assert.equal(provenance, null);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='accounting_commits' OR name='discharge_index'").get().count, 0);
  } finally { db.close(); }
});

test('surviving SQLite sidecars prevent a missing store from appearing empty', async t => {
  const { root } = fixture(t);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  fs.unlinkSync(file);
  fs.writeFileSync(file + '-wal', 'orphaned sidecar');
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  const request = { action: 'handover', handoverId: randomUUID(), controller: { host: 'codex', session: 'new-owner' }, authority: 'Fixture handover', objective: 'New work', tasks: [{ id: 'work', title: 'New work', agreement: { source: 'Fixture', outcome: 'New work' } }] };
  await assert.rejects(runtimeExecute(root, request, { nativeOwner: () => ({ pid: 12345, created: 'fixture', name: 'codex.exe' }), ownerAlive: () => true }), { code: 'missing-predecessor' });
  assert.equal(fs.existsSync(file), false);
});

test('a pre-existing version-zero database is not initialized by refused creation', async t => {
  const parent = path.resolve(__dirname, '../.tmp/runtime-legacy-migration');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'version-zero-'));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const directory = path.join(root, '.nightshift/runs');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'state.sqlite');
  fs.writeFileSync(file, '');
  const request = { action: 'handover', handoverId: randomUUID(), controller: { host: 'codex', session: 'new-owner' }, authority: 'Fixture handover', objective: 'New work', tasks: [{ id: 'work', title: 'New work', agreement: { source: 'Fixture', outcome: 'New work' } }] };
  await assert.rejects(runtimeExecute(root, request, { nativeOwner: () => ({ pid: 12345, created: 'fixture', name: 'codex.exe' }), ownerAlive: () => true }), { code: 'state-version' });
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 0);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table'").get().count, 0);
  } finally { db.close(); }
});

test('tracked legacy follow-ups bind their backlog entry and require reapproval after it changes', async t => {
  const { root, id } = fixture(t, { followups: [{ id: 'saved-question', status: 'pending', title: 'Track the saved question' }] });
  const backlog = path.join(root, '.nightshift/BUGS.md');
  fs.writeFileSync(backlog, ['# Bugs', '', '### Saved question', '', 'Original tracking text.', ''].join(String.fromCharCode(13, 10)));
  const choice = { ...choiceFor(id), followups: [{ id: 'saved-question', disposition: 'tracked', destination: { path: '.nightshift/BUGS.md', anchor: 'saved-question' } }] };
  const inventoryBefore = execute(root, { action: 'inventory' });
  assert.deepEqual(inventoryBefore.preview[0].followups.map(item => item.id), ['saved-question']);
  assert.ok(Array.isArray(inventoryBefore.preview[0].incompleteTasks));
  assert.ok(Array.isArray(inventoryBefore.preview[0].workers));
  assert.equal(inventoryBefore.preview[0].closing.stage, 'retrospective');
  const approval = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const request = { action: 'retire', ids: [id], choices: [choice], manifestHash: approval.hash, authority: 'Approve tracking the saved question', actor: { host: 'codex', session: 'fixture-owner' } };
  execute(root, request);
  const inventoryAfter = execute(root, { action: 'inventory' });
  assert.equal(inventoryAfter.preview[0].retiredFollowups[0].disposition, 'tracked');
  assert.equal(inventoryAfter.preview[0].retiredFollowups[0].destination.path, '.nightshift/BUGS.md');
  assert.equal(inventoryAfter.preview[0].retiredFollowups[0].destinationStatus.status, 'current');
  const status = await runtimeExecute(root, { action: 'status' });
  assert.equal(status.legacyFollowups.total, 1);
  assert.equal(status.legacyFollowups.items[0].disposition, 'tracked');
  fs.writeFileSync(backlog, ['# Bugs', '', '### Saved question', '', 'Different tracking text.', ''].join(String.fromCharCode(13, 10)));
  const driftedInventory = execute(root, { action: 'inventory' });
  assert.equal(driftedInventory.preview[0].retiredFollowups[0].retirement.status, 'unavailable');
  assert.equal(driftedInventory.preview[0].retiredFollowups[0].destinationStatus.status, 'drifted');
  const staleStatus = await runtimeExecute(root, { action: 'status' });
  assert.equal(staleStatus.legacyFollowups.items[0].retirement.status, 'unavailable');
  assert.equal(staleStatus.legacyFollowups.items[0].destinationStatus.status, 'drifted');
  assert.throws(() => execute(root, request), { code: 'migration-certificate-stale' });
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
  const revised = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  assert.notEqual(revised.hash, approval.hash);
  assert.equal(execute(root, { ...request, manifestHash: revised.hash, authority: 'Approve the changed tracking entry' }).state, 'retired');
});

test('a byte-order mark change stales a whole-record tracked destination', t => {
  const { root, id } = fixture(t, { followups: [{ id: 'saved-question', status: 'pending' }] });
  const index = path.join(root, '.nightshift/FEATURES.md');
  const record = path.join(root, '.nightshift/features/saved-question.md');
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(index, ['# Features', '', '[Saved question](features/saved-question.md)', ''].join(String.fromCharCode(10)));
  const content = ['# Saved question', '', 'Original tracking text.', ''].join(String.fromCharCode(10));
  fs.writeFileSync(record, content);
  const choice = { ...choiceFor(id), followups: [{ id: 'saved-question', disposition: 'tracked', destination: { path: '.nightshift/features/saved-question.md', anchor: null } }] };
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the whole-record target', actor: { host: 'codex', session: 'fixture-owner' } });
  fs.writeFileSync(record, String.fromCodePoint(0xFEFF) + content);
  const inventory = execute(root, { action: 'inventory' });
  assert.equal(inventory.preview[0].retiredFollowups[0].destinationStatus.status, 'drifted');
  assert.equal(inventory.preview[0].retirement.status, 'unavailable');
});

test('tracked heading anchors follow the shared backlog heading order', t => {
  const { root } = fixture(t);
  const index = path.join(root, '.nightshift/FEATURES.md');
  const record = path.join(root, '.nightshift/features/repeated-heading.md');
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(index, ['# Features', '', '[Repeated heading](features/repeated-heading.md)', ''].join(String.fromCharCode(10)));
  const first = ['### Foo', 'First tracked section.', ''].join(String.fromCharCode(10));
  const content = ['# Record', '', 'Foo', '---', '', first, '### Foo', 'Second tracked section.', ''].join(String.fromCharCode(10));
  fs.writeFileSync(record, content);
  const destination = targetEntry(root, { path: '.nightshift/features/repeated-heading.md', anchor: 'foo-1' });
  assert.equal(destination.entryHash, sha256(Buffer.from(first + String.fromCharCode(10))));
});

test('tracked heading anchors keep lone carriage returns in the Ready line model', t => {
  const { root } = fixture(t);
  const index = path.join(root, '.nightshift/FEATURES.md');
  const record = path.join(root, '.nightshift/features/lone-carriage-return.md');
  fs.mkdirSync(path.dirname(record), { recursive: true });
  const newline = String.fromCharCode(10);
  fs.writeFileSync(index, ['# Features', '', '[Lone carriage return](features/lone-carriage-return.md)', ''].join(newline));
  const second = ['### Foo', 'Second tracked section.', ''].join(newline);
  const content = ['# Record', '', 'Foo' + String.fromCharCode(13) + '---', '', '### Foo', 'First tracked section.', '', second].join(newline);
  fs.writeFileSync(record, content);
  const destination = targetEntry(root, { path: '.nightshift/features/lone-carriage-return.md', anchor: 'foo-1' });
  assert.equal(destination.entryHash, sha256(Buffer.from(second)));
});

test('tracked targets reject fences left open under the Ready line model', t => {
  const { root } = fixture(t);
  const index = path.join(root, '.nightshift/FEATURES.md');
  const record = path.join(root, '.nightshift/features/open-fence.md');
  fs.mkdirSync(path.dirname(record), { recursive: true });
  const newline = String.fromCharCode(10);
  fs.writeFileSync(index, ['# Features', '', '[Open fence](features/open-fence.md)', ''].join(newline));
  fs.writeFileSync(record, ['# Record', '', '```', 'text' + String.fromCharCode(13) + '```', ''].join(newline));
  assert.throws(() => targetEntry(root, { path: '.nightshift/features/open-fence.md', anchor: null }), { code: 'migration-followup-target-unavailable' });
});

test('a stale earlier retirement does not block an unrelated approved retirement', t => {
  // Arrange
  const { root, id } = fixture(t, { followups: [{ id: 'question', status: 'pending' }] });
  const second = addCompletedRun(root, id);
  const backlog = path.join(root, '.nightshift/BUGS.md');
  fs.writeFileSync(backlog, ['# Bugs', '', '### Question', '', 'Original tracking text.', ''].join(String.fromCharCode(13, 10)));
  const firstChoice = { ...choiceFor(id), followups: [{ id: 'question', disposition: 'tracked', destination: { path: '.nightshift/BUGS.md', anchor: 'question' } }] };
  const firstManifest = execute(root, { action: 'manifest', ids: [id], choices: [firstChoice] });
  execute(root, { action: 'retire', ids: [id], choices: [firstChoice], manifestHash: firstManifest.hash, authority: 'Approve first record and tracking', actor: { host: 'codex', session: 'fixture-owner' } });
  fs.writeFileSync(backlog, ['# Bugs', '', '### Question', '', 'Changed tracking text.', ''].join(String.fromCharCode(13, 10)));
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
  const secondChoice = { ...choiceFor(second), followups: [{ id: 'question', disposition: 'dismissed', destination: null }] };
  const secondManifest = execute(root, { action: 'manifest', ids: [second], choices: [secondChoice] });

  // Act
  const retired = execute(root, { action: 'retire', ids: [second], choices: [secondChoice], manifestHash: secondManifest.hash, authority: 'Approve second record and dismissal', actor: { host: 'codex', session: 'fixture-owner' } });

  // Assert
  assert.equal(retired.state, 'retired');
  const inventory = execute(root, { action: 'inventory' });
  assert.equal(inventory.counts.retired, 1);
  assert.equal(inventory.counts.unavailableRetirements, 1);
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
});

test('a malformed unrelated certificate does not block an eligible retirement', t => {
  // Arrange
  const { root, id } = fixture(t);
  const second = addCompletedRun(root, id);
  const firstChoice = choiceFor(id);
  const first = execute(root, { action: 'manifest', ids: [id], choices: [firstChoice] });
  execute(root, { action: 'retire', ids: [id], choices: [firstChoice], manifestHash: first.hash, authority: 'Approve first fixture record', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const malformed = sha256('null');
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(malformed, 'null');
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(malformed, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
  const choice = choiceFor(second);
  const manifest = execute(root, { action: 'manifest', ids: [second], choices: [choice] });

  // Act
  const retired = execute(root, { action: 'retire', ids: [second], choices: [choice], manifestHash: manifest.hash, authority: 'Approve unrelated fixture record', actor: { host: 'codex', session: 'fixture-owner' } });

  // Assert
  assert.equal(retired.state, 'retired');
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('invalid UTF-8 in a tracked backlog target cannot share a normalized hash', t => {
  // Arrange
  const { root, id } = fixture(t, { followups: [{ id: 'question', status: 'pending' }] });
  fs.writeFileSync(path.join(root, '.nightshift/BUGS.md'), Buffer.from([35, 32, 66, 117, 103, 115, 10, 255, 10]));
  const choice = { ...choiceFor(id), followups: [{ id: 'question', disposition: 'tracked', destination: { path: '.nightshift/BUGS.md', anchor: 'bugs' } }] };

  // Act
  const preview = () => execute(root, { action: 'manifest', ids: [id], choices: [choice] });

  // Assert
  assert.throws(preview, { code: 'migration-followup-target-unavailable' });
});

test('a tracked destination changed after resource preflight rolls retirement back', t => {
  const { root, id } = fixture(t, { followups: [{ id: 'question', status: 'pending', title: 'Question' }] });
  const backlog = path.join(root, '.nightshift/BUGS.md');
  const original = ['# Bugs', '', '### Question', '', 'Approved tracking text.', ''].join(String.fromCharCode(13, 10));
  fs.writeFileSync(backlog, original);
  const choice = { ...choiceFor(id), followups: [{ id: 'question', disposition: 'tracked', destination: { path: '.nightshift/BUGS.md', anchor: 'question' } }] };
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const request = { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve exact tracking text', actor: { host: 'codex', session: 'fixture-owner' } };
  assert.throws(() => execute(root, request, null, { afterResourcePreflight: () => fs.writeFileSync(backlog, original.replace('Approved', 'Changed')) }), { code: 'migration-manifest-stale' });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1); }
  finally { db.close(); }
});

test('a report decision is bound to the bytes shown before retirement', t => {
  const initial = ['# Report', '', 'Initial report.', ''].join(String.fromCharCode(13, 10));
  const changed = ['# Report', '', 'Changed report.', ''].join(String.fromCharCode(13, 10));
  const { root, id } = fixture(t, { report: { bytes: initial } });
  const reportFile = path.join(root, '.nightshift/runs/reports/old.md');
  const choice = { ...choiceFor(id), report: { kind: 'confirmed' } };
  assert.equal(execute(root, { action: 'inventory' }).preview[0].report.owed, true);
  const preview = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  fs.writeFileSync(reportFile, changed);
  const request = { action: 'retire', ids: [id], choices: [choice], manifestHash: preview.hash, authority: 'I saw the initial report and approve this manifest', actor: { host: 'codex', session: 'fixture-owner' } };
  assert.throws(() => execute(root, request), { code: 'migration-decision-unavailable' });
  fs.writeFileSync(reportFile, initial);
  assert.equal(execute(root, request).state, 'retired');
  fs.writeFileSync(reportFile, changed);
  assert.equal(execute(root, request).state, 'already-retired');
  const store = new RunStore(root);
  try { assert.equal(store.transaction(() => creationAssessment(store)).replaceable, true); }
  finally { store.close(); }
});

test('a report changed after manifest validation rolls retirement back', t => {
  const initial = ['# Report', '', 'Approved report.', ''].join(String.fromCharCode(13, 10));
  const changed = ['# Report', '', 'Changed before commit.', ''].join(String.fromCharCode(13, 10));
  const { root, id } = fixture(t, { report: { bytes: initial } });
  const reportFile = path.join(root, '.nightshift/runs/reports/old.md');
  const choice = { ...choiceFor(id), report: { kind: 'confirmed' } };
  const preview = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const request = { action: 'retire', ids: [id], choices: [choice], manifestHash: preview.hash, authority: 'Approve the exact report bytes', actor: { host: 'codex', session: 'fixture-owner' } };
  assert.throws(() => execute(root, request, null, { afterManifest: () => fs.writeFileSync(reportFile, changed) }), { code: 'migration-manifest-stale' });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='legacy_retirements'").get().count, 0);
  } finally { db.close(); }
});

test('a report read checks its actual bytes against the aggregate allowance', t => {
  // Arrange
  const { root, id } = fixture(t, { report: { bytes: 'x'.repeat(100) } });
  const reportFile = path.join(root, '.nightshift/runs/reports/old.md');
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  let state;
  try { state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state); }
  finally { db.close(); }
  const lstat = fs.lstatSync;
  let distorted = false;
  fs.lstatSync = (target, options) => {
    const metadata = lstat(target, options);
    if (!distorted && target === reportFile && metadata) { metadata.size = 1; distorted = true; }

    return metadata;
  };
  const budget = { bytes: 16 * 1024 * 1024 - 50, maximum: 16 * 1024 * 1024 };

  // Act and assert
  try { assert.throws(() => reportProjection(root, state, budget), { code: 'migration-report-bound' }); }
  finally { fs.lstatSync = lstat; }
  assert.equal(distorted, true);
});

test('oversized reports need an explicit waiver rather than a confirmation', t => {
  const { root, id } = fixture(t, { report: { bytes: Buffer.alloc(1024 * 1024 + 1, 65) } });
  const waived = { ...choiceFor(id), report: { kind: 'waived' } };
  const preview = execute(root, { action: 'manifest', ids: [id], choices: [waived] });
  assert.equal(preview.members[0].record.report.file.reason, 'oversized');
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [{ ...waived, report: { kind: 'confirmed' } }] }), { code: 'migration-decision-unavailable' });
  assert.equal(execute(root, { action: 'retire', ids: [id], choices: [waived], manifestHash: preview.hash, authority: 'I waive the unavailable report and approve this manifest', actor: { host: 'codex', session: 'fixture-owner' } }).state, 'retired');
});

test('unsafe saved report paths are diagnosed without reading outside the project', t => {
  const { root, id } = fixture(t, { report: { path: '.nightshift/runs/reports/../../../outside.md' } });
  const choice = { ...choiceFor(id), report: { kind: 'waived' } };
  const preview = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  assert.equal(preview.members[0].record.report.file.status, 'unavailable');
  assert.equal(preview.members[0].record.report.file.reason, 'unsafe-path');
  assert.equal(execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: preview.hash, authority: 'I waive the unsafe report path', actor: { host: 'codex', session: 'fixture-owner' } }).state, 'retired');
});

test('a multiply linked saved report is diagnosed as linked', t => {
  const { root, id } = fixture(t, { report: { bytes: '# Saved report' } });
  const original = path.join(root, '.nightshift/runs/reports/old.md');
  fs.linkSync(original, path.join(root, '.nightshift/runs/reports/other.md'));
  const preview = execute(root, { action: 'manifest', ids: [id], choices: [{ ...choiceFor(id), report: { kind: 'waived' } }] });
  assert.equal(preview.members[0].record.report.file.reason, 'linked');
});

test('a linked report parent is unsafe even when its final file is also linked', t => {
  const { root, id } = fixture(t, { report: { bytes: '# Saved report' } });
  const source = path.join(root, '.nightshift/runs/reports/old.md');
  const alternate = path.join(root, 'linked-report-target');
  fs.mkdirSync(alternate);
  fs.linkSync(source, path.join(alternate, 'old.md'));
  const linked = path.join(root, '.nightshift/runs/reports/linked');
  try { fs.symlinkSync(alternate, linked, 'junction'); }
  catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Directory links are unavailable to this test process');
    throw error;
  }
  try {
    const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
    try {
      const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
      state.closing.reportEvidence.path = '.nightshift/runs/reports/linked/old.md';
      const body = JSON.stringify(state);
      db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
      db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
    } finally { db.close(); }
    const preview = execute(root, { action: 'manifest', ids: [id], choices: [{ ...choiceFor(id), report: { kind: 'waived' } }] });
    assert.equal(preview.members[0].record.report.file.reason, 'unsafe-path');
  } finally { fs.unlinkSync(linked); }
});

test('a new delivery identity stales an approved batch without changing its members', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const preview = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  addCompletedRun(root, id);
  assert.throws(() => execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: preview.hash, authority: 'Approve the earlier inventory', actor: { host: 'codex', session: 'fixture-owner' } }), { code: 'migration-manifest-stale' });
});

test('separate retirement batches preserve each other and unblock only after all legacy records are resolved', t => {
  const { root, id } = fixture(t);
  const second = addCompletedRun(root, id);
  const retireOne = runId => {
    const choice = choiceFor(runId);
    const manifest = execute(root, { action: 'manifest', ids: [runId], choices: [choice] });

    return execute(root, { action: 'retire', ids: [runId], choices: [choice], manifestHash: manifest.hash, authority: `Approve retirement of ${runId}`, actor: { host: 'codex', session: 'fixture-owner' } });
  };
  assert.equal(retireOne(id).state, 'retired');
  let store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
  assert.equal(retireOne(second).state, 'retired');
  store = new RunStore(root);
  try { assert.equal(store.transaction(() => creationAssessment(store)).replaceable, true); }
  finally { store.close(); }
});

test('a shared approval manifest is fetched once while validating its retired members', t => {
  // Arrange
  const { root, id } = fixture(t);
  const second = addCompletedRun(root, id);
  const choices = [choiceFor(id), choiceFor(second)];
  const manifest = execute(root, { action: 'manifest', ids: [id, second], choices });
  execute(root, { action: 'retire', ids: [id, second], choices, manifestHash: manifest.hash, authority: 'Approve both fixture records', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  let manifestReads = 0;
  const counting = { prepare(sql) {
    const statement = db.prepare(sql);
    return { get(...args) {
      if (sql.startsWith('SELECT body FROM artifacts') && args[0] === manifest.hash) manifestReads++;

      return statement.get(...args);
    } };
  } };
  const budgets = {};

  // Act
  try {
    for (const runId of [id, second]) {
      const row = db.prepare('SELECT id, revision, state FROM runs WHERE id=?').get(runId);
      const latest = db.prepare('SELECT state FROM history WHERE run_id=? AND revision=?').get(runId, row.revision);
      const artifact = db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(runId).artifact;
      validateCertificate(counting, root, row, JSON.parse(row.state), latest, artifact, budgets);
    }

    // Assert
    assert.equal(manifestReads, 1);
    assert.equal(budgets.manifests.cache.size, 1);
  } finally { db.close(); }
});

test('tracked destinations are bounded separately for each approved retirement manifest', t => {
  const pending = Array.from({ length: 9 }, (_, index) => ({ id: `question-${index}`, status: 'pending', title: `Question ${index}` }));
  const { root, id } = fixture(t, { followups: pending });
  const second = addCompletedRun(root, id);
  const records = path.join(root, '.nightshift/bugs');
  fs.mkdirSync(records, { recursive: true });
  const links = [];
  for (let index = 0; index < 18; index++) {
    fs.writeFileSync(path.join(records, `target-${index}.md`), [`# Target ${index}`, '', 'x'.repeat(959000), ''].join(String.fromCharCode(13, 10)));
    links.push(`[Target ${index}](bugs/target-${index}.md)`);
  }
  fs.writeFileSync(path.join(root, '.nightshift/BUGS.md'), ['# Bugs', '', ...links, ''].join(String.fromCharCode(13, 10)));
  const retire = (runId, offset) => {
    const choice = { ...choiceFor(runId), followups: pending.map((item, index) => ({ id: item.id, disposition: 'tracked', destination: { path: `.nightshift/bugs/target-${offset + index}.md`, anchor: null } })) };
    const manifest = execute(root, { action: 'manifest', ids: [runId], choices: [choice] });

    return execute(root, { action: 'retire', ids: [runId], choices: [choice], manifestHash: manifest.hash, authority: `Approve tracked destinations for ${runId}`, actor: { host: 'codex', session: 'fixture-owner' } });
  };
  assert.equal(retire(id, 0).state, 'retired');
  assert.equal(retire(second, 9).state, 'retired');
  const store = new RunStore(root);
  try { assert.equal(store.transaction(() => creationAssessment(store)).replaceable, true); }
  finally { store.close(); }
});

test('a schema-two record with missing independent accounting cannot be retired as legacy', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.progress = { schema: 2 };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.damagedModern, 1);
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }), { code: 'migration-decision-unavailable' });
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), error => error.code === 'delivery-consistency-unavailable' && error.message.includes('unsupported accounting')); }
  finally { store.close(); }
});

test('a running legacy record is diagnosed as unfinished work, not retirement eligibility', t => {
  // Arrange
  const { root, id } = fixture(t, { status: 'running' });
  const store = new RunStore(root);

  // Act
  const refusal = () => store.transaction(() => creationAssessment(store));

  // Assert
  try {
    assert.throws(refusal, error => error.code === 'delivery-consistency-unavailable' && error.message.includes('running:no-independent-accounting') && error.message.includes('reconcile running work directly') && error.message.includes(id));
  } finally { store.close(); }
});

test('a legacy replay revision bound names the record and migration route', t => {
  // Arrange
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE accounting_commits (run_id TEXT NOT NULL, revision INTEGER NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, revision)); CREATE TABLE discharge_index (run_id TEXT NOT NULL, occurrence TEXT NOT NULL, evidence_hash TEXT NOT NULL, binding_hash TEXT NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, occurrence, evidence_hash, binding_hash, artifact)); PRAGMA user_version=2;');
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    const insert = db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)');
    for (let revision = 1; revision <= 256; revision++) {
      state.revision = revision;
      insert.run(id, revision, 'complete', state.updatedAt, JSON.stringify(state));
    }
    db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(256, JSON.stringify(state), id);
  } finally { db.close(); }
  const store = new RunStore(root);

  // Act
  const refusal = () => store.transaction(() => creationAssessment(store));

  // Assert
  try { assert.throws(refusal, error => error.code === 'delivery-consistency-unavailable' && error.message.includes(id) && error.message.includes('legacy-replay-bound') && error.message.includes('migration inventory')); }
  finally { store.close(); }
});

test('several long legacy replays retain every blocking identity within the shared input bound', t => {
  // Arrange
  const { root, id } = fixture(t);
  const ids = [id, ...Array.from({ length: 4 }, () => addCompletedRun(root, id))];
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE accounting_commits (run_id TEXT NOT NULL, revision INTEGER NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, revision)); CREATE TABLE discharge_index (run_id TEXT NOT NULL, occurrence TEXT NOT NULL, evidence_hash TEXT NOT NULL, binding_hash TEXT NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, occurrence, evidence_hash, binding_hash, artifact)); PRAGMA user_version=2; BEGIN');
    const insert = db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)');
    const updateFirst = db.prepare('UPDATE history SET state=? WHERE run_id=? AND revision=0');
    const updateCurrent = db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?');
    const padding = 'x'.repeat(81000);
    for (const runId of ids) {
      const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(runId).state);
      state.padding = padding;
      for (let revision = 0; revision < 210; revision++) {
        state.revision = revision;
        const body = JSON.stringify(state);
        if (revision === 0) updateFirst.run(body, runId);
        else insert.run(runId, revision, 'complete', state.updatedAt, body);
        if (revision === 209) updateCurrent.run(revision, body, runId);
      }
    }
    db.exec('COMMIT');
  } finally { db.close(); }
  const store = new RunStore(root);

  // Act
  const refusal = () => store.transaction(() => creationAssessment(store));

  // Assert
  try { assert.throws(refusal, error => error.code === 'delivery-consistency-unavailable' && error.message.includes('5 record(s)') && ids.every(runId => error.message.includes(runId)) && error.message.includes('migration inventory')); }
  finally { store.close(); }
});

test('creation bounds artifacts and current state separately for a legacy store', t => {
  // Arrange
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE accounting_commits (run_id TEXT NOT NULL, revision INTEGER NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, revision)); CREATE TABLE discharge_index (run_id TEXT NOT NULL, occurrence TEXT NOT NULL, evidence_hash TEXT NOT NULL, binding_hash TEXT NOT NULL, artifact TEXT NOT NULL, PRIMARY KEY(run_id, occurrence, evidence_hash, binding_hash, artifact)); PRAGMA user_version=2;');
    const artifact = JSON.stringify('x'.repeat(48 * 1024 * 1024 - 2));
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(sha256(artifact), artifact);
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.padding = 'y'.repeat(12 * 1024 * 1024);
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  const store = new RunStore(root);

  // Act
  let result;
  try { result = store.transaction(() => creationAssessment(store, { resourceOnly: true })); }
  finally { store.close(); }

  // Assert
  assert.equal(result.artifactCount, 1);
  assert.ok(result.artifactBytes > 47 * 1024 * 1024);
  assert.ok(result.inputBytes > 24 * 1024 * 1024);
});

test('an eligible legacy record retires beside damaged modern discharge evidence', async t => {
  // Arrange
  const parent = path.resolve(__dirname, '../.tmp/runtime-legacy-migration');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'mixed-modern-'));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const actor = { host: 'codex', session: 'fixture-owner' };
  const dependencies = { nativeOwner: () => ({ pid: 12345, created: 'isolated-fixture', name: 'codex.exe' }), ownerAlive: () => true, acknowledgementObserver: fixtureAcknowledgement };
  await runtimeExecute(root, { action: 'handover', handoverId: randomUUID(), controller: actor, authority: 'Explicit fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture', outcome: 'Reflect without proposals' } }] }, dependencies);
  const modern = await completeReflection(root, actor, runtimeExecute, dependencies);
  const legacyId = randomUUID();
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const now = new Date().toISOString();
    const legacy = { schema: 1, kind: 'delivery', id: legacyId, root, revision: 0, status: 'complete', controller: actor, resourceMode: 'development', tasks: [], workers: [], followups: [], createdAt: now, updatedAt: now };
    const body = JSON.stringify(legacy);
    db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(legacyId, 0, body);
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(legacyId, 0, 'complete', now, body);
    const discharge = db.prepare('SELECT rowid FROM discharge_index WHERE run_id=? LIMIT 1').get(modern.id);
    assert.ok(discharge);
    db.prepare('DELETE FROM discharge_index WHERE rowid=?').run(discharge.rowid);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.damagedModern, 1);
  const choice = choiceFor(legacyId);
  const manifest = execute(root, { action: 'manifest', ids: [legacyId], choices: [choice] });

  // Act
  const retired = execute(root, { action: 'retire', ids: [legacyId], choices: [choice], manifestHash: manifest.hash, authority: 'Approve this eligible legacy record', actor });

  // Assert
  assert.equal(retired.state, 'retired');
  const after = execute(root, { action: 'inventory' });
  assert.equal(after.counts.retired, 1);
  assert.equal(after.counts.damagedModern, 1);
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
});

test('lost retirement write protection makes inventory unavailable', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the exact fixture manifest', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try { db.exec('DROP TRIGGER legacy_guard_runs_update'); }
  finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-protection-unavailable' });
});

test('store inventory identity includes the exact current retirement reference', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve this completed record', actor: { host: 'codex', session: 'fixture-owner' } });
  const before = execute(root, { action: 'inventory' });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const earlierId = db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(id).artifact;
    const earlier = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(earlierId).body);
    const later = JSON.stringify({ ...earlier, supersedes: earlierId, recordedAt: new Date(Date.now() + 1000).toISOString() });
    const laterId = sha256(later);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(laterId, later);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(laterId, id);
  }
  finally { db.close(); }
  const after = execute(root, { action: 'inventory' });
  assert.notEqual(after.storeInventoryHash, before.storeInventoryHash);
  assert.equal(after.counts.retired, 1);
});

test('a coherent later legacy revision can supersede a stale retirement without losing the earlier certificate', t => {
  // Arrange
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const first = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const original = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: first.hash, authority: 'Approve original work', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    for (const trigger of TRIGGERS) db.exec(`DROP TRIGGER ${trigger.name}`);
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.revision = 1;
    state.objective = 'Coherent later legacy work';
    state.updatedAt = new Date(Date.now() + 1000).toISOString();
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(1, body, id);
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(id, 1, 'complete', state.updatedAt, body);
    for (const trigger of TRIGGERS) db.exec(trigger.sql);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
  const next = execute(root, { action: 'manifest', ids: [id], choices: [choice] });

  // Act
  const superseded = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: next.hash, authority: 'Approve revised work', actor: { host: 'codex', session: 'fixture-owner' } });

  // Assert
  assert.equal(superseded.state, 'retired');
  const inventory = execute(root, { action: 'inventory' });
  assert.equal(inventory.counts.retired, 1);
  assert.equal(inventory.counts.unavailableRetirements, 0);
  const saved = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try {
    const current = saved.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(id).artifact;
    assert.equal(readArtifact(saved, current, 8192).supersedes, original.certificates[0].artifact);
  } finally { saved.close(); }
});

test('an identical retry after large superseded manifests returns the saved certificate', t => {
  // Arrange
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  let db = new DatabaseSync(file);
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.objective = 'a'.repeat(5 * 1024 * 1024);
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  const first = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: first.hash, authority: 'Approve first large manifest', actor: { host: 'codex', session: 'fixture-owner' } });
  db = new DatabaseSync(file);
  try {
    for (const trigger of TRIGGERS) db.exec(`DROP TRIGGER ${trigger.name}`);
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.revision = 1;
    state.objective = 'b'.repeat(5 * 1024 * 1024);
    state.updatedAt = new Date(Date.now() + 1000).toISOString();
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET revision=?, state=? WHERE id=?').run(1, body, id);
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(id, 1, 'complete', state.updatedAt, body);
    for (const trigger of TRIGGERS) db.exec(trigger.sql);
  } finally { db.close(); }
  const second = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const request = { action: 'retire', ids: [id], choices: [choice], manifestHash: second.hash, authority: 'Approve second large manifest', actor: { host: 'codex', session: 'fixture-owner' } };
  execute(root, request);

  // Act
  const retried = execute(root, request);

  // Assert
  assert.equal(retried.state, 'already-retired');
});

test('an orphaned retirement certificate cannot fall back to legacy replay', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve this completed record', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try { db.prepare('DELETE FROM legacy_retirements WHERE run_id=?').run(id); }
  finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), error => error.code === 'migration-evidence-unavailable' && error.message.includes(id));
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store, { resourceOnly: true })), error => error.code === 'delivery-consistency-unavailable' && error.message.includes('certificate')); }
  finally { store.close(); }
});

test('a missing current certificate diagnoses its run without blaming an earlier certificate', t => {
  // Arrange
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const first = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: first.hash, authority: 'Approve first fixture certificate', actor: { host: 'codex', session: 'fixture-owner' } });
  const second = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: second.hash, authority: 'Approve second fixture certificate', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const current = db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(id).artifact;
    db.prepare('DELETE FROM artifacts WHERE id=?').run(current);
  } finally { db.close(); }

  // Act
  const inventory = execute(root, { action: 'inventory' });

  // Assert
  assert.equal(inventory.counts.unavailableRetirements, 1);
  assert.equal(inventory.preview[0].retirement.status, 'unavailable');
  assert.match(inventory.preview[0].retirement.reason, /absent/);
});

test('an orphaned retirement remains detectable beside another broken chain', t => {
  // Arrange
  const { root, id } = fixture(t);
  const second = addCompletedRun(root, id);
  const choices = [choiceFor(id), choiceFor(second)];
  const first = execute(root, { action: 'manifest', ids: [id, second], choices });
  execute(root, { action: 'retire', ids: [id, second], choices, manifestHash: first.hash, authority: 'Approve both fixture records', actor: { host: 'codex', session: 'fixture-owner' } });
  const next = execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] });
  execute(root, { action: 'retire', ids: [id], choices: [choiceFor(id)], manifestHash: next.hash, authority: 'Supersede first fixture record', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const current = db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(id).artifact;
    db.prepare('DELETE FROM artifacts WHERE id=?').run(current);
    db.prepare('DELETE FROM legacy_retirements WHERE run_id=?').run(second);
  } finally { db.close(); }

  // Act
  const inventory = () => execute(root, { action: 'inventory' });

  // Assert
  assert.throws(inventory, error => error.code === 'migration-evidence-unavailable' && error.message.includes(second));
});

test('lost referenced state evidence makes a retired record unavailable to creation', t => {
  const { root, id } = fixture(t);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  const db = new DatabaseSync(file);
  let artifact;
  try {
    db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=2;');
    const evidence = JSON.stringify({ purpose: 'saved evidence' });
    artifact = sha256(evidence);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(artifact, evidence);
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.notes = { $artifact: artifact };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the exact record', actor: { host: 'codex', session: 'fixture-owner' } });
  const changed = new DatabaseSync(file);
  try { changed.prepare('DELETE FROM artifacts WHERE id=?').run(artifact); }
  finally { changed.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
});

test('a selection table without its singleton constraint is unavailable', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('DROP TABLE active; CREATE TABLE active (singleton INTEGER PRIMARY KEY, id TEXT NOT NULL REFERENCES runs(id));');
    db.prepare('INSERT INTO active VALUES (?, ?)').run(2, id);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
});

test('a present history table without its owner foreign key is unavailable', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const saved = db.prepare('SELECT revision, kind, recorded_at, state FROM history WHERE run_id=?').get(id);
    db.exec('DROP TABLE history; CREATE TABLE history (run_id TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision));');
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(id, saved.revision, saved.kind, saved.recorded_at, saved.state);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
});

test('orphaned history refuses read-only migration inventory and manifests', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('PRAGMA foreign_keys=OFF');
    const body = db.prepare('SELECT state FROM runs WHERE id=?').get(id).state;
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(randomUUID(), 0, 'complete', new Date().toISOString(), body);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }), { code: 'migration-store-unavailable' });
});

test('administrative inventory refuses linked project directories and database sidecars', t => {
  const { root } = fixture(t);
  const parent = path.resolve(__dirname, '../.tmp/runtime-legacy-migration');
  const linkedRoot = fs.mkdtempSync(path.join(parent, 'linked-'));
  t.after(() => { assert.equal(path.dirname(linkedRoot), parent); const junction = path.join(linkedRoot, '.nightshift'); if (fs.lstatSync(junction, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(junction); fs.rmSync(linkedRoot, { recursive: true, force: true }); });
  let linked;
  try {
    fs.symlinkSync(path.join(root, '.nightshift'), path.join(linkedRoot, '.nightshift'), 'junction');
    linked = true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('Directory links are unavailable to this test process');
    throw error;
  }
  assert.equal(linked, true);
  assert.throws(() => execute(linkedRoot, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  const sidecar = path.join(root, '.nightshift/runs/state.sqlite-wal');
  const dummy = path.join(linkedRoot, 'sidecar-source');
  fs.writeFileSync(dummy, 'fixture');
  fs.linkSync(dummy, sidecar);
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  fs.unlinkSync(sidecar);
});

test('an oversized detailed inventory falls back to a bounded exact ID list', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.followups = [{ id: 'large-question', status: 'pending', context: 'x'.repeat(8 * 1024 * 1024 + 100) }];
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  const inventory = execute(root, { action: 'inventory' });
  assert.equal(inventory.detailUnavailable, 'inventory-response-bound');
  assert.deepEqual(inventory.preview.map(record => record.id), [id]);
  assert.ok(Buffer.byteLength(JSON.stringify(inventory)) <= 8 * 1024 * 1024);
  assert.throws(() => execute(root, { action: 'manifest', ids: [id] }), error => error.code === 'migration-manifest-unavailable' && error.message.includes(id));
});

test('unsupported progress and contradictory latest history never become legacy', t => {
  const { root, id } = fixture(t);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  const db = new DatabaseSync(file);
  try {
    const original = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    const future = JSON.stringify({ ...original, progress: { schema: 3 } });
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(future, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(future, id);
    assert.equal(execute(root, { action: 'inventory' }).counts.damagedModern, 1);
    assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }), { code: 'migration-decision-unavailable' });
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(original), id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(JSON.stringify({ ...original, progress: { schema: 2 } }), id);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
});

test('contradictory stop recovery cannot be retired as coherent legacy history', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.stopRecovery = { reminders: 2 };
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(JSON.stringify(state), id);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }), { code: 'migration-store-unavailable' });
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
});

test('a legacy record without its saved controller cannot reach approval', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    delete state.controller;
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }), { code: 'migration-store-unavailable' });
});

test('an orphan backlog record cannot carry a pending follow-up', t => {
  const { root, id } = fixture(t, { followups: [{ id: 'question', status: 'pending', title: 'Question' }] });
  const bugs = path.join(root, '.nightshift/BUGS.md');
  const orphan = path.join(root, '.nightshift/bugs/orphan.md');
  fs.mkdirSync(path.dirname(orphan), { recursive: true });
  fs.writeFileSync(orphan, ['# Orphan', '', 'Tracking text.', ''].join(String.fromCharCode(13, 10)));
  fs.writeFileSync(bugs, ['# Bugs', '', 'No link to the orphan.', ''].join(String.fromCharCode(13, 10)));
  const choice = { ...choiceFor(id), followups: [{ id: 'question', disposition: 'tracked', destination: { path: '.nightshift/bugs/orphan.md', anchor: null } }] };
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choice] }), { code: 'migration-followup-target-unavailable' });
  fs.writeFileSync(bugs, ['# Bugs', '', '[Orphan](bugs/orphan.md)', ''].join(String.fromCharCode(13, 10)));
  assert.match(execute(root, { action: 'manifest', ids: [id], choices: [choice] }).hash, /^[a-f0-9]{64}$/);
});

test('tracked-target read caches retain identities without file buffers', t => {
  const { root } = fixture(t);
  const target = path.join(root, '.nightshift/BUGS.md');
  const original = ['# Bugs', '', '### Saved question', '', 'Original content.', ''].join(String.fromCharCode(13, 10));
  fs.writeFileSync(target, original);
  const budget = { bytes: 0, maximum: 16 * 1024 * 1024, cache: new Map() };
  const destination = { path: '.nightshift/BUGS.md', anchor: 'saved-question' };
  const first = targetEntry(root, destination, budget);
  assert.deepEqual(targetEntry(root, destination, budget), first);
  assert.ok([...budget.cache.values()].every(value => Number.isSafeInteger(value.bytes) && /^[a-f0-9]{64}$/.test(value.sha256) && !Buffer.isBuffer(value)));
  fs.writeFileSync(target, original.replace('Original', 'Changed'));
  assert.throws(() => targetEntry(root, destination, budget), { code: 'migration-followup-target-unavailable' });
});

test('empty active indexes remain readable across tracked destinations', t => {
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, '.nightshift/FEATURES.md'), '');
  const directory = path.join(root, '.nightshift/bugs');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'first.md'), '# First');
  fs.writeFileSync(path.join(directory, 'second.md'), '# Second');
  fs.writeFileSync(path.join(root, '.nightshift/BUGS.md'), ['# Bugs', '', '[First](bugs/first.md)', '[Second](bugs/second.md)', ''].join(String.fromCharCode(13, 10)));
  const budget = { bytes: 0, maximum: 16 * 1024 * 1024, cache: new Map() };
  assert.match(targetEntry(root, { path: '.nightshift/bugs/first.md', anchor: null }, budget).entryHash, /^[a-f0-9]{64}$/);
  assert.match(targetEntry(root, { path: '.nightshift/bugs/second.md', anchor: null }, budget).entryHash, /^[a-f0-9]{64}$/);
  assert.equal(budget.cache.get('.nightshift/FEATURES.md').bytes, 0);
});

test('repeat tracked-target reads count toward the aggregate manifest bound', t => {
  const { root } = fixture(t);
  const directory = path.join(root, '.nightshift/bugs');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'large.md'), ['# Large', '', 'x'.repeat(999000), ''].join(String.fromCharCode(13, 10)));
  fs.writeFileSync(path.join(root, '.nightshift/BUGS.md'), ['# Bugs', '', '[Large](bugs/large.md)', ''].join(String.fromCharCode(13, 10)));
  const budget = { bytes: 0, maximum: 16 * 1024 * 1024, cache: new Map() };
  const destination = { path: '.nightshift/bugs/large.md', anchor: null };
  for (let index = 0; index < 16; index++) targetEntry(root, destination, budget);
  assert.throws(() => targetEntry(root, destination, budget), { code: 'migration-target-bound' });
});

test('a retry must repeat the exact approved batch and dispositions', t => {
  const { root, id } = fixture(t);
  const second = addCompletedRun(root, id);
  const choices = [choiceFor(id), choiceFor(second)];
  const manifest = execute(root, { action: 'manifest', ids: [id, second], choices });
  const request = { action: 'retire', ids: [id, second], choices, manifestHash: manifest.hash, authority: 'Approve both completed records', actor: { host: 'codex', session: 'fixture-owner' } };
  assert.equal(execute(root, request).state, 'retired');
  assert.equal(execute(root, request).state, 'already-retired');
  assert.throws(() => execute(root, { ...request, ids: [id], choices: [choiceFor(id)] }), { code: 'migration-manifest-stale' });
  assert.throws(() => execute(root, { ...request, choices: [{ ...choiceFor(id), disposition: 'retired-stopped' }, choiceFor(second)] }), { code: 'migration-decision-unavailable' });
});

test('direct fresh-identity save diagnoses version-one legacy records without upgrading the store', t => {
  const { root, id } = fixture(t);
  const store = new RunStore(root);
  try {
    const candidate = { ...store.read(undefined, { hydrate: false }), id: randomUUID() };
    assert.throws(() => store.transaction(() => store.save(candidate, 'created')), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(id) && error.message.includes('migration inventory'));
  } finally { store.close(); }
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='artifacts' OR name='accounting_commits'").get().count, 0);
  } finally { db.close(); }
});

test('direct fresh-identity save leaves missing version-two support tables absent on refusal', t => {
  const { root, id } = fixture(t);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  const before = new DatabaseSync(file);
  try { before.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=2;'); }
  finally { before.close(); }
  const store = new RunStore(root);
  try {
    const candidate = { ...store.read(undefined, { hydrate: false }), id: randomUUID() };
    assert.throws(() => store.transaction(() => store.save(candidate, 'created')), error => error.code === 'delivery-consistency-unavailable' && error.message.includes(id));
  } finally { store.close(); }
  const after = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(after.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='accounting_commits' OR name='discharge_index'").get().count, 0);
  } finally { after.close(); }
});

test('a stopped legacy delivery needs its own retirement choice', t => {
  const { root, id } = fixture(t, { status: 'stopped' });
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }), { code: 'migration-decision-unavailable' });
  const choice = { ...choiceFor(id), disposition: 'retired-stopped' };
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const result = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve abandonment of this stopped work', actor: { host: 'codex', session: 'fixture-owner' } });
  assert.equal(result.state, 'retired');
  assert.equal(execute(root, { action: 'raw-inspect', runId: id }).chain[0].certificate.disposition, 'retired-stopped');
});

test('stopped approval pages retain the saved work and closing context', t => {
  const { root, id } = fixture(t, { status: 'stopped' });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.objective = 'Complete the unfinished review';
    state.stop = { kind: 'user-stop', reason: 'The user interrupted closing before triage' };
    state.tasks = [{ id: 'review', title: 'Review the change', status: 'active', findings: [{ id: 'open-finding', disposition: null }], checks: [] }];
    state.closing = { docs: { findings: [{ id: 'closing-finding', disposition: null }], checks: [] }, triageEvidence: null };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  const choice = { ...choiceFor(id), disposition: 'retired-stopped' };
  const member = execute(root, { action: 'manifest', ids: [id], choices: [choice] }).members[0].record;
  assert.equal(member.objective, 'Complete the unfinished review');
  assert.match(member.stop.reason, /interrupted closing/);
  assert.equal(member.incompleteTasks[0].findings[0].id, 'open-finding');
  assert.equal(member.closing.saved.docs.findings[0].id, 'closing-finding');
});

test('approval pages omit completed task histories while retaining closing context', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.tasks = [
      { id: 'done', title: 'Completed task', status: 'complete', reviews: [{ body: 'x'.repeat(128 * 1024) }] },
      { id: 'open', title: 'Unfinished task', status: 'active' },
    ];
    state.closing = { docs: { reviews: [{ body: 'y'.repeat(128 * 1024) }] } };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  const member = execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }).members[0].record;
  assert.deepEqual(member.incompleteTasks.map(task => task.id), ['open']);
  assert.equal(member.closing.saved.docs.reviews[0].body.length, 128 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(member)) < 160 * 1024);
});

test('approval pages expose closing work renewed after run completion', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.closing = { retrospectiveEvidence: { summary: 'Recorded' }, triageEvidence: null, carriedFindings: [{ id: 'unresolved-closing', disposition: null }] };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  const member = execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }).members[0].record;
  assert.equal(member.closing.stage, 'triage');
  assert.equal(member.closing.saved.carriedFindings[0].id, 'unresolved-closing');
});

test('an uncertain worker blocks its record without hiding unrelated retirement choices', t => {
  const { root, id } = fixture(t);
  const uncertain = addCompletedRun(root, id);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(uncertain).state);
    state.workers = [{ id: 'worker', status: 'unverified' }];
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, uncertain);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, uncertain);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.legacy, 2);
  assert.match(execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }).hash, /^[a-f0-9]{64}$/);
  assert.throws(() => execute(root, { action: 'manifest', ids: [uncertain], choices: [choiceFor(uncertain)] }), { code: 'migration-decision-unavailable' });
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  assert.equal(execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve eligible record', actor: { host: 'codex', session: 'fixture-owner' } }).state, 'retired');
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
});

test('inventory refuses an oversized saved state before loading the body', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try { db.prepare('UPDATE runs SET state=CAST(zeroblob(?) AS TEXT) WHERE id=?').run(64 * 1024 * 1024 + 1, id); }
  finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
});

test('inventory refuses a newer oversized history row before loading its body', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try { db.prepare("INSERT INTO history VALUES (?, 1, 'complete', ?, CAST(zeroblob(?) AS TEXT))").run(id, new Date().toISOString(), 64 * 1024 * 1024 + 1); }
  finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
});

test('inventory refuses excess retirement references before loading their rows', t => {
  const { root } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('PRAGMA foreign_keys=OFF; CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE legacy_retirements (run_id TEXT PRIMARY KEY REFERENCES runs(id), artifact TEXT NOT NULL); BEGIN');
    const insert = db.prepare('INSERT INTO legacy_retirements VALUES (?, ?)');
    for (let index = 0; index <= 10000; index++) insert.run(index.toString(16).padStart(8, '0'), 'a'.repeat(64));
    db.exec('COMMIT');
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
});

test('raw inspection refuses an oversized saved state before parsing it', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try { db.prepare('UPDATE runs SET state=CAST(zeroblob(?) AS TEXT) WHERE id=?').run(8 * 1024 * 1024 + 1, id); }
  finally { db.close(); }
  assert.throws(() => execute(root, { action: 'raw-inspect', runId: id }), { code: 'migration-raw-bound' });
});

test('a migration artifact read refuses an oversized body before loading it', t => {
  const { root } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    const id = 'a'.repeat(64);
    db.prepare('INSERT INTO artifacts VALUES (?, CAST(zeroblob(?) AS TEXT))').run(id, 8193);
    assert.throws(() => readArtifact(db, id, 8192), { code: 'migration-evidence-unavailable' });
  } finally { db.close(); }
});

test('repeated referenced evidence is read once and bounded when expanded', t => {
  // Arrange
  const { root } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  const body = JSON.stringify({ detail: 'x'.repeat(1024) });
  const id = sha256(body);
  db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
  db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(id, body);
  let bodyReads = 0;
  const counting = { prepare(sql) {
    const statement = db.prepare(sql);
    return { get(...args) {
      if (sql.startsWith('SELECT body FROM artifacts')) bodyReads++;

      return statement.get(...args);
    } };
  } };
  const envelope = { $artifact: id };
  const budget = { bytes: 0, maximum: Buffer.byteLength(body), expansionMaximum: Buffer.byteLength(body) * 2, visited: new Set(), artifactsAvailable: true };

  // Act
  let hydrated;
  try { hydrated = hydrateArtifact(counting, [envelope, envelope], new Set(), budget); }
  finally { db.close(); }

  // Assert
  assert.equal(bodyReads, 1);
  assert.notEqual(hydrated[0], hydrated[1]);
  assert.equal(budget.bytes, Buffer.byteLength(body));
  assert.equal(budget.expandedBytes, Buffer.byteLength(body) * 2);
  assert.throws(() => hydrateArtifact({ prepare: () => { throw new Error('Cached evidence should need no SQLite read'); } }, envelope, new Set(), budget), { code: 'migration-evidence-bound' });
});

test('ordinary runtime hydration reports a missing artifact as missing evidence', t => {
  // Arrange
  const { root } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try { db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=2;'); }
  finally { db.close(); }
  const store = new RunStore(root);

  // Act
  const hydrate = () => store.hydrate({ $artifact: 'a'.repeat(64) });

  // Assert
  try { assert.throws(hydrate, { code: 'missing-evidence' }); }
  finally { store.close(); }
});

test('raw inspection includes the current row and diagnoses missing referenced artifacts', t => {
  const { root, id } = fixture(t);
  const missing = 'a'.repeat(64);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.notes = { $artifact: missing };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  const raw = execute(root, { action: 'raw-inspect', runId: id });
  assert.equal(raw.current.revision, 0);
  assert.deepEqual(raw.current.artifacts, [missing]);
  assert.equal(raw.current.evidence.code, 'missing-evidence');
  assert.deepEqual(raw.history[0].artifacts, [missing]);
});

test('raw inspection diagnoses corrupt referenced artifacts when inventory is unavailable', t => {
  const { root, id } = fixture(t);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL); PRAGMA user_version=2;');
    const corrupt = '{broken';
    const artifact = sha256(corrupt);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(artifact, corrupt);
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.notes = { $artifact: artifact };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  const raw = execute(root, { action: 'raw-inspect', runId: id });
  assert.equal(raw.current.evidence.code, 'invalid-evidence');
  assert.equal(raw.history[0].evidence.code, 'invalid-evidence');
});

test('raw inspection retains state and a chain diagnostic for a missing supersedes field', t => {
  // Arrange
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const retired = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve fixture record', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const certificate = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(retired.certificates[0].artifact).body);
    delete certificate.supersedes;
    const body = JSON.stringify(certificate);
    const artifact = sha256(body);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(artifact, body);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(artifact, id);
  } finally { db.close(); }

  // Act
  const inspected = execute(root, { action: 'raw-inspect', runId: id, fromRevision: 0 });

  // Assert
  assert.equal(inspected.current.revision, 0);
  assert.equal(inspected.history.length, 1);
  assert.equal(inspected.chain.length, 2);
  assert.equal(inspected.chain[1].diagnostic.code, 'migration-raw-bound');
});

test('a proposed batch cannot ignore missing evidence on another saved delivery', t => {
  const { root, id } = fixture(t);
  const second = addCompletedRun(root, id);
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(second).state);
    state.notes = { $artifact: 'a'.repeat(64) };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, second);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, second);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }), { code: 'migration-store-unavailable' });
});

test('a malformed superseded certificate keeps the retirement unavailable', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const result = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the exact completed record', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const current = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(result.certificates[0].artifact).body);
    const malformed = JSON.stringify({ schema: 1, runId: id, supersedes: result.certificates[0].artifact });
    const malformedId = sha256(malformed);
    const altered = JSON.stringify({ ...current, supersedes: malformedId });
    const alteredId = sha256(altered);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(malformedId, malformed);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(alteredId, altered);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(alteredId, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
  const store = new RunStore(root);
  try { assert.throws(() => store.transaction(() => creationAssessment(store)), { code: 'delivery-consistency-unavailable' }); }
  finally { store.close(); }
});

test('an otherwise valid retirement certificate rejects unsupported fields', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const result = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the exact record', actor: { host: 'codex', session: 'fixture-owner' } });
  const originalId = result.certificates[0].artifact;
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const original = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(originalId).body);
    const changed = JSON.stringify({ ...original, supersedes: originalId, unsupported: true });
    const changedId = sha256(changed);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(changedId, changed);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(changedId, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('a malformed saved follow-up choice stays visible as unavailable in inventory', t => {
  // Arrange
  const { root, id } = fixture(t, { followups: [{ id: 'question', status: 'pending' }] });
  const choice = { ...choiceFor(id), followups: [{ id: 'question', disposition: 'dismissed', destination: null }] };
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve fixture dismissal', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const originalId = db.prepare('SELECT artifact FROM legacy_retirements WHERE run_id=?').get(id).artifact;
    const original = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(originalId).body);
    const changed = JSON.stringify({ ...original, followups: [null], supersedes: originalId });
    const changedId = sha256(changed);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(changedId, changed);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(changedId, id);
  } finally { db.close(); }

  // Act
  const inventory = execute(root, { action: 'inventory' });

  // Assert
  assert.equal(inventory.counts.unavailableRetirements, 1);
  assert.equal(inventory.preview[0].retiredFollowups[0].destinationStatus.status, 'unavailable');
});

test('a retirement certificate rejects an approval manifest with an invalid inventory hash', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve exact saved work', actor: { host: 'codex', session: 'fixture-owner' } });
  replaceApprovalManifest(root, id, approved => ({ ...approved, storeInventoryHash: 'invalid' }));
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('a retirement certificate rejects altered approved task obligations', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve exact saved work', actor: { host: 'codex', session: 'fixture-owner' } });
  replaceApprovalManifest(root, id, approved => ({ ...approved, records: [{ ...approved.records[0], incompleteTasks: [{ id: 'invented', status: 'active' }] }] }));
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('a retirement certificate rejects an unsupported approval projection schema', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve versioned projection', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try {
    assert.equal(JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(manifest.hash).body).schema, 1);
  } finally { db.close(); }
  replaceApprovalManifest(root, id, approved => ({ ...approved, schema: 2 }));
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('saved schema-one approval remains valid when current helper exports change', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the schema-one projection', actor: { host: 'codex', session: 'fixture-owner' } });
  const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/legacy-helper-drift.cjs'), root], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('a retirement certificate rejects a follow-up source hash that differs from saved content', t => {
  const { root, id } = fixture(t, { followups: [{ id: 'question', status: 'pending', title: 'Saved question' }] });
  const choice = { ...choiceFor(id), followups: [{ id: 'question', disposition: 'dismissed', destination: null }] };
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const retired = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the saved question', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const current = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(retired.certificates[0].artifact).body);
    const approved = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(manifest.hash).body);
    const changedFollowups = [{ ...current.followups[0], sourceHash: 'a'.repeat(64) }];
    const changedManifest = JSON.stringify({ ...approved, choices: [{ ...approved.choices[0], followups: changedFollowups }] });
    const changedManifestId = sha256(changedManifest);
    const changedCertificate = JSON.stringify({ ...current, followups: changedFollowups, manifestHash: changedManifestId, supersedes: retired.certificates[0].artifact });
    const changedCertificateId = sha256(changedCertificate);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(changedManifestId, changedManifest);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(changedCertificateId, changedCertificate);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(changedCertificateId, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('a retirement certificate rejects authority beyond the approval bound', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const result = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the exact record', actor: { host: 'codex', session: 'fixture-owner' } });
  const originalId = result.certificates[0].artifact;
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const original = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(originalId).body);
    const changed = JSON.stringify({ ...original, supersedes: originalId, authority: 'A'.repeat(4 * 1024 + 1) });
    assert.ok(Buffer.byteLength(changed) < 8 * 1024);
    const changedId = sha256(changed);
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(changedId, changed);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(changedId, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('an oversized certificate names its run and requires a revised approval reply', t => {
  // Arrange
  const followups = Array.from({ length: 40 }, (_, index) => ({ id: `question-${index}`, status: 'pending' }));
  const { root, id } = fixture(t, { followups });
  const choice = { ...choiceFor(id), followups: followups.map(item => ({ id: item.id, disposition: 'dismissed', destination: null })) };
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const request = { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'A'.repeat(4096), actor: { host: 'codex', session: 'fixture-owner' } };

  // Act
  const retire = () => execute(root, request);

  // Assert
  assert.throws(retire, error => error.code === 'migration-certificate-bound' && error.message.includes(id) && error.message.includes('shorter exact approval reply'));
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'), { readOnly: true });
  try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1); }
  finally { db.close(); }
});

test('a superseded certificate with an unsupported report decision is unavailable', t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const result = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the exact completed record', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const current = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(result.certificates[0].artifact).body);
    const approved = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(manifest.hash).body);
    const badReport = { kind: 'unsupported', sha256: null };
    const badManifest = JSON.stringify({ ...approved, choices: [{ ...approved.choices[0], report: badReport }] });
    const badManifestId = sha256(badManifest);
    const badAncestor = JSON.stringify({ ...current, report: badReport, manifestHash: badManifestId, supersedes: result.certificates[0].artifact });
    const badAncestorId = sha256(badAncestor);
    const changedCurrent = JSON.stringify({ ...current, supersedes: badAncestorId });
    const changedCurrentId = sha256(changedCurrent);
    for (const [artifact, body] of [[badManifestId, badManifest], [badAncestorId, badAncestor], [changedCurrentId, changedCurrent]]) db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(artifact, body);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(changedCurrentId, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('a superseded tracked follow-up keeps its original destination grammar', t => {
  const { root, id } = fixture(t, { followups: [{ id: 'question', status: 'pending', title: 'Question' }] });
  const choice = { ...choiceFor(id), followups: [{ id: 'question', disposition: 'dismissed', destination: null }] };
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  const result = execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Dismiss the saved question', actor: { host: 'codex', session: 'fixture-owner' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const current = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(result.certificates[0].artifact).body);
    const approved = JSON.parse(db.prepare('SELECT body FROM artifacts WHERE id=?').get(manifest.hash).body);
    const badFollowups = [{ ...current.followups[0], disposition: 'tracked', destination: { path: '../outside.md', anchor: null, entryHash: 'a'.repeat(64) } }];
    const badManifest = JSON.stringify({ ...approved, choices: [{ ...approved.choices[0], followups: badFollowups }] });
    const badManifestId = sha256(badManifest);
    const badAncestor = JSON.stringify({ ...current, followups: badFollowups, manifestHash: badManifestId, supersedes: result.certificates[0].artifact });
    const badAncestorId = sha256(badAncestor);
    const changedCurrent = JSON.stringify({ ...current, supersedes: badAncestorId });
    const changedCurrentId = sha256(changedCurrent);
    for (const [artifact, body] of [[badManifestId, badManifest], [badAncestorId, badAncestor], [changedCurrentId, changedCurrent]]) db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(artifact, body);
    db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(changedCurrentId, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).counts.unavailableRetirements, 1);
});

test('inventory pages expose every exact saved ID under the same snapshot hash', t => {
  const { root, id } = fixture(t);
  for (let index = 0; index < 24; index++) addCompletedRun(root, id);
  const first = execute(root, { action: 'inventory' });
  const second = execute(root, { action: 'inventory', page: 1 });
  assert.equal(first.pages, 2);
  assert.equal(first.page, 0);
  assert.equal(second.page, 1);
  assert.equal(first.storeInventoryHash, second.storeInventoryHash);
  assert.equal(new Set([...first.preview, ...second.preview].map(record => record.id)).size, 25);
  assert.throws(() => execute(root, { action: 'inventory', page: 2 }), { code: 'migration-inventory-unavailable' });
});

test('a failed post-write resource check rolls retirement and version upgrade back together', t => {
  const { root, id } = fixture(t);
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  const db = new DatabaseSync(file);
  try {
    db.exec('CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    const foreign = JSON.stringify({ runId: randomUUID() });
    db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(sha256(foreign), foreign);
  } finally { db.close(); }
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  assert.throws(() => execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve the exact record', actor: { host: 'codex', session: 'fixture-owner' } }), { code: 'delivery-consistency-unavailable' });
  const after = new DatabaseSync(file, { readOnly: true });
  try {
    assert.equal(after.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(after.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name='legacy_retirements'").get().count, 0);
    assert.equal(after.prepare("SELECT count(*) AS count FROM sqlite_master WHERE type='trigger' AND name LIKE 'legacy_guard_%'").get().count, 0);
    assert.equal(after.prepare('SELECT count(*) AS count FROM artifacts').get().count, 1);
  } finally { after.close(); }
});

test('inventory separates modern, retired and remaining legacy deliveries', async t => {
  const { root, id } = fixture(t);
  const choice = choiceFor(id);
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [choice] });
  execute(root, { action: 'retire', ids: [id], choices: [choice], manifestHash: manifest.hash, authority: 'Approve completed record', actor: { host: 'codex', session: 'fixture-owner' } });
  await runtimeExecute(root, { action: 'handover', handoverId: randomUUID(), controller: { host: 'codex', session: 'modern-owner' }, authority: 'Create a modern record', objective: 'Modern work', tasks: [{ id: 'modern', title: 'Modern', agreement: { source: 'Fixture', outcome: 'Modern work' } }] }, { nativeOwner: () => ({ pid: 12345, created: 'fixture', name: 'codex.exe' }), ownerAlive: () => true });
  const remaining = addCompletedRun(root, id);
  const inventory = execute(root, { action: 'inventory' });
  assert.equal(inventory.counts.legacy, 2);
  assert.equal(inventory.counts.retired, 1);
  assert.equal(inventory.counts.modern, 1);
  const nextChoice = choiceFor(remaining);
  const nextManifest = execute(root, { action: 'manifest', ids: [remaining], choices: [nextChoice] });
  assert.equal(execute(root, { action: 'retire', ids: [remaining], choices: [nextChoice], manifestHash: nextManifest.hash, authority: 'Approve remaining legacy record', actor: { host: 'codex', session: 'fixture-owner' } }).state, 'retired');
});

test('a saved report without its hash remains an owed decision', t => {
  const { root, id } = fixture(t, { report: { bytes: '# Saved report' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    delete state.handover;
    delete state.closing.reportEvidence.sha256;
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [choiceFor(id)] }), { code: 'migration-decision-unavailable' });
  const waived = { ...choiceFor(id), report: { kind: 'waived' } };
  const manifest = execute(root, { action: 'manifest', ids: [id], choices: [waived] });
  assert.equal(manifest.members[0].record.report.owed, true);
  assert.equal(manifest.members[0].record.report.savedHash, null);
  assert.equal(execute(root, { action: 'retire', ids: [id], choices: [waived], manifestHash: manifest.hash, authority: 'Waive this saved report without a valid hash', actor: { host: 'codex', session: 'fixture-owner' } }).state, 'retired');
});

test('a matching report hash without a recipient reply remains owed', t => {
  const { root, id } = fixture(t, { report: { bytes: '# Saved report' } });
  const db = new DatabaseSync(path.join(root, '.nightshift/runs/state.sqlite'));
  try {
    const state = JSON.parse(db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
    state.closing.reportDelivery = { sha256: state.closing.reportEvidence.sha256 };
    const body = JSON.stringify(state);
    db.prepare('UPDATE runs SET state=? WHERE id=?').run(body, id);
    db.prepare('UPDATE history SET state=? WHERE run_id=?').run(body, id);
  } finally { db.close(); }
  assert.equal(execute(root, { action: 'inventory' }).preview[0].report.owed, true);
  const alreadyDelivered = { ...choiceFor(id), report: { kind: 'already-delivered' } };
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [alreadyDelivered] }), { code: 'migration-decision-unavailable' });
  assert.match(execute(root, { action: 'manifest', ids: [id], choices: [{ ...choiceFor(id), report: { kind: 'confirmed' } }] }).hash, /^[a-f0-9]{64}$/);
});

test('a pending follow-up without an exact identity is unavailable', t => {
  const { root, id } = fixture(t, { followups: [{ status: 'pending', title: 'Question without ID' }] });
  assert.throws(() => execute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' });
  assert.throws(() => execute(root, { action: 'manifest', ids: [id], choices: [{ ...choiceFor(id), followups: [{ disposition: 'dismissed' }] }] }), { code: 'migration-store-unavailable' });
});
