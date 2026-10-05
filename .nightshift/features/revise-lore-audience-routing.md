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

Experiments a retrospective proposes, which the user asked for on 2026-10-03, are a further kind of retrospective output with their own durable destination, tracked by [Controller-run experiments](controller-run-experiments.md).

Context facts the user supplied are another input, added on 2026-10-04 at the triage of [the section-level audit of v2 records](../reports/v2-section-audit-20261004.md). v2 wrote consequential facts the user supplied, such as a deployment target or a compatibility constraint, into the project's instructions so that a later session would not ask again ([Calibrate first-draft rigor to deployment context](calibrate-first-draft-rigor.md)). The migration retired that automatic writing, and its disposition under [Portability umbrella and continuations](../../V3-MIGRATION.md#portability-umbrella-and-continuations) rules out automatically turning session observations into rules, but nothing prompts a retrospective to propose recording such facts. The user chose to fold it in here: the retrospective looks for consequential context facts the user supplied during the session and proposes recording them at the destination this entry's routing chooses, through the usual approval.

## Added at the inbox triage of 2026-10-05

Lessons about how Nightshift behaves have gone to the host's per-project memory instead of the plugin. The incident report triaged that day says the controller's memory recorded two earlier occasions, the later on 2026-10-02 in run `61461833-3c7e-4449-8282-67b3df7dd564`, where a revise-lore retrospective routed a review-loop lesson into a project memory and the user corrected it. On 2026-10-05, after the user stopped the run described in [Agreement reached in ordinary chat activates the lifecycle](../bugs/chat-agreement-lifecycle-activation.md), the controller saved "no Nightshift run for README or documentation polish in this repo" as a per-project memory and offered to narrow the repository `AGENTS.md` sentence; the user corrected both, because when the lifecycle activates is plugin behavior, and the memory was deleted. A memory is local to one machine and one host, so it hides the defect where it was caught and leaves it in the shipped plugin. Checked at that triage: neither this record nor [revise-lore](../../skills/revise-lore/SKILL.md) named host memory.

The user chose to fold it in here: acceptance includes that a lesson about Nightshift itself never goes to the host's memory, whichever destination the routing chooses. The 2026-10-05 slip happened after the user's stop, outside the retrospective, in a session where the user had invoked no skill but the controller had read revise-lore's instructions while carrying the lifecycle (`skills/revise-lore/SKILL.md`, at 02:50:57Z in the session transcript). The user chose at the same triage to cover corrections given in ordinary chat through the global instructions as well.

## Before implementation

The change is shipped guidance in the operating brief, revise-lore and three public skills, so it rides with a plugin version increase. Routing, precedence and the decision on a conflict are model-owned behavior, so the start of the work decides between a budgeted installed-host check and deterministic evidence only with that behavior marked unverified. Tracking and readiness do not authorize implementation.
