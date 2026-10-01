---
name: lore-proposal-review-gate
description: Apply the common strong review, skeptic validation and disposition process to the instruction proposals a session retrospective makes, as the v3 migration agreed
metadata:
  type: feature
status: exploring
---

# Review retrospective instruction proposals like any other change

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded the retained need "Loop revise-lore's fresh-eyes pass to convergence" as Present; independent auditors and verifiers found its agreed disposition carried only in part. Drafted overnight for the user's triage.

## Agreed disposition

Agreed on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md) under Review and simplification ownership: "Apply the common independent review, skeptic validation, and finding-disposition process to proposed instruction changes. Only a completed strong independent assessment with credible broad coverage can support passing the review gate. Every repair batch receives full cumulative review. No-edit resolutions avoid an extra LGTM-only pass only when the artifact is unchanged and that assessment is complete; weaker-only or narrowly focused review requires a fresh strong integrated assessment. Preserve user control over applying changes. A qualified existing reviewer can continue without a separate convergence system."

## Current behavior

Checked on 2026-09-29:

- [revise-lore](../../skills/revise-lore/SKILL.md) asks only: "Give a fresh independent reviewer the proposed diffs, current destination content, applicable conventions and evidence; assess conflicts, overlap, proportionality and whether the rule will be recalled where needed. Validate findings before changing the proposal." It names no strength, broad coverage, skeptic validation, disposition or reassessment after a revision.
- The general rules exist in [the operating brief](../../internal/workflow.md) ("Advisory assessment never supplies the required strong review coverage", "Every finding receives fresh skeptic validation", "Weak or narrow coverage cannot pass the gate") and in the status the runtime emits ("Every repair needs cumulative strong broad review"), but none names instruction proposals, and the brief's review section is written around implementation.
- Nothing gates proposals made in a lifecycle retrospective: the retrospective records only text evidence, and no runtime operation adds a lore task mid-run. A standalone lore task without an imported assessment completes directly; one that imports an assessment does get the review loop enforced.
- User approval is carried: revise-lore presents reviewed proposals for approval before any instruction changes.
- Continuing a qualified existing reviewer was not possible when this was found, because the runtime could not resume a reviewer; [Resumable reviewer and adversarial repair dialogue](resumable-reviewer-dialogue.md) delivered that on 2026-10-01 in the local 3.3.0 candidate, for any review kind, so a lore assessment's reviewer can now be resumed through a repair like any other.

## Direction

Apply the common review, skeptic validation and disposition process, with a strong broad assessment and cumulative reassessment after each revision, to every instruction proposal, whether a standalone revise-lore or a lifecycle retrospective makes it, and have the runtime hold proposals to it.

## Open questions

- What a lifecycle retrospective dispatches its proposal assessment against, since no task exists for it mid-run.
- How this fits [Run-free revise](run-free-revise.md), which would let revise-lore run on its own without a runtime run, and [Degraded assessment mode](degraded-assessment-mode.md), which changes what a weaker assessment may carry.
- Which installed-host evidence the changed model-owned behavior needs.
