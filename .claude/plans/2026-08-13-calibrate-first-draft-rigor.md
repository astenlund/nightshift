# Calibrate First-Draft Rigor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every spec that enters the revise lifecycle carry an explicit rigor profile (the `Operating context` section), derived deterministically from its operating context, consulted with the user at the entry point, and propagated to reviewers — so validation/recovery/compatibility/observability/proof effort scales with consequences above a non-negotiable correctness floor.

**Architecture:** A bundled deterministic Node helper (`skills/revise/rigor.js`, mirroring the existing `ready.js` dual role of export-for-tests + CLI) owns the three-step derivation rule (audience→baseline tier, five one-level uplift predicates capped at `high`, tier→per-dimension effort). The two revise artifact profiles (`spec.md`, `plan.md`) each gain a grounding step that checks/derives the operating-context section before review and raises a shared `structural-precondition-error` for missing/skeletal sections (revise-plan per-upstream-spec, skip-with-note when none). The common-context block in `SKILL.md` gains the operating-context text so every reviewer calibrates against it. Handover's shift-start validation gains the entry-point consult. Judgment boundaries (audience component-to-category, uplift-predicate thresholds) stay prose-level recorded deviations, never invented as numeric scales.

**Tech Stack:** Node.js (22 is the CI floor; no dependencies, no framework), the existing fixture-test convention (`node:assert/strict`, exit code 1 on failure). All "code" is instruction prose executed by the agent plus one Node helper.

## Global Constraints

- This repo is a Claude Code/Codex plugin; shipped behavior is `commands/**`, `skills/**` except files ending in `.test.js`, `hooks/**`, and every `.claude-plugin/plugin.json` field other than `version`. Repository-only documentation, tests, CI config, and marketplace metadata do not independently require a version increase. Every unpushed batch that changes shipped behavior must include exactly **one** monotonic version increase in `.claude-plugin/plugin.json`.
- Edit the clone at `C:/Git/nightshift`, never an installed plugin cache.
- No em-dashes, en-dashes, emoticons, or emoji in any generated text (code, comments, docs, commit messages).
- Commit subjects follow Conventional Commits (`type(scope): subject`), max 72 chars, subject-only by default (no `Co-Authored-By` trailer).
- Keep commits atomic: one logical change per commit.
- Never run the full `dotnet` test suite (N/A here); the applicable suites are `node skills/ready/ready.test.js` and `node skills/revise/revise-round.test.js` (plus the new `node skills/revise/rigor.test.js`).
- In C# lines stay under 180 chars (N/A). In test files use Arrange/Act/Assert comments (N/A for Node fixtures; the existing suites use bare assert blocks).
- The operating-context section and the derivation rule's judgment boundaries are prose, not machine-parseable fields. The helper computes only the *deterministic* core: settled audience category → baseline tier, fired uplift count → capped tier, settled tier → per-dimension effort. Audience component-to-category mapping and uplift-predicate thresholds are author judgments recorded as deviation entries, never encoded as numbers in rigor.js.
- Correctness is never negotiable; "low rigor" never means relaxing correctness or omitting known requirements.
- Do not modify the external brainstorm skill; the revise lifecycle owns enforcement at the point spec work passes into review.

---

### Task 1: Create the deterministic derivation helper

**Files:**
- Create: `skills/revise/rigor.js`
- Test: `skills/revise/rigor.test.js`

**Interfaces:**
- Consumes: nothing (standalone pure module; no filesystem or process access in the exported functions).
- Produces (consumed by the grounding steps in Tasks 2–4 and by the CLI):
  - `AUDIENCE_BASELINE` — map of audience category → baseline tier (`'low' | 'medium' | 'high'`)
  - `TIER_CAP` — `'high'`
  - `UPLIFTS` — array of five keys: `'deployment_criticality'`, `'failure_consequence'`, `'concurrency_compatibility'`, `'reversibility_recovery'`, `'expected_lifetime'`
  - `baselineTier(audienceCategory)` → tier string; throws for a category not in `AUDIENCE_BASELINE`
  - `upliftedTier(baselineTier, firedUpliftCount)` → tier capped at `TIER_CAP`; fires one level per positive count, throws on negative count
  - `dimensionEffort(tier)` → object with exactly five keys `validation, recovery, compatibility, observability, proofEffort` each `'low' | 'medium' | 'high'`, per Step 3's fixed mapping; throws on an unknown tier
  - `derive({ audienceCategory, firedUplifts })` → `{ tier, effort }`; one call combining the three steps; throws if `audienceCategory` unknown or `firedUplifts` is not a non-negative integer. `firedUplifts` (the derive object key) and `firedUpliftCount` (the upliftedTier parameter and CLI argument) are the same scalar, the number of fired uplifts; derive forwards its key value into upliftedTier's parameter under that name.
  - CLI: `node skills/revise/rigor.js <audienceCategory> <firedUpliftCount>` prints one JSON line `{"tier": "...", "effort": {...}}` on stdout, exit 0; prints a usage line to stderr and exit 1 on bad input.

- [ ] **Step 1: Write the failing test**

Create `skills/revise/rigor.test.js`:

```js
#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const rigor = require('./rigor.js')

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log(`ok - ${name}`)
  } catch (err) {
    failures += 1
    console.error(`not ok - ${name}\n  ${err.message}`)
  }
}

check('baselineTier maps every audience category', () => {
  assert.equal(rigor.baselineTier('personal use'), 'low')
  assert.equal(rigor.baselineTier('trusted circle'), 'low')
  assert.equal(rigor.baselineTier('paying customers'), 'medium')
  assert.equal(rigor.baselineTier('organization'), 'high')
  assert.equal(rigor.baselineTier('public'), 'high')
})

check('baselineTier rejects an unknown category', () => {
  assert.throws(() => rigor.baselineTier('aliens'), /unknown audience category/)
})

check('upliftedTier caps at high and never drops below baseline', () => {
  assert.equal(rigor.upliftedTier('low', 0), 'low')
  assert.equal(rigor.upliftedTier('low', 1), 'medium')
  assert.equal(rigor.upliftedTier('low', 2), 'high')
  assert.equal(rigor.upliftedTier('low', 5), 'high')
  assert.equal(rigor.upliftedTier('medium', 1), 'high')
  assert.equal(rigor.upliftedTier('high', 1), 'high')
})

check('upliftedTier rejects a negative count', () => {
  assert.throws(() => rigor.upliftedTier('low', -1), /negative/)
})

check('dimensionEffort enumerates exactly the five scaling dimensions', () => {
  const low = rigor.dimensionEffort('low')
  assert.deepEqual(Object.keys(low).sort(), [
    'compatibility', 'observability', 'proofEffort', 'recovery', 'validation',
  ])
  assert.equal(low.validation, 'low')
  assert.equal(low.proofEffort, 'low')
})

check('dimensionEffort maps medium and high per the fixed rule', () => {
  const medium = rigor.dimensionEffort('medium')
  const high = rigor.dimensionEffort('high')
  assert.equal(medium.validation, 'medium')
  assert.equal(high.validation, 'high')
  assert.equal(high.recovery, 'high')
  assert.equal(high.compatibility, 'high')
  assert.equal(high.observability, 'high')
  assert.equal(high.proofEffort, 'high')
})

check('dimensionEffort rejects an unknown tier', () => {
  assert.throws(() => rigor.dimensionEffort('ultra'), /unknown tier/)
})

check('derive combines the three steps and caps at high', () => {
  const personalUseful = rigor.derive({ audienceCategory: 'personal use', firedUplifts: 0 })
  assert.equal(personalUseful.tier, 'low')
  assert.equal(personalUseful.effort.validation, 'low')

  const publicCritical = rigor.derive({ audienceCategory: 'public', firedUplifts: 5 })
  assert.equal(publicCritical.tier, 'high')
  assert.equal(publicCritical.effort.proofEffort, 'high')
})

check('derive rejects invalid inputs', () => {
  assert.throws(() => rigor.derive({ audienceCategory: 'nope', firedUplifts: 0 }), /unknown audience category/)
  assert.throws(() => rigor.derive({ audienceCategory: 'public', firedUplifts: -2 }), /negative/)
  assert.throws(() => rigor.derive({ audienceCategory: 'public', firedUplifts: 1.5 }), /non-integer/)
})

if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node skills/revise/rigor.test.js`
Expected: `FAIL` — the module load throws before any `check` runs (the top-level `require('./rigor.js')` at the top of the file is evaluated during load, `rigor.js` does not exist yet, so Node emits an uncaught `MODULE_NOT_FOUND` stack trace to stderr and exits 1). No `ok -` or `not ok -` line is printed. Capture the exit code 1; the precise expected output is the module-not-found stack trace, not check-by-check failure lines.

- [ ] **Step 3: Write the minimal implementation**

Create `skills/revise/rigor.js`:

```js
#!/usr/bin/env node
'use strict'

// Deterministic derivation core behind the rigor profile (the "Operating
// context" section) for revise-spec and revise-plan. Implements the three
// firm steps of the calibrate-first-draft-rigor feature:
//
//   Step 1: audience category -> baseline tier (AUDIENCE_BASELINE)
//   Step 2: fired uplift count -> tier uplift, capped at TIER_CAP
//   Step 3: settled tier -> per-dimension effort on the five scaling
//           dimensions (DIMENSION_EFFORT)
//
// Only the deterministic machinery lives here. Judgment boundaries are
// deliberately NOT encoded as numbers: mapping the four audience components
// to a category, and deciding whether each uplift predicate fired, are
// author judgments recorded as deviation entries in the spec prose. This
// module takes those settled values as input and derives what follows
// mechanically.
//
// Usage: node rigor.js <audienceCategory> <firedUpliftCount>

const AUDIENCE_BASELINE = Object.freeze({
  'personal use': 'low',
  'trusted circle': 'low',
  'paying customers': 'medium',
  'organization': 'high',
  'public': 'high',
})

const TIER_CAP = 'high'

const UPLIFTS = Object.freeze([
  'deployment_criticality',
  'failure_consequence',
  'concurrency_compatibility',
  'reversibility_recovery',
  'expected_lifetime',
])

const DIMENSION_EFFORT = Object.freeze({
  low: {
    validation: 'low',
    recovery: 'low',
    compatibility: 'low',
    observability: 'low',
    proofEffort: 'low',
  },
  medium: {
    validation: 'medium',
    recovery: 'medium',
    compatibility: 'medium',
    observability: 'medium',
    proofEffort: 'medium',
  },
  high: {
    validation: 'high',
    recovery: 'high',
    compatibility: 'high',
    observability: 'high',
    proofEffort: 'high',
  },
})

function baselineTier(audienceCategory) {
  const tier = AUDIENCE_BASELINE[audienceCategory]
  if (tier === undefined) {
    throw new Error(`unknown audience category: ${audienceCategory}`)
  }
  return tier
}

function upliftedTier(baseline, firedUpliftCount) {
  if (!Number.isInteger(firedUpliftCount) || firedUpliftCount < 0) {
    throw new Error(`negative or non-integer uplift count: ${firedUpliftCount}`)
  }
  const ordinal = { low: 0, medium: 1, high: 2 }
  const clamped = Math.min(ordinal[baseline] + firedUpliftCount, ordinal[TIER_CAP])
  return Object.keys(ordinal).find((tier) => ordinal[tier] === clamped)
}

function dimensionEffort(tier) {
  const effort = DIMENSION_EFFORT[tier]
  if (effort === undefined) {
    throw new Error(`unknown tier: ${tier}`)
  }
  return effort
}

function derive({ audienceCategory, firedUplifts }) {
  const tier = upliftedTier(baselineTier(audienceCategory), firedUplifts)
  return { tier, effort: dimensionEffort(tier) }
}

module.exports = {
  AUDIENCE_BASELINE,
  TIER_CAP,
  UPLIFTS,
  baselineTier,
  upliftedTier,
  dimensionEffort,
  derive,
}

if (require.main === module) {
  const usage =
    'Usage: node rigor.js <audienceCategory> <firedUpliftCount>\n' +
    '  audienceCategory: one of ' + Object.keys(AUDIENCE_BASELINE).join(' | ') + '\n' +
    '  firedUpliftCount: non-negative integer (0-5)'
  const [, , audienceCategory, firedUpliftsRaw] = process.argv
  if (audienceCategory === undefined || firedUpliftsRaw === undefined) {
    process.stderr.write(usage + '\n')
    process.exit(1)
  }
  try {
    const firedUplifts = Number(firedUpliftsRaw)
    const result = derive({ audienceCategory, firedUplifts })
    process.stdout.write(JSON.stringify(result) + '\n')
  } catch (err) {
    process.stderr.write(usage + '\n' + err.message + '\n')
    process.exit(1)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node skills/revise/rigor.test.js`
Expected: `ok - ...` for all 9 checks, then `all checks passed`, exit 0.

- [ ] **Step 5: Exercise the CLI once**

Run: `node skills/revise/rigor.js "public" 5`
Expected stdout: `{"tier":"high","effort":{"validation":"high","recovery":"high","compatibility":"high","observability":"high","proofEffort":"high"}}`, exit 0.
Run: `node skills/revise/rigor.js "aliens" 0`
Expected: usage line + error to stderr, exit 1.

- [ ] **Step 6: Commit**

```bash
git add skills/revise/rigor.js skills/revise/rigor.test.js
git commit -m "feat(revise): add deterministic rigor derivation helper"
```

---

### Task 2: Grounding step for revise-spec

**Files:**
- Modify: `skills/revise/spec.md`
- Test: none required here (the grounding step is instruction prose; its deterministic core is exclusively the `rigor.js` logic already fixture-tested in Task 1, and the step itself adds no mechanically-checkable behavior).

**Interfaces:**
- Consumes: `rigor.js` (`baselineTier`, `upliftedTier`, `dimensionEffort`, `derive`), the canonical fingerprint recipe.
- Produces: a `## Grounding step` section in `spec.md` that the controller executes before any reviewer or skeptic launches.

- [ ] **Step 1: Add the grounding-step section to spec.md**

Insert a new `## Grounding step` section directly after the `## Setup` section (before `## Review parameters`). Use the Edit tool with this exact block:

```markdown
## Grounding step

The operating-context section must exist and be complete before any reviewer or skeptic launches. The controller runs this step at the start of the review run, at the entry point where the user is still present (shift start). It never defaults-substitutes and never fails closed silently: a missing or incomplete section is filled by asking the user.

1. **Check.** Look for an `Operating context` section in the spec body. Absent means no such section at all. Skeletal means the section exists but (a) omits any of the six operating-context inputs (deployment environment and operational criticality; audience; failure consequence and data or security sensitivity; concurrency and compatibility risk; reversibility and recovery cost; expected feature lifetime), or (b) records inputs without applying the derivation rule in `skills/revise/rigor.js` to yield a tier and per-dimension effort, or (c) states a tier that does not follow from the inputs under that rule. Whether prose "omits an input" is a semantic judgment; when not mechanically decidable, record the detection call and its basis as a deviation entry, exactly as the derivation rule's Step 2 boundaries are recorded.
2. **Derive.** When absent or skeletal, derive the section from durable project knowledge first (repository guidance, architecture documents, established project conventions). Consult the user only when durable knowledge runs short; this consult is an entry-point action performed at shift start while the user is still present, before any unattended continuation. Apply the audience component-to-category judgment, the uplift-predicate judgments, and the derivation rule via `node skills/revise/rigor.js <audienceCategory> <firedUpliftCount>`; record every judgment boundary as a deviation entry with its basis.
3. **Persist.** When the consult answered a question durable knowledge left unanswered (a gap, not a default deviation), persist the gathered operating-context facts to the project-local instruction file the host reads: `CLAUDE.md` under Claude Code, `AGENTS.md` under Codex. Write to the file that actually holds durable content, not to a pointer file (a `CLAUDE.md` whose body is only `@AGENTS.md` points at the referent). A deviation from a documented default is never persisted; it stays in the spec. If creation is refused or the project tracks no durable instruction prose, keep the facts in the spec's own derivation notes.
4. **Recalculate the fingerprint** after adding or filling the section, so every reviewer in the run calibrates against a complete profile.
5. **Report absence as the shared error.** When the section remains absent or skeletal after the step (impossible here, since the user is present and fills it, but kept for the revise-plan side's symmetry), raise `structural-precondition-error` with its three fields: artifact path, reason (absent or skeletal with the specific missing input or rule violation), and remediation direction.
```

- [ ] **Step 2: Verify the section is present**

Run: `grep -n "## Grounding step" skills/revise/spec.md`
Expected: a line matched directly after `## Setup`.

- [ ] **Step 3: Commit**

```bash
git add skills/revise/spec.md
git commit -m "feat(revise): add spec grounding step for operating context"
```

---

### Task 3: Grounding step for revise-plan

**Files:**
- Modify: `skills/revise/plan.md`
- Test: the deterministic core is covered by Task 1's fixtures; the plan-side per-upstream-spec logic is instruction prose.

**Interfaces:**
- Consumes: `rigor.js` (for verifying a derived tier if the caller re-derives), the canonical fingerprint recipe.
- Produces: a `## Grounding step` section in `plan.md` for the plan entry point.

- [ ] **Step 1: Add the grounding-step section to plan.md**

Insert a new `## Grounding step` section directly after the `## Setup` section (before `## Review parameters`), using the Edit tool with this exact block:

```markdown
## Grounding step

The plan carries no operating-context section of its own; its calibration source is the upstream spec(s) it references. The controller runs this step at the start of the review run, before any reviewer or skeptic launches.

1. **Enumerate the upstream specs.** A plan may reference one or more upstream specs, or none at all.
2. **Per-spec check.** For each referenced upstream spec, look for a complete `Operating context` section (absent vs skeletal per the fixed definitions in `spec.md`'s grounding step). Verify the tier stated there follows from the inputs under the derivation rule in `skills/revise/rigor.js`.
3. **Raise on incomplete.** For any upstream spec whose section is absent or skeletal, raise `structural-precondition-error` with its three fields (artifacts paths: the plan and the failing upstream spec; reason: absent or skeletal with the specific missing input or rule violation; remediation: harden that upstream spec first, then re-run). Do not invent a plan-local copy and do not proceed with an incomplete calibration baseline.
4. **Skip when none.** When the plan has no upstream spec, skip with a one-line note (matching the Spec Reconciliation step's spec-less skip) and proceed without an operating-context baseline.
5. **Propagate all sections.** Copy each upstream spec's complete operating-context section unchanged into the common-context block for planners and reviewers, so they calibrate against the actual declared baseline. When two referenced upstream specs declare different rigor tiers, that divergence is itself a finding reviewers surface, directing the upstream specs' owners to reconcile before the plan's rigor is trusted.
```

- [ ] **Step 2: Verify the section is present**

Run: `grep -n "## Grounding step" skills/revise/plan.md`
Expected: a line matched directly after `## Setup`.

- [ ] **Step 3: Commit**

```bash
git add skills/revise/plan.md
git commit -m "feat(revise): add plan grounding step for operating context"
```

---

### Task 4: Propagate the operating-context section in the common-context block

**Files:**
- Modify: `skills/revise/SKILL.md`
- Test: none (instruction prose).

**Interfaces:**
- Consumes: the operating-context sections produced by Tasks 2–3.
- Produces: a common-context payload line telling reviewers to calibrate against the section and flag tier/mechanism mismatches in both directions.

- [ ] **Step 1: Extend the common context assembly**

Find the `## Dispatch and repair` "Common context" paragraph in `skills/revise/SKILL.md` (line 270). It currently has **two sentences**: the first begins "Common context contains project context, ... and profile additional rules.", and the second is "Tell reviewers to verify ambiguous instructions against the working tree, consult linked pattern files only when the index signals relevance, report high-confidence issues only, and provide a concrete verification note even for LGTM." Replace ONLY the first sentence with the block below, and leave the second sentence unchanged and in place. Do not drop or rewrite the second sentence: it is load-bearing reviewer behavior this feature does not modify.

```markdown
Common context contains project context, relevant inlined project-instruction excerpts, the PATTERNS index when present, artifact identity and delivery, acknowledgements and caveats, profile additional rules, and the operating-context section (the rigor profile) unchanged from the artifact under review (the spec body for revise-spec; each referenced upstream spec for revise-plan, including any declared tier divergence as a flag). Reviewers calibrate findings against the declared rigor tier as a grounding input, not a review outcome: a declared `high` tier over minimal validation/recovery/compatibility/observability machinery, or a declared `low` tier over heavy machinery the profile does not warrant, is expected to be flagged as a finding in the design-soundness or requirements dimension, directing the author to conform the mechanism to the warranted rigor. That calibration channel is how the profile acts as an active design input; whether fresh reviewers reliably surface either mismatch is a runtime-owned behavior, not settled by repository prose.
```

- [ ] **Step 2: Verify the change**

Run: `grep -n "operating-context section (the rigor profile)" skills/revise/SKILL.md`
Expected: matched within the Common context paragraph.

- [ ] **Step 3: Commit**

```bash
git add skills/revise/SKILL.md
git commit -m "feat(revise): propagate operating-context into reviewer payloads"
```

---

### Task 5: Add the entry-point consult to handover shift-start

**Files:**
- Modify: `commands/handover.md`
- Test: none (instruction prose).

**Interfaces:**
- Consumes: the grounding steps in Tasks 2–3; the stage-detection and validation flow already in handover.
- Produces: a shift-start validation instruction that consults the user for an absent/skeletal operating-context section before the ladder proceeds.

- [ ] **Step 1: Extend the shift-start validation paragraph**

Find the "Validate before proceeding" paragraph near the top of the `## Shift-start: stage detection` section (the one that dispatches a fresh agent to validate the governing spec/plan and flags surviving `(live-claim: ...)` markers). Append these two sentences to the end of that paragraph:

```markdown
The validation agent also checks the governing spec for a complete `Operating context` section (absent vs skeletal per the revise-spec grounding step) and reports an absent or skeletal section as a flag. That flag downgrades a clean detection to confirm-first, and is resolved by the entry-point consult: the user, present at shift start, fills or approves the section before any unattended continuation proceeds (the spec's grounding step derives it, consulting this same user).
```

- [ ] **Step 2: Verify the change**

Run: `grep -n "entry-point consult" commands/handover.md`
Expected: matched within the validation paragraph.

- [ ] **Step 3: Commit**

```bash
git add commands/handover.md
git commit -m "feat(handover): consult user for operating context at shift start"
```

---

### Task 6: Wire the rigor test suite into CI and bump the plugin version

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: `skills/revise/rigor.test.js` from Task 1.
- Produces: CI coverage for the new suite; the one monotonic version increase for this batch.

- [ ] **Step 1: Add the rigor test to CI**

Find the two `- run: node ...` lines in `.github/workflows/ci.yml` and add a third after the revise-round test:

```yaml
      - run: node skills/revise/rigor.test.js
```

- [ ] **Step 2: Verify the CI edit**

Run: `grep -n "rigor.test" .github/workflows/ci.yml`
Expected: one matched line after the `revise-round.test.js` line.

- [ ] **Step 3: Bump the plugin version**

In `.claude-plugin/plugin.json`, change `"version": "2.0.28"` to `"version": "2.0.29"`. Verify with `grep -n '"version"' .claude-plugin/plugin.json`.

- [ ] **Step 4: Run all three suites**

Run: `node skills/ready/ready.test.js && node skills/revise/revise-round.test.js && node skills/revise/rigor.test.js`
Expected: all three exit 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml .claude-plugin/plugin.json
git commit -m "chore(release): wire rigor tests into CI, bump version"
```

---

### Task 7: Update the feature status and sync the index

**Files:**
- Modify: `.claude/features/calibrate-first-draft-rigor.md`
- Modify: `.claude/FEATURES.md` (walk-and-remove the `Requires:` line when the feature's index entry moves to history)
- Modify: `.claude/FEATURES_HISTORY.md` (append the shipped entry in Step 2)

**Interfaces:**
- Consumes: the completed implementation.
- Produces: shipped-state recording and the history-archive move per the walk-and-remove convention.

- [ ] **Step 1: Mark the feature shipped in its Status**

In `.claude/features/calibrate-first-draft-rigor.md`, replace the `## Status` section's final sentence ("Not yet designed as a buildable change; to be re-hardened by this revise-spec re-review before planning.") with:

```markdown
Shipped on 2026-08-13: deterministic derivation helper, revise-spec and revise-plan grounding steps, common-context propagation, and the shift-start entry-point consult all landed.
```

- [ ] **Step 2: Move the FEATURES.md index entry to history**

Append the feature entry to `.claude/FEATURES_HISTORY.md` (title, one-line shipped note with the date), remove the entry from `.claude/FEATURES.md`, and walk every other `**Requires:**` line in `FEATURES.md`/`BUGS.md` to drop references to this feature (this feature's `Requires: none.` means no downstream lines reference it; the walk is a verify-then-note step). Then run:

```bash
node skills/ready/ready.js
```

Expected: `structuralErrors: 0`; the calibrate feature no longer appears in the `ready` list.

- [ ] **Step 3: Commit**

```bash
git add .claude/features/calibrate-first-draft-rigor.md .claude/FEATURES.md .claude/FEATURES_HISTORY.md
git commit -m "docs(feature): mark calibrate-first-draft-rigor shipped"
```

---

### Task 8: Verify the success criteria end-to-end

This task runs the feature's own success criteria against the implementation, using a scratch spec in the temporary directory.

**Files:**
- Use: `C:/Users/asten/.claude/jobs/d3883b5f/tmp/` for scratch (never `/tmp`).
- No repo files modified.

- [ ] **Step 1: Run the suites once more**

Run: `node skills/ready/ready.test.js && node skills/revise/revise-round.test.js && node skills/revise/rigor.test.js`
Expected: all three exit 0.

- [ ] **Step 2: Verify revise-spec derives a missing section**

Create a scratch spec `C:/Users/asten/.claude/jobs/d3883b5f/tmp/rigor-scratch-spec.md` with a `Feature:` first line and `## What it does` but **no** `Operating context` section. Invoke the revise-spec entry point scoped to that file (per the command's normal invocation) and confirm, in the controller's report, that the grounding step derived an `Operating context` section (consulting the user at the interactive entry point) and recalculated the fingerprint before any reviewer launched.

- [ ] **Step 3: Verify revise-plan skips-with-note for a spec-less plan**

Create a scratch plan `C:/Users/asten/.claude/jobs/d3883b5f/tmp/rigor-scratch-plan.md` with no upstream spec reference. Invoke the revise-plan entry point scoped to it and confirm the grounding step recorded a one-line skip note and proceeded without an operating-context baseline.

- [ ] **Step 4: Clean up scratch**

Remove `C:/Users/asten/.claude/jobs/d3883b5f/tmp/rigor-scratch-spec.md` and `C:/Users/asten/.claude/jobs/d3883b5f/tmp/rigor-scratch-plan.md`.

- [ ] **Step 5: No commit** (verification only).

---

## Self-Review

**Spec coverage:**
- Operating-context section shape and placement → Task 2 (grounding step checks/derives the prose section in the spec body).
- Six operating-context inputs → Task 2 Step 1 check (a).
- Audience classification with closest-match deviation → Task 2 Step 2 (judgment recorded as deviation; no numeric scale).
- Three-step derivation rule → Task 1 (`rigor.js`) + Task 2 Step 2 (invokes the helper; judgment boundaries recorded as deviations).
- Knowledge-first derivation with gap-not-deviation persistence → Task 2 Steps 2–3.
- Enforcement (both entry points, structural-precondition-error, skip-with-note) → Tasks 2–3.
- Entry-point consult at shift start, no defaults/fail-closed → Tasks 2, 5.
- Propagation as review calibration, both directions, `(live-claim: provisional)` handled → Task 4 + Task 5; the existing spec already carries the provisional marker, and handover's existing live-claim handling covers probing.
- Plan-side per-upstream-spec grounding with divergent-tier finding → Task 3.
- Host-selected instruction-file creation + pointer handling → Task 2 Step 3.
- Success criteria → Task 8.
- Same-file contention: the four `SKILL.md` editors are recorded in the spec; this plan touches `SKILL.md` (Task 4) and should land mechanically per the recorded cheap order. `content-fingerprint-helper` and `revise-lifecycle-rounds` are not prerequisites.

**Placeholder scan:** no TBD/TODO/later; every code and prose block is inline verbatim. The one judgment call — the fidelity of `dimensionEffort`'s medium tier — matches the spec's "medium adds targeted validation for the named risks" faithfully (simple uniform `medium` for the five dimensions is the spec's stated fixed mapping; the prose distinguishes the *content* of effort, not the ordinal).

**Type consistency:** `derive({ audienceCategory, firedUplifts })` is used consistently in Task 1 (tests + CLI) and Task 2 Step 2's invocation; `firedUplifts` (derive's object key) and `firedUpliftCount` (upliftedTier's parameter and the CLI/usage text) denote the same scalar and the Interfaces block states that equivalence explicitly. `baselineTier`/`upliftedTier`/`dimensionEffort` names match across Task 1 test and implementation. The `structural-precondition-error` name is identical in Tasks 2–3. `skill/revise/rigor.js` path is consistent (Tasks 1–3). Audience category strings (`personal use`, etc.) match the canonical labels used in the spec and the reconciled consumer.

## Hardening

- revise-plan graduated 2026-08-13 02:40 at 6f446e4, scope: whole file, content: ecde4034