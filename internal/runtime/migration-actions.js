'use strict';

const READ_ONLY_MIGRATION_ACTIONS = new Set(['inventory', 'manifest', 'raw-inspect', 'close-manifest']);
// close stays non-read-only: its admission then requires the requester's live activation and refuses while another project operation
// runs, which the older-release guard and project-operation serialization depend on.
const MIGRATION_ACTIONS = new Set([...READ_ONLY_MIGRATION_ACTIONS, 'retire', 'compact-history', 'close']);

function isMigrationAction(action) { return MIGRATION_ACTIONS.has(action); }

function isReadOnlyMigrationAction(action) { return READ_ONLY_MIGRATION_ACTIONS.has(action); }

module.exports = { MIGRATION_ACTIONS, isMigrationAction, isReadOnlyMigrationAction };
