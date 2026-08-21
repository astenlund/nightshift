'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const mod = require('./orchestration.js')
const {
  OrchestrationError, REVISE_LIMITS,
  resolveBoundary, cellAfterRound, verifierBoundary, preflightLaunch, exitTerminal, canComplete,
  validateState, buildFailureRecord, parseFailureRecord,
} = mod

const FP = 'sha256:aaaaaaaaaaaa'
const FP2 = 'sha256:bbbbbbbbbbbb'

function cell (over) {
  return { id: 'd1/whole', kind: 'cross-cutting', status: 'active', naReason: null, certification: null, ...over }
}

function agentRow (over) {
  return { role: 'reviewer', cellId: 'd1/whole', status: 'in-flight', repairs: 0, ...over }
}

function baseState (over) {
  return {
    status: 'reviewing', roundStatus: 'evaluated', round: 3, fingerprint: FP, stamp: null,
    verifierLaunches: 0, agreementBoundary: null, autonomousHandover: false, artifactEdited: false,
    postReviewStep: 'not-started', failure: null,
    cells: [cell()], agents: [agentRow()],
    pendingUserRequest: false, pendingControllerMutation: false,
    ...over,
  }
}

function applicabilityFor (state, notApplicable = {}) {
  return state.cells.map(c => notApplicable[c.id]
    ? { cellId: c.id, applicable: false, reason: notApplicable[c.id] }
    : { cellId: c.id, applicable: true })
}

function finding (over) {
  return { verdict: 'CONFIRMED', disposition: 'fix-applied', actionableFollowUp: false, ...over }
}

function verifierState (over) {
  return baseState({
    roundStatus: 'evaluated',
    cells: [cell({ status: 'inactive', certification: FP })],
    agents: [{ role: 'verifier', cellId: 'verifier/whole-artifact', status: 'completed', repairs: 0 }],
    ...over,
  })
}

function verifierOutcome (over) {
  return { lgtm: true, verifiedNote: 'read the whole artifact and cross-checked every dimension seam', findings: [], appliedFix: false, authoritativeDeferredFollowUp: false, ...over }
}

function assertRefusal (fn, code, label) {
  let threw = null
  try { fn() } catch (error) { threw = error }
  assert.equal(threw instanceof OrchestrationError, true, `${label}: must throw OrchestrationError`)
  assert.equal(threw.code, code, `${label}: code must be ${code}, got ${threw && threw.code}`)
}

const tests = {
  'limits table carries the shipped cap values as data' () {
    assert.deepEqual(REVISE_LIMITS, { roundsPerRun: 30, verifierLaunchesPerRun: 10, repairLaunchesPerCellPerRound: 3 })
  },
  'an active cell carrying a certification is refused' () {
    const s = baseState({ cells: [cell({ status: 'active', certification: FP })] })
    assertRefusal(() => validateState(s), 'invalid-state', 'active-with-cert')
  },
  'an inactive cell without a certification is refused' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: null })] })
    assertRefusal(() => validateState(s), 'invalid-state', 'inactive-without-cert')
  },
  'an N/A row with a blank reason is refused' () {
    const s = baseState({ cells: [cell({ status: 'na', naReason: '   ', certification: null })] })
    assertRefusal(() => validateState(s), 'invalid-state', 'na-blank-reason')
  },
  'duplicate cell IDs are refused' () {
    const s = baseState({ cells: [cell(), cell()] })
    assertRefusal(() => validateState(s), 'invalid-state', 'duplicate-ids')
  },
  'a counter beyond its cap is refused while a counter at its cap is accepted' () {
    const at = baseState({ roundStatus: 'in-flight', agents: [agentRow({ repairs: 3 })] })
    validateState(at) // must not throw
    const beyond = baseState({ agents: [agentRow({ repairs: 4 })] })
    assertRefusal(() => validateState(beyond), 'invalid-state', 'counter-beyond-cap')
  },
  'a literal none string on a state field is refused as invalid-state' () {
    const s = baseState({ stamp: 'none' })
    assertRefusal(() => validateState(s), 'invalid-state', 'none-string-state')
  },
  'an applicability set missing a cell or naming an unknown cell is refused' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => resolveBoundary(s, [], true, null), 'invalid-input', 'applicability-missing')
    const extra = [{ cellId: 'd1/whole', applicable: true }, { cellId: 'ghost', applicable: true }]
    assertRefusal(() => resolveBoundary(s, extra, true, null), 'invalid-input', 'applicability-unknown')
  },
  'a literal none string as a parameter or carried value is refused as invalid-input' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => resolveBoundary(s, [{ cellId: 'd1/whole', applicable: false, reason: 'none' }], true, null), 'invalid-input', 'none-string-parameter')
  },
  'completion: some applicable cell active -> false' () {
    const s = baseState({ cells: [cell(), cell({ id: 'd2/whole', status: 'inactive', certification: FP })], stamp: FP })
    assert.equal(canComplete(s), false)
  },
  'completion: one certification at an older fingerprint -> false' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP2 })], stamp: FP })
    assert.equal(canComplete(s), false)
  },
  'completion: converged, stamp null -> false' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })], stamp: null })
    assert.equal(canComplete(s), false)
  },
  'completion: converged, stamp at an older fingerprint -> false' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })], stamp: FP2 })
    assert.equal(canComplete(s), false)
  },
  'completion: applicable set empty -> false, never completes' () {
    const s = baseState({ cells: [cell({ status: 'na', naReason: 'out of scope', certification: null })], stamp: FP })
    assert.equal(canComplete(s), false)
  },
  'completion: converged with an N/A cell present -> true (quantifier over applicable cells only)' () {
    const s = baseState({
      cells: [cell({ status: 'inactive', certification: FP }), cell({ id: 'd2/whole', status: 'na', naReason: 'out of scope', certification: null })],
      stamp: FP,
    })
    assert.equal(canComplete(s), true)
  },
  'completion: completes only on the full conjunction' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })], stamp: FP })
    assert.equal(canComplete(s), true)
  },
  'a Start round that would exceed round 30 fails before any agent launches' () {
    const s = baseState({ round: 30, roundStatus: 'evaluated' })
    const r = preflightLaunch(s, { kind: 'round' }, true)
    assert.equal(r.ok, false)
    const rec = parseFailureRecord(r.failure)
    assert.equal(rec.failingRule, 'round-cap')
    assert.equal(rec.round, 30)
    assert.equal(rec.fingerprint, FP)
  },
  'an eleventh verifier launch fails the run at the preflight' () {
    const s = baseState({ verifierLaunches: 10, cells: [cell({ status: 'inactive', certification: FP })] })
    const r = preflightLaunch(s, { kind: 'verifier' }, true)
    assert.equal(r.ok, false)
    assert.equal(parseFailureRecord(r.failure).failingRule, 'verifier-cap')
  },
  'double-exceeded verifier preflight carries verifier-cap (verifier cap before round cap)' () {
    const s = baseState({ verifierLaunches: 10, round: 30, cells: [cell({ status: 'inactive', certification: FP })] })
    const r = preflightLaunch(s, { kind: 'verifier' }, true)
    assert.equal(parseFailureRecord(r.failure).failingRule, 'verifier-cap')
  },
  'a verifier launch below the verifier cap still pays the round cap' () {
    const s = baseState({ verifierLaunches: 4, round: 30, cells: [cell({ status: 'inactive', certification: FP })] })
    const r = preflightLaunch(s, { kind: 'verifier' }, true)
    assert.equal(r.ok, false)
    assert.equal(parseFailureRecord(r.failure).failingRule, 'round-cap')
  },
  'a repair counter at 3 within its round fails the run before another launch' () {
    const s = baseState({ roundStatus: 'in-flight', agents: [agentRow({ repairs: 3 })] })
    const r = preflightLaunch(s, { kind: 'repair', cellId: 'd1/whole' }, true)
    assert.equal(r.ok, false)
    const rec = parseFailureRecord(r.failure)
    assert.equal(rec.failingRule, 'repair-exhaustion')
    assert.equal(rec.cellId, 'd1/whole')
  },
  'any launch kind with a pending mutation, non-null boundary, or false gate -> blocked' () {
    for (const over of [{ pendingControllerMutation: true }, { agreementBoundary: 'fit-check' }]) {
      for (const launch of [{ kind: 'round' }, { kind: 'verifier' }, { kind: 'repair', cellId: 'd1/whole' }]) {
        const s = baseState({ roundStatus: launch.kind === 'repair' ? 'in-flight' : 'evaluated', ...over })
        assert.deepEqual(preflightLaunch(s, launch, true), { ok: false, blocked: true }, `${launch.kind} ${JSON.stringify(over)}`)
      }
    }
    for (const launch of [{ kind: 'round' }, { kind: 'verifier' }, { kind: 'repair', cellId: 'd1/whole' }]) {
      const gateFalse = baseState({ roundStatus: launch.kind === 'repair' ? 'in-flight' : 'evaluated' })
      assert.deepEqual(preflightLaunch(gateFalse, launch, false), { ok: false, blocked: true }, `gate-false ${launch.kind}`)
    }
  },
  'a pending user request blocks round and verifier but not repair (the deadlock exemption)' () {
    const round = baseState({ pendingUserRequest: true })
    assert.deepEqual(preflightLaunch(round, { kind: 'round' }, true), { ok: false, blocked: true })
    const verifier = baseState({ pendingUserRequest: true, cells: [cell({ status: 'inactive', certification: FP })] })
    assert.deepEqual(preflightLaunch(verifier, { kind: 'verifier' }, true), { ok: false, blocked: true })
    const repair = baseState({ pendingUserRequest: true, roundStatus: 'in-flight' })
    assert.deepEqual(preflightLaunch(repair, { kind: 'repair', cellId: 'd1/whole' }, true), { ok: true })
  },
  'a round preflight on an in-flight state with no blocking condition -> ok (verifier-only conjunct)' () {
    const s = baseState({ roundStatus: 'in-flight' })
    assert.deepEqual(preflightLaunch(s, { kind: 'round' }, true), { ok: true })
  },
  'a verifier preflight with Round status in-flight is refused off-domain even when blocked' () {
    const s = baseState({ roundStatus: 'in-flight', pendingUserRequest: true, cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => preflightLaunch(s, { kind: 'verifier' }, true), 'off-domain', 'verifier-in-flight-blocked')
  },
  'a repair preflight with Round status evaluated or idle, or a completed row, is refused off-domain' () {
    assertRefusal(() => preflightLaunch(baseState({ roundStatus: 'evaluated' }), { kind: 'repair', cellId: 'd1/whole' }, true), 'off-domain', 'repair-evaluated')
    assertRefusal(() => preflightLaunch(baseState({ roundStatus: 'idle' }), { kind: 'repair', cellId: 'd1/whole' }, true), 'off-domain', 'repair-idle')
    const completed = baseState({ roundStatus: 'in-flight', agents: [agentRow({ status: 'completed' })] })
    assertRefusal(() => preflightLaunch(completed, { kind: 'repair', cellId: 'd1/whole' }, true), 'off-domain', 'repair-completed-row')
  },
  'a repair preflight naming a cell with no current Agents row is refused' () {
    const s = baseState({ roundStatus: 'in-flight' })
    assertRefusal(() => preflightLaunch(s, { kind: 'repair', cellId: 'ghost' }, true), 'invalid-input', 'repair-unknown-row')
  },
  'any preflight kind on a failed or post-review state -> off-domain, even when also blocked' () {
    for (const status of ['failed', 'post-review']) {
      for (const launch of [{ kind: 'round' }, { kind: 'verifier' }, { kind: 'repair', cellId: 'd1/whole' }]) {
        const s = baseState({ status, pendingUserRequest: true, failure: status === 'failed' ? buildFailureRecord(baseState(), 'round-cap', {}) : null })
        assertRefusal(() => preflightLaunch(s, launch, true), 'off-domain', `${launch.kind}-on-${status}`)
      }
    }
  },
  'a state both blocked and at a cap -> blocked, never a cap failure' () {
    const s = baseState({ round: 30, pendingControllerMutation: true })
    assert.deepEqual(preflightLaunch(s, { kind: 'round' }, true), { ok: false, blocked: true })
  },
  'failure record round-trips and refuses unparseable or unknown-class text' () {
    const text = buildFailureRecord(baseState({ round: 30 }), 'round-cap', {})
    const rec = parseFailureRecord(text)
    assert.equal(rec.failingRule, 'round-cap')
    assert.equal(typeof rec.verifierLaunches, 'number')
    assert.equal(Array.isArray(rec.cells), true)
    assertRefusal(() => parseFailureRecord('not json'), 'invalid-input', 'unparseable-record')
    assertRefusal(() => parseFailureRecord(JSON.stringify({ failingRule: 'novel-class' })), 'invalid-input', 'unknown-class')
  },
  'skeptic-refuted sole finding -> cell stays active with acknowledgement only' () {
    const r = cellAfterRound(cell(), { lgtm: false, verifiedNote: 'checked the claim against SKILL.md', findings: [finding({ verdict: 'REFUTED', disposition: 'refuted' })] }, FP)
    assert.deepEqual(r, { status: 'active', certification: null, ledger: { acknowledgement: true, followUp: false, appliedChange: false } })
  },
  'controller rejection without a skeptic-verified refutation is refused' () {
    assertRefusal(() => cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding({ verdict: 'CONFIRMED', disposition: 'refuted' })] }, FP), 'impermissible-outcome', 'unverified-refutation')
  },
  'mixed round: one refuted plus one valid-but-deferred -> active with follow-up and acknowledgement' () {
    const r = cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding({ verdict: 'REFUTED', disposition: 'refuted' }), finding({ disposition: 'deferred-follow-up', actionableFollowUp: true })] }, FP)
    assert.deepEqual(r, { status: 'active', certification: null, ledger: { acknowledgement: true, followUp: true, appliedChange: false } })
  },
  'accepted judgment call with an actionable follow-up -> active with follow-up row recorded' () {
    const r = cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding({ verdict: 'JUDGMENT_CALL', disposition: 'accepted-judgment-call', actionableFollowUp: true })] }, FP)
    assert.deepEqual(r.ledger, { acknowledgement: true, followUp: true, appliedChange: false })
    assert.equal(r.status, 'active')
  },
  'acknowledgement-only accepted judgment call -> active with no certification' () {
    const r = cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding({ verdict: 'JUDGMENT_CALL', disposition: 'accepted-judgment-call' })] }, FP)
    assert.deepEqual(r, { status: 'active', certification: null, ledger: { acknowledgement: true, followUp: false, appliedChange: false } })
  },
  'fix-applied, self-contained -> active, applied-change only' () {
    const r = cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding()] }, FP)
    assert.deepEqual(r, { status: 'active', certification: null, ledger: { acknowledgement: false, followUp: false, appliedChange: true } })
  },
  'fix-applied with a queued out-of-surface remainder -> applied-change and follow-up flags both set' () {
    const r = cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding({ actionableFollowUp: true })] }, FP)
    assert.deepEqual(r.ledger, { acknowledgement: false, followUp: true, appliedChange: true })
  },
  'a later clean LGTM with a concrete rationale certifies that review fingerprint' () {
    const r = cellAfterRound(cell(), { lgtm: true, verifiedNote: 'traced every invariant against SKILL.md', findings: [] }, FP2)
    assert.deepEqual(r, { status: 'inactive', certification: FP2, ledger: { acknowledgement: false, followUp: false, appliedChange: false } })
  },
  'acceptance branch on a CONFIRMED-verdict finding is refused' () {
    assertRefusal(() => cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding({ verdict: 'CONFIRMED', disposition: 'accepted-judgment-call' })] }, FP), 'impermissible-outcome', 'acceptance-on-confirmed')
  },
  'an LGTM with a blank note is refused as repairable reviewer output' () {
    assertRefusal(() => cellAfterRound(cell(), { lgtm: true, verifiedNote: '   ', findings: [] }, FP), 'impermissible-outcome', 'blank-note-lgtm')
    assertRefusal(() => cellAfterRound(cell(), { lgtm: false, verifiedNote: '', findings: [finding()] }, FP), 'impermissible-outcome', 'blank-note-findings')
  },
  'a round outcome for an inactive or N/A cell is refused as a stale or misrouted replay' () {
    assertRefusal(() => cellAfterRound(cell({ status: 'inactive', certification: FP }), { lgtm: true, verifiedNote: 'n', findings: [] }, FP), 'off-domain', 'replay-inactive')
    assertRefusal(() => cellAfterRound(cell({ status: 'na', naReason: 'out of scope' }), { lgtm: true, verifiedNote: 'n', findings: [] }, FP), 'off-domain', 'replay-na')
  },
  'contradictory-output class is refused at cellAfterRound' () {
    assertRefusal(() => cellAfterRound(cell(), { lgtm: true, verifiedNote: 'n', findings: [finding()] }, FP), 'impermissible-outcome', 'lgtm-with-findings')
    assertRefusal(() => cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [] }, FP), 'impermissible-outcome', 'no-lgtm-empty')
  },
  'actionableFollowUp inconsistency is refused at cellAfterRound' () {
    assertRefusal(() => cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding({ verdict: 'REFUTED', disposition: 'refuted', actionableFollowUp: true })] }, FP), 'impermissible-outcome', 'followup-on-refuted')
    assertRefusal(() => cellAfterRound(cell(), { lgtm: false, verifiedNote: 'n', findings: [finding({ disposition: 'deferred-follow-up', actionableFollowUp: false })] }, FP), 'impermissible-outcome', 'deferred-without-row')
  },
  'verifier clean LGTM with a concrete note -> current fingerprint stamped' () {
    assert.deepEqual(verifierBoundary(verifierState(), verifierOutcome()), { stamp: FP, next: 'post-review' })
  },
  'verifierBoundary on reviewer-only Agents rows is refused' () {
    const s = verifierState({ agents: [agentRow({ status: 'completed' })] })
    assertRefusal(() => verifierBoundary(s, verifierOutcome()), 'off-domain', 'reviewer-rows-only')
  },
  'verifier LGTM without a concrete note -> refused, no stamp and no transition' () {
    assertRefusal(() => verifierBoundary(verifierState(), verifierOutcome({ verifiedNote: ' ' })), 'impermissible-outcome', 'verifier-blank-note')
  },
  'all verifier findings refuted -> stamp unset, relaunch at the same fingerprint' () {
    const o = verifierOutcome({ lgtm: false, findings: [finding({ verdict: 'REFUTED', disposition: 'refuted' })] })
    assert.deepEqual(verifierBoundary(verifierState(), o), { stamp: null, next: 'relaunch-verifier' })
  },
  'all verifier findings acknowledgement-only judgment calls -> stamp unset, relaunch' () {
    const o = verifierOutcome({ lgtm: false, findings: [finding({ verdict: 'JUDGMENT_CALL', disposition: 'accepted-judgment-call' })] })
    assert.deepEqual(verifierBoundary(verifierState(), o), { stamp: null, next: 'relaunch-verifier' })
  },
  'authoritative deferred follow-up with no fix -> may stamp without LGTM' () {
    const o = verifierOutcome({ lgtm: false, findings: [finding({ disposition: 'deferred-follow-up', actionableFollowUp: true })], authoritativeDeferredFollowUp: true })
    assert.deepEqual(verifierBoundary(verifierState(), o), { stamp: FP, next: 'post-review' })
  },
  'deferred follow-up plus an applied fix -> stamp unset, fingerprint advance owned upstream, sweep resumes' () {
    const o = verifierOutcome({
      lgtm: false,
      findings: [finding({ disposition: 'deferred-follow-up', actionableFollowUp: true }), finding()],
      appliedFix: true,
      authoritativeDeferredFollowUp: true,
    })
    assert.deepEqual(verifierBoundary(verifierState(), o), { stamp: null, next: 'sweep' })
  },
  'applied fix with no deferred follow-up -> stamp unset, sweep resumes' () {
    const o = verifierOutcome({ lgtm: false, findings: [finding()], appliedFix: true })
    assert.deepEqual(verifierBoundary(verifierState(), o), { stamp: null, next: 'sweep' })
  },
  'verifierBoundary domain and derived-flag contradictions are refused' () {
    assertRefusal(() => verifierBoundary(verifierState({ status: 'post-review' }), verifierOutcome()), 'off-domain', 'verifier-status')
    assertRefusal(() => verifierBoundary(verifierState({ roundStatus: 'idle' }), verifierOutcome()), 'off-domain', 'verifier-roundstatus')
    const contradicted = verifierOutcome({ lgtm: false, findings: [finding()], appliedFix: false })
    assertRefusal(() => verifierBoundary(verifierState(), contradicted), 'impermissible-outcome', 'derived-flag-mismatch')
  },
  'contradictory-output class is refused at verifierBoundary too' () {
    assertRefusal(() => verifierBoundary(verifierState(), verifierOutcome({ lgtm: true, findings: [finding()], appliedFix: true })), 'impermissible-outcome', 'verifier-lgtm-with-findings')
  },
  'actionableFollowUp inconsistency is refused at verifierBoundary too' () {
    const o = verifierOutcome({ lgtm: false, findings: [finding({ verdict: 'REFUTED', disposition: 'refuted', actionableFollowUp: true })], authoritativeDeferredFollowUp: true })
    assertRefusal(() => verifierBoundary(verifierState(), o), 'impermissible-outcome', 'verifier-followup-on-refuted')
  },
}

let failures = 0
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL - ${name}`)
    console.error(error && error.stack ? error.stack : String(error))
  }
}
if (failures > 0) {
  console.error(`orchestration.test: ${failures} case(s) failed`)
  process.exitCode = 1
} else {
  console.log(`orchestration.test: all ${Object.keys(tests).length} named cases passed`)
}
