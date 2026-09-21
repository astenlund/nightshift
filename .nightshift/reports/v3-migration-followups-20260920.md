# V3 migration follow-ups

Captured on 2026-09-20, with individual user decisions completed and applied on 2026-09-21. All 63 items are resolved for tracking: 56 are tracked, three were skipped and four were closed as superseded. These are tracking dispositions, not completed implementations. [The reconciliation](v3-capability-reconciliation-20260920.md) and [independent audit](pre-v3-shipped-capability-audit-20260921.md) preserve evidence and uncertainty.

The first two tracking edits were applied during triage. At the user's request, all later decisions were recorded immediately and their tracking/documentation edits were applied together afterward. Each item below retains its original recommendation, user decision, rationale when supplied, and actual durable route. Related items can share a feature while keeping their individual acceptance obligations.

The original 55 items were supplemented by eight audit findings. Missing capabilities, verification questions, replaced implementation targets and deliberately declined work remain distinguishable. Existing incremental-finding and command-enforcement drafts were not duplicated. No implementation or publication is authorized by these dispositions.

## Reuse one resolution-local artifact snapshot across governing-set expansion

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code).

Current evidence: Shared hashes exist; operation-local byte reuse remains open. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-review-snapshot-reuse).

Recommendation at triage: Track the remaining outcome with capture review content once within an operation, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-review-snapshot-reuse.md). The tracking edit is complete; the capability or repair remains open.

## Reuse parsed ready-entry metadata for Requires and Slices instead of rescanning entry bodies

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code).

Current evidence: Shared scanners exist; remaining grammar, collection and producer consistency work is explicit. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-parser-consistency).

Recommendation at triage: Track the remaining outcome with complete shared backlog parsing and template consistency, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-parser-consistency.md). The tracking edit is complete; the capability or repair remains open.

## Retire the 2.4.5 legacy baseline together with its fidelity pin

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Replace. [Source](../migration/v2/QUICK_WINS.md#migration-pin-retirement).

Current evidence: Old controller consumers were removed, but the legacy fixture remains; reconcile it with current update verification. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-verification-infrastructure).

Recommendation at triage: Track the remaining outcome with reconcile retained host verification and fixture maintenance, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-21. Rationale and scope: Track as verification-tooling cleanup: confirm current upgrade verification covers supported paths before removing the unused legacy fixture; do not restore the retired fidelity pin. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-verification-infrastructure.md). The tracking edit is complete; the capability or repair remains open.

## Accept an unambiguous qualified agreement without re-presentation

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#agreement-response-classification).

Current evidence: Stable commitments exist; the original compatible-revision outcomes need explicit regression evidence. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-agreement-continuity).

Recommendation at triage: Track the remaining outcome with verify compatible agreement continuity across representation changes, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-agreement-continuity.md). The tracking edit is complete; the capability or repair remains open.

## Let the fetch-depth pin fail honestly on a benign checkout edit

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../migration/v2/QUICK_WINS.md#release-gate-follow-ups).

Current evidence: Replacement gate removed old assertion shapes without establishing both retained outcomes. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-release-gate-diagnostics).

Recommendation at triage: Track the remaining outcome with complete release-gate history diagnostics and checkout verification, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-release-gate-diagnostics.md). The tracking edit is complete; the capability or repair remains open.

## Name the stale-branch case in the version gate's decrease message

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../migration/v2/QUICK_WINS.md#release-gate-follow-ups).

Current evidence: Replacement gate removed old assertion shapes without establishing both retained outcomes. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-release-gate-diagnostics).

Recommendation at triage: Track the remaining outcome with complete release-gate history diagnostics and checkout verification, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-release-gate-diagnostics.md). The tracking edit is complete; the capability or repair remains open.

## Keep the governing entry's archive move out of implementation plans

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Replace. [Source](../migration/v2/QUICK_WINS.md#review-workflow-refinements).

Current evidence: Stable commitments exist; the original compatible-revision outcomes need explicit regression evidence. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-agreement-continuity).

Recommendation at triage: Track the remaining outcome with verify compatible agreement continuity across representation changes, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-agreement-continuity.md). The tracking edit is complete; the capability or repair remains open.

## Explain Codex host-context confirmation in user terms

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Preservation policy remains, but canonical guidance discovery and concrete setup proposals are not exposed by reduced setup. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-guidance-routing).

Recommendation at triage: Track the remaining outcome with restore setup guidance discovery and instruction routing, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Rationale and scope: Include concrete user-facing instruction-source decisions in the already selected discovery/routing feature, rather than creating a separate feature. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-guidance-routing.md). The tracking edit is complete; the capability or repair remains open.

## Reduce init-backlog controller-suite process startup

Status: tracked. Classification: Retained requirement needs verification against the replacement.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Old implementation shapes disappeared; current protocol, fixture, evidence and performance obligations still need scoped assessment. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-verification-infrastructure).

Recommendation at triage: Track the remaining outcome with reconcile retained host verification and fixture maintenance, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-21. Rationale and scope: Track within verification efficiency: measure current v3 costs before reducing avoidable startup, preserving isolation, failure attribution and meaningful coverage rather than rebuilding the old controller suite. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-verification-infrastructure.md). The tracking edit is complete; the capability or repair remains open.

## Remove unsupported POSIX host-discovery execution paths

Status: superseded. Classification: Original implementation removed; surviving need needs a decision.

Original accounting: Keep. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: The old evaluator/import protocol and registrars are no longer current consumers; current tests directly author v3 fixtures. See the [supporting assessment](v3-capability-reconciliation-20260920.md#replaced-harness-evidence).

Recommendation at triage: Confirm that the removed target needs no separate rebuild; carry any still-applicable verification gap into current harness maintenance. Do not mark the old feature shipped.

Decision and durable route: the user chose "skip" on 2026-09-21. Rationale and scope: The user agreed to close this as superseded: the old evaluator and unsupported execution paths are gone, with no remaining cleanup target found. This is not a claim of macOS or Linux support. No implementation is authorized.

Applied on 2026-09-21: [replacement accounting](v3-capability-reconciliation-20260920.md#replaced-harness-evidence). No new implementation entry was created for this item.

## Centralize controller-suite fixture cleanup

Status: tracked. Classification: Retained requirement needs verification against the replacement.

Original accounting: Keep. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Old implementation shapes disappeared; current protocol, fixture, evidence and performance obligations still need scoped assessment. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-verification-infrastructure).

Recommendation at triage: Track the remaining outcome with reconcile retained host verification and fixture maintenance, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-21. Rationale and scope: Track within current verification tooling: explicit fixture ownership from creation through success, failure and cancellation, with safe recovery of proven-owned inactive residue and no sweeping unrelated temporary files. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-verification-infrastructure.md). The tracking edit is complete; the capability or repair remains open.

## Decompose init-backlog filesystem services

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Current setup recovery exists; the retained physical-ownership and clear validation/mutation boundaries need completion. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-recovery-artifact-ownership).

Recommendation at triage: Track the remaining outcome with bind setup recovery to physical artifact ownership, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Rationale and scope: The user agreed to carry clear filesystem mutation, executable discovery and request transport responsibilities into setup restoration, not create a standalone refactoring project. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-recovery-artifact-ownership.md). The tracking edit is complete; the capability or repair remains open.

## Decompose publication apply phases

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Current setup recovery exists; the retained physical-ownership and clear validation/mutation boundaries need completion. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-recovery-artifact-ownership).

Recommendation at triage: Track the remaining outcome with bind setup recovery to physical artifact ownership, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Rationale and scope: The user agreed to carry clear write stages and cleanup ownership into recovery repairs, preserving pre-mutation validation, no-overwrite behavior and partial-write recovery without a standalone refactor. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-recovery-artifact-ownership.md). The tracking edit is complete; the capability or repair remains open.

## Avoid quadratic streaming buffer concatenation

Status: tracked. Classification: Retained requirement needs verification against the replacement.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Old implementation shapes disappeared; current protocol, fixture, evidence and performance obligations still need scoped assessment. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-verification-infrastructure).

Recommendation at triage: Track the remaining outcome with reconcile retained host verification and fixture maintenance, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-21. Rationale and scope: Assess current host transports and measure before optimizing; preserve byte and fragment bounds, framing, partial-input behavior and prompt invalid-input failure rather than applying a blanket buffer rewrite. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-transport-maintenance.md). The tracking edit is complete; the capability or repair remains open.

## Separate inspection evidence from proposal generation

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Preservation policy remains, but canonical guidance discovery and concrete setup proposals are not exposed by reduced setup. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-guidance-routing).

Recommendation at triage: Track the remaining outcome with restore setup guidance discovery and instruction routing, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Rationale and scope: Include the observed-facts versus proposed-changes boundary and freshness checks in the selected inspection/setup-restoration work. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-guidance-routing.md). The tracking edit is complete; the capability or repair remains open.

## Separate Git-policy probes from policy assembly

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Migration preserves some policy; selected tracking/exclusion destinations and their full rerun cases are absent. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-setup-tracking-policy).

Recommendation at triage: Track the remaining outcome with restore setup tracking choices and shared or local exclusions, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Rationale and scope: Include separate Git evidence gathering and policy decisions in tracking/exclusion restoration, preserving failed-probe handling. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/init-backlog-ignore-shape-election.md). The tracking edit is complete; the capability or repair remains open.

## Modularize recovery validation and execution

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure).

Current evidence: Current setup recovery exists; the retained physical-ownership and clear validation/mutation boundaries need completion. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-recovery-artifact-ownership).

Recommendation at triage: Track the remaining outcome with bind setup recovery to physical artifact ownership, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-21. Rationale and scope: The user agreed to carry separate validation and mutation into the selected recovery work, including authority, current-state checks, deterministic retry and honest partial-failure reporting, not a standalone refactor. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-recovery-artifact-ownership.md). The tracking edit is complete; the capability or repair remains open.

## Unify cross-skill backlog parsing sources

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#backlog-parser-and-template-maintenance).

Current evidence: Shared scanners exist; remaining grammar, collection and producer consistency work is explicit. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-parser-consistency).

Recommendation at triage: Track the remaining outcome with complete shared backlog parsing and template consistency, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-parser-consistency.md). The tracking edit is complete; the capability or repair remains open.

## Unify ready continuation joining after grammar fixtures

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#backlog-parser-and-template-maintenance).

Current evidence: Shared scanners exist; remaining grammar, collection and producer consistency work is explicit. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-parser-consistency).

Recommendation at triage: Track the remaining outcome with complete shared backlog parsing and template consistency, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-parser-consistency.md). The tracking edit is complete; the capability or repair remains open.

## Decide remaining unwrap scanner parity

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#backlog-parser-and-template-maintenance).

Current evidence: Shared scanners exist; remaining grammar, collection and producer consistency work is explicit. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-parser-consistency).

Recommendation at triage: Track the remaining outcome with complete shared backlog parsing and template consistency, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-parser-consistency.md). The tracking edit is complete; the capability or repair remains open.

## Extract Windows runner protocol state

Status: tracked. Classification: Retained requirement needs verification against the replacement.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-harness-architecture).

Current evidence: Old implementation shapes disappeared; current protocol, fixture, evidence and performance obligations still need scoped assessment. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-verification-infrastructure).

Recommendation at triage: Track the remaining outcome with reconcile retained host verification and fixture maintenance, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-21. Rationale and scope: Track within current transport maintenance: independently testable sequencing, limits and completion decisions separated from process wiring, preserving cancellation, stream closure and termination guarantees without recreating the old runner. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-transport-maintenance.md). The tracking edit is complete; the capability or repair remains open.

## Regenerate init-backlog import fixtures

Status: superseded. Classification: Original implementation removed; surviving need needs a decision.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-harness-architecture).

Current evidence: The old evaluator/import protocol and registrars are no longer current consumers; current tests directly author v3 fixtures. See the [supporting assessment](v3-capability-reconciliation-20260920.md#replaced-harness-evidence).

Recommendation at triage: Confirm that the removed target needs no separate rebuild; carry any still-applicable verification gap into current harness maintenance. Do not mark the old feature shipped.

Decision and durable route: the user chose "skip" on 2026-09-21. Rationale and scope: The user agreed to close this as superseded because the old import protocol and consumers were removed. Preserve reproducibility of current directly authored fixtures without restoring the old generator. No implementation is authorized.

Applied on 2026-09-21: [replacement accounting](v3-capability-reconciliation-20260920.md#replaced-harness-evidence). No new implementation entry was created for this item.

## Decompose host-behavior test registrars

Status: superseded. Classification: Original implementation removed; surviving need needs a decision.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-harness-architecture).

Current evidence: The old evaluator/import protocol and registrars are no longer current consumers; current tests directly author v3 fixtures. See the [supporting assessment](v3-capability-reconciliation-20260920.md#replaced-harness-evidence).

Recommendation at triage: Confirm that the removed target needs no separate rebuild; carry any still-applicable verification gap into current harness maintenance. Do not mark the old feature shipped.

Decision and durable route: the user chose "skip" on 2026-09-21. Rationale and scope: The user agreed to close this as superseded: the old registrars were removed with the harness and no refactor target remains. Organize current tests by behavior as ordinary maintenance. No implementation is authorized.

Applied on 2026-09-21: [replacement accounting](v3-capability-reconciliation-20260920.md#replaced-harness-evidence). No new implementation entry was created for this item.

## Extract host-discovery evidence persistence

Status: tracked. Classification: Retained requirement needs verification against the replacement.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-harness-architecture).

Current evidence: Old implementation shapes disappeared; current protocol, fixture, evidence and performance obligations still need scoped assessment. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-verification-infrastructure).

Recommendation at triage: Track the remaining outcome with reconcile retained host verification and fixture maintenance, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-21. Rationale and scope: Track within current verification tooling: safe evidence storage/read ownership, identity and bounds separated from acceptance decisions; missing, partial or stale evidence cannot establish a pass. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-verification-infrastructure.md). The tracking edit is complete; the capability or repair remains open.

## Decompose controller oracle registrars

Status: superseded. Classification: Original implementation removed; surviving need needs a decision.

Original accounting: Simplify. [Source](../migration/v2/QUICK_WINS.md#init-backlog-harness-architecture).

Current evidence: The old evaluator/import protocol and registrars are no longer current consumers; current tests directly author v3 fixtures. See the [supporting assessment](v3-capability-reconciliation-20260920.md#replaced-harness-evidence).

Recommendation at triage: Confirm that the removed target needs no separate rebuild; carry any still-applicable verification gap into current harness maintenance. Do not mark the old feature shipped.

Decision and durable route: the user chose "skip" on 2026-09-21. Rationale and scope: The user agreed to close this as superseded: the old controller registrars are gone. Preserve reusable neutral test helpers as ordinary maintenance, without reconstructing the former harness. No implementation is authorized.

Applied on 2026-09-21: [replacement accounting](v3-capability-reconciliation-20260920.md#replaced-harness-evidence). No new implementation entry was created for this item.

## Verified fixup transactions: MVP - verified fixup creation

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Replace. [Source](../features/verified-fixup-transactions.md#mvp-verified-fixup-creation).

Current evidence: Project Git policy remains binding; reusable deciding evidence and recovery need reconciliation, not the old transaction engine. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-git-repair-evidence).

Recommendation at triage: Track the remaining outcome with verify repair-commit and autosquash safety in ordinary delivery, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-git-repair-evidence.md). The tracking edit is complete; the capability or repair remains open.

## Durable run identity and concurrency protection

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../features/durable-run-identity-concurrency.md).

Current evidence: Single-run protection exists; stopped adoption, active transfer and independent overlapping runs have explicit destinations. See the [supporting assessment](v3-capability-reconciliation-20260920.md#continuity-and-deferred-capabilities).

Recommendation at triage: Use the existing stopped-run ownership bug for its concrete gap and the separately listed active-transfer and independent-run drafts for the wider deferred capabilities.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../BUGS.md#run-ownership-is-locked-to-the-creating-host-session). The tracking edit is complete; the capability or repair remains open.

## Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../features/agent-host-agnostic-nightshift.md#host-neutral-scaffolding-and-instruction-routing).

Current evidence: Preservation policy remains, but canonical guidance discovery and concrete setup proposals are not exposed by reduced setup. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-guidance-routing).

Recommendation at triage: Track the remaining outcome with restore setup guidance discovery and instruction routing, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-guidance-routing.md). The tracking edit is complete; the capability or repair remains open.

## Filesystem metadata preservation

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../features/filesystem-metadata-preservation.md).

Current evidence: The consequential Windows metadata inventory and complete preservation contract remain unsettled. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-filesystem-metadata).

Recommendation at triage: Track the remaining outcome with define and preserve consequential filesystem metadata, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-filesystem-metadata.md). The tracking edit is complete; the capability or repair remains open.

## Request-spool Windows DACL hardening

Status: tracked. Classification: Retained requirement needs verification against the replacement.

Original accounting: Keep. [Source](../features/request-spool-windows-dacl.md).

Current evidence: Old spool replaced by pipes; confidentiality of current on-disk private material still needs an explicit boundary. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-private-request-material).

Recommendation at triage: Track the remaining outcome with protect private request and review artifacts on windows, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-private-request-material.md). The tracking edit is complete; the capability or repair remains open.

## Recovery artifact physical identity

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../features/recovery-artifact-physical-identity.md).

Current evidence: Current setup recovery exists; the retained physical-ownership and clear validation/mutation boundaries need completion. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-recovery-artifact-ownership).

Recommendation at triage: Track the remaining outcome with bind setup recovery to physical artifact ownership, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-recovery-artifact-ownership.md). The tracking edit is complete; the capability or repair remains open.

## Executable identity revalidation for Windows launches

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../features/executable-identity-revalidation.md).

Current evidence: Resolution checks exist, but launch roles and replacement/retargeting assurance are not fully reconciled. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-launch-identity).

Recommendation at triage: Track the remaining outcome with complete executable identity assurance for windows launches, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-launch-identity.md). The tracking edit is complete; the capability or repair remains open.

## Bounded guidance discovery

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../features/bounded-guidance-discovery.md).

Current evidence: Preservation policy remains, but canonical guidance discovery and concrete setup proposals are not exposed by reduced setup. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-guidance-routing).

Recommendation at triage: Track the remaining outcome with restore setup guidance discovery and instruction routing, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-guidance-routing.md). The tracking edit is complete; the capability or repair remains open.

## Turn-sequencer timer ownership

Status: tracked. Classification: Retained requirement needs verification against the replacement.

Original accounting: Simplify. [Source](../features/turn-sequencer-timer-ownership.md).

Current evidence: Old implementation shapes disappeared; current protocol, fixture, evidence and performance obligations still need scoped assessment. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-verification-infrastructure).

Recommendation at triage: Track the remaining outcome with reconcile retained host verification and fixture maintenance, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-21. Rationale and scope: Track single-owner timer lifecycle and replacement, cancellation, completion and stale-callback verification within current transport maintenance; the old inert timer fields are gone and are not a separate rebuild target. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-transport-maintenance.md). The tracking edit is complete; the capability or repair remains open.

## Init-backlog ignore-shape election

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../features/init-backlog-ignore-shape-election.md).

Current evidence: Migration preserves some policy; selected tracking/exclusion destinations and their full rerun cases are absent. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-setup-tracking-policy).

Recommendation at triage: Track the remaining outcome with restore setup tracking choices and shared or local exclusions, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Restored [the feature record](../features/init-backlog-ignore-shape-election.md) to Exploring with a current v3 direction and the historical proposal preserved.

Applied on 2026-09-21: [tracking destination](../features/init-backlog-ignore-shape-election.md). The tracking edit is complete; the capability or repair remains open.

## Run-shaping settings: round cap and review lanes

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../features/run-shaping-settings.md).

Current evidence: Deadlines, dispatch limits and per-dispatch selection exist; durable preferences and requested budget coverage remain explicit work. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-run-preferences).

Recommendation at triage: Track the remaining outcome with preserve run preferences and enforce supported resource budgets, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-run-preferences.md). The tracking edit is complete; the capability or repair remains open.

## Bullet-entry selector re-keying and within-digest continuation

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Replace. [Source](../features/bullet-entry-selector-rekeying.md).

Current evidence: Stable commitments exist; the original compatible-revision outcomes need explicit regression evidence. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-agreement-continuity).

Recommendation at triage: Track the remaining outcome with verify compatible agreement continuity across representation changes, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-agreement-continuity.md). The tracking edit is complete; the capability or repair remains open.

## Init-backlog templates prescribe parser-invalid empty Requires syntax

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../bugs/init-backlog-parser-invalid-empty-requires.md).

Current evidence: Shared scanners exist; remaining grammar, collection and producer consistency work is explicit. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-parser-consistency).

Recommendation at triage: Track the remaining outcome with complete shared backlog parsing and template consistency, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/init-backlog-parser-invalid-empty-requires.md). The tracking edit is complete; the capability or repair remains open.

## Ignore election cannot initialize a missing .gitignore

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../bugs/ignore-election-missing-gitignore.md).

Current evidence: Migration preserves some policy; selected tracking/exclusion destinations and their full rerun cases are absent. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-setup-tracking-policy).

Recommendation at triage: Track the remaining outcome with restore setup tracking choices and shared or local exclusions, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Rationale and scope: Carry missing and empty ignore targets as acceptance cases within the restored setup-choice and exclusion-destination work, not as a separate feature or a claim that current setup cannot create .gitignore. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/setup-tracking-choice.md). The tracking edit is complete; the capability or repair remains open.

## Agreement digests drift toward micro-detail through review revisions

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Replace. [Source](../bugs/agreement-digest-revision-detail-drift.md).

Current evidence: Stable commitments exist; the original compatible-revision outcomes need explicit regression evidence. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-agreement-continuity).

Recommendation at triage: Track the remaining outcome with verify compatible agreement continuity across representation changes, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-agreement-continuity.md). The tracking edit is complete; the capability or repair remains open.

## Overlapping Markdown roots can lose or duplicate collected files

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../bugs/overlapping-markdown-root-deduplication.md).

Current evidence: Shared scanners exist; remaining grammar, collection and producer consistency work is explicit. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-parser-consistency).

Recommendation at triage: Track the remaining outcome with complete shared backlog parsing and template consistency, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/overlapping-markdown-root-deduplication.md). The tracking edit is complete; the capability or repair remains open.

## No-replace action destination binding

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../features/no-replace-action-destination-binding.md).

Current evidence: Current setup recovery exists; the retained physical-ownership and clear validation/mutation boundaries need completion. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-recovery-artifact-ownership).

Recommendation at triage: Track the remaining outcome with bind setup recovery to physical artifact ownership, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-recovery-artifact-ownership.md). The tracking edit is complete; the capability or repair remains open.

## Immutable accepted authority for compatible refreshes

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../features/immutable-accepted-authority.md).

Current evidence: Stable commitments exist; the original compatible-revision outcomes need explicit regression evidence. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-agreement-continuity).

Recommendation at triage: Track the remaining outcome with verify compatible agreement continuity across representation changes, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-agreement-continuity.md). The tracking edit is complete; the capability or repair remains open.

## Review report JSON schema

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../features/review-report-json-schema.md).

Current evidence: Validation exists; narrow formatting correction without full reassessment remains missing. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-review-result-recovery).

Recommendation at triage: Track the remaining outcome with recover review report formatting without repeating the assessment, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-review-result-recovery.md). The tracking edit is complete; the capability or repair remains open.

## Bounded revise acknowledgement context

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../features/bounded-revise-acknowledgement-context.md).

Current evidence: Stored history does not automatically deliver applicable decisions and experiment evidence to later reviewers. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-review-decision-context).

Recommendation at triage: Track the remaining outcome with carry settled decisions and experiment evidence into later reviews, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-review-decision-context.md). The tracking edit is complete; the capability or repair remains open.

## Controller-owned session experiment ledger

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Simplify. [Source](../features/controller-owned-session-experiment-ledger.md).

Current evidence: Stored history does not automatically deliver applicable decisions and experiment evidence to later reviewers. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-review-decision-context).

Recommendation at triage: Track the remaining outcome with carry settled decisions and experiment evidence into later reviews, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-review-decision-context.md). The tracking edit is complete; the capability or repair remains open.

## Marketplace installation surface

Status: tracked. Classification: Retained work is open or only partially covered.

Original accounting: Keep. [Source](../features/marketplace-installation-surface.md).

Current evidence: Retained bundle manifest is implemented; marketplace cache contents still need a separate verified boundary. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-marketplace-surface).

Recommendation at triage: Track the remaining outcome with define and verify marketplace installation contents, preserving this item's separate acceptance obligation. Settle its design before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-marketplace-surface.md). The tracking edit is complete; the capability or repair remains open.

## Restore setup in non-Git projects

Status: tracked. Classification: Confirmed legacy migration gap; fresh setup exists.

Original accounting: Reduced setup scope; useful restoration remains for triage. [Shipped setup design](../features/deterministic-init-backlog.md).

Current evidence: fresh non-Git setup succeeds; migration of an existing legacy backlog fails with git-failed while preserving the source. Fresh-path repository classification and policy writes have their own tracked bug. The user narrowed this restoration to legacy migration. See [the independent audit](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track as a distinct feature outcome if still wanted; settle the supported scope and acceptance before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Scope narrowed during triage: track failure to migrate an existing legacy backlog in a non-Git project. Fresh non-Git setup already succeeds according to the independent audit probe and is excluded from this restoration claim; reconcile the earlier broad evidence wording in the deferred edit batch. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/setup-nongit-migration.md). The tracking edit is complete; the capability or repair remains open.

## Restore controlled mixed-line-ending repair

Status: tracked. Classification: Previously shipped setup capability omitted from the reduced v3 surface.

Original accounting: Reduced setup scope; useful restoration remains for triage. [Shipped setup design](../features/deterministic-init-backlog.md).

Current evidence: The shipped setup supported inspected normalization on its controlled backlog surface. Current setup can optionally unwrap prose but has no corresponding mixed-ending repair proposal/apply flow. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-setup-compatibility).

Recommendation at triage: Track as a distinct feature outcome if still wanted; settle the supported scope and acceptance before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-mixed-ending-repair.md). The tracking edit is complete; the capability or repair remains open.

## Restore customized backlog and legacy-guidance repair

Status: tracked. Classification: Previously shipped setup capability omitted from the reduced v3 surface.

Original accounting: Reduced setup scope; useful restoration remains for triage. [Shipped setup design](../features/deterministic-init-backlog.md).

Current evidence: The shipped controller separated semantic repair proposals from approved publication. Reduced v3 setup validates existing catalogs and explicitly defers broader structural repair and legacy-guidance conversion. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-setup-compatibility).

Recommendation at triage: Track as a distinct feature outcome if still wanted; settle the supported scope and acceptance before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-setup-compatibility.md). The tracking edit is complete; the capability or repair remains open.

## Restore fresh-scaffold track, ignore or defer choice

Status: tracked. Classification: Previously shipped setup capability omitted from the reduced v3 surface.

Original accounting: Reduced setup scope; useful restoration remains for triage. [Shipped setup design](../features/deterministic-init-backlog.md).

Current evidence: The shipped deterministic setup gave the user a fresh-scaffold election. Current Setup preserves migration choices and writes run exclusions but does not expose this election. This is distinct from the never-shipped shared/local destination choice. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-setup-tracking-policy).

Recommendation at triage: Track as a distinct feature outcome if still wanted; settle the supported scope and acceptance before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Added [the Exploring feature](../features/setup-tracking-choice.md), keeping the shared/local exclusion choice separate.

Applied on 2026-09-21: [tracking destination](../features/setup-tracking-choice.md). The tracking edit is complete; the capability or repair remains open.

## Verify the complete lifecycle on macOS and Linux

Status: skipped. Classification: Explicitly deferred capability with only umbrella tracking.

Original accounting: Deferred beyond MVP. [V3 continuation record](../features/v3-continuations.md).

Current evidence: Explicit MVP deferral; current acceptance covers Windows only. This was already named in the V3 continuations umbrella. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-additional-platforms).

Recommendation at triage: Track as a distinct feature outcome if still wanted; settle the supported scope and acceptance before implementation.

Decision and durable route: the user chose "skip" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [declined capability record](../features/v3-continuations.md). No new implementation entry was created for this item.

## Transfer active control between host sessions

Status: skipped. Classification: Explicitly deferred capability with only umbrella tracking.

Original accounting: Deferred beyond MVP. [V3 continuation record](../features/v3-continuations.md).

Current evidence: Explicit MVP deferral, broader than adoption of a stopped run without active workers. This was already named in the V3 continuations umbrella. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-active-controller-transfer).

Recommendation at triage: Track as a distinct feature outcome if still wanted; settle the supported scope and acceptance before implementation.

Decision and durable route: the user chose "skip" on 2026-09-20. Rationale and scope: The user said post-switch adoption is the real use case. Keep adoption in the existing ownership work; do not add active controller transfer as a feature. No implementation is authorized.

Applied on 2026-09-21: [declined capability record](../features/v3-continuations.md). No new implementation entry was created for this item.

## Support independent runs in one checkout

Status: skipped. Classification: Explicitly deferred capability with only umbrella tracking.

Original accounting: Deferred beyond MVP. [V3 continuation record](../features/v3-continuations.md).

Current evidence: Explicit MVP deferral; current single-run ownership protections are intentional. This was already named in the V3 continuations umbrella. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-independent-runs).

Recommendation at triage: Track as a distinct feature outcome if still wanted; settle the supported scope and acceptance before implementation.

Decision and durable route: the user chose "skip" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [declined capability record](../features/v3-continuations.md). No new implementation entry was created for this item.

## Relaunch unfinished work after host exit or restart

Status: tracked. Classification: Explicitly deferred capability with only umbrella tracking.

Original accounting: Deferred beyond MVP. [V3 continuation record](../features/v3-continuations.md).

Current evidence: Explicit MVP deferral; user-driven reopening is the supported baseline. Night Guard covers related checkpointing and shutdown coordination, not an already-delivered relaunch path. See the [supporting assessment](v3-capability-reconciliation-20260920.md#candidate-v3-host-relaunch).

Recommendation at triage: Track as a distinct feature outcome if still wanted; settle the supported scope and acceptance before implementation.

Decision and durable route: the user chose "track" on 2026-09-20. Rationale and scope: Track as a separate relaunch capability linked to Night Guard; preserve the distinction from checkpointing and shutdown coordination. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../features/v3-host-relaunch.md). The tracking edit is complete; the capability or repair remains open.

## Setup unwrap can lose existing backlog content after a partial write

Status: tracked. Classification: Confirmed preservation regression.

Original accounting: additional result of the requested shipped-feature audit, outside the original 122-work-unit ledger.

Current evidence: The independent actual-CLI ENOSPC probe reduced an existing 115-byte backlog file to 6 bytes. There was no recovery copy, and a rerun succeeded with no ready entries, errors or notices. This is separate from restoring mixed-line-ending normalization. See [the complete audit and probe references](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track as a bug with recoverable writes and truthful retry behavior as the outcome.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/setup-unwrap-partial-write-data-loss.md). The tracking edit is complete; the capability or repair remains open.

## Interrupted template creation is accepted as a complete existing file

Status: tracked. Classification: Confirmed interrupted-setup regression.

Original accounting: additional result of the requested shipped-feature audit, outside the original 122-work-unit ledger.

Current evidence: A partial FEATURES.md creation left only "# Feat". Setup skipped that existing target on retry and reported completion without a parser problem. This differs from corruption of an existing file during unwrap. See [the complete audit and probe references](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track as a bug, preserving genuine customized content while recognizing owned incomplete creation.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/setup-partial-template-recovery.md). The tracking edit is complete; the capability or repair remains open.

## Exploring and Ready omit explicit parser problem reporting requirements

Status: tracked. Classification: Confirmed instruction loss; current native behavior unverified.

Original accounting: additional result of the requested shipped-feature audit, outside the original 122-work-unit ledger.

Current evidence: Exploring no longer explicitly requires reporting structuralErrors, notices and indexes.missing or conditioning the empty-draft message on a clean parse. Ready also omits an explicit missing-index requirement. Parser output survives; the earlier presentation campaign did not establish these current Exploring branches. See [the complete audit and probe references](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track the presentation regression with installed-host acceptance for failure, missing-index and genuinely empty cases.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/exploring-parser-diagnostics.md). The tracking edit is complete; the capability or repair remains open.

## Migration turns private exclusions into shared ignore rules

Status: tracked. Classification: Confirmed policy-preservation regression.

Original accounting: additional result of the requested shipped-feature audit, outside the original 122-work-unit ledger.

Current evidence: An isolated migration started with the legacy file excluded through .git/info/exclude and ended with its new destination excluded through root .gitignore. Ignored status was preserved but the choice of private rule storage was not. The newly tracked destination-election feature addresses new choices, not proof that this relocation branch is repaired. See [the complete audit and probe references](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track as a linked preservation bug under the exclusion-destination feature, retaining its distinct migration acceptance case.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/migration-private-ignore-source.md). The tracking edit is complete; the capability or repair remains open.

## New setup templates ignore effective project newline policy

Status: tracked. Classification: Confirmed template materialization gap.

Original accounting: additional result of the requested shipped-feature audit, outside the original 122-work-unit ledger.

Current evidence: With Git reporting text:set and eol:lf, freshly created FEATURES.md used CRLF. Current initialize unconditionally converts templates to CRLF. This is separate from repairing an existing mixed-ending file. See [the complete audit and probe references](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track as a bug for new-file materialization according to the effective supported newline policy.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/setup-template-newline-policy.md). The tracking edit is complete; the capability or repair remains open.

## Setup inspection omits current backlog completeness

Status: tracked. Classification: Confirmed inspection capability gap.

Original accounting: additional result of the requested shipped-feature audit, outside the original 122-work-unit ledger.

Current evidence: Inspect returns backlog:null for malformed current .nightshift content because it only parses when legacy files will move. Missing current targets and their repair opportunities are not presented; apply can create other files before eventually rejecting the malformed catalog. See [the complete audit and probe references](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track the current-home inspection outcome, coordinating with the existing inspection/proposal and guidance-routing follow-ups.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/setup-current-home-inspection.md). The tracking edit is complete; the capability or repair remains open.

## Setup does not diagnose actual pre-v3 recovery residue

Status: tracked. Classification: Confirmed missing diagnosis; complete legacy recovery remains unverified.

Original accounting: additional result of the requested shipped-feature audit, outside the original 122-work-unit ledger.

Current evidence: Sentinel old setup lock/election names and .tmp/revise-state.md remained unclassified while inspection and initialization returned normally. The existing unfinished-run test creates current SQLite state at a legacy path, so it does not prove handling of real pre-v3 formats. The probe does not establish a live old writer or authorize adopting its records. See [the complete audit and probe references](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track explicit legacy-format diagnosis and safe transition or refusal, linked to recovery ownership without granting old records new write authority.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/setup-legacy-recovery-residue.md). The tracking edit is complete; the capability or repair remains open.

## Fresh setup does not distinguish non-Git roots from broken Git metadata

Status: tracked. Classification: Confirmed repository-classification gap.

Original accounting: additional result of the requested shipped-feature audit, outside the original 122-work-unit ledger.

Current evidence: Fresh non-Git setup succeeds but writes Git policy files. A malformed .git indirection also succeeds, showing that this branch does not reliably distinguish no repository from failed repository discovery. The already-decided non-Git restoration item is scoped only to legacy migration, so this is a separate decision. See [the complete audit and probe references](pre-v3-shipped-capability-audit-20260921.md).

Recommendation at triage: Track the repository-classification and no-Git-policy behavior as a separate compatibility bug.

Decision and durable route: the user chose "track" on 2026-09-20. No implementation is authorized.

Applied on 2026-09-21: [tracking destination](../bugs/setup-repository-classification.md). The tracking edit is complete; the capability or repair remains open.
