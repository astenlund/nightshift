'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { RunError, safeDirectory } = require('./store');

// Windows cannot start a process whose working directory is longer than MAX_PATH, and ordinary tools cannot read or delete files
// past it, so folders whose contents nest deeply sit one short segment below the run directory: private copies, since suites run
// inside a copy nest further copies within their own fixtures, and Vibe reviewer homes, under which Vibe pins its plugin store.
const PRIVATE_COPY_ROOT = '.nightshift/runs/c';
const VIBE_HOME_ROOT = '.nightshift/runs/v';
const SHORT_NAME = /^[0-9a-f]{8}$/;
const SHORT_ATTEMPTS = 16;

function createShortDirectory(root, parentRelative, code) {
  const parent = safeDirectory(root, parentRelative, true);
  for (let attempt = 0; attempt < SHORT_ATTEMPTS; attempt++) {
    const directory = path.join(parent, randomBytes(4).toString('hex'));
    try {
      fs.mkdirSync(directory);

      return directory;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new RunError(code, `Could not allocate a directory under ${parentRelative}`);
}

function isShortDirectory(root, parentRelative, directory) {
  return path.dirname(directory) === path.join(fs.realpathSync.native(root), ...parentRelative.split('/')) && SHORT_NAME.test(path.basename(directory));
}

function createPrivateCopyDirectory(root) {
  return createShortDirectory(root, PRIVATE_COPY_ROOT, 'private-copy-unavailable');
}

function isPrivateCopyDirectory(root, directory) {
  return isShortDirectory(root, PRIVATE_COPY_ROOT, directory);
}

function createVibeHomeDirectory(root) {
  return createShortDirectory(root, VIBE_HOME_ROOT, 'vibe-isolation-unavailable');
}

function isVibeHomeDirectory(root, directory) {
  return isShortDirectory(root, VIBE_HOME_ROOT, directory);
}

module.exports = { PRIVATE_COPY_ROOT, VIBE_HOME_ROOT, createPrivateCopyDirectory, createVibeHomeDirectory, isPrivateCopyDirectory, isVibeHomeDirectory };
