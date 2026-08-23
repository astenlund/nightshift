---
name: wave-round-economy
description: Explore reducing the number of review rounds a whole-artifact revise run consumes, prompted by a spec run needing three user cap raises
metadata:
  type: feature
status: exploring
---

# Wave round economy

Draft exploring how to cut the round count a revise run consumes to converge. Prompted by the 2026-08-20 review-orchestration-tests spec run, which needed three user cap raises (30 to 40 to 50 to 60) while producing genuinely confirmed findings the whole way; the cost was not noise but the lifecycle's per-fix amplification. Complements the queued verifier-round cap-exclusion quick win, which trims accounting rather than work.

## Observed amplifiers

- **Whole-artifact fingerprint granularity**: any one-clause fix moves the single fingerprint, staling every certification and forcing full re-certification waves over deltas most cells have no stake in. Section- or claim-scoped certification would let unaffected cells stay certified.
- **Single-finding tail rounds**: late in a run, each round yields one narrow finding, one micro-fix, one fingerprint move, one sweep, repeatedly. Batching candidate fixes across a probation round, or accepting N clean sub-rounds before re-certifying, would collapse the tail.
- **Fix-authored surface**: fixes add new spec surface (new sentences, new fields) that later rounds then review as fresh ground; a run's own hardening extends its runway. Possibly inherent; worth measuring before mechanism-building.
- **Verifier rounds inside the round cap**: already captured as the cap-exclusion quick win.

- **Whole-file fingerprint over a shared index** (evidence from the 2026-08-23 version-increase-gate handover): the revise-spec run over one 25-line bullet in `QUICK_WINS.md` fingerprinted the whole index file with the `design-before-hardening` selector, so one clause added to the bullet in round 3 reactivated six cells already certified at the earlier fingerprint and round 5 re-reviewed the same text six more times; the run converged in 6 rounds where an entry-scoped fingerprint (the `bullet-entry` selector already exists in `skills/spec-agreement/spec-agreement.js`) would have converged in 4.

## Candidate directions (none committed)

- Delta-scoped re-review: reactivated cells receive the diff since their last certification alongside the full artifact, with the full-payload certification rule preserved (compare fix-scoped-rounds, which narrows for a different reason).
- Convergence-aware batching: when the last K rounds each produced at most one confirmed finding, run all still-active cells plus the sweep candidates in one combined round rather than serial cell-tail rounds.
- Cheaper wave re-entry: a sweep wave over a one-line delta could run a reduced-effort confirmation pass with full-effort review reserved for cells whose dimension the delta plausibly touches; conflicts with the certification-requires-full-review rule, so it needs a real design decision, not a tweak.
- Round-economy telemetry first: instrument runs (findings per round, hunks per fix batch, wave counts) before choosing a mechanism.

## Catch-earlier levers (evidence from the same run)

Distinct from the lifecycle amplifiers above: these reduce the findings themselves, at authoring time, rather than the rounds per finding.

- **Surface-symmetry checklist**: when a spec defines a function surface, apply the full contract set (typed parameters, typed result, state-domain refusal, guard interaction, off-domain fixture) across every function in one authoring pass; the run derived these one function per round across roughly fifteen rounds.
- **Sibling sweep per fix batch**: every boundary fix batch sweeps the fixed pattern's sibling sites (decision bullets vs sections, fixture lists vs prose, carrier enumerations) before the batch closes; several rounds existed only to catch a sibling a prior batch missed.
- **Clause-level authority diff**: before round 1 of a spec that restates an authority document, diff every restated sentence against its source clause; four separate rounds each caught one conformance divergence a single pre-pass would have caught together.
- **Design search belongs in brainstorming**: the failure-class mechanism iterated through five designs inside the review loop; hardening reviews are an expensive place to do design search, and a mechanism with open design questions should go back to a design pass rather than iterating via findings.
- **Enumeration-treadmill awareness**: a relationship section that reads as exhaustive converts every unlisted neighbor into a future finding; either mark the enumeration non-exhaustive or accept that each backlog addition creates review work in every spec that enumerates neighbors.
- **Reviewer calibration against refutation patterns**: each refuted finding costs a skeptic dispatch plus adjudication. The run's roughly fourteen refutations clustered in three reviewer failure patterns worth naming in the payload delivery rules: assert a failure scenario only after tracing reachability against the shipped producers (upstream normalization killed two prominent claims); before reporting a divergence-from-authority finding, check whether a neighboring lifecycle record owns the seam; and treat a recorded acknowledgement's reasoning, not just its literal wording, as settled ground. Lowering the dud-dispatch rate is cheaper than widening the skeptic pipeline. (Shipped 2026-08-21 into `internal/revise/spec.md`'s Reviewer calibration bullet, alongside a referent-grounding rule and a D5 unpinned-deliberate-rules lens.)
- **Reciprocal-record symmetry sweep**: when a spec adds a reciprocal record about a neighbor, sweep the neighbor's file for the mirror-side record in the same change; rounds 52-76 repeatedly caught one missing mirror side per round, and the unshipped mirrors became morning-report follow-up items.
- **Ship-site enumeration audit**: when a spec prescribes updates to enumeration sites (suite lists, count sentences, literal test pins), audit the actual repository sites at authoring time rather than naming site categories; the missed sites are count sentences and literal pins, one round each.
- **Fixture pairing at authoring time**: pair each deliberate positive rule ("X proceeds under Y") with its fixture in the same authoring pass; rounds 62, 70, and 71 each caught one unpinned rule. Authoring-side complement of the D5 unpinned-deliberate-rules review lens.
- **Lifecycle-status boilerplate refresh**: refresh a section's status boilerplate (Status lines, "not yet designed" phrasing, tense) whenever the section is rewritten; boilerplate left over from an earlier lifecycle stage generated late conformance rounds.

## Requirements

- The wave lifecycle in `internal/revise/SKILL.md` (shipped); any mechanism here edits lifecycle invariants and pairs with the shipped orchestration module and fixtures (`internal/revise/orchestration.js`, `internal/revise/orchestration.test.js`) in the same change set.
