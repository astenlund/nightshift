---
name: project-inboxes
description: Give every Nightshift project an inbox for its own suggestions and reports
metadata:
  type: feature
status: exploring
---

# Project inboxes

Requested and clarified by the user on 2026-09-13. Extend the inbox concept currently used by the Nightshift repository to every project using Nightshift. This feature is tracked in [the feature index](../FEATURES.md#project-inboxes).

## Agreed direction

- Every project's `.nightshift/inbox/` holds raw suggestions and reports relating to that project. Ownership follows the subject of the report: entries in `foo/.nightshift/inbox/` must concern foo, regardless of where they were observed.
- Reports about Nightshift itself continue to go to Nightshift's maintainer inbox, including reports raised while working in another project.
- `init-backlog` creates the project inbox.
- `ready` lists untriaged inbox reports separately from actionable backlog work. Inbox entries are holding material for triage, not ready tasks or implementation authority.
- Triage deletes a report once its disposition is durably recorded (as a backlog entry, or in a triage record, including an explicit skip), rather than keeping it in the inbox or moving it to a subfolder. Added by the user on 2026-09-24 after four already-triaged reports were found lingering in the maintainer inbox's `triaged/` subfolder.

## Details to settle

Settle version-control policy, capture and triage conventions beyond report deletion, handling of existing projects and setup reruns, and how project inbox capture interacts with follow-ups retained by an active run. Preserve existing reports during setup. The current maintainer presentation omits empty or absent inboxes; decide and document that behavior for the general project view alongside the implementation scope.
