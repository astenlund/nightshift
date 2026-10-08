'use strict';

const { fixtureReport } = require('./fixtures/report');
const { fixtureContinuation } = require('./fixtures/continuation');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { RunStore } = require('../internal/runtime/store');
const { obligationBrief, transition } = require('../internal/runtime/lifecycle');
const { scratchFailure, scratchStatus } = require('../internal/runtime/scratch');
const { fixtureControllerClaim, executeWithFixtureController } = require('./fixtures/controller-claim');

const actor = { host: 'codex', session: 'controller' };
const LORE = [{ id: 'lessons', title: 'Retrospective', kind: 'lore', agreement: { source: 'User', outcome: 'Reflect without an instruction proposal' } }];
const IGNORE_NOTICE = /\.tmp is not ignored here.*add \/\.tmp\/ to \.gitignore or \.git\/info\/exclude/;

function git(root, args) {
  const result = spawnSync('git', ['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', ...args], { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

// Runs work with one environment variable set, restoring its previous value or absence afterwards.
function withEnvironment(name, value, work) {
  const saved = process.env[name];
  process.env[name] = value;
  try {
    return work();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

// A committed Git project with the given files, ignoring .tmp unless told otherwise. Its stores close before its folder is
// removed, in one hook, since an open store keeps the folder in use.
function project(t, { ignored = true, files = {} } = {}) {
  const parent = path.resolve(__dirname, '../.tmp/scratch-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const stores = [];
  t.after(() => {
    for (const store of stores) store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  git(root, ['init', '--quiet']);
  write('src.js', 'module.exports = 1;\n');
  if (ignored) write('.gitignore', '/.tmp/\n');
  for (const [file, content] of Object.entries(files)) write(file, content);
  git(root, ['add', '--force', '.']);
  git(root, ['commit', '--quiet', '-m', 'test(fixture): establish scratch baseline']);
  return { root, stores, write, baseSha: git(root, ['rev-parse', 'HEAD']) };
}

// A lore run with its session closing recorded, so completion reaches the scratch check; the base stands for its first dispatch.
function closedRun(p, baseSha = p.baseSha) {
  const store = new RunStore(p.root, { create: true });
  p.stores.push(store);
  store.create({ mechanism: fixtureContinuation(), objective: 'Deliver accepted work', authority: 'User agreed the scope', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: LORE });
  const act = request => {
    fixtureReport(store, actor, request);
    return store.update(actor, store.read().revision, request.action, state => transition(state, request));
  };
  if (baseSha) store.update(actor, store.read().revision, 'fixture-review-base', state => { state.baseSha = baseSha; });
  act({ action: 'advance', taskId: 'lessons', evidence: 'Retrospective completed; no instruction proposal' });
  act({ action: 'triage', evidence: 'No follow-ups' });
  return { act, scratch: () => obligationBrief(store.read()).scratch };
}

test('the scratch status warns when .tmp is not ignored, and a shared rule or a private exclusion quiets it', t => {
  // Arrange
  const open = project(t, { ignored: false });
  const shared = project(t);

  // Act
  const unignored = scratchStatus(open.root);
  fs.mkdirSync(path.join(open.root, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(open.root, '.git', 'info', 'exclude'), '/.tmp/\n');

  // Assert
  assert.equal(unignored.applies, true);
  assert.equal(unignored.ignored, false);
  assert.match(unignored.notices.join('\n'), IGNORE_NOTICE);
  assert.deepEqual(scratchStatus(shared.root), { applies: true, ignored: true, tracked: [], trackedCount: 0, notices: [] });
  assert.equal(scratchStatus(open.root).ignored, true);
});

test('a rule that ignores only some names under .tmp still draws the warning, while one that ignores every entry does not', t => {
  // Arrange
  const dotfiles = project(t, { ignored: false, files: { '.gitignore': '/.tmp/.*\n' } });
  const fileType = project(t, { ignored: false, files: { '.gitignore': '*.txt\n' } });
  const entries = project(t, { ignored: false, files: { '.gitignore': '/.tmp/*\n' } });

  // Act
  const partial = [scratchStatus(dotfiles.root), scratchStatus(fileType.root)];
  const whole = scratchStatus(entries.root);

  // Assert
  for (const status of partial) {
    assert.equal(status.ignored, false);
    assert.match(status.notices.join('\n'), IGNORE_NOTICE);
  }
  assert.equal(whole.ignored, true);
  assert.deepEqual(whole.notices, []);
});

test('creating a run and reading its status report the scratch status before any agent writes scratch', async t => {
  // Arrange
  const p = project(t, { ignored: false });

  // Act
  const created = await executeWithFixtureController(p.root, { action: 'handover', mechanism: fixtureContinuation(), objective: 'Deliver accepted work', authority: 'User agreed the scope', controller: actor, tasks: LORE });
  const status = await executeWithFixtureController(p.root, { action: 'status' });

  // Assert
  assert.equal(created.scratch.ignored, false);
  assert.match(created.scratch.notices.join('\n'), IGNORE_NOTICE);
  assert.deepEqual(status.scratch, created.scratch);
});

test('completion refuses .tmp paths the run added to the index until they leave it, and names the commits to squash', t => {
  // Arrange
  const p = project(t);
  const run = closedRun(p);
  p.write('.tmp/scratch.txt', 'probe output\n');

  // Act
  git(p.root, ['add', '--force', '.tmp/scratch.txt']);
  const staged = () => run.act({ action: 'complete' });
  assert.throws(staged, { code: 'committed-scratch', message: /\.tmp\/scratch\.txt.*git rm --cached/ });
  git(p.root, ['commit', '--quiet', '-m', 'chore(fixture): commit scratch by mistake']);
  const adding = git(p.root, ['rev-parse', 'HEAD']);
  assert.throws(staged, { code: 'committed-scratch' });
  assert.match(run.scratch().notices.join('\n'), /This run added \.tmp paths to the index: \.tmp\/scratch\.txt/);
  git(p.root, ['rm', '--cached', '--quiet', '.tmp/scratch.txt']);
  git(p.root, ['commit', '--quiet', '-m', 'chore(fixture): untrack scratch']);
  const scratch = run.scratch();

  // Assert
  assert.deepEqual(scratch.tracked, []);
  assert.deepEqual(scratch.notices, [`Commits in this run added .tmp paths: ${adding}; squash the scratch out of them before publishing`]);
  assert.equal(run.act({ action: 'complete' }).status, 'complete');
  assert.ok(fs.existsSync(path.join(p.root, '.tmp', 'scratch.txt')));
});

test('a merged side branch that added and then removed scratch is named for squashing', t => {
  // Arrange
  const p = project(t);
  const run = closedRun(p);
  const main = git(p.root, ['branch', '--show-current']);
  git(p.root, ['checkout', '--quiet', '-b', 'side']);
  p.write('.tmp/side.txt', 'side branch scratch\n');
  git(p.root, ['add', '--force', '.tmp/side.txt']);
  git(p.root, ['commit', '--quiet', '-m', 'chore(fixture): add scratch on a side branch']);
  const adding = git(p.root, ['rev-parse', 'HEAD']);
  git(p.root, ['rm', '--cached', '--quiet', '.tmp/side.txt']);
  git(p.root, ['commit', '--quiet', '-m', 'chore(fixture): untrack the side scratch']);
  git(p.root, ['checkout', '--quiet', main]);

  // Act
  git(p.root, ['merge', '--quiet', '--no-ff', 'side', '-m', 'chore(fixture): merge the side branch']);
  const scratch = run.scratch();

  // Assert
  assert.deepEqual(scratch.notices, [`Commits in this run added .tmp paths: ${adding}; squash the scratch out of them before publishing`]);
  assert.equal(run.act({ action: 'complete' }).status, 'complete');
});

test('a merge that itself introduced scratch is named for squashing, while a clean merge is not', t => {
  // Arrange
  const p = project(t);
  const run = closedRun(p);
  const main = git(p.root, ['branch', '--show-current']);
  // Empty commits keep the reviewed inventory unchanged, so only the scratch check decides completion.
  git(p.root, ['checkout', '--quiet', '-b', 'side']);
  git(p.root, ['commit', '--quiet', '--allow-empty', '-m', 'chore(fixture): add side work']);
  git(p.root, ['checkout', '--quiet', main]);
  git(p.root, ['commit', '--quiet', '--allow-empty', '-m', 'chore(fixture): add main work']);
  git(p.root, ['merge', '--quiet', '--no-ff', '--no-commit', 'side']);
  p.write('.tmp/merge.txt', 'scratch staged while resolving the merge\n');
  git(p.root, ['add', '--force', '.tmp/merge.txt']);
  git(p.root, ['commit', '--quiet', '-m', 'chore(fixture): merge with scratch']);
  const merging = git(p.root, ['rev-parse', 'HEAD']);
  git(p.root, ['rm', '--cached', '--quiet', '.tmp/merge.txt']);
  git(p.root, ['commit', '--quiet', '-m', 'chore(fixture): untrack the merge scratch']);
  git(p.root, ['checkout', '--quiet', '-b', 'later']);
  git(p.root, ['commit', '--quiet', '--allow-empty', '-m', 'chore(fixture): add later work']);
  git(p.root, ['checkout', '--quiet', main]);

  // Act
  git(p.root, ['merge', '--quiet', '--no-ff', 'later', '-m', 'chore(fixture): merge cleanly']);
  const scratch = run.scratch();

  // Assert
  assert.deepEqual(scratch.notices, [`Commits in this run added .tmp paths: ${merging}; squash the scratch out of them before publishing`]);
  assert.equal(run.act({ action: 'complete' }).status, 'complete');
});

test('completion refuses when Git cannot read the run\'s history, as the status says', t => {
  // Arrange
  const p = project(t);
  const run = closedRun(p);
  p.write('.tmp/scratch.txt', 'probe output\n');
  git(p.root, ['add', '--force', '.tmp/scratch.txt']);
  git(p.root, ['commit', '--quiet', '-m', 'chore(fixture): commit scratch by mistake']);
  const adding = git(p.root, ['rev-parse', 'HEAD']);
  git(p.root, ['rm', '--cached', '--quiet', '.tmp/scratch.txt']);
  git(p.root, ['commit', '--quiet', '-m', 'chore(fixture): untrack scratch']);
  const object = path.join(p.root, '.git', 'objects', adding.slice(0, 2), adding.slice(2));
  const hidden = `${object}.hidden`;

  // Act
  fs.renameSync(object, hidden);
  let scratch;
  try {
    scratch = run.scratch();
    assert.throws(() => run.act({ action: 'complete' }), { code: 'committed-scratch', message: /could not read the run's commits after its review base/ });
  } finally {
    fs.renameSync(hidden, object);
  }

  // Assert
  assert.deepEqual(scratch.tracked, []);
  assert.deepEqual(scratch.notices, ['Git could not read the run\'s commits after its review base, so completion cannot establish which of them added .tmp paths']);
  assert.equal(run.act({ action: 'complete' }).status, 'complete');
});

test('.tmp paths tracked before the run, or on a run without a review base, draw a notice and never refuse completion', t => {
  // Arrange
  const earlier = project(t, { files: { '.tmp/legacy.txt': 'tracked long ago\n' } });
  const unbased = project(t);
  const based = closedRun(earlier);
  const unattributed = closedRun(unbased, null);
  unbased.write('.tmp/unattributed.txt', 'no base to compare with\n');
  git(unbased.root, ['add', '--force', '.tmp/unattributed.txt']);

  // Act
  const before = based.scratch();
  const without = unattributed.scratch();

  // Assert
  assert.deepEqual(before.tracked, ['.tmp/legacy.txt']);
  assert.deepEqual(before.notices, ['.tmp paths tracked before this run, which are not its to repair: .tmp/legacy.txt']);
  assert.equal(based.act({ action: 'complete' }).status, 'complete');
  assert.deepEqual(without.notices, ['Tracked .tmp paths that this run cannot attribute, since it recorded no review base: .tmp/unattributed.txt; check whether any is scratch']);
  assert.equal(unattributed.act({ action: 'complete' }).status, 'complete');
});

test('outside Git the scratch checks do not apply, and a Git failure refuses completion', t => {
  // Arrange
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'nightshift-scratch-outside-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const outside = path.join(parent, 'project');
  fs.mkdirSync(path.join(outside, '.tmp'), { recursive: true });
  fs.writeFileSync(path.join(outside, '.tmp', 'scratch.txt'), 'never committed\n');
  const p = project(t);

  // Act
  const [outsideStatus, outsideFailure] = withEnvironment('GIT_CEILING_DIRECTORIES', parent, () => [scratchStatus(outside), scratchFailure(outside)]);
  const [brokenStatus, brokenFailure] = withEnvironment('GIT_CONFIG_COUNT', 'invalid-count', () => [scratchStatus(p.root, p.baseSha), scratchFailure(p.root, p.baseSha)]);

  // Assert
  assert.deepEqual(outsideStatus, { applies: false });
  assert.equal(outsideFailure, null);
  assert.equal(brokenStatus.ignored, null);
  assert.equal(brokenStatus.tracked, null);
  assert.match(brokenStatus.notices.join('\n'), /Git could not say whether \.tmp is ignored/);
  assert.match(brokenFailure, /Git could not list the tracked \.tmp paths/);
});
