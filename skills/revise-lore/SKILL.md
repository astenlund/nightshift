---
name: revise-lore
description: "Use for explicit revise-lore or a Nightshift retrospective, or the required retrospective inside accepted delivery. Standalone reflection uses a review context without creating a delivery run."
---

# Session retrospective

Use [automatic preparation and resource binding](../../internal/releases/REFERENCE.md#skill-activation) before this skill. Claude native session marker: `${CLAUDE_SESSION_ID}`.

Use [the closing and triage rules](../../internal/workflow.md#close-and-report). Within accepted delivery, use the existing run and record its retrospective once after documentation/backlog reconciliation and before triage; an ordinary documentation edit does not satisfy that stage. Otherwise use [the runtime](../../internal/runtime/REFERENCE.md) `open-review` with kind `lore`, a preserved UUID `reviewContextId`, actual controller identity, authority, objective and agreement. Subsequent operations name the context, current revision, actor and target `#review`. Standalone reflection creates no delivery run, continuation or further session closing; it reports pending follow-ups directly. Preserve context ownership, evidence, resources and proposal approval obligations through compaction.

Inspect observed session evidence: user corrections, recurring implementation or workflow failures, lost obligations before or after compaction, ineffective rules, and useful approaches. Distinguish a product defect to fix at its source from a lesson or proposed instruction. Route project-specific conclusions to the project; cross-project conventions belong in the canonical global instructions, preserving host adapters. Plugin changes belong in its source clone.

Prepare only worthwhile proposals. State principles with concrete firing conditions and evidence, avoiding duplicated rules or enumerated-example checklists. Give a fresh independent reviewer the proposed diffs, current destination content, applicable conventions and evidence; assess conflicts, overlap, proportionality and whether the rule will be recalled where needed. Validate findings before changing the proposal.

Present concrete reviewed proposals for user approval before changing instructions. If the user is unavailable, preserve the complete proposal, motivation, assessment and original approval terms as pending follow-ups. Do not treat silence as approval. Triage one item at a time when the user returns. No worthwhile proposal means the retrospective completes without artificial ceremony.
