# Setup inspection omits current backlog completeness

## Current evidence

The audit existing-current-inspection probe used malformed .nightshift/FEATURES.md. Inspect returned backlog:null because no legacy files would move; apply later rejected it after creating other missing files. Current-home missing targets and repair opportunities are not part of the migration-only inspection result.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Inspect the current supported scaffold and expose its completeness and parser problems before apply. Keep observed project facts separate from repair proposals and make the reduced meaning of migration status explicit.

## Verification and related work

Cover fresh, partial and existing current-home catalogs, malformed entries, missing targets, no legacy inventory and failed probes. Validate current state before dependent writes; do not treat creation of owned inspection recovery storage as inherently a product defect.

Coordinate with [instruction routing](../features/v3-guidance-routing.md) and [scoped repair](../features/v3-setup-compatibility.md).

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Setup inspection omits current backlog completeness](../reports/v3-migration-followups-20260920.md#setup-inspection-omits-current-backlog-completeness).

Tracking is not implementation authority.
