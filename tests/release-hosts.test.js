'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { applyHooks, claudeHooksDisabled, definitions, discardJournal, inspectHooks, inspectionContext, planHooks, reconcileCodexJournal, recoverClaude } = require('../internal/releases/host-config');
const { ReleaseError } = require('../internal/releases/io');
const { fixture, settingsReader } = require('./release-fixtures');

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

test('Claude admission follows the host effective settings rather than the user profile file', async t => {
  const value = fixture(t);
  const target = path.join(value.profile, 'settings.json');
  const registration = { host: 'claude', profile: value.profile, definitions: definitions('claude', 'C:/store/launchers/hash/bootstrap.js', key) };
  const hooks = Object.fromEntries(Object.entries(registration.definitions).map(([event, definition]) => [event, [{ hooks: [definition] }]]));

  // A project or local opt-out never appears in the user profile, which is the only
  // file the profile snapshot can see.
  fs.writeFileSync(target, JSON.stringify({ hooks }));
  const disabling = settingsReader({ disableAllHooks: true });
  const disabled = await inspectHooks(registration, value.project, { readSettings: disabling });
  assert.equal(disabled.disabled, true);
  assert.equal(disabled.configured, true);
  assert.equal(disabled.usable, false);
  assert.deepEqual(disabling.calls, [{ profile: value.profile, cwd: value.project }]);

  // The complementary case: a project may re-enable hooks the user profile disabled,
  // so a profile file saying true cannot stand in for the resolved value.
  fs.writeFileSync(target, JSON.stringify({ disableAllHooks: true, hooks }));
  const enabled = await inspectHooks(registration, value.project, { readSettings: settingsReader({ disableAllHooks: false }) });
  assert.equal(enabled.disabled, false);
  assert.equal(enabled.usable, true);
});

test('Claude settings resolve against the project even when inspection runs from the profile', async t => {
  const value = fixture(t);
  fs.writeFileSync(path.join(value.profile, 'settings.json'), JSON.stringify({}));
  const registration = { host: 'claude', profile: value.profile, definitions: definitions('claude', 'C:/store/launchers/hash/bootstrap.js', key) };
  const read = settingsReader();
  await inspectHooks(registration, value.profile, { project: value.project, readSettings: read });
  assert.deepEqual(read.calls, [{ profile: value.profile, cwd: value.project }]);
});

test('unavailable Claude settings inspection is distinct from an enabled result', async t => {
  const value = fixture(t);
  fs.writeFileSync(path.join(value.profile, 'settings.json'), JSON.stringify({}));
  const registration = { host: 'claude', profile: value.profile, definitions: definitions('claude', 'C:/store/launchers/hash/bootstrap.js', key) };
  await assert.rejects(inspectHooks(registration, value.project, { readSettings: async () => ({ sources: [] }) }), error => error.code === 'host-configuration-unavailable');
  await assert.rejects(inspectHooks(registration, value.project, { readSettings: async () => { throw new ReleaseError('native-host-timeout', 'inspection timed out'); } }), error => error.code === 'native-host-timeout');
});

test('automatic Claude registration stops at a deliberate opt-out without touching settings', async t => {
  const value = fixture(t);
  const target = path.join(value.profile, 'settings.json');
  const original = Buffer.from(JSON.stringify({ theme: 'preserve' }));
  fs.writeFileSync(target, original);
  const registration = { host: 'claude', profile: value.profile, automatic: true, definitions: definitions('claude', 'C:/store/launchers/hash/bootstrap.js', key) };
  let journal;
  await assert.rejects(applyHooks(registration, value.profile, false, value => { journal = value; }, { project: value.project, readSettings: settingsReader({ disableAllHooks: true }) }), /hooks are disabled/);
  assert.equal(journal, undefined);
  assert.deepEqual(fs.readFileSync(target), original);

  await applyHooks(registration, value.profile, false, value => { journal = value; }, { project: value.project, readSettings: settingsReader({ disableAllHooks: false }) });
  assert.equal(JSON.parse(fs.readFileSync(target)).theme, 'preserve');
  assert.equal(JSON.parse(fs.readFileSync(target)).hooks.Stop.length, 1);
  discardJournal(journal);
});

test('an operation resolves each settings context once and keeps distinct contexts apart', async t => {
  const value = fixture(t);
  const other = path.join(value.root, 'other-project');
  fs.mkdirSync(other);
  const read = settingsReader({ disableAllHooks: true });
  const cache = new Map();

  // An inspection started from the profile with an explicit project resolves to the same
  // context as one started from the project, so both reach the same memo entry.
  assert.equal(inspectionContext(value.profile, { project: value.project }), value.project);
  assert.equal(inspectionContext(value.project, {}), value.project);

  assert.equal(await claudeHooksDisabled(value.profile, value.project, { readSettings: read, cache }), true);
  assert.equal(await claudeHooksDisabled(value.profile, inspectionContext(value.profile, { project: value.project }), { readSettings: read, cache }), true);
  assert.equal(read.calls.length, 1, 'the same profile and project must not start a second native session');

  assert.equal(await claudeHooksDisabled(value.profile, other, { readSettings: read, cache }), true);
  assert.equal(read.calls.length, 2, 'a different project is a different question');

  // Without a cache every call resolves again, so the memo is opt-in per operation.
  await claudeHooksDisabled(value.profile, value.project, { readSettings: read });
  assert.equal(read.calls.length, 3);
});

test('Codex journal recovery prefers the recorded directory and survives its deletion', async t => {
  const value = fixture(t);
  const desired = definitions('codex', 'C:/store/launchers/hash/bootstrap.js', key);
  const survivor = { key: stateKey(0), currentHash: 'user-hash', trustStatus: 'trusted', enabled: true };
  const recorded = path.join(value.root, 'checkout-that-will-be-deleted');
  const registration = { host: 'codex', profile: value.profile, definitions: desired, pending: { definitions: desired, remove: false, journal: { type: 'codex', expectedVersion: 'before-write', survivors: [survivor], context: recorded } } };
  const contexts = [];
  const readSnapshot = async (profile, context) => {
    contexts.push(context);
    const hooks = Object.fromEntries(Object.entries(desired).map(([event, definition]) => [event, [{ hooks: [definition] }]]));
    return { file: source, version: 'after-write', hooks, native: [{ source: 'user', ...survivor }] };
  };

  fs.mkdirSync(recorded);
  assert.equal(await reconcileCodexJournal(registration, value.profile, { project: value.project, readSnapshot }), 'written');
  assert.deepEqual(contexts, [recorded], 'the recorded directory is preferred while it exists');

  // Deleting the checkout the write ran from must not leave the registration pending forever:
  // recovery falls back to the caller's context, and removal, which carries no project,
  // falls back to the profile.
  fs.rmSync(recorded, { recursive: true });
  assert.equal(await reconcileCodexJournal(registration, value.profile, { project: value.project, readSnapshot }), 'written');
  assert.equal(await reconcileCodexJournal(registration, value.profile, { readSnapshot }), 'written');
  assert.deepEqual(contexts, [recorded, value.project, value.profile]);
});
