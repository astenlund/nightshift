'use strict';

// Starts a detached child that outlives this process, prints the child's PID and exits,
// leaving the child with a Windows parent process that no longer exists.
const { spawn } = require('node:child_process');

const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
process.stdout.write(`${child.pid}\n`);
