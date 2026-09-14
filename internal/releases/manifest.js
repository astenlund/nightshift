'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { digest, parseJson, readBytes, relativePath, requireValue } = require('./io');

const MANIFEST_PATH = 'internal/releases/payload.json';
const PAYLOAD_ROOTS = Object.freeze(['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'LICENSE', 'hooks', 'internal', 'skills']);
const MAX_FILES = 10000;
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024;

function isPayload(file) {
  return file !== MANIFEST_PATH && !/\.test\.[cm]?js$/.test(file) && PAYLOAD_ROOTS.some(root => file === root || file.startsWith(root + '/'));
}

function walk(root, relative = '') {
  const target = path.join(root, relative);
  const stat = fs.lstatSync(target);
  requireValue(!stat.isSymbolicLink(), 'unsafe-release-path', `Linked release entry: ${relative}`);
  if (stat.isFile()) {
    requireValue(stat.nlink === 1, 'unsafe-release-path', `Multiply linked release entry: ${relative}`);
    return [relative.split(path.sep).join('/')];
  }
  requireValue(stat.isDirectory(), 'unsafe-release-path', `Unsupported release entry: ${relative}`);
  return fs.readdirSync(target).sort().flatMap(name => walk(root, relative ? `${relative}/${name}` : name));
}

function payloadFiles(root) { return PAYLOAD_ROOTS.flatMap(relative => walk(root, relative)).filter(isPayload).sort(); }

function makeManifest(files, read) {
  const paths = [...files].filter(isPayload).sort();
  const manifests = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].map(file => parseJson(read(file), file));
  requireValue(manifests.every(manifest => manifest.name === 'nightshift' && manifest.version === manifests[0].version), 'release-version-mismatch', 'Both plugin manifests must identify the same Nightshift release');
  const result = { schema: 1, name: 'nightshift', version: manifests[0].version, files: paths.map(file => { const bytes = read(file); return { path: file, bytes: bytes.length, sha256: digest(bytes) }; }) };
  validateManifest(result);
  return result;
}

function validateManifest(manifest) {
  requireValue(manifest?.schema === 1 && manifest.name === 'nightshift' && /^\d+\.\d+\.\d+$/.test(manifest.version) && Array.isArray(manifest.files), 'unsupported-release-manifest', 'Unsupported or incomplete Nightshift release manifest');
  requireValue(Object.keys(manifest).sort().join(',') === 'files,name,schema,version', 'unsupported-release-manifest', 'Unknown release manifest fields');
  requireValue(manifest.files.length > 0 && manifest.files.length <= MAX_FILES, 'invalid-release-manifest', 'Release manifest file count is outside its bounds');
  const names = new Set();
  let total = 0;
  for (const file of manifest.files) {
    requireValue(file && Object.keys(file).sort().join(',') === 'bytes,path,sha256', 'invalid-release-manifest', 'Invalid release file entry');
    relativePath(file.path);
    requireValue(isPayload(file.path) && !names.has(file.path.toUpperCase()), 'invalid-release-manifest', `Unexpected or duplicate payload path: ${file.path}`);
    names.add(file.path.toUpperCase());
    requireValue(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 16 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(file.sha256), 'invalid-release-manifest', `Invalid size or digest: ${file.path}`);
    total += file.bytes;
  }
  requireValue(total <= MAX_PAYLOAD_BYTES, 'invalid-release-manifest', 'Release payload exceeds its size bound');
  for (const required of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'LICENSE', 'internal/releases/launcher.js', 'internal/runtime/cli.js', 'internal/runtime/hook.js', 'skills/ready/ready.js', 'skills/init-backlog/init-backlog.js', 'skills/init-backlog/unwrap.js']) {
    requireValue(names.has(required.toUpperCase()), 'invalid-release-manifest', `Missing required runtime resource: ${required}`);
  }
  for (const skill of ['exploring', 'handover', 'init-backlog', 'ready', 'revise-code', 'revise-docs', 'revise-lore', 'revise-spec']) requireValue(names.has(`skills/${skill}/SKILL.md`.toUpperCase()), 'invalid-release-manifest', `Missing public skill: ${skill}`);
  return manifest;
}

function encodeManifest(manifest) { return Buffer.from(JSON.stringify(manifest, null, 2) + '\n'); }

function loadManifest(root) {
  const bytes = readBytes(root, MANIFEST_PATH, 4 * 1024 * 1024);
  const manifest = validateManifest(parseJson(bytes, MANIFEST_PATH));
  return { manifest, bytes, identity: `${manifest.version}-${digest(bytes)}`, digest: digest(bytes) };
}

function verifyBundle(root, expectedIdentity) {
  const loaded = loadManifest(root);
  requireValue(!expectedIdentity || loaded.identity === expectedIdentity, 'release-identity-mismatch', 'Retained release identity changed');
  const actual = walk(root).sort();
  const expected = [...loaded.manifest.files.map(file => file.path), MANIFEST_PATH].sort();
  requireValue(JSON.stringify(actual) === JSON.stringify(expected), 'release-inventory-mismatch', 'Retained bundle does not contain exactly its declared payload');
  for (const file of loaded.manifest.files) {
    const bytes = readBytes(root, file.path);
    requireValue(bytes.length === file.bytes && digest(bytes) === file.sha256, 'release-content-mismatch', `Retained resource failed verification: ${file.path}`);
  }
  const manifests = ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json'].map(file => parseJson(readBytes(root, file), file));
  requireValue(manifests.every(manifest => manifest.name === loaded.manifest.name && manifest.version === loaded.manifest.version), 'release-version-mismatch', 'Payload plugin manifests do not match the release manifest');
  return loaded;
}

module.exports = { MANIFEST_PATH, MAX_FILES, PAYLOAD_ROOTS, encodeManifest, isPayload, loadManifest, makeManifest, payloadFiles, validateManifest, verifyBundle, walk };
