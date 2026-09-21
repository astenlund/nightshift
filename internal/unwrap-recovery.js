'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isUtf8 } = require('node:buffer');
const { comparableIdentity, comparableMode, pathIsContained, stableOpenFile } = require('./filesystem-primitives');
const { acquireLock } = require('./unwrap-lock');

const RECOVERY_SUFFIX = '.nightshift-unwrap.json';
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_RECORD_BYTES = 48 * 1024 * 1024;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const recordPath = target => target + RECOVERY_SUFFIX;

function recoveryError(code, target, message, cause) {
  const error = new Error(`${message}; target: ${target}; recovery: ${recordPath(target)}`, { cause });
  error.code = code;
  error.target = target;
  error.recoveryFile = recordPath(target);
  return error;
}

function exists(file) {
  try { fs.lstatSync(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

function directoryIdentity(directory) {
  const stat = fs.lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync.native(directory) !== directory) throw new Error('Directory identity changed');
  return comparableIdentity(stat);
}

function readTarget(root, target) {
  try { return stableOpenFile(root, target, { requireSingleLink: true, maxBytes: MAX_FILE_BYTES }); }
  catch (cause) { cause.code ??= 'identity-changed'; throw cause; }
}

function readUnwrapSnapshot(root, target, options = {}) {
  const rejectPending = () => {
    if (exists(recordPath(target))) throw recoveryError('unwrap-recovery-required', target, 'A pending unwrap prevents a reliable read');
  };
  rejectPending();
  let snapshot;
  try { snapshot = stableOpenFile(root, target, { requireSingleLink: false, ...options }); }
  catch (error) { error.code ??= 'identity-changed'; throw error; }
  rejectPending();
  return snapshot;
}

function verifyUnwrapRead(root, target, snapshot) {
  const current = readUnwrapSnapshot(root, target);
  if (snapshot.identity !== current.identity || snapshot.rawSha256 !== current.rawSha256) {
    const error = new Error(`Backlog changed during assessment; retry: ${target}`);
    error.code = 'backlog-changed';
    error.target = target;
    throw error;
  }
}

function encode(bytes) { return { bytes: bytes.toString('base64'), length: bytes.length, sha256: hash(bytes) }; }

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function decode(value) {
  if (!exactKeys(value, ['bytes', 'length', 'sha256']) || typeof value.bytes !== 'string' || !Number.isSafeInteger(value.length) || value.length < 0 || value.length > MAX_FILE_BYTES || typeof value.sha256 !== 'string') throw new Error('Invalid saved bytes');
  const bytes = Buffer.from(value.bytes, 'base64');
  if (bytes.length !== value.length || bytes.toString('base64') !== value.bytes || hash(bytes) !== value.sha256) throw new Error('Saved bytes failed verification');
  return bytes;
}

function loadRecord(root, target) {
  try {
    const snapshot = stableOpenFile(root, recordPath(target), { requireSingleLink: true, maxBytes: MAX_RECORD_BYTES });
    if (!isUtf8(snapshot.bytes)) throw new Error('Recovery record is not UTF-8');
    const record = JSON.parse(snapshot.bytes.toString('utf8'));
    if (!exactKeys(record, ['version', 'root', 'parent', 'target', 'rootIdentity', 'parentIdentity', 'targetIdentity', 'mode', 'recordIdentity', 'authority', 'original', 'replacement'])
      || record.version !== 1 || record.target !== target || typeof record.root !== 'string' || !path.isAbsolute(record.root)
      || !pathIsContained(record.root, target) || record.parent !== path.dirname(target) || record.recordIdentity !== snapshot.identity
      || typeof record.targetIdentity !== 'string' || typeof record.rootIdentity !== 'string' || typeof record.parentIdentity !== 'string'
      || !(record.mode === null || Number.isInteger(record.mode) && record.mode >= 0 && record.mode <= 4095)
      || !record.authority || record.authority.targetIdentity !== target || record.authority.rootIdentity !== record.root) throw new Error('Invalid recovery ownership');
    return { record, snapshot, original: decode(record.original), replacement: decode(record.replacement) };
  } catch (cause) { throw recoveryError('unwrap-recovery-invalid', target, 'Recovery record is incomplete, changed or invalid; preserve it for explicit reconciliation', cause); }
}

function writeAll(descriptor, bytes) {
  let offset = 0;
  while (offset < bytes.length) {
    const count = fs.writeSync(descriptor, bytes, offset, bytes.length - offset, offset);
    if (count === 0) throw new Error('Write ended early');
    offset += count;
  }
}

function createRecord(root, target, before, replacement, authority) {
  const file = recordPath(target);
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    const record = {
      version: 1, root, parent: path.dirname(target), target,
      rootIdentity: directoryIdentity(root), parentIdentity: directoryIdentity(path.dirname(target)),
      targetIdentity: before.identity, mode: before.mode,
      recordIdentity: comparableIdentity(fs.fstatSync(descriptor, { bigint: true })),
      authority, original: encode(before.bytes), replacement: encode(replacement),
    };
    const bytes = Buffer.from(JSON.stringify(record) + '\n');
    if (bytes.length > MAX_RECORD_BYTES) throw new Error('Recovery record exceeds its byte limit');
    writeAll(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  return loadRecord(root, target);
}

function validateSaved(root, target, saved, validateAuthority) {
  const { record } = saved;
  if (directoryIdentity(record.root) !== record.rootIdentity || directoryIdentity(record.parent) !== record.parentIdentity) throw new Error('Recovery directory ownership changed');
  validateAuthority(record.authority);
  const current = readTarget(root, target);
  if (current.identity !== record.targetIdentity || current.mode !== record.mode) throw new Error('Recovery target ownership changed');
  const snapshot = stableOpenFile(root, recordPath(target), { requireSingleLink: true, maxBytes: MAX_RECORD_BYTES });
  if (snapshot.identity !== saved.snapshot.identity || snapshot.rawSha256 !== saved.snapshot.rawSha256) throw new Error('Recovery record changed');
  return current;
}

function recoverableRewrite(root, target, transform, options) {
  const parent = path.dirname(target);
  const pending = exists(recordPath(target));
  // No-op writes need no coordination artifact. Any actual mutation re-reads under the lock.
  if (!pending) {
    const before = readUnwrapSnapshot(root, target, { requireSingleLink: true, maxBytes: MAX_FILE_BYTES });
    const replacement = transform(before.bytes);
    if (replacement === null || replacement === undefined || Buffer.isBuffer(replacement) && replacement.equals(before.bytes)) {
      verifyUnwrapRead(root, target, before);
      return { changed: false, recovered: false };
    }
  }
  const lock = acquireLock(parent);
  let descriptor;
  let saved;
  try {
    lock.validate();
    const recovering = exists(recordPath(target));
    if (recovering) {
      saved = loadRecord(root, target);
      const predicted = transform(saved.original);
      if (!Buffer.isBuffer(predicted) || !predicted.equals(saved.replacement)) throw recoveryError('unwrap-recovery-invalid', target, 'Saved replacement does not match the current unwrap operation');
    } else {
      const before = readTarget(root, target);
      const replacement = transform(before.bytes);
      if (replacement === null || replacement === undefined || Buffer.isBuffer(replacement) && replacement.equals(before.bytes)) return { changed: false, recovered: false };
      if (!Buffer.isBuffer(replacement) || replacement.length > MAX_FILE_BYTES) throw new Error('Invalid or oversized replacement');
      options.beforeWrite?.();
      options.validateAuthority(options.authority);
      const current = readTarget(root, target);
      if (current.identity !== before.identity || !current.bytes.equals(before.bytes) || current.mode !== before.mode) throw Object.assign(new Error('Target changed before recording repair'), { code: 'identity-changed' });
      lock.validate();
      saved = createRecord(root, target, current, replacement, options.authority);
    }
    if (recovering) options.beforeWrite?.();
    options.validateAuthority(options.authority);
    const current = validateSaved(root, target, saved, options.validateAuthority);
    if (!current.bytes.equals(saved.original) && !current.bytes.equals(saved.replacement)) throw recoveryError('unwrap-recovery-conflict', target, 'Current bytes match neither saved version; preserve the current file and extract the original from the recovery record only after explicit reconciliation');
    const recoveryDescriptor = fs.openSync(recordPath(target), 'r+');
    try {
      if (comparableIdentity(fs.fstatSync(recoveryDescriptor, { bigint: true })) !== saved.snapshot.identity) throw new Error('Recovery record changed before sync');
      fs.fsyncSync(recoveryDescriptor);
    } finally { fs.closeSync(recoveryDescriptor); }
    descriptor = fs.openSync(target, fs.constants.O_RDWR | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW ?? 0));
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || comparableIdentity(opened) !== saved.record.targetIdentity || comparableMode(opened) !== saved.record.mode) throw new Error('Opened target ownership changed');
    lock.validate();
    const beforeWrite = validateSaved(root, target, saved, options.validateAuthority);
    if (!beforeWrite.bytes.equals(current.bytes)) throw new Error('Target changed before mutation');
    if (current.bytes.equals(saved.original)) {
      fs.ftruncateSync(descriptor, 0);
      writeAll(descriptor, saved.replacement);
    }
    fs.fsyncSync(descriptor);
    const after = validateSaved(root, target, saved, options.validateAuthority);
    if (!after.bytes.equals(saved.replacement)) throw new Error('Target verification failed');
    lock.validate();
    options.validateAuthority(options.authority);
    fs.unlinkSync(recordPath(target));
    return { changed: true, recovered: recovering };
  } catch (cause) {
    if (cause.recoveryFile || !exists(recordPath(target))) throw cause;
    throw recoveryError(cause.code ?? 'unwrap-recovery-required', target, `Unwrap is incomplete (${cause.message}); recovery evidence retained`, cause);
  } finally {
    try { if (descriptor !== undefined) fs.closeSync(descriptor); } finally { lock.close(); }
  }
}

module.exports = { MAX_FILE_BYTES, MAX_RECORD_BYTES, RECOVERY_SUFFIX, exists, recordPath, recoverableRewrite, readUnwrapSnapshot, verifyUnwrapRead };
