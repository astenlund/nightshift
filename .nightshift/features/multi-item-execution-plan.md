---
name: multi-item-execution-plan
description: When the user picks more than one item, propose an execution plan that works them in parallel, in sequence, together as a unit or a mix, and include it in the readback for agreement before any work starts
metadata:
  type: feature
---

# Execution plan for a multi-item selection

## Origin

Raised by the user on 2026-10-01, in their words: "idea: when picking more than one item, the controller or the runtime creates an execution plan where items can be worked in in parallel, in sequence, together as a unit, or a mix of all three. this execution plan is included in the readback so the user can agree to it before any work starts".

It came during a Ready selection in this repository. The user picked [Resumable reviewer and adversarial repair dialogue](resumable-reviewer-dialogue.md) and [Audit capabilities that left v2 without a disposition naming them](../QUICK_WINS_HISTORY.md#audit-capabilities-that-left-v2-without-a-disposition-naming-them) and asked "could we do 40 and 1 in parallel perhaps". The controller worked out a plan by hand for that readback: the audit as a read-only background agent keeping its evidence in `.tmp`, and its report and backlog edits landing before the other item's implementation starts or after it delivers, because a code, docs or skeptic assessment is discarded when files outside `.nightshift/runs`, `.nightshift/inbox` and `.tmp` change while it runs ([the runtime reference](../../internal/runtime/REFERENCE.md)).

## Related

- [The operating brief](../../internal/workflow.md) lets a shared agreement cover a finite queue and has run creation capture queue dependencies; [the v3 feature](nightshift-v3.md) accepts sequential dispatch as a baseline and uses parallel dispatch where available and useful.
- [Handover as the delivery boundary](handover-only-delivery.md) settles Ready's selection and scope-confirmation boundary, superseding the mandatory three-choice proposal; [Size-aware Ready recommendations](ready-sized-recommendations.md) recommends groups of entries; [Offer a run-owned worktree at handover](run-worktree-delivery.md) could let parallel items stop sharing one checkout. The worktree-delivery design retained one active run per project at its 2026-10-14 graduation and left parallel implementing items within that run to this entry.
- v2's handover skill had a queue (`skills/handover/handover-queue.js`, deleted in the v3 change 8ca3cb4), within the scope of the audit named above.

## Settled questions

The user agreed these answers on 2026-10-14, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: a run's tasks already form a dependency graph, where `requires` names upstream tasks and `start-task` refuses with `dependency-blocked` until they are complete, and nothing limits a run to one active task (`internal/runtime/lifecycle.js`); a change to project files outside `.nightshift/runs`, `.nightshift/inbox` and `.tmp` while a code, docs or skeptic assessment runs discards it as review input drift, so two items implemented in one checkout keep invalidating each other's reviews; and only the owning session can change a run, with no operation that adds a task.

- Who builds the plan. Settled: the controller proposes it from the items' dependencies and the files each is expected to touch. There is no separate plan artifact: the plan becomes the run's task graph, where sequence is a `requires` link, parallel is the absence of one and a unit is one task.
- What "together as a unit" means for runs, tasks, agreement and review. Settled: one task with one agreement covering all its items, one cumulative review and completion together.
- How parallel items coexist in one checkout and one active run, given the review input drift rule. Settled: parallel items that implement each work in a worktree on a branch of their own and are reviewed there, and their branches join the run's branch in an order the plan sets, after which the combined result gets a fresh cumulative review; merge conflicts are resolved within the run. Until [Offer a run-owned worktree at handover](run-worktree-delivery.md) ships, parallel means only read-only work, such as a background audit keeping its evidence in `.tmp`, alongside one implementing item, as the controller planned by hand on 2026-10-01.
- How the plan is presented in the readback, how a change to it during the work is agreed, and how it interacts with handover. Settled: the readback shows each item, whether it runs in sequence, in parallel or as a unit, and why, and the user's agreement covers the plan. Rescheduling between parallel and sequence is the controller's, reported in progress updates and the morning report; changing which items form a unit changes the agreement and needs the user's decision.
- How newly agreed items join an active run's plan. Settled: Ready and its readback work in another session while a run is active, and an item agreed there is recorded as a pending addition with its agreement on the user's direction, a write by a session that does not own the run, as with the stop that [Recover a run whose owner can no longer act while its host process lives on](stalled-owner-recovery.md) records. The owning controller takes it in at its next task boundary through the add-task operation that [Keep a handed-over run open for triage after delivery](handover-open-for-triage.md) plans, which whichever entry ships first builds.

## Slices

The entry ships in three slices, as the index records: the MVP covers the plan in the readback, units and read-only parallel work, and requires nothing; parallel implementation in worktrees requires [Offer a run-owned worktree at handover](run-worktree-delivery.md); and queueing work while a run is active requires nothing of its own. As Ready parses slices, each later slice also waits for the MVP, which suits the third, since a queued item takes its place in the plan.

## Before implementation

Settle how the controller derives the plan, how the readback presents it, how a unit is recorded, the pending addition and when the owner takes it in, and, for the second slice, how parallel branches join and are reassessed, in a concise governing spec in `.nightshift/specs`. The change alters the runtime, its reference, the operating brief and the Ready and handover skills, so it rides with a plugin version increase. Building the plan and scheduling are model-owned, so the work needs evidence on both hosts, with its budget decided when it starts. Tracking and readiness do not authorize implementation.
