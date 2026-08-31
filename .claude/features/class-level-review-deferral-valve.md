---
name: class-level-review-deferral-valve
description: Explore a controller-owned diminishing-returns valve for recurring classes of review findings
metadata:
  type: feature
status: exploring
---

# Class-level review deferral valve

Draft exploring a controller-owned diminishing-returns valve for a fuzzy issue family reported in a second consecutive round. The controller may designate the class deferrable then and there, route and log the current finding with a narrow boundary, and acknowledge only that family while every review, staleness, convergence, and verifier gate continues normally.

## Settled exploration boundary

- This is not exact-finding deduplication and not ordinary deferral of a finding that is already obviously out of scope when first reported.
- The first report need not appear deferrable. A fresh review reporting the same type of issue in the next consecutive round is the signal for a controller judgment that further remediation of that class is not worth the token cost.
- Designating a class deferrable is not automatic. The controller makes and records the decision, routes the current finding durably, and defines the acknowledged family narrowly.
- The affected dimension keeps reviewing normally. Only the acknowledged family is suppressed; materially different, broader, or contract-breaking findings remain reportable.
- The valve never skips a cell, staleness sweep, convergence boundary, or holistic verifier.

## Open design questions

- Define the fuzzy issue-family classifier, its evidence, and how family identity survives fingerprint changes, deduplication, reactivation waves, manual fallback, and resume.
- Define which severities and contract boundaries may qualify without treating repeated minor findings as evidence that no more serious defect exists.
- Define the controller record, acknowledgement grammar, route lifecycle, invalidation conditions, and verifier visibility.
- Define behavior when the second-round classification is uncertain, the durable route cannot be written, or a later finding crosses the recorded class boundary.
