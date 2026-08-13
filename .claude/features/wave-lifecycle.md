# Wave-convergence lifecycle with a holistic gate

Feature: the revise review engine's phase model is removed. A run converges through rounds and reactivation waves until every applicable dimension cell has certified the current artifact fingerprint, then a single fresh holistic verifier reviews the whole artifact at that fingerprint; the run completes only on the conjunction of wave convergence and a clean verifier stamp over the same fingerprint. This file is the authoritative design record. It supersedes the retired "Simplify the revise lifecycle around rounds" feature (`revise-lifecycle-rounds.md`), whose motivating observations and still-valid ingredients are absorbed below.

## What it does

Today the lifecycle runs phases: each phase reviews per dimension until every dimension is inactive, and completion requires at least two converged phases plus a terminal change-free phase. Phase convergence is weak (dimensions certify different fingerprints within one phase), the terminal phase re-runs all dimensions against a fingerprint the last-settling dimensions just certified, and the phase vocabulary itself has caused real controller failures: two observed phase-1 short-circuits on 2026-08-12 where a "dirty" phase was misread as the trigger to start phase 2, both requiring human interruption.

This feature replaces phases with a single convergence process:

- Rounds launch one fresh reviewer per active cell, exactly as today, with the shipped per-round certification routes unchanged: LGTM with a concrete note, or an all-refuted round (every skeptic-verified finding refuted or accepted as an acknowledgement-only judgment call), both certifying the reviewed fingerprint; any applied fix or open follow-up keeps the cell active.
- When every applicable cell is inactive, cells whose certified fingerprint is older than the current fingerprint are reactivated (a reactivation wave) and rounds continue. Wave convergence is reached when every applicable cell's certification equals the current fingerprint.
- At wave convergence, one fresh holistic verifier reviews the entire artifact at that fingerprint. Clean verifier with a concrete verification note: the verifier stamps the fingerprint and the run enters post-review. Verifier findings enter the normal skeptic pipeline; confirmed fixes are applied at a verifier boundary with round-boundary semantics, staleness reactivates every cell whose certification predates the new fingerprint, and the loop re-converges before the verifier runs again.

## Settled design decisions

- **Staleness is evaluated only when every cell is inactive**, never mid-round. This batches accumulated changes into one wave instead of re-running settled cells per tiny delta. (Simulation controllers flagged the absence of this rationale; it is now explicit.)
- **Reactivation clears the cell's certification**; the cell holds none until it next deactivates through a certification route.
- **The verifier boundary is a round boundary in all but name**: apply every confirmed fix once, increment the fingerprint once if at least one fix applied, trigger spawned consequences, record applied changes. (Simulation controllers flagged that fingerprint increments were defined only for round boundaries.)
- **The stamp is a conjunction, not an authority.** The verifier can only decline to block: it never runs before wave convergence, its stamp names the exact fingerprint it certified, and post-review entry requires the stamp to equal the current fingerprint at a wave-converged state. No single agent can complete the run alone, preserving the engine's no-manufactured-LGTM invariant. Any later reviewable-content edit moves the fingerprint, which simultaneously invalidates the stamp and stales certifications; the staleness machinery is the single re-entry path.
- **Acknowledgements, follow-ups, applied changes, and refuted-finding acknowledgements persist for the whole run** (they already do; stated here because the phase-reset rule that previously created ambiguity about their scope is gone).
- **Identity simplification**: with no phase resets, the round number is monotonic per run, so run identity tuples become (round, fingerprint, delivery snapshot). The workflow invocation contract drops its `phase` field.
- **Caps**: at most 30 rounds per run and 10 verifier launches per run, both preflight-checked and fail-closed with diagnostics; the per-cell execution-repair budget of 3 is unchanged. The per-cell 10-attempts-per-phase counter is removed (the run round cap bounds total work). No cap path can manufacture LGTM, a stamp, or refutation.
- **Verifier parameters**: stable cell ID `verifier/whole-artifact`, fresh agent per launch, pinned to opus for every artifact type (a single seat carrying completion weight warrants the stronger tier; the code profile's volume rationale for sonnet does not apply to one agent). The verifier reads the whole artifact plus the standard common context and a holistic charter: cross-dimension coherence, gaps between dimension lenses, and completion-worthiness, reporting high-confidence findings only, with a concrete verification note required for a clean conclusion.

## Why completion stays sound

Completion previously attested: every dimension certified the final artifact in a terminal change-free phase, after at least two phase convergences. Under this design it attests: every dimension certified the exact final fingerprint (stronger than phase convergence, which mixed fingerprints), and one independent fresh holistic agent certified the same fingerprint. Every artifact state that reaches post-review has therefore been examined by at least two independent fresh looks (the converging cells and the verifier), including the pristine round-1-clean case that previously forced a full second phase. The trade accepted: the second look thins from a full per-dimension pass to one holistic seat; in exchange it gains a lens no dimension has (cross-dimension coherence), and the wave model means most cells have already re-reviewed the artifact across waves with fresh eyes each time.

## Simulation evidence (2026-08-13)

Ten opus controllers executed distilled instruction sets for this design (B) against an enhanced-phase variant (A: phases forced to converge on the latest fingerprint, terminal full phase retained) over five deterministic scenarios with 0 to 32 fixes, including cascade damage, a second-look issue, a verifier-only issue, and refuted noise. All ten executions matched the hand-computed ground truth. Reviewer-run totals (A vs B, verifier counted separately):

| Scenario (fixes) | A | B |
|---|---|---|
| pristine (0) | 16 | 8 + 1 verifier |
| light (3) | 24 | 16 + 1 |
| moderate (11) | 37 | 29 + 1 |
| heavy (20) | 40 | 40 + 2 |
| churn (32) | 48 | 40 + 1 |

B saved roughly one full 8-dimension pass at every fix volume except the heavy scenario, where it spent the savings catching a cross-cutting verifier-only defect that A completed without ever detecting. Wall-clock steps tied everywhere except that same scenario (A finished faster by shipping the defect). The phase variant's controllers also independently flagged a completion-count off-by-one hazard (whether the converged-phase count includes the just-converged phase), the same hazard family as the observed 2026-08-12 production failures; the wave variant's ambiguities were definitional gaps now settled above.

## Rejected alternatives

- **Enhanced phases (waves inside phases, phases retained)**: dominated in simulation; the intra-phase wave duplicates the next phase's work because the full next phase still runs. Never cheaper than the phaseless model, never catches more.
- **Ending at wave convergence with no verifier**: strictly cheapest, but the pristine case would complete on a single round of eight LGTMs, exactly what the old "Phase 1 cannot complete" rule exists to prevent; the verifier is the floor that preserves a second independent look in every run.
- **Restating the phase model more crisply** (the retired `revise-lifecycle-rounds` feature): a restatement reduces the mis-execution surface; removal eliminates it. Its round cap, cap-end asymmetry rule (a cap-forced end can never produce completion), change-free-final-state rationale, and the all-refuted deactivation trade note all carry forward into this design.

## Interactions

- **Fix-scoped follow-up rounds** (`fix-scoped-rounds.md`): composes; the reactivation wave replaces "the next phase's whole-scope reset" as that feature's full-coverage backstop, and waves 2+ must remain full-payload certifications (fix-scoping a wave would defeat its certifying purpose). That feature's Requires line now points here.
- **Second-opinion gates** (`second-opinion-gates.md`): natural merge target; making the verifier a different-model-family agent buys decorrelation. Deferred; the initial verifier is same-family opus.
- **Review orchestration tests** (`review-orchestration-tests.md`): its extractable-invariant purpose survives and gains value; its phase transition matrix content is superseded and will be refocused on wave/stamp invariants (staleness sweep, certification clearing, stamp conjunction, cap asymmetry) when this ships.

## Status

Designed 2026-08-13 across a working session: economics analysis, ten-controller simulation with matching ground truth, and the settled decisions above. Ready for planning; a revise-spec hardening pass over this file is recommended before or alongside implementation review.

## Requirements

- The revise lifecycle, state schema, checkpoint templates, drift and resume rules in `skills/revise/SKILL.md` (existing; the replacement subject).
- The workflow invocation contract in `skills/revise/revise-round.workflow.js` and its suite `skills/revise/revise-round.test.js` (existing; the `phase` input field is removed).
- The artifact parameter files, README, and repository AGENTS.md lifecycle descriptions (existing; phase references replaced).

**Requires:** none.

## Hardening

- (None entered yet; this file has not been through a revise-spec review.)
