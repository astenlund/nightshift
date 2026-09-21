---
name: v3-filesystem-metadata
description: Define and preserve consequential filesystem metadata
metadata:
  type: feature
status: exploring
---

# Define and preserve consequential filesystem metadata

Complete the retained preservation contract for metadata beyond bytes and meaningful modes across supported writes and recovery. Establish which Windows properties matter and verify preservation or explicit limitations.

## Selected outcome

The migration kept this feature without settling its metadata inventory. Define required properties, capture and refresh rules, partial outcomes and recovery. Existing content hashes and Git mode preservation do not prove ACL, attribute or other metadata preservation.

## Evidence and limits

`internal/filesystem-primitives.js` records portable mode and physical identity for selected operations; `Setup.apply` copies and removes migration files. Neither is a complete declared Windows metadata contract.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Settle the consequential property set for supported filesystems and operations. Verify success, failure between content and metadata writes, unsupported properties and stale evidence. Avoid promises about every filesystem attribute.



## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Filesystem metadata preservation](../reports/v3-migration-followups-20260920.md#filesystem-metadata-preservation).

[The migration decision](../../V3-MIGRATION.md#preservation-and-recovery-authority) preserves the surviving requirement; earlier records: [filesystem-metadata-preservation](filesystem-metadata-preservation.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
