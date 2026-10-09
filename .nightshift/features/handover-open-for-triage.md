---
name: handover-open-for-triage
description: A handed-over run stays open after delivery, with continuation lifted, so follow-up triage, its tracking edits and agreed follow-on work happen in the running run under the normal gates
metadata:
  type: feature
---

# Keep a handed-over run open for triage after delivery

Raised by the user on 2026-09-30 in run `f440497c-a0cc-4375-bada-e834e32b49a6`, while triaging a follow-up about a stale triage record on a completed handed-over run. Asked how to track it, the user replied: "or should we extend the run to include the follow-up dispositions, since the triage is often likely to include backlog edits?" After the controller set out what that would run into, the user settled the direction: "i think the run should be treated as not closed, but after delivery, the stop hook can be lifted", and then: "let's graduate this feature, so we can pick it up in the next session".

## Problem

A handed-over run completes before the user answers its follow-ups. [The operating brief](../../internal/workflow.md) has it record the morning report and triage evidence stating which decisions stay deferred, then "complete with those follow-ups pending", and says optional follow-up decisions "never delay closing, the morning report or a completed delivery". When the user returns, triage happens on a complete run:

- `triage` is refused on a complete run, so the recorded triage keeps saying the decisions stayed deferred while `resolve-followup` records the user's actual decisions. The handover-close fixture of run `f440497c` (fixture run `a64f7816`) shows this, and [the acceptance report](../reports/independent-documentation-review-20260929.md) lists it under its limits.
- Triage usually brings backlog edits. Reviewing them after completion needed dedicated machinery: [Independent documentation review](independent-documentation-review.md) added a closing docs review that is admitted on a complete run as bookkeeping and gates no task or completion there. Since 3.3.10 it does bear on replacement: a closing record reopened after completion holds a new handover back until the run completes again, and a closing check recorded on the record after completion holds it back until the latest qualifying closing assessment covers what the check recorded, while later file changes without recorded closing work do not.
- Follow-on work agreed after the report needs a new run. On 2026-10-03, after the morning report of run `e92922e8-d20f-4674-907c-bf3277f5f184`, the user agreed a one-sentence change to the operating brief before triaging that run's seven pending follow-ups. A complete run takes no new task and runtime writes must name the checkout's current run, so the change got run `4ba1ff28-1b06-4c93-b5ff-17f6c7365e04`, which left the first run's follow-ups unresolvable and out of the SessionStart morning-report notice; the controller copied them into the new run. Asked how to track the gap, the user said: "feels to me like we shouldn't need a new run in this situation".

## Agreed direction

- After delivery, a handed-over run is treated as not closed: follow-up triage, the tracking edits it calls for, their rerun checks and their closing docs review happen in the still-open run, under the same gates as any delivery close, and the run completes after them.
- After delivery, continuation stops pressing the run: the Stop hook no longer resists the controller yielding, so the run waits for the user rather than keeping a session busy.
- Follow-on work the user agrees at the report or during triage joins the still-open run as a new task, so its pending follow-ups and the new work stay in one run. Added at triage on 2026-10-03.

## Before implementation

- Define the delivered-but-not-closed state: which recorded boundary counts as delivery (the recorded morning report at the end of unattended work, or the user's `report-delivered` reply), how `status` and the closing stages show it, and how the SessionStart morning-report notice and delivery recording work with it.
- Release a native persistent goal after delivery as well as the Stop hook: [the runtime reference](../../internal/runtime/REFERENCE.md) requires a goal, where the host requires one, to refer to verified run completion, and [the handover skill](../../skills/handover/SKILL.md) carries the lifecycle "until verified completion", so a goal-carried run kept open after delivery would keep continuation pressing. Releasing a goal before run completion must also be reconciled with the rule, stated in both, never to replace an unfinished goal.
- Reword the guidance that assumes completion before triage: the brief's Close and report section, including the rule that optional follow-up decisions never delay a completed delivery and the instruction to complete with follow-ups pending, the handover skill, and the runtime reference, and decide how its closing record on complete runs relates to runs kept open, since a run that completes with follow-ups still pending would still need it.
- Decide how a delivered but open run interacts with other work in the checkout. `handover` refuses a new run with `overlapping-run` while an unfinished run owns the checkout, and [Ready offers to pick up an interrupted run](ready-interrupted-run-pickup.md) would otherwise offer it as interrupted. As agreed when that feature graduated on 2026-10-03, whichever of the two ships second makes Ready present a delivered but still open run as delivered and waiting for the user's follow-up triage, with an offer to continue that triage in a new session, never as interrupted.
- Give a run whose follow-ups are never triaged a defined end, such as completing with them pending once the user declines or turns to other work, and state what then covers any tracking edits already made.
- Add an operation that adds an agreed task to an open run, recording its agreement as `handover` does; [Review retrospective instruction proposals like any other change](lore-proposal-review-gate.md) needs the same operation for a retrospective's proposal, and whichever feature ships first builds it, as agreed on 2026-10-03, and decide how a run that has recorded its retrospective, report or triage returns to engineering for the new task and which closing stages it then repeats.
- Settle these in a concise governing spec in `.nightshift/specs`. Shipped runtime, hook and skill changes need a plugin version increase, and the start of the work decides between a budgeted installed-host campaign and deterministic evidence only, with model-owned behavior marked unverified.
