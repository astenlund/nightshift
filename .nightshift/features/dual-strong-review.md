---
name: dual-strong-review
description: An extra strong review mode for critical work that uses two strong independent reviewers, preferably from different suppliers, and waits for both before repairs while skeptics start as each review arrives
metadata:
  type: feature
status: exploring
---

# Dual strong review for critical work

## Origin

Raised by the user on 2026-10-03, outside any run, during a backlog session, in their words: "idea: introduce an extra strong dual-review mode for critical stuff. this would use two strong agents, preferably from different suppliers of available. the controller should wait for both reviews to come in before making fixes (skeptics can be dispatched right away)."

## Current behavior

Checked on 2026-10-03. A review stage has one strong lead reviewer, and [the operating brief](../../internal/workflow.md) prefers an equivalent-strength lead on the other host when suitable. The agreed but unbuilt [Dispatch reviewer peers and return their evidence to the lead](reviewer-peer-dispatch.md) adds peers of the lead's own model and effort, whose evidence returns to that one lead for a single integrated assessment, so it does not give two independent verdicts from different suppliers. No backlog entry describes two independent strong reviews of the same change.

## Direction

- For work marked critical, two strong reviewers assess the same change independently, preferably from different suppliers when both are available, such as Claude and Codex.
- The controller waits for both reviews before making repairs. Skeptics validating a review's findings are dispatched as soon as that review arrives.

## Settled questions

Answered by the user on 2026-10-03, the day the entry was raised: "fallback to two of the same model is ok. the controller merges the two results before fixing."

- What happens when a second supplier is not available: two strong reviewers from one supplier in fresh contexts, waiting, or the single-review path. Settled: two strong reviewers of the same model, each in a fresh context, are an acceptable fallback.
- How findings from both reviews are merged and deduplicated before repair, which [Keep every affected surface when merging findings](finding-affected-surfaces.md) bears on. Settled: the controller merges the two results before any repair. Skeptics still start on each review's findings as that review arrives; once both are in, the controller combines them into one set of findings, keeping every affected surface and its evidence and recording which reviewer raised each finding. A finding both reviewers raised is a stronger signal to check, not proof, so it still gets its skeptic validation.
- What passes the gate: whether both reviewers must return clean assessments, whether both reassess after every repair batch, which doubles each round's cost, and how the final fresh pass works. Settled by the user the same day: "both have to come back clean and both get a new round if there are fixes". The gate passes only when both reviewers return clean assessments, and any repair batch sends both into a new round. Whether each reviewer's final clean round must come from a fresh context, as a single review's loop requires, stays open below.

## Open questions

- What counts as critical and who decides: the user marking it at agreement, the controller proposing it in the readback for work such as security, data loss, review gates or releases, or both. The user left this open on 2026-10-03.
- Whether each reviewer's final clean round must come from a fresh context, as a single review's loop requires.
- Cost: about twice the review cost of the work it covers, which bears on the cost work graduated on 2026-10-03, such as [Proportionate review of tracking edits](tracking-review-cost.md), and on [Make resumed reviewers actually cheap](../QUICK_WINS.md#make-resumed-reviewers-actually-cheap).
- Relations: [Initial reviewer selection](initial-reviewer-selection.md), which picks one lead and prefers the other host; [User-configurable model policy file](model-policy-file.md), whose strong list defines the eligible models on each side; [Degraded assessment mode](degraded-assessment-mode.md); and [Dispatch reviewer peers and return their evidence to the lead](reviewer-peer-dispatch.md).

Tracking does not authorize implementation.
