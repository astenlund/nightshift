---
name: setup-tracking-choice
description: Restore the fresh-scaffold track, ignore or defer election
metadata:
  type: feature
---

# Restore fresh-scaffold track, ignore or defer choice

Restore the fresh-project setup choice to track the backlog in Git, ignore it, or defer the decision. Preserve existing tracking and ignore policy on reruns. This restores a previously shipped setup capability; choosing shared versus clone-local exclusions is tracked separately in [Init-backlog ignore-shape election](init-backlog-ignore-shape-election.md).

## Outcome

When setup introduces a backlog whose Git policy is not already settled, explain the consequences and let the user choose tracking, exclusion or deferral. Apply only that choice, preserve unrelated rules and files, and recognize the established choice on a later run. An unanswered or deferred decision must not silently become permission to track or ignore content. The project inbox gets the same choice as a separate question.

## Current evidence and provenance

The shipped [deterministic setup design](deterministic-init-backlog.md) included this election. Current [Setup.preservePolicies](../../internal/setup.js) preserves migration visibility and writes run exclusions but exposes no fresh-scaffold election. V3's reduced setup preserved existing choices without restoring this user-facing capability.

The user chose to track restoration on 2026-09-20 during [migration triage](../reports/v3-migration-followups-20260920.md#restore-fresh-scaffold-track-ignore-or-defer-choice). Tracking is not implementation authority. The [completed independent audit](../reports/pre-v3-shipped-capability-audit-20260921.md) supplies the current evidence and limits.

## Settled questions

The user agreed these answers on 2026-10-04, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day in `internal/setup.js`: fresh setup creates the seven top-level backlog files and the `features`, `bugs`, `patterns` and `runs` directories, adds `/.nightshift/runs/` to the project's `.gitignore` through `preservePolicies`, and leaves the rest neither tracked nor ignored, while migration already updates the Git index when it relocates tracked files (`relocateIndex`). Legacy non-Git migration and repository classification keep their separate bug entries, and shared versus clone-local exclusion destinations stay with the linked feature.

- The exact backlog paths covered. Settled: one choice covers the backlog under `.nightshift/`, meaning the seven top-level backlog files and the `features/`, `bugs/`, `patterns/`, `specs/` and `reports/` folders. Run records, setup's journal and plans keep their current handling, and the inbox gets its own question, below.
- When the choice is asked, and how existing mixed tracking states are presented. Settled: setup asks only while the backlog is undecided, meaning no backlog file is tracked and no ignore rule covers it, whether the folder is new or holds files left undecided earlier. When any of it is tracked or ignored, that is the project's choice: setup reports it and does not ask. A mixed state is reported part by part as tracked or ignored, naming each ignore rule's source file and line, and setup changes nothing.
- What applying track means for the Git index. Settled: track stages the backlog files with one `git add` and never commits; the staged files show the choice to later runs. Ignore adds rules to the project's `.gitignore`, creating the file when it is missing, that ignore the backlog without hiding the inbox from its own answer, since Git cannot re-include a file inside an ignored directory. Choosing `.git/info/exclude` instead belongs to [Init-backlog ignore-shape election](init-backlog-ignore-shape-election.md), which extends this choice.
- How a deferred choice is recognized on a later invocation. Settled: defer writes nothing, so the backlog reads as undecided and the next setup run asks again; no marker file is kept, since the Git state itself shows the choice. An unanswered or declined question, or a handed-over run with no user present, counts as defer, and the report says the choice is still open.
- How an unreadable Git state is told apart from an absent choice. Settled: a folder that is not a Git repository gets no question. When a Git check fails or the Git metadata is broken, setup writes nothing for this choice and reports the failure; telling those two apart stays with [Fresh setup does not distinguish non-Git roots from broken Git metadata](../BUGS.md#fresh-setup-does-not-distinguish-non-git-roots-from-broken-git-metadata).
- The inbox. Settled: the inbox gets its own track, ignore or defer question in the same setup run, applied independently of the backlog's answer. Its own `.gitignore` records the answer, since Git cannot track an empty folder: ignore writes one containing `*`, the shape [Project inboxes](project-inboxes.md) agreed; track writes one holding only a comment and stages it; defer writes nothing. Setup reads the choice from that file's content, or from tracked reports or an ignore rule from elsewhere already covering the inbox, and otherwise treats the inbox as undecided and asks; a migrated inbox keeps the tracking it had. As for the backlog, no answer counts as defer, so until someone answers, reports show as untracked files, and an agent that creates an inbox to file a report likewise writes no `.gitignore`. This replaces the ignored-by-default decision of Project inboxes, whose record is amended to point here. The user asked for the separate question at graduation and chose the defer default over keeping inboxes ignored without an answer.
- Line endings of a new `.gitignore`. Settled: a new `.gitignore`, the project's or the inbox's, follows the same newline rule as new templates, which [New setup templates ignore effective project newline policy](../BUGS.md#new-setup-templates-ignore-effective-project-newline-policy) is to settle, one rule built by whichever ships first. When the line ending cannot be determined, nothing is written. This carries the missing and empty `.gitignore` cases that the 2026-09-20 triage folded into this entry.
- Interrupted application. Settled: the backlog's answer is a single index update or a single ignore-file write, so a rerun finds it either applied or still undecided and asks again in the second case. The inbox's choice is read from its `.gitignore` content, so a rerun finishes an interrupted track by staging that file.

## Before implementation

Settle the exact ignore rules, the two questions' wording and the report of an existing or mixed state in a concise governing spec in `.nightshift/specs`. The change alters setup, the init-backlog skill's questions and the setup fixtures, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check of the questions the skill asks and deterministic evidence only. The staged files and written rules belong in the change list that [Show setup's change list before applying it](../QUICK_WINS.md#show-setups-change-list-before-applying-it) adds. Until [Project inboxes](project-inboxes.md) ships, setup creates no inbox in other projects, so the inbox question applies to inboxes that already exist.

Verify fresh setup for each answer to each question and for no answer, refusal to infer an unanswered choice, idempotent reruns, pre-existing tracked, ignored and mixed content, failed Git probes and interrupted application, and that the backlog's ignore rules leave the inbox to its own answer. Preserve the existing protection of run records and any deliberate tracking exceptions. Tracking and readiness do not authorize implementation.

## Applied migration triage

Treat missing and empty ignore targets as normal election cases, preserving conventions and safe reruns. The independent audit found fresh non-Git setup succeeds; its legacy migration and repository-classification defects have separate bug entries.

- [Ignore election cannot initialize a missing .gitignore](../reports/v3-migration-followups-20260920.md#ignore-election-cannot-initialize-a-missing-gitignore), whose original diagnosis is [the v2 bug record](../bugs/ignore-election-missing-gitignore.md).
- [Restore fresh-scaffold track, ignore or defer choice](../reports/v3-migration-followups-20260920.md#restore-fresh-scaffold-track-ignore-or-defer-choice).
