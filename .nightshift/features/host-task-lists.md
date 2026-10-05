---
name: host-task-lists
description: Mirror a run's queue and lifecycle stages into the host's native task list so the user can follow a run as it progresses, with durable run state staying the authority
metadata:
  type: feature
status: exploring
---

# Mirror run progress into the host's task list

## Origin

Raised by the user on 2026-10-05, mid-run in run `253965ee-2713-4140-bbd4-622bfa55eb61` after a handover, in their words: "idea: use task lists so the user can follow along as the run progresses". It was recorded as a run follow-up and tracked as Exploring at that run's triage the same day.

## Current understanding

v2's [host-agnostic design](agent-host-agnostic-nightshift.md#review-host-adapters) listed "optional mirroring of the durable handover queue into a native task list" among the adapter capabilities, and stated that durable handover state, "rather than a host task list, becomes the stop authority; hosts may mirror that queue into native task tools". [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) tracks that section's surviving need in [Dispatch reviewer peers and return their evidence to the lead](reviewer-peer-dispatch.md), and no active index entry or record carries the mirror; checked on 2026-10-05 by searching `.nightshift` outside the v2 migration archive for task-list terms.

Today a user follows a run through the controller's text output, the runtime's `status` and the morning report. [Show review progress without being asked](visible-revise-progress.md), agreed but not yet shipped, would add short text updates after each review result and repair batch, and [Graphical run view](run-graph-view.md) and [Claude Code mods for run visibility](claude-code-mods.md) explore richer surfaces. A native task list would sit between them: a checklist the host renders, which the user can glance at without reading the conversation.

Which native tools each host offers for this was not checked. The user's global instructions refer to a TaskCreate queue on Claude Code, which the session that raised this idea did not offer, and whether Codex offers an equivalent is unknown.

## Open questions

- Which native tools each host offers for this, what the user sees of them in the terminal, the desktop app or another device, and what a host without one shows instead.
- What the list mirrors: the queue's tasks, each task's lifecycle stages (implementation, revise-code, revise-docs, retrospective, report, triage), review and repair passes, or a mix.
- Who writes it and when: the controller from `status` at consequential boundaries, a hook or the runtime; and how the list is reconciled after compaction, adoption or a resumed session so that it never disagrees with durable state for long.
- Authority: the list is a mirror only, never the stop authority or evidence, as v2 settled; how that stays clear to the user and the controller.
- Cost: the tool round trips each update takes, weighed under [Orchestration efficiency](orchestration-efficiency.md).
- How it relates to [Show review progress without being asked](visible-revise-progress.md), [Graphical run view](run-graph-view.md) and [Claude Code mods for run visibility](claude-code-mods.md).
