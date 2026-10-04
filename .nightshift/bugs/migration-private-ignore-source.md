# Migration turns private exclusions into shared ignore rules

## Current evidence

The audit private-ignore-source probe began with .git/info/exclude owning the legacy file exclusion. After migration the new destination was ignored by a root .gitignore rule. The ignored boolean survived, but its private storage choice did not.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Preserve the effective private/shared policy choice when relocating backlog content. Do not convert clone-local exclusions into shared repository rules merely to restore an ignored flag.

## Verification and related work

Cover local, shared and global sources, masking parent rules, tracked exceptions, interrupted relocation and reruns. Distinguish preservation of an existing choice from choosing a destination for new exclusions.

Since 2026-10-04 Nightshift ignores content only through self-ignoring folders, whose own `.gitignore` is never committed, and adds no rule to the project's `.gitignore` or `.git/info/exclude`, as [Restore fresh-scaffold track, ignore or defer choice](../features/setup-tracking-choice.md) records, so a fix can restore an ignored flag through a self-ignoring `.gitignore` beside the moved content rather than through any shared rule. The defect was linked to [Init-backlog ignore-shape election](../features/init-backlog-ignore-shape-election.md), retired that day; it remains a distinct acceptance obligation.

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Migration turns private exclusions into shared ignore rules](../reports/v3-migration-followups-20260920.md#migration-turns-private-exclusions-into-shared-ignore-rules).

Tracking is not implementation authority.
