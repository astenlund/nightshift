'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { spawnSync } = require('node:child_process');
const { resolveTrustedExecutable } = require('../filesystem-primitives');
const { claudeSettings, withCodex } = require('./native-host');
const { digest, parseJson, readBytes, requireValue, writeNew } = require('./io');

const EVENTS = Object.freeze({ SessionStart: 'sessionStart', PreCompact: 'preCompact', Stop: 'stop' });
const EVENT_KEYS = Object.freeze({ SessionStart: 'session_start', PreCompact: 'pre_compact', Stop: 'stop' });
const DISABLED_MESSAGE = 'Nightshift hooks are disabled; enable them explicitly before using Nightshift';

function quotedCommandPath(value) {
  requireValue(!['"', '$', '`', '%', '!', '\r', '\n'].some(character => value.includes(character)), 'unsupported-host-command-path', 'Choose a retained store path without shell expansion characters');
  return '"' + value.split(path.sep).join('/') + '"';
}

function definitions(host, bootstrap, key) {
  return Object.fromEntries(Object.keys(EVENTS).map(event => [event, host === 'claude'
    ? { type: 'command', command: 'node', args: [bootstrap, key, '--hook'], timeout: 60 }
    : { type: 'command', command: `node ${quotedCommandPath(bootstrap)} ${key} --hook`, timeout: 60 }]));
}

function groups(value, event) {
  const result = value[event] ?? [];
  requireValue(Array.isArray(result) && result.every(group => group && Array.isArray(group.hooks)), 'unsupported-hook-configuration', `Unsupported ${event} hook configuration`);
  return result;
}

function flatten(hooks, event) {
  return groups(hooks, event).flatMap((group, groupIndex) => group.hooks.map((definition, index) => ({ definition, groupIndex, index })));
}

function owned(definition, expected, previous) {
  return isDeepStrictEqual(definition, expected) || (Array.isArray(previous) ? previous.some(item => isDeepStrictEqual(definition, item)) : previous && isDeepStrictEqual(definition, previous));
}

function planHooks(currentHooks, desired, previous, remove, sourcePath, nativeHooks = []) {
  const hooks = structuredClone(currentHooks ?? {});
  const states = structuredClone(hooks.state ?? {});
  const survivors = [];
  for (const event of Object.keys(EVENTS)) {
    const before = flatten(hooks, event);
    const expected = desired[event];
    const oldExpected = Array.isArray(previous) ? previous.map(value => value?.[event]).filter(Boolean) : previous?.[event];
    const matches = before.filter(item => owned(item.definition, expected, oldExpected));
    requireValue(matches.length <= 1, 'hook-configuration-conflict', `Multiple owned ${event} hook entries require reconciliation`);
    const marker = expected.args?.[1] ?? expected.command.split(' ').at(-2);
    requireValue(!before.some(item => JSON.stringify(item.definition).includes(marker) && !owned(item.definition, expected, oldExpected)), 'hook-configuration-conflict', `An owned ${event} hook was edited`);
    if (remove && matches.length === 0) continue;
    const maps = [];
    const afterGroups = [];
    for (const [groupIndex, group] of groups(hooks, event).entries()) {
      const after = [];
      for (const [index, definition] of group.hooks.entries()) {
        if (owned(definition, expected, oldExpected)) {
          if (sourcePath) delete states[`${sourcePath}:${EVENT_KEYS[event]}:${groupIndex}:${index}`];
          if (!remove && isDeepStrictEqual(definition, expected)) after.push(definition);
          continue;
        }
        maps.push({ oldGroup: groupIndex, oldIndex: index, newGroup: afterGroups.length, newIndex: after.length });
        after.push(definition);
      }
      if (after.length > 0 || group.hooks.length === 0) afterGroups.push({ ...group, hooks: after });
    }
    if (!remove && !matches.some(item => isDeepStrictEqual(item.definition, expected))) afterGroups.push({ hooks: [expected] });
    hooks[event] = afterGroups;
    if (sourcePath) {
      const originalStates = currentHooks?.state ?? {};
      for (const item of before) delete states[`${sourcePath}:${EVENT_KEYS[event]}:${item.groupIndex}:${item.index}`];
      for (const mapping of maps) {
        const oldKey = `${sourcePath}:${EVENT_KEYS[event]}:${mapping.oldGroup}:${mapping.oldIndex}`;
        const key = `${sourcePath}:${EVENT_KEYS[event]}:${mapping.newGroup}:${mapping.newIndex}`;
        const native = nativeHooks.find(item => item.key === oldKey && item.source === 'user');
        requireValue(native, 'hook-trust-unverified', 'Native hook listing does not cover every surviving affected hook');
        if (Object.hasOwn(originalStates, oldKey)) states[key] = structuredClone(originalStates[oldKey]);
        survivors.push({ key, currentHash: native.currentHash, trustStatus: native.trustStatus, enabled: native.enabled });
      }
      const retained = !remove && matches.find(item => isDeepStrictEqual(item.definition, expected));
      if (retained) {
        const oldKey = `${sourcePath}:${EVENT_KEYS[event]}:${retained.groupIndex}:${retained.index}`;
        const newEntry = flatten(hooks, event).find(item => isDeepStrictEqual(item.definition, expected));
        const key = `${sourcePath}:${EVENT_KEYS[event]}:${newEntry.groupIndex}:${newEntry.index}`;
        if (Object.hasOwn(originalStates, oldKey)) states[key] = structuredClone(originalStates[oldKey]);
      } else if (!remove) {
        const item = flatten(hooks, event).find(entry => isDeepStrictEqual(entry.definition, expected));
        delete states[`${sourcePath}:${EVENT_KEYS[event]}:${item.groupIndex}:${item.index}`];
      }
    }
  }
  if (sourcePath && (!remove || Object.hasOwn(currentHooks ?? {}, 'state') || Object.keys(states).length > 0)) hooks.state = states;
  return { hooks, survivors };
}

async function codexSnapshot(profile, cwd) {
  return withCodex(profile, cwd, async request => {
    const configuration = await request('config/read', { includeLayers: true, cwd: null });
    const file = path.join(profile, 'config.toml');
    const layer = configuration.layers?.find(layer => layer.name?.type === 'user' && !layer.name.profile && path.relative(file, layer.name.file) === '');
    requireValue(layer && !layer.disabledReason && typeof layer.version === 'string', 'host-configuration-unavailable', 'Native Codex did not expose the selected writable user config layer');
    const listing = await request('hooks/list', { cwds: [cwd] });
    requireValue(Array.isArray(listing.data) && listing.data.every(entry => Array.isArray(entry.hooks) && entry.errors?.length === 0), 'hook-trust-unverified', 'Native Codex hook listing is incomplete');
    return { file: layer.name.file, version: layer.version, hooks: layer.config.hooks ?? {}, native: listing.data.flatMap(entry => entry.hooks).filter(hook => hook.source === 'user' && path.relative(layer.name.file, hook.sourcePath) === '') };
  });
}

function claudeSnapshot(profile) {
  const file = path.join(profile, 'settings.json');
  const bytes = fs.existsSync(file) ? readBytes(profile, 'settings.json', 4 * 1024 * 1024) : null;
  const value = bytes ? parseJson(bytes, 'Claude settings') : {};
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'host-configuration-unavailable', 'Claude settings must be a JSON object');
  return { file, bytes, value, hooks: value.hooks ?? {} };
}

// The directory host settings resolve against. Every inspection resolves it once, so two
// admission paths cannot consult different roots for the same session.
function inspectionContext(cwd, options = {}) {
  return options.project ?? cwd;
}

// Claude applies managed, command-line, project local, shared project and user settings
// in that order. A project opt-out therefore overrides the user profile, and a project
// can equally re-enable hooks the user profile disabled, so the layers cannot simply be
// combined. Only the host resolves that precedence, and it alone can see the managed and
// command-line layers. An inspection that cannot run is a distinct recoverable condition,
// never an enabled result.
async function claudeHooksDisabled(profile, context, options = {}) {
  const readSettings = options.readSettings ?? claudeSettings;
  // The separator is built rather than written literally: a raw control byte in source
  // makes the whole module read as binary to content search and byte sweeps.
  const key = profile + String.fromCharCode(0) + context;
  if (options.cache?.has(key)) return options.cache.get(key);
  const settings = await readSettings(profile, context);
  requireValue(settings?.effective && typeof settings.effective === 'object' && !Array.isArray(settings.effective), 'host-configuration-unavailable', 'Native Claude did not expose its effective settings');
  const value = settings.effective.disableAllHooks;
  // An absent key is the host reporting that nothing set it. A value the host does report
  // but that is not boolean is an inspection that did not run, never an enabled result.
  requireValue(value === undefined || typeof value === 'boolean', 'host-configuration-unavailable', 'Native Claude reported an unrecognized disableAllHooks value');
  const disabled = value === true;
  options.cache?.set(key, disabled);
  return disabled;
}

// One classification of a hook inspection. Admission and guidance both consume this
// verdict rather than re-deriving one from the raw fields, so a state cannot be split at
// one call site and merged at another.
function classifyHooks(nativeState) {
  if (nativeState.disabled === true) {
    return { state: 'disabled', code: 'nightshift-disabled', message: DISABLED_MESSAGE, guidance: 'Nightshift hooks are disabled for this profile or project; enable them explicitly, then open or reopen a native session.' };
  }
  if (nativeState.configured === false) {
    return { state: 'unconfigured', code: 'nightshift-disabled', message: 'Nightshift hooks were removed or changed; reconcile them explicitly before using Nightshift', guidance: 'Reconcile the registered hook definitions, then open or reopen a native session.' };
  }
  if (!nativeState.usable) {
    return { state: 'untrusted', code: 'hook-activation-required', message: 'Nightshift hooks are not trusted on this host; restore native trust and reopen the session', guidance: 'Review and trust the installed hook definitions, then open or reopen a native session.' };
  }
  return { state: 'usable', code: null, message: null, guidance: 'Use a native session that has observed this generation; open or reopen if yours has not.' };
}

async function inspectHooks(registration, cwd, options = {}) {
  const context = inspectionContext(cwd, options);
  if (registration.host === 'codex') {
    const snapshot = await codexSnapshot(registration.profile, context);
    const entries = Object.entries(registration.definitions).map(([event, definition]) => snapshot.native.filter(item => item.eventName === EVENTS[event] && item.command === definition.command));
    return { configured: entries.every(items => items.length === 1), disabled: entries.some(items => items.some(item => item.enabled === false)), usable: entries.every(items => items.length === 1 && items[0].enabled && items[0].trustStatus === 'trusted'), entries: entries.flat().map(item => ({ key: item.key, currentHash: item.currentHash, trustStatus: item.trustStatus, enabled: item.enabled })) };
  }
  const snapshot = claudeSnapshot(registration.profile);
  const configured = Object.entries(registration.definitions).every(([event, definition]) => flatten(snapshot.hooks, event).filter(item => isDeepStrictEqual(item.definition, definition)).length === 1);
  const disabled = await claudeHooksDisabled(registration.profile, context, options);
  return { configured, disabled, usable: !disabled && configured, entries: [] };
}

async function reconcileCodexJournal(registration, cwd, options = {}) {
  const pending = registration.pending;
  requireValue(pending?.journal?.type === 'codex', 'invalid-settings-journal', 'No Codex configuration journal is available');
  // Survivors were listed against the writing operation's directory, so the comparison
  // prefers that directory over the recovering caller's, which can differ: recovery runs
  // from the next skill invocation's project, or from none at all during removal. When
  // that directory no longer exists, or the journal predates recording it, the caller's
  // context is used instead: survivors are keyed by the user configuration file, so the
  // comparison below still decides, and removal never waits on a deleted checkout.
  const recorded = pending.journal.context;
  const readSnapshot = options.readSnapshot ?? codexSnapshot;
  const snapshot = await readSnapshot(registration.profile, recorded && fs.existsSync(recorded) ? recorded : inspectionContext(cwd, options));
  if (snapshot.version === pending.journal.expectedVersion) return 'not-written';
  const matches = Object.entries(pending.definitions).every(([event, definition]) => {
    const count = flatten(snapshot.hooks, event).filter(item => isDeepStrictEqual(item.definition, definition)).length;
    return pending.remove ? count === 0 : count === 1;
  });
  requireValue(matches, 'configuration-conflict', 'Interrupted Codex configuration does not match its prepared result');
  for (const survivor of pending.journal.survivors) {
    const current = snapshot.native.find(item => item.key === survivor.key);
    requireValue(current && current.currentHash === survivor.currentHash && current.trustStatus === survivor.trustStatus && current.enabled === survivor.enabled, 'configuration-conflict', 'Interrupted configuration cannot establish surviving hook identity and trust');
  }
  return 'written';
}

async function applyHooks(registration, cwd, remove = false, beforeWrite = () => {}, options = {}) {
  const context = inspectionContext(cwd, options);
  if (registration.host === 'codex') {
    const snapshot = await codexSnapshot(registration.profile, context);
    const plan = planHooks(snapshot.hooks, registration.definitions, registration.previousDefinitions, remove, snapshot.file, snapshot.native);
    if (registration.automatic) {
      const commands = [registration.definitions, ...(registration.previousDefinitions ?? [])].flatMap(definitions => Object.values(definitions).map(definition => definition.command));
      requireValue(!snapshot.native.some(item => commands.includes(item.command) && item.enabled === false), 'nightshift-disabled', DISABLED_MESSAGE);
    }
    if (isDeepStrictEqual(snapshot.hooks, plan.hooks)) return;
    beforeWrite({ type: 'codex', expectedVersion: snapshot.version, survivors: plan.survivors, context });
    await withCodex(registration.profile, context, request => request('config/batchWrite', { filePath: snapshot.file, expectedVersion: snapshot.version, reloadUserConfig: true, edits: [{ keyPath: 'hooks', value: plan.hooks, mergeStrategy: 'replace' }] }));
    // The survivor comparison is only meaningful against the same listing scope.
    const after = await codexSnapshot(registration.profile, context);
    for (const survivor of plan.survivors) {
      const current = after.native.find(item => item.key === survivor.key);
      requireValue(current && current.currentHash === survivor.currentHash && current.trustStatus === survivor.trustStatus && current.enabled === survivor.enabled, 'hook-trust-conflict', 'A surviving user hook changed identity or trust during configuration');
    }
    return;
  }
  const snapshot = claudeSnapshot(registration.profile);
  if (registration.automatic) requireValue(await claudeHooksDisabled(registration.profile, context, options) === false, 'nightshift-disabled', DISABLED_MESSAGE);
  const plan = planHooks(snapshot.hooks, registration.definitions, registration.previousDefinitions, remove, null);
  if (isDeepStrictEqual(snapshot.hooks, plan.hooks)) return;
  const bytes = Buffer.from(JSON.stringify({ ...snapshot.value, hooks: plan.hooks }, null, 2) + '\r\n');
  const nonce = randomUUID();
  const prefix = `.nightshift-${nonce}`;
  const next = path.join(registration.profile, prefix + '.next');
  const backup = path.join(registration.profile, prefix + '.backup');
  writeNew(next, bytes);
  if (snapshot.bytes) writeNew(backup, snapshot.bytes);
  const journal = { type: 'claude', profile: registration.profile, target: snapshot.file, next, backup: snapshot.bytes ? backup : null, expectedHash: snapshot.bytes ? digest(snapshot.bytes) : null, nextHash: digest(bytes) };
  beforeWrite(journal);
  recoverClaude(journal, cwd);
}

function recoverClaude(journal, cwd) {
  requireValue(journal.type === 'claude' && path.dirname(journal.target) === journal.profile && path.basename(journal.target) === 'settings.json', 'invalid-settings-journal', 'Invalid Claude settings recovery journal');
  for (const file of [journal.next, journal.backup].filter(Boolean)) requireValue(path.dirname(file) === journal.profile && /^\.nightshift-[a-f0-9-]{36}\.(?:next|backup)$/.test(path.basename(file)), 'invalid-settings-journal', 'Recovery file escaped its profile');
  const request = path.join(journal.profile, `.nightshift-${randomUUID()}.request.json`);
  writeNew(request, JSON.stringify(journal) + '\r\n');
  try {
    const pwsh = resolveTrustedExecutable({ root: cwd, basename: 'pwsh.exe' });
    const result = spawnSync(pwsh, ['-NoProfile', '-File', path.join(__dirname, 'settings-write.ps1'), '-RequestFile', request], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
    requireValue(!result.error && result.status === 0, 'configuration-conflict', 'Claude settings could not be safely written; retained recovery files preserve the original and planned bytes');
  } finally { fs.unlinkSync(request); }
}

function discardJournal(journal) {
  if (journal?.type !== 'claude') return;
  for (const [file, expected] of [[journal.next, journal.nextHash], [journal.backup, journal.expectedHash]]) {
    if (!file || !fs.existsSync(file)) continue;
    requireValue(path.dirname(file) === journal.profile && /^\.nightshift-[a-f0-9-]{36}\.(?:next|backup)$/.test(path.basename(file)), 'invalid-settings-journal', 'Recovery cleanup escaped its profile');
    requireValue(digest(readBytes(journal.profile, path.basename(file), 4 * 1024 * 1024)) === expected, 'configuration-conflict', 'Recovery bytes changed; preserve them for inspection');
    fs.unlinkSync(file);
  }
}

module.exports = { EVENTS, applyHooks, classifyHooks, claudeHooksDisabled, claudeSnapshot, codexSnapshot, definitions, discardJournal, flatten, inspectHooks, inspectionContext, planHooks, reconcileCodexJournal, recoverClaude };
