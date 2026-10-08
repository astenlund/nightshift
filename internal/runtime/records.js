'use strict';

const { requireCondition } = require('./errors');

function recordKind(state) {
  const kind = state.kind === undefined ? 'delivery' : state.kind;
  requireCondition(kind === 'delivery' || kind === 'review', 'unsupported-record-kind', 'Runtime state must identify delivery or review ownership');
  return kind;
}

function isReviewContext(state) { return recordKind(state) === 'review'; }

function requireDelivery(state, action) {
  requireCondition(!isReviewContext(state), 'delivery-required', `${action} applies to a handed-over delivery run, not a standalone review context`);
}

module.exports = { recordKind, isReviewContext, requireDelivery };
