'use strict';

const READ_ONLY_ACTIONS = new Set(['status', 'inspect', 'history', 'wait']);

function isReadOnlyAction(action) { return READ_ONLY_ACTIONS.has(action); }

module.exports = { isReadOnlyAction };
