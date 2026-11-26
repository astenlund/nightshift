---
name: backlog-meta-index
description: Give the shared backlog conventions one home instead of repeating them in every index
metadata:
  type: feature
status: exploring
---

# Give shared backlog conventions one home

Proposed by the user during the recoverable-unwrap handover on 2026-09-21 and approved for tracking at the closing triage. Tracked in [the feature index](../FEATURES.md#give-shared-backlog-conventions-one-home). The original capture is follow-up `backlog-meta-index` in run `16d148ab-5297-4077-80e9-c993afc81433`. On 2026-11-26 the user merged into this record the quick win "Move backlog conventions out of the index files into a shipped reference", raised that day while adjudicating this repository's init-backlog template differences, which proposed the same move with a different home.

## Problem

The four indexes and three history files set up from the init-backlog templates all repeat the same backlog conventions (the `**Requires:**` and `**External:**` grammar, slicing, walk-and-remove, history moves and retirement, line discipline and Exploring graduation), so each copy drifts on its own and a template change reaches a project only as template differences at its next init-backlog run. This repository held them in its own `AGENTS.md` instead, which no other project sees, until 2026-11-26, when they moved into its index files from the 3.3.44 templates pending this record.

## Candidate homes

- A project-local `BACKLOG.md` meta-index, the original direction: it links `FEATURES.md`, `BUGS.md`, `QUICK_WINS.md` and `PATTERNS.md` and holds their shared instructions, while instructions specific to one index stay with that index, and every hook that uses any of the four index files includes it so those hooks receive the shared guidance.
- One conventions reference shipped with the plugin, the direction of the merged quick win: the template preambles of all seven files shrink to each file's purpose and a pointer to that reference, and the skills that create, move or close backlog entries load it.

## Root instruction pointer

The merged quick win proposed that, with the shipped reference, setup proposes, for the user's approval, a short pointer in the project's root instructions that names the indexes and says to follow the Nightshift backlog conventions and run `/nightshift:ready` after an edit, never naming a plugin cache path or a release; whether a project-local `BACKLOG.md` needs such a pointer is open. The user settled on 2026-11-26 where setup writes that pointer: with only `AGENTS.md`, there; with only `CLAUDE.md`, there; with both, where one holds nothing but a pointer to the other (such as `@AGENTS.md`), in the file with the content; with both holding content, in both, including a file that imports the other alongside content of its own; with neither, setup creates the one for the current host. The rule writes the pointer only to the root `AGENTS.md` and `CLAUDE.md` and judges each by its own content, so other instruction files such as `.claude/CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.override.md` neither receive the pointer nor affect the choice.

## Details to settle

Choose the home, and for a project-local file its location and link-resolution convention. Inventory the shared instructions and all consumers before deciding which text moves and how each reader reaches the shared home; that inventory has not yet been established. Define setup and migration behavior for existing projects, preserving customized guidance and handling a missing or conflicting home explicitly. Decide how setup recognizes and updates its pointer on a rerun, for which the template adjudication of remembered keeps and retired text is the candidate mechanism, and how an agent that edits the backlog without invoking a skill finds the conventions beyond that pointer. Coordinate with [guidance discovery and routing](v3-guidance-routing.md) and [customized backlog repair](v3-setup-compatibility.md) without assuming either feature is already delivered. The work would absorb [Drop the History section from the index templates](../QUICK_WINS.md#drop-the-history-section-from-the-index-templates) and interacts with [Surface retired index preambles a project still carries](../QUICK_WINS.md#surface-retired-index-preambles-a-project-still-carries), since shrinking the preambles retires their current text in every project still holding an unchanged copy.

On 2026-09-29, triaging [Ground Ready recommendations in the project's direction](ready-project-direction.md), the user suggested the meta-index as one more place to put the project's goals or direction, in their words: "one more place to put project goals or directions might be in the shared BACKLOG.md meta-index."

Since the 3.3.13 batch setup compares existing indexes with their templates and offers to remove guidance a template dropped, as [setup's template adjudication](../specs/setup-index-text-adjudication.md) describes, so guidance this work moves out of the index templates becomes retired for those indexes and existing projects are offered its removal.

Template, skill and setup changes ship with a version increase. Tracking preserves the idea for design; it does not authorize implementation or publication.
