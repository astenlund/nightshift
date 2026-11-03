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
const { fixtureAcknowledgement } = require('../fixtures/acknowledgement');
const parent = path.resolve(__dirname, '../../.tmp/creation-budget-fixtures');
fs.mkdirSync(parent, { recursive: true });
// Report files seeded into the fixture project before any run, so that each completed run's closing baseline, the completion
// evidence the gate hydrates, is large next to the accounting and provenance artifacts that the shared budget charges.
const REPORT_FILES = 600;
let root;
const actor = { host: 'codex', session: 'f5-controller' };
const owner = { pid: 12345, created: 'fixture-process', name: 'codex.exe' };
const dependencies = { nativeOwner: () => owner, ownerAlive: () => true, acknowledgementObserver: fixtureAcknowledgement };
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
function enlarge(id) {
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
// Runs the gate once, observing every artifact charge and the budget it was charged to. The first budget seen is the shared one,
// since the accounting checkpoint of the first record precedes any completion hydration; each later budget is one record's
// completion evidence budget. An optional limit stands in for the 8 MiB allowance for this call only.
function assess(label, limit) {
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
  const [shared, ...completion] = order;
  const distinct = new Set(order.flatMap(budget => [...charged.get(budget).keys()]));
  assert.ok(calls > distinct.size, 'Exercise repeated checkpoint and ancestry reads');
  // What one budget shared across records would have charged for completion evidence: each distinct body once.
  const completionDistinct = new Map(completion.flatMap(budget => [...charged.get(budget)]));
  const evidence = { label, sharedBytes: shared?.bytes ?? 0, completionBytes: completion.map(budget => budget.bytes), completionDistinctBytes: sum(completionDistinct), distinctArtifacts: distinct.size, calls, repeatedLarge, replaceable: result?.replaceable ?? null, error: error?.code ?? null, message: error?.message ?? null };
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
    assert.ok(baseline.sharedBytes < allowance, 'The shared accounting charge stays within the allowance');
    const perRecord = Math.max(...baseline.completionBytes);
    // One record whose own completion evidence passes the allowance is still refused, with the shared charge within it.
    assert.ok(baseline.sharedBytes < perRecord - 1, 'Fixture precondition: the shared charge must fit the chosen allowance');
    const refused = assess('completion-evidence-over-allowance', perRecord - 1);
    assert.equal(refused.error, 'delivery-consistency-unavailable', 'A record whose own completion evidence passes the allowance is refused');
    assert.match(refused.message, /Accounting recovery exceeded its byte bound/);
    assert.equal(refused.replaceable, null);
    // The shared allowance for accounting and provenance artifacts is unchanged: frontiers accumulate across records.
    enlarge(ids[0]);
    const one = assess('one-large-frontier');
    assert.ok(one.sharedBytes < 8 * 1024 * 1024);
    assert.ok(one.repeatedLarge > 0);
    assert.equal(one.replaceable, true);
    assert.doesNotThrow(() => store.transaction(() => creationAssessment(store, { resourceOnly: true })), 'Retirement preflight must accept modern accounting within its read bound');
    enlarge(ids[1]);
    const two = assess('two-large-frontiers');
    assert.ok(two.sharedBytes > 8 * 1024 * 1024);
    assert.ok(two.sharedBytes < 16 * 1024 * 1024);
    assert.equal(two.error, 'delivery-consistency-unavailable', 'Creation must reject aggregate accounting artifacts above 8 MiB');
    assert.equal(two.replaceable, null);
    assert.throws(() => store.transaction(() => creationAssessment(store, { resourceOnly: true })), { code: 'delivery-consistency-unavailable' }, 'Retirement preflight must preserve the modern accounting read bound');
    assert.throws(() => migrationExecute(root, { action: 'inventory' }), { code: 'migration-store-unavailable' }, 'Migration inventory must diagnose the shared accounting read bound as unavailable');
    enlarge(ids[2]);
    enlarge(ids[3]);
    const four = assess('four-large-frontiers');
    assert.ok(four.sharedBytes > 8 * 1024 * 1024);
    assert.equal(four.error, 'delivery-consistency-unavailable');
  } finally {
    if (store) store.close();
    assert.equal(path.dirname(root), parent);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
module.exports = { main };
