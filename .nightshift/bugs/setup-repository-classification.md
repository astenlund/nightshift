# Fresh setup does not distinguish non-Git roots from broken Git metadata

## Current evidence

The independent fresh-non-git probe succeeded but wrote root and setup Git policy files. A malformed .git indirection also succeeded. The probes used GIT_CEILING_DIRECTORIES so the containing checkout could not be mistaken for the fixture repository.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Distinguish absent Git from failed or malformed repository discovery before applying Git policy. Preserve supported fresh non-Git initialization while keeping unusable Git metadata an explicit diagnosis.

## Verification and related work

Cover genuine non-Git roots, normal repositories, broken .git indirections, unavailable Git and enclosing repositories. Do not conflate this fresh-path classification gap with legacy non-Git migration.

See the separate [non-Git migration bug](setup-nongit-migration.md).

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Fresh setup does not distinguish non-Git roots from broken Git metadata](../reports/v3-migration-followups-20260920.md#fresh-setup-does-not-distinguish-non-git-roots-from-broken-git-metadata).

Tracking is not implementation authority.
