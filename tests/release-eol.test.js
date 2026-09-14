'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { fixture, packageCopy, repository } = require('./release-fixtures');
const { MANIFEST_PATH, loadManifest, verifyBundle } = require('../internal/releases/manifest');
const { checkTree, workingManifest } = require('../tools/release-manifest');

test('autocrlf checkout preserves every manifest byte and unlocked policies fail', t => {
  const value = fixture(t);
  const source = packageCopy(value.root, '1.0.0');
  fs.copyFileSync(path.join(repository, '.gitattributes'), path.join(source, '.gitattributes'));
  const git = args => {
    const result = spawnSync('git', args, { cwd: source, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '--quiet']);
  git(['config', 'core.autocrlf', 'true']);
  git(['add', '--all']);
  const tree = git(['write-tree']);
  assert.equal(checkTree(source, tree), true);
  const target = path.join(value.root, 'checkout');
  fs.mkdirSync(target);
  git(['checkout-index', '--all', '--prefix=' + target.replaceAll(path.sep, '/') + '/']);
  fs.unlinkSync(path.join(target, '.gitattributes'));
  const original = loadManifest(source);
  assert.equal(verifyBundle(target, original.identity).identity, original.identity);
  assert.deepEqual(fs.readFileSync(path.join(target, MANIFEST_PATH)), fs.readFileSync(path.join(source, MANIFEST_PATH)));
  const attributes = path.join(source, '.gitattributes');
  fs.appendFileSync(attributes, '\nskills/** !text !eol\n');
  assert.throws(() => workingManifest(source), /lacks a locked byte policy/);
  git(['add', '.gitattributes']);
  assert.throws(() => checkTree(source, git(['write-tree'])), /lacks a locked byte policy/);
});

test('autocrlf preserves reviewed repository text and byte-exact fixture exceptions', t => {
  const value = fixture(t);
  const source = path.join(value.root, 'review-source');
  const target = path.join(value.root, 'review-checkout');
  fs.mkdirSync(source);
  fs.mkdirSync(target);
  fs.copyFileSync(path.join(repository, '.gitattributes'), path.join(source, '.gitattributes'));
  const files = new Map([
    ['.nightshift/specs/work.md', Buffer.from('# Stable governing spec\n')],
    ['tests/fixtures/releases/helper.cjs', Buffer.from('module.exports = 1;\n')],
    ['tests/fixtures/init-backlog-host/raw.txt', Buffer.from('Deliberate\r\nfixture bytes\r\n')],
  ]);
  for (const [file, bytes] of files) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), bytes);
  }
  for (const args of [['init', '--quiet'], ['config', 'core.autocrlf', 'true'], ['add', '--all'], ['checkout-index', '--all', '--prefix=' + target.replaceAll(path.sep, '/') + '/']]) {
    const result = spawnSync('git', args, { cwd: source, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  for (const [file, bytes] of files) assert.deepEqual(fs.readFileSync(path.join(target, file)), bytes, file);
});
