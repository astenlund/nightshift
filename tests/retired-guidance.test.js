'use strict';

// The retired-guidance list: its generator and verifier over template history, and the release gate's check of it
// (commitment 3 of .nightshift/specs/setup-index-text-adjudication.md).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { BACKLOG_FILES } = require('../internal/backlog-catalog');
const { sha256 } = require('../internal/template-text/document');
const { LIST, generate, serialize, templatePath, verify } = require('../tools/retired-guidance');
const { retiredGuidanceProblems } = require('../tools/release-gate');

const LF = String.fromCharCode(10);
const text = (...rows) => rows.join(LF) + LF;
const baseTemplate = guidance => text('# Index', '', ...guidance.flatMap(paragraph => [paragraph, '']), '## History', '', 'History guidance.');

function git(root, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  return result.stdout.trim();
}

function repository(t) {
  const parent = path.resolve(__dirname, '../.tmp/retired-guidance-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, 'init', '--quiet');

  return fs.realpathSync.native(root);
}

// Writes every template with the given guidance paragraphs for QUICK_WINS.md and fixed text for the rest, and commits.
function commitTemplates(root, guidance, message, list = undefined) {
  for (const file of BACKLOG_FILES) {
    const target = path.join(root, templatePath(file));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, baseTemplate(file === 'QUICK_WINS.md' ? guidance : ['Fixed guidance.']));
  }
  const listFile = path.join(root, LIST);
  if (list === null) fs.rmSync(listFile, { force: true });
  else if (list !== undefined) fs.writeFileSync(listFile, serialize(list));
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '--allow-empty', '-m', message);

  return git(root, 'rev-parse', 'HEAD');
}

const current = root => new Map(BACKLOG_FILES.map(file => [file, fs.readFileSync(path.join(root, templatePath(file)), 'utf8')]));
const quickBlocks = list => list.retired['QUICK_WINS.md'].blocks;

test('generation lists guidance earlier versions had and the current one lacks, and verification accepts it', t => {
  const root = repository(t);
  commitTemplates(root, ['Old guidance.', 'Kept guidance.'], 'first');
  const head = commitTemplates(root, ['Kept guidance.'], 'second');
  const { list } = generate(root, head, current(root));
  assert.deepEqual(quickBlocks(list), [sha256('Old guidance.')]);
  assert.deepEqual(verify(root, head, list, current(root)), []);
  const extra = JSON.parse(serialize(list));
  extra.retired['QUICK_WINS.md'].blocks = [sha256('Kept guidance.'), sha256('Old guidance.')].sort();
  assert.match(verify(root, head, extra, current(root)).join(LF), /current template holds/);
  extra.retired['QUICK_WINS.md'].blocks = [sha256('Never in any version.'), sha256('Old guidance.')].sort();
  assert.match(verify(root, head, extra, current(root)).join(LF), /no template version reachable/);
});

test('a guidance heading that became a container is not retired, while its dropped guidance is', t => {
  const root = repository(t);
  const commitQuick = (quick, message) => {
    for (const file of BACKLOG_FILES) {
      const target = path.join(root, templatePath(file));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file === 'QUICK_WINS.md' ? quick : baseTemplate(['Fixed guidance.']));
    }
    git(root, 'add', '-A');
    git(root, 'commit', '--quiet', '-m', message);

    return git(root, 'rev-parse', 'HEAD');
  };
  commitQuick(text('# Index', '', 'Intro guidance.', '', '## Notes', '', 'Notes guidance.', '', '## History', '', 'History guidance.'), 'first');
  const head = commitQuick(text('# Index', '', 'Intro guidance.', '', '## Notes', '', '## History', '', 'History guidance.'), 'second');
  const { list } = generate(root, head, current(root));
  assert.deepEqual(list.retired['QUICK_WINS.md'], { blocks: [sha256('Notes guidance.')], headings: [] });
});

test('verification fails when the comparison rules no longer reproduce a listed hash', t => {
  const root = repository(t);
  commitTemplates(root, ['Old guidance.'], 'first');
  const head = commitTemplates(root, ['New guidance.'], 'second');
  const { list } = generate(root, head, current(root));
  const altered = JSON.parse(serialize(list));
  altered.retired['QUICK_WINS.md'].blocks = [sha256('Old guidance. ')];
  assert.match(verify(root, head, altered, current(root)).join(LF), /no template version reachable/);
  altered.rules = 2;
  assert.match(verify(root, head, altered, current(root)).join(LF), /comparison rules 2/);
});

test('rewriting unpublished history and publishing intermediate wordings leave the list valid', t => {
  const root = repository(t);
  commitTemplates(root, ['Old guidance.'], 'published one');
  const baseline = commitTemplates(root, ['Published guidance.'], 'published two');
  commitTemplates(root, ['Intermediate wording.'], 'unpublished one');
  commitTemplates(root, ['Final wording.'], 'unpublished two');
  const { list } = generate(root, baseline, current(root));
  assert.deepEqual(quickBlocks(list), [sha256('Old guidance.'), sha256('Published guidance.')].sort());
  git(root, 'reset', '--quiet', '--soft', baseline);
  const rewritten = commitTemplates(root, ['Final wording.'], 'squashed', list);
  assert.deepEqual(generate(root, baseline, current(root)).list, list);
  assert.deepEqual(verify(root, rewritten, list, current(root)), [], 'the list stays valid after unpublished history is rewritten');
});

test('the release gate accepts a first list equal to the history and refuses a missing or hand-edited one', t => {
  const root = repository(t);
  commitTemplates(root, ['Old guidance.'], 'first');
  const baseline = commitTemplates(root, ['Published guidance.'], 'published');
  const missing = commitTemplates(root, ['Published guidance.'], 'no list');
  assert.match(retiredGuidanceProblems(root, baseline, missing).join(LF), /missing/);
  const { list } = generate(root, baseline, current(root));
  const good = commitTemplates(root, ['Published guidance.'], 'list', list);
  assert.deepEqual(retiredGuidanceProblems(root, baseline, good), []);
  const edited = JSON.parse(serialize(list));
  edited.retired['QUICK_WINS.md'].blocks = [];
  const bad = commitTemplates(root, ['Published guidance.'], 'edited', edited);
  assert.match(retiredGuidanceProblems(root, baseline, bad).join(LF), /differs from what the history/);
});

test('under unchanged rules the gate requires dropped guidance to be listed and refuses dropping a listed hash', t => {
  const root = repository(t);
  commitTemplates(root, ['Old guidance.'], 'first');
  commitTemplates(root, ['Published guidance.'], 'second');
  const { list } = generate(root, 'HEAD', current(root));
  const baseline = commitTemplates(root, ['Published guidance.'], 'published with list', list);
  const dropped = commitTemplates(root, ['Replacement guidance.'], 'drops published guidance', list);
  assert.match(retiredGuidanceProblems(root, baseline, dropped).join(LF), /does not list/);
  const listed = JSON.parse(serialize(list));
  listed.retired['QUICK_WINS.md'].blocks = [...listed.retired['QUICK_WINS.md'].blocks, sha256('Published guidance.')].sort();
  const fixed = commitTemplates(root, ['Replacement guidance.'], 'lists it', listed);
  assert.deepEqual(retiredGuidanceProblems(root, baseline, fixed), []);
  const shrunk = JSON.parse(serialize(listed));
  shrunk.retired['QUICK_WINS.md'].blocks = [sha256('Published guidance.')];
  const handDrop = commitTemplates(root, ['Replacement guidance.'], 'drops a retired hash', shrunk);
  assert.match(retiredGuidanceProblems(root, baseline, handDrop).join(LF), /drops retired blocks/);
});

test('a rules change, and a documentation-only change after a published batch, pass the gate', t => {
  const root = repository(t);
  commitTemplates(root, ['Old guidance.'], 'first');
  commitTemplates(root, ['Published guidance.'], 'second');
  const { list } = generate(root, 'HEAD', current(root));
  const older = JSON.parse(serialize(list));
  older.rules = 2;
  const baseline = commitTemplates(root, ['Published guidance.'], 'list under other rules', older);
  const regenerated = commitTemplates(root, ['Published guidance.'], 'regenerated', list);
  assert.deepEqual(retiredGuidanceProblems(root, baseline, regenerated), []);
  commitTemplates(root, ['Intermediate wording.'], 'batch one', list);
  const tip = commitTemplates(root, ['Published guidance.'], 'batch two', list);
  fs.writeFileSync(path.join(root, 'NOTES.md'), 'docs');
  git(root, 'add', '-A');
  git(root, 'commit', '--quiet', '-m', 'docs only');
  assert.deepEqual(retiredGuidanceProblems(root, tip, git(root, 'rev-parse', 'HEAD')), []);
});
