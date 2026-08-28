'use strict'

const { APPROVAL_BRANCHES, VERSION_CONTROL_OPTION_ORDER, isPlainObject, sha256 } = require('./state')
const { canonicalJson } = require('./transcript')
const { CLAUDE_ROOT_EXCLUSION_CONFIRMATION, CODEX_HOST_CONTEXT_CONFIRMATION, HOST_CONTROL_RECORDS, validateTurnObject } = require('../init-backlog-controller/oracles.cases')
// Plan-mandated production binding: the approved apply request is built and
// serialized through the same canonical manifest machinery production uses,
// never hand-serialized by the harness.
const { canonicalActionOrder, canonicalBytes, validateRequestRecord } = require('../../skills/init-backlog/lib/protocol')

const SCRIPTED_BRANCHES = Object.freeze(['approved', 'denied', 'deferred'])
const HOST_OUTCOMES = Object.freeze(['none', 'unavailable', 'auto-denied'])
const FAULT_SCHEDULES = Object.freeze(['none', 'after-approval-create-features'])
const RESERVED_GATE_IDS = Object.freeze(['host-context-confirmation', 'claude-root-exclusion-confirmation', 'action-disclosure', 'manifest-approval'])
const MANIFEST_PROPOSAL_MEMBERS = 'actions,proposalDispositions,semanticDecisions,versionControlChoice,versionControlOptions'
const CONTEXT_STOP_RESULT_JSON = canonicalJson({ approvalBranch: 'unavailable', reasonCode: 'guidance-resolution' })

function isNonblankString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function buildApprovedApplyRequest({ host, hostContext, inspection, manifestProposal, root }) {
  if (!isPlainObject(manifestProposal) || Object.keys(manifestProposal).sort().join(',') !== MANIFEST_PROPOSAL_MEMBERS) {
    throw new Error('the manifest proposal must carry exactly the closed proposal members')
  }
  if (!Array.isArray(manifestProposal.versionControlOptions) || manifestProposal.versionControlOptions.join(',') !== VERSION_CONTROL_OPTION_ORDER.join(',')) {
    throw new Error('the manifest proposal version-control options must use the fixed order')
  }
  const request = {
    actions: canonicalActionOrder(manifestProposal.actions),
    host,
    hostContext,
    inspection,
    operation: 'apply',
    proposalDispositions: manifestProposal.proposalDispositions,
    protocolVersion: 1,
    root,
    semanticDecisions: manifestProposal.semanticDecisions,
    versionControlChoice: manifestProposal.versionControlChoice,
  }
  validateRequestRecord(request)

  return Buffer.concat([canonicalBytes(request), Buffer.from('\n', 'ascii')])
}

function validateWalkConfiguration(config) {
  const { applyFault, approvalBranch, approvalResponse, claudeRootExclusion, faultSchedule, gate, host, hostContext, hostOutcome, mode, onlineDisclosureCheck, preApprovalTurns, scenarioRoot, verifyDisclosureSequence } = config
  if (host !== 'claude-code' && host !== 'codex') {
    throw new Error(`host is not a closed host name: ${host}`)
  }
  if (mode !== 'enabled' && mode !== 'disabled') {
    throw new Error(`mode is not a closed mode: ${mode}`)
  }
  if (!APPROVAL_BRANCHES.includes(approvalBranch)) {
    throw new Error(`approvalBranch is not a closed branch: ${approvalBranch}`)
  }
  if (!HOST_OUTCOMES.includes(hostOutcome)) {
    throw new Error(`hostOutcome is not a closed outcome: ${hostOutcome}`)
  }
  if (SCRIPTED_BRANCHES.includes(approvalBranch)) {
    if (!isNonblankString(approvalResponse) || hostOutcome !== 'none') {
      throw new Error(`branch ${approvalBranch} requires a nonblank approvalResponse and hostOutcome none`)
    }
  } else if (approvalResponse !== null || hostOutcome !== approvalBranch) {
    throw new Error(`branch ${approvalBranch} requires a null approvalResponse and a matching hostOutcome`)
  }
  if (!FAULT_SCHEDULES.includes(faultSchedule)) {
    throw new Error(`faultSchedule is not a closed schedule: ${faultSchedule}`)
  }
  if (faultSchedule !== 'none' && typeof applyFault !== 'function') {
    throw new Error('a scheduled fault requires an applyFault function')
  }
  if (!Array.isArray(preApprovalTurns)) {
    throw new Error('preApprovalTurns must be an array')
  }
  const seenGateIds = new Set()
  for (const item of preApprovalTurns) {
    if (!isPlainObject(item) || Object.keys(item).sort().join(',') !== 'gateId,response' || !isNonblankString(item.gateId) || !isNonblankString(item.response)) {
      throw new Error('every preapproval turn carries a nonblank gateId and response')
    }
    if (RESERVED_GATE_IDS.includes(item.gateId)) {
      throw new Error(`a fixture gate ID cannot be reserved: ${item.gateId}`)
    }
    if (seenGateIds.has(item.gateId)) {
      throw new Error('preapproval gate IDs must be unique')
    }
    seenGateIds.add(item.gateId)
  }
  if (typeof verifyDisclosureSequence !== 'function') {
    throw new Error('verifyDisclosureSequence must be a function')
  }
  if (mode === 'enabled') {
    if (!isPlainObject(gate)) {
      throw new Error('an enabled walk requires the authorization gate')
    }
    if (typeof onlineDisclosureCheck !== 'function') {
      throw new Error('an enabled walk requires an onlineDisclosureCheck function')
    }
    if (!isPlainObject(hostContext)) {
      throw new Error('an enabled walk requires the fixture hostContext')
    }
    if (!isNonblankString(scenarioRoot)) {
      throw new Error('an enabled walk requires the scenarioRoot')
    }
  } else {
    if (gate !== null) {
      throw new Error('a disabled walk carries no gate')
    }
    if (onlineDisclosureCheck !== null) {
      throw new Error('a disabled walk carries no online disclosure check')
    }
  }
  if (host === 'claude-code' && mode === 'enabled') {
    if (!isPlainObject(claudeRootExclusion) || Object.keys(claudeRootExclusion).sort().join(',') !== 'present,response,verifiedLoadedMemory' || typeof claudeRootExclusion.present !== 'boolean') {
      throw new Error('an enabled Claude walk requires the closed claudeRootExclusion record')
    }
    if (claudeRootExclusion.present) {
      if (typeof claudeRootExclusion.verifiedLoadedMemory !== 'boolean' || claudeRootExclusion.response !== null) {
        throw new Error('a present-root claudeRootExclusion carries only the loaded-memory verification')
      }
    } else if (claudeRootExclusion.verifiedLoadedMemory !== null || (claudeRootExclusion.response !== null && typeof claudeRootExclusion.response !== 'string')) {
      throw new Error('a missing-root claudeRootExclusion carries only the scripted response or nonresponse')
    }
  } else if (claudeRootExclusion !== null) {
    throw new Error('claudeRootExclusion is only for enabled Claude walks')
  }
}

function createGateWalk(config) {
  const normalized = {
    applyFault: null,
    claudeRootExclusion: null,
    faultSchedule: 'none',
    gate: null,
    hostContext: null,
    onlineDisclosureCheck: null,
    scenarioRoot: null,
    ...config,
  }
  validateWalkConfiguration(normalized)
  const { applyFault, approvalBranch, approvalResponse, claudeRootExclusion, faultSchedule, gate, host, hostContext, hostOutcome, mode, onlineDisclosureCheck, preApprovalTurns, scenarioRoot, verifyDisclosureSequence } = normalized

  let state = 'clarifications'
  if (mode === 'enabled') {
    if (host === 'codex') {
      state = 'await-host-context'
    } else if (claudeRootExclusion.present) {
      if (claudeRootExclusion.verifiedLoadedMemory) {
        gate.authorizeInspect()
      } else {
        state = 'context-stopped'
      }
    } else {
      state = 'await-root-exclusion'
    }
  }

  let clarificationIndex = 0
  let failed = false
  let bufferedDigest = null
  const buffered = []

  const fail = (reason) => {
    failed = true

    return { failure: { reason } }
  }

  const respond = (response, kind) => ({ action: 'respond', kind, response })

  const receiveDisclosure = (turn) => {
    const items = turn.presentation.actionDisclosures
    if (items.length !== 1) {
      return fail('disclosure-cardinality')
    }
    const [item] = items
    if (bufferedDigest === null) {
      bufferedDigest = item.proposalDigest
    } else if (item.proposalDigest !== bufferedDigest) {
      return fail('proposal-digest')
    }
    if (mode === 'enabled' && onlineDisclosureCheck(item, buffered.length)?.ok !== true) {
      return fail('disclosure-online-check')
    }
    buffered.push(item)
    state = 'disclosures'

    return respond(HOST_CONTROL_RECORDS.disclosureAcknowledgement, 'host-control')
  }

  const receiveManifestApproval = (turn) => {
    if (turn.presentation.actionDisclosures.length !== 0) {
      return fail('approval-disclosures-nonempty')
    }
    const manifestProposal = turn.presentation.manifestProposal
    if (manifestProposal === null) {
      return fail('missing-proposal')
    }
    const proposalDigest = sha256(Buffer.from(canonicalJson(manifestProposal), 'utf8'))
    if (buffered.some((item) => item.proposalDigest !== proposalDigest)) {
      return fail('proposal-digest')
    }
    if (verifyDisclosureSequence({ items: [...buffered], manifestProposal })?.ok !== true) {
      return fail('disclosure-sequence')
    }
    if (mode === 'enabled') {
      if (approvalBranch === 'approved') {
        const inspectionBytes = gate.storedInspectionBytes()
        if (inspectionBytes === null) {
          return fail('missing-inspection')
        }
        let requestBytes
        try {
          requestBytes = buildApprovedApplyRequest({ host, hostContext, inspection: JSON.parse(inspectionBytes.toString('utf8')), manifestProposal, root: scenarioRoot })
        } catch {
          // The production builder rejected the model's proposal; the harness
          // never installs a hand-repaired request.
          return fail('apply-request-rejected')
        }
        gate.installApplyAuthorization(requestBytes)
      } else {
        gate.closeApplyForever()
      }
    }
    if (faultSchedule === 'after-approval-create-features') {
      applyFault()
    }
    state = 'await-result'
    if (hostOutcome === 'unavailable') {
      return respond(HOST_CONTROL_RECORDS.unavailable, 'host-control')
    }
    if (hostOutcome === 'auto-denied') {
      return respond(HOST_CONTROL_RECORDS.autoDenied, 'host-control')
    }

    return respond(approvalResponse, 'approval')
  }

  return {
    receiveTurn(turn) {
      if (failed) {
        return { failure: { reason: 'walk-failed' } }
      }
      if (state === 'done') {
        return fail('extra-turn')
      }
      try {
        validateTurnObject(turn)
      } catch {
        return fail('turn-schema')
      }
      if (turn.phase === 'finished') {
        if (state === 'context-stopped') {
          if (canonicalJson(turn.presentation.result) !== CONTEXT_STOP_RESULT_JSON) {
            return fail('context-result')
          }
          state = 'done'

          return { done: true, result: turn.presentation.result }
        }
        if (state === 'await-result') {
          state = 'done'

          return { done: true, result: turn.presentation.result }
        }

        return fail('early-result')
      }
      const gateId = turn.gateId
      if (gateId !== 'manifest-approval' && turn.presentation.manifestProposal !== null) {
        return fail('premature-proposal')
      }
      if (gateId !== 'action-disclosure' && gateId !== 'manifest-approval' && turn.presentation.actionDisclosures.length !== 0) {
        return fail('unexpected-disclosure')
      }
      if (state === 'context-stopped' || state === 'await-result') {
        return fail(state === 'await-result' ? 'extra-gate' : 'wrong-gate')
      }
      if (state === 'await-host-context') {
        if (gateId !== 'host-context-confirmation') {
          return fail('wrong-gate')
        }
        state = 'clarifications'
        gate.authorizeInspect()

        return respond(CODEX_HOST_CONTEXT_CONFIRMATION, 'host-context')
      }
      if (state === 'await-root-exclusion') {
        if (gateId !== 'claude-root-exclusion-confirmation') {
          return fail('wrong-gate')
        }
        const scripted = claudeRootExclusion.response
        if (scripted === CLAUDE_ROOT_EXCLUSION_CONFIRMATION) {
          gate.authorizeInspect()
          state = 'clarifications'

          return respond(scripted, 'host-context')
        }
        state = 'context-stopped'

        return scripted === null ? respond(HOST_CONTROL_RECORDS.unavailable, 'host-control') : respond(scripted, 'scripted')
      }
      if (state === 'clarifications') {
        if (gateId === 'action-disclosure' || gateId === 'manifest-approval') {
          if (clarificationIndex !== preApprovalTurns.length) {
            return fail('missing-gate')
          }

          return gateId === 'action-disclosure' ? receiveDisclosure(turn) : receiveManifestApproval(turn)
        }
        const expected = preApprovalTurns[clarificationIndex]
        if (expected === undefined || gateId !== expected.gateId) {
          return fail('wrong-gate')
        }
        clarificationIndex += 1

        return respond(expected.response, 'scripted')
      }
      if (gateId === 'action-disclosure') {
        return receiveDisclosure(turn)
      }
      if (gateId === 'manifest-approval') {
        return receiveManifestApproval(turn)
      }

      return fail('wrong-gate')
    },
    state() {
      return state
    },
  }
}

module.exports = { buildApprovedApplyRequest, createGateWalk }
