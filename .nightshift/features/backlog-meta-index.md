---
name: backlog-meta-index
description: Centralize shared backlog instructions in a BACKLOG.md meta-index
metadata:
  type: feature
status: exploring
---

# Shared BACKLOG.md meta-index

Proposed by the user during the recoverable-unwrap handover on 2026-09-21 and approved for tracking at the closing triage. Tracked in [the feature index](../FEATURES.md#shared-backlogmd-meta-index). The original capture is follow-up `backlog-meta-index` in run `16d148ab-5297-4077-80e9-c993afc81433`.

## Requested direction

- Introduce one `BACKLOG.md` meta-index pointing to `FEATURES.md`, `BUGS.md`, `QUICK_WINS.md` and `PATTERNS.md`.
- Put shared backlog instructions in that file to avoid repeating them across the indexes. Keep instructions specific to an individual index with that index.
- Include `BACKLOG.md` in every hook that uses any of the four index files, so those hooks receive the shared guidance.

## Details to settle

Choose the file's project location and link-resolution convention. Inventory the shared instructions and all consumers before deciding which text moves and how each reader reaches the meta-index; that inventory has not yet been established. Define setup and migration behavior for existing projects, preserving customized guidance and handling a missing or conflicting meta-index explicitly. Coordinate with [guidance discovery and routing](v3-guidance-routing.md) and [customized backlog repair](v3-setup-compatibility.md) without assuming either feature is already delivered.

Tracking preserves the idea for design; it does not authorize implementation or publication.
