'use strict'

const { OPERATION, canonicalActionOrder, canonicalBytes, sameKeys, validateRequestRecord } = require('./protocol')

const MANIFEST_PROPOSAL_KEYS = Object.freeze(['actions', 'proposalDispositions', 'semanticDecisions', 'versionControlChoice', 'versionControlOptions'])
const VERSION_CONTROL_OPTION_ORDER = Object.freeze(['track', 'ignore', 'deferred', 'not-required'])

function buildApprovedApplyRequest({ host, hostContext, inspection, manifestProposal, root }) {
  if (!sameKeys(manifestProposal, MANIFEST_PROPOSAL_KEYS)) {
    throw new Error('the manifest proposal must carry exactly the closed proposal members')
  }
  if (!Array.isArray(manifestProposal.versionControlOptions) || manifestProposal.versionControlOptions.length !== VERSION_CONTROL_OPTION_ORDER.length || manifestProposal.versionControlOptions.some((value, index) => value !== VERSION_CONTROL_OPTION_ORDER[index])) {
    throw new Error('the manifest proposal version-control options must use the fixed order')
  }
  const request = {
    actions: canonicalActionOrder(manifestProposal.actions),
    host,
    hostContext,
    inspection,
    operation: OPERATION.APPLY,
    proposalDispositions: manifestProposal.proposalDispositions,
    protocolVersion: 1,
    root,
    semanticDecisions: manifestProposal.semanticDecisions,
    versionControlChoice: manifestProposal.versionControlChoice,
  }
  validateRequestRecord(request)

  return Buffer.concat([canonicalBytes(request), Buffer.from('\n', 'ascii')])
}

module.exports = { VERSION_CONTROL_OPTION_ORDER, buildApprovedApplyRequest }
