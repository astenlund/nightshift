#!/usr/bin/env node
'use strict';

const backlogCatalog = require('../../internal/backlog-catalog');

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
  backlogCatalog.runCli(process.argv.slice(2));
}
