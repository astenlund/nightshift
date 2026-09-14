#!/usr/bin/env node
'use strict';

const backlogCatalog = require('../../internal/backlog-catalog');
const path = require('node:path');

module.exports = {
  LABEL_AT_START: backlogCatalog.LABEL_AT_START,
  CatalogError: backlogCatalog.CatalogError,
  canonicalBacklogRootIdentity: backlogCatalog.canonicalBacklogRootIdentity,
  canonicalPath: backlogCatalog.canonicalPath,
  compareTargets: backlogCatalog.compareTargets,
  detectHardWraps: backlogCatalog.detectHardWraps,
  unwrapText: backlogCatalog.unwrapText,
  collectMarkdownFiles: backlogCatalog.collectMarkdownFiles,
  isContainedPath: backlogCatalog.isContainedPath,
  normalizeCatalogItems: backlogCatalog.normalizeCatalogItems,
  analyzeUnwrapCatalog: backlogCatalog.analyzeUnwrapCatalog,
};

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    const admitted = require('../../internal/releases/entry').admitEntry(path.resolve(__dirname, '../..'), args, args.findIndex(argument => argument !== '--write'));
    backlogCatalog.runCli(admitted.args);
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error.code ?? 'unwrap-failed', message: error.message }) + '\n');
    process.exitCode = 1;
  }
}
