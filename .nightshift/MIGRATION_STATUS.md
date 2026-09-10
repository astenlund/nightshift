# V3 tracking migration

All 122 original work units have an agreed disposition: 39 retired proposals and 83 retained needs. Their original index entries are preserved in migration/v2, and their design/diagnostic breakouts remain available. The detailed reasons and surviving obligations are in [V3-MIGRATION.md](../V3-MIGRATION.md).

The delivered [v3 MVP](features/nightshift-v3.md) is recorded in [feature history](FEATURES_HISTORY.md). The active backlog holds deferred capabilities and later work. Consolidation records where a need is tracked; it does not by itself assert delivery of every retained need. The MVP feature governs first-release inclusion. Retained needs outside that scope remain inputs to [continuations](features/v3-continuations.md), with the agreed ledger preserving their complete reasoning. Retired proposals are not shipped features or fixed bugs.

| Original work unit | Agreed disposition | Tracking treatment | Evidence |
|---|---|---|---|
| Consolidate the duplicated spec-agreement preflight shared by the three revise wrappers | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code) |
| Reuse one resolution-local artifact snapshot across governing-set expansion | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code) |
| Reuse parsed ready-entry metadata for Requires and Slices instead of rescanning entry bodies | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code) |
| Break the agreement controller and its ready dependency cycle into narrower scanner and controller modules | Replace | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code) |
| Replace handover's duplicated agreement sequence with a narrow delegation to the shared agreement skill | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code) |
| Pass the already-validated derived diff through a compatible refresh | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code) |
| Enforce the all-inactive staleness boundary mechanically | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code) |
| Gate spec-review fixes by artifact layer before editing | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#spec-review-convergence-safeguards) |
| Calibrate revise-spec against implementation-detail escalation | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#spec-review-convergence-safeguards) |
| Update the review dimensions against the latest superpowers guidance | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#review-dimension-sourcing) |
| Have the plan risk dimension enumerate the recovery state space up front, and give the plan author a recovery checklist | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#review-dimension-sourcing) |
| Split the plan-correctness dimension into a static cell and an executable cell | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#review-dimension-sourcing) |
| Stop counting verifier rounds toward the per-run round cap | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#wave-lifecycle-tuning) |
| Run the deferred Workflow-runtime ordering probe | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#revise-engine-verification) |
| Retire the 2.4.5 legacy baseline together with its fidelity pin | Replace | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#migration-pin-retirement) |
| Shorten the decision-complete digest and cut what it costs to produce | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-digest-economy) |
| Bundle a composite entry operation in the agreement CLI so callers stop hand-writing driver scripts | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-digest-economy) |
| Present the controller's assessment of the governing text before the digest | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#agreement-presentation) |
| Accept an unambiguous qualified agreement without re-presentation | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#agreement-response-classification) |
| Let the fetch-depth pin fail honestly on a benign checkout edit | Keep | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#release-gate-follow-ups) |
| Name the stale-branch case in the version gate's decrease message | Keep | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#release-gate-follow-ups) |
| Read non-ASCII changed paths verbatim in the version-increase gate | Keep | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#release-gate-follow-ups) |
| Give each symptom its own cause in capture entries | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#spec-authoring-habits) |
| State how a copied convention list resolves mechanically | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#spec-authoring-habits) |
| Loop revise-lore's fresh-eyes pass to convergence | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#lore-review-depth) |
| Reserve review authority vocabulary for the controller | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#review-workflow-refinements) |
| Align manual revise fallback with the Workflow path | Replace | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#review-workflow-refinements) |
| Use a single-agent review loop outside active Nightshift implementation | Replace | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#review-workflow-refinements) |
| Make review probes hermetic | Keep | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#review-workflow-refinements) |
| Keep the governing entry's archive move out of implementation plans | Replace | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#review-workflow-refinements) |
| Give the engine a fixer-ownership rule so controller edits and an author agent cannot overwrite each other | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#review-workflow-refinements) |
| Explain Codex host-context confirmation in user terms | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Auto-apply the trivial plans-directory scaffold | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Reduce init-backlog controller-suite process startup | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Remove unsupported POSIX host-discovery execution paths | Keep | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Centralize controller-suite fixture cleanup | Keep | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Decompose init-backlog filesystem services | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Decompose publication apply phases | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Memoize guidance-resolution candidate bytes | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Avoid quadratic streaming buffer concatenation | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Separate inspection evidence from proposal generation | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Separate Git-policy probes from policy assembly | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Modularize recovery validation and execution | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-runtime-and-controller-structure) |
| Unify cross-skill backlog parsing sources | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#backlog-parser-and-template-maintenance) |
| Unify ready continuation joining after grammar fixtures | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#backlog-parser-and-template-maintenance) |
| Profile-gate ready Requires resolution reuse | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#backlog-parser-and-template-maintenance) |
| Compose shared init-backlog template boilerplate | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#backlog-parser-and-template-maintenance) |
| Decide remaining unwrap scanner parity | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#backlog-parser-and-template-maintenance) |
| Extract Windows runner protocol state | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-harness-architecture) |
| Regenerate init-backlog import fixtures | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-harness-architecture) |
| Decompose host-behavior test registrars | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-harness-architecture) |
| Extract host-discovery evidence persistence | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-harness-architecture) |
| Decompose controller oracle registrars | Simplify | Consolidated retained need | [Source](migration/v2/QUICK_WINS.md#init-backlog-harness-architecture) |
| Revalidate and consolidate residual micro-cleanups | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#init-backlog-harness-architecture) |
| Open a created Hardening section with a blank line in the provenance writer | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-controller-hygiene) |
| Collapse the five structural-error wrappers in spec-agreement.js into one factory, and reword the entry-scope comment | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-controller-hygiene) |
| List provenance-bind and provenance-write-bound among the agreement skill's CLI operations | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-controller-hygiene) |
| Make the post-agreement Operating context write refuse a direct file edit | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#agreement-controller-hygiene) |
| Amend the retained-authority sentence for the unpresented-held-section precondition | Retire | Retired proposal | [Source](migration/v2/QUICK_WINS.md#guidance-text-reconciliation) |
| Bundled revise controller | Replace | Consolidated retained need | [Source](features/bundled-revise-controller.md) |
| Verified fixup transactions: MVP - verified fixup creation | Replace | Consolidated retained need | [Source](features/verified-fixup-transactions.md#mvp-verified-fixup-creation) |
| Durable run identity and concurrency protection | Simplify | Consolidated retained need | [Source](features/durable-run-identity-concurrency.md) |
| Manual review dedup parity | Simplify | Consolidated retained need | [Source](features/manual-review-dedup-parity.md) |
| Content fingerprint helper | Simplify | Consolidated retained need | [Source](features/content-fingerprint-helper.md) |
| Same-session validation skip and validation stamp | Retire | Retired proposal | [Source](features/same-session-validation-skip.md) |
| Pre-hardening verify-fix loop | Replace | Consolidated retained need | [Source](features/pre-hardening-verify-fix-loop.md) |
| Fixer-triggered cell reactivation | Retire | Retired proposal | [Source](features/fixer-triggered-cell-reactivation.md) |
| Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing | Simplify | Consolidated retained need | [Source](features/agent-host-agnostic-nightshift.md#host-neutral-scaffolding-and-instruction-routing) |
| Agent-host-agnostic Nightshift: Review host adapters | Replace | Consolidated retained need | [Source](features/agent-host-agnostic-nightshift.md#review-host-adapters) |
| Communicate for technically sophisticated, time-constrained users | Replace | Consolidated retained need | [Source](features/sophisticated-user-communication.md) |
| Pick-time breakouts | Retire | Retired proposal | [Source](features/pick-time-breakouts.md) |
| Filesystem metadata preservation | Keep | Consolidated retained need | [Source](features/filesystem-metadata-preservation.md) |
| Request-spool Windows DACL hardening | Keep | Consolidated retained need | [Source](features/request-spool-windows-dacl.md) |
| Recovery artifact physical identity | Keep | Consolidated retained need | [Source](features/recovery-artifact-physical-identity.md) |
| Executable identity revalidation for Windows launches | Keep | Consolidated retained need | [Source](features/executable-identity-revalidation.md) |
| Bounded guidance discovery | Simplify | Consolidated retained need | [Source](features/bounded-guidance-discovery.md) |
| Publication lock and resume lifecycle | Retire | Retired proposal | [Source](features/publication-lock-resume-lifecycle.md) |
| Turn-sequencer timer ownership | Simplify | Consolidated retained need | [Source](features/turn-sequencer-timer-ownership.md) |
| Nightshift inbox | Keep | Consolidated retained need | [Source](features/nightshift-inbox.md) |
| Init-backlog ignore-shape election | Keep | Consolidated retained need | [Source](features/init-backlog-ignore-shape-election.md) |
| Run-shaping settings: round cap and review lanes | Simplify | Consolidated retained need | [Source](features/run-shaping-settings.md) |
| Dimension duration tracking and split suggestions | Retire | Retired proposal | [Source](features/dimension-duration-tracking.md) |
| Revise progress visible by default | Simplify | Consolidated retained need | [Source](features/revise-progress-visible-by-default.md) |
| Bullet-entry selector re-keying and within-digest continuation | Replace | Consolidated retained need | [Source](features/bullet-entry-selector-rekeying.md) |
| Init-backlog templates prescribe parser-invalid empty Requires syntax | Keep | Consolidated retained need | [Source](bugs/init-backlog-parser-invalid-empty-requires.md) |
| Ignore election cannot initialize a missing .gitignore | Keep | Consolidated retained need | [Source](bugs/ignore-election-missing-gitignore.md) |
| Agreement digests drift toward micro-detail through review revisions | Replace | Consolidated retained need | [Source](bugs/agreement-digest-revision-detail-drift.md) |
| Overlapping Markdown roots can lose or duplicate collected files | Keep | Consolidated retained need | [Source](bugs/overlapping-markdown-root-deduplication.md) |
| Rigor-steered lifecycle | Retire | Retired proposal | [Source](features/rigor-steered-lifecycle.md) |
| Audience-category recalibration | Retire | Retired proposal | [Source](features/audience-category-recalibration.md) |
| Second-opinion gates | Replace | Consolidated retained need | [Source](features/second-opinion-gates.md) |
| Adversarial repair dialogue | Simplify | Consolidated retained need | [Source](features/adversarial-repair-dialogue.md) |
| Verified fixup transactions: Checkpoint autosquash | Retire | Retired proposal | [Source](features/verified-fixup-transactions.md#checkpoint-autosquash) |
| Durable scope anchor | Simplify | Consolidated retained need | [Source](features/durable-scope-anchor.md) |
| Contract-calibrated revise admission | Simplify | Consolidated retained need | [Source](features/contract-calibrated-revise-admission.md) |
| Fix-scoped follow-up rounds | Retire | Retired proposal | [Source](features/fix-scoped-rounds.md) |
| Agent-host-agnostic Nightshift: Portable resource and fingerprint contract | Simplify | Consolidated retained need | [Source](features/agent-host-agnostic-nightshift.md#portable-resource-and-fingerprint-contract) |
| Agent-host-agnostic Nightshift: Host-neutral documentation and lore | Simplify | Consolidated retained need | [Source](features/agent-host-agnostic-nightshift.md#host-neutral-documentation-and-lore) |
| Agent-host-agnostic Nightshift: Packaging and cross-host validation | Keep | Consolidated retained need | [Source](features/agent-host-agnostic-nightshift.md#packaging-and-cross-host-validation) |
| No-replace action destination binding | Keep | Consolidated retained need | [Source](features/no-replace-action-destination-binding.md) |
| Revise workflows cannot dispatch on the supported Codex agent surface | Replace | Consolidated retained need | [Source](migration/v2/BUGS.md#revise-workflows-cannot-dispatch-on-the-supported-codex-agent-surface) |
| Light revise mode | Replace | Consolidated retained need | [Source](features/light-revise-mode.md) |
| Wave round economy | Retire | Retired proposal | [Source](features/wave-round-economy.md) |
| Immutable accepted authority for compatible refreshes | Simplify | Consolidated retained need | [Source](features/immutable-accepted-authority.md) |
| Controller-owned revise convergence recovery | Simplify | Consolidated retained need | [Source](features/controller-owned-revise-convergence-recovery.md) |
| Review dimension deferral | Retire | Retired proposal | [Source](features/review-dimension-deferral.md) |
| Authoring guidance overlay | Replace | Consolidated retained need | [Source](features/authoring-guidance-overlay.md) |
| Review report JSON schema | Simplify | Consolidated retained need | [Source](features/review-report-json-schema.md) |
| Incremental revise finding delivery | Keep | Deferred capability | [Source](features/incremental-revise-finding-delivery.md) |
| Backlog index version | Retire | Retired proposal | [Source](features/backlog-index-version.md) |
| Revise prompt-prefix caching | Retire | Retired proposal | [Source](features/revise-prompt-prefix-caching.md) |
| Bounded revise acknowledgement context | Simplify | Consolidated retained need | [Source](features/bounded-revise-acknowledgement-context.md) |
| Pre-implementation context reset | Retire | Retired proposal | [Source](features/pre-implementation-context-reset.md) |
| Lifecycle shape proposal | Replace | Consolidated retained need | [Source](features/lifecycle-shape-proposal.md) |
| Controller-owned session experiment ledger | Simplify | Consolidated retained need | [Source](features/controller-owned-session-experiment-ledger.md) |
| Night manager and shift supervisor | Simplify | Consolidated retained need | [Source](features/night-manager-shift-supervisor.md) |
| Class-level review deferral valve | Retire | Retired proposal | [Source](features/class-level-review-deferral-valve.md) |
| Stage-altitude finding routing | Simplify | Consolidated retained need | [Source](features/stage-altitude-finding-routing.md) |
| Code simplifier workflow placement | Retire | Retired proposal | [Source](features/code-simplifier-workflow-placement.md) |
| Review-run command enforcement | Keep | Deferred capability | [Source](features/review-run-command-enforcement.md) |
| Marketplace installation surface | Keep | Consolidated retained need | [Source](features/marketplace-installation-surface.md) |
| Overarching backlog goals | Simplify | Consolidated retained need | [Source](features/overarching-backlog-goals.md) |
