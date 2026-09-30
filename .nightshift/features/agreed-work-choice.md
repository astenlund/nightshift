---
name: agreed-work-choice
description: Have Ready end with a three-choice question, through the host's question tool, whether to hand over, implement without a runtime run, or pause with the agreed task kept ready
metadata:
  type: feature
---

# Choose how agreed work proceeds

Raised by the user on 2026-09-30 in run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9`. The readback there ended with "After a yes, this runs as an attended self-hosting run", and the user replied that this "made it sound like attended was required for some reason. the last few runs have had reasons for attended runs, due to live campaign complications." Earlier the user had asked "the last few runs have been attended. what do we need to make unattended available for most tasks?", and later handed that run over. At triage, offered a quick win to reword how a readback describes the run mode, the user replied: "track, but I think we should instead make unattended the standard mode. We've exercised the workflow enough now that that's what I always do, trusting the provess". Later in the same triage the user refined that direction: "here's what i want: ready ends with a three-choise user question (native if the host supports it): - hand over - just implement without creating a runtime run (the user would have to run revise skills manually if wanted later on, pairs with the runless revise feature) - pause here (task stays locked and loaded, but nothing is implemented just now; useful if the user wants to chat about it before commencement)", adding "could be a separate step after acknowledgement".

## Problem

Attended is the default mode, and a run operates unattended only through the user's explicit handover, whether a new run is created unattended at handover or a running one is handed over later. Nothing asks the user which they want:

- [The operating brief](../../internal/workflow.md) says "Handover is the user's act, invoked through the skill or in prose, and until then the session stays interactive", and [WORKFLOW.md](../../WORKFLOW.md) says the same: "Handover is the user's act."
- [The Ready skill](../../skills/ready/SKILL.md) tells the controller not to ask whether to hand over, start a separate task or open a new conversation, a rule shipped in 3.2.4 as "Continue agreed Ready work in the current session" in [QUICK_WINS_HISTORY.md](../QUICK_WINS_HISTORY.md), which kept agreement on scope and explicit handover as distinct decisions.
- This repository's [AGENTS.md](../../AGENTS.md) has agreed implementation start an attended run, with "An explicit handover selects unattended operation."

So a user who always hands over must volunteer it for every run, and a readback that mentions the run mode reads as if attended were required. Creating a run unattended already exists in the runtime; the change concerns how the user is asked to choose.

## Agreed direction

- Ready ends with one question with three choices, through the host's native question tool where the host has one:
  - **Hand over:** the agreed work proceeds unattended under the handover rules.
  - **Implement without a runtime run:** the controller implements directly and creates no run; review, documentation and retrospective happen only if the user later runs the revise skills, which pairs with [Run-free revise](run-free-revise.md).
  - **Pause:** the agreed task stays locked and loaded, and nothing is implemented yet, so the user can discuss it before work starts.
- The user suggested the question could be a separate step after the readback is acknowledged; where it is asked is still open.

## Before implementation

- Decide where the question is asked: at the end of the readback, or, as the user suggested it could be, as a separate step after acknowledgement. The 3.2.4 rule kept agreement on scope and explicit handover as distinct decisions, which a separate step would preserve.
- Decide whether an attended run with the full lifecycle, today's default, remains a choice. The user's reasons for recent attended runs (live-campaign complications), this repository's AGENTS.md self-hosting rule and [Run-free revise](run-free-revise.md), which keeps the attended run a project lifecycle requirement starts, all rely on it.
- Reverse the Ready skill's rule against asking about handover, and reconcile the brief's and WORKFLOW.md's "Handover is the user's act": choosing hand over in the question is that act.
- Define pause: what records the agreed task (a run created but not started, or the agreement alone), how it survives compaction and a new session, how the user resumes it and which choice then applies, and how it interacts with `overlapping-run` and [Ready offers to pick up an interrupted run](ready-interrupted-run-pickup.md) (Exploring).
- Define implement without a runtime run: which guidance still applies, how the final message says that no independent review ran, and whether the choice is offered in a project, such as this repository, whose instructions require the full lifecycle for agreed implementation.
- Define hand over when continuation cannot be verified. Today such a handover is recorded in attended mode; carry the user's direction in [Handed-over continuations lose unattended execution intent](../BUGS.md#handed-over-continuations-lose-unattended-execution-intent) that missing or inactive continuation is a recovery blocker to report and resolve, not a reason to silently reinterpret the work as attended.
- Keep the settlement rule: every queued item still has its readback or governing decisions confirmed before a handover. Reconcile this with [Background review and assessment of selected work](selection-review-and-assessment.md), which changes when a handover is accepted, and with [Keep a handed-over run open for triage after delivery](handover-open-for-triage.md).
- Give hosts without a native question tool a plain-text form of the question.
- Update the brief, the Ready and handover skills, the runtime reference where it describes handover, WORKFLOW.md and this repository's AGENTS.md self-hosting rule together.
- Settle these in a concise governing spec in `.nightshift/specs`. Shipped skill and guidance changes need a plugin version increase and a decision between installed-host evidence and deterministic evidence only, with model-owned behavior marked unverified.
