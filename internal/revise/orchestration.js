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

// Caller precondition, stated rather than silently relied on: the controller
// applies an evaluated round's dispositions, verifierBoundary included, before
// resolving the boundary; a resume that finds an undispositioned round result
// on disk re-enters adjudication first. The crashed state is byte-identical to
// the legitimate post-relaunch-disposition state, so this is an ordering
// precondition the checkpoint cannot carry as a domain check.
function resolveBoundary (state, applicability, gateCurrent, remap) {
  validateState(state)
  validateApplicability(state, applicability)
  if (typeof gateCurrent !== 'boolean') { refuse('invalid-input', 'gateCurrent must be a boolean assertion') }
  if (remap !== null) {
    if (remap === undefined || typeof remap !== 'object' || !Array.isArray(remap.affected) || remap.affected.length === 0) {
      refuse('invalid-input', 'remap must be null or {affected} with a nonempty list')
    }
    const ids = new Set(state.cells.map(c => c.id))
    for (const id of remap.affected) {
      if (!ids.has(id)) { refuse('invalid-input', `remap names a cell absent from the state: ${id}`) }
    }
  }
  // Domain: the all-inactive evaluated boundary of a reviewing run.
  if (state.status !== 'reviewing') { refuse('off-domain', 'resolveBoundary requires Status: reviewing') }
  if (state.roundStatus === 'in-flight') { refuse('off-domain', 'a round is still in flight; the boundary is not resolved') }
  if (state.cells.some(c => c.status === 'active')) { refuse('off-domain', 'an applicable cell is still active') }
  // GUARD before any transition.
  if (state.pendingUserRequest || state.pendingControllerMutation || state.agreementBoundary !== null || gateCurrent === false) {
    return { transition: 'blocked' }
  }
  const clearStamp = remap !== null
  const affected = new Set(remap === null ? [] : remap.affected)
  const verdictFor = new Map(applicability.map(v => [v.cellId, v]))
  const activated = []
  const promotions = []
  const demotions = []
  const preserved = []
  const nextCells = state.cells.map(c => {
    const v = verdictFor.get(c.id)
    if (!v.applicable) {
      if (c.status === 'na') {
        preserved.push({ cellId: c.id, reason: v.reason })
        return { ...c, naReason: v.reason }
      }
      demotions.push({ cellId: c.id, reason: v.reason })
      return { ...c, status: 'na', naReason: v.reason, certification: null }
    }
    if (c.status === 'na') {
      promotions.push(c.id)
      return { ...c, status: 'active', naReason: null, certification: null }
    }
    // applicable and inactive: remap clearing first, then staleness.
    if (affected.has(c.id) || c.certification !== state.fingerprint) {
      activated.push(c.id)
      return { ...c, status: 'active', certification: null }
    }
    return c
  })
  const carriers = { promotions, demotions, preserved, clearStamp }
  const applicable = nextCells.filter(c => c.status !== 'na')
  if (applicable.length === 0) {
    return { transition: 'failed', failure: buildFailureRecord(state, 'empty-applicable-set', { cells: nextCells }), ...carriers }
  }
  if (activated.length > 0 || promotions.length > 0) {
    return { transition: 'reactivate', activated, ...carriers }
  }
  // A reconciling remap invalidates the stamp even when no cell reactivates,
  // so convergence compares the post-clear stamp, never the raw persisted one.
  const effectiveStamp = clearStamp ? null : state.stamp
  if (effectiveStamp !== state.fingerprint) {
    return { transition: 'launch-verifier', activated: [], ...carriers }
  }
  return { transition: 'post-review', activated: [], ...carriers }
}

function buildFailureRecord (state, failingRule, extra) {
  if (!FAILING_RULES.includes(failingRule)) { refuse('invalid-input', `unknown failing rule: ${failingRule}`) }
  const cellsSnapshot = (extra.cells || state.cells).map(c => ({
    id: c.id,
    status: c.status,
    certification: c.certification ?? null,
    repairs: (state.agents.find(a => a.cellId === c.id) || { repairs: 0 }).repairs,
  }))
  const record = {
    failingRule,
    round: state.round,
    fingerprint: state.fingerprint,
    verifierLaunches: state.verifierLaunches,
    cells: cellsSnapshot,
  }
  if (failingRule === 'repair-exhaustion') {
    if (typeof extra.cellId !== 'string' || extra.cellId === '') { refuse('invalid-input', 'a repair-exhaustion record carries the exhausted cellId') }
    record.cellId = extra.cellId
  }
  return JSON.stringify(record)
}

function parseFailureRecord (text) {
  if (typeof text !== 'string') { refuse('invalid-input', 'failure record must be the Failure JSON string content') }
  let record
  try { record = JSON.parse(text) } catch { refuse('invalid-input', 'failure record is unparseable environment residue') }
  if (record === null || typeof record !== 'object' || !FAILING_RULES.includes(record.failingRule)) {
    refuse('invalid-input', 'failure record carries an unknown failing rule')
  }
  if (!isNonNegativeInt(record.round) || !FINGERPRINT_RE.test(record.fingerprint) || !isNonNegativeInt(record.verifierLaunches) || !Array.isArray(record.cells)) {
    refuse('invalid-input', 'failure record is missing named fields')
  }
  if (record.failingRule === 'repair-exhaustion' && (typeof record.cellId !== 'string' || record.cellId === '')) {
    refuse('invalid-input', 'a repair-exhaustion record names the exhausted cell')
  }
  return record
}

const LAUNCH_KINDS = Object.freeze(['round', 'verifier', 'repair'])

function preflightLaunch (state, launch, gateCurrent) {
  validateState(state)
  if (launch === null || typeof launch !== 'object' || !LAUNCH_KINDS.includes(launch.kind)) { refuse('invalid-input', 'launch kind out of domain') }
  if (typeof gateCurrent !== 'boolean') { refuse('invalid-input', 'gateCurrent must be a boolean assertion') }
  let row = null
  if (launch.kind === 'repair') {
    noNoneString(launch.cellId, 'invalid-input', 'repair cellId')
    row = state.agents.find(a => a.cellId === launch.cellId)
    if (typeof launch.cellId !== 'string' || launch.cellId === '' || !row) { refuse('invalid-input', 'a repair cellId names a current Agents row') }
  }
  // Domain first.
  if (state.status !== 'reviewing') { refuse('off-domain', 'every launch kind requires Status: reviewing') }
  if (launch.kind === 'verifier' && state.roundStatus === 'in-flight') { refuse('off-domain', 'no second launch against an in-flight verifier round') }
  if (launch.kind === 'repair') {
    if (state.roundStatus !== 'in-flight') { refuse('off-domain', 'a repair targets unfinished work inside an in-flight round') }
    if (row.status === 'completed') { refuse('off-domain', 'a completed Agents row is not repairable') }
  }
  // Guard second.
  const blockedAllKinds = state.pendingControllerMutation || state.agreementBoundary !== null || gateCurrent === false
  const blockedByRequest = state.pendingUserRequest && launch.kind !== 'repair'
  if (blockedAllKinds || blockedByRequest) { return { ok: false, blocked: true } }
  // Caps last, from an unblocked in-domain state.
  if (launch.kind === 'verifier') {
    if (state.verifierLaunches + 1 > REVISE_LIMITS.verifierLaunchesPerRun) {
      return { ok: false, failure: buildFailureRecord(state, 'verifier-cap', {}) }
    }
    if (state.round + 1 > REVISE_LIMITS.roundsPerRun) {
      return { ok: false, failure: buildFailureRecord(state, 'round-cap', {}) }
    }
    return { ok: true }
  }
  if (launch.kind === 'round') {
    if (state.round + 1 > REVISE_LIMITS.roundsPerRun) {
      return { ok: false, failure: buildFailureRecord(state, 'round-cap', {}) }
    }
    return { ok: true }
  }
  if (row.repairs + 1 > REVISE_LIMITS.repairLaunchesPerCellPerRound) {
    return { ok: false, failure: buildFailureRecord(state, 'repair-exhaustion', { cellId: launch.cellId }) }
  }
  return { ok: true }
}

const VERDICTS = Object.freeze(['CONFIRMED', 'REFUTED', 'JUDGMENT_CALL'])
const DISPOSITIONS = Object.freeze(['fix-applied', 'deferred-follow-up', 'refuted', 'accepted-judgment-call'])

function validateOutcome (outcome, { requireDerived }) {
  if (outcome === null || typeof outcome !== 'object') { refuse('impermissible-outcome', 'outcome must be an object') }
  if (typeof outcome.lgtm !== 'boolean' || typeof outcome.verifiedNote !== 'string' || !Array.isArray(outcome.findings)) {
    refuse('impermissible-outcome', 'outcome must carry lgtm, verifiedNote, and findings')
  }
  if (outcome.verifiedNote.trim() === '') { refuse('impermissible-outcome', 'a blank verification note is repairable reviewer output') }
  if (outcome.lgtm && outcome.findings.length > 0) { refuse('impermissible-outcome', 'lgtm with a nonempty findings list is contradictory output') }
  if (!outcome.lgtm && outcome.findings.length === 0) { refuse('impermissible-outcome', 'no-lgtm with an empty findings list is contradictory output') }
  for (const f of outcome.findings) {
    if (f === null || typeof f !== 'object' || !VERDICTS.includes(f.verdict) || !DISPOSITIONS.includes(f.disposition) || typeof f.actionableFollowUp !== 'boolean') {
      refuse('impermissible-outcome', 'finding shape out of domain')
    }
    if (f.disposition === 'refuted' && f.verdict !== 'REFUTED') { refuse('impermissible-outcome', 'a refutation requires a skeptic-verified REFUTED verdict') }
    if (f.disposition === 'accepted-judgment-call' && f.verdict !== 'JUDGMENT_CALL') { refuse('impermissible-outcome', 'the acceptance branch applies only to JUDGMENT_CALL verdicts') }
    if (f.disposition === 'refuted' && f.actionableFollowUp) { refuse('impermissible-outcome', 'actionableFollowUp is inconsistent on a refuted finding') }
    if (f.disposition === 'deferred-follow-up' && !f.actionableFollowUp) { refuse('impermissible-outcome', 'a deferred follow-up finding carries an unconditional authoritative row') }
  }
  if (requireDerived) {
    const appliedFix = outcome.findings.some(f => f.disposition === 'fix-applied')
    const followUp = outcome.findings.some(f => f.actionableFollowUp)
    if (outcome.appliedFix !== appliedFix || outcome.authoritativeDeferredFollowUp !== followUp) {
      refuse('impermissible-outcome', 'derived flags contradict the per-finding dispositions')
    }
  }
  return outcome
}

// Caller precondition, stated rather than silently relied on: roundOutcome is
// the current round's adjudication-ready result for this cell at the passed
// fingerprint; the whole-round barrier and the round/fingerprint/delivery-
// snapshot identity checks that discard outdated results are controller-owned
// upstream. The module-side defenses are the cell-status refusal and the
// fingerprint-bound certification.
function cellAfterRound (cellRecord, roundOutcome, fingerprint) {
  validateCell(cellRecord)
  if (!FINGERPRINT_RE.test(fingerprint)) { refuse('invalid-input', 'reviewed fingerprint must be sha256:<12 hex>') }
  if (cellRecord.status !== 'active') { refuse('off-domain', 'a round outcome for an inactive or N/A cell is a stale or misrouted replay') }
  validateOutcome(roundOutcome, { requireDerived: false })
  if (roundOutcome.lgtm) {
    return { status: 'inactive', certification: fingerprint, ledger: { acknowledgement: false, followUp: false, appliedChange: false } }
  }
  return {
    status: 'active',
    certification: null,
    ledger: {
      acknowledgement: roundOutcome.findings.some(f => f.disposition === 'refuted' || f.disposition === 'accepted-judgment-call' || f.disposition === 'deferred-follow-up'),
      followUp: roundOutcome.findings.some(f => f.actionableFollowUp),
      appliedChange: roundOutcome.findings.some(f => f.disposition === 'fix-applied'),
    },
  }
}

// Caller precondition, stated rather than silently relied on: verifierOutcome
// is the current verifier round's adjudication-ready result at the state's
// current fingerprint (a fingerprint move mid-round discards the round
// upstream), so the stamp value is under that precondition exactly the
// reviewed fingerprint.
function verifierBoundary (state, verifierOutcome) {
  validateState(state)
  if (state.status !== 'reviewing') { refuse('off-domain', 'verifierBoundary requires Status: reviewing') }
  if (state.roundStatus !== 'evaluated') { refuse('off-domain', 'verifierBoundary requires an evaluated round') }
  if (!state.agents.some(a => a.role === 'verifier')) { refuse('off-domain', 'no verifier Role row: a reviewer round can never stamp') }
  if (verifierOutcome === null || typeof verifierOutcome !== 'object' || typeof verifierOutcome.appliedFix !== 'boolean' || typeof verifierOutcome.authoritativeDeferredFollowUp !== 'boolean') {
    refuse('impermissible-outcome', 'verifierOutcome must carry the derived appliedFix and authoritativeDeferredFollowUp flags')
  }
  validateOutcome(verifierOutcome, { requireDerived: true })
  if (verifierOutcome.lgtm) { return { stamp: state.fingerprint, next: 'post-review' } }
  if (verifierOutcome.appliedFix) { return { stamp: null, next: 'sweep' } }
  if (verifierOutcome.authoritativeDeferredFollowUp) { return { stamp: state.fingerprint, next: 'post-review' } }
  return { stamp: null, next: 'relaunch-verifier' }
}

const FAILED_KINDS = Object.freeze(['retry', 'restart', 'abandon'])
const POST_REVIEW_KINDS = Object.freeze(['reviewable-change', 'finalize'])
const ROUTE_TABLE = Object.freeze({
  retry: ['repair-exhaustion'],
  restart: ['round-cap', 'verifier-cap', 'empty-applicable-set'],
  abandon: FAILING_RULES,
})

function exitTerminal (state, disposition, applicability, failure) {
  validateState(state)
  if (disposition === null || typeof disposition !== 'object' || typeof disposition.kind !== 'string') { refuse('invalid-input', 'disposition must carry a kind') }
  const kind = disposition.kind
  const failedKind = FAILED_KINDS.includes(kind)
  const postReviewKind = POST_REVIEW_KINDS.includes(kind)
  if (!failedKind && !postReviewKind) { refuse('invalid-input', `disposition kind out of domain: ${kind}`) }
  // Status domain check.
  if (state.status === 'reviewing') { refuse('off-domain', 'a reviewing state is refused for every disposition') }
  if (failedKind && state.status !== 'failed') { refuse('off-domain', `${kind} requires Status: failed`) }
  if (postReviewKind && state.status !== 'post-review') { refuse('off-domain', `${kind} requires Status: post-review`) }
  // failure record scoping.
  if (postReviewKind) {
    if (failure !== null && failure !== undefined) { refuse('invalid-input', 'a post-review disposition never carries a failure record') }
  }
  // applicability scoping.
  if (kind === 'restart') {
    if (applicability === null || applicability === undefined) { refuse('invalid-input', 'restart requires the controller-evaluated applicability verdicts') }
    validateApplicability(state, applicability)
  } else if (applicability !== null && applicability !== undefined) {
    refuse('invalid-input', 'applicability rides only the restart disposition')
  }
  if (failedKind) {
    if (failure === null || failure === undefined) { refuse('invalid-input', 'a failed-state disposition requires the round-tripped failure record') }
    const record = parseFailureRecord(failure)
    // Derivable contradiction checks against the state.
    if (record.failingRule === 'round-cap' && state.round < REVISE_LIMITS.roundsPerRun) { refuse('invalid-input', 'a round-cap record contradicts a below-cap round') }
    if (record.failingRule === 'verifier-cap' && state.verifierLaunches < REVISE_LIMITS.verifierLaunchesPerRun) { refuse('invalid-input', 'a verifier-cap record contradicts below-cap launches') }
    if (record.failingRule === 'repair-exhaustion') {
      const row = state.agents.find(a => a.cellId === record.cellId)
      if (!row) { refuse('invalid-input', 'the recorded exhausted cell has no current Agents row') }
      if (row.repairs < REVISE_LIMITS.repairLaunchesPerCellPerRound) { refuse('invalid-input', 'a repair-exhaustion record contradicts a below-cap counter') }
    }
    if (record.failingRule === 'empty-applicable-set' && !record.cells.every(c => c.status === 'na')) {
      refuse('invalid-input', 'an empty-applicable-set record must show the sweep-derived applicable set as empty')
    }
    // Route table.
    if (!ROUTE_TABLE[kind].includes(record.failingRule)) { refuse('off-route', `${kind} is not a permitted disposition for ${record.failingRule}`) }
    if (kind === 'retry') {
      if (typeof disposition.identityMatched !== 'boolean') { refuse('invalid-input', 'retry carries the caller-asserted identityMatched check') }
      if (disposition.identityMatched === false) { refuse('invalid-input', 'an identity mismatch follows drift abandonment, not retry') }
      if (typeof disposition.cellId !== 'string' || disposition.cellId === '') { refuse('invalid-input', 'retry names the exhausted cell') }
      if (!state.agents.some(a => a.cellId === disposition.cellId)) { refuse('invalid-input', 'a retry cellId names a current Agents row') }
      if (disposition.cellId !== record.cellId) { refuse('invalid-input', 'retry resets the recorded exhausted cell, never a sibling') }
      return {
        exit: 'reviewing',
        effects: {
          status: 'reviewing',
          failure: null,
          agentRow: { cellId: disposition.cellId, status: 'needs-retry', repairs: 0 },
          resultWork: { reviewerOrVerifierCell: 'needs-reviewer', skepticFinding: 'needs-retry' },
        },
      }
    }
    if (kind === 'restart') {
      noNoneString(disposition.currentFingerprint, 'invalid-input', 'restart currentFingerprint')
      if (!FINGERPRINT_RE.test(disposition.currentFingerprint)) { refuse('invalid-input', 'restart carries the controller-computed current fingerprint') }
      const verdictFor = new Map(applicability.map(v => [v.cellId, v]))
      return {
        exit: 'restarted',
        effects: {
          status: 'reviewing',
          postReviewStep: 'not-started',
          failure: null,
          priorFailureCopied: true,
          round: 0,
          roundStatus: 'idle',
          verifierLaunches: 0,
          stamp: null,
          fingerprint: disposition.currentFingerprint,
          artifactEdited: false,
          agents: [],
          postReviewWorkItemsCleared: true,
          pendingControllerMutationCleared: true,
          cells: state.cells.map(c => {
            const v = verdictFor.get(c.id)
            return v.applicable
              ? { id: c.id, kind: c.kind, status: 'active', naReason: null, certification: null }
              : { id: c.id, kind: c.kind, status: 'na', naReason: v.reason, certification: null }
          }),
          agreementBoundaryPreserved: true,
        },
      }
    }
    return { exit: 'terminated', effects: {} } // abandon: deletion is controller-owned.
  }
  // Post-review dispositions: checkpoint-readable drain-and-agreement conjuncts.
  if (state.pendingUserRequest || state.pendingControllerMutation || state.agreementBoundary !== null) {
    refuse('off-domain', 'the drain and agreement resolution precede any post-review boundary')
  }
  if (kind === 'reviewable-change') {
    noNoneString(disposition.nextFingerprint, 'invalid-input', 'reviewable-change nextFingerprint')
    if (!FINGERPRINT_RE.test(disposition.nextFingerprint)) { refuse('invalid-input', 'reviewable-change carries the controller-computed refreshed fingerprint') }
    return {
      exit: 'reviewing',
      effects: {
        status: 'reviewing',
        postReviewStep: 'not-started',
        postReviewWorkItemsCleared: true,
        completedMutationCleared: true,
        stamp: null,
        fingerprint: disposition.nextFingerprint,
      },
    }
  }
  // finalize
  if (state.postReviewStep !== 'done') { refuse('off-domain', 'finalization requires Post-review step: done') }
  if (typeof disposition.recheckMatched !== 'boolean') { refuse('invalid-input', 'finalize carries the caller-asserted final fingerprint recheck') }
  if (disposition.recheckMatched === false) { refuse('invalid-input', 'a failed recheck routes to the reviewable-change disposition') }
  return { exit: 'finalized', effects: {} } // deletion is controller-owned.
}

function canComplete (state) {
  validateState(state)
  const applicable = state.cells.filter(c => c.status !== 'na')
  if (applicable.length === 0) { return false }
  if (!applicable.every(c => c.status === 'inactive')) { return false }
  if (!applicable.every(c => c.certification === state.fingerprint)) { return false }
  return state.stamp === state.fingerprint
}

module.exports = {
  OrchestrationError,
  REVISE_LIMITS,
  validateState,
  resolveBoundary,
  canComplete,
  preflightLaunch,
  buildFailureRecord,
  parseFailureRecord,
  cellAfterRound,
  verifierBoundary,
  exitTerminal,
}
