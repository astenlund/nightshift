# Setup unwrap can lose existing backlog content after a partial write

## Current evidence

The independent actual init-backlog CLI probe injected ENOSPC during an unwrap write. An existing 115-byte backlog file became 6 bytes, no recovery copy remained, and a subsequent run succeeded with no ready entries, errors or notices. The path delegates through unwrapBacklog to stableRewriteFile, which truncates the only target before writing.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Resolution

Implemented locally in candidate 3.2.2 on 2026-09-21. Original-byte recovery, writer ownership, safe retry and incomplete-state diagnostics are covered by the [governing spec](../specs/recoverable-unwrap.md) and [acceptance report](../reports/recoverable-unwrap-20260921.md). The evidence above describes the original defect; broader setup recovery remains separate.

## Required outcome

Make supported mechanical repair recoverable after partial writes and prevent a truncated retry from being reported as a clean empty backlog. Preserve original bytes and owned recovery evidence through failure without overwriting unrelated user changes.

## Verification and related work

Exercise partial writes through the actual setup/unwrap entry, interruption at each durable write boundary, failed recovery and rerun. Verify preserved content and honest incomplete status; successful normal unwrap tests do not establish these paths.

[Recovery ownership](../features/v3-recovery-artifact-ownership.md) supplies related design work; mixed-ending restoration is a separate feature.

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Setup unwrap can lose existing backlog content after a partial write](../reports/v3-migration-followups-20260920.md#setup-unwrap-can-lose-existing-backlog-content-after-a-partial-write).

Tracking is not implementation authority.
