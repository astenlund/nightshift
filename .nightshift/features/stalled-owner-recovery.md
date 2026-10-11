---
name: stalled-owner-recovery
description: Supported, user-directed recovery of a running run whose owning chat can no longer act while its host process lives on, so a stalled owner forces neither an app restart nor an unsupported manual stop
metadata:
  type: feature
status: exploring
---

# Recover a run whose owner can no longer act while its host process lives on

## Origin

Reported to the maintainer inbox on 2026-10-07 from this repository at the user's explicit request, in their words: "yes. also file a report to the nightshift inbox; this should be officially supported". Run `67af3471-c7c7-4e28-ab57-88e3ba299126`, on the retained 3.3.8 runtime, was owned by Codex chat `01a11295-41c4-7ae0-ac66-458b36c6b1d6`, which stalled after its context overflowed, as [Codex controller overflows its context window instead of compacting](../BUGS.md#codex-controller-overflows-its-context-window-instead-of-compacting) records, and which the user closed. A new chat's `adopt` was refused with `controller-not-inactive`, "The exact former controller process is live or its inactivity is unknown": the saved controller identity and the new chat ran in the same live `codex.exe` process, which hosts every chat of the Codex app, so closing the chat could not show the former controller inactive. Restarting the app would have interrupted the user's work in other projects. With the user's approval the controller recorded an administrative user stop outside the public interface, at revision 172, after backing up the run database, checking the backup's integrity and the exact saved run content, and verifying that every recorded worker had ended; normal adoption then succeeded at revision 173 and left execution stopped until resumption was authorized. Tracked as Exploring at inbox triage on 2026-10-11.

## Current understanding

The refusal follows [the run-adoption and continuation spec](../specs/run-adoption-and-continuation.md): an explicitly stopped run can move to another session while the former chat or host process stays open, but a run still marked running also needs confirmed inactivity of its former controller, which the runtime judges by the controller's process. A controller that can no longer take a turn cannot stop its own run, and on Codex Desktop its process outlives the chat, so the only supported recovery is quitting the whole app, as the user did after the second overflow in the same run on 2026-10-08. The administrative stop kept the former owner, queue, findings, evidence, workers, limits and publication authority, and recorded the operator, the approval, the native observation and the backup's identity; it was an explicit exception, not a supported path. The app's own chat state reported the former chat as not loaded, with a failed latest turn; the report did not claim that this proves every assignment or descendant ended. Claude Code, separate native processes and other host states were not tested.

The same recovery hit an unrelated limit in its own scratch script: hashing the 2,328,989,696-byte backup with `readFileSync` exceeded Node's 2 GiB read limit. The run store's growth is tracked in [Run store keeps a full state copy for every revision](../BUGS.md#run-store-keeps-a-full-state-copy-for-every-revision).

## Open questions

- What evidence shows that a former controller can no longer act when its process is shared, such as the host's own chat or thread state, and how that evidence is captured and recorded.
- Who may record the stop from another session and under what user direction, and whether that is a new runtime operation or an extension of `stop` or `adopt`.
- Which safeguards it keeps from the manual recovery: worker termination checks, a backup or integrity check, and a record of the operator, approval and observation.
- How it interacts with ownership checks, an operation still in flight and publication authority, and whether Claude Code needs the same path.
- How it relates to [Ready offers to pick up an interrupted run](ready-interrupted-run-pickup.md), which offers no pickup while the run or its workers may still be active.
