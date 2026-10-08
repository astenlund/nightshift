'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Returns the 8.3 short leaf name Windows reports for an existing entry, or null when the volume gives it none distinct from
// its long name. The command is passed verbatim so cmd.exe, not Node's argument quoting, handles the quoted path.
function shortLeaf(target) {
  const result = spawnSync('cmd.exe', ['/d', '/s', '/c', `"for %I in ("${target}") do @echo %~sI"`], { windowsHide: true, windowsVerbatimArguments: true, encoding: 'utf8', timeout: 10000 });
  if (result.error || result.status !== 0) return null;
  const leaf = path.win32.basename(result.stdout.trim());
  return leaf && leaf.toUpperCase() !== path.win32.basename(target).toUpperCase() ? leaf : null;
}

module.exports = { shortLeaf };
