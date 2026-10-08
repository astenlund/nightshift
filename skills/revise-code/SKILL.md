---
name: revise-code
description: "Use for explicit revise-code or revise code intent, or required implementation review and repair inside an accepted Nightshift delivery. Standalone revision creates a review context, not a delivery run. Plain review and review-loop requests do not activate this skill."
---

# Revise code

Use [automatic preparation and resource binding](../../internal/releases/REFERENCE.md#skill-activation) before this skill. Claude native session marker: `${CLAUDE_SESSION_ID}`.

Use [the shared operating brief](../../internal/workflow.md) and [runtime review operations](../../internal/runtime/REFERENCE.md#independent-assessment). Within accepted delivery, use its existing authorized task. Otherwise use `open-review` with kind `code`, a preserved UUID `reviewContextId`, actual controller identity, authority, objective and agreement. Subsequent operations name that context, its current revision, actor and target `#review`. No delivery run, continuation, session retrospective or triage is created. Native ownership, resource integrity, serialization and complete assurance remain required. Establish the agreed outcome and full cumulative change, including uncommitted edits and new files. Advanced staged-only or historical-range selection remains unsupported; state that limitation instead of silently substituting another scope. A previous review does not authorize narrowing a requested new pass.

Dispatch a fresh strong lead with all six code dimensions, the requirements, complete change and surrounding context. Prefer the other host at equivalent strength when suitable; the controller chooses placement. Do not supply the author rationale or filter dimensions. Reviewers and skeptics cannot edit reviewed inputs.

Validate every finding with a fresh skeptic using concrete evidence; decide validity, authority and practical value separately, and have the skeptic's repair proposal before any repair. Apply authorized worthwhile repairs and verify them. After every repair batch, including small ones, resume the reviewer that raised the repaired findings, or replace it when it cannot be resumed, to record their closure and reassess the cumulative change and sibling paths; then pass the gate only on a fresh lead's assessment, as the brief describes. Relay a dialogue between reviewer and skeptic when a finding's consequence, value or repair quality stays disputed. Missing or stale evidence cannot pass. A fresh assessment whose findings resolve without edits finishes without an LGTM-only repeat. Investigate the shared cause after repeated related findings.

Record reports, skeptical verdicts, dispositions, checks and outstanding work through the runtime so compaction cannot erase obligations. Reconcile the existing context and surviving workers after resumption; never replace missing or unreadable known state. Another owner's unfinished delivery or uncertain worker prevents conflicting canonical repairs; isolated assessment may continue. Report actual results, accepted tradeoffs and unresolved work. Standalone revision lists pending follow-ups in its final message; delivery retains its closing triage. Do not publish without authority.
