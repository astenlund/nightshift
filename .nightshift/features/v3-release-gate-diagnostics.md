---
name: v3-release-gate-diagnostics
description: Complete release-gate history diagnostics and checkout verification
metadata:
  type: feature
status: exploring
---

# Complete release-gate history diagnostics and checkout verification

Finish the retained release-gate follow-ups for stale-branch versus genuine version decreases and robust verification of required checkout depth. Preserve current release policy and avoid reviving obsolete assertion shapes.

## Selected outcome

The non-ASCII Git path issue now has a NUL-delimited reader and a real-Git regression. The other two retained outcomes still need explicit accounting: an accurate history-based diagnosis and a checkout/depth check that tolerates benign action-version or input-order edits.

## Evidence and limits

`tools/release-gate.js` compares baseline and HEAD versions and emits a generic decrease message. CI currently has fetch-depth: 0, but current package tests do not check that requirement. The old brittle release-surface test was removed rather than repaired.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Settle exact history semantics before changing diagnostics or pass/fail policy. Verify stale branches, later genuine decreases and absent depth/checkout against benign workflow edits. Preserve the existing unusual-path regression.



## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Let the fetch-depth pin fail honestly on a benign checkout edit](../reports/v3-migration-followups-20260920.md#let-the-fetch-depth-pin-fail-honestly-on-a-benign-checkout-edit).
- [Name the stale-branch case in the version gate's decrease message](../reports/v3-migration-followups-20260920.md#name-the-stale-branch-case-in-the-version-gates-decrease-message).

[The migration decision](../../V3-MIGRATION.md#release-gate-accuracy) preserves the surviving requirement. Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
