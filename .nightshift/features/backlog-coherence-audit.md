---
name: backlog-coherence-audit
description: Whole-backlog coherence audit as a mode of revise-docs, repairing when attended and reporting when unattended
metadata:
  type: feature
status: exploring
---

# Whole-backlog coherence audit

Raised by the user on 2026-09-25 and shaped in discussion the same day. This feature is tracked in [the feature index](../FEATURES.md#whole-backlog-coherence-audit).

## Problem

`revise-docs` reconciles the backlog against one change: it finds what that change made stale. Nothing audits the active backlog as a whole, so drift that accumulates between changes goes unnoticed. Active entries depend on prose relationships ("coordinate with", "separate from", "already considers", "carried by") and on anchors into sibling indexes, breakouts and history files, while the parser validates only `Requires` and `External`. Entries also make claims about the current code ("the current `cli.js` probe branch still returns ...") that go stale when the code changes.

## Agreed direction

- The audit is a whole-backlog mode of `revise-docs`, not a new public skill. It walks every active index, breakout and pattern file; history files are out of scope as audit subjects, but links from active entries into them must still resolve.
- Scope covers relationships between entries (stated separations and coordinations still holding, overlapping or duplicate entries, missing or satisfied `Requires`), consistency between index excerpts and their records, and entries' claims about the current code.
- When attended, the audit repairs what it confirms, under the existing revise-docs rules. When unattended, it edits nothing and produces a report for later triage, since backlog content reflects the user's triage decisions.
- The user triggers it manually; a scheduled trigger is also wanted.

## Details to settle

- Where a scheduled run executes. A local run needs the machine awake; a cloud routine works from the pushed repository, sees no unpushed backlog edits, and cannot write to the git-ignored inbox. Options raised: stop ignoring the inbox (coordinate with [project inboxes](project-inboxes.md), which owns inbox version-control policy) or deliver the report elsewhere. Left open by the user on 2026-09-25.
- Whether a scheduled run should skip when the backlog and cited code are unchanged since the last audit, rather than run on a fixed cadence, given the cost of a full read.
- Which checks are deterministic (dead links and anchors, orphaned breakouts, excerpt drift) and could run in the Ready parser as notices on every invocation, leaving model judgment to the audit. Coordinate with [parser consistency](v3-parser-consistency.md) and the [shared BACKLOG.md meta-index](backlog-meta-index.md).
- How findings are validated before repair or reporting, consistent with the revise family's independent validation.
