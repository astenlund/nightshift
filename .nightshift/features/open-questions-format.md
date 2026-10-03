---
name: open-questions-format
description: Give open and settled questions in backlog records one fixed, greppable format and a function that parses them out grouped by feature, with a keyword search and a lightweight model to catch questions outside the format, so tools and agents can find, count and answer them
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

The user then added, in their words: "we could have a format but also do a keyword search, then dispatch a super quick lightweight model as a final discriminator". The format catches the questions written in it, a keyword search catches open questions phrased otherwise, such as under the older headings or in "Settle" bullets, and a fast, lightweight model judges each keyword match, keeping the real open questions and discarding false matches.

The user then made the layers improve each other, in their words: "when the keyword search finds something that the parse didn't, that should be lifted as a potential improvement (i.e. update the entry to use the correct format). when the model finds something both previous layers missed, do the same and also consider adding another keyword to layer 2 for next time". An open question that only the keyword search found becomes a proposed fix that rewrites it in the format; one that only the model found becomes the same proposed fix and also a candidate keyword for the search.

## Open questions

- The format: a fixed heading such as "## Open questions" with one single-line bullet per question, a marker on each question line, or both; and the matching forms for settled questions, deliberately loose leanings and items that must be settled before implementation.
- The function: where it lives, such as a mode of the Ready parser beside its catalog or a separate script; whether it groups by index entry, which would also reach quick wins and bugs kept only in their index, or by record file; whether it reads only records an active index reaches; whether it tolerates the existing headings, which would lessen the need for one format, or relies on the format; and whether it also lists the items under "Before implementation".
- The keyword search and its discriminator: which keywords; which model is light enough to be quick yet reliable enough to judge, within [User-configurable model policy file](model-policy-file.md); where the model step runs, since the Ready parser is deterministic and calls no model; whether it judges only matches outside the format; whether its verdicts are kept so unchanged records are not judged again; what happens when no such model is available, such as listing the matches unjudged; and whether a set of known open questions and false matches shows that it judges reliably.
- What the model reads beyond the keyword matches, since a model that judges only those matches cannot find a question both other layers missed: whole records, only the records near the session's work, or a sample, and at what cost.
- How the proposed fixes and keywords reach the user and land: whether they are follow-ups for triage or tracking edits applied and reviewed like others; where the keyword list lives, whether shipped with the plugin or kept by each project; and how the list is kept from growing until false matches cost more model calls than the new keywords catch.
- Whether the parser enforces the format, for example as a Ready notice for a nonstandard heading, and whether Ready shows a count of open questions per entry.
- Migrating the existing records and the init-backlog templates, and whether records no active index links and the v2 archive are migrated or left as they are.
- How it relates to [Related field for non-dependency relations](related-field.md), another change to the record grammar, and to [Complete shared backlog parsing and template consistency](v3-parser-consistency.md), which owns consistency across the parser, setup and unwrap.

Tracking does not authorize implementation.
