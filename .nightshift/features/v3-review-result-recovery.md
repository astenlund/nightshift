---
name: v3-review-result-recovery
description: Recover review report formatting without repeating the assessment
metadata:
  type: feature
---

# Recover review report formatting without repeating the assessment

Complete the retained minimal-report contract with narrow correction or clarification of malformed results, preserving original substantive findings, attribution and evidence instead of automatically repeating the full review.

## Selected outcome

V3 validates structured reports, which meets only part of the agreed Review report JSON schema replacement. Formatting mistakes should be recoverable without rewriting substance or turning missing evidence into a completed verdict.

## Evidence and limits

`dispatchReview` validates output after runAgent and records a failed attempt on parsing or validation errors; fallback invokes a new assessment. There is no dedicated report-correction operation in the runtime reference.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Settled questions

The user agreed these answers on 2026-10-05, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked on 2026-10-04 in `internal/runtime/review.js`: both hosts receive the report's JSON schema (`schemaFor`), while `validateReport` also enforces rules a schema cannot express, such as evidence on every finding and coverage evidence for every dimension of a complete review; when a completed attempt's report fails parsing or validation, `dispatchReview` records the attempt as failed and the next candidate starts a fresh assessment, so the finished assessment work is discarded. Resuming a reviewer's own session already works on both hosts for continued reviews.

- Which failures permit narrow correction. Settled: when an attempt completes but its report fails parsing or validation, the runtime resumes that reviewer's own session once, passing the validation error and asking for the same report in valid form with no change of substance. Form faults are corrected by re-emitting: unparseable output, a wrong request echo, missing or empty required text, duplicate identities and wrong shapes. An evidence gap, a report marked complete without coverage evidence for every dimension or marked complete while it requests probes, may be corrected only by downgrading the report to incomplete with its findings kept, never by adding coverage evidence to justify a complete verdict. A skeptic that left an assigned finding unevaluated is not corrected, since the evaluation itself is missing work, and neither are an unattributable or unfinished session, unverified termination or changed inputs; these keep today's handling.
- How original and corrected results remain attributable. Settled: the reviewer's identity is unchanged, since the correction runs in the same session. The receipt records that a correction turn happened and which validation error prompted it, the original output stays in the attempt's artifacts beside the corrected one, and the correction turn's token usage counts toward the attempt.
- When a fresh assessment is required. Settled: when the resume fails or the corrected report fails again, the attempt fails as today and the next candidate takes over. The input-drift check still runs after a correction, so a project that changed during the review still needs a fresh assessment, and skeptics validate a corrected report's findings like any other.

## Before implementation

Settle the correction prompt, the exact split of validation errors into correctable form faults, downgrade-only evidence gaps and uncorrectable failures, and the receipt fields in a concise governing spec in `.nightshift/specs`. The change alters the runtime's review dispatch, the runtime reference and the fixtures, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check of the correction turn on each host, which depends on host resume and on the model, and deterministic evidence only. Verify malformed formatting, each evidence gap, contradictory evidence, stale inputs and interrupted correction. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Review report JSON schema](../reports/v3-migration-followups-20260920.md#review-report-json-schema).

[The migration decision](../../V3-MIGRATION.md#execution-and-result-handling) preserves the surviving requirement; earlier records: [review-report-json-schema](review-report-json-schema.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
