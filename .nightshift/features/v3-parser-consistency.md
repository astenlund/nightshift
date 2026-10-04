---
name: v3-parser-consistency
description: Complete shared backlog parsing and template consistency
metadata:
  type: feature
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

The migration accounting audit of 2026-09-29 found two parts of the retained need Unify cross-skill backlog parsing sources that this entry did not name. The backlog file vocabulary is still defined three times: `BACKLOG_FILES` in `internal/setup.js` and `internal/backlog-catalog.js`, and `INDEX_FILE_STEMS` in `skills/ready/ready.js`. Link targets share one catalog-target predicate, but the entry filters in front of it still differ without a recorded reconciliation: Ready rejects only http and https targets and then drive letters and dot segments, while the link notices in `internal/backlog-links.js` reject any URI scheme and normalize source-relative paths.

Coordinate with [overlapping-root collection](../bugs/overlapping-markdown-root-deduplication.md). The [invalid template instructions](../bugs/init-backlog-parser-invalid-empty-requires.md) were fixed in 3.2.9.

The [customized backlog repair feature](v3-setup-compatibility.md) owns the approved lettered-list compatibility behavior: compact simple flat lists into inline lettered items and preserve hierarchy around nested content. Its [FeatherPod incident](../reports/inbox-triage-20260921.md#unwrapping-collapses-lettered-workflow-steps) supplies the concrete case. Coordinate scanner recognition and ambiguity handling there; this cross-reference does not broaden the supported grammar by itself.

## Settled questions

The user agreed these answers on 2026-10-05, when the entry graduated from Exploring to current work. Checked the same day: the three file vocabularies above are still separate, `BACKLOG_FILES` in `internal/setup.js` and `internal/backlog-catalog.js` listing the same seven files in different orders, and Ready's `isRepoRelativeTarget` still rejects only `http` and `https` targets while `internal/backlog-links.js` rejects any URI scheme (`URI_SCHEME`).

- What happens to each remaining difference. Settled: each one, between Ready's top-level and slice continuation joining, unwrap's scanner and the shared catalog, first gets a fixture pinning its current behavior. Where consumers interpret the same syntax, it is unified; otherwise it stays, with its reason in one line at the narrowest code site. A difference that turns out to be a defect gets its own bug entry, so its fix stays traceable. No dependency meaning changes, and the existing grammar fixtures keep passing.
- The backlog file vocabulary. Settled: `BACKLOG_FILES` in `internal/backlog-catalog.js` becomes the only definition; setup imports it and Ready derives its index stems from it.
- The link-target filters. Settled: Ready and the link notices share one predicate, the stricter of the two, which rejects any URI scheme. Fixtures pin each target whose acceptance changes, which `isCatalogTarget` already refuses in most cases.
- Rescanning entry bodies. Settled: Ready parses each entry's metadata once, and every consumer reads that parse instead of scanning the body again.
- Relations. Settled: the entry requires nothing. It is best shipped before [Related field for non-dependency relations](related-field.md), [Restore controlled mixed-line-ending repair](v3-mixed-ending-repair.md) and [Ready silently ignores dependency lines on quick wins](../BUGS.md#ready-silently-ignores-dependency-lines-on-quick-wins), which change the same metadata and scanning, but that is ordering advice, not a dependency.

## Before implementation

The change alters shipped parser, catalog and setup code, so it rides with a plugin version increase. An agreed readback is enough, and deterministic fixtures are enough evidence, since no model-owned behavior changes. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Reuse parsed ready-entry metadata for Requires and Slices instead of rescanning entry bodies](../reports/v3-migration-followups-20260920.md#reuse-parsed-ready-entry-metadata-for-requires-and-slices-instead-of-rescanning-entry-bodies).
- [Unify cross-skill backlog parsing sources](../reports/v3-migration-followups-20260920.md#unify-cross-skill-backlog-parsing-sources).
- [Unify ready continuation joining after grammar fixtures](../reports/v3-migration-followups-20260920.md#unify-ready-continuation-joining-after-grammar-fixtures).
- [Decide remaining unwrap scanner parity](../reports/v3-migration-followups-20260920.md#decide-remaining-unwrap-scanner-parity).

[The migration decision](../../V3-MIGRATION.md#parser-consistency-and-template-maintenance) preserves the surviving requirement. Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
