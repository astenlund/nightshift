---
name: night-guard
description: Explore reboot-aware coordination and continuously persisted recovery state across active agent sessions
metadata:
  type: feature
status: exploring
---

# Night Guard

Tracked for after the v3 MVP by user decision on 2026-09-10. Explore a watchdog that detects an impending Windows reboot, coordinates a bounded stop across active Nightshift sessions, and preserves work for later resumption.

Autonomy comes first, quality second, and speed and economy third. Recovery must not depend on an agent composing a checkpoint after the shutdown warning: Windows may leave only seconds, and some sessions may receive no warning or never respond.

## Agreed direction

- Persist recovery state continuously throughout the run, including enough current authority, ownership, obligations and evidence to reconcile interrupted work later.
- Identify multiple active agent sessions and message the intended sessions, including sessions on different hosts. Preserve session identity and ownership; unrelated sessions must not be stopped accidentally.
- Use the final warning window to stop starting new work, request interruption of ongoing work, flush remaining state where possible, and collect per-session acknowledgements within the available time.
- Recover from the last durable state when notification, flushing or acknowledgement is missing. Partial writes, uncertain activity and stale evidence require reconciliation rather than a completion claim.
- Preserve the original task authority and user decisions when resuming. Checkpointing does not authorize new work, ownership transfer or publication.

Warning signals, session discovery and messaging, checkpoint contents, trust boundaries, and recovery behavior need design and host verification. Automatic host relaunch is related work in [V3 continuations](v3-continuations.md); tracking Night Guard does not settle that policy or authorize implementation.

The [acceptance report](../reports/v3-acceptance-272m-20260910.md) records the campaign that prompted this capture. The original idea and its multi-session and continuous-persistence refinements remain in the local `night-guard-reboot-watchdog` follow-up in `.tmp/v3-work-queue.json`.
