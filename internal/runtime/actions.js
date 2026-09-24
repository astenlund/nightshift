'use strict';

const READ_ONLY_ACTIONS = new Set(['status', 'inspect', 'history', 'wait']);
const RUNTIME_ACTIONS = new Set([
  ...READ_ONLY_ACTIONS, 'create', 'adopt', 'claim-controller', 'resume', 'dispatch', 'probe', 'check', 'review', 'validate',
  'add-spec-review', 'start-task', 'dispose', 'repair', 'advance', 'block', 'unblock', 'retrospective', 'report', 'report-delivered',
  'triage', 'followup', 'resolve-followup', 'invalidate-continuation', 'continuation', 'handover', 'worker', 'worker-finished', 'stop', 'complete',
]);

function isReadOnlyAction(action) { return READ_ONLY_ACTIONS.has(action); }

function isRuntimeAction(action) { return RUNTIME_ACTIONS.has(action); }

function unknownActionMessage(action) {
  const supplied = action === undefined ? 'is missing' : `${JSON.stringify(action)} is not a runtime action`;

  return `The request key action ${supplied}; accepted actions: ${[...RUNTIME_ACTIONS].join(', ')}`;
}

module.exports = { RUNTIME_ACTIONS, isReadOnlyAction, isRuntimeAction, unknownActionMessage };
