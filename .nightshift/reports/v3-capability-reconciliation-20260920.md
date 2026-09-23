# V3 capability reconciliation

Accounting captured on 2026-09-20; independent audit, user triage and tracking application completed by 2026-09-21. Product baseline: f032030, plugin 3.2.0. This is backlog/documentation work, not a delivery run or implementation of the missing capabilities.

## Final accounting

[V3-MIGRATION.md](../../V3-MIGRATION.md) preserves 122 original active work units: 20 Keep, 46 Simplify, 17 Replace and 39 Retire. The original 83 retained needs were mostly labeled consolidated without individual delivery evidence or an actionable destination. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) now preserves those original fields and supplies current evidence or a concrete route for every row.

The separate shipping history contains twelve pre-v3 shipped entries and one proposal superseded without shipping. The [independent audit](pre-v3-shipped-capability-audit-20260921.md) examines their material capabilities against actual code, named assertions and deciding probes. It is more detailed than the initial inventory inspection and retains explicit limits on model-owned and installed-host claims.

The user triaged [63 follow-ups](v3-migration-followups-20260920.md): 55 initially captured items plus eight additional audit findings. All decisions are applied: 56 tracking dispositions, three skipped capabilities and four superseded implementation targets. Grouping avoids duplicate standalone refactors while preserving each selected acceptance obligation. No item remains awaiting a triage decision.

## Dispositions and active destinations

- Restoration and unsettled assurance designs are in [Features](../FEATURES.md) as Exploring entries. Two setup-choice entries were restored during triage; the final batch adds 19 grouped feature records.
- 11 concrete bugs were added or restored in [Bugs](../BUGS.md), with their evidence and separate acceptance cases. Existing adoption, permission-recovery and host-probe bugs remain their concrete owners.
- Active-controller transfer, independent runs in one checkout and additional-platform verification were declined. Post-switch adoption remains selected; automatic host relaunch is tracked separately and linked to Night Guard. [The old continuation umbrella](../features/v3-continuations.md) now records those dispositions instead of remaining a catch-all Exploring item.
- Four old evaluator/import/registrar targets were closed as superseded. Current fixture custody, measured efficiency, evidence storage and transport ownership remain selected work.
- The backlog-visibility bug is [archived as an accounting repair](../BUGS_HISTORY.md#retained-v3-continuation-needs-lack-actionable-backlog-visibility). Missing capabilities themselves are not marked shipped or fixed.

## Evidence classification

The initial per-row assessment classified 22 retained needs as present, 12 as policy present, 33 partial, five open, seven needing reconciliation against their replacement and four with removed original targets; the other 39 original proposals were retired. Present means the named replacement is visible in cited source/evidence, not that every host invocation is verified. Policy present means the rule exists, not universal model compliance. The final table routes every selected open/partial/reconciliation outcome to active work, preserves the two already-existing independent drafts, and records the four superseded targets explicitly.

The audit corrected the broad non-Git claim: fresh setup succeeds, legacy migration fails, and repository classification/policy-writing has separate defects. It also established two failed-write recovery regressions, private-to-shared ignore migration, project newline-policy loss, missing current-home inspection and legacy-residue diagnosis, and reduced Exploring diagnostic instructions. Passing existing tests does not turn these counterexamples into successful preservation.

## Previously shipped behavior

The history inventory contains twelve shipped pre-v3 entries and one superseded proposal. These are outside the 122 active-work-unit count and must be considered separately. The source is [FEATURES_HISTORY.md](../FEATURES_HISTORY.md); this reconciliation does not rewrite historical delivery.

| Historical entry | Current disposition and evidence |
|---|---|
| Review orchestration tests | Old wave tests were removed with their scheduler. Transactional runtime, review and completion tests cover the replacement; current harness improvements remain pending. |
| Present chosen spec for agreement before work | Concise intake and stable commitments replace the digest gate. Compatible-agreement regression work is a separate pending follow-up. |
| Universal skill entry points | Retained native skills on both hosts; the deliberate eight-skill surface removes the dedicated routine plan-review stage. Package tests and installed acceptance cover the retained surface. |
| Dependency-cycle detection | Retained in ready.js and ready.test.js; no separate dropped capability identified. |
| Calibrate first-draft rigor to deployment context | Relevant context gathering is retained in intake and review. Mandatory six-input profiles, tier arithmetic and per-dimension effort were deliberately removed by the shipped-policy migration decision. |
| Simplify revise lifecycle around rounds | Historical record says superseded without shipping; not a shipped capability to restore. |
| Wave-convergence lifecycle with a holistic gate | Deliberately replaced by broad cumulative independent review after each repair; no wave/verifier-stamp rebuild is proposed. |
| Surface Exploring entries in Ready | Parser output and draft visibility survive. The audit found missing explicit problem-channel guidance in Exploring and missing-index guidance in Ready; the new presentation bug tracks these separately from link and recommendation improvements. |
| Dedup-before-verify | The per-arrival judge and shared-verdict protocol were replaced by one-problem consolidation and batch skepticism. Their old optimization is not a missing supported invariant. |
| Immediate skeptic dispatch | The old multi-cell barrier is gone. Completed-report review is the supported baseline; optional streaming findings remains an existing draft, not a claim of restored streaming. |
| Plugin version bump policy | Retained and extended to both manifests, payload integrity and README status in the current release gate. |
| Deterministic init-backlog | Partly retained: scaffolding, migration, normal interruption recovery, optional unwrap and parser validation. Guidance routing, tracking election, controlled mixed-ending repair and broader semantic repair have Exploring entries. Legacy non-Git migration, fresh repository classification, current-home inspection, failed writes, policy-source preservation and new-file newline materialization have bug entries. Fresh non-Git setup itself succeeds. |
| Operating context at shift start | The compulsory profile, twelfth digest field and deferred operating-context writer were deliberately removed; consequential project facts and user commitments remain required. |

The old setup also contained physical-identity, approved-write and recovery protections. Their surviving requirements are individually pending under recovery ownership, metadata, launch identity and private request material; normal copy recovery is not evidence of every old protection. The old mandatory plans directory and routine plan lifecycle are retired, so their absence is not restoration work.

## Agreement and authoring evidence

[The operating brief](../../internal/workflow.md), especially Priorities and authority, Review and repair, and the spec dimensions, carries concise intake, investigation before agreement, appropriate detail and material-change boundaries. [lifecycle.js](../../internal/runtime/lifecycle.js) stores stable task IDs and commitment revisions. [runtime-review.test.js](../../tests/runtime-review.test.js) includes `an in-flight report cannot accept changed ... commitments`; [runtime-regressions.test.js](../../tests/runtime-regressions.test.js) includes `another spec assessment cannot refresh changed governing commitments`. Those tests do not settle the separately pending qualified-assent and repeated-revision acceptance cases. The existing [permission-only recovery bug](../BUGS.md#permission-only-recovery-invalidates-accepted-specs) remains open.

## Review and worker evidence

[review.js](../../internal/runtime/review.js) supplies every dimension, validates native report attribution and freshness and protects reviewed inputs; [lifecycle.js](../../internal/runtime/lifecycle.js) separates validity, obligation and controller disposition. [The runtime tests](../../tests/runtime.test.js) cover weak/narrow/failed review refusal, cumulative repair invalidation, no-edit refutation and ownership. [Review tests](../../tests/runtime-review.test.js) cover native report tampering, model fallback and rerouting, complete skeptic assignments and reviewed-input drift. [The accepted Windows campaign](v3-acceptance-272m-20260910.md) records actual installed host outcomes and limitations.

The shared brief names one problem as one finding, fresh skepticism, optional peers/supervisor and exclusive write ownership. The runtime's worker operation rejects overlapping writes and binds peer model/effort to the lead; registration is not dispatch. The primitive and policy are present, not a claim of an autonomous supervisor service. Existing deep-copy, Git-probe, activation and continuation bugs stay open and are not discounted by this baseline.

## Closing and instruction evidence

[The shared brief](../../internal/workflow.md) and [revise-lore](../../skills/revise-lore/SKILL.md) require independent review and user control over instruction changes. [Runtime regression tests](../../tests/runtime-regressions.test.js) cover standalone docs/lore repair, current assessment and closing preservation. The accepted Windows report records standalone documentation and retrospective cases on both hosts with their qualifications; it does not prove every possible instruction-source layout, which remains in setup routing follow-up work.

## Content and resource evidence

[evidence.js](../../internal/runtime/evidence.js) implements shared snapshot/freshness operations. [The retained-resource interface](../../internal/releases/REFERENCE.md), its release tests and [retained release acceptance](retained-plugin-releases-20260914.md) establish exact session-bound resource ownership and retained execution. [Automatic-preparation acceptance](automatic-plugin-preparation-20260915.md) covers the later preparation behavior. Operation-local captured-byte reuse and marketplace cache exclusions remain separate pending items.

## Parser and release evidence

Ready imports [internal/markdown.js](../../internal/markdown.js) and [backlog-catalog.js](../../internal/backlog-catalog.js), removing its former dependency on the agreement controller. [Ready fixtures](../../skills/ready/ready.test.js) and [unwrap fixtures](../../skills/init-backlog/unwrap.test.js) retain grammar, protected-content and alias cases; shared modules do not by themselves prove every outstanding consolidation complete.

The collector was probed on a private two-file fixture. One root yielded both files. Repeating the same file yielded it twice; repeating the root duplicated its index; child-before-parent omitted the child record, while parent-before-child retained both. This freshly reproduces the retained overlapping-root problem. The source and derived facts are retained under .tmp/migration-collector-evidence.json and .tmp/probe-migration-collector.cjs; the two-file fixture was removed. The report records the deciding facts so the ignored evidence is not its sole support.

[The release gate](../../tools/release-gate.js) reads NUL-delimited Git paths. [release-gate.test.js](../../tests/release-gate.test.js), case `non-ASCII shipped paths are not hidden by path quoting`, passed against actual Git. The generic decrease message and absent replacement checkout-depth assertion remain pending. Template instructions still contain bare `Requires: none.` in archive-removal guidance; the valid producer/consumer form is `**Requires:** none.`, so this retained bug is not closed merely because fresh empty indexes parse.

## Replaced harness evidence

A focused search over current tests, internal modules, skills, tools and CI found no consumers of `legacy-plugin-2.4.5`, `init-backlog-import`, `init-backlog-controller` or `evaluateLinuxContainment` outside the retained legacy fixture tree and generated payload manifest. The old registrar/import/evaluator mechanisms therefore are not the current targets of the original changes. [setup.test.js](../../tests/setup.test.js) now directly creates v3 fixtures. This is evidence of replacement, not authority to retire the surviving maintenance goals or delete the inert fixture. The user closed all four removed-target proposals as superseded during triage; current fixture/evidence maintenance remains tracked separately.

## Backlog and inbox evidence

The [Ready skill](../../skills/ready/SKILL.md) uses project goals and invariant priorities; [repository instructions](../../AGENTS.md) define maintainer inbox capture and triage. The MVP now explicitly describes a maintainer-only inbox. General [Project inboxes](../features/project-inboxes.md) is an existing separate draft. The current [recommendation omission bug](../BUGS.md#ready-reports-omit-actionable-recommendations) prevents treating prose policy as universally verified model behavior.

## Progress and convergence evidence

The brief requires visible progress and investigation after three successive related repair findings. The runtime exposes focused status and full inspect/history; [runtime-regressions.test.js](../../tests/runtime-regressions.test.js) names `large immutable logs are stored once rather than copied into every history revision` and `focused restoration excludes inventory payloads, and final reconciliation remains actionable`. These support the replacement mechanics; they do not certify that every controller notices recurrence. The old full growing log and compulsory healthy-run certification remain retired.

## Continuity and deferred capabilities

The current single-run baseline rejects foreign/stale owners and preserves commitments across reopening. Fresh checks passed for `overlapping runs, foreign owners and stale writes cannot replace progress` and `persisted commitments, findings and ownership survive closing and reopening`. The existing [post-switch adoption and ownership bug](../BUGS_HISTORY.md#run-ownership-is-locked-to-the-creating-host-session) is still open. The user declined active-controller transfer and independent overlapping runs, identifying post-switch adoption as the real use case. Additional platforms were also skipped; automatic relaunch and broader setup repair now have explicit Exploring entries. These later decisions preserve the original MVP exclusions without presenting every exclusion as future planned work.

## Retired proposals

All 39 original Retire dispositions remain unchanged, with their source links and rationale in the migration ledger. Their surviving general principles are carried by the v3 baseline or the pending outcomes above. This accounting does not reactivate Superpowers, mandatory plan production, rigor tiers, per-cell waves, verifier stamps, routine checkpoint autosquash, old digest protocols or retired optimization schemes. The final triage also closed four removed implementation targets as superseded and declined three umbrella capabilities. A missing old mechanism alone is not evidence that it should return.

## Candidate capability assessments

These sections retain investigation context and current disposition. Active feature and bug records govern the selected future outcome; no proposed architecture here is implementation authority.

<a id="candidate-v3-guidance-routing"></a>

### Restore setup guidance discovery and instruction routing

[Tracked feature](../features/v3-guidance-routing.md). Restore canonical instruction-source discovery and approved backlog guidance updates on both hosts, with bounded traversal and explicit handling of conflicting or missing sources. The v3 setup currently relocates files and scaffolds indexes but does not expose the earlier guidance-resolution flow.

Retained outcome: The shipped deterministic setup supported canonical guidance ownership, including Claude import adapters and Codex effective instruction names. The migration retained this need while removing the old controller. Establish the actual durable source, preserve adapters and independent instructions, and present proposed changes in user terms. Bound discovery without silently omitting applicable guidance.

Current evidence: `internal/setup.js` implements migration inventory, references and index templates; `excludedReference` excludes root instruction files from automatic rewriting. `skills/init-backlog/SKILL.md` reserves instruction edits for separately assessed proposals. This is a missing supported setup flow, not authority to overwrite guidance.

Still to settle: Settle the supported discovery inputs and traversal limits, conflict handling and proposal/application boundary. Verify imports, custom instruction names, missing files, conflicting owners, exhausted discovery and both installed hosts.

<a id="candidate-v3-setup-compatibility"></a>

### Restore customized backlog and legacy-guidance repair

[Tracked feature](../features/v3-setup-compatibility.md). Restore scoped proposals and approved repairs for customized backlog content and legacy guidance. Preserve user content, identify ambiguity and keep the repair boundary explicit.

Retained outcome: Earlier setup separated semantic repair proposals from approved publication. General structural repair and bulk legacy conversion were deliberately outside the reduced MVP; the user now wants this outcome tracked. Canonical instruction routing, mixed-ending normalization and non-Git migration have separate destinations.

Current evidence: Current initialize skips existing targets before final parser validation and has no semantic repair proposal/apply flow. The independent audit distinguishes this missing capability from current-home inspection and recoverable-write defects.

Still to settle: Choose the bounded repair inventory, exact proposal and approval boundary, interruption recovery and handling of ambiguous customized content. Verify preservation, deferred/unanswered decisions, repeat runs and invalid or incompatible catalogs.

<a id="candidate-v3-setup-tracking-policy"></a>

### Restore setup tracking choices and shared or local exclusions

Tracked as [fresh-scaffold choice](../features/setup-tracking-choice.md) and [shared/local exclusion destination](../features/init-backlog-ignore-shape-election.md), with missing/empty targets and separated Git evidence included. The [private-ignore migration bug](../bugs/migration-private-ignore-source.md) remains a separate preservation case.

<a id="candidate-v3-filesystem-metadata"></a>

### Define and preserve consequential filesystem metadata

[Tracked feature](../features/v3-filesystem-metadata.md). Complete the retained preservation contract for metadata beyond bytes and meaningful modes across supported writes and recovery. Establish which Windows properties matter and verify preservation or explicit limitations.

Retained outcome: The migration kept this feature without settling its metadata inventory. Define required properties, capture and refresh rules, partial outcomes and recovery. Existing content hashes and Git mode preservation do not prove ACL, attribute or other metadata preservation.

Current evidence: `internal/filesystem-primitives.js` records portable mode and physical identity for selected operations; `Setup.apply` copies and removes migration files. Neither is a complete declared Windows metadata contract.

Still to settle: Settle the consequential property set for supported filesystems and operations. Verify success, failure between content and metadata writes, unsupported properties and stale evidence. Avoid promises about every filesystem attribute.

<a id="candidate-v3-recovery-artifact-ownership"></a>

### Bind setup recovery to physical artifact ownership

[Tracked feature](../features/v3-recovery-artifact-ownership.md). Complete physical artifact ownership and no-overwrite recovery for supported setup operations, including safe recognition of owned partial creation. Carry clear write stages, cleanup ownership and separate validation into the recovery repairs.

Retained outcome: The user selected physical identity and safe destination binding, with filesystem responsibility, publication-stage clarity and recovery validation as constraints on restoration rather than standalone refactors. Establish ownership before changing or deleting managed objects; do not adopt an unrelated destination merely because its bytes match.

Current evidence: Current migration recovery checks existence and hashes, uses exclusive copying and preserves tested staged/working distinctions. The audit confirms some link and substitution guards while leaving full journal and artifact ownership unverified. Its separate unwrap and partial-template data-loss probes do not become fixed by this design entry.

Still to settle: Inventory actual artifacts and durable crash states, choose physical identity evidence, and keep validation distinct from its owning mutation. Verify partial creation, same-byte substitution, aliases, stale state, failure and deterministic retry. Preserve unrelated files and existing recovery evidence.

<a id="candidate-v3-launch-identity"></a>

### Complete executable identity assurance for Windows launches

[Tracked feature](../features/v3-launch-identity.md). Reconcile retained launch roles with the selected executable identity and trust boundary, including replacement and path retargeting between discovery and launch. Verify the boundary rather than inferring it from a resolved path.

Retained outcome: The retained requirement allows legitimate re-resolution and updates but requires missing identity proof to block the affected launch. Cover runtime hosts, their PowerShell runner, setup Git and retained-release administration according to their actual trust policy.

Current evidence: `resolveTrustedExecutable` performs two identity checks while resolving; runtime and release host launchers use it. `internal/setup.js` invokes Git by name. This establishes partial mechanisms, not one verified launch-time contract across every role or closure of all races.

Still to settle: Choose the per-role contract and document residual race limits. Verify retargeting, replacement, permitted updates and unavailable proof on the supported Windows host without treating a last-moment path check as atomic launch binding.

<a id="candidate-v3-private-request-material"></a>

### Protect private request and review artifacts on Windows

[Tracked feature](../features/v3-private-request-material.md). Carry the retained request-confidentiality requirement into current request files, review copies and native evidence. Define and verify the appropriate Windows access boundary before sensitive material is written.

Retained outcome: The original request-spool DACL proposal was conditional on retaining that transport. Current hosts use pipes, but review requests, source copies and native records are still written to disk. Reconcile that actual surface and its sensitivity rather than reintroducing the old spool or claiming inherited permissions are stronger isolation.

Current evidence: `dispatchReview` writes request.json, a complete project copy and attempt evidence below `.nightshift/runs/reviews`; host transports also persist event and error output. No cross-principal access probe was performed in this reconciliation.

Still to settle: Decide which artifacts require restricted access, the allowed principals, creation order and interrupted cleanup. Verify the chosen permissions on Windows and state explicitly that ACLs do not isolate agents sharing the same principal.

<a id="candidate-v3-marketplace-surface"></a>

### Define and verify marketplace installation contents

[Tracked feature](../features/v3-marketplace-surface.md). Finish the retained installed-package boundary: required runtime resources and intentional user documentation, with repository-maintenance material excluded where the host permits it. Distinguish marketplace caches from retained execution bundles.

Retained outcome: Retained release manifests now define an exact runtime bundle, but that does not by itself restrict what each marketplace initially installs. Preserve all runtime dependencies and supported discovery while deciding the user-facing installation surface.

Current evidence: `internal/releases/manifest.js` and `payload.json` validate retained payloads, and package tests check their dependencies. The plugin manifests point at skills and hooks; a current clean marketplace-content comparison is still needed before claiming the earlier packaging concern resolved.

Still to settle: Choose inclusion/exclusion mechanisms supported by each marketplace and the documentation policy. Verify clean installation and update contents on both hosts, including resource resolution and removal of stale public entry points.

<a id="candidate-v3-review-result-recovery"></a>

### Recover review report formatting without repeating the assessment

[Tracked feature](../features/v3-review-result-recovery.md). Complete the retained minimal-report contract with narrow correction or clarification of malformed results, preserving original substantive findings, attribution and evidence instead of automatically repeating the full review.

Retained outcome: V3 validates structured reports, which meets only part of the agreed Review report JSON schema replacement. Formatting mistakes should be recoverable without rewriting substance or turning missing evidence into a completed verdict.

Current evidence: `dispatchReview` validates output after runAgent and records a failed attempt on parsing or validation errors; fallback invokes a new assessment. There is no dedicated report-correction operation in the runtime reference.

Still to settle: Define which failures permit narrow correction, how original and corrected results remain attributable, and when a fresh assessment is required. Verify malformed formatting, contradictory evidence, stale inputs and interrupted correction.

<a id="candidate-v3-review-decision-context"></a>

### Carry settled decisions and experiment evidence into later reviews

[Tracked feature](../features/v3-review-decision-context.md). Complete the retained concise decision and experiment record so subsequent independent reviews receive relevant settled facts and unresolved obligations after edits or compaction. Preserve the ability for new evidence to reopen a decision.

Retained outcome: Bounded acknowledgements and the controller-owned experiment ledger were simplified into the ordinary run record, not retired. History and finding dispositions exist, but reviewers also need access to applicable prior reasoning and raw evidence without inheriting the author's correctness argument.

Current evidence: `buildPrompt` supplies requirements, the cumulative source, assigned findings and matching probes. It does not automatically project prior dispositions or experiment conclusions into review context. The active bug "Probe evidence about the host is discarded on any edit" is a concrete subset and remains its repair owner.

Still to settle: Settle relevance, invalidation and bounded delivery, with fuller-evidence fallback when summarization is unsafe. Verify a settled decision across an unrelated edit, changed evidence reopening it, and unresolved obligations surviving compaction. Coordinate with the existing probe-evidence bug rather than duplicating its repair.

<a id="candidate-v3-parser-consistency"></a>

### Complete shared backlog parsing and template consistency

[Tracked feature](../features/v3-parser-consistency.md). Complete shared dependency metadata and continuation handling across Ready, setup and unwrap, preserving justified grammar differences and protected content.

Retained outcome: Shared catalog and Markdown modules already exist. Reuse parsed entry metadata, characterize top-level and slice continuations, and reconcile scanner differences only where consumers interpret the same syntax. The reproduced overlapping-root and invalid-template defects have separate bug entries.

Current evidence: Ready retains distinct top-level and slice continuation paths and shares only part of its scanning with backlog-catalog. Existing grammar fixtures provide a baseline, not proof that every consolidation has landed. The audit confirms substantial parser behavior remains supported.

Still to settle: Characterize each remaining difference before changing it. Verify malformed and duplicate labels, indentation, fences, raw HTML, protected blocks, idempotence and unchanged dependency meaning. Keep actual defect fixes traceable to their linked bug records.

<a id="candidate-v3-release-gate-diagnostics"></a>

### Complete release-gate history diagnostics and checkout verification

[Tracked feature](../features/v3-release-gate-diagnostics.md). Finish the retained release-gate follow-ups for stale-branch versus genuine version decreases and robust verification of required checkout depth. Preserve current release policy and avoid reviving obsolete assertion shapes.

Retained outcome: The non-ASCII Git path issue now has a NUL-delimited reader and a real-Git regression. The other two retained outcomes still need explicit accounting: an accurate history-based diagnosis and a checkout/depth check that tolerates benign action-version or input-order edits.

Current evidence: `tools/release-gate.js` compares baseline and HEAD versions and emits a generic decrease message. CI currently has fetch-depth: 0, but current package tests do not check that requirement. The old brittle release-surface test was removed rather than repaired.

Still to settle: Settle exact history semantics before changing diagnostics or pass/fail policy. Verify stale branches, later genuine decreases and absent depth/checkout against benign workflow edits. Preserve the existing unusual-path regression.

<a id="candidate-v3-verification-infrastructure"></a>

### Maintain verification evidence, fixtures and measured efficiency

[Tracked feature](../features/v3-verification-infrastructure.md). Improve current verification tooling through explicit fixture ownership, safe evidence storage and measured reduction of unnecessary startup. Retire the unused 2.4.5 fixture only after reconciling supported upgrade checks.

Retained outcome: The user selected current verification outcomes, not reconstruction of the removed controller harness. Preserve fixture custody through failure/cancellation and safe recovery of proven-owned inactive residue. Keep evidence storage and integrity separate from acceptance interpretation. Measure actual startup costs before optimizing.

Current evidence: Current tests directly create v3 fixtures, and the old import/evaluator/registrar consumers were removed. The legacy 2.4.5 fixture still exists without current consumers found by the audit. Existing live acceptance drivers are retained under ignored .tmp; their graduation remains a separate recorded decision.

Still to settle: Inventory current fixture and evidence ownership, candidate binding and startup costs. Verify safe cleanup, uncertain liveness, stale/partial evidence, reproducibility and supported update paths before removing obsolete fixtures. The user closed the old import-generator and registrar refactors as superseded.

<a id="candidate-v3-run-preferences"></a>

### Preserve run preferences and enforce supported resource budgets

[Tracked feature](../features/v3-run-preferences.md). Complete the retained run-settings outcome across continuation: durable model and effort preferences, explicit requirements and substitutions, plus enforceable requested budgets with accurate accounting and honest unsupported limits.

Retained outcome: The old tier-derived caps and verifier lanes remain retired. Current runtime limits cover deadlines and dispatch attempts; token/cost limits require a separate verified mechanism. Restore any missing preference persistence and shared budget support without inventing a settings interview for each run.

Current evidence: `limits.js` accepts only deadlineUtc and maxDispatches; dispatch accepts candidates, requiredModel and substitutionReason per request. Existing budget bugs and handover quick wins own concrete accounting and allowance-settlement repairs.

Still to settle: Decide the preference source, scope and refresh rules, and which additional budget metrics can actually be enforced. Verify continuation, allowed substitution, unavailable required models, delayed usage and real exhaustion. Coordinate with existing budget entries instead of declaring their problems solved.

<a id="candidate-v3-git-repair-evidence"></a>

### Verify repair-commit and autosquash safety in ordinary delivery

[Tracked feature](../features/v3-git-repair-evidence.md). Complete the retained reliable repair-commit outcome using ordinary Git and project policy: establish ownership and the current safe fixup target, preserve unrelated work, honor hooks and verify the intended autosquash.

Retained outcome: The elaborate transaction engine and routine checkpoint autosquash remain retired. V3 relies on controller judgment and applicable Git conventions; the retained requirement still calls for concrete Git evidence and safe recovery when a fixup cannot be applied reliably.

Current evidence: `internal/workflow.md` delegates coherent commits and publication to project policy. The runtime records publication authority but exposes no repair-commit validation operation. This is an assurance/integration gap, not a requirement to build the old transaction engine.

Still to settle: Establish the minimal shared checks and actual remaining failure cases. Verify blame-based targeting, intervening edits, hook failure, authorized autosquash and interrupted operations using isolated repositories; never infer rewrite or publication authority from a review checkpoint.

<a id="candidate-v3-review-snapshot-reuse"></a>

### Capture review content once within an operation

[Tracked feature](../features/v3-review-snapshot-reuse.md). Complete the retained operation-local snapshot reuse requirement while preserving freshness and exact reviewed bytes. Reuse captured source and identity for governing artifacts and review copies where valid, without introducing a persistent cache.

Retained outcome: Shared content hashing is implemented, but the migration separately retained consistent reuse of captured bytes within one resolution or review preparation. A saved hash alone is not a reusable byte snapshot or proof that a later copy used those bytes.

Current evidence: `dispatchReview` snapshots the context, separately snapshots specs, then copies files and checks freshness. These guards protect the current flow; they do not implement the proposed single captured-content reuse.

Still to settle: Measure redundant acquisition, settle bounded ownership of captured bytes and retain every required live freshness check. Verify mid-capture changes, large inputs, selected ignored artifacts and equal identities for the content actually delivered to the reviewer.

<a id="candidate-v3-agreement-continuity"></a>

### Verify compatible agreement continuity across representation changes

[Tracked feature](../features/v3-agreement-continuity.md). Complete evidence for retained agreement behavior: qualified assent, compatible title or description edits, archival moves and repeated spec refinements preserve accepted commitments without enlarging the approval burden.

Retained outcome: Stable task IDs and commitment revisions exist, and policy separates compatible corrections from material decisions. The original re-keying and digest-drift needs require end-to-end evidence for ordinary index-only work and repeated revisions, beyond removal of the old digest implementation.

Current evidence: `lifecycle.js` keeps stable task IDs and commitment records; review tests bind assessments to requirements and spec bytes. The active permission-only recovery bug identifies one remaining invalidation boundary and stays the owner of that concrete repair.

Still to settle: Verify qualified assent, unchanged commitments under representation-only edits, archive movement and actual scope expansion on both hosts. Reconcile with the permission-recovery bug, retain material-decision gates and distinguish product gaps from missing acceptance evidence.

<a id="candidate-v3-additional-platforms"></a>

### Verify the complete lifecycle on macOS and Linux

User disposition on 2026-09-21: Additional-platform verification was skipped; macOS and Linux remain unverified. [Disposition record](../features/v3-continuations.md).

<a id="candidate-v3-active-controller-transfer"></a>

### Transfer active control between host sessions

User disposition on 2026-09-21: Active-controller transfer was skipped; the user identified post-switch adoption as the real use case, retained in the ownership bug. [Disposition record](../features/v3-continuations.md).

<a id="candidate-v3-independent-runs"></a>

### Support independent runs in one checkout

User disposition on 2026-09-21: Independent runs sharing one checkout were skipped; the supported single coordinated run remains unchanged. [Disposition record](../features/v3-continuations.md).

<a id="candidate-v3-host-relaunch"></a>

### Relaunch unfinished work after host exit or restart

[Tracked feature](../features/v3-host-relaunch.md). Restore unattended execution after a host exits or Windows restarts, beyond the currently supported user-driven reopen and reconciliation. Coordinate with Night Guard checkpointing without assuming it already restarts execution.

Retained outcome: Automatic relaunch was deliberately deferred; a host exit can currently end an unattended night. Resume only authorized unfinished work after reconciling real files, ownership and surviving processes.

Current evidence: The MVP and acceptance report explicitly exclude automatic host relaunch. Night Guard explores persistent checkpoints and shutdown coordination but leaves relaunch as a separate decision.

Still to settle: Settle the activation mechanism, user opt-in, credentials, restart bounds and stop/limit semantics. Verify crash, orderly exit, reboot and failed recovery without treating every exit as permission to restart.

<a id="candidate-v3-mixed-ending-repair"></a>

### Restore controlled mixed-line-ending repair

[Tracked feature](../features/v3-mixed-ending-repair.md). Restore inspected normalization of mixed LF/CRLF endings on the controlled backlog surface, using the effective project convention and preserving recoverability.

The audit mixed-endings probe leaves mixed bytes unchanged even with unwrap enabled, with no parser error or notice. The historical bug record describes the earlier approved mechanical repair and byte-exact backups.

<a id="candidate-v3-transport-maintenance"></a>

### Maintain bounded host transports and explicit runtime ownership

[Tracked feature](../features/v3-transport-maintenance.md). Assess current host transports for bounded efficient buffering, independently testable protocol decisions and one owner for every live timer. Preserve cancellation, stream closure and termination guarantees.

Current runtime and release host transports use pending maps, timers and stream parsing. Old controller-harness targets are gone. No current copying bottleneck or timer leak is asserted by the migration capture; characterize the actual implementation first.

## Verification and limits

The initial accounting ran ten focused cases: two release-gate, five runtime and three setup cases, all passing, plus a collector probe that reproduced its open defect. The independent audit ran 231 selected deterministic cases with no failures or skips, alongside eleven ordinary setup probes and two interruption probes. Its report names the exact scopes, assertions and recorded outcomes; these counts overlap in coverage and are not added into a unique total.

No full repository suite, current installed-model campaign, additional-platform campaign or implementation repair ran. Current host behavior not decided by existing bounded native evidence remains unverified. The independent report records source snapshots and confirms its 98 compared source/test/package files and HEAD stayed unchanged.

Tracking validation checks the actual Ready parser, complete disposition routing, local files and anchors, original ledger-field preservation, paragraph formatting, byte content and uniform line endings. Publication and implementation remain separate user decisions.
