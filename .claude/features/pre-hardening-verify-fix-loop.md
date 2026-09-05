# Pre-hardening verify-fix loop

Adds a verify-fix loop as a lifecycle step before `revise-spec`, run by a fresh strongest-model agent per iteration, so a spec is reshaped at the macro level before the multi-agent hardening loop starts accumulating micro-detail findings.

## Motivation

Observed in another project and captured mid-run during the 2026-09-03 batch: running a verify-fix loop ahead of the hardening loop shortened the revise tail noticeably, because the strong model restructured the design while restructuring was still cheap. Once the hardening loop is running, every macro-level change invalidates certifications across the whole cell set and costs a full reactivation wave.

The supporting evidence from this repository's own run is the shape of its spec gate: sixty-eight rounds, with most findings after the second reactivation wave being byte-level. A loop that lands the macro-level reshaping first would have removed a large share of the rounds whose only product was a rewording that then had to be re-certified by seven cells.

## The loop

The step runs before `revise-spec`, after the spec is written and before the hardening loop is entered. Each iteration dispatches one fresh agent with no prior context, asks it to verify the spec against its governing requirement and the repository, and applies the fixes it returns. The loop stops when an iteration returns nothing that changes the artifact.

The loop is deliberately not the multi-agent engine: one agent per iteration, no dimension fan-out, no skeptics, no certification bookkeeping. Its job is to find the shape defects that a single strong reader sees at a glance, not to be exhaustive; exhaustiveness is what the hardening loop that follows is for.

Open at pick-up: whether the loop has its own round cap, what it does when a fix it applies contradicts an earlier iteration's fix (the same fixer-ownership hazard that produced the author-agent rewrite regression), and whether its output feeds the hardening loop any state at all or the hardening loop starts cold.

## Model exception

The step uses the strongest model available, Fable at high effort. This is an explicit exception to the engine's current pins, which reserve Fable for the controller and pin reviewers, skeptics, and verifiers to opus, and it must be written as an exception rather than as a general relaxation of those pins.

If [Run-shaping settings: round cap and review lanes](run-shaping-settings.md) lands first, this step becomes another lane in that surface with its own default rather than a hardcoded exception; the two designs must be reconciled in whichever order they ship, so the pin is stated once.

## Lifecycle integration

- `skills/handover/SKILL.md`: the step's placement in the lifecycle, before the spec gate.
- `skills/revise-spec/SKILL.md`: the relationship between this loop and the hardening loop it precedes, including what the hardening loop may assume about an artifact that has been through it (nothing, unless the design decides otherwise).
- `internal/revise/SKILL.md` and `internal/revise/spec.md`: only if the loop reuses engine machinery; the default position is that it does not.

## Verification

Fixtures cover a spec that converges in one iteration, a spec that needs several, a loop that reaches its stop condition with the artifact unchanged, and an iteration whose fix contradicts a prior iteration's fix. A live claim over a real spec records the round count of the following hardening loop with and without the pre-hardening step, since the entire justification is that the tail gets shorter.

## Non-goals

- Replacing the hardening loop or reducing its dimension coverage.
- Running the loop over plans or code; this step is spec-shaped work only until evidence says otherwise.
- Relaxing the engine's reviewer, skeptic, and verifier model pins generally.
