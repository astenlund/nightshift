'use strict';

const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { pathIsContained, resolveTrustedExecutable, stableMetadata, stableOpenFile } = require('../filesystem-primitives');

const OPENAI_PUBLISHER = 'OpenAI OpCo, LLC';

function signatureIsTrusted(record) {
  return record?.valid === true && record.publisher === OPENAI_PUBLISHER;
}

function verifySignature(candidate, profile, project) {
  const pwsh = resolveTrustedExecutable({ root: profile, protectedRoots: [project], basename: 'pwsh.exe' });
  const result = spawnSync(pwsh, ['-NoProfile', '-File', path.join(__dirname, 'executable-signature.ps1'), '-Executable', candidate], { windowsHide: true, timeout: 30000, maxBuffer: 8192 });
  if (result.error || result.status !== 0) return false;
  return signatureIsTrusted(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.stdout)));
}

function trustedStandaloneCandidate(candidate, profile, options = {}) {
  const canonicalProfile = fs.realpathSync.native(profile);
  if (options.project) {
    const project = fs.realpathSync.native(options.project);
    if (path.relative(project, candidate) === '' || pathIsContained(project, candidate)) return false;
  }
  const packages = path.join(canonicalProfile, 'packages');
  const standalone = path.join(packages, 'standalone');
  const releases = path.join(standalone, 'releases');
  for (const directory of [packages, standalone, releases]) {
    if (!stableMetadata(directory).metadata.isDirectory()) return false;
  }
  const relative = path.relative(releases, candidate).split(path.sep);
  if (relative.length !== 3 || relative[1] !== 'bin' || relative[2] !== 'codex.exe') return false;
  const release = path.join(releases, relative[0]);
  if (!stableMetadata(release).metadata.isDirectory() || !stableMetadata(path.join(release, 'bin')).metadata.isDirectory()) return false;
  const manifest = path.join(release, 'codex-package.json');
  const before = stableOpenFile(canonicalProfile, manifest, { maxBytes: 16384 });
  const metadata = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(before.bytes));
  if (metadata?.layoutVersion !== 1 || metadata.variant !== 'codex' || metadata.entrypoint !== 'bin/codex.exe' || metadata.resourcesDir !== 'codex-resources' || metadata.pathDir !== 'codex-path') return false;
  if (typeof metadata.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(metadata.version) || typeof metadata.target !== 'string' || !/^(?:x86_64|aarch64)-pc-windows-msvc$/.test(metadata.target)) return false;
  if (relative[0] !== `${metadata.version}-${metadata.target}`) return false;
  const verified = (options.verifySignature ?? verifySignature)(candidate, canonicalProfile, options.project);
  const after = stableOpenFile(canonicalProfile, manifest, { maxBytes: 16384 });
  return verified === true && before.identity === after.identity && before.rawSha256 === after.rawSha256;
}

module.exports = { signatureIsTrusted, trustedStandaloneCandidate, verifySignature };
