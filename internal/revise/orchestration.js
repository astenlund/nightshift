'use strict'

const REVISE_LIMITS = Object.freeze({
  roundsPerRun: 30,
  verifierLaunchesPerRun: 10,
  repairLaunchesPerCellPerRound: 3,
})

const REFUSAL_CODES = Object.freeze(['invalid-state', 'invalid-input', 'off-domain', 'impermissible-outcome', 'off-route'])
const FINGERPRINT_RE = /^sha256:[0-9a-f]{12}$/
const STATUSES = Object.freeze(['reviewing', 'failed', 'post-review'])
const ROUND_STATUSES = Object.freeze(['idle', 'in-flight', 'evaluated'])
const CELL_STATUSES = Object.freeze(['active', 'inactive', 'na'])
const AGENT_STATUSES = Object.freeze(['in-flight', 'completed', 'needs-retry'])
const POST_REVIEW_STEPS = Object.freeze(['not-started', 'follow-up-routing', 'dimension-retrospective', 'authoring-retrospective', 'spec-reconciliation', 'hardening-stamp', 'done'])
const FAILING_RULES = Object.freeze(['repair-exhaustion', 'round-cap', 'verifier-cap', 'empty-applicable-set'])

class OrchestrationError extends Error {
  constructor (code, message) {
    super(message)
    this.name = 'OrchestrationError'
    if (!REFUSAL_CODES.includes(code)) { throw new Error(`unknown refusal code: ${code}`) }
    this.code = code
  }
}

function refuse (code, message) { throw new OrchestrationError(code, message) }

function noNoneString (value, code, label) {
  if (value === 'none') { refuse(code, `${label} carries the literal 'none' string; the surface sentinel is null`) }
}

function isNonNegativeInt (value) { return Number.isInteger(value) && value >= 0 }

function validateCell (cell) {
  if (cell === null || typeof cell !== 'object') { refuse('invalid-state', 'cell record must be an object') }
  if (typeof cell.id !== 'string' || cell.id === '') { refuse('invalid-state', 'cell id must be a nonempty string') }
  if (!CELL_STATUSES.includes(cell.status)) { refuse('invalid-state', `cell status out of domain: ${cell.status}`) }
  noNoneString(cell.certification, 'invalid-state', 'cell certification')
  noNoneString(cell.naReason, 'invalid-state', 'cell naReason')
  if (cell.certification !== null && !FINGERPRINT_RE.test(cell.certification)) { refuse('invalid-state', 'certification must be null or sha256:<12 hex>') }
  const inactive = cell.status === 'inactive'
  if (inactive !== (cell.certification !== null)) { refuse('invalid-state', 'a cell is inactive exactly when it holds a certification') }
  if (cell.status === 'na' && (typeof cell.naReason !== 'string' || cell.naReason.trim() === '')) { refuse('invalid-state', 'an N/A row carries a nonblank reason') }
  if (cell.status !== 'na' && cell.naReason !== null) { refuse('invalid-state', 'a non-N/A row carries no reason') }
  return cell
}

function validateState (state) {
  if (state === null || typeof state !== 'object') { refuse('invalid-state', 'state must be an object') }
  if (!STATUSES.includes(state.status)) { refuse('invalid-state', `status out of domain: ${state.status}`) }
  if (!ROUND_STATUSES.includes(state.roundStatus)) { refuse('invalid-state', `round status out of domain: ${state.roundStatus}`) }
  if (!isNonNegativeInt(state.round) || state.round > REVISE_LIMITS.roundsPerRun) { refuse('invalid-state', 'round must be an integer in 0..cap inclusive') }
  if (!FINGERPRINT_RE.test(state.fingerprint)) { refuse('invalid-state', 'fingerprint must be sha256:<12 hex>') }
  noNoneString(state.stamp, 'invalid-state', 'stamp')
  if (state.stamp !== null && !FINGERPRINT_RE.test(state.stamp)) { refuse('invalid-state', 'stamp must be null or sha256:<12 hex>') }
  if (!isNonNegativeInt(state.verifierLaunches) || state.verifierLaunches > REVISE_LIMITS.verifierLaunchesPerRun) { refuse('invalid-state', 'verifier launches must be an integer in 0..cap inclusive') }
  noNoneString(state.agreementBoundary, 'invalid-state', 'agreement boundary')
  if (![null, 'fit-check', 'agreement'].includes(state.agreementBoundary)) { refuse('invalid-state', 'agreement boundary out of domain') }
  if (typeof state.autonomousHandover !== 'boolean' || typeof state.artifactEdited !== 'boolean') { refuse('invalid-state', 'handover and edited flags must be booleans') }
  if (!POST_REVIEW_STEPS.includes(state.postReviewStep)) { refuse('invalid-state', 'post-review step out of domain') }
  noNoneString(state.failure, 'invalid-state', 'failure')
  if (state.failure !== null && typeof state.failure !== 'string') { refuse('invalid-state', 'failure must be null or the Failure JSON string content') }
  if (!Array.isArray(state.cells) || state.cells.length === 0) { refuse('invalid-state', 'state must carry a nonempty cell table') }
  const seen = new Set()
  for (const c of state.cells) {
    validateCell(c)
    if (seen.has(c.id)) { refuse('invalid-state', `duplicate cell id: ${c.id}`) }
    seen.add(c.id)
  }
  if (!Array.isArray(state.agents)) { refuse('invalid-state', 'state must carry an Agents list') }
  for (const a of state.agents) {
    if (a === null || typeof a !== 'object') { refuse('invalid-state', 'agent row must be an object') }
    if (typeof a.role !== 'string' || typeof a.cellId !== 'string') { refuse('invalid-state', 'agent row must carry role and cellId') }
    if (!AGENT_STATUSES.includes(a.status)) { refuse('invalid-state', `agent status out of domain: ${a.status}`) }
    if (!isNonNegativeInt(a.repairs) || a.repairs > REVISE_LIMITS.repairLaunchesPerCellPerRound) { refuse('invalid-state', 'repair counter must be an integer in 0..cap inclusive') }
  }
  if (typeof state.pendingUserRequest !== 'boolean' || typeof state.pendingControllerMutation !== 'boolean') { refuse('invalid-state', 'pending flags must be booleans') }
  return state
}

function validateApplicability (state, applicability) {
  if (!Array.isArray(applicability)) { refuse('invalid-input', 'applicability must be a list') }
  const ids = new Set(state.cells.map(c => c.id))
  const seen = new Set()
  for (const v of applicability) {
    if (v === null || typeof v !== 'object' || typeof v.cellId !== 'string') { refuse('invalid-input', 'applicability verdict must name a cell') }
    if (!ids.has(v.cellId)) { refuse('invalid-input', `applicability names an unknown cell: ${v.cellId}`) }
    if (seen.has(v.cellId)) { refuse('invalid-input', `applicability names ${v.cellId} twice`) }
    seen.add(v.cellId)
    if (typeof v.applicable !== 'boolean') { refuse('invalid-input', 'applicability verdict must be boolean') }
    noNoneString(v.reason, 'invalid-input', 'applicability reason')
    if (!v.applicable && (typeof v.reason !== 'string' || v.reason.trim() === '')) { refuse('invalid-input', 'a not-applicable verdict carries a nonblank reason') }
  }
  if (seen.size !== ids.size) { refuse('invalid-input', 'applicability must cover exactly the state cells') }
  return applicability
}

function resolveBoundary (state, applicability, gateCurrent, remap) {
  validateState(state)
  validateApplicability(state, applicability)
  refuse('off-domain', 'resolveBoundary is implemented in a later task')
}

module.exports = {
  OrchestrationError,
  REVISE_LIMITS,
  validateState,
  resolveBoundary,
  // filled by later tasks:
  cellAfterRound: undefined,
  verifierBoundary: undefined,
  preflightLaunch: undefined,
  exitTerminal: undefined,
  canComplete: undefined,
  buildFailureRecord: undefined,
  parseFailureRecord: undefined,
}
