# Nightshift review-system proposals

> **Transient migration vehicle.** This file is a holding area for proposals while they are being migrated into the `.claude/` backlog (see [`.claude/features/`](.claude/features/)). It is **not** an authoritative or durable home: every entry moves to a feature file (or into shipped code) and this file is deleted once the last entry migrates. As such, **no repository file should reference this document or its numbered entries**: a backward reference here would dangle once the file is gone. Migrated designs live in the backlog; cite those files instead.

> **Migration workflow.** Migrate proposals one at a time, in the suggested priority order (bottom of this file). For each selected proposal: present the design choices already made, one at a time, and confirm each before moving on; once the design is confirmed, write the feature spec at `.claude/features/<slug>.md` following the house shape (a `Feature:` first line, `## What it does`, a Status, Requirements with a `**Requires:**` line, and a Hardening section), add its index entry under the matching section of `.claude/FEATURES.md`, and remove the original proposal content from this file (renumbering this priority list). Do not implement anything in the migration session; this is backlog-only work. After the migration, dispatch a fresh-eyes review agent at max effort over the outgoing diff versus `origin/main` (including the uncommitted working tree), and commit on a clean verdict; on fixes, apply them and launch another review agent, repeating until clean. Pushing remains user-directed per the repository convention.

This document summarizes the proposals discussed for the Nightshift Claude Code and Codex plugin.

The main design goal is **high-confidence unattended operation**. Token efficiency matters only insofar as it does not materially reduce output quality or reliability.

# Additional hardening proposals

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

# Suggested priority order

1. **Add a durable handover execution ledger if interrupted unattended runs remain a practical problem.**
