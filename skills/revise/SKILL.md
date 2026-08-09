---
name: revise
description: Shared fresh-agent review engine behind the revise-code, revise-plan, and revise-spec commands (the user entry points). Invoked with a first-argument artifact type (code, plan, or spec) followed by the scope; not called directly by users.
---

# revise

Fresh-agent review phases shared by three artifact types. This file owns how the run, phases, rounds, checkpoints, repairs, and post-review tail work. The artifact parameter files beside it own what to review.

## Invocation

The first argument token selects `code`, `plan`, or `spec`. Everything after it is the scope interpreted by the matching parameter file. Read that file before any review action:

- `code` -> `code.md`
- `plan` -> `plan.md`
- `spec` -> `spec.md`

The parameter file supplies scope resolution, dimensions, model pin, pre-seed sources, delivery rules, additional prompt rules, post-fix steps, edit surface, retrospective extras, and artifact-specific post-review work. If the first token is missing or invalid, ask which artifact type is meant.

## Review lifecycle

Define and apply these terms consistently:

- A run is the complete review and post-review process for one logical artifact and resolved scope.
- A phase begins with every applicable dimension active.
- A round launches one fresh reviewer for each currently active dimension against the current artifact fingerprint.
- An explicit clean conclusion with a concrete nonblank verification rationale makes that dimension inactive for the rest of the phase.
- A finding that causes an accepted artifact edit dirties the phase and keeps its dimension active.
- Any other controller-coordinated reviewable-content edit also dirties the phase, while preserving each dimension's current active or inactive state until the next phase.
- A finding that causes no artifact edit keeps its dimension active until a later fresh reviewer returns a clear clean conclusion.
- A REFUTED finding records a reasoned acknowledgement and no follow-up or applied-change entry. A valid-but-deferred finding records both its actionable follow-up and the acknowledgement or caveat that prevents repeated review noise, with no applied-change entry. Neither disposition dirties the phase or counts as a clean conclusion.
- Another dimension's later edit never reactivates an inactive dimension inside the same phase.
- A newly contradicted N/A justification becomes applicable immediately so the current phase cannot complete without reviewing it.

Once every applicable dimension is inactive, complete one convergence-boundary checkpoint. That single atomic checkpoint records the current phase as `Last converged phase`, increments `Converged phases` only when the current phase was not already recorded, and either enters `post-review` or invokes `Start phase` for the next phase. A phase abandoned because its fingerprint drifted before every applicable dimension became inactive increments the phase number for auditability but does not change `Converged phases` or `Last converged phase`.

Phase 1 cannot complete the review stage.
Phase 2 or later completes only after at least two phases have converged and the current phase ended with every applicable dimension inactive and no reviewable-content changes.

Phase 1 always advances to phase 2. A clean phase enters `post-review` only after the updated `Converged phases` is at least 2. A dirty phase, and a clean phase whose updated count is below 2, advances to a new phase with every applicable dimension active.

### Limits and enum values

The limits are 10 original reviewer launches per stable dimension or shard cell per phase, 10 phases, and 3 execution-repair launches per stable reviewer or skeptic cell. No limit path can manufacture LGTM or refutation.

An original reviewer launch increments its stable dimension or shard cell's phase attempt counter before dispatch; a cell already at 10 fails the run before any round agents launch.
A transition that would start phase 11 fails the run while preserving phase 10 diagnostics.

The original reviewer dispatch is not a repair launch. Every later same-session clarification or fresh replacement launch increments the stable reviewer or skeptic cell's repair counter before dispatch. A repair counter already at 3 fails the run before another agent launches. Phase 10 can enter post-review when it satisfies the clean-phase completion rule.

Use only these values:

- Run `Status`: `reviewing`, `post-review`, or `failed`.
- `Round status`: `idle`, `in-flight`, or `evaluated`.
- Dimension `Status`: `active`, `inactive`, or `N/A`. An N/A row requires a nonblank encoded reason; active and inactive rows require raw `none`.
- Agent `Status`: `in-flight`, `completed`, or `needs-retry`.
- Round-result `Status`: `awaiting-results`, `partial`, or `usable`.
- Follow-up `Status`: `open`, `handed-off`, or `resolved`; `Route`: `none`, `handover`, `address-now`, `track`, or `skip`. Open rows use route and evidence `none`; handed-off rows use `handover` and nonblank encoded transfer evidence; resolved rows use one of the three final routes and nonblank encoded disposition evidence.
- User-request `Status`: `pending` or `consumed`. Pending rows use evidence `none`; consumed rows require nonblank encoded evidence.
- Post-review work-item `Status`: `pending` or `completed`.
- Pending controller mutation `Kind`: `none`, `user-request`, or `post-review`; its `Status`: `none`, `prepared`, or `applied`.
- `Post-review step`: `not-started`, `follow-up-routing`, `dimension-retrospective`, `authoring-retrospective`, `spec-reconciliation`, `hardening-stamp`, or `done`.

`Autonomous handover` and `Phase changed` use raw `yes` or `no`. A persisted skeptic verdict in either dispatch mode is `CONFIRMED`, `REFUTED`, or `JUDGMENT_CALL`.

Re-evaluate every N/A declaration at each phase boundary. Change a contradicted N/A to active with zero attempts immediately.

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
Post-review step: not-started
Failure: none
Phase: 2
Converged phases: 1
Last converged phase: 1
Round: 5
Round status: in-flight
Artifact fingerprint: sha256:a1b2c3d4e5f6
Phase changed: yes

## Dimension cells

| Cell ID | Dimension UTF-8 hex | Cell kind | Cluster UTF-8 hex | Delivery scope | Predecessor cell IDs | Status | N/A reason UTF-8 hex | Attempts this phase |
|---|---|---|---|---|---|---|---|---:|
| correctness/cluster-parser | 436f72726563746e657373 | local | 706172736572 | local-slice | none | active | none | 2 |
| security/whole-scope | 5365637572697479 | cross-cutting | 77686f6c652d73636f7065 | whole-scope | none | inactive | none | 1 |

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

Stable IDs must match `^[a-z0-9][a-z0-9._/-]{0,115}$`. `Predecessor cell IDs` is `none` or an ordinal-sorted, single-space-separated list of stable IDs. Serialize Dimension cells by ordinal Cell ID, Resolved code paths by ordinal encoded path, and Local slice paths by the ordinal tuple `(Cell ID, encoded path)`. Use the same serializer for the delivery-only projection. Reject malformed JSON, malformed hex, duplicate decoded identities, noncanonical row order, and raw multiline scalar content as an invalid checkpoint or incomplete cell. Never parse a line created from agent text. Exact repository paths exist only in reversible hex path tables.

A field with a raw `none` sentinel switches to a corresponding `... JSON` field before carrying arbitrary text. For example, `Failure: none` becomes `Failure JSON: "..."`.

For plan and spec, Dimension cells use `Delivery scope: whole-artifact`, omit the code path tables, and store the one artifact path as lowercase UTF-8 hex under `Resolved scope UTF-8 hex`.

### Atomic replacement and field lifetimes

Every state and result replacement is atomic and creates no second authority. Write the complete next contents to `.tmp/revise-state.next.md` or `.tmp/revise-round-result.next.md` in the same directory, validate the schema and phase, round, fingerprint, and map relationships, then atomically rename it over the canonical file. A crash before rename leaves the prior checkpoint authoritative. Never read a leftover `.next.md`; overwrite it on the next staged replacement. A crash after rename exposes a complete checkpoint. Persist result cells before a state transition or agent-row update that depends on them. This rule covers boundary rewrites, partial merges, repair counters, user requests, and pending mutations.

Artifact identity, scope decisions, autonomy mode, acknowledgements, user requests, applied changes, follow-ups, and prior failures persist until successful cleanup or a user-authorized restart rule says otherwise. Phase fields are the phase and convergence counters, dirty flag, full dimension-cell lifecycle and lineage, and exact encoded scope maps. Round fields are round number, round status, fingerprint, Agents rows, and `.tmp/revise-round-result.md`.

The state file marks the single active run. Do not add an ownership token or lock. An unfinished `reviewing` or `post-review` state with the same artifact and logical scope is a resume candidate. Surface unfinished state for different work instead of overwriting it. There is no persisted complete status because successful completion deletes the state.

### Boundary templates

Map every transition to one of these templates:

- `Start phase`: before changing phase fields, fail with current diagnostics when the requested phase exceeds 10. Otherwise set the requested phase, `Phase changed: no`, round 0, `Round status: idle`, and current fingerprint; clear Agents; delete the prior result scratch; make every applicable dimension or shard cell active with zero attempts and N/A reason `none`; preserve an inapplicable cell as N/A only after re-evaluating and encoding its nonblank reason.
- `Start round`: preflight every active dimension or shard cell. If any already has 10 attempts, set `Status: failed`, record the exhausted cell and last unresolved issue, and dispatch nothing. Otherwise calculate the next round, launch fingerprint, immutable canonical delivery-map snapshot, incremented phase attempts, and replacement Agents section in memory. The Agents section has exactly one reviewer row for every active cell, session ID `none`, `in-flight`, zero repairs, and no prior-round rows. Atomically replace the result scratch with its matching cell-empty header and snapshot, then atomically rewrite state with the same identities and map bytes, incremented attempts, replacement Agents, and `Round status: in-flight`. Dispatch only after both checkpoints match.
- `Restart run`: set `Status: reviewing`, `Post-review step: not-started`, `Failure: none`, phase 1, `Converged phases: 0`, and `Last converged phase: 0`; clear post-review work items and pending mutation; preserve artifact and scope identity, acknowledgements, user requests, applied changes, follow-ups, and prior failures; copy the prior failure into Prior failures; then apply `Start phase` for phase 1.

New-run creation writes the identity and empty persistent sections, pre-seeds acknowledgements and caveats from the artifact profile before phase 1, initializes the same counters as `Restart run`, and invokes `Start phase` for phase 1. Normal dirty advance, clean convergence below two phases, and drift abandonment use `Start phase`. A reviewable post-review mutation returns to `reviewing`, resets the post-review step and its work items, clears the completed mutation, and uses `Start phase`. Partial results set result status `partial`, keep the round in flight, update Agents and result cells by stable ID, and preserve every completed result. A fully repaired and adjudicated result sets round status `evaluated`, result status `usable`, and all Agents rows `completed`. Failure preserves diagnostic phase and round fields. Successful finalization deletes state, payload, result, patch, and staging scratch files.

At phase convergence, compute the updated convergence counter, `Last converged phase`, and destination in one boundary rewrite. On resume, if a reviewing state has every applicable dimension inactive, compare `Last converged phase` with `Phase`, count the phase only if they differ, and enter post-review or perform the same `Start phase` advance. A stable checkpoint cannot remain reviewing with every applicable dimension inactive.

## Round result and delivery snapshot

Initialize `.tmp/revise-round-result.md` with:

```markdown
# Revise round result

Phase: 2
Round: 5
Artifact fingerprint: sha256:a1b2c3d4e5f6
Status: awaiting-results
```

Immediately append `## Delivery map snapshot`. For code, its cell table contains only `Cell ID`, `Dimension UTF-8 hex`, `Cell kind`, `Cluster UTF-8 hex`, and `Delivery scope`, in ordinal Cell ID order, followed by byte-for-byte copies of the canonical Resolved code paths and Local slice paths tables. It excludes predecessor IDs, lifecycle status, N/A reason, and attempts. For plan and spec, use the same delivery-only cell projection and encoded `whole-artifact` scope. State and snapshot bytes come from the same serializer. The projection is immutable for that round and precedes all result cells.

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
Location JSON: "skills/revise/revise-round.workflow.js"
Evidence JSON: "The early return precedes the input guard."
Verification status: needs-retry
Issue JSON: "skeptic execution failed"
Skeptic session ID JSON: "session-587"
```

A clean cell has `Status: usable`, `LGTM: yes`, a nonblank decoded verified note, and no findings. A verified finding replaces `Issue JSON` with an allowed `Verdict` and nonblank `Reason JSON`. A `needs-reviewer` cell retains identity fields, status, and nonblank `Issue JSON`, but omits LGTM, note, and findings. A present session uses its `... Session ID JSON`; an unavailable session uses raw `... Session ID: none`. Stable cell and finding IDs bind results to lineage and repair counters. A result whose phase, round, fingerprint, or exact snapshot differs from state is stale and contributes no cells.

Before setting a round in flight, calculate the next identities, snapshot, attempts, and Agents in memory. Replace the cell-empty result first, then state. If a crash leaves the next-round header while state still names the prior evaluated round, the header is an orphan and contributes nothing; the next `Start round` replaces it, and persisted attempts do not advance. If state was rewritten and the matching empty result remains, preserve the incremented phase attempt and recover only missing reviewer cells through bounded repair without changing the round or original attempt. A fresh missing-cell launch is a repair launch.

## Fingerprints, drift, and resume

For plan and spec, fingerprint reviewable content with the handover recipe, retaining 12 hexadecimal characters:

```bash
awk '/^## Hardening$/{exit} !/^Status:/' <artifact-path> | sha256sum | cut -c1-12
```

Store `sha256:<digest>`. For code, fingerprint the generated cumulative review patch with `sha256sum` and retain the first 12 hexadecimal characters. The fingerprint is a drift hint within one temporary run, not durable provenance. Check it at round launch, round return, and every reviewing resume.

For idle-state drift, no round conclusion exists to discard. If `Phase changed` and the latest applied-change entry account for the edit, or the user confirms it interactively, record any missing ledger entry, set `Phase changed: yes`, refresh fingerprint and code map atomically, regenerate delivery, and remain in the phase at round 0 with current dispositions and attempts. Interactive rejection or unresolved ambiguity abandons the phase conservatively. Autonomous handover records unexplained idle abandonment and invokes `Start phase` with the next phase and current fingerprint.

If the fingerprint changes while agents are in flight, discard the round, record the abandoned dirty phase in Applied changes, leave convergence counters unchanged, invoke `Start phase` with the next phase and new fingerprint, and regenerate delivery. If evaluated-state drift is clearly accounted for by `Phase changed` and the latest applied-change entry, refresh fingerprint and delivery and continue the same dirty phase without changing dimension statuses. Otherwise ask in interactive mode: confirmation records the missing entry, dirties and refreshes the same phase; rejection or unresolved ambiguity applies scope disposition and conservative phase abandonment. Autonomous handover records unexplained abandonment and advances phase. A crash after an edit but before its ledger entry follows the unexplained path. Do not add per-edit hashes, immutable round directories, or mutation journals.

For an unchanged-fingerprint in-flight resume, render the delivery-only projection from state and compare it byte-for-byte with the result snapshot. If projected bytes changed, discard all current-round results and rows, record delivery-map round abandonment without changing phase or `Phase changed`, and invoke `Start round` for the next round with existing phase attempts preserved before normal increments. Mutable lifecycle changes excluded from the projection do not invalidate results. If identities match, preserve every complete reviewer result and skeptic verdict, then repair only missing cells. Because state becomes in flight only after the matching result header and snapshot exist, no valid `Start round` crash can leave in-flight state with mismatched result identity.

Never resume an agent across fingerprint, projected map, phase, or round changes. A missing, expired, unsupported, or terminal session uses a fresh replacement as the next permitted repair. Session tracking is only an optimization.

`Status: failed` never auto-resumes. A later invocation reports `Failure` and offers explicit retry or abandon. For execution-repair exhaustion, a user-authorized retry whose phase, round, fingerprint, and snapshot still match sets status reviewing, clears Failure, resets only the affected stable cell repair counter, marks it `needs-retry`, and preserves all completed results. Identity mismatch follows drift abandonment. For a dimension-attempt or phase-cap failure, a user-authorized restart records the failure and invokes `Restart run`. Explicit abandon shows the retained failure, then deletes only review scratch. Autonomous handover cannot authorize retry or abandon and stops for user disposition.

## User requests and controller mutations

`## User requests` contains `- None.` or a table with `Request ID`, `Status`, `Text UTF-8 hex`, and `Evidence UTF-8 hex`. If a reviewable request arrives while agents are in flight, mint a stable semantic request ID, atomically append a pending encoded row with evidence `none`, and do not edit the artifact. Consumed rows persist until cleanup.

After the round is fully evaluated and before convergence or another launch, drain pending requests by ordinal Request ID. If the requested outcome is already satisfied, atomically mark it consumed with encoded evidence without dirtying the phase. Otherwise persist one Pending controller mutation with a stable mutation ID, `Kind: user-request`, owning request ID, nonblank `Target JSON`, `Intent JSON`, and `Success check JSON`, `Status: prepared`, and `Evidence: none`. After applying or recovering the edit, one atomic state rewrite marks the request consumed with evidence, appends its Applied changes entry, sets `Phase changed: yes`, and clears the mutation. Reconcile scope, fingerprint, map, delivery projection, payloads, and cumulative patch before any launch.

The Pending controller mutation serializes one user-request or post-review side effect. Recover it before general drift handling. A prepared mutation runs its persisted success check. If satisfied, record it applied without repeating the side effect; otherwise inspect the exact target and perform it once only when still safe. An applied mutation re-verifies evidence before completing its owner. Complete the owner and clear the mutation in one atomic rewrite. Malformed records, owner-kind mismatch, an unobservable success check, or unexpected target content follows the normal interactive or autonomous ambiguity rule.

## Dispatch and repair

Workflow and manual modes deliver the same common context plus only one cell's assigned criteria. Encode the UTF-8 bytes of each stable cell ID as lowercase hex and use the flat path `.tmp/revise-payload-{hex-cell-id}.md`. This mapping is injective on case-sensitive and case-insensitive file systems, and a slash-bearing ID never becomes a directory. For example, `correctness/cluster-parser` maps to `.tmp/revise-payload-636f72726563746e6573732f636c75737465722d706172736572.md`. Begin each payload with phase, round, fingerprint, stable cell ID, canonical dimension name, cell kind, cluster, and exact encoded slice paths, then the complete common context and only that profile dimension's complete criteria.

Before every original or repair dispatch, render the complete expected payload from state, map, context, and profile. If it is missing or differs byte-for-byte, write `.tmp/revise-payload-{hex-cell-id}.next.md`, validate every required section and exact bytes, atomically rename it over the canonical payload, and compare once more. Identity-header agreement alone is insufficient. Ignore leftover staging files, remove payloads no longer named by the map, and remove all payload and staging files on cleanup or abandon.

Common context contains project context, relevant inlined project-instruction excerpts, the PATTERNS index when present, artifact identity and delivery, acknowledgements and caveats, and profile additional rules. Tell reviewers to verify ambiguous instructions against the working tree, consult linked pattern files only when the index signals relevance, report high-confidence issues only, and provide a concrete verification note even for LGTM.

### Skeptic evidence contract

Workflow and manual modes dispatch one fresh skeptic for every finding and accept `CONFIRMED`, `REFUTED`, or `JUDGMENT_CALL` with concrete evidence and a nonblank reason. Runtime-owned literals or formats cannot be refuted from repository or design-record evidence because those records can be stale against the live system. Both modes classify whether the claim is runtime-owned and whether a live probe covered every relevant execution context. If a runtime-owned `REFUTED` result clearly relies only on repository or design-record evidence, normalize it to `JUDGMENT_CALL` with a probe recommendation. If claim ownership or probe coverage is unclear, leave the skeptic result retryable. Only a live probe in every relevant execution context can support `REFUTED` for a runtime-owned claim. Any probe must reproduce the real module or script scope, framework call path, and execution context. Uncoordinated reviewer convergence raises verification priority, not truth.

### Workflow path

Prefer the Workflow tool when it and the script are available. Invoke `${CLAUDE_PLUGIN_ROOT}/skills/revise/revise-round.workflow.js` once after `Start round` with only:

```json
{
  "phase": 2,
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

Do not pass payload content inline. The original stable cell ID is the sole uniqueness and reconciliation key; duplicate display names are valid. Require the Task 1 exact input types, unique restricted IDs, nonblank names and paths, and valid fingerprint. After a Workflow batch returns, compare state with the result scratch's phase, round, fingerprint, and exact delivery-map snapshot before persisting usable cells and repairable gaps. Keep the round in flight while resuming or replacing gaps. The Workflow launches one original reviewer per input cell and one skeptic per finding. A `needs-reviewer` cell or a `needs-retry` finding is repairable, not a conclusion.

### Manual Agent path

If Workflow or its script is unavailable, or Workflow fails, dispatch one fresh `Explore` reviewer per active stable cell in one batch with the profile model pin. Each agent reads its exact payload and has no prior context. After all usable reviewers return, assign each finding `<cell-id>/finding-<one-based-result-index>`, persist it, then dispatch one fresh skeptic per finding in one batch. Apply the shared skeptic evidence contract above. The controller accepts semantically equivalent prose and normalizes it, but does not coerce ambiguity or invent evidence.

The manual controller may add direct verification evidence for a plan or spec finding only when a re-read establishes an objective quoted contradiction, symbol presence, or literal. That evidence supplements adjudication and never replaces the fresh skeptic verdict required for every reported finding; even an objectively verified finding still goes to a fresh skeptic. When verdicts on different framings of one issue conflict, scope the fix to the core a CONFIRMED verdict evidenced and acknowledge the refuted framing.

### Repair rules

Four safety rules are absolute:

1. A dimension cannot become inactive without a clear clean-review conclusion and a concrete nonblank verification rationale against the current fingerprint.
2. Every reported finding must receive a fresh skeptic verdict before adjudication, including a finding with objective controller evidence.
3. Objective controller verification may supplement adjudication but never replaces the required fresh skeptic verdict. A finding cannot be treated as refuted without concrete skeptic verification and a nonblank reason from that skeptic.
4. Results tied to an outdated phase, round, fingerprint, or delivery snapshot cannot affect review state.

Everything else is repairable within the stable cell's three-launch budget. Record incomplete, contradictory, or oddly formatted output. The first repair resumes the same agent for narrow clarification when its session and review identity remain valid. Clarification can supply missing rationale or resolve format ambiguity, but cannot ask a reviewer to retract a disputed finding. Normalize a complete clarification. If still unusable, use fresh replacements for later repairs. If the session is unavailable, the first repair is fresh.

Count every clarification or replacement launch against the stable cell's three-attempt execution-repair budget.
Use the same agent for the first repair launch when its session is available and the review identity still matches; use fresh replacements for later unresolved repairs.
When no repair attempt remains, fail the run before launching another agent.
An unresolved clarification remains retryable while budget remains and cannot manufacture LGTM or refutation.

Increment the repair counter atomically before dispatch. A phase, round, fingerprint, or snapshot mismatch follows abandonment rather than consuming repairs. Retry only the missing reviewer cell or the skeptic cell whose finding is `needs-retry`; preserve every completed reviewer and skeptic result. An uncertain dimension remains active while budget remains. Exhaustion of any limit is terminal until explicit disposition.

For a `needs-verification` cell, repair only findings still marked `needs-retry`. Resume the skeptic first when its session is valid; otherwise launch a fresh manual replacement. Merge its verdict without relaunching the reviewer or completed skeptics. Key reviewer repairs by dimension cell ID and skeptic repairs by finding ID, never by optional session ID or display name.

Do not edit reviewable content until every required cell is usable and each finding has a permitted verified disposition. Keep round status in flight through partial results and repairs. Only after the barrier is complete may the controller set the result usable, adjudicate all findings, and set the round evaluated.

## Adjudication and round boundary

For each verified finding:

- If confirmed and small enough to fix within the edit surface, apply the fix at the round boundary, run the profile post-fix steps, record the applied change immediately, set `Phase changed: yes`, and keep that cell active.
- If valid but beyond an inline artifact edit, create an authoritative open Follow-ups row with a stable ID, encoded text, route and evidence `none`, and record a narrow acknowledgement or caveat. Keep the cell active.
- If refuted, record a reasoned acknowledgement only. Keep the cell active.
- If a judgment call is intentionally accepted, record the acknowledgement and any actionable follow-up required. Keep the cell active.
- Only an LGTM cell with a nonblank concrete verification note becomes inactive for the rest of the phase.

Another dimension's edit does not reactivate an inactive sibling. If removing review-added machinery undoes another dimension's accepted fix, this is a controller-coordinated reviewable edit: dirty the phase and preserve current cell dispositions. The mandatory next phase reactivates every applicable cell.

After any fix that adds, removes, or relocates a member of a set the artifact presents as closed, sweep every enumeration of that set before the next round. Regenerate delivery and reconcile the live artifact, scope, fingerprint, and ledger before launch. Re-read the live artifact when a finding appears to duplicate a prior-round fix.

After every evaluated round, report what changed and which cells became inactive or remain active, then atomically persist the boundary. Drain user requests. If all applicable cells are inactive, perform the single convergence checkpoint; otherwise `Start round` again.

## Post-review tail

Entering post-review sets `Status: post-review`, `Post-review step: not-started`, and Post-review work items to `- None.`. Every artifact runs `follow-up-routing`, `dimension-retrospective`, and `authoring-retrospective` in that order. A plan then runs `spec-reconciliation` and `hardening-stamp`; a spec runs `hardening-stamp`; code proceeds to `done`. Live-claim probing remains handover behavior and is not part of this tail.

Before each step, enumerate its complete current work set and assign stable semantic item IDs independent of list position. Atomically replace `- None.` with a table containing `Step`, `Item ID`, `Status`, and `Evidence UTF-8 hex`. New rows are pending with evidence `none`. Follow-up routing includes only authoritative open rows and reuses their IDs. Dimension-retrospective rows use stable cell IDs. Singleton actions use fixed semantic IDs. Before completing a step, reconcile its authoritative source set and append newly appeared IDs; never delete completed rows because ordering changed.

Before a mutating item, persist one controller mutation with a stable ID, `Kind: post-review`, matching item ID, nonblank `Target JSON`, `Intent JSON`, and `Success check JSON`, `Status: prepared`, and `Evidence: none`. Apply one item at a time. After mutation, set `Status: applied` and replace the sentinel with nonblank `Evidence JSON`. Then atomically mark the work item completed with the same encoded evidence and clear the mutation. A stamp refresh is a separate item from the artifact or spec edit that required it.

On resume, recover prepared and applied mutations through the common protocol. With no mutation pending, select the first ordinal pending stable ID and never select a completed row. Read-only or safely repeatable checks need no mutation but must persist completed evidence before another item. Text and tracking success checks prove intended content exists exactly once. Commit checks identify commit and paths. Stamp checks match current scope and content fingerprint. When all rows are complete, atomically advance `Post-review step` and reset work items to `- None.`.

Before stamping and before cleanup, recompute the fingerprint. Drift returns to reviewing, resets the post-review step, records the edit, clears work items and the completed mutation, and invokes `Start phase` with the next phase and current fingerprint. Persist step, work item, and mutation checkpoints before side effects. Any post-review action that changes reviewable content follows this same restart. Provenance-only stamp appends do not restart review. Delete scratch only after `Post-review step: done` and the final fingerprint check succeeds.

### Follow-up routing

For each valid deferred finding, the authoritative Follow-ups row remains open until routed. In an interactive standalone run, propose `address-now`, `track`, or `skip` with a reason and ask for bulk approval or per-item overrides. Completing the work item atomically sets the row resolved with its final route and encoded evidence, completes the item, and clears the mutation. Check tracking files for an existing entry before adding one. Resolved rows persist across an address-now edit and the required new review phase.

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
