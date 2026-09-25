---
name: backlog-index-version
description: Version the backlog index files themselves and check the version against the plugin's latest, notifying the user to run init-backlog to bring an outdated index up to date
metadata:
  type: feature
status: exploring
---

> V2 design/diagnostic archive. The agreed disposition and surviving needs are recorded in [MIGRATION_STATUS.md](../../../MIGRATION_STATUS.md). Current implementation is governed by [the v3 MVP](../../../features/nightshift-v3.md); this historical design is not a separate active work item.

# Backlog index version

Give each backlog index file (`.nightshift/FEATURES.md`, `QUICK_WINS.md`, `BUGS.md`, `PATTERNS.md`) its own durable version number, separate from the plugin version, and an instruction to check that version against the latest version known to the plugin, so the user is notified to run `/init-backlog` when an index predates the current template.

Idea sketch (2026-08-12 capture): the index files carry a version marker; a check invoked on demand compares it against the latest version from the plugin (a "backlog index version", explicitly not the plugin version) and notifies the user that they should run `init-backlog` to bring the index up to the latest version.

Open questions to settle when it graduates to a designed feature: where the version marker lives and its exact grammar (frontmatter field, a comment, a header line) so it survives index rewrites; how the plugin exposes its "latest index version" (a constant in bundled code, a marker in the template itself); which on-demand check surfaces the notification (`/nightshift:ready`, a dedicated `init-backlog --check`, or a drift report); how the version interacts with the existing concept-checklist staleness heuristic (a version bump at template change would make staleness decidable by comparison instead of by prose concept-matching, likely simplifying the `## Concept checklists` logic); and whether the version gates the `## Exploring` drafts or only the template-controlled sections.
