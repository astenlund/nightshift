'use strict';

// A command that exits while leaving a long-lived descendant in its job, like a build server:
// node lingering-descendant.cjs <holds-output|ignores-output> <exit code>
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const [mode, exitCode] = process.argv.slice(2);
if (mode === '--leaf') setInterval(() => {}, 1000);
else {
  // Detached, because libuv ends an ordinary child with its parent; a build server outlives the build the same way.
  const leaf = spawn(process.execPath, [__filename, '--leaf'], { detached: true, stdio: mode === 'holds-output' ? 'inherit' : 'ignore', windowsHide: true });
  fs.writeFileSync('lingering.pid', String(leaf.pid) + '\n');
  process.stdout.write('command finished\n');
  process.exit(Number(exitCode));
}
