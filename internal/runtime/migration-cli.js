#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { admitEntry } = require('../releases/entry');
const { isMigrationAction } = require('./migration-actions');
const { requireCondition } = require('./errors');
const { sha256 } = require('./legacy-store');

function execute(root, request, context) {
  requireCondition(request && isMigrationAction(request.action), 'invalid-migration-request', 'Choose inventory, manifest, raw-inspect or retire');
  requireCondition(!context || context.administrative === true, 'migration-admission-required', 'Use the current administrative migration entry');

  return require('./legacy-migration').execute(root, request, context);
}

function main() {
  const args = process.argv.slice(2);
  const [root, requestFile] = args[0] === '--development' ? args.slice(1) : args;
  requireCondition(root && requestFile, 'usage', `Usage: node ${path.basename(__filename)} <project-root> <request.json>`);
  const content = fs.readFileSync(requestFile, 'utf8');
  const request = JSON.parse(content.startsWith(String.fromCharCode(0xfeff)) ? content.slice(1) : content);
  const admitted = admitEntry(path.resolve(__dirname, '../..'), args, 0, { exactProject: true, diagnostic: false, migrationRequest: { action: request.action, hash: sha256(Buffer.from(JSON.stringify(request))) } });
  process.stdout.write(JSON.stringify(execute(root, request, admitted.context), null, 2) + String.fromCharCode(10));
}

if (require.main === module) {
  try { main(); }
  catch (error) { process.stderr.write(JSON.stringify({ error: error.code ?? 'migration-failed', message: error.message }) + String.fromCharCode(10)); process.exitCode = 1; }
}

module.exports = { execute };
