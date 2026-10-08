'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID, createHash } = require('node:crypto');
const { stableOpenFile } = require('../filesystem-primitives');

class ReleaseError extends Error {
  constructor(code, message) { super(message); this.name = 'ReleaseError'; this.code = code; }
}

function requireValue(condition, code, message) {
  if (!condition) throw new ReleaseError(code, message);
}

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

function text(value, name) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= 32768 && !value.includes(String.fromCharCode(0)), 'invalid-release-request', `${name} must be nonempty bounded text`);
  return value;
}

function relativePath(value) {
  text(value, 'relative path');
  requireValue(value.length <= 1024 && !path.posix.isAbsolute(value) && !path.win32.isAbsolute(value) && !value.includes(String.fromCharCode(92)), 'unsafe-release-path', 'Release paths must be relative and use forward slashes');
  for (const part of value.split('/')) {
    requireValue(part && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/[<>:"|?*]/.test(part) && ![...part].some(character => character.codePointAt(0) < 32), 'unsafe-release-path', `Unsafe release path: ${value}`);
    requireValue(!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part), 'unsafe-release-path', `Reserved Windows filename: ${value}`);
  }
  return value;
}

function directory(root, relative, create = false) {
  let current = fs.realpathSync.native(root);
  for (const segment of relativePath(relative).split('/')) {
    current = path.join(current, segment);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync.native(current) === current, 'unsafe-release-path', `Release directory is not canonically confined: ${current}`);
  }
  return current;
}

function readBytes(root, relative, maximum = 16 * 1024 * 1024) {
  relativePath(relative);
  const canonical = fs.realpathSync.native(root);
  try { return stableOpenFile(canonical, path.join(canonical, relative), { requireSingleLink: true, maxBytes: maximum }).bytes; }
  catch (error) { throw new ReleaseError('release-read-failed', `Cannot read complete release resource ${relative}: ${error.message}`); }
}

function parseJson(bytes, name) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (error) { throw new ReleaseError('invalid-release-json', `${name} is not valid UTF-8 JSON: ${error.message}`); }
}

function writeNew(file, bytes) {
  const descriptor = fs.openSync(file, 'wx');
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

function replaceFile(file, bytes, expected) {
  const present = fs.existsSync(file);
  requireValue(expected === null ? !present : present && fs.readFileSync(file).equals(expected), 'configuration-conflict', `File changed before replacement: ${file}`);
  if (present) {
    const stat = fs.lstatSync(file);
    requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'unsafe-release-path', `Refuse to replace linked file: ${file}`);
  }
  const temporary = path.join(path.dirname(file), `.nightshift-${randomUUID()}.tmp`);
  writeNew(temporary, bytes);
  try {
    requireValue(expected === null ? !fs.existsSync(file) : fs.existsSync(file) && fs.readFileSync(file).equals(expected), 'configuration-conflict', `File changed during replacement: ${file}`);
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function hostProfile(host, value) {
  return value ?? (host === 'codex' ? process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex') : process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'));
}

function requireConsistentRunId(request) {
  const { UUID } = require('../runtime/record-ids');
  if (Object.hasOwn(request, 'runId')) requireValue(typeof request.runId === 'string' && (UUID.test(request.runId) || request.runId.startsWith('review:') && UUID.test(request.runId.slice(7))), 'resource-run-conflict', 'Envelope selectors require a complete record identity');
  if (request.entry === 'runtime') {
    const target = require('../runtime/targets').runtimeTarget(request.request);
    requireValue(request.runId === undefined || target.reference === undefined || request.runId === target.reference, 'resource-run-conflict', 'Conflicting record identities were supplied');
    requireValue(request.runId === undefined || (target.kind === 'review') === request.runId.startsWith('review:'), 'resource-run-conflict', 'Envelope selector belongs to another record domain');
    requireValue(request.runId === undefined || !target.creating || target.reference === request.runId, 'resource-run-conflict', 'Creation cannot ignore an envelope record selector');
  } else requireValue(request.runId === undefined || request.request?.runId === undefined || request.runId === request.request.runId, 'resource-run-conflict', 'Conflicting run identities were supplied');
}

function normalizeRuntimeTarget(request, execution = false) {
  if (request.entry === 'runtime' && (execution || Object.hasOwn(request, 'request'))) requireValue(request.request && typeof request.request === 'object' && !Array.isArray(request.request), 'invalid-runtime-request', 'Supply a runtime request object with action');
  if (request.entry !== 'runtime' || request.runId === undefined) { requireConsistentRunId(request); return request; }
  const nested = { ...request.request };
  if (!Object.hasOwn(nested, 'runId') && !Object.hasOwn(nested, 'reviewContextId')) {
    if (typeof request.runId === 'string' && request.runId.startsWith('review:')) nested.reviewContextId = request.runId.slice(7);
    else nested.runId = request.runId;
  }
  const normalized = { ...request, request: nested };
  requireConsistentRunId(normalized);
  return normalized;
}

function projectRoot(value) {
  const root = fs.realpathSync.native(text(value, 'project root'));
  requireValue(fs.statSync(root).isDirectory(), 'invalid-release-project', 'Project root must be a directory');
  return root;
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'ESRCH' ? false : null; }
}

module.exports = { ReleaseError, digest, directory, hostProfile, normalizeRuntimeTarget, parseJson, processAlive, projectRoot, readBytes, relativePath, replaceFile, requireConsistentRunId, requireValue, text, writeNew };
