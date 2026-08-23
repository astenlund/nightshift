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
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
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
    if (fence === null && fenceMatch) {
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

function detectHardWraps(text) {
  return scanWraps(splitLines(text).lines);
}

function unwrapText(text) {
  const { bom, lines, endings } = splitLines(text);
  const continuation = new Set(scanWraps(lines).map((wrap) => wrap.line - 1));
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (continuation.has(index)) {
      const last = output[output.length - 1];
      last.text = `${last.text.replace(/\s+$/, '')} ${lines[index].trim()}`;
      last.ending = endings[index];
    } else {
      output.push({ text: lines[index], ending: endings[index] });
    }
  }

  return bom + output.map((line) => line.text + line.ending).join('');
}

// The directories under .claude/ that hold backlog prose. Anything else in a
// .claude/ tree (plans, host commands, agents, skills, rules) is out of scope.
const BACKLOG_DIRECTORIES = ['features', 'bugs', 'patterns'];

function sortedEntries(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

// A directory target is read as a backlog root: its top-level markdown files
// plus everything under the backlog directories, following links. A file
// target is taken when it is markdown.
function collectMarkdownFiles(targets) {
  const files = [];
  const isMarkdown = (name) => path.extname(name).toLowerCase() === '.md';
  const visitAll = (directory) => {
    for (const entry of sortedEntries(directory)) {
      const child = path.join(directory, entry.name);
      if (fs.statSync(child).isDirectory()) {
        visitAll(child);
      } else if (isMarkdown(entry.name)) {
        files.push(child);
      }
    }
  };
  const visitBacklogRoot = (root) => {
    for (const entry of sortedEntries(root)) {
      const child = path.join(root, entry.name);
      const stat = fs.statSync(child);
      if (stat.isDirectory() && BACKLOG_DIRECTORIES.includes(entry.name)) {
        visitAll(child);
      } else if (stat.isFile() && isMarkdown(entry.name)) {
        files.push(child);
      }
    }
  };
  for (const target of targets) {
    const resolved = path.resolve(target);
    if (fs.statSync(resolved).isDirectory()) {
      visitBacklogRoot(resolved);
    } else if (isMarkdown(resolved)) {
      files.push(resolved);
    }
  }

  return files;
}

function runCli(argv) {
  const write = argv.includes('--write');
  const targets = argv.filter((arg) => arg !== '--write');
  if (targets.length === 0) {
    process.stderr.write('usage: node unwrap.js [--write] <file-or-directory>...\n');
    process.exitCode = 2;
    return;
  }
  const missing = targets.find((target) => !fs.existsSync(target));
  if (missing !== undefined) {
    process.stderr.write(`unwrap.js: no such file or directory: ${missing}\n`);
    process.exitCode = 2;
    return;
  }
  const report = [];
  for (const file of collectMarkdownFiles(targets)) {
    const text = fs.readFileSync(file, 'utf8');
    const wraps = detectHardWraps(text);
    if (wraps.length === 0) continue;
    report.push({ file, wraps: wraps.length, firstLine: wraps[0].line, rewritten: write });
    if (write) {
      fs.writeFileSync(file, unwrapText(text));
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.length > 0 && !write ? 1 : 0;
}

module.exports = { LABEL_AT_START, detectHardWraps, unwrapText, collectMarkdownFiles };

if (require.main === module) {
  runCli(process.argv.slice(2));
}
