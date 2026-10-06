'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const scriptName = path.basename(process.argv[1]);

async function main() {
  assert.equal(process.platform, 'win32');
  const repository = path.resolve(__dirname, '../..');
  const parent = fs.realpathSync.native(path.join(repository, '.tmp'));
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(parent, 'launch-boundary-')));
  const profile = path.join(root, 'profile');
  const project = path.join(root, 'project');
  const trustedTools = path.join(root, 'trusted-tools');
  const release = path.join(profile, 'packages/standalone/releases/0.160.1-x86_64-pc-windows-msvc');
  const bin = path.join(release, 'bin');
  const mode = process.argv[2];
  const missingRunner = mode === 'profile-no-runner' || mode === 'setup-junction-no-runner';
  for (const directory of [bin, project, trustedTools]) fs.mkdirSync(directory, { recursive: true });
  const alias = path.join(root, 'project-junction');
  fs.symlinkSync(project, alias, 'junction');
  const profileAlias = path.join(root, 'profile-junction');
  fs.symlinkSync(profile, profileAlias, 'junction');
  const projectPowerShell = path.join(project, 'pwsh.exe');
  const trustedPowerShell = path.join(trustedTools, 'pwsh.exe');
  const files = [path.join(bin, 'codex.exe'), projectPowerShell, ...(missingRunner ? [] : [trustedPowerShell])];
  for (const file of files) fs.writeFileSync(file, 'Harmless resolver marker; never execute.\n');
  fs.writeFileSync(path.join(release, 'codex-package.json'), JSON.stringify({ layoutVersion: 1, version: '0.160.1', target: 'x86_64-pc-windows-msvc', variant: 'codex', entrypoint: 'bin/codex.exe', resourcesDir: 'codex-resources', pathDir: 'codex-path' }));
  const originalPath = process.env.PATH;
  const originalSpawn = cp.spawn;
  const originalSpawnSync = cp.spawnSync;
  const signatureCalls = [];
  let dispatch;
  const intercepted = new Error('Launch intercepted before execution');
  try {
    process.env.PATH = (mode === 'snapshot-profile-junction' ? [bin, trustedTools] : [alias, bin, trustedTools]).join(path.delimiter);
    cp.spawnSync = (executable, args) => {
      assert.equal(args[0], '-NoProfile');
      assert.equal(path.basename(args[2]), 'executable-signature.ps1');
      signatureCalls.push(executable);
      return { status: 0, stdout: Buffer.from(JSON.stringify({ valid: true, publisher: 'OpenAI OpCo, LLC' })) };
    };
    cp.spawn = (executable, args, options) => {
      dispatch = { executable, args, cwd: options.cwd };
      throw intercepted;
    };
    if (mode.startsWith('setup-')) {
      const { route } = require(path.join(repository, 'internal/releases/launcher'));
      const requestedProject = mode === 'setup-canonical' ? project : mode === 'setup-missing-project' ? path.join(root, 'missing-project') : alias;
      const operation = route({ action: 'setup', host: 'codex', profile, project: requestedProject, store: path.join(root, 'store') });
      if (mode === 'setup-missing-project') {
        await assert.rejects(operation, error => error.code === 'ENOENT');
        assert.equal(fs.existsSync(path.join(root, 'store')), false);
        assert.equal(dispatch, undefined);
        assert.deepEqual(signatureCalls, []);
      } else if (missingRunner) {
        await assert.rejects(operation, /No trusted executable was found/);
        assert.equal(dispatch, undefined);
        assert.deepEqual(signatureCalls, []);
      } else {
        await assert.rejects(operation, error => error === intercepted);
        assert.equal(dispatch.executable, trustedPowerShell);
        assert.equal(dispatch.cwd, profile);
        assert.deepEqual(signatureCalls, [trustedPowerShell]);
      }
    } else if (mode.startsWith('snapshot-')) {
      const { codexSnapshot } = require(path.join(repository, 'internal/releases/host-config'));
      const cwd = mode === 'snapshot-profile-junction' ? profileAlias : profile;
      const options = mode === 'snapshot-profile-project' ? { project } : mode === 'snapshot-profile-as-project' ? { project: profile } : {};
      if (mode === 'snapshot-profile-as-project') {
        await assert.rejects(codexSnapshot(profile, cwd, options), /No trusted executable was found/);
        assert.equal(dispatch, undefined);
        assert.deepEqual(signatureCalls, []);
      } else {
        await assert.rejects(codexSnapshot(profile, cwd, options), error => error === intercepted);
        assert.equal(dispatch.executable, trustedPowerShell);
        assert.equal(dispatch.cwd, cwd);
        assert.deepEqual(signatureCalls, [trustedPowerShell]);
      }
    } else {
      const { withCodex } = require(path.join(repository, 'internal/releases/native-host'));
      const options = { project, profileScoped: mode !== 'project', ...(missingRunner ? { verifySignature: () => true } : {}) };
      const cwd = mode === 'project' ? project : profile;
      if (missingRunner) {
        await assert.rejects(withCodex(profile, cwd, async () => {}, options), /No trusted executable was found/);
        assert.equal(dispatch, undefined);
      } else {
        await assert.rejects(withCodex(profile, cwd, async () => {}, options), error => error === intercepted);
        assert.equal(dispatch.executable, trustedPowerShell);
        assert.equal(path.basename(dispatch.args[2]), 'windows-job-runner.ps1');
        assert.equal(dispatch.cwd, cwd);
      }
      if (mode === 'profile') assert.deepEqual(signatureCalls, [trustedPowerShell]);
      else assert.deepEqual(signatureCalls, []);
    }
    console.log(JSON.stringify({ signatureSuccessSimulated: true, projectExecutableSelected: dispatch?.executable === projectPowerShell, eligibleRunnerFound: !!dispatch, subprocessExecuted: false }));
  } finally {
    cp.spawn = originalSpawn;
    cp.spawnSync = originalSpawnSync;
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    assert.equal(path.dirname(root), parent);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(scriptName + ': ' + error.stack); process.exitCode = 1; });
