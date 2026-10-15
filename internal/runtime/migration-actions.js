'use strict';

const READ_ONLY_MIGRATION_ACTIONS = new Set(['inventory', 'manifest', 'raw-inspect']);
const MIGRATION_ACTIONS = new Set([...READ_ONLY_MIGRATION_ACTIONS, 'retire']);

function isMigrationAction(action) { return MIGRATION_ACTIONS.has(action); }

function isReadOnlyMigrationAction(action) { return READ_ONLY_MIGRATION_ACTIONS.has(action); }

module.exports = { MIGRATION_ACTIONS, isMigrationAction, isReadOnlyMigrationAction };
