---
name: v3-mixed-ending-repair
description: Restore controlled mixed-line-ending repair
metadata:
  type: feature
status: exploring
---

# Restore controlled mixed-line-ending repair

Restore inspected normalization of mixed LF/CRLF endings on the controlled backlog surface, using the effective project convention and preserving recoverability.

## Selected outcome

This previously shipped capability is absent from reduced setup. Restore a concrete repair proposal, compose it safely with optional hard-wrap repair, and ask only when the newline choice is genuinely unresolved. Existing-file normalization and new-template materialization are different behaviors.

## Evidence and limits

The audit mixed-endings probe leaves mixed bytes unchanged even with unwrap enabled, with no parser error or notice. The historical bug record describes the earlier approved mechanical repair and byte-exact backups.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Settle the controlled target set, convention precedence and ambiguity handling. Verify BOM and byte preservation outside intended newline edits, hard-wrap composition, interruptions and idempotence. Keep invalid encodings and unrelated files outside silent normalization.

Dependable write/recovery behavior is tracked in the [unwrap data-loss bug](../bugs/setup-unwrap-partial-write-data-loss.md). [New-file newline policy](../bugs/setup-template-newline-policy.md) remains a distinct bug.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Restore controlled mixed-line-ending repair](../reports/v3-migration-followups-20260920.md#restore-controlled-mixed-line-ending-repair).

[The migration decision](../../V3-MIGRATION.md#initialization) preserves the surviving requirement; earlier records: [deterministic-init-backlog](deterministic-init-backlog.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
