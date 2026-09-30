---
name: repair-current-contents
description: Direct every repair to start from the current contents and keep earlier repairs' constraints, and state that the controller routes fixes to a helper-owned artifact through that helper
metadata:
  type: feature
---

# Repairs start from current contents and respect helper ownership

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded "Give the engine a fixer-ownership rule so controller edits and an author agent cannot overwrite each other" as Present; independent auditors and verifiers found its agreed disposition carried only in part. The v2 need, as its title says, was a rule so that controller edits and an author agent cannot overwrite each other. Drafted overnight for the user's triage.

## Agreed disposition

Agreed on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md#repair-coverage-and-progress): "Keep one active writer per shared artifact, with an explicit handoff when responsibility changes. Repairs use current contents and preserve earlier constraints; cumulative review checks the integrated result. Independent file assignments can run concurrently. Establish ownership without requiring a file-lease subsystem or a new per-fix record format."

## Current behavior

Checked on 2026-09-29:

- Carried: helpers record exclusive write ownership ([the operating brief](../../internal/workflow.md): "Record assignment, host/session, model/effort, and exclusive write ownership"), the status the runtime emits says "Preserve writer ownership.", the runtime refuses overlapping writes between registered workers, and a handoff is explicit and recorded: registration assigns paths and `worker-finished` releases them only after completion is verified. Independent assignments can run concurrently, and every repair batch gets a cumulative review that includes previous repairs.
- Missing: nothing directs whoever makes a repair, the controller or a helper, to apply it to the current contents rather than a private or reassembled copy, or to keep the constraints of earlier repairs. A reverted fix is caught only afterwards, by relevant verification or the next cumulative review, and the status lists only unresolved findings, so a resolved finding's constraints do not reach a later repairer.
- Missing in part: the controller's own exclusion from a helper's owned paths is implied by "exclusive" but never stated, and no sentence says a fix to a helper-owned artifact goes through that helper. The disposition establishes ownership without requiring a file-lease subsystem, so a stated rule may be enough, though proportionate enforcement stayed open until the settlement below.

## Direction

State the repair rules where a run loads them: repairs start from the current contents and preserve earlier constraints, and the controller does not edit a path a helper owns but routes the fix through the helper or takes the path back through a recorded handoff.

## Settled questions

The user agreed these answers at triage on 2026-09-30, and the entry graduated from Exploring to current work on 2026-10-01. Each question is kept with its answer.

- Where earlier repairs' constraints come from for a later repairer, since the status lists only unresolved findings; compare [Carry settled decisions and experiment evidence into later reviews](v3-review-decision-context.md), which carries settled decisions to reviewers rather than repairers. Settled: the controller gives each repair assignment, its own or a helper's, the earlier resolved findings and repairs on the same artifact, read from the run's recorded state (`inspect` returns the complete state). No new record format is added.
- Whether any of this needs a runtime check, given that the disposition does not require a file-lease subsystem or a per-fix record format. Settled as stated rules only: [the operating brief](../../internal/workflow.md) is to say that repairs start from the current contents and keep earlier repairs' constraints, that the controller never edits a path a helper owns, and that a fix to a helper-owned path goes through that helper or a recorded handoff. The runtime stays unchanged; relevant verification and the cumulative review still catch a reverted fix afterwards.

## Before implementation

The change is shipped instruction text that alters model-owned behavior, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check and deterministic evidence only with the model-owned behavior marked unverified. An agreed readback suffices; no governing spec is needed. Tracking and readiness do not authorize implementation.
