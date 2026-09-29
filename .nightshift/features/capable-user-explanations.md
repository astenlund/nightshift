---
name: capable-user-explanations
description: Give a technically capable user who may not know the codebase concise, precise explanations of behavior, architecture, tradeoffs and risk, with the evidence needed to decide and without default source exposition
metadata:
  type: feature
status: exploring
---

# Explain for a capable user who may not know the codebase

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded "Communicate for technically sophisticated, time-constrained users" as Policy present. The bug [Migration status may overstate two retained policies as present](../BUGS.md#migration-status-may-overstate-two-retained-policies-as-present) had already flagged the row, and independent auditors and verifiers confirmed that the communication part of its agreed disposition is not carried. Drafted overnight for the user's triage.

## Agreed disposition

Agreed on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md#supervision-and-retained-decisions): "Replace the authority policy while retaining concise, precise explanations of behavior, architecture, tradeoffs, and risk for a technically capable user who may not know the codebase. Supply the evidence needed to decide without default source exposition. Remove execution-phase permission to expand scope and report afterward, naive-first scope expansion, and automatic refactoring backlog entries. Routine authorized engineering continues autonomously; scope changes outside existing delegation require the user's decision before dependent work. Apply the agreed follow-up triage in every phase."

## Current behavior

Checked on 2026-09-29:

- Missing: no instruction a run loads asks for concise, precise explanations of behavior, architecture, tradeoffs and risk aimed at a user who may not know the codebase, or says to avoid source exposition by default. Surface-specific wording exists (a short understanding readback, a morning report written "for a reader who saw nothing of the run", concise context in Ready, a one-or-two-sentence restatement at handover), but none states the audience or that altitude.
- Partly carried: [the operating brief](../../internal/workflow.md) asks for the context needed to decide for specific decisions, such as follow-up triage, blocked-decision questions and the morning report, but not for readbacks, spec presentations or other decisions.
- Carried: the replaced authority policy (material changes need the user's decision, dependent work pauses on a blocked decision, an out-of-scope finding does not authorize a repair), and the removed permissions are absent.
- Unverified: follow-up triage is carried for run phases; whether "every phase" also covers ideas and decisions raised before a run exists is a matter of reading.

## Direction

State the audience and altitude where a run loads them: concise, precise explanations of behavior, architecture, tradeoffs and risk, with the evidence needed to decide and without source exposition unless asked.

## Open questions

- Where the rule belongs: once in the brief, or also in the skills whose output the user reads directly (Ready, handover, the closing report).
- Whether follow-up triage applies to the interactive phases before a run.
- Relations: this entry becomes the tracked destination for the communication row of the bug above. [Background review and assessment of selected work](selection-review-and-assessment.md) covers stating concerns and tradeoffs before agreement.
