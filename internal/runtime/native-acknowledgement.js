'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { requireCondition } = require('./errors');
const { UUID } = require('./record-ids');
const { acknowledgementText } = require('./acknowledgement');

// A history is read whole up to this size and by its final window beyond it, since a long session's history only grows.
const WINDOW_BYTES = 64 * 1024 * 1024;
// The bound on a Codex rollout's first line, its session_meta attribution, read beside the window of a larger file.
const FIRST_LINE_BYTES = 1024 * 1024;
const MAX_ENTRIES = 50000;
const MAX_FILES = 8;
const visible = new Set(['commentary', 'final']);

function nativeProfile(state, context) {
  if (!context) return fs.realpathSync.native(process.env[state.controller.host === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'] ?? path.join(os.homedir(), '.' + state.controller.host));
  const { Registry } = require('../releases/registry');
  const registry = new Registry(context.store);
  try {
    const registration = registry.get('registration', context.registration);
    requireCondition(registration?.host === state.controller.host && context.session === state.controller.session, 'acknowledgement-source-unavailable', 'Native history profile does not match the admitted owner');
    return fs.realpathSync.native(registration.profile);
  } finally { registry.close(); }
}

function sourceFiles(profile, state) {
  requireCondition(UUID.test(state.controller.session), 'acknowledgement-source-unavailable', 'The native history observer requires a supported native UUID session');
  if (state.controller.host === 'claude') {
    const slug = state.root.replace(/[^a-zA-Z0-9]/g, '-');
    return [path.join(profile, 'projects', slug, state.controller.session + '.jsonl')];
  }
  const directory = path.join(profile, 'sessions');
  const files = [];
  let entries = 0;
  const walk = (folder, depth) => {
    const children = fs.readdirSync(folder, { withFileTypes: true });
    entries += children.length;
    requireCondition(entries <= MAX_ENTRIES, 'acknowledgement-source-unavailable', 'Native history discovery exceeded its entry bound');
    for (const child of children) {
      if (child.isSymbolicLink()) continue;
      const file = path.join(folder, child.name);
      if (child.isDirectory() && depth < 3 && /^\d+$/.test(child.name)) walk(file, depth + 1);
      if (child.isFile() && child.name.startsWith('rollout-') && child.name.endsWith('-' + state.controller.session + '.jsonl')) files.push(file);
      requireCondition(files.length <= MAX_FILES, 'acknowledgement-source-unavailable', 'Native history has too many candidate files');
    }
  };
  walk(directory, 0);
  return files;
}

function readAt(descriptor, position, length) {
  const buffer = Buffer.alloc(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(descriptor, buffer, read, length - read, position + read);
    if (count === 0) break;
    read += count;
  }

  return buffer.subarray(0, read);
}

// The complete lines of bytes read from offset onward, each with its byte offset in the file. A final line without its newline is
// still being written and is left out. Each line must be valid UTF-8; a newline byte never falls inside a UTF-8 sequence.
function completeLines(bytes, offset) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const lines = [];
  let start = 0;
  for (let end = bytes.indexOf(10); end !== -1; start = end + 1, end = bytes.indexOf(10, start)) {
    const line = decoder.decode(bytes.subarray(start, end)).replace(/\r$/, '');
    if (line) lines.push({ line, offset: offset + start });
  }

  return lines;
}

// The rows of a native history at the size observed when it is opened, so later appends are not read. A file within the window is read
// whole; a larger one by its final window, from the first line that starts inside it, and for Codex also by its first line, whose
// session attribution precedes the window. Each complete line read is decoded strictly, and the first three bytes are checked for a BOM;
// an unfinished final line and the partial line before the window are not decoded.
function sourceRows(file, profile, { codex = false, windowBytes = WINDOW_BYTES, firstLineBytes = FIRST_LINE_BYTES } = {}) {
  const canonical = fs.realpathSync.native(file);
  const relative = path.relative(profile, canonical);
  const stat = fs.lstatSync(file);
  requireCondition(canonical === file && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'acknowledgement-source-unavailable', 'Native history must be an ordinary file in the selected profile');
  const descriptor = fs.openSync(file, 'r');
  let lines;
  try {
    const size = fs.fstatSync(descriptor).size;
    const opening = readAt(descriptor, 0, Math.min(3, size));
    requireCondition(!(opening[0] === 239 && opening[1] === 187 && opening[2] === 191), 'acknowledgement-source-unavailable', 'Native history has an unsupported BOM');
    if (size <= windowBytes) lines = completeLines(readAt(descriptor, 0, size), 0);
    else {
      const start = size - windowBytes;
      const window = readAt(descriptor, start, windowBytes);
      const first = window.indexOf(10);
      lines = first === -1 ? [] : completeLines(window.subarray(first + 1), start + first + 1);
      if (codex) {
        const head = readAt(descriptor, 0, Math.min(firstLineBytes, size));
        const end = head.indexOf(10);
        requireCondition(end !== -1, 'acknowledgement-source-unavailable', `Native history's first line exceeds its ${firstLineBytes}-byte bound`);
        // The window always starts after the first line's start, so the first line is never read twice.
        lines.unshift(...completeLines(head.subarray(0, end + 1), 0));
      }
    }
  } finally { fs.closeSync(descriptor); }

  return lines.map(({ line, offset }) => ({ row: JSON.parse(line), offset, hash: createHash('sha256').update(line).digest('hex') }));
}

function sameProject(value, root) {
  if (typeof value !== 'string') return false;
  try { return fs.realpathSync.native(value) === root; } catch { return false; }
}

function assistantMessages(rows, state) {
  const actor = state.controller;
  if (actor.host === 'codex') {
    const metadata = rows.find(item => item.row.type === 'session_meta')?.row.payload;
    requireCondition(metadata?.id === actor.session && sameProject(metadata.cwd, state.root), 'acknowledgement-source-unavailable', 'Codex history has no matching native session and project attribution');
  }
  return rows.flatMap(item => {
    const row = item.row;
    let content;
    let id;
    if (actor.host === 'claude') {
      if (row.type !== 'assistant' || row.sessionId !== actor.session || row.isSidechain === true || row.message?.role !== 'assistant' || typeof row.message.model !== 'string' || row.message.model === '<synthetic>' || !sameProject(row.cwd, state.root)) return [];
      content = row.message.content?.filter(block => block.type === 'text').map(block => block.text).join('\n');
      id = row.uuid;
    } else {
      const message = row.payload;
      if (row.type !== 'response_item' || message?.type !== 'message' || message.role !== 'assistant' || !visible.has(message.phase ?? message.channel)) return [];
      content = message.content?.filter(block => block.type === 'output_text').map(block => block.text).join('\n');
      // A line's byte offset stays the same as the file grows, whichever part of it a read covers.
      id = typeof message.id === 'string' ? message.id : 'offset:' + item.offset;
    }
    return typeof content === 'string' && content.length <= 65536 && typeof id === 'string' && typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)) ? [{ text: content, emittedAt: row.timestamp, id, hash: item.hash }] : [];
  });
}

// bounds overrides the read window and first-line bound, so fixtures can stand in for oversized histories.
function readAcknowledgementFromProfile(state, profile, bounds = {}) {
  try {
    const files = sourceFiles(profile, state);
    requireCondition(files.length > 0, 'acknowledgement-source-unavailable', 'The owning native session history is unavailable');
    const boundary = Math.max(Date.parse(state.acknowledgement.renewedAt), Date.parse(state.acknowledgement.requiredAfter));
    const failed = state.continuation.verified !== true;
    for (const file of files) {
      const rows = sourceRows(file, profile, { ...bounds, codex: state.controller.host === 'codex' });
      const message = assistantMessages(rows, state).find(message => Date.parse(message.emittedAt) > boundary && acknowledgementText(message.text, failed));
      if (!message) continue;
      return { runId: state.id, controller: { ...state.controller }, scopeHash: state.acknowledgement.scopeHash, renewalRevision: state.acknowledgement.renewalRevision, outcomeIdentity: state.acknowledgement.outcomeIdentity, emittedAt: message.emittedAt, observedAt: new Date().toISOString(), text: message.text, failedContinuation: failed, source: { host: state.controller.host, session: state.controller.session, path: file, messageId: message.id, eventSha256: message.hash } };
    }
    return null;
  } catch (error) {
    requireCondition(false, 'acknowledgement-source-unavailable', 'Cannot establish native acknowledgement output: ' + String(error.message).slice(0, 1200));
  }
}

function observeAcknowledgement(state, context) {
  try { return readAcknowledgementFromProfile(state, nativeProfile(state, context)); }
  catch (error) { requireCondition(false, 'acknowledgement-source-unavailable', 'Cannot establish native acknowledgement output: ' + String(error.message).slice(0, 1200)); }
}

module.exports = { assistantMessages, observeAcknowledgement, readAcknowledgementFromProfile, sourceFiles, sourceRows };
