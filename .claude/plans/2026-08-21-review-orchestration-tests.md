# Review Orchestration Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the revise engine's wave/convergence/adjudication decisions into a pure Node module (`internal/revise/orchestration.js`) with a fixture suite (`internal/revise/orchestration.test.js`) that binds the invariants, pins six SKILL.md sentences, and lands the two engine convention sentences plus every suite-enumeration site update in the same change set.

**Architecture:** One dependency-free CommonJS module exporting six pure functions over a decoded review-state projection, a closed refusal error, and a declared limits table. A framework-free test file beside it runs data-driven fixture cases (state in, result or refusal out) plus six verbatim prose pins with mutation probes. No engine behavior changes: SKILL.md gains exactly two one-sentence conventions the spec ships, and the repository's suite enumerations gain the new suite.

**Tech Stack:** Node 22, CommonJS, `node:assert/strict`, no test framework (exit code 1 on failure), mirroring `internal/revise/revise-round.test.js` and `skills/ready/ready.test.js`.

Governing-spec hardening record: `revise-spec graduated 2026-08-21 02:57 at c721e87, scope: whole file, content: 948a9f41`.

**Spec:** [.claude/features/review-orchestration-tests.md](.claude/features/review-orchestration-tests.md)

## Governing specs

- Spec JSON: {"kind":"whole-file","path":".claude/features/review-orchestration-tests.md","selectors":[],"workUnit":null}

## Global Constraints

- Shell for every verification command: Git Bash (POSIX sh) on Windows; commands use forward slashes and full paths, no `cd` prefixes.
- All generated text is pure ASCII: no em-dashes, en-dashes, emoji, or other non-ASCII bytes. After edits to prose files, verify bytes: `st=0; n=$(LC_ALL=C.UTF-8 grep -cP '[^\x00-\x7F]' <file>) || st=$?` and require `n` = 0 with `st` = 1.
- Commit subjects: Conventional Commits, max 72 chars, subject-only (no body, no Co-Authored-By trailer).
- Caps are data, not scattered literals: 30 rounds per run (verifier rounds included), 10 verifier launches per run, 3 execution-repair launches per stable cell per round. They live only in the exported `REVISE_LIMITS` table.
- Fingerprint/stamp shape everywhere: `sha256:` plus exactly 12 lowercase hexadecimal characters.
- The refusal is one thrown `OrchestrationError` with a closed `code` in `['invalid-state', 'invalid-input', 'off-domain', 'impermissible-outcome', 'off-route']`. Fixtures bind the code, not just the throw.
- Absent values on the module surface are `null`, never the string `'none'`; a literal `'none'` string on any surface field is refused (state fields as `invalid-state`, parameters and carried values as `invalid-input`).
- The module is a consultable spec-check: no file under `skills/` or `hooks/` starts importing it, and `internal/revise/SKILL.md` gains only the two convention sentences in Task 9. No controller rewiring.
- Files end with a trailing newline.

---

## File Structure

- Create: `internal/revise/orchestration.js` - the pure transition module: `REVISE_LIMITS`, `OrchestrationError`, `resolveBoundary`, `cellAfterRound`, `verifierBoundary`, `preflightLaunch`, `exitTerminal`, `canComplete`, plus the exported-for-tests helpers `validateState`, `buildFailureRecord`, `parseFailureRecord` (eleven exported names total, exactly the names the suite destructures; Task 1's `module.exports` block is the authoritative list and matches this line; `validateCell`, `validateApplicability`, `refuse`, and `FINGERPRINT_RE` stay module-internal).
- Create: `internal/revise/orchestration.test.js` - the fixture suite: shared state builders, data-driven fixture cases grouped by spec section, six prose pins with mutation probes. Runs with `node internal/revise/orchestration.test.js`, exit code 1 on failure.
- Modify: `internal/revise/SKILL.md` - two one-sentence conventions (failure-record persistence; deferred scope-map refresh).
- Modify: `tests/universal-skill-topology.test.js` - add both new files to the relocated-engine-files list.
- Modify: `AGENTS.md` - new per-suite bullet plus the suite-count sentence.
- Modify: `README.md` - suite run-list sentence.
- Modify: `.github/workflows/ci.yml` - one per-file step.
- Modify: `skills/spec-agreement/spec-agreement.test.js` - the literal suite-count pin.
- Modify (conditional): `.claude-plugin/plugin.json` - the patch-version bump when Task 10's version check finds the unpushed range carries none.

## State projection shape (used by every task)

The fixture suite binds this exact member spelling (the spec leaves spelling to this plan):

```js
// state: the decoded checkpoint projection
{
  status: 'reviewing' | 'failed' | 'post-review',
  roundStatus: 'idle' | 'in-flight' | 'evaluated',
  round: 0,                        // integer >= 0
  fingerprint: 'sha256:aaaaaaaaaaaa',
  stamp: null,                     // null or 'sha256:<12hex>'
  verifierLaunches: 0,             // integer 0..10
  agreementBoundary: null,         // null | 'fit-check' | 'agreement'
  autonomousHandover: false,
  artifactEdited: false,
  postReviewStep: 'not-started',   // 'not-started'|'follow-up-routing'|'dimension-retrospective'|'authoring-retrospective'|'spec-reconciliation'|'hardening-stamp'|'done'
  failure: null,                   // null or the Failure JSON string content (compact canonical JSON text)
  cells: [ { id: 'd1/whole', kind: 'cross-cutting', status: 'active', naReason: null, certification: null } ],
  agents: [ { role: 'reviewer', cellId: 'd1/whole', status: 'in-flight', repairs: 0 } ],
  pendingUserRequest: false,
  pendingControllerMutation: false,
}
// applicability: [{ cellId, applicable: true } | { cellId, applicable: false, reason: 'nonblank' }], exactly one per state cell
// roundOutcome: { lgtm, verifiedNote, findings: [{ verdict, disposition, actionableFollowUp }] }
// verifierOutcome: roundOutcome plus { appliedFix, authoritativeDeferredFollowUp }
// failure record (JSON text round-tripped through state.failure):
// { failingRule: 'repair-exhaustion'|'round-cap'|'verifier-cap'|'empty-applicable-set',
//   round, fingerprint, verifierLaunches,
//   cells: [{ id, status, certification, repairs }],
//   cellId }   // present only for repair-exhaustion
```

---

### Task 1: Module scaffold, refusal error, limits table, input validation

**Files:**
- Create: `internal/revise/orchestration.js`
- Create: `internal/revise/orchestration.test.js`

**Interfaces:**
- Produces: exported: `OrchestrationError` (has `.code`), `REVISE_LIMITS = { roundsPerRun: 30, verifierLaunchesPerRun: 10, repairLaunchesPerCellPerRound: 3 }`, `validateState(state)`; module-internal helpers later tasks call before their own logic: `validateCell(cell)`, `validateApplicability(state, applicability)`, `refuse(code, message)`, `FINGERPRINT_RE`.

- [ ] **Step 1: Write the failing test harness and input-contract fixtures**

Create `internal/revise/orchestration.test.js`:

```js
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
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: FAIL with `Cannot find module './orchestration.js'` (exit code nonzero).

- [ ] **Step 3: Write the module scaffold and validation**

Create `internal/revise/orchestration.js`:

```js
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

module.exports = {
  OrchestrationError,
  REVISE_LIMITS,
  validateState,
  // filled by later tasks:
  resolveBoundary: undefined,
  cellAfterRound: undefined,
  verifierBoundary: undefined,
  preflightLaunch: undefined,
  exitTerminal: undefined,
  canComplete: undefined,
  buildFailureRecord: undefined,
  parseFailureRecord: undefined,
}
```

Then replace the `resolveBoundary` stub used by the applicability test with a minimal domain wrapper so Task 1's tests pass without Task 6 (Task 6 replaces it):

```js
function resolveBoundary (state, applicability, gateCurrent, remap) {
  validateState(state)
  validateApplicability(state, applicability)
  refuse('off-domain', 'resolveBoundary is implemented in a later task')
}
```

and export it (`resolveBoundary,` in `module.exports` instead of `resolveBoundary: undefined`).

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: `orchestration.test: all 8 named cases passed`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/orchestration.js internal/revise/orchestration.test.js
git -C C:/Git/nightshift commit -m "feat(revise): scaffold orchestration module with input contract"
```

---

### Task 2: canComplete

**Files:**
- Modify: `internal/revise/orchestration.js`
- Modify: `internal/revise/orchestration.test.js`

**Interfaces:**
- Consumes: `validateState`, `REVISE_LIMITS`, `FINGERPRINT_RE` from Task 1.
- Produces: `canComplete(state) -> boolean` (throws `OrchestrationError` on invalid input; boolean defined only over valid states). The completion conjunction: applicable set nonempty AND every applicable cell inactive AND every applicable cell's certification equals `state.fingerprint` AND `state.stamp` equals `state.fingerprint`.

- [ ] **Step 1: Add the failing completion fixtures**

Append to the `tests` object in `orchestration.test.js` (before the runner):

```js
  'completion: some applicable cell active -> false' () {
    const s = baseState({ cells: [cell(), cell({ id: 'd2/whole', status: 'inactive', certification: FP })], stamp: FP })
    assert.equal(canComplete(s), false)
  },
  'completion: one certification at an older fingerprint -> false' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP2 })], stamp: FP })
    assert.equal(canComplete(s), false)
  },
  'completion: converged, stamp none -> false' () {
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: FAIL - the new cases throw `TypeError: canComplete is not a function` (module exports it as `undefined`).

- [ ] **Step 3: Implement canComplete**

Add to `orchestration.js` (and export by name):

```js
function canComplete (state) {
  validateState(state)
  const applicable = state.cells.filter(c => c.status !== 'na')
  if (applicable.length === 0) { return false }
  if (!applicable.every(c => c.status === 'inactive')) { return false }
  if (!applicable.every(c => c.certification === state.fingerprint)) { return false }
  return state.stamp === state.fingerprint
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: all named cases pass, exit code 0.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/orchestration.js internal/revise/orchestration.test.js
git -C C:/Git/nightshift commit -m "feat(revise): add canComplete stamp conjunction"
```

---

### Task 3: preflightLaunch and the failure-record builder

**Files:**
- Modify: `internal/revise/orchestration.js`
- Modify: `internal/revise/orchestration.test.js`

**Interfaces:**
- Consumes: Task 1 validation helpers.
- Produces: `preflightLaunch(state, launch, gateCurrent) -> {ok: true} | {ok: false, blocked: true} | {ok: false, failure}` where `failure` is the compact canonical JSON text of the failure record; `buildFailureRecord(state, failingRule, extra) -> string` and `parseFailureRecord(text) -> record` (throws `invalid-input` on unparseable or unknown-class text). Task 6 reuses `buildFailureRecord` for the empty-applicable-set failure; Task 7 reuses `parseFailureRecord`.

- [ ] **Step 1: Add the failing execution-failure fixtures**

Append to `tests`:

```js
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
  'any launch kind with a pending mutation, non-none boundary, or false gate -> blocked' () {
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: FAIL - `preflightLaunch is not a function` on the first new case.

- [ ] **Step 3: Implement**

Add to `orchestration.js` (and export `preflightLaunch`, `buildFailureRecord`, `parseFailureRecord`):

```js
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
```

Note on the round-cap boundary value: `round` holds the current round number; a `Start round` computing round `round + 1 > 30` fails. `validateState` accepts `round` up to 30 (a state at the cap is valid input).

Note on the pending-user-request exemption: the `launch.kind !== 'repair'` carve-out knowingly diverges from the literal all-dispatch reading of SKILL.md's `Also block those dispatches...` sentence. The governing spec records this as a deliberate kind-scoped reconciliation and defers the engine-prose true-up to a queued follow-up outside this change set; do not "fix" the module to match that sentence, and do not edit it here.

- [ ] **Step 4: Run to verify pass**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: all named cases pass, exit code 0.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/orchestration.js internal/revise/orchestration.test.js
git -C C:/Git/nightshift commit -m "feat(revise): add preflightLaunch with failure records"
```

---

### Task 4: cellAfterRound and outcome validation

**Files:**
- Modify: `internal/revise/orchestration.js`
- Modify: `internal/revise/orchestration.test.js`

**Interfaces:**
- Consumes: `validateCell`, `refuse`, `FINGERPRINT_RE`.
- Produces: `cellAfterRound(cell, roundOutcome, fingerprint) -> {status, certification, ledger}` with `ledger = {acknowledgement, followUp, appliedChange}` booleans; shared internal `validateOutcome(outcome, {requireDerived})` reused by Task 5 (validates note, contradictory-output class, verdict/disposition enums, refuted-requires-REFUTED, acceptance-requires-JUDGMENT_CALL, actionableFollowUp consistency; with `requireDerived` also checks `appliedFix`/`authoritativeDeferredFollowUp` equality).

- [ ] **Step 1: Add the failing rejected-findings fixtures**

Append to `tests` (helper first, above `tests`):

```js
function finding (over) {
  return { verdict: 'CONFIRMED', disposition: 'fix-applied', actionableFollowUp: false, ...over }
}
```

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: FAIL - `cellAfterRound is not a function`.

- [ ] **Step 3: Implement**

Add to `orchestration.js` (export `cellAfterRound`):

```js
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
      acknowledgement: roundOutcome.findings.some(f => f.disposition === 'refuted' || f.disposition === 'accepted-judgment-call'),
      followUp: roundOutcome.findings.some(f => f.actionableFollowUp),
      appliedChange: roundOutcome.findings.some(f => f.disposition === 'fix-applied'),
    },
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: all named cases pass, exit code 0.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/orchestration.js internal/revise/orchestration.test.js
git -C C:/Git/nightshift commit -m "feat(revise): add cellAfterRound disposition rules"
```

---

### Task 5: verifierBoundary

**Files:**
- Modify: `internal/revise/orchestration.js`
- Modify: `internal/revise/orchestration.test.js`

**Interfaces:**
- Consumes: `validateState`, `validateOutcome` from Task 4.
- Produces: `verifierBoundary(state, verifierOutcome) -> {stamp, next}` with `stamp` null or `state.fingerprint`, `next` in `['post-review', 'sweep', 'relaunch-verifier']`.

- [ ] **Step 1: Add the failing verifier-stamping fixtures**

Append to `tests` (helper above `tests`):

```js
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
```

```js
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
```

- [ ] **Step 2: Run to verify failure**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: FAIL - `verifierBoundary is not a function`.

- [ ] **Step 3: Implement**

```js
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
```

Export it.

- [ ] **Step 4: Run to verify pass**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: all named cases pass, exit code 0.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/orchestration.js internal/revise/orchestration.test.js
git -C C:/Git/nightshift commit -m "feat(revise): add verifierBoundary stamp routes"
```

---

### Task 6: resolveBoundary (guard, remap, sweep, convergence)

**Files:**
- Modify: `internal/revise/orchestration.js` (replace the Task 1 stub)
- Modify: `internal/revise/orchestration.test.js`

**Interfaces:**
- Consumes: `validateState`, `validateApplicability`, `buildFailureRecord`.
- Produces: `resolveBoundary(state, applicability, gateCurrent, remap)` returning `{transition: 'blocked'}` or `{transition, activated?, promotions, demotions, preserved, clearStamp, failure?}` per the spec. `activated` and `promotions` are cell-ID lists; `demotions`/`preserved` are `{cellId, reason}` lists; `clearStamp` is true exactly when `remap` is non-null.

- [ ] **Step 1: Add the failing boundary fixtures**

Append to `tests`:

```js
  'boundary: one stale certification -> exactly that cell reactivates' () {
    const s = baseState({
      cells: [cell({ status: 'inactive', certification: FP2 }), cell({ id: 'd2/whole', status: 'inactive', certification: FP })],
    })
    const r = resolveBoundary(s, applicabilityFor(s), true, null)
    assert.equal(r.transition, 'reactivate')
    assert.deepEqual(r.activated, ['d1/whole'])
    assert.deepEqual(r.promotions, [])
    assert.deepEqual(r.demotions, [])
    assert.equal(r.clearStamp, false)
  },
  'boundary: all certifications current, stamp none -> verifier launch' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })], stamp: null })
    assert.equal(resolveBoundary(s, applicabilityFor(s), true, null).transition, 'launch-verifier')
  },
  'boundary: all certifications current, stamp current -> post-review' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })], stamp: FP })
    assert.equal(resolveBoundary(s, applicabilityFor(s), true, null).transition, 'post-review')
  },
  'boundary: demotion-only sweep falls through with demotions carried' () {
    const s = baseState({
      cells: [cell({ status: 'inactive', certification: FP }), cell({ id: 'd2/whole', status: 'inactive', certification: FP })],
      stamp: FP,
    })
    const r = resolveBoundary(s, applicabilityFor(s, { 'd2/whole': 'slice no longer delivered' }), true, null)
    assert.equal(r.transition, 'post-review')
    assert.deepEqual(r.demotions, [{ cellId: 'd2/whole', reason: 'slice no longer delivered' }])
  },
  'boundary: a stale-certified cell demoted by its verdict never counts as activated' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP2 }), cell({ id: 'd2/whole', status: 'inactive', certification: FP })], stamp: FP })
    const r = resolveBoundary(s, applicabilityFor(s, { 'd1/whole': 'now out of scope' }), true, null)
    assert.equal(r.transition, 'post-review')
    assert.deepEqual(r.activated, [])
    assert.deepEqual(r.demotions, [{ cellId: 'd1/whole', reason: 'now out of scope' }])
  },
  'boundary: preserved N/A cell re-encodes its fresh reason' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP }), cell({ id: 'd2/whole', status: 'na', naReason: 'old reason' })], stamp: FP })
    const r = resolveBoundary(s, applicabilityFor(s, { 'd2/whole': 'fresh reason text' }), true, null)
    assert.equal(r.transition, 'post-review')
    assert.deepEqual(r.preserved, [{ cellId: 'd2/whole', reason: 'fresh reason text' }])
  },
  'boundary: sweep leaving the applicable set empty fails the run' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })] })
    const r = resolveBoundary(s, applicabilityFor(s, { 'd1/whole': 'nothing left in scope' }), true, null)
    assert.equal(r.transition, 'failed')
    const rec = parseFailureRecord(r.failure)
    assert.equal(rec.failingRule, 'empty-applicable-set')
    assert.equal(rec.cells.every(c => c.status === 'na'), true, 'record snapshot must show the sweep-derived applicable set as empty')
  },
  'boundary: contradicted N/A promotes to active with no certification' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP }), cell({ id: 'd2/whole', status: 'na', naReason: 'was out of scope' })], stamp: FP })
    const r = resolveBoundary(s, applicabilityFor(s), true, null)
    assert.equal(r.transition, 'reactivate')
    assert.deepEqual(r.promotions, ['d2/whole'])
  },
  'boundary: scope-map change clears affected certifications and clearStamp is true' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP }), cell({ id: 'd2/whole', status: 'inactive', certification: FP })], stamp: FP })
    const r = resolveBoundary(s, applicabilityFor(s), true, { affected: ['d1/whole'] })
    assert.equal(r.clearStamp, true)
    assert.equal(r.transition, 'reactivate')
    assert.deepEqual(r.activated, ['d1/whole'])
  },
  'boundary: malformed remap is refused' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => resolveBoundary(s, applicabilityFor(s), true, { affected: [] }), 'invalid-input', 'remap-empty')
    assertRefusal(() => resolveBoundary(s, applicabilityFor(s), true, { affected: ['ghost'] }), 'invalid-input', 'remap-unknown')
  },
  'boundary: blocked guard preempts every transition' () {
    for (const over of [{ pendingUserRequest: true }, { pendingControllerMutation: true }, { agreementBoundary: 'agreement' }]) {
      const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })], ...over })
      assert.deepEqual(resolveBoundary(s, applicabilityFor(s), true, null), { transition: 'blocked' }, JSON.stringify(over))
    }
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP })] })
    assert.deepEqual(resolveBoundary(s, applicabilityFor(s), false, null), { transition: 'blocked' })
  },
  'certification span: a certified cell is never activated at an unchanged fingerprint' () {
    const s = baseState({ cells: [cell({ status: 'inactive', certification: FP }), cell({ id: 'd2/whole', status: 'inactive', certification: FP })], stamp: null })
    const first = resolveBoundary(s, applicabilityFor(s), true, null)
    const second = resolveBoundary(s, applicabilityFor(s), true, null)
    assert.equal(first.transition, 'launch-verifier')
    assert.deepEqual(second, first, 'repeated boundary resolution is pure: the certified cell joins no activated set at an unchanged fingerprint, and the controller launches only active cells, so it is launched zero times')
  },
  'cross-cell: a sibling fix moves the fingerprint mid-round; the certified cell is preserved until the sweep' () {
    const midRound = baseState({ fingerprint: FP2, cells: [cell({ status: 'inactive', certification: FP }), cell({ id: 'd2/whole' })] })
    assertRefusal(() => resolveBoundary(midRound, applicabilityFor(midRound), true, null), 'off-domain', 'no-sweep-mid-round')
    const atBoundary = baseState({ fingerprint: FP2, cells: [cell({ status: 'inactive', certification: FP }), cell({ id: 'd2/whole', status: 'inactive', certification: FP2 })] })
    const r = resolveBoundary(atBoundary, applicabilityFor(atBoundary), true, null)
    assert.deepEqual(r.activated, ['d1/whole'], 'the sweep is the global re-review barrier: the stale certification reactivates only at the all-inactive boundary')
  },
  'boundary: off-domain states are refused' () {
    const active = baseState()
    assertRefusal(() => resolveBoundary(active, applicabilityFor(active), true, null), 'off-domain', 'boundary-active-cell')
    const failed = baseState({ status: 'failed', failure: buildFailureRecord(baseState(), 'round-cap', {}), cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => resolveBoundary(failed, applicabilityFor(failed), true, null), 'off-domain', 'boundary-failed')
    const inFlight = baseState({ roundStatus: 'in-flight', cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => resolveBoundary(inFlight, applicabilityFor(inFlight), true, null), 'off-domain', 'boundary-in-flight')
  },
```

- [ ] **Step 2: Run to verify failure**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: FAIL - the Task 1 stub throws `off-domain` on the first boundary case (`resolveBoundary is implemented in a later task`).

- [ ] **Step 3: Implement (replace the stub)**

```js
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
  if (state.stamp !== state.fingerprint) {
    return { transition: 'launch-verifier', activated: [], ...carriers }
  }
  return { transition: 'post-review', activated: [], ...carriers }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: all named cases pass, exit code 0. (Earlier tasks' applicability-refusal cases still pass because validation precedes the domain check.)

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/orchestration.js internal/revise/orchestration.test.js
git -C C:/Git/nightshift commit -m "feat(revise): add resolveBoundary sweep and convergence"
```

---

### Task 7: exitTerminal (terminal-state exits)

**Files:**
- Modify: `internal/revise/orchestration.js`
- Modify: `internal/revise/orchestration.test.js`

**Interfaces:**
- Consumes: `parseFailureRecord`, `buildFailureRecord`, `validateState`, `validateApplicability`.
- Produces: `exitTerminal(state, disposition, applicability, failure) -> {exit, effects}` per the five routes. `failure` is the Failure JSON string content (or `null`); `applicability` is required for restart and must be `null` otherwise.

- [ ] **Step 1: Add the failing terminal-exit fixtures**

Append to `tests` (helper above `tests`):

```js
function failedState (failingRule, over = {}, extra = {}) {
  const base = baseState({ roundStatus: 'evaluated', agents: [agentRow({ status: 'needs-retry', repairs: 3 })], ...over })
  const record = buildFailureRecord(base, failingRule, failingRule === 'repair-exhaustion' ? { cellId: 'd1/whole', ...extra } : extra)
  return { ...base, status: 'failed', failure: record }
}
```

```js
  'authorized retry with matching identity -> reviewing, counter reset, results preserved' () {
    const s = failedState('repair-exhaustion', { roundStatus: 'in-flight' })
    const r = exitTerminal(s, { kind: 'retry', cellId: 'd1/whole', identityMatched: true }, null, s.failure)
    assert.equal(r.exit, 'reviewing')
    assert.deepEqual(r.effects.status, 'reviewing')
    assert.equal(r.effects.failure, null)
    assert.deepEqual(r.effects.agentRow, { cellId: 'd1/whole', status: 'needs-retry', repairs: 0 })
    assert.deepEqual(r.effects.resultWork, { reviewerOrVerifierCell: 'needs-reviewer', skepticFinding: 'needs-retry' })
  },
  'retry, restart, and abandon are permitted under Autonomous handover: yes exactly as with no' () {
    const s = failedState('repair-exhaustion', { roundStatus: 'in-flight', autonomousHandover: true })
    assert.equal(exitTerminal(s, { kind: 'retry', cellId: 'd1/whole', identityMatched: true }, null, s.failure).exit, 'reviewing')
    const cap = failedState('round-cap', { round: 30, autonomousHandover: true })
    assert.equal(exitTerminal(cap, { kind: 'restart', currentFingerprint: FP2 }, applicabilityFor(cap), cap.failure).exit, 'restarted')
    assert.equal(exitTerminal(cap, { kind: 'abandon' }, null, cap.failure).exit, 'terminated')
  },
  'retry with mismatched identity is refused with no counter reset' () {
    const s = failedState('repair-exhaustion', { roundStatus: 'in-flight' })
    assertRefusal(() => exitTerminal(s, { kind: 'retry', cellId: 'd1/whole', identityMatched: false }, null, s.failure), 'invalid-input', 'retry-identity')
  },
  'a retry naming a cell with no current Agents row is refused' () {
    const s = failedState('repair-exhaustion', { roundStatus: 'in-flight' })
    const record = JSON.parse(s.failure); record.cellId = 'ghost'
    assertRefusal(() => exitTerminal(s, { kind: 'retry', cellId: 'ghost', identityMatched: true }, null, JSON.stringify(record)), 'invalid-input', 'retry-unknown-row')
  },
  'a retry whose cellId is not the recorded exhausted cell is refused even at its own cap' () {
    const s = failedState('repair-exhaustion', {
      roundStatus: 'in-flight',
      cells: [cell(), cell({ id: 'd2/whole' })],
      agents: [agentRow({ status: 'needs-retry', repairs: 3 }), agentRow({ cellId: 'd2/whole', status: 'in-flight', repairs: 3 })],
    })
    assertRefusal(() => exitTerminal(s, { kind: 'retry', cellId: 'd2/whole', identityMatched: true }, null, s.failure), 'invalid-input', 'retry-sibling-at-cap')
  },
  'restart after a cap failure applies the complete Restart run template' () {
    const s = failedState('round-cap', { round: 30, verifierLaunches: 4, stamp: FP, agreementBoundary: 'fit-check', cells: [cell({ status: 'inactive', certification: FP2 })], agents: [agentRow({ status: 'completed', repairs: 2 })] })
    const r = exitTerminal(s, { kind: 'restart', currentFingerprint: FP }, applicabilityFor(s), s.failure)
    assert.equal(r.exit, 'restarted')
    assert.deepEqual(r.effects, {
      status: 'reviewing',
      postReviewStep: 'not-started',
      failure: null,
      priorFailureCopied: true,
      round: 0,
      roundStatus: 'idle',
      verifierLaunches: 0,
      stamp: null,
      fingerprint: FP,
      artifactEdited: false,
      agents: [],
      postReviewWorkItemsCleared: true,
      pendingControllerMutationCleared: true,
      cells: [{ id: 'd1/whole', kind: 'cross-cutting', status: 'active', naReason: null, certification: null }],
      agreementBoundaryPreserved: true,
    })
  },
  'restart after an empty-applicable-set failure with applicability unchanged fails again deterministically' () {
    const s = failedState('empty-applicable-set', { cells: [cell({ status: 'na', naReason: 'nothing in scope' })], agents: [] })
    const r = exitTerminal(s, { kind: 'restart', currentFingerprint: FP }, applicabilityFor(s, { 'd1/whole': 'nothing in scope' }), s.failure)
    assert.equal(r.exit, 'restarted')
    assert.equal(r.effects.cells.every(c => c.status === 'na'), true, 'restart with unchanged applicability re-derives the empty set; the next boundary fails again')
  },
  'the retained cell table showing applicable cells does not refuse an empty-set restart or abandon' () {
    const failing = baseState({ cells: [cell({ status: 'na', naReason: 'gone' })], agents: [] })
    const record = buildFailureRecord(failing, 'empty-applicable-set', {})
    const retained = { ...baseState({ cells: [cell({ status: 'inactive', certification: FP })], agents: [] }), status: 'failed', failure: record }
    assert.equal(exitTerminal(retained, { kind: 'restart', currentFingerprint: FP }, applicabilityFor(retained), record).exit, 'restarted')
    assert.equal(exitTerminal(retained, { kind: 'abandon' }, null, record).exit, 'terminated')
  },
  'explicit abandon is terminal with no derived transition' () {
    const s = failedState('round-cap', { round: 30 })
    assert.deepEqual(exitTerminal(s, { kind: 'abandon' }, null, s.failure), { exit: 'terminated', effects: {} })
  },
  'reviewable post-review mutation or drift returns the run to reviewing' () {
    const s = baseState({ status: 'post-review', stamp: FP, postReviewStep: 'dimension-retrospective', cells: [cell({ status: 'inactive', certification: FP })] })
    const r = exitTerminal(s, { kind: 'reviewable-change', nextFingerprint: FP2 }, null, null)
    assert.equal(r.exit, 'reviewing')
    assert.deepEqual(r.effects, { postReviewStep: 'not-started', postReviewWorkItemsCleared: true, completedMutationCleared: true, stamp: null, fingerprint: FP2 })
  },
  'finalization with step done and a matching recheck -> finalized (deletion controller-owned)' () {
    const s = baseState({ status: 'post-review', stamp: FP, postReviewStep: 'done', cells: [cell({ status: 'inactive', certification: FP })] })
    assert.deepEqual(exitTerminal(s, { kind: 'finalize', recheckMatched: true }, null, null), { exit: 'finalized', effects: {} })
  },
  'finalize with the post-review step not done is refused' () {
    const s = baseState({ status: 'post-review', stamp: FP, postReviewStep: 'hardening-stamp', cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => exitTerminal(s, { kind: 'finalize', recheckMatched: true }, null, null), 'off-domain', 'finalize-step')
  },
  'finalize with a failed fingerprint recheck is refused; the route is reviewable-change' () {
    const s = baseState({ status: 'post-review', stamp: FP, postReviewStep: 'done', cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => exitTerminal(s, { kind: 'finalize', recheckMatched: false }, null, null), 'invalid-input', 'finalize-recheck')
  },
  'finalize or reviewable-change with pending work or a non-none boundary is refused' () {
    for (const over of [{ pendingUserRequest: true }, { pendingControllerMutation: true }, { agreementBoundary: 'agreement' }]) {
      const s = baseState({ status: 'post-review', stamp: FP, postReviewStep: 'done', cells: [cell({ status: 'inactive', certification: FP })], ...over })
      assertRefusal(() => exitTerminal(s, { kind: 'finalize', recheckMatched: true }, null, null), 'off-domain', `finalize-${JSON.stringify(over)}`)
      assertRefusal(() => exitTerminal(s, { kind: 'reviewable-change', nextFingerprint: FP2 }, null, null), 'off-domain', `reviewable-${JSON.stringify(over)}`)
    }
  },
  'off-route dispositions are refused with no partial effects' () {
    const cap = failedState('round-cap', { round: 30, roundStatus: 'in-flight' })
    assertRefusal(() => exitTerminal(cap, { kind: 'retry', cellId: 'd1/whole', identityMatched: true }, null, cap.failure), 'off-route', 'retry-on-cap')
    const empty = failedState('empty-applicable-set', { cells: [cell({ status: 'na', naReason: 'gone' })], agents: [] })
    assertRefusal(() => exitTerminal(empty, { kind: 'retry', cellId: 'd1/whole', identityMatched: true }, null, empty.failure), 'off-route', 'retry-on-empty')
    const repair = failedState('repair-exhaustion', { roundStatus: 'in-flight' })
    assertRefusal(() => exitTerminal(repair, { kind: 'restart', currentFingerprint: FP }, applicabilityFor(repair), repair.failure), 'off-route', 'restart-on-repair')
  },
  'a missing, unparseable, or unknown-class failure record refuses every failed-state exit' () {
    const s = failedState('round-cap', { round: 30 })
    assertRefusal(() => exitTerminal({ ...s, failure: null }, { kind: 'abandon' }, null, null), 'invalid-input', 'record-missing')
    assertRefusal(() => exitTerminal(s, { kind: 'abandon' }, null, 'not json'), 'invalid-input', 'record-unparseable')
    assertRefusal(() => exitTerminal(s, { kind: 'abandon' }, null, JSON.stringify({ failingRule: 'novel-class' })), 'invalid-input', 'record-unknown-class')
    assertRefusal(() => exitTerminal(s, { kind: 'retry', cellId: 'd1/whole', identityMatched: true }, null, 'not json'), 'invalid-input', 'record-unparseable-retry')
    assertRefusal(() => exitTerminal(s, { kind: 'restart', currentFingerprint: FP }, applicabilityFor(s), null), 'invalid-input', 'record-missing-restart')
  },
  'a failure record contradicting the state where derivable is refused' () {
    const belowRound = failedState('round-cap', { round: 12 })
    assertRefusal(() => exitTerminal(belowRound, { kind: 'restart', currentFingerprint: FP }, applicabilityFor(belowRound), belowRound.failure), 'invalid-input', 'round-cap-below')
    const belowLaunches = failedState('verifier-cap', { verifierLaunches: 2 })
    assertRefusal(() => exitTerminal(belowLaunches, { kind: 'restart', currentFingerprint: FP }, applicabilityFor(belowLaunches), belowLaunches.failure), 'invalid-input', 'verifier-cap-below')
    const belowRepairs = failedState('repair-exhaustion', { roundStatus: 'in-flight', agents: [agentRow({ status: 'needs-retry', repairs: 1 })] })
    assertRefusal(() => exitTerminal(belowRepairs, { kind: 'retry', cellId: 'd1/whole', identityMatched: true }, null, belowRepairs.failure), 'invalid-input', 'repair-below-cap')
  },
  'a post-review disposition carrying a failure record, or any disposition on reviewing, is refused' () {
    const pr = baseState({ status: 'post-review', stamp: FP, postReviewStep: 'done', cells: [cell({ status: 'inactive', certification: FP })] })
    assertRefusal(() => exitTerminal(pr, { kind: 'finalize', recheckMatched: true }, null, buildFailureRecord(baseState(), 'round-cap', {})), 'invalid-input', 'post-review-with-record')
    const reviewing = baseState()
    assertRefusal(() => exitTerminal(reviewing, { kind: 'abandon' }, null, null), 'off-domain', 'exit-on-reviewing')
  },
  'applicability rides only the restart disposition' () {
    const cap = failedState('round-cap', { round: 30 })
    assertRefusal(() => exitTerminal(cap, { kind: 'abandon' }, applicabilityFor(cap), cap.failure), 'invalid-input', 'applicability-on-abandon')
    assertRefusal(() => exitTerminal(cap, { kind: 'restart', currentFingerprint: FP }, null, cap.failure), 'invalid-input', 'restart-without-applicability')
  },
  'no implicit or automatic resume exists from Status: failed' () {
    const s = failedState('round-cap', { round: 30 })
    assertRefusal(() => exitTerminal(s, { kind: 'reviewable-change', nextFingerprint: FP2 }, null, s.failure), 'off-domain', 'no-implicit-resume')
  },
```

- [ ] **Step 2: Run to verify failure**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: FAIL - `exitTerminal is not a function`.

- [ ] **Step 3: Implement**

```js
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
```

Export `exitTerminal`. This replaces the last `: undefined` placeholder, so also delete the now-obsolete `// filled by later tasks:` comment line from the `module.exports` block; no plan-scaffolding comment ships in the final module (task references in durable source are forbidden by the project's positional-identifier rule).

- [ ] **Step 4: Run to verify pass**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: all named cases pass, exit code 0.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/orchestration.js internal/revise/orchestration.test.js
git -C C:/Git/nightshift commit -m "feat(revise): add exitTerminal disposition routes"
```

---

### Task 8: Six prose pins with mutation probes

**Files:**
- Modify: `internal/revise/orchestration.test.js`

**Interfaces:**
- Consumes: `internal/revise/SKILL.md` (read at test time, relative to the test file: `join(__dirname, 'SKILL.md')`).
- Produces: one named case iterating the closed six-sentence pin set through a shared `assertPin` helper. For each sentence the case asserts the pin against the live file, then proves the assertion bites by asserting that `assertPin` throws on a mutant with the sentence reworded, the exact `assertDispatchContract`/`dispatchGuardMutant` technique `revise-round.test.js` ships.

- [ ] **Step 1: Add the failing pin cases**

Append to `tests`:

```js
  'prose pins: the six lifecycle sentences are pinned verbatim with mutation probes' () {
    const engine = readFileSync(join(__dirname, 'SKILL.md'), 'utf8')
    const pins = [
      ['limits sentence', 'The limits are 30 rounds per run (verifier rounds included), 10 verifier launches per run (a launch is the dispatch of one verifier round), and 3 execution-repair launches per stable reviewer, skeptic, or verifier cell.'],
      ['Launch verifier precondition', '`Launch verifier`: applies only at wave convergence with `Round status: evaluated` or `idle`.'],
      ['stamp conjunction', 'The run enters `post-review` only on the conjunction of wave convergence and a verifier stamp equal to the current fingerprint.'],
      ['repair safety rule 1', 'A cell cannot become inactive without a clean-review LGTM conclusion with a concrete nonblank verification rationale against the current fingerprint.'],
      ['never auto-resumes', '`Status: failed` never auto-resumes.'],
      ['cap asymmetry', 'A cap-forced end is terminal until explicit user disposition; it never produces completion.'],
    ]
    const assertPin = (source, label, sentence) => {
      assert.equal(source.includes(sentence), true, `pin must hold: ${label}`)
    }
    for (const [label, sentence] of pins) {
      assertPin(engine, label, sentence)
      const mutant = engine.replace(sentence, `REWORDED: ${label}`)
      assert.notEqual(mutant, engine, `mutation probe must alter the surface: ${label}`)
      assert.throws(() => assertPin(mutant, label, sentence), /pin must hold/, `mutation probe must bite: ${label}`)
    }
  },
```

- [ ] **Step 2: Run to verify the case passes against the live file (and the probe bites)**

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: PASS. This case is red only if a pin sentence is absent; the `assert.throws` probe proves the pin assertion itself fails on a reworded engine, so the pin genuinely bites rather than passing vacuously. If any pin fails, compare the sentence against the live `internal/revise/SKILL.md` (the pins above were copied from it at plan time; SKILL.md is the authority) and fix the pin string in the test, never the engine sentence.

- [ ] **Step 3: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/orchestration.test.js
git -C C:/Git/nightshift commit -m "test(revise): pin six lifecycle sentences with mutation probes"
```

---

### Task 9: The two engine convention sentences

**Files:**
- Modify: `internal/revise/SKILL.md`

**Interfaces:**
- Produces: two one-sentence additions the spec ships in this change set. No other SKILL.md edits.

- [ ] **Step 1: Add the failure-record persistence sentence**

In `internal/revise/SKILL.md`, locate the paragraph beginning `` `Start round` preflights the round cap `` (the cap-preflight paragraph, line 43 area). Append this sentence to the end of that paragraph, after `it never produces completion.` (skip if the sentence is already present from a resumed run):

```text
Whenever a failed transition or a not-ok cap preflight lands the run in `Status: failed`, write the module failure record's compact canonical JSON as the `Failure JSON` field's string content, so a later disposition parses the record back rather than inferring the class from state values.
```

- [ ] **Step 2: Add the deferred scope-map refresh sentence**

In `internal/revise/SKILL.md`, locate the paragraph beginning `For idle-state drift, no round conclusion exists to discard.` (the drift section). Append this sentence to the end of that paragraph (skip if the sentence is already present from a resumed run):

```text
The persisted scope map itself is rewritten only in the reconciling boundary's rewrite, never at detection, so a resume between detection and the reconciling boundary re-derives the same map change by comparing the persisted map against the freshly resolved current one.
```

- [ ] **Step 3: Verify the appends landed exactly once, pins still hold, bytes stay ASCII**

Verify each appended sentence appears exactly once. Both appends land inside single-line paragraphs, and `grep -c` counts matching lines (a duplicate inside one line still reads 1), so count occurrences, not lines:

```bash
grep -oF "write the module failure record's compact canonical JSON" C:/Git/nightshift/internal/revise/SKILL.md | wc -l
grep -oF "rewritten only in the reconciling boundary's rewrite" C:/Git/nightshift/internal/revise/SKILL.md | wc -l
```

Expected: `1` for each (`wc -l` prints 0 on zero matches, so no exit-status capture is needed here). A `0` means that append did not land: re-run the step. A `2` or more means a resumed run duplicated an append: remove the duplicate sentence before committing.

Run: `node C:/Git/nightshift/internal/revise/orchestration.test.js`
Expected: all cases pass (neither sentence edits a pinned sentence).
Run: `node C:/Git/nightshift/internal/revise/revise-round.test.js`
Expected: `revise-round.test: all 53 named cases passed` (the two additions touch no pinned or required-contract sentence).
Run: `st=0; n=$(LC_ALL=C.UTF-8 grep -cP '[^\x00-\x7F]' C:/Git/nightshift/internal/revise/SKILL.md) || st=$?; echo "$n $st"`
Expected: `0 1`.

- [ ] **Step 4: Commit**

```bash
git -C C:/Git/nightshift add internal/revise/SKILL.md
git -C C:/Git/nightshift commit -m "docs(revise): add failure-record and map-refresh conventions"
```

---

### Task 10: Suite-enumeration sites, topology list, count pin, version check

**Files:**
- Modify: `tests/universal-skill-topology.test.js`
- Modify: `AGENTS.md`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `skills/spec-agreement/spec-agreement.test.js`
- Modify (conditional): `.claude-plugin/plugin.json` (Step 6's version bump when the unpushed range carries none)

- [ ] **Step 1: Add both files to the topology relocated-engine-files list**

In `tests/universal-skill-topology.test.js`, the test `revise topology requires all relocated engine files as regular files` iterates a hardcoded array. Change:

```js
  for (const fileName of ['SKILL.md', 'code.md', 'plan.md', 'spec.md', 'rigor.js', 'rigor.test.js', 'revise-round.workflow.js', 'revise-round.test.js']) {
```

to:

```js
  for (const fileName of ['SKILL.md', 'code.md', 'plan.md', 'spec.md', 'rigor.js', 'rigor.test.js', 'revise-round.workflow.js', 'revise-round.test.js', 'orchestration.js', 'orchestration.test.js']) {
```

- [ ] **Step 2: Update AGENTS.md (bullet plus count sentence)**

All Task 9 and Task 10 inserts are guarded for resumed runs: before each insert or append, check whether the exact text is already present, skip the edit if it appears once, and de-duplicate first if it appears more than once (Task 10 commits only at its final step, so an interrupted run resumes over uncommitted edits).

In `AGENTS.md` under `## Development commands`, after the line `- Run the revise rigor derivation suite: `node internal/revise/rigor.test.js`.` insert (skip if already present once):

```markdown
- Run the revise orchestration suite: `node internal/revise/orchestration.test.js`.
```

and change the count sentence `- CI runs all six suites on Node 22.` to:

```markdown
- CI runs all seven suites on Node 22.
```

- [ ] **Step 3: Update README.md run-list**

In `README.md`, in the sentence listing the suites (`Run the agreement controller suite with ...`), after `the rigor derivation suite with `node internal/revise/rigor.test.js`,` insert `the orchestration suite with `node internal/revise/orchestration.test.js`,` so the sentence enumerates all seven.

- [ ] **Step 4: Add the CI step**

In `.github/workflows/ci.yml`, after the line `      - run: node internal/revise/rigor.test.js` insert (skip if already present once; de-duplicate if present twice):

```yaml
      - run: node internal/revise/orchestration.test.js
```

- [ ] **Step 5: Update the literal count pin**

In `skills/spec-agreement/spec-agreement.test.js`, the test `AGENTS describes the literal six-suite CI contract` asserts `countExact(agents, 'CI runs all six suites on Node 22.')`. Work through these branches in order:

1. **Duplicate guard**: `grep -c "node internal/revise/orchestration.test.js" C:/Git/nightshift/.github/workflows/ci.yml` must read exactly 1, and the AGENTS.md orchestration bullet must appear exactly once. A reading of 2 or more means a resumed run duplicated an insert: de-duplicate before recounting, and never attribute a duplicate to a competing suite.
2. **Recount** (the spec's landing-time rule): run `grep -c "      - run:" C:/Git/nightshift/.github/workflows/ci.yml` NOW, after Step 4 added this plan's own step, and use that number as-is (it already includes the new suite; do not add one).
3. **Reading 7**: the count word is `seven`.
4. **Reading 8 or more**: another suite landed first; the count word derived from the recount replaces `seven` in this step AND retroactively in the Step 2 AGENTS.md sentence and anywhere Step 3 worded a count.
5. **Reading 6 or fewer**: the Step 4 insertion did not land; stop, re-run Step 4, and recount before proceeding. Never write a count word from a reading below 7.
6. **Apply**: update the test name to `AGENTS describes the literal <count>-suite CI contract`, the asserted string to `'CI runs all <count> suites on Node 22.'` (spelled-out word, matching the AGENTS.md sentence exactly), and the assertion message to `'AGENTS must describe the <count>-suite CI contract'`.
7. **Pin-home mobility**: if the pin is not found in `skills/spec-agreement/spec-agreement.test.js`, the queued generic-assertions relocation quick win landed first; locate the pin's then-current home by grepping the repository for `CI runs all` and apply the same edits there, per the spec's whichever-lands-first rebase rule. The Step 6 version literals follow the same rule.

- [ ] **Step 6: Version-increase check**

This change set edits shipped plugin behavior (`internal/revise/` non-test resources and SKILL.md), so the unpushed range must contain exactly one monotonic `version` increase in `.claude-plugin/plugin.json`. Check the version value itself, not commit presence (a commit that touched only `description` is not a bump). Run both:

```bash
MSYS_NO_PATHCONV=1 git -C C:/Git/nightshift show origin/main:.claude-plugin/plugin.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))"
node -e "console.log(require('C:/Git/nightshift/.claude-plugin/plugin.json').version)"
```

(The `MSYS_NO_PATHCONV=1` prefix is load-bearing: without it, Git Bash's MSYS runtime rewrites the `origin/main:.claude-plugin/plugin.json` rev-spec into a Windows path list and git aborts.) Then take exactly one branch:

- **Failed read**: the first command errors or prints nothing. Stop and surface the failed read to the user; never treat a failed read as bump-already-exists.
- **Working-tree version greater** (numeric per-component semver comparison): the unpushed range already carries its bump; make none. Resume safety: still verify that both version-literal sites in the release test block equal the working-tree version (a prior interrupted run may have bumped the manifest without updating them); repair any stale literal now, staged with this task's commit.
- **Versions equal**: bump the patch component once and update both version-literal sites in the release test block of `skills/spec-agreement/spec-agreement.test.js` to match in the same commit: the test name (`test('plugin release version is X', ...)`) and the asserted literal (`assert.equal(manifest.version, 'X')`). Editing only one leaves either a red suite or a permanently stale test name.
- **Working-tree version smaller**: stop and surface the anomaly to the user; the local `origin/main` ref is ahead of the tree and the range read is unreliable.

This check reads the local `origin/main` ref without fetching (git networking stays user-directed); a stale ref makes the comparison conservative, never silently bump-skipping, because equality still forces a bump.

- [ ] **Step 7: Run the affected suites**

Run each; every one must pass:

```bash
node C:/Git/nightshift/internal/revise/orchestration.test.js
node --test C:/Git/nightshift/tests/universal-skill-topology.test.js
node C:/Git/nightshift/skills/spec-agreement/spec-agreement.test.js
```

If the Step 5 mobility rule fired (the count pin and version literals were edited at a relocated home instead of `skills/spec-agreement/spec-agreement.test.js`), also run that relocated suite here and substitute the relocated path everywhere this task names the agreement suite file, Step 8's staging list included; the edits must be exercised and committed at the file that actually holds them.

Expected: all pass, exit code 0 each. Then the ASCII check on the prose files touched:

```bash
st=0; n=$(LC_ALL=C.UTF-8 grep -cP '[^\x00-\x7F]' C:/Git/nightshift/AGENTS.md) || st=$?; echo "$n $st"
st=0; n=$(LC_ALL=C.UTF-8 grep -cP '[^\x00-\x7F]' C:/Git/nightshift/README.md) || st=$?; echo "$n $st"
```

Expected: `0 1` both. (AGENTS.md and README.md carry pre-existing non-ASCII only if earlier content had it; a nonzero count that `git diff` attributes to untouched lines is pre-existing debt, not this task's failure.)

- [ ] **Step 8: Commit**

```bash
git -C C:/Git/nightshift add tests/universal-skill-topology.test.js AGENTS.md README.md .github/workflows/ci.yml skills/spec-agreement/spec-agreement.test.js
git -C C:/Git/nightshift commit -m "chore(suite): enumerate the orchestration suite repo-wide"
```

(If Step 6 required a version bump, `git add .claude-plugin/plugin.json` joins this commit and the subject becomes `chore(release): bump version and enumerate orchestration suite`. If the Step 5 mobility rule fired, replace `skills/spec-agreement/spec-agreement.test.js` in the staging list with the relocated file that received the pin and version-literal edits.)

---

## Self-Review Notes

- Spec coverage: Tasks 1-7 implement the six-function surface, input contract, refusal codes, and every fixture list (input contract in Task 1; completion in Task 2; execution failure and preflight in Task 3; rejected findings in Task 4; verifier stamping in Task 5; boundary/sweep in Task 6; terminal exits in Task 7). The spec's run-level sequencing fixtures (Certification span's launched-zero-times case, Cross-cell mutation's preserve-until-the-sweep half, the mid-round-edit case) are encoded module-side in Task 6: repeat-boundary purity carries launched-zero-times (the controller launches only active cells, the stated convention), and the off-domain refusal on a mid-round state carries preserve-until-the-sweep and no-sweep-mid-round. Task 8 covers the closed six-sentence pin set. Task 9 ships the two engine conventions. Task 10 covers the topology list, all four enumeration sites, the count pin with the re-derive-at-landing-time rule, and the version-increase convention. Not covered by design (spec anti-goals): environment failure routes, post-review tail internals, new-run creation, mid-round skeptic fan-out, controller rewiring.
- The spec's resume-remap fixture entry is a controller-owned convention, not a module fixture (spec line: "recorded as a controller-owned convention"); the module-side half is the malformed-remap refusal (Task 6).
- Type consistency: `ledger` flags are `{acknowledgement, followUp, appliedChange}` in Tasks 4-5; state member spelling is fixed in the projection block above and used identically in every task; `failure` values are JSON text strings produced by `buildFailureRecord` and consumed by `parseFailureRecord` in Tasks 3, 6, 7.
