---
name: reliability-parts
description: Decide whether durability and evidence join autonomy and trust as named parts of the reliability priority, and whether trust and reliability are too adjacent
metadata:
  type: feature
status: exploring
---

# Name durability and evidence in the reliability priority

## Origin

Raised by the user on 2026-09-30 while agreeing run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9`: "reliability should perhaps add a couple more keywords. we have autonomy and trust, but another important piece to the puzzle is durability. we use durable records to increase trustworthiness. evidence is the other one; that's why we have skeptics checking review findings." At that run's triage the user chose to track it as Exploring and added: "another question worth pondering is if trust and reliability are too adjacent to each other".

## Current wording

The invariant priority names reliability with autonomy and trust as its two equal parts. A search on 2026-09-30 for "autonomy and trust" and for "reliability" across the repository's Markdown found it stated in current guidance in [AGENTS.md](../../AGENTS.md), [VISION.md](../../VISION.md) ("Reliability has two equal parts", and trust "must be warranted by evidence, never produced by confident reporting"), [WORKFLOW.md](../../WORKFLOW.md), [README.md](../../README.md), [the operating brief](../../internal/workflow.md) (Priorities and authority, which adds "with trust earned through independent quality assurance"), [the Ready skill](../../skills/ready/SKILL.md) (its recommendation rule) and [the handover skill](../../skills/handover/SKILL.md). The same wording appears in the [v3 feature](nightshift-v3.md), in several other feature records and in the accepted specs for [run adoption](../specs/run-adoption-and-continuation.md) and [retained releases](../specs/retained-plugin-releases.md), which record decisions already taken.

## Open questions

- Whether durability (durable records such as runtime state, receipts and history) and evidence (skeptic-validated findings, recorded checks) are named parts of reliability beside autonomy and trust, or the means by which trust is earned, as the brief's "trust earned through independent quality assurance" and the vision's trust "warranted by evidence" already suggest.
- Whether trust and reliability are too adjacent to each other to be a part and its whole, and what wording would separate them.
- Which statements change: operating instructions (the brief and the skills) need a code assessment and a plugin version increase, while historical specs and records keep the wording of their time.
