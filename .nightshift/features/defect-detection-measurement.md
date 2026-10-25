---
name: defect-detection-measurement
description: Measure the lifecycle's defect detection and false-positive rates against a fixed suite of seeded defects
metadata:
  type: feature
status: exploring
---

# Measure whether the lifecycle catches defects

## Origin

From the user-supplied ideas document "Workflow ideas adopted from other agent tools" (raised 2026-09-26; its comparison with other tools comes from general knowledge, not a systematic survey). Tracked as Exploring at the triage of run `f87356d8-8613-45a8-93e5-d79c48f2254b` on 2026-09-27.

## Observation

Nightshift's central claim is that independent review, skeptic validation and cumulative reassessment catch what the implementer missed. Acceptance reports record single observations of behavior rather than detection rates. Since 2026-10-24 the [seeded-defect suite](../specs/seeded-defect-suite.md) measures detection, false-positive, severity and skeptic rates for one fresh code lead and its skeptic, with Opus 5.5 targets reset on 2026-10-25 from [its corrected baseline](../reports/seeded-defect-baseline-20261025.md); it runs no repair, closure or fresh gate, so the rates for the whole lifecycle this record proposes remain unmeasured. Benchmarks such as SWE-bench and Aider's leaderboards show how persuasive measured results are.

## Proposal

Build a small fixed suite of tasks with seeded defects of known kinds across the code dimensions. Run the lifecycle against the suite and record detection rate, false-positive rate after skeptic validation, and time and model cost per task. Repeat the measurement when models or review guidance change. It measures whether the trust that reliability rests on is warranted instead of asserting it, and provides the baseline that efficiency work needs before claiming savings.

## Open questions

- An explicit aggregate budget and reliable usage accounting, as required for real-model campaigns. The seeded-defect suite provides both for lead and skeptic dispatches (`--budget` and per-attempt token records), with two known limits: a single null token reading stops a run folder for good (the BUGS.md entry "Seeded-defect harness cannot resume past a null token reading"), and an evaluated host's token totals may not count cached input as the Claude and Codex records do. A whole-lifecycle run still needs both.
- How to prevent the suite from leaking into reviewer context or training effects. The seeded-defect suite refuses its contamination tokens in everything it supplies to a reviewer and grades a run that mentions them as contaminated; training effects remain open.
- How many runs are needed for a meaningful rate.

## Related

- [Maintain verification evidence, fixtures and measured efficiency](v3-verification-infrastructure.md), which covers fixture ownership and startup efficiency but not detection measurement.
- [Orchestration efficiency](orchestration-efficiency.md), which needs measured baselines.
- [Controller-run experiments](controller-run-experiments.md), for which this suite would be a controlled harness for comparing review arms, such as two reviewer models or a guided and an unguided reviewer.
