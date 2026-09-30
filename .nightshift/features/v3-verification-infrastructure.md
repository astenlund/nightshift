---
name: v3-verification-infrastructure
description: Maintain verification evidence, fixtures and measured efficiency
metadata:
  type: feature
status: exploring
---

# Maintain verification evidence, fixtures and measured efficiency

Improve current verification tooling through explicit fixture ownership, safe evidence storage and measured reduction of unnecessary startup. Retire the 2.4.5 fixture only after reconciling supported upgrade checks.

## Selected outcome

The user selected current verification outcomes, not reconstruction of the removed controller harness. Preserve fixture custody through failure/cancellation and safe recovery of proven-owned inactive residue. Keep evidence storage and integrity separate from acceptance interpretation. Measure actual startup costs before optimizing.

## Evidence and limits

Current tests directly create v3 fixtures, and the old import/evaluator/registrar consumers were removed. The legacy 2.4.5 fixture still exists; the migration accounting audit of 2026-09-29 found that the ignored upgrade driver `.tmp/v3-upgrade-candidate.cjs` still loads it, so it is not unused. Existing live acceptance drivers are retained under ignored .tmp; their graduation remains a separate recorded decision.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

Run `f440497c-a0cc-4375-bada-e834e32b49a6` authenticated its live acceptance fixtures with a long-lived token the user created once with `claude setup-token`, supplied through `CLAUDE_CODE_OAUTH_TOKEN`, with no credential file in any fixture. Claude Code removes that variable from the environment of commands its tools start, so a Fable fallback reviewer dispatched inside a fixture could not authenticate, and [the acceptance report](../reports/independent-documentation-review-20260929.md) marks the Fable fallback path as not live-verified. At that run's triage on 2026-09-30 the user chose to track the open question here: how a fixture's nested Claude reviewer authenticates without a copied credential, so a future campaign can exercise the fallback. Its counterpart for credential copying on both hosts is the quick win [Codex acceptance fixtures copy the live credential](../QUICK_WINS.md#codex-acceptance-fixtures-copy-the-live-credential).

## Decisions and acceptance

Inventory current fixture and evidence ownership, candidate binding and startup costs. Verify safe cleanup, uncertain liveness, stale/partial evidence, reproducibility and supported update paths before removing obsolete fixtures. The user closed the old import-generator and registrar refactors as superseded.

The migration accounting audit of 2026-09-29 found agreed requirements this entry did not name, under [Test execution and fixture custody](../../V3-MIGRATION.md#test-execution-and-fixture-custody) and [Protocol and evidence boundaries](../../V3-MIGRATION.md#protocol-and-evidence-boundaries):

- "Distinguish buffered output from verified process failure or a hang." Nothing does so today.
- Clean fixtures after "supported cancellation, and preserve useful diagnostics when cleanup fails". A probe found no SIGINT or SIGTERM listener inside a `node --test` child, so an interrupted run skips its `t.after` cleanup. A failed cleanup leaves no durable record, and nothing reclaims owned residue after a forced termination.
- Host and release verification evidence storage. Nothing in shipped or tracked code stores or reads it with ownership, stable identity, bounded reads, exclusive writes, accurate status and binding to the examined candidate; the live acceptance tooling exists only as ignored scripts under `.tmp`, so this part is open rather than awaiting reconciliation.
- Removal of stale entry points after an upgrade is tracked by [Define and verify marketplace installation contents](v3-marketplace-surface.md).

Coordinate with the existing acceptance-evidence digest, bounded approval-wait and deep review-copy entries. Native transport structure and timer/buffer work have [their own outcome](v3-transport-maintenance.md), and measuring the lifecycle's defect detection is [a separate exploration](defect-detection-measurement.md).

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Retire the 2.4.5 legacy baseline together with its fidelity pin](../reports/v3-migration-followups-20260920.md#retire-the-245-legacy-baseline-together-with-its-fidelity-pin).
- [Reduce init-backlog controller-suite process startup](../reports/v3-migration-followups-20260920.md#reduce-init-backlog-controller-suite-process-startup).
- [Centralize controller-suite fixture cleanup](../reports/v3-migration-followups-20260920.md#centralize-controller-suite-fixture-cleanup).
- [Extract host-discovery evidence persistence](../reports/v3-migration-followups-20260920.md#extract-host-discovery-evidence-persistence).

[The migration decision](../../V3-MIGRATION.md#harness-verification-and-remaining-maintenance) preserves the surviving requirement. Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
