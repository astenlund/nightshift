---
name: dual-strong-review
description: An extra strong review mode for critical work that uses two strong independent reviewers, preferably from different suppliers, and waits for both before repairs while skeptics start as each review arrives
metadata:
  type: feature
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
- What passes the gate: whether both reviewers must return clean assessments, whether both reassess after every repair batch, which doubles each round's cost, and how the final fresh pass works. Settled by the user the same day: "both have to come back clean and both get a new round if there are fixes". The gate passes only when both reviewers return clean assessments, and any repair batch sends both into a new round. Asked whether each reviewer's final clean round must come from a fresh context, as a single review's loop requires, the user answered: "I'd say yes, both need fresh as well". So each side's clean verdict after repair rounds is followed by a fresh-context assessment of its own, and the gate passes only when both fresh assessments are clean.

The user agreed these further answers on 2026-10-04, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- What counts as critical and who decides: the user marking it at agreement, the controller proposing it in the readback for work such as security, data loss, review gates or releases, or both. Settled: the user decides at agreement. The controller may propose the mode in the readback with its reason, such as work on review gates, releases, security or data loss, and the user may ask for it; it is never on by default.
- What happens when no user is available to decide. Settled: in a handed-over run the mode stays as agreed, and the controller never turns it on by itself; when it judges work critical that was not agreed for dual review, it records that recommendation in the morning report. In an attended run the controller may propose switching mid-run, and the user decides.
- Cost: about twice the review cost of the work it covers, which bears on the cost work graduated on 2026-10-03, such as [Proportionate review of tracking edits](tracking-review-cost.md), and on [Make resumed reviewers actually cheap](resumed-reviewer-cost.md). Settled by the answer on who decides: since the mode is never on by default, the user agrees to the doubled review cost each time it is used; the linked cost entries still bear on what that cost is.
- Relations: [Initial reviewer selection](initial-reviewer-selection.md), which picks one lead and prefers the other host; [User-configurable model policy file](model-policy-file.md), whose strong list defines the eligible models on each side; [Degraded assessment mode](degraded-assessment-mode.md); [Dispatch reviewer peers and return their evidence to the lead](reviewer-peer-dispatch.md); and [Controller-run experiments](controller-run-experiments.md), which would let the controller compare dual against single review, or a guided against an unguided second reviewer, as experiments. Settled as independent: each can ship without the others, so the entry declares no `**Requires:**` and the relations stay in this prose.

## First trial

On 2026-10-03 the controller ran the mode by hand, outside any run and without the runtime, on that session's 23 backlog commits (25 files): Astra through `codex exec` and Fable as a Claude Code subagent, both read-only, with one shared brief listing the user's agreed decisions, the recorded acknowledgements and the documentation dimensions. Each round's findings from both reviewers were merged before any repair, the controller verified every finding against the agreed decisions and the sources rather than through skeptic agents, both reviewers verified each repair batch by resuming, and each side ended with a fresh-context pass, so two clean fresh first assessments closed the loop. Each side took seven dispatches, three fresh and four resumed.

- The two reviewers' findings did not overlap in the first two passes. In the first, Astra raised two important findings where a record had drifted from the user's agreed decisions, while Fable raised three minor consistency findings and returned a clean verdict, so a single Fable review would have passed with both important findings unrepaired. In the first fresh pass, Astra again raised the only important finding.
- Overlap came later. In the rounds where the user added explicit dependency and link checks, both reviewers found the same items, including one important finding where three records offered options that exist only once another of them ships, and both final fresh passes raised the same minor finding.
- One important finding rested partly on the controller's own brief, which had paraphrased an agreed decision more broadly than the user agreed it: the record was faithful and its index excerpt was not. A brief that quotes agreed decisions rather than paraphrasing them avoids that.
- On verification, one of the final minor findings was refuted, and the other five were deferred into the session's next tracking batch, whose own review is to cover them, instead of starting another round.
- Astra's seven dispatches used 15,573,219 input tokens, 95.7 percent read from cache, and 36,135 output tokens; resumes kept their cache hits but carried growing context, as [Make resumed reviewers actually cheap](resumed-reviewer-cost.md) records. Fable's usage is not observable from the parent session beyond the harness's per-run figure.
- A Fable reviewer told to stay strictly read-only still wrote a link-checking script into the session's scratch directory, outside the repository; the controller's later instructions, and the follow-up batch's brief, named that directory as the only place for scratch scripts, which avoids the ambiguity.

The evidence is kept locally under `.tmp/dual-review-20261003-c6be6b01`.

## Before implementation

Checked on 2026-10-04: the runtime's review gate reads only the latest lead assessment of a task (`leadEntry` and `reviewGateFailure` in `internal/runtime/lifecycle.js`), so a gate that waits for two clean fresh assessments changes the runtime as well as [the operating brief](../../internal/workflow.md). Settle in a concise governing spec in `.nightshift/specs` how a stage runs two independent leads and merges their findings, how its gate requires both fresh clean assessments, and how the readback proposes the mode. The change rides with a plugin version increase and fixture tests, and the start of the work decides between a budgeted installed-host check and deterministic evidence only.

When the work starts, ask the user whether to enable dual mode for all Nightshift work through the project-local AGENTS.md, as the user directed at graduation on 2026-10-04: "add a note to ask whether to enable dual mode for all Nightshift work in the project-local AGENTS.md -- this will be decided when work starts". Tracking and readiness do not authorize implementation.
