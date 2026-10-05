---
name: v3-review-decision-context
description: Carry settled decisions and experiment evidence into later reviews
metadata:
  type: feature
---

# Carry settled decisions and experiment evidence into later reviews

Complete the retained concise decision and experiment record so subsequent independent reviews receive relevant settled facts and unresolved obligations after edits or compaction. Preserve the ability for new evidence to reopen a decision.

## Selected outcome

Bounded acknowledgements and the controller-owned experiment ledger were simplified into the ordinary run record, not retired. History and finding dispositions exist, but reviewers also need access to applicable prior reasoning and raw evidence without inheriting the author's correctness argument. On 2026-10-03 the user reversed the ledger part of that simplification, in their words: "a separate experiments ledger would be good too, not fond of the simplification"; the ledger is now tracked by [Controller-run experiments](controller-run-experiments.md), and this entry keeps the delivery of settled decisions and evidence to later reviews.

## Evidence and limits

`buildPrompt` supplies requirements, the cumulative source, assigned findings and matching probes. Since the local 3.3.0 candidate, a resumed or replacement lead also receives the dispositions of its own findings recorded since its last report, and any dispatch can carry controller-chosen `review.acknowledgements`. A fresh review still receives no automatic projection of prior dispositions, and no review receives experiment conclusions. The active bug "Probe evidence about the host is discarded on any edit" is a concrete subset and remains its repair owner.

Run `5196a103-47f4-4efd-8012-a5a61ad2eb23` on 2026-10-05 showed the cost of controller-chosen acknowledgements: a skeptic refuted a docs-review routing finding on task qw-dependency-lines, and the next fresh docs review (`3468fd47`), dispatched with acknowledgements written before the refutation, raised the same finding again as important and required, so a second skeptic (`4405d830`) had to refute it. It did not recur once the controller added the refutation to later dispatches' acknowledgements. The user chose at that run's triage to record it here as evidence for acknowledgements derived from the run record.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Settle relevance, invalidation and bounded delivery, with fuller-evidence fallback when summarization is unsafe. Verify a settled decision across an unrelated edit, changed evidence reopening it, and unresolved obligations surviving compaction. Coordinate with the existing probe-evidence bug rather than duplicating its repair.

The existing [host-probe evidence bug](../BUGS.md#probe-evidence-about-the-host-is-discarded-on-any-edit) owns its concrete invalidation repair. Share supporting evidence without recreating a separate experiment ledger; since the user's 2026-10-03 reversal noted above, experiment records belong in the separate ledger that [Controller-run experiments](controller-run-experiments.md) tracks, which later reviews can draw on.

## Recording gaps found by the migration accounting audit

The audit of 2026-09-29 found two recording gaps that this entry also owns, besides delivery to later reviews:

- Capturing investigations, for the retained need Controller-owned session experiment ledger. Follow-ups, dispositions with their reasons, check output, the closing retrospective and the morning report already record much of this, but no instruction directs recording a material investigation's conclusion, deciding evidence and limits in the run record when they are established, and an attended run without a handover has no morning report.
- Working notes, for the retained need Stage-altitude finding routing, whose agreed disposition under [Finding decisions](../../V3-MIGRATION.md#finding-decisions) begins "Preserve useful implementation discoveries in working notes and carry unresolved obligations through compaction or handoff." Unresolved obligations survive compaction and handoff, but no instruction or runtime operation preserves implementation discoveries, and a finding deferred to implementation leaves the focused status once it is disposed.

## Settled questions

The user agreed these answers on 2026-10-05, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: `review.acknowledgements` in `internal/runtime/review.js` carries free-text statements the controller chooses for each dispatch, delivered as "Do not raise them again; adjacent issues about how they are carried out remain in scope"; a resumed or replacement lead receives its own findings' dispositions through `dispositionsSince` in `internal/runtime/continuation.js`; a fresh review receives neither automatically; and the runtime reference records user decisions made mid-run in `agreement.decisions`, while no runtime operation records an investigation's conclusion or an implementation discovery.

- Which settled facts reach later reviews. Settled: every review dispatch, fresh ones included, receives acknowledgements the runtime derives from the run record: the task's refuted, skipped and deferred findings, each as its claim in one line with its disposition and reason, and the user decisions recorded in `agreement.decisions`. They never carry the author's argument for correctness, and a fresh reviewer receives no other earlier findings. The controller can still add statements through the existing option, such as intentional choices from the agreement.
- Relevance and invalidation. Settled: each projected acknowledgement names the paths its finding concerned. When any of them changed after the disposition, the acknowledgement is delivered marked as settled before a later change, so the reviewer judges that content afresh rather than staying silent. Acknowledgements stay scoped to the settled choice, as the existing clause on adjacent issues already does.
- Preserving the ability for new evidence to reopen a decision. Settled: a reviewer may raise a settled point again only by citing new evidence and saying what changed, and the delivered text says so.
- Bounded delivery, with fuller evidence where summarizing is unsafe. Settled: the projected set has a size bound; beyond it the reviewer receives compact entries and the full records in its review copy, and an acknowledgement whose summary would blur the settled choice with the mechanics around it is delivered in full.
- Experiment conclusions. Settled: once the separate ledger that [Controller-run experiments](controller-run-experiments.md) tracks exists, its conclusions relevant to a review reach it the same way, with their evidence and limits. That entry graduated the same day, and its MVP slice supplies the ledger, so this is a later extension rather than a dependency.
- The two recording gaps. Settled: a runtime operation records a note of kind investigation, with its conclusion, deciding evidence and limits, or kind discovery, for an implementation discovery, when it is established, and the operating brief directs recording both. Notes survive compaction and handoff with the run state, and a finding deferred to implementation stays visible in the focused status until the implementation addresses it.
- Relations. Settled: the entry requires nothing, and [Probe evidence about the host is discarded on any edit](../BUGS.md#probe-evidence-about-the-host-is-discarded-on-any-edit) keeps its own invalidation repair.

## Before implementation

Settle the projected acknowledgement's form, how a finding records the paths it concerns, the size bound, the note operation and the focused-status rule in a concise governing spec in `.nightshift/specs`. The change alters the runtime's review dispatch, its records and the focused status, the operating brief and revise-code, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check of reviewer behavior under projected acknowledgements and deterministic evidence only. Verify a settled decision across an unrelated edit, a change to its paths reopening it, new evidence reopening it, and unresolved obligations surviving compaction. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Bounded revise acknowledgement context](../reports/v3-migration-followups-20260920.md#bounded-revise-acknowledgement-context).
- [Controller-owned session experiment ledger](../reports/v3-migration-followups-20260920.md#controller-owned-session-experiment-ledger).

[The migration decision](../../V3-MIGRATION.md#finding-delivery-and-retained-context) preserves the surviving requirement; earlier records: [bounded-revise-acknowledgement-context](bounded-revise-acknowledgement-context.md), [controller-owned-session-experiment-ledger](controller-owned-session-experiment-ledger.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
