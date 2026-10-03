---
name: visible-revise-progress
description: Keep review and repair progress visible in text without a user request, saying after each pass what review established, what was repaired, what remains, why another pass is needed and what the pass used in tokens by category, with recurring problems and usage totals visible through continuation and in the final report
metadata:
  type: feature
---

# Show review progress without being asked

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded "Revise progress visible by default" as Policy present, relying on the reconciliation report's statement "The brief requires visible progress". Independent auditors and verifiers found that the operating brief never contained such a rule: not at the v3 introduction, not when the reconciliation report was written, and not now. Drafted overnight for the user's triage.

## Agreed disposition

Agreed on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md#progress-and-review-cost): "Keep progress visible without requiring a user request: what review established, what was repaired, what remains unresolved, and why another pass is needed. Preserve an inspectable history so recurring problems remain visible through continuation and in the final report. Drop compulsory reprinting of the entire growing log after every pass and fields tied to the old cells, waves, and fingerprints. Exact presentation and storage remain open."

## Current behavior

Checked on 2026-09-29:

- Missing: no instruction a run loads, and no runtime output, tells the user after a pass what review established, what was repaired, what remains and why another pass is needed. [The operating brief](../../internal/workflow.md) mentions progress only in passing: a progress notice is not a presentation, progress output may not have been read, the Stop hook has a no-progress bound, and a supervisor can coordinate progress. None of these directs a progress summary.
- Partly carried: the runtime keeps an inspectable history (`status`, `inspect`, `history`, and findings linked to earlier ones), but the focused status lists only unresolved findings, nothing directs reading the history for resolved earlier findings, and the final report carries retrospective outcomes rather than the review and repair series.
- Carried: the three-pass signal to investigate a shared cause, and the dropped log reprinting and old fields.

Checked on 2026-10-03: the operating brief and the revise skills still direct no progress summary. Token usage is recorded only as one total per review attempt. `internal/runtime/hosts.js` sums Claude's input, output, cache-read and cache-write counts from the result's `modelUsage` and keeps only `totalTokens` from Codex's `thread/tokenUsage/updated` event, and `internal/runtime/review.js` stores that figure on each attempt and the session total on the receipt; the categories survive only in each attempt's native event log. The hosts count differently: Claude's input count excludes cache reads and writes, while a Codex event reports `inputTokens`, `cachedInputTokens`, `cacheWriteInputTokens`, `outputTokens` and `reasoningOutputTokens`, and in one sample from this repository its `totalTokens` (30,264) was `inputTokens` (30,201) plus `outputTokens` (63). Whether Codex counts cached input inside `inputTokens` is not established, since that sample had none.

## Direction

After each validated review result and each repair batch, tell the user in a short text update what was established, repaired and left, why another pass is needed and what the pass used in tokens by category, and keep recurring problems and usage totals visible through continuation and in the final report.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- Presentation and storage, which the disposition leaves open, and how an unattended run records progress for the morning report instead of for a user who is away. Settled: after each validated review result and each repair batch, in attended and unattended runs alike, the controller gives a short text update covering only what changed, never a reprint of the log: the findings confirmed, by severity, and those refuted; what was repaired; what remains open; and why the next pass happens, such as which reviewer resumes or that a fresh lead is due. No new store is added: the updates are drawn from the runtime's history and its per-attempt usage records, and the controller reads that history for earlier resolved findings so that a recurring problem shows. Because progress output may not have been read, the final report carries a short account of the review and repair passes, the repairs, any problem that recurred and the usage totals by category.
- How this relates to [Graphical run view](run-graph-view.md), a live graph of the run rather than this textual summary. Settled: this feature stays text only, and showing progress graphically is left to the graph view, whose record notes it. The user's words: "graphical representation made sense with the old v2 wave style reviews, but I don't think that's needed now", applying to this feature only, "partly because the graphical run view feature would cover that part". Neither depends on the other.

The user added one commitment at graduation, in their words: "a breakdown of token usage would be more helpful, including cached vs non-cached input/output".

- Token usage. Settled: each update gives the pass's usage as uncached input, cache reads, cache writes and output, plus the run's running total, and the final report gives the run's totals by category. The runtime records these categories for every review attempt and receipt instead of one total, converting each host's counting into the same categories, and for a resumed session subtracts the earlier totals category by category, as it already does for the total. A figure the runtime lacks, such as the usage of a resume whose host started a new session or a category a host does not report, shows as unknown, never zero, and a total that includes one says it is partial. Work the runtime did not dispatch, such as the controller's own turns and subagents started outside it, is not counted, and the update says so.

## Before implementation

The change adds usage recording to the runtime and progress guidance to the operating brief and the revise skills, so it ships with a plugin version increase and fixture tests covering both hosts' usage formats, including resumed attempts and unknown figures. How Codex's cached input relates to its input count is established before the categories are defined. The progress updates and the final-report account are model-owned behavior, so the start of the work decides between a budgeted installed-host check and deterministic evidence only with that behavior marked unverified. [Make resumed reviewers actually cheap](../QUICK_WINS.md#make-resumed-reviewers-actually-cheap), which needs to find why resumes start without a cache hit, would measure with these categories. Tracking and readiness do not authorize implementation.
