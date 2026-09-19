---
name: orchestration-efficiency
description: Investigate measured v3 controller overhead while preserving autonomy and independent quality assurance
metadata:
  type: feature
status: exploring
---

# Orchestration efficiency

Tracked for after the v3 MVP by user decision on 2026-09-10. Investigate avoidable controller overhead from repeated context reads, status polling, bookkeeping and mechanical tool round trips. Tracking authorizes later exploration; implementation choices remain open.

The invariant priority order applies: autonomy first, quality second, speed and economy third. Preserve independent broad review, fresh skeptical validation of findings, cumulative review after every repair, and dependable continuation and recovery.

## Evidence and direction

The v3 model-choice acceptance case used approximately 3.69M of its 3.96M total tokens in controller activity. This motivates investigation; controller activity also includes necessary work, and cached input tokens have a different cost from uncached input or output. Measure elapsed time and actual cost alongside token quantities before claiming savings.

Use representative v3 runs to locate avoidable repeated work, test focused improvements, and compare their effect on autonomy, quality and cost. Prefer fewer unnecessary reads and round trips where the same reliable evidence and independent judgment can be preserved. Do not assume that reducing token counts alone improves the workflow.

The [acceptance report](../reports/v3-acceptance-272m-20260910.md) records the campaign observations and qualifications. Detailed measurements are retained locally in `.tmp/v3-efficiency-assessment.md` and the `measured-orchestration-overhead` entry of `.tmp/v3-work-queue.json`.

Earlier wave-economy and prompt-prefix-caching proposals remain retired under the [migration assessment](../../V3-MIGRATION.md). This exploration follows measured v3 behavior and does not reinstate their old scheduler or prescribe a caching architecture.

## Measured in the handover transition run

Run `d4a44daa-96be-4ac4-bcaa-d16d8596584f` on 2026-09-18 to 19 delivered plugin 3.2.0, a change of roughly 400 lines, for 14,869,844 review tokens across 18 dispatches (six whole-spec assessments, six code dispatches and six skeptics, summed from that run's review receipts) and 14,445,999 live-verification tokens, the latter recorded in [the acceptance report](../reports/handover-transition-and-morning-report-20260919.md). Almost all of it was context re-read on every call: single dispatches cost 0.6 to 0.9 million tokens per spec assessment, for a spec of sixty lines plus project context, and 0.7 to 1.4 million per code dispatch, the cheaper ones being dispatches that returned incomplete, and a fixture controller carrying one handover lifecycle over a one-line documentation task cost 1 to 2.5 million tokens per host process, with a first-use Ready alone costing about 250,000. Four tracked defects fired during the run ("Probe evidence about the host is discarded on any edit", "Probe proposals with implausible timeouts run as specified", "Private review copies fail at Windows path depth" and "Permission-only recovery invalidates accepted specs"); the clearest single cost was a sixth whole-spec assessment of 903,042 tokens after `unblock` reopened the accepted spec, which was partly legitimate because the spec named the old allowance. The share of the review cost attributable to those defects was not measured, so fixing them is a likely cheap gain before any redesign, not an established one.
