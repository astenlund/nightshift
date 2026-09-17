'use strict';

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { resolveTrustedExecutable } = require('../filesystem-primitives');
const { spawnWindowsJob } = require('../runtime/windows-job');
const { ReleaseError, parseJson, requireValue } = require('./io');

const METHODS = new Set(['initialize', 'hooks/list', 'skills/list', 'plugin/list', 'config/read', 'config/batchWrite']);
const CONTROL_SUBTYPES = new Set(['initialize', 'get_settings']);

function executable(host, protectedRoot) {
  requireValue(process.platform === 'win32' && ['codex', 'claude'].includes(host), 'unsupported-release-host', 'Retained host integration requires the supported native Windows host');
  return resolveTrustedExecutable({ root: protectedRoot, basename: `${host}.exe` });
}

async function withCodex(profile, cwd, action, options = {}) {
  const child = spawnWindowsJob(executable('codex', cwd), ['app-server', '--stdio'], { cwd, protectedRoot: cwd, env: { ...process.env, CODEX_HOME: profile } });
  const pending = new Map();
  let ordinal = 0;
  let failure = null;
  let received = 0;
  const closed = new Promise(resolve => child.once('close', resolve));
  const fail = error => {
    failure ??= error;
    for (const call of pending.values()) call.reject(error);
    pending.clear();
    child.kill();
  };
  child.on('error', error => fail(new ReleaseError('native-host-unavailable', error.message)));
  child.stdin.on('error', error => fail(new ReleaseError('native-host-unavailable', error.message)));
  child.stderr.resume();
  child.once('close', () => {
    for (const call of pending.values()) call.reject(failure ?? new ReleaseError('native-host-unavailable', 'Native Codex exited before completing its request'));
    pending.clear();
  });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    try {
      received += Buffer.byteLength(line);
      requireValue(received <= 32 * 1024 * 1024, 'native-host-response-limit', 'Native Codex response exceeds its bound');
      const message = JSON.parse(line);
      if (message.id !== undefined && message.method) {
        child.stdin.write(JSON.stringify({ id: message.id, error: { code: -32000, message: 'Host resource management does not approve interactive requests' } }) + '\n');
        return;
      }
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new ReleaseError('native-host-request-failed', `Native Codex could not complete ${call.method} (${message.error.code ?? 'unknown'})`));
      else call.resolve(message.result);
    } catch (error) { fail(error); }
  });
  const request = (method, params) => {
    requireValue(METHODS.has(method), 'invalid-host-operation', 'Unsupported retained-resource host operation');
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = ++ordinal;
      pending.set(id, { method, resolve, reject });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  };
  const timer = setTimeout(() => fail(new ReleaseError('native-host-timeout', 'Native host resource operation timed out')), options.timeoutMs ?? 30000);
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await request('initialize', { clientInfo: { name: 'nightshift_resources', version: '1' }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
    return await action(request);
  } finally {
    child.stdin.end();
    child.kill();
    await closed;
    clearTimeout(timer);
    requireValue(child.jobEmpty === true, 'native-host-termination-unverified', 'Native resource helper termination could not be established');
  }
}

// Claude resolves managed, command-line, project, local and user settings into one
// effective value. Asking the host for that value keeps deliberate disabling honoured
// at every level, including layers no file inspection of the profile can observe.
async function claudeSettings(profile, cwd, options = {}) {
  const args = ['--print', '--safe-mode', '--no-session-persistence', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--strict-mcp-config', '--no-chrome', '--tools', ''];
  const child = spawnWindowsJob(executable('claude', cwd), args, { cwd, protectedRoot: cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: profile } });
  const pending = new Map();
  let failure = null;
  let received = 0;
  const closed = new Promise(resolve => child.once('close', resolve));
  const fail = error => {
    failure ??= error;
    for (const call of pending.values()) call.reject(error);
    pending.clear();
    child.kill();
  };
  child.on('error', error => fail(new ReleaseError('native-host-unavailable', error.message)));
  child.stdin.on('error', error => fail(new ReleaseError('native-host-unavailable', error.message)));
  child.stderr.resume();
  child.once('close', () => {
    for (const call of pending.values()) call.reject(failure ?? new ReleaseError('native-host-unavailable', 'Native Claude exited before reporting its settings'));
    pending.clear();
  });
  readline.createInterface({ input: child.stdout }).on('line', line => {
    try {
      received += Buffer.byteLength(line);
      requireValue(received <= 32 * 1024 * 1024, 'native-host-response-limit', 'Native Claude response exceeds its bound');
      const message = JSON.parse(line);
      if (message.type === 'control_request' && message.request_id) {
        // Decline rather than ignore: an unanswered inbound request would stall this probe
        // until its timer fires and fail admission instead of being refused, which is the
        // behaviour the sibling Codex session already has.
        child.stdin.write(JSON.stringify({ type: 'control_response', response: { request_id: message.request_id, subtype: 'error', error: 'Host resource management does not approve interactive requests' } }) + '\n');
        return;
      }
      if (message.type !== 'control_response') return;
      const call = pending.get(message.response?.request_id);
      if (!call) return;
      pending.delete(message.response.request_id);
      if (message.response.subtype === 'error') call.reject(new ReleaseError('native-host-request-failed', `Native Claude could not complete ${call.subtype}`));
      else call.resolve(message.response.response);
    } catch (error) { fail(error); }
  });
  const request = subtype => {
    requireValue(CONTROL_SUBTYPES.has(subtype), 'invalid-host-operation', 'Unsupported retained-resource host operation');
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      pending.set(id, { subtype, resolve, reject });
      child.stdin.write(JSON.stringify({ type: 'control_request', request_id: id, request: { subtype } }) + '\n');
    });
  };
  // Hook handling runs this inspection and a plugin listing in sequence inside a 60 second
  // hook timeout, so the default leaves room for the second call and for the handler to
  // report a recovery instead of being killed mid-diagnosis. A live resolution is ~1.5s.
  const timer = setTimeout(() => fail(new ReleaseError('native-host-timeout', 'Native Claude settings inspection timed out')), options.timeoutMs ?? 20000);
  try {
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await request('initialize');
    return await request('get_settings');
  } finally {
    child.stdin.end();
    child.kill();
    await closed;
    clearTimeout(timer);
    requireValue(child.jobEmpty === true, 'native-host-termination-unverified', 'Native resource helper termination could not be established');
  }
}

function claudeEntry(profile, pluginId, cwd) {
    const result = spawnSync(executable('claude', cwd), ['plugin', 'list', '--json'], { cwd, env: { ...process.env, CLAUDE_CONFIG_DIR: profile }, windowsHide: true, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    requireValue(!result.error && result.status === 0, 'installation-unavailable', 'Native Claude plugin listing failed');
    const listing = parseJson(result.stdout, 'Claude plugin listing');
    requireValue(Array.isArray(listing), 'installation-unavailable', 'Unrecognized Claude plugin listing');
    const entries = listing.filter(entry => entry.id === pluginId);
    requireValue(entries.length === 1 && entries[0].enabled === true && typeof entries[0].installPath === 'string' && typeof entries[0].version === 'string', 'installation-unavailable', 'The selected Claude plugin is unavailable, disabled or ambiguous');
    return entries[0];
}

async function codexEntry(request, pluginId, cwd) {
  const listing = await request('plugin/list', { cwds: [cwd], marketplaceKinds: ['local'], forceRefetch: false });
  requireValue(Array.isArray(listing.marketplaces), 'installation-unavailable', 'Unrecognized Codex plugin listing');
  const entries = listing.marketplaces.flatMap(marketplace => marketplace.plugins ?? []).filter(entry => entry.id === pluginId);
  requireValue(entries.length === 1 && entries[0].installed === true && entries[0].enabled === true, 'installation-unavailable', 'The selected Codex plugin is unavailable, disabled or ambiguous');
  return entries[0];
}

async function isEnabled(host, profile, pluginId, cwd) {
  requireValue(['claude', 'codex'].includes(host), 'unsupported-release-host', 'Unknown native host');
  if (host === 'claude') claudeEntry(profile, pluginId, cwd);
  else {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await withCodex(profile, cwd, request => codexEntry(request, pluginId, cwd)); break; }
      catch (error) {
        if (attempt === 2 || !['installation-unavailable', 'native-host-request-failed'].includes(error.code)) throw error;
      }
    }
  }
  return true;
}

async function discover(host, profile, pluginId, cwd) {
  if (host === 'claude') {
    const entry = claudeEntry(profile, pluginId, cwd);
    return { root: fs.realpathSync.native(entry.installPath), version: entry.version, pluginId };
  }
  return withCodex(profile, cwd, async request => {
    await codexEntry(request, pluginId, cwd);
    const skills = await request('skills/list', { cwds: [cwd], forceReload: true });
    requireValue(Array.isArray(skills.data) && skills.data.every(entry => Array.isArray(entry.skills) && Array.isArray(entry.errors)), 'installation-unavailable', 'Unrecognized Codex skill inventory');
    const owned = skills.data.flatMap(entry => entry.skills).filter(skill => skill.pluginId === pluginId && skill.enabled === true);
    const paths = [...new Set(owned.filter(skill => ['ready', 'nightshift:ready'].includes(skill.name)).map(skill => skill.path))];
    requireValue(paths.length === 1 && typeof paths[0] === 'string', 'installation-unavailable', 'Native Codex did not identify one enabled Nightshift Ready resource');
    const root = fs.realpathSync.native(path.resolve(path.dirname(paths[0]), '../..'));
    requireValue(path.relative(root, paths[0]).split(path.sep).join('/') === 'skills/ready/SKILL.md', 'installation-unavailable', 'Native skill location does not match the Nightshift package layout');
    const manifest = parseJson(fs.readFileSync(path.join(root, '.codex-plugin/plugin.json')), 'Installed Codex plugin manifest');
    requireValue(manifest.name === 'nightshift' && typeof manifest.version === 'string', 'installation-unavailable', 'Native resource root does not identify Nightshift');
    return { root, version: manifest.version, pluginId };
  });
}

module.exports = { claudeSettings, discover, executable, isEnabled, withCodex };
