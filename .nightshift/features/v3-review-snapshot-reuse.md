---
name: v3-review-snapshot-reuse
description: Capture review content once within an operation
metadata:
  type: feature
status: exploring
---

# Capture review content once within an operation

Complete the retained operation-local snapshot reuse requirement while preserving freshness and exact reviewed bytes. Reuse captured source and identity for governing artifacts and review copies where valid, without introducing a persistent cache.

## Selected outcome

Shared content hashing is implemented, but the migration separately retained consistent reuse of captured bytes within one resolution or review preparation. A saved hash alone is not a reusable byte snapshot or proof that a later copy used those bytes.

## Evidence and limits

`dispatchReview` snapshots the context, separately snapshots specs, then copies files and checks freshness. These guards protect the current flow; they do not implement the proposed single captured-content reuse.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Measure redundant acquisition, settle bounded ownership of captured bytes and retain every required live freshness check. Verify mid-capture changes, large inputs, selected ignored artifacts and equal identities for the content actually delivered to the reviewer.



## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Reuse one resolution-local artifact snapshot across governing-set expansion](../reports/v3-migration-followups-20260920.md#reuse-one-resolution-local-artifact-snapshot-across-governing-set-expansion).

[The migration decision](../../V3-MIGRATION.md#stable-work-and-shared-mechanics) preserves the surviving requirement; earlier records: [content-fingerprint-helper](content-fingerprint-helper.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
