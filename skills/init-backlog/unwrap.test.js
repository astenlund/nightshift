'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { CatalogError, canonicalPath, detectHardWraps, unwrapText, collectMarkdownFiles, analyzeUnwrapCatalog } = require('./unwrap.js');
const { runCli } = require('../../internal/backlog-catalog.js');
const { targetRecord } = require('./lib/inspection.js');
const { scanMarkdown } = require('../spec-agreement/spec-agreement.js');

const CRLF = String.fromCharCode(13, 10);

function invokeRunCli(argv, options = {}) {
  const previousExitCode = process.exitCode;
  let stdout = '';
  let stderr = '';
  process.exitCode = undefined;
  try {
    runCli(argv, {
      ...options,
      stderr: { write: (value) => { stderr += value; } },
      stdout: { write: (value) => { stdout += value; } },
    });

    return { status: process.exitCode ?? 0, stderr, stdout };
  } finally {
    process.exitCode = previousExitCode;
  }
}

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

test('collectMarkdownFiles reads a directory as a backlog root and accepts single files', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-'));
  try {
    for (const dir of ['features', 'features/nested', 'bugs', 'patterns', 'plans', 'commands']) {
      fs.mkdirSync(path.join(root, dir));
    }
    fs.writeFileSync(path.join(root, 'FEATURES.md'), '# F\n');
    fs.writeFileSync(path.join(root, 'FEATURES_HISTORY.md'), '# H\n');
    fs.writeFileSync(path.join(root, 'features', 'a.md'), '# A\n');
    fs.writeFileSync(path.join(root, 'features', 'nested', 'b.md'), '# B\n');
    fs.writeFileSync(path.join(root, 'features', 'notes.txt'), 'ignored\n');
    fs.writeFileSync(path.join(root, 'bugs', 'c.md'), '# C\n');
    fs.writeFileSync(path.join(root, 'patterns', 'd.md'), '# D\n');
    fs.writeFileSync(path.join(root, 'plans', 'ephemeral.md'), '# P\n');
    fs.writeFileSync(path.join(root, 'commands', 'host.md'), '# Host\n');
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# Host instructions\n');
    fs.writeFileSync(path.join(root, 'notes.md'), '# Stray\n');
    assert.deepEqual(collectMarkdownFiles([root]).map((file) => path.relative(root, file).replace(/\\/g, '/')), ['FEATURES.md', 'FEATURES_HISTORY.md', 'bugs/c.md', 'features/a.md', 'features/nested/b.md', 'patterns/d.md']);
    assert.deepEqual(collectMarkdownFiles([path.join(root, 'features', 'a.md')]), [path.join(root, 'features', 'a.md')]);
    assert.throws(() => collectMarkdownFiles([{ path: root, stat: fs.statSync(root) }]), /path strings/);
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

test('inline HTML followed by prose remains in its paragraph', () => {
  const text = 'Intro\n<span>hello\ncontinues\n';

  assert.deepEqual(detectHardWraps(text), [
    { line: 2, kind: 'paragraph' },
    { line: 3, kind: 'paragraph' },
  ]);
  assert.equal(unwrapText(text), 'Intro <span>hello continues\n');
});

test('all CommonMark raw HTML block types terminate according to their block rules', () => {
  const cases = [
    ['type 1', '<script>\ninside\n</script>\nAfter\ncontinued\n'],
    ['type 2', '<!--\ninside\n-->\nAfter\ncontinued\n'],
    ['type 3', '<?xml\ninside\n?>\nAfter\ncontinued\n'],
    ['type 4', '<!DOCTYPE html\ninside\n>\nAfter\ncontinued\n'],
    ['type 5', '<![CDATA[\ninside\n]]>\nAfter\ncontinued\n'],
    ['type 6', '<div>\ninside\n\nAfter\ncontinued\n'],
    ['type 7', '<custom>\ninside\n\nAfter\ncontinued\n'],
  ];

  for (const [name, text] of cases) {
    assert.deepEqual(detectHardWraps(text), [{ line: 5, kind: 'paragraph' }], name);
    assert.equal(unwrapText(text), text.replace('After\ncontinued', 'After continued'), name);
  }
});

test('same-line type 1 closure resumes prose scanning immediately', () => {
  const text = '<script>inline</script>\nAfter\ncontinued\n';

  assert.deepEqual(detectHardWraps(text), [{ line: 3, kind: 'paragraph' }]);
  assert.equal(unwrapText(text), '<script>inline</script>\nAfter continued\n');
});

test('unterminated raw HTML blocks suppress wrap detection through EOF when required', () => {
  const cases = [
    '<script>\ninside\nAfter\ncontinued\n',
    '<!--\ninside\nAfter\ncontinued\n',
    '<?xml\ninside\nAfter\ncontinued\n',
    '<!DOCTYPE html\ninside\nAfter\ncontinued\n',
    '<![CDATA[\ninside\nAfter\ncontinued\n',
    '<div>\ninside\n\nAfter\ncontinued\n',
    '<custom>\ninside\n\nAfter\ncontinued\n',
  ];

  for (const [index, text] of cases.entries()) {
    const wraps = index < 5 ? [] : [{ line: 5, kind: 'paragraph' }];
    assert.deepEqual(detectHardWraps(text), wraps, text.split('\n', 1)[0]);
    assert.equal(unwrapText(text), index < 5 ? text : text.replace('After\ncontinued', 'After continued'));
  }
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

test('a fence closer shorter than its opener stays inside the fence', () => {
  const text = '````\ncode\n```\na\nb\n````\nc\nd\n';
  assert.deepEqual(detectHardWraps(text), [{ line: 8, kind: 'paragraph' }]);
  assert.equal(unwrapText(text), '````\ncode\n```\na\nb\n````\nc d\n');
});

// ready.js reads a backlog through both parsers, so a fence one of them opens
// and the other does not would split entry parsing from wrap detection.
test('a backtick fence line whose info string carries a backtick opens no fence, as the shared scanner reads it', () => {
  const text = '# Title\n\n``` js `x`\nwrapped prose one\ncontinues here\n';
  assert.deepEqual(detectHardWraps(text), [
    { line: 4, kind: 'paragraph' },
    { line: 5, kind: 'paragraph' },
  ]);
  assert.equal(unwrapText(text), '# Title\n\n``` js `x` wrapped prose one continues here\n');
  const scanned = scanMarkdown(Buffer.from(text, 'utf8'));
  assert.deepEqual(scanned.lines.map((line) => line.outsideFence), [true, true, true, true, true]);
  assert.equal(scanned.unclosedFence, false);
});

test('an ATX heading indented up to three spaces and a spaced thematic break each end a paragraph', () => {
  const text = 'para\n ## Heading\nafter\n\nmore\n_ _ _\nlast\n';
  assert.deepEqual(detectHardWraps(text), []);
  assert.equal(unwrapText(text), text);
});

test('rows after a piped table without a blank line stay separate rows', () => {
  const text = '| a | b |\n|---|---|\n| 1 | 2 |\ntrailing\nmore\n';
  assert.deepEqual(detectHardWraps(text), []);
  assert.equal(unwrapText(text), text);
});

test('fences, headings, HTML, and breaks nested under a list item are measured from the item content', () => {
  const text = [
    '- item',
    '  - sub',
    '    ```',
    '    code a',
    '    code b',
    '    ```',
    '    ### Heading',
    '    <details>',
    '    <summary>x</summary>',
    '',
    '- other',
    '    ---',
    '    wrapped under a break',
    '',
    '    code after a blank is indented code',
    '    second code line',
    '',
  ].join('\n');
  assert.deepEqual(detectHardWraps(text), []);
  assert.equal(unwrapText(text), text);
});

test('collectMarkdownFiles follows contained links once and rejects links outside the requested root', (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-'));
  const external = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-external-'));
  try {
    fs.mkdirSync(path.join(root, 'real'));
    fs.mkdirSync(path.join(root, 'plans'));
    fs.writeFileSync(path.join(root, 'real', 'a.md'), '# A\n');
    fs.writeFileSync(path.join(root, 'plans', 'excluded.md'), 'excluded\ncontinuation\n');
    fs.writeFileSync(path.join(external, 'nested.md'), 'nested\ncontinuation\n');
    fs.writeFileSync(path.join(external, 'top.md'), 'top\ncontinuation\n');
    try {
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'features'), 'junction');
      fs.symlinkSync(external, path.join(root, 'patterns'), 'junction');
      fs.symlinkSync(path.join(external, 'nested.md'), path.join(root, 'real', 'escape.md'), 'file');
      fs.symlinkSync(path.join(external, 'top.md'), path.join(root, 'FEATURES.md'), 'file');
      fs.symlinkSync(path.join(root, 'real', 'missing.md'), path.join(root, 'real', 'dangling.md'), 'file');
      fs.symlinkSync(path.join(root, 'real'), path.join(root, 'real', 'loop'), 'junction');
      fs.symlinkSync(root, path.join(root, 'real', 'up'), 'junction');
    } catch {
      // Link creation needs privileges this runner lacks; the walk is then untestable here.
      t.skip('symlinks unavailable');

      return;
    }
    assert.deepEqual(collectMarkdownFiles([root]).map((file) => path.relative(root, file).replace(/\\/g, '/')), ['features/a.md']);
    assert.deepEqual(collectMarkdownFiles([path.join(root, 'FEATURES.md')]), []);
    assert.equal(fs.readFileSync(path.join(external, 'nested.md'), 'utf8'), 'nested\ncontinuation\n');
    assert.equal(fs.readFileSync(path.join(external, 'top.md'), 'utf8'), 'top\ncontinuation\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});

test('collectMarkdownFiles reports directory enumeration failures as catalog errors', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-unreadable-'));
  const features = path.join(root, 'features');
  fs.mkdirSync(features);
  const originalReaddirSync = fs.readdirSync;
  fs.readdirSync = (target, options) => {
    if (path.resolve(target) === path.resolve(features)) {
      const error = new Error('synthetic directory denial');
      error.code = 'EACCES';
      throw error;
    }

    return originalReaddirSync(target, options);
  };
  try {
    assert.throws(
      () => collectMarkdownFiles([root]),
      (error) => error instanceof CatalogError && error.code === 'EACCES' && error.message.includes(features),
    );
  } finally {
    fs.readdirSync = originalReaddirSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unwrap CLI rejects a backlog root junction outside the repository root', (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-root-link-'));
  const repoRoot = path.join(root, 'repo');
  const claudeDir = path.join(repoRoot, '.claude');
  const external = path.join(root, 'external');
  const externalFeatures = path.join(external, 'FEATURES.md');
  fs.mkdirSync(repoRoot);
  fs.mkdirSync(external);
  fs.writeFileSync(externalFeatures, '# Features\n\nwrapped line one\nwrapped line two\n');
  try {
    try {
      fs.symlinkSync(external, claudeDir, 'junction');
    } catch {
      t.skip('links unavailable');

      return;
    }
    const completion = spawnSync(process.execPath, [path.join(__dirname, 'unwrap.js'), '--write', claudeDir], { encoding: 'utf8' });
    assert.notEqual(completion.status, 0, 'an escaping backlog root must fail closed');
    assert.equal(fs.readFileSync(externalFeatures, 'utf8'), '# Features\n\nwrapped line one\nwrapped line two\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unwrap CLI rejects parent junction substitution before mutation', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-parent-substitution-'));
  const backlogRoot = path.join(root, '.claude');
  const contained = path.join(backlogRoot, 'contained');
  const external = path.join(root, 'external');
  const features = path.join(backlogRoot, 'features');
  const internalTarget = path.join(contained, 'item.md');
  const externalTarget = path.join(external, 'item.md');
  const original = 'wrapped line one\nwrapped line two\n';
  try {
    fs.mkdirSync(contained, { recursive: true });
    fs.mkdirSync(external);
    fs.writeFileSync(internalTarget, original);
    fs.writeFileSync(externalTarget, original);
    try {
      fs.symlinkSync(contained, features, 'junction');
    } catch {
      t.skip('junctions unavailable');

      return;
    }
    const completion = invokeRunCli(['--write', backlogRoot], {
      beforeWrite: () => {
        fs.unlinkSync(features);
        fs.symlinkSync(external, features, 'junction');
      },
    });

    assert.notEqual(completion.status, 0);
    assert.equal(completion.stderr, '');
    assert.deepEqual(JSON.parse(completion.stdout), [{ file: path.join(features, 'item.md'), error: 'identity-changed' }]);
    assert.equal(fs.readFileSync(internalTarget, 'utf8'), original);
    assert.equal(fs.readFileSync(externalTarget, 'utf8'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unwrap CLI rejects target link substitution before mutation', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-target-substitution-'));
  const backlogRoot = path.join(root, '.claude');
  const containedTarget = path.join(backlogRoot, 'contained.md');
  const alias = path.join(backlogRoot, 'FEATURES.md');
  const externalTarget = path.join(root, 'external.md');
  const original = 'wrapped line one\nwrapped line two\n';
  try {
    fs.mkdirSync(backlogRoot);
    fs.writeFileSync(containedTarget, original);
    fs.writeFileSync(externalTarget, original);
    try {
      fs.symlinkSync(containedTarget, alias, 'file');
    } catch {
      t.skip('file links unavailable');

      return;
    }
    const completion = invokeRunCli(['--write', backlogRoot], {
      beforeWrite: () => {
        fs.unlinkSync(alias);
        fs.symlinkSync(externalTarget, alias, 'file');
      },
    });

    assert.notEqual(completion.status, 0);
    assert.equal(completion.stderr, '');
    assert.deepEqual(JSON.parse(completion.stdout), [{ file: alias, error: 'identity-changed' }]);
    assert.equal(fs.readFileSync(containedTarget, 'utf8'), original);
    assert.equal(fs.readFileSync(externalTarget, 'utf8'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unwrap CLI rejects a hard-linked target without changing its alias', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-hard-link-'));
  const backlogRoot = path.join(root, '.claude');
  const externalTarget = path.join(root, 'external.md');
  const target = path.join(backlogRoot, 'FEATURES.md');
  const original = 'wrapped line one\nwrapped line two\n';
  try {
    fs.mkdirSync(backlogRoot);
    fs.writeFileSync(externalTarget, original);
    try {
      fs.linkSync(externalTarget, target);
    } catch {
      t.skip('hard links unavailable');

      return;
    }
    const completion = invokeRunCli(['--write', backlogRoot]);

    assert.notEqual(completion.status, 0);
    assert.equal(completion.stderr, '');
    assert.deepEqual(JSON.parse(completion.stdout), [{ file: target, error: 'identity-changed' }]);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.equal(fs.readFileSync(externalTarget, 'utf8'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unwrap CLI rejects a hard-link alias added after the stable read', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-hard-link-drift-'));
  const backlogRoot = path.join(root, '.claude');
  const target = path.join(backlogRoot, 'FEATURES.md');
  const alias = path.join(root, 'external.md');
  const original = 'wrapped line one\nwrapped line two\n';
  try {
    fs.mkdirSync(backlogRoot);
    fs.writeFileSync(target, original);
    try {
      fs.linkSync(target, alias);
      fs.unlinkSync(alias);
    } catch {
      t.skip('hard links unavailable');

      return;
    }
    const completion = invokeRunCli(['--write', backlogRoot], {
      beforeWrite: () => {
        fs.linkSync(target, alias);
      },
    });

    assert.notEqual(completion.status, 0);
    assert.equal(completion.stderr, '');
    assert.deepEqual(JSON.parse(completion.stdout), [{ file: target, error: 'identity-changed' }]);
    assert.equal(fs.readFileSync(target, 'utf8'), original);
    assert.equal(fs.readFileSync(alias, 'utf8'), original);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unwrap CLI preserves an unchanged contained target link', { skip: process.platform !== 'win32' }, (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-contained-link-'));
  const backlogRoot = path.join(root, '.claude');
  const containedTarget = path.join(backlogRoot, 'contained.md');
  const alias = path.join(backlogRoot, 'FEATURES.md');
  try {
    fs.mkdirSync(backlogRoot);
    fs.writeFileSync(containedTarget, 'wrapped line one\nwrapped line two\n');
    try {
      fs.symlinkSync(containedTarget, alias, 'file');
    } catch {
      t.skip('file links unavailable');

      return;
    }
    const completion = invokeRunCli(['--write', backlogRoot]);

    assert.equal(completion.status, 0);
    assert.equal(completion.stderr, '');
    assert.deepEqual(JSON.parse(completion.stdout), [{ file: alias, wraps: 1, firstLine: 2, rewritten: true }]);
    assert.equal(fs.readFileSync(containedTarget, 'utf8'), 'wrapped line one wrapped line two\n');
    assert.equal(fs.lstatSync(alias).isSymbolicLink(), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unwrap CLI rejects malformed UTF-8 in check and write modes without changing the bytes', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-invalid-utf8-'));
  const target = path.join(root, 'FEATURES.md');
  const invalidBytes = Buffer.from([0xc3, 0x28]);
  fs.writeFileSync(target, invalidBytes);
  try {
    for (const args of [[target], ['--write', target]]) {
      const completion = spawnSync(process.execPath, [path.join(__dirname, 'unwrap.js'), ...args], { encoding: 'utf8' });

      assert.equal(completion.status, 1);
      assert.equal(completion.stderr, '');
      assert.deepEqual(JSON.parse(completion.stdout), [{ file: target, error: 'invalid-utf8' }]);
      assert.deepEqual(fs.readFileSync(target), invalidBytes);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the unwrap CLI preserves valid UTF-8, byte-order marks, and line endings', () => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-valid-utf8-'));
  const word = `Caf${String.fromCharCode(0xe9)}`;
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const cases = [
    { name: 'lf.md', before: Buffer.from(`${word}\ncontinued\n`), after: Buffer.from(`${word} continued\n`) },
    { name: 'bom-crlf.md', before: Buffer.concat([bom, Buffer.from(`${word}${CRLF}continued${CRLF}`)]), after: Buffer.concat([bom, Buffer.from(`${word} continued${CRLF}`)]) },
  ];
  try {
    for (const fixture of cases) {
      const target = path.join(root, fixture.name);
      fs.writeFileSync(target, fixture.before);

      const completion = spawnSync(process.execPath, [path.join(__dirname, 'unwrap.js'), '--write', target], { encoding: 'utf8' });

      assert.equal(completion.status, 0);
      assert.equal(completion.stderr, '');
      assert.deepEqual(JSON.parse(completion.stdout), [{ file: target, wraps: 1, firstLine: 2, rewritten: true }]);
      assert.deepEqual(fs.readFileSync(target), fixture.after);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('canonicalPath gives one identity to every spelling of a file and never throws', (t) => {
  const root = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'unwrap-'));
  try {
    fs.mkdirSync(path.join(root, 'features'));
    fs.writeFileSync(path.join(root, 'features', 'bar.md'), '# Bar\n');
    assert.equal(canonicalPath(path.join(root, 'features', 'missing.md')), path.join(root, 'features', 'missing.md'));
    assert.equal(canonicalPath(path.join(root, 'features', '..', 'features', 'bar.md')), canonicalPath(path.join(root, 'features', 'bar.md')));
    if (!fs.existsSync(path.join(root, 'features', 'Bar.md'))) {
      t.skip('case-sensitive filesystem');

      return;
    }
    assert.equal(canonicalPath(path.join(root, 'features', 'Bar.md')), canonicalPath(path.join(root, 'features', 'bar.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a two-space hard break on a continuation line survives the join, so the rewrite is idempotent', () => {
  const text = 'foo\nbar  \nbaz\n\n- a\n  b  \n  c\n';
  const once = unwrapText(text);
  assert.equal(once, 'foo bar  \nbaz\n\n- a b  \n  c\n');
  assert.equal(unwrapText(once), once);
});

test('analyzeUnwrapCatalog returns target-sorted wraps and predicted contents without filesystem access', () => {
  const items = [
    { target: 'features/z.md', contents: 'First line\ncontinued\n' },
    { target: 'FEATURES.md', contents: '# Features\n' },
    { target: 'features/a.md', contents: '- item\n  continued\n' },
  ];
  const readFileSync = fs.readFileSync;
  let result;
  try {
    fs.readFileSync = () => {
      throw new Error('analyzeUnwrapCatalog must not read the filesystem');
    };
    result = analyzeUnwrapCatalog(items);
  } finally {
    fs.readFileSync = readFileSync;
  }

  assert.deepEqual(result, [
    { target: 'FEATURES.md', wraps: [], contents: '# Features\n' },
    { target: 'features/a.md', wraps: [{ line: 2, kind: 'list-item' }], contents: '- item continued\n' },
    { target: 'features/z.md', wraps: [{ line: 2, kind: 'paragraph' }], contents: 'First line continued\n' },
  ]);
});

test('analyzeUnwrapCatalog applies the same raw HTML block boundaries as unwrapText', () => {
  const cases = [
    ['script', '<script>\ninside\n</script>\nAfter\ncontinued\n'],
    ['comment', '<!--\ninside\n-->\nAfter\ncontinued\n'],
    ['processing', '<?xml\ninside\n?>\nAfter\ncontinued\n'],
    ['declaration', '<!DOCTYPE html\ninside\n>\nAfter\ncontinued\n'],
    ['cdata', '<![CDATA[\ninside\n]]>\nAfter\ncontinued\n'],
    ['div', '<div>\ninside\n\nAfter\ncontinued\n'],
    ['custom', '<custom>\ninside\n\nAfter\ncontinued\n'],
  ];
  const items = cases.map(([name, contents]) => ({ target: `features/${name}.md`, contents }));

  const expectedNames = ['cdata', 'comment', 'custom', 'declaration', 'div', 'processing', 'script'];
  assert.deepEqual(analyzeUnwrapCatalog(items).map(({ target, wraps }) => ({ target, wraps })), expectedNames.map((name) => ({ target: `features/${name}.md`, wraps: [{ line: 5, kind: 'paragraph' }] })));
});

test('targetRecord consumes a cached wrap analysis instead of rescanning decoded text', () => {
  const declaration = { contentRole: 'semantic', kind: 'file', regions: [] };
  const record = (text, wraps) => {
    const bytes = Buffer.from(text);

    return targetRecord(
      '.claude/FEATURES.md',
      { bytes, kind: 'file', mode: 0o644, present: true, rawSha256: 'a'.repeat(64) },
      declaration,
      null,
      { gitKind: 'non-git', platform: process.platform, wraps },
    );
  };

  assert.equal(record('# Features\n', [{ kind: 'paragraph', line: 2 }]).states.includes('wrapped'), true);
  assert.equal(record('First line\ncontinued\n', []).states.includes('wrapped'), false);
});
