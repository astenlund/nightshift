---
name: retrospective-open-questions
description: Have the session retrospective look through the backlog's open questions and answer those the session's evidence or a cheap check can settle, proposing answers to questions that are the user's to decide
metadata:
  type: feature
status: exploring
---

# Answer open backlog questions cheaply in retrospectives

## Origin

Raised by the user on 2026-10-03, in a backlog session that had just listed a new entry's open questions, in their words: "another idea: revise-lore could look through open questions in the backlog and see if any can be answered cheaply".

The same session shows the kind of answer meant. [Show review progress without being asked](visible-revise-progress.md) recorded as open whether Codex counts cached input inside `inputTokens`; the controller settled it in minutes from stored Codex review events already on disk, where every total with cached input equals `inputTokens` plus `outputTokens`.

## Current behavior

Checked on 2026-10-03. [revise-lore](../../skills/revise-lore/SKILL.md) inspects the session's evidence, "user corrections, recurring implementation or workflow failures, lost obligations before or after compaction, ineffective rules, and useful approaches", and proposes instruction changes; nothing directs it to the open questions that backlog records carry. The [Whole-backlog coherence audit](backlog-coherence-audit.md) checks relationships, excerpts and code claims across the backlog, not open questions.

## Direction

The user's idea as captured, with the controller's reading, not yet agreed:

- During the retrospective, look through the open questions in the backlog's records and pick out those the session's evidence, or a cheap check such as reading stored records or code, can answer.
- A factual question gets its answer with the evidence behind it. A question that is the user's to decide gets a proposed answer for the user to settle at triage, never settled silently.
- It stays cheap: a question that needs measurement or real spending is not answered here but may become a proposed experiment for [Controller-run experiments](controller-run-experiments.md).

## Open questions

- What counts as cheap: only evidence the session already gathered, or also small checks, and with what budget.
- Scope: every open question in the backlog, which spans dozens of records, or only those near the session's work, and how they are found when records phrase them under different headings.
- How answers land: as tracking edits applied after triage, moving a question under the record's settled questions with its evidence and date, and reviewed like other tracking edits, with [Proportionate review of tracking edits](tracking-review-cost.md) in mind.
- How it relates to [Offer to revisit an entry's settled decisions before starting work](../QUICK_WINS.md#offer-to-revisit-an-entrys-settled-decisions-before-starting-work), its counterpart that reopens settled answers before work starts, and to the coherence audit.

Tracking does not authorize implementation.
