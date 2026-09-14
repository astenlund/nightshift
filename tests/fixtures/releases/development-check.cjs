'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const [repository, target, resultFile] = process.argv.slice(2);
fs.mkdirSync(target, { recursive: true });
const git = spawnSync('git', ['init', '--quiet'], { cwd: target, windowsHide: true, encoding: 'utf8' });
if (git.error || git.status !== 0) throw new Error(git.error?.message ?? git.stderr);
let failure = null;
try { require(path.join(repository, 'internal/setup')).initialize(target); }
catch (error) { failure = { code: error.code ?? null, message: error.message }; }
fs.writeFileSync(resultFile, JSON.stringify({ inheritedBinding: !!process.env.NIGHTSHIFT_RESOURCE_CONTEXT, executionMode: process.env.NIGHTSHIFT_EXECUTION_MODE ?? null, failure }) + '\n');
if (failure) process.exitCode = 1;
