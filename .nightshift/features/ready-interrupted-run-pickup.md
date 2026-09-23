---
name: ready-interrupted-run-pickup
description: A new session learns about interrupted Nightshift work from Ready and can pick it up so everything behaves as in the original session
metadata:
  type: feature
status: exploring
---

# Ready offers to pick up an interrupted run

Raised by the user on 2026-09-19 during review of the handover transition and morning report, in their words: "if entering a new session in a project that had an interrupted run, `/ready` should inform the user of the unfinished work and offer to pick it up from there", and "everything should work the same from the user's perspective once the run has been resumed in a new session, so no pointing to report files or the like". This feature is tracked in [the feature index](../FEATURES.md#ready-offers-to-pick-up-an-interrupted-run).

## Why

The original baseline bound a run to the host session that created it. The local 3.2.3 candidate now supports explicit compatible adoption, with [evidence and limitations](../reports/run-adoption-and-continuation-20260921.md); automatic Ready pickup remains separate, unimplemented scope. The historical motivation below describes the earlier baseline. Hooks restore obligations, the morning-report notice and the follow-up hand-off only in that owning session, and every mutation is refused elsewhere, which is the tracked bug [Run ownership is locked to the creating host session](../BUGS_HISTORY.md#run-ownership-is-locked-to-the-creating-host-session). Plugin 3.2.0 therefore states a boundary instead of working around it: [the governing spec](../specs/handover-transition-and-morning-report.md) keeps report duties within the active run and its owner, and deliberately does not send a returning user to saved report files. A user who comes back in a new session currently learns nothing about the unfinished work. A related incident on 2026-09-18, reported in the maintainer inbox as `2026-09-18-no-activation-after-clear-blocks-runtime-create.md` and not yet triaged, had a session that had used `/clear` unable to create a run until it was reopened; its cause is not established.

## Shape to explore

Ready already lists untriaged inbox reports beside the ready set in this repository; an interrupted or undelivered run is the same kind of notice. When the project has a run that is not complete, or is stopped, or is a completed handed-over run whose report was never delivered, Ready says so with enough context to decide, and offers to pick it up. Picking it up is the adoption the ownership bug describes, under explicit user authority, after which the adopting session is the owner and every existing mechanism (obligation brief, Stop protection, morning-report notice, single-reply hand-off) applies unchanged. Ready stays read-only: the offer is a question, and adoption is a separate authorized operation.

## Open questions

Whether unfinished work includes a completed handed-over run with an undelivered report, which 3.2.0 can surface only in the owning session. How Ready learns about runs without requiring continuation activation, since Ready is the one entry admitted without it. What the offer says when the run's workers are still active or its release binding differs from the new session's. Whether the notice also belongs in the SessionStart context of a non-owning session, or only in Ready.

## Relationships

Adoption of a stopped run with no active workers by another session, which the run-ownership bug tracks, comes first. Adopting a completed run, which the undelivered-report case would need, is not part of that bug and is an open point of this feature. Transferring a run that is still active stays with [V3 continuations](v3-continuations.md).
