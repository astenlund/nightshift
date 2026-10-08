---
name: revise-docs
description: "Use for explicit revise-docs or required documentation and backlog reconciliation inside accepted Nightshift delivery. Standalone revision uses its own review context without creating a delivery run."
---

# Revise docs

Use [automatic preparation and resource binding](../../internal/releases/REFERENCE.md#skill-activation) before this skill. Claude native session marker: `${CLAUDE_SESSION_ID}`.

Use the documentation and closing rules in [the operating brief](../../internal/workflow.md#close-and-report). Within accepted delivery, use its existing authorized task and record this reconciliation as documentation evidence. Otherwise use [the runtime](../../internal/runtime/REFERENCE.md) `open-review` with kind `docs`, a preserved UUID `reviewContextId`, actual controller identity, authority, objective and agreement. Subsequent operations name that context, its current revision, actor and target `#review`. A standalone invocation has no delivery run, continuation or mandatory session closing. Preserve ownership, resources, exact evidence and repair obligations through compaction. Establish the actual change from the conversation, files and Git evidence.

Find documentation that refers to changed behavior, renamed or retired identifiers, relocated files and completed backlog entries. Include relevant README/docs content and the .nightshift indexes, breakouts and patterns. Update actual stale claims and navigable references, including affected sibling descriptions. Keep descriptions proportionate and preserve useful design reasoning and historical evidence. New instruction rules remain proposals for independent assessment and user approval.

Preserve the four-index convention: shipped entries move to the corresponding history, dropping Requires/External; delivered slices are struck and the next slice gates advance; remove satisfied Requires references from other active entries. Retired proposals are recorded as retired, never shipped or fixed. Validate backlog changes with the real ready parser, recorded as the ready parser check with `--check` as the operating brief describes.

Obtain a strong independent docs review of the complete change through the runtime's `docs` assessment kind, preferring the other host at equivalent strength, with the relevant code as context. Validate every finding with a fresh skeptic, decide validity, authority and value separately, repair, and after every repair batch resume the docs reviewer that raised the repaired findings, ending with a fresh docs review, as revise-code does for code. A purely mechanical change, such as a regenerated file or a version string, may instead record its exemption when the task completes. Edits to files agents load as operating instructions also need a code assessment. Tracking edits after follow-up triage get the closing docs review the operating brief describes.

Report what changed and remaining uncertainty. Within delivery, complete its session retrospective next, before follow-up triage. Standalone revision lists pending follow-ups directly and finishes without a delivery retrospective or triage. A standalone documentation request does not authorize unrelated implementation, publication or new instructions.
