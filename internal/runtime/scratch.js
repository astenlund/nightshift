'use strict';

const { spawnSync } = require('node:child_process');
const { outsideGitWorktree } = require('./evidence');

// Nightshift and its agents keep scratch under the project's .tmp directory, which review inventories leave out, so only Git's
// ignore policy keeps that scratch out of commits. Nothing here edits that policy: the status names it, and completion refuses
// scratch the run added to the index. Each answer is computed when asked and never stored.
const SCRATCH_DIRECTORY = '.tmp';
// The ignore check samples names rather than proving the whole directory ignored: two never-tracked ordinary names that share no
// suffix, one at the top of .tmp and one nested like Nightshift's own request files, so a rule that covers only dotfiles, one name
// or one file type does not pass for the directory.
const IGNORE_PROBES = Object.freeze([`${SCRATCH_DIRECTORY}/nightshift-ignore-probe`, `${SCRATCH_DIRECTORY}/nightshift/scratch.ignore-probe`]);
const LISTED_PATHS = 20;
const IGNORE_FIX = 'add /.tmp/ to .gitignore or .git/info/exclude; Nightshift does not edit the ignore policy';
const UNLISTED = 'Git could not list the tracked .tmp paths, so completion cannot establish that no scratch is committed';
const UNREAD_HISTORY = 'Git could not read the run\'s commits after its review base, so completion cannot establish which of them added .tmp paths';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30000 });

  return result.error ? null : result;
}

// Whether Git ignores new ordinary files under .tmp: true when it ignores every probe, false when it misses one, or null when Git
// cannot say.
function scratchIgnored(root) {
  // The probe names are plain ASCII, so the line-per-path output needs no quoting-aware parse.
  const result = git(root, ['check-ignore', '--', ...IGNORE_PROBES]);
  if (result?.status !== 0 && result?.status !== 1) return null;
  const ignored = new Set(lines(result.stdout));

  return IGNORE_PROBES.every(probe => ignored.has(probe));
}

// The .tmp paths in the index, which holds staged additions too, or in a commit's tree; null when Git cannot list them.
function trackedScratch(root, revision = null) {
  const result = git(root, revision ? ['ls-tree', '-r', '-z', '--name-only', revision, '--', SCRATCH_DIRECTORY] : ['ls-files', '-z', '--cached', '--', SCRATCH_DIRECTORY]);

  return result?.status === 0 ? result.stdout.split('\0').filter(Boolean).sort() : null;
}

function lines(output) {
  return output.split('\n').map(line => line.trim()).filter(Boolean);
}

// Whether a merge's tree holds a .tmp path that none of its own parents holds, so the merge itself introduced it; null when Git
// cannot tell.
function mergeIntroducesScratch(root, merge) {
  const parents = git(root, ['rev-parse', `${merge}^@`]);
  const own = trackedScratch(root, merge);
  if (parents?.status !== 0 || own === null) return null;
  const inherited = new Set();
  for (const parent of lines(parents.stdout)) {
    const paths = trackedScratch(root, parent);
    if (paths === null) return null;
    for (const file of paths) inherited.add(file);
  }

  return own.some(file => !inherited.has(file));
}

// Commits after the base that added a .tmp path: ordinary commits on any merged branch, since history simplification would skip a
// branch that added and then removed scratch, and merges that introduced scratch themselves, for which git log computes no diff.
// Null when Git cannot list them.
function scratchCommits(root, baseSha) {
  const range = `${baseSha}..HEAD`;
  const ordinary = git(root, ['log', '--full-history', '--no-merges', '--format=%H', '--diff-filter=A', range, '--', SCRATCH_DIRECTORY]);
  const merges = git(root, ['rev-list', '--merges', '--full-history', range, '--', SCRATCH_DIRECTORY]);
  if (ordinary?.status !== 0 || merges?.status !== 0) return null;
  const introducing = [];
  for (const merge of lines(merges.stdout)) {
    const introduced = mergeIntroducesScratch(root, merge);
    if (introduced === null) return null;
    if (introduced) introducing.push(merge);
  }

  return [...introducing, ...lines(ordinary.stdout)];
}

function listed(paths) {
  return paths.length > LISTED_PATHS ? `${paths.slice(0, LISTED_PATHS).join(', ')} and ${paths.length - LISTED_PATHS} more` : paths.join(', ');
}

// What Git reports about the run's scratch, for the status and the completion gate alike: the tracked .tmp paths split by whether
// the run's cumulative review base already tracked them, and the commits after that base that added .tmp paths. Without a base
// nothing can be attributed to the run, so every tracked path counts as earlier and no history is read. A Git failure leaves its
// part null, and `unanswered` names it.
function scratchState(root, baseSha) {
  const tracked = trackedScratch(root);
  const atBase = baseSha ? trackedScratch(root, baseSha) : [];
  const before = new Set(atBase ?? []);
  const split = tracked === null || atBase === null ? null : { added: baseSha ? tracked.filter(file => !before.has(file)) : [], earlier: baseSha ? tracked.filter(file => before.has(file)) : tracked };

  return { split, commits: baseSha ? scratchCommits(root, baseSha) : [] };
}

// Why Git could not answer the scratch check, or null; the status reports it and completion refuses on it.
function unanswered(state) {
  if (state.split === null) return UNLISTED;

  return state.commits === null ? UNREAD_HISTORY : null;
}

// The live scratch status a run's brief reports. Outside Git nothing can be committed, so it does not apply.
function scratchStatus(root, baseSha = null) {
  if (outsideGitWorktree(root)) return { applies: false };
  const ignored = scratchIgnored(root);
  const state = scratchState(root, baseSha);
  const { split, commits } = state;
  const failure = unanswered(state);
  const notices = [];
  if (ignored === false) notices.push(`.tmp is not ignored here, so scratch written there can be committed: ${IGNORE_FIX}`);
  if (ignored === null) notices.push(`Git could not say whether .tmp is ignored; confirm it, and if it is not, ${IGNORE_FIX}`);
  if (failure) notices.push(failure);
  if (split?.added.length) notices.push(`This run added .tmp paths to the index: ${listed(split.added)}; remove them from the index and commit before completion`);
  if (split?.earlier.length && baseSha) notices.push(`.tmp paths tracked before this run, which are not its to repair: ${listed(split.earlier)}`);
  if (split?.earlier.length && !baseSha) notices.push(`Tracked .tmp paths that this run cannot attribute, since it recorded no review base: ${listed(split.earlier)}; check whether any is scratch`);
  if (commits?.length) notices.push(`Commits in this run added .tmp paths: ${commits.join(', ')}; squash the scratch out of them before publishing`);

  const tracked = split ? [...split.added, ...split.earlier].sort() : null;

  return { applies: true, ignored, tracked: tracked?.slice(0, LISTED_PATHS) ?? null, trackedCount: tracked?.length ?? null, notices };
}

// Why completion is refused for committed scratch, or null: the index holds .tmp paths the run's base did not, or Git cannot answer.
function scratchFailure(root, baseSha = null) {
  if (outsideGitWorktree(root)) return null;
  const state = scratchState(root, baseSha);
  const failure = unanswered(state);
  if (failure) return failure;

  return state.split.added.length === 0 ? null : `The index holds .tmp paths this run added: ${listed(state.split.added)}; remove them from the index (git rm --cached) and commit, keeping the files in the ignored .tmp`;
}

module.exports = { scratchFailure, scratchStatus };
