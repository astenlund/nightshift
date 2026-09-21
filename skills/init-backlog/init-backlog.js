#!/usr/bin/env node
'use strict';

const { Setup, initialize } = require('../../internal/setup');
const { requireCondition } = require('../../internal/runtime/store');
const fs = require('node:fs');
const path = require('node:path');

function main(args = process.argv.slice(2)) {
  const [action, root, optionsFile] = args;
  requireCondition(['inspect', 'apply'].includes(action) && root, 'usage', 'Usage: node init-backlog.js <inspect|apply> <project-root> [options.json]');
  const options = optionsFile ? JSON.parse(fs.readFileSync(optionsFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  if (action === 'apply') return initialize(root, options);
  const setup = new Setup(root);
  try { return setup.inspect(options); } finally { setup.close(); }
}

if (require.main === module) {
  try {
    const admitted = require('../../internal/releases/entry').admitEntry(path.resolve(__dirname, '../..'), process.argv.slice(2), 1, { exactProject: true });
    process.stdout.write(JSON.stringify(main(admitted.args), null, 2) + String.fromCharCode(10));
  }
  catch (error) { process.stderr.write(JSON.stringify({ error: error.code ?? 'setup-failed', message: error.message, ...(error.completed?.length ? { completed: error.completed } : {}) }) + String.fromCharCode(10)); process.exitCode = 1; }
}

module.exports = { main };
