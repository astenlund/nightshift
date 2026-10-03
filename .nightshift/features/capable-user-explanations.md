---
name: capable-user-explanations
description: Give a technically capable user who may not know the codebase concise, precise, self-contained explanations of behavior, architecture, tradeoffs and risk, with the evidence needed to decide and without default source exposition, and triage follow-ups in every phase
metadata:
  type: feature
---

# Explain for a capable user who may not know the codebase

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded "Communicate for technically sophisticated, time-constrained users" as Policy present. The bug [Migration status may overstate two retained policies as present](../BUGS_HISTORY.md#migration-status-may-overstate-two-retained-policies-as-present) had already flagged the row, and independent auditors and verifiers confirmed that the communication part of its agreed disposition is not carried. Drafted overnight for the user's triage.

## Agreed disposition

Agreed on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md#supervision-and-retained-decisions): "Replace the authority policy while retaining concise, precise explanations of behavior, architecture, tradeoffs, and risk for a technically capable user who may not know the codebase. Supply the evidence needed to decide without default source exposition. Remove execution-phase permission to expand scope and report afterward, naive-first scope expansion, and automatic refactoring backlog entries. Routine authorized engineering continues autonomously; scope changes outside existing delegation require the user's decision before dependent work. Apply the agreed follow-up triage in every phase."

## Current behavior

Checked on 2026-09-29:

- Missing: no instruction a run loads asks for concise, precise explanations of behavior, architecture, tradeoffs and risk aimed at a user who may not know the codebase, or says to avoid source exposition by default. Surface-specific wording exists (a short understanding readback, a morning report written "for a reader who saw nothing of the run", concise context in Ready, a one-or-two-sentence restatement at handover), but none states the audience or that altitude.
- Partly carried: [the operating brief](../../internal/workflow.md) asks for the context needed to decide for specific decisions, such as follow-up triage, blocked-decision questions and the morning report, but not for readbacks, spec presentations or other decisions.
- Carried: the replaced authority policy (material changes need the user's decision, dependent work pauses on a blocked decision, an out-of-scope finding does not authorize a repair), and the removed permissions are absent.
- Unverified: follow-up triage is carried for run phases; whether "every phase" also covers ideas and decisions raised before a run exists is a matter of reading.

A further instance on 2026-10-03, outside any run: while graduating Exploring entries, the controller explained a draft in terms of runtime functions, file paths and links, and the user replied: "could you dumb this one down for me? I can't recall the details and can't open the spec file here".

## Direction

State the audience and altitude wherever explanations are written: concise, precise explanations of behavior, architecture, tradeoffs and risk in plain words, with the evidence needed to decide inside the message itself and without source exposition unless asked, and triage follow-ups in every phase.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- Where the rule belongs: once in the brief, or also in the skills whose output the user reads directly (Ready, handover, the closing report). Settled: the rule is stated once in [the operating brief](../../internal/workflow.md), which the handover and revise skills already direct agents to, and the three public skills that do not, `ready`, `exploring` and `init-backlog`, each carry one sentence pointing to it. The rule: when explaining anything to the user, such as a readback, a recommendation, a decision question or a report, say what it does, why it matters, its tradeoffs and risks and the evidence needed to decide, in plain words; source code, function names and file paths appear only when the user asks for them or the decision depends on them. A message that asks for a decision makes sense on its own: links supplement it and never replace the facts needed to decide, since the user may be reading on another device or may not remember earlier details, as in the instance above.
- Whether follow-up triage applies to the interactive phases before a run. Settled: it does, as the agreed disposition's "in every phase" says. During investigation and discussion before a run exists, follow-ups the agent turns up, such as out-of-scope defects or ideas, are put to the user with context and a recommended disposition before the conversation moves past them, and are never silently dropped or filed.
- Relations: this entry is the tracked destination for the communication row of the bug above, now resolved. [Background review and assessment of selected work](selection-review-and-assessment.md) covers stating concerns and tradeoffs before agreement. Settled as independent: neither requires the other.

## Before implementation

The change is shipped guidance in the operating brief and three public skills, so it rides with a plugin version increase. Explanation style and pre-run triage are model-owned behavior, so the start of the work decides between a budgeted installed-host check and deterministic evidence only with that behavior marked unverified. Tracking and readiness do not authorize implementation.
