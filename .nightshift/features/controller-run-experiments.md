---
name: controller-run-experiments
description: Let the controller design and run bounded experiments within the user's authority, such as comparing reviewer models or review framings, and report each result for the user to adopt, repeat, revise, track or discard
metadata:
  type: feature
status: exploring
---

# Controller-run experiments

## Origin

Raised again by the user on 2026-10-03, after a backlog session that ran several experiments by hand (a dual review by two reviewer models, compacting a reviewer thread before its resume, explicit dependency and link checks), when proposing to compare a reviewer guided by the review lenses with an unguided one, in their words: "i was thinking this could be part of the "controller running experiments" feature; the controller decides which experiment to run (astra vs fable, guided vs unguided, etc.)". On learning that nothing in the backlog tracked it any longer: "that's unfortunate, i definitely want it back."

## How it was lost

Nightshift v2 carried the capability inside an Exploring draft for a two-level run management design, a run manager with an optional shift supervisor, which never shipped. On 2026-09-06 the v3 migration simplified that draft into the optional supervisor now tracked by [Spawn a shift supervisor when admin work fills the controller's context](context-triggered-supervisor.md), and its disposition did not name the experiment authority. A sibling draft for an experiment evidence ledger was simplified into recording material conclusions in the ordinary run record, "without a separate ledger or experiment framework" ([V3-MIGRATION.md](../../V3-MIGRATION.md)), now tracked by [Carry settled decisions and experiment evidence into later reviews](v3-review-decision-context.md). The 2026-10-01 audit of capabilities that left v2 without a disposition covered shipped capabilities, so this part of an unshipped draft went unnoticed until 2026-10-03.

## Direction

Restated from the v2 draft as the starting point, not yet agreed:

- The controller may devise, authorize and run bounded experiments without asking first when every variant stays within the authority already granted, keeps every mandatory gate, and does not put the primary result at material risk. An experiment that risks the outcome, permissions, publication, destructive actions or the user's intent needs the user's authority before it runs.
- Each experiment records its hypothesis, control and treatment arms when comparable work exists, how work is assigned to arms, what is measured, its stop conditions and cost limit, how contamination between arms is avoided, its rollback, and the result that would decide the hypothesis.
- Arms are kept isolated and every variant is identified, with enough evidence to tell a treatment effect from differences between tasks; a separate evaluator judges the outcome where practical. A/B control is preferred when comparable work exists; otherwise a weaker design may be used, with its confounders reported and an inconclusive result allowed.
- Instruction variants run as temporary overlays, never by silently rewriting the canonical instructions during a run.
- A variant joins real work only when every arm stays compliant and useful; one that could jeopardize the primary result runs in shadow or waits for the user.
- Results never promote themselves. The report states the hypothesis, method, sample, observed effects, costs, limits, side effects, conclusion and recommendation, and offers adopting, repeating, revising, tracking or discarding the change for the user to decide.
- In the v2 draft a shift supervisor executed experiments that dispatch workers and the run manager ran only one-step probes itself; in v3 the controller can coordinate directly, and the optional supervisor is still Exploring.

## Candidate experiments

From 2026-10-03: the reviewer model (Astra versus Fable); a reviewer guided by the review lenses versus an unguided one that receives the change and the governing requirement but no lenses; dual versus single review; and compacting a Codex reviewer thread before its resume, and above which threshold. That day's manual trials are recorded in [Dual strong review for critical work](dual-strong-review.md) and [Make resumed reviewers actually cheap](resumed-reviewer-cost.md).

## Open questions

- The 2026-09-06 migration agreed on no separate experiment framework; this entry asks for controller-run experiments again, so how much structure they need, from a recorded experiment with arms and a report section to less, is to be settled with the user.
- Budgets, arm assignment, contamination controls, evaluator independence, and what evidence counts as directional, conclusive or inconclusive.
- Where experiment evidence lives, given that [Carry settled decisions and experiment evidence into later reviews](v3-review-decision-context.md) records material conclusions in the run record.
- Whether experiments run only inside agreed runs or also on their own, and how the authority boundary is stated where a run loads it.
- How it relates to [Measure whether the lifecycle catches defects](defect-detection-measurement.md), whose planted-bug suite is a controlled harness for comparing review arms, and to [Model knowledge base](model-knowledge-base.md), where results about models would land.

Tracking does not authorize implementation.
