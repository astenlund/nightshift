'use strict';

const { UUID } = require('./record-ids');
const { requireCondition } = require('./errors');

function runtimeTarget(request = {}) {
  const review = Object.hasOwn(request, 'reviewContextId');
  const delivery = Object.hasOwn(request, 'runId');
  requireCondition(!(review && delivery), 'invalid-runtime-target', 'Choose a delivery run or a standalone review context, not both');
  const accepting = request.action === 'handover' && Object.hasOwn(request, 'tasks');
  const opening = request.action === 'open-review';
  requireCondition(!(request.action === 'handover' && review), 'invalid-runtime-target', 'Handover always targets delivery storage');
  requireCondition(!(opening && delivery), 'invalid-review-context', 'Standalone revision does not accept a delivery selector');
  if (review) requireCondition(typeof request.reviewContextId === 'string' && UUID.test(request.reviewContextId), 'invalid-review-context', 'Review contexts require their immutable UUID identity');
  if (delivery) requireCondition(typeof request.runId === 'string' && UUID.test(request.runId), 'invalid-runtime-target', 'Delivery selectors require an immutable UUID identity');
  const kind = review || opening ? 'review' : 'delivery';
  const id = review ? request.reviewContextId : request.runId;
  return { kind, id, reference: id === undefined ? undefined : kind === 'review' ? 'review:' + id : id, creating: accepting || opening };
}

module.exports = { runtimeTarget };
