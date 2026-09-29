---
name: run-free-revise
description: Revise skills invoked on their own run without creating a runtime run, keeping attributed review evidence through a lightweight review record
metadata:
  type: feature
---

# Run-free revise

Raised by the user on 2026-09-28 in run `a0eaaee7-6c97-4261-960d-346c6a4654aa`, in their words: "i think all of the revise skills should be available for individual invocation without creating a run, only handover should do that". The controller proposed keeping the attended runs that a project lifecycle requirement starts and making the review operations usable without a run; the user agreed that readback, recorded below. Tracked in [the feature index](../FEATURES.md#run-free-revise). Tracking and readiness do not authorize implementation.

## Problem

Every revise skill invoked on its own currently ends up in a runtime run. [revise-docs](../../skills/revise-docs/SKILL.md) and [revise-lore](../../skills/revise-lore/SKILL.md) say they work independently using a docs or a lore task in the runtime. [revise-code](../../skills/revise-code/SKILL.md) and [revise-spec](../../skills/revise-spec/SKILL.md) arrive there implicitly: `dispatch`, `review`, `validate`, `dispose` and `repair` all name a task, and tasks exist only inside a run. This follows the v3 decision of 2026-09-07 in [the migration assessment](../../V3-MIGRATION.md#standalone-operations-and-work-already-underway) that standalone revision uses the shared Nightshift machinery.

A run carries obligations a single revise does not need. On 2026-09-28 a standalone revise-docs pass created run `a0eaaee7` for one docs task. Once that task completed, the run still required a session retrospective and follow-up triage before it could complete, and until then, or until it is stopped, `create` refuses a new run in the checkout with `overlapping-run`.

## Agreed direction

- Runs belong to agreed implementation delivery: the attended run that a project lifecycle requirement starts once implementation scope is agreed, and a handed-over run. A revise skill invoked on its own never creates a run; invoked inside an active run, it keeps using that run's tasks as today.
- The runtime review operations become usable without a run through a lightweight review record holding dispatch receipts, skeptic verdicts, dispositions and repairs. It keeps what makes a revise review trustworthy: the isolated read-only review copy, cross-host dispatch, receipts attributed to the model that actually ran and checked for freshness, and findings recorded durably enough to survive compaction. It has no controller claim, continuation, closing stages or completion gate.
- Follow-ups found by a run-free invocation are listed in its final message with enough context to act on, as a run without a handover already does; there is no triage stage.
- Direct agents without runtime records were considered and rejected: cheaper to build, but equivalent to the user's global review-loop and without attributed receipts, which are why the user's global push gate accepts an explicitly requested revise workflow's review.

## Before implementation

- Settle the review record's complete lifecycle in a concise governing spec in `.nightshift/specs`: creation, storage relative to `.nightshift/runs/state.sqlite`, session binding and ownership, how it survives compaction and is found again, bounds and cleanup, which limits apply to its dispatches now that run `limits` such as `maxDispatches` and `deadlineUtc` have no run to belong to, what happens when a run starts in the checkout while it is open, and how status and hooks treat it.
- Amend the text that ties standalone revision to a run: the "works independently" sentences of revise-docs and revise-lore, which name a docs or lore task in the runtime, and the runtime reference's standalone lore task, which currently supplies a run's session retrospective. [The v3 feature](nightshift-v3.md) says standalone revision uses explicit revise intent and that documentation and retrospective operations remain independently callable, and run-free revise keeps both. The 2026-09-07 decision in [the migration assessment](../../V3-MIGRATION.md#standalone-operations-and-work-already-underway) stays as preserved reasoning: the governing spec settles whether run-free revise departs from its shared machinery and shared lifecycle behavior; if it does, the migration record gains a pointer to the superseding decision rather than a rewrite, and if it does not, neither file changes.
- [Independent documentation review](independent-documentation-review.md) landed first, in the local 3.2.16 candidate: revise-docs now requires a docs assessment of its complete change, and a run-level closing record reviews tracking edits after triage. This feature, landing second, moves that assessment to the run-less path and reconciles with it.
- Shipped skill and runtime changes need a plugin version increase, and the start of the work decides between a budgeted installed-host campaign and deterministic evidence only, with the model-owned behavior marked unverified.
