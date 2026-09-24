'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { RunError, requireCondition, text } = require('./store');
const { resolveTrustedExecutable } = require('../filesystem-primitives');
const { assertAction } = require('./lifecycle');
const { timeLeft } = require('./limits');
const { projectFile, snapshot } = require('./evidence');
const { verificationEnvironment } = require('../releases/entry');
const processes = require('../releases/processes');

// A bare name resolves from the check environment's PATH, outside the project, because the contained launcher performs no search.
function resolveExecutable(root, executable, env) {
  if (path.isAbsolute(executable) || /[\\/]/.test(executable)) return executable;
  const basename = process.platform === 'win32' && !path.extname(executable) ? executable + '.exe' : executable;
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH');
  try {
    return resolveTrustedExecutable({ root, basename, pathValue: pathKey ? env[pathKey] : '' });
  } catch {
    // The resolver reports only that no qualifying entry exists; the refusal below names the requested executable.
    throw new RunError('executable-not-found', `No executable named ${basename} was found on PATH outside the project; name it by path`);
  }
}

function validateCommand(check) {
  text(check?.name, 'check.name');
  text(check.executable, 'check.executable');
  requireCondition(!/\.(?:cmd|bat)$/i.test(check.executable), 'shell-required', 'Invoke command shims through an explicit shell script');
  requireCondition(Array.isArray(check.args) && check.args.every(arg => typeof arg === 'string'), 'invalid-check', 'Check arguments must be a string array');
  requireCondition(check.timeoutMs === undefined || Number.isSafeInteger(check.timeoutMs) && check.timeoutMs > 0, 'invalid-check', 'Check timeout must be positive');
  verificationEnvironment(check.resourceMode ?? 'inherit');
  requireCondition(check.resourceMode !== null, 'invalid-check-resource-mode', 'Check resource mode cannot be null');
}

// Validates a command and resolves its executable, so callers can refuse it before reserving a worker.
function prepareCommand(root, check) {
  validateCommand(check);
  return { ...check, executable: resolveExecutable(root, check.executable, verificationEnvironment(check.resourceMode ?? 'inherit')) };
}

async function reservedOperation(store, request, work, dependencies = {}) {
  const id = randomUUID();
  const helperProcess = (dependencies.information ?? processes.information)(process.pid, null, store.root);
  requireCondition(helperProcess?.found === true, 'operation-owner-unavailable', 'Cannot reserve execution without its actual helper process identity');
  const terminationPath = `.nightshift/runs/operations/${id}/termination.json`;
  const pending = request.action === 'check' ? { attemptId: id, name: request.check.name, passed: false, pending: true, error: 'Reserved execution has no collected result', snapshot: snapshot(store.root, request.check.paths) } : null;
  const registered = store.update(request.actor, request.revision, 'operation-reserved', state => {
    assertAction(state, request);
    state.workers.push({ id, session: null, role: 'operation', assignment: request.action, action: request.action, taskId: request.taskId, operationName: request.check?.name ?? request.probeId, writes: [], status: 'starting', phase: 'reserved', helperProcess, terminationPath });
    if (pending) state.tasks.find(task => task.id === request.taskId).checks.push(pending);
  });
  const update = change => store.update(request.actor, store.read().revision, 'operation-progress', state => {
    const worker = state.workers.find(item => item.id === id);
    requireCondition(worker && ['starting', 'running', 'unverified'].includes(worker.status), 'operation-not-active', 'The reserved execution no longer owns work');
    Object.assign(worker, change);
  });
  let termination = null;
  let launchAttempted = false;
  const writeTermination = result => {
    termination = { runId: registered.id, workerId: id, helperProcess, descendantsReclaimed: result.descendantsReclaimed === true, exitCode: result.code ?? null, observedAt: new Date().toISOString() };
    const file = projectFile(store.root, terminationPath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(termination) + '\n', { flag: 'wx' });
  };
  const run = async (root, requested) => {
    const check = prepareCommand(root, requested);
    // Preparation such as snapshots and private copies takes time, so the deadlines bound the command from its launch.
    const timeoutMs = timeLeft({ deadlineUtc: store.read().limits?.deadlineUtc, operationDeadlineUtc: dependencies.resourceContext?.operationDeadlineUtc }, check.timeoutMs ?? 120000);
    update({ phase: 'launching' });
    const startedAt = new Date().toISOString();
    try {
      launchAttempted = true;
      const result = await (dependencies.runContained ?? processes.runContained)(check.executable, check.args, {
        cwd: root, env: verificationEnvironment(check.resourceMode ?? 'inherit'), timeoutMs,
        onPrepared: info => update({ runnerPid: info.runnerPid, runnerProcess: (dependencies.information ?? processes.information)(info.runnerPid, null, root) }),
        onStarted: info => update({ phase: 'contained', status: 'running', pid: info.pid, runnerPid: info.runnerPid, childProcess: (dependencies.information ?? processes.information)(info.pid, null, root) }),
        onFinished: writeTermination,
      });

      update({ phase: 'finalizing' });

      return { ...check, timeoutMs, resourceMode: check.resourceMode ?? 'inherit', startedAt, finishedAt: new Date().toISOString(), exitCode: result.code, error: result.error ?? null, output: (result.stdout ?? '') + (result.stderr ?? '') };
    } catch (error) {
      if (!termination && error.descendantsReclaimed === true) writeTermination({ descendantsReclaimed: true, code: null });
      throw error;
    }
  };
  try {
    update({ phase: 'preparing' });
    const evidence = await work(run);
    requireCondition(termination?.descendantsReclaimed === true, 'operation-termination-unverified', 'The reserved command did not establish descendant termination');

    return store.update(request.actor, store.read().revision, 'operation-completed', state => {
      const worker = state.workers.find(item => item.id === id);
      const task = state.tasks.find(item => item.id === request.taskId);
      requireCondition(worker && task, 'operation-not-active', 'Execution ownership or task is missing');
      if (request.action === 'check') {
        // Completion order must not replace a newer invocation's result.
        const index = task.checks.findIndex(check => check.attemptId === id);
        requireCondition(index >= 0, 'operation-not-active', 'The reserved check attempt is missing');
        task.checks[index] = { ...evidence, attemptId: id };
      }
      else task.probeEvidence = [...(task.probeEvidence ?? []), evidence];
      Object.assign(worker, { status: 'complete', phase: 'terminated', terminationEvidence: termination, evidence: 'Command result and terminal worker state committed together' });
    });
  } catch (error) {
    // A refusal before the contained launch leaves no process to account for; only an attempted launch without termination evidence is uncertain.
    const settled = !launchAttempted || termination?.descendantsReclaimed === true;
    store.update(request.actor, store.read().revision, 'operation-failed', state => {
      const worker = state.workers.find(item => item.id === id);
      Object.assign(worker, { status: settled ? 'failed' : 'unverified', terminationEvidence: termination, evidence: error.message });
    });
    throw error;
  }
}

async function reservedCheck(store, request, dependencies) {
  const check = prepareCommand(store.root, request.check);
  const before = snapshot(store.root, check.paths);

  return reservedOperation(store, request, async run => {
    const result = await run(store.root, check);
    const after = snapshot(store.root, check.paths);
    const inputsUnchanged = before.digest === after.digest;

    return { ...result, snapshot: after, inputsUnchanged, passed: !result.error && result.exitCode === 0 && inputsUnchanged };
  }, dependencies);
}

module.exports = { prepareCommand, reservedCheck, reservedOperation };
