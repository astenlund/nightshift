---
name: ready-interrupted-run-pickup
description: A new session learns about interrupted Nightshift work from Ready and can pick it up so everything behaves as in the original session
metadata:
  type: feature
---

# Ready offers to pick up an interrupted run

Raised by the user on 2026-09-19 during review of the handover transition and morning report, in their words: "if entering a new session in a project that had an interrupted run, `/ready` should inform the user of the unfinished work and offer to pick it up from there", and "everything should work the same from the user's perspective once the run has been resumed in a new session, so no pointing to report files or the like". This feature is tracked in [the feature index](../FEATURES.md#ready-offers-to-pick-up-an-interrupted-run).

## Why

The original baseline bound a run to the host session that created it. The local 3.2.3 candidate now supports explicit compatible adoption, with [evidence and limitations](../reports/run-adoption-and-continuation-20260921.md); automatic Ready pickup remains separate, unimplemented scope. The historical motivation below describes the earlier baseline. Hooks restore obligations, the morning-report notice and the follow-up hand-off only in that owning session, and every mutation is refused elsewhere, which is the tracked bug [Run ownership is locked to the creating host session](../BUGS_HISTORY.md#run-ownership-is-locked-to-the-creating-host-session). Plugin 3.2.0 therefore states a boundary instead of working around it: [the governing spec](../specs/handover-transition-and-morning-report.md) keeps report duties within the active run and its owner, and deliberately does not send a returning user to saved report files. A user who comes back in a new session currently learns nothing about the unfinished work. A related incident on 2026-09-18, reported in the maintainer inbox as `2026-09-18-no-activation-after-clear-blocks-runtime-create.md` and not yet triaged, had a session that had used `/clear` unable to create a run until it was reopened; its cause is not established.

## Shape

Ready already lists untriaged inbox reports beside the ready set in this repository; an interrupted or undelivered run is the same kind of notice. When the project has a run that is not complete, or is stopped, or is a completed handed-over run whose report was never delivered, Ready says so with enough context to decide, and offers to pick it up. The settled questions below narrow this: the undelivered-report case is left to keeping handed-over runs open after delivery. Picking it up is the adoption the ownership bug describes, under explicit user authority, after which the adopting session is the owner and every existing mechanism (obligation brief, Stop protection, morning-report notice, report hand-off and follow-up triage) applies unchanged. Ready stays read-only: the offer is a question, and adoption is a separate authorized operation.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- Whether unfinished work includes a completed handed-over run with an undelivered report, which 3.2.0 can surface only in the owning session. Settled: no. Unfinished work here is a stopped run, or a run marked running whose controlling session has ended. [Keep a handed-over run open for triage after delivery](handover-open-for-triage.md) is to keep a handed-over run open after delivery, so a run whose report the user has not yet seen would be an open run rather than a completed one, and this feature adds no adoption of completed runs. Whichever of the two features ships second makes Ready present a delivered but still open run as delivered and waiting for the user's follow-up triage, with an offer to continue that triage in the new session, never as interrupted.
- How Ready learns about runs without requiring continuation activation, since Ready was the one entry admitted without it when this was settled; the 3.3.10 runtime admission also tolerates absent activation, while runs bound to older retained runtimes keep their prerequisites. Settled: Ready reads the project's run state read-only, without activation, and the read works whatever release the run is bound to. Today a bound `status` read refuses a run bound to another release; the quick win [Bound status refuses a completed run bound to another release](../QUICK_WINS.md#bound-status-refuses-a-completed-run-bound-to-another-release) tracks that refusal for completed runs, and the two are best done together, although neither requires the other.
- What the offer says when the run's workers are still active or its release binding differs from the new session's. Settled: when the run is still active in another session, or its workers are not provably inactive, Ready says so and offers no pickup, since adoption requires that evidence. When the run's release cannot be adopted from this session, Ready says why and what the user can do. Ready never offers a replacement run over unfinished work.
- Whether the notice also belongs in the SessionStart context of a non-owning session, or only in Ready. Settled: only in Ready, as the user first asked, in its own section before the ready set. A SessionStart notice stays a possible later step, left out for now because hooks run in every session in the project.

Ready stays read-only: the offer is a question, and pickup happens only after the user says yes, through the existing `adopt` operation.

## Relationships

Adoption of a stopped run with no active workers by another session, which the run-ownership bug tracked, came first and was delivered as explicit adoption. Adopting a completed run, which the undelivered-report case would have needed, was an open point of this feature until 2026-10-03, when it was settled as above. Transferring a run that is still active stays with [V3 continuations](v3-continuations.md).

## Before implementation

Settle the read-only run summary, the notice's wording for each case above and the offer's path into `adopt` in a concise governing spec in `.nightshift/specs`. The change alters the Ready skill and what it reads, so it rides with a plugin version increase, and since pickup involves real sessions, the start of the work decides between a budgeted installed-host check and deterministic evidence only with the model-owned behavior marked unverified. Tracking and readiness do not authorize implementation.
