---
name: run-graph-view
description: Show a run as a live graph of its whole workflow in a local web page, highlighting the current step and animating as subagents start and files change
metadata:
  type: feature
status: exploring
---

# Graphical run view

## Origin

Raised by the user on 2026-09-29, outside any run, while a review loop was running, in their words: "idea: adding a graphical representation of a run. it would be hosted in a local web server, viewable on the same computer, and would show the whole workflow as a graph, highlighting the current step and animating smoothly when things happen (subagents spawning, files being edited, etc.)"

Asked about its loose ends (where file-edit and subagent events would come from, who starts and stops the local server and how it stays local-only and read-only, and whether it shows one run or every run), the user answered: "future slice would include old runs as well. a further future slice could also include clickable elements (nodes, etc.) where the user can find out details about that step."

On 2026-09-30, during run `f440497c-a0cc-4375-bada-e834e32b49a6`, the user added: "idea: we have a feature for a browser-based visualization. we could expand on that and make it an actual operational ui, as an alternative to the cli." At that run's triage the user chose to widen this record rather than open a separate entry, keeping the read-only view as the first slice.

## Current behavior

A search on 2026-09-29 found no backlog entry, shipped code or governing document that mentions a graphical view, dashboard or local web server. [The runtime](../../internal/runtime/REFERENCE.md#start-and-observe) exposes a run's current obligations through `status`, its complete state through `inspect` and its saved transitions through `history`, all read from `.nightshift/runs/state.sqlite`, which is authoritative. Workers are recorded when the controller registers them or the runtime dispatches a review, with their role and write ownership, and checks and private probes are recorded as internal operation workers from launch to completion; a subagent started without registration is not recorded, and the runtime records no individual file edit. A runtime-dispatched review keeps each attempt's native event log; a completed assessment's receipt references the log of the attempt that produced it.

## Slices

- **Current run.** A page served by a local web server and viewable on the same computer shows the whole workflow of the current run as a graph, highlights the current step, and animates smoothly when things happen, such as subagents spawning and files being edited.
- **Old runs.** A later slice adds earlier runs.
- **Step details.** A further slice could make elements such as nodes clickable, so the user can find out details about that step.
- **Operational UI.** A later slice could let the user operate Nightshift from the page, as an alternative to the CLI.

## Open questions

- Where events come from, since the runtime records state transitions, registered and dispatched workers, check and probe operations and review event logs, but no file edits or unregistered subagents: new runtime events, watching the checkout, reading host-native logs, or a mix, and how both hosts supply them.
- Who starts and stops the server (a skill, a hook, the runtime or the user), how the view slices stay bound to the local machine and read-only, so that they never change run state, and whether it stays within Node's built-in modules like the rest of the plugin.
- What the graph of the whole workflow shows: lifecycle stages, the task queue and its dependencies, review and repair loops, and the closing stages.
- How an interrupted run appears: [Ready offers to pick up an interrupted run](ready-interrupted-run-pickup.md) surfaces the project's current run when no live session is executing it, which bears on what the Current run slice shows for such a run and whether it belongs with old runs.
- What a run contains once [Run-free revise](run-free-revise.md), agreed Current work, lets revise invoked on its own work without a runtime run, so such standalone reviews would not appear in a run's graph.
- Which operations the Operational UI slice may perform, how it keeps the runtime's writer ownership, controller claim and approval rules, and how it relates to the host sessions that run the controller. The earlier slices stay local-only and read-only; only this slice would change run state.
