---
name: harder-review-fixtures
description: Harder lead and skeptic fixtures for the seeded-defect suite, drawn from real run records, mutated real code and designed skeptic traps
metadata:
  type: feature
status: exploring
---

# Harder fixtures for lead review and skeptic evaluation

## Origin

Raised by the user on 2026-10-29 after confirming the 3.3.17 installation on both hosts: how to create harder tests for lead reviews and skeptic evaluations, and whether a workflow step should mine future Nightshift runs for suitable scenarios using real code. Tracked as Exploring the same day.

## Observation

The seeded-defect suite is saturated on detection. [The GLM evaluation of 2026-10-23](../reports/glm-5-3-review-evaluation-20261023.md) found Opus 5.5, Sol and GLM 5.3 all at the ceiling on the seventeen fixtures of the time and said harder fixtures were needed before detection could rank models. [The corrected Opus baseline of 2026-10-25](../reports/seeded-defect-baseline-20261025.md), on the full suite of twenty-three fixtures run twice, again detected every planted defect in every dimension and agreed with the truth on every skeptic verdict, so it states that detection can show a regression but not an improvement. Of the figures the baseline reports, detection and skeptic accuracy sit at their ceilings, so the ones that can still move are clean-change false positives, unmatched confirmations, severity agreement, the out-of-scope rate and tokens per fixture run. The fixtures are small synthetic trees, the sibling-path and out-of-scope cases the spec requires included, so a reviewer inspects the whole project rather than searching it, a regime strong reviewers saturate.

Everything a harder scenario could be drawn from is already recorded in each project's run store: each task's findings with their severity and, once validated, a verdict, the dispositions (implement, defer, skip or refuted, each with a reason), the repairs marking the findings they repaired, and each dispatch's registration beside whatever artifacts it left: a receipt when it completed, a failure record when one could be written, and sometimes neither, since the runtime reference lets a failed dispatch keep only its worker record. Findings and verdicts imported into run state stay there even when the receipt that carried them can no longer be read, and the cumulative diff and manifest the reviewer read are kept in the dispatch's context folder. A dispatch that left neither receipt nor failure record is a gap in the evidence; the fortnight tool already counts dispatches without a receipt, and a mining tool would identify and list such gaps rather than present them as scenarios. The fortnight tool already reads these records to count how often a fresh gate after a resumed closure raised a critical or important finding, which is often a defect an earlier assessment passed over, though it may also sit in the repair itself. The suite's fixture grammar already admits the receipt id of a defect a fresh gate caught as a defect's origin.

## Proposal

Grow the suite in three directions, each with its own fixture criteria, and measure the result through the suite's existing acceptance rules.

- Mined real scenarios. A read-only tool shaped like the fortnight tool reads a project's run store and lists candidate scenarios with their base SHA, dispatch and receipt ids: a critical or important finding a fresh gate raised after a clean cumulative review, a finding a skeptic refuted whose site a later repair changed anyway, a confirmed finding disposed as skip or defer, and a finding one lead raised that another lead dispatched on the same inputs did not. The tool lists; it does not write fixtures. A maintainer trims a candidate into a self-contained base and change tree within the spec's size guideline, writes the requirements as a controller would, audits the tree for every real issue a reviewer could report and records the origin. The nightshift and Hermes stores already hold weeks of runs, so mining need not wait for future ones. This is not a lifecycle step: a step inside delivery would change shipped behavior, cost a version increase and brief changes, and record nothing the store does not already hold.
- Mutated real code. Take a snapshot of a real module, apply one semantic mutation with a recorded truth entry and keep the rest intact, so the reviewer finds a needle in a realistic haystack. What makes these harder than the current fixtures is the surrounding real code, not the defect class: the spec already requires sibling-path and out-of-scope cases, so the gain is in the search. Candidate mutation classes: evidence that spans two files, code that is internally consistent but contradicts the requirements text, ordering and concurrency faults with no visible error path, and a repair that reintroduces a fixed bug.
- Skeptic traps. Beyond false decoys, add findings that are true but mis-located, true with inflated severity, true in conclusion with wrong evidence, and findings whose proposed fix would regress something. Grading these needs the truth to carry the expected verdict per trap class, which the current decoy grammar, a false finding with a reason, does not express.

## Open questions

- Selection bias in mining: the store holds only what some reviewer eventually caught, never a shared blind spot. How far cross-model disagreement and mutation compensate, and whether a blind-spot estimate is possible at all.
- Fixture size against cost: harder fixtures mean larger trees, and fixture size dominates a dispatch's tokens. Where to set the size guideline, and whether the suite needs a per-fixture token figure to choose fixtures by.
- Grading: the open bug "Seeded-defect grader gives a planted defect to a nearer unrelated finding" in [BUGS.md](../BUGS.md) matters more once fixtures hold several nearby truths; skeptic traps need a verdict-per-class truth grammar and a matching accuracy figure; a true-but-mislocated finding needs a matching rule that tolerates the wrong location while grading it.
- Acceptance: adding fixtures changes the fixture set hash, so the spec's acceptance rules require a new baseline and reset targets. Whether to keep the current set as a regression floor and grow a second set for ranking.
- Provenance and privacy: fixtures drawn from a project's run store carry that project's code. Which projects may contribute, and how a fixture names its origin without leaking planted truth into reviewer context.
- Placement: whether the mining tool belongs under `tools/` beside the harness, as the suite does, so no plugin version increase follows.

## Related

- [Measure whether the lifecycle catches defects](defect-detection-measurement.md), whose first version the suite realizes and whose planned second version runs the lifecycle around the review; the fresh-gate catch rate becomes measurable there.
- [The seeded-defect suite spec](../specs/seeded-defect-suite.md), whose fixture grammar, composition rules and acceptance rules govern any growth of the suite.
- The quick win "Resolve the seeded-defect suite's deferred review findings" in [QUICK_WINS.md](../QUICK_WINS.md), and the bugs "Seeded-defect grader gives a planted defect to a nearer unrelated finding" and "Seeded-defect harness cannot resume past a null token reading" in [BUGS.md](../BUGS.md), which bound what the harness can grade and resume before the suite grows.
- [Controller-run experiments](controller-run-experiments.md), for which a harder suite is the controlled harness for comparing review arms.
