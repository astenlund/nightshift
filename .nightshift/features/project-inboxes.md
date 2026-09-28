---
name: project-inboxes
description: Give every Nightshift project an inbox for its own suggestions and reports
metadata:
  type: feature
---

# Project inboxes

Requested and clarified by the user on 2026-09-13. Extend the [inbox concept](nightshift-inbox.md) currently used by the Nightshift repository to every project using Nightshift. This feature is tracked in [the feature index](../FEATURES.md#project-inboxes).

## Agreed direction

- Every project's `.nightshift/inbox/` holds raw suggestions and reports relating to that project. Ownership follows the subject of the report: entries in `foo/.nightshift/inbox/` must concern foo, regardless of where they were observed.
- Reports about Nightshift itself continue to go to Nightshift's maintainer inbox, including reports raised while working in another project.
- `init-backlog` creates the project inbox.
- `ready` lists untriaged inbox reports separately from actionable backlog work. Inbox entries are holding material for triage, not ready tasks or implementation authority.
- Triage deletes a report once its disposition is durably recorded (as a backlog entry, or in a triage record, including an explicit skip), rather than keeping it in the inbox or moving it to a subfolder. Added by the user on 2026-09-24 after four already-triaged reports were found lingering in the maintainer inbox's `triaged/` subfolder.

## Settled questions

Agreed with the user on 2026-09-28, when the entry graduated from Exploring. None of this is implemented yet.

- **Version control.** Inboxes are to be ignored by default. Whoever creates an inbox, setup or an agent filing a report, is to create it with its own `.gitignore` containing `*`, the self-ignoring shape setup already uses for its recovery journal under `.nightshift/setup`. No rule is then written to the project's `.gitignore` or `.git/info/exclude`, so the inbox stays outside [Init-backlog ignore-shape election](init-backlog-ignore-shape-election.md). A project that wants tracked reports deletes that file, and setup is never to recreate it. Reports are raw and deleted at triage, so history gains nothing from tracking them, and a report filed from another session cannot dirty the working tree or be swept into a commit. The runtime already leaves `.nightshift/inbox` out of review inputs whether it is tracked or not, so a report filed during a review does not make the assessment stale.
- **Setup and existing projects.** `init-backlog` is to create the inbox when it is absent, on fresh setup, on existing projects and on reruns, and to leave an existing inbox's contents and its tracking and ignore policy unchanged. Migration from `.claude/inbox` already carries over its contents and whether they are tracked or ignored, but it restores an ignored inbox through a shared root `.gitignore` rule even when the original exclusion was clone-local, the open bug [Migration turns private exclusions into shared ignore rules](../bugs/migration-private-ignore-source.md). A project uses Nightshift when it has a `.nightshift` directory, and a project without one gets no inbox.
- **Report format.** One Markdown file per report, named `YYYY-MM-DD-<slug>.md` and never overwriting an existing file. A report is to record what was observed or suggested, where (project, operation and version when known) and the evidence, marking uncertainty and hypotheses, and to leave design and disposition to triage. The operating brief is to carry this guidance for Nightshift work, and the README is to document the format for users whose own instructions file reports from ordinary sessions. Nightshift is to inject no always-on session context for it.
- **Runs and follow-ups.** Observations about a run's own project stay follow-ups, as the operating brief already requires for mid-run ideas, and pending follow-ups are never moved into the inbox. An observation about another project goes to that project's inbox when it uses Nightshift and its location is known, and the run's report is to name each report filed; otherwise it becomes a follow-up. A run is not to triage reports that others file into its project's inbox while it runs, and closing triage covers only the run's follow-ups. Nightshift's own inbox is simply the Nightshift project's inbox, located through the maintainer's own instructions; recognizing a maintainer stays with [Retrospective routing by audience and instruction precedence](revise-lore-audience-routing.md).
- **Ready and triage.** Ready is to list untriaged reports by name in their own section and omit that section when the inbox is empty or absent, the current maintainer presentation extended to every project; files the inbox itself uses, such as its `.gitignore`, are not reports. Triage runs only at the user's request, one report at a time through the standard triage flow, and deletes each report once its disposition is durably recorded. Once this ships, the repository-only sentence in `AGENTS.md` asking Ready to list this repository's inbox is redundant and is to be removed.
- **Delivery.** It changes shipped code and instructions, so it needs a concise governing spec and a version increase. Deterministic tests are to cover setup (creation, existing inboxes, reruns and the reversed v3 assertion) and the listing (empty, absent and non-report files). Where reports are filed and their deletion at triage are model-owned behavior, so the spec is to decide between a budgeted installed-host check and deterministic evidence with those behaviors marked unverified.

## Before implementation

- Amend the v3 decision this reverses. [The v3 feature](nightshift-v3.md) says the ignored inbox is "a maintainer-only drop box in the Nightshift repository" and that setup "migrates an existing inbox but does not create one in other projects", and `tests/setup.test.js` asserts that fresh initialization creates no inbox and leaves `.nightshift/inbox/report.md` unignored. Sweep both for any other sentence or assertion stating the same fact before listing the amendment targets.
- Settle where the operating brief carries the report guidance and the Ready skill the listing and triage text, and whether the parser or the skill reads the inbox.
- Settle what setup does with an existing inbox that another tool created without the ignore file and with nothing tracked.
- Settle whether subfolders or files other than Markdown reports count as reports.
