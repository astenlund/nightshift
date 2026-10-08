'use strict';

const READ_ONLY_ACTIONS = new Set(['status', 'inspect', 'history', 'wait']);
const RUNTIME_ACTIONS = new Set([
  ...READ_ONLY_ACTIONS, 'open-review', 'adopt', 'claim-controller', 'resume', 'dispatch', 'probe', 'check', 'review', 'validate', 'dialogue',
  'add-spec-review', 'start-task', 'dispose', 'repair', 'advance', 'block', 'unblock', 'spec-accepted', 'retrospective', 'report', 'report-delivered',
  'triage', 'followup', 'resolve-followup', 'invalidate-continuation', 'continuation', 'handover', 'worker', 'worker-finished', 'hold', 'stop', 'complete',
]);

// Tracking edits applied after triage are reviewed by a run-level record, which task operations address by this reserved identity.
const CLOSING_TARGET = '#closing';

function isReadOnlyAction(action) { return READ_ONLY_ACTIONS.has(action); }

function isRuntimeAction(action) { return RUNTIME_ACTIONS.has(action); }

function isCreationRequest(request) {
  return request?.action === 'open-review' || request?.action === 'handover' && Object.hasOwn(request, 'tasks');
}

function requiresOwnershipInventory(request) {
  if (isCreationRequest(request) || request?.action === 'create') return true;
  if (request?.action === 'worker') return !Array.isArray(request.worker?.writes) || request.worker.writes.length > 0;
  if (request?.action === 'dispose') return request.disposition === 'implement';
  return ['adopt', 'claim-controller', 'resume', 'start-task', 'repair', 'advance', 'check', 'complete'].includes(request?.action);
}

function unknownActionMessage(action) {
  const supplied = action === undefined ? 'is missing' : `${JSON.stringify(action)} is not a runtime action`;

  return `The request key action ${supplied}; accepted actions: ${[...RUNTIME_ACTIONS].join(', ')}`;
}

module.exports = { CLOSING_TARGET, RUNTIME_ACTIONS, isCreationRequest, requiresOwnershipInventory, isReadOnlyAction, isRuntimeAction, unknownActionMessage };
