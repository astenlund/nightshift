'use strict';

const { isDeepStrictEqual } = require('node:util');
const { requireCondition, text } = require('./errors');
const { validateLimits } = require('./limits');

const REVIEW_TARGET = '#review';
const REVIEW_KINDS = new Set(['code', 'spec', 'docs', 'lore']);

function assertRepairScope(root, owner, state, writes) {
  if (state && writes === undefined) require('./project-ownership').assertCanonicalWriteScope(state);
  const delivery = require('../releases/service').readRun(root);
  if (!delivery || delivery.status === 'complete') return;
  requireCondition(isDeepStrictEqual(delivery.controller, owner), 'review-write-conflict', 'Another delivery owner holds this project; continue only isolated assessment');
  if (writes === undefined) requireCondition(delivery.workers.every(worker => ['complete', 'failed', 'stopped'].includes(worker.status)), 'review-write-conflict', 'A delivery worker has active or uncertain work; reconcile it before standalone repair');
}

function reviewInput(request) {
  requireCondition(REVIEW_KINDS.has(request.kind), 'invalid-review-kind', 'Choose code, spec, docs or lore for a standalone revision');
  requireCondition(!Object.hasOwn(request, 'tasks') && !Object.hasOwn(request, 'runId') && !Object.hasOwn(request, 'mode'), 'invalid-review-context', 'Standalone revision does not accept a delivery queue, run identity or execution mode');
  text(request.authority, 'review authority');
  text(request.objective, 'review objective');
  text(request.agreement?.source, 'review agreement.source');
  text(request.agreement?.outcome, 'review agreement.outcome');
  validateLimits(request.limits ?? {});
  return {
    controller: request.controller,
    authority: request.authority,
    objective: request.objective,
    limits: request.limits ?? {},
    publication: { authorized: false },
    tasks: [{ id: REVIEW_TARGET, title: request.objective, kind: request.kind, agreement: request.agreement }],
  };
}

function openReview(store, request, resources, resourceMode, ownerObservation = null) {
  const input = reviewInput(request);
  const existing = store.read();
  if (existing) {
    const opening = { authority: input.authority, objective: input.objective, kind: request.kind, agreement: input.tasks[0].agreement, limits: input.limits, resources };
    requireCondition(isDeepStrictEqual(existing.controller, request.controller) && isDeepStrictEqual(existing.opening, opening), 'review-context-conflict', 'This identity already belongs to another standalone revision; reconcile its original request');
    return existing;
  }
  return store.create({ ...input, resources, resourceMode, ownerObservation });
}

module.exports = { REVIEW_TARGET, REVIEW_KINDS, reviewInput, openReview, assertRepairScope };
