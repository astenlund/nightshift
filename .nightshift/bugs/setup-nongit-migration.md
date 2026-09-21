# Legacy backlog migration fails in non-Git projects

## Current evidence

The independent legacy-non-git probe failed with git-failed when a valid legacy FEATURES.md was present; the source remained unchanged. Fresh non-Git initialization succeeds, correcting the earlier blanket missing-support claim.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Support safe legacy backlog migration without a Git repository, preserving content and references without requiring Git index or ignore operations. The user explicitly narrowed restoration to this migration gap.

## Verification and related work

Cover fresh and existing non-Git roots, migration conflicts, interrupted relocation and byte preservation. Repository detection and unnecessary policy-file writes are separate tracked behavior.

Coordinate with [repository classification](setup-repository-classification.md); do not describe fresh non-Git setup as unavailable.

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Restore setup in non-Git projects](../reports/v3-migration-followups-20260920.md#restore-setup-in-non-git-projects).

Tracking is not implementation authority.
