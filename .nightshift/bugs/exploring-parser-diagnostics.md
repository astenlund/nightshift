# Exploring and Ready omit explicit parser problem reporting requirements

## Current evidence

The shipped-feature audit found that Exploring no longer explicitly requires presentation of structuralErrors, notices and indexes.missing, or conditions its empty-draft message on a clean parse. Ready also lacks an explicit missing-index requirement. Parser data and existing visibility tests survive; current installed-host rendering of these branches was not tested.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Restore complete, truthful problem-channel reporting in the skill instructions while preserving complete draft visibility and the distinction between failed parsing, missing indexes and a genuinely empty set.

## Verification and related work

Use appropriate installed-host evidence for parser failure, structural errors, notices, missing indexes and clean empty results on both hosts. The earlier Ready link-rendering campaign does not establish Exploring diagnostic behavior.

Coordinate with the existing [Exploring link-guidance quick win](../QUICK_WINS.md#align-exploring-source-link-guidance-with-ready), without treating it as coverage of diagnostic branches.

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Exploring and Ready omit explicit parser problem reporting requirements](../reports/v3-migration-followups-20260920.md#exploring-and-ready-omit-explicit-parser-problem-reporting-requirements).

Tracking is not implementation authority.
