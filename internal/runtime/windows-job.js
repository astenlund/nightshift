'use strict';

const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const readline = require('node:readline');
const { spawn } = require('node:child_process');
const { resolveTrustedExecutable } = require('../filesystem-primitives');

const MAX_FRAME_BYTES = 5592576;
const START_STAGES = ['command', 'setup', 'create-process', 'job-assignment', 'resume'];
// Shared with internal/runtime/windows-job-runner.ps1, which truncates longer system messages.
const MAX_WIN32_MESSAGE_LENGTH = 1024;

function hasExactKeys(frame, keys) {
  const actual = Object.keys(frame).sort();
  return actual.length === keys.length && [...keys].sort().every((key, index) => key === actual[index]);
}

// Validates a start-failed frame and returns the error naming the executable, stage and any Windows error.
function startFailure(executable, frame) {
  const prefix = `Windows job could not start the host ${executable}`;
  if (frame.detailCode === 'termination') {
    if (!hasExactKeys(frame, ['detailCode', 'kind', 'pid']) || !Number.isSafeInteger(frame.pid) || frame.pid <= 0) throw new Error('Invalid Windows job start failure');
    return new Error(`${prefix} (termination of the partially started process is unproven)`);
  }
  const win32 = Object.hasOwn(frame, 'win32Error');
  const valid = frame.detailCode === 'spawn' && START_STAGES.includes(frame.stage)
    && hasExactKeys(frame, win32 ? ['detailCode', 'kind', 'stage', 'win32Error', 'win32Message'] : ['detailCode', 'kind', 'stage'])
    && (!win32 || (Number.isSafeInteger(frame.win32Error) && frame.win32Error > 0 && typeof frame.win32Message === 'string' && frame.win32Message.length <= MAX_WIN32_MESSAGE_LENGTH));
  if (!valid) throw new Error('Invalid Windows job start failure');
  // Some system messages carry an unfilled %1 insert for the file that could not start.
  return new Error(win32 ? `${prefix} (${frame.stage}): Windows error ${frame.win32Error}: ${frame.win32Message.replaceAll('%1', () => executable)}` : `${prefix} (${frame.stage})`);
}

function spawnWindowsJob(executable, args, options) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = undefined;
  child.exitCode = null;
  child.signalCode = null;
  child.jobEmpty = false;
  child.diagnostics = [];
  let closed = false;
  let terminating = false;
  let terminateTimer;
  let hostExit = null;
  let failure = null;
  let inputOrdinal = 0;
  let acceptedOrdinal = 0;
  const outputOrdinals = { 'host-stdout': 1, 'host-stderr': 1 };
  let outputBytes = 0;
  const powerShell = resolveTrustedExecutable({ root: options.protectedRoot ?? options.cwd, basename: 'pwsh.exe' });
  const runner = spawn(powerShell, ['-NoProfile', '-File', path.join(__dirname, 'windows-job-runner.ps1')], { cwd: options.cwd, env: options.env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  child.runnerPid = runner.pid;
  const send = frame => {
    if (closed || runner.stdin.destroyed) return false;
    const ordered = Object.fromEntries(Object.entries(frame).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
    const bytes = JSON.stringify(ordered) + '\n';
    if (Buffer.byteLength(bytes) > MAX_FRAME_BYTES) throw new Error('Windows job frame exceeds its limit');
    return runner.stdin.write(bytes);
  };
  const fail = error => {
    if (failure) return;
    failure = error;
    child.emit('error', error);
    child.kill();
  };
  child.stdin = new Writable({
    write(bytes, encoding, callback) {
      try {
        const input = Buffer.from(bytes);
        for (let offset = 0; offset < input.length; offset += 16384) {
          send({ kind: 'host-input', ordinal: ++inputOrdinal, dataBase64: input.subarray(offset, offset + 16384).toString('base64') });
        }
        callback();
      }
      catch (error) { callback(error); }
    },
    final(callback) {
      try { send({ kind: 'close-input' }); callback(); }
      catch (error) { callback(error); }
    },
  });
  child.kill = () => {
    if (closed || terminating) return false;
    terminating = true;
    child.signalCode = 'SIGTERM';
    try { send({ kind: 'terminate' }); } catch (error) { failure ??= error; }
    terminateTimer = setTimeout(() => runner.kill(), 5000);
    return true;
  };
  runner.stdin.on('error', fail);
  runner.on('error', fail);
  runner.stderr.on('data', bytes => child.stderr.write(bytes));
  runner.once('spawn', () => {
    try {
      send({ kind: 'start', executable, args, cwd: options.cwd, environment: options.env ?? process.env });
      // Noninteractive commands can exit while process-observation callbacks run.
      // Queue EOF before those callbacks, while the runner still owns its input pipe.
      if (options.closeInput === true) child.stdin.end();
    }
    catch (error) { fail(error); }
  });
  readline.createInterface({ input: runner.stdout }).on('line', line => {
    try {
      if (Buffer.byteLength(line) > MAX_FRAME_BYTES) throw new Error('Windows job output frame exceeds its limit');
      const frame = JSON.parse(line);
      child.diagnostics.push({ kind: frame.kind, detailCode: frame.detailCode, ordinal: frame.ordinal });
      if (frame.kind === 'started') {
        if (child.pid !== undefined || !Number.isSafeInteger(frame.pid) || frame.pid <= 0) throw new Error('Invalid Windows job start');
        child.pid = frame.pid;
        child.emit('spawn');
      } else if (frame.kind === 'host-stdout' || frame.kind === 'host-stderr') {
        if (frame.ordinal !== outputOrdinals[frame.kind]++) throw new Error('Windows job output ordering changed');
        const bytes = Buffer.from(frame.dataBase64, 'base64');
        if (bytes.toString('base64') !== frame.dataBase64) throw new Error('Invalid Windows job output encoding');
        outputBytes += bytes.length;
        if (outputBytes > 32 * 1024 * 1024) throw new Error('Agent output exceeds its capacity');
        (frame.kind === 'host-stdout' ? child.stdout : child.stderr).write(bytes);
      } else if (frame.kind === 'input-accepted') {
        if (frame.ordinal !== ++acceptedOrdinal || acceptedOrdinal > inputOrdinal) throw new Error('Windows job input ordering changed');
      } else if (frame.kind === 'host-exit') {
        if (!Number.isInteger(frame.exitCode) || hostExit !== null) throw new Error('Invalid Windows job exit');
        hostExit = frame.exitCode;
      } else if (frame.kind === 'job-empty') child.jobEmpty = true;
      else if (frame.kind === 'start-failed') {
        const error = startFailure(executable, frame);
        if (frame.detailCode === 'spawn') child.jobEmpty = true;
        else {
          child.pid = frame.pid;
          child.emit('spawn');
        }
        fail(error);
      } else throw new Error('Unknown Windows job frame');
    } catch (error) { fail(error); }
  });
  runner.once('close', (code, signal) => {
    closed = true;
    clearTimeout(terminateTimer);
    child.exitCode = hostExit ?? code;
    child.signalCode ??= signal;
    if (!failure && (!child.jobEmpty || code !== 0)) {
      failure = new Error('Windows job closed without verified descendant cleanup');
      child.emit('error', failure);
    }
    child.stdout.end();
    child.stderr.end();
    child.stdin.destroy();
    child.emit('close', child.exitCode, child.signalCode);
  });
  return child;
}

module.exports = { MAX_FRAME_BYTES, spawnWindowsJob, startFailure };
