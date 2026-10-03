---
name: revise-lore-audience-routing
description: Route retrospective lessons by who the user is, and let user and project instructions take precedence over plugin instructions when they conflict
metadata:
  type: feature
---

# Retrospective routing by audience and instruction precedence

## Origin

Raised by the user on 2026-09-27, mid-run in run `f87356d8-8613-45a8-93e5-d79c48f2254b`, and tracked as Exploring at that run's triage. In the user's words: "revise-lore should act differently depending on project and user. a nightshift maintainer can add to the ns backlog or inbox. a regular user can add instructions to the global or project-local AGENTS.md/CLAUDE.md. global or local agent instructions should always override plugin instructions if they clash."

## Current behavior

[revise-lore](../../skills/revise-lore/SKILL.md) routes project-specific conclusions to the project, cross-project conventions to the canonical global instructions, and plugin changes to the plugin's source clone, the same way for every user. A user who does not maintain Nightshift has no source clone to change, so a lesson about Nightshift itself has nowhere useful to go. Neither the skill nor [the operating brief](../../internal/workflow.md) states which side wins when a user's or project's instructions conflict with the plugin's. Checked again on 2026-10-03: the brief says only that everything "stays within the user's authority and limits", and honors user-supplied document locations.

## Direction

- A Nightshift maintainer routes lessons about Nightshift to its backlog or inbox.
- A regular user routes lessons to the global or project-local instruction files (AGENTS.md or CLAUDE.md).
- Global and project instructions take precedence over plugin instructions when they conflict.

The settled questions below refine this direction where they differ: a regular user's lessons about their own way of working become instruction-file proposals, while lessons about Nightshift itself become a report the user can send upstream.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- How revise-lore tells a maintainer from a regular user, for example whether the operating project is the Nightshift clone itself or the maintainer's inbox exists. [Project inboxes](project-inboxes.md) is to give every project that uses Nightshift an inbox and leaves recognizing a maintainer to this entry, so once it ships, the existence of an inbox alone will not identify a maintainer. Settled: revise-lore does not guess who the user is; it follows the instructions. When the user's or the project's instructions say where lessons about Nightshift go, as this maintainer's global instructions name the inbox of the Nightshift clone, it uses that destination. Otherwise, when the operating project is Nightshift's own source, those lessons go to its backlog. Otherwise the user is a regular user: lessons about their own way of working become proposals for their global or project instruction files, approved by the user as today, and lessons about Nightshift itself are shown to the user as a short report they can send upstream, such as a GitHub issue, which the agent never files itself because it is outward-facing.
- How the precedence rule interacts with gates the plugin treats as mandatory, such as independent review before task completion, and whether the rule belongs in every skill rather than in revise-lore alone. Settled: the user's global and project instructions take precedence over Nightshift's when they conflict. When following one means a requirement Nightshift normally applies does not happen, such as an independent review, the report says so plainly and never claims it ran. A requirement the runtime enforces mechanically, such as completion waiting for its review, is not worked around: the agent tells the user about the conflict and the user decides, for example to stop the run or to let the requirement run this time; with no user available, that task waits on a user decision while independent work continues. [Run the full test suite before delivery](full-suite-before-delivery.md) already fits this: the readback names the suite command and the user can opt out there, so the user's agreement is the explicit ask that a rule against unrequested full-suite runs needs. The precedence rule is stated once in the operating brief, with one sentence pointing to it in the `ready`, `exploring` and `init-backlog` skills, which do not direct agents to the brief; the routing rule belongs in revise-lore. Neither part depends on Project inboxes.

## Before implementation

The change is shipped guidance in the operating brief, revise-lore and three public skills, so it rides with a plugin version increase. Routing, precedence and the decision on a conflict are model-owned behavior, so the start of the work decides between a budgeted installed-host check and deterministic evidence only with that behavior marked unverified. Tracking and readiness do not authorize implementation.
