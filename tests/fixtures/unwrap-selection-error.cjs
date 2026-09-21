'use strict';
const fs = require('node:fs');
const path = require('node:path');
const read = fs.readdirSync;
let reads = 0;
fs.readdirSync = function (directory, ...args) {
  if (path.resolve(directory) === process.env.NIGHTSHIFT_UNWRAP_BLOCKED_DIRECTORY && ++reads === 2) {
    fs.appendFileSync(process.env.NIGHTSHIFT_UNWRAP_TRACE, 'selection-read-failed\n');
    throw Object.assign(new Error('Injected selection read failure'), { code: 'EACCES' });
  }
  return read(directory, ...args);
};
