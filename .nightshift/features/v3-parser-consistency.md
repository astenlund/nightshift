---
name: v3-parser-consistency
description: Complete shared backlog parsing and template consistency
metadata:
  type: feature
status: exploring
---

# Complete shared backlog parsing and template consistency

Complete shared dependency metadata and continuation handling across Ready, setup and unwrap, preserving justified grammar differences and protected content.

## Selected outcome

Shared catalog and Markdown modules already exist. Reuse parsed entry metadata, characterize top-level and slice continuations, and reconcile scanner differences only where consumers interpret the same syntax. The reproduced overlapping-root and invalid-template defects have separate bug entries.

## Evidence and limits

Ready retains distinct top-level and slice continuation paths and shares only part of its scanning with backlog-catalog. Existing grammar fixtures provide a baseline, not proof that every consolidation has landed. The audit confirms substantial parser behavior remains supported.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Characterize each remaining difference before changing it. Verify malformed and duplicate labels, indentation, fences, raw HTML, protected blocks, idempotence and unchanged dependency meaning. Keep actual defect fixes traceable to their linked bug records.

Coordinate with [overlapping-root collection](../bugs/overlapping-markdown-root-deduplication.md). The [invalid template instructions](../bugs/init-backlog-parser-invalid-empty-requires.md) were fixed in 3.2.9.

The [customized backlog repair feature](v3-setup-compatibility.md) owns the approved lettered-list compatibility behavior: compact simple flat lists into inline lettered items and preserve hierarchy around nested content. Its [FeatherPod incident](../reports/inbox-triage-20260921.md#unwrapping-collapses-lettered-workflow-steps) supplies the concrete case. Coordinate scanner recognition and ambiguity handling there; this cross-reference does not broaden the supported grammar by itself.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Reuse parsed ready-entry metadata for Requires and Slices instead of rescanning entry bodies](../reports/v3-migration-followups-20260920.md#reuse-parsed-ready-entry-metadata-for-requires-and-slices-instead-of-rescanning-entry-bodies).
- [Unify cross-skill backlog parsing sources](../reports/v3-migration-followups-20260920.md#unify-cross-skill-backlog-parsing-sources).
- [Unify ready continuation joining after grammar fixtures](../reports/v3-migration-followups-20260920.md#unify-ready-continuation-joining-after-grammar-fixtures).
- [Decide remaining unwrap scanner parity](../reports/v3-migration-followups-20260920.md#decide-remaining-unwrap-scanner-parity).

[The migration decision](../../V3-MIGRATION.md#parser-consistency-and-template-maintenance) preserves the surviving requirement. Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
