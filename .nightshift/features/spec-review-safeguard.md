---
name: spec-review-safeguard
description: Complete the retained spec-review safeguard and authoring guidance that the v3 migration recorded as present, so a spec finding justifies demanded detail, review challenges complexity and the approach, and specs record important tradeoffs
metadata:
  type: feature
status: exploring
---

# Complete the spec-review safeguard and authoring guidance

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for, in their words: "i had initially approved cutting features for the initial v3 migration, but i didn't mean "silently remove functionality and mark it as delivered" -- what wasn't shipped should have remained/appeared in the backlog. we should look for more stuff that's unaccounted for". Independent auditors and verifiers found four retained needs that [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded as Policy present, whose agreed dispositions a run carries only in part. Drafted overnight for the user's triage.

## Agreed dispositions

The v3 migration agreed these on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md):

- Gate spec-review fixes by artifact layer before editing, under Review scale and spec discipline: "Require a reviewer to explain why a detail belongs in the spec by identifying a consequential gap, contradiction, or defect in its commitments or chosen approach."
- Calibrate revise-spec against implementation-detail escalation, in the same section: "Fold the shared safeguard into the four agreed spec lenses and common review instructions, preserving contractual detail and important reasoning without demanding a complete internal implementation."
- Pre-hardening verify-fix loop, under Lifecycle and authoring proposals: "Ordinary v3 spec review challenges the overall approach, unnecessary complexity, and missing commitments so fundamental design problems are caught early."
- Authoring guidance overlay, in the same section: "Use concise Nightshift authoring guidance to capture meaningful behavior, constraints, tradeoffs, and acceptance evidence while delegating routine engineering choices."

## Current behavior

Checked on 2026-09-29 against what a run loads:

- The reviewer prompt that `internal/runtime/review.js` sends for every assessment says "do not manufacture findings or prescribe unnecessary implementation detail", and its spec lenses ask for commitments and reasoning "without contradictions, missing decisions or unnecessary prescription". [The operating brief](../../internal/workflow.md#spec-dimensions) and [revise-spec](../../skills/revise-spec/SKILL.md) ("Do not demand an unchosen implementation in prose or pseudocode") carry the same bar. Each finding carries a consequence and evidence.
- Nothing asks a spec finding to justify a demanded detail by naming the consequential gap, contradiction or defect in the spec's commitments or approach; the bar is only negative.
- The soundness lens covers feasibility ("Can the approach satisfy the commitments in the actual project and operating environment"). Nothing asks whether a simpler or different approach would better meet the commitments, or directs a challenge to unnecessary complexity.
- The brief's authoring clause asks for "a concise spec of consequential commitments, boundaries and acceptance evidence" and does not name tradeoffs; the clarity lens covers important reasoning and missing decisions only indirectly. `WORKFLOW.md` and [the v3 feature](nightshift-v3.md) ask for reasons behind important tradeoffs, but a run does not load them. This gap is the least material of the four.
- Carried: skeptic validation of every finding, whole-spec reassessment of a revised spec, review for missing commitments, delegation of routine engineering choices, and no routine plan stage.

## Direction

Add the missing parts where a run loads them, keeping the agreed stance that review criteria find missing commitments without becoming a checklist that expands every spec.

## Open questions

- Where each clause belongs: the lens briefs and common prompt the runtime sends, the brief the controller reads, revise-spec, or several of them, and how to keep them in step.
- How a challenge to complexity and to the overall approach stays proportionate, so spec review does not reopen settled design on every pass.
- Which installed-host evidence the changed model-owned review behavior needs.
- Relations: the bug [Migration status may overstate two retained policies as present](../BUGS.md#migration-status-may-overstate-two-retained-policies-as-present) names the Gate row, and this entry becomes its tracked destination. [Background review and assessment of selected work](selection-review-and-assessment.md) tracks explaining accepted tradeoffs before agreement, not recording them in specs.
