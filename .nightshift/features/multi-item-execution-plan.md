---
name: multi-item-execution-plan
description: When the user picks more than one item, propose an execution plan that works them in parallel, in sequence, together as a unit or a mix, and include it in the readback for agreement before any work starts
metadata:
  type: feature
status: exploring
---

# Execution plan for a multi-item selection

## Origin

Raised by the user on 2026-10-01, in their words: "idea: when picking more than one item, the controller or the runtime creates an execution plan where items can be worked in in parallel, in sequence, together as a unit, or a mix of all three. this execution plan is included in the readback so the user can agree to it before any work starts".

It came during a Ready selection in this repository. The user picked [Resumable reviewer and adversarial repair dialogue](resumable-reviewer-dialogue.md) and [Audit capabilities that left v2 without a disposition naming them](../QUICK_WINS.md#audit-capabilities-that-left-v2-without-a-disposition-naming-them) and asked "could we do 40 and 1 in parallel perhaps". The controller worked out a plan by hand for that readback: the audit as a read-only background agent keeping its evidence in `.tmp`, and its report and backlog edits landing before the other item's implementation starts or after it delivers, because a code, docs or skeptic assessment is discarded when files outside `.nightshift/runs`, `.nightshift/inbox` and `.tmp` change while it runs ([the runtime reference](../../internal/runtime/REFERENCE.md)).

## Related

- [The operating brief](../../internal/workflow.md) lets a shared agreement cover a finite queue and has run creation capture queue dependencies; [the v3 feature](nightshift-v3.md) accepts sequential dispatch as a baseline and uses parallel dispatch where available and useful.
- [Choose how agreed work proceeds](agreed-work-choice.md) changes how Ready's readback ends; [Size-aware Ready recommendations](ready-sized-recommendations.md) recommends groups of entries; [Deliver each run on its own branch or worktree](run-worktree-delivery.md) could let parallel items stop sharing one checkout.
- v2's handover skill had a queue (`skills/handover/handover-queue.js`, deleted in the v3 change 8ca3cb4), within the scope of the audit named above.

## Open questions

- Who builds the plan: controller judgment, the runtime from dependency declarations and the files each item touches, or both.
- What "together as a unit" means for runs, tasks, agreement and review, such as one task with one cumulative review.
- How parallel items coexist in one checkout and one active run, given the review input drift rule. The user added the same day: "you could use git worktrees and separate branches", which ties parallel items to [Deliver each run on its own branch or worktree](run-worktree-delivery.md) and leaves how their branches come back together open.
- How the plan is presented in the readback, how a change to it during the work is agreed, and how it interacts with handover.
