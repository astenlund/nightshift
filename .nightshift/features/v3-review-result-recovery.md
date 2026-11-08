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

The [Mistral Large 4 evaluation](../reports/mistral-large-4-review-evaluation-20261030.md) recorded how often a Vibe reviewer's completed attempt hits these failures; the user chose on 2026-10-31 to add it here rather than as a separate quick win. The first run had 16 failed stage dispatches besides probe requests. Seven were replies that were not valid JSON, five were reports without findings or coverage, one was a finding without its severity and obligation assessment, two were reports marked complete although they needed probe evidence, and one was a host failure. The rerun had 15. Four were invalid JSON, three were findings without that assessment, and eight were reports marked complete although they needed probe evidence. Under the settled answers below, the JSON, shape and missing-assessment faults would be re-emitted, and the reports marked complete only downgraded to incomplete. Each such failure in the suite cost a fresh dispatch of the whole review.

Ordinary work showed the same classes on 2026-11-07 in Hermes delivery `f1473d98-bb0a-465b-be2c-60f7d29f0dbf` on installed 3.3.30, with `glm-5-3` on Vibe the first lead candidate before Sol on Codex and Opus on Claude, recorded here by the user's inbox triage decision on 2026-11-08 from the maintainer inbox report `2026-11-07-glm-lead-unusable-reports.md`. Five of the run's eleven GLM dispatches produced no usable report: four through report faults, and docs lead `34a0e70a`, which the report does not list, through a host billing failure outside these classes (HTTP 402, Vibe budget exhausted, read from its receipt), with Sol completing it on fallback. Fresh code lead `943cf127` was refused with "An assessment needing probe evidence must remain incomplete", a report marked complete while requesting probes, which the settled answers below allow only to be downgraded; Sol then returned an incomplete report with a probe request. The resume `7466bd2d` of a GLM lineage failed `resume-failed` on output that was not valid JSON ("Expected ',' or '}' after property value in JSON at position 6400"), a form fault; status routed `continue: replace` and the GLM replacement `2f9784a4` succeeded. Fresh code lead `e62dcec7` and fresh docs lead `9e10efb0` were refused with "Report lacks its toolFailure statement", missing required text, and Sol succeeded on fallback each time. The other six GLM dispatches (`98645100`, `a20cd156`, `2f9784a4`, `9f585c04`, `409641e6` and `83a92235`) produced usable reports. The fresh-lead report faults cost one extra fallback attempt each rather than blocking the run, and the failed resume needed its separate replacement dispatch; the cause of each malformed or incomplete report is not established. The request ids are under that project's `.nightshift/runs/reviews/`.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Settled questions

The user agreed these answers on 2026-10-05, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked on 2026-10-04 in `internal/runtime/review.js`: both hosts receive the report's JSON schema (`schemaFor`), while `validateReport` also enforces rules a schema cannot express, such as evidence on every finding and coverage evidence for every dimension of a complete review; when a completed attempt's report fails parsing or validation, `dispatchReview` records the attempt as failed and the next candidate starts a fresh assessment, so the finished assessment work is discarded. Resuming a reviewer's own session already works on both hosts for continued reviews.

- Which failures permit narrow correction. Settled: when an attempt completes but its report fails parsing or validation, the runtime resumes that reviewer's own session once, passing the validation error and asking for the same report in valid form with no change of substance. Form faults are corrected by re-emitting: unparseable output, a wrong request echo, missing or empty required text, duplicate identities and wrong shapes. An evidence gap, a report marked complete without coverage evidence for every dimension or marked complete while it requests probes, may be corrected only by downgrading the report to incomplete with its findings kept, never by adding coverage evidence to justify a complete verdict. A skeptic that left an assigned finding unevaluated is not corrected, since the evaluation itself is missing work, and neither are an unattributable or unfinished session, unverified termination or changed inputs; these keep today's handling. Amended by the user on 2026-10-18 at the triage of run `5b9cc37c-fd38-48f2-98d6-6e5f20594a99`: a report that names a failure of the reviewer's own tools is not corrected either, since a resume of the same session would meet the same tools and the only valid re-emission would blank the failure; since 3.3.13 `validateReport` refuses such a report with `reviewer-tools-unavailable`, after which a fresh or replacement dispatch falls back to its next candidate and a resumed dispatch fails with `resume-failed`, its closure then routed to a replacement, which stays its handling.
- How original and corrected results remain attributable. Settled: the reviewer's identity is unchanged, since the correction runs in the same session. The receipt records that a correction turn happened and which validation error prompted it, the original output stays in the attempt's artifacts beside the corrected one, and the correction turn's token usage counts toward the attempt.
- When a fresh assessment is required. Settled: when the resume fails or the corrected report fails again, the attempt fails as today and the next candidate takes over. The input-drift check still runs after a correction, so a project that changed during the review still needs a fresh assessment, and skeptics validate a corrected report's findings like any other.

## Before implementation

Settle the correction prompt, the exact split of validation errors into correctable form faults, downgrade-only evidence gaps and uncorrectable failures, and the receipt fields in a concise governing spec in `.nightshift/specs`. The change alters the runtime's review dispatch, the runtime reference and the fixtures, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check of the correction turn on each host, which depends on host resume and on the model, and deterministic evidence only. Verify malformed formatting, each evidence gap, contradictory evidence, stale inputs and interrupted correction. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Review report JSON schema](../reports/v3-migration-followups-20260920.md#review-report-json-schema).

[The migration decision](../../V3-MIGRATION.md#execution-and-result-handling) preserves the surviving requirement; earlier records: [review-report-json-schema](review-report-json-schema.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
