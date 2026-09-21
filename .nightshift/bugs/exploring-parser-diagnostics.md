# Exploring and Ready omit explicit parser problem reporting requirements

## Current evidence

The shipped-feature audit found that Exploring no longer explicitly requires presentation of structuralErrors, notices and indexes.missing, or conditions its empty-draft message on a clean parse. Ready also lacks an explicit missing-index requirement. Parser data and existing visibility tests survive; current installed-host rendering of these branches was not tested.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

The [Ready migration-suggestion incident](../reports/inbox-triage-20260921.md#ready-omits-the-init-backlog-recovery-suggestion) records a separate observed response gap on Codex with installed 3.2.1. In disco-elysium-companion, the parser diagnosed a missing .nightshift backlog and explicitly named init-backlog, but the response only offered to investigate migration. The user invoked init-backlog and migration succeeded. This establishes the reported omission, not its cause in skill wording or behavior on the other host.

## Required outcome

Restore complete, truthful problem-channel reporting in the skill instructions while preserving complete draft visibility and the distinction between failed parsing, missing indexes and a genuinely empty set.

When Ready identifies a setup or migration prerequisite, name and offer the relevant skill, including init-backlog for the reported legacy-layout case. Preserve actionable recovery guidance already supplied by the parser rather than replacing it with an unspecified investigation offer.

## Verification and related work

Use appropriate installed-host evidence for parser failure, structural errors, notices, missing indexes and clean empty results on both hosts. The earlier Ready link-rendering campaign does not establish Exploring diagnostic behavior.

Include a valid legacy .claude backlog with no .nightshift directory and verify that the response names and offers init-backlog while reporting that Ready did not complete. Also verify that unrelated parser failures receive their actual recovery guidance rather than an invented migration diagnosis.

Coordinate with the existing [Exploring link-guidance quick win](../QUICK_WINS.md#align-exploring-source-link-guidance-with-ready), without treating it as coverage of diagnostic branches.

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Exploring and Ready omit explicit parser problem reporting requirements](../reports/v3-migration-followups-20260920.md#exploring-and-ready-omit-explicit-parser-problem-reporting-requirements).

Tracking is not implementation authority.
