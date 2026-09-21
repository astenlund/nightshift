---
name: v3-review-decision-context
description: Carry settled decisions and experiment evidence into later reviews
metadata:
  type: feature
status: exploring
---

# Carry settled decisions and experiment evidence into later reviews

Complete the retained concise decision and experiment record so subsequent independent reviews receive relevant settled facts and unresolved obligations after edits or compaction. Preserve the ability for new evidence to reopen a decision.

## Selected outcome

Bounded acknowledgements and the controller-owned experiment ledger were simplified into the ordinary run record, not retired. History and finding dispositions exist, but reviewers also need access to applicable prior reasoning and raw evidence without inheriting the author's correctness argument.

## Evidence and limits

`buildPrompt` supplies requirements, the cumulative source, assigned findings and matching probes. It does not automatically project prior dispositions or experiment conclusions into review context. The active bug "Probe evidence about the host is discarded on any edit" is a concrete subset and remains its repair owner.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Settle relevance, invalidation and bounded delivery, with fuller-evidence fallback when summarization is unsafe. Verify a settled decision across an unrelated edit, changed evidence reopening it, and unresolved obligations surviving compaction. Coordinate with the existing probe-evidence bug rather than duplicating its repair.

The existing [host-probe evidence bug](../BUGS.md#probe-evidence-about-the-host-is-discarded-on-any-edit) owns its concrete invalidation repair. Share supporting evidence without recreating a separate experiment ledger.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Bounded revise acknowledgement context](../reports/v3-migration-followups-20260920.md#bounded-revise-acknowledgement-context).
- [Controller-owned session experiment ledger](../reports/v3-migration-followups-20260920.md#controller-owned-session-experiment-ledger).

[The migration decision](../../V3-MIGRATION.md#finding-delivery-and-retained-context) preserves the surviving requirement; earlier records: [bounded-revise-acknowledgement-context](bounded-revise-acknowledgement-context.md), [controller-owned-session-experiment-ledger](controller-owned-session-experiment-ledger.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
