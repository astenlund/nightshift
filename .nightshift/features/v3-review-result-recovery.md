---
name: v3-review-result-recovery
description: Recover review report formatting without repeating the assessment
metadata:
  type: feature
status: exploring
---

# Recover review report formatting without repeating the assessment

Complete the retained minimal-report contract with narrow correction or clarification of malformed results, preserving original substantive findings, attribution and evidence instead of automatically repeating the full review.

## Selected outcome

V3 validates structured reports, which meets only part of the agreed Review report JSON schema replacement. Formatting mistakes should be recoverable without rewriting substance or turning missing evidence into a completed verdict.

## Evidence and limits

`dispatchReview` validates output after runAgent and records a failed attempt on parsing or validation errors; fallback invokes a new assessment. There is no dedicated report-correction operation in the runtime reference.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Define which failures permit narrow correction, how original and corrected results remain attributable, and when a fresh assessment is required. Verify malformed formatting, contradictory evidence, stale inputs and interrupted correction.



## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Review report JSON schema](../reports/v3-migration-followups-20260920.md#review-report-json-schema).

[The migration decision](../../V3-MIGRATION.md#execution-and-result-handling) preserves the surviving requirement; earlier records: [review-report-json-schema](review-report-json-schema.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
