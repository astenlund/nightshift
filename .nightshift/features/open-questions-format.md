---
name: open-questions-format
description: Give open and settled questions in backlog records one fixed, greppable format and a function that parses them out grouped by feature, so tools and agents can find, count and answer them
metadata:
  type: feature
status: exploring
---

# A greppable format for open and settled questions

## Origin

Raised by the user on 2026-10-04, while shaping [Answer open backlog questions cheaply in retrospectives](retrospective-open-questions.md), whose open questions include how a retrospective finds a record's open questions when records phrase them under different headings, in their words: "we could formalize the open questions format so they're easily greppable". They added at once: "perhaps best to write a function that parses these out, so they would be grouped by feature".

## Current state

Counted on 2026-10-04 over `.nightshift/features`, before this record existed: 24 headings mark open questions under 7 different names, "Open questions" (16), "Open design questions" (2), "Open before commitment" (2), and one each of "Details to settle", "Design points to settle", "Decisions before implementation" and "Costs and open points", while one more, "Resolved open questions", holds questions already resolved. Five of the 25 records with those headings are linked only from the migration status or a history file, not from an active index. The v2 archive under `.nightshift/migration/v2/features` holds 8 more open-question headings and an eighth name, "Open design questions before graduation". Other open items sit under headings that name no question: 28 records carry a "Before implementation" section, and in 7 of them bullets beginning "Settle" list decisions still to make. 23 records carry a "Settled questions" heading, the form the 2026-10-03 graduations used, keeping each question with its answer and date; one uses "Current leaning" for answers the user chose to leave loose.

## Direction

The user's idea, not yet shaped: one fixed format for open questions in backlog records, and its counterpart for settled ones, so that a search finds every open question reliably, and a function that parses the open questions out of the records and lists them grouped by the feature they belong to, so a retrospective or the user sees each entry's questions together.

## Open questions

- The format: a fixed heading such as "## Open questions" with one single-line bullet per question, a marker on each question line, or both; and the matching forms for settled questions, deliberately loose leanings and items that must be settled before implementation.
- The function: where it lives, such as a mode of the Ready parser beside its catalog or a separate script; whether it groups by index entry, which would also reach quick wins and bugs kept only in their index, or by record file; whether it reads only records an active index reaches; whether it tolerates the existing headings, which would lessen the need for one format, or relies on the format; and whether it also lists the items under "Before implementation".
- Whether the parser enforces the format, for example as a Ready notice for a nonstandard heading, and whether Ready shows a count of open questions per entry.
- Migrating the existing records and the init-backlog templates, and whether records no active index links and the v2 archive are migrated or left as they are.
- How it relates to [Related field for non-dependency relations](related-field.md), another change to the record grammar, and to [Complete shared backlog parsing and template consistency](v3-parser-consistency.md), which owns consistency across the parser, setup and unwrap.

Tracking does not authorize implementation.
