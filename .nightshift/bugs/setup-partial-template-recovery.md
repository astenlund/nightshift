# Interrupted template creation is accepted as a complete existing file

## Current evidence

The audit partial-template probe injected a failed FEATURES.md write leaving only "# Feat". On retry initialize skipped the existing file, created the other targets and reported completion with no parser error or notice.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Recognize and recover owned incomplete template creation instead of accepting existence as completion. Preserve genuinely customized pre-existing content and refuse ambiguous ownership rather than overwriting it.

## Verification and related work

Cover partial creation, response loss, retry, changed partial output, genuine customized content and unavailable recovery evidence. Keep this new-file failure distinct from damage to an existing file during unwrap.

Coordinate with [recovery ownership](../features/v3-recovery-artifact-ownership.md) and the distinct [unwrap data-loss bug](setup-unwrap-partial-write-data-loss.md).

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Interrupted template creation is accepted as a complete existing file](../reports/v3-migration-followups-20260920.md#interrupted-template-creation-is-accepted-as-a-complete-existing-file).

Tracking is not implementation authority.
