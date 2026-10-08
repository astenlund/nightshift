'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { requireCondition, text } = require('./errors');
const { requireDelivery } = require('./records');
const { hookAdmissionAliases } = require('../releases/hook-diagnostics');

const CONTINUATION_KINDS = Object.freeze({ goal: ['claude', 'codex'], 'stop-hook': ['claude'] });

function mechanismKind(state, mechanism) {
  requireCondition(typeof mechanism?.kind === 'string' && Object.hasOwn(CONTINUATION_KINDS, mechanism.kind), 'invalid-continuation-kind', `Continuation mechanism kind must be one of ${Object.keys(CONTINUATION_KINDS).join(', ')}`);
  requireCondition(CONTINUATION_KINDS[mechanism.kind].includes(state.controller.host), 'unsupported-continuation', `A ${mechanism.kind} mechanism cannot continue a ${state.controller.host} controller; observe its native goal instead`);
  return mechanism.kind;
}

function scopeObservation(state, observation) {
  return { ...observation, runId: state.id, controller: { ...state.controller }, observedAt: new Date().toISOString() };
}

function verifiedContinuation(state, mechanism) {
  requireDelivery(state, 'continuation');
  requireCondition(mechanism?.verified === true && typeof mechanism.evidence === 'string' && mechanism.evidence.trim(), 'unverified-continuation', 'Continuation needs observed host evidence');
  mechanismKind(state, mechanism);
  return scopeObservation(state, mechanism);
}

function invalidateContinuation(state, reason) {
  requireDelivery(state, 'invalidate-continuation');
  text(reason, 'invalidate-continuation.reason');
  const same = state.continuation?.verified === false && state.continuation.status === 'unobserved' && state.continuation.reason === reason && state.continuation.runId === state.id && isDeepStrictEqual(state.continuation.controller, state.controller);
  if (!same) state.continuation = scopeObservation(state, { verified: false, status: 'unobserved', reason });
}

function failureDetails(state, mechanism) {
  requireDelivery(state, 'continuation');
  const kind = mechanismKind(state, mechanism);
  requireCondition(mechanism.verified === false, 'invalid-continuation-failure', 'A continuation failure is explicitly unverified');
  requireCondition(!['paused', 'stopped', 'limited', 'usageLimited', 'budgetLimited'].includes(mechanism.status), 'continuation-held', 'Respect a user hold, stop or resource limit rather than treating it as a technical failure');
  const reason = text(mechanism.reason ?? mechanism.evidence, 'continuation.failure.reason');
  const operation = mechanism.operation ?? 'continuation';
  text(operation, 'continuation.failure.operation');
  return { kind, operation, reason };
}

function failedContinuation(state, mechanism) {
  const { kind, operation, reason } = failureDetails(state, mechanism);
  const followup = recordFailure(state, kind, operation, reason);
  state.continuation = scopeObservation(state, { ...mechanism, verified: false, status: 'failed', operation, reason, followupId: followup.id });
  return state.continuation;
}

function failureKey(state, kind, operation, reason) {
  return createHash('sha256').update(JSON.stringify([state.id, state.controller, kind, operation, reason])).digest('hex');
}

function failureKeys(state, kind, operation, reason) {
  const aliases = operation === 'hook-admission' && ['stop-hook', 'hook-integration'].includes(kind) ? hookAdmissionAliases(reason) : [reason];
  return new Set(aliases.map(alias => failureKey(state, kind, operation, alias)));
}

function sameFailure(state, item, kind, operation, keys) {
  const failure = item.continuationFailure;
  return failure?.runId === state.id && isDeepStrictEqual(failure.controller, state.controller) && failure.kind === kind && failure.operation === operation && keys.has(failure.key);
}

function recordFailure(state, kind, operation, reason) {
  const keys = failureKeys(state, kind, operation, reason);
  const previous = state.followups.filter(item => sameFailure(state, item, kind, operation, keys));
  const key = previous[0]?.continuationFailure.key ?? failureKey(state, kind, operation, reason);
  const prefix = `continuation-${key}`;
  let followup = previous.findLast(item => item.status === 'pending');
  if (!followup) {
    followup = { id: previous.length === 0 ? prefix : `${prefix}-${previous.length + 1}`, status: 'pending', title: `${kind} continuation failed`, context: reason, evidence: reason, recommendation: 'Investigate the observed continuation failure and its effect on reliable resumption', continuationFailure: { key, kind, operation, runId: state.id, controller: { ...state.controller }, occurrences: 0 } };
    state.followups.push(followup);
  }
  followup.continuationFailure.occurrences++;
  followup.continuationFailure.lastObservedAt = new Date().toISOString();
  return followup;
}

function observeIntegration(state, integration) {
  if (state.kind !== 'delivery' || !integration) return;
  if (integration.usable !== true && integration.usable !== false) return;
  state.hookIntegration = scopeObservation(state, { verified: integration.usable, status: integration.usable ? 'healthy' : 'failed', cause: integration.cause ?? null });
  if (integration.usable) return;
  const reason = text(integration.cause ?? 'Native hook admission reported unusable integration without a diagnostic', 'integration.failure.cause');
  if (state.controller.host === 'claude') failedContinuation(state, { verified: false, kind: 'stop-hook', operation: 'hook-admission', reason });
  else recordFailure(state, 'hook-integration', 'hook-admission', reason);
}

function continuationOutcomeCurrent(state) {
  const current = state.continuation;
  if (!current || current.runId !== state.id || !isDeepStrictEqual(current.controller, state.controller) || !CONTINUATION_KINDS[current.kind]?.includes(state.controller.host)) return false;
  if (current.verified === true) return typeof current.evidence === 'string' && current.evidence.trim().length > 0;
  if (current.verified !== false || current.status !== 'failed' || typeof current.reason !== 'string' || !current.reason.trim()) return false;
  const operation = current.operation ?? 'continuation';
  const keys = failureKeys(state, current.kind, operation, current.reason);
  return Array.isArray(state.followups) && state.followups.some(item => item.id === current.followupId && sameFailure(state, item, current.kind, operation, keys));
}

function continuationForRequest(state, mechanism, integration = null) {
  const failure = mechanism?.verified === false ? failureDetails(state, mechanism) : null;
  const success = failure ? null : verifiedContinuation(state, mechanism);
  if (state.controller.host === 'claude' && integration?.usable === false) {
    const reason = integration.cause ?? 'Native hook admission reported unusable integration without a diagnostic';
    if (!continuationOutcomeCurrent(state) || state.continuation.verified !== false || state.continuation.kind !== 'stop-hook' || state.continuation.operation !== 'hook-admission' || state.continuation.reason !== reason) observeIntegration(state, integration);
    if (failure && (failure.kind !== state.continuation.kind || failure.operation !== state.continuation.operation || failure.reason !== state.continuation.reason)) recordFailure(state, failure.kind, failure.operation, failure.reason);
    return state.continuation;
  }
  return failure ? failedContinuation(state, mechanism) : success;
}

module.exports = { CONTINUATION_KINDS, verifiedContinuation, invalidateContinuation, failedContinuation, observeIntegration, continuationOutcomeCurrent, continuationForRequest };
