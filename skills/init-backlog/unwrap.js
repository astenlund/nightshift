#!/usr/bin/env node
'use strict';

// Backlog prose is one paragraph or one bullet per physical line. This module
// finds hard-wrapped continuation lines in backlog markdown and joins them,
// so init-backlog can repair an existing backlog and ready can report one.
//
//   node unwrap.js [--write] <file-or-directory>...
//
// Without --write it prints a JSON report and exits 1 when any file carries a
// hard wrap; with --write it rewrites the offending files in place and exits 0.
// A file that cannot be read is reported with its error code and exits 1
// either way.
//
// A continuation line is a non-blank line that directly follows a paragraph
// line or an indented line that directly follows a list item, outside YAML
// frontmatter, fenced and indented code, HTML blocks, tables, and block
// quotes. Headings (ATX and setext), list markers, blank lines, and bold
// `**Label:**` lines start new blocks. A line ending in two spaces or a
// backslash asks for a hard break and is never joined. A column-zero line
// after a list item is a separate block: the ready parser ends a bullet at
// column zero, so joining there would change what it reads. Every line keeps
// its own ending, and a leading byte-order mark survives the rewrite.

const fs = require('node:fs');
const path = require('node:path');

const BOM = String.fromCharCode(0xfeff);
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}\s/;
const SETEXT_UNDERLINE = /^\s{0,3}(?:=+|-+)\s*$/;
const TABLE_ROW = /^\s*\|/;
// A GFM delimiter row with at least one pipe; the row above it is the header.
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/;
const BLOCK_QUOTE = /^\s*>/;
const THEMATIC_BREAK = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const HTML_COMMENT_OPEN = /^\s{0,3}<!--/;
const HTML_COMMENT_CLOSE = /-->/;
const HTML_BLOCK_START = /^\s{0,3}<(?:\/?[a-zA-Z][\w-]*(?:\s|\/?>|$)|[?!])/;
const HARD_BREAK = /(?: {2,}|\\)$/;
// A **Label:** line starts a new block, so **Requires:** and **External:**
// keep their own lines; the ready parser imports this as its label terminator.
const LABEL_AT_START = /^\*\*[^*]+?:\*\*/;
// The files and directories under .claude/ that hold backlog prose. Anything
// else in a .claude/ tree (plans, host instruction files, commands, agents,
// skills, rules) is out of scope.
const BACKLOG_FILES = ['QUICK_WINS.md', 'FEATURES.md', 'BUGS.md', 'PATTERNS.md', 'QUICK_WINS_HISTORY.md', 'FEATURES_HISTORY.md', 'BUGS_HISTORY.md'];
const BACKLOG_DIRECTORIES = ['features', 'bugs', 'patterns'];

function splitLines(text) {
  const bom = text.startsWith(BOM) ? BOM : '';
  const raw = text.slice(bom.length).split('\n');
  const lines = raw.map((line) => line.replace(/\r$/, ''));
  const endings = raw.map((line, index) => (index === raw.length - 1 ? '' : line.endsWith('\r') ? '\r\n' : '\n'));

  return { bom, lines, endings };
}

function frontmatterEnd(lines) {
  if (lines[0] !== '---') {
    return -1;
  }
  const close = lines.findIndex((line, index) => index > 0 && line === '---');

  return close;
}

// Block starts under a list item are measured from the item's content, so the
// caller passes the line with its indentation stripped as the probe there.
function classify(line, probe) {
  if (line.trim() === '') return 'blank';
  if (HEADING.test(probe)) return 'heading';
  if (THEMATIC_BREAK.test(probe)) return 'break';
  if (TABLE_ROW.test(line)) return 'table';
  if (BLOCK_QUOTE.test(line)) return 'quote';
  if (LIST_MARKER.test(line)) return 'list-item';
  if (LABEL_AT_START.test(line.trim())) return 'label';
  if (/^\s+\S/.test(line)) return 'indented';

  return 'paragraph';
}

// Tracks the multi-line constructs whose interior is never joined. Takes the
// open block, the probe (see classify), and the previous physical line (a
// table header sits there). Returns true while the line belongs to one of them.
function createBlockTracker() {
  let fence = null;
  let inHtml = false;
  let inComment = false;
  let inIndentedCode = false;
  let inTable = false;

  return (line, previous, probe, lastLine) => {
    const blank = line.trim() === '';
    if (inComment) {
      inComment = !HTML_COMMENT_CLOSE.test(line);

      return true;
    }
    if (inHtml || inTable) {
      inHtml = inHtml && !blank;
      inTable = inTable && !blank;

      return !blank;
    }
    if (inIndentedCode) {
      inIndentedCode = blank || INDENTED_CODE.test(line);
      if (inIndentedCode) return true;
    }
    if (previous === null && INDENTED_CODE.test(line)) {
      inIndentedCode = true;

      return true;
    }
    const fenceMatch = FENCE.exec(probe);
    // CommonMark forbids a backtick anywhere in a backtick fence's info
    // string, so such a line opens no fence. This mirrors fenceOpener in
    // skills/spec-agreement/spec-agreement.js, the shared markdown scanner
    // that ready.js reads through scanMarkdown; without the rule the two
    // parsers classify the same lines differently around such a line.
    if (fence === null && fenceMatch && !(fenceMatch[1][0] === '`' && fenceMatch[2].includes('`'))) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };

      return true;
    }
    if (fence !== null) {
      const closer = FENCE.exec(line.trimStart());
      if (closer && closer[1][0] === fence.char && closer[1].length >= fence.length && line.trim() === closer[1]) {
        fence = null;
      }

      return true;
    }
    if (HTML_COMMENT_OPEN.test(probe)) {
      inComment = !HTML_COMMENT_CLOSE.test(line);

      return true;
    }
    if (HTML_BLOCK_START.test(probe)) {
      inHtml = true;

      return true;
    }
    if (TABLE_DELIMITER.test(line) && lastLine !== null && lastLine.includes('|')) {
      inTable = true;

      return true;
    }

    return false;
  };
}

// Walks the lines and reports, per physical line, whether it continues the
// block started on the previous line. Returns 1-based line numbers.
function scanWraps(lines) {
  const wraps = [];
  const frontmatterClose = frontmatterEnd(lines);
  const insideBlock = createBlockTracker();
  let previous = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index <= frontmatterClose) {
      previous = null;
      continue;
    }
    const probe = previous?.kind === 'paragraph' ? line : line.trimStart();
    if (insideBlock(line, previous, probe, index > 0 ? lines[index - 1] : null)) {
      // A table header is the line above its delimiter row; it is never a
      // continuation of the paragraph above it.
      if (TABLE_DELIMITER.test(line) && wraps.length > 0 && wraps[wraps.length - 1].line === index) {
        wraps.pop();
      }
      previous = null;
      continue;
    }
    const kind = classify(line, probe);
    if (previous?.kind === 'paragraph' && SETEXT_UNDERLINE.test(line)) {
      previous = null;
      continue;
    }
    const continuesParagraph = previous?.kind === 'paragraph' && (kind === 'paragraph' || kind === 'indented');
    const continuesListItem = previous?.kind === 'list-item' && kind === 'indented';
    if ((continuesParagraph || continuesListItem) && !HARD_BREAK.test(previous.line)) {
      wraps.push({ line: index + 1, kind: continuesListItem ? 'list-item' : 'paragraph' });
      previous = { kind: previous.kind, line };
      continue;
    }
    previous = kind === 'blank' || kind === 'heading' || kind === 'break' || kind === 'table' || kind === 'quote'
      ? null
      : { kind: kind === 'indented' || kind === 'label' ? 'paragraph' : kind, line };
  }

  return wraps;
}

// Private single-scan core: one splitLines + scanWraps pass per text, shared
// by detection and repair so a caller needing both never scans twice.
function analyzeText(text) {
  const { bom, lines, endings } = splitLines(text);

  return { bom, lines, endings, wraps: scanWraps(lines) };
}

function joinContinuations({ bom, lines, endings, wraps }) {
  const continuation = new Set(wraps.map((wrap) => wrap.line - 1));
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (continuation.has(index)) {
      const last = output[output.length - 1];
      const next = lines[index].trimStart();
      // A two-space hard break on the joined line still ends it, so keep it.
      const tail = / {2,}$/.test(next) ? `${next.trimEnd()}  ` : next.trimEnd();
      last.text = `${last.text.replace(/\s+$/, '')} ${tail}`;
      last.ending = endings[index];
    } else {
      output.push({ text: lines[index], ending: endings[index] });
    }
  }

  return bom + output.map((line) => line.text + line.ending).join('');
}

function detectHardWraps(text) {
  return analyzeText(text).wraps;
}

function unwrapText(text) {
  return joinContinuations(analyzeText(text));
}

class CatalogError extends TypeError {}

function compareTargets(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPortableComponent(component) {
  if (component.length === 0 || /[<>:"|?*]/.test(component) || /[. ]$/.test(component)) {
    return false;
  }
  for (const character of component) {
    if (character.charCodeAt(0) < 32) {
      return false;
    }
  }

  return !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(component.split('.')[0]);
}

function isCatalogTarget(target) {
  if (typeof target !== 'string' || target.length === 0 || target.startsWith('/') || target.includes('\\') || !target.toLowerCase().endsWith('.md')) {
    return false;
  }
  const parts = target.split('/');
  if (!parts.every(isPortableComponent)) {
    return false;
  }
  if (parts.length === 1) {
    return BACKLOG_FILES.includes(target);
  }

  return BACKLOG_DIRECTORIES.includes(parts[0]);
}

// Validates the controller-owned, root-relative markdown catalog. Catalog
// records intentionally hold no filesystem identity, so every consumer can
// analyze one stable snapshot without reaching back to disk.
function normalizeCatalogItems(items) {
  if (!Array.isArray(items)) {
    throw new CatalogError('catalog items must be an array');
  }
  const targets = new Set();
  const normalized = items.map((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'target') || !Object.hasOwn(item, 'contents')) {
      throw new CatalogError('catalog items must be exact { target, contents } records');
    }
    if (!isCatalogTarget(item.target)) {
      throw new CatalogError(`invalid catalog target: ${String(item.target)}`);
    }
    if (typeof item.contents !== 'string') {
      throw new CatalogError(`catalog contents must be a string for ${item.target}`);
    }
    if (targets.has(item.target)) {
      throw new CatalogError(`duplicate catalog target: ${item.target}`);
    }
    targets.add(item.target);

    return { target: item.target, contents: item.contents };
  });

  return normalized.sort((left, right) => compareTargets(left.target, right.target));
}

// Pure controller adapter: predict each catalog file's unwrap result without
// discovery or any filesystem access. The sorted output is also a stable
// catalog for a later ready analysis.
function analyzeUnwrapCatalog(items) {
  return normalizeCatalogItems(items).map(({ target, contents }) => {
    const analysis = analyzeText(contents);

    return { target, wraps: analysis.wraps, contents: joinContinuations(analysis) };
  });
}

function sortedEntries(directory) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => compareTargets(a.name, b.name));
  } catch (error) {
    const code = error?.code ?? 'unknown';
    const wrapped = new CatalogError(`cannot enumerate backlog directory ${directory} (${code})`, { cause: error });
    wrapped.code = code;

    throw wrapped;
  }
}

// The on-disk identity of a path: links resolved and, on case-insensitive
// filesystems, the stored casing. Falls back to the resolved path when the
// target cannot be reached, so a comparison never throws.
function canonicalPath(target) {
  try {
    return fs.realpathSync.native(target);
  } catch {
    // Dangling link, permission error, or a loop: the resolved spelling is the best identity available.
    return path.resolve(target);
  }
}

// A path entry that cannot be stat'ed (dangling link, a link loop, a
// permission error) is skipped; the walk never throws on one entry.
function statOrNull(target) {
  try {
    return fs.statSync(target);
  } catch {
    // Unreachable entries are out of scope rather than fatal.
    return null;
  }
}

function isContainedPath(root, target) {
  const relative = path.relative(root, target);

  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function canonicalBacklogRootIdentity(root) {
  const resolved = path.resolve(root);
  const authority = canonicalPath(path.dirname(resolved));
  const identity = canonicalPath(resolved);

  return isContainedPath(authority, identity) ? identity : null;
}

// A directory target is read as a backlog root: the seven backlog files at its
// top level plus everything under the backlog directories, following contained
// links once and skipping dangling or escaping ones. A file target is taken when
// it is markdown. This private collector consumes targets already statted by its
// caller so the CLI can report missing inputs without repeating filesystem work.
function collectMarkdownFilesFromStattedTargets(targets) {
  const files = [];
  const visitedDirectories = new Set();
  const isMarkdown = (name) => path.extname(name).toLowerCase() === '.md';
  const addMarkdown = (rootIdentity, target, name) => {
    if (isMarkdown(name) && isContainedPath(rootIdentity, canonicalPath(target))) files.push(target);
  };
  const visitAll = (directory, rootIdentity) => {
    const identity = canonicalPath(directory);
    if (!isContainedPath(rootIdentity, identity)) return;
    if (visitedDirectories.has(identity)) return;
    visitedDirectories.add(identity);
    for (const entry of sortedEntries(directory)) {
      const child = path.join(directory, entry.name);
      const stat = statOrNull(child);
      if (stat === null) continue;
      if (stat.isDirectory()) {
        visitAll(child, rootIdentity);
      } else {
        addMarkdown(rootIdentity, child, entry.name);
      }
    }
  };
  const visitBacklogRoot = (root) => {
    const rootIdentity = canonicalBacklogRootIdentity(root);
    if (rootIdentity === null) {
      throw new CatalogError(`backlog root escapes its repository authority: ${root}`);
    }
    visitedDirectories.add(rootIdentity);
    for (const entry of sortedEntries(root)) {
      const child = path.join(root, entry.name);
      const stat = statOrNull(child);
      if (stat === null) continue;
      if (stat.isDirectory() && BACKLOG_DIRECTORIES.includes(entry.name)) {
        visitAll(child, rootIdentity);
      } else if (stat.isFile() && BACKLOG_FILES.includes(entry.name)) {
        addMarkdown(rootIdentity, child, entry.name);
      }
    }
  };
  for (const target of targets) {
    const resolved = path.resolve(target.path);
    const stat = target.stat;
    if (stat.isDirectory()) {
      visitBacklogRoot(resolved);
    } else {
      addMarkdown(canonicalPath(path.dirname(resolved)), resolved, resolved);
    }
  }

  return files;
}

function collectMarkdownFiles(targets) {
  if (!Array.isArray(targets) || targets.some((target) => typeof target !== 'string')) {
    throw new TypeError('collectMarkdownFiles targets must be path strings');
  }
  const statted = targets.map((target) => {
    const resolved = path.resolve(target);

    return { path: resolved, stat: fs.statSync(resolved) };
  });

  return collectMarkdownFilesFromStattedTargets(statted);
}

function runCli(argv) {
  const write = argv.includes('--write');
  const targets = argv.filter((arg) => arg !== '--write');
  if (targets.length === 0) {
    process.stderr.write('usage: node unwrap.js [--write] <file-or-directory>...\n');
    process.exitCode = 2;
    return;
  }
  const statted = targets.map((target) => ({ path: target, stat: statOrNull(path.resolve(target)) }));
  const missing = statted.find((entry) => entry.stat === null);
  if (missing !== undefined) {
    process.stderr.write(`unwrap.js: no such file or directory: ${missing.path}\n`);
    process.exitCode = 2;
    return;
  }
  const report = [];
  let files;
  try {
    files = collectMarkdownFilesFromStattedTargets(statted);
  } catch (error) {
    if (!(error instanceof CatalogError)) throw error;
    process.stderr.write(`unwrap.js: ${error.message}\n`);
    process.exitCode = 2;

    return;
  }
  for (const file of files) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (error) {
      report.push({ file, error: error?.code ?? 'unknown' });
      continue;
    }
    const analysis = analyzeText(text);
    const wraps = analysis.wraps;
    if (wraps.length === 0) continue;
    report.push({ file, wraps: wraps.length, firstLine: wraps[0].line, rewritten: write });
    if (write) {
      fs.writeFileSync(file, joinContinuations(analysis));
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  const unreadable = report.some((entry) => entry.error !== undefined);
  process.exitCode = unreadable || (report.length > 0 && !write) ? 1 : 0;
}

module.exports = { LABEL_AT_START, CatalogError, canonicalBacklogRootIdentity, canonicalPath, compareTargets, detectHardWraps, unwrapText, collectMarkdownFiles, isContainedPath, normalizeCatalogItems, analyzeUnwrapCatalog };

if (require.main === module) {
  runCli(process.argv.slice(2));
}
