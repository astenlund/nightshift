---
name: context-triggered-supervisor
description: Have the controller spawn a lower-tier shift supervisor when administrative work starts filling its context, so the retained optional supervisor becomes something a run actually uses
metadata:
  type: feature
status: exploring
---

# Spawn a shift supervisor when admin work fills the controller's context

## Origin

Raised by the user on 2026-09-29, after asking what happened to the v2 shift supervisor feature, in their words: "problem: nothing seems to trigger this role instantiation, so it's pretty useless. the point is that the controller should spawn the supervisor when it notices that context starts filling up with admin tasks." The migration accounting audit the user then asked for confirmed the gap, and at triage the user chose to track it as this entry.

## Agreed direction

The v3 migration kept the supervisor as an optional role. Under [Agreed staffing refinement](../../V3-MIGRATION.md#agreed-staffing-refinement), agreed on 2026-09-06: "The controller, acting as night manager, may hire a lower-tier shift supervisor when coordination load warrants it. The trigger is operational load, not merely having subagents. The supervisor handles assignments, progress, result collection, and routine recovery with enough discretion to avoid continual referral back to the manager. The manager retains consequential engineering decisions, scope and authority judgments, finding dispositions, and final acceptance. Summaries preserve access to underlying evidence." The same section names candidate model pairings to evaluate with host support and says "Detailed supervision and recovery protocols remain to be chosen." The disposition of the v2 design, under [Supervision and retained decisions](../../V3-MIGRATION.md#supervision-and-retained-decisions), keeps the optional supervisor and trims the old managerial routing, executive packets and schemas. The original design is archived at [Night manager and shift supervisor](../migration/v2/features/night-manager-shift-supervisor.md).

## Current behavior

Checked on 2026-09-29:

- [The operating brief](../../internal/workflow.md) allows it in one sentence: "A lower-tier supervisor can coordinate assignments, progress and routine recovery; consequential engineering judgment, authority, finding dispositions and final acceptance stay with the controller." The handover skill mentions "optional lower-tier supervision where authorized and useful". The runtime accepts a `supervisor` worker role and gives it an empty write list.
- Nothing triggers or launches one: no instruction says when coordination load warrants a supervisor, how to brief it, which model it uses, or how it reports, and the runtime's own dispatch launches only reviews and skeptics.
- The agreed rule that supervisor summaries preserve access to underlying evidence is not carried anywhere a run loads.
- A supervisor running in its own session cannot record any run transition, since only the owning controller can change the run; the controller would record its results. Whether a subagent inside the controller's own session is a workable path is untested and undocumented.
- No test registers a supervisor and no acceptance report shows one in use; the migration reconciliation itself says the primitive and policy are present, "not a claim of an autonomous supervisor service".

## Direction

The controller notices when administrative work (assignments, polling, result collection, routine recovery) starts filling its context and spawns a lower-tier supervisor to carry it, keeping consequential decisions and access to the underlying evidence.

## Open questions

- How the controller notices the trigger: a measure of context use, a count of administrative actions, or its own judgment against a stated threshold.
- The supervisor's brief, model tier and reporting contract, including summaries that keep the evidence reachable, and how its results reach the run record through the controller.
- Whether it runs as a subagent inside the controller's session or as its own session, on each host.
- How to evaluate it: the agreed order is reliable unattended progress and controller capacity first, then missed problems and handoff errors, then total cost.
- Relations: [Orchestration efficiency](orchestration-efficiency.md) measures controller overhead, and [Incremental revise finding delivery](incremental-revise-finding-delivery.md) mentions a supervisor that could own finding fan-out.
