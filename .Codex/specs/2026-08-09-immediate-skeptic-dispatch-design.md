# Immediate Skeptic Dispatch Design

Status: signed off 2026-08-09

## Goal

Reduce review latency by submitting skeptic verification as soon as each reviewer returns findings. Submit all reviewer requests at round start. When one reviewer completes, submit one fresh skeptic for each of that reviewer's findings without waiting for unrelated reviewers to finish.

The round remains the unit of adjudication. Immediate dispatch must not permit fixes, follow-up routing, dimension transitions, or artifact edits before every required reviewer and skeptic result in the round is usable.

That barrier preserves one evidence basis for the round. An early artifact edit would invalidate the fixed fingerprint used by unfinished reviewers and skeptics, while early adjudication would act before the round's complete evidence set is available.

## Current behavior

The shared skeptic contract already requires one fresh skeptic for every finding, but it does not state when that skeptic launches relative to other reviewers.

The Workflow script expresses review and verification as stages of a per-dimension `pipeline()`. This suggests completion-driven verification, but the guarantee is indirect and the test double processes complete dimension pipelines serially.

The manual Agent fallback explicitly waits for all usable reviewers before assigning finding IDs and dispatching skeptics. That reviewer-batch barrier is the behavior this change removes.

## Dispatch contract

At round start, submit every active reviewer before entering the completion-observation loop. Use a batch or parallel submission primitive when the host provides one. Otherwise issue the background submissions back-to-back without waiting for any reviewer result between calls.

When a reviewer completion is observed:

1. Validate and normalize its complete response.
2. For a usable response with findings, assign the existing derived finding IDs, `<cell-id>/finding-<one-based-result-index>`.
3. In manual mode, persist the reviewer result and pending skeptic records. In Workflow mode, retain them inside the current invocation until the completed cell returns.
4. Submit one fresh skeptic per finding back-to-back, without waiting for another reviewer, a sibling skeptic, or adjudication.
5. Resume observing both reviewers and skeptics.

All findings from one reviewer are handled as one fan-out. Here, "together" means the controller performs no unrelated wait or work between those sibling submissions. It does not require atomic scheduler admission or guarantee that a very fast sibling cannot finish while a host serializes later submission calls. A finite-capacity host may queue accepted work. Rejected submissions use the existing bounded repair path.

A clean usable reviewer launches no skeptic. An incomplete or contradictory reviewer response enters reviewer repair and launches no skeptic until a usable response exists.

The manual controller performs only required validation and checkpoint writes between observing a reviewer result and starting its skeptic fan-out. It does not adjudicate findings in that interval.

## Workflow mode

Replace the indirect two-stage `pipeline()` call with an explicit concurrent operation per dimension cell:

1. Start every dimension operation concurrently.
2. Within each operation, await that cell's reviewer.
3. When the reviewer returns usable findings, start all skeptic calls for that cell without awaiting sibling completion between calls.
4. Await that cell's skeptic fan-out and return the completed cell.

The outer operation awaits all dimension operations and reconciles returned cells by stable cell ID. Within each cell, reconcile returned skeptic results against the original derived finding IDs. Any missing result becomes `needs-retry` with issue `skeptic result was missing`; do not rely on result position or silently omit findings. Reviewer and skeptic normalization, evidence requirements, model selection, labels, payload isolation, finding IDs, and repair classifications remain unchanged.

Workflow metadata keeps the existing phase names and uses these exact values:

```javascript
description: 'One revise-loop round: concurrent reviewer-to-skeptic pipelines per active dimension',
phases: [
  { title: 'Review', detail: 'all active-dimension reviewers are submitted concurrently' },
  { title: 'Verify', detail: 'each finding fan-out is submitted when its reviewer returns, overlapping unfinished reviews' },
]
```

If the Workflow call rejects, no child result is accepted outside the returned Workflow result. Use the existing manual repair fallback for missing cells. A successful Workflow result with repairable gaps uses the existing per-cell repair rules. This change does not add a new Workflow invocation checkpoint protocol.

## Manual Agent mode

Keep the existing Agents table, session tracking, repair budgets, and best-effort recovery model. This design uses only the background submission and individual completion notifications already exposed by the active Agent tool. It does not introduce a cross-host adapter API, terminal-result replay or acknowledgement protocol, task-status model, or cancellation lifecycle. That boundary is deliberate: the repository has no cross-host Agent adapter surface, that migration remains separate work, and the requested scheduling guarantee needs only background submission, attributable completion, and stale-result rejection. In this section, `Session ID` means the single canonical background-agent identifier that submission returns and the host repeats on that agent's completion notification. Persist only that identifier in every existing Session ID field. A separate resume handle, when a host exposes one, does not replace it; resume remains the existing best-effort optimization.

At round start, issue one background reviewer submission per active cell back-to-back and persist each returned Session ID in the existing Agents row. Then observe the host's normal completion notifications across the in-flight set. When a reviewer completes, validate and persist its normalized result before doing any work for another completed agent.

If the reviewer has findings, create every pending finding record in one checkpoint write, then submit the corresponding fresh skeptics back-to-back. The pre-submission checkpoint makes every required verification durable, so interruption recovery can identify and repair only missing skeptic work. Collect returned skeptic Session IDs in memory during the sibling submission loop; do not checkpoint between sibling submissions. After every sibling submission call has been initiated, persist all returned identities in their findings and Agents rows before observing any completion. Do not wait for another reviewer or a sibling skeptic, and do not perform unrelated work between sibling submissions. Resume observing all unfinished reviewers and skeptics after the fan-out has been issued.

Before the first manual submission in a started round, inspect the active Agent tool interface for background submission plus completion notifications carrying the same Session ID. If either primitive is unavailable, persist `Status: failed`, retain `Round status: in-flight`, the existing phase, round, fingerprint, and delivery snapshot, plus every pre-created in-flight reviewer Agents row with Session ID `none`, and set `Failure JSON: "manual immediate dispatch is unsupported by the active Agent tool"`. A user-authorized retry clears Failure, restores `Status: reviewing`, repeats the same interface inspection, and resumes the unchanged round using those retained rows. After successful inspection, submit every retained reviewer row with Session ID `none` back-to-back through the initial reviewer-submission sequence before observing any completion. Do not silently restore the reviewer-batch barrier. This is an inspection of the exposed tool interface, not a new callable capability-discovery contract.

Initial and repair submissions persist result state before the corresponding Agents-row transition. On unchanged-identity resume, reconcile every result-owned pending reviewer or skeptic Session ID against its matching Agents row before selecting repairs, whether that row is `in-flight` or `needs-retry`. Preserve a still-live session and its repair counter; when unavailable, first convert the result to its role-specific retry form, then mark the row `needs-retry` with Session ID `none`. Reconciliation does not increment or reset repair counters, and no completion is observed until the dependent checkpoint writes succeed.

A completion is accepted only for the current phase, round, fingerprint, delivery snapshot, cell or finding, and persisted Session ID. Missing, rejected, invalid, or unavailable work follows the existing bounded repair path. A completion from an abandoned or superseded Session ID is stale and cannot change results or counters. Controller interruption, drift, and explicit abandon retain the existing best-effort semantics: persisted sessions may be resumed when the host still exposes them, otherwise only missing work is repaired, and late results are discarded. This change adds no stronger task-retirement or exactly-once recovery guarantee.

For a reviewer with findings, the partial cell has `Status: needs-verification`, `LGTM: no`, its nonblank verified note and reviewer session field, and one or more findings with this pending shape:

```markdown
### Finding: <derived-finding-id>

Summary JSON: "<nonblank summary>"
Location JSON: "<nonblank location>"
Evidence JSON: "<nonblank evidence>"
Verification status: awaiting-verification
Skeptic session ID: none
```

`awaiting-verification` is created before skeptic submission, refreshed only by persisting the returned skeptic identity, and replaced by the existing complete verified shape when that skeptic returns valid output. It remains scoped to the current round and finding. It is invalidated by round abandonment or supersession, and it becomes the existing `needs-retry` shape only when the associated work is missing, rejected, invalid, or unavailable under the existing repair rules. The controller and resume path treat it as pending, never as a verified disposition. When the last required skeptic becomes verified and no finding remains `needs-retry`, the same result update sets the enclosing cell to `Status: usable`.

## Round barrier

Immediate dispatch changes scheduling only:

- No finding is adjudicated before every required cell is usable and every finding has a permitted verified disposition.
- No reviewable artifact content changes while reviewers or skeptics are in flight.
- Results tied to stale phase, round, fingerprint, delivery snapshot, or Session ID cannot affect the round.
- Reviewer and skeptic repair budgets retain their current limits.
- A clean dimension becomes inactive only through its reviewer's concrete LGTM conclusion.

## Verification

Add a deterministic concurrency test with two dimension cells. Keep both reviewer results behind a controlled test release until every reviewer submission call has been initiated, then let the first return at least two findings while the second stays blocked. Record submission-call initiation and controller-observed completion events. The event assertions pass only when every reviewer submission call is initiated before the controller observes a reviewer completion and every skeptic submission call for the first reviewer is initiated before the controller observes either a sibling skeptic completion or the second reviewer completion. Separately assert that the sibling fan-out loop body performs only request construction and submission, with no unrelated controller operation between adjacent submissions; this structural check covers synchronous work that the event log cannot observe.

Run the same blocked-sibling scenario through the real Workflow runtime before treating host scheduling as validated. Capture reviewer and skeptic submission-call initiation plus controller-observed completion events. The probe passes only when every reviewer submission call is initiated before the controller begins observing reviewer completions, and every first-reviewer skeptic submission call is initiated before the controller observes a sibling skeptic completion or the blocked reviewer's completion. Inspect the shipped fan-out loop for the same construction-and-submission-only body used by the deterministic structural assertion. Actual child completion may occur during a later serialized submission call and does not fail the probe until the controller observes it. `(live-claim: provisional)`

If a Workflow invocation rejects or throws after an available normalized trace has already proved an ordering violation, the live probe fails. Otherwise, rejection is inconclusive and the scheduling claim remains provisional.

Adapt the Workflow test harness so it models concurrent dimension execution rather than serial complete pipelines. Preserve every existing test case, then add the new ordering coverage for reviewer submissions, multi-finding skeptic fan-out, and the exact metadata above.

Run `node skills/revise/revise-round.test.js` and `git diff --check` for the implementation changes.

## Change surface

- `skills/revise/revise-round.workflow.js`: make per-dimension completion-driven fan-out explicit and update metadata.
- `skills/revise/revise-round.test.js`: model concurrent dimension execution and prove reviewer and skeptic submission ordering.
- `skills/revise/SKILL.md`: state the shared dispatch contract, add the `awaiting-verification` lifecycle, consume manual completions incrementally, and preserve the round barrier.
- `.claude-plugin/plugin.json`: increase version `2.0.25` to `2.0.26` exactly once because the change alters shipped plugin behavior.

No checkpoint schema migration, scheduler admission protocol, filesystem gate, new identity system, task-duration deadline, skeptic evidence rule, reviewer dimension, adjudication rule, repair limit, artifact edit surface, marketplace metadata, or handover behavior is part of this change.

## Hardening

- revise-spec graduated 2026-08-09 21:27 at a696d64, scope: whole file, content: 61c067ae
- revise-spec refreshed 2026-08-10 02:35 at a696d64, scope: whole file, content: 524baaac (spec reconciliation)
