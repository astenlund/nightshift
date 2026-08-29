'use strict'

const { Buffer } = require('node:buffer')

const { analyzeCatalog } = require('../../ready/ready')
const { BACKLOG_DIRECTORY_TARGETS, loadManifest } = require('./assets')
const { InitBacklogError, failureRecord } = require('./errors')
const { buildReadyCatalog, inspectRegions } = require('./inspection')
const {
  canonicalActionOrder,
  canonicalJson,
  compareOrdinal,
  deriveManifestId,
  deriveSemanticActionId,
  deriveSnapshotId,
  isSemanticActionId,
  proposalsByCanonicalAction,
  sameCanonical,
  sameKeys,
  sha256,
  validateAction,
  validateBase64,
  validateDigest,
  validateTarget,
  validateProposalDispositions,
} = require('./protocol')

const DIRECTORY_TARGETS = new Set(['.claude', ...BACKLOG_DIRECTORY_TARGETS])
const ACTION_KINDS = new Set(['ensure-directory', 'create-from-template', 'exact-edit', 'unwrap-file'])

function admissionError(detail, fields = {}) {
  throw new InitBacklogError(failureRecord({ code: fields.code ?? 'manifest-invalid', detail, operation: 'apply', phase: 'prevalidate', ...fields }))
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function targetMap(inspection) {
  if (!Array.isArray(inspection.targets)) admissionError('Inspection target catalog is invalid.')
  const result = new Map()
  for (const item of inspection.targets) {
    if (result.has(item.target)) admissionError('Inspection target catalog contains a duplicate.', { target: item.target })
    result.set(item.target, item)
  }

  return result
}

function validateInspectionIdentity(inspection, currentInspection) {
  if (!inspection || inspection.ok !== true || inspection.operation !== 'inspect') admissionError('Carried inspection is invalid.')
  let expected
  try {
    expected = deriveSnapshotId({ ...inspection, snapshotId: null })
  } catch (error) {
    admissionError('Carried inspection identity cannot be derived.', { code: 'snapshot-drift', systemCode: error.code })
  }
  if (inspection.snapshotId !== expected) admissionError('Carried inspection snapshot does not match its contents.', { code: 'snapshot-drift' })
  if (currentInspection !== undefined && !sameCanonical({ ...inspection, snapshotId: null }, { ...currentInspection, snapshotId: null })) {
    admissionError('Current inspection differs from the approved snapshot.', { code: 'snapshot-drift' })
  }
}

function electionMarkerState(inspection, choice) {
  const carried = inspection.git
  const state = carried.electionMarker === 'absent' ? choice === 'not-required' ? 'absent' : choice : choice === 'not-required' ? carried.electionMarker : choice
  const snapshotId = state === 'absent' ? null : inspection.snapshotId
  const mode = state === 'absent' ? null : carried.electionMarkerMode

  return { mode, snapshotId, state }
}

function validateChoice(inspection, choice) {
  const git = inspection.git
  if (!git || !['git', 'non-git'].includes(git.kind)) admissionError('Inspection Git state is invalid.')
  if (git.kind === 'non-git' && choice !== 'not-required') admissionError('Non-Git repositories cannot select an election branch.')
  if (git.kind === 'git' && !git.electionRequired && choice !== 'not-required') admissionError('An election is not applicable to this scaffold.')
  if (git.electionRequired && !['deferred', 'ignore', 'track'].includes(choice)) admissionError('A required election must select track, ignore, or deferred.')
  if (git.electionMarker !== 'absent' && git.electionMarker !== 'deferred' && choice !== git.electionMarker) admissionError('The election choice does not match the carried marker.')
  if (git.plansPolicy === 'action-required' && choice === 'ignore' && inspection.proposals.every((item) => item.reason !== 'elective-ignore')) admissionError('Ignore requires its inspected elective policy action.')
}

function validateSemanticDecisions(inspection, decisions, targets) {
  if (!Array.isArray(decisions)) admissionError('Semantic decisions are not an array.')
  const required = new Map()
  for (const item of targets.values()) {
    if (item.contentRole !== 'semantic' || item.templateId === null || item.states.includes('exact-template')) continue
    const emptyRepair = item.contentBase64 !== null && item.contentBase64.length === 0 && inspection.proposals.some((proposal) => proposal.action.target === item.target && proposal.reason === 'empty-target' && proposal.condition === 'always')
    if (!emptyRepair) required.set(item.target, item)
  }
  const seen = new Set()
  let previousTarget = null
  for (const decision of decisions) {
    if (decision === null || typeof decision !== 'object' || Array.isArray(decision) || !Object.hasOwn(decision, 'target') || !Object.hasOwn(decision, 'status') || !Object.hasOwn(decision, 'conceptIds')) admissionError('Semantic decision record is invalid.')
    if (!sameKeys(decision, ['conceptIds', 'status', 'target'])) admissionError('Semantic decision record has unexpected fields.')
    if (typeof decision.target !== 'string' || (previousTarget !== null && compareOrdinal(previousTarget, decision.target) >= 0)) admissionError('Semantic decisions must be ordinal sorted.', { target: decision.target })
    previousTarget = decision.target
    if (seen.has(decision.target) || !required.has(decision.target)) admissionError('Semantic decisions do not exactly cover semantic targets.', { target: decision.target })
    seen.add(decision.target)
    const target = required.get(decision.target)
    const concepts = Array.isArray(decision.conceptIds) ? decision.conceptIds : []
    if (concepts.some((id) => typeof id !== 'string')) admissionError('Semantic decision concepts are invalid.', { target: decision.target })
    const template = Array.isArray(inspection.templates) ? inspection.templates.find((item) => item.templateId === target.templateId && item.target === target.target) : undefined
    const expected = template?.conceptIds ?? []
    if (!['deferred', 'satisfied'].includes(decision.status)) admissionError('Semantic decision status is invalid.', { target: decision.target })
    const orderedConcepts = [...concepts].sort(compareOrdinal)
    if (!sameCanonical(concepts, orderedConcepts)) admissionError('Semantic decision concepts must be ordinal sorted.', { target: decision.target })
    if (new Set(concepts).size !== concepts.length) admissionError('Semantic decision concepts must be unique.', { target: decision.target })
    if (decision.status === 'satisfied' && !sameCanonical(concepts, expected)) admissionError('Satisfied semantic decisions must attest every concept.', { target: decision.target })
    if (decision.status === 'deferred' && (concepts.length === 0 || concepts.some((id) => !expected.includes(id)))) admissionError('Deferred semantic decisions must name unresolved concepts.', { target: decision.target })
  }
  if (seen.size !== required.size) admissionError('Semantic decisions do not cover every required semantic target.')
}

function selectedProposals(inspection, dispositions, choice) {
  try {
    validateProposalDispositions(inspection.proposals, dispositions, { versionControlChoice: choice })
  } catch (error) {
    if (error instanceof InitBacklogError) throw error
    admissionError('Proposal dispositions are invalid.')
  }
  const selected = []
  for (let index = 0; index < inspection.proposals.length; index += 1) {
    if (dispositions[index].disposition === 'selected') selected.push(inspection.proposals[index])
  }
  const wraps = inspection.wrapFindings ?? []
  if (wraps.length > 0) {
    const selectedTargets = selected.filter((item) => item.reason === 'hard-wrap').map((item) => item.action.target)
    const expectedTargets = wraps.map((item) => item.target).sort()
    if (!sameCanonical(selectedTargets.slice().sort(), expectedTargets)) admissionError('Unwrap proposals must be admitted as one complete batch.')
  }

  return selected
}

function proposalForAction(action, proposals) {
  const proposal = proposalsByCanonicalAction(proposals).get(canonicalJson(action))
  if (proposal !== undefined) return proposal
  if (action.kind === 'exact-edit' && isSemanticActionId(action.id)) return null
  admissionError('Action is not one of the approved proposals.', { actionId: action.id, target: action.target })
}

function targetBytes(record) {
  return record.contentBase64 === null ? null : validateBase64(record.contentBase64)
}

// A target can carry a chain of predicted-intermediate exact edits, and the
// carried proposals are ordinal by proposal identity, which is a content
// digest and says nothing about chain order. The starting content is the
// chain head: the one candidate whose input no sibling proposal produces.
// Taking whichever candidate sorts first would seed a mechanical target with a
// mid-chain intermediate whenever the digests happened to fall that way.
function chainHeadProposal(inspection, target) {
  const siblings = (inspection.proposals ?? []).filter((item) => item.action.target === target)
  const produced = new Set(siblings.map((item) => item.afterBase64).filter((value) => value !== null && value !== undefined))
  const heads = siblings.filter((item) => item.beforeBase64 !== null && item.beforeBase64 !== undefined && !produced.has(item.beforeBase64))

  // No unique head means the chain is ambiguous, so the caller seeds nothing
  // and the edit's own input check refuses the manifest.
  return heads.length === 1 ? heads[0] : undefined
}

function initialState(record, inspection) {
  let content = targetBytes(record)
  if (content === null && record.kind === 'file') {
    const proposal = chainHeadProposal(inspection, record.target)
    content = proposal === undefined ? null : validateBase64(proposal.beforeBase64)
  }

  return { content, kind: record.kind, mode: record.mode, present: !record.states.includes('missing'), rawSha256: record.rawSha256, regions: record.editableRegions }
}

function regionFor(record, regionId) {
  return record.editableRegions.find((item) => item.regionId === regionId)
}

function parentTarget(target) {
  const separator = target.lastIndexOf('/')

  return separator < 0 ? null : target.slice(0, separator)
}

function validateRescannedRegions(regions, contentLength, action, declarations = null) {
  if (!Array.isArray(regions)) admissionError('Exact edit rescan did not return regions.', { actionId: action.id, target: action.target })
  const seen = new Set()
  let previous = null
  for (const region of regions) {
    if (region === null || typeof region !== 'object' || typeof region.regionId !== 'string' || !Number.isSafeInteger(region.startByte) || !Number.isSafeInteger(region.endByte) || region.startByte < 0 || region.endByte < region.startByte || region.endByte > contentLength || seen.has(region.regionId)) {
      admissionError('Exact edit rescan returned an invalid region set.', { actionId: action.id, target: action.target })
    }
    if (previous !== null && compareOrdinal(previous, region.regionId) >= 0) admissionError('Exact edit rescan regions are not ordinal sorted.', { actionId: action.id, target: action.target })
    seen.add(region.regionId)
    previous = region.regionId
  }

  if (declarations !== null) {
    const regionById = new Map(regions.map((region) => [region.regionId, region]))
    for (const declaration of declarations) {
      if (declaration.syntax === 'empty-document') continue
      const region = regionById.get(declaration.regionId)
      if (region === undefined || declaration.syntax !== 'gitignore-append' && declaration.missingPlacement === 'end' && region.startByte === contentLength) {
        admissionError('Exact edit rescan omitted a required declaration.', { actionId: action.id, target: action.target })
      }
    }
  }

  return regions
}

function createRegionDeclarationsResolver(inspection, options) {
  let manifest = null
  const resolved = new Map()

  return (target) => {
    const configured = options.regionDeclarations
    if (configured !== undefined) {
      const declarations = configured instanceof Map ? configured.get(target) : configured[target]
      if (declarations !== undefined) return declarations
    }
    if (resolved.has(target)) return resolved.get(target)
    try {
      manifest ??= loadManifest(options.templatesRoot)
      const selector = target === inspection?.guidance?.resolvedTarget ? '@resolved-guidance' : target
      const declarations = manifest.manifest.targets.find((item) => item.targetSelector === selector)?.regions
      resolved.set(target, declarations)

      return declarations
    } catch (error) {
      admissionError('Template region declarations could not be loaded.', { target, systemCode: error?.code })
    }
  }
}

function validateSemanticAction(action, record, inspection, options, declarationsFor) {
  if (!isSemanticActionId(action.id)) return
  if (record.contentRole !== 'semantic' || record.templateId === null || typeof record.templateId !== 'string') admissionError('Semantic action requires an authorized inspected template.', { actionId: action.id, target: action.target })
  const template = Array.isArray(inspection.templates) ? inspection.templates.find((item) => item.templateId === record.templateId && item.target === record.target) : undefined
  if (template === undefined || template.logicalSha256 !== record.templateSha256 || !Array.isArray(template.conceptIds) || template.conceptIds.length === 0) admissionError('Semantic action requires a nonempty inspected concept set.', { actionId: action.id, target: action.target })
  const declarations = declarationsFor(action.target)
  const declaration = declarations?.find((item) => item.regionId === action.regionId)
  if (declaration === undefined || declaration.semantic !== true) admissionError('Semantic action region is not authorized by the inspected metadata.', { actionId: action.id, target: action.target })
}

function rescanRegions(action, after, inspection, options, declarationsFor) {
  if (typeof options.rescanRegions === 'function') {
    let regions
    try {
      regions = options.rescanRegions({ action, content: after, inspection, target: action.target })
    } catch (error) {
      admissionError('Exact edit output could not be rescanned.', { actionId: action.id, target: action.target, systemCode: error?.code })
    }

    return validateRescannedRegions(regions, after.length, action)
  }
  let regions
  try {
    regions = inspectRegions(after, declarationsFor(action.target))
  } catch (error) {
    admissionError('Exact edit output could not be rescanned.', { actionId: action.id, target: action.target, systemCode: error?.code })
  }

  return validateRescannedRegions(regions, after.length, action, declarationsFor(action.target))
}

function simulateAction(action, state, inspection, targets, options, declarationsFor) {
  if (!ACTION_KINDS.has(action.kind)) admissionError('Action kind is not supported.', { actionId: action.id })
  const record = targets.get(action.target)
  if (record === undefined) admissionError('Action target is outside the inspected closed surface.', { actionId: action.id, target: action.target })
  if (action.kind === 'ensure-directory') {
    if (!DIRECTORY_TARGETS.has(action.target) || record.kind !== 'directory' || !record.states.includes('missing')) admissionError('Directory action has an invalid prerequisite.', { actionId: action.id, target: action.target })
    if (action.mode !== record.mode) admissionError('Directory action mode drifted from inspection.', { actionId: action.id, target: action.target })
    const parent = parentTarget(action.target)
    if (parent !== null && !targets.has(parent)) admissionError('Directory action parent is outside the inspected surface.', { actionId: action.id, target: action.target })
    state.present = true
    state.kind = 'directory'

    return
  }
  if (record.kind !== 'file') admissionError('File action targets a directory.', { actionId: action.id, target: action.target })
  if (action.kind === 'create-from-template') {
    if (!record.states.includes('missing') || record.templateId !== action.templateId || action.mode !== record.mode) admissionError('Template creation prerequisite or mode is invalid.', { actionId: action.id, target: action.target })
    const parent = parentTarget(action.target)
    if (parent !== null && !targets.has(parent)) admissionError('Template action parent is outside the inspected surface.', { actionId: action.id, target: action.target })
    state.present = true
    state.kind = 'file'
    const proposal = inspection.proposals.find((item) => item.action.id === action.id)
    state.content = proposal?.afterBase64 === null || proposal?.afterBase64 === undefined ? Buffer.alloc(0) : validateBase64(proposal.afterBase64)
    state.rawSha256 = sha256(state.content)
    state.regions = action.target === '.gitignore' ? [{ endByte: state.content.length, regionId: 'gitignore-append', startByte: state.content.length }] : state.regions

    return
  }
  if (!state.present || state.kind !== 'file') admissionError('Edit prerequisite requires a present file.', { actionId: action.id, target: action.target })
  if (action.kind === 'unwrap-file') {
    if (state.rawSha256 !== action.beforeRawSha256 || action.mode !== record.mode) admissionError('Unwrap input or mode differs from inspection.', { actionId: action.id, target: action.target })
    state.rawSha256 = action.afterRawSha256
    const finding = inspection.wrapFindings?.find((item) => item.target === action.target)
    if (finding?.predictedContentBase64 !== null && finding?.predictedContentBase64 !== undefined) {
      state.content = validateBase64(finding.predictedContentBase64)
      state.regions = finding.predictedEditableRegions
    }

    return
  }
  if (state.content === null || Buffer.from(state.content).toString('base64') !== action.beforeBase64) admissionError('Exact edit input differs from inspection or prior action.', { actionId: action.id, target: action.target })
  const region = regionFor({ editableRegions: state.regions }, action.regionId)
  if (region === undefined) admissionError('Exact edit region is not available in the current transition state.', { actionId: action.id, target: action.target })
  if (isSemanticActionId(action.id)) {
    const expectedId = deriveSemanticActionId({ afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, kind: action.kind, regionId: action.regionId, target: action.target })
    if (expectedId !== action.id || action.regionId.endsWith('empty-document')) admissionError('Semantic action is not bound to an approved semantic region.', { actionId: action.id, target: action.target })
  }
  const before = Buffer.from(state.content)
  const after = validateBase64(action.afterBase64)
  // The bytes after the region keep their content, not their offsets: a
  // semantic repair inserts into the region, so the preserved tail moves.
  // Comparing it at its original absolute offset would reject every
  // length-changing edit, the documented append included.
  const preservedTail = before.length - region.endByte
  if (isSemanticActionId(action.id) && (after.length < region.startByte + preservedTail || !before.subarray(0, region.startByte).equals(after.subarray(0, region.startByte)) || !before.subarray(region.endByte).equals(after.subarray(after.length - preservedTail)))) admissionError('Exact edit broadens its approved region.', { actionId: action.id, target: action.target })
  state.content = after
  state.rawSha256 = sha256(after)
  state.regions = rescanRegions(action, after, inspection, options, declarationsFor)
}

function simulateReady(inspection, actions, states, options = {}) {
  const unwrap = actions.filter((action) => action.kind === 'unwrap-file')
  const semanticChanges = actions.some((action) => isSemanticActionId(action.id) && action.beforeBase64 !== action.afterBase64)
  if (unwrap.length > 0 && !Array.isArray(options.readyCatalog)) {
    if (semanticChanges) admissionError('Compound ready simulation requires the carried post-unwrap catalog.', { code: 'manifest-invalid' })

    return clone(inspection.unwrapReady.after)
  }
  const catalogEntries = Array.isArray(options.readyCatalog) ? options.readyCatalog.map((item) => ({ ...item })) : []
  if (catalogEntries.length === 0) {
    for (const record of inspection.targets ?? []) {
      if (record.kind !== 'file' || !record.target.startsWith('.claude/') || record.contentBase64 === null || record.contentBase64 === undefined) continue
      catalogEntries.push({ contents: Buffer.from(validateBase64(record.contentBase64)).toString('utf8'), target: record.target.slice('.claude/'.length) })
    }
  }

  const contentsByTarget = new Map(catalogEntries.map((item) => [item.target.startsWith('.claude/') ? item.target.slice('.claude/'.length) : item.target, item.contents]))
  const unwrapTargets = new Set(unwrap.map((action) => action.target))
  for (const [physicalTarget, state] of states ?? []) {
    if (!physicalTarget.startsWith('.claude/') || state.kind !== 'file' || state.content === null) continue
    const record = (inspection.targets ?? []).find((item) => item.target === physicalTarget)
    const logicalTarget = physicalTarget.slice('.claude/'.length)
    if (record?.contentRole === 'mechanical' && unwrapTargets.has(physicalTarget) && contentsByTarget.has(logicalTarget)) continue
    contentsByTarget.set(logicalTarget, Buffer.from(state.content).toString('utf8'))
  }
  const predictedCatalog = [...contentsByTarget.entries()].map(([target, contents]) => ({ contents, target }))
  if (predictedCatalog.length === 0) return clone(inspection.ready)

  try {
    return analyzeCatalog(buildReadyCatalog(predictedCatalog))
  } catch (error) {
    admissionError('Ready parser simulation failed.', { code: 'manifest-invalid', systemCode: error?.code })
  }
}

// The manifest identity is a pure function of the request, so publication can
// recognize a durable owner record for the same manifest before admission runs.
// Admission derives its own identity through this helper so the two can never
// disagree.
function manifestProjection(request) {
  const inspection = request?.inspection ?? request
  const choice = request?.versionControlChoice ?? 'not-required'

  return {
    actions: request?.actions ?? [],
    electionMarker: electionMarkerState(inspection, choice),
    proposalDispositions: request?.proposalDispositions ?? [],
    semanticDecisions: request?.semanticDecisions ?? [],
    snapshotId: inspection.snapshotId,
    versionControlChoice: choice,
  }
}

function deriveRequestManifestId(request) {
  return deriveManifestId(manifestProjection(request))
}

function admitApplyManifest(request, options = {}) {
  const inspection = request?.inspection ?? request
  if (request?.operation !== undefined && request.operation !== 'apply') admissionError('Apply manifest operation is invalid.')
  const choice = request?.versionControlChoice ?? 'not-required'
  const dispositions = request?.proposalDispositions ?? []
  const actions = request?.actions ?? []
  validateInspectionIdentity(inspection, options.currentInspection ?? request?.currentInspection)
  validateChoice(inspection, choice)
  const targets = targetMap(inspection)
  validateSemanticDecisions(inspection, request?.semanticDecisions ?? [], targets)
  const selected = selectedProposals(inspection, dispositions, choice)
  const selectedActions = selected.map((item) => item.action)
  const declarationsFor = createRegionDeclarationsResolver(inspection, options)
  const actionIds = new Set()
  for (const action of actions) {
    try {
      validateTarget(action.target)
    } catch {
      admissionError('Action target is unsafe or outside the closed target grammar.', { actionId: action.id, code: 'invalid-target', target: null })
    }
    validateAction(action, 'manifest-invalid', 'prevalidate')
    const record = targets.get(action.target)
    if (record !== undefined) validateSemanticAction(action, record, inspection, options, declarationsFor)
    if (actionIds.has(action.id)) admissionError('Action IDs must be unique.', { actionId: action.id })
    actionIds.add(action.id)
  }
  const authoredActionIds = new Set()
  for (const action of actions) {
    if (proposalForAction(action, selected) === null) authoredActionIds.add(action.id)
  }
  const canonicalActions = new Set(actions.map((item) => canonicalJson(item)))
  for (const action of selectedActions) {
    if (!canonicalActions.has(canonicalJson(action))) admissionError('A selected proposal action is missing.', { actionId: action.id })
  }
  let ordered
  try {
    ordered = canonicalActionOrder(actions)
  } catch (error) {
    admissionError('Action transition graph is invalid.', { systemCode: error?.code })
  }
  if (!sameCanonical(ordered, actions)) admissionError('Actions are not in stable dependency order.')
  const deferredTargets = new Set((request?.semanticDecisions ?? []).filter((item) => item.status === 'deferred').map((item) => item.target))
  const simulateStates = (transition) => {
    const simulated = new Map([...targets].map(([target, record]) => [target, initialState(record, inspection)]))
    for (const action of transition) {
      if (deferredTargets.has(action.target)) admissionError('Deferred semantic targets cannot receive an action.', { actionId: action.id, target: action.target })
      const parent = parentTarget(action.target)
      if (parent !== null && simulated.has(parent) && !simulated.get(parent).present) admissionError('Action prerequisite parent is not present.', { actionId: action.id, target: action.target })
      simulateAction(action, simulated.get(action.target), inspection, targets, options, declarationsFor)
    }

    return simulated
  }
  const states = simulateStates(actions)
  const ready = simulateReady(inspection, actions, states, options)
  // The inspected transition is the manifest restricted to approved proposals:
  // every one of those effects, creations included, is predicted by inspection
  // itself, so comparing against the untouched baseline would reject the very
  // scaffold the inspection proposed. The gate therefore holds the manifest's
  // request-authored semantic edits to the inspected prediction, which is the
  // only part of the manifest inspection did not compute.
  const inspectedTransition = actions.filter((action) => !authoredActionIds.has(action.id))
  const expectedReady = inspectedTransition.length === actions.length ? ready : simulateReady(inspection, inspectedTransition, simulateStates(inspectedTransition), options)
  if (!sameCanonical(ready, expectedReady)) admissionError('Simulated ready result differs from the inspected prediction.', { code: 'manifest-invalid' })
  const projection = manifestProjection(request)
  const manifestId = deriveManifestId(projection)
  if (typeof options.writeAdapter === 'function') {
    // Admission is deliberately effect-free. Publication owns the adapter call.
  }

  return { actions, electionMarker: projection.electionMarker, manifestId, ready, snapshotId: inspection.snapshotId, states: [...states.entries()].map(([target, state]) => ({ ...state, target })) }
}

module.exports = { admitApplyManifest, deriveRequestManifestId, simulateReady }
