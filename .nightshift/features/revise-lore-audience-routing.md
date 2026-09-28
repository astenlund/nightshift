---
name: revise-lore-audience-routing
description: Route retrospective lessons by who the user is, and let user and project instructions take precedence over plugin instructions when they conflict
metadata:
  type: feature
status: exploring
---

# Retrospective routing by audience and instruction precedence

## Origin

Raised by the user on 2026-09-27, mid-run in run `f87356d8-8613-45a8-93e5-d79c48f2254b`, and tracked as Exploring at that run's triage. In the user's words: "revise-lore should act differently depending on project and user. a nightshift maintainer can add to the ns backlog or inbox. a regular user can add instructions to the global or project-local AGENTS.md/CLAUDE.md. global or local agent instructions should always override plugin instructions if they clash."

## Current behavior

[revise-lore](../../skills/revise-lore/SKILL.md) routes project-specific conclusions to the project, cross-project conventions to the canonical global instructions, and plugin changes to the plugin's source clone, the same way for every user. A user who does not maintain Nightshift has no source clone to change, so a lesson about Nightshift itself has nowhere useful to go. Neither the skill nor [the operating brief](../../internal/workflow.md) states which side wins when a user's or project's instructions conflict with the plugin's.

## Direction

- A Nightshift maintainer routes lessons about Nightshift to its backlog or inbox.
- A regular user routes lessons to the global or project-local instruction files (AGENTS.md or CLAUDE.md).
- Global and project instructions take precedence over plugin instructions when they conflict.

## Open questions

- How revise-lore tells a maintainer from a regular user, for example whether the operating project is the Nightshift clone itself or the maintainer's inbox exists. [Project inboxes](project-inboxes.md) is to give every project that uses Nightshift an inbox and leaves recognizing a maintainer to this entry, so once it ships, the existence of an inbox alone will not identify a maintainer.
- How the precedence rule interacts with gates the plugin treats as mandatory, such as independent review before task completion, and whether the rule belongs in every skill rather than in revise-lore alone.
