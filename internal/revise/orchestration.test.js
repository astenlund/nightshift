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
