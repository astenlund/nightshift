# Manual review dedup parity

Feature: give Workflow and capable manual dispatch the same conservative same-round finding deduplication, with one fresh skeptic beneath every shared verdict group. This file is the authoritative design record.

## Scope anchor

Requested outcome: prevent manual review adapters from paying one skeptic per duplicate finding when Workflow already shares a verified sibling verdict safely.

Material exclusions: no cross-round or cross-run verdict reuse, durable pre-verdict dedup journal, actionability decision, model-vendor assignment, general finding ontology, or exact-once guarantee.

## What it does

`internal/revise/revise-round.workflow.js` registers findings as reviewer cells complete, asks a low-cost judge whether each new finding duplicates an earlier same-round registered finding, and exposes a successful relationship as `sharedVerdictFrom`. The earlier verdict may still be in flight or may already be complete. An uncertain or failed judgment launches a fresh skeptic. `internal/revise/SKILL.md` explicitly withholds that exception from the manual Agent path, which creates one skeptic row and one fresh skeptic for every finding.

This feature removes the semantic and cost disparity whenever the manual host exposes independent fresh-agent dispatch. Workflow and manual modes deduplicate incrementally as findings arrive, compare against every earlier eligible same-round finding whether its verdict is in flight or complete, apply the same identity rule, retain one fresh skeptic per canonical group, and normalize to the same completed result shape. A host that cannot launch the judge or any failed judgment follows the existing one-skeptic-per-finding path.

## Duplicate identity

A duplicate is not merely similar wording. The judge compares:

- the asserted obligation or premise;
- the affected artifact surface;
- the counterexample or deciding evidence;
- the frozen contract context supplied to both findings, when contract-calibrated admission is present.

The new finding may share a verdict only when the earlier skeptic's answer will decide the complete new claim. A different defect, a new affected surface, stronger counterexample, changed governing context, or uncertainty returns no match and launches a fresh skeptic. This deliberately favors extra verification over false sharing.

The first implementation is same-round only. A finding reported in a later round always receives a new skeptic, even when acknowledgements describe an apparent recurrence. Artifact, scope, or contract fingerprints need no selector exception because no cross-round verdict is reused. Captured telemetry may motivate a separately designed continuation later.

## Workflow behavior

Workflow keeps its current arrival-time registry and `sharedVerdictFrom` result shape. The dedup prompt changes from same claim and same code region to the premise, surface, evidence, and frozen-context rule above. Candidate ordering remains stable within the set offered to one judge, while reviewer completion timing may produce a different sharing topology after resume. That variance changes cost only; every completed group still has a fresh canonical skeptic verdict.

If a later finding adds stronger evidence or a new surface, the first version does not mutate the earlier canonical record. It launches a separate skeptic so no evidence disappears behind a shared verdict. Canonical enrichment is a future optimization, not required for correctness.

## Manual completion-driven behavior

The manual controller retains completion-driven reviewer processing:

1. Persist the complete usable reviewer result with every derived finding in `awaiting-verification` before judge or skeptic submission.
2. Register each finding against every earlier same-round finding whose round, artifact fingerprint, delivery snapshot, and contract context still match, whether its verdict is in flight or complete.
3. Ask the dedup judge using the same prompt and result validation as Workflow.
4. For each unmatched or uncertain finding, create its skeptic Agents row, checkpoint it under the existing result-first ordering, and launch the fresh skeptic.
5. For a match whose canonical verdict is still in flight, keep the candidate relationship in controller memory and await completion. Do not create a skeptic row for the duplicate while that live relationship remains usable.
6. For a match whose canonical verdict is already complete and valid, or when an in-flight canonical verdict completes validly, persist the duplicate's full copied verdict and `Shared verdict from` reference together. Only that completed unit is durable authority. A retryable or contradictory completed result is not shareable and launches normal fresh verification.

The controller never observes a skeptic completion or adjudicates a finding before required checkpoint writes finish. Independent unmatched skeptics continue concurrently. A duplicate may point to an earlier duplicate, but registration order guarantees every live chain terminates at a finding with a dispatched skeptic.

## No pre-verdict dedup authority

The judge's intermediate opinion is intentionally not a durable authority. Before the canonical verdict completes, the duplicate remains an ordinary `awaiting-verification` finding without a skeptic row. If the controller is interrupted, recovery treats that absence as missing skeptic work and launches a fresh skeptic through the existing bounded-repair path. It may instead rerun dedup when the unchanged round still exposes a safe candidate, but it never assumes the lost in-memory relationship.

This permits repeated work after a crash and prevents false certification. A separate dedup checkpoint would add partial-write and migration states without improving coverage.

The successful write sequence is:

1. Reviewer result with every finding awaiting verification.
2. Canonical skeptic row and session checkpoints for unmatched findings.
3. Canonical complete verdict.
4. Duplicate complete verdict plus shared reference copied as one unit.

Crash behavior is deterministic:

- after the reviewer result but before a judge outcome, recover a missing skeptic;
- after an in-memory match but before the canonical verdict, recover a missing skeptic for the duplicate or safely rerun the judge;
- after the canonical verdict but before the duplicate copy, recover the duplicate independently or safely copy only after revalidating round, fingerprint, delivery snapshot, candidate ID, and complete canonical verdict;
- after the complete shared copy, preserve it exactly as current shared-verdict recovery does.

## Failure behavior

- Judge denial, timeout, unavailable capability, thrown error, malformed result, out-of-range candidate, or uncertainty launches a fresh skeptic.
- A canonical verdict that becomes retryable leaves each live sharing duplicate non-certifying. The live controller may await canonical repair; interruption converts missing duplicate work to independent repair.
- A canonical finding abandoned by round or fingerprint drift invalidates every incomplete in-memory relationship. No stale completion may populate a duplicate.
- A completed canonical verdict with contradictory classification or probe evidence is not shareable and follows normal skeptic repair.
- Capacity exhaustion does not drop the finding. It schedules ordinary fresh verification under the host's existing bounded dispatch and failure rules.
- A manual host without the judge capability retains one fresh skeptic per finding and records dedup as unavailable in the run report.

## Result and state compatibility

The completed result uses the existing `Shared verdict from: <finding-id>` line and full normalized skeptic-verdict fields. No new persistent judge row, policy version, or state file is introduced solely for dedup. Manual state creates skeptic Agents rows only for actually dispatched skeptics; a completed duplicate needs no row because its full result identifies the canonical fresh verdict.

Existing checkpoints remain valid. A run started before this feature has no manual shared relationships and continues safely. A resumed Workflow round may derive a different sharing topology under current rules. A resumed manual round never reconstructs a lost match from similarity alone.

Contract-calibrated actionability, when installed, runs after the copied factual verdict and remains controller-owned per finding. Sharing truth does not force two findings to share actionability when their contract traces differ. The controller records each actionability decision separately.

## Complete behavior by branch

### No earlier candidate

Dispatch one fresh skeptic normally.

### Confirmed duplicate

If the earlier verdict is in flight, await it; if it is already complete and valid, copy it immediately. Persist the complete verdict plus shared reference. The duplicate retains its own summary, location, evidence, and later actionability decision.

### Similar premise, different surface

Dispatch a fresh skeptic. A verdict about one surface cannot silently decide another.

### Stronger evidence

Dispatch a fresh skeptic in the first implementation. Do not discard or merge the stronger counterexample.

### Empty finding set

Launch neither judge nor skeptic. Reviewer LGTM behavior is unchanged.

### Judge unavailable

Dispatch one fresh skeptic for each finding. The run costs more but loses no coverage.

### Canonical retry or interruption

No duplicate certifies from an incomplete root. Live relationships may wait for canonical repair; resume may repeat work independently.

### Later-round recurrence

Launch a fresh skeptic. Prior acknowledgements remain reviewer context, not verification authority.

## Consumer behavior

- `internal/revise/revise-round.workflow.js` owns Workflow registration, prompt semantics, and completed sharing.
- `internal/revise/revise-round.test.js` covers duplicate, nonduplicate, stronger-evidence, new-surface, malformed, unavailable, retry, and chain behavior.
- `internal/revise/SKILL.md` owns manual scheduling, checkpoint order, interruption recovery, and fallback.
- Manual-path fixture or transcript tests prove parity with Workflow without pretending the transport mechanics are identical.
- `contract-calibrated-revise-admission` consumes completed factual verdicts but neither controls nor broadens dedup identity.
- `review-host-adapters` in the host-agnostic feature must preserve this semantic contract when dispatch mechanics later move behind provider adapters.
- `review-report-json-schema` may eventually validate the existing completed shared-verdict shape; it does not gain a judge-result schema from this feature.

## Acceptance and evaluation

Deterministic Workflow and manual fixtures prove:

- two differently worded findings with the same premise, affected surface, and deciding evidence launch exactly one skeptic;
- the same premise on a different surface launches two skeptics;
- stronger evidence launches a fresh skeptic and remains visible;
- judge failure, denial, malformed output, and uncertainty each launch a fresh skeptic;
- one completed duplicate stores its own finding data, the complete canonical verdict, and the canonical finding ID;
- an incomplete or retryable canonical result cannot certify any duplicate;
- interruption at every successful write boundary either preserves a complete shared verdict or recovers with fresh verification;
- manual and Workflow paths produce equivalent complete verdict groups for the same controlled completion order;
- a late reviewer finding may share an already completed earlier same-round verdict in both paths;
- a later-round recurrence launches a fresh skeptic;
- every completed sharing chain terminates at a finding backed by one fresh skeptic.

Evaluate the retained relocation and universal-entry transcripts for raw findings, canonical groups, skeptic launches, judge failures, and stronger-evidence fallbacks. The measurements inform later recurrence work but do not become hard success thresholds.

## Explicit anti-goals

- No cross-round or cross-run sharing.
- No semantic proof across changed fingerprints.
- No durable judge decision before a complete skeptic verdict exists.
- No actionability, observations, backlog routing, or repair policy.
- No model names or mandatory deployment tier.
- No guarantee that resume preserves the pre-crash sharing topology.

## Status

Designed through cross-project arbitration on 2026-08-18 after the manual Codex adaptation exposed the existing Workflow parity gap. User approved the arbitration ruling. Not yet hardened by revise-spec.

## Requirements

- Existing Workflow same-round dedup and `Shared verdict from` result semantics.
- Manual completion-driven fan-out, result-first checkpointing, and bounded recovery.
- A capable host path that can launch a narrow independent judge; absence uses the fail-open fallback.

**Requires:** none.

## Hardening

- (None yet; this file has not been through a revise-spec run.)
