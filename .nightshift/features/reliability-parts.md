---
name: reliability-parts
description: Decide whether durability and evidence join autonomy and trust as named parts of the reliability priority, and whether trust and reliability are too adjacent
metadata:
  type: feature
---

# Name durability and evidence in the reliability priority

## Origin

Raised by the user on 2026-09-30 while agreeing run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9`: "reliability should perhaps add a couple more keywords. we have autonomy and trust, but another important piece to the puzzle is durability. we use durable records to increase trustworthiness. evidence is the other one; that's why we have skeptics checking review findings." At that run's triage the user chose to track it as Exploring and added: "another question worth pondering is if trust and reliability are too adjacent to each other".

## Current wording

The invariant priority names reliability with autonomy and trust as its two equal parts. A search on 2026-09-30 for "autonomy and trust" and for "reliability" across the repository's Markdown found it stated in current guidance in [AGENTS.md](../../AGENTS.md), [VISION.md](../../VISION.md) ("Reliability has two equal parts", and trust "must be warranted by evidence, never produced by confident reporting"), [WORKFLOW.md](../../WORKFLOW.md), [README.md](../../README.md), [the operating brief](../../internal/workflow.md) (Priorities and authority, which adds "with trust earned through independent quality assurance"), [the Ready skill](../../skills/ready/SKILL.md) (its recommendation rule) and [the handover skill](../../skills/handover/SKILL.md). The same wording appears in the [v3 feature](nightshift-v3.md), in several other feature records and in the accepted specs for [run adoption](../specs/run-adoption-and-continuation.md) and [retained releases](../specs/retained-plugin-releases.md), which record decisions already taken.

## Current leaning

The user agreed on 2026-10-03, when the entry graduated from Exploring to current work, to the answers below as a loose direction rather than settled wording, in their words: "let's leave things a little loose. we should think on this one more time when the feature is picked up." Each question is kept with its leaning.

- Whether durability (durable records such as runtime state, receipts and history) and evidence (skeptic-validated findings, recorded checks) are named parts of reliability beside autonomy and trust, or the means by which trust is earned, as the brief's "trust earned through independent quality assurance" and the vision's trust "warranted by evidence" already suggest. Leaning: they are the means, not new parts. Evidence, such as independent review, skeptic validation and recorded checks, makes trust warranted; durable records, such as runtime state, review receipts and history, keep work moving across interruptions and restarts and let every claim be checked later, so durability serves autonomy as well as trust. One sentence saying so follows the two parts.
- Whether trust and reliability are too adjacent to each other to be a part and its whole, and what wording would separate them. Leaning: keep both names. Reliability is the whole, an outcome the user can count on; trust is one part, believing the result without inspecting it. The vision's existing definitions already separate them, and the added sentence states how both are achieved.
- Which statements change: operating instructions (the brief and the skills) need a code assessment and a plugin version increase, while historical specs and records keep the wording of their time. Leaning: only the two statements that define the priority change, the vision's Invariant priorities section and the operating brief's priorities sentence. The short phrase "reliability, through autonomy and trust" in the repository instructions, the workflow, the README and the Ready and handover skills stays, since it remains accurate.

## Before implementation

Revisit the leaning above with the user before any wording changes, as they asked; the reconsidered answers replace it. A change to the operating brief is shipped guidance, so it needs a code assessment and a plugin version increase, while the vision is repository documentation. Tracking and readiness do not authorize implementation.
