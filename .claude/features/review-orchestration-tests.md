# Review orchestration tests

Feature: turn the revise review engine's wave, convergence, and completion decisions into executable, fixture-tested invariants. This file is the authoritative design record.

**2026-08-20 re-derivation note:** the invariant set below was re-derived from the shipped wave-convergence lifecycle in `internal/revise/SKILL.md`, which removed phases, replacing the phase-model transition matrix this file carried from the 2026-08-11 migration. The extraction purpose and module shape are unchanged.

## What it does

The deterministic backlog parser (`skills/ready/ready.js`) has strong behavioral test coverage via `ready.test.js`. The review engine is the more consequential component by overall quality impact, and today it has none at the orchestration level: the wave/convergence/adjudication decisions live only as prose in `internal/revise/SKILL.md`, restated by the controller every cycle. `revise-round.test.js` covers one round's Workflow dispatch (concurrency, reviewer-to-skeptic fan-out, result normalization, fingerprint validation). It does not cover the machinery that decides whether a cell certifies or reactivates, how the staleness sweep resolves an all-inactive boundary, when the verifier may launch or stamp, or whether the run completes.

This feature extracts those orchestration decisions into a deterministic, importable Node module with a `ready.test.js`-style fixture suite, driven by mocked reviewer and skeptic results rather than agent dispatch. It promotes the workflow rules from prose into executable invariants: a regression in the controller's boundary reasoning becomes a failing fixture instead of silent behavior drift. Design decisions confirmed during backlog migration on 2026-08-11, restated in wave terms after the 2026-08-20 re-derivation:

- **Substrate**: extract pure transition logic; SKILL.md prose stays authoritative for execution, the module is a consultable spec-check that binds the invariants.
- **Boundary resolution**: encode the full all-inactive evaluated-boundary rule, in order: the staleness sweep runs first (reactivation, N/A promotion and demotion, empty-applicable-set failure); wave convergence without a current stamp launches the verifier; wave convergence with a current stamp enters post-review. A boundary with a pending controller mutation, a pending user request, or a non-`none` agreement boundary resolves to no transition and no dispatch.
- **Certification span**: a cell is inactive exactly while it holds a certification; within a run's normal flow only a staleness-sweep boundary (reactivation on fingerprint inequality, or demotion to N/A) or a scope-remap boundary clears a certification, and the user-authorized `Restart run` clears every certification outside that flow.
- **Cross-cell mutation**: a sibling's accepted edit preserves every cell's current state until the sweep; the sweep is the global re-review barrier. One invariant with both halves tested.
- **Rejected findings**: the current disposition rule set (every finding-bearing round keeps the cell active, including an all-refuted or acknowledgement-only round; only a later explicit clean LGTM certifies it; no side effects on other cells).
- **Execution failure**: the full run-level fail-closed contract with explicit disposition, cap preflights included.
- **Completion invariant**: the stamp conjunction (wave convergence and a verifier stamp over the same current fingerprint), tested for refusal in every non-completing combination, with cap asymmetry (a cap-forced end never completes) absolute.

## The substrate: a pure transition module

Extract the review-state transition decisions into one bundled Node module, mirroring the `ready.js` / `ready.test.js` pattern: deterministic, importable, no test framework, exit code 1 on failure, and the transition rules live only in the module, never hand-approximated in prose. SKILL.md prose stays authoritative for how the controller executes the run; the module is the single authority for the transition decisions and the exact surface the tests bind to.

The module answers the orchestration questions as pure functions over the review state:

- how the all-inactive evaluated boundary resolves (sweep reactivation, verifier launch, post-review entry, or failure);
- how certification, the staleness sweep, and a scope-remap change affect each cell's active, inactive, or N/A status;
- how a rejected finding affects a cell's convergence;
- how execution failure and limit exhaustion terminate a run;
- whether the run can complete.

Limit values are data, not literals scattered through logic: the transition table is declared configuration carrying the current shipped values (30 rounds per run with verifier rounds included, 10 verifier launches per run, 3 execution-repair launches per stable reviewer, skeptic, or verifier cell). Declared-up-front makes a future cap or lifecycle redesign a table-and-fixture update in its own change set rather than a module rewrite.

The module lives under `internal/revise/` (for example, `internal/revise/orchestration.js`) with its fixture suite beside it (for example, `internal/revise/orchestration.test.js`), runnable the same way as the existing suites. When the feature ships, the universal-entry topology fixture requires both new files to remain internal and absent from the public skill catalog without treating the rest of `internal/revise/` as a closed file set, and the repository's Commands guidance that enumerates the test suites gains this suite.

## Boundary resolution and the staleness sweep

At every evaluated boundary where all applicable cells are inactive, the controller resolves the next transition in one rewrite, sweep first:

```text
Inputs: every applicable cell inactive (the boundary condition),
current fingerprint F, verifier stamp S.

SWEEP (always first)
  reactivate exactly the cells whose certified fingerprint != F,
  clearing each reactivated cell's certification; re-evaluate every
  N/A declaration in both directions (promotion yields active with no
  certification; demotion clears certification and records a freshly
  evaluated nonblank reason)
  applicable set empty after sweep  -> run fails (convergence is
                                       never vacuous)
  sweep activated at least one cell -> Start round
  demotion-only or no-op sweep      -> fall through (converged)

WAVE CONVERGENCE (every certification equals F)
  S != F (none or stale) -> Launch verifier
  S == F                 -> post-review (complete)
```

Staleness is evaluated only at this boundary, never mid-round: accumulated edits batch into one wave instead of re-running settled cells per small delta. No artifact edit or finding disposition reactivates a cell directly; fingerprint movement reactivates only through the sweep. The one exception is a resolved-scope-map change, which fingerprint inequality cannot detect: the boundary that reconciles it clears every affected cell's certification directly (whole-scope and cross-cutting cells on any map change, local cells on slice-membership change).

Fixture cases:

- all inactive, one certification stale -> exactly that cell reactivates with cleared certification and a round starts; currently certified cells stay inactive;
- all certifications current, stamp none -> verifier launch;
- all certifications current, stamp equal to the current fingerprint -> post-review;
- demotion-only sweep -> no round; resolution falls through to the convergence branch;
- sweep leaves the applicable set empty -> run fails with current diagnostics;
- contradicted N/A -> promoted to active with no certification, so the run cannot complete without reviewing it;
- mid-round edit -> no sweep until the next all-inactive boundary;
- scope-map change at an unchanged fingerprint -> affected cells' certifications cleared directly at the reconciling boundary;
- pending user request or controller mutation, or non-`none` agreement boundary -> no transition and no dispatch.

## Certification span

A cell that converges cleanly (explicit LGTM with a concrete nonblank verification rationale) becomes inactive, certifying the exact fingerprint it reviewed. The run does not relaunch it in any later round while it stays certified, no matter how long a sibling cell takes; only a staleness-sweep reactivation or a scope-remap clearing returns it to active. Round numbers are monotonic for the whole run and never reset.

Fixture case:

- round N: D1 LGTM after one note-backed review, D2 requires seven reviews at an unchanged fingerprint -> D1 is launched zero times across the remaining six rounds.

## Cross-cell mutation

One invariant with two halves, both fixture-tested:

- **Preserve until the sweep.** A sibling cell's accepted artifact edit moves the fingerprint and preserves each cell's current active or inactive state until the next all-inactive boundary. D1 that already certified is not reactivated mid-run by D2's fix, even though the artifact changed under D1's certification. The staleness sweep is what provides the global re-review barrier.
- **Reactivate at the sweep.** At the all-inactive boundary, the sweep reactivates exactly the cells whose certification differs from the current fingerprint, clearing each reactivated certification. D1's prior LGTM buys it nothing against a moved fingerprint.

Fixture cases:

- round N: D1 certified, D2's accepted fix moves the fingerprint -> D1 still inactive for every remaining round before the boundary, launched zero times;
- at the boundary: the sweep reactivates D1 with `Certified fingerprint: none`, while a cell certified at the moved fingerprint stays inactive.

## Rejected findings

The disposition rule set, with the refuted and valid-but-deferred branches both covered:

1. A valid-but-deferred finding, or an accepted judgment call with an actionable follow-up, keeps its cell active. The disposition is not a convergence device and never produces LGTM by itself.
2. A round whose skeptic-verified findings all landed as refuted or as acknowledgement-only accepted judgment calls keeps the cell active with no certification. The reasoned acknowledgements enter the next payload, and only a later explicit clean LGTM with a concrete nonblank verification rationale deactivates the cell. The module refuses to record a refutation from a controller rejection that lacks a skeptic-verified verdict, and the acceptance branch applies only to findings whose skeptic verdict is JUDGMENT_CALL.
3. A rejected finding neither moves the fingerprint nor counts as a per-finding clean conclusion.

Valid-but-deferred additionally records its actionable follow-up and the acknowledgement or caveat, with no applied-change entry. A REFUTED finding records a reasoned acknowledgement and no follow-up or applied-change entry.

Fixture cases:

- reviewer finding F, skeptic REFUTES it, no other findings in the round -> cell D stays active with no certification, and the reasoned acknowledgement enters the next payload;
- reviewer finding F, controller rejects it without a skeptic-verified refutation -> the disposition is refused and D stays active;
- mixed round: one refuted finding plus one valid-but-deferred -> D stays active, with the follow-up and acknowledgement recorded;
- accepted judgment call with an actionable follow-up as the round's sole finding -> D stays active, with the follow-up row recorded;
- acknowledgement-only accepted judgment call as the round's sole finding -> D stays active with no certification and receives another fresh review at the same fingerprint;
- deferred in round N, all findings refuted in round N+1 -> D stays active while the round-N follow-up row stays open, and only a later clean LGTM can deactivate D;
- after any finding-bearing round, a later clean LGTM with a concrete nonblank rationale -> D becomes inactive and certifies that clean review's fingerprint;
- attempting the acceptance branch on a CONFIRMED-verdict finding is refused;
- the fingerprint does not move in any of these, no sibling cell changes state, and no per-finding clean conclusion is counted.

## Verifier stamping

The holistic verifier launches only at wave convergence and follows the same finding and skeptic pipeline as dimension cells. Its cell (`verifier/whole-artifact`) sits outside the applicable set: the sweep and wave convergence never count it. Its stamp names only the fingerprint it reviewed; a stamp whose fingerprint no longer matches the current fingerprint is stale and authorizes nothing. The transition module covers every verifier boundary:

1. A clean LGTM with a concrete nonblank verification note stamps the current fingerprint.
2. A no-fix verifier round whose findings are all refuted or accepted as acknowledgement-only judgment calls leaves the stamp unset, carries the reasoned acknowledgements forward, and launches another fresh verifier at the same fingerprint.
3. Only a current no-fix verifier round that creates an authoritative deferred follow-up may stamp without a clean LGTM. The stamp attests review coverage while the authoritative follow-up records the accepted debt.
4. A verifier round that applies any fix leaves the stamp unset, advances the fingerprint once at the boundary, and returns to the staleness sweep. An authoritative deferred follow-up in the same round does not override the applied-fix branch.

Fixture cases:

- verifier returns clean LGTM with a concrete note -> current fingerprint is stamped;
- verifier returns LGTM without a concrete nonblank note -> stamp is refused;
- every verifier finding is skeptic-refuted, no fix or follow-up -> stamp stays unset and another fresh verifier is required at the same fingerprint;
- every verifier finding is an acknowledgement-only accepted judgment call, no fix or follow-up -> stamp stays unset and another fresh verifier is required at the same fingerprint;
- verifier creates an authoritative deferred follow-up and applies no fix -> current fingerprint may be stamped without LGTM, with the follow-up retained;
- verifier creates an authoritative deferred follow-up and applies a fix -> stamp stays unset, the fingerprint advances, and the staleness sweep resumes;
- verifier applies a fix with no deferred follow-up -> stamp stays unset, the fingerprint advances, and the staleness sweep resumes.

## Execution failure

The run-level fail-closed contract, which is distinct from the round-level `needs-reviewer` status that `revise-round.test.js` already covers:

- a missing or malformed reviewer or skeptic output is repairable within the affected stable cell's execution-repair budget; the run lands in `Status: failed` only when no repair attempt remains or a cap preflight would be exceeded;
- the failed run is not a convergence data point: no boundary transition, no partial certification, no completion, and no manufactured LGTM, stamp, or refutation from any limit path;
- a failed run never auto-resumes; it surfaces `Failure` and requires explicit user disposition (retry, restart, or abandon in interactive mode; autonomous handover stops for user disposition).

Limits: 30 rounds per run (verifier rounds included), 10 verifier launches per run, 3 execution-repair launches per stable reviewer, skeptic, or verifier cell. `Start round` and `Launch verifier` preflight their caps: a launch that would exceed a cap fails the run before any agent launches. Exhaustion of any limit is terminal until explicit disposition, and a cap-forced end never produces completion.

Fixture cases:

- reviewer output missing/malformed with repair budget remaining -> repairable, never a run failure, an LGTM, or a refutation;
- reviewer output missing/malformed with the cell's repair budget exhausted -> `Status: failed`, round, fingerprint, and cell diagnostics preserved, no transition, no completion;
- a `Start round` that would exceed round 30 fails the run before any agent launches, preserving round-30 diagnostics;
- an eleventh verifier launch fails the run at the preflight;
- a repair counter at 3 fails the run before another agent launches;
- the module refuses to turn any limit-exhausted state into an LGTM, a stamp, or a refutation.

## Completion invariant

The run enters `post-review` only on the conjunction:

```text
canComplete(cells, fingerprint, stamp)
  = applicable set nonempty
    AND every applicable cell inactive
    AND every certification == fingerprint
    AND stamp == fingerprint
```

The stamp is a conjunction, not an authority: the verifier never launches before wave convergence, so no single agent and no cap path can complete the run alone. Any reviewable edit after a stamp moves the fingerprint, and any scope-map change clears the affected certifications directly; either event invalidates completion, and certification loss is the single re-entry path.

The predicate is tested for refusal in every failing combination independently:

- some applicable cell active -> refuses;
- all inactive, one certification at an older fingerprint -> refuses (sweep territory, not completion);
- converged, stamp none -> refuses (verifier territory);
- converged, stamp at an older fingerprint -> refuses;
- applicable set empty -> the run fails and never completes;
- converged with stamp none and verifier launches exhausted -> the run fails and never completes (cap asymmetry);
- completes only on: nonempty applicable set, every applicable cell inactive, every certification current, stamp equal to the current fingerprint.

## Relationship to neighboring features

- **second-opinion-gates**: the completion predicate is written against the current shipped semantics (wave convergence plus the verifier-stamp conjunction, 30-round and 10-verifier-launch caps). A future gate or cap redesign is deliberately out of scope; see that file's recorded unclaimed direction, whose phase-cap question dissolved into these caps. Because the transition table is declared configuration, adopting a different cap later is a table-and-fixture update in that change, not a rewrite of this module.
- **contract-calibrated-revise-admission**: this transition substrate lands first against current behavior. Admission then updates the module and fixtures atomically for the `contract-clean` certification kind, contract-context invalidation, and every verifier stamp basis rather than leaving those branches as prose-only exceptions.
- **light-revise-mode** (exploring): if a lightened single-reviewer shape changes the convergence invariant mapping, its own change updates the affected fixtures rather than redefining the transition module here.
- **revise-round.test.js**: that suite stays the round-dispatch safety net; this suite covers the decisions above the round, so the two do not overlap on the same assertions.

## Operating context

- **Deployment environment and operational criticality**: development-time tooling inside the nightshift plugin repository; the module and its suite run in CI and on demand, never in an installed user's runtime path. Criticality: low.
- **Audience**: trusted circle. Deviation entry: the repository is public and marketplace-distributed, but this module is internal development tooling that installed users never execute; public visibility alone does not read as `public`.
- **Failure consequence and data or security sensitivity**: a wrong invariant silently blesses controller drift, costing review-workflow quality; recoverable via git, no data or security surface. Uplift `failure_consequence` judged not fired.
- **Concurrency and compatibility risk**: none; pure functions over review state with no concurrency and no external compatibility surface. Uplifts `concurrency_compatibility` and `deployment_criticality` judged not fired.
- **Reversibility and recovery cost**: trivially reversible (git revert of a repository-internal module). Uplift `reversibility_recovery` judged not fired.
- **Expected feature lifetime**: long-lived; the module is the durable single authority for the transition decisions. Uplift `expected_lifetime` judged fired.
- **Derived rigor**: audience `trusted circle` (baseline low) plus 1 fired uplift yields tier `medium` via `node internal/revise/rigor.js "trusted circle" 1`; per-dimension effort: validation medium, recovery medium, compatibility medium, observability medium, proofEffort medium.

## Status

Migrated into the backlog on 2026-08-11, with the design decisions above confirmed one at a time during migration; the invariant set was re-derived from the shipped wave-convergence lifecycle on 2026-08-20 after the phase model's removal. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The review engine's wave/round/checkpoint machinery and its prose rules in `internal/revise/SKILL.md` (shipped by the universal-skill MVP and the wave-lifecycle change; this feature extracts and tests the decisions they already specify).
- The existing fixture-test convention demonstrated by `skills/ready/ready.test.js` and `internal/revise/revise-round.test.js` (shipped; no framework, exit code 1 on failure).

**Requires:** none (FEATURES.md index entry).

## Hardening

- (None yet; this file has not been through a revise-spec run.)
