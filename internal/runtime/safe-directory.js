'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { requireCondition } = require('./errors');

// Resolves a runtime directory under the project root, refusing a segment that escapes it and any directory that is linked or not a
// directory; with create, missing segments are made on the way.
function safeDirectory(root, relative, create = false) {
  const canonical = fs.realpathSync.native(root);
  let current = canonical;
  for (const segment of relative.split('/')) {
    requireCondition(segment !== '' && segment !== '.' && segment !== '..' && !segment.includes('\\'), 'unsafe-path', 'Invalid runtime directory');
    current = path.join(current, segment);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current);
    const stat = fs.lstatSync(current);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && fs.realpathSync.native(current) === current, 'unsafe-path', `Runtime directory is linked or not a directory: ${current}`);
  }

  return current;
}

module.exports = { safeDirectory };
