'use strict';

const { requireCondition } = require('./store');

function validateLimits(limits) {
  requireCondition(limits !== null && typeof limits === 'object' && !Array.isArray(limits), 'invalid-limits', 'Limits must be an object');
  requireCondition(Object.keys(limits).every(key => ['deadlineUtc', 'maxDispatches'].includes(key)), 'unsupported-limit', 'Supported deterministic run limits are deadlineUtc and maxDispatches. Establish a verified host mechanism for any other requested limit before unattended work; do not silently discard it.');
  if (limits.deadlineUtc !== undefined) requireCondition(typeof limits.deadlineUtc === 'string' && Number.isFinite(Date.parse(limits.deadlineUtc)) && /Z$/.test(limits.deadlineUtc), 'invalid-limits', 'deadlineUtc must be a UTC timestamp');
  if (limits.maxDispatches !== undefined) requireCondition(Number.isSafeInteger(limits.maxDispatches) && limits.maxDispatches >= 0, 'invalid-limits', 'maxDispatches must be a nonnegative integer');
  return limits;
}

function exhaustedLimit(state, options = {}) {
  if (state.limits?.deadlineUtc && (options.now ?? Date.now()) >= Date.parse(state.limits.deadlineUtc)) return 'The authorized run deadline has been reached';
  if (options.dispatch && state.limits?.maxDispatches !== undefined && (state.dispatches ?? 0) >= state.limits.maxDispatches) return 'The authorized model-dispatch allowance has been reached';
  return null;
}

function remainingTime(state, requested = 900000) {
  const remaining = state.limits?.deadlineUtc ? Date.parse(state.limits.deadlineUtc) - Date.now() : requested;
  requireCondition(remaining > 0, 'resource-limit', 'The authorized run deadline has been reached');
  return Math.max(1, Math.min(requested, remaining));
}

module.exports = { exhaustedLimit, remainingTime, validateLimits };
