'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { requireCondition, text } = require('./store');

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function relativeParts(relative) {
  text(relative, 'artifact path');
  const parts = relative.split('/');
  requireCondition(!relative.includes('\\') && !path.isAbsolute(relative) && !parts.some(part => ['', '.', '..'].includes(part)), 'unsafe-path', 'Evidence paths must be project-relative with forward slashes');
  return parts;
}

function fileIdentity(root, relative) {
  const metadata = fs.lstatSync(path.join(root, ...relativeParts(relative)), { throwIfNoEntry: false, bigint: true });
  requireCondition(metadata === undefined || metadata.ino !== 0n, 'file-identity-unavailable', 'Cannot safely distinguish aliases for this filesystem entry');
  return { key: metadata ? `entry:${metadata.dev}:${metadata.ino}` : `path:${relative}`, exists: metadata !== undefined, directory: metadata?.isDirectory() ?? false };
}

function projectFile(root, relative) {
  const parts = relativeParts(relative);
  let current = fs.realpathSync.native(root);
  for (const segment of parts) {
    current = path.join(current, segment);
    const metadata = fs.lstatSync(current, { throwIfNoEntry: false });
    if (!metadata) continue;
    requireCondition(!metadata.isSymbolicLink() && (metadata.isDirectory() || metadata.isFile() && metadata.nlink === 1), 'unsafe-path', `Unsupported reviewed entry ${relative}: linked or special files require explicit reconciliation`);
  }
  return current;
}

function snapshot(root, paths) {
  requireCondition(Array.isArray(paths) && paths.length > 0, 'empty-evidence', 'Snapshot requires artifact paths');
  const files = [...new Set(paths)].sort().map(relative => {
    const target = projectFile(root, relative);
    if (!fs.existsSync(target)) return { path: relative, sha256: null };
    requireCondition(fs.statSync(target).isFile(), 'unsafe-path', `Unsupported reviewed entry ${relative}: snapshots require regular files; submodule directories need explicit reconciliation`);
    return { path: relative, sha256: hash(fs.readFileSync(target)) };
  });
  return { digest: hash(JSON.stringify(files)), files };
}

function fresh(root, evidence) {
  if (!evidence || !Array.isArray(evidence.files) || evidence.files.length === 0) return false;
  if (evidence.inventory) {
    const current = projectInventory(root, evidence.excludedPaths ?? [], evidence.includedPaths ?? []);
    if (JSON.stringify(current) !== JSON.stringify(evidence.files.map(file => file.path))) return false;
  }
  return snapshot(root, evidence.files.map(file => file.path)).digest === evidence.digest;
}

function projectInventory(root, excluded = [], included = []) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });
  requireCondition(!result.error && result.status === 0, 'inventory-failed', result.error?.message ?? result.stderr);
  const identities = new Map();
  const identity = file => {
    if (!identities.has(file)) identities.set(file, fileIdentity(root, file));
    return identities.get(file);
  };
  const exclusions = new Set(excluded.map(file => {
    const entry = identity(file);
    requireCondition(!entry.directory, 'invalid-review-paths', 'Exclusions must name individual file entries, not directories');
    return entry.key;
  }));
  const selected = new Map();
  const visible = result.stdout.split('\0').filter(file => file && !file.startsWith('.nightshift/runs/') && !file.startsWith('.nightshift/inbox/') && !file.startsWith('.tmp/'));
  for (const file of visible) {
    const key = identity(file).key;
    if (!exclusions.has(key) && !selected.has(key)) selected.set(key, file);
  }
  for (const file of included) {
    const key = identity(file).key;
    requireCondition(!exclusions.has(key), 'conflicting-review-paths', 'An explicitly selected artifact cannot also be excluded');
    if (!selected.has(key)) selected.set(key, file);
  }
  return [...selected.values()].sort();
}

function executeCommand(root, request) {
  text(request.name, 'check.name');
  text(request.executable, 'check.executable');
  requireCondition(!/\.(?:cmd|bat)$/i.test(request.executable), 'shell-required', 'Invoke Windows command shims through an explicit shell script, for example pwsh -NoProfile -File <script.ps1>');
  requireCondition(Array.isArray(request.args) && request.args.every(arg => typeof arg === 'string'), 'invalid-check', 'Check arguments must be a string array');
  requireCondition(request.timeoutMs === undefined || Number.isSafeInteger(request.timeoutMs) && request.timeoutMs > 0, 'invalid-check', 'Check timeout must be a positive integer');
  const resourceMode = request.resourceMode ?? 'inherit';
  requireCondition(request.resourceMode !== null, 'invalid-check-resource-mode', 'Check resourceMode cannot be null');
  const env = require('../releases/entry').verificationEnvironment(resourceMode);
  const startedAt = new Date().toISOString();
  const result = spawnSync(request.executable, request.args, { cwd: root, env, shell: false, windowsHide: true, encoding: 'utf8', timeout: request.timeoutMs ?? 120000, maxBuffer: 4 * 1024 * 1024 });
  return { name: request.name, executable: request.executable, args: request.args, resourceMode, startedAt, finishedAt: new Date().toISOString(), exitCode: result.status, error: result.error?.message ?? null, output: (result.stdout ?? '') + (result.stderr ?? '') };
}

function verifyCommand(root, request) {
  const before = snapshot(root, request.paths);
  const result = executeCommand(root, request);
  const after = snapshot(root, request.paths);
  const inputsUnchanged = before.digest === after.digest;
  return { ...result, snapshot: after, inputsUnchanged, passed: !result.error && result.exitCode === 0 && inputsUnchanged };
}

module.exports = { executeCommand, fileIdentity, fresh, hash, projectFile, projectInventory, snapshot, verifyCommand };
