---
name: setup-tracking-choice
description: Restore the fresh-scaffold track, ignore or defer election
metadata:
  type: feature
status: exploring
---

# Restore fresh-scaffold track, ignore or defer choice

Restore the fresh-project setup choice to track the backlog in Git, ignore it, or defer the decision. Preserve existing tracking and ignore policy on reruns. This restores a previously shipped setup capability; choosing shared versus clone-local exclusions is tracked separately in [Init-backlog ignore-shape election](init-backlog-ignore-shape-election.md).

## Outcome

When setup introduces a backlog whose Git policy is not already settled, explain the consequences and let the user choose tracking, exclusion or deferral. Apply only that choice, preserve unrelated rules and files, and recognize the established choice on a later run. An unanswered or deferred decision must not silently become permission to track or ignore content.

## Current evidence and provenance

The shipped [deterministic setup design](deterministic-init-backlog.md) included this election. Current [Setup.preservePolicies](../../internal/setup.js) preserves migration visibility and writes run exclusions but exposes no fresh-scaffold election. V3's reduced setup preserved existing choices without restoring this user-facing capability.

The user chose to track restoration on 2026-09-20 during [migration triage](../reports/v3-migration-followups-20260920.md#restore-fresh-scaffold-track-ignore-or-defer-choice). Tracking is not implementation authority. The [completed independent audit](../reports/pre-v3-shipped-capability-audit-20260921.md) supplies the current evidence and limits.

## Decisions before implementation

Settle the exact backlog paths covered, how existing mixed tracking states are presented, what applying track means for the Git index, and how a deferred choice is recognized on a later invocation. Preserve existing explicit policy and distinguish an unreadable Git state from an absent choice. Legacy non-Git migration and repository classification have separate bug entries; shared versus clone-local exclusion destinations are covered by the linked feature.

Verify fresh setup for each decision, refusal to infer an unanswered choice, idempotent reruns, pre-existing tracked or ignored content, failed Git probes and interrupted application. Preserve the existing protection of run records and any deliberate tracking exceptions.

## Applied migration triage

Treat missing and empty ignore targets as normal election cases, preserving conventions and safe reruns. The independent audit found fresh non-Git setup succeeds; its legacy migration and repository-classification defects have separate bug entries.

- [Ignore election cannot initialize a missing .gitignore](../reports/v3-migration-followups-20260920.md#ignore-election-cannot-initialize-a-missing-gitignore), whose original diagnosis is [the v2 bug record](../bugs/ignore-election-missing-gitignore.md).
- [Restore fresh-scaffold track, ignore or defer choice](../reports/v3-migration-followups-20260920.md#restore-fresh-scaffold-track-ignore-or-defer-choice).
