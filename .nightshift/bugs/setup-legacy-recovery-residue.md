# Setup does not diagnose actual pre-v3 recovery residue

## Current evidence

The audit legacy-recovery-residue probe left old root setup lock/election names and .tmp/revise-state.md unclassified while inspect and initialize returned normally. Its sentinels establish missing diagnosis, not a live old writer. The existing unfinished-run migration fixture constructs current SQLite state at a legacy path, not real pre-v3 state.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Identify relevant legacy recovery formats before dependent migration and define safe preservation, supported transition or explicit refusal. Never grant old records new write authority merely because their names are familiar.

## Verification and related work

Use real historical record shapes for missing, complete, interrupted, conflicting and potentially live-owner cases. Preserve evidence and require sound ownership before transition or cleanup; keep unverified historical state explicit.

Coordinate with [recovery artifact ownership](../features/v3-recovery-artifact-ownership.md).

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Setup does not diagnose actual pre-v3 recovery residue](../reports/v3-migration-followups-20260920.md#setup-does-not-diagnose-actual-pre-v3-recovery-residue).

Tracking is not implementation authority.
