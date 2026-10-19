#!/usr/bin/env node
'use strict';

const { Setup, currentBacklogStatus, initialize } = require('../../internal/setup');
const { inspectTemplates } = require('../../internal/template-text');
const { requireCondition } = require('../../internal/runtime/store');
const fs = require('node:fs');
const path = require('node:path');

function main(args = process.argv.slice(2)) {
  const [action, root, optionsFile] = args;
  requireCondition(['inspect', 'apply'].includes(action) && root, 'usage', 'Usage: node init-backlog.js <inspect|apply> <project-root> [options.json]');
  const options = optionsFile ? JSON.parse(fs.readFileSync(optionsFile, 'utf8').replace(/^\uFEFF/, '')) : {};
  if (action === 'apply') return initialize(root, options);
  const setup = new Setup(root);
  try {
    const result = setup.inspect(options);
    // Template differences are computed from the current files on every inspect and never journaled.
    const templates = result.status === 'unwrap-recovery-required' ? { unavailable: 'unwrap-recovery-required' } : inspectTemplates(root, { validate: () => currentBacklogStatus(fs.realpathSync.native(root)) });

    return { ...result, templates };
  } finally { setup.close(); }
}

if (require.main === module) {
  try {
    const admitted = require('../../internal/releases/entry').admitEntry(path.resolve(__dirname, '../..'), process.argv.slice(2), 1, { exactProject: true });
    process.stdout.write(JSON.stringify(main(admitted.args), null, 2) + String.fromCharCode(10));
  }
  catch (error) { process.stderr.write(JSON.stringify({ error: error.code ?? 'setup-failed', message: error.message, ...(error.completed?.length ? { completed: error.completed } : {}) }) + String.fromCharCode(10)); process.exitCode = 1; }
}

module.exports = { main };
