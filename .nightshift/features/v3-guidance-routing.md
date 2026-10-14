---
name: v3-guidance-routing
description: Restore setup guidance discovery and instruction routing
metadata:
  type: feature
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
- Documentation and lore. The agreed disposition under [Portability umbrella and continuations](../../V3-MIGRATION.md#portability-umbrella-and-continuations) retains "editing the durable source behind any host adapter" and "Unclear destinations become follow-up questions; do not guess a destination, replace an adapter, or automatically turn session observations into rules." [revise-lore](../../skills/revise-lore/SKILL.md) names a canonical source only for cross-project conventions, neither revise-lore nor [revise-docs](../../skills/revise-docs/SKILL.md) directs resolving the durable source behind a project-level adapter before editing, and nothing turns an unclear destination into a follow-up question. This part is not setup work; it could instead join [Retrospective routing by audience and instruction precedence](revise-lore-audience-routing.md) or become its own entry. The user chose on 2026-10-13 to move it there, as the settled questions below record.

## Added at the section-level audit's triage

[The section-level audit of v2 records](../reports/v2-section-audit-20261004.md) found that [Bounded guidance discovery](bounded-guidance-discovery.md) asked to "Define ordering and accounting so the same repository state produces the same visited set, admitted guidance, exclusions, and budget result", and that the Simplify disposition under [Launches and discovery](../../V3-MIGRATION.md#launches-and-discovery) dropped it without naming it. The user chose on 2026-10-04 to add that repeatability obligation to this entry's acceptance. For the settled input set below, the operative comparison holds repository state and captured host inputs fixed, including Codex-reported instruction names and the global instruction content used for precedence; changing those inputs can change the result.

## Settled questions

The user agreed these answers on 2026-10-13, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: `excludedReference` in `internal/setup.js` skips `AGENTS.md`, `CLAUDE.md`, `_AGENTS.md` and `_CLAUDE.md` both when rewriting references and when collecting the reference decisions `inspect` reports, so a stale reference in a root instruction file is neither rewritten nor reported; setup has no guidance discovery; the runtime elsewhere recognizes four host instruction files, `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md` and `CLAUDE.local.md` (`HOST_INSTRUCTION_FILES` in `internal/runtime/lifecycle.js`); and [the init-backlog skill](../../skills/init-backlog/SKILL.md) already allows mechanical authorized references in root instruction changes and requires any change beyond them to be a concrete proposal with independent assessment and user approval, so the code is stricter than the stated policy.

- The proposal and application boundary, and mechanical reference repair. Settled: path references in instruction files that point to moved backlog files are rewritten during the migration like those in any other file, listed by `inspect` before `apply` and under the same apply authority. Every other guidance change stays a concrete proposal requiring independent assessment and the user's approval.
- How completion reporting exposes unresolved references. Settled: `apply` lists every unresolved reference in its migration inventory, including instruction-file references to moved backlog paths, and a migration with any such reference reports itself as complete with unresolved references, never as clean. [Migration leaves embedded and placeholder backlog paths without a diagnostic](../BUGS.md#migration-leaves-embedded-and-placeholder-backlog-paths-without-a-diagnostic) separately tracks detection of configuration strings, absent-directory placeholders and repeated link text; references it adds to the inventory receive the same unresolved report.
- The supported discovery inputs. Settled: the four host instruction files at the project root and below it, the files they import or explicitly link, such as Claude `@path` imports and links to instruction files, and the instruction file names Codex is configured to read where the host reports them. The user's global instructions are read for precedence and never edited by setup.
- Traversal limits and exclusions. Settled: discovery has fixed depth and count limits and a fixed order, so the same repository state and captured host inputs yield the same result, preserving the repeatability the user chose on 2026-10-04. It skips ignored and vendored directories and reports what it excluded, and an exhausted budget is reported as incomplete discovery, never passed over silently.
- Conflicting owners, adapters and missing files. Settled: an import adapter, such as a CLAUDE.md that imports AGENTS.md, is preserved, and edits go to the durable source behind it. Two files holding competing guidance where neither imports the other are both reported, and the user decides which owns a change; setup does not pick one. A missing instruction file is never created without the user's approval.
- Where the documentation and lore part belongs. Settled: it moves to [Retrospective routing by audience and instruction precedence](revise-lore-audience-routing.md), which already routes lessons by the user's instructions, and it covers revise-docs as well as revise-lore there. This entry keeps setup.
- Relations and evidence. Settled: the [current-home inspection bug](../bugs/setup-current-home-inspection.md) keeps its own repair, and the entry requires nothing. Deterministic fixtures cover imports, custom instruction names, missing files, conflicting owners, exhausted discovery and the FeatherPod case; presenting proposals is model-owned, so the entry keeps its evidence on both installed hosts, with the budget decided when the work starts.

## Before implementation

Settle the discovery inputs Codex reports and how they are read, the traversal limits and order, the exclusion report, the conflict question and the unresolved-reference report in a concise governing spec in `.nightshift/specs`. The change alters setup, init-backlog and its inspection result, so it rides with a plugin version increase. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Explain Codex host-context confirmation in user terms](../reports/v3-migration-followups-20260920.md#explain-codex-host-context-confirmation-in-user-terms).
- [Separate inspection evidence from proposal generation](../reports/v3-migration-followups-20260920.md#separate-inspection-evidence-from-proposal-generation).
- [Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing](../reports/v3-migration-followups-20260920.md#agent-host-agnostic-nightshift-host-neutral-scaffolding-and-instruction-routing).
- [Bounded guidance discovery](../reports/v3-migration-followups-20260920.md#bounded-guidance-discovery).

[The migration decision](../../V3-MIGRATION.md#host-portability-installation-and-enforcement) preserves the surviving requirement; earlier records: [agent-host-agnostic-nightshift](agent-host-agnostic-nightshift.md), [bounded-guidance-discovery](bounded-guidance-discovery.md), [deterministic-init-backlog](deterministic-init-backlog.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
