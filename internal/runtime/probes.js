'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { requireCondition, text } = require('./store');
const { executeCommand, fresh, hash, inventorySnapshot, projectFile } = require('./evidence');
const { writeJson } = require('./artifacts');
const { prepareCommand } = require('./operations');
const { createPrivateCopyDirectory } = require('./copies');
const { changedFiles, currencyRefusal, intactSnapshot } = require('./finding-scope');

// Assessors have repeatedly proposed seconds as milliseconds; a timeout below the floor cannot be what they meant.
const PROBE_TIMEOUT_FLOOR_MS = 5000;
const PROBE_TIMEOUT_CAP_MS = 120000;
// One dispatch attaches at most this many stored results, newest first.
const PROBE_ATTACHMENT_LIMIT = 20;

// Refuses an unusable probe before any worker is reserved and resolves its executable as checks do.
function prepareProbe(root, probe) {
  requireCondition(Number.isSafeInteger(probe.timeoutMs) && probe.timeoutMs >= PROBE_TIMEOUT_FLOOR_MS && probe.timeoutMs <= PROBE_TIMEOUT_CAP_MS, 'invalid-probe-timeout', `Probe timeoutMs is in milliseconds and must be from ${PROBE_TIMEOUT_FLOOR_MS} to ${PROBE_TIMEOUT_CAP_MS}; ${probe.timeoutMs} is outside that range, so request a corrected probe`);
  const command = prepareCommand(root, { name: probe.purpose, executable: probe.executable, args: probe.args, timeoutMs: probe.timeoutMs, resourceMode: 'development' });

  return { ...probe, executable: command.executable };
}

// The files a probe's result depends on, when it declares them and every one is in the requesting receipt's recorded inventory.
// An empty list is a probe about the host or tools alone. Null keeps the whole-inventory comparison.
function declaredFiles(inputs, probe) {
  if (inputs.inventory !== true || !Array.isArray(probe.paths) || !probe.paths.every(file => typeof file === 'string' && file.trim())) return null;
  const recorded = new Map(inputs.files.map(file => [file.path, file]));
  const paths = [...new Set(probe.paths)];

  return paths.every(file => recorded.has(file)) ? paths.map(file => recorded.get(file)) : null;
}

function requireDeclaredCurrent(root, files, condition) {
  const changed = changedFiles(root, files);
  requireCondition(changed.length === 0, 'stale-probe', `${condition}; changed or missing declared files: ${changed.join(', ')}`);
}

function runProbe(root, receipt, probe, runner) {
  text(probe?.id, 'probe.id');
  text(probe.purpose, 'probe.purpose');
  const inputs = receipt.contextSnapshot ?? receipt.snapshot;
  const carried = [receipt.snapshot, ...(receipt.contextSnapshot ? [receipt.contextSnapshot] : [])];
  requireCondition(carried.every(intactSnapshot), 'stale-probe', currencyRefusal('The requested probe\'s reviewed inputs', { established: false, changedPaths: null }));
  const declared = declaredFiles(inputs, probe);
  if (declared) requireDeclaredCurrent(root, declared, 'The requested probe no longer targets its declared files');
  else requireCondition(fresh(root, inputs), 'stale-probe', 'The requested probe no longer targets current reviewed inputs');
  requireCondition(Array.isArray(probe.files), 'invalid-probe', 'Probe must declare its isolated fixture files');
  // A declared probe runs on the project's current files under the receipt's recorded selection; execution integrity watches all of them.
  const baseline = declared ? inventorySnapshot(root, inputs.excludedPaths ?? [], inputs.includedPaths ?? []) : inputs;
  const directory = projectFile(root, `.nightshift/runs/reviews/${receipt.requestId}/probes/${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  const project = createPrivateCopyDirectory(root);
  for (const file of baseline.files) {
    if (file.sha256 === null) continue;
    const destination = projectFile(project, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(projectFile(root, file.path), destination, fs.constants.COPYFILE_EXCL);
  }
  for (const file of probe.files) {
    text(file.path, 'probe file path');
    requireCondition(typeof file.content === 'string' && !/[^\x00-\x7f]/.test(file.content), 'invalid-probe', 'New probe source must be ASCII; use explicit escapes for non-ASCII test values');
    const destination = projectFile(project, file.path);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, file.content.endsWith('\n') ? file.content : file.content + '\n');
  }
  if (declared) requireDeclaredCurrent(root, declared, 'Declared files changed while preparing the fixture');
  requireCondition(fresh(root, baseline), 'stale-probe', 'Canonical inputs changed while preparing the fixture');
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  requireCondition(!initialized.error && initialized.status === 0, 'probe-git-boundary', 'Could not establish an independent Git repository for the probe');
  const boundary = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  requireCondition(!boundary.error && boundary.status === 0 && fs.realpathSync.native(boundary.stdout.trim()) === fs.realpathSync.native(project), 'probe-git-boundary', 'Probe Git discovery does not resolve to its private copy');
  const check = (runner ?? executeCommand)(project, { name: probe.purpose, executable: probe.executable, args: probe.args, timeoutMs: probe.timeoutMs, resourceMode: 'development' });
  const finish = check => {
    // This is controller-authorized execution with normal user privileges, not a sandbox.
    // Drift detection covers the inventory at launch, whatever the probe declared, not every writable file on the machine.
    const canonicalUnchanged = fresh(root, baseline);
    const result = {
      requestId: receipt.requestId, runId: receipt.runId, taskId: receipt.taskId,
      probeId: probe.id, purpose: probe.purpose, probe, copy: path.relative(fs.realpathSync.native(root), project).split(path.sep).join('/'),
      snapshotDigest: receipt.snapshot.digest, contextDigest: inputs.digest, canonicalUnchanged,
      ...(declared ? { declared: { paths: declared.map(file => file.path), files: declared, digest: hash(JSON.stringify(declared)) } } : {}),
      exitCode: check.exitCode, error: check.error, output: check.output, resourceMode: check.resourceMode,
      startedAt: check.startedAt, finishedAt: check.finishedAt,
      ...(check.lingeringDescendants === undefined ? {} : { lingeringDescendants: check.lingeringDescendants }),
    };
    const file = path.join(directory, 'result.json');
    writeJson(file, result);
    requireCondition(canonicalUnchanged, 'probe-input-drift', 'The project changed during the isolated probe; do not accept its result');

    return { path: path.relative(root, file).split(path.sep).join('/'), sha256: hash(fs.readFileSync(file)), snapshotDigest: receipt.snapshot.digest };
  };

  return check && typeof check.then === 'function' ? check.then(finish) : finish(check);
}

// A result's name is its stored identity, the same in every dispatch of its task whatever else is attached.
function probeResultName(reference) {
  const directory = path.posix.basename(path.posix.dirname(reference.path));

  return `context/probes/${/^[0-9A-Za-z-]+$/.test(directory) ? directory : hash(reference.path).slice(0, 32)}.json`;
}

// Why a stored result is withheld from this dispatch, or null when it is eligible. A result without usable declared files, as one stored
// before files were declared, needs byte-identical inputs.
function withheldReason(root, result, expectedSnapshot, contextSnapshot) {
  const declared = result.declared;
  if (declared === undefined || declared === null) {
    return result.snapshotDigest === expectedSnapshot.digest && result.contextDigest === contextSnapshot.digest ? null : { comparison: 'digest', paths: null };
  }
  if (!Array.isArray(declared.files) || hash(JSON.stringify(declared.files)) !== declared.digest) return { comparison: 'digest', paths: null };
  const changed = changedFiles(root, declared.files);

  return changed.length === 0 ? null : { comparison: 'declared', paths: changed };
}

function repeatKey(result) {
  return JSON.stringify([result.probe?.executable, result.probe?.args, result.probe?.files, result.declared?.paths ?? null]);
}

// Results still bearing on the current inputs, newest first: among eligible repeats of one probe only the newest, up to the limit.
// Stored records stay durable; what is withheld or left out is reported rather than discarded.
function loadProbeEvidence(root, references, expectedSnapshot, contextSnapshot = expectedSnapshot) {
  const loaded = (references ?? []).map(reference => {
    const bytes = fs.readFileSync(projectFile(root, reference.path));
    requireCondition(hash(bytes) === reference.sha256, 'changed-probe', 'Saved probe evidence changed');
    const result = JSON.parse(bytes.toString('utf8'));
    requireCondition(result.canonicalUnchanged === true && result.snapshotDigest === reference.snapshotDigest, 'invalid-probe-evidence', 'Saved probe evidence lacks consistent reviewed input identity');

    return { name: probeResultName(reference), result };
  });
  const attached = [];
  const leftOut = [];
  const withheld = [];
  const newest = new Map();
  for (const entry of [...loaded].reverse()) {
    const reason = withheldReason(root, entry.result, expectedSnapshot, contextSnapshot);
    if (reason) {
      withheld.push({ name: entry.name, ...reason });
      continue;
    }
    const key = repeatKey(entry.result);
    if (newest.has(key)) leftOut.push({ name: entry.name, supersededBy: newest.get(key) });
    else if (attached.length === PROBE_ATTACHMENT_LIMIT) leftOut.push({ name: entry.name, supersededBy: null });
    else {
      newest.set(key, entry.name);
      attached.push(entry);
    }
  }

  return { attached, leftOut, withheld };
}

module.exports = { PROBE_ATTACHMENT_LIMIT, PROBE_TIMEOUT_CAP_MS, PROBE_TIMEOUT_FLOOR_MS, loadProbeEvidence, prepareProbe, probeResultName, runProbe };
