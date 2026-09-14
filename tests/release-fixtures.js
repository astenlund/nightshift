'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { payloadFiles, makeManifest, encodeManifest, MANIFEST_PATH } = require('../internal/releases/manifest');
const { ReleaseService } = require('../internal/releases/service');

const repository = path.resolve(__dirname, '..');

function fixture(t) {
  const parent = path.join(repository, '.tmp/release-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => { assert.equal(path.dirname(root), parent); fs.rmSync(root, { recursive: true, force: true }); });
  const profile = path.join(root, 'profile');
  const project = path.join(root, 'project');
  fs.mkdirSync(profile);
  fs.mkdirSync(path.join(project, '.git'), { recursive: true });
  fs.mkdirSync(path.join(project, '.nightshift'));
  for (const name of ['FEATURES', 'BUGS', 'QUICK_WINS', 'PATTERNS']) fs.writeFileSync(path.join(project, '.nightshift', name + '.md'), '# ' + name + '\r\n');
  return { root, profile, project, store: path.join(root, 'store') };
}

function packageCopy(root, version) {
  const target = path.join(root, 'source-' + version);
  fs.mkdirSync(target);
  const files = payloadFiles(repository);
  for (const file of files) {
    const destination = path.join(target, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(repository, file), destination);
  }
  for (const file of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const value = JSON.parse(fs.readFileSync(path.join(target, file), 'utf8'));
    value.version = version;
    fs.writeFileSync(path.join(target, file), JSON.stringify(value, null, 2) + '\n');
  }
  const manifest = makeManifest(files, file => fs.readFileSync(path.join(target, file)));
  fs.writeFileSync(path.join(target, MANIFEST_PATH), encodeManifest(manifest));
  return target;
}

function simulatedService(value, source, version = '1.0.0') {
  const state = { source, version, enabled: true, trusted: true, discoveries: 0 };
  const service = new ReleaseService(value.store, {
    discover: async () => { state.discoveries++; if (!state.enabled) throw Object.assign(new Error('disabled fixture plugin'), { code: 'installation-unavailable' }); return { root: state.source, version: state.version }; },
    inspectHooks: async () => ({ usable: state.trusted, entries: [] }),
    applyHooks: async () => {},
    nativeOwner: () => ({ found: true, pid: process.pid, created: 'fixture-process', name: 'codex.exe' }),
    ownerAlive: owner => owner?.pid === process.pid,
    runContained: async (executable, args, options) => {
      options.onPrepared?.({ runnerPid: process.pid });
      options.onStarted?.({ pid: process.pid, runnerPid: process.pid, contained: true });
      const result = spawnSync(executable, args, { cwd: options.cwd, env: options.env, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
      const exit = { code: result.status, signal: result.signal, stdout: result.stdout, stderr: result.stderr, descendantsReclaimed: !result.error, error: result.error?.message };
      options.onFinished?.(exit);
      if (result.error) throw result.error;
      return exit;
    },
  });
  return { service, state };
}

async function activate(service, registration, project, session) {
  await service.hook(registration, { cwd: project, session_id: session, hook_event_name: 'SessionStart', source: 'startup' });
}

module.exports = { activate, fixture, packageCopy, repository, simulatedService };
