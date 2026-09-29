---
name: visible-revise-progress
description: Keep review and repair progress visible without a user request, saying what review established, what was repaired, what remains and why another pass is needed, with recurring problems visible through continuation and in the final report
metadata:
  type: feature
status: exploring
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

## Direction

After each review or repair pass, tell the user briefly what was established, repaired and left, and why another pass is needed, and keep recurring problems visible through continuation and in the final report.

## Open questions

- Presentation and storage, which the disposition leaves open, and how an unattended run records progress for the morning report instead of for a user who is away.
- How this relates to [Graphical run view](run-graph-view.md), a live graph of the run rather than this textual summary.
