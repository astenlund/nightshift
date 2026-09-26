# Bugs

V2 entries are preserved in [the historical index](migration/v2/BUGS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Contained-process tests fail intermittently on the Windows CI runner

Observed on 2026-09-25 in CI run `36188878030` for the 3.2.9 push (`14303b8`), whose diff changed no runtime or process code. Two tests failed on the first attempt and passed on a re-run of the failed job, and both files pass locally. `real contained check produces attributable termination evidence` (`tests/runtime-adoption.test.js`) runs `node --version` as a contained check with a 15-second timeout; it failed after 23.8 seconds with `operation-termination-unverified` from `runContained` in `internal/releases/processes.js`. `a read-only assessor receives private execution evidence with selected artifact=false` (`tests/runtime-probes.test.js`) failed after 14.3 seconds with `operation-timeout` from the same function, while its `selected artifact=true` sibling passed in 10.7 seconds. The CI auto-retry workflow left the run for a human because the failures do not match its infrastructure signature. The cause is unconfirmed. A plausible hypothesis is slow contained-process startup under runner load exceeding the fixtures' 10- and 15-second bounds; the adoption test's duration is consistent with a timeout firing first, because `runContained` checks descendant termination before rethrowing an already recorded failure, so a fired timeout followed by an unreconciled job surfaces as `operation-termination-unverified`, but a timeout firing in that run was not observed directly.

Establish the cause from the failure evidence before changing bounds, then make the tests deterministic on a loaded runner without weakening the containment assertions they exist to prove. Tracking does not authorize implementation.

**Requires:** none.

### Unwrap joins adjacent link reference definitions

Found on 2026-09-25 while writing fixtures in run `6e70931a-3760-46e2-b628-fdaa4a29f0e3`. The shared unwrap scanner (`scanWraps` in `internal/backlog-catalog.js`) treats two adjacent link reference definition lines (`[a]: x` followed by `[b]: y`) as one hard-wrapped paragraph. Ready then reports a hard-wrap notice, and `unwrap.js --write` would join them into one line (`[a]: x [b]: y`). Under CommonMark that line is no longer a definition, so both definitions are lost as paragraph text, while Ready's definition pattern, which has no end anchor, would still read the first as defined. The repository backlog has no reference definitions today, so nothing is affected yet. Pre-existing; the user chose to track it at triage.

Treat a link reference definition line as its own block in the unwrap scanner, so adjacent definitions are neither noticed nor joined, with unwrap and Ready fixtures. Shared catalog code, so keep the Ready link notices coherent and ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Shared block model misreads a fence opened on a list item's marker line

Found on 2026-09-25 in run `6e70931a-3760-46e2-b628-fdaa4a29f0e3`. The shared block model (`describeLines` in `internal/backlog-catalog.js`, used by unwrap and by Ready's link notices) does not recognize a fence opened on a list item's marker line (`- ```md`). It reads the fenced lines as list continuation and the closing fence as an opener, so every later line reads as fenced code. `unwrapText` on such a record joins the code onto the marker line and breaks the fence, which `--write` would persist. Ready inherits the misreading: the example link inside the fence is reported as broken, genuine broken links after the fence go unchecked, and a heading anchor or a record linked after the fence draws a false broken-anchor or unreachable notice. `internal/backlog-links.js` declares the construct unmodeled. The user chose to track it at triage.

Give the shared block model list-item context for a fence opened on a marker line, with unwrap and Ready fixtures, then remove the documented link-notice limitation. Behavior changes for both consumers ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Controller interrupts a progressing reviewer on file-size evidence

Reported on 2026-09-21 from `C:/Git/FeatherPod-Private`, Codex controller session `01a0c45b-1c48-79b0-aa45-f9c2fe9f814d`, bound plugin 3.2.2, run `f1eb7c88-b040-4200-95df-734faa05faea`, review worker `a8beeee5-d10f-406e-a22b-52e1a8df552c`. A revise-code dispatch started a Claude Fable lead with a Codex Astra fallback. For more than four minutes repeated `Get-ChildItem` observations showed the attempt's `events.jsonl` and `stderr.txt` at zero bytes while the Claude process was alive; the controller diagnosed a startup stall and terminated the verified child PID 39480, leaving the runner to start the fallback. A later `Get-Item` observation found a 945,803-byte event log with 282 events (181 system, 58 assistant, 35 user, 8 rate-limit) from `claude-fable-5-1`, session `a97db1ae-46ec-4c7a-ab5d-78c1becde026`, and no final result: the attempt had been working. The interrupted attempt cannot count as a completed review. The Astra fallback produced inspection events and was still running when the report was written. Evidence remains under that project's `.nightshift/runs/reviews/a8beeee5-d10f-406e-a22b-52e1a8df552c/`, including both attempts' event logs and stderr files. The user chose to track this at inbox triage on 2026-09-24.

The confirmed defect is terminating an unfinished reviewer on insufficient progress evidence. The zero-length readings were unexplained when reported. On 2026-09-24 in this repository, during review `e43fe6ef-1233-41eb-8ba0-886d0d441e4c`, `Get-ChildItem` listed the running attempt's `events.jsonl` at 0 bytes while `Get-Item` and an opened file handle both read 11,663,345 bytes, confirming on this machine that a directory listing can report a stale size for a file another process holds open for writing. Investigate which runtime liveness and progress signals a controller should rely on before declaring a stall; any size-based signal must read the file itself rather than a directory listing. Preserve genuine termination of stalled workers and the fallback path. Tracking does not authorize implementation.

**Requires:** none.

### Handed-over continuations lose unattended execution intent

During run-adoption delivery in this repository, run `b9b654ea-0368-40da-93dc-b212899db003` retained the user's original "scope looks good, handing over" authority but completed in attended mode on its retained 3.2.1 runtime because the root controller's continuation protection was unverified. The run continued across compaction, budget interruptions and user-authorized resumption; the user also reported a PC reboot, whose ordering relative to token exhaustion was unknown. This evidence establishes continued attended operation after handover, not an observed unattended-to-attended transition caused by any particular event. Successful 3.2.3 acceptance fixtures were separate from the root run and did not establish its continuation readiness. The [delivery acceptance report](reports/run-adoption-and-continuation-20260921.md) preserves the evidence and limitations.

On 2026-09-23 the user clarified that a continuation of a handed-over run should stay unattended, then explicitly chose track. Preserve the user's unattended handover intent across continuation, compaction, restarts and budget changes until the user explicitly pauses or revokes it. Missing or inactive host continuation is a recovery blocker to report and resolve, not a reason to silently reinterpret the work as attended or require renewed handover. Distinguish durable authority from current execution capability: retained intent alone must never be presented as verified continuation or override an explicit stop, an exhausted limit, ownership checks or host restrictions. Investigate how this intent is represented and restored, including when the host exposes no automatic recovery operation; concrete state and recovery design remain unsettled.

This is separate from [Handover leaves existing runs in attended mode](BUGS_HISTORY.md#handover-leaves-existing-runs-in-attended-mode), fixed in 3.2.0 by adding the in-place transition. It also extends beyond the shipped [renewed-handover reconciliation](BUGS_HISTORY.md#renewed-handover-yields-with-blocked-native-continuation): the requested invariant is persistence of unattended intent without another handover. Verify normal continuation, compaction, restart, budget exhaustion and renewal, unavailable mechanisms, successful restoration, explicit pause and revocation, preserving truthful readiness and safe execution in every case. Tracking does not authorize implementation.

**Requires:** none.

### Adoption replay bypasses fresh reconciliation after an intervening revision

Independent publication review of the local 3.2.3 candidate reported a minor mismatch in the lost-response replay shortcut in `internal/runtime/store.js`. Its isolated reproduction adopted a stopped revision 1 run at revision 2, resumed it at revision 3, then replayed the revision 1 adoption request. The shortcut returned the current running revision 3 state, while the [governing design](specs/run-adoption-and-continuation.md) requires fresh reconciliation after an intervening revision. No second ownership mutation or data loss was observed. Fresh skeptical validation and repair remain outstanding. [Triage evidence](reports/adoption-session-triage-20260922.md#adoption-replay-after-an-intervening-revision) preserves the user decision and reproduction.

Reconcile lost-response replay with the governing revision boundary while preserving safe retries when no intervening transition occurred. Validate the reported behavior and cover changed state before choosing a repair. Keep this minor replay issue separate from the subsequently observed takeover and continuation evidence in the [current acceptance report](reports/run-adoption-and-continuation-20260921.md). Tracking does not authorize implementation.

**Requires:** none.

### Executive governing scope is missing during early review

During the run-adoption specification work on 2026-09-21, the controller expanded and repeatedly reviewed a technical draft before creating and presenting the concise executive governing artifact. The user reported waiting roughly ninety minutes, and the conversation reached compaction first. Without that agreed baseline, review additions could not reliably be classified as refinements or scope expansion. Later creation and approval do not retroactively settle that question. No particular addition has been established as scope creep. [Triage evidence](reports/adoption-session-triage-20260922.md#missing-executive-governing-scope) preserves the user's corrections and the two run identities.

Investigate why the existing requirement for prompt, concise scope presentation did not produce the expected artifact and interaction. Preserve the distinction between a governing commitment and its technical elaboration, and between a small agreed readback and substantial work. Do not reinstate retired approval machinery or assume another rule is needed before distinguishing guidance, sequencing, presentation and controller-compliance failures. Tracking does not authorize implementation.

**Requires:** none.

### Available recovery is mistaken for a terminal blocker

In the run-adoption delivery, the controller reported acceptance blocked while an identified, authorized accounting investigation remained available. Automatic continuation pursued that investigation without a new grant or changed authority and produced actionable driver evidence. The earlier report had treated unfinished recovery work as an impasse. This is distinct from repeated reporting of an unchanged outcome and from whether the eventual custom tooling was proportionate. [Triage evidence](reports/adoption-session-triage-20260922.md#premature-blocker-classification) retains those boundaries.

Investigate how blocker classification accounts for remaining authorized investigation and recovery. Preserve genuine user, capability and resource boundaries, and keep recovery within the agreed outcome rather than treating autonomy as authority to expand tooling indefinitely. Coordinate with the existing [internal-ceiling authority issue](#controller-treats-internal-token-ceilings-as-user-owned-budget-decisions). Tracking does not authorize implementation.

**Requires:** none.

### Automatic blocker checks repeat handover reports

After the blocked-delivery report for run adoption was presented, two automatic goal continuations revalidated unchanged barriers. The controller emitted another blocker-status final and then repeated the full report without a new delivery result. The user described this as triple reports and could not distinguish it from the earlier premature-blocker incident. The duplication and unnecessary reporting/bookkeeping are observed; the respective roles of controller behavior, reporting guidance and goal continuation remain unverified. [Triage evidence](reports/adoption-session-triage-20260922.md#repeated-handover-reports) preserves the sequence.

Investigate how repeated blocker audits interact with report presentation and delivery acknowledgement. Preserve a complete initial handover and meaningful changes in outcome without treating every unchanged continuation as another handover. Do not infer receipt or a triage answer from an automatic continuation. Tracking does not authorize implementation.

**Requires:** none.

### Acceptance tooling expands beyond demonstrated verification needs

The run-adoption scope required reliable aggregate token accounting and evidence from real native sessions. The controller chose a substantial temporary harness under `.tmp/adoption-live`, then incurred repeated repair and independent-review work for that new machinery before obtaining any positive acceptance result. It also introduced a model restriction that was not a user requirement. The custom architecture and added restriction are established choices; whether the entire harness was avoidable or earlier tooling could have been reused remains unassessed. [Triage evidence](reports/adoption-session-triage-20260922.md#acceptance-tooling-expansion) records the accepted distinction.

Investigate proportionality, reuse and requirement discipline in selecting verification tooling. A review required after an introduced change does not by itself justify the change that created that burden. Preserve reliable accounting and native evidence without presuming a replacement framework or weakening acceptance. Coordinate with [verification infrastructure](features/v3-verification-infrastructure.md) and the existing [acceptance-evidence tooling question](QUICK_WINS.md#acceptance-reports-carry-a-checkable-evidence-digest). Keep general plugin guidance about capabilities and required strength rather than proliferating model-specific instructions. Tracking does not authorize implementation.

**Requires:** none.

### Report edits invalidate unrelated regression checks

Saved check snapshots in the run-adoption delivery covered 279 inputs. Two changes confined to the candidate report triggered 306-test source checks, with two intervening retries on unchanged inputs. The four executions totaled about 1,008 seconds of command runtime; equivalent added wall-clock delay is not established. The retries had a local failure-recovery rationale, but the broad input declaration coupled prose edits to behavioral regression checks without code changes. The cleanup-test failure they exposed has [its own entry](#windows-job-pipe-and-containment-fixtures-fail-outside-the-code-they-cover). [Triage evidence](reports/adoption-session-triage-20260922.md#report-triggered-regression-reruns) preserves the timestamps and snapshot comparison.

Investigate how verification obligations are scoped to their actual inputs and how unrelated edits invalidate them. Relevant changes must still invalidate evidence; avoiding unnecessary reruns must not turn missing coverage into a pass. Keep this registered-check issue distinct from [host-probe invalidation](#probe-evidence-about-the-host-is-discarded-on-any-edit) and [documentation ordering around assessment](QUICK_WINS.md#documentation-and-backlog-edits-land-before-the-first-cumulative-assessment). Tracking does not authorize implementation.

**Requires:** none.

### Permitted validation fallbacks are lost between runs

Prior specifications and executed campaigns already permitted Opus for Claude-specific checks and Astra for strong assessment. The run-adoption driver nevertheless hardcoded Fable on the Claude path and excluded the permitted validation fallback. With an availability warning already known, two actual Fable attempts produced no acceptance evidence and left 2,256,000 tokens conservatively held, not proven consumed. The user later identified the weekly cap and reset timing and reaffirmed the existing role distinction. The operational choice and exposure are separate from the broader harness-design issue. [Triage evidence](reports/adoption-session-triage-20260922.md#missed-validation-fallback) cites the prior agreement and observations.

Investigate why applicable model-role decisions were not carried into current selection and recovery. Distinguish host-specific behavioral validation from roles requiring a strong independent assessor; do not lower the strong-review gate or silently substitute contrary to an explicit user requirement. Generalize by capabilities, strength and availability, retaining concrete identities in configuration and evidence where necessary. This is separate from the older [worker-role acceptance-gate defect](#fable-only-acceptance-gate-rejects-supported-worker-roles). Tracking does not authorize implementation.

**Requires:** none.

### Retrospectives omit work-selection and policy failures

The recorded run-adoption retrospective described driver repairs, test failures and passing checks without assessing the proportionality of the machinery, why report edits triggered broad reruns, or why the existing validation fallback was not applied. The user identified these omissions afterward. Revise-lore already requests examination of workflow failures and ineffective rules, but independent review is specified for proposed instruction diffs rather than the conclusion that no proposal is needed. The runtime records nonempty retrospective evidence without assessing reflective quality. The later duplicate-report episode occurred after this retrospective and is not retroactively attributed to it. [Triage evidence](reports/adoption-session-triage-20260922.md#retrospective-coverage) preserves the bounded assessment.

Investigate the coverage failure and distinguish controller execution, skill framing and orchestration. Existing instructions covering a principle do not establish that they were followed or effective, and successful repairs do not establish that the work generating them was proportionate. Do not presume that more mandatory reviews or duplicate instructions are the remedy. Coordinate with [retrospective treatment of tool warnings](#tool-warnings-dismissed-without-assessing-their-retrospective-value) while preserving the distinct evidence. Tracking does not authorize implementation.

**Requires:** none.

### [Interrupted template creation is accepted as a complete existing file](bugs/setup-partial-template-recovery.md)

The audit partial-template probe injected a failed FEATURES.md write leaving only "# Feat". On retry initialize skipped the existing file, created the other targets and reported completion with no parser error or notice.

Recognize and recover owned incomplete template creation instead of accepting existence as completion. Preserve genuinely customized pre-existing content and refuse ambiguous ownership rather than overwriting it. Cover partial creation, response loss, retry, changed partial output, genuine customized content and unavailable recovery evidence. Keep this new-file failure distinct from damage to an existing file during unwrap. [The report](bugs/setup-partial-template-recovery.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### [Exploring and Ready omit explicit parser problem reporting requirements](bugs/exploring-parser-diagnostics.md)

The shipped-feature audit found that Exploring no longer explicitly requires presentation of structuralErrors, notices and indexes.missing, or conditions its empty-draft message on a clean parse. Ready also lacks an explicit missing-index requirement. Parser data and existing visibility tests survive; current installed-host rendering of these branches was not tested.

Restore complete, truthful problem-channel reporting in the skill instructions while preserving complete draft visibility and the distinction between failed parsing, missing indexes and a genuinely empty set. When Ready identifies a setup or migration prerequisite, name and offer the relevant skill; a reported Codex response omitted init-backlog even though the parser named it. Use appropriate installed-host evidence for parser failure, structural errors, notices, missing indexes, actionable recovery suggestions and clean empty results on both hosts. The earlier Ready link-rendering campaign does not establish Exploring diagnostic behavior. [The report](bugs/exploring-parser-diagnostics.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### [Migration turns private exclusions into shared ignore rules](bugs/migration-private-ignore-source.md)

The audit private-ignore-source probe began with .git/info/exclude owning the legacy file exclusion. After migration the new destination was ignored by a root .gitignore rule. The ignored boolean survived, but its private storage choice did not.

Preserve the effective private/shared policy choice when relocating backlog content. Do not convert clone-local exclusions into shared repository rules merely to restore an ignored flag. Cover local, shared and global sources, masking parent rules, tracked exceptions, interrupted relocation and reruns. Distinguish preservation of an existing choice from choosing a destination for new exclusions. [The report](bugs/migration-private-ignore-source.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### [New setup templates ignore effective project newline policy](bugs/setup-template-newline-policy.md)

In the audit git-newline-policy probe Git reported text:set and eol:lf, but new FEATURES.md bytes used CRLF. Current initialize converts template text unconditionally to CRLF.

Materialize missing templates according to the effective supported project newline policy, keeping logical template content and existing files intact. Resolve genuine ambiguity rather than silently overriding an established convention. Cover explicit LF and CRLF policies, defaults, existing files, missing targets and interruption. This concerns new-file creation, not normalization of an existing mixed-ending file. [The report](bugs/setup-template-newline-policy.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### [Setup inspection omits current backlog completeness](bugs/setup-current-home-inspection.md)

The audit existing-current-inspection probe used malformed .nightshift/FEATURES.md. Inspect returned backlog:null because no legacy files would move; apply later rejected it after creating other missing files. Current-home missing targets and repair opportunities are not part of the migration-only inspection result.

Inspect the current supported scaffold and expose its completeness and parser problems before apply. Keep observed project facts separate from repair proposals and make the reduced meaning of migration status explicit. Cover fresh, partial and existing current-home catalogs, malformed entries, missing targets, no legacy inventory and failed probes. Validate current state before dependent writes; do not treat creation of owned inspection recovery storage as inherently a product defect. [The report](bugs/setup-current-home-inspection.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### [Setup does not diagnose actual pre-v3 recovery residue](bugs/setup-legacy-recovery-residue.md)

The audit legacy-recovery-residue probe left old root setup lock/election names and .tmp/revise-state.md unclassified while inspect and initialize returned normally. Its sentinels establish missing diagnosis, not a live old writer. The existing unfinished-run migration fixture constructs current SQLite state at a legacy path, not real pre-v3 state.

Identify relevant legacy recovery formats before dependent migration and define safe preservation, supported transition or explicit refusal. Never grant old records new write authority merely because their names are familiar. Use real historical record shapes for missing, complete, interrupted, conflicting and potentially live-owner cases. Preserve evidence and require sound ownership before transition or cleanup; keep unverified historical state explicit. [The report](bugs/setup-legacy-recovery-residue.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### [Fresh setup does not distinguish non-Git roots from broken Git metadata](bugs/setup-repository-classification.md)

The independent fresh-non-git probe succeeded but wrote root and setup Git policy files. A malformed .git indirection also succeeded. The probes used GIT_CEILING_DIRECTORIES so the containing checkout could not be mistaken for the fixture repository.

Distinguish absent Git from failed or malformed repository discovery before applying Git policy. Preserve supported fresh non-Git initialization while keeping unusable Git metadata an explicit diagnosis. Cover genuine non-Git roots, normal repositories, broken .git indirections, unavailable Git and enclosing repositories. Do not conflate this fresh-path classification gap with legacy non-Git migration. [The report](bugs/setup-repository-classification.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### [Legacy backlog migration fails in non-Git projects](bugs/setup-nongit-migration.md)

The independent legacy-non-git probe failed with git-failed when a valid legacy FEATURES.md was present; the source remained unchanged. Fresh non-Git initialization succeeds, correcting the earlier blanket missing-support claim.

Support safe legacy backlog migration without a Git repository, preserving content and references without requiring Git index or ignore operations. The user explicitly narrowed restoration to this migration gap. Cover fresh and existing non-Git roots, migration conflicts, interrupted relocation and byte preservation. Repository detection and unnecessary policy-file writes are separate tracked behavior. [The report](bugs/setup-nongit-migration.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### [Overlapping Markdown roots can lose or duplicate collected files](bugs/overlapping-markdown-root-deduplication.md)

A fresh two-file collector probe emitted a repeated direct file twice, duplicated the index when the root was repeated and omitted the child record when its directory preceded the parent root. Parent-before-child and normal single-root collection retained both files.

Return every eligible file once while preserving its accepted authority. Track traversal coverage separately from emitted-file identity so deduplication cannot create omissions. Cover repeated files and roots, both nested-root orders, aliases and ordinary single-root behavior. Preserve the relevant mutation authority and compare complete outputs, not only counts. [The report](bugs/overlapping-markdown-root-deduplication.md) preserves evidence and related work. Tracking does not authorize implementation.

**Requires:** none.

### Missing session activation blocks agreed work until restart

Observed once on 2026-09-18 in this repository on Claude Code with installed Nightshift 3.1.1. After `/clear`, Ready preparation and parsing succeeded, but creating the subsequently agreed attended run was refused because the native session had no recorded activation for the current hook generation. Status reported the hooks configured, enabled and usable, while activation was absent for this window; another window had an activation for the same registration and generation. Quitting and resuming restored activation, and the unchanged create request succeeded with the same session ID. The missing activation and recovery are recorded observations; whether `/clear` caused the failure, whether the hook ran at startup or clear, and whether it failed or its record was removed remain unverified. The detailed incident and evidence limitations are preserved in [the report](bugs/missing-session-activation-blocks-agreed-work.md).

Investigate how activation was missed and repair the confirmed cause or recovery gap without treating Ready success or configured hooks as proof of native activation. Distinguish startup, clear and resume behavior, preserve actionable failure evidence, and verify that genuinely missing activation still prevents dependent operations. Compare with [hook inspection cost](QUICK_WINS.md#hook-path-native-settings-resolution-cost) and [the Codex launcher hypothesis](#codex-hook-launcher-may-lose-the-plugin-root-under-powershell) without assuming a shared cause. Tracking does not authorize implementation.

**Requires:** none.

### Stop hook resists a pause the user asked for after handover

Observed on 2026-09-19 on installed Claude Code 2.1.277 with plugin 3.2.0, fixture `claude-ed2c0a87` of the handover acceptance campaign, recorded in [the acceptance report](reports/handover-transition-and-morning-report-20260919.md). A user who was still present handed an attended run over and asked the controller to stop for a moment until they confirmed. The in-place `handover` had just made the run unattended, so the Stop hook blocked the yield: the fixture history shows three `continuation-reminder` entries before the three-reminder bound released it, and each blocked stop re-read a large context; that pass, which also covered both handovers and closing out the worker, cost about 2,500,000 tokens. The controller held correctly through all three reminders and edited nothing, but it did not record the hold as a user decision, which is the only pause the hook permits. On Codex CLI 0.154.0 the same request led the controller to record the handover without a mechanism and tell the user not to leave yet, so no hook resistance occurred. The hook behaved as designed; what is missing is a sanctioned way to express a user-requested hold after handover.

Decide how such a hold is expressed and state it in `skills/handover/SKILL.md` and the brief: for example the controller records a user-decision blocker, which the Stop hook already permits as a conversational pause, or defers the continuation mechanism until the user confirms they are leaving. Preserve the protection against a premature yield for every other case, and do not count reminders against a hold the user asked for. Verify on both installed hosts with a present user who asks for a hold after handover, and with the ordinary absent-user case unchanged. Tracking does not authorize implementation.

**Requires:** none.

### Probe evidence about the host is discarded on any edit

Observed on 2026-09-17 in this repository, attended run `c675a074-6431-46e2-85b7-e3b8616e9220` on the development runtime at the 3.1.1 candidate, during the revise-code cumulative assessment loop with Fable 5.1 as controller, leads and skeptics. Across seven strong lead dispatches on the automatic-preparation change, the reviewer asked as an execution probe whether the nested `claude --print --safe-mode` session that resolves effective settings fires the profile's registered hooks. The question was answered by execution in the second dispatch (no hooks fired, with `CLAUDECODE=1` inherited), again in the fifth against a populated profile and two projects, and again in the sixth with the exact production command shape under both a nested and a clean environment, with the same answer each time. After every repair batch the runtime treated the recorded probe evidence as obsolete because the reviewed inputs had changed, the next fresh lead had no way to know the question was settled, and it raised the same important finding and requested the same probe. That cost three additional strong dispatches and three re-executions of a settled question.

The mechanism is the documented one: stored probe evidence joins a re-dispatch only while inputs still match, and changed inputs omit it while retaining its artifacts and history. That is correct for evidence about the changed bytes and wrong for evidence about the host. Whether a safe-mode session fires hooks, what files it writes and how it resolves settings precedence do not depend on which lines of a source file changed, yet the runtime cannot tell the two kinds of evidence apart, and the retained artifacts and history are not visible to the next reviewer. The loop therefore cannot converge on its own once a repair is needed after a probe, and it turns the repair discipline against itself: the honest response to a confirmed finding is an edit, and every edit erases the evidence that closed the recurring finding. The workaround in that run was to write the executed host evidence into the acceptance report, so that it became part of the reviewed inputs a fresh reviewer reads, and then to stop editing.

A second symptom of the same binding appeared in the same loop. A probe request is bound to the snapshot of the receipt that asked for it, so a documentation edit that lands after a receipt arrives makes its pending probes unrunnable, and the only path is another dispatch. The guidance in `internal/runtime/REFERENCE.md` then said to land documentation before dispatch or after import; since 3.2.5 it says to land documentation edits after the task advances to documentation, but it still does not mention that an edit also invalidates pending probe requests.

Let settled evidence about host behavior reach the next reviewer across edits that do not bear on it, without weakening invalidation of evidence about the changed content, and state in the reference what an edit does to pending probe requests. Open, and not assessed by the report: whether the remedy is a probe evidence kind that survives unrelated edits, an explicit way for the controller to attach prior probe records to a new dispatch, or surfacing prior probe history to the lead so it can decide; and whether reviewers would still re-ask given visible history. Verify with an executed case in which a host-behavior probe is answered, a repair edit follows, and the next fresh lead receives the earlier result, alongside a case in which evidence about edited content is still withheld. The runtime records of run `c675a074` hold every probe request, receipt and result referenced here. Original inbox report: `2026-09-17-probe-evidence-discarded-on-any-edit.md`. Tracking does not authorize implementation.

Recurred in run `d4a44daa-96be-4ac4-bcaa-d16d8596584f` on 2026-09-18 to 19, the handover transition and morning report delivery, which spent 14,869,844 review tokens across 18 dispatches, summed from that run's review receipts, and 14,445,999 live-verification tokens on a change of roughly 400 lines, with four already tracked defects firing during it. Here, supplying an evidence digest as a selected artifact changed the reviewed inputs, so the probe records an incomplete assessment had just requested were not attached to the next dispatch, and an earlier incomplete assessment's probes were lost the same way after a repair.

Recurred again on 2026-09-25 in run `ff195382-31a4-4fea-bb48-ca56d20507bb`, the 3.2.8 start-failure detail delivery. The Astra lead `890e1dd4-b514-43cd-b9a3-90ea8963e1ae` came back clean after its execution probes passed. The documentation stage then added one sentence to `internal/runtime/REFERENCE.md` and archived two backlog entries, which dropped that evidence: the required cumulative lead `76de4327-4b2c-43fc-a39f-b2ca261361f0` came back incomplete and requested equivalent probes, costing one more dispatch and two more probe runs before `84e03146-af45-4a4f-bfb3-0f2596074ac1` came back clean. The leads also asked to run test files that the run had already recorded as passing named checks; whether recorded check evidence reaches the reviewer at all was not established. The user chose to track this recurrence at triage.

The related [decision-and-experiment evidence feature](features/v3-review-decision-context.md) owns the broader delivery of relevant prior decisions and conclusions to later reviews. This bug remains the concrete owner of host-probe invalidation behavior; neither entry is declared fixed by tracking the other.

**Requires:** none.

### Codex hook launcher may lose the plugin root under PowerShell

Hypothesis reported on 2026-09-14 from `C:/Git/aoa-registration-of-arrival`, Codex thread `01a09f41-ef3e-7831-94fa-99a22bb52d44`, installed plugin 3.0.12. During an ordinary rebase session the user saw a couple of Codex harness hook failures. The interface showed only "Hook failed" and "hook exited with code 1"; the transcript and the inspected local logs yielded neither the failed hook's identity nor its stderr. The 3.0.12 `hooks/hooks.json` registered SessionStart, Stop and PreCompact with `node "${CLAUDE_PLUGIN_ROOT}/internal/runtime/hook.js"`, and the user's default shell is PowerShell.

Confirmed by a shell reproduction with empty JSON input under PowerShell 7 with `-NoProfile` and Node.js v22.23.2: running the installed hook by its absolute path exited 0 and printed `{}`, while running the exact configured command through `pwsh -NoProfile -Command`, with `CLAUDE_PLUGIN_ROOT` set in the child environment, exited 1 with `MODULE_NOT_FOUND` for `C:\internal\runtime\hook.js`. PowerShell reads `${CLAUDE_PLUGIN_ROOT}` as a regular variable rather than an environment variable, so an environment value alone leaves it unset and the path collapses. Not established: that Codex runs hook commands through that shell path, whether the harness substitutes plugin placeholders before any shell sees the command, or that this caused the observed failures. SessionStart and Stop sharing the launcher is consistent with a pair of failures and nothing more. The reproduction used the 3.0.12 payload; at triage on 2026-09-18 the current `hooks/codex.json` still launches through the same placeholder form, and the hooks that host setup registers under `internal/releases` have not been checked against this hypothesis.

Investigate before selecting any fix: capture the actual Codex hook command, the selected shell, the placeholder substitution behavior and the stderr of a failing hook on the supported Windows host, for both the bundled hooks and the registered user hooks. If shell expansion is responsible, the launcher must resolve the plugin root correctly on that host, with coverage for the actual Windows harness invocation. Consider whether hook-failure diagnostics can preserve actionable stderr, so that an exit code alone does not require this investigation again. Original inbox report: `2026-09-14-codex-hook-exit-1-powershell-plugin-root.md`. Tracking does not authorize implementation.

**Requires:** none.

### Permission-only recovery invalidates accepted specs

Observed during retained-release delivery in this repository, run `2a89bde5-9c0c-4ba5-b67f-dadc545bfcc4`, Codex session `01a09c60-dd6e-7d42-b8a0-7333fd211d92`. The user approved exporting the already-scoped implementation and review context to Astra. Resolving the approval blocker with `unblock` appended that transport permission to the engineering agreement, advanced its requirements revision and reopened the previously accepted governing-spec task, although the engineering commitments had not changed. The subsequent code-assessment dispatch stopped before any model call because the spec gate was no longer satisfied. The user chose to track this defect during follow-up triage on 2026-09-15. The run preserves the original approval resolution and the `permission-unblock-invalidates-spec` follow-up.

Distinguish permission or capability recovery from consequential changes to the agreed engineering requirements. Preserve valid spec agreement and assessment evidence when only the ability to perform authorized work changes; continue to invalidate affected evidence when scope or requirements actually change. Verify both cases, including a permission-only review-export approval and a genuine change of commitments, without weakening ownership, approval or evidence-freshness checks. This is separate from the external approval rejection itself, tracked in [Review-transfer approval interrupts an authorized handover](#review-transfer-approval-interrupts-an-authorized-handover). Tracking does not authorize implementation.

Recurred in run `d4a44daa-96be-4ac4-bcaa-d16d8596584f` on 2026-09-18 to 19, the handover transition and morning report delivery, which spent 14,869,844 review tokens across 18 dispatches, summed from that run's review receipts, and 14,445,999 live-verification tokens on a change of roughly 400 lines, with four already tracked defects firing during it. Here, `unblock` on a budget blocker, resolved by the user raising the live-verification allowance, reopened the accepted governing-spec task and staled the clean code assessment. It was partly legitimate, since the spec named the old allowance, but it cost a sixth whole-spec assessment and a further code cycle.

Related case observed on 2026-09-23 during installed 3.2.3 run-adoption acceptance, source run `1d6e1aca-8683-4a54-b5a4-42ea65a7caa5`: clearing a user-requested execution hold after client restoration of the existing paused native goal invalidated clean assessment `ae9ae937-c1e2-4f80-92f2-d3917ca1cddb`, although the reviewed files were unchanged. The `user-decision` unblock appended an agreement decision and advanced the requirements revision, forcing a fresh strong assessment. The behavior is observed; whether this execution-only checkpoint should alter commitment freshness remains unresolved. The user chose track on 2026-09-23. Delivery run `b9b654ea-0368-40da-93dc-b212899db003` preserves follow-up `unchanged-client-restoration-hold-invalidates-review`; raw native events and the client-restoration receipt are under `.tmp/adoption-live/candidate-physical-gate/actors/astra-reviewer-adopter/`, including `goal-restorations/003ba8e8-cfc8-4727-92c6-faeefa947621`. Investigate this execution-hold case alongside permission/capability recovery without assuming every cleared user decision preserves scope. Tracking does not authorize implementation.

The [agreement-continuity feature](features/v3-agreement-continuity.md) carries related qualified-assent, compatible wording, archival and repeated-revision acceptance cases. This bug retains its specific permission/capability recovery repair.

**Requires:** none.

### Controller treats internal token ceilings as user-owned budget decisions

Observed during the self-hosting lifecycle activation repair on 2026-09-13. The user granted 1,000,000 aggregate live-verification tokens. The controller imposed a 60,000-token checkpoint threshold, interrupted a Codex probe at 64,130 reported tokens, and then held 885,870 tokens as uncertain exposure. It repeatedly paused for permission to change its own controls even though the user allowance had not been shown exhausted. The user identified this as a bug, clarified that the controller has full authority to raise its own ceiling within the allowance, requested tracking, and reiterated autonomy as the first core directive. Run 3a98dc79-b675-43c6-8236-1b997c443680 preserves the follow-up and authority clarification; the checkpoint audit is under .tmp/self-hosting-verification.

Repair the distinction between the user-owned aggregate budget and controller-owned probe ceilings, admission estimates and reservations. Resize internal controls and recover autonomously within the existing allowance; do not turn a low internal threshold or speculative hold into a new approval boundary. Preserve actual usage and qualified uncertainty, and distinguish an operational estimate from measured consumption or a proven maximum. A genuinely exhausted user allowance or a proposed increase beyond it remains a user boundary. Verify both recovery within an existing grant and actual exhaustion, keeping autonomy first without silently redefining the granted budget. This entry tracks the workflow defect; the current repair only adjusts its own scratch controls.

A later review in the same run exposed a distinct enforcement failure in the controller's scratch harness: the metering callback threw at its threshold, but the copied Claude transport caught that callback exception as malformed input and continued the model process. The controller observed 427,223 reviewer tokens, stopped the dedicated processes, and confirmed their absence. Combined reported checkpoint and reviewer usage reached 1,250,632 tokens, exceeding the 1,000,000 allowance by at least 250,632; further interrupted usage remains unmeasured. No review verdict was accepted. The scratch callback path was repaired to terminate the host on error, with a provider-free regression control. Preserve the distinction between this ineffective enforcement and the earlier unnecessary approval pause when repairing the workflow; neither permits exceeding a user-owned allowance.

The user subsequently granted an additional 2,000,000 tokens and requested carrying forward both the initial 500,000-token estimate being too conservative and the subsequent overshoot. Track estimation calibration as part of this diagnosis: estimate the complete native probe and independent review/repair cycle, including repeated context, necessary recovery and verification of the spending controls. The observed retained-review context became expensive on every further read. An estimate, an internal admission ceiling and the user-owned aggregate allowance are different quantities; neither underestimation nor ineffective enforcement authorizes an overrun.

Later reconciliation also found that Claude streaming assistant events carried placeholder output counts, while persisted completed-response records contained the finalized output usage. Reconciliation added 30,779 tokens to the additional allowance ledger, taking its accounted usage to 1,996,820; some interrupted output remains unmeasured. Include accurate final response accounting and deliberately controlled stop boundaries in the follow-up. Streaming lower bounds, conservative reservations and actual consumption must remain distinguishable.

**Requires:** none.

### Tool warnings dismissed without assessing their retrospective value

Observed during inbox triage in this repository on 2026-09-13: sandboxed Git repeatedly warned that `C:/Users/asten/.config/git/ignore` was inaccessible with permission denied, while `git status --short` reported `.claude/` as untracked. The controller treated the warning as incidental, explicitly described it to the independent reviewer as a "harmless warning", and reported the untracked directory without qualifying the missing ignore configuration. The user explained that the directory was ignored in their normal shell. After the user moved the rule to `.git/info/exclude`, checks confirmed the directory was ignored and status was clean; after removal of the global ignore file, checks also confirmed the warning was gone. The warning had affected the interpretation of repository status despite successful Git exit codes. This session performed inbox triage and did not run revise-lore, so it does not demonstrate a failure inside an executed retrospective.

The user reports that no revise-lore in earlier sessions, today or previously, mentioned this warning and suspects those runs dismissed it similarly. That recurrence and the earlier retrospectives' access to the warning have not been independently verified. Investigate prior run evidence before claiming a repeated revise-lore omission. Track the workflow concern separately from the repaired local ignore configuration and from the existing bug about omitting required lifecycle stages altogether.

Investigate and repair how consequential tool warnings and capability limitations are assessed and carried into session retrospectives. Assess their effect on evidence and user-facing claims before labeling them harmless or passing that characterization to reviewers; a successful command alone does not establish that its warnings are irrelevant. When revise-lore runs, make relevant observed warnings and their disposition available for consideration, including minor issues that caused misleading claims or user intervention. Preserve the distinction between an assessed warning with no worthwhile follow-up, a resolved incident with a reusable lesson, and an unresolved limitation; do not manufacture instruction changes for every warning. Verify warning capture and retrospective consideration with installed-host evidence, including a successful command whose warning changes result interpretation, and distinguish unverified historical recurrence from observed behavior. Evidence: this inbox-triage conversation, its Git outputs and the independent-review dispatch describing the warning as harmless.

**Requires:** none.

### Git-history review probes lack the evidence they need

Reported on 2026-09-12 from `C:/Git/FeatherPod-Private`, handover run `655d10db-0f93-436c-8b41-86a882761ced`, Fable review `bf2af192-0d39-4b29-b09d-6274f7663bb9` on Claude, dispatched with plugin 3.0.8 and collected after the installed cache changed to 3.0.9. The lead found no current code defects but returned an incomplete assessment for missing commit-citation and commit-composition evidence. Its three probes requested plain `git log`, `git show` and `git status` without fixture files. The runtime created independent empty Git repositories: log and show exited 128, while status listed the copied project as untracked. Each probe reported `canonicalUnchanged=true`, but none established the requested canonical history. The runtime reference already documents that history-dependent probes need deliberately prepared Git fixtures; the reviewer supplied none. The controller supplied a separate read-only canonical Git audit artifact and dispatched fresh skeptic validation. The report preserves the original incomplete assessment and raw probe results without establishing the later validation outcome.

Investigate and repair preparation and validation of history-dependent review evidence so requested probes can decide commit-citation and commit-composition claims. Distinguish a private snapshot's synthetic Git state from the canonical repository history, and validate that the selected evidence surface contains the history and metadata the claim requires. Preserve private-copy isolation and canonical write restrictions. When adequate evidence is unavailable, keep the assessment incomplete and identify the missing evidence rather than treating an unchanged canonical tree as proof of the history claim. Verify both adequate-history and missing-history cases, including the misleading success of `git status` in a newly initialized snapshot. Original inbox report: `2026-09-12-featherpod-review-git-probe-evidence-gap.md`.

**Requires:** none.

### Review-transfer approval interrupts an authorized handover

Reported on 2026-09-12 from `C:/Git/FeatherPod-Private`, plugin 3.0.10 after an in-session update from 3.0.9, run `288d395f-2cb9-4d7f-bd8c-f4ff78d8c0c2`, controller Codex session `01a096c8-2a36-7ea0-b6b5-d07bbb2bf5e2`. The user approved the investigated readback for two push-page toggle fixes and explicitly handed over delivery. A Fable lead review initially failed in the sandbox before a reviewer session existed, then launched under escalation and completed with findings, receipt `e81d8668-3a43-49c4-9a22-a7d9165615c0`. Automatic approval review subsequently rejected the fresh Astra skeptic invocation, `node .tmp/nightshift-run.cjs .tmp/assurance-skeptic.json`, before launch because it considered export of private repository code and review context to the external reviewer destination insufficiently authorized. The rejection prohibited bypassing it through a workaround. The controller recorded a user-decision blocker at revision 21, paused with no skeptic running and eventually marked the native goal blocked after repeated continuations.

The controller initially attributed the interruption to the handover lacking explicit private-code transfer authorization. The user corrected this: the handover authorized working through completion, including reviews. The controller acknowledged that authorization and the separate approval system's inconsistent treatment of the launches. After the snapshot/context destinations were described as the configured Codex/OpenAI and Claude reviewer sessions, the user renewed the handover and requested the incident report. The observed rejection is distinct from the later premature yield and manual goal resumption, and from the existing Claude Code runtime-create classifier issue.

Investigate approval handling for required review dispatches within an authorized handover and repair inaccurate attribution of approval denials to missing user authority. Preserve established authorization across the lifecycle while accurately reporting an external approval system's rejection, affected action and stated reason. Respect that system's enforcement and prohibition on workarounds; do not treat handover as a bypass. Establish what authorized recovery or concrete user intervention is available when a launch is denied, continue unaffected work where possible and report unresolved capability limits. Verify allowed and denied review-launch paths, including a denied skeptic after a successful lead review, without claiming that Nightshift can guarantee external approval. Original inbox report: `2026-09-12-featherpod-review-transfer-approval-interruption.md`.

**Requires:** none.
**External:** Codex automatic approval-review behavior that the plugin cannot change.

### Fable-only acceptance gate rejects supported worker roles

Minor issue in the temporary acceptance-test harness, tracked on 2026-09-10 for repair when that harness is reused. `verifyFableAssessors` in `.tmp/v3-fable-assessor-policy.cjs` accepts only reviewer and skeptic workers, so a permitted implementer, supervisor or reviewer peer can incorrectly fail a case. Completed MVP cases were unaffected; the Nightshift runtime supports these roles.

Reconcile the gate with the staffing permitted by the test scenario while retaining applicable host/model restrictions. Add focused controls for permitted roles and rejected models before reuse. Preserve historical case evidence. The original diagnosis and reproduced implementer rejection are in `.tmp/fable-allocation-review-f4c6f3c6-7ae5-4248-b938-ed7bb5e14fc7/audit/report.md` and its `private/fable-policy-probe.json`.

**Requires:** none.
**External:** User decision to reuse the temporary acceptance harness.

### Temporary acceptance controls are unsafe to rerun in place

Minor test-infrastructure issue, tracked on 2026-09-10 for repair before these controls are reused. In `.tmp/v3-fable256-preparation/controls`, `start-order-control.cjs` writes its generated helper and result beside itself, so an in-place rerun can overwrite saved evidence. `docs-diff-assessment.cjs` compares against the current Git HEAD, so committing the assessed changes makes its original check fail on an empty diff.

Give retained controls explicit output locations and fixed input baselines, with focused checks that reruns preserve earlier artifacts and evaluate the intended change. Until then, use private copies and preserve the recorded results. The historical verdicts remain supported; this is a reuse limitation. Evidence: `.tmp/fable-allocation-review-f4c6f3c6-7ae5-4248-b938-ed7bb5e14fc7/audit/report.md` and its `private/tests/start-order-control.json`.

**Requires:** none.
**External:** User decision to reuse the temporary acceptance controls.

### Compaction/resume acceptance harness needs precision repairs

Minor test-infrastructure follow-up, tracked on 2026-09-10 for recheck and repair before harness reuse. A review of `.tmp/v3-claude-pressure-resume.cjs` and its preparation material recorded five issues: an incorrect grant-path instruction, overstated preflight coverage, incomplete hash binding of closed-segment artifacts, non-malformed stops labeled as malformed evidence, and a monitoring race that can misclassify a successful completion. The last two issues did not change the recorded token charge basis.

Reconcile these findings against the retained versions before changing anything. Align instructions and coverage claims with actual launch checks, make retained evidence dependencies explicit, and distinguish stop causes and successful completion accurately. Add focused model-free controls for whichever defects remain. Preserve the original artifacts and accepted case qualifications; do not replay completed native cases merely to tidy their reports. Evidence: `.tmp/fable-pressure69-review-241e0b96-348a-4894-ba82-85da528ab537/audit/report.md`, including its reviewed hashes and deciding controls.

**Requires:** none.
**External:** User decision to reuse the temporary compaction/resume harness.

### Directory ignore probe can misreport tracked backlog directories as ignored

Reported from an init-backlog run in another project on 2026-09-11. The original reproduction is unverified; a deterministic trigger found later is recorded at the end of this paragraph. `inspect` reported `.claude/features`, `.claude/bugs` and `.claude/patterns` as ignored although all three held tracked files. `Setup.inspect` and `Setup.preservePolicies` (`internal/setup.js`) derive that flag from `git check-ignore --no-index -q -- <dir>/`. While the failure was live on git 2.55.0.windows.3, that command reported a match on a blank `.gitignore` line for every directory in the tree, a copied `.gitignore` reproduced it in a fresh probe repository, and deleting any single line cleared it; the same probe without `--no-index` or without the trailing slash answered correctly. Forty-five minutes later the identical bytes no longer triggered it anywhere, so no deterministic trigger was known at that point. On 2026-09-11 a second probe in this repository reproduced it deterministically: with a CRLF root `.gitignore` containing a blank line, trailing or interior, `git check-ignore --no-index --verbose -z --stdin` reported that empty line (pattern `''`) as matching every directory path given with a trailing slash (`.claude/bugs/`, `.claude/plans/`, tracked `.claude/features/`), while file paths in the same call were unaffected and the same content with LF endings did not trigger it. Under that trigger, consulting the index but keeping the trailing slash still misreports the untracked directory; only dropping the trailing slash answers correctly for both. The probe shape is recorded in the breakout file. Apply wrote no spurious rules only because the destination probe returned the same false positive; had it cleared between the source and destination checks, the tool would have ignored the new backlog directories while the migrated tracked files still passed the final tracking check.

Treat this as a robustness gap: classify a directory containing tracked files as visible regardless of the probe result, avoid the `--no-index` plus trailing-slash combination, and add a fixture asserting that a directory with tracked children is never reported as ignored. The full observation record is in [`bugs/init-backlog-check-ignore-directory-false-positive.md`](bugs/init-backlog-check-ignore-directory-false-positive.md).

**Requires:** none.

### Auto-mode classifier denies the runtime CLI

Observed on 2026-09-11 in this repository under Claude Code auto mode while starting an explicitly handed-over run. `node internal/runtime/cli.js <project> <request.json>` with a `create` request was refused by the auto-mode permission classifier twice, first as "Unauthorized Persistence" when chained with the `continuation` and `status` calls, then as "Instruction Poisoning" on its own. The request described an unattended run, hooks-based continuation and the controller session binding, which appears to read as a persistence or injection attempt. Without the create step no lifecycle operation can run, so an auto-mode controller cannot start, review, close or resume a run; the user had to run the create manually.

Establish which part of the invocation triggers the classifier (the CLI path, the request prose, or the chained calls) with a reproducible probe, then decide between documenting a permission rule for auto-mode users in the README and skills, restructuring the request or invocation so routine run operations are not misclassified, or both. Treat the denial as a capability blocker in the handover skill until then, so a controller reports it instead of retrying.

**Requires:** none.
**External:** Claude Code auto-mode classifier behavior that the plugin cannot change.

### Windows job pipe and containment fixtures fail outside the code they cover

Observed on 2026-09-12 in this repository on Windows 11 with Node v26.6.0 while running the deterministic suite for an unrelated runtime change. In `tests/runtime-hosts.test.js`, the `--no-input-leaf` case of "Windows pipes keep output and cancellation live while stdin is pending" fails deterministically, also on a checkout without the unrelated change: the test writes 256 KiB to a child that reads no input and kills it after 500 ms, and the assertion that the job emptied fails with the collected error `write EOF`. The case "Windows job containment carries the actual host protocol and proves descendants have ended" fails only when the whole CI file list runs in one `node --test` invocation: the `descendant` fixture's `descendant.pid` does not exist when the test reads it after a 2.5 second timeout, and the same case passes when the file runs alone. Both cases are skipped off Windows, so CI on `windows-latest` is where they can surface.

A related failure recurred on 2026-09-22 under Node 22.23.2 during run-adoption verification: two default-concurrency runs passed 305 of 306 tests but the same `--no-input-leaf` case reported "Windows job closed without verified descendant cleanup" with `jobEmpty` false. Both cancellation variants passed in isolation, and the complete set passed sequentially without source edits or timeout changes. One failing run overlapped other native fixtures; the other did not. Actual process leakage, the precise cause and identity with the earlier Node 26 failure remain unverified. The [triage evidence](reports/adoption-session-triage-20260922.md#cancellation-cleanup-verification) preserves this recurrence separately from the unnecessary trigger for those broad reruns.

Establish whether the `write EOF` comes from the job runner closing the child's stdin before the 256 KiB write drains under Node 26, or from a Node change in pipe semantics, and make the fixture assert the intended containment property rather than the incidental write outcome; give the descendant fixture a start-up signal or a longer budget so the containment case does not depend on scheduler load. Evidence: full-suite run and isolated reruns on 2026-09-12, recorded in the session that shipped the unattended wait and pause change.

Investigate the newer Node 22 failure without assuming those earlier explanations apply. Distinguish actual containment failure from missing verification, pipe behavior and fixture timing; a successful sequential run does not explain the concurrent failures. Tracking this recurrence does not authorize implementation.

**Requires:** none.

## History

Prior delivered work remains in [BUGS_HISTORY.md](BUGS_HISTORY.md).
