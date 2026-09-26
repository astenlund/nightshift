'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { RunError, safeDirectory } = require('./store');

// Windows cannot start a process whose working directory is longer than MAX_PATH, and suites run inside a
// private copy nest further copies within their own fixtures, so every copy sits one short segment below the run directory.
const PRIVATE_COPY_ROOT = '.nightshift/runs/c';
const PRIVATE_COPY_NAME = /^[0-9a-f]{8}$/;
const PRIVATE_COPY_ATTEMPTS = 16;

function createPrivateCopyDirectory(root) {
  const parent = safeDirectory(root, PRIVATE_COPY_ROOT, true);
  for (let attempt = 0; attempt < PRIVATE_COPY_ATTEMPTS; attempt++) {
    const directory = path.join(parent, randomBytes(4).toString('hex'));
    try {
      fs.mkdirSync(directory);

      return directory;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new RunError('private-copy-unavailable', `Could not allocate a private copy directory under ${PRIVATE_COPY_ROOT}`);
}

function isPrivateCopyDirectory(root, directory) {
  return path.dirname(directory) === path.join(fs.realpathSync.native(root), ...PRIVATE_COPY_ROOT.split('/')) && PRIVATE_COPY_NAME.test(path.basename(directory));
}

module.exports = { PRIVATE_COPY_ROOT, createPrivateCopyDirectory, isPrivateCopyDirectory };
