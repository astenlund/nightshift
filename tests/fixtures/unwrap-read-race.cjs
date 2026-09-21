'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const recovery = require('../../internal/unwrap-recovery');
const target = process.env.NIGHTSHIFT_UNWRAP_TARGET;
const trace = process.env.NIGHTSHIFT_UNWRAP_TRACE;
const scenario = process.env.NIGHTSHIFT_READ_RACE;
let fired = false;

function writer() {
  if (fired) return;
  fired = true;
  const env = { ...process.env };
  if (scenario === 'after-complete') delete env.NODE_OPTIONS;
  else {
    env.NODE_OPTIONS = `--require "${path.join(__dirname, 'unwrap-fault.cjs').split(path.sep).join('/')}"`;
    env.NIGHTSHIFT_UNWRAP_FAULT = 'target-write-error';
  }
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../../skills/init-backlog/unwrap.js'), '--development', '--write', target], { env, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, scenario === 'after-complete' ? 0 : 1, result.stdout + result.stderr);
  fs.appendFileSync(trace, 'writer-ran\n');
}

const read = recovery.readUnwrapSnapshot;
recovery.readUnwrapSnapshot = function (root, file) {
  const result = read(root, file);
  if (file === target && scenario !== 'before') writer();
  return result;
};
const catalog = require('../../internal/backlog-catalog');
const discover = catalog.recoveryDiagnostics;
catalog.recoveryDiagnostics = function (...args) {
  const result = discover(...args);
  if (scenario === 'before') writer();
  return result;
};
