'use strict';

const { acknowledged, obligationCurrent, observationCurrent, outcomeIdentity } = require('./acknowledgement');
const { continuationOutcomeCurrent, observeIntegration } = require('./continuation-health');
const { observeAcknowledgement } = require('./native-acknowledgement');

const NEXT_STEP = Object.freeze({ 'awaiting-outcome': 'record-continuation', missing: 'emit-text-then-status', available: 'request-engineering', unavailable: 'recover-history' });
const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const reasonText = value => String(value).replace(/[^ -~]/g, '?').slice(0, 1200);

function owningView(state, actor, context) {
  const owner = state.controller;
  if (context && context.session !== owner.session) return false;
  if (!context && !actor) return false;
  return !actor || actor.host === owner.host && actor.session === owner.session;
}

function inspect(state, context, observer) {
  if (!obligationCurrent(state)) return { status: 'unavailable', reason: 'Acknowledgement renewal or scope is absent, malformed or stale; preserve the duty and reconcile its recorded transition' };
  if (!continuationOutcomeCurrent(state) || !validTime(state.acknowledgement.requiredAfter) || state.acknowledgement.outcomeIdentity !== outcomeIdentity(state)) {
    return { status: 'awaiting-outcome', reason: 'Record or reconcile the current continuation outcome and its acknowledgement boundary before emitting the message' };
  }
  if (context?.integration?.usable === false) {
    const projected = structuredClone(state);
    observeIntegration(projected, context.integration);
    if (outcomeIdentity(projected) !== outcomeIdentity(state)) return { status: 'awaiting-outcome', reason: 'Fresh admission observed a different continuation failure; record that outcome before emitting its acknowledgement' };
  }
  const observation = observer(state, context);
  if (!observation) return { status: 'missing', reason: 'Emit the acknowledgement as ordinary visible assistant text, then read status in the same ongoing turn before engineering' };
  if (!observationCurrent(state, observation)) return { status: 'unavailable', reason: 'Native evidence does not match the current owner, scope, renewal and outcome; preserve the duty' };
  return { status: 'available', reason: null };
}

function acceptanceCheckpoint(state, actor, context, observer = observeAcknowledgement) {
  if (state.kind !== 'delivery' || !state.handover || acknowledged(state) || !owningView(state, actor, context)) return null;
  let inspection;
  try { inspection = inspect(state, context, observer); }
  catch (error) { inspection = { status: 'unavailable', reason: reasonText(error.message) }; }
  return {
    requiredNextAssistantOutput: 'Before another engineering tool call, emit a distinct visible acknowledgement paragraph as ordinary assistant text beginning Handover accepted: with the agreed scope and limits, followed by You can leave. If continuation failed, explain that automatic continuation is unavailable, the failure is recorded, and resumption may be needed if the session stops. Then call status in this same ongoing tool-use turn and follow its inspection result. Intended narration in thinking, a tool result, a saved flag or a later final response cannot establish this emission. Do not end the turn to acknowledge when continuation is unavailable.',
    observedContinuation: continuationOutcomeCurrent(state) ? state.continuation.verified ? 'available' : 'failed' : 'pending',
    assistantOutputEvidenceRequired: true,
    inspection,
    nextStep: NEXT_STEP[inspection.status],
  };
}

module.exports = { acceptanceCheckpoint };
