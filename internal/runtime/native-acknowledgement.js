'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { requireCondition } = require('./errors');
const { UUID } = require('./record-ids');
const { acknowledgementText } = require('./acknowledgement');

const MAX_BYTES = 64 * 1024 * 1024;
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

function sourceRows(file, profile) {
  const canonical = fs.realpathSync.native(file);
  const relative = path.relative(profile, canonical);
  const stat = fs.lstatSync(file);
  requireCondition(canonical === file && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative) && stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= MAX_BYTES, 'acknowledgement-source-unavailable', 'Native history must be a bounded ordinary file in the selected profile');
  const bytes = fs.readFileSync(file);
  requireCondition(bytes.length <= MAX_BYTES && !(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191), 'acknowledgement-source-unavailable', 'Native history is oversized or has an unsupported BOM');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const lines = text.split(/\r?\n/);
  if (!text.endsWith('\n')) lines.pop();
  return lines.filter(Boolean).map((line, ordinal) => ({ row: JSON.parse(line), ordinal, hash: createHash('sha256').update(line).digest('hex') }));
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
      id = typeof message.id === 'string' ? message.id : 'ordinal:' + item.ordinal;
    }
    return typeof content === 'string' && content.length <= 65536 && typeof id === 'string' && typeof row.timestamp === 'string' && Number.isFinite(Date.parse(row.timestamp)) ? [{ text: content, emittedAt: row.timestamp, id, hash: item.hash }] : [];
  });
}

function readAcknowledgementFromProfile(state, profile) {
  try {
    const files = sourceFiles(profile, state);
    requireCondition(files.length > 0, 'acknowledgement-source-unavailable', 'The owning native session history is unavailable');
    const boundary = Math.max(Date.parse(state.acknowledgement.renewedAt), Date.parse(state.acknowledgement.requiredAfter));
    const failed = state.continuation.verified !== true;
    for (const file of files) {
      const rows = sourceRows(file, profile);
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
