---
name: v3-recovery-artifact-ownership
description: Bind setup recovery to physical artifact ownership
metadata:
  type: feature
status: exploring
---

# Bind setup recovery to physical artifact ownership

Complete physical artifact ownership and no-overwrite recovery for supported setup operations, including safe recognition of owned partial creation. Carry clear write stages, cleanup ownership and separate validation into the recovery repairs.

## Selected outcome

The user selected physical identity and safe destination binding, with filesystem responsibility, publication-stage clarity and recovery validation as constraints on restoration rather than standalone refactors. Establish ownership before changing or deleting managed objects; do not adopt an unrelated destination merely because its bytes match.

## Evidence and limits

Current migration recovery checks existence and hashes, uses exclusive copying and preserves tested staged/working distinctions. The audit confirms some link and substitution guards while leaving full journal and artifact ownership unverified. The separate [unwrap data-loss repair](../reports/recoverable-unwrap-20260921.md) now supplies bounded recovery for mechanical unwrap; partial-template data loss and the broader migration ownership contract remain unfinished.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Inventory actual artifacts and durable crash states, choose physical identity evidence, and keep validation distinct from its owning mutation. Verify partial creation, same-byte substitution, aliases, stale state, failure and deterministic retry. Preserve unrelated files and existing recovery evidence.

Preserve the delivered [unwrap recovery boundary](../specs/recoverable-unwrap.md) while addressing the separate [partial-template recovery](../bugs/setup-partial-template-recovery.md) and [legacy-residue diagnosis](../bugs/setup-legacy-recovery-residue.md) obligations. No old transaction schema is mandated.

## Added at the section-level audit's triage

[The section-level audit of v2 records](../reports/v2-section-audit-20261004.md) found that v2's [deterministic init-backlog](deterministic-init-backlog.md) shipped the rule "Only one apply or mutating recovery owns a repository root at a time", under which a live or indeterminate owner blocked mutation and stale ownership was cleared only through evidence-first recovery. v3 setup itself has no setup-level owner: `assertQuiescent` in `internal/setup.js` refuses unless the project's current run is stopped, paused or complete with no active worker, and `apply` locks only unwrap lock files that already exist. Setup started through the installed launcher is serialized one level up: `ReleaseService.run` in `internal/releases/service.js` refuses every project operation that is not read-only, setup included, with `resource-operation-busy` while another operation on the same project is active or its termination is uncertain. The uncovered case is therefore setup reached outside that launcher, such as a direct call of the setup script. [The 2026-09-21 audit](../reports/pre-v3-shipped-capability-audit-20260921.md) noted "no exhaustive current proof for setup concurrent-owner exclusion" without routing a follow-up. The user chose on 2026-10-04 to fold it in here: one setup operation owns a project at a time, and a live or uncertain owner blocks mutation. The work starts with a probe of what remains uncovered, such as whether a direct second setup fails on the exclusive writes or resumes the first one's migration, so that it adds nothing the launcher's serialization already provides.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Decompose init-backlog filesystem services](../reports/v3-migration-followups-20260920.md#decompose-init-backlog-filesystem-services).
- [Decompose publication apply phases](../reports/v3-migration-followups-20260920.md#decompose-publication-apply-phases).
- [Modularize recovery validation and execution](../reports/v3-migration-followups-20260920.md#modularize-recovery-validation-and-execution).
- [Recovery artifact physical identity](../reports/v3-migration-followups-20260920.md#recovery-artifact-physical-identity).
- [No-replace action destination binding](../reports/v3-migration-followups-20260920.md#no-replace-action-destination-binding).

[The migration decision](../../V3-MIGRATION.md#preservation-and-recovery-authority) preserves the surviving requirement; earlier records: [recovery-artifact-physical-identity](recovery-artifact-physical-identity.md), [no-replace-action-destination-binding](no-replace-action-destination-binding.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
