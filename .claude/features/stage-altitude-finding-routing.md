---
name: stage-altitude-finding-routing
description: Explore durable routing of valid review findings to the pipeline stage that owns their altitude
metadata:
  type: feature
status: exploring
---

# Stage-altitude finding routing

Draft exploring controller-owned routing of valid review findings to the pipeline stage that owns their altitude, including durable `valid-but-plan-altitude` seeds that plan authoring must consume or explicitly reject with a verified record.

## Settled exploration boundary

- A valid finding need not be forced into the artifact under review or deferred directly to a backlog home when a later stage in the same lifecycle owns its altitude.
- Spec review gains a `valid-but-plan-altitude` disposition for implementation detail that should seed plan authoring without making the governing design overly prescriptive.
- The seed must survive session boundaries, and plan authoring must either consume it or record an explicit rejection that later validation can verify.
- The controller owns the disposition. Review agents report findings but do not silently transfer or discard them.

## Open design questions

- Choose the durable carrier for stage-altitude seeds without turning non-normative plan input into governing spec content or introducing a competing lifecycle identity.
- Define who may accept or reject a seed, the evidence each outcome records, and how revise-plan verifies complete consumption without requiring verbatim prose.
- Decide which downward routes, such as code findings to documentation work, use the same mechanism and which upward routes require the existing contradiction and agreement path.
- Define empty, stale, rejected, malformed, and interrupted-transition behavior across attended and unattended handover runs.
