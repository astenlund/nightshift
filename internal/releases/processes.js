'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveTrustedExecutable } = require('../filesystem-primitives');
const { spawnWindowsJob } = require('../runtime/windows-job');
const { ReleaseError, processAlive, requireValue } = require('./io');

const MAX_OPERATION_TIMEOUT_MS = 3600000;
// One inspection's total time, retry included. An idle lookup takes well under a second, but PowerShell alone can take
// many seconds to start on a heavily loaded machine, as the job runner's termination grace allows for.
const INSPECTION_BUDGET_MS = 30000;
// A registered hook inspects beside its other native work inside the host's 60-second hook timeout, so it keeps a shorter total.
const HOOK_INSPECTION_BUDGET_MS = 10000;
const EXCERPT_LENGTH = 200;

function excerpt(text) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();

  return value.length > EXCERPT_LENGTH ? value.slice(0, EXCERPT_LENGTH) + '...' : value;
}

function withExcerpt(message, text) {
  const value = excerpt(text);

  return value ? `${message}: ${value}` : message;
}

// One run of the inspection helper: { value } for a readable answer, otherwise { failure } naming the cause and whether the attempt timed out.
function inspectOnce(pid, host, cwd, timeoutMs, run) {
  let executable;
  try {
    executable = resolveTrustedExecutable({ root: cwd, basename: 'pwsh.exe' });
  } catch (error) {
    return { failure: `could not start PowerShell: ${error.message}` };
  }
  const args = ['-NoProfile', '-File', path.join(__dirname, 'process-info.ps1'), '-ProcessId', String(pid)];
  if (host) args.push('-HostName', host, '-FindOwner');
  const result = run(executable, args, { cwd, windowsHide: true, timeout: timeoutMs, encoding: 'utf8', maxBuffer: 8192 });
  if (result.error?.code === 'ETIMEDOUT') return { failure: `timed out after ${timeoutMs} ms`, timedOut: true };
  if (result.error) return { failure: `could not run PowerShell: ${result.error.message}` };
  if (result.status !== 0) return { failure: withExcerpt(`PowerShell exited with ${result.status === null ? `signal ${result.signal}` : `code ${result.status}`}`, result.stderr) };
  let value;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return { failure: withExcerpt('unreadable output', result.stdout) };
  }
  if (value?.found === false) return { value: exitedParent(value.exitedParent) ? { found: false, exitedParent: { pid: value.exitedParent.pid, child: value.exitedParent.child } } : { found: false } };
  if (value?.found === true && Number.isSafeInteger(value.pid) && typeof value.created === 'string' && typeof value.name === 'string') return { value };

  return { failure: withExcerpt('unreadable output', result.stdout) };
}

// Returns the process record, a not-found observation, or null when inspection failed, after reporting the failure's cause
// to options.onFailure. An attempt that fails before its time is up is retried once within the remaining budget.
function information(pid, host, cwd, options = {}) {
  const { budgetMs = INSPECTION_BUDGET_MS, onFailure, run = spawnSync } = options;
  const deadline = Date.now() + budgetMs;
  const failures = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const remaining = deadline - Date.now();
    if (attempt > 0 && remaining <= 0) break;
    let outcome;
    try {
      outcome = inspectOnce(pid, host, cwd, Math.max(remaining, 1), run);
    } catch (error) {
      outcome = { failure: `inspection error: ${error.message}` };
    }
    if (outcome.value) return outcome.value;
    failures.push(outcome.failure);
    if (outcome.timedOut) break;
  }
  onFailure?.(failures.join('; retry: '));

  return null;
}

function exitedParent(value) {
  return Number.isSafeInteger(value?.pid) && value.pid > 0 && typeof value.child === 'string' && value.child.length > 0;
}

// The refusal suffix for a reported inspection failure, empty when no cause was reported.
function inspectionFailureDetail(cause) {
  return cause ? `: process inspection failed (${cause}); nothing was granted, and the request can be retried` : '';
}

// Returns the owner record, a not-found observation that may name where the ancestry broke, or null when inspection failed.
function observeNativeOwner(host, cwd, options) { return information(process.pid, host, cwd, options); }

function nativeOwner(host, cwd, options) { const value = observeNativeOwner(host, cwd, options); return value?.found ? value : null; }

// True or false when the owner's liveness was established; null for an unusable owner record or a failed inspection, whose cause reaches options.onFailure.
function ownerAlive(owner, cwd, options) {
  if (!owner || !Number.isSafeInteger(owner.pid) || typeof owner.created !== 'string') return null;
  if (processAlive(owner.pid) === false) return false;
  const actual = information(owner.pid, null, cwd, options);
  if (!actual) return null;
  return actual.found === true && actual.created === owner.created && actual.name === owner.name;
}

async function runContained(executable, args, options) {
  const child = spawnWindowsJob(executable, args, { cwd: options.cwd, protectedRoot: options.cwd, env: options.env, closeInput: true, reclaimAfterMs: options.reclaimAfterMs });
  let stdout = '';
  let stderr = '';
  let failure = null;
  let bytes = 0;
  const fail = error => { failure ??= error; child.kill(); };
  const capture = (text, stream) => {
    bytes += Buffer.byteLength(text);
    if (bytes > 32 * 1024 * 1024) { fail(new ReleaseError('operation-output-limit', 'Guarded operation output exceeded its bound')); return; }
    if (stream === 'stdout') stdout += text;
    else stderr += text;
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => capture(text, 'stdout'));
  child.stderr.on('data', text => capture(text, 'stderr'));
  child.on('error', fail);
  child.stdin.on('error', fail);
  child.once('spawn', () => {
    try { options.onStarted?.({ pid: child.pid, runnerPid: child.runnerPid, contained: true }); }
    catch (error) { fail(error); }
  });
  try { options.onPrepared?.({ runnerPid: child.runnerPid }); }
  catch (error) { fail(error); }
  const timer = setTimeout(() => fail(new ReleaseError('operation-timeout', 'Guarded operation exceeded its time bound')), options.timeoutMs ?? MAX_OPERATION_TIMEOUT_MS);
  const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  const exit = { ...result, stdout, stderr, descendantsReclaimed: child.jobEmpty === true, lingering: child.lingering, error: failure?.message ?? null };
  options.onFinished?.(exit);
  requireValue(exit.descendantsReclaimed, 'operation-termination-unverified', 'Guarded operation descendants could not be reconciled');
  if (failure) {
    failure.descendantsReclaimed = exit.descendantsReclaimed;
    throw failure;
  }
  return exit;
}

module.exports = { HOOK_INSPECTION_BUDGET_MS, INSPECTION_BUDGET_MS, MAX_OPERATION_TIMEOUT_MS, information, inspectionFailureDetail, nativeOwner, observeNativeOwner, ownerAlive, runContained };
