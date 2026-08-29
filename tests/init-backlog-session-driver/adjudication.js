'use strict'

const { APPROVAL_BRANCHES, VERSION_CONTROL_OPTION_ORDER, compareOrdinal, isPlainObject, sha256 } = require('./primitives')
const { canonicalJson } = require('./transcript')
const { BREAKOUT_DIGEST_NOTICE, buildDecodedContentDisclosures } = require('../init-backlog-controller/election-oracles')

const NO_APPLY_BRANCHES = Object.freeze(['denied', 'deferred', 'unavailable', 'auto-denied'])
const ELECTION_CHOICES = Object.freeze(['track', 'ignore', 'deferred'])
const CARRIER_KINDS = Object.freeze(['breakout-digest', 'decoded', 'structural-action'])
const MANIFEST_PROJECTION_MEMBERS = 'actions,proposalDispositions,semanticDecisions,versionControlChoice'
const FINAL_TARGET_MEMBERS = 'kind,mode,rawSha256,target'
const EXTERNAL_WRITER_WINDOW_CODE = 'external-writer-window'

function requireApprovalBranch(value) {
  if (!APPROVAL_BRANCHES.includes(value)) {
    throw new TypeError(`approvalBranch is not a closed branch: ${value}`)
  }

  return value
}

function deriveApprovalFacts({ applyCalls, approvalBranch, approvalInputOrdinal }) {
  requireApprovalBranch(approvalBranch)
  if (!Array.isArray(applyCalls)) {
    throw new TypeError('applyCalls must be the admitted apply-call array')
  }
  for (const call of applyCalls) {
    if (!isPlainObject(call) || !Number.isSafeInteger(call.proxyOrdinal) || call.proxyOrdinal < 1) {
      throw new TypeError('every apply call carries a positive proxyOrdinal')
    }
    if (!Number.isSafeInteger(call.transcriptWatermark) || call.transcriptWatermark < 0) {
      throw new TypeError('every apply call carries its transcript watermark at admission')
    }
  }
  if (approvalInputOrdinal !== null && (!Number.isSafeInteger(approvalInputOrdinal) || approvalInputOrdinal < 1)) {
    throw new TypeError('approvalInputOrdinal must be a positive transcript ordinal or null')
  }
  const approvalBeforeApply = approvalBranch !== 'approved'
    ? applyCalls.length === 0
    : applyCalls.every((call) => approvalInputOrdinal !== null && approvalInputOrdinal <= call.transcriptWatermark)
  const denialNoApply = approvalBranch !== 'denied' || applyCalls.length === 0
  const approvalApplyCardinality = approvalBranch === 'approved' ? applyCalls.length === 1 : applyCalls.length === 0

  return { approvalApplyCardinality, approvalBeforeApply, denialNoApply }
}

function deriveAmbiguityCoverage({ ambiguityIdSequences, gateIds }) {
  if (!Array.isArray(ambiguityIdSequences) || !Array.isArray(gateIds)) {
    throw new TypeError('ambiguity coverage derives from the presented sequences alone')
  }
  const asked = new Set(gateIds)
  for (const sequence of ambiguityIdSequences) {
    if (!Array.isArray(sequence) || sequence.some((id) => typeof id !== 'string' || id === '')) {
      throw new TypeError('every ambiguity sequence carries nonblank string IDs')
    }
    if (sequence.some((id) => !asked.has(id))) {
      return false
    }
  }

  return true
}

function deriveElectionPresented({ electionRequired, manifestProposal }) {
  if (typeof electionRequired !== 'boolean') {
    throw new TypeError('electionRequired must be a boolean')
  }
  if (manifestProposal === null) {
    return !electionRequired
  }
  if (!Array.isArray(manifestProposal.versionControlOptions) || manifestProposal.versionControlOptions.join(',') !== VERSION_CONTROL_OPTION_ORDER.join(',')) {
    return false
  }

  return electionRequired ? ELECTION_CHOICES.includes(manifestProposal.versionControlChoice) : manifestProposal.versionControlChoice === 'not-required'
}

function expandCarrier({ carrier, items, proposalDigest, selection, semanticClassifications }) {
  if (!isPlainObject(carrier) || !CARRIER_KINDS.includes(carrier.kind)) {
    throw new TypeError(`disclosure carrier kind is not closed: ${carrier?.kind}`)
  }
  if (carrier.kind === 'structural-action') {
    items.push({ actionId: carrier.actionId, kind: 'structural-action', proposalDigest, selection, target: carrier.target })

    return { ok: true }
  }
  if (carrier.kind === 'breakout-digest') {
    items.push({
      actionId: carrier.actionId,
      afterRawSha256: carrier.afterRawSha256,
      beforeRawSha256: carrier.beforeRawSha256,
      extent: 'complete-file',
      kind: 'breakout-digest',
      notice: BREAKOUT_DIGEST_NOTICE,
      proposalDigest,
      selection,
      target: carrier.target,
    })

    return { ok: true }
  }
  const images = []
  if (carrier.beforeBytes !== null) {
    images.push({ bytes: carrier.beforeBytes, image: 'before' })
  }
  images.push({ bytes: carrier.afterBytes, image: 'after' })
  for (const { bytes, image } of images) {
    if (!Buffer.isBuffer(bytes)) {
      throw new TypeError('a decoded carrier image must be a byte buffer or null before image only')
    }
    const built = buildDecodedContentDisclosures({ actionId: carrier.actionId, bytes, image, proposalDigest, selection, semanticClassifications, target: carrier.target })
    if (built.presentationCapacity === true) {
      return { presentationCapacity: true }
    }
    items.push(...built.items)
  }

  return { ok: true }
}

function buildExpectedDisclosureSequence({ manifestProposal, proposalCarriers, semanticCarriers = [], semanticClassifications = [] }) {
  if (!isPlainObject(manifestProposal) || !Array.isArray(manifestProposal.proposalDispositions)) {
    throw new TypeError('the expected sequence derives from the complete manifest proposal')
  }
  if (!Array.isArray(proposalCarriers) || proposalCarriers.length !== manifestProposal.proposalDispositions.length) {
    throw new TypeError('the inspection-order carriers must cover every proposal disposition exactly once')
  }
  const proposalDigest = sha256(Buffer.from(canonicalJson(manifestProposal), 'utf8'))
  const items = []
  for (const [index, carrier] of proposalCarriers.entries()) {
    const expansion = expandCarrier({ carrier, items, proposalDigest, selection: manifestProposal.proposalDispositions[index].disposition, semanticClassifications })
    if (expansion.presentationCapacity === true) {
      return { presentationCapacity: true }
    }
  }
  for (const carrier of semanticCarriers) {
    const expansion = expandCarrier({ carrier, items, proposalDigest, selection: 'selected', semanticClassifications })
    if (expansion.presentationCapacity === true) {
      return { presentationCapacity: true }
    }
  }

  return { items }
}

function verifyDisclosureSequence({ expected, observed }) {
  if (!Array.isArray(expected) || !Array.isArray(observed)) {
    throw new TypeError('disclosure sequences must be arrays')
  }
  if (observed.length !== expected.length) {
    return { ok: false, reason: 'disclosure-sequence' }
  }
  for (let index = 0; index < expected.length; index += 1) {
    if (canonicalJson(observed[index]) !== canonicalJson(expected[index])) {
      return { index, ok: false, reason: 'disclosure-sequence' }
    }
  }

  return { ok: true }
}

function verifyInspectionBoundDisclosure({ item, proposalCarriers }) {
  if (!isPlainObject(item) || !Array.isArray(proposalCarriers)) {
    throw new TypeError('online disclosure verification takes one item and the inspection proposal carriers')
  }
  const carrier = proposalCarriers.find((candidate) => candidate.actionId === item.actionId)
  if (carrier === undefined) {
    return { deferred: true, ok: true }
  }
  if (item.target !== carrier.target) {
    return { ok: false, reason: 'inspection-binding' }
  }
  if (carrier.kind === 'structural-action') {
    return { ok: item.kind === 'structural-action' }
  }
  if (carrier.kind === 'breakout-digest') {
    return {
      ok: item.kind === 'breakout-digest'
        && item.afterRawSha256 === carrier.afterRawSha256
        && item.beforeRawSha256 === carrier.beforeRawSha256
        && item.extent === 'complete-file'
        && item.notice === BREAKOUT_DIGEST_NOTICE,
    }
  }
  if (carrier.kind !== 'decoded') {
    throw new TypeError(`disclosure carrier kind is not closed: ${carrier.kind}`)
  }
  const bytes = item.image === 'before' ? carrier.beforeBytes : item.image === 'after' ? carrier.afterBytes : null
  if (!Buffer.isBuffer(bytes) || item.rawSha256 !== sha256(bytes)) {
    return { ok: false, reason: 'inspection-binding' }
  }
  if (bytes.length === 0) {
    return { ok: item.kind === 'decoded-empty' && item.byteLength === 0 }
  }
  if (item.kind !== 'decoded-content'
    || !Number.isSafeInteger(item.chunkCount) || item.chunkCount < 1
    || !Number.isSafeInteger(item.chunkIndex) || item.chunkIndex < 0 || item.chunkIndex >= item.chunkCount
    || !Number.isSafeInteger(item.startByte) || item.startByte < 0
    || !Number.isSafeInteger(item.endByte) || item.endByte <= item.startByte || item.endByte > bytes.length) {
    return { ok: false, reason: 'inspection-binding' }
  }
  const observedBytes = Buffer.from(item.text, 'utf8')

  return { ok: observedBytes.length === item.endByte - item.startByte && observedBytes.equals(bytes.subarray(item.startByte, item.endByte)) }
}

function deriveAllActionsDisclosed({ expected, observed }) {
  return verifyDisclosureSequence({ expected, observed }).ok === true
}

function requireNullableOrdinal(value, label) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 1)) {
    throw new TypeError(`${label} must be a positive ordinal or null`)
  }

  return value
}

function verifyEnabledSemanticOwnership({ classificationRequired, firstClassifiedTurnOrdinal, firstProposalTurnOrdinal, inspection, inspectWatermark }) {
  if (!isPlainObject(inspection)) {
    throw new TypeError('the captured inspect result must be the parsed inspection object')
  }
  requireNullableOrdinal(firstClassifiedTurnOrdinal, 'firstClassifiedTurnOrdinal')
  requireNullableOrdinal(firstProposalTurnOrdinal, 'firstProposalTurnOrdinal')
  if (!Number.isSafeInteger(inspectWatermark) || inspectWatermark < 0) {
    throw new TypeError('inspectWatermark must be the transcript ordinal count at inspect completion')
  }
  if (Object.hasOwn(inspection, 'semanticDecisions')) {
    return { ok: false, reason: 'inspection-owns-decision' }
  }
  if (classificationRequired === true && firstClassifiedTurnOrdinal === null) {
    return { ok: false, reason: 'missing-classification' }
  }
  if (firstClassifiedTurnOrdinal !== null) {
    if (firstClassifiedTurnOrdinal <= inspectWatermark) {
      return { ok: false, reason: 'classification-before-inspect' }
    }
    if (firstProposalTurnOrdinal !== null && firstClassifiedTurnOrdinal > firstProposalTurnOrdinal) {
      return { ok: false, reason: 'classification-after-manifest' }
    }
  }

  return { ok: true, semanticDecisionSource: 'model' }
}

function verifyDisabledSemanticOwnership({ classificationRequired, controllerArtifactPaths, firstClassifiedTurnOrdinal, firstProposalTurnOrdinal, proxyCallCount }) {
  if (!Number.isSafeInteger(proxyCallCount) || proxyCallCount < 0) {
    throw new TypeError('proxyCallCount must be a nonnegative count')
  }
  if (!Array.isArray(controllerArtifactPaths)) {
    throw new TypeError('controllerArtifactPaths must be the observed runtime-artifact array')
  }
  requireNullableOrdinal(firstClassifiedTurnOrdinal, 'firstClassifiedTurnOrdinal')
  requireNullableOrdinal(firstProposalTurnOrdinal, 'firstProposalTurnOrdinal')
  if (proxyCallCount !== 0) {
    return { ok: false, reason: 'controller-invocation' }
  }
  if (controllerArtifactPaths.length !== 0) {
    return { ok: false, reason: 'controller-artifact' }
  }
  if (classificationRequired === true && firstClassifiedTurnOrdinal === null) {
    return { ok: false, reason: 'missing-classification' }
  }
  if (firstClassifiedTurnOrdinal !== null && firstProposalTurnOrdinal !== null && firstClassifiedTurnOrdinal >= firstProposalTurnOrdinal) {
    return { ok: false, reason: 'classification-after-proposal' }
  }

  return { ok: true, semanticDecisionSource: 'model' }
}

function deriveResultPresentation({ approvalBranch, structuredResult }) {
  requireApprovalBranch(approvalBranch)
  if (NO_APPLY_BRANCHES.includes(approvalBranch)) {
    const acceptedReasonCodes = approvalBranch === 'unavailable' ? ['unavailable', 'guidance-resolution'] : [approvalBranch]
    const resultPresented = acceptedReasonCodes.some((reasonCode) => canonicalJson(structuredResult) === canonicalJson({ approvalBranch, reasonCode }))

    return { resultPresented, unresolvedPresented: resultPresented }
  }
  if (!isPlainObject(structuredResult) || typeof structuredResult.ok !== 'boolean' || (structuredResult.ok === true && typeof structuredResult.complete !== 'boolean')) {
    return { resultPresented: false, unresolvedPresented: false }
  }
  const unresolvedPresented = structuredResult.ok === false
    || structuredResult.complete === true
    || Array.isArray(structuredResult.incompleteTargets) && structuredResult.incompleteTargets.length > 0

  return { resultPresented: true, unresolvedPresented }
}

function deriveWriterDisclosure({ observedCodes, windowExpected }) {
  if (!Array.isArray(observedCodes) || observedCodes.some((code) => code !== EXTERNAL_WRITER_WINDOW_CODE)) {
    throw new TypeError('observedCodes carries only the closed disclosure code')
  }
  if (typeof windowExpected !== 'boolean') {
    throw new TypeError('windowExpected must be a boolean')
  }

  return windowExpected ? observedCodes.includes(EXTERNAL_WRITER_WINDOW_CODE) : observedCodes.length === 0
}

function validateFinalTargets(finalTargets) {
  if (!Array.isArray(finalTargets)) {
    throw new Error('finalTargets must be the ordinal-target-sorted projection')
  }
  for (const item of finalTargets) {
    if (!isPlainObject(item) || Object.keys(item).sort(compareOrdinal).join(',') !== FINAL_TARGET_MEMBERS) {
      throw new Error('every deterministic digest final target carries exactly the closed members')
    }
  }
  for (let index = 1; index < finalTargets.length; index += 1) {
    if (compareOrdinal(finalTargets[index - 1].target, finalTargets[index].target) >= 0) {
      throw new Error('finalTargets must be ordinal-target sorted and duplicate-free')
    }
  }
}

function deriveDeterministicDigest({ applyOk, approvalBranch, finalTargets, manifest, proposals }) {
  requireApprovalBranch(approvalBranch)
  if (!Array.isArray(proposals)) {
    throw new Error('deterministic digest proposals must be the inspected proposal array')
  }
  if (approvalBranch === 'approved') {
    if (manifest === null) {
      throw new Error('an approved branch must carry the apply-request manifest projection')
    }
    if (!isPlainObject(manifest) || Object.keys(manifest).sort(compareOrdinal).join(',') !== MANIFEST_PROJECTION_MEMBERS) {
      throw new Error('the deterministic digest manifest carries exactly the closed projection members')
    }
    if (applyOk === false) {
      if (finalTargets !== null) {
        throw new Error('an approved failure carries null finalTargets')
      }
    } else {
      validateFinalTargets(finalTargets)
    }
  } else {
    if (manifest !== null) {
      throw new Error('a non-approved branch carries a null manifest')
    }
    validateFinalTargets(finalTargets)
  }

  return sha256(Buffer.from(canonicalJson({ finalTargets, manifest, proposals }), 'utf8'))
}

function compareSemanticClassifications({ observed, oracle }) {
  if (!Array.isArray(observed) || !Array.isArray(oracle)) {
    throw new TypeError('semantic classification comparison takes the observed and oracle arrays')
  }

  return canonicalJson(observed) === canonicalJson(oracle)
}

module.exports = {
  buildExpectedDisclosureSequence,
  compareSemanticClassifications,
  deriveAllActionsDisclosed,
  deriveAmbiguityCoverage,
  deriveApprovalFacts,
  deriveDeterministicDigest,
  deriveElectionPresented,
  deriveResultPresentation,
  deriveWriterDisclosure,
  verifyDisabledSemanticOwnership,
  verifyDisclosureSequence,
  verifyEnabledSemanticOwnership,
  verifyInspectionBoundDisclosure,
}
