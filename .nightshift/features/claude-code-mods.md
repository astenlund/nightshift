---
name: claude-code-mods
description: Consider Claude Code mods as an optional Claude-only surface for run visibility, such as run progress, review state or CI status after a push
metadata:
  type: feature
status: exploring
---

# Claude Code mods for run visibility

## Origin

Raised by the user on 2026-10-01, mid-run in run `edb0199e-f5f3-4fab-a55f-8fa909a08289` while its code review loop was running, in their words: "idea: see if mods could be something for Nightshift (https://claude.com/blog/claude-code-mods)". Later the same day the user added: "CI/CD status might be an interesting usecase for the mods idea". The runtime refused to record it as a run follow-up while a review dispatch held the project lease, so it reached the maintainer inbox, and the user chose to track it as Exploring at inbox triage on 2026-10-02.

## Current understanding

Claude Code mods are plugins of function hooks that add a live pane, band, status line, toast or hook inside Claude Code, in the terminal or the desktop Code tab, and hot-reload in the session. Nothing has been investigated yet against Nightshift's registered hooks, its continuation mechanisms or the runtime's read-only status operations.

Mods exist only on Claude Code, while [the operating brief](../../internal/workflow.md) requires that either supported host can carry the complete lifecycle. A mod could therefore only add optional visibility, never machinery the lifecycle depends on.

## Open questions

- Which views are worth a live surface: the current run's stage and queue, review and repair progress, worker activity, or CI status after a push.
- How a mod reads state without changing it: polling the runtime's read-only `status`, reading `.nightshift/runs/state.sqlite`, or events from Nightshift's registered hooks, and what each costs.
- How it ships: inside the Nightshift plugin, which the release gate and packaging would then cover, or as a separate optional plugin.
- What Codex users see instead, and whether that asymmetry is acceptable for a visibility-only feature.
- How it relates to [Graphical run view](run-graph-view.md), which shows the workflow in a local web page, and [Show review progress without being asked](visible-revise-progress.md), which keeps review progress visible in the conversation.
