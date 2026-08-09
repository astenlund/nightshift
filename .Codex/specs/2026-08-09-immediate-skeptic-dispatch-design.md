# Immediate Skeptic Dispatch Design

Status: signed off 2026-08-09

## Goal

Reduce review latency by starting verification as soon as each reviewer returns findings. All reviewers still begin concurrently. When one reviewer completes, every skeptic for that reviewer's findings starts concurrently while unrelated reviewers continue running.

The round remains the unit of adjudication. Immediate skeptic dispatch must not permit fixes, follow-up routing, dimension transitions, or artifact edits before every required reviewer and skeptic result in the round is usable.

## Current behavior

The shared skeptic contract requires one fresh skeptic for every finding, but it does not state when that skeptic launches relative to other reviewers.

The Workflow script expresses review and verification as stages of a per-dimension `pipeline()`. This suggests completion-driven verification, but the sequencing guarantee is indirect and the test double processes dimensions serially. The tests therefore do not prove that a skeptic starts before a slower sibling reviewer finishes.

The manual Agent fallback explicitly waits for all usable reviewers before assigning finding IDs and dispatching skeptics. This creates a full reviewer-batch barrier and does not meet the desired behavior.

## Dispatch invariant

Every active dimension cell starts one reviewer concurrently against the round's fixed phase, round, fingerprint, and delivery snapshot.

When a reviewer returns, its complete response is normalized. A usable response containing findings receives the existing derived finding IDs, `<cell-id>/finding-<one-based-result-index>`. All skeptics for those findings then launch concurrently without waiting for any other reviewer. A reviewer returns its findings as one response, so dispatch is immediate at reviewer-response granularity rather than while the reviewer is still generating output.

A clean usable response launches no skeptic. An incomplete or contradictory reviewer response enters the existing reviewer-repair path and launches no skeptic until a usable reviewer result exists.

The controller performs only mandatory validation and checkpoint work between receiving a manual reviewer result and dispatching its skeptics. It does not wait for unrelated agents or do adjudication work in that interval.

## Workflow mode

Replace the indirect two-stage `pipeline()` call with an explicit concurrent operation per dimension cell:

1. Start all dimension operations concurrently.
2. Within each operation, await that cell's reviewer.
3. Immediately run that cell's skeptic fan-out when the reviewer produced usable findings.
4. Return that cell after all of its required skeptics settle.

The outer concurrent operation returns cells in a form reconciled by stable cell ID, preserving the existing protection against missing or reordered results. Reviewer and skeptic normalization, evidence requirements, model selection, labels, payload isolation, and retry classifications remain unchanged.

The Workflow invocation remains one controller call. The Workflow runtime owns completion-driven dispatch inside that call, and the controller persists returned cells after the call completes under the existing identity and delivery-snapshot checks.

Workflow metadata describes verification as overlapping review completion rather than as a second batch that begins after the Review phase finishes.

## Manual Agent mode

Launch every reviewer as an independently observable background task rather than a barriered foreground batch. Process completion notifications until all reviewer and skeptic work has settled.

For each completed reviewer:

1. Validate and normalize the reviewer response.
2. Assign derived finding IDs for a usable response.
3. Atomically persist the partial reviewer result and the corresponding in-flight skeptic Agent rows.
4. Dispatch one fresh background skeptic per finding as one concurrent fan-out for that reviewer.
5. Continue observing both the remaining reviewers and the newly launched skeptics.

Persist each completed skeptic result through the existing partial-result protocol. Repair only the reviewer or skeptic cell that remains incomplete, preserving completed sibling results.

If a host cannot expose independently observable Agent completions, manual mode reports that it cannot satisfy the dispatch invariant. It must not silently fall back to waiting for the complete reviewer batch.

## Round barrier and recovery

Immediate dispatch changes agent scheduling only. The following existing barrier remains authoritative:

- No finding is adjudicated before every required cell is usable and every finding has a permitted verified disposition.
- No reviewable artifact content changes while reviewers or skeptics are in flight.
- Results tied to stale phase, round, fingerprint, or delivery-snapshot identity cannot affect review state.
- Reviewer and skeptic repair budgets remain separate and retain their current limits.
- A clean dimension becomes inactive only through its reviewer's concrete LGTM conclusion.

Manual mode records finding identities and in-flight skeptic rows before dispatch so an interruption can resume or replace only missing work. Workflow mode retains its existing whole-call recovery boundary: failures return repairable reviewer or skeptic gaps, and the controller persists and repairs those gaps after identity validation.

## Verification

Add a deterministic concurrency test with two dimension cells. The first reviewer returns a finding while the second reviewer remains blocked. The test observes that the first finding's skeptic starts before the second reviewer is released. The command's observable event order must include reviewer starts for both cells, the first reviewer completion, and the first skeptic start before the second reviewer completion.

Retain the existing tests for clean reviews, multiple findings, invalid reviewer output, failed skeptics, stable finding IDs, payload isolation, and repair isolation. Adapt the workflow test harness so its concurrency behavior matches the runtime contract instead of serializing complete dimension pipelines.

Run `node skills/revise/revise-round.test.js` and `git diff --check` for the implementation changes.

## Change surface

- `skills/revise/revise-round.workflow.js`: make per-dimension completion-driven fan-out explicit and update metadata.
- `skills/revise/revise-round.test.js`: model concurrent dimension execution and prove skeptic launch ordering.
- `skills/revise/SKILL.md`: state the shared dispatch invariant and make the manual fallback completion-driven.
- `.claude-plugin/plugin.json`: increase version `2.0.25` to `2.0.26` exactly once because the change alters shipped plugin behavior.

No skeptic evidence rules, reviewer dimensions, adjudication rules, repair limits, artifact edit surfaces, marketplace metadata, or handover behavior change.
