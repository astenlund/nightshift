'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { GateError, evaluateRelease, isShipped, prePushRanges } = require('../tools/release-gate');

const gate = path.resolve(__dirname, '../tools/release-gate.js');

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function write(root, file, content) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
}

function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

function manifest(version, description = 'Nightshift') {
  return JSON.stringify({ name: 'nightshift', version, description }, null, 2) + '\n';
}

function readme(version) {
  return `# Nightshift\n\n**Status:** Nightshift ${version} is published on \`main\`, with acceptance complete.\n`;
}

function release(root, version) {
  write(root, '.claude-plugin/plugin.json', manifest(version));
  write(root, '.codex-plugin/plugin.json', manifest(version));
  write(root, 'README.md', readme(version));
}

function fixture(t) {
  const parent = path.resolve(__dirname, '../.tmp/release-gate-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.autocrlf', 'false']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  release(root, '1.2.3');
  write(root, 'internal/runtime/hosts.js', "'use strict';\n");
  write(root, 'skills/ready/ready.test.js', "'use strict';\n");
  write(root, 'docs.md', 'Prose\n');
  commit(root, 'baseline');
  return root;
}

test('unchanged, documentation-only and test-only ranges pass without a version increase', t => {
  const root = fixture(t);
  assert.deepEqual(evaluateRelease(root, 'HEAD', 'HEAD').problems, []);
  write(root, 'docs.md', 'More prose\n');
  write(root, 'skills/ready/ready.test.js', "'use strict';\n// test-only edit\n");
  commit(root, 'docs and tests');
  const result = evaluateRelease(root, 'HEAD~1', 'HEAD');
  assert.deepEqual(result.shipped, []);
  assert.deepEqual(result.problems, []);
});

test('shipped code changes require a version increase and a matching README status line', t => {
  const root = fixture(t);
  write(root, 'internal/runtime/hosts.js', "'use strict';\n// behavior change\n");
  commit(root, 'change runtime');
  const unbumped = evaluateRelease(root, 'HEAD~1', 'HEAD');
  assert.deepEqual(unbumped.shipped, ['internal/runtime/hosts.js']);
  assert.equal(unbumped.problems.length, 1);
  assert.match(unbumped.problems[0], /without a version increase over 1\.2\.3: internal\/runtime\/hosts\.js/);
  write(root, '.claude-plugin/plugin.json', manifest('1.2.4'));
  write(root, '.codex-plugin/plugin.json', manifest('1.2.4'));
  commit(root, 'bump manifests only');
  const staleReadme = evaluateRelease(root, 'HEAD~2', 'HEAD');
  assert.equal(staleReadme.problems.length, 1);
  assert.match(staleReadme.problems[0], /README\.md status announces 1\.2\.3 while the manifests carry 1\.2\.4/);
  write(root, 'README.md', readme('1.2.4'));
  commit(root, 'move readme');
  assert.deepEqual(evaluateRelease(root, 'HEAD~3', 'HEAD').problems, []);
});

test('moving or test-renaming a shipped file still counts as a shipped change', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'tools'));
  git(root, ['mv', 'internal/runtime/hosts.js', 'tools/hosts.js']);
  commit(root, 'relocate');
  const moved = evaluateRelease(root, 'HEAD~1', 'HEAD');
  assert.deepEqual(moved.shipped, ['internal/runtime/hosts.js']);
  assert.match(moved.problems[0], /without a version increase/);
  git(root, ['mv', 'tools/hosts.js', 'internal/runtime/hosts.test.js']);
  commit(root, 'rename to test');
  const renamed = evaluateRelease(root, 'HEAD~1', 'HEAD');
  assert.deepEqual(renamed.shipped, []);
  assert.deepEqual(renamed.problems, []);
  assert.deepEqual(evaluateRelease(root, 'HEAD~2', 'HEAD').shipped, ['internal/runtime/hosts.js']);
});

test('manifest metadata changes count as shipped behavior', t => {
  const root = fixture(t);
  write(root, '.codex-plugin/plugin.json', manifest('1.2.3', 'Changed description'));
  commit(root, 'describe');
  const result = evaluateRelease(root, 'HEAD~1', 'HEAD');
  assert.deepEqual(result.manifestFieldsChanged, ['.codex-plugin/plugin.json']);
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /without a version increase over 1\.2\.3: \.codex-plugin\/plugin\.json/);
});

test('version decreases and unequal manifests are rejected', t => {
  const root = fixture(t);
  release(root, '1.2.2');
  commit(root, 'decrease');
  assert.match(evaluateRelease(root, 'HEAD~1', 'HEAD').problems[0], /decreases from 1\.2\.3 to 1\.2\.2/);
  write(root, '.codex-plugin/plugin.json', manifest('1.2.3'));
  commit(root, 'unequal');
  assert.ok(evaluateRelease(root, 'HEAD~2', 'HEAD').problems.some(problem => /Manifest versions differ/.test(problem)));
});

test('a missing README status line is a problem', t => {
  const root = fixture(t);
  write(root, 'README.md', '# Nightshift\n');
  commit(root, 'drop status');
  assert.match(evaluateRelease(root, 'HEAD~1', 'HEAD').problems[0], /no recognizable published-version status line/);
});

test('unreadable baselines fail closed', t => {
  const root = fixture(t);
  assert.throws(() => evaluateRelease(root, 'no-such-ref', 'HEAD'), GateError);
});

test('non-ASCII shipped paths are not hidden by path quoting', t => {
  const root = fixture(t);
  git(root, ['config', 'core.quotePath', 'true']);
  write(root, 'internal/\u00e4.js', "'use strict';\n");
  commit(root, 'non-ascii');
  assert.deepEqual(evaluateRelease(root, 'HEAD~1', 'HEAD').shipped, ['internal/\u00e4.js']);
});

test('shipped path classification excludes tests and repository-only files', () => {
  assert.equal(isShipped('internal/runtime/hosts.js'), true);
  assert.equal(isShipped('hooks/hooks.json'), true);
  assert.equal(isShipped('skills/ready/ready.js'), true);
  assert.equal(isShipped('skills/ready/ready.test.js'), false);
  assert.equal(isShipped('tests/package.test.js'), false);
  assert.equal(isShipped('tools/release-gate.js'), false);
  assert.equal(isShipped('README.md'), false);
});

test('pre-push input parses into ranges', () => {
  assert.deepEqual(prePushRanges('refs/heads/main abc refs/heads/main def\n'), [{ localRef: 'refs/heads/main', localSha: 'abc', remoteRef: 'refs/heads/main', remoteSha: 'def' }]);
});

test('the pre-push entry point blocks unreleased behavior and skips refs without a baseline', t => {
  const root = fixture(t);
  write(root, 'internal/runtime/hosts.js', "'use strict';\n// unreleased\n");
  commit(root, 'unreleased');
  const head = git(root, ['rev-parse', 'HEAD']);
  const run = input => spawnSync(process.execPath, [gate, '--pre-push'], { cwd: root, input, windowsHide: true, encoding: 'utf8' });
  const baseline = git(root, ['rev-parse', 'HEAD~1']);
  const blocked = run(`refs/heads/main ${head} refs/heads/main ${baseline}\r\nrefs/tags/v1 ${head} refs/tags/v1 ${'0'.repeat(40)}\r\n`);
  assert.equal(blocked.status, 1, blocked.stderr);
  assert.match(blocked.stderr, /without a version increase/);
  assert.match(blocked.stdout, /skipped for refs\/tags\/v1: only refs\/heads\/main/);
  const branch = run(`refs/heads/feature ${head} refs/heads/feature ${baseline}\n`);
  assert.equal(branch.status, 0, branch.stderr);
  assert.match(branch.stdout, /only refs\/heads\/main is a published baseline/);
  const fresh = run(`refs/heads/main ${head} refs/heads/main ${'0'.repeat(40)}\n`);
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.match(fresh.stdout, /no published baseline/);
  const deletion = run(`(delete) ${'0'.repeat(40)} refs/heads/main ${head}\n`);
  assert.equal(deletion.status, 0, deletion.stderr);
  assert.match(deletion.stdout, /ref deletion/);
  const stale = run(`refs/heads/main ${head} refs/heads/main ${'a'.repeat(40)}\n`);
  assert.equal(stale.status, 2, stale.stderr);
  assert.match(stale.stderr, /not available locally; fetch it and retry/);
});

test('the command line entry point reports and exits by outcome', t => {
  const root = fixture(t);
  write(root, 'internal/runtime/hosts.js', "'use strict';\n// unreleased\n");
  commit(root, 'unreleased');
  const run = args => spawnSync(process.execPath, [gate, ...args], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(run(['--baseline', 'HEAD~1']).status, 1);
  assert.equal(run(['--baseline', 'HEAD~1', '--head', 'HEAD~1']).status, 0);
  assert.equal(run(['--baseline', '0'.repeat(40)]).status, 0);
  const broken = run(['--baseline', 'no-such-ref']);
  assert.equal(broken.status, 2);
  assert.match(broken.stderr, /could not run/);
});
