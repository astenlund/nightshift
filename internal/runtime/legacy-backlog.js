'use strict';

const fs = require('node:fs');
const { stableOpenFile } = require('../filesystem-primitives');
const { extractLinks, headingPositions, resolveLink } = require('../backlog-links');
const { describeBlocks } = require('../backlog-catalog');
const { relativePath } = require('../releases/io');
const { projectFile } = require('./evidence');
const { requireCondition } = require('./errors');
const { sha256 } = require('./legacy-store');

const ACTIVE_INDEXES = new Set(['.nightshift/FEATURES.md', '.nightshift/BUGS.md', '.nightshift/QUICK_WINS.md', '.nightshift/PATTERNS.md']);
const ACTIVE_RECORD_DIRECTORIES = ['.nightshift/features/', '.nightshift/bugs/', '.nightshift/patterns/'];
const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_TARGET_READ_BYTES = 16 * 1024 * 1024;
const lf = String.fromCharCode(10);
const cr = String.fromCharCode(13);

function activeBacklogPath(relative) {
  return ACTIVE_INDEXES.has(relative) || ACTIVE_RECORD_DIRECTORIES.some(directory => relative.startsWith(directory) && relative.endsWith('.md'));
}

function backlogDestinationPath(destination) {
  if (!destination || typeof destination.path !== 'string' || !(destination.anchor === null || typeof destination.anchor === 'string' && destination.anchor.length > 0)) return null;
  let relative;
  try { relative = relativePath(destination.path); }
  catch { return null; }
  if (!activeBacklogPath(relative) || destination.anchor === null && ACTIVE_INDEXES.has(relative)) return null;

  return relative;
}

function targetBytes(root, relative, budget) {
  const target = projectFile(root, relative);
  const cached = budget.cache.get(relative);
  const remaining = budget.maximum - budget.bytes;
  requireCondition(remaining >= 0, 'migration-target-bound', 'Backlog target reads exceed their aggregate bound');
  let opened;
  try { opened = stableOpenFile(root, target, { requireSingleLink: true, maxBytes: remaining }); }
  catch (error) { requireCondition(false, error.code === 'file-too-large' ? 'migration-target-bound' : 'migration-followup-target-unavailable', `Backlog target ${relative} is unavailable: ${error.message}`); }
  budget.bytes += opened.bytes.length;
  if (cached) requireCondition(cached.bytes === opened.bytes.length && cached.sha256 === opened.rawSha256, 'migration-followup-target-unavailable', `Backlog target ${relative} changed during migration inspection`);
  else budget.cache.set(relative, { bytes: opened.bytes.length, sha256: opened.rawSha256 });

  return opened.bytes;
}

function decoded(bytes) {
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { requireCondition(false, 'migration-followup-target-unavailable', 'Tracked backlog target is not valid UTF-8'); }

  return content;
}

function normalized(bytes) {
  return decoded(bytes).replaceAll(cr + lf, lf).replaceAll(cr, lf);
}

function readyLineStarts(bytes, content) {
  const starts = [content.startsWith(String.fromCodePoint(0xFEFF)) ? 3 : 0];
  for (let index = starts[0]; index < bytes.length; index++) {
    if (bytes[index] === 10) starts.push(index + 1);
  }

  return starts;
}

function reachableRecord(root, target, budget) {
  const queue = [];
  const seen = new Set();
  for (const index of ACTIVE_INDEXES) {
    if (fs.lstatSync(projectFile(root, index), { throwIfNoEntry: false })) queue.push(index);
  }
  while (queue.length > 0) {
    const source = queue.shift();
    if (seen.has(source)) continue;
    seen.add(source);
    for (const link of extractLinks(decoded(targetBytes(root, source, budget)))) {
      const resolved = resolveLink(source.slice('.nightshift/'.length), link.raw);
      if (!resolved) continue;
      const linked = `.nightshift/${resolved.file}`;
      if (!activeBacklogPath(linked)) continue;
      if (linked === target) return true;
      if (seen.has(linked)) continue;
      if (fs.lstatSync(projectFile(root, linked), { throwIfNoEntry: false })) queue.push(linked);
    }
  }

  return false;
}

function targetEntry(root, destination, budget = { bytes: 0, maximum: MAX_TARGET_READ_BYTES, cache: new Map() }) {
  root = fs.realpathSync.native(root);
  const relative = backlogDestinationPath(destination);
  requireCondition(relative !== null, 'migration-followup-target-unavailable', 'Tracked follow-up destination needs a safe active backlog path and optional heading');
  requireCondition(budget.cache instanceof Map && Number.isSafeInteger(budget.bytes) && Number.isSafeInteger(budget.maximum), 'migration-followup-target-unavailable', 'Tracked follow-up read budget is malformed');
  const bytes = targetBytes(root, relative, budget);
  const content = decoded(bytes);
  if (!ACTIVE_INDEXES.has(relative)) requireCondition(reachableRecord(root, relative, budget), 'migration-followup-target-unavailable', 'Tracked backlog record is not reachable from an active index');
  const document = describeBlocks(content);
  requireCondition(!document.unclosedFence, 'migration-followup-target-unavailable', 'Tracked backlog target has an unclosed fence');
  let entry = bytes;
  if (destination.anchor !== null) {
    const headings = headingPositions(content);
    const lineStarts = readyLineStarts(bytes, content);
    const position = headings.findIndex(heading => heading.anchor === destination.anchor.toLowerCase());
    requireCondition(position >= 0, 'migration-followup-target-unavailable', 'Tracked backlog heading is missing or unsupported');
    const current = headings[position];
    const next = headings.slice(position + 1).find(heading => heading.level <= current.level);
    const start = lineStarts[current.line - 1];
    const end = next ? lineStarts[next.line - 1] : bytes.length;
    requireCondition(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start < end, 'migration-followup-target-unavailable', 'Tracked backlog heading offsets are unavailable');
    entry = bytes.subarray(start, end);
  }
  requireCondition(entry.length > 0 && entry.length <= MAX_ENTRY_BYTES, 'migration-followup-target-unavailable', 'Tracked backlog entry exceeds its byte bound');

  return { path: relative, anchor: destination.anchor, entryHash: sha256(Buffer.from(normalized(entry), 'utf8')) };
}

module.exports = { MAX_ENTRY_BYTES, MAX_TARGET_READ_BYTES, backlogDestinationPath, targetEntry };
