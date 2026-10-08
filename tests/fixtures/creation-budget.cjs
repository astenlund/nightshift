'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { execute } = require('../../internal/runtime/cli');
const { RunStore } = require('../../internal/runtime/store');
const { ProgressStore } = require('../../internal/runtime/progress-store');
const { creationAssessment } = require('../../internal/runtime/creation-consistency');
const progress = require('../../internal/runtime/progress');
const { completeReflection } = require('../fixtures/completion');
const { fixtureAcknowledgement } = require('../fixtures/acknowledgement');
const parent = path.resolve(__dirname, '../../.tmp/creation-budget-fixtures');
fs.mkdirSync(parent, { recursive: true });
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
function snapshot() {
  return JSON.stringify(['runs', 'active', 'history', 'artifacts', 'accounting_commits', 'discharge_index'].map(table => [table, store.db.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all()]));
}
function assess(label) {
  const before = snapshot();
  const original = ProgressStore.prototype.artifact;
  const distinct = new Map();
  let calls = 0;
  let repeatedLarge = 0;
  let lastBudget;
  let result;
  let error;
  ProgressStore.prototype.artifact = function(id, budget) {
    calls++;
    const row = this.store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(id);
    if (row) distinct.set(id, Buffer.byteLength(row.body));
    lastBudget = budget;
    const value = original.call(this, id, budget);
    if (row && Buffer.byteLength(row.body) > 4 * 1024 * 1024) {
      const before = budget.bytes;
      calls++;
      original.call(this, id, budget);
      assert.equal(budget.bytes, before, 'Repeated large artifact reads must not consume more allowance');
      repeatedLarge++;
    }
    return value;
  };
  try { result = store.transaction(() => creationAssessment(store)); }
  catch (caught) { error = caught; }
  finally { ProgressStore.prototype.artifact = original; }
  assert.equal(snapshot(), before, 'Assessment must not change durable rows');
  const bytes = [...distinct.values()].reduce((sum, value) => sum + value, 0);
  assert.ok(calls > distinct.size, 'Exercise repeated checkpoint and ancestry reads');
  assert.equal(lastBudget.bytes, bytes, 'No reminders: shared budget must equal distinct artifact bytes');
  assert.equal(lastBudget.artifacts.size, distinct.size);
  const evidence = { label, distinctBytes: bytes, calls, repeatedLarge, distinctArtifacts: distinct.size, replaceable: result?.replaceable ?? null, error: error?.code ?? null };
  console.log(JSON.stringify(evidence));
  return evidence;
}
async function main() {
  root = fs.mkdtempSync(path.join(parent, 'case-'));
  try {
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const accepted = await execute(root, { action: 'handover', handoverId: randomUUID(), controller: actor, authority: 'Explicit isolated fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] }, dependencies);
      await completeReflection(root, actor, execute, dependencies);
      ids.push(accepted.id);
    }
    store = new RunStore(root);
    const baseline = assess('baseline');
    assert.equal(baseline.replaceable, true);
    assert.equal(baseline.error, null);
    enlarge(ids[0]);
    const one = assess('one-large-frontier');
    assert.ok(one.distinctBytes < 8 * 1024 * 1024);
    assert.ok(one.repeatedLarge > 0);
    assert.equal(one.replaceable, true);
    enlarge(ids[1]);
    const two = assess('two-large-frontiers');
    assert.ok(two.distinctBytes > 8 * 1024 * 1024);
    assert.ok(two.distinctBytes < 16 * 1024 * 1024);
    assert.equal(two.error, 'delivery-consistency-unavailable', 'Creation must reject aggregate artifacts above 8 MiB');
    assert.equal(two.replaceable, null);
    enlarge(ids[2]);
    enlarge(ids[3]);
    const four = assess('four-large-frontiers');
    assert.ok(four.distinctBytes > 8 * 1024 * 1024);
    assert.equal(four.error, 'delivery-consistency-unavailable');
  } finally {
    if (store) store.close();
    assert.equal(path.dirname(root), parent);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
module.exports = { main };
