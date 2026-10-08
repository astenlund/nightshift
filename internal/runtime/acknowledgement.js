'use strict';

const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { requireCondition } = require('./errors');
const { continuationOutcomeCurrent } = require('./continuation-health');

const ENGINEERING = new Set(['start-task', 'add-spec-review', 'repair', 'advance', 'check', 'probe', 'dispatch', 'worker', 'complete']);
const HASH = /^[a-f0-9]{64}$/;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function scopeHash(state) {
  const internal = new Set(state.tasks.map(task => task.agreement?.specReviewTaskId).filter(Boolean));
  const tasks = state.tasks.filter(task => !internal.has(task.id));
  const identities = new Set(tasks.map(task => task.id));
  return digest({ tasks: tasks.map(task => ({ id: task.id, kind: task.kind, requires: task.requires.filter(id => identities.has(id)), outcome: task.agreement.outcome, decisions: task.agreement.decisions ?? [], requirementsRevision: task.requirementsRevision ?? 0 })), limits: state.limits });
}

function outcomeIdentity(state) {
  if (!continuationOutcomeCurrent(state)) return null;
  const value = state.continuation;
  return digest({ runId: state.id, controller: state.controller, kind: value.kind, verified: value.verified, failure: value.verified ? null : value.followupId });
}

function renewAcknowledgement(state, revision, recordedAt) {
  if (state.kind !== 'delivery') return;
  state.acknowledgement = { schema: 1, status: 'pending', runId: state.id, controller: { ...state.controller }, scopeHash: scopeHash(state), renewalRevision: revision, renewedAt: recordedAt, requiredAfter: null };
  refreshAcknowledgementOutcome(state);
}

function obligationCurrent(state) {
  const value = state.acknowledgement;
  return value?.schema === 1 && ['pending', 'observed'].includes(value.status) && value.runId === state.id && isDeepStrictEqual(value.controller, state.controller) && value.scopeHash === scopeHash(state) && Number.isSafeInteger(value.renewalRevision) && value.renewalRevision >= 0 && time(value.renewedAt);
}

function refreshAcknowledgementOutcome(state) {
  if (state.kind !== 'delivery' || !obligationCurrent(state) || state.acknowledgement.status === 'observed' || !continuationOutcomeCurrent(state)) return;
  const value = state.acknowledgement;
  const identity = outcomeIdentity(state);
  if (value.outcomeIdentity === identity && time(value.requiredAfter)) return;
  requireCondition(time(state.continuation.observedAt), 'acknowledgement-obligation-unavailable', 'The continuation outcome has no usable emission boundary');
  value.requiredAfter = time(value.requiredAfter) && Date.parse(value.requiredAfter) > Date.parse(state.continuation.observedAt) ? value.requiredAfter : state.continuation.observedAt;
  value.outcomeIdentity = identity;
  value.failedContinuation = state.continuation.verified !== true;
}

function acknowledgementText(text, failed) {
  if (typeof text !== 'string' || text.length > 65536) return false;
  const plain = text.replace(/\r\n/g, '\n').replace(/\*\*|__|\*|_/g, '').trim();
  const opening = /^Handover accepted:\s+(.+?)\bYou can leave[.!;]/is.exec(plain);
  if (!opening || !opening[1].trim()) return false;
  return !failed || /automatic continuation is unavailable/i.test(plain) && /failure.*recorded/is.test(plain) && /resum/i.test(plain);
}

function observationCurrent(state, observation) {
  const value = state.acknowledgement;
  return obligationCurrent(state) && time(value.requiredAfter) && typeof value.outcomeIdentity === 'string' && HASH.test(value.outcomeIdentity) && typeof value.failedContinuation === 'boolean' && observation?.failedContinuation === value.failedContinuation && observation.runId === state.id && isDeepStrictEqual(observation.controller, state.controller) && observation.scopeHash === value.scopeHash && observation.renewalRevision === value.renewalRevision && observation.outcomeIdentity === value.outcomeIdentity && time(observation.emittedAt) && Date.parse(observation.emittedAt) > Math.max(Date.parse(value.renewedAt), Date.parse(value.requiredAfter)) && time(observation.observedAt) && Date.parse(observation.observedAt) >= Date.parse(observation.emittedAt) && observation.source?.host === state.controller.host && observation.source.session === state.controller.session && typeof observation.source.path === 'string' && typeof observation.source.messageId === 'string' && HASH.test(observation.source.eventSha256) && acknowledgementText(observation.text, observation.failedContinuation);
}

function acknowledged(state) {
  return state.kind !== 'delivery' || state.acknowledgement?.status === 'observed' && observationCurrent(state, state.acknowledgement.observation);
}

function needsAcknowledgement(state, request) {
  return state.kind === 'delivery' && !(state.status === 'complete' && request.taskId === '#closing') && (ENGINEERING.has(request.action) || request.action === 'dispose' && request.disposition === 'implement');
}

function establishAcknowledgement(state, context, observer) {
  if (acknowledged(state)) return null;
  requireCondition(obligationCurrent(state), 'acknowledgement-obligation-unavailable', 'Acknowledgement renewal or scope is absent, malformed or stale; preserve the pending duty and reconcile its recorded transition');
  refreshAcknowledgementOutcome(state);
  requireCondition(time(state.acknowledgement.requiredAfter), 'acknowledgement-required', 'Record the continuation outcome, then emit the separate handover acknowledgement before engineering');
  const observation = (observer ?? require('./native-acknowledgement').observeAcknowledgement)(state, context);
  requireCondition(observationCurrent(state, observation), 'acknowledgement-required', 'Before engineering, emit a separate visible assistant message beginning Handover accepted: with the agreed scope and limits, followed by You can leave. Include failed-continuation consequences when applicable, then retry. A tool result or saved flag is not that message');
  return observation;
}

function recordAcknowledgement(state, observation) {
  if (!observation) return;
  requireCondition(observationCurrent(state, observation), 'acknowledgement-obligation-unavailable', 'Acknowledgement observation no longer matches the current renewal and scope');
  state.acknowledgement.status = 'observed';
  state.acknowledgement.observation = observation;
}

module.exports = { acknowledgementText, acknowledged, establishAcknowledgement, needsAcknowledgement, obligationCurrent, observationCurrent, outcomeIdentity, recordAcknowledgement, refreshAcknowledgementOutcome, renewAcknowledgement, scopeHash };
