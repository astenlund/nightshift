'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const primitives = require('../../internal/filesystem-primitives');
const checkout = path.resolve(__dirname, '../..');
const target = process.env.NIGHTSHIFT_UNWRAP_TARGET;
const trace = process.env.NIGHTSHIFT_UNWRAP_TRACE;
const read = primitives.stableOpenFile;
let fired = false;
primitives.stableOpenFile = function (root, file, options) {
  if (!fired && file === target) {
    fired = true;
    const env = { ...process.env, NIGHTSHIFT_UNWRAP_FAULT: 'target-write-error' };
    delete env.NODE_OPTIONS;
    const result = spawnSync(process.execPath, ['--require', path.join(__dirname, 'unwrap-fault.cjs'), path.join(checkout, 'skills/init-backlog/unwrap.js'), '--development', '--write', target], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(fs.readFileSync(trace, 'utf8').split('\n').includes('target-partial'));
    fs.appendFileSync(trace, 'writer-before-noop-read\n');
  }
  return read(root, file, options);
};
