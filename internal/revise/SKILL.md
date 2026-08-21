---
name: revise
description: Shared fresh-agent review engine behind the revise-code, revise-plan, and revise-spec public skills (the user entry points). Invoked with a first-argument artifact type (code, plan, or spec) followed by the scope; not called directly by users.
---

# revise

Fresh-agent review rounds shared by three artifact types. This file owns how the run, rounds, reactivation waves, the holistic gate, checkpoints, repairs, and post-review tail work. The artifact parameter files beside it own what to review.

## Invocation

The first argument token selects `code`, `plan`, or `spec`. Everything after it is the scope interpreted by the matching parameter file. Read that file before any review action:

- `code` -> `code.md`
- `plan` -> `plan.md`
- `spec` -> `spec.md`

The parameter file supplies scope resolution, agreement binding and impact triggers, dimensions, model pin, pre-seed sources, delivery rules, additional prompt rules, post-fix steps, edit surface, retrospective extras, and artifact-specific post-review work. If the first token is missing or invalid, ask which artifact type is meant.

## Review lifecycle

Define and apply these terms consistently:

- A run is the complete review and post-review process for one logical artifact and resolved scope. There are no phases: a run is a single convergence process of rounds, reactivation waves, and verifier rounds.
- A round launches one fresh reviewer for each currently active cell against the current artifact fingerprint. Round numbers are monotonic for the whole run and never reset.
- An explicit clean LGTM conclusion with a concrete nonblank verification rationale makes that cell inactive, certifying the fingerprint it reviewed.
- A finding that causes an accepted artifact edit keeps its cell active and records an applied change.
- Any other controller-coordinated reviewable-content edit records an applied change while preserving each cell's current active or inactive state until the staleness sweep.
- A finding that causes no artifact edit but yields an open follow-up keeps its cell active into the next round; each round's outcome is then judged on that round's own yield by the round-boundary rule below.
- A REFUTED finding records a reasoned acknowledgement and no follow-up or applied-change entry. A valid-but-deferred finding records both its actionable follow-up and the acknowledgement or caveat that prevents repeated review noise, with no applied-change entry. Neither disposition counts as a per-finding clean conclusion. Acknowledgements persist for the whole run.
- A cell whose skeptic-verified findings were all refuted or accepted without an actionable follow-up remains active with no certification and receives another fresh review against the same fingerprint. Its reasoned acknowledgements enter the next payload so the reviewer can spend that pass on uncovered ground instead of repeating the rejected claim. The 30-round cap remains the livelock backstop.
- Staleness sweep: when every applicable cell is inactive, compare each applicable cell's certified fingerprint with the current fingerprint and re-evaluate every N/A declaration in both directions. Reactivate exactly the cells whose certification differs (digests carry no order; inequality is the whole test), clearing each reactivated cell's certification. Promote a newly contradicted N/A to active with no certification. Demote a cell whose justification no longer applies to N/A with a newly evaluated nonblank encoded reason, clearing its certification; demotion happens only at this boundary or at a remap re-evaluation (the applicability re-check a scope-map or slice-membership change triggers), and the demoted cell's open follow-ups stay in the run-wide ledger. A demotion-only sweep converges immediately; only cell activation blocks convergence. A sweep that finds the applicable set empty fails the run with current diagnostics: wave convergence is never vacuous, and the verifier can never be the artifact's only fresh look. Staleness is evaluated only at this all-inactive boundary, never mid-round: accumulated changes batch into one wave instead of re-running settled cells per small delta. No artifact edit or finding disposition reactivates a cell directly; fingerprint movement reactivates only through the sweep. The one exception is a resolved-scope-map change, which fingerprint inequality cannot detect: the boundary that reconciles the map change clears every affected cell's certification directly (whole-scope and cross-cutting cells on any map change, local cells on slice-membership change), reactivating them, because delivered content changed even when the fingerprint held.
- Wave convergence: every applicable cell's certification equals the current fingerprint. Only then may a verifier round launch.
- Verifier round: a round whose single cell is `verifier/whole-artifact`, reviewing the entire artifact at the wave-converged fingerprint under the holistic gate rules below. The verifier cell sits outside the applicable set: the sweep and wave convergence never count it. A clean LGTM conclusion with a concrete note stamps that exact fingerprint. A verifier round whose skeptic-verified findings were all refuted or accepted without an actionable follow-up leaves the stamp unset and launches another fresh verifier against the same fingerprint. Only a current verifier round that applies no fix and creates an authoritative deferred follow-up may stamp without a clean LGTM: relaunching at the same fingerprint would add no information about accepted debt, and the stamp attests review coverage, not zero deferred debt. Verifier findings follow the normal skeptic and adjudication pipeline; a verifier boundary that applies at least one fix increments the fingerprint once like any round boundary, leaves the stamp unset, and returns the run to the staleness sweep.
- A newly contradicted N/A justification becomes applicable immediately, active with no certification, so the run cannot complete without reviewing it; N/A promotion and demotion happen at exactly two boundaries, the staleness sweep and a remap re-evaluation.

The run enters `post-review` only on the conjunction of wave convergence and a verifier stamp equal to the current fingerprint. The stamp is a conjunction, not an authority: the verifier never launches before wave convergence, so no single agent and no cap path can complete the run alone. Any reviewable-content edit after a stamp moves the fingerprint, and any resolved-scope-map change alters delivered content even when the fingerprint holds; either event invalidates the stamp: a moved fingerprint stales certifications for the sweep to reactivate, and a map change clears the affected certifications directly at the boundary that reconciles it. Certification loss is the single re-entry path in both cases.

### Limits and enum values

The limits are 30 rounds per run (verifier rounds included), 10 verifier launches per run (a launch is the dispatch of one verifier round), and 3 execution-repair launches per stable reviewer, skeptic, or verifier cell. No limit path can manufacture LGTM, a stamp, or refutation.

`Start round` preflights the round cap: a launch that would exceed round 30 fails the run with current diagnostics before any agent launches. `Launch verifier` preflights both caps the same way at 10 verifier launches. A cap-forced end is terminal until explicit user disposition; it never produces completion. Whenever a failed transition or a not-ok cap preflight lands the run in `Status: failed`, write the module failure record's compact canonical JSON as the `Failure JSON` field's string content, so a later disposition parses the record back rather than inferring the class from state values.

The original reviewer or verifier dispatch is not a repair launch. Every later same-session clarification or fresh replacement launch increments the stable cell's repair counter before dispatch. A repair counter already at 3 fails the run before another agent launches.

Use only these values:

- Run `Status`: `reviewing`, `post-review`, or `failed`.
- `Round status`: `idle`, `in-flight`, or `evaluated`.
- Cell `Status`: `active`, `inactive`, or `N/A`. An N/A row requires a nonblank encoded reason; active and inactive rows require raw `none`. `Certified fingerprint` is `sha256:` plus 12 lowercase hexadecimal characters on an inactive row and raw `none` on an active or N/A row: a cell is inactive exactly when it holds a certification.
- Agent `Status`: `in-flight`, `completed`, or `needs-retry`.
- Round-result `Status`: `awaiting-results`, `partial`, or `usable`.
- Follow-up `Status`: `open`, `handed-off`, or `resolved`; `Route`: `none`, `handover`, `address-now`, `track`, or `skip`. Open rows use route and evidence `none`; handed-off rows use `handover` and nonblank encoded transfer evidence; resolved rows use one of the three final routes and nonblank encoded disposition evidence.
- User-request `Status`: `pending` or `consumed`. Pending rows use evidence `none`; consumed rows require nonblank encoded evidence.
- Post-review work-item `Status`: `pending` or `completed`.
- Pending controller mutation `Kind`: `none`, `user-request`, or `post-review`; its `Status`: `none`, `prepared`, or `applied`.
- `Agreement boundary`: `none`, `fit-check`, or `agreement`.
- `Post-review step`: `not-started`, `follow-up-routing`, `dimension-retrospective`, `authoring-retrospective`, `spec-reconciliation`, `hardening-stamp`, or `done`.

`Autonomous handover` and `Artifact edited` use raw `yes` or `no`. `Verifier stamp` is raw `none` or `sha256:` plus 12 lowercase hexadecimal characters. A persisted skeptic verdict in either dispatch mode is `CONFIRMED`, `REFUTED`, or `JUDGMENT_CALL`.


## Authoritative checkpoint

`.tmp/revise-state.md`, not conversation memory, is authoritative at every round boundary. Use this complete shape, with code path tables replaced by the plan or spec scope field described below when appropriate:

```markdown
# Revise state

Artifact type: code
Artifact JSON: "logical feature changeset"
Resolved scope JSON: "code base abc1234; exact path set below"
Scope decision JSON: "explicit commit range plus controller-coordinated fixes"
Autonomous handover: yes
Status: reviewing
Agreement boundary: none
Post-review step: not-started
Failure: none
Round: 5
Round status: in-flight
Verifier launches: 0
Verifier stamp: none
Artifact fingerprint: sha256:a1b2c3d4e5f6
Artifact edited: yes

## Dimension cells

| Cell ID | Dimension UTF-8 hex | Cell kind | Cluster UTF-8 hex | Delivery scope | Predecessor cell IDs | Status | N/A reason UTF-8 hex | Certified fingerprint |
|---|---|---|---|---|---|---|---|---|
| correctness/cluster-parser | 436f72726563746e657373 | local | 706172736572 | local-slice | none | active | none | none |
| security/whole-scope | 5365637572697479 | cross-cutting | 77686f6c652d73636f7065 | whole-scope | none | inactive | none | sha256:a1b2c3d4e5f6 |

## Resolved code paths

| UTF-8 path hex |
|---|
| 7372632f612e6a73 |
| 74657374732f612e746573742e6a73 |

## Local slice paths

| Cell ID | UTF-8 path hex |
|---|---|
| correctness/cluster-parser | 7372632f612e6a73 |
| correctness/cluster-parser | 74657374732f612e746573742e6a73 |

## Agents

| Role | Cell ID | Session ID UTF-8 hex | Status | Repair attempts |
|---|---|---|---|---:|
| reviewer | correctness/cluster-parser | 73657373696f6e2d343132 | in-flight | 0 |
| skeptic | correctness/cluster-parser/finding-1 | 73657373696f6e2d353837 | in-flight | 0 |

## Acknowledgements and caveats

- None.

## User requests

- None.

## Applied changes

- Text JSON: "Correctness: fixed empty-input validation; scope unchanged."

## Follow-ups

| Follow-up ID | Status | Route | Text UTF-8 hex | Evidence UTF-8 hex |
|---|---|---|---|---|
| followup/parser-helper | open | none | 45787472616374207061727365722076616c69646174696f6e2068656c7065722e | none |

## Prior failures

- None.

## Post-review work items

- None.

## Pending controller mutation

Mutation ID: none
Kind: none
Item ID: none
Target: none
Intent: none
Success check: none
Status: none
Evidence: none
```

Never interpolate reviewer, skeptic, controller, user, path, or provider text directly into Markdown structure. Outside tables, persist every arbitrary text scalar as one canonical JSON string literal on the same physical line under a field ending in `JSON`. Use `JSON.stringify`, which escapes CR, LF, quotes, and backslashes, and use `JSON.parse` before semantic validation on resume. Persist arbitrary table values only as lowercase UTF-8 hex, with raw `none` as the absent sentinel. Enum tokens, positive integers, fingerprints, and restricted IDs remain raw. List sections contain either `- None.` or one `- Text JSON: {canonical-json-string}` per item. Reject `- Text JSON: "None."` as a reserved empty-list lookalike; only the raw `- None.` line represents an empty list.

Restricted controller-minted IDs and stable cell IDs must match `^[a-z0-9][a-z0-9._/-]{0,115}$`. The 116-character cell limit keeps encoded cell IDs within payload filename bounds. A finding ID is derived rather than independently minted: it is exactly its current owning cell ID plus `/finding-<positive-one-based-reviewer-result-index>`. The derived suffix does not use the cell length cap, so a finding ID may exceed 116 characters. Validate each finding ID against its exact owning cell ID and reviewer result order whenever checkpoint results are persisted, resumed, or selected for repair. In the Agents table, `Cell ID` contains a stable cell ID for a reviewer row and the derived finding ID for a skeptic row. Every other restricted stable ID remains subject to the 116-character grammar. `Predecessor cell IDs` is `none` or an ordinal-sorted, single-space-separated list of stable cell IDs. Serialize Dimension cells by ordinal Cell ID, Resolved code paths by ordinal encoded path, and Local slice paths by the ordinal tuple `(Cell ID, encoded path)`. Use the same serializer for the delivery-only projection. Reject malformed JSON, malformed hex, duplicate decoded identities, noncanonical row order, and raw multiline scalar content as an invalid checkpoint or incomplete cell. Never parse a line created from agent text. Exact repository paths exist only in reversible hex path tables.

A field with a raw `none` sentinel switches to a corresponding `... JSON` field before carrying arbitrary text. For example, `Failure: none` becomes `Failure JSON: "..."`.

For plan and spec, Dimension cells use `Delivery scope: whole-artifact`, omit the code path tables, and store the one artifact path as lowercase UTF-8 hex under `Resolved scope UTF-8 hex`.

### Atomic replacement and field lifetimes

Every state and result replacement is atomic and creates no second authority. Write the complete next contents to `.tmp/revise-state.next.md` or `.tmp/revise-round-result.next.md` in the same directory, validate the schema and round, fingerprint, and map relationships, then atomically rename it over the canonical file. A crash before rename leaves the prior checkpoint authoritative. Never read a leftover `.next.md`; overwrite it on the next staged replacement. A crash after rename exposes a complete checkpoint. Persist result cells before a state transition or agent-row update that depends on them. This rule covers boundary rewrites, partial merges, repair counters, user requests, and pending mutations.

`Agreement boundary` is the only durable agreement-related field. It records a required resume action, never approval. Do not persist an agreement target, governing scopes, candidate or candidate token, digest, source bytes, response, semantic verdict or evidence, agreement record or other authority, or a satisfied flag. Those values remain solely in the active volatile controller context owned by `skills/spec-agreement/SKILL.md`.

Require the field exactly once in every current-schema checkpoint and accept only the three raw enum values. A missing field, duplicate field, JSON variant, or any other value is an invalid checkpoint and fails closed; never default it to `none`.

Artifact identity, scope decisions, autonomy mode, acknowledgements, user requests, applied changes, follow-ups, and prior failures persist until successful cleanup or a user-authorized restart rule says otherwise. Convergence fields are the verifier counters and stamp, the full cell lifecycle, lineage, certifications, and exact encoded scope maps. Round fields are round number, round status, fingerprint, Agents rows, and `.tmp/revise-round-result.md`.

The state file marks the single active run. Do not add an ownership token or lock. An unfinished `reviewing` or `post-review` state with the same artifact and logical scope is a resume candidate. A state file written by the phase-model schema (a raw `Phase:` header field or an `Attempts this phase` column) is never migrated: set `Status: failed` with `Failure JSON: "pre-wave state file; not migrated"` and offer restart or abandon. Surface unfinished state for different work instead of overwriting it. There is no persisted complete status because successful completion deletes the state.

### Boundary templates

Map every transition to one of these templates:

- `Start round`: fail with current diagnostics when the next round would exceed 30. Otherwise calculate the next round, launch fingerprint, and immutable canonical delivery-map snapshot, and the replacement Agents section in memory. The Agents section has exactly one reviewer row for every active cell (or exactly one verifier row for a verifier round), session ID `none`, `in-flight`, zero repairs, and no prior-round rows. Atomically replace the result scratch with its matching cell-empty header and snapshot, then atomically rewrite state with the same identities and map bytes, replacement Agents, `Artifact edited: no`, and `Round status: in-flight`. Dispatch only after both checkpoints match. Clearing `Artifact edited` here gives the flag its wave-era meaning: a reviewable edit made after the last reconciled launch (the reconciliation that precedes every launch has just accounted for all prior edits in the ledger), replacing the phase model's per-phase reset so the unexplained-drift branch keeps its discriminating power.
- `Reactivate stale cells`: applies only at an all-inactive boundary where the staleness sweep changes something. In one atomic state rewrite: set every cell whose `Certified fingerprint` differs from the current fingerprint to `Status: active` with `Certified fingerprint: none`; re-evaluate every N/A declaration in both directions, changing a contradicted N/A to active with no certification, demoting a no-longer-applicable cell to N/A with a newly evaluated nonblank encoded reason and `Certified fingerprint: none`, and preserving an inapplicable cell as N/A only after re-evaluating and encoding its nonblank reason. If the rewrite would leave the applicable set empty, set `Status: failed` with current diagnostics instead. If it activated at least one cell, `Start round`; a demotion-only rewrite proceeds directly to the boundary resolution below.
- `Launch verifier`: applies only at wave convergence with `Round status: evaluated` or `idle`. Fail with current diagnostics when verifier launches would exceed 10. Otherwise increment `Verifier launches` and apply `Start round` as a verifier round: the single cell is `verifier/whole-artifact`, model pin opus, holistic-gate payload.
- `Restart run`: preserve the current `Agreement boundary` until the normal entry gate succeeds; never clear a prior `fit-check` or `agreement` marker as part of restart. Set `Status: reviewing`, `Post-review step: not-started`, `Failure: none`, round 0, `Round status: idle`, `Verifier launches: 0`, `Verifier stamp: none`, current fingerprint, and `Artifact edited: no`; clear Agents and post-review work items and pending mutation; delete the prior result scratch; make every applicable cell active with `Certified fingerprint: none` and N/A reason `none`, preserving an inapplicable cell as N/A only after re-evaluating and encoding its nonblank reason; preserve artifact and scope identity, acknowledgements, user requests, applied changes, follow-ups, and prior failures; copy the prior failure into Prior failures. Run the normal entry gate and write `Agreement boundary: none` only after an exact match, validated compatible refresh, renewed agreement replacement, or `not-applicable` result succeeds.

New-run creation occurs only after the public entry gate succeeds on an exact match, validated compatible refresh, renewed agreement replacement, or `not-applicable` result. It then writes the identity and empty persistent sections, pre-seeds acknowledgements and caveats from the artifact profile, sets `Agreement boundary: none`, and initializes the same counters and cell states as `Restart run`. A reviewable post-review mutation returns to `reviewing`, resets the post-review step and its work items, clears the completed mutation, clears `Verifier stamp` to `none`, and refreshes the fingerprint so the staleness sweep drives re-review. Partial results set result status `partial`, keep the round in flight, update Agents and result cells by stable cell or derived finding ID as appropriate, and preserve every completed result. A fully repaired and adjudicated result sets round status `evaluated`, result status `usable`, and all Agents rows `completed`. Failure preserves diagnostic round and convergence fields. Successful finalization deletes state, payload, result, patch, and staging scratch files.

At every evaluated boundary with all applicable cells inactive, resolve the next transition in one boundary rewrite, sweep first: `Reactivate stale cells` runs the staleness sweep (reactivation, N/A promotion and demotion, empty-set failure) and starts the next round when it activated cells; wave convergence without a current stamp applies `Launch verifier`; wave convergence with `Verifier stamp` equal to the current fingerprint enters `post-review`. On resume, a reviewing state with every applicable cell inactive resolves the same way after session reconciliation; a stable checkpoint cannot remain reviewing with every applicable cell inactive, current certifications, no verifier row in flight, and no transition taken.

## Round result and delivery snapshot

Initialize `.tmp/revise-round-result.md` with:

```markdown
# Revise round result

Round: 5
Artifact fingerprint: sha256:a1b2c3d4e5f6
Status: awaiting-results
```

Immediately append `## Delivery map snapshot`. For code, its cell table contains only `Cell ID`, `Dimension UTF-8 hex`, `Cell kind`, `Cluster UTF-8 hex`, and `Delivery scope`, in ordinal Cell ID order, followed by byte-for-byte copies of the canonical Resolved code paths and Local slice paths tables. It excludes predecessor IDs, lifecycle status, N/A reason, and certifications. For plan and spec, use the same delivery-only cell projection and encoded `whole-artifact` scope. State and snapshot bytes come from the same serializer. The projection is immutable for that round and precedes all result cells.

Persist each completed or repairable cell in reviewer order with this shape:

```markdown
## Cell: correctness/cluster-parser

Dimension JSON: "Correctness"
Cell kind: local
Cluster JSON: "parser"
Status: needs-verification
LGTM: no
Verified note JSON: "Traced both parser validation branches against the delivered patch."
Reviewer session ID JSON: "session-412"

### Finding: correctness/cluster-parser/finding-1

Summary JSON: "Empty input bypasses validation."
Location JSON: "internal/revise/revise-round.workflow.js"
Evidence JSON: "The early return precedes the input guard."
Verification status: needs-retry
Issue JSON: "skeptic execution failed"
Skeptic session ID JSON: "session-587"
```

For manual completion-driven fan-out, persist a usable reviewer with findings before skeptic submission as `Status: needs-verification`, `LGTM: no`, its nonblank verified note, and its reviewer Session ID. Each finding keeps its derived ID, summary, location, and evidence and initially has exactly:

```text
Verification status: awaiting-verification
Skeptic session ID: none
```

`awaiting-verification` is created before skeptic submission, refreshed only by replacing the raw `none` sentinel with the returned skeptic Session ID, replaced by the existing complete verified shape when that skeptic returns valid output, or replaced by the existing `needs-retry` shape when the associated work is missing, rejected, invalid, or unavailable under the existing repair rules. It is scoped to the current round, fingerprint, delivery snapshot, cell, finding, and Session ID. Round abandonment or supersession invalidates it. Resume treats it as pending, never as a verified disposition. When the last required skeptic becomes verified and no finding remains `needs-retry`, the same result replacement sets the cell to `Status: usable`.

A clean cell has `Status: usable`, `LGTM: yes`, a nonblank decoded verified note, and no findings. A verified finding replaces `Issue JSON` with an allowed `Verdict`, nonblank `Reason JSON`, raw `Runtime owned: yes|no`, and raw `Live probe performed: yes|no`. It then carries exactly one probe-evidence form: `Live probe evidence: none` when no probe was performed, or `Live probe evidence JSON: "<canonical nonblank evidence for every relevant execution context>"` when one was performed. Reject a performed probe with missing or blank evidence, an unperformed probe with evidence, any missing classification field, and any other contradictory combination as an incomplete skeptic result. A finding whose verdict was shared through a recorded dedup judgment additionally carries raw `Shared verdict from: <derived-finding-id>` naming the verified sibling; a finding verified by its own skeptic omits the line. Persist the complete verdict, classification, normalized probe evidence, and any shared-verdict reference together; resume, repair, and adjudication preserve that complete unit. A `needs-reviewer` cell retains identity fields, status, and nonblank `Issue JSON`, but omits LGTM, note, and findings. A present session uses its `... Session ID JSON`; an unavailable session uses raw `... Session ID: none`. Stable cell IDs and their exact derived finding IDs bind results to lineage and repair counters. A result whose round, fingerprint, or exact snapshot differs from state is stale and contributes no cells.

Before setting a round in flight, calculate the next identities, snapshot, and Agents in memory. Replace the cell-empty result first, then state. If a crash leaves the next-round header while state still names the prior evaluated round, the header is an orphan and contributes nothing; the next `Start round` replaces it. If state was rewritten and the matching empty result remains, recover only missing reviewer cells through bounded repair without changing the round. A fresh missing-cell launch is a repair launch.

## Fingerprints, drift, and resume

For plan and spec, load `${CLAUDE_PLUGIN_ROOT}/skills/spec-agreement/spec-agreement.js` and call its `selectArtifact` with selector kind `design-before-hardening` and empty selectors, then call `hashSelection`. Store `sha256:` plus the first 12 hexadecimal characters of the returned `contentHash`. The shared controller is the sole owner of eligible design selection and hashing; do not duplicate its scanner, selector, normalization, or hash pipeline. A `Status:` line is eligible design content and is never excluded. For code, fingerprint the generated cumulative review patch with `sha256sum` and retain the first 12 hexadecimal characters. That cumulative-patch fingerprint remains only the review drift hint and never supplies agreement identity. Check the applicable fingerprint at round launch, round return, and every reviewing resume.

For idle-state drift, no round conclusion exists to discard. If `Artifact edited` and the latest applied-change entry account for the edit, or the user confirms it interactively, record any missing ledger entry, set `Artifact edited: yes`, clear `Verifier stamp` to `none` if set, refresh fingerprint and code map atomically, and regenerate delivery; prior certifications are now stale against the moved fingerprint, so the staleness sweep drives re-review with current cell states preserved until then. Interactive rejection or unresolved ambiguity applies scope disposition and records the abandonment. Autonomous handover records unexplained idle drift as an abandonment entry and continues the same way. A resolved-scope-map change without a fingerprint move follows the same path: clear `Verifier stamp` to `none` if set, and at the next boundary reactivate every affected cell with `Certified fingerprint: none` (whole-scope and cross-cutting cells on any map change, local cells on slice-membership change), re-evaluating N/A applicability in both directions, because delivered content changed even though the patch fingerprint did not. The persisted scope map itself is rewritten only in the reconciling boundary's rewrite, never at detection, so a resume between detection and the reconciling boundary re-derives the same map change by comparing the persisted map against the freshly resolved current one.

If the fingerprint changes while agents are in flight, discard the round: results tied to the old identity contribute nothing. Record the abandoned round in Applied changes, clear `Verifier stamp` to `none` if set, refresh fingerprint and delivery, and continue; the moved fingerprint stales prior certifications, and the staleness sweep re-reviews every settled cell. If evaluated-state drift is clearly accounted for by `Artifact edited` and the latest applied-change entry, refresh fingerprint and delivery and continue without changing cell statuses. Otherwise ask in interactive mode: confirmation records the missing entry and refreshes; rejection or unresolved ambiguity applies scope disposition and records the abandonment. Autonomous handover records unexplained abandonment and continues. A crash after an edit but before its ledger entry follows the unexplained path. Do not add per-edit hashes, immutable round directories, or mutation journals.

For an unchanged-fingerprint in-flight resume, render the delivery-only projection from state and compare it byte-for-byte with the result snapshot. If projected bytes changed, discard all current-round results and rows, record delivery-map round abandonment without changing `Artifact edited`, and invoke `Start round` for the next round. Mutable lifecycle changes excluded from the projection do not invalidate results. If identities match, preserve every complete reviewer result and complete canonical skeptic verification, including classification, probe evidence, and any shared-verdict reference, then repair only missing cells. Because state becomes in flight only after the matching result header and snapshot exist, no valid `Start round` crash can leave in-flight state with mismatched result identity.

Never resume an agent across fingerprint, projected map, or round changes. A missing, expired, unsupported, or terminal session uses a fresh replacement as the next permitted repair. Session tracking is only an optimization.

`Status: failed` never auto-resumes. A later invocation reports `Failure` and offers explicit retry or abandon. For execution-repair exhaustion, a user-authorized retry whose round, fingerprint, and snapshot still match sets status reviewing, clears Failure, resets only the affected stable cell repair counter, marks it `needs-retry`, and preserves all completed results. Identity mismatch follows drift abandonment. For a round-cap or verifier-cap failure, a user-authorized restart records the failure and invokes `Restart run`. Explicit abandon shows the retained failure, then deletes only review scratch. Autonomous handover cannot authorize retry or abandon and stops for user disposition.

## User requests and controller mutations

`## User requests` contains `- None.` or a table with `Request ID`, `Status`, `Text UTF-8 hex`, and `Evidence UTF-8 hex`. If a reviewable request arrives while agents are in flight, mint a stable semantic request ID, atomically append a pending encoded row with evidence `none`, and do not edit the artifact. Consumed rows persist until cleanup.

After the round is fully evaluated and before convergence or another launch, drain pending requests by ordinal Request ID. If the requested outcome is already satisfied, atomically mark it consumed with encoded evidence and no applied-change entry. Otherwise persist one Pending controller mutation with a stable mutation ID, `Kind: user-request`, owning request ID, nonblank `Target JSON`, `Intent JSON`, and `Success check JSON`, `Status: prepared`, and `Evidence: none`. After applying or recovering the edit, one atomic state rewrite marks the request consumed with evidence, appends its Applied changes entry, sets `Artifact edited: yes`, clears `Verifier stamp` to `none` if set, and clears the mutation. Reconcile scope, fingerprint, map, delivery projection, payloads, and cumulative patch before any launch.

The Pending controller mutation serializes one user-request or post-review side effect. Recover it before general drift handling. A prepared mutation runs its persisted success check. If satisfied, record it applied without repeating the side effect; otherwise inspect the exact target and perform it once only when still safe. An applied mutation re-verifies evidence before completing its owner. Complete the owner and clear the mutation in one atomic rewrite. Malformed records, owner-kind mismatch, an unobservable success check, or unexpected target content follows the normal interactive or autonomous ambiguity rule.

### Governing agreement boundary

The exact durable enum is `Agreement boundary: none|fit-check|agreement`. It is a fail-closed resume cursor only. Use the artifact profile's agreement-impact rule to decide whether a completed controller batch can alter a governing artifact, governing set, selected target, or plan declaration. The shared agreement controller remains the only owner of candidate construction, governing resolution, structural comparison, source-diff construction, and fit-verdict validation. Do not duplicate mapping or classification logic in this engine or an artifact profile.

At each agreement-relevant evaluated-round or post-review boundary, finish controller fixes and pending user requests as one complete mutation batch. First durably record every adjudicated review fix. Then drain every pending request that has arrived through the end of the drain, applying or recovering each through the common controller-mutation protocol. Do not reconstruct or classify between edits. If a request that arrives after the drain remains pending, block dispatch, drain another complete batch, and classify the resulting final state before proceeding.

After the complete batch and before any resolution, reconstruction, or fit evaluation, atomically rewrite the checkpoint to `Agreement boundary: fit-check`. Invoke `${CLAUDE_PLUGIN_ROOT}/skills/spec-agreement/SKILL.md` in `post-mutation` phase with the originating request mode, reconstruct exactly once and classify exactly once for that stable complete batch, and retain all candidate, digest, response, verdict, evidence, and authority data only in its volatile controller context. Mechanical drift or ambiguity is a boundary failure, not permission to read a partly old tuple or perform incremental classifications.

Keep `Agreement boundary: fit-check` through reconstruction, comparison, semantic classification, and compatible-state replacement. If current authority cannot continue, atomically rewrite the checkpoint to `Agreement boundary: agreement` before rendering uncertainty or changed-contract evidence, rendering a digest, or waiting for a user response. Keep `agreement` while a response, reconstruction, renewed agreement replacement, or its storage remains unresolved. Only after an exact match, validated compatible refresh, renewed agreement replacement, or `not-applicable` result has succeeded may one atomic checkpoint replacement restore `Agreement boundary: none`. Complete that write before any dispatch or transition.

While the marker is `fit-check` or `agreement`, prohibit every reviewer, skeptic, verifier, post-review, planning, implementation, or downstream dispatch. Also block those dispatches while a controller mutation or user request remains pending. All reconstruction, classification, and volatile-state storage failures retain the last non-`none` marker and dispatch nothing. If the first `fit-check` rewrite itself fails while `none` remains on disk, the durable applied-change ledger or pending request still makes the batch unresolved; retry `fit-check` before any dispatch. Any later failed boundary rewrite leaves the prior successfully written non-`none` marker authoritative.

Resume derives only the artifact identity, resolved review scope, and artifact-specific request mode from durable state. It always reruns normal target and governing-set resolution against current bytes. `fit-check` reruns post-mutation classification. `agreement` re-enters the gate and presents again unless separately retained same-session state, after current reconstruction, exactly proves the renewed approval. `none` runs the normal entry gate and never authorizes dispatch by itself. If volatile replacement succeeded and interruption occurred before writing `none`, safe replay reconstructs the current tuple, takes exact continuation, and only then clears the marker.

The six atomic-rewrite interruption states are executable resume cases:

- An interruption before writing `fit-check` leaves the durable mutation batch unresolved; resume writes `fit-check` before reconstruction or dispatch.
- An interruption after writing `fit-check` reruns complete post-mutation resolution, reconstruction, and classification.
- An interruption before writing `agreement` leaves `fit-check`; resume repeats classification, then writes `agreement` before any rendering or wait.
- An interruption after writing `agreement` re-enters fresh presentation unless current same-session state proves renewed agreement after reconstruction.
- An interruption before writing `none` leaves the last non-`none` marker; resume replays exact, compatible, renewed, or not-applicable continuation before clearing it.
- An interruption after writing `none` runs the normal entry gate, verifies there is no unresolved batch or pending request, and only then permits dispatch.

## Dispatch and repair

Workflow and manual modes deliver the same common context plus only one cell's assigned criteria. Encode the UTF-8 bytes of each stable cell ID as lowercase hex and use the flat path `.tmp/revise-payload-{hex-cell-id}.md`. This mapping is injective on case-sensitive and case-insensitive file systems, and a slash-bearing ID never becomes a directory. For example, `correctness/cluster-parser` maps to `.tmp/revise-payload-636f72726563746e6573732f636c75737465722d706172736572.md`. Begin each payload with round, fingerprint, stable cell ID, canonical dimension name, cell kind, cluster, and exact encoded slice paths, then the complete common context and only that profile dimension's complete criteria.

Before every original or repair dispatch, render the complete expected payload from state, map, context, and profile. If it is missing or differs byte-for-byte, write `.tmp/revise-payload-{hex-cell-id}.next.md`, validate every required section and exact bytes, atomically rename it over the canonical payload, and compare once more. Identity-header agreement alone is insufficient. Ignore leftover staging files, remove payloads no longer named by the map, and remove all payload and staging files on cleanup or abandon.

Common context contains project context, relevant inlined project-instruction excerpts, the PATTERNS index when present, artifact identity and delivery, acknowledgements and caveats, profile additional rules, and the operating-context section (the rigor profile) unchanged from the artifact under review (the spec body for revise-spec; each referenced upstream spec for revise-plan, including any declared tier divergence as a flag). Reviewers calibrate findings against the declared rigor tier as a grounding input, not a review outcome: a declared `high` tier over minimal validation/recovery/compatibility/observability machinery, or a declared `low` tier over heavy machinery the profile does not warrant, is expected to be flagged as a finding in the design-soundness or requirements dimension, directing the author to conform the mechanism to the warranted rigor. That calibration channel is how the profile acts as an active design input; whether fresh reviewers reliably surface either mismatch is a runtime-owned behavior, not settled by repository prose. Tell reviewers to verify ambiguous instructions against the working tree, consult linked pattern files only when the index signals relevance, report high-confidence issues only, and provide a concrete verification note even for LGTM.

### Skeptic evidence contract

Workflow and manual modes dispatch one fresh skeptic for every finding and accept `CONFIRMED`, `REFUTED`, or `JUDGMENT_CALL` with concrete evidence and a nonblank reason. One exception, available only through the Workflow path's dedup judge, trims redundant verification: when a recorded dedup judgment establishes that a finding makes the same claim about the same code as a finding already under verification in the same round, the duplicate shares that sibling's fresh skeptic verdict instead of dispatching another skeptic. The shared verdict is recorded on each duplicate with a reference to the verified sibling, and an uncertain, failed, or unavailable dedup judgment falls back to a fresh skeptic, never to a skipped verification. A shared verdict that lands retryable leaves every finding sharing it retryable. Manual dispatch has no dedup judge: the manual controller submits one fresh skeptic per finding and the exception never arises there. Both modes normalize every verified result to the same complete shape: status, verdict, reason, runtime-owned classification, live-probe-performed classification, and normalized live-probe evidence, with null or the raw `none` checkpoint form when no probe was performed. Runtime-owned literals or formats cannot be refuted from repository or design-record evidence because those records can be stale against the live system. Both modes classify whether the claim is runtime-owned and whether a live probe covered every relevant execution context. A performed probe requires concrete nonblank structured evidence for every relevant execution context; an unperformed probe carries no probe evidence. If a runtime-owned `REFUTED` result clearly has no performed probe, normalize it to `JUDGMENT_CALL` with a probe recommendation. If claim ownership, probe coverage, or evidence consistency is unclear or contradictory, leave the skeptic result retryable. Only a live probe in every relevant execution context can support `REFUTED` for a runtime-owned claim. Any probe must reproduce the real module or script scope, framework call path, and execution context. Uncoordinated reviewer convergence raises verification priority, not truth.

### Workflow path

Prefer the Workflow tool when it and the script are available. Invoke `${CLAUDE_PLUGIN_ROOT}/internal/revise/revise-round.workflow.js` once after `Start round` with only:

```json
{
  "round": 5,
  "fingerprint": "sha256:a1b2c3d4e5f6",
  "dimensions": [
    {
      "id": "correctness/cluster-parser",
      "name": "Correctness",
      "payloadFile": "<absolute encoded payload path>"
    }
  ],
  "model": "<artifact profile pin>"
}
```

Do not pass payload content inline. The original stable cell ID is the sole uniqueness and reconciliation key; duplicate display names are valid. Require the Workflow invocation contract's exact input types, unique restricted cell IDs, nonblank names and paths, and valid fingerprint. After a Workflow batch returns, compare state with the result scratch's round, fingerprint, and exact delivery-map snapshot before persisting usable cells and repairable gaps. Keep the round in flight while resuming or replacing gaps. The Workflow starts every input cell as a concurrent reviewer-to-skeptic operation: one original reviewer per cell, followed immediately by one fresh skeptic per finding from that reviewer while unrelated reviewers may still be in flight. Before dispatching a skeptic, the Workflow runs a low-effort dedup judge against the findings already under verification this round and shares the sibling's verdict on a match (surfaced as `sharedVerdictFrom` on the duplicate finding, persisted as the finding's shared-verdict reference), per the skeptic evidence contract. The judge's candidate set depends on reviewer completion timing, so a resumed round may re-run dedup judges against a different set and re-derive a different sharing topology; every path still ends in a fresh skeptic verdict, so resume variance affects dispatch cost and sharing bookkeeping, never verification coverage. A `needs-reviewer` cell or a `needs-retry` finding is repairable, not a conclusion.

### Manual Agent path

If Workflow or its script is unavailable, or Workflow fails, use the active Agent tool only when it exposes background submission and individually attributable completion notifications carrying the same canonical Session ID returned by submission. Inspect that exposed interface before the first manual submission in the started round. If either primitive is absent, set `Status: failed`, retain `Round status: in-flight`, round, fingerprint, delivery snapshot, result header, and every pre-created in-flight reviewer Agents row with Session ID `none`, and set `Failure JSON: "manual immediate dispatch is unsupported by the active Agent tool"`. Dispatch nothing. A user-authorized retry clears Failure, restores `Status: reviewing`, repeats the inspection, and resumes the unchanged round. After successful inspection, submit every retained reviewer row whose Session ID is `none` back-to-back through the initial reviewer submission sequence before observing any completion. Never restore the reviewer-batch barrier.

If any required checkpoint write, schema validation, or atomic rename fails during manual dispatch, stop before any further agent submission or completion observation. The last successfully renamed canonical result and state checkpoints remain authoritative. Report the failed checkpoint operation and error. If an atomic state replacement still succeeds without changing canonical result authority, set `Status: failed` with `Failure JSON: "<failed checkpoint operation and error>"`. A user-authorized retry whose canonical round, fingerprint, and delivery snapshot still match clears Failure, restores `Status: reviewing`, reconciles the last successfully renamed result and state under unchanged-fingerprint in-flight resume, and resumes only missing work; an identity mismatch follows drift abandonment.

At initial manual dispatch, submit one fresh background `Explore` reviewer for every active stable cell with the profile model pin. Each reviewer reads only its exact payload and has no prior context. Issue all reviewer submissions back-to-back, persist each returned canonical Session ID in its existing Agents row, then observe the host's normal completion notifications across the full in-flight reviewer set. A rejected or identity-less reviewer submission does not stop the initial loop: attempt every remaining original reviewer submission before checkpointing the rejection, observing completions, or launching any repair. After all original reviewer submissions have been attempted, replace the result first with a complete `needs-reviewer` cell for each rejected submission: retain its identity fields, set `Issue JSON: "reviewer submission failed or returned no canonical Session ID"`, use raw `Reviewer session ID: none`, and omit LGTM, note, and findings. Then replace state to set each matching reviewer Agents row to Status `needs-retry`, Session ID `none`, and its unchanged zero repair count. The existing selector increments that stable counter only immediately before launching the fresh repair. A separate resume handle never replaces the canonical Session ID; session resume remains the existing best-effort optimization.

When one reviewer completion arrives, accept it only when its Session ID matches the current in-flight reviewer row and the round, fingerprint, and delivery snapshot still match. Validate and normalize the complete response before processing another completion. A clean usable reviewer completes its row and launches no skeptic. An incomplete or contradictory response becomes `needs-reviewer` and launches no skeptic until normal bounded repair produces a usable response.

For a usable reviewer with findings, assign `<cell-id>/finding-<one-based-result-index>` and atomically persist the complete reviewer cell with every finding in `awaiting-verification` before launching skeptic work. Then replace state by completing that reviewer row and appending one in-flight skeptic Agents row with Session ID `none` for every derived finding. This result-first then state ordering makes every required verification durable before submission, so interruption recovery can identify and repair only missing skeptic work.

Submit all fresh skeptics for that reviewer back-to-back. The sibling submission loop performs only request construction and submission: collect returned skeptic Session IDs in memory and do not checkpoint, wait, adjudicate, or perform unrelated work between sibling submissions. After every sibling submission call has been initiated, replace the result to persist every returned skeptic Session ID and replace each rejected or identity-less finding with the complete existing `needs-retry` shape, using `Issue JSON: "skeptic submission failed or returned no canonical Session ID"` and raw `Skeptic session ID: none`. Then replace state with returned IDs in successful in-flight skeptic Agents rows and set each rejected row to Status `needs-retry`, Session ID `none`, and its unchanged zero repair count before observing any skeptic completion. The existing selector increments that stable counter only immediately before launching the fresh repair.

Whenever bounded repair selects a reviewer or skeptic row, atomically increment its stable repair counter from `k` to `k+1` before dispatch, as required by the existing repair rules. If a reviewer repair submission returns canonical Session ID `R`, replace the result first so the same complete `needs-reviewer` cell carries Reviewer session ID `R`, then replace state so its reviewer Agents row carries Session ID `R`, Status `in-flight`, and repair count `k+1`. If that submission is rejected or identity-less, replace the result first with the complete `needs-reviewer` cell, `Issue JSON: "reviewer repair submission failed or returned no canonical Session ID"`, and raw `Reviewer session ID: none`, then replace state so the reviewer row has Session ID `none`, Status `needs-retry`, and repair count `k+1`. If a skeptic repair submission returns canonical Session ID `S`, replace the finding's retry shape first with `Verification status: awaiting-verification`, remove `Issue JSON`, persist Skeptic session ID `S`, and keep the enclosing cell `needs-verification`; then replace state so its skeptic Agents row carries Session ID `S`, Status `in-flight`, and repair count `k+1`. If that submission is rejected or identity-less, replace the result first with the complete `needs-retry` finding, `Issue JSON: "skeptic repair submission failed or returned no canonical Session ID"`, and raw `Skeptic session ID: none`, then replace state so the skeptic row has Session ID `none`, Status `needs-retry`, and repair count `k+1`. Observe no repair completion before both replacements finish. Failure of either post-submission checkpoint follows the existing checkpoint-failure rule and unchanged-identity reconciliation before any further completion observation or agent dispatch.

Continue observing unfinished reviewers and skeptics together. Match every completion to the current in-flight Agents row by Session ID. Persist a normalized skeptic verdict through the shared evidence contract, mark that skeptic row completed, and make its cell usable in the same result replacement that records the final required verified skeptic when no finding remains `needs-retry`. Missing, rejected, invalid, or unavailable work follows the existing bounded repair path. A completion from an abandoned or superseded Session ID is stale and changes neither results nor counters.

Controller interruption, drift, and explicit abandon retain the existing best-effort semantics. Resume preserves complete reviewer results, verified skeptic results, and live matching `awaiting-verification` work when the host still exposes the persisted Session ID. On unchanged-identity resume, reconcile these cases in order:

- **Reviewer result persisted before skeptic rows.** When a durable `needs-verification` cell has valid derived findings but state still has its reviewer row in flight and lacks their skeptic rows, replace the result first to change each missing finding from `awaiting-verification` to `needs-retry` with `Issue JSON: "skeptic submission missing after checkpoint interruption"`, then replace state to mark the reviewer row completed and append one skeptic Agents row per missing finding ID with Status `needs-retry`, Session ID `none`, and zero repairs. The existing selector atomically increments that stable skeptic repair counter before launching its fresh replacement.
- **Skeptic row exists without a submitted session.** If an `awaiting-verification` finding and its matching in-flight skeptic Agents row both have Session ID `none`, replace the result to set the finding to `needs-retry` with the same interruption issue, then replace state to set that existing row to Status `needs-retry` while preserving its repair counter.
- **Result-owned pending session.** Before result-recovery transitions or repair selection, reconcile each current-identity result-owned pending session against its matching Agents row whether that row is `in-flight` or `needs-retry`. The reviewer form is a `needs-reviewer` cell with a non-`none` Reviewer session ID, and the skeptic form is an `awaiting-verification` finding with a non-`none` Skeptic session ID.
  - **Live session.** When the host still exposes that exact session, atomically copy the result-owned ID into the row, set the row to Status `in-flight`, preserve its repair counter, and exclude it from repair selection and later result-recovery transitions during this resume.
  - **Unavailable session.** Replace the result first: keep the reviewer form `needs-reviewer` but set `Issue JSON: "reviewer session unavailable during checkpoint resume"` and raw `Reviewer session ID: none`, or replace the skeptic form with the complete `needs-retry` shape using `Issue JSON: "skeptic session unavailable during checkpoint resume"` and raw `Skeptic session ID: none` while keeping its cell `needs-verification`. Then replace state to set the matching row to Status `needs-retry`, Session ID `none`, and its preserved repair counter. Only after both unavailable-session replacements succeed may repair selection include that row.

  Session reconciliation neither resets nor increments the repair counter.
- **Reviewer needs retry with neither side owning a session.** If a current `needs-reviewer` cell with raw Reviewer session ID `none` matches an in-flight reviewer Agents row with Session ID `none`, rewrite only that row to Status `needs-retry` while preserving its repair counter. The durable result is already authoritative, so do not rewrite it; an atomic state-write failure leaves the same pair for the next resume.
- **Reviewer result cleared but its row owns a session.** If a current `needs-reviewer` cell with raw Reviewer session ID `none` matches an in-flight reviewer Agents row with a non-`none` Session ID, rewrite only that row to Status `needs-retry`, Session ID `none`, and its preserved repair counter. The durable result is already authoritative, so do not rewrite it; an atomic state-write failure leaves the same pair for the next resume. The cleared reviewer row rejects the old Session ID as stale.
- **Skeptic retry still owns its row's session.** If a current `needs-retry` finding with a non-`none` Skeptic session ID matches an in-flight skeptic Agents row with that same Session ID, replace the result first to set its raw `Skeptic session ID: none`, then replace state to set that row to Status `needs-retry`, Session ID `none`, and its preserved repair counter.
- **Skeptic retry cleared but its row owns a session.** If a current `needs-retry` finding with raw Skeptic session ID `none` matches an in-flight skeptic Agents row with a non-`none` Session ID, rewrite only that row to Status `needs-retry`, Session ID `none`, and its preserved repair counter; an atomic state-write failure leaves the same pair for the next resume.
- **Skeptic retry with neither side owning a session.** If a current `needs-retry` finding with raw Skeptic session ID `none` matches an in-flight skeptic Agents row with Session ID `none`, rewrite only that row to Status `needs-retry` while preserving its repair counter. The durable result is already authoritative, so do not rewrite it; an atomic state-write failure leaves the same pair for the next resume.
- **Durably completed work.** Before observing completions or selecting repairs, atomically mark any other in-flight reviewer Agents row completed only when its matching stable cell and Session ID have either a clean usable cell or a `needs-verification` cell with a fully normalized usable reviewer response, never `needs-reviewer`; mark an in-flight skeptic Agents row completed when its matching derived finding ID and Session ID have a complete canonical verification.

After this reconciliation, only missing reviewer or skeptic work becomes repairable. This procedure adds no stronger task-retirement, replay, acknowledgement, deadline, identity, or exactly-once guarantee.

The manual controller may add direct verification evidence for a plan or spec finding only when a re-read establishes an objective quoted contradiction, symbol presence, or literal. That evidence supplements adjudication and never replaces the fresh skeptic verdict required for every reported finding; even an objectively verified finding still goes to a fresh skeptic. When verdicts on different framings of one issue conflict, scope the fix to the core a CONFIRMED verdict evidenced and acknowledge the refuted framing.

### Repair rules

Four safety rules are absolute:

1. A cell cannot become inactive without a clean-review LGTM conclusion with a concrete nonblank verification rationale against the current fingerprint. Only a current verifier round that applies no fix and creates an authoritative deferred follow-up may stamp without the same clean LGTM conclusion over the whole artifact.
2. Every reported finding must receive a fresh skeptic verdict before adjudication, including a finding with objective controller evidence. A finding covered by a recorded Workflow-path dedup judgment satisfies this through the shared verdict of its verified sibling, per the skeptic evidence contract; the dedup judgment never substitutes for the verdict itself.
3. Objective controller verification may supplement adjudication but never replaces the required fresh skeptic verdict. A finding cannot be treated as refuted without concrete skeptic verification and a nonblank reason from that skeptic.
4. Results tied to an outdated round, fingerprint, or delivery snapshot cannot affect review state.

Everything else is repairable within the stable cell's three-launch budget. Record incomplete, contradictory, or oddly formatted output. The first repair resumes the same agent for narrow clarification when its session and review identity remain valid. Clarification can supply missing rationale or resolve format ambiguity, but cannot ask a reviewer to retract a disputed finding. Normalize a complete clarification. If still unusable, use fresh replacements for later repairs. If the session is unavailable, the first repair is fresh.

Count every clarification or replacement launch against the stable cell's three-attempt execution-repair budget.
Use the same agent for the first repair launch when its session is available and the review identity still matches; use fresh replacements for later unresolved repairs.
When no repair attempt remains, fail the run before launching another agent.
An unresolved clarification remains retryable while budget remains and cannot manufacture LGTM or refutation.

Increment the repair counter atomically before dispatch. A round, fingerprint, or snapshot mismatch follows abandonment rather than consuming repairs. Retry only the missing reviewer cell or the skeptic cell whose finding is `needs-retry`; preserve every completed reviewer and skeptic result. An uncertain cell remains active while budget remains. Exhaustion of any limit is terminal until explicit disposition.

For a `needs-verification` cell, repair only findings still marked `needs-retry`. Validate each derived finding ID against its current owning cell and reviewer result order before selecting it. Resume the skeptic first when its session is valid; otherwise launch a fresh manual replacement. Normalize and merge the complete canonical verification without relaunching the reviewer or completed skeptics; never merge only verdict and reason while dropping classification, probe evidence, or the shared-verdict reference. Key reviewer repairs by dimension cell ID and skeptic repairs by the validated derived finding ID, never by optional session ID or display name.

Do not edit reviewable content until every required cell is usable and each finding has a permitted verified disposition. Keep round status in flight through partial results and repairs. Only after the barrier is complete may the controller set the result usable, adjudicate all findings, and set the round evaluated. Immediate dispatch changes scheduling only; controller adjudication, dimension transitions, follow-up routing, and reviewable artifact edits remain behind this whole-round barrier.

## Adjudication and round boundary

For each verified finding, validate the canonical classification and probe-evidence fields again before choosing a disposition. Controller adjudication cannot treat a runtime-owned claim as refuted unless `Live probe performed: yes` has nonblank evidence covering every relevant execution context. A missing or contradictory field returns the finding to `needs-retry` instead of producing a disposition.

Then adjudicate:

- If confirmed and small enough to fix within the edit surface, apply the fix at the round boundary, run the profile post-fix steps, record the applied change immediately, set `Artifact edited: yes`, and keep that cell active.
- If valid but beyond an inline artifact edit, create an authoritative open Follow-ups row with a stable ID, encoded text, route and evidence `none`, and record a narrow acknowledgement or caveat. Keep the cell active.
- If refuted, record a reasoned acknowledgement only.
- If a judgment call is intentionally accepted, record the acknowledgement and, as an authoritative open Follow-ups row, any actionable follow-up required. This acceptance disposition applies only to a finding whose skeptic verdict is JUDGMENT_CALL; a confirmed finding always takes one of the two confirmed routes above.
- At the round boundary every finding-bearing cell remains active, including one whose skeptic-verified findings all landed as refuted or as acknowledgement-only accepted judgment calls. Its reasoned acknowledgements enter the next payload.
- Only an LGTM cell with a nonblank concrete verification note becomes inactive, certifying the reviewed fingerprint.

Another cell's edit does not directly reactivate an inactive sibling; fingerprint movement reactivates only through the staleness sweep at an all-inactive boundary, and a resolved-scope-map change clears affected certifications directly at the boundary that reconciles it. If removing review-added machinery undoes another cell's accepted fix, this is a controller-coordinated reviewable edit: record the applied change and preserve current cell dispositions; the moved fingerprint stales the affected certifications and the sweep re-reviews them.

After any fix that adds, removes, or relocates a member of a set the artifact presents as closed, sweep every enumeration of that set before the next round. Regenerate delivery and reconcile the live artifact, scope, fingerprint, and ledger before launch. Re-read the live artifact when a finding appears to duplicate a prior-round fix.

After every evaluated round, report what changed and which cells became inactive or remain active, then atomically persist the boundary. Drain user requests into the same complete controller mutation batch as the adjudicated fixes. When the artifact profile marks that batch agreement-relevant, resolve the governing agreement boundary before continuing. Only with `Agreement boundary: none`, no pending request or mutation, and a current successful normal entry or post-mutation gate result may the controller resolve the transition per the boundary templates: `Reactivate stale cells`, `Launch verifier`, post-review entry, or `Start round`.

## Holistic gate

The verifier is one fresh agent per launch with stable cell ID `verifier/whole-artifact`, model pin opus for every artifact type, dispatched as a verifier round through the same Workflow or manual path as reviewers, with the same skeptic evidence contract, repair budget, and checkpoint shapes. Its result cell uses `Cell kind: verifier` and `Cluster JSON: "whole-artifact"` with the standard cell shapes otherwise. Its payload uses the standard encoded payload path and begins with round, fingerprint, and cell identity, then the complete common context and the holistic charter: review the entire artifact at this fingerprint for cross-dimension coherence, gaps between the profile dimensions' lenses, and completion-worthiness; report high-confidence findings only; a clean LGTM conclusion requires a concrete nonblank verification note.

Adjudicate verifier findings with the standard disposition rules. At the verifier boundary: if at least one fix was applied, the fingerprint increments once, spawned consequences and applied changes are recorded exactly as at a reviewer round boundary, `Verifier stamp` stays `none`, and the staleness sweep resumes the run. A clean LGTM conclusion records `Verifier stamp` as the current fingerprint and enters `post-review` with its concrete note as the rationale. If every finding was refuted or accepted as an acknowledgement-only judgment call, the stamp stays `none` and the next boundary launches another fresh verifier against the same fingerprint; its reasoned acknowledgements enter the next payload. Only a current verifier round that applies no fix and creates an authoritative deferred follow-up may stamp without a clean LGTM; that follow-up is an authoritative Follow-ups row, and one atomic rewrite records the stamp and enters `post-review` with the acknowledgements and deferred follow-up as its rationale.

The verifier never launches before wave convergence and never stamps a fingerprint other than the one it reviewed. A stamp whose fingerprint no longer matches the current fingerprint is stale and authorizes nothing.

## Post-review tail

Entering post-review sets `Status: post-review`, `Post-review step: not-started`, and Post-review work items to `- None.`. Every artifact runs `follow-up-routing`, `dimension-retrospective`, and `authoring-retrospective` in that order. A plan then runs `spec-reconciliation` and `hardening-stamp`; a spec runs `hardening-stamp`; code proceeds to `done`. Live-claim probing remains handover behavior and is not part of this tail.

Before each step, enumerate its complete current work set and assign stable semantic item IDs independent of list position. Atomically replace `- None.` with a table containing `Step`, `Item ID`, `Status`, and `Evidence UTF-8 hex`. New rows are pending with evidence `none`. Follow-up routing includes only authoritative open rows and reuses their IDs. Dimension-retrospective rows use stable cell IDs. Singleton actions use fixed semantic IDs. Before completing a step, reconcile its authoritative source set and append newly appeared IDs; never delete completed rows because ordering changed.

Before a mutating item, persist one controller mutation with a stable ID, `Kind: post-review`, matching item ID, nonblank `Target JSON`, `Intent JSON`, and `Success check JSON`, `Status: prepared`, and `Evidence: none`. Apply one item at a time. After mutation, set `Status: applied` and replace the sentinel with nonblank `Evidence JSON`. Then atomically mark the work item completed with the same encoded evidence and clear the mutation. A stamp refresh is a separate item from the artifact or spec edit that required it.

On resume, recover prepared and applied mutations through the common protocol. With no mutation pending, select the first ordinal pending stable ID and never select a completed row. Read-only or safely repeatable checks need no mutation but must persist completed evidence before another item. Text and tracking success checks prove intended content exists exactly once. Commit checks identify commit and paths. Stamp checks match current scope and content fingerprint. When all rows are complete, atomically advance `Post-review step` and reset work items to `- None.`.

Before stamping and before cleanup, recompute the fingerprint. Drift returns to reviewing, resets the post-review step, records the edit, clears work items, the completed mutation, and `Verifier stamp`, and lets the staleness sweep reactivate every cell whose certification predates the current fingerprint. Persist step, work item, and mutation checkpoints before side effects. Any post-review action that changes reviewable content follows this same restart. Provenance-only stamp appends do not restart review. Delete scratch only after `Post-review step: done` and the final fingerprint check succeeds.

### Follow-up routing

For each valid deferred finding, the authoritative Follow-ups row remains open until routed. In an interactive standalone run, propose `address-now`, `track`, or `skip` with a reason and ask for bulk approval or per-item overrides. Completing the work item atomically sets the row resolved with its final route and encoded evidence, completes the item, and clears the mutation. Check tracking files for an existing entry before adding one. Resolved rows persist across an address-now edit and the required re-review.

In autonomous handover, do not prompt or invent a final route. Propose one of the three routes, then prepare a post-review mutation that atomically adds one canonical JSON line to `.tmp/handover-followups.md`. The item contains decoded artifact type and identity as `source`, the follow-up ID as `sourceItemId`, exact decoded follow-up text, and proposed route. Its success check proves exactly one item with the same `(source, sourceItemId)`. After that check, one atomic state rewrite marks the follow-up handed-off, route `handover`, records transfer evidence, completes the work item, and clears the mutation. Recovery checks the composite key before writing, so a crash cannot duplicate it. Resolved and handed-off rows persist across review restarts; later routing steps enumerate only open rows.

### Dimension retrospective

Review coverage gaps, independent convergence on the same issue, repeated false positives, signal-to-noise, and missing context. Run the profile retrospective extras. Route shared mechanics improvements to this file and dimension-specific improvements to the artifact profile. Edit the Nightshift clone, show and explain proposed workflow-instruction changes, apply only with user approval, and leave pushing to the user.

### Authoring retrospective

For each confirmed finding, ask whether a cheap, always-applicable authoring habit would have prevented the whole class. Promote only a recurring pattern or a near-zero-cost universal habit. State promoted rules as principles, not a list tied to the triggering finding. Route project rules to project instructions or patterns; workflow rules follow the approval flow, and third-party skill guidance lands in project instructions instead of editing third-party files.

Report the first-round confirmed-finding count per artifact type with promoted habits or a stated null outcome. The workflow keeps no cross-run ledger; this per-run count lets accumulated reports show whether authoring habits reduce findings.

### Artifact-specific final work

Plan Spec Reconciliation sorts findings by whether a correction to a durable contract, invocation, assumption, or design decision would otherwise disappear with the plan. Present each spec-worthy edit as readable current and proposed text for approval. Apply localized corrections only, refresh the spec stamp as a separate work item, and route design changes to follow-up. State explicitly when no upstream spec exists or nothing reconciles.

Plan and spec hardening preserve the exact profile stamp literals and use the profile's durable 8-character provenance recipe only after all other work has landed. Do not commit an artifact solely for stamping.

## Edit and delivery rules

- During reviewing, edit only the artifact under review and the exceptions named by its profile. Post-review routing and artifact-specific steps use their explicit edit surfaces.
- Document reviewers read the full file once for context, focus on named headings, use targeted reads above 400 lines, and treat surrounding sections as context rather than findings. Each reviewer reads one cell payload containing common context plus only its assigned criteria.
- Code delivery follows `code.md`, including scope resolution, cumulative patch regeneration, canonical shard mapping, and slice-union proof.
- Report the complete applied-change summary and any declined requests to cut load-bearing reasoning after successful cleanup.
