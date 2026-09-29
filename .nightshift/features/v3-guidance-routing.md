---
name: v3-guidance-routing
description: Restore setup guidance discovery and instruction routing
metadata:
  type: feature
status: exploring
---

# Restore setup guidance discovery and instruction routing

Restore canonical instruction-source discovery and approved backlog guidance updates on both hosts, with bounded traversal and explicit handling of conflicting or missing sources. The v3 setup currently relocates files and scaffolds indexes but does not expose the earlier guidance-resolution flow.

## Selected outcome

The shipped deterministic setup supported canonical guidance ownership, including Claude import adapters and Codex effective instruction names. The migration retained this need while removing the old controller. Establish the actual durable source, preserve adapters and independent instructions, and present proposed changes in user terms. Bound discovery without silently omitting applicable guidance.

## Evidence and limits

`internal/setup.js` implements migration inventory, references and index templates; `excludedReference` excludes root instruction files from automatic rewriting. `skills/init-backlog/SKILL.md` reserves changes beyond mechanical authorized references for separately assessed proposals. The unconditional code exclusion therefore also omits mechanical root references. This is a missing supported setup flow, not authority to overwrite guidance.

The [FeatherPod migration incident](../reports/inbox-triage-20260921.md#migration-leaves-root-backlog-references-unchanged) supplies a concrete case: installed 3.2.1 moved 42 backlog files and reported completion while ordinary tracked AGENTS.md still named the old indexes, histories and record directories; CLAUDE.md imported AGENTS.md. The source report records a later manual repair and no backlog content loss. Current code confirms the unconditional exclusion; the original invocation was not replayed during triage.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Settle the supported discovery inputs and traversal limits, conflict handling and proposal/application boundary. Verify imports, custom instruction names, missing files, conflicting owners, exhausted discovery and both installed hosts.

Include user-facing ownership decisions and bounded traversal. The separate [current-home inspection bug](../bugs/setup-current-home-inspection.md) owns its concrete detection failure; observed facts must remain distinct from proposed changes.

Include the FeatherPod case in acceptance: migration of indexes, histories and record directories with literal references in a canonical root instruction file and an unchanged import adapter. Reconcile mechanical authorized reference repair with the proposal boundary for broader guidance edits, and ensure completion reporting exposes any unresolved references.

## Gaps found by the migration accounting audit

The audit of 2026-09-29 found retained requirements that this entry's text did not name:

- Bounded discovery. V3 ships no guidance discovery at all; the v2 walk was removed. Besides bounded traversal and accurate reporting of exclusions, the agreed disposition under [Launches and discovery](../../V3-MIGRATION.md#launches-and-discovery) retains using "reliable host-provided context where available", preserving "applicable instruction precedence and explicitly referenced sources", resolving "essential gaps before dependent writes while allowing unrelated authorized work to continue", and that "Routine exclusions do not require a new user approval step."
- Documentation and lore. The agreed disposition under [Portability umbrella and continuations](../../V3-MIGRATION.md#portability-umbrella-and-continuations) retains "editing the durable source behind any host adapter" and "Unclear destinations become follow-up questions; do not guess a destination, replace an adapter, or automatically turn session observations into rules." [revise-lore](../../skills/revise-lore/SKILL.md) names a canonical source only for cross-project conventions, neither revise-lore nor [revise-docs](../../skills/revise-docs/SKILL.md) directs resolving the durable source behind a project-level adapter before editing, and nothing turns an unclear destination into a follow-up question. This part is not setup work; it could instead join [Retrospective routing by audience and instruction precedence](revise-lore-audience-routing.md) or become its own entry.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Explain Codex host-context confirmation in user terms](../reports/v3-migration-followups-20260920.md#explain-codex-host-context-confirmation-in-user-terms).
- [Separate inspection evidence from proposal generation](../reports/v3-migration-followups-20260920.md#separate-inspection-evidence-from-proposal-generation).
- [Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing](../reports/v3-migration-followups-20260920.md#agent-host-agnostic-nightshift-host-neutral-scaffolding-and-instruction-routing).
- [Bounded guidance discovery](../reports/v3-migration-followups-20260920.md#bounded-guidance-discovery).

[The migration decision](../../V3-MIGRATION.md#host-portability-installation-and-enforcement) preserves the surviving requirement; earlier records: [agent-host-agnostic-nightshift](agent-host-agnostic-nightshift.md), [bounded-guidance-discovery](bounded-guidance-discovery.md), [deterministic-init-backlog](deterministic-init-backlog.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
