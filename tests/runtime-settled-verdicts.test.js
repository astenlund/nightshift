'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { RunStore } = require('../internal/runtime/store');
const { execute } = require('../internal/runtime/cli');
const { BOUNDS, creationAssessment } = require('../internal/runtime/creation-consistency');
const { execute: migrationExecute } = require('../internal/runtime/legacy-migration');
const verdicts = require('../internal/runtime/settled-verdicts');
const { HistoryReader, latestRowStats } = require('../internal/runtime/history-store');
const { MAX_DELIVERY_RECORDS } = require('../internal/runtime/legacy-store');
const { completeReflection } = require('./fixtures/completion');
const { rewriteHistory } = require('./fixtures/history');

const actor = { host: 'codex', session: 'verdict-owner' };
const dependencies = { nativeOwner: () => ({ pid: 12345, created: 'isolated-fixture', name: 'codex.exe' }), ownerAlive: () => true };
const CODE = 'delivery-consistency-unavailable';
const sha256 = text => createHash('sha256').update(text).digest('hex');

// One cleanup per test restores narrowed bounds and the rule identity, closes the stores the test opened, then removes the project,
// so a failure in one step cannot leave another test's bounds narrowed or a store open.
function isolatedProject(t, label, folder = 'settled-verdicts') {
  const parent = path.resolve(__dirname, '../.tmp', folder);
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, label + '-'));
  const stores = [];
  const bounds = { ...BOUNDS };
  const identity = { ...verdicts.IDENTITY };
  t.after(() => {
    Object.assign(BOUNDS, bounds);
    Object.assign(verdicts.IDENTITY, identity);
    for (const store of stores) if (store.db.isOpen) store.close();
    assert.equal(path.dirname(root), parent);
    fs.rmSync(root, { recursive: true, force: true });
  });
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  const open = () => {
    const store = new RunStore(root);
    stores.push(store);
    return store;
  };
  return { root, open };
}

const handover = () => ({ action: 'handover', handoverId: randomUUID(), controller: actor, authority: 'Explicit isolated fixture handover', objective: 'Reflect without proposals', mechanism: { verified: true, kind: 'goal', evidence: 'Simulated fixture continuation' }, tasks: [{ id: 'reflection', title: 'Reflection', kind: 'lore', agreement: { source: 'Fixture user', outcome: 'Reflect without instruction proposals' } }] });

// Completed deliveries, each handover replacing the one before, so every record but the last is settled and not selected.
async function completedRuns(root, count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    ids.push((await execute(root, handover(), dependencies)).id);
    await completeReflection(root, actor, execute, dependencies);
  }
  return ids;
}

// The project's cleanup restores the default bounds.
function withBounds(input) {
  BOUNDS.input = input;
}

function pass(store, options) {
  try { return { result: store.transaction(() => creationAssessment(store, options)), error: null }; }
  catch (error) { return { result: null, error }; }
}

const saved = store => store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='settled_verdicts'").get() ? store.db.prepare('SELECT * FROM settled_verdicts ORDER BY run_id').all() : [];
const clear = store => { if (saved(store).length) store.db.exec('DELETE FROM settled_verdicts'); };
const guards = store => store.db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND substr(name, 1, 14)='verdict_guard_' ORDER BY name").all();

// Makes a settled record one an earlier release saved, without its progress marker, journal or discharge-index rows, so the gate judges it by
// bounded replay from its creation; that replay cannot establish its discharge, which makes the record a legacy blocker once judged.
// The record must not be verdicted, since its rows are frozen while it is.
function asEarlierRelease(store, id) {
  const strip = text => {
    const state = JSON.parse(text);
    delete state.progress;
    delete state.stopRecovery;
    return JSON.stringify(state);
  };
  store.transaction(() => {
    store.db.prepare('UPDATE runs SET state=? WHERE id=?').run(strip(store.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state), id);
    rewriteHistory(store.db, strip, { runId: id });
    store.db.prepare('DELETE FROM accounting_commits WHERE run_id=?').run(id);
    store.db.prepare('DELETE FROM discharge_index WHERE run_id=?').run(id);
  });
}

// Rewrites a store the runtime created, which is compact, as the full version-2 store an earlier release left: the same records,
// with every history row holding its whole state. Verdicts and their guards are left behind, as an earlier release never had them.
function asFullStore(root) {
  const file = path.join(root, '.nightshift/runs/state.sqlite');
  const compact = new DatabaseSync(file);
  const schema = compact.prepare("SELECT type, name, sql FROM sqlite_master WHERE type IN ('table', 'index') AND sql IS NOT NULL AND name NOT IN ('history', 'settled_verdicts') AND tbl_name NOT IN ('history', 'settled_verdicts') ORDER BY CASE name WHEN 'runs' THEN 0 ELSE 1 END, type DESC").all();
  const rows = Object.fromEntries(schema.filter(entry => entry.type === 'table').map(entry => [entry.name, compact.prepare(`SELECT * FROM ${entry.name}`).all()]));
  const history = compact.prepare('SELECT run_id, revision, kind, recorded_at FROM history ORDER BY run_id, revision').all().map(row => ({ ...row, state: new HistoryReader(compact, row.run_id).text(row.revision).state }));
  compact.close();
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  const full = new DatabaseSync(file);
  try {
    full.exec('BEGIN');
    for (const entry of schema) full.exec(entry.sql);
    full.exec('CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision))');
    for (const [table, values] of Object.entries(rows)) {
      for (const row of values) {
        const columns = Object.keys(row);
        full.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map(column => row[column]));
      }
    }
    const insert = full.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)');
    for (const row of history) insert.run(row.run_id, row.revision, row.kind, row.recorded_at, row.state);
    full.exec('PRAGMA user_version=2; COMMIT');
  } finally { full.close(); }
}

// Saves a record at its next revision, as reopening it does.
function reopen(store, id) {
  const state = JSON.parse(store.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);
  store.transaction(() => {
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    store.save(state, 'fixture-reopen');
  });
}

// Narrows the allowance below what the records' current states and latest history rows alone take, so no read of them all at once
// could fit, and returns that total.
function belowRows(store) {
  const rows = store.db.prepare('SELECT coalesce(sum(length(CAST(state AS BLOB))), 0) AS bytes FROM runs').get().bytes + latestRowStats(store.db).bytes;
  withBounds(rows - 1);
  assert.ok(BOUNDS.input < rows, 'Fixture precondition: current states and latest rows alone exceed the allowance');
  return rows;
}

// What a pass over records judged in full charges the shared allowance.
function fullCharge(store) {
  clear(store);
  const full = pass(store);
  assert.equal(full.error, null);
  return full.result.inputBytes;
}

test('settled records together past the input allowance are admitted once they hold verdicts, which refused passes keep', async t => {
  // Arrange
  const { root, open } = isolatedProject(t, 'progress');
  const ids = await completedRuns(root, 4);
  const store = open();
  const full = fullCharge(store);
  assert.equal(saved(store).length, 3, 'A successful pass writes a verdict for every settled record that is not selected');
  const confirmed = pass(store).result.inputBytes;
  assert.ok(confirmed < full, 'Verdicted records are not charged to the shared allowance');
  clear(store);
  belowRows(store);

  // Act
  const outcomes = [];
  for (let attempt = 0; attempt < 4 && (outcomes.at(-1)?.error ?? true); attempt++) outcomes.push({ ...pass(store), kept: saved(store).length });

  // Assert
  const [first] = outcomes;
  assert.equal(first.error?.code, CODE, 'A store past the allowance before any verdict exists is refused at first');
  assert.equal(first.error.sharedAllowance, true);
  assert.match(first.error.message, /Delivery consistency input exceeds its byte bound/);
  assert.ok(first.kept > 0, 'The refused pass keeps the verdicts it established');
  const last = outcomes.at(-1);
  assert.equal(last.error, null, 'Successive handovers re-judge the store a part at a time until it fits');
  assert.equal(last.result.replaceable, true);
  assert.deepEqual(saved(store).map(row => row.run_id), ids.slice(0, 3).sort());
});

test('a rule identity change stales every verdict, and re-judgment proceeds across passes', async t => {
  // Arrange
  const { root, open } = isolatedProject(t, 'rule-identity');
  await completedRuns(root, 4);
  const store = open();
  fullCharge(store);
  Object.assign(verdicts.IDENTITY, { rule: 'settled-record-verdict-fixture-next', earlier: [verdicts.IDENTITY.rule] });
  belowRows(store);

  // Act
  const first = pass(store);
  const firstRules = saved(store).map(row => row.rule);
  let next = pass(store);
  for (let attempt = 0; attempt < 3 && next.error; attempt++) next = pass(store);

  // Assert
  assert.equal(first.error?.code, CODE);
  assert.ok(firstRules.includes('settled-record-verdict-fixture-next'), 'The refused pass replaced the verdicts it re-judged');
  assert.equal(next.error, null);
  assert.ok(saved(store).every(row => row.rule === 'settled-record-verdict-fixture-next'));
});

test('a verdict table past the record bound under intact protection is left as it is, with every record judged in full', async t => {
  // Arrange: no runtime writes more verdicts than the store holds records, so the surplus may be a later release's orphans.
  const { root, open } = isolatedProject(t, 'surplus');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  const [template] = saved(store);
  store.transaction(() => {
    const insert = store.db.prepare('INSERT INTO settled_verdicts SELECT ?, revision, state_bytes, state_digest, latest_revision, latest_bytes, journal_revision, acceptance, retirement, ? FROM settled_verdicts WHERE run_id=?');
    for (let index = saved(store).length; index <= MAX_DELIVERY_RECORDS; index++) insert.run(`later-orphan-${index}`, 'a-later-release-rule', template.run_id);
  });
  const before = saved(store);
  const installed = guards(store);
  assert.ok(before.length > MAX_DELIVERY_RECORDS, 'Fixture precondition: the verdict table is past the record bound');

  // Act
  const outcome = pass(store);

  // Assert
  assert.equal(outcome.error, null);
  assert.equal(outcome.result.inputBytes, full, 'Every record is judged in full');
  assert.deepEqual(saved(store), before, 'No verdict is written or removed');
  assert.deepEqual(guards(store), installed);
});

test('a verdict under a rule identity no runtime release here knows is a later release\'s and stays unchanged', async t => {
  const { root, open } = isolatedProject(t, 'later-rule');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  const confirmed = pass(store).result.inputBytes;
  const [later] = saved(store);
  store.db.prepare("UPDATE settled_verdicts SET rule='a-later-release-rule' WHERE run_id=?").run(later.run_id);

  const outcome = pass(store);

  assert.equal(outcome.error, null);
  assert.ok(outcome.result.inputBytes > confirmed, 'The record is judged in full');
  assert.ok(outcome.result.inputBytes < full, 'Records under the current rule are still confirmed');
  assert.equal(pass(store).result.inputBytes, outcome.result.inputBytes, 'The record stays judged in full at every pass');
  assert.equal(saved(store).find(row => row.run_id === later.run_id).rule, 'a-later-release-rule');
  // A later release's rule identity takes precedence over this runtime's shape checks.
  store.db.prepare('UPDATE settled_verdicts SET latest_bytes=-1, state_digest=? WHERE run_id=?').run('not-this-runtime-shape', later.run_id);
  const shaped = saved(store).find(row => row.run_id === later.run_id);
  assert.equal(pass(store).error, null);
  assert.deepEqual(saved(store).find(row => row.run_id === later.run_id), shaped, 'A later release\'s verdict stays unchanged whatever its other values');
});

test('an allowance refusal says whether it kept verdicts, so a retry is known to progress', async t => {
  const { root, open } = isolatedProject(t, 'refusal-text');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  clear(store);
  withBounds(full - 1);
  const progressing = pass(store);
  assert.equal(progressing.error?.code, CODE);
  assert.match(progressing.error.message, /keep their verdicts, so a later handover judges less/);
  clear(store);
  // An allowance that the selected delivery alone fits, but not beside any other record judged in full, keeps nothing.
  const selected = store.db.prepare('SELECT id FROM active').get().id;
  const reserved = verdicts.metadataOf(store.db, new Set(['accounting_commits']), selected);
  withBounds(reserved.stateBytes + reserved.latestBytes + 1);
  const stuck = pass(store);
  assert.equal(stuck.error?.code, CODE);
  assert.doesNotMatch(stuck.error.message, /keep their verdicts/);
  assert.deepEqual(saved(store), []);
});

test('a verdict stale by each bound value, malformed or orphaned settles nothing and is replaced or removed', async t => {
  const { root, open } = isolatedProject(t, 'stale');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  const original = saved(store);
  const changes = { revision: 'revision+1', state_bytes: 'state_bytes+1', latest_revision: 'latest_revision+1', latest_bytes: 'latest_bytes+1', journal_revision: 'coalesce(journal_revision, 0)+1', retirement: `'${'0'.repeat(64)}'`, state_digest: "'not-a-digest'" };
  for (const [column, value] of Object.entries(changes)) {
    store.db.prepare(`UPDATE settled_verdicts SET ${column}=${value} WHERE run_id=?`).run(original[0].run_id);
    const outcome = pass(store);
    assert.equal(outcome.error, null, column);
    assert.ok(outcome.result.inputBytes > pass(store).result.inputBytes, `A verdict stale by ${column} leads to a full judgment`);
    assert.deepEqual(saved(store), original, `A verdict stale by ${column} is replaced`);
  }
  store.db.prepare('INSERT INTO settled_verdicts SELECT ?, revision, state_bytes, state_digest, latest_revision, latest_bytes, journal_revision, acceptance, retirement, rule FROM settled_verdicts LIMIT 1').run(randomUUID());
  assert.equal(pass(store).error, null);
  assert.deepEqual(saved(store), original, 'An orphaned verdict is removed');
  assert.ok(full > pass(store).result.inputBytes);
  // A later release's verdict stays as it is even orphaned, while a malformed one keyed by NULL is removed.
  const copy = key => `INSERT INTO settled_verdicts SELECT ${key}, revision, state_bytes, state_digest, latest_revision, latest_bytes, journal_revision, acceptance, retirement, ? FROM settled_verdicts LIMIT 1`;
  const laterOrphan = randomUUID();
  store.db.prepare(copy('?')).run(laterOrphan, 'a-later-release-rule');
  store.db.prepare(copy('NULL')).run(verdicts.IDENTITY.rule);
  assert.equal(pass(store).error, null);
  assert.equal(saved(store).find(row => row.run_id === laterOrphan)?.rule, 'a-later-release-rule', 'A later release\'s orphaned verdict stays unchanged');
  assert.equal(store.db.prepare('SELECT count(*) AS count FROM settled_verdicts WHERE run_id IS NULL').get().count, 0, 'A NULL-keyed verdict is removed');
  // Each row is handled on its own, whichever rows share its key: of two NULL-keyed rows, in either order, the later release's stays
  // and the malformed one goes.
  for (const order of [['a-later-release-rule', verdicts.IDENTITY.rule], [verdicts.IDENTITY.rule, 'a-later-release-rule']]) {
    for (const rule of order) store.db.prepare(copy('NULL')).run(rule);
    assert.equal(pass(store).error, null);
    assert.deepEqual(store.db.prepare('SELECT rule FROM settled_verdicts WHERE run_id IS NULL').all().map(row => row.rule), ['a-later-release-rule'], `Rows inserted as ${order.join(', ')}`);
    store.db.prepare('DELETE FROM settled_verdicts WHERE run_id IS NULL').run();
  }
});

test('a verdict holding an integer past what JavaScript represents is malformed and replaced, or left as it is under a later rule', async t => {
  // Arrange
  const { root, open } = isolatedProject(t, 'unrepresentable');
  await completedRuns(root, 3);
  const store = open();
  fullCharge(store);
  const original = saved(store);
  const [current, later] = original.map(row => row.run_id);
  const largest = '9223372036854775807';

  // Act and assert: each bound column of a current-rule verdict in turn.
  for (const column of ['revision', 'state_bytes', 'latest_revision', 'latest_bytes', 'journal_revision']) {
    store.db.prepare(`UPDATE settled_verdicts SET ${column}=${largest} WHERE run_id=?`).run(current);
    assert.equal(pass(store).error, null, column);
    assert.deepEqual(saved(store), original, `A verdict whose ${column} cannot be represented is replaced`);
  }
  store.db.prepare(`UPDATE settled_verdicts SET latest_bytes=${largest}, rule='a-later-release-rule' WHERE run_id=?`).run(later);
  const raw = () => store.db.prepare('SELECT CAST(latest_bytes AS TEXT) AS bytes, rule FROM settled_verdicts WHERE run_id=?').get(later);
  const before = raw();
  assert.equal(pass(store).error, null);
  assert.deepEqual(raw(), before, 'A later release\'s verdict with such a value stays unchanged');
});

test('the store refuses rewriting or deleting a verdicted record\'s rows in place, and a reopened record is re-judged', async t => {
  const { root, open } = isolatedProject(t, 'freeze');
  const ids = await completedRuns(root, 3);
  const store = open();
  fullCharge(store);
  const [id] = ids;
  const revision = store.db.prepare('SELECT revision FROM runs WHERE id=?').get(id).revision;
  const completion = store.db.prepare("SELECT revision FROM history WHERE run_id=? AND kind='complete' ORDER BY revision DESC LIMIT 1").get(id).revision;
  assert.ok(revision > 0, 'Fixture precondition: the record has an earlier history row');
  const writes = {
    'current row rewrite': () => store.db.prepare('UPDATE runs SET state=state WHERE id=?').run(id),
    'current row deletion': () => store.db.prepare('DELETE FROM runs WHERE id=?').run(id),
    'completion row rewrite': () => store.db.prepare("UPDATE history SET kind='complete' WHERE run_id=? AND revision=?").run(id, completion),
    'completion row deletion': () => store.db.prepare('DELETE FROM history WHERE run_id=? AND revision=?').run(id, completion),
    'earlier history row rewrite': () => store.db.prepare('UPDATE history SET kind=kind WHERE run_id=? AND revision=0').run(id),
    'earlier history row deletion': () => store.db.prepare('DELETE FROM history WHERE run_id=? AND revision=0').run(id),
    'earlier journal row deletion': () => store.db.prepare('DELETE FROM accounting_commits WHERE run_id=? AND revision<?').run(id, revision),
    'journal row rewrite': () => store.db.prepare('UPDATE accounting_commits SET artifact=artifact WHERE run_id=?').run(id),
    'discharge-index row deletion': () => store.db.prepare('DELETE FROM discharge_index WHERE run_id=?').run(id),
    'discharge-index row rewrite': () => store.db.prepare('UPDATE discharge_index SET artifact=artifact WHERE run_id=?').run(id),
  };
  // A replacing insert's implicit delete fires no trigger, so replacing a frozen row is refused by its own guard.
  const replacing = (table, revision, change) => () => {
    const row = { ...store.db.prepare(`SELECT * FROM ${table} WHERE run_id=? AND revision=?`).get(id, revision), ...change };
    const columns = Object.keys(row);
    store.db.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`).run(...columns.map(column => row[column]));
  };
  writes['latest history row replacing insert'] = replacing('history', revision, { kind: 'replaced' });
  writes['journal row replacing insert'] = replacing('accounting_commits', revision, { artifact: '0'.repeat(64) });
  // A replacing update from an unverdicted run's row onto a frozen key is refused by the destination side of the update guard.
  const source = ids.at(-1);
  writes['latest history row replacing update from another run'] = () => store.db.prepare('UPDATE OR REPLACE history SET run_id=?, revision=? WHERE run_id=? AND revision=0').run(id, revision, source);
  writes['journal row replacing update from another run'] = () => store.db.prepare('UPDATE OR REPLACE accounting_commits SET run_id=?, revision=? WHERE run_id=? AND revision=0').run(id, revision, source);
  assert.ok(store.db.prepare('SELECT 1 FROM discharge_index WHERE run_id=?').get(id), 'Fixture precondition: the record has discharge-index rows');
  for (const [label, write] of Object.entries(writes)) assert.throws(write, /verdicted-run/, label);

  // A save to a new revision is admitted and stales the verdict, so the record is judged again.
  reopen(store, id);
  const before = saved(store).find(row => row.run_id === id);
  assert.equal(before.revision, revision, 'The saved verdict still names the earlier revision');
  assert.equal(pass(store).error, null);
  assert.equal(saved(store).find(row => row.run_id === id).revision, revision + 1, 'The reopened record is re-judged and its verdict replaced');
});

test('a reopened record is re-judged on a full store as well', async t => {
  // Arrange
  const { root, open } = isolatedProject(t, 'reopen-full');
  const [id] = await completedRuns(root, 3);
  asFullStore(root);
  const store = open();
  assert.equal(store.db.prepare('PRAGMA user_version').get().user_version, 2, 'Fixture precondition: a full store');
  assert.equal(pass(store).error, null);
  const revision = saved(store).find(row => row.run_id === id)?.revision;
  assert.equal(revision, store.db.prepare('SELECT revision FROM runs WHERE id=?').get(id).revision, 'Fixture precondition: the record holds a verdict');

  // Act
  reopen(store, id);
  const outcome = pass(store);

  // Assert
  assert.equal(outcome.error, null);
  assert.equal(saved(store).find(row => row.run_id === id).revision, revision + 1, 'The reopened record is re-judged and its verdict replaced');
});

test('the store refuses rewriting or deleting a verdicted record\'s reminder issuance row', async t => {
  // Arrange: a reminder issued while the record was running, before it settled.
  const { root, open } = isolatedProject(t, 'reminder');
  const id = (await execute(root, handover(), dependencies)).id;
  const issuing = open();
  assert.equal(issuing.remind(actor, issuing.read().revision, () => true).issued, true);
  const reminded = issuing.db.prepare('SELECT revision FROM runs WHERE id=?').get(id).revision;
  issuing.close();
  await completeReflection(root, actor, execute, dependencies);
  await completedRuns(root, 1);
  const store = open();
  fullCharge(store);
  assert.ok(saved(store).some(row => row.run_id === id), 'Fixture precondition: the reminded record holds a verdict');
  assert.equal(store.db.prepare('SELECT kind FROM history WHERE run_id=? AND revision=?').get(id, reminded)?.kind, 'continuation-reminder', 'Fixture precondition: the reminder issuance row');

  // Act and assert
  assert.throws(() => store.db.prepare('UPDATE history SET kind=kind WHERE run_id=? AND revision=?').run(id, reminded), /verdicted-run/, 'rewrite');
  assert.throws(() => store.db.prepare('DELETE FROM history WHERE run_id=? AND revision=?').run(id, reminded), /verdicted-run/, 'deletion');
});

test('running out of the shared allowance inside an earlier release\'s replay keeps the pass\'s writes', async t => {
  // Arrange: the replayed record is judged last, after the settled records whose verdicts the pass establishes.
  const { root, open } = isolatedProject(t, 'legacy-replay');
  const ids = await completedRuns(root, 4);
  const settled = ids.slice(0, 3).sort();
  const store = open();
  const full = fullCharge(store);
  clear(store);
  asEarlierRelease(store, settled[2]);
  // The replay reads every history row of the record, more than the full judgment of its latest state charged.
  withBounds(full + 8000);

  // Act
  const refused = pass(store);

  // Assert
  assert.equal(refused.error?.code, CODE);
  assert.equal(refused.error.sharedAllowance, true);
  assert.match(refused.error.message, /^Accounting recovery exceeded its input byte bound; the 2 settled record\(s\) this pass judged keep their verdicts/);
  assert.deepEqual(saved(store).map(row => row.run_id), settled.slice(0, 2));
});

test('a legacy blocker found before the allowance runs out leaves verdicts and protection unchanged', async t => {
  // Arrange: the blocker is judged first; the settled records after it hold stale verdicts, so they are judged in full.
  const { root, open } = isolatedProject(t, 'legacy-blocker');
  const ids = await completedRuns(root, 4);
  const settled = ids.slice(0, 3).sort();
  const store = open();
  fullCharge(store);
  const stale = saved(store).filter(row => row.run_id !== settled[0]).map(row => ({ ...row, latest_bytes: row.latest_bytes + 1 }));
  clear(store);
  asEarlierRelease(store, settled[0]);
  // The smallest allowance the blocker's replay fits: the records after it no longer fit beside it, so the allowance runs out after
  // the blocker is found. The search stops at the first pass that gets past the replay, whichever refusal follows, so it does not
  // depend on the refusal under test; a pass that runs out before then writes nothing, as no settled record is judged before it.
  const selected = verdicts.metadataOf(store.db, new Set(['accounting_commits']), ids.at(-1));
  const inReplay = /^Accounting (recovery|predecessor)/;
  let bound = selected.stateBytes + selected.latestBytes + 1;
  for (let replaying = false; ; bound += 250) {
    withBounds(bound);
    const error = pass(store).error;
    const message = error?.unkeptMessage ?? error?.message ?? '';
    if (!error?.sharedAllowance || replaying && !inReplay.test(message)) break;
    replaying ||= inReplay.test(message);
  }
  assert.equal(saved(store).length, 0);
  const insert = store.db.prepare('INSERT INTO settled_verdicts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of stale) insert.run(row.run_id, row.revision, row.state_bytes, row.state_digest, row.latest_revision, row.latest_bytes, row.journal_revision, row.acceptance, row.retirement, row.rule);
  const before = saved(store);
  const installed = guards(store);

  // Act
  const refused = pass(store);

  // Assert
  assert.equal(refused.error?.code, CODE);
  assert.equal(refused.error.sharedAllowance, undefined);
  assert.match(refused.error.message, new RegExp(`^Legacy delivery consistency is unavailable for 1 record\\(s\\): complete:legacy-replay-unavailable \\(1\\): ${settled[0]}`));
  assert.deepEqual(saved(store), before, 'The refused pass writes no verdict');
  assert.deepEqual(guards(store), installed);
});

test('a verdict table whose definition this runtime does not recognize is a later release\'s and left unchanged, with every record judged in full', async t => {
  // Arrange: the same rows under a table defined differently, this runtime's guards intact.
  const { root, open } = isolatedProject(t, 'foreign-table');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  const installed = guards(store);
  // The guards name the table, so they are set aside while it is rebuilt and recreated exactly as this runtime defines them.
  store.transaction(() => {
    for (const guard of installed) store.db.exec(`DROP TRIGGER ${guard.name}`);
    store.db.exec('CREATE TEMP TABLE kept AS SELECT * FROM settled_verdicts; DROP TABLE settled_verdicts');
    store.db.exec(verdicts.TABLE_SQL.replace(/\)$/, ', note TEXT)'));
    store.db.exec('INSERT INTO settled_verdicts SELECT *, NULL FROM kept; DROP TABLE kept');
    for (const guard of verdicts.TRIGGERS) store.db.exec(guard.sql);
  });
  const definition = () => store.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='settled_verdicts'").get().sql;
  const before = { rows: saved(store), sql: definition() };
  assert.notEqual(before.sql, verdicts.TABLE_SQL, 'Fixture precondition: the table is not defined as this runtime defines it');
  assert.deepEqual(guards(store), installed, 'Fixture precondition: the guards are unchanged');
  assert.equal(verdicts.protectionState(store.db), 'later');

  // Act
  const outcome = pass(store);

  // Assert
  assert.equal(outcome.error, null);
  assert.equal(outcome.result.inputBytes, full, 'Every record is judged in full');
  assert.deepEqual({ rows: saved(store), sql: definition() }, before, 'The table and its verdicts are left unchanged');
  assert.deepEqual(guards(store), installed);
});

test('missing protection is reinstalled with every earlier verdict removed, and altered protection is left as a later release\'s', async t => {
  // Arrange
  const { root, open } = isolatedProject(t, 'protection');
  await completedRuns(root, 4);
  const store = open();
  const full = fullCharge(store);
  const installed = guards(store);
  const earlier = saved(store);
  belowRows(store);

  // Act: one guard missing on a store that needs more than one pass. A sentinel digest marks the verdicts written before the gap;
  // confirmation does not compare digests, so only their removal clears it.
  const sentinel = 'f'.repeat(64);
  store.db.prepare('UPDATE settled_verdicts SET state_digest=?').run(sentinel);
  store.db.exec(`DROP TRIGGER ${installed[0].name}`);
  const refused = pass(store);
  const kept = saved(store);

  // Assert
  assert.equal(refused.error?.code, CODE);
  assert.deepEqual(guards(store), installed, 'The refused pass still reinstalls the protection');
  assert.ok(kept.every(row => row.state_digest !== sentinel), 'Verdicts written before the reinstall are removed, not accepted on the next pass');
  assert.ok(kept.every(row => earlier.some(old => old.run_id === row.run_id)));
  let next = pass(store);
  for (let attempt = 0; attempt < 3 && next.error; attempt++) next = pass(store);
  assert.equal(next.error, null);

  // An altered guard is a later release's: nothing is accepted and nothing is changed.
  Object.assign(BOUNDS, { input: 64 * 1024 * 1024 });
  const rows = saved(store);
  store.db.exec(`DROP TRIGGER ${installed[0].name}`);
  const altered = installed[0].sql.replace("'verdicted-run'", "'later-release'");
  store.db.exec(altered);
  const later = pass(store);
  assert.equal(later.error, null);
  assert.equal(later.result.inputBytes, full, 'A later release\'s protection leads to full judgment');
  assert.deepEqual(saved(store), rows, 'A later release\'s verdicts are left unchanged');
  assert.equal(guards(store).find(guard => guard.name === installed[0].name).sql, altered, 'A later release\'s protection is left unchanged');
});

test('the retirement preflight neither accepts nor writes verdicts', async t => {
  const { root, open } = isolatedProject(t, 'preflight');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  const rows = saved(store);
  const preflight = pass(store, { resourceOnly: true });
  assert.equal(preflight.error, null);
  assert.equal(preflight.result.inputBytes, full, 'The preflight judges every record in full');
  assert.deepEqual(saved(store), rows);
  clear(store);
  pass(store, { resourceOnly: true });
  assert.deepEqual(saved(store), [], 'The preflight writes no verdict');
});

test('the runtime\'s own guards without their verdict table count as missing protection and are repaired', async t => {
  // Arrange
  const { root, open } = isolatedProject(t, 'table-dropped');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  const installed = guards(store);
  store.db.exec('DROP TABLE settled_verdicts');

  // Act
  const repaired = pass(store);

  // Assert
  assert.equal(repaired.error, null);
  assert.equal(repaired.result.inputBytes, full, 'No verdict is accepted while protection is missing');
  assert.deepEqual(guards(store), installed);
  assert.equal(saved(store).length, 2, 'The pass reinstalls the table and writes verdicts again');
  assert.ok(pass(store).result.inputBytes < full, 'The next pass confirms them');
});

test('the store refuses moving a verdicted run back to an earlier revision', async t => {
  const { root, open } = isolatedProject(t, 'revision-back');
  const ids = await completedRuns(root, 3);
  const store = open();
  fullCharge(store);
  const [id] = ids;
  store.db.prepare('UPDATE runs SET revision=revision+1 WHERE id=?').run(id);
  assert.throws(() => store.db.prepare('UPDATE runs SET revision=revision-1 WHERE id=?').run(id), /verdicted-run/);
  // Every other route back to the verdicted revision is refused as well, whatever revision the run is at: deleting the row, renaming
  // it away or another row onto its id, inserting it again, and a replacing insert, whose implicit delete fires no trigger.
  store.db.exec('PRAGMA foreign_keys=OFF');
  const [other] = ids.slice(1);
  const row = store.db.prepare('SELECT revision, state FROM runs WHERE id=?').get(id);
  const routes = {
    deletion: () => store.db.prepare('DELETE FROM runs WHERE id=?').run(id),
    'rename away': () => store.db.prepare("UPDATE runs SET id='renamed-away' WHERE id=?").run(id),
    'rename onto': () => store.db.prepare('UPDATE runs SET id=? WHERE id=?').run(id, other),
    'replacing insert': () => store.db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?, ?)').run(id, row.revision - 1, row.state),
    'same-revision rewrite': () => store.db.prepare('UPDATE runs SET state=state WHERE id=?').run(id),
    'rename to NULL': () => store.db.prepare('UPDATE runs SET id=NULL, revision=revision+1 WHERE id=?').run(id),
    'rename from NULL onto its id': () => {
      store.db.prepare("INSERT INTO runs VALUES (NULL, ?, 'nulled')").run(row.revision + 5);
      try { store.db.prepare('UPDATE runs SET id=? WHERE id IS NULL').run(id); }
      finally { store.db.prepare('DELETE FROM runs WHERE id IS NULL').run(); }
    },
  };
  for (const [label, write] of Object.entries(routes)) assert.throws(write, /verdicted-run/, label);
  // A replacing insert below the run's current revision is refused even while it stays above the verdict's.
  store.db.prepare('UPDATE runs SET revision=revision+1 WHERE id=?').run(id);
  assert.throws(() => store.db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?, ?)').run(id, row.revision, row.state), /verdicted-run/, 'replacing insert below the current revision');
});

test('a pass whose kept verdicts fail to commit says it kept none, so a retry stops', async t => {
  // Arrange
  const { root, open } = isolatedProject(t, 'persist-failure');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  clear(store);
  withBounds(full - 1);
  const original = verdicts.applyWrites;
  t.after(() => { verdicts.applyWrites = original; });
  // Only the fresh transaction after the rollback runs applyWrites, so failing it stands in for a commit that cannot be kept.
  verdicts.applyWrites = () => { throw new Error('fixture persistence failure'); };

  // Act
  const refused = pass(store);

  // Assert
  assert.equal(refused.error?.code, CODE);
  assert.doesNotMatch(refused.error.message, /keep their verdicts/);
  assert.match(refused.error.message, /its settled-record verdicts could not be kept: fixture persistence failure/);
  assert.deepEqual(saved(store), [], 'None of the pass\'s writes persist');
});

test('a dropped verdict table under this runtime\'s guards never blocks a save', async t => {
  // Arrange
  const { root, open } = isolatedProject(t, 'table-dropped-save');
  const ids = await completedRuns(root, 3);
  const store = open();
  fullCharge(store);
  store.db.exec('DROP TABLE settled_verdicts');
  const [id] = ids;
  const state = JSON.parse(store.db.prepare('SELECT state FROM runs WHERE id=?').get(id).state);

  // Act
  const saving = () => store.transaction(() => {
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    store.save(state, 'fixture-reopen');
  });

  // Assert
  assert.doesNotThrow(saving, 'A save recreates the empty table beneath the guards before writing');
  assert.deepEqual(saved(store), [], 'The recreated table holds no verdict');
});

test('a verdict whose acceptance identity collides with another refuses the pass as ambiguous', async t => {
  const { root, open } = isolatedProject(t, 'acceptance-collision');
  await completedRuns(root, 3);
  const store = open();
  fullCharge(store);
  const [first, second] = saved(store);
  assert.ok(first.acceptance && second.acceptance, 'Fixture precondition: both verdicts bind an acceptance identity');
  store.db.prepare('UPDATE settled_verdicts SET acceptance=? WHERE run_id=?').run(first.acceptance, second.run_id);
  const rows = saved(store);
  const refused = pass(store);
  assert.equal(refused.error?.code, CODE);
  assert.match(refused.error.message, /Acceptance identity is ambiguous/);
  assert.deepEqual(saved(store), rows, 'The refused pass writes nothing');
});

test('a pass refused for a reason other than the shared allowance leaves verdicts and protection unchanged', async t => {
  const { root, open } = isolatedProject(t, 'other-refusal');
  await completedRuns(root, 3);
  const store = open();
  const full = fullCharge(store);
  const rows = saved(store);
  const installed = guards(store);
  // A completion row over its own bound refuses one record judged in full; the stale verdict means that record is judged.
  store.db.prepare('UPDATE settled_verdicts SET latest_bytes=latest_bytes+1 WHERE run_id=?').run(rows[0].run_id);
  const tampered = saved(store);
  withBounds(full);
  BOUNDS.completionRow = 1;
  const refused = pass(store);
  assert.equal(refused.error?.code, CODE);
  assert.equal(refused.error.sharedAllowance, undefined);
  assert.match(refused.error.message, /completion history exceeds its own read bound/);
  assert.deepEqual(saved(store), tampered, 'A refusal by a per-record bound writes no verdict');
  assert.deepEqual(guards(store), installed);
});

test('compact-history carries verdicts and their protection over exactly, and confirmation still holds', async t => {
  // A version-2 store, which compaction rewrites; stores the runtime creates are compact already.
  const { root, open } = retiredFixture(t);
  let store = open();
  assert.equal(pass(store).error, null);
  const before = { rows: saved(store), guards: guards(store), confirmed: pass(store).result.inputBytes };
  assert.equal(before.rows.length, 1, 'Fixture precondition: the store holds a verdict');
  store.close();

  const result = migrationExecute(root, { action: 'compact-history', store: 'delivery' }, null, { fixtureCompaction: true });
  migrationExecute(root, { action: 'compact-history', store: 'delivery', finish: true }, null, { fixtureCompaction: true });

  assert.equal(result.state, 'swapped');
  store = open();
  assert.deepEqual(saved(store), before.rows);
  assert.deepEqual(guards(store), before.guards);
  const after = pass(store);
  assert.equal(after.error, null);
  assert.equal(after.result.inputBytes, before.confirmed, 'Compacted verdicts are confirmed as before');
});

// Two retired earlier-release records, the second selected. With `tracked`, the first's pending follow-up is retired as tracked by a
// backlog entry, whose file the fixture returns.
test('compact-history carries a later release\'s verdict holding an integer past what JavaScript represents exactly', async t => {
  // Arrange
  const { root, open } = retiredFixture(t);
  let store = open();
  assert.equal(pass(store).error, null);
  store.db.prepare("INSERT INTO settled_verdicts VALUES ('later-orphan', 0, 0, ?, 0, 9223372036854775807, NULL, NULL, NULL, 'a-later-release-rule')").run('0'.repeat(64));
  const raw = () => store.db.prepare('SELECT run_id, CAST(revision AS TEXT) AS revision, CAST(latest_bytes AS TEXT) AS latest_bytes, typeof(latest_bytes) AS type, rule FROM settled_verdicts ORDER BY run_id').all();
  const before = raw();
  store.close();

  // Act
  const swapped = migrationExecute(root, { action: 'compact-history', store: 'delivery' }, null, { fixtureCompaction: true });
  const finished = migrationExecute(root, { action: 'compact-history', store: 'delivery', finish: true }, null, { fixtureCompaction: true });

  // Assert
  assert.equal(swapped.state, 'swapped');
  assert.equal(finished.state, 'finished');
  store = open();
  assert.deepEqual(raw(), before, 'Every verdict is carried over exactly, the wide integer still an integer');
});

function retiredFixture(t, { tracked = false } = {}) {
  // Retirement admits only fixtures under its own development folder.
  const { root, open } = isolatedProject(t, 'retired', 'runtime-legacy-migration');
  const canonical = fs.realpathSync.native(root);
  const directory = path.join(canonical, '.nightshift/runs');
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'state.sqlite'));
  db.exec('PRAGMA foreign_keys=ON; CREATE TABLE runs (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL); CREATE TABLE active (singleton INTEGER PRIMARY KEY CHECK(singleton=1), id TEXT NOT NULL REFERENCES runs(id)); CREATE TABLE history (run_id TEXT NOT NULL REFERENCES runs(id), revision INTEGER NOT NULL, kind TEXT NOT NULL, recorded_at TEXT NOT NULL, state TEXT NOT NULL, PRIMARY KEY(run_id, revision)); PRAGMA user_version=1;');
  const ids = [randomUUID(), randomUUID()].sort();
  const followup = { id: 'saved-question', status: 'pending', title: 'Track the saved question' };
  for (const [index, id] of ids.entries()) {
    const state = { schema: 1, kind: 'delivery', id, root: canonical, revision: 0, status: 'complete', controller: { host: 'codex', session: `owner-${index}` }, resourceMode: 'development', tasks: [], workers: [], followups: tracked && index === 0 ? [followup] : [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const body = JSON.stringify(state);
    db.prepare('INSERT INTO runs VALUES (?, ?, ?)').run(id, 0, body);
    db.prepare('INSERT INTO history VALUES (?, ?, ?, ?, ?)').run(id, 0, 'complete', state.updatedAt, body);
  }
  db.prepare('INSERT INTO active VALUES (?, ?)').run(1, ids[1]);
  db.close();
  const backlog = path.join(canonical, '.nightshift/BUGS.md');
  if (tracked) fs.writeFileSync(backlog, ['# Bugs', '', '### Saved question', '', 'Original tracking text.', ''].join('\n'));
  const choices = ids.map((id, index) => ({ runId: id, disposition: 'retired-complete', report: { kind: 'none' }, followups: tracked && index === 0 ? [{ id: followup.id, disposition: 'tracked', destination: { path: '.nightshift/BUGS.md', anchor: 'saved-question' } }] : [] }));
  const preview = migrationExecute(canonical, { action: 'manifest', ids, choices }, null, { fixtureRetirement: true });
  migrationExecute(canonical, { action: 'retire', ids, choices, manifestHash: preview.hash, authority: 'Approve the exact fixture manifest', actor: { host: 'codex', session: 'owner-0' } }, null, { fixtureRetirement: true });
  return { root: canonical, open, retired: ids[0], backlog };
}

test('a verdicted retired record keeps its certificate validation, and re-retirement stales its verdict', async t => {
  // Arrange
  const { open, retired } = retiredFixture(t);
  const store = open();
  assert.equal(pass(store).error, null);
  const [verdict] = saved(store);
  assert.equal(verdict.run_id, retired);
  assert.match(verdict.retirement, /^[a-f0-9]{64}$/);

  // Act and assert: the verdicted record is confirmed while its certificate chain is still walked.
  assert.equal(pass(store).error, null);
  const earlierId = verdict.retirement;
  const later = JSON.stringify({ ...JSON.parse(store.db.prepare('SELECT body FROM artifacts WHERE id=?').get(earlierId).body), supersedes: earlierId, recordedAt: new Date(Date.now() + 1000).toISOString() });
  store.db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(sha256(later), later);
  store.db.prepare('UPDATE legacy_retirements SET artifact=? WHERE run_id=?').run(sha256(later), retired);
  assert.equal(pass(store).error, null);
  assert.equal(saved(store)[0].retirement, sha256(later), 'Re-retirement stales the verdict, which is replaced');

  // A certificate artifact outside every chain still refuses at the end of the pass, verdict or not.
  const orphan = JSON.stringify({ ...JSON.parse(later), recordedAt: new Date(Date.now() + 2000).toISOString() });
  store.db.prepare('INSERT INTO artifacts VALUES (?, ?)').run(sha256(orphan), orphan);
  const refused = pass(store);
  assert.equal(refused.error?.code, CODE);
  assert.match(refused.error.message, /outside every current reference chain/);
});

test('an edited tracked destination of a verdicted retired record still refuses creation', async t => {
  // Arrange
  const { open, retired, backlog } = retiredFixture(t, { tracked: true });
  const store = open();
  assert.equal(pass(store).error, null);
  const before = saved(store);
  assert.deepEqual(before.map(row => row.run_id), [retired], 'Fixture precondition: the retired record holds a verdict');
  assert.ok(pass(store).result.inputBytes > 0, 'Fixture precondition: the verdict is confirmed');

  // Act
  fs.writeFileSync(backlog, fs.readFileSync(backlog, 'utf8').replace('Original tracking text.', 'Different tracking text.'));
  const refused = pass(store);

  // Assert
  assert.ok(refused.error, 'The verdict does not vouch for the tracked destination in project files');
  assert.match(refused.error.message, new RegExp(`Pending follow-ups of ${retired} changed or lost their tracking destination`));
  assert.deepEqual(saved(store), before, 'The refused pass writes nothing');
});
