# Nightshift review-system proposals

> **Transient migration vehicle.** This file is a holding area for proposals while they are being migrated into the `.claude/` backlog (see [`.claude/features/`](.claude/features/)). It is **not** an authoritative or durable home: every entry moves to a feature file (or into shipped code) and this file is deleted once the last entry migrates. As such, **no repository file should reference this document or its numbered entries**: a backward reference here would dangle once the file is gone. Migrated designs live in the backlog; cite those files instead.

> **Migration workflow.** Migrate proposals one at a time, in the suggested priority order (bottom of this file). For each selected proposal: present the design choices already made, one at a time, and confirm each before moving on; once the design is confirmed, write the feature spec at `.claude/features/<slug>.md` following the house shape (a `Feature:` first line, `## What it does`, a Status, Requirements with a `**Requires:**` line, and a Hardening section), add its index entry under the matching section of `.claude/FEATURES.md`, and remove the original proposal content from this file (renumbering this priority list). Do not implement anything in the migration session; this is backlog-only work. After the migration, dispatch a fresh-eyes review agent at max effort over the outgoing diff versus `origin/main` (including the uncommitted working tree), and commit on a clean verdict; on fixes, apply them and launch another review agent, repeating until clean. Pushing remains user-directed per the repository convention.

This document summarizes the proposals discussed for the Nightshift Claude Code and Codex plugin.

The main design goal is **high-confidence unattended operation**. Token efficiency matters only insofar as it does not materially reduce output quality or reliability.

# Additional hardening proposals

## 16. Move deterministic `init-backlog` work out of promptspace

`init-backlog` contains a large amount of authoritative template and mechanical scaffolding behavior.

Where there is one objectively correct result, prefer deterministic code/files over asking the model to reproduce it.

Candidates:
- static template bodies;
- directory creation;
- missing-file creation;
- unambiguous structural edits;
- hook merging where it can be done deterministically.

Leave Claude responsible for genuinely semantic decisions such as:
- whether customized existing prose already expresses a required concept;
- resolving ambiguous merges;
- deciding when user input is genuinely required.

General principle:

> **If there is one objectively correct answer, get it out of promptspace.**

## 18. Consider a durable handover execution ledger

For truly unattended operation, context loss is only one failure mode; process/session death can also interrupt work midway.

Longer term, persist more detailed handover execution state:
- current handover step;
- completed implementation tasks;
- associated commit SHA;
- verification/test status;
- checkpoints;
- outstanding follow-ups.

Then an interrupted implementation can resume from known durable state instead of heuristically inferring which tasks appear to have landed.

This is lower priority than the review redesign and core deterministic hardening.

## 22. Communicate for technically sophisticated, time-constrained users

Nightshift should assume the user is an accomplished engineer who owns the requirements but does not have time to absorb the project's code-level details. Communicate technical decisions at the behavioral, architectural, and risk level with full precision, without requiring source familiarity.

Resolve routine implementation mechanics from the approved spec, project knowledge, and code. Ask the user only when a decision materially affects requirements, scope, observable behavior, risk tolerance, cost, or reversibility. Provide code-level evidence when it is necessary to explain a concern or when the user requests it.

Do not confuse unfamiliarity with the codebase for lack of technical sophistication. Avoid both unexplained implementation detail and condescending simplification. The default communication should let an experienced engineer make the decisions that actually require their judgment without first reconstructing the project's internals.

# Suggested priority order

1. **Communicate for technically sophisticated, time-constrained users.**
2. **Move deterministic `init-backlog` mechanics out of prompts.**
3. **Add a durable handover execution ledger if interrupted unattended runs remain a practical problem.**
