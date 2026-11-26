'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const childProcess = require('node:child_process');
const { resolveTrustedExecutable } = require('./filesystem-primitives');
const { acquireLock, inspectLock } = require('./unwrap-lock');
const { hash, projectFile } = require('./runtime/evidence');
const { RunError, requireCondition } = require('./runtime/errors');

const STAGING_DIRECTORY = '.nightshift/setup';
const BASELINE_PATH = STAGING_DIRECTORY + '/review-model.json';
const PUBLICATION_LOCK = { name: 'review-model.lock.sqlite', label: 'review model setup', codePrefix: 'review-model', allowRelocation: true };
const isDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const validPublication = value => value === undefined || typeof value?.id === 'string' && /^[0-9a-f-]{36}$/.test(value.id) && (value.before === null || isDigest(value.before));

function readPublicationJournal(root) {
  let bytes;
  try {
    const file = projectFile(root, BASELINE_PATH);
    if (!fs.lstatSync(file, { throwIfNoEntry: false })) return { record: null, bytes: null };
    bytes = fs.readFileSync(file);
  } catch (error) {
    return { record: null, readError: error.message };
  }
  try {
    const record = JSON.parse(bytes.toString('utf8'));
    if (record?.schema === 1 && (record.baseline === null || typeof record.baseline === 'string') &&
        (record.projectTextSha256 === undefined || isDigest(record.projectTextSha256)) &&
        (record.baseline === null || isDigest(record.projectTextSha256)) &&
        (record.pending === null || typeof record.pending?.baseline === 'string' && isDigest(record.pending.after) && validPublication(record.pending.publication))) {
      return { record, bytes };
    }
  } catch {
    // Only the live project and bundled texts can be compared with unknown journal content.
  }

  return { record: null, bytes };
}

function publicationPaths(root, { id }) {
  const relative = `${STAGING_DIRECTORY}/review-model-${id}`;
  const prefix = projectFile(root, relative);

  return { target: path.join(projectFile(root, '.nightshift'), 'REVIEW.md'), next: prefix + '.next', previous: prefix + '.previous', recoveryPath: relative + '.previous' };
}

const entry = file => fs.lstatSync(file, { throwIfNoEntry: false, bigint: true });
const powerShell = root => resolveTrustedExecutable({ root, basename: process.platform === 'win32' ? 'pwsh.exe' : 'pwsh' });

function acquirePublicationLock(root, directory) {
  return acquireLock(directory, { ...PUBLICATION_LOCK, publishNewLock: initialize => {
    const executable = powerShell(root);
    const publication = { id: randomUUID() };
    const staged = path.join(directory, `review-model-${publication.id}.lock`);
    const target = path.join(directory, PUBLICATION_LOCK.name);
    // Keep unfinished initialization off the lock path. File.Move preserves the initialized lock's identity.
    initialize(staged);
    try {
      install(root, executable, publication, 'lock', staged);
    } catch (error) {
      // Another initializer may win. acquireLock still authenticates the published file and takes its SQLite lock.
      if (error.code !== 'review-model-move-failed' || !entry(target)) throw error;
    } finally {
      if (entry(staged)) fs.unlinkSync(staged);
    }
  } });
}

function publicationLockMovedFrom(root, previousRoot) {
  try {
    const directory = projectFile(root, STAGING_DIRECTORY);
    const lock = inspectLock(directory, PUBLICATION_LOCK);

    return lock.recordedParent === path.join(previousRoot, STAGING_DIRECTORY);
  } catch {
    // A missing, copied or otherwise unverified lock cannot establish continuity of the checkout.
    return false;
  }
}

function singleFile(file) {
  const stat = entry(file);
  requireCondition(stat?.isFile() && stat.nlink === 1n, 'unsafe-review-model-publication', 'Review model publication needs a regular single-link file');

  return stat;
}

// File.Move without overwrite publishes the flushed file within this project volume and leaves an occupied target alone.
function install(root, executable, publication, part, source) {
  singleFile(source);
  const result = childProcess.spawnSync(executable, ['-NoProfile', '-NonInteractive', '-File', path.join(__dirname, 'review-model-move.ps1'), '-ProjectRoot', root, '-PublicationId', publication.id, '-Part', part],
    { windowsHide: true, timeout: 15000, maxBuffer: 8192, encoding: 'utf8' });
  requireCondition(!result.error && result.status === 0, 'review-model-move-failed', result.error?.message ?? (result.stderr || 'The no-replace move did not complete').trim());
}

function restoreIfAbsent(root, executable, publication, { target, previous }) {
  if (entry(previous) && !entry(target)) install(root, executable, publication, 'previous', previous);
}

function preparePublication(root, before, bytes) {
  const publication = { id: randomUUID(), before: before?.sha256 ?? null };
  const { target, next } = publicationPaths(root, publication);
  const mode = before ? Number(singleFile(target).mode & 0o777n) : 0o644;
  fs.writeFileSync(next, bytes, { flag: 'wx', flush: true, mode });

  return publication;
}

function preservedPolicy(root, publication) {
  const paths = publicationPaths(root, publication);

  return entry(paths.previous) ? paths.recoveryPath : null;
}

function previousMatches(root, publication) {
  if (publication.before === null) return true;
  const { previous } = publicationPaths(root, publication);
  try {
    singleFile(previous);

    return hash(fs.readFileSync(previous)) === publication.before;
  } catch {
    // A missing or unreadable displaced file cannot establish the approved before-image.
    return false;
  }
}

function publicationStillStaged(root, publication, expected) {
  try {
    const { next } = publicationPaths(root, publication);
    singleFile(next);

    return hash(fs.readFileSync(next)) === expected;
  } catch {
    // An unreadable or absent staging file cannot prove a publication was left unapplied.
    return false;
  }
}

function checkDisplacedPolicy(previous, before) {
  if (before === null) return;
  singleFile(previous);
  requireCondition(hash(fs.readFileSync(previous)) === before, 'review-model-drift', 'The displaced policy differs from the approved version');
}

function publishReviewModel(root, publication) {
  const paths = publicationPaths(root, publication);
  let executable;
  let installing = false;
  try {
    executable = powerShell(root);
    if (publication.before !== null) {
      fs.renameSync(paths.target, paths.previous);
      checkDisplacedPolicy(paths.previous, publication.before);
    }
    installing = true;
    install(root, executable, publication, 'next', paths.next);
    installing = false;
    checkDisplacedPolicy(paths.previous, publication.before);
  } catch (cause) {
    let code = cause.code === 'review-model-drift' ? cause.code : 'review-model-publication-failed';
    const messages = [`Review model publication could not finish safely: ${cause.message}`];
    try {
      // Establish occupancy before restoration can put the approved original back at the target.
      if (installing && entry(paths.next) && entry(paths.target)) code = 'review-model-drift';
      if (executable) restoreIfAbsent(root, executable, publication, paths);
      if (entry(paths.previous)) messages.push(`Displaced policy is preserved at ${paths.recoveryPath}`);
    } catch (error) {
      messages.push(`Restoration needs attention: ${error.message}`, `Check for the displaced policy at ${paths.recoveryPath}`);
    }
    const message = messages.map(part => part.trimEnd()).map(part => /[.!?]$/.test(part) ? part : part + '.').join(' ');
    throw new RunError(code, message);
  }
}

module.exports = { BASELINE_PATH, STAGING_DIRECTORY, acquirePublicationLock, isDigest, preparePublication, preservedPolicy, previousMatches, publicationLockMovedFrom, publicationStillStaged, publishReviewModel, readPublicationJournal };
