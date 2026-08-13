# Review orchestration tests

Feature: turn the revise review engine's phase, convergence, and completion decisions into executable, fixture-tested invariants. This file is the authoritative design record.

## What it does

The deterministic backlog parser (`skills/ready/ready.js`) has strong behavioral test coverage via `ready.test.js`. The review engine is the more consequential component by overall quality impact, and today it has none at the orchestration level: the phase/convergence/adjudication decisions live only as prose in `skills/revise/SKILL.md`, restated by the controller every cycle. `revise-round.test.js` covers one round's Workflow dispatch (concurrency, reviewer-to-skeptic fan-out, result normalization, fingerprint validation). It does not cover the machinery that decides whether to advance a phase, whether a dimension converges, whether a sibling's mutation reaches an inactive dimension, or whether the stage completes.

This feature extracts those orchestration decisions into a deterministic, importable Node module with a `ready.test.js`-style fixture suite, driven by mocked reviewer and skeptic results rather than agent dispatch. It promotes the workflow rules from prose into executable invariants: a regression in the controller's phase reasoning becomes a failing fixture instead of silent behavior drift. Design decisions confirmed during backlog migration on 2026-08-11:

- **Substrate**: extract pure transition logic; SKILL.md prose stays authoritative for execution, the module is a consultable spec-check that binds the invariants.
- **Phase matrix**: encode the full table derived from SKILL.md, where any phase that reaches the all-inactive boundary increments the convergence counter (drift abandonment is the only non-increment), cleanliness gates only the destination, and phase 1 can never complete. The fixture set includes the drift-abandoned clean-under-two path that forces a third phase.
- **Convergence span**: inactive is phase-scoped; only a phase boundary reactivates.
- **Cross-dimension mutation**: preserve within phase, reset at next phase, one invariant with both halves tested.
- **Rejected findings**: the disposition rule set (a follow-up-yielding disposition keeps the dimension active, an all-refuted or acknowledgement-only round deactivates it on skeptic evidence, no dirt side effects).
- **Execution failure**: the full run-level fail-closed contract with explicit disposition.
- **Completion invariant**: one joined predicate over phase floor, converged count, all-inactive, and zero mutations, tested for refusal in every combination.

## The substrate: a pure transition module

Extract the review-state transition decisions into one bundled Node module, mirroring the `ready.js` / `ready.test.js` pattern: deterministic, importable, no test framework, exit code 1 on failure, and the transition rules live only in the module, never hand-approximated in prose. SKILL.md prose stays authoritative for how the controller executes the run; the module is the single authority for the transition decisions and the exact surface the tests bind to.

The module answers the orchestration questions as pure functions over the review state:

- what the next phase boundary is (advance, enter post-review, or fail);
- how per-dimension convergence and mutation affect active/inactive status within and across phases;
- how a rejected finding affects a dimension's convergence;
- how execution failure and limit exhaustion terminate a run;
- whether the stage can complete.

Limit values and the phase ceiling are data, not literals scattered through logic: the transition table is declared configuration carrying the current shipped values (phase ceiling 10, 10 original reviewer launches per stable dimension or shard cell per phase, 3 execution-repair launches per stable reviewer or skeptic cell, 2-phase completion floor). Declared-up-front makes a future phase redesign a table-and-fixture update in its own change set rather than a module rewrite.

The module lives under `skills/revise/` (e.g. `skills/revise/orchestration.js`) with its fixture suite beside it (e.g. `skills/revise/orchestration.test.js`), runnable the same way as the existing suites. When the feature ships, the repository's Commands guidance that enumerates the test suites gains this suite.

## Phase progression

The full transition table derived from SKILL.md. The convergence-boundary checkpoint fires once every applicable dimension is inactive: it records the current phase as `Last converged phase`, increments `Converged phases` only when the current phase was not already recorded, and either enters `post-review` or invokes `Start phase` for the next phase. A phase that reaches the all-inactive boundary increments the counter whether it was clean or dirty; only a drift-abandoned phase (fingerprint drifted before every applicable dimension became inactive) leaves the counter and `Last converged phase` unchanged while still incrementing the phase number for auditability. Cleanliness is applied at the destination rule, not at the counter. Phase 1 can never complete the review stage.

```text
Inputs: every applicable dimension inactive (the boundary condition), and
C = Converged phases before this checkpoint.

EVERY CONVERGED PHASE
  records itself, increments C unless already recorded
  (drift-abandoned phases never reach the boundary and never increment)

PHASE 1
  clean            -> advance to phase 2 (C becomes 1)
  dirty            -> advance to phase 2 (C becomes 1)

PHASE 2+
  clean, C+1 >= 2  -> post-review (complete)
  clean, C+1 <  2  -> advance to next phase (e.g. C = 0 after a
                      drift-abandoned phase 1 -> phase 3, NOT complete)
  dirty            -> advance to next phase (C still becomes C+1)
```

Fixture cases:

- phase 1 clean, C = 0 -> phase 2 required, C becomes 1;
- phase 1 dirty -> phase 2, C becomes 1 (a dirty phase that reaches the all-inactive boundary still converges);
- phase 2 clean, C = 1 -> complete, C becomes 2;
- phase 2 dirty, C = 1 -> phase 3 required, C becomes 2 (cleanliness gates the destination, not the counter);
- phase 1 dirty, then phase 2 clean -> complete (phase 1 took C to 1, phase 2 clean takes it to 2 and is mutation-free; the common dirty-then-clean run needs no phase 3);
- phase 1 drift-abandoned (C stays 0), then phase 2 clean -> phase 3 required, C becomes 1 (the only path where a clean converged phase must still advance, because the two-phase floor is unsatisfied);
- phase 3 clean, C = 1 -> complete, C becomes 2.

## Per-dimension convergence

A dimension that converges cleanly (explicit LGTM with a concrete nonblank verification rationale) becomes inactive for the rest of its phase. The run does not relaunch it for any remaining round of that phase, no matter how long a sibling dimension takes. Inactive is phase-scoped only: a later phase may reactivate it, per the cross-dimension mutation rule.

Fixture case:

- phase N, D1 LGTM after one note-backed review, D2 requires seven reviews -> D1 is launched zero times across the remaining six rounds of phase N.

## Cross-dimension mutation

One invariant with two halves, both fixture-tested:

- **Preserve within phase.** A sibling dimension's accepted artifact edit dirties the phase and preserves each dimension's current active or inactive state until the next phase. D1 that already converged is not reactivated mid-phase by D2's fix, even though the artifact changed under D1's certification. The mandatory next phase is what provides the global re-review barrier.
- **Reset at next phase.** The convergence boundary that follows invokes `Start phase`, which makes every applicable dimension or shard cell active with zero attempts. D1's prior LGTM buys it nothing in the new phase.

Fixture cases:

- phase N: D1 LGTM, D2 accepted fix -> phase dirtied, D1 still inactive for the remainder of phase N, D1 launched zero times;
- after the boundary: start of phase N+1, D1 and D2 both active at zero attempts.

## Rejected findings

The disposition rule set, with the refuted and valid-but-deferred branches both covered:

1. A valid-but-deferred finding, or an accepted judgment call with an actionable follow-up, keeps its dimension active. The disposition is not a convergence device and never produces LGTM by itself.
2. A round whose skeptic-verified findings all landed as refuted or as acknowledgement-only accepted judgment calls deactivates the dimension at that round's boundary, judged on that round's own yield alone. The module refuses to deactivate from a controller rejection that lacks a skeptic-verified refutation, and the acceptance branch applies only to findings whose skeptic verdict is JUDGMENT_CALL.
3. A rejected finding neither dirties the phase nor counts as a per-finding clean conclusion.

Valid-but-deferred additionally records its actionable follow-up and the acknowledgement or caveat, with no applied-change entry. A REFUTED finding records a reasoned acknowledgement and no follow-up or applied-change entry.

Fixture cases:

- reviewer finding F, skeptic REFUTES it, no other findings in the round -> dimension D becomes inactive at the round boundary with the skeptic evidence as rationale;
- reviewer finding F, controller rejects it without a skeptic-verified refutation -> deactivation is refused and D stays active;
- mixed round: one refuted finding plus one valid-but-deferred -> D stays active, with the follow-up and acknowledgement recorded;
- accepted judgment call with an actionable follow-up as the round's sole finding -> D stays active, with the follow-up row recorded;
- acknowledgement-only accepted judgment call as the round's sole finding -> D becomes inactive at the boundary;
- deferred in round N, all findings refuted in round N+1 -> D becomes inactive at round N+1's boundary while the round-N follow-up row stays open;
- attempting the acceptance branch on a CONFIRMED-verdict finding is refused;
- the phase is not dirtied in any of these and no per-finding clean conclusion is counted.

## Execution failure

The run-level fail-closed contract, which is distinct from the round-level `needs-reviewer` status that `revise-round.test.js` already covers:

- a missing or malformed reviewer or skeptic output, or limit exhaustion, lands the run in `Status: failed`;
- the failed run is not a convergence data point: no phase advance, no partial LGTM, no completion, and no manufactured LGTM or refutation from any limit path;
- a failed run never auto-resumes; it surfaces `Failure` and requires explicit user disposition (retry, restart, or abandon in interactive mode; autonomous handover stops for user disposition).

Limits: 10 original reviewer launches per stable dimension or shard cell per phase, 10 phases, 3 execution-repair launches per stable reviewer or skeptic cell. Exhaustion of any limit is terminal until explicit disposition.

Fixture cases:

- reviewer missing/malformed -> `Status: failed`, phase/round/fingerprint preserved, no phase advance, no completion;
- a dimension at 10 attempts fails the run before any round agents launch;
- a transition to phase 11 fails the run while preserving phase-10 diagnostics;
- a repair counter at 3 fails the run before another agent launches;
- the module refuses to turn any limit-exhausted state into an LGTM or a refutation.

## Completion invariant

The stage completes only when the joined predicate holds:

```text
canComplete(phase, converged, cells, mutations)
  = phase > 1
    AND converged >= 2
    AND every applicable dimension inactive
    AND mutations == 0
```

The predicate is tested for refusal in every failing combination independently, and the phase-1 ban is absolute across every input shape:

- phase 1, converged, no mutations -> refuses;
- phase 2, converged = 1, no mutations -> refuses;
- phase 2, converged >= 2, some dimension active -> refuses;
- phase 2, converged >= 2, all inactive, mutations > 0 -> refuses;
- completes only on: phase >= 2, converged >= 2, every applicable dimension inactive, zero mutations.

## Relationship to neighboring features

- **second-opinion-gates**: the completion predicate is written against the current shipped semantics (phase ceiling 10, completed-by-convergence). A future phase redesign is deliberately out of scope; see that file's recorded unclaimed direction. Because the transition table is declared configuration, adopting a phase-2 cap later is a table-and-fixture update in that change, not a rewrite of this module.
- **light-revise-mode** (exploring): if a lightened single-reviewer shape changes the convergence invariant mapping, its own change updates the affected fixtures rather than redefining the transition module here.
- **revise-round.test.js**: that suite stays the round-dispatch safety net; this suite covers the decisions above the round, so the two do not overlap on the same assertions.

## Status

Migrated into the backlog on 2026-08-11, with the seven design decisions above confirmed one at a time during migration. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The review engine's phase/round/checkpoint machinery and its prose rules in `skills/revise/SKILL.md` (shipped; this feature extracts and tests the decisions they already specify).
- The existing fixture-test convention demonstrated by `skills/ready/ready.test.js` and `skills/revise/revise-round.test.js` (shipped; no framework, exit code 1 on failure).

**Requires:** none (FEATURES.md index entry).

## Hardening

- (None yet; this file has not been through a revise-spec run.)
