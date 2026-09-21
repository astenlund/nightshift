---
name: v3-verification-infrastructure
description: Maintain verification evidence, fixtures and measured efficiency
metadata:
  type: feature
status: exploring
---

# Maintain verification evidence, fixtures and measured efficiency

Improve current verification tooling through explicit fixture ownership, safe evidence storage and measured reduction of unnecessary startup. Retire the unused 2.4.5 fixture only after reconciling supported upgrade checks.

## Selected outcome

The user selected current verification outcomes, not reconstruction of the removed controller harness. Preserve fixture custody through failure/cancellation and safe recovery of proven-owned inactive residue. Keep evidence storage and integrity separate from acceptance interpretation. Measure actual startup costs before optimizing.

## Evidence and limits

Current tests directly create v3 fixtures, and the old import/evaluator/registrar consumers were removed. The legacy 2.4.5 fixture still exists without current consumers found by the audit. Existing live acceptance drivers are retained under ignored .tmp; their graduation remains a separate recorded decision.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Inventory current fixture and evidence ownership, candidate binding and startup costs. Verify safe cleanup, uncertain liveness, stale/partial evidence, reproducibility and supported update paths before removing obsolete fixtures. The user closed the old import-generator and registrar refactors as superseded.

Coordinate with the existing acceptance-evidence digest, bounded approval-wait and deep review-copy entries. Native transport structure and timer/buffer work have [their own outcome](v3-transport-maintenance.md).

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Retire the 2.4.5 legacy baseline together with its fidelity pin](../reports/v3-migration-followups-20260920.md#retire-the-245-legacy-baseline-together-with-its-fidelity-pin).
- [Reduce init-backlog controller-suite process startup](../reports/v3-migration-followups-20260920.md#reduce-init-backlog-controller-suite-process-startup).
- [Centralize controller-suite fixture cleanup](../reports/v3-migration-followups-20260920.md#centralize-controller-suite-fixture-cleanup).
- [Extract host-discovery evidence persistence](../reports/v3-migration-followups-20260920.md#extract-host-discovery-evidence-persistence).

[The migration decision](../../V3-MIGRATION.md#harness-verification-and-remaining-maintenance) preserves the surviving requirement. Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
