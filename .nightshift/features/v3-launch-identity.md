---
name: v3-launch-identity
description: Complete executable identity assurance for Windows launches
metadata:
  type: feature
status: exploring
---

# Complete executable identity assurance for Windows launches

Reconcile retained launch roles with the selected executable identity and trust boundary, including replacement and path retargeting between discovery and launch. Verify the boundary rather than inferring it from a resolved path.

## Selected outcome

The retained requirement allows legitimate re-resolution and updates but requires missing identity proof to block the affected launch. Cover runtime hosts, their PowerShell runner, setup Git and retained-release administration according to their actual trust policy.

## Evidence and limits

`resolveTrustedExecutable` performs two identity checks while resolving; runtime and release host launchers use it. `internal/setup.js` invokes Git by name. This establishes partial mechanisms, not one verified launch-time contract across every role or closure of all races.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

The local 3.3.9 repair recognizes verified Windows Codex standalone packages for profile-scoped retained-release administration, as [its acceptance report](../reports/codex-standalone-trust-20261006.md) records. It checks canonical package metadata and a valid OpenAI Authenticode signature, preserving project exclusions and ordinary concurrent-change detection. This closes the standalone profile-resolution refusal, not the broader atomic signature-to-launch identity requirement tracked here.

## Decisions and acceptance

Choose the per-role contract and document residual race limits. Verify retargeting, replacement, permitted updates and unavailable proof on the supported Windows host without treating a last-moment path check as atomic launch binding.

The migration accounting audit of 2026-09-29 found a launch role this entry did not name: the runtime's own Git launches, which run `git` by bare name with no identity check, in `internal/runtime/evidence.js` (repository detection, blob hashing and the file inventory), `internal/runtime/review.js` (the cumulative diff and new-file diffs) and `internal/runtime/probes.js` (initializing and checking a probe copy). The per-role contract needs to cover them as well as setup Git.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Executable identity revalidation for Windows launches](../reports/v3-migration-followups-20260920.md#executable-identity-revalidation-for-windows-launches).

[The migration decision](../../V3-MIGRATION.md#launches-and-discovery) preserves the surviving requirement; earlier records: [executable-identity-revalidation](executable-identity-revalidation.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
