'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { requireCondition, text } = require('./store');
const { executeCommand, fresh, hash, projectFile } = require('./evidence');
const { writeJson } = require('./artifacts');

function runProbe(root, receipt, probe) {
  text(probe?.id, 'probe.id');
  text(probe.purpose, 'probe.purpose');
  const inputs = receipt.contextSnapshot ?? receipt.snapshot;
  requireCondition(fresh(root, inputs), 'stale-probe', 'The requested probe no longer targets current reviewed inputs');
  requireCondition(Array.isArray(probe.files), 'invalid-probe', 'Probe must declare its isolated fixture files');
  const directory = projectFile(root, `.nightshift/runs/reviews/${receipt.requestId}/probes/${randomUUID()}`);
  fs.mkdirSync(directory, { recursive: true });
  const project = path.join(directory, 'project');
  fs.mkdirSync(project);
  for (const file of inputs.files) {
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
  requireCondition(fresh(root, inputs), 'stale-probe', 'Canonical inputs changed while preparing the fixture');
  const initialized = spawnSync('git', ['init', '--quiet'], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  requireCondition(!initialized.error && initialized.status === 0, 'probe-git-boundary', 'Could not establish an independent Git repository for the probe');
  const boundary = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: project, windowsHide: true, encoding: 'utf8', timeout: 30000 });
  requireCondition(!boundary.error && boundary.status === 0 && fs.realpathSync.native(boundary.stdout.trim()) === fs.realpathSync.native(project), 'probe-git-boundary', 'Probe Git discovery does not resolve to its private copy');
  const check = executeCommand(project, { name: probe.purpose, executable: probe.executable, args: probe.args, timeoutMs: probe.timeoutMs, resourceMode: 'development' });
  // This is controller-authorized execution with normal user privileges, not a sandbox.
  // Drift detection covers the reviewed inventory, not every writable file on the machine.
  const canonicalUnchanged = fresh(root, inputs);
  const result = {
    requestId: receipt.requestId, runId: receipt.runId, taskId: receipt.taskId,
    probeId: probe.id, purpose: probe.purpose, probe,
    snapshotDigest: receipt.snapshot.digest, contextDigest: inputs.digest, canonicalUnchanged,
    exitCode: check.exitCode, error: check.error, output: check.output, resourceMode: check.resourceMode,
    startedAt: check.startedAt, finishedAt: check.finishedAt,
  };
  const file = path.join(directory, 'result.json');
  writeJson(file, result);
  requireCondition(canonicalUnchanged, 'probe-input-drift', 'Canonical reviewed inputs changed during the isolated probe; do not accept its result');
  return { path: path.relative(root, file).split(path.sep).join('/'), sha256: hash(fs.readFileSync(file)), snapshotDigest: receipt.snapshot.digest };
}

function loadProbeEvidence(root, references, expectedSnapshot, contextSnapshot = expectedSnapshot) {
  return (references ?? []).flatMap(reference => {
    const file = projectFile(root, reference.path);
    const bytes = fs.readFileSync(file);
    requireCondition(hash(bytes) === reference.sha256, 'changed-probe', 'Saved probe evidence changed');
    const result = JSON.parse(bytes.toString('utf8'));
    requireCondition(result.canonicalUnchanged === true && result.snapshotDigest === reference.snapshotDigest, 'invalid-probe-evidence', 'Saved probe evidence lacks consistent reviewed input identity');
    // Old evidence remains durable, but a new assessment receives only current evidence.
    if (result.snapshotDigest !== expectedSnapshot.digest || result.contextDigest !== contextSnapshot.digest) return [];
    return [result];
  });
}

module.exports = { loadProbeEvidence, runProbe };
