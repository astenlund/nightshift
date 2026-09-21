---
name: v3-marketplace-surface
description: Define and verify marketplace installation contents
metadata:
  type: feature
status: exploring
---

# Define and verify marketplace installation contents

Finish the retained installed-package boundary: required runtime resources and intentional user documentation, with repository-maintenance material excluded where the host permits it. Distinguish marketplace caches from retained execution bundles.

## Selected outcome

Retained release manifests now define an exact runtime bundle, but that does not by itself restrict what each marketplace initially installs. Preserve all runtime dependencies and supported discovery while deciding the user-facing installation surface.

## Evidence and limits

`internal/releases/manifest.js` and `payload.json` validate retained payloads, and package tests check their dependencies. The plugin manifests point at skills and hooks; a current clean marketplace-content comparison is still needed before claiming the earlier packaging concern resolved.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Choose inclusion/exclusion mechanisms supported by each marketplace and the documentation policy. Verify clean installation and update contents on both hosts, including resource resolution and removal of stale public entry points.



## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Marketplace installation surface](../reports/v3-migration-followups-20260920.md#marketplace-installation-surface).

[The migration decision](../../V3-MIGRATION.md#installation-and-existing-host-issues) preserves the surviving requirement; earlier records: [marketplace-installation-surface](marketplace-installation-surface.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
