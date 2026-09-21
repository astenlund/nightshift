---
name: v3-setup-compatibility
description: Restore customized backlog and legacy-guidance repair
metadata:
  type: feature
status: exploring
---

# Restore customized backlog and legacy-guidance repair

Restore scoped proposals and approved repairs for customized backlog content and legacy guidance. Preserve user content, identify ambiguity and keep the repair boundary explicit.

## Selected outcome

Earlier setup separated semantic repair proposals from approved publication. General structural repair and bulk legacy conversion were deliberately outside the reduced MVP; the user now wants this outcome tracked. Canonical instruction routing, mixed-ending normalization and non-Git migration have separate destinations.

## Evidence and limits

Current initialize skips existing targets before final parser validation and has no semantic repair proposal/apply flow. The independent audit distinguishes this missing capability from current-home inspection and recoverable-write defects.

The [FeatherPod lettered-workflow incident](../reports/inbox-triage-20260921.md#unwrapping-collapses-lettered-workflow-steps) records installed 3.2.1 joining indented a. through h. workflow steps into surrounding prose and a nested metadata bullet. Words survived but grouping became misleading; Ready reported no problems. The source used nonstandard Markdown list markers, so its classification as a supported-syntax defect remains unsettled. The original source commit and local repair are preserved in the report.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Choose the bounded repair inventory, exact proposal and approval boundary, interruption recovery and handling of ambiguous customized content. Verify preservation, deferred/unanswered decisions, repeat runs and invalid or incompatible catalogs.

The user selected this desired behavior during inbox triage: compact a simple flat lettered list such as a. foo, b. bar, c. baz into `a) foo, b) bar, c) baz`, preserving item boundaries; preserve hierarchy when items contain nested content. Do not flatten later workflow steps into a preceding metadata bullet. Settle recognition and ambiguity handling before implementation. Cover flat lists, nested metadata, ordinary prose that resembles a marker and repeated processing, coordinated with [shared parser consistency](v3-parser-consistency.md), without assuming every alphabetic marker is a list.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Restore customized backlog and legacy-guidance repair](../reports/v3-migration-followups-20260920.md#restore-customized-backlog-and-legacy-guidance-repair).

[The migration decision](../../V3-MIGRATION.md#initialization) preserves the surviving requirement; earlier records: [deterministic-init-backlog](deterministic-init-backlog.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
