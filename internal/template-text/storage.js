'use strict';

// The remembered-keeps file and the atomic writes setup adjudication makes (commitments 7 and 14 of
// .nightshift/specs/setup-index-text-adjudication.md).
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { BACKLOG_FILES, decodeUtf8 } = require('../backlog-catalog');
const { projectFile } = require('../runtime/evidence');
const { requireCondition } = require('../runtime/errors');

const DECISIONS_FILE = '.nightshift/template-decisions.json';
const TEMPORARY = /^\.(.+)\.nightshift-template-[0-9a-f-]{36}\.tmp$/;
// A leftover kept because it may hold the only copy of its file's earlier content; no run removes it.
const PRESERVED = /^\.(.+)\.nightshift-preserved-[0-9a-f-]{36}\.tmp$/;
const HASH = /^[a-f0-9]{64}$/;
const LF = String.fromCharCode(10);
const keyOf = (file, hash) => `${file}:${hash}`;

// { status: 'absent' | 'ok' | 'unreadable', reason, kept: Set of 'file:hash', entries, canonical }
function readDecisions(root) {
  const target = projectFile(root, DECISIONS_FILE);
  if (!fs.existsSync(target)) return { status: 'absent', kept: new Set(), entries: [], bytes: null };
  let bytes;
  let value;
  try {
    bytes = fs.readFileSync(target);
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) { return { status: 'unreadable', reason: error.message, kept: new Set(), entries: [], bytes: null }; }
  const problem = !value || typeof value !== 'object' || Array.isArray(value) || value.schema !== 1 ? 'unsupported schema'
    : !Array.isArray(value.kept) ? 'kept must be a list'
      : value.kept.find(entry => !entry || typeof entry !== 'object' || !BACKLOG_FILES.includes(entry.file) || typeof entry.templateHash !== 'string' || !HASH.test(entry.templateHash)) ? 'an entry names an unknown file or a malformed hash'
        : null;
  if (problem) return { status: 'unreadable', reason: problem, kept: new Set(), entries: [], bytes: null };
  const kept = new Set(value.kept.map(entry => keyOf(entry.file, entry.templateHash)));

  return { status: 'ok', kept, entries: [...kept], bytes };
}

function decisionsBytes(kept) {
  const entries = [...kept].sort().map(key => {
    const separator = key.lastIndexOf(':');

    return { file: key.slice(0, separator), templateHash: key.slice(separator + 1) };
  });

  return Buffer.from(JSON.stringify({ schema: 1, kept: entries }, null, 2) + LF, 'utf8');
}

const temporaryName = target => path.join(path.dirname(target), `.${path.basename(target)}.nightshift-template-${randomUUID()}.tmp`);

// Whether a leftover's target exists and decodes, so the leftover can only be derived output of an earlier apply; a
// leftover whose target is absent or unreadable may hold the only copy of that file's earlier content.
function targetState(directory, target) {
  const file = path.join(directory, target);
  if (!fs.existsSync(file)) return 'absent';
  try {
    decodeUtf8(fs.readFileSync(file));

    return 'readable';
  } catch { return 'unreadable'; }
}

// Leftover temporary files of an interrupted apply in the backlog directory, with the file each was meant to replace.
function leftoverTemporaries(root) {
  const directory = projectFile(root, '.nightshift');
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory).filter(name => TEMPORARY.test(name)).map(name => {
    const target = TEMPORARY.exec(name)[1];

    return { name, path: `.nightshift/${name}`, target, targetState: targetState(directory, target) };
  });
}

// Leftovers an earlier apply kept under a preserved name, for the user to recover or remove.
function preservedCopies(root) {
  const directory = projectFile(root, '.nightshift');
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory).filter(name => PRESERVED.test(name)).map(name => ({ name, path: `.nightshift/${name}`, target: PRESERVED.exec(name)[1] }));
}

const preservedPath = leftover => `.nightshift/${leftover.name.replace('.nightshift-template-', '.nightshift-preserved-')}`;

// Replaces a project file atomically: a temporary file in its directory, with the file's mode, flushed before the
// rename, written only while the target still holds the expected bytes. expected null means the file must be absent.
function replaceAtomically(root, relative, bytes, expected) {
  const target = projectFile(root, relative);
  const present = fs.existsSync(target);
  const current = present ? fs.readFileSync(target) : null;
  const unchanged = expected === null ? !present : present && current.equals(expected);
  requireCondition(unchanged, 'template-text-drift', `${relative} changed after its differences were computed`);
  const mode = present ? fs.statSync(target).mode & 0o777 : 0o644;
  const temporary = temporaryName(target);
  const descriptor = fs.openSync(temporary, 'wx', mode);
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  try {
    const now = fs.existsSync(target) ? fs.readFileSync(target) : null;
    requireCondition(expected === null ? now === null : now !== null && now.equals(expected), 'template-text-drift', `${relative} changed during replacement`);
    if (present) fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, target);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

module.exports = { DECISIONS_FILE, decisionsBytes, keyOf, leftoverTemporaries, preservedCopies, preservedPath, readDecisions, replaceAtomically };
