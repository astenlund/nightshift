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
const HEADING = /^#{1,6}\s/;
const SETEXT_UNDERLINE = /^\s{0,3}(?:=+|-+)\s*$/;
const TABLE_ROW = /^\s*\|/;
// A GFM delimiter row with at least one pipe; the row above it is the header.
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)+\|?\s*$/;
const BLOCK_QUOTE = /^\s*>/;
const THEMATIC_BREAK = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const INDENTED_CODE = /^(?: {4}|\t)/;
const HTML_COMMENT_OPEN = /^\s{0,3}<!--/;
const HTML_COMMENT_CLOSE = /-->/;
const HTML_BLOCK_START = /^\s{0,3}<(?:\/?[a-zA-Z][\w-]*(?:\s|\/?>|$)|[?!])/;
const HARD_BREAK = /(?: {2,}|\\)$/;
// Mirrors the ready parser's LABEL_AT_START terminator: a **Label:** line
// starts a new block, so **Requires:** and **External:** keep their own lines.
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

function classify(line) {
  if (line.trim() === '') return 'blank';
  if (HEADING.test(line)) return 'heading';
  if (THEMATIC_BREAK.test(line)) return 'break';
  if (TABLE_ROW.test(line)) return 'table';
  if (BLOCK_QUOTE.test(line)) return 'quote';
  if (HTML_COMMENT_OPEN.test(line) || HTML_BLOCK_START.test(line)) return 'html';
  if (LIST_MARKER.test(line)) return 'list-item';
  if (LABEL_AT_START.test(line.trim())) return 'label';
  if (/^\s+\S/.test(line)) return 'indented';

  return 'paragraph';
}

// Tracks the multi-line constructs whose interior is never joined. Returns
// true while the line belongs to one of them.
function createBlockTracker() {
  let fence = null;
  let inHtml = false;
  let inComment = false;
  let inIndentedCode = false;
  let inTable = false;

  return (line, previous) => {
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
    const fenceMatch = FENCE.exec(line);
    if (fence === null && fenceMatch) {
      fence = fenceMatch[1][0];

      return true;
    }
    if (fence !== null) {
      if (fenceMatch && fenceMatch[1][0] === fence && line.trim() === fenceMatch[1]) {
        fence = null;
      }

      return true;
    }
    if (HTML_COMMENT_OPEN.test(line)) {
      inComment = !HTML_COMMENT_CLOSE.test(line);

      return true;
    }
    if (HTML_BLOCK_START.test(line)) {
      inHtml = true;

      return true;
    }
    if (previous === null && INDENTED_CODE.test(line)) {
      inIndentedCode = true;

      return true;
    }
    if (TABLE_DELIMITER.test(line) && previous !== null && previous.line.includes('|')) {
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
    if (insideBlock(line, previous)) {
      // A table header is the line above its delimiter row; it is never a
      // continuation of the paragraph above it.
      if (TABLE_DELIMITER.test(line) && wraps.length > 0 && wraps[wraps.length - 1].line === index) {
        wraps.pop();
      }
      previous = null;
      continue;
    }
    const kind = classify(line);
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
    previous = kind === 'blank' || kind === 'heading' || kind === 'break' || kind === 'table' || kind === 'quote' || kind === 'html'
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

module.exports = { detectHardWraps, unwrapText, collectMarkdownFiles };

if (require.main === module) {
  runCli(process.argv.slice(2));
}
