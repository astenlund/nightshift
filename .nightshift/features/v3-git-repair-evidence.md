---
name: v3-git-repair-evidence
description: Verify repair-commit and autosquash safety in ordinary delivery
metadata:
  type: feature
status: exploring
---

# Verify repair-commit and autosquash safety in ordinary delivery

Complete the retained reliable repair-commit outcome using ordinary Git and project policy: establish ownership and the current safe fixup target, preserve unrelated work, honor hooks and verify the intended autosquash.

## Selected outcome

The elaborate transaction engine and routine checkpoint autosquash remain retired. V3 relies on controller judgment and applicable Git conventions; the retained requirement still calls for concrete Git evidence and safe recovery when a fixup cannot be applied reliably.

## Evidence and limits

`internal/workflow.md` delegates coherent commits and publication to project policy. The runtime records publication authority but exposes no repair-commit validation operation. No shipped instruction or check covers repair commits, as described below; closing that gap is not a requirement to build the old transaction engine.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Establish the minimal shared checks and actual remaining failure cases. Verify blame-based targeting, intervening edits, hook failure, authorized autosquash and interrupted operations using isolated repositories; never infer rewrite or publication authority from a review checkpoint.

The migration accounting audit of 2026-09-29 found that this is missing instruction as well as missing evidence: [the operating brief](../../internal/workflow.md) says only "Commit coherent local work under the user's Git policy and required hooks", and no instruction or check a run loads mentions fixups, autosquash, a follow-up commit or history rewriting. The agreed disposition under [Repair commits and history rewriting](../../V3-MIGRATION.md#repair-commits-and-history-rewriting) also retains two rules this entry did not name: where fixup form is unsafe, "use an ordinary follow-up commit only when policy and current state permit it; otherwise preserve the repair and report the affected blocker while continuing independent work", and "Do not defer accepted repairs merely for tidier history."

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Verified fixup transactions: MVP - verified fixup creation](../reports/v3-migration-followups-20260920.md#verified-fixup-transactions-mvp---verified-fixup-creation).

[The migration decision](../../V3-MIGRATION.md#repair-commits-and-history-rewriting) preserves the surviving requirement; earlier records: [verified-fixup-transactions](verified-fixup-transactions.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
