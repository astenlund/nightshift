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
// frontmatter, fenced code, tables, and block quotes. Headings, list markers,
// blank lines, and bold `**Label:**` lines start new blocks. A line ending in
// two spaces or a backslash asks for a hard break and is never joined. A
// column-zero line after a list item is a separate block: the ready parser
// ends a bullet at column zero, so joining there would change what it reads.

const fs = require('node:fs');
const path = require('node:path');

const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/;
const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEADING = /^#{1,6}\s/;
const TABLE_ROW = /^\s*\|/;
const BLOCK_QUOTE = /^\s*>/;
const THEMATIC_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const HARD_BREAK = /(?: {2,}|\\)$/;
// Mirrors the ready parser's LABEL_AT_START terminator: a **Label:** line
// starts a new block, so **Requires:** and **External:** keep their own lines.
const LABEL_AT_START = /^\*\*[^*]+?:\*\*/;

function splitLines(text) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);

  return { lines, newline };
}

function frontmatterEnd(lines) {
  if (lines[0] !== '---') {
    return -1;
  }
  const close = lines.findIndex((line, index) => index > 0 && line === '---');

  return close;
}

function classify(line) {
  if (line.trim() === '') return 'blank';
  if (HEADING.test(line)) return 'heading';
  if (THEMATIC_BREAK.test(line)) return 'break';
  if (TABLE_ROW.test(line)) return 'table';
  if (BLOCK_QUOTE.test(line)) return 'quote';
  if (LIST_MARKER.test(line)) return 'list-item';
  if (LABEL_AT_START.test(line.trim())) return 'label';
  if (/^\s+\S/.test(line)) return 'indented';

  return 'paragraph';
}

// Walks the lines and reports, per physical line, whether it continues the
// block started on the previous line. Returns 1-based line numbers.
function scanWraps(lines) {
  const wraps = [];
  const frontmatterClose = frontmatterEnd(lines);
  let fence = null;
  let previous = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (index <= frontmatterClose) {
      previous = null;
      continue;
    }
    const fenceMatch = FENCE.exec(line);
    if (fence === null && fenceMatch) {
      fence = fenceMatch[1][0];
      previous = null;
      continue;
    }
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1][0] === fence && line.trim() === fenceMatch[1]) {
        fence = null;
      }
      previous = null;
      continue;
    }
    const kind = classify(line);
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
  const { lines, newline } = splitLines(text);
  const continuation = new Set(scanWraps(lines).map((wrap) => wrap.line - 1));
  const output = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (continuation.has(index)) {
      output[output.length - 1] = `${output[output.length - 1].replace(/\s+$/, '')} ${lines[index].trim()}`;
    } else {
      output.push(lines[index]);
    }
  }

  return output.join(newline);
}

function collectMarkdownFiles(targets) {
  const files = [];
  const visit = (target) => {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
        visit(path.join(target, entry.name));
      }
    } else if (path.extname(target).toLowerCase() === '.md') {
      files.push(target);
    }
  };
  for (const target of targets) {
    visit(path.resolve(target));
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

module.exports = { detectHardWraps, unwrapText, collectMarkdownFiles };

if (require.main === module) {
  runCli(process.argv.slice(2));
}
