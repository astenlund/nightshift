'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { execute } = require('../../internal/runtime/cli');
const { RunStore } = require('../../internal/runtime/store');
const { ProgressStore } = require('../../internal/runtime/progress-store');
const { creationAssessment } = require('../../internal/runtime/creation-consistency');
const { execute: migrationExecute } = require('../../internal/runtime/legacy-migration');
const progress = require('../../internal/runtime/progress');
const { completeReflection } = require('../fixtures/completion');
const parent = path.resolve(__dirname, '../../.tmp/creation-budget-fixtures');
fs.mkdirSync(parent, { recursive: true });
// Report files seeded into the fixture project before any run, so that each completed run's closing baseline, the completion
// evidence the gate hydrates, is large next to the accounting and provenance artifacts that the shared budget charges.
const REPORT_FILES = 600;
let root;
const actor = { host: 'codex', session: 'f5-controller' };
const owner = { pid: 12345, created: 'fixture-process', name: 'codex.exe' };
const dependencies = { nativeOwner: () => owner, ownerAlive: () => true };
let store;
function put(value) {
  const body = JSON.stringify(value);
  const id = createHash('sha256').update(body).digest('hex');
  store.db.prepare('INSERT OR IGNORE INTO artifacts VALUES (?, ?)').run(id, body);
  return id;
}
function seedReports() {
  const directory = path.join(root, '.nightshift', 'reports');
  fs.mkdirSync(directory, { recursive: true });
  for (let i = 0; i < REPORT_FILES; i++) fs.writeFileSync(path.join(directory, `seed-${i}.md`), `# Seed ${i}\n\nFixture report ${i} seeded for the completion evidence budget.\n`);
}
// Each assessment here measures a full judgment, so the settled-record verdicts an earlier pass wrote are dropped first; a record
// a verdict covers is frozen, so they are dropped before a fixture edits accounting in place as well.
function clearVerdicts() {
  if (store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settled_verdicts'").get()) store.db.exec('DELETE FROM settled_verdicts');
}
function enlarge(id) {
  clearVerdicts();
  const row = store.db.prepare('SELECT revision FROM runs WHERE id=?').get(id);
  const commit = store.db.prepare('SELECT artifact FROM accounting_commits WHERE run_id=? AND revision=?').get(id, row.revision);
  const record = JSON.parse(store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(commit.artifact).body);
  const frontier = JSON.parse(store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(record.marker.frontierHash).body);
  const credits = new Set(frontier.credits);
  for (let i = 0; credits.size < progress.MAX_CREDITS; i++) credits.add(createHash('sha256').update('f5-credit-' + i).digest('hex'));
  frontier.credits = [...credits].sort();
  progress.validateFrontier(frontier, id);
  record.marker.frontierHash = put(frontier);
  store.db.prepare('UPDATE accounting_commits SET artifact=? WHERE run_id=? AND revision=?').run(put(record), id, row.revision);
}
// The distinct bytes of the evidence a completed record's latest state references from its task checks and reviews and its closing
// docs record, which the gate hydrates on the completion path, read from the store without running the gate.
function storedCompletionEvidence(id) {
  const state = JSON.parse(store.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
  const referenced = new Set();
  const collect = value => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$artifact === 'string') referenced.add(value.$artifact);
    for (const child of Object.values(value)) collect(child);
  };
  for (const task of state.tasks) {
    collect(task.checks);
    collect(task.reviews);
  }
  collect(state.closing?.docs);
  return [...referenced].reduce((total, artifact) => total + Buffer.byteLength(store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(artifact).body), 0);
}
function snapshot() {
  return JSON.stringify(['runs', 'active', 'history', 'artifacts', 'accounting_commits', 'discharge_index'].map(table => [table, store.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
}
// Runs the gate once over records judged in full, observing every artifact charge and the budget it was charged to. A budget that
// counts its artifacts against the input allowance is one record's accounting and provenance budget; any other is one record's
// completion evidence budget. An optional limit stands in for the 8 MiB allowance for this call only.
function assess(label, limit) {
  clearVerdicts();
  const before = snapshot();
  const original = ProgressStore.prototype.artifact;
  const previousLimit = progress.MAX_FRONTIER_BYTES;
  if (limit !== undefined) progress.MAX_FRONTIER_BYTES = limit;
  const charged = new Map();
  const order = [];
  let calls = 0;
  let repeatedLarge = 0;
  let result;
  let error;
  ProgressStore.prototype.artifact = function(id, budget) {
    calls++;
    const row = this.store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(id);
    if (!charged.has(budget)) {
      charged.set(budget, new Map());
      order.push(budget);
    }
    if (row) charged.get(budget).set(id, Buffer.byteLength(row.body));
    const value = original.call(this, id, budget);
    if (row && Buffer.byteLength(row.body) > 4 * 1024 * 1024) {
      const bytesBefore = budget.bytes;
      calls++;
      original.call(this, id, budget);
      assert.equal(budget.bytes, bytesBefore, 'Repeated large artifact reads must not consume more allowance');
      repeatedLarge++;
    }
    return value;
  };
  try { result = store.transaction(() => creationAssessment(store)); }
  catch (caught) { error = caught; }
  finally {
    ProgressStore.prototype.artifact = original;
    progress.MAX_FRONTIER_BYTES = previousLimit;
  }
  assert.equal(snapshot(), before, 'Assessment must not change durable rows');
  const sum = map => [...map.values()].reduce((total, value) => total + value, 0);
  for (const budget of order) {
    assert.equal(budget.bytes, sum(charged.get(budget)), 'Each budget must equal the distinct artifact bytes charged to it');
    assert.equal(budget.artifacts.size, charged.get(budget).size);
  }
  const accounting = order.filter(budget => budget.chargeArtifacts);
  const completion = order.filter(budget => !budget.chargeArtifacts);
  const distinct = new Set(order.flatMap(budget => [...charged.get(budget).keys()]));
  assert.ok(calls > distinct.size, 'Exercise repeated checkpoint and ancestry reads');
  // What one budget shared across records would have charged: each distinct body once.
  const completionDistinct = new Map(completion.flatMap(budget => [...charged.get(budget)]));
  const accountingDistinct = new Map(accounting.flatMap(budget => [...charged.get(budget)]));
  const evidence = { label, accountingBytes: accounting.map(budget => budget.bytes), accountingDistinctBytes: sum(accountingDistinct), completionBytes: completion.map(budget => budget.bytes), completionDistinctBytes: sum(completionDistinct), distinctArtifacts: distinct.size, calls, repeatedLarge, inputBytes: result?.inputBytes ?? null, replaceable: result?.replaceable ?? null, error: error?.code ?? null, message: error?.message ?? null };
  console.log(JSON.stringify(evidence));
  return evidence;
}
async function main() {
  root = fs.mkdtempSync(path.join(parent, 'case-'));
  try {
    // A repository of its own gives each closing record a project inventory as its baseline; under this checkout's ignored .tmp
    // the enclosing repository would inventory nothing.
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    seedReports();
    const ids = [];
    for (let i = 0; i < 4; i++) {
      // A report of each run's own makes its baseline a distinct artifact, as real runs' baselines are.
      fs.writeFileSync(path.join(root, '.nightshift', 'reports', `run-${i}.md`), `# Run ${i}\n`);
      const accepted = await execute(root, { action: 'handover', handoverId: randomUUID(), controller: actor, authority: 'Explicit isolated fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] }, dependencies);
      await completeReflection(root, actor, execute, dependencies);
      ids.push(accepted.id);
    }
    store = new RunStore(root);
    const baseline = assess('baseline');
    assert.equal(baseline.replaceable, true);
    assert.equal(baseline.error, null);
    // An allowance every record's own completion evidence fits, read from the stored evidence alone, which the records' distinct
    // evidence together passes: one budget shared across records would refuse it.
    const stored = ids.map(storedCompletionEvidence);
    const allowance = 2 * Math.max(...stored);
    assert.ok(stored.reduce((total, value) => total + value, 0) > allowance, 'Fixture precondition: the records\' distinct completion evidence together must pass the chosen allowance');
    const admitted = assess('completion-evidence-per-record', allowance);
    assert.equal(admitted.error, null, 'Completion evidence is bounded per record, not summed across records');
    assert.equal(admitted.replaceable, true);
    assert.equal(baseline.completionBytes.length, 4, 'Each completed record hydrates its completion evidence under a budget of its own');
    assert.ok(baseline.completionBytes.every(bytes => bytes > 0), 'Completion evidence is charged to the per-record budget');
    assert.equal(baseline.accountingBytes.length, 4, 'Each record judged in full charges its accounting and provenance artifacts to a budget of its own');
    assert.ok(Math.max(...baseline.accountingBytes) < allowance, 'Each record\'s accounting charge stays within the allowance');
    const perRecord = Math.max(...baseline.completionBytes);
    // One record whose own completion evidence passes the allowance is still refused, with every accounting charge within it.
    assert.ok(Math.max(...baseline.accountingBytes) < perRecord - 1, 'Fixture precondition: every accounting charge must fit the chosen allowance');
    const refused = assess('completion-evidence-over-allowance', perRecord - 1);
    assert.equal(refused.error, 'delivery-consistency-unavailable', 'A record whose own completion evidence passes the allowance is refused');
    assert.match(refused.message, /Delivery [0-9a-f-]+ is unavailable[.]/);
    assert.equal(refused.replaceable, null);
    // The accounting and provenance allowance bounds each record judged in full, and its bytes count against the shared input
    // allowance: frontiers that together pass 8 MiB, which the 3.3.40 gate refused, are admitted while each record's fits.
    enlarge(ids[0]);
    const one = assess('one-large-frontier');
    assert.ok(Math.max(...one.accountingBytes) < 8 * 1024 * 1024);
    assert.ok(one.repeatedLarge > 0);
    assert.equal(one.replaceable, true);
    assert.doesNotThrow(() => store.transaction(() => creationAssessment(store, { resourceOnly: true })), 'Retirement preflight must accept modern accounting within its read bound');
    enlarge(ids[1]);
    const two = assess('two-large-frontiers');
    assert.ok(two.accountingDistinctBytes > 8 * 1024 * 1024, 'Fixture precondition: the records\' accounting artifacts together pass 8 MiB');
    assert.ok(two.accountingBytes.every(bytes => bytes < 8 * 1024 * 1024), 'Fixture precondition: each record\'s accounting artifacts fit 8 MiB');
    assert.equal(two.error, null, 'Creation bounds accounting artifacts per record, not summed across records');
    assert.equal(two.replaceable, true);
    assert.ok(two.inputBytes > two.accountingDistinctBytes, 'Accounting artifact bytes count against the shared input allowance');
    clearVerdicts();
    assert.doesNotThrow(() => store.transaction(() => creationAssessment(store, { resourceOnly: true })), 'Retirement preflight follows the gate\'s per-record accounting allowance');
    assert.doesNotThrow(() => migrationExecute(root, { action: 'inventory' }), 'Migration inventory follows the gate\'s per-record accounting allowance');
    enlarge(ids[2]);
    enlarge(ids[3]);
    const four = assess('four-large-frontiers');
    assert.ok(four.accountingDistinctBytes > 16 * 1024 * 1024);
    assert.equal(four.error, null);
    // One record whose own accounting artifacts pass the allowance is still refused.
    const narrowed = assess('one-record-over-accounting-allowance', Math.max(...four.accountingBytes) - 1);
    assert.equal(narrowed.error, 'delivery-consistency-unavailable');
    // A complete delivery past its own accounting allowance reads unavailable and is named with that outcome.
    assert.match(narrowed.message, /Delivery [0-9a-f-]+ is unavailable[.]/);
  } finally {
    if (store) store.close();
    store = undefined;
    assert.equal(path.dirname(root), parent);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
// Each completed record's completion row is bounded on its own, so completed records do not accumulate against the input
// allowance the whole pass shares. The shared allowance is narrowed to what a full judgment charges it plus the largest completion
// row, and the completion-row bound to the largest row: every record's row fits on its own, while the rows together
// would pass either allowance were they summed across records, whether into the shared input or into a total of their own.
async function completionRows() {
  const { BOUNDS } = require('../../internal/runtime/creation-consistency');
  const { HistoryReader, latestRevisionOfKind } = require('../../internal/runtime/history-store');
  const defaults = { ...BOUNDS };
  root = fs.mkdtempSync(path.join(parent, 'case-'));
  try {
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const accepted = await execute(root, { action: 'handover', handoverId: randomUUID(), controller: actor, authority: 'Explicit isolated fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] }, dependencies);
      await completeReflection(root, actor, execute, dependencies);
      ids.push(accepted.id);
    }
    store = new RunStore(root);
    const run = () => {
      clearVerdicts();
      try { return { result: store.transaction(() => creationAssessment(store)), error: null }; }
      catch (error) { return { result: null, error }; }
    };
    // What a full judgment charges the shared allowance under default bounds: states, latest rows and accounting artifacts.
    const mandatory = run().result.inputBytes;
    const rows = ids.map(id => {
      const revision = latestRevisionOfKind(store.db, id, 'complete');
      assert.notEqual(revision, undefined, 'Fixture precondition: every record has a completion row');
      return { id, bytes: new HistoryReader(store.db, id).meta(revision).bytes };
    });
    const largest = Math.max(...rows.map(row => row.bytes));
    const allowance = mandatory + largest;
    const rowTotal = rows.reduce((total, row) => total + row.bytes, 0);
    assert.ok(mandatory + rowTotal > allowance, 'Fixture precondition: the completion rows together must pass the narrowed shared allowance');
    assert.ok(rowTotal > largest, 'Fixture precondition: the completion rows together must pass the narrowed per-record bound');
    const before = snapshot();
    BOUNDS.input = allowance;
    BOUNDS.completionRow = largest;
    const admitted = run();
    assert.equal(admitted.error?.message ?? null, null, 'Completion rows are bounded per record, not charged to the shared input allowance');
    assert.equal(admitted.result.replaceable, true);
    assert.equal(admitted.result.inputBytes, mandatory, 'The shared allowance carries the mandatory rows and no completion row');
    Object.assign(BOUNDS, defaults);
    // One record whose own completion row passes its bound is still refused, naming that record.
    BOUNDS.completionRow = largest - 1;
    const refused = run();
    assert.equal(refused.error?.code, 'delivery-consistency-unavailable');
    // The gate judges records in id order, so the refusal names the first of the records whose row is the largest.
    const over = rows.filter(row => row.bytes === largest).map(row => row.id).sort()[0];
    assert.ok(refused.error.message.includes(`Delivery ${over} is unavailable.`), refused.error.message);
    assert.equal(snapshot(), before, 'Assessment must not change durable rows');
  } finally {
    Object.assign(BOUNDS, defaults);
    if (store) store.close();
    store = undefined;
    assert.equal(path.dirname(root), parent);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
// The status brief's legacy follow-up report loads the same inventory as the migration inventory action, so with a retirement in the
// store, which is what makes the brief report at all, the two reach the same outcome under the gate's per-record artifact allowance:
// both admit accounting artifacts that together pass the allowance while each record's fits, and both refuse once one record's do not.
async function legacyFollowupOutcome() {
  const { putHistory } = require('./history');
  // Retirement admits only fixtures under its own development folder.
  const fixtures = path.resolve(__dirname, '../../.tmp/runtime-legacy-migration');
  fs.mkdirSync(fixtures, { recursive: true });
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(fixtures, 'followup-brief-')));
  const previousLimit = progress.MAX_FRONTIER_BYTES;
  try {
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const accepted = await execute(root, { action: 'handover', handoverId: randomUUID(), controller: actor, authority: 'Explicit isolated fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] }, dependencies);
      await completeReflection(root, actor, execute, dependencies);
      ids.push(accepted.id);
    }
    // A record an earlier release saved, without independent accounting, retired as the migration route retires one.
    store = new RunStore(root);
    const legacy = randomUUID();
    const now = new Date().toISOString();
    const legacyState = JSON.stringify({ schema: 1, kind: 'delivery', id: legacy, root: store.root, revision: 0, status: 'complete', controller: { host: 'codex', session: 'legacy-owner' }, resourceMode: 'development', tasks: [], workers: [], followups: [], createdAt: now, updatedAt: now });
    store.transaction(() => {
      store.db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(legacy, 0, legacyState);
      putHistory(store.db, legacy, 0, 'complete', now, legacyState);
    });
    store.close();
    store = undefined;
    const choices = [{ runId: legacy, disposition: 'retired-complete', report: { kind: 'none' }, followups: [] }];
    const preview = migrationExecute(root, { action: 'manifest', ids: [legacy], choices }, null, { fixtureRetirement: true });
    migrationExecute(root, { action: 'retire', ids: [legacy], choices, manifestHash: preview.hash, authority: 'Approve the exact fixture manifest', actor: { host: 'codex', session: 'legacy-owner' } }, null, { fixtureRetirement: true });
    store = new RunStore(root);
    enlarge(ids[0]);
    enlarge(ids[1]);
    const two = assess('retired-beside-two-large-frontiers');
    assert.ok(two.accountingDistinctBytes > 8 * 1024 * 1024, 'Fixture precondition: the records\' accounting artifacts together pass 8 MiB');
    assert.equal(two.error, null);
    store.close();
    store = undefined;
    const outcomes = async () => {
      let inventory;
      try { migrationExecute(root, { action: 'inventory' }); inventory = 'available'; }
      catch (error) { inventory = error.code; }
      const status = await execute(root, { action: 'status' });
      return { inventory, brief: status.legacyFollowups?.status, reason: status.legacyFollowups?.reason ?? null };
    };
    const admitted = await outcomes();
    assert.deepEqual([admitted.inventory, admitted.brief], ['available', 'available'], 'Both admit artifacts past 8 MiB in total while each record\'s fit');
    progress.MAX_FRONTIER_BYTES = Math.max(...two.accountingBytes) - 1;
    const refused = await outcomes();
    assert.equal(refused.inventory, 'migration-store-unavailable', 'The inventory refuses a record whose own artifacts pass the allowance');
    assert.equal(refused.brief, 'unavailable', 'The status brief reaches the same outcome');
    assert.match(refused.reason, /Accounting recovery exceeded its byte bound/, 'The brief is unavailable for the per-record allowance');
  } finally {
    progress.MAX_FRONTIER_BYTES = previousLimit;
    if (store) store.close();
    store = undefined;
    assert.equal(path.dirname(root), fixtures);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
module.exports = { completionRows, legacyFollowupOutcome, main };
