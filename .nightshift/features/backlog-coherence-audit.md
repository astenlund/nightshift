---
name: backlog-coherence-audit
description: Whole-backlog coherence audit as a mode of revise-docs, repairing when attended and reporting when unattended
metadata:
  type: feature
---

# Whole-backlog coherence audit

Raised by the user on 2026-09-25 and shaped in discussion the same day; the user settled its commitments and graduated it from Exploring that day. This feature is tracked in [the feature index](../FEATURES.md#whole-backlog-coherence-audit). Tracking and readiness do not authorize implementation.

## Problem

`revise-docs` reconciles the backlog against one change: it finds what that change made stale. Nothing audits the active backlog as a whole, so drift that accumulates between changes goes unnoticed. Active entries depend on prose relationships ("coordinate with", "separate from", "already considers", "carried by") and on anchors into sibling indexes, breakouts and history files, while the parser validates only `Requires` and `External`. Entries also make claims about the current code ("the current `cli.js` probe branch still returns ...") that go stale when the code changes.

## Agreed direction

- The audit is a whole-backlog mode of `revise-docs`, not a new public skill. It walks every active index, breakout and pattern file; history files are out of scope as audit subjects, but links from active entries into them must still resolve.
- Scope covers relationships between entries (stated separations and coordinations still holding, overlapping or duplicate entries, missing or satisfied `Requires`), consistency between index excerpts and their records, and entries' claims about the current code.
- Every finding receives fresh skeptic validation against concrete evidence before it is repaired or reported, as in the rest of the revise family.
- When attended, the audit repairs what it confirms, under the existing revise-docs rules. When unattended, it edits nothing and writes a report to the inbox for later triage, since backlog content reflects the user's triage decisions.
- Under the user's global review rules the backlog is documentation, so the audit's repairs are reviewed with the documentation lens: accuracy against what each entry describes.

## Slices

- **MVP - manual audit.** The user triggers the audit explicitly; there is no scheduled trigger.
- **Scheduled trigger.** A scheduled run first checks whether any commit has landed since the last audited commit and aborts without auditing if none has; checking for any new commit is deliberately broader than checking the backlog and the code it cites, because a spurious audit costs less than a missed one. Still open: where a scheduled run executes, where its report lands and where the last audited commit is recorded. A local run needs the machine awake; a cloud routine works from the pushed repository, sees no unpushed backlog edits and cannot write to the git-ignored inbox, so the options raised are to stop ignoring the inbox (coordinate with [project inboxes](project-inboxes.md), which owns inbox version-control policy) or to deliver the report elsewhere.

Deterministic checks that could run in the Ready parser on every invocation (dead links and anchors, orphaned breakouts, excerpt drift) are a separate entry, [Ready reports broken backlog links and drifting excerpts](../QUICK_WINS.md#ready-reports-broken-backlog-links-and-drifting-excerpts), leaving model judgment to this audit.
