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
