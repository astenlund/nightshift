'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { executable } = require('../internal/releases/native-host');
const { signatureIsTrusted } = require('../internal/releases/codex-executable');

function fixture(t) {
  const parent = path.resolve(__dirname, '../.tmp/release-executable-tests');
  fs.mkdirSync(parent, { recursive: true });
  const profile = fs.mkdtempSync(path.join(parent, 'profile-'));
  t.after(() => {
    assert.equal(path.dirname(profile), parent);
    fs.rmSync(profile, { recursive: true, force: true });
  });
  const release = path.join(profile, 'packages/standalone/releases/0.160.1-x86_64-pc-windows-msvc');
  const bin = path.join(release, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const candidate = path.join(bin, 'codex.exe');
  fs.writeFileSync(candidate, 'Resolver fixture; never execute.\n');
  fs.writeFileSync(path.join(release, 'codex-package.json'), JSON.stringify({ layoutVersion: 1, version: '0.160.1', target: 'x86_64-pc-windows-msvc', variant: 'codex', entrypoint: 'bin/codex.exe', resourcesDir: 'codex-resources', pathDir: 'codex-path' }));
  return { profile, release, bin, candidate, manifest: path.join(release, 'codex-package.json') };
}

test('profile-scoped Codex resolution accepts the verified standalone package', { skip: process.platform !== 'win32' }, t => {
  const value = fixture(t);
  const previousPath = process.env.PATH;
  process.env.PATH = value.bin;
  try {
    assert.equal(executable('codex', value.profile, { profile: value.profile, profileScoped: true, verifySignature: () => true }), value.candidate);
  } finally {
    process.env.PATH = previousPath;
  }
});

function resolve(value, options = {}) {
  return executable('codex', value.profile, { profile: value.profile, profileScoped: true, pathValue: value.bin, verifySignature: () => true, ...options });
}

test('the package exception is opt-in and never overrides a project exclusion', { skip: process.platform !== 'win32' }, t => {
  const value = fixture(t);
  for (const options of [{ profileScoped: false }, { project: value.profile }, { project: path.dirname(value.profile) }]) {
    assert.throws(() => resolve(value, options), /No trusted executable was found/);
  }
});

test('arbitrary profile placements and Claude executables remain excluded', { skip: process.platform !== 'win32' }, t => {
  const value = fixture(t);
  fs.copyFileSync(value.candidate, path.join(value.profile, 'codex.exe'));
  fs.copyFileSync(value.candidate, path.join(value.bin, 'claude.exe'));
  assert.throws(() => resolve(value, { pathValue: value.profile }), /No trusted executable was found/);
  assert.throws(() => executable('claude', value.profile, { profile: value.profile, profileScoped: true, pathValue: value.bin, verifySignature: () => true }), /No trusted executable was found/);
});

test('missing, failed and non-boolean signature evidence refuses the package', { skip: process.platform !== 'win32' }, t => {
  const value = fixture(t);
  for (const verifySignature of [() => false, () => undefined, () => 'true', () => { throw new Error('inspection unavailable'); }]) {
    assert.throws(() => resolve(value, { verifySignature }), /No trusted executable was found/);
  }
});

test('the signature report requires Windows validity and the exact publisher', () => {
  assert.equal(signatureIsTrusted({ valid: true, publisher: 'OpenAI OpCo, LLC' }), true);
  for (const report of [null, {}, { valid: 'true', publisher: 'OpenAI OpCo, LLC' }, { valid: false, publisher: 'OpenAI OpCo, LLC' }, { valid: true, publisher: 'Other publisher' }, { valid: true, publisher: 'openai opco, llc' }]) {
    assert.equal(signatureIsTrusted(report), false);
  }
});

for (const [name, mutate] of [
  ['missing metadata', value => fs.unlinkSync(value.manifest)],
  ['malformed metadata', value => fs.writeFileSync(value.manifest, '{')],
  ['unknown layout', metadata => { metadata.layoutVersion = 2; }],
  ['wrong release identity', metadata => { metadata.version = '0.160.2'; }],
  ['wrong entry point', metadata => { metadata.entrypoint = '../codex.exe'; }],
  ['wrong variant', metadata => { metadata.variant = 'other'; }],
  ['unsupported target', metadata => { metadata.target = 'x86_64-unknown-linux-gnu'; }],
]) {
  test(`${name} refuses the package before signature inspection`, { skip: process.platform !== 'win32' }, t => {
    const value = fixture(t);
    if (name === 'missing metadata' || name === 'malformed metadata') mutate(value);
    else {
      const metadata = JSON.parse(fs.readFileSync(value.manifest, 'utf8'));
      mutate(metadata);
      fs.writeFileSync(value.manifest, JSON.stringify(metadata));
    }
    let inspected = false;
    assert.throws(() => resolve(value, { verifySignature: () => { inspected = true; return true; } }), /No trusted executable was found/);
    assert.equal(inspected, false);
  });
}

test('the installer PATH junction resolves to the verified canonical package', { skip: process.platform !== 'win32' }, t => {
  const value = fixture(t);
  const alias = path.join(value.profile, 'installer-bin');
  fs.symlinkSync(value.bin, alias, 'junction');
  assert.equal(resolve(value, { pathValue: alias }), value.candidate);
});

test('a release-directory junction cannot counterfeit a managed package location', { skip: process.platform !== 'win32' }, t => {
  const value = fixture(t);
  const original = value.release;
  const relocated = path.join(value.profile, 'relocated');
  fs.renameSync(original, relocated);
  fs.symlinkSync(relocated, original, 'junction');
  assert.throws(() => resolve(value), /No trusted executable was found/);
});

test('a signature inspection cannot change the executable or package metadata', { skip: process.platform !== 'win32' }, t => {
  for (const mutate of [value => fs.appendFileSync(value.candidate, 'changed'), value => fs.appendFileSync(value.manifest, ' ')]) {
    const value = fixture(t);
    assert.throws(() => resolve(value, { verifySignature: () => { mutate(value); return true; } }), /No trusted executable was found/);
  }
});

test('the real signature reader refuses an unsigned fixture', { skip: process.platform !== 'win32' }, t => {
  const value = fixture(t);
  assert.throws(() => resolve(value, { verifySignature: undefined }), /No trusted executable was found/);
});

for (const mode of ['profile', 'profile-no-runner', 'project']) {
  test(`the complete Codex launch path preserves runner exclusions in ${mode} scope`, { skip: process.platform !== 'win32' }, () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/release-executable-boundary.cjs'), mode], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.subprocessExecuted, false);
    assert.equal(observed.projectExecutableSelected, false);
    assert.equal(observed.eligibleRunnerFound, mode !== 'profile-no-runner');
  });
}

for (const mode of ['setup-canonical', 'setup-junction', 'setup-junction-no-runner', 'setup-missing-project']) {
  test(`public ${mode} preserves the physical project exclusion`, { skip: process.platform !== 'win32' }, () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/release-executable-boundary.cjs'), mode], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.subprocessExecuted, false);
    assert.equal(observed.projectExecutableSelected, false);
    assert.equal(observed.eligibleRunnerFound, mode === 'setup-canonical' || mode === 'setup-junction');
  });
}

test('unresolvable protected roots fail before returning a PATH candidate', { skip: process.platform !== 'win32' }, t => {
  const value = fixture(t);
  assert.throws(() => resolve(value, { project: path.join(value.profile, 'missing-project') }), error => error.code === 'ENOENT');
});

for (const mode of ['snapshot-profile-junction', 'snapshot-profile-project', 'snapshot-profile-as-project']) {
  test(`${mode} keeps profile administration distinct from project exclusions`, { skip: process.platform !== 'win32' }, () => {
    const result = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/release-executable-boundary.cjs'), mode], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.subprocessExecuted, false);
    assert.equal(observed.projectExecutableSelected, false);
    assert.equal(observed.eligibleRunnerFound, mode !== 'snapshot-profile-as-project');
  });
}
