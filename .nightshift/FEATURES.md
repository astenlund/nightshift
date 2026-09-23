# Features

Upcoming work and deferred extensions to the delivered v3 MVP. Its delivery is recorded in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). The original v2 proposals and their agreed dispositions are preserved in [MIGRATION_STATUS.md](MIGRATION_STATUS.md) and [the historical index](migration/v2/FEATURES.md). Readiness is not implementation authority.

## Current work

No active feature deliveries.

## Exploring

### [Shared BACKLOG.md meta-index](features/backlog-meta-index.md)

Introduce one BACKLOG.md meta-index linking the four backlog indexes and holding their shared instructions to avoid repetition. Include it in every hook that consumes those indexes. Settle its location, instruction ownership and migration of existing guidance before implementation.

### [Restore setup guidance discovery and instruction routing](features/v3-guidance-routing.md)

Restore canonical instruction-source discovery and approved backlog guidance updates on both hosts, with bounded traversal and explicit handling of conflicting or missing sources. Include the reported migration that left literal root instruction references unchanged after moving backlog files. The v3 setup currently relocates files and scaffolds indexes but does not expose the earlier guidance-resolution flow.

### [Restore customized backlog and legacy-guidance repair](features/v3-setup-compatibility.md)

Restore scoped proposals and approved repairs for customized backlog content and legacy guidance. Preserve user content, identify ambiguity and keep the repair boundary explicit. Include compact inline conversion of simple lettered lists while preserving hierarchy when items contain nested content, coordinated with parser consistency.

### [Define and preserve consequential filesystem metadata](features/v3-filesystem-metadata.md)

Complete the retained preservation contract for metadata beyond bytes and meaningful modes across supported writes and recovery. Establish which Windows properties matter and verify preservation or explicit limitations.

### [Bind setup recovery to physical artifact ownership](features/v3-recovery-artifact-ownership.md)

Complete physical artifact ownership and no-overwrite recovery for supported setup operations, including safe recognition of owned partial creation. Carry clear write stages, cleanup ownership and separate validation into the recovery repairs.

### [Complete executable identity assurance for Windows launches](features/v3-launch-identity.md)

Reconcile retained launch roles with the selected executable identity and trust boundary, including replacement and path retargeting between discovery and launch. Verify the boundary rather than inferring it from a resolved path.

### [Protect private request and review artifacts on Windows](features/v3-private-request-material.md)

Carry the retained request-confidentiality requirement into current request files, review copies and native evidence. Define and verify the appropriate Windows access boundary before sensitive material is written.

### [Define and verify marketplace installation contents](features/v3-marketplace-surface.md)

Finish the retained installed-package boundary: required runtime resources and intentional user documentation, with repository-maintenance material excluded where the host permits it. Distinguish marketplace caches from retained execution bundles.

### [Recover review report formatting without repeating the assessment](features/v3-review-result-recovery.md)

Complete the retained minimal-report contract with narrow correction or clarification of malformed results, preserving original substantive findings, attribution and evidence instead of automatically repeating the full review.

### [Carry settled decisions and experiment evidence into later reviews](features/v3-review-decision-context.md)

Complete the retained concise decision and experiment record so subsequent independent reviews receive relevant settled facts and unresolved obligations after edits or compaction. Preserve the ability for new evidence to reopen a decision.

### [Complete shared backlog parsing and template consistency](features/v3-parser-consistency.md)

Complete shared dependency metadata and continuation handling across Ready, setup and unwrap, preserving justified grammar differences and protected content.

### [Complete release-gate history diagnostics and checkout verification](features/v3-release-gate-diagnostics.md)

Finish the retained release-gate follow-ups for stale-branch versus genuine version decreases and robust verification of required checkout depth. Preserve current release policy and avoid reviving obsolete assertion shapes.

### [Maintain verification evidence, fixtures and measured efficiency](features/v3-verification-infrastructure.md)

Improve current verification tooling through explicit fixture ownership, safe evidence storage and measured reduction of unnecessary startup. Retire the unused 2.4.5 fixture only after reconciling supported upgrade checks.

### [Preserve run preferences and enforce supported resource budgets](features/v3-run-preferences.md)

Complete the retained run-settings outcome across continuation: durable model and effort preferences, explicit requirements and substitutions, plus enforceable requested budgets with accurate accounting and honest unsupported limits.

### [Verify repair-commit and autosquash safety in ordinary delivery](features/v3-git-repair-evidence.md)

Complete the retained reliable repair-commit outcome using ordinary Git and project policy: establish ownership and the current safe fixup target, preserve unrelated work, honor hooks and verify the intended autosquash.

### [Capture review content once within an operation](features/v3-review-snapshot-reuse.md)

Complete the retained operation-local snapshot reuse requirement while preserving freshness and exact reviewed bytes. Reuse captured source and identity for governing artifacts and review copies where valid, without introducing a persistent cache.

### [Verify compatible agreement continuity across representation changes](features/v3-agreement-continuity.md)

Complete evidence for retained agreement behavior: qualified assent, compatible title or description edits, archival moves and repeated spec refinements preserve accepted commitments without enlarging the approval burden.

### [Relaunch unfinished work after host exit or restart](features/v3-host-relaunch.md)

Restore unattended execution after a host exits or Windows restarts, beyond the currently supported user-driven reopen and reconciliation. Coordinate with Night Guard checkpointing without assuming it already restarts execution.

### [Restore controlled mixed-line-ending repair](features/v3-mixed-ending-repair.md)

Restore inspected normalization of mixed LF/CRLF endings on the controlled backlog surface, using the effective project convention and preserving recoverability.

### [Maintain bounded host transports and explicit runtime ownership](features/v3-transport-maintenance.md)

Assess current host transports for bounded efficient buffering, independently testable protocol decisions and one owner for every live timer. Preserve cancellation, stream closure and termination guarantees.

### [Init-backlog ignore-shape election](features/init-backlog-ignore-shape-election.md)

When new backlog exclusions are needed, let the user choose shared .gitignore rules or clone-local .git/info/exclude rules. Inspect effective policy first, preserve existing tracking and rule-source choices, and recognize the selected destination on reruns. This extends the separate fresh-scaffold track, ignore or defer feature.

### [Restore fresh-scaffold track, ignore or defer choice](features/setup-tracking-choice.md)

Restore the fresh-project setup choice to track the backlog in Git, ignore it, or defer the decision. Preserve existing tracking and ignore policy on reruns. This restores a previously shipped setup capability; choosing shared versus clone-local exclusions is tracked separately in [Init-backlog ignore-shape election](features/init-backlog-ignore-shape-election.md).

### [Ready offers to pick up an interrupted run](features/ready-interrupted-run-pickup.md)

When a new session opens in a project with an interrupted, stopped or undelivered Nightshift run, Ready tells the user about the unfinished work and offers to pick it up, after which everything behaves as in the original session, with no pointing at report files. Raised by the user on 2026-09-19. It builds on explicit run adoption, now implemented in the local 3.2.3 candidate with [qualified installed evidence](reports/run-adoption-and-continuation-20260921.md); the open questions include whether an undelivered morning report counts as unfinished work and how Ready learns about runs without continuation activation; the record lists all four.

### [Degraded assessment mode](features/degraded-assessment-mode.md)

Let a weaker model carry an independent assessment when no supported strong reviewer is available, clearly labeled as degraded and refused at the gates that require strength. Raised by the user during the automatic-preparation run, which was the live case: both admissible reviewers were unavailable at once and the lifecycle had no recordable fallback. The open design question is which gates a degraded assessment may satisfy on its own; it absorbs the earlier opus-review-gate follow-up.

### [Project inboxes](features/project-inboxes.md)

Give every Nightshift project a `.nightshift/inbox/` for suggestions and reports about that project. `init-backlog` creates it, and `ready` lists untriaged reports separately from actionable work. Reports about Nightshift itself continue to belong in Nightshift's maintainer inbox.

### [Orchestration efficiency](features/orchestration-efficiency.md)

Post-MVP investigation of measured controller overhead: repeated context reads, polling, bookkeeping and mechanical tool round trips. Preserve autonomy, independent review, skeptical validation and cumulative review after fixes; verify actual time and cost improvements before claiming savings.

### [Night Guard](features/night-guard.md)

Post-MVP reboot watchdog for multiple active agent sessions. Persist recovery state continuously, use the seconds-long shutdown window for bounded stop/flush coordination, and recover from saved state even when a session receives no warning or cannot acknowledge it.

### [Native event validation](features/native-event-validation.md)

Post-MVP exploration of consistent handling for assistant messages missing model metadata and other malformed native evidence. Preserve required-model and independent-review guarantees while distinguishing legitimate event shapes and maintaining reliable recovery.

### [Incremental revise finding delivery](features/incremental-revise-finding-delivery.md)

Deferred beyond the MVP. Streaming could overlap validation with the remaining review, while preserving corrections, withdrawal, attribution and input stability. Completed reports remain the baseline.

### [Review-run command enforcement](features/review-run-command-enforcement.md)

Deferred exploration of stronger enforcement for explicit command restrictions. Existing restrictions remain binding; no general protected-shell mode is claimed.

### [Initial reviewer selection](features/initial-reviewer-selection.md)

Policy for the initial spec/code lead: Fable or Astra only, prefer the other host, preserve the author or implementer effort floor, and use hard when effort is unknown. Strong same-host fallback takes precedence over a weaker cross-host reviewer. Additional enforcement style, if any, remains open.

### [Structured model teams](features/structured-model-teams.md)

Later deliberate model-role arrangements. The MVP uses task-fit preferences and controller judgment, with interchangeable strong roles and equivalent-strength cross-host review when suitable.

### [Interactive Codex and Claude Code collaboration](features/interactive-session-collaboration.md)

Later pairing of visible interactive sessions, including optional Windows Terminal pane launch/reuse and user steering of both. No interactive bridge is required by the MVP.

## History

Delivered features belong in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). When shipping an entry, remove its satisfied Requires references from active indexes; retirement is recorded separately.
