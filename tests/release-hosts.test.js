'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { applyHooks, definitions, discardJournal, planHooks, recoverClaude } = require('../internal/releases/host-config');
const { fixture } = require('./release-fixtures');

const key = 'a'.repeat(64);
const source = 'C:\\fixture\\config.toml';
const stateKey = (group, index = 0) => `${source}:session_start:${group}:${index}`;

test('Codex setup appends owned hooks and does not inherit stale trust', () => {
  const desired = definitions('codex', 'C:/store/launchers/hash/bootstrap.js', key);
  const user = { type: 'command', command: 'echo user' };
  const hooks = { SessionStart: [{ hooks: [user] }, { hooks: [] }], state: { [stateKey(0)]: { trusted_hash: 'user-hash' }, [stateKey(2)]: { trusted_hash: 'stale-hash' } } };
  const native = [{ key: stateKey(0), source: 'user', currentHash: 'user-hash', trustStatus: 'trusted', enabled: true }];
  const planned = planHooks(hooks, desired, undefined, false, source, native);
  assert.deepEqual(planned.hooks.SessionStart.slice(0, 2), hooks.SessionStart);
  assert.deepEqual(planned.hooks.SessionStart[2].hooks, [desired.SessionStart]);
  assert.equal(planned.hooks.state[stateKey(0)].trusted_hash, 'user-hash');
  assert.equal(planned.hooks.state[stateKey(2)], undefined);
});

for (const trustedTail of [true, false]) test(`Codex removal preserves shifted surviving trust with trustedTail=${trustedTail}`, () => {
  const desired = definitions('codex', 'C:/store/launchers/hash/bootstrap.js', key);
  const first = { type: 'command', command: 'echo first' };
  const tail = { type: 'command', command: 'echo tail' };
  const hooks = { SessionStart: [{ hooks: [first] }, { hooks: [] }, { hooks: [desired.SessionStart] }, { hooks: [tail] }], state: { [stateKey(0)]: { trusted_hash: 'first-hash' }, [stateKey(2)]: { trusted_hash: 'owned-hash' }, ...(trustedTail ? { [stateKey(3)]: { trusted_hash: 'tail-hash' } } : {}) } };
  const native = [{ key: stateKey(0), source: 'user', currentHash: 'first-hash', trustStatus: 'trusted', enabled: true }, { key: stateKey(3), source: 'user', currentHash: 'tail-hash', trustStatus: trustedTail ? 'trusted' : 'untrusted', enabled: true }];
  const result = planHooks(hooks, desired, undefined, true, source, native);
  assert.deepEqual(result.hooks.SessionStart, [{ hooks: [first] }, { hooks: [] }, { hooks: [tail] }]);
  assert.equal(result.hooks.state[stateKey(3)], undefined);
  assert.deepEqual(result.hooks.state[stateKey(2)], trustedTail ? { trusted_hash: 'tail-hash' } : undefined);
  assert.equal(result.survivors.find(item => item.currentHash === 'tail-hash').key, stateKey(2));
});

test('edited owned hooks conflict and absent removal is a no-op', () => {
  const desired = definitions('codex', 'C:/store/launchers/hash/bootstrap.js', key);
  assert.throws(() => planHooks({ SessionStart: [{ hooks: [{ ...desired.SessionStart, timeout: 1 }] }] }, desired, undefined, true, source), /owned SessionStart hook was edited/);
  assert.deepEqual(planHooks({}, desired, undefined, true, source).hooks, {});
});

test('Claude configuration preserves unrelated values and has replayable recovery', async t => {
  const value = fixture(t);
  const target = path.join(value.profile, 'settings.json');
  const userHook = { type: 'command', command: 'echo user' };
  fs.writeFileSync(target, JSON.stringify({ theme: 'dark', permissions: { deny: ['Bash(private)'] }, hooks: { SessionStart: [{ hooks: [userHook] }] } }));
  const registration = { host: 'claude', profile: value.profile, definitions: definitions('claude', 'C:/store/launchers/hash/bootstrap.js', key) };
  let journal;
  await applyHooks(registration, value.project, false, value => { journal = value; });
  const current = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(current.theme, 'dark');
  assert.deepEqual(current.permissions, { deny: ['Bash(private)'] });
  assert.deepEqual(current.hooks.SessionStart[0].hooks, [userHook]);
  const bytes = fs.readFileSync(target);
  recoverClaude(journal, value.project);
  assert.deepEqual(fs.readFileSync(target), bytes);
  discardJournal(journal);
  await applyHooks(registration, value.project, true, value => { journal = value; });
  assert.deepEqual(JSON.parse(fs.readFileSync(target)).hooks.SessionStart, [{ hooks: [userHook] }]);
  discardJournal(journal);
});

test('Claude concurrent edits are preserved and recovery files remain inspectable', async t => {
  const value = fixture(t);
  const target = path.join(value.profile, 'settings.json');
  const original = Buffer.from('{"theme":"original"}');
  const changed = Buffer.from('{"theme":"user changed"}');
  fs.writeFileSync(target, original);
  const registration = { host: 'claude', profile: value.profile, definitions: definitions('claude', 'C:/store/launchers/hash/bootstrap.js', key) };
  let journal;
  await assert.rejects(applyHooks(registration, value.project, false, value => { journal = value; fs.writeFileSync(target, changed); }), /could not be safely written/);
  assert.deepEqual(fs.readFileSync(target), changed);
  assert.deepEqual(fs.readFileSync(journal.backup), original);
  assert.throws(() => recoverClaude(journal, value.project), /could not be safely written/);
  assert.deepEqual(fs.readFileSync(target), changed);
  discardJournal(journal);
});

test('Claude first setup creates a complete file and rejects linked settings', async t => {
  const value = fixture(t);
  const target = path.join(value.profile, 'settings.json');
  const registration = { host: 'claude', profile: value.profile, definitions: definitions('claude', 'C:/store/launchers/hash/bootstrap.js', key) };
  let journal;
  await applyHooks(registration, value.project, false, value => { journal = value; });
  assert.equal(JSON.parse(fs.readFileSync(target)).hooks.Stop.length, 1);
  discardJournal(journal);
  fs.linkSync(target, path.join(value.root, 'linked-settings.json'));
  await assert.rejects(applyHooks(registration, value.project, true), /ordinary nonlinked file/);
});
