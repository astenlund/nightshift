'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveTrustedExecutable } = require('../filesystem-primitives');
const { spawnWindowsJob } = require('../runtime/windows-job');
const { ReleaseError, processAlive, requireValue } = require('./io');

function information(pid, host, cwd) {
  try {
    const executable = resolveTrustedExecutable({ root: cwd, basename: 'pwsh.exe' });
    const args = ['-NoProfile', '-File', path.join(__dirname, 'process-info.ps1'), '-ProcessId', String(pid)];
    if (host) args.push('-HostName', host, '-FindOwner');
    const result = spawnSync(executable, args, { cwd, windowsHide: true, timeout: 10000, encoding: 'utf8', maxBuffer: 8192 });
    if (result.error || result.status !== 0) return null;
    const value = JSON.parse(result.stdout);
    if (value.found === false) return { found: false };
    return value.found === true && Number.isSafeInteger(value.pid) && typeof value.created === 'string' && typeof value.name === 'string' ? value : null;
  } catch { return null; }
}

function nativeOwner(host, cwd) { const value = information(process.pid, host, cwd); return value?.found ? value : null; }

function ownerAlive(owner, cwd) {
  if (!owner || !Number.isSafeInteger(owner.pid) || typeof owner.created !== 'string') return null;
  if (processAlive(owner.pid) === false) return false;
  const actual = information(owner.pid, null, cwd);
  if (!actual) return null;
  return actual.found === true && actual.created === owner.created && actual.name === owner.name;
}

async function runContained(executable, args, options) {
  const child = spawnWindowsJob(executable, args, { cwd: options.cwd, protectedRoot: options.cwd, env: options.env, closeInput: true });
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
  const timer = setTimeout(() => fail(new ReleaseError('operation-timeout', 'Guarded operation exceeded its time bound')), options.timeoutMs ?? 3600000);
  const result = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  clearTimeout(timer);
  const exit = { ...result, stdout, stderr, descendantsReclaimed: child.jobEmpty === true, error: failure?.message ?? null };
  options.onFinished?.(exit);
  requireValue(exit.descendantsReclaimed, 'operation-termination-unverified', 'Guarded operation descendants could not be reconciled');
  if (failure) {
    failure.descendantsReclaimed = exit.descendantsReclaimed;
    throw failure;
  }
  return exit;
}

module.exports = { information, nativeOwner, ownerAlive, runContained };
