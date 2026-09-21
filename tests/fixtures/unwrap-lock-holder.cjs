'use strict';
const fs = require('node:fs');
const { acquireLock } = require('../../internal/unwrap-lock');
const [parent, trace] = process.argv.slice(2);
const lock = acquireLock(parent);
try {
  fs.writeFileSync(trace, 'locked\n');
  const deadline = Date.now() + 30000;
  while (!fs.existsSync(trace + '.release')) {
    if (Date.now() > deadline) throw new Error('Lock-holder test timed out');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
} finally { lock.close(); }
