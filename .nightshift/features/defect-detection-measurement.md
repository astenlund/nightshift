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

Nightshift's central claim is that independent review, skeptic validation and cumulative reassessment catch what the implementer missed. Current acceptance reports record single observations of behavior rather than detection rates. Benchmarks such as SWE-bench and Aider's leaderboards show how persuasive measured results are.

## Proposal

Build a small fixed suite of tasks with seeded defects of known kinds across the code dimensions. Run the lifecycle against the suite and record detection rate, false-positive rate after skeptic validation, and time and model cost per task. Repeat the measurement when models or review guidance change. It verifies the quality priority instead of asserting it, and provides the baseline that efficiency work needs before claiming savings.

## Open questions

- An explicit aggregate budget and reliable usage accounting, as required for real-model campaigns.
- How to prevent the suite from leaking into reviewer context or training effects.
- How many runs are needed for a meaningful rate.

## Related

- [Maintain verification evidence, fixtures and measured efficiency](v3-verification-infrastructure.md), which covers fixture ownership and startup efficiency but not detection measurement.
- [Orchestration efficiency](orchestration-efficiency.md), which needs measured baselines.
