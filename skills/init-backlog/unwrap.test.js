'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { detectHardWraps, unwrapText, collectMarkdownFiles } = require('./unwrap.js');

const CRLF = String.fromCharCode(13, 10);

test('a hard-wrapped paragraph is detected at each continuation line and joined with single spaces', () => {
  const text = '# Title\n\nFirst line of a paragraph\nsecond line\nthird line\n\nLone line\n';
  assert.deepEqual(detectHardWraps(text), [
    { line: 4, kind: 'paragraph' },
    { line: 5, kind: 'paragraph' },
  ]);
  assert.equal(unwrapText(text), '# Title\n\nFirst line of a paragraph second line third line\n\nLone line\n');
});

test('a bullet with indented continuation lines is joined into one bullet line', () => {
  const text = '## Section\n\n- **Entry.** Starts here and\n  continues here,\n  and ends here.\n- Next bullet\n  1. nested ordered item\n     wrapped nested text\n';
  assert.deepEqual(detectHardWraps(text), [
    { line: 4, kind: 'list-item' },
    { line: 5, kind: 'list-item' },
    { line: 8, kind: 'list-item' },
  ]);
  assert.equal(unwrapText(text), '## Section\n\n- **Entry.** Starts here and continues here, and ends here.\n- Next bullet\n  1. nested ordered item wrapped nested text\n');
});

test('a wrapped Requires line under an index entry is joined into one line', () => {
  const text = '### [Feature](features/feature.md)\n\nExcerpt.\n\n**Requires:** [A](#a),\n[B](#b).\n**External:** none.\n';
  assert.equal(unwrapText(text), '### [Feature](features/feature.md)\n\nExcerpt.\n\n**Requires:** [A](#a), [B](#b).\n**External:** none.\n');
});

test('frontmatter, fenced code, tables, block quotes, headings, and blank-separated lines are never joined', () => {
  const text = [
    '---',
    'name: slug',
    'description: one line',
    'metadata:',
    '  type: feature',
    '---',
    '',
    '# Heading',
    'Paragraph right under a heading',
    '',
    '```text',
    'code line one',
    'code line two',
    '```',
    '',
    '~~~markdown',
    '# Inner heading',
    'inner paragraph',
    '~~~',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
    '> quoted line one',
    '> quoted line two',
    '',
    'Last line',
    '',
  ].join('\n');
  assert.deepEqual(detectHardWraps(text), []);
  assert.equal(unwrapText(text), text);
});

test('a deliberate hard break (two trailing spaces or a trailing backslash) is not a wrap', () => {
  const text = 'Line one  \nline two\\\nline three\n';
  assert.deepEqual(detectHardWraps(text), []);
  assert.equal(unwrapText(text), text);
});

test('a bullet and a column-zero line next to each other are separate blocks, matching the ready parser', () => {
  const text = 'Intro sentence:\n- item one\n- item two\nTrailing paragraph\n';
  assert.deepEqual(detectHardWraps(text), []);
  assert.equal(unwrapText(text), text);
});

test('line endings are preserved and reported line numbers count physical lines', () => {
  const text = ['Para one', 'wrapped', '', '- bullet', '  wrapped bullet', ''].join(CRLF);
  assert.deepEqual(detectHardWraps(text), [
    { line: 2, kind: 'paragraph' },
    { line: 5, kind: 'list-item' },
  ]);
  assert.equal(unwrapText(text), ['Para one wrapped', '', '- bullet wrapped bullet', ''].join(CRLF));
});

test('unwrapping is idempotent and preserves every non-whitespace character in order', () => {
  const text = '# T\n\nalpha beta\ngamma\n\n- one\n  two\n\n```\nx\ny\n```\n';
  const once = unwrapText(text);
  assert.equal(unwrapText(once), once);
  assert.equal(once.replace(/\s+/g, ''), text.replace(/\s+/g, ''));
});

test('collectMarkdownFiles walks a directory recursively and accepts single files', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-'));
  try {
    fs.mkdirSync(path.join(root, 'features'));
    fs.writeFileSync(path.join(root, 'FEATURES.md'), '# F\n');
    fs.writeFileSync(path.join(root, 'features', 'a.md'), '# A\n');
    fs.writeFileSync(path.join(root, 'features', 'notes.txt'), 'ignored\n');
    assert.deepEqual(collectMarkdownFiles([root]).map((file) => path.relative(root, file).replace(/\\/g, '/')), ['FEATURES.md', 'features/a.md']);
    assert.deepEqual(collectMarkdownFiles([path.join(root, 'features', 'a.md')]), [path.join(root, 'features', 'a.md')]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the plugin's own backlog carries no hard wraps", () => {
  const backlogRoot = path.join(__dirname, '..', '..', '.claude');
  const offenders = collectMarkdownFiles([backlogRoot])
    .map((file) => ({ file: path.relative(backlogRoot, file).replace(/\\/g, '/'), wraps: detectHardWraps(fs.readFileSync(file, 'utf8')) }))
    .filter(({ wraps }) => wraps.length > 0)
    .map(({ file, wraps }) => `${file} (${wraps.length}, first at line ${wraps[0].line})`);
  assert.deepEqual(offenders, [], 'run node skills/init-backlog/unwrap.js --write .claude');
});

test('indented code, HTML blocks and comments, setext headings, and pipe-less tables are never joined', () => {
  const text = [
    'Para',
    '',
    '    code line one',
    '    code line two',
    '',
    '<details>',
    '<summary>x</summary>',
    'content',
    '</details>',
    '',
    '<!-- comment line one',
    'comment line two -->',
    'Prose after the comment',
    'wrapped prose',
    '',
    'Title',
    '=====',
    'Para under the title',
    '',
    'Subtitle',
    '--',
    'a | b',
    '--|--',
    '1 | 2',
    '',
  ].join('\n');
  assert.deepEqual(detectHardWraps(text), [{ line: 14, kind: 'paragraph' }]);
  assert.equal(unwrapText(text), text.replace('Prose after the comment\nwrapped prose', 'Prose after the comment wrapped prose'));
});

test('a leading byte-order mark survives and still shields the frontmatter', () => {
  const bom = String.fromCharCode(0xfeff);
  const text = `${bom}---\nname: x\ndescription: a\n  b\n---\n\nPara\nwrapped\n`;
  assert.deepEqual(detectHardWraps(text), [{ line: 8, kind: 'paragraph' }]);
  assert.equal(unwrapText(text), `${bom}---\nname: x\ndescription: a\n  b\n---\n\nPara wrapped\n`);
});

test('each line keeps its own ending under mixed line endings', () => {
  const text = `Para one${CRLF}wrapped\n\nPara two${CRLF}`;
  assert.equal(unwrapText(text), `Para one wrapped\n\nPara two${CRLF}`);
});
