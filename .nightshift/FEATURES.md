# Features

Upcoming work and deferred extensions to the delivered v3 MVP. Its delivery is recorded in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). The original v2 proposals and their agreed dispositions are preserved in [MIGRATION_STATUS.md](MIGRATION_STATUS.md) and [the historical index](migration/v2/FEATURES.md). Readiness is not implementation authority.

## Current work

### [Independent documentation review](features/independent-documentation-review.md)

Add one strong independent documentation review kind, whose brief covers claim accuracy against the cited code and records, sweep completeness, backlog grammar, sibling consistency and proportionality instead of the six code dimensions, with the same skeptic, disposition and repair loop. Have revise-docs require it for its complete change, purely mechanical changes excepted, and have closing tracking use it over backlog-only changes, whose clean receipt lets the completion gate accept task reviews made stale only by those edits and covers them at publication, including tracking applied after a handed-over run completes. Raised by the user on 2026-09-24 as the closing tracking review, after run `46fc13f1-98fc-4a3e-953c-958a31261ae4` needed a completion workaround and a separate review-loop for its tracking commit, and widened by the user on 2026-09-28 after a standalone revise-docs pass completed with no independent review; both readbacks are agreed and recorded in the linked record. Not started; it needs a concise governing spec and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Whole-backlog coherence audit](features/backlog-coherence-audit.md)

A whole-backlog mode of `revise-docs` that walks every active index, breakout and pattern file and checks that relationships between entries, excerpts against their records, and claims about the current code still hold. Every finding gets fresh skeptic validation; the audit repairs when attended and writes an inbox report for later triage when unattended. Raised and settled by the user on 2026-09-25; the MVP is manual only.

**Slices:**

- **MVP - manual audit.** The user triggers the audit explicitly.
- **Scheduled trigger.** A scheduled run aborts unless a commit has landed since the last audited commit; where it executes, where its report lands and where the last audited commit is recorded remain open.
  **External:** User decision on where scheduled audits execute, where their report lands and where the last audited commit is recorded.

**Requires:** none.

### [Separate run-time guidance from reference material](features/runtime-guidance-separation.md)

Keep what agents follow during a run in instruction files, separate from reference material that only informs design. The operating brief stays run-time guidance; the operating passages of both REFERENCE files move to a run-time operations guide the skills link to, and the REFERENCE files remain as design references that no run loads. Implementation starts with a one-for-one inventory of directing sentences, verified by independent review. Raised and settled by the user on 2026-09-25; it needs a concise governing spec and an evidence decision before implementation.

**Requires:** none.

### [Verify faked boundaries live](features/live-boundary-verification.md)

Have the operating brief ask for a change that crosses a boundary the deterministic tests fake (processes, host or shell, filesystem, credentials, network, model behavior) to be exercised in the real environment once those tests pass, with verification reports stating what stayed test-only as a limit. Settle the live-evidence allowance at handover, carrying the two budget quick wins this entry absorbed with their original terms. Raised by the user on 2026-09-26 after most recent live-found defects turned out not to be model-owned but to sit where the deterministic tests use stand-ins or never reach; the direction is proposed, not agreed, and it needs a concise governing spec and an evidence decision before implementation. A passive half, proposed by the controller on 2026-09-28, marks fixes or behavior changes shipped without installed-host evidence and has each session retrospective record, per host, any such marker the run exercised.

**Requires:** none.

### [Reproduce a bug with a failing check before repairing it](features/reproduce-before-repair.md)

Have the operating brief ask the controller, for defect work, to run a check that reproduces the failure before the repair, confirm it fails for the defect's reason, and rerun it under the same name after the repair, and have its Tests and evidence code dimension ask whether a fix carries that pair. This is guidance only: the existing check evidence already keeps both runs and gates acceptance on the latest, so the runtime stays unchanged. The agreed scope identifies defect work, and for a defect without a practical automated reproduction the controller is to record why and what evidence stands in, reported as a verification limit. From the user's 2026-09-26 ideas document; the commitments were agreed with the user on 2026-09-28 and are recorded in the linked record. It changes model-owned behavior, so it needs a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Run-free revise](features/run-free-revise.md)

Let revise-code, revise-spec, revise-docs and revise-lore run without creating a runtime run when invoked on their own, while inside an active run they keep using its tasks. Runs stay with agreed implementation delivery: the attended run a project lifecycle requirement starts, and a handed-over run. Make the review operations usable without a run through a lightweight review record holding receipts, skeptic verdicts, dispositions and repairs, with no controller claim, continuation, closing stages or completion gate, so isolated read-only review copies, cross-host dispatch and attributed receipts are kept; a run-free invocation lists its follow-ups in its final message. Raised and agreed by the user on 2026-09-28 after a standalone revise-docs pass created run `a0eaaee7-6c97-4261-960d-346c6a4654aa`, which then needed a retrospective and triage to close. It changes the skill and runtime text that ties standalone revision to a run, and its spec settles how that relates to the v3 decision on shared machinery, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Project inboxes](features/project-inboxes.md)

Give every project that uses Nightshift a `.nightshift/inbox/` for raw suggestions and reports about that project, owned by the report's subject. Whoever creates an inbox, setup or an agent filing a report, is to create it ignored through its own `.gitignore`, and setup is to create one when absent while leaving an existing inbox's contents and policy unchanged. Reports are to be dated Markdown files that never overwrite each other and leave design to triage. During a run, observations about the run's own project stay follow-ups, while those about another Nightshift project whose location is known go to its inbox and are named in the run's report. Ready is to list untriaged reports in their own section, omitted when the inbox is empty or absent, and triage runs only at the user's request, deleting each report once its disposition is recorded. Reports about Nightshift itself go to the Nightshift project's own inbox, located through the maintainer's instructions. Requested by the user on 2026-09-13; the commitments were agreed with the user on 2026-09-28 and are recorded in the linked record. It reverses the v3 decision that setup creates no inbox in other projects, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Degraded assessment mode](features/degraded-assessment-mode.md)

Let a weaker model carry an independent assessment when no supported strong model can take a reviewer role, or when the user explicitly selects one, using the strongest permitted model available and never overriding an explicit model requirement; attended, the controller asks first, and unattended, it proceeds on recorded unavailability evidence. A degraded assessment covers lead review, skeptic validation and reassessment, is recorded like any other so tasks can advance past review, and is labeled as degraded in the review gate, status, obligation brief and reports, with no gate treating it as strong. The run cannot complete, and nothing is published, until a supported strong assessment covers the same content, reviewing the whole change fresh; unrecorded advisory feedback still never counts. Raised by the user during the automatic-preparation run, which was the live case: both admissible reviewers were unavailable at once and the lifecycle had no recordable fallback. It absorbs the earlier opus-review-gate follow-up; the commitments were agreed with the user on 2026-09-29 and are recorded in the linked record. It reverses the governing rule that no task advances past review without a strong assessment, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

### [Background review and assessment of selected work](features/selection-review-and-assessment.md)

When a readback or spec that asks whether to begin implementation is presented, dispatch two background agents at once, each on the strongest model available and preferring the other host: an independent review agent, which a plain readback does not get today, and a separate assessment agent that gives short, prioritized feedback on the selected work with suggested tweaks, as advice rather than a gate and without the controller's reasoning. The draft is shown without waiting; the user may say yes before the results arrive, but implementation and handover acceptance wait until both have been presented and any tweaks the user wants are settled. Raised by the user on 2026-09-29 so that the user gets the model's feedback before work starts, even on an entry written without any AI input; the commitments were agreed with the user on 2026-09-29 and are recorded in the linked record. It changes the agreement rules, the Ready selection path and the handover acceptance condition, so it needs a concise governing spec, a version increase and a decision on installed-host evidence before implementation.

**Requires:** none.

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

### [Size-aware Ready recommendations](features/ready-sized-recommendations.md)

Besides the few high-value entries Ready recommends today, also recommend one or two smaller entries for a quick session and a larger entry, or a group of entries, sized for a longer session such as a night's worth of work. Raised by the user on 2026-09-29, who settled that size is the model's rough judgment from what it reads; what makes a group coherent, how a pick for a night fits the settlement that handover requires first, and how a group is cited and selected are among the questions the record lists as open.

### [Retrospective routing by audience and instruction precedence](features/revise-lore-audience-routing.md)

Have revise-lore route lessons by who the user is: a Nightshift maintainer to the Nightshift backlog or inbox, a regular user to the global or project-local instruction files, and let global and project instructions take precedence over plugin instructions when they conflict. Raised by the user on 2026-09-27. Open: how a maintainer is recognized, and how precedence interacts with gates the plugin treats as mandatory.

### [Deliver each run on its own branch or worktree](features/run-worktree-delivery.md)

Implement each run in a dedicated Git worktree on a run-owned branch, so the morning report points at a reviewable diff and the user keeps working in the main checkout. From the user's 2026-09-26 ideas document comparing other agent tools. Open: the checkout lease, the recorded project path and adoption, review-copy source, worktree lifecycle and uncommitted user changes, and branch or draft pull request publication.

### [Measure whether the lifecycle catches defects](features/defect-detection-measurement.md)

Run the lifecycle against a small fixed suite of seeded defects and record detection rate, false-positive rate after skeptic validation, and time and model cost, repeating when models or review guidance change. From the user's 2026-09-26 ideas document. Open: budget and usage accounting, keeping the suite out of reviewer context, and how many runs a meaningful rate needs.

### [User proxy consultation and opt-in user profile](features/user-proxy-consultation.md)

When the controller is uncertain and the user is absent, consult the strongest available model reasoning as the user from recorded knowledge, and route its labelled answer and confidence to morning triage; with high confidence the controller might proceed. An opt-in user profile would accumulate priorities and sensibilities for it. Reserved decisions, confidence thresholds, labelling and profile consent remain open.

### [Review mode for someone else's implementation](features/review-mode.md)

Validate a feature implementation made by someone else, a human or an AI not participating in the session, against whatever material the user provides, such as links, Word documents or text in chat. It takes a local branch, commit range or worktree, a GitHub pull request or uncommitted changes; beyond reviewing the code it runs checks and tests, verifies faked boundaries live, checks documentation and backlog accuracy, and can post its verdict to the pull request with the user's explicit go-ahead each time. It reports first, then offers repairs as patch files or direct edits, taking the findings one at a time once repair is initiated. Raised by the user on 2026-09-28. Open questions include whether it is a skill or a revise-code mode distinct from plain review requests, whether it creates a run, how baseline material is ingested and confirmed, the trust boundary for running someone else's code, and how the change is checked out without disturbing the user's work; the record lists them all.

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

### [Model choice per role: Opus 5.5 versus Fable](features/opus-versus-fable-role-choice.md)

Investigate which roles could use Opus 5.5 instead of Fable without falling below their required capability and strength, and at what cost difference. The user reports Opus working well as default controller, unmeasured; live testing and pricing evidence settle any policy change.

### [User-configurable model policy file](features/model-policy-file.md)

Move the supported strong-model list, today a constant in the runtime's review module, into a file the user can edit, which can also hold a general allow list, a deny list, or both. Raised by the user on 2026-09-29 while graduating Degraded assessment mode. Open questions include where the file lives and whether a project's copy may widen the strong list, what happens when it is missing or malformed, and what the allow and deny lists govern; the record lists them all.

### [Structured model teams](features/structured-model-teams.md)

Later deliberate model-role arrangements. The MVP uses task-fit preferences and controller judgment, with interchangeable strong roles and equivalent-strength cross-host review when suitable.

### [Interactive Codex and Claude Code collaboration](features/interactive-session-collaboration.md)

Later pairing of visible interactive sessions, including optional Windows Terminal pane launch/reuse and user steering of both. No interactive bridge is required by the MVP.

## History

Delivered features belong in [FEATURES_HISTORY.md](FEATURES_HISTORY.md). When shipping an entry, remove its satisfied Requires references from active indexes; retirement is recorded separately.
