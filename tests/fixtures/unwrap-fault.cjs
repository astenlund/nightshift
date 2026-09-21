'use strict';

// Preloaded only by isolated recovery tests; no production fault switches.
const fs = require('node:fs');
const path = require('node:path');
const target = process.env.NIGHTSHIFT_UNWRAP_TARGET;
const fault = process.env.NIGHTSHIFT_UNWRAP_FAULT;
const trace = process.env.NIGHTSHIFT_UNWRAP_TRACE;
const descriptors = new Map();
const original = Object.fromEntries(['openSync', 'closeSync', 'writeSync', 'readSync', 'ftruncateSync', 'fsyncSync', 'unlinkSync', 'appendFileSync'].map(name => [name, fs[name]]));
let written = false;

function event(stage) {
  original.appendFileSync(trace, stage + '\n');
  if (fault === 'crash-' + stage) process.exit(73);
  if (fault === 'hold-' + stage) {
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(trace + '.release')) {
      if (Date.now() > deadline) throw new Error('Test hold expired');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
}

function failure(code) { throw Object.assign(new Error('Injected ' + code), { code }); }

fs.openSync = function (file, flags, ...args) {
  const descriptor = original.openSync.call(fs, file, flags, ...args);
  const resolved = typeof file === 'string' ? path.resolve(file) : '';
  const role = resolved === target ? 'target' : resolved === target + '.nightshift-unwrap.json' ? 'record' : resolved === path.join(path.dirname(target), '.nightshift-unwrap-lock.sqlite') ? 'lock' : null;
  if (role !== null) descriptors.set(descriptor, role);
  if (flags === 'wx' && (role === 'record' || role === 'lock')) event(role + '-created');
  return descriptor;
};
fs.closeSync = function (descriptor) { descriptors.delete(descriptor); return original.closeSync.call(fs, descriptor); };
fs.writeSync = function (descriptor, bytes, offset, length, position) {
  const role = descriptors.get(descriptor);
  if (role === 'record' && fault === 'record-write-error') {
    original.writeSync.call(fs, descriptor, bytes, offset, Math.min(6, length), position);
    event('record-partial');
    failure('ENOSPC');
  }
  if (role === 'target' && ['target-write-error', 'crash-target-partial'].includes(fault)) {
    original.writeSync.call(fs, descriptor, bytes, offset, Math.min(6, length), position);
    event('target-partial');
    failure('ENOSPC');
  }
  const count = original.writeSync.call(fs, descriptor, bytes, offset, fault === role + '-short' ? Math.min(5, length) : length, position);
  if (role === 'target') {
    written = true;
    if (count === length) event('target-written');
  }
  return count;
};
fs.ftruncateSync = function (descriptor, length) {
  const result = original.ftruncateSync.call(fs, descriptor, length);
  if (descriptors.get(descriptor) === 'target') event('target-truncated');
  return result;
};
fs.fsyncSync = function (descriptor) {
  const role = descriptors.get(descriptor);
  if (role === 'record' && fault === 'record-sync-error') { event('record-sync-error'); failure('EIO'); }
  if (role === 'target' && fault === 'target-sync-error') { event('target-sync-error'); failure('EIO'); }
  const result = original.fsyncSync.call(fs, descriptor);
  if (role === 'record' || role === 'target') event(role + '-synced');
  return result;
};
fs.readSync = function (descriptor, ...args) {
  if (descriptors.get(descriptor) === 'target' && written && fault === 'target-verify-error') { event('target-verify-error'); failure('EIO'); }
  return original.readSync.call(fs, descriptor, ...args);
};
fs.unlinkSync = function (file) {
  const isRecord = path.resolve(file) === target + '.nightshift-unwrap.json';
  if (isRecord) {
    event('before-cleanup');
    if (fault === 'cleanup-error') failure('EACCES');
  }
  const result = original.unlinkSync.call(fs, file);
  if (isRecord) event('after-cleanup');
  return result;
};
