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

const GIT_OPTIONS = { windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 };

const gitObjectId = (bytes, format) => createHash(format).update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

// The Git object ids these exact bytes would have as committed content: as read, and with CRLF line endings converted to LF.
function normalizedCandidates(bytes, format) {
  const candidates = [gitObjectId(bytes, format)];
  if (bytes.includes(13)) candidates.push(gitObjectId(Buffer.from(bytes.toString('latin1').replaceAll('\r\n', '\n'), 'latin1'), format));
  return candidates;
}

// Every write moves a file's change time, so an unchanged stamp shows that no write landed between two observations.
function writeStamp(target) {
  const metadata = fs.statSync(target, { bigint: true, throwIfNoEntry: false });
  return metadata ? `${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}` : null;
}

// With an object format, each existing file also carries its normalized candidates, computed from the same bytes as its raw hash, and the write stamp taken before those bytes were read.
function readIdentities(root, paths, format = null) {
  return [...new Set(paths)].sort().map(relative => {
    const target = projectFile(root, relative);
    if (!fs.existsSync(target)) return { path: relative, sha256: null };
    requireCondition(fs.statSync(target).isFile(), 'unsafe-path', `Unsupported reviewed entry ${relative}: snapshots require regular files; submodule directories need explicit reconciliation`);
    const stamp = format ? writeStamp(target) : null;
    const bytes = fs.readFileSync(target);
    return format ? { path: relative, sha256: hash(bytes), candidates: normalizedCandidates(bytes, format), target, stamp } : { path: relative, sha256: hash(bytes) };
  });
}

function fileSha256(root, relative) {
  return readIdentities(root, [relative])[0].sha256;
}

// The worktree's object format, or null outside a Git worktree or when Git cannot report it.
function gitObjectFormat(root) {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree', '--show-object-format'], { ...GIT_OPTIONS, cwd: root });
  if (result.error || result.status !== 0) return null;
  const [inside, format] = result.stdout.split('\n').map(line => line.trim());
  return inside === 'true' && ['sha1', 'sha256'].includes(format) ? format : null;
}

// Git rereads each file from disk, so its id can describe other content than the bytes read here. Keep it only when the file's write stamp shows no write between the two reads and the id is one of that file's own candidates.
function verifiedBlobs(root, files) {
  const verified = new Map();
  if (files.length === 0 || files.some(file => file.path.includes('\n'))) return verified;
  const result = spawnSync('git', ['hash-object', '--stdin-paths'], { ...GIT_OPTIONS, cwd: root, input: files.map(file => file.path).join('\n') + '\n' });
  if (result.error || result.status !== 0) return verified;
  const ids = result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
  if (ids.length !== files.length) return verified;
  files.forEach((file, index) => { if (file.candidates.includes(ids[index]) && writeStamp(file.target) === file.stamp) verified.set(file.path, ids[index]); });
  return verified;
}

// The digest covers each recorded blob id, so evidence cannot gain a normalized identity that its dispatch did not record.
function snapshot(root, paths) {
  requireCondition(Array.isArray(paths) && paths.length > 0, 'empty-evidence', 'Snapshot requires artifact paths');
  const format = gitObjectFormat(root);
  const read = readIdentities(root, paths, format);
  const blobs = format ? verifiedBlobs(root, read.filter(file => file.sha256 !== null)) : new Map();
  const files = read.map(({ candidates, target, stamp, ...file }) => blobs.has(file.path) ? { ...file, blob: blobs.get(file.path) } : file);
  return { digest: hash(JSON.stringify(files)), files };
}

// The marker for an entry that can no longer be read as a regular project file, such as one replaced by a directory or a link.
const UNREADABLE = Symbol('unreadable');

// The current sha256 of each distinct recorded path, null for a missing file. With tolerate, an unreadable entry maps to
// UNREADABLE instead of throwing, so it counts as changed without stopping the comparison of other paths.
function currentSha256(root, files, tolerate = false) {
  const paths = [...new Set(files.map(file => file.path))];
  if (!tolerate) return new Map(readIdentities(root, paths).map(file => [file.path, file.sha256]));
  return new Map(paths.map(relative => {
    try {
      return [relative, readIdentities(root, [relative])[0].sha256];
    } catch {
      // Whatever stops the read, the recorded identity cannot be matched.
      return [relative, UNREADABLE];
    }
  }));
}

// The recorded files whose bytes changed, and among them those whose recorded blob id lets a renormalization be recognized:
// both versions exist and the record carries a blob id; evidence recorded without blob ids keeps the byte comparison.
function byteChanges(root, files, current = currentSha256(root, files)) {
  const changed = files.filter(file => current.get(file.path) !== file.sha256);
  return { changed, candidates: changed.filter(file => file.sha256 !== null && typeof current.get(file.path) === 'string' && typeof file.blob === 'string') };
}

// The blob id Git would commit for each candidate's current content, established with one object-format query and one batched
// hash however many files changed. A file whose id cannot be verified is left out, never counted as unchanged.
function currentBlobs(root, candidates) {
  if (candidates.length === 0) return new Map();
  const format = gitObjectFormat(root);
  if (!format) return new Map();
  return verifiedBlobs(root, readIdentities(root, [...new Set(candidates.map(file => file.path))], format).filter(file => file.sha256 !== null));
}

// The candidates Git would commit with their recorded content, as after a line-ending renormalization.
function renormalizedPaths(root, candidates) {
  const blobs = currentBlobs(root, candidates);
  return new Set(candidates.filter(file => blobs.get(file.path) === file.blob).map(file => file.path));
}

// Git's refusal when discovery found no repository at all. An unusable GIT_DIR or .git file draws a different refusal that names
// the path it could not use, so only this wording is evidence of a project outside Git.
const NO_REPOSITORY = /not a git repository \(or any of the parent directories\)/i;

function samePath(left, right) {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

// Whether root or an ancestor Git would search holds a .git entry of any kind; discovery never enters a ceiling directory.
function gitEntryInDiscovery(root) {
  const ceilings = (process.env.GIT_CEILING_DIRECTORIES ?? '').split(path.delimiter).filter(Boolean).map(entry => path.resolve(entry));
  for (let directory = path.resolve(root); ; directory = path.dirname(directory)) {
    if (fs.lstatSync(path.join(directory, '.git'), { throwIfNoEntry: false })) return true;
    const parent = path.dirname(directory);
    if (parent === directory || ceilings.some(ceiling => samePath(ceiling, parent))) return false;
  }
}

// True only when every sign shows root outside any Git worktree: no GIT_DIR or GIT_WORK_TREE redirects discovery, no .git entry
// of any kind lies on the discovery path, even a broken one Git would skip, and Git itself refuses with its no-repository wording.
// Anything else, including a Git failure, is no evidence and returns false. Messages are forced untranslated for that match.
function outsideGitWorktree(root) {
  if (process.env.GIT_DIR || process.env.GIT_WORK_TREE || gitEntryInDiscovery(root)) return false;
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { ...GIT_OPTIONS, cwd: root, env: { ...process.env, LC_ALL: 'C', LANGUAGE: 'C' } });
  return !result.error && result.status === 128 && NO_REPOSITORY.test(result.stderr ?? '');
}

// Unchanged bytes are fresh. Changed bytes are fresh only when Git would commit the same content, as after a line-ending renormalization.
function fresh(root, evidence) {
  return freshAll(root, [evidence])[0];
}

// Whether each snapshot still matches current inputs, as fresh decides for one, judged together: each distinct file is read once,
// and the renormalization candidates of every snapshot cost one object-format query and one batched hash rather than two each.
// Judging never throws: an inventory or entry that cannot be read leaves its snapshot not fresh and the others unaffected, so a
// status brief can name the stale evidence instead of failing, while every gate that needs fresh evidence still refuses.
function freshAll(root, evidences) {
  const comparable = evidences.map(evidence => {
    if (!evidence || !Array.isArray(evidence.files) || evidence.files.length === 0) return false;
    if (hash(JSON.stringify(evidence.files)) !== evidence.digest) return false;
    if (evidence.inventory) {
      try {
        const current = projectInventory(root, evidence.excludedPaths ?? [], evidence.includedPaths ?? []);
        if (JSON.stringify(current) !== JSON.stringify(evidence.files.map(file => file.path))) return false;
      } catch {
        // An inventory that cannot be established cannot show the snapshot current.
        return false;
      }
    }
    return true;
  });
  const sha256 = currentSha256(root, evidences.filter((_, index) => comparable[index]).flatMap(evidence => evidence.files), true);
  const decided = evidences.map((evidence, index) => {
    if (!comparable[index]) return false;
    const { changed, candidates } = byteChanges(root, evidence.files, sha256);
    if (changed.length === 0) return true;
    // A change that no blob id can explain decides the answer without consulting Git.
    return candidates.length === changed.length ? candidates : false;
  });
  let blobs = new Map();
  try {
    blobs = currentBlobs(root, decided.filter(Array.isArray).flat());
  } catch {
    // A candidate that became unreadable after the byte comparison stays unverified, which never counts as unchanged.
  }
  return decided.map(result => (Array.isArray(result) ? result.every(file => blobs.get(file.path) === file.blob) : result));
}

// A snapshot of the whole reviewable project inventory, in the form a review's context snapshot takes.
function inventorySnapshot(root, excluded = [], included = []) {
  return { ...snapshot(root, projectInventory(root, excluded, included)), inventory: true, excludedPaths: excluded, includedPaths: included };
}

// The paths that appeared, disappeared or changed content since an inventory snapshot, sorted; null when that cannot be established.
function changedPaths(root, evidence) {
  if (evidence?.inventory !== true || !Array.isArray(evidence.files) || hash(JSON.stringify(evidence.files)) !== evidence.digest) return null;
  try {
    const current = projectInventory(root, evidence.excludedPaths ?? [], evidence.includedPaths ?? []);
    const recorded = new Set(evidence.files.map(file => file.path));
    const present = new Set(current);
    const changed = new Set([...current.filter(file => !recorded.has(file)), ...[...recorded].filter(file => !present.has(file))]);
    const { changed: altered, candidates } = byteChanges(root, evidence.files.filter(file => present.has(file.path)));
    const renormalized = renormalizedPaths(root, candidates);
    for (const file of altered) if (!renormalized.has(file.path)) changed.add(file.path);

    return [...changed].sort();
  } catch {
    // An unreadable or unsafe entry means the difference cannot be established, which never counts as confined.
    return null;
  }
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

module.exports = { changedPaths, executeCommand, fileIdentity, fileSha256, fresh, freshAll, hash, inventorySnapshot, outsideGitWorktree, projectFile, projectInventory, snapshot, verifyCommand };
