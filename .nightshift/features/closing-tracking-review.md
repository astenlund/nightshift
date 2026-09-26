---
name: closing-tracking-review
description: A scoped independent review of triage tracking edits that the completion gate and the push gate accept
metadata:
  type: feature
---

# Closing tracking review

Raised by the user on 2026-09-24 after run `46fc13f1-98fc-4a3e-953c-958a31261ae4` completed. The user agreed the readback recorded below, then chose to track the work as a feature instead of implementing it in that session. Tracking and readiness do not authorize implementation.

## Problem

Follow-up triage comes after the session retrospective, so backlog edits that apply triage decisions land after the run's last review. Two consecutive runs on 2026-09-24 show the consequences:

- The completion gate re-checks every reviewed task, and a code review's snapshot covers the whole project inventory, so a tracking commit makes the run look stale. Run `46fc13f1` triaged while attended, was refused with `stale-review` ("Final reviewed inputs changed") and was completed only by temporarily restoring the reviewed file bytes. The handed-over run before it, `0a2dceee-1692-41f6-86bc-bc5c7b272a61`, completed before its follow-ups were answered, as the handover flow does, and applied its tracking edits afterwards.
- The global push gate treats tracking prose as judgment content. Run `46fc13f1` needed a separate direct review-loop over its tracking commit before pushing, and that review found a date-order error and an overstated message list, so the content genuinely needs independent review. The tracking commit of run `0a2dceee` was published with no recorded independent review.

Reviews are task-bound in the runtime: `dispatch`, `review`, `validate`, `dispose` and `repair` all name a task, and importing a review or recording a repair returns a completed task to its review stage. A tracking review therefore cannot reuse the task-level path unchanged.

## Agreed direction

The user chose to let the completion gate recognize a tracking-only change reviewed by its own receipt, rather than recording completion before tracking and leaving the review as a post-completion obligation.

1. **Tracking scope.** Tracking edits are changes confined to the backlog: the four indexes, their history files, and records under `.nightshift/features`, `.nightshift/bugs` and `.nightshift/patterns`. Any change outside those paths still needs a full cumulative review, so a tracking commit cannot carry code or other documentation past the gate.
2. **Tracking review.** A new review kind, `tracking`, performed by one strong independent reviewer over the diff since the last reviewed snapshot. Its brief is factual accuracy of each claim against the code and records it cites, backlog grammar and conventions, and consistency with sibling entries and history files, without the six code dimensions. Its findings still receive fresh skeptic validation, a disposition, repair and a further tracking review, and none of this reopens the completed engineering tasks.
3. **Completion gate.** Completion accepts a task review that is stale only in tracking paths when a clean tracking review, recorded after the triage evidence, matches the current inventory. Checks whose inputs the tracking edits touched, such as the ready parser check, must be rerun. A new retrospective clears the tracking review, as it clears the other closing evidence.
4. **Handed-over runs.** Their triage usually happens after completion, when the user replies to the morning report. A tracking review can also be recorded on a completed run as bookkeeping, and that record covers the tracking edits at publication.
5. **Guidance.** The operating brief's Close and report section and the runtime reference say to apply tracking edits after the triage decisions, run the ready parser, record the tracking review and then complete.

## Before implementation

- The change adds a review kind, a run-level record and a gate change, so it needs a concise governing spec in `.nightshift/specs` with independent spec review before code, and a plugin version increase.
- Since 3.2.10 the completion gate also admits a covering code-kind review owned by another code or docs task that lists the task, through `sharesCumulativeAssessment` in `internal/runtime/lifecycle.js` (see [Let one cumulative assessment cover code and docs tasks together](../QUICK_WINS_HISTORY.md#let-one-cumulative-assessment-cover-code-and-docs-tasks-together)). The spec reconciles the tracking exception with that admission rule.
- The runtime behavior is covered by deterministic tests. The guidance changes model-owned closing behavior, so the user decides at start between a budgeted installed-host campaign on both hosts (one attended close with triage and tracking edits, one handover close) and deterministic evidence only, with the model-owned behavior marked unverified.
