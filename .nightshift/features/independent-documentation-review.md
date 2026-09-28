---
name: independent-documentation-review
description: One independent documentation review kind that revise-docs requires and that closing tracking uses, accepted by the completion gate and the push gate
metadata:
  type: feature
---

# Independent documentation review

Raised by the user on 2026-09-24 after run `46fc13f1-98fc-4a3e-953c-958a31261ae4` completed, as the closing tracking review. The user agreed the readback recorded under [Tracking direction](#tracking-direction-agreed-2026-09-24), then chose to track the work as a feature instead of implementing it in that session. On 2026-09-28, in run `a0eaaee7-6c97-4261-960d-346c6a4654aa`, the user widened it into a documentation review kind that revise-docs also requires, recorded under [Widened scope](#widened-scope-agreed-2026-09-28). Tracking and readiness do not authorize implementation.

## Problem

Follow-up triage comes after the session retrospective, so backlog edits that apply triage decisions land after the run's last review. Two consecutive runs on 2026-09-24 show the consequences:

- The completion gate re-checks every reviewed task, and a code review's snapshot covers the whole project inventory, so a tracking commit makes the run look stale. Run `46fc13f1` triaged while attended, was refused with `stale-review` ("Final reviewed inputs changed") and was completed only by temporarily restoring the reviewed file bytes. The handed-over run before it, `0a2dceee-1692-41f6-86bc-bc5c7b272a61`, completed before its follow-ups were answered, as the handover flow does, and applied its tracking edits afterwards.
- The global push gate treats tracking prose as judgment content. Run `46fc13f1` needed a separate direct review-loop over its tracking commit before pushing, and that review found a date-order error and an overstated message list, so the content genuinely needs independent review. The tracking commit of run `0a2dceee` was published with no recorded independent review.

Reviews are task-bound in the runtime: `dispatch`, `review`, `validate`, `dispose` and `repair` all name a task, and importing a review or recording a repair returns a completed task to its review stage. A tracking review therefore cannot reuse the task-level path unchanged.

Standalone revise-docs has the same gap without any triage. A docs task may import an assessment, but [the runtime reference](../../internal/runtime/REFERENCE.md) keeps the direct completion path for a maintenance task without one, and [the skill](../../skills/revise-docs/SKILL.md) never asks for one. On 2026-09-28 the graduation of [Reproduce a bug with a failing check before repairing it](reproduce-before-repair.md) (commit `db1f2b7`) described operating-brief guidance that does not exist yet in the present tense. Only the author's own revise-docs pass in run `a0eaaee7` caught it (commit `8d51714`), and no independent reviewer saw either commit.

## Widened scope (agreed 2026-09-28)

1. **One documentation review kind.** The planned `tracking` kind becomes a documentation review kind, performed by one strong independent reviewer over the documentation change with the relevant code supplied as context. Its brief is the accuracy of each claim against the code and records it cites, the completeness of the sweep (documentation, changed or not, that the change left stale or missing), backlog grammar and conventions, consistency with sibling entries and history files, and proportionality, without the six code dimensions. Its findings still receive fresh skeptic validation, a disposition, repair and a further documentation review.
2. **revise-docs requires it.** revise-docs obtains this assessment of its complete change, with the same skeptic validation and cumulative repair loop as revise-code. Purely mechanical changes, such as a regenerated file or a version string, need none. It works on today's run-bound machinery and moves to the run-less review path when [Run-free revise](run-free-revise.md) ships.
3. **Closing tracking is one use of it.** Items 1, 3, 4 and 5 of the tracking direction below apply unchanged with this kind in place of `tracking`, so the completion-gate exception stays limited to the tracking scope of backlog paths.

## Tracking direction (agreed 2026-09-24)

The user chose to let the completion gate recognize a tracking-only change reviewed by its own receipt, rather than recording completion before tracking and leaving the review as a post-completion obligation.

1. **Tracking scope.** Tracking edits are changes confined to the backlog: the four indexes, their history files, and records under `.nightshift/features`, `.nightshift/bugs` and `.nightshift/patterns`. Any change outside those paths still needs a full cumulative review, so a tracking commit cannot carry code or other documentation past the gate.
2. **Tracking review.** Superseded on 2026-09-28 by the documentation review kind above; the original terms were: a new review kind, `tracking`, performed by one strong independent reviewer over the diff since the last reviewed snapshot. Its brief is factual accuracy of each claim against the code and records it cites, backlog grammar and conventions, and consistency with sibling entries and history files, without the six code dimensions. Its findings still receive fresh skeptic validation, a disposition, repair and a further tracking review, and none of this reopens the completed engineering tasks.
3. **Completion gate.** Completion accepts a task review that is stale only in tracking paths when a clean tracking review, recorded after the triage evidence, matches the current inventory. Checks whose inputs the tracking edits touched, such as the ready parser check, must be rerun. A new retrospective clears the tracking review, as it clears the other closing evidence.
4. **Handed-over runs.** Their triage usually happens after completion, when the user replies to the morning report. A tracking review can also be recorded on a completed run as bookkeeping, and that record covers the tracking edits at publication.
5. **Guidance.** The operating brief's Close and report section and the runtime reference say to apply tracking edits after the triage decisions, run the ready parser, record the tracking review and then complete.

## Before implementation

- The change adds a review kind, a run-level record and a gate change, and changes revise-docs, so it needs a concise governing spec in `.nightshift/specs` with independent spec review before code, and a plugin version increase.
- Settle which files the documentation kind covers. The user's global review convention treats files an agent loads as operating instructions (skills, the operating brief, instruction files) as code and descriptive prose (READMEs, specs, reports, the backlog) as documentation; [Separate run-time guidance from reference material](runtime-guidance-separation.md) decides which parts of the two REFERENCE files remain run-time instructions.
- Since 3.2.10 the completion gate also admits a covering code-kind review owned by another code or docs task that lists the task, through `sharesCumulativeAssessment` in `internal/runtime/lifecycle.js` (see [Let one cumulative assessment cover code and docs tasks together](../QUICK_WINS_HISTORY.md#let-one-cumulative-assessment-cover-code-and-docs-tasks-together)). The spec reconciles the tracking exception with that admission rule.
- [Whole-backlog coherence audit](backlog-coherence-audit.md) reviews its repairs with the documentation lens; this kind supplies that lens. [Run-free revise](run-free-revise.md) also edits revise-docs, so whichever lands second reconciles with the other.
- The runtime behavior is covered by deterministic tests. The guidance changes model-owned closing and revise-docs behavior, so the user decides at start between a budgeted installed-host campaign on both hosts (one attended close with triage and tracking edits, one handover close, one standalone revise-docs pass) and deterministic evidence only, with the model-owned behavior marked unverified.
