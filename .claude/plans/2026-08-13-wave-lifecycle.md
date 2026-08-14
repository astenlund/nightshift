# Wave-Convergence Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the revise engine's phase lifecycle with the wave-convergence lifecycle plus holistic verifier gate, per the settled design.

**Architecture:** All lifecycle authority lives in `skills/revise/SKILL.md` prose; the phase model is removed there and replaced with staleness-driven reactivation waves and a verifier round, the state schema loses its phase fields and gains per-cell certifications plus verifier counters, and the workflow contract drops its now-redundant `phase` input (rounds are run-monotonic without phase resets). Parameter files, README, repository AGENTS.md, and dependent feature records are synced in the same batch.

**Tech Stack:** Markdown instruction prose; Node 22 (no framework) for `revise-round.workflow.js` and the three test suites.

**Spec:** `.claude/features/wave-lifecycle.md` (authoritative design record; argue every judgment call from it).

## Global Constraints

- Plain ASCII in all newly written text: no em-dashes, en-dashes, emoticons, or emoji anywhere, including prose files.
- Every file ends with a trailing newline.
- Commit subjects: Conventional Commits `type(scope): subject`, max 72 chars, subject-only commits, no trailers.
- Exactly one version increase for this whole batch: `2.1.0` to `2.2.0`, applied in Task 9 only.
- Edit the clone `C:/Git/nightshift`, never an installed plugin cache.
- Preserve the checkpoint serialization conventions untouched: JSON-string scalars on `... JSON` fields, lowercase UTF-8 hex in tables, raw `none` sentinels, atomic `.next.md` rename staging.
- In Bash tool calls use forward slashes and full paths, never `cd`.
- If any Edit reports a non-unique anchor, widen the quoted old string with the immediately preceding sentence from the live file; never proceed with a replace_all on a lifecycle edit.
- Terminology in all new prose: "cell" for a dimension or shard cell; "staleness sweep" for the all-inactive comparison of certifications against the current fingerprint; "wave convergence" for every applicable cell certifying the current fingerprint; "verifier round" for the round whose single cell is `verifier/whole-artifact`.

---

### Task 1: Drop the `phase` input from the workflow contract

**Files:**
- Modify: `skills/revise/revise-round.workflow.js`
- Modify: `skills/revise/revise-round.test.js`

**Interfaces:**
- Produces: workflow input contract `{ round, fingerprint, dimensions, model }` (no `phase`); result object echoes `round` and `fingerprint` only. Task 4 rewrites the SKILL.md invocation example to match.

- [ ] **Step 1: Update the two identity tests to expect no phase field**

In `skills/revise/revise-round.test.js`, replace the test list entries (near line 42):

```javascript
  'phase and round identity are echoed unchanged',
  'a nonpositive or noninteger phase or round is rejected before launch',
```

with:

```javascript
  'round identity is echoed unchanged',
  'a nonpositive or noninteger round is rejected before launch',
```

Replace the test implementation (near line 607):

```javascript
  async 'phase and round identity are echoed unchanged'() {
    const input = { ...argsFor(), phase: 3, round: 7 }
```

with:

```javascript
  async 'round identity is echoed unchanged'() {
    const input = { ...argsFor(), round: 7 }
```

In that test body, delete the assertion line `assert.equal(result.phase, 3)` and keep the round assertion. Replace the rejection test (near line 614):

```javascript
  async 'a nonpositive or noninteger phase or round is rejected before launch'() {
    for (const invalid of [{ ...argsFor(), phase: 0 }, { ...argsFor(), round: -1 }, { ...argsFor(), phase: 1.5 }, { ...argsFor(), round: '5' }]) {
```

with:

```javascript
  async 'a nonpositive or noninteger round is rejected before launch'() {
    for (const invalid of [{ ...argsFor(), round: 0 }, { ...argsFor(), round: -1 }, { ...argsFor(), round: 1.5 }, { ...argsFor(), round: '5' }]) {
```

In the shared `argsFor()` fixture (near line 60), delete the line `phase: 2,`.

- [ ] **Step 2: Run the suite to verify it fails**

Run: `node C:/Git/nightshift/skills/revise/revise-round.test.js`
Expected: FAIL (the script still rejects inputs without `phase`, and still echoes `phase`).

- [ ] **Step 3: Remove `phase` from the workflow script**

In `skills/revise/revise-round.workflow.js`, replace (near line 80):

```javascript
  if (!Number.isInteger(input.phase) || input.phase <= 0 || !Number.isInteger(input.round) || input.round <= 0 || typeof input.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(input.fingerprint)) {
    throw new TypeError('revise-round: phase, round, or fingerprint is invalid')
```

with:

```javascript
  if (!Number.isInteger(input.round) || input.round <= 0 || typeof input.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(input.fingerprint)) {
    throw new TypeError('revise-round: round or fingerprint is invalid')
```

Replace the destructuring (near line 212): `const { phase, round, fingerprint, model } = input` with `const { round, fingerprint, model } = input`. In the returned result object (near line 273), delete the `phase,` line. Do NOT touch `phases:` in the meta block or any `phase: 'Review'` / `phase: 'Verify'` agent option or test filter; those are Workflow display groups, not lifecycle fields.

The prompt generalization is a separate logical change committed in Steps 6 to 8 below; this step and this commit carry only the phase-contract removal.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node C:/Git/nightshift/skills/revise/revise-round.test.js`
Expected: `revise-round.test: all 47 named cases passed` (same count as before; no test was added or removed).

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add skills/revise/revise-round.workflow.js skills/revise/revise-round.test.js
git -C C:/Git/nightshift commit -m "feat(revise): drop phase from workflow identity contract"
```

- [ ] **Step 6: Generalize the agent prompts to cell framing**

Generalize both agent prompts so a verifier round is not misframed as a dimension review. The payload sentence `It contains the common context and only the criteria assigned to this dimension cell.` occurs exactly twice, byte-identically, in `reviewerPrompt` (near line 110) and `skepticPrompt` (near line 123): replace both occurrences with `It contains the common context and only the criteria assigned to this cell.` (a replace-all on that exact string is correct here). In `reviewerPrompt` only, replace `'You are a fresh code/document reviewer with no prior context, reviewing one dimension cell only.',` with `'You are a fresh code/document reviewer with no prior context, reviewing one review cell only.',` and `Your stable dimension cell ID is '${dimension.id}'.` with `Your stable cell ID is '${dimension.id}'.`. In `skepticPrompt` only, replace `The finding was raised in dimension cell '${dimension.id}' (${dimension.name}).` with `The finding was raised in cell '${dimension.id}' (${dimension.name}).`. Deliberately untouched (display metadata, never agent-facing framing): the `meta` block's `description`/`phases`, the `phase: 'Review'` / `phase: 'Verify'` display groups, and the `dimensions` input field name itself.

- [ ] **Step 7: Run the suite**

Run: `node C:/Git/nightshift/skills/revise/revise-round.test.js`
Expected: `revise-round.test: all 47 named cases passed`. If a prompt-string assertion fails, update that assertion's expected text to the new wording in this same step and rerun.

- [ ] **Step 8: Commit the prompt generalization**

```bash
git -C C:/Git/nightshift add skills/revise/revise-round.workflow.js skills/revise/revise-round.test.js
git -C C:/Git/nightshift commit -m "feat(revise): generalize agent prompts to cell framing"
```

---

### Task 2: Replace the SKILL.md lifecycle and limits sections

**Files:**
- Modify: `skills/revise/SKILL.md` (sections `## Review lifecycle` and `### Limits and enum values`)

**Interfaces:**
- Produces: the terms "staleness sweep", "wave convergence", "verifier round", `Verifier stamp`, `Artifact edited`, `Certified fingerprint`, caps 30 rounds and 10 verifier launches. Every later task uses these names verbatim.

- [ ] **Step 0: Replace the file's opening summary sentence**

Replace:

```markdown
Fresh-agent review phases shared by three artifact types. This file owns how the run, phases, rounds, checkpoints, repairs, and post-review tail work. The artifact parameter files beside it own what to review.
```

with:

```markdown
Fresh-agent review rounds shared by three artifact types. This file owns how the run, rounds, reactivation waves, the holistic gate, checkpoints, repairs, and post-review tail work. The artifact parameter files beside it own what to review.
```

- [ ] **Step 1: Replace the lifecycle terms and completion rules**

The current section spans the `## Review lifecycle` heading through the paragraph beginning "Phase 1 always advances to phase 2." Replace from the line `Define and apply these terms consistently:` through the line ending `advances to a new phase with every applicable dimension active.` (inclusive) with:

```markdown
Define and apply these terms consistently:

- A run is the complete review and post-review process for one logical artifact and resolved scope. There are no phases: a run is a single convergence process of rounds, reactivation waves, and verifier rounds.
- A round launches one fresh reviewer for each currently active cell against the current artifact fingerprint. Round numbers are monotonic for the whole run and never reset.
- An explicit clean conclusion with a concrete nonblank verification rationale makes that cell inactive, certifying the fingerprint it reviewed.
- A finding that causes an accepted artifact edit keeps its cell active and records an applied change.
- Any other controller-coordinated reviewable-content edit records an applied change while preserving each cell's current active or inactive state until the staleness sweep.
- A finding that causes no artifact edit but yields an open follow-up keeps its cell active into the next round; each round's outcome is then judged on that round's own yield by the round-boundary rule below.
- A REFUTED finding records a reasoned acknowledgement and no follow-up or applied-change entry. A valid-but-deferred finding records both its actionable follow-up and the acknowledgement or caveat that prevents repeated review noise, with no applied-change entry. Neither disposition counts as a per-finding clean conclusion. Acknowledgements persist for the whole run.
- A cell whose round yields no applied fix and no open follow-up, because every skeptic-verified finding was refuted or accepted without an actionable follow-up, becomes inactive at the round boundary, certifying the fingerprint it reviewed; the recorded skeptic evidence and acknowledgements are its verification rationale.
- Staleness sweep: when every applicable cell is inactive, compare each applicable cell's certified fingerprint with the current fingerprint and re-evaluate every N/A declaration in both directions. Reactivate exactly the cells whose certification differs (digests carry no order; inequality is the whole test), clearing each reactivated cell's certification. Promote a newly contradicted N/A to active with no certification. Demote a cell whose justification no longer applies to N/A with a newly evaluated nonblank encoded reason, clearing its certification; demotion happens only at this boundary, and the demoted cell's open follow-ups stay in the run-wide ledger. A demotion-only sweep converges immediately; only cell activation blocks convergence. A sweep that finds the applicable set empty fails the run with current diagnostics: wave convergence is never vacuous, and the verifier can never be the artifact's only fresh look. Staleness is evaluated only at this all-inactive boundary, never mid-round: accumulated changes batch into one wave instead of re-running settled cells per small delta. No cell is ever reactivated directly by another cell's edit or disposition; only the sweep reactivates.
- Wave convergence: every applicable cell's certification equals the current fingerprint. Only then may a verifier round launch.
- Verifier round: a round whose single cell is `verifier/whole-artifact`, reviewing the entire artifact at the wave-converged fingerprint under the holistic gate rules below. The verifier cell sits outside the applicable set: the sweep and wave convergence never count it. A verifier round that applies no fix stamps that exact fingerprint: a clean conclusion with a concrete note, or a round in which every skeptic-verified finding landed refuted, was accepted as an acknowledgement-only judgment call, or was deferred to an authoritative open follow-up. Deferred verifier findings never block the stamp: relaunching at the same fingerprint would add no information, and the stamp attests review coverage, not zero deferred debt. Verifier findings follow the normal skeptic and adjudication pipeline; a verifier boundary that applies at least one fix increments the fingerprint once like any round boundary, leaves the stamp unset, and returns the run to the staleness sweep.
- A newly contradicted N/A justification becomes applicable immediately, active with no certification, so the run cannot complete without reviewing it; the staleness sweep owns both N/A promotion and demotion.

The run enters `post-review` only on the conjunction of wave convergence and a verifier stamp equal to the current fingerprint. The stamp is a conjunction, not an authority: the verifier never launches before wave convergence, so no single agent and no cap path can complete the run alone. Any reviewable-content edit after a stamp moves the fingerprint, and any resolved-scope-map change alters delivered content even when the fingerprint holds; either event invalidates the stamp and clears or stales the affected certifications, and the staleness sweep is the single re-entry path in both cases.
```

- [ ] **Step 2: Replace the limits paragraphs**

Replace from the line `The limits are 10 original reviewer launches per stable dimension or shard cell per phase, 10 phases, and 3 execution-repair launches per stable reviewer or skeptic cell. No limit path can manufacture LGTM or refutation.` through the line `The original reviewer dispatch is not a repair launch. Every later same-session clarification or fresh replacement launch increments the stable reviewer or skeptic cell's repair counter before dispatch. A repair counter already at 3 fails the run before another agent launches. Phase 10 can enter post-review when it satisfies the clean-phase completion rule.` (inclusive) with:

```markdown
The limits are 30 rounds per run (verifier rounds included), 10 verifier launches per run (a launch is the dispatch of one verifier round), and 3 execution-repair launches per stable reviewer, skeptic, or verifier cell. No limit path can manufacture LGTM, a stamp, or refutation.

`Start round` preflights the round cap: a launch that would exceed round 30 fails the run with current diagnostics before any agent launches. `Launch verifier` preflights both caps the same way at 10 verifier launches. A cap-forced end is terminal until explicit user disposition; it never produces completion.

The original reviewer or verifier dispatch is not a repair launch. Every later same-session clarification or fresh replacement launch increments the stable cell's repair counter before dispatch. A repair counter already at 3 fails the run before another agent launches.
```

- [ ] **Step 3: Update the enum values list**

In `Use only these values:`, replace the line:

```markdown
- Dimension `Status`: `active`, `inactive`, or `N/A`. An N/A row requires a nonblank encoded reason; active and inactive rows require raw `none`.
```

with:

```markdown
- Cell `Status`: `active`, `inactive`, or `N/A`. An N/A row requires a nonblank encoded reason; active and inactive rows require raw `none`. `Certified fingerprint` is `sha256:` plus 12 lowercase hexadecimal characters on an inactive row and raw `none` on an active or N/A row: a cell is inactive exactly when it holds a certification.
```

Replace the line:

```markdown
`Autonomous handover` and `Phase changed` use raw `yes` or `no`. A persisted skeptic verdict in either dispatch mode is `CONFIRMED`, `REFUTED`, or `JUDGMENT_CALL`.
```

with:

```markdown
`Autonomous handover` and `Artifact edited` use raw `yes` or `no`. `Verifier stamp` is raw `none` or `sha256:` plus 12 lowercase hexadecimal characters. A persisted skeptic verdict in either dispatch mode is `CONFIRMED`, `REFUTED`, or `JUDGMENT_CALL`.
```

Delete the line `Re-evaluate every N/A declaration at each phase boundary. Change a contradicted N/A to active with zero attempts immediately.` (the lifecycle section now owns N/A re-evaluation).

- [ ] **Step 4: Verify no stale terms remain in the two sections**

Run: `grep -n -i "phase" C:/Git/nightshift/skills/revise/SKILL.md | head -40`
Expected: between the `## Review lifecycle` heading and the `## Authoritative checkpoint` heading, exactly one hit: the vocabulary sentence `There are no phases` in the run bullet. Hits later in the file remain until Tasks 3 to 5.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add skills/revise/SKILL.md
git -C C:/Git/nightshift commit -m "feat(revise): restate lifecycle as waves with holistic gate"
```

---

### Task 3: Rewrite the checkpoint schema and boundary templates

Declared coupling: between this task and Task 6, `skills/revise/code.md` still names the deleted `Start phase` template and per-phase attempt counting; that transitional inconsistency is deliberate, harmless to the test suites, and closed by Task 6.

**Files:**
- Modify: `skills/revise/SKILL.md` (sections `## Authoritative checkpoint`, `### Atomic replacement and field lifetimes`, `### Boundary templates`, and the round-result header in `## Round result and delivery snapshot`)

**Interfaces:**
- Consumes: Task 2's terms.
- Produces: state fields `Round`, `Round status`, `Verifier launches`, `Verifier stamp`, `Artifact fingerprint`, `Artifact edited`; cell column `Certified fingerprint`; templates `Start round`, `Reactivate stale cells`, `Launch verifier`, `Restart run`. Tasks 4 and 5 reference these verbatim.

- [ ] **Step 1: Update the state header block**

In the `# Revise state` example, replace:

```markdown
Phase: 2
Converged phases: 1
Last converged phase: 1
Round: 5
Round status: in-flight
Artifact fingerprint: sha256:a1b2c3d4e5f6
Phase changed: yes
```

with:

```markdown
Round: 5
Round status: in-flight
Verifier launches: 0
Verifier stamp: none
Artifact fingerprint: sha256:a1b2c3d4e5f6
Artifact edited: yes
```

- [ ] **Step 2: Update the Dimension cells table schema**

Replace the header row and both example rows:

```markdown
| Cell ID | Dimension UTF-8 hex | Cell kind | Cluster UTF-8 hex | Delivery scope | Predecessor cell IDs | Status | N/A reason UTF-8 hex | Attempts this phase |
|---|---|---|---|---|---|---|---|---:|
| correctness/cluster-parser | 436f72726563746e657373 | local | 706172736572 | local-slice | none | active | none | 2 |
| security/whole-scope | 5365637572697479 | cross-cutting | 77686f6c652d73636f7065 | whole-scope | none | inactive | none | 1 |
```

with:

```markdown
| Cell ID | Dimension UTF-8 hex | Cell kind | Cluster UTF-8 hex | Delivery scope | Predecessor cell IDs | Status | N/A reason UTF-8 hex | Certified fingerprint |
|---|---|---|---|---|---|---|---|---|
| correctness/cluster-parser | 436f72726563746e657373 | local | 706172736572 | local-slice | none | active | none | none |
| security/whole-scope | 5365637572697479 | cross-cutting | 77686f6c652d73636f7065 | whole-scope | none | inactive | none | sha256:a1b2c3d4e5f6 |
```

- [ ] **Step 3: Update field lifetimes and identity-validation phrasing**

In `### Atomic replacement and field lifetimes`, replace `validate the schema and phase, round, fingerprint, and map relationships` with `validate the schema and round, fingerprint, and map relationships`. Replace the sentence:

```markdown
Artifact identity, scope decisions, autonomy mode, acknowledgements, user requests, applied changes, follow-ups, and prior failures persist until successful cleanup or a user-authorized restart rule says otherwise. Phase fields are the phase and convergence counters, dirty flag, full dimension-cell lifecycle and lineage, and exact encoded scope maps. Round fields are round number, round status, fingerprint, Agents rows, and `.tmp/revise-round-result.md`.
```

with:

```markdown
Artifact identity, scope decisions, autonomy mode, acknowledgements, user requests, applied changes, follow-ups, and prior failures persist until successful cleanup or a user-authorized restart rule says otherwise. Convergence fields are the verifier counters and stamp, the full cell lifecycle, lineage, certifications, and exact encoded scope maps. Round fields are round number, round status, fingerprint, Agents rows, and `.tmp/revise-round-result.md`.
```

- [ ] **Step 3b: Add the pre-wave fail-closed resume rule**

In the paragraph containing `An unfinished ``reviewing`` or ``post-review`` state with the same artifact and logical scope is a resume candidate.`, insert immediately after that sentence:

```markdown
A state file written by the phase-model schema (a raw `Phase:` header field or an `Attempts this phase` column) is never migrated: set `Status: failed` with `Failure JSON: "pre-wave state file; not migrated"` and offer restart or abandon.
```

- [ ] **Step 4: Replace the boundary templates**

Replace the three-bullet template list (from `- ` + `Start phase`: through the end of the `Restart run` bullet) and the two paragraphs that follow it (beginning `New-run creation writes` and `At phase convergence, compute`) with:

```markdown
- `Start round`: fail with current diagnostics when the next round would exceed 30. Otherwise calculate the next round, launch fingerprint, and immutable canonical delivery-map snapshot, and the replacement Agents section in memory. The Agents section has exactly one reviewer row for every active cell (or exactly one verifier row for a verifier round), session ID `none`, `in-flight`, zero repairs, and no prior-round rows. Atomically replace the result scratch with its matching cell-empty header and snapshot, then atomically rewrite state with the same identities and map bytes, replacement Agents, `Artifact edited: no`, and `Round status: in-flight`. Dispatch only after both checkpoints match. Clearing `Artifact edited` here gives the flag its wave-era meaning: a reviewable edit made after the last reconciled launch (the reconciliation that precedes every launch has just accounted for all prior edits in the ledger), replacing the phase model's per-phase reset so the unexplained-drift branch keeps its discriminating power.
- `Reactivate stale cells`: applies only at an all-inactive boundary where the staleness sweep changes something. In one atomic state rewrite: set every cell whose `Certified fingerprint` differs from the current fingerprint to `Status: active` with `Certified fingerprint: none`; re-evaluate every N/A declaration in both directions, changing a contradicted N/A to active with no certification, demoting a no-longer-applicable cell to N/A with a newly evaluated nonblank encoded reason and `Certified fingerprint: none`, and preserving an inapplicable cell as N/A only after re-evaluating and encoding its nonblank reason. If the rewrite would leave the applicable set empty, set `Status: failed` with current diagnostics instead. If it activated at least one cell, `Start round`; a demotion-only rewrite proceeds directly to the boundary resolution below.
- `Launch verifier`: applies only at wave convergence with `Round status: evaluated` or `idle`. Fail with current diagnostics when verifier launches would exceed 10. Otherwise increment `Verifier launches` and apply `Start round` as a verifier round: the single cell is `verifier/whole-artifact`, model pin opus, holistic-gate payload.
- `Restart run`: set `Status: reviewing`, `Post-review step: not-started`, `Failure: none`, round 0, `Round status: idle`, `Verifier launches: 0`, `Verifier stamp: none`, current fingerprint, and `Artifact edited: no`; clear Agents and post-review work items and pending mutation; delete the prior result scratch; make every applicable cell active with `Certified fingerprint: none` and N/A reason `none`, preserving an inapplicable cell as N/A only after re-evaluating and encoding its nonblank reason; preserve artifact and scope identity, acknowledgements, user requests, applied changes, follow-ups, and prior failures; copy the prior failure into Prior failures.

New-run creation writes the identity and empty persistent sections, pre-seeds acknowledgements and caveats from the artifact profile before the first round, and initializes the same counters and cell states as `Restart run`. A reviewable post-review mutation returns to `reviewing`, resets the post-review step and its work items, clears the completed mutation, clears `Verifier stamp` to `none`, and refreshes the fingerprint so the staleness sweep drives re-review. Partial results set result status `partial`, keep the round in flight, update Agents and result cells by stable cell or derived finding ID as appropriate, and preserve every completed result. A fully repaired and adjudicated result sets round status `evaluated`, result status `usable`, and all Agents rows `completed`. Failure preserves diagnostic round and convergence fields. Successful finalization deletes state, payload, result, patch, and staging scratch files.

At every evaluated boundary with all applicable cells inactive, resolve the next transition in one boundary rewrite, sweep first: `Reactivate stale cells` runs the staleness sweep (reactivation, N/A promotion and demotion, empty-set failure) and starts the next round when it activated cells; wave convergence without a current stamp applies `Launch verifier`; wave convergence with `Verifier stamp` equal to the current fingerprint enters `post-review`. On resume, a reviewing state with every applicable cell inactive resolves the same way after session reconciliation; a stable checkpoint cannot remain reviewing with every applicable cell inactive, current certifications, no verifier row in flight, and no transition taken.
```

- [ ] **Step 5: Update the round-result header example**

In `## Round result and delivery snapshot`, replace:

```markdown
# Revise round result

Phase: 2
Round: 5
```

with:

```markdown
# Revise round result

Round: 5
```

- [ ] **Step 5b: Update the delivery-snapshot exclusion sentence**

In the paragraph beginning `Immediately append `## Delivery map snapshot``, replace `It excludes predecessor IDs, lifecycle status, N/A reason, and attempts.` with `It excludes predecessor IDs, lifecycle status, N/A reason, and certifications.`

- [ ] **Step 6: Verify**

Run: `grep -n "Start phase\|Converged phases\|Last converged phase\|Phase changed\|Attempts this phase\|Phase:" C:/Git/nightshift/skills/revise/SKILL.md`
Expected: zero hits for `Converged phases` and `Last converged phase`; zero raw `Phase:` header lines (both example-block occurrences are removed by Steps 1 and 5); exactly one line hitting both `Attempts this phase` and `Phase:`, the pre-wave fail-closed sentence added by Step 3b (it names the old schema being rejected); remaining `Start phase` / `Phase changed` hits only in the drift, user-request, adjudication, and post-review sections that Tasks 4 and 5 rewrite (list them; if any hit falls outside those sections, fix it now).

- [ ] **Step 7: Commit**

```bash
git -C C:/Git/nightshift add skills/revise/SKILL.md
git -C C:/Git/nightshift commit -m "feat(revise): wave-era checkpoint schema and boundary templates"
```

---

### Task 4: Sweep identity tuples and rewrite drift, resume, and dispatch prose

**Files:**
- Modify: `skills/revise/SKILL.md` (sections `## Round result and delivery snapshot` tail, `## Fingerprints, drift, and resume`, `## User requests and controller mutations`, `## Dispatch and repair`, `### Workflow path`, `### Manual Agent path`, `### Repair rules`)

**Interfaces:**
- Consumes: Task 2 and 3 terms; Task 1's workflow contract.

- [ ] **Step 1: Identity-tuple sweep (exact replacements, one Edit each)**

| Old (verbatim) | New |
|---|---|
| `It is scoped to the current phase, round, fingerprint, delivery snapshot, cell, finding, and Session ID.` | `It is scoped to the current round, fingerprint, delivery snapshot, cell, finding, and Session ID.` |
| `A result whose phase, round, fingerprint, or exact snapshot differs from state is stale and contributes no cells.` | `A result whose round, fingerprint, or exact snapshot differs from state is stale and contributes no cells.` |
| `preserve the incremented phase attempt and recover only missing reviewer cells through bounded repair without changing the round or original attempt` | `recover only missing reviewer cells through bounded repair without changing the round` |
| `Never resume an agent across fingerprint, projected map, phase, or round changes.` | `Never resume an agent across fingerprint, projected map, or round changes.` |
| `a user-authorized retry whose phase, round, fingerprint, and snapshot still match sets status reviewing` | `a user-authorized retry whose round, fingerprint, and snapshot still match sets status reviewing` |
| `For a dimension-attempt or phase-cap failure, a user-authorized restart records the failure and invokes `Restart run`.` | `For a round-cap or verifier-cap failure, a user-authorized restart records the failure and invokes `Restart run`.` |
| `Begin each payload with phase, round, fingerprint, stable cell ID,` | `Begin each payload with round, fingerprint, stable cell ID,` |
| `compare state with the result scratch's phase, round, fingerprint, and exact delivery-map snapshot` | `compare state with the result scratch's round, fingerprint, and exact delivery-map snapshot` |
| `retain `Round status: in-flight`, phase, round, fingerprint, delivery snapshot,` | `retain `Round status: in-flight`, round, fingerprint, delivery snapshot,` |
| `A user-authorized retry whose canonical phase, round, fingerprint, and delivery snapshot still match clears Failure` | `A user-authorized retry whose canonical round, fingerprint, and delivery snapshot still match clears Failure` |
| `accept it only when its Session ID matches the current in-flight reviewer row and the phase, round, fingerprint, and delivery snapshot still match` | `accept it only when its Session ID matches the current in-flight reviewer row and the round, fingerprint, and delivery snapshot still match` |
| `Results tied to an outdated phase, round, fingerprint, or delivery snapshot cannot affect review state.` | `Results tied to an outdated round, fingerprint, or delivery snapshot cannot affect review state.` |
| `A phase, round, fingerprint, or snapshot mismatch follows abandonment rather than consuming repairs.` | `A round, fingerprint, or snapshot mismatch follows abandonment rather than consuming repairs.` |
| `An uncertain dimension remains active while budget remains.` | `An uncertain cell remains active while budget remains.` |
| `record delivery-map round abandonment without changing phase or `Phase changed`` | `record delivery-map round abandonment without changing `Artifact edited`` |
| `and invoke `Start round` for the next round with existing phase attempts preserved before normal increments` | `and invoke `Start round` for the next round` |
| `calculate the next identities, snapshot, attempts, and Agents in memory` | `calculate the next identities, snapshot, and Agents in memory` |
| `the next `Start round` replaces it, and persisted attempts do not advance` | `the next `Start round` replaces it` |

- [ ] **Step 2: Remove the workflow example's phase line**

In the `### Workflow path` JSON example, delete the line `  "phase": 2,` (the object then begins with `"round": 5,`), matching Task 1's contract.

- [ ] **Step 3: Rewrite the two drift paragraphs**

Replace the paragraph beginning `For idle-state drift, no round conclusion exists to discard.` (through its end) with:

```markdown
For idle-state drift, no round conclusion exists to discard. If `Artifact edited` and the latest applied-change entry account for the edit, or the user confirms it interactively, record any missing ledger entry, set `Artifact edited: yes`, clear `Verifier stamp` to `none` if set, refresh fingerprint and code map atomically, and regenerate delivery; prior certifications are now stale against the moved fingerprint, so the staleness sweep drives re-review with current cell states preserved until then. Interactive rejection or unresolved ambiguity applies scope disposition and records the abandonment. Autonomous handover records unexplained idle drift as an abandonment entry and continues the same way. A resolved-scope-map change without a fingerprint move follows the same path: clear `Verifier stamp` to `none` if set, and at the next boundary reactivate every affected cell with `Certified fingerprint: none` (whole-scope and cross-cutting cells on any map change, local cells on slice-membership change), because delivered content changed even though the patch fingerprint did not.
```

Replace the paragraph beginning `If the fingerprint changes while agents are in flight, discard the round,` (through `Do not add per-edit hashes, immutable round directories, or mutation journals.`) with:

```markdown
If the fingerprint changes while agents are in flight, discard the round: results tied to the old identity contribute nothing. Record the abandoned round in Applied changes, clear `Verifier stamp` to `none` if set, refresh fingerprint and delivery, and continue; the moved fingerprint stales prior certifications, and the staleness sweep re-reviews every settled cell. If evaluated-state drift is clearly accounted for by `Artifact edited` and the latest applied-change entry, refresh fingerprint and delivery and continue without changing cell statuses. Otherwise ask in interactive mode: confirmation records the missing entry and refreshes; rejection or unresolved ambiguity applies scope disposition and records the abandonment. Autonomous handover records unexplained abandonment and continues. A crash after an edit but before its ledger entry follows the unexplained path. Do not add per-edit hashes, immutable round directories, or mutation journals.
```

- [ ] **Step 4: Rename the flag in the user-request section**

Replace `atomically mark it consumed with encoded evidence without dirtying the phase` with `atomically mark it consumed with encoded evidence and no applied-change entry`. Replace `appends its Applied changes entry, sets `Phase changed: yes`, and clears the mutation` with `appends its Applied changes entry, sets `Artifact edited: yes`, clears `Verifier stamp` to `none` if set, and clears the mutation`.

- [ ] **Step 5: Verify**

Run: `grep -n "Phase changed\|phase, round\|phase or round\|phase attempts" C:/Git/nightshift/skills/revise/SKILL.md`
Expected: exactly one hit: the adjudication-section bullet containing `set `Phase changed: yes``, which Task 5 Step 2 replaces. Any other hit is an escape to fix before committing.

- [ ] **Step 6: Commit**

```bash
git -C C:/Git/nightshift add skills/revise/SKILL.md
git -C C:/Git/nightshift commit -m "feat(revise): wave-era identity, drift, and dispatch prose"
```

---

### Task 5: Adjudication boundary, holistic gate section, and post-review tail

**Files:**
- Modify: `skills/revise/SKILL.md` (sections `### Repair rules`, `## Adjudication and round boundary`, new `## Holistic gate`, `## Post-review tail`)

**Interfaces:**
- Consumes: all prior task terms.
- Produces: the `## Holistic gate` section other files may reference by name.

- [ ] **Step 1: Update repair rule 1**

Replace:

```markdown
1. A dimension cannot become inactive without either a clear clean-review conclusion with a concrete nonblank verification rationale against the current fingerprint, or a round boundary at which every skeptic-verified finding from the current round was refuted or accepted without an actionable follow-up, with that skeptic evidence recorded as the rationale.
```

with:

```markdown
1. A cell cannot become inactive without either a clear clean-review conclusion with a concrete nonblank verification rationale against the current fingerprint, or a round boundary at which every skeptic-verified finding from the current round was refuted or accepted without an actionable follow-up, with that skeptic evidence recorded as the rationale. The verifier stamp obeys the same rule over the whole artifact.
```

- [ ] **Step 2: Rewrite the adjudication disposition endings**

Replace:

```markdown
- At the round boundary a cell remains active only when the current round yielded at least one applied fix or open follow-up. A cell whose current round's skeptic-verified findings all landed as refuted or as acknowledgement-only accepted judgment calls becomes inactive for the rest of the phase, with the skeptic evidence and acknowledgements recorded as its verification rationale.
- An LGTM cell with a nonblank concrete verification note likewise becomes inactive for the rest of the phase.
```

with:

```markdown
- At the round boundary a cell remains active only when the current round yielded at least one applied fix or open follow-up. A cell whose current round's skeptic-verified findings all landed as refuted or as acknowledgement-only accepted judgment calls becomes inactive, certifying the reviewed fingerprint, with the skeptic evidence and acknowledgements recorded as its verification rationale.
- An LGTM cell with a nonblank concrete verification note likewise becomes inactive, certifying the reviewed fingerprint.
```

In the confirmed-fix bullet of the same list, replace `record the applied change immediately, set `Phase changed: yes`, and keep that cell active` with `record the applied change immediately, set `Artifact edited: yes`, and keep that cell active`.

- [ ] **Step 3: Rewrite the sibling-reactivation paragraph**

Replace:

```markdown
Another dimension's edit does not reactivate an inactive sibling. If removing review-added machinery undoes another dimension's accepted fix, this is a controller-coordinated reviewable edit: dirty the phase and preserve current cell dispositions. The mandatory next phase reactivates every applicable cell.
```

with:

```markdown
Another cell's edit does not directly reactivate an inactive sibling; only the staleness sweep reactivates, and only at an all-inactive boundary. If removing review-added machinery undoes another cell's accepted fix, this is a controller-coordinated reviewable edit: record the applied change and preserve current cell dispositions; the moved fingerprint stales the affected certifications and the sweep re-reviews them.
```

- [ ] **Step 4: Rewrite the boundary-close paragraph**

Replace:

```markdown
After every evaluated round, report what changed and which cells became inactive or remain active, then atomically persist the boundary. Drain user requests. If all applicable cells are inactive, perform the single convergence checkpoint; otherwise `Start round` again.
```

with:

```markdown
After every evaluated round, report what changed and which cells became inactive or remain active, then atomically persist the boundary. Drain user requests. If all applicable cells are inactive, resolve the transition per the boundary templates: `Reactivate stale cells`, `Launch verifier`, or post-review entry. Otherwise `Start round` again.
```

- [ ] **Step 5: Insert the holistic gate section**

Immediately before the `## Post-review tail` heading, insert:

```markdown
## Holistic gate

The verifier is one fresh agent per launch with stable cell ID `verifier/whole-artifact`, model pin opus for every artifact type, dispatched as a verifier round through the same Workflow or manual path as reviewers, with the same skeptic evidence contract, repair budget, and checkpoint shapes. Its result cell uses `Cell kind: verifier` and `Cluster JSON: "whole-artifact"` with the standard cell shapes otherwise. Its payload uses the standard encoded payload path and begins with round, fingerprint, and cell identity, then the complete common context and the holistic charter: review the entire artifact at this fingerprint for cross-dimension coherence, gaps between the profile dimensions' lenses, and completion-worthiness; report high-confidence findings only; a clean conclusion requires a concrete nonblank verification note.

Adjudicate verifier findings with the standard disposition rules. At the verifier boundary: if at least one fix was applied, the fingerprint increments once, spawned consequences and applied changes are recorded exactly as at a reviewer round boundary, `Verifier stamp` stays `none`, and the staleness sweep resumes the run. If the verifier round applied no fix (a clean conclusion, or every skeptic-verified finding refuted, accepted as an acknowledgement-only judgment call, or deferred to an authoritative open Follow-ups row), one atomic rewrite records `Verifier stamp` as the current fingerprint and enters `post-review`, with the note or the skeptic evidence and acknowledgements as the stamp rationale. Deferred verifier findings never block the stamp: relaunching at the same fingerprint would add no information, and the stamp attests review coverage, not zero deferred debt.

The verifier never launches before wave convergence and never stamps a fingerprint other than the one it reviewed. A stamp whose fingerprint no longer matches the current fingerprint is stale and authorizes nothing.
```

- [ ] **Step 6: Update the post-review drift restart and follow-up phrasing**

Replace:

```markdown
Before stamping and before cleanup, recompute the fingerprint. Drift returns to reviewing, resets the post-review step, records the edit, clears work items and the completed mutation, and invokes `Start phase` with the next phase and current fingerprint.
```

with:

```markdown
Before stamping and before cleanup, recompute the fingerprint. Drift returns to reviewing, resets the post-review step, records the edit, clears work items, the completed mutation, and `Verifier stamp`, and lets the staleness sweep reactivate every cell whose certification predates the current fingerprint.
```

Replace `Resolved rows persist across an address-now edit and the required new review phase.` with `Resolved rows persist across an address-now edit and the required re-review.`

- [ ] **Step 7: Verify SKILL.md is phase-free**

Run: `grep -n -i "phase" C:/Git/nightshift/skills/revise/SKILL.md`
Expected: exactly three hit lines, all naming the retired model rather than using it: the lifecycle vocabulary sentence containing `There are no phases`, the pre-wave fail-closed sentence containing `phase-model schema`, `Phase:`, and `Attempts this phase`, and the `Start round` template's flag-rationale clause containing `the phase model's per-phase reset`. Any other hit is an escaped reference; fix it against the spec before committing. Also run: `grep -n -i "attempt" C:/Git/nightshift/skills/revise/SKILL.md`
Expected: hits only for the repair budget (`Repair attempts` column, `three-attempt`, `repair attempt` phrasing), the pre-wave sentence's `Attempts this phase`, and the Manual Agent path's ordinary-English verbs (`attempt every remaining original reviewer submission`, `have been attempted`); any per-cell review-attempt counting hit is an escape to fix.

- [ ] **Step 8: Commit**

```bash
git -C C:/Git/nightshift add skills/revise/SKILL.md
git -C C:/Git/nightshift commit -m "feat(revise): adjudication boundary and holistic gate"
```

---

### Task 6: Sweep the artifact parameter files

**Files:**
- Modify: `skills/revise/code.md`, `skills/revise/plan.md`, `skills/revise/spec.md`

- [ ] **Step 0: Scout-rule byte cleanup, committed first**

Two pre-existing non-ASCII characters sit in files this task edits; clean and commit them before any terminology edit so the style change stays its own commit and the Task 9 byte gate can pass. In `plan.md`, replace `must be` + one U+2264 character + `72 chars` (the less-than-or-equal sign in the commit-subject rule) with `must be at most 72 chars`. In `spec.md`, replace the three U+2192 arrow characters in `(input` ... `persistence)` (the data-shape boundary parenthetical) with ASCII `->`, yielding `(input -> algorithm -> output -> persistence)`. Then:

```bash
git -C C:/Git/nightshift add skills/revise/plan.md skills/revise/spec.md
git -C C:/Git/nightshift commit -m "style(revise): replace non-ASCII characters in parameter files"
```

- [ ] **Step 1: code.md replacements (one Edit each)**

| Old (verbatim) | New |
|---|---|
| `- **Pre-seed sources** (for the acknowledgements list, before phase 1):` | `- **Pre-seed sources** (for the acknowledgements list, before the first round):` |
| `Same expensive false-positive class, cheapest to suppress before phase 1.` | `Same expensive false-positive class, cheapest to suppress before the first round.` |
| `Create the map before phase 1 and the first payload.` | `Create the map before the first round and the first payload.` |
| `Re-evaluate applicability immediately: a contradicted N/A becomes active with zero attempts, the finding's active cell remains active, and inactive cells remain inactive until the next mandatory phase. Refresh the fingerprint, map, payloads, union proof, and cumulative patch before the next round. The next phase starts every applicable cell active against the expanded final scope.` | `Re-evaluate applicability immediately: a contradicted N/A becomes active with no certification, and the finding's active cell remains active. Refresh the fingerprint, map, payloads, union proof, and cumulative patch before the next round; the scope-map change clears `Verifier stamp` if set and the certifications of every affected cell (whole-scope and cross-cutting cells on any map change, local cells on slice-membership change) even when the patch fingerprint holds, so the staleness sweep re-reviews every settled cell against the expanded scope.` |
| `An unchanged logical `(dimension, cluster)` cell keeps its ID, status, N/A reason, and phase attempt count when its label or membership changes.` | `An unchanged logical `(dimension, cluster)` cell keeps its ID, status, N/A reason, and certification when only its label changes; a change to its slice membership clears the certification and reactivates it, because the certification attests exactly the reviewed slice.` |
| `A split or merge gets a new ID, records ordinal predecessor IDs, and inherits the maximum predecessor attempt count. A genuinely new local cell starts at zero.` | `A split or merge gets a new ID and records ordinal predecessor IDs. A genuinely new local cell starts active with no certification.` |
| `An applicable cell becomes active if any applicable predecessor or same-dimension sibling is active, otherwise inactive for the rest of the phase if any is inactive, otherwise active.` | `A split child whose slice is a subset of a single inactive predecessor's certified slice inherits that predecessor's certification; every other minted cell, including every merge and every cell with no applicable predecessors, starts active with no certification.` |
| `Cross-cutting cells retain identity and lifecycle fields while their whole-scope payloads refresh. No remap resets inherited attempt budgets. `Start phase` makes every applicable remapped cell active with zero attempts.` | `Cross-cutting cells retain identity and lifecycle fields while their whole-scope payloads refresh. No remap resets a stable cell's repair counter.` |
| `A fix keeps only its cell active inside the phase, every applicable cell reactivates next phase, and slices regenerate between rounds.` | `A fix keeps only its cell active; the staleness sweep reactivates settled cells once the active set drains, and slices regenerate between rounds.` |

- [ ] **Step 2: plan.md and spec.md replacements**

In `plan.md`: replace `- **Pre-seed sources** (for the acknowledgements list, before phase 1): scan the plan` with `- **Pre-seed sources** (for the acknowledgements list, before the first round): scan the plan`; replace `Did D5 become inactive immediately in phase 1 on a single-task plan?` with `Did D5 become inactive immediately in the first round on a single-task plan?`.

In `spec.md`: replace `- **Pre-seed sources** (for the acknowledgements list, before phase 1): scan the spec` with `- **Pre-seed sources** (for the acknowledgements list, before the first round): scan the spec`.

- [ ] **Step 3: Verify**

Run: `grep -n -i "phase" C:/Git/nightshift/skills/revise/code.md C:/Git/nightshift/skills/revise/plan.md C:/Git/nightshift/skills/revise/spec.md`
Expected: exactly one hit: `plan.md`'s task-number-leakage rule (the literal `"Phase N"` inside its quoted trio); zero hits in `code.md` and `spec.md`. Anything else is an escape to fix before committing.

- [ ] **Step 4: Commit the sweep**

Step 0's style commit already landed; this commit carries only the terminology sweep:

```bash
git -C C:/Git/nightshift add skills/revise/code.md skills/revise/plan.md skills/revise/spec.md
git -C C:/Git/nightshift commit -m "feat(revise): wave-era parameter file sweep"
```

---

### Task 7: Sync README, repository AGENTS.md, and handover.md

**Files:**
- Modify: `README.md`, `AGENTS.md`, `commands/handover.md`

- [ ] **Step 1: README line 5 lifecycle sentences**

Replace:

```markdown
A dimension becomes inactive for the rest of its phase on a clean conclusion, or when a round's findings all land as skeptic-refuted or accepted without an actionable follow-up; it is not reactivated by another dimension's later edit, and the next phase reactivates every applicable dimension. Phase 1 cannot complete the review stage. Phase 2 or later completes only after at least two phases have converged and the current phase ended with every applicable dimension inactive and no reviewable-content changes.
```

with:

```markdown
A dimension becomes inactive on a clean conclusion, or when a round's findings all land as skeptic-refuted or accepted without an actionable follow-up, certifying the fingerprint it reviewed; settled dimensions are re-reviewed by a reactivation wave whenever the artifact moves past their certification. Once every dimension certifies the current fingerprint, a single fresh holistic verifier reviews the whole artifact, and the run completes only when its stamp lands on that same fingerprint.
```

- [ ] **Step 1b: README checkpoint sentence**

In the same paragraph, replace:

```markdown
Markdown scratch checkpoints preserve controller-owned phase state, while resumable agent IDs provide best-effort recovery when sessions remain available.
```

with:

```markdown
Markdown scratch checkpoints preserve controller-owned run state, while resumable agent IDs provide best-effort recovery when sessions remain available.
```

- [ ] **Step 2: README line 37 description**

Replace:

```markdown
Dimensions converge independently within a phase: a dimension goes inactive on a clean LGTM or when a round's findings are all skeptic-refuted (or accepted without follow-up), and stays inactive until the next phase even when another dimension causes an edit.
```

with:

```markdown
Dimensions converge independently: a dimension goes inactive on a clean LGTM or when a round's findings are all skeptic-refuted (or accepted without follow-up), certifying the reviewed fingerprint, and a staleness-driven reactivation wave re-reviews settled dimensions once the artifact moves; a holistic verifier gate stamps the converged fingerprint before completion.
```

- [ ] **Step 3: Repository AGENTS.md**

Replace:

```markdown
Phase 1 cannot complete the review stage.
Phase 2 or later completes only after at least two phases have converged and the current phase ended with every applicable dimension inactive and no reviewable-content changes.
```

with:

```markdown
The holistic verifier never launches before every applicable cell has certified the current fingerprint.
A run completes only on the conjunction of that wave convergence and a clean verifier stamp over the same fingerprint.
```

Replace `` `SKILL.md` owns *how* the review run, phases, rounds, checkpoints, skeptic verification, and follow-up logging work `` with `` `SKILL.md` owns *how* the review run, rounds, reactivation waves, the holistic gate, checkpoints, skeptic verification, and follow-up logging work ``. Replace `` `.tmp/revise-state.md` is the controller-owned phase authority `` with `` `.tmp/revise-state.md` is the controller-owned state authority ``.

- [ ] **Step 4: handover.md review-phase phrasing**

Three occurrences of `run to completion under the skill's review-phase rules` exist (the spec-gate step, the revise-plan step, and the revise-code step). Replace the first two with `run to completion under the skill's review rules`, using one Edit each with their distinct step-number prefixes as anchors; the revise-code occurrence is covered by the longer Valid-but-deferred anchor below. Also replace `under the skill's review-phase rules. Valid-but-deferred findings flow into the follow-up items list across all rounds` with `under the skill's review rules. Valid-but-deferred findings flow into the follow-up items list across all rounds`. Also replace `a revise review phase is an internal repeated-review unit and does not alter that target scope.` with `a revise review round or wave is an internal repeated-review unit and does not alter that target scope.` Leave every "feature phase", "phasing declaration", and "implementation-phase" occurrence untouched: those describe spec slicing, not the review lifecycle.

- [ ] **Step 5: Verify**

Run: `grep -n -i "phase" C:/Git/nightshift/README.md C:/Git/nightshift/AGENTS.md`
Expected: zero hits in README; AGENTS.md hits only if unrelated to the revise lifecycle (currently none expected: list any and justify or fix).

Run: `grep -n "review-phase\|revise review phase" C:/Git/nightshift/commands/handover.md`
Expected: zero hits (the three review-rules replacements and the round-or-wave clause replacement all landed).

- [ ] **Step 6: Commit**

```bash
git -C C:/Git/nightshift add README.md AGENTS.md commands/handover.md
git -C C:/Git/nightshift commit -m "docs: describe wave lifecycle in README, AGENTS, handover"
```

---

### Task 8: Reconcile dependent feature records

**Files:**
- Modify: `.claude/features/fix-scoped-rounds.md`, `.claude/features/review-orchestration-tests.md`, `.claude/FEATURES.md`

- [ ] **Step 1: fix-scoped-rounds.md wave phrasing**

Replace every phase-model phrase with its wave equivalent, keeping the feature's own design unchanged. Exact edits:

| Old (verbatim) | New |
|---|---|
| `The next phase resets to whole-scope delivery as today, restoring full coverage over the fixed artifact.` | `The reactivation wave restores whole-scope delivery, preserving full coverage over the fixed artifact.` |
| `Round 1 of every phase remains whole-scope, unchanged.` | `A cell's first review of any fingerprint remains whole-scope, unchanged.` |
| the `## Why the completion guarantee is unaffected` section's opening paragraph | Verify only, no edit: that paragraph was already rewritten during spec hardening to the narrowed-payload-never-certifies constraint (a narrowed review happens at the post-fix fingerprint and must never certify it; certification requires a full-payload review). Confirm it still opens with `Under the wave-convergence lifecycle` and states that constraint; fix only if drifted. The section's second paragraph is not verify-only: its phase-boundary clause is edited by the `with the phase boundary as the backstop.` row below. |
| `waits for the next phase's whole-scope pass.` | `waits for the reactivation wave's whole-scope pass.` |
| `while an inactive dimension sees nothing until the next phase's reset. Fix-scoping reduces the accidental privilege by leveling down: a dimension re-reviewing its own fixes no longer sees sibling fixes, and the phase boundary uniformly restores every dimension's full view.` | `while an inactive dimension sees nothing until the reactivation wave. Fix-scoping reduces the accidental privilege by leveling down: a dimension re-reviewing its own fixes no longer sees sibling fixes, and the wave uniformly restores every dimension's full view.` |
| `caught a phase later instead of a round later. In some runs that means an extra phase, partially or wholly offsetting` | `caught a wave later instead of a round later. In some runs that means extra rounds, partially or wholly offsetting` |
| `Feature: within a revise phase, a round 2+ reviewer` | `Feature: within a wave-lifecycle review run, a round 2+ reviewer` |
| `Primary rationale: this reduces a within-phase asymmetry in who gets to weigh in on fixes;` | `Primary rationale: this reduces a within-run asymmetry in who gets to weigh in on fixes;` |
| `Today every round of every phase delivers each active dimension's reviewer its full normal payload:` | `Today every round delivers each active dimension's reviewer its full normal payload:` |
| `with the phase boundary as the backstop.` | `with the staleness sweep and verifier gate as the backstop.` |
| `(round 1 of every phase, and round 2+ deliveries to zero-fix active dimensions)` | `(a cell's first review of any fingerprint, and round 2+ deliveries to zero-fix active dimensions)` |
| `- The round and phase lifecycle in `skills/revise/SKILL.md` (existing; the delivery rules this feature narrows).` | `- The wave-convergence lifecycle in `skills/revise/SKILL.md` (existing; the delivery rules this feature narrows).` |

After the table edits, run: `grep -n -i "phase" C:/Git/nightshift/.claude/features/fix-scoped-rounds.md`
Expected: zero hits. Any hit is an escape: fix it with the nearest wave-era equivalent from the rows above before committing.

- [ ] **Step 2: review-orchestration-tests.md refocus note**

This feature's phase transition matrix is superseded but the file is a design record for an unshipped feature; do not rewrite its body wholesale in this batch. Insert immediately under the `# Review orchestration tests` heading's `Feature:` paragraph:

```markdown
**2026-08-13 supersession note:** the phase transition matrix below predates the wave-convergence lifecycle (`wave-lifecycle.md`), which removed phases. When this feature is picked up, re-derive the invariant set from the shipped wave model: staleness sweep, certification clearing on reactivation, the disposition rule set (which carries over), cap asymmetry (a cap-forced end never completes), and the stamp conjunction. The extraction purpose and module shape below remain valid.
```

- [ ] **Step 3: FEATURES.md excerpt sync**

In the review-orchestration-tests entry, replace `the full derived phase table (any converged phase increments the counter regardless of cleanliness; drift abandonment is the only non-increment), phase-scoped per-dimension convergence, preserved-within-phase / reset-at-boundary cross-dimension mutation,` with `the wave-model invariant set (staleness sweep, certification clearing, cap asymmetry, stamp conjunction; re-derived per the file's supersession note),`. The fix-scoped-rounds entry was already rewritten during spec hardening (reactivation-wave backstop phrase and the narrowed-review-never-certifies completion argument); verify it, and fix only if drifted.

- [ ] **Step 4: Verify and commit**

Run: `node C:/Git/nightshift/skills/ready/ready.js C:/Git/nightshift`
Expected: `structuralErrors` empty; fix-scoped-rounds still blocked on the wave feature only.

```bash
git -C C:/Git/nightshift add .claude/features/fix-scoped-rounds.md .claude/features/review-orchestration-tests.md .claude/FEATURES.md
git -C C:/Git/nightshift commit -m "docs(feature): reconcile records with wave lifecycle"
```

---

### Task 9: Version bump, full verification, and consistency sweep

**Files:**
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Bump the version**

Replace `"version": "2.1.0",` with `"version": "2.2.0",`.

- [ ] **Step 2: Run all three suites**

Run: `node C:/Git/nightshift/skills/ready/ready.test.js` then `node C:/Git/nightshift/skills/revise/revise-round.test.js` then `node C:/Git/nightshift/skills/revise/rigor.test.js`
Expected: 39 passed; all 47 named cases passed; all checks passed.

- [ ] **Step 3: Repo-wide lifecycle-sense phase sweep**

Run: `grep -rn -i "phase" C:/Git/nightshift/skills C:/Git/nightshift/commands C:/Git/nightshift/README.md C:/Git/nightshift/AGENTS.md`
Expected: hits only in (a) Workflow display-group usage in `revise-round.workflow.js` / `revise-round.test.js` (`phases:` meta, `phase: 'Review'`, `phase: 'Verify'`), (b) plan/spec-slicing senses in `commands/handover.md` ("feature phase", "phasing declaration", "implementation-phase", "post-stamp"), (c) plan-phase-ordinal prose in `commands/revise-docs.md`, `commands/init-backlog.md`, and `skills/revise/plan.md`'s task-number rule, (d) the three SKILL.md lines that name the retired model (`There are no phases`, the pre-wave `phase-model schema` fail-closed sentence, and the `Start round` flag-rationale clause naming `the phase model's per-phase reset`). Any hit describing the revise review lifecycle as current behavior is an escape: fix it before committing.

- [ ] **Step 4: Byte hygiene check**

Run: `LC_ALL=C.UTF-8 grep -rnP "[^\x00-\x7F]" C:/Git/nightshift/skills/revise/SKILL.md C:/Git/nightshift/skills/revise/code.md C:/Git/nightshift/skills/revise/plan.md C:/Git/nightshift/skills/revise/spec.md C:/Git/nightshift/commands/handover.md C:/Git/nightshift/README.md C:/Git/nightshift/AGENTS.md C:/Git/nightshift/.claude/FEATURES.md C:/Git/nightshift/.claude/features/fix-scoped-rounds.md C:/Git/nightshift/.claude/features/review-orchestration-tests.md; echo "exit: $?"`
Expected: no match lines and `exit: 1` (zero matches). `exit: 2` means the command itself failed to run: fix the invocation (the `LC_ALL=C.UTF-8` prefix is required because bare `grep -P` errors in this repository's Git Bash); never treat a failed check as a clean check.

- [ ] **Step 5: Commit any gate-triggered corrections, then the bump**

If any Step 2 to Step 4 gate triggered a corrective edit, commit those corrections first as their own conventional commit describing the fix (for example `fix(revise): close lifecycle sweep escape`); the release commit must stay bump-only.

```bash
git -C C:/Git/nightshift add .claude-plugin/plugin.json
git -C C:/Git/nightshift commit -m "chore(release): bump version to 2.2.0"
```

---

### Task 10: Ship the feature

**Files:**
- Modify: `.claude/features/wave-lifecycle.md`, `.claude/FEATURES.md`, `.claude/FEATURES_HISTORY.md`, `.claude/features/fix-scoped-rounds.md`

- [ ] **Step 1: Flip the feature status**

In `.claude/features/wave-lifecycle.md`, replace `Ready for planning; a revise-spec hardening pass over this file is recommended before or alongside implementation review.` with `Shipped 2026-08-14 in the 2.2.0 batch; the file remains the historical design record, and its Verification probes stay live until dispositioned.`

- [ ] **Step 2: Move the index entry to history**

Append to `.claude/FEATURES_HISTORY.md`: `- [Wave-convergence lifecycle with a holistic gate](features/wave-lifecycle.md): the revise engine's phase model replaced by staleness-driven reactivation waves, per-cell fingerprint certifications, and a holistic opus verifier whose stamp gates completion. Shipped 2026-08-14 in the 2.2.0 batch.` Then delete the entire `### [Wave-convergence lifecycle with a holistic gate](features/wave-lifecycle.md)` entry (heading, paragraph, and `**Requires:** none.` line) from `.claude/FEATURES.md`.

- [ ] **Step 3: Walk-and-remove dependent Requires lines**

In `.claude/FEATURES.md`, replace `**Requires:** [Wave-convergence lifecycle with a holistic gate](features/wave-lifecycle.md).` with `**Requires:** none.` In `.claude/features/fix-scoped-rounds.md`, replace `**Requires:** [Wave-convergence lifecycle with a holistic gate](wave-lifecycle.md).` with `**Requires:** none.`

- [ ] **Step 4: Verify and commit**

Run: `node C:/Git/nightshift/skills/ready/ready.js C:/Git/nightshift`
Expected: `structuralErrors` empty; the wave entry absent; Fix-scoped follow-up rounds now in the ready set.

```bash
git -C C:/Git/nightshift add .claude/features/wave-lifecycle.md .claude/FEATURES.md .claude/FEATURES_HISTORY.md .claude/features/fix-scoped-rounds.md
git -C C:/Git/nightshift commit -m "docs(feature): mark wave-lifecycle shipped"
```

---

## Post-plan note

After all tasks land, run `/nightshift:revise-code` over the batch (the plugin is self-hosting; this change rewrites the very lifecycle that review runs under, so the reviewing session executes the OLD shipped rules from its installed cache while reviewing the NEW rules in the clone; that is expected and safe). Pushing remains user-directed and requires the standard fresh-eyes pre-push review. Delete this plan file once the work lands.

## Hardening

- revise-plan graduated 2026-08-14 10:28 at c68331e, scope: whole file, content: 3f3422fd
