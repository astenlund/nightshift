'use strict';

const path = require('node:path');

function fixtureAcknowledgement(state) {
  const obligation = state.acknowledgement;
  const emittedAt = new Date(Math.max(Date.now(), Date.parse(obligation.requiredAfter) + 1, Date.parse(obligation.renewedAt) + 1)).toISOString();
  const failed = obligation.failedContinuation;
  return { runId: state.id, controller: { ...state.controller }, scopeHash: obligation.scopeHash, renewalRevision: obligation.renewalRevision, outcomeIdentity: obligation.outcomeIdentity, emittedAt, observedAt: emittedAt, failedContinuation: failed, text: 'Handover accepted: Complete the explicitly simulated fixture scope under its limits. You can leave.' + (failed ? ' Automatic continuation is unavailable; the failure is recorded. Resume the session if it stops.' : ''), source: { host: state.controller.host, session: state.controller.session, path: path.join(state.root, '.tmp/fixture-native-output.jsonl'), messageId: 'fixture-visible-assistant-message', eventSha256: 'f'.repeat(64) } };
}

module.exports = { fixtureAcknowledgement };
