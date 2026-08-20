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

## Candidate directions (none committed)

- Delta-scoped re-review: reactivated cells receive the diff since their last certification alongside the full artifact, with the full-payload certification rule preserved (compare fix-scoped-rounds, which narrows for a different reason).
- Convergence-aware batching: when the last K rounds each produced at most one confirmed finding, run all still-active cells plus the sweep candidates in one combined round rather than serial cell-tail rounds.
- Cheaper wave re-entry: a sweep wave over a one-line delta could run a reduced-effort confirmation pass with full-effort review reserved for cells whose dimension the delta plausibly touches; conflicts with the certification-requires-full-review rule, so it needs a real design decision, not a tweak.
- Round-economy telemetry first: instrument runs (findings per round, hunks per fix batch, wave counts) before choosing a mechanism.

## Requirements

- The wave lifecycle in `internal/revise/SKILL.md` (shipped); any mechanism here edits lifecycle invariants and pairs with the review-orchestration-tests module and fixtures once that feature ships.
