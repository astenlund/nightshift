'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { MANIFEST_PATH, loadManifest, payloadFiles, verifyBundle, walk } = require('./manifest');
const { digest, directory, parseJson, processAlive, readBytes, requireValue, writeNew } = require('./io');

function bundleRecord(registry, key) {
  const record = registry.get('bundle', key);
  requireValue(record && record.key === key && path.relative(registry.root, record.root) === path.join('bundles', key), 'release-unavailable', 'Retained bundle record is unavailable or unsafe');
  directory(registry.root, `bundles/${key}`);
  return record;
}

function verifiedRecord(registry, key) {
  const record = bundleRecord(registry, key);
  verifyBundle(record.root, record.identity);
  return record;
}

function reconcileOrphans(registry) {
  const base = path.join(registry.root, 'bundles');
  if (!fs.existsSync(base)) return;
  directory(registry.root, 'bundles');
  for (const key of fs.readdirSync(base)) {
    if (!/^[a-f0-9-]{36}$/.test(key) || registry.get('bundle', key)) continue;
    try {
      const root = directory(registry.root, `bundles/${key}`);
      const loaded = verifyBundle(root);
      registry.put('bundle', key, { schema: 1, key, identity: loaded.identity, version: loaded.manifest.version, manifestDigest: loaded.digest, root, createdAt: new Date().toISOString(), recoveredPublication: true });
    } catch { /* Unknown or incomplete directories are retained, never selected. */ }
  }
}

// Callers hold the registry transaction through verification and publication, so
// collection cannot remove a reusable bundle between lookup and binding creation.
function capture(registry, source, options = {}) {
  const root = fs.realpathSync.native(source);
  const loaded = loadManifest(root);
  requireValue(!options.identity || options.identity === loaded.identity, 'release-identity-mismatch', 'Available source is not the release bound to this work');
  requireValue(!options.version || options.version === loaded.manifest.version, 'release-version-mismatch', 'Native installation and payload manifest versions differ');
  reconcileOrphans(registry);
  for (const candidate of registry.list('bundle').map(entry => entry.value).filter(record => record.identity === loaded.identity)) {
    try { return verifiedRecord(registry, candidate.key); }
    catch { /* A damaged copy is never selected; acquire a separate complete copy. */ }
  }
  requireValue(JSON.stringify(payloadFiles(root)) === JSON.stringify(loaded.manifest.files.map(file => file.path).sort()), 'release-inventory-mismatch', 'Installed payload inventory differs from its shipped manifest');
  const key = randomUUID();
  const staging = directory(registry.root, `staging/${key}`, true);
  writeNew(path.join(staging, 'owner.json'), JSON.stringify({ schema: 1, pid: process.pid, key }) + '\n');
  const target = directory(registry.root, `staging/${key}/payload`, true);
  for (const file of loaded.manifest.files) {
    const bytes = readBytes(root, file.path);
    requireValue(bytes.length === file.bytes && digest(bytes) === file.sha256, 'release-content-mismatch', `Installed resource changed or is incomplete: ${file.path}`);
    const parent = path.posix.dirname(file.path);
    if (parent !== '.') directory(target, parent, true);
    writeNew(path.join(target, file.path), bytes);
    options.afterCopy?.(file.path, root, target);
  }
  directory(target, path.posix.dirname(MANIFEST_PATH), true);
  writeNew(path.join(target, MANIFEST_PATH), loaded.bytes);
  verifyBundle(target, loaded.identity);
  directory(registry.root, 'bundles', true);
  const published = path.join(registry.root, 'bundles', key);
  fs.renameSync(target, published);
  const record = { schema: 1, key, identity: loaded.identity, version: loaded.manifest.version, manifestDigest: loaded.digest, root: published, createdAt: new Date().toISOString() };
  registry.put('bundle', key, record);
  fs.unlinkSync(path.join(staging, 'owner.json'));
  fs.rmdirSync(staging);
  return record;
}

function availableIdentity(registry, identity) {
  for (const candidate of registry.list('bundle').map(entry => entry.value).filter(record => record.identity === identity)) {
    try { return verifiedRecord(registry, candidate.key); }
    catch { /* Keep damaged evidence in place and try another complete copy. */ }
  }
  return null;
}

function removeBundle(registry, key) {
  const record = registry.get('bundle', key);
  requireValue(record && path.relative(registry.root, record.root) === path.join('bundles', key), 'unsafe-release-path', 'Bundle cleanup escaped the retained store');
  const journal = deletionFile(registry, key);
  if (fs.existsSync(journal)) {
    const intent = deletionIntent(registry, key);
    requireValue(intent.identity === record.identity, 'release-deletion-conflict', 'Deletion intent names another retained identity');
  } else {
    verifiedRecord(registry, key);
    directory(registry.root, 'deletions', true);
    writeNew(journal, JSON.stringify({ schema: 1, key, identity: record.identity }) + '\n');
  }
  // The durable intent outlives a SQLite rollback and authorizes resuming our
  // own partial deletion. An arbitrary damaged bundle has no such intent.
  if (fs.existsSync(record.root)) {
    directory(registry.root, `bundles/${key}`);
    walk(record.root);
    fs.rmSync(record.root, { recursive: true });
  }
  registry.remove('bundle', key);
}

function deletionFile(registry, key) {
  requireValue(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(key), 'unsafe-release-path', 'Invalid deletion identity');
  return path.join(registry.root, 'deletions', key + '.json');
}

function deletionIntent(registry, key) {
  const intent = parseJson(readBytes(registry.root, `deletions/${key}.json`, 4096), 'retained deletion intent');
  requireValue(intent?.schema === 1 && intent.key === key && /^\d+\.\d+\.\d+-[a-f0-9]{64}$/.test(intent.identity), 'release-deletion-conflict', 'Unrecognized retained deletion intent');
  return intent;
}

function finishDeletions(registry) {
  const root = path.join(registry.root, 'deletions');
  if (!fs.existsSync(root)) return;
  directory(registry.root, 'deletions');
  for (const name of fs.readdirSync(root)) {
    const key = name.endsWith('.json') ? name.slice(0, -5) : '';
    const file = deletionFile(registry, key);
    deletionIntent(registry, key);
    if (registry.get('bundle', key)) continue;
    requireValue(!fs.existsSync(path.join(registry.root, 'bundles', key)), 'release-deletion-conflict', 'Completed deletion still has an unregistered directory');
    fs.unlinkSync(file);
  }
}

function collectStaging(registry) {
  const base = path.join(registry.root, 'staging');
  if (!fs.existsSync(base)) return [];
  directory(registry.root, 'staging');
  const removed = [];
  for (const key of fs.readdirSync(base)) {
    if (!/^[a-f0-9-]{36}$/.test(key)) continue;
    const target = directory(registry.root, `staging/${key}`);
    const entries = fs.readdirSync(target);
    if (entries.length === 0) { fs.rmdirSync(target); removed.push(key); continue; }
    let owner;
    try { owner = parseJson(readBytes(target, 'owner.json', 4096), 'staging owner'); }
    catch { continue; }
    if (owner.schema !== 1 || owner.key !== key || processAlive(owner.pid) !== false) continue;
    requireValue(path.relative(registry.root, target) === path.join('staging', key), 'unsafe-release-path', 'Staging cleanup escaped the retained store');
    fs.rmSync(target, { recursive: true });
    removed.push(key);
  }
  return removed;
}

module.exports = { availableIdentity, bundleRecord, capture, collectStaging, finishDeletions, reconcileOrphans, removeBundle, verifiedRecord };
