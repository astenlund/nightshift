'use strict';

const { requireCondition } = require('./store');
const { MAX_OPERATION_TIMEOUT_MS } = require('../releases/processes');

// Runtime-owned timeouts end this long before the launcher's operation deadline, leaving time to record their evidence.
const OPERATION_EXIT_MARGIN_MS = 60000;

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

// The launcher's operation deadline, less the exit margin, as milliseconds from now; null outside a launcher operation.
function operationWindow(operationDeadlineUtc, now = Date.now()) {
  return operationDeadlineUtc ? Date.parse(operationDeadlineUtc) - now - OPERATION_EXIT_MARGIN_MS : null;
}

// Bounds one execution by the run deadline and the launcher operation deadline, refusing when either leaves no time.
function timeLeft({ deadlineUtc, operationDeadlineUtc }, requested) {
  const now = Date.now();
  const run = deadlineUtc ? Date.parse(deadlineUtc) - now : requested;
  requireCondition(run > 0, 'resource-limit', 'The authorized run deadline has been reached');
  const operation = operationWindow(operationDeadlineUtc, now);
  requireCondition(operation === null || operation > 0, 'operation-time-limit', `The launcher operation bound leaves no time for this execution before its ${OPERATION_EXIT_MARGIN_MS} ms exit margin; raise the envelope timeoutMs`);
  return Math.max(1, Math.min(requested, run, operation ?? requested));
}

function remainingTime(state, requested, context = null) {
  return timeLeft({ deadlineUtc: state.limits?.deadlineUtc, operationDeadlineUtc: context?.operationDeadlineUtc }, requested);
}

// A dispatch gives every candidate its own attempt timeout, so all of them must fit before the launcher deadline.
function requireDispatchFits(state, context, candidates, attemptTimeoutMs) {
  const window = operationWindow(context?.operationDeadlineUtc);
  if (window === null) return;
  const run = state.limits?.deadlineUtc ? Date.parse(state.limits.deadlineUtc) - Date.now() : Infinity;
  const needed = Math.min(candidates * attemptTimeoutMs, run);
  requireCondition(needed <= window, 'operation-time-limit', `This dispatch can run ${candidates} attempt(s) of up to ${attemptTimeoutMs} ms each, needing ${needed + OPERATION_EXIT_MARGIN_MS} ms including a ${OPERATION_EXIT_MARGIN_MS} ms exit margin, but only ${Math.max(0, window + OPERATION_EXIT_MARGIN_MS)} ms of the launcher operation bound remain after launcher startup; raise the envelope timeoutMs above that need to leave room for startup (at most ${MAX_OPERATION_TIMEOUT_MS}), lower review.timeoutMs or list fewer candidates`);
}

module.exports = { OPERATION_EXIT_MARGIN_MS, exhaustedLimit, remainingTime, requireDispatchFits, timeLeft, validateLimits };
