---
name: revise-by-content
description: One revise entry point that picks the variants a change needs, inside runs and standalone, replacing the global review-loop routine
metadata:
  type: feature
status: exploring
---

# One revise that picks its variants by content

## Origin

Raised by the user on 2026-10-16 in this repository, outside any run. A plain `review-loop` over edits to this repository's `AGENTS.md` and backlog ended with ten minor findings reported as left for the user "to pick up later if you want". The user pointed out that "there's no definition of 'later' -- a finding that isn't handled in a session isn't likely to be revisited later", then that "this is still part of Nightshift and should be handled by the plugin", and declined a proposed edit to the review-loop and publication-gate rules in their global instructions. Weighing a bundled skill, they said: "the point of review-loop is that it can be run outside of a Nightshift run. but I suppose it could be a bundled skill that can be used both within runs and standalone", and then: "let's drop the review-loop name, we could just call it revise and have it invoke the appropriate variant(s) based on content."

## Current state

Checked on 2026-10-16 and 2026-10-17:

- [WORKFLOW.md](../../WORKFLOW.md) says plain `review` and `review-loop` requests use the user's global direct-agent routines and do not activate the plugin, that the detailed routines belong in the user's global instructions, and that Nightshift's review skills activate only for explicit `revise` intent.
- The public revise skills are separate per kind of work: [revise-code](../../skills/revise-code/SKILL.md), [revise-docs](../../skills/revise-docs/SKILL.md), [revise-lore](../../skills/revise-lore/SKILL.md) and [revise-spec](../../skills/revise-spec/SKILL.md).
- Used standalone, revise-code, revise-docs and revise-spec end by listing their pending follow-ups, as [the operating brief](../../internal/workflow.md#close-and-report) directs for a standalone review context, and revise-lore presents its instruction proposals for approval and triages any left pending one at a time when the user returns, while delivery triages its follow-ups one at a time after its morning report. That list-only ending is the original agreed direction of [Run-free revise](run-free-revise.md) ("there is no triage stage"), shipped in its standalone review-context slice in 3.3.10; the direction below changes it. The runtime says the same in its standalone review-context section and review-context status rules, and refuses the `triage` action outside a delivery. [Triage a standalone revise's unfixed findings before it ends](../QUICK_WINS.md#triage-a-standalone-revises-unfixed-findings-before-it-ends) tracks closing that gap in today's skills.
- The user's global routine splits a change into code, meaning anything that changes behavior, including every file an agent or program loads or follows as operating instructions, and documentation, each with its own reviewer, and loops through resumed reviewers and fresh passes. Their global publication gate requires such reviews before every push in every project.

## Direction

A single `revise` entry point that works inside a run and standalone, decides from the change which variants it needs, invokes them, and ends a standalone use by triaging every unfixed finding one at a time (fix, track or skip), so that no finding is left in a report as deferred without a record. It would replace the global review-loop routine, so that one implementation serves both and the global rule and the operating brief stop drifting apart.

## Open questions

- Weight: revise validates every finding with a fresh skeptic and records value and authority dispositions, while the global loop is lighter. Whether standalone use keeps the full machinery or gains a lighter mode.
- How content selects the variants: the global split by whether a change alters behavior, with instruction files counted as code, or the runtime's path-based split of documentation from code, and how lore and spec work fit in.
- The publication gate: it covers every push in every project, so moving it into the plugin needs the plugin wherever the user pushes. What stays in the global instructions, and what happens on a machine or host without the plugin.
- Whether the variant skills stay directly invocable, and what a plain `review` or `review-loop` request does afterwards.
- The amendments to current guidance stating that plain review-loop requests bypass the plugin. A 2026-10-16 sweep of tracked files for that routing found it in [WORKFLOW.md](../../WORKFLOW.md), this repository's [AGENTS.md](../../AGENTS.md), [the operating brief](../../internal/workflow.md), the revise-code and revise-spec skill descriptions and [the v3 feature](nightshift-v3.md), while [V3-MIGRATION.md](../../V3-MIGRATION.md) records it as a v3 migration decision. [README.md](../../README.md) says a plain review request does not trigger the plugin and lists the variant skills, so it changes with the answer to the previous question. Repeat the sweep before amending.
- Relation to [Run-free revise](run-free-revise.md), whose staged, unstaged and commit-range capture a standalone revise of arbitrary changes needs and whose agreed list-only ending this would change, and to [Weigh minor fixes against the review cycle and keep the rest as follow-ups](../QUICK_WINS.md#weigh-minor-fixes-against-the-review-cycle-and-keep-the-rest-as-follow-ups).
- Relation to records that build on the global routine: [Resumable reviewer and adversarial repair dialogue](resumable-reviewer-dialogue.md), whose spec adopts the user's own review-loop rule as its minimum, and [Review mode for someone else's implementation](review-mode.md), which relies on plain review requests not activating the plugin.
- Relation to [Explain for a capable user who may not know the codebase](capable-user-explanations.md), whose v3 disposition applies follow-up triage in every phase and which also edits the operating brief.

Tracking does not authorize implementation.
