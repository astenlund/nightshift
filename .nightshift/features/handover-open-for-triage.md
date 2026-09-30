---
name: handover-open-for-triage
description: A handed-over run stays open after delivery, with continuation lifted, so follow-up triage and its tracking edits happen in the running run under the normal gates
metadata:
  type: feature
---

# Keep a handed-over run open for triage after delivery

Raised by the user on 2026-09-30 in run `f440497c-a0cc-4375-bada-e834e32b49a6`, while triaging a follow-up about a stale triage record on a completed handed-over run. Asked how to track it, the user replied: "or should we extend the run to include the follow-up dispositions, since the triage is often likely to include backlog edits?" After the controller set out what that would run into, the user settled the direction: "i think the run should be treated as not closed, but after delivery, the stop hook can be lifted", and then: "let's graduate this feature, so we can pick it up in the next session".

## Problem

A handed-over run completes before the user answers its follow-ups. [The operating brief](../../internal/workflow.md) has it record the morning report and triage evidence stating which decisions stay deferred, then "complete with those follow-ups pending", and says optional follow-up decisions "never delay closing, the morning report or a completed delivery". When the user returns, triage happens on a complete run:

- `triage` is refused on a complete run, so the recorded triage keeps saying the decisions stayed deferred while `resolve-followup` records the user's actual decisions. The handover-close fixture of run `f440497c` (fixture run `a64f7816`) shows this, and [the acceptance report](../reports/independent-documentation-review-20260929.md) lists it under its limits.
- Triage usually brings backlog edits. Reviewing them after completion needed dedicated machinery: [Independent documentation review](independent-documentation-review.md) added a closing docs review that is admitted on a complete run as bookkeeping and gates nothing there, so its coverage matters only for publication.

## Agreed direction

- After delivery, a handed-over run is treated as not closed: follow-up triage, the tracking edits it calls for, their rerun checks and their closing docs review happen in the still-open run, under the same gates as an attended close, and the run completes after them.
- After delivery, continuation stops pressing the run: the Stop hook no longer resists the controller yielding, so the run waits for the user rather than keeping a session busy.

## Before implementation

- Define the delivered-but-not-closed state: which recorded boundary counts as delivery (the recorded morning report at the end of unattended work, or the user's `report-delivered` reply), how `status` and the closing stages show it, and how the SessionStart morning-report notice and delivery recording work with it.
- Release a native persistent goal after delivery as well as the Stop hook: [the runtime reference](../../internal/runtime/REFERENCE.md) requires a goal, where the host requires one, to refer to verified run completion, and [the handover skill](../../skills/handover/SKILL.md) carries the lifecycle "until verified completion", so a goal-carried run kept open after delivery would keep continuation pressing. Releasing a goal before run completion must also be reconciled with the rule, stated in both, never to replace an unfinished goal.
- Reword the guidance that assumes completion before triage: the brief's Close and report section, including the rule that optional follow-up decisions never delay a completed delivery and the instruction to complete with follow-ups pending, the handover skill, and the runtime reference, and decide how its closing record on complete runs relates to runs kept open, since a run that completes with follow-ups still pending would still need it.
- Decide how a delivered but open run interacts with other work in the checkout. `create` refuses a new run with `overlapping-run` while an unfinished run owns the checkout, and [Ready offers to pick up an interrupted run](ready-interrupted-run-pickup.md) (Exploring) would otherwise offer it as interrupted.
- Give a run whose follow-ups are never triaged a defined end, such as completing with them pending once the user declines or turns to other work, and state what then covers any tracking edits already made.
- Settle these in a concise governing spec in `.nightshift/specs`. Shipped runtime, hook and skill changes need a plugin version increase, and the start of the work decides between a budgeted installed-host campaign and deterministic evidence only, with model-owned behavior marked unverified.
