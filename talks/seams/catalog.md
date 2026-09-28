# Seams catalog

Evidence for the keynote question "How do you trust the results without reviewing the code yourself?" Each entry is an event from Nightshift's own reports, tagged by the seam it illustrates, with verbatim quotes and line references so every slide claim can be traced to its source. The [slide outline](outline.md) cites entries by their IDs.

## How to read this

- **Seams:** S1 Agreement, S2 Independent review, S3 Staleness, S4 Skeptic and cumulative re-review, S5 Continuity, S6 Handover and autonomy, S7 Closing, L Limits.
- **Origin:** *organic* happened unplanned during real work; *designed* was provoked by an acceptance test, fixture or probe; *descriptive* states a rule or test result without an incident. What a model did on its own inside a designed scenario is marked organic.
- **Enforcement:** *hard* means the runtime or a mechanical check decided or refused it; *soft* means model judgment or written procedure. On slides, draw hard seams as solid gates and soft seams as dashed ones.
- **Strength:** 1 to 5, how well the entry is likely to make a technical audience nod.
- **Quotes** are verbatim and cite `source:line`; they were machine-checked against the cited lines on 2026-09-28. Report sources are abbreviated as the filename without its date; see [Sources](#sources).
- Numbers marked *derived* are arithmetic on a report's figures, not stated by it.
- Check [Slide cautions](#slide-cautions) before anything goes on a slide.

## R. Running example: one run, five seams

A Claude Code controller running Fable, with Astra on Codex as reviewer, in the dedicated pressure case of the 64M acceptance campaign. It passes through most of the argument in one sequence and ends with S7.1. It is an acceptance fixture: the product task and the history pressure were arranged for the test, and the parallel Codex case states a seeded defect (`v3-acceptance-64m:35`). The reviewer hang, the regression and the recovery were not scripted.

1. **The reviewer hangs** (S6, S2).
   - `v3-acceptance-64m:53` "The first Astra lead produced 28,895 message deltas over about 899 seconds, mostly structural whitespace, without completing its turn."
   - `v3-acceptance-64m:53` "That timeout reclaimed the job, and a fresh same-host Fable reviewer returned a complete broad assessment with three findings. Partial output claiming complete never became a receipt."
2. **Compaction with three findings open** (S5).
   - `v3-acceptance-64m:55` "At revision 12, all three actual findings remain unresolved and the complete authority, agreement, worker and evidence projection is captured."
   - `v3-acceptance-64m:55` "A native boundary with explicit auto trigger then reduces recorded history from 215,588 to 17,531 tokens, dropping 198,057 in 99,396 milliseconds. Actual-state recall is verified at unchanged revision 12 before validation and product edits."
   - `v3-acceptance-64m:55` "Inspection of 80 Bash commands and 30 file-edit calls found no manual compaction or observer tampering."
3. **A fresh skeptic confirms and classifies** (S4).
   - `v3-acceptance-64m:57` "A fresh Astra skeptic confirms the three findings. Atomicity and meaningful contract checks are required; diagnostic detail is optional."
4. **Tests go green, and the new tests are shown able to fail.**
   - `v3-acceptance-64m:57` "The candidate passes 14 tests and the existing limited nine-case product oracle; four new tests fail against the original module."
5. **Cumulative re-review finds a regression the tests missed** (S4).
   - `v3-acceptance-64m:59` "The next Astra assessment remains incomplete and identifies an important regression: operations.forEach skips missing array slots."
   - `v3-acceptance-64m:59` "Explicit undefined throws TypeError and preserves the input, but sparse-only operations incorrectly succeed and a trailing hole after an increment changes [10] to [15]. Independent execution reproduces both failures. Passing the limited tests and oracle is therefore insufficient for clean cumulative assurance."
   - `v3-acceptance-64m:61` "The current review gate is false, all three workers are collected, and retrospective and triage fields are empty."
6. **The budget runs out; the run is not declared done** (S7).
   - `v3-acceptance-64m:51` "The case remains incomplete at revision 34, with a new important cumulative-review finding and no closing or local commit."
   - `v3-acceptance-64m:94` "The system preserved that issue instead of declaring completion."
7. **It finishes later, and the record corrects the model's own summary** (S7).
   - `v3-acceptance-272m:13` "later completion at runtime revision 131"
   - `v3-acceptance-272m:52` "The completed Claude pressure fixture's triage summary undercounts its work. Durable records show 10 findings across four imported assessments: six implemented, three skipped and one deferred. Its summary says nine findings, three rounds and two skips."

**Numbers:** 28,895 deltas in about 899 seconds; 215,588 to 17,531 tokens; 3 findings confirmed; 14 tests and a 9-case oracle green; 4 new tests fail against the original; stopped at revision 34, completed at 131; 10 findings in the record against 9 in the summary.

## S1. Agreement: "It'll build the wrong thing"

### S1.1 The scope drifted while the user waited

*organic, soft, strength 4.* The controller expanded and reviewed a technical draft for about 90 minutes before showing the user the concise scope, and the user could no longer tell refinements from additions. This is the origin story for presenting the draft while independent review runs. It also serves as a limit.

- `adoption-session-triage:38` "The controller expanded and reviewed a technical draft before creating and presenting the concise governing artifact. The user reported roughly ninety minutes of waiting, and compaction occurred before the final executive presentation."
- `adoption-session-triage:38` "Without it, the user could not reliably distinguish review refinements from scope expansion. Later approval of the executive scope does not prove that earlier additions were agreed; no specific addition has been classified as scope creep."
- `adoption-session-triage:40` "Existing v3 instructions already require prompt presentation alongside independent assessment."

### S1.2 No edits until the turn after "yes"

*designed, soft rule graded mechanically, strength 3.* After a real bug in which Ready follow-ups went straight into implementation, the fix was accepted on both hosts from native event logs rather than from what the model said.

- `ready-selection-boundary:22` "In both work attempts the event logs show project edits only in the turn after the readback was agreed; earlier turns wrote only launcher request files in the project's ignored `.tmp`."
- `ready-selection-boundary:7` "Grading used each attempt's native event log (tool calls and file changes per turn) and, for the handover case, the fixture's own `state.sqlite` history, not the model's prose."

**Numbers:** 7 attempts, 2,857,992 metered tokens (`ready-selection-boundary:9`).

### S1.3 Blocked on the user's real decision

*designed scenario, organic response, soft, strength 4.* A mid-run request changed a committed behavior and deliberately left ordering open. The controller kept the approved design, recorded the open choice and waited.

- `v3-acceptance-128m:43` "The later material request changes duplicate rejection to collapsing but deliberately leaves ordering undecided. The controller preserves the earlier approved design, records the unresolved choice without selecting a fallback or transferring approval, and completes the independent NOTES update. The new run remains blocked on the real user decision."
- `v3-acceptance-128m:43` "After an actual first-occurrence-order choice, the complete revised draft receives fresh whole-spec assessment and is separately presented for agreement."

### S1.4 Spec review found a real defect before any code existed

*organic finding, soft, strength 4.* The skeptic could not verify the finding by reading, so a private probe supplied the evidence and a rejection rule entered the spec before agreement.

- `v3-acceptance-128m:39` "A real encoding finding identifies escaped unpaired surrogates whose UTF-8 encoding loses identity. The first skeptic remains unverified; a private Node probe supplies deciding evidence, followed by fresh confirmation, a proposed rejection rule and whole-spec reassessment."
- `v3-acceptance-272m:30` "The presentation case made the complete stable draft available at ordinal 307, 07:32:35 UTC, after actual independent Astra dispatch and before its completion or receipt."

**Notes:** the 128M run did not yet show the overlap (`v3-acceptance-128m:45` "It does not demonstrate concurrent human and AI review"); 272M did. Do not present the presentation case's findings as confirmed defects: they were never validated (`v3-acceptance-272m:46` "with five unvalidated findings and unanswered product decisions").

### S1.5 Agreement is scoped, including spend and publication

*organic, soft, strength 3.* Agreements record what the user authorized, including a token budget and whether publication is allowed, and a user's triage decision overrides the system's recommendation.

- `paused-strong-gate:3` "Governing agreement: the user selected "Paused strong gate pauses repair application", approved the scoped readback, directed continuing in the same task, granted 1,000,000 aggregate tokens for live testing and handed over."
- `paused-strong-gate:3` "Publication is not authorized."
- `v3-migration-followups:747` "The user said post-switch adoption is the real use case. Keep adoption in the existing ownership work; do not add active controller transfer as a feature."

### S1.6 Before and after: v2's digest gate against v3's gate

*designed, hard, strength 3.* v3 dropped a twelve-field digest protocol and lets the user read the draft while review runs, but implementation still cannot start without an agreed, reviewed spec.

- `pre-v3-shipped-capability-audit:95` "Twelve-field digest, normalized selector grammar, co-governing expansion and special archive no-op"
- `pre-v3-shipped-capability-audit:92` "Agreement replacement deliberately changes timing from pre-review approval to review/presentation overlap while keeping implementation gated."
- `pre-v3-shipped-capability-audit:92` "`tests/runtime.test.js:101` rejects dependent start without agreed-spec review; regression cases at `tests/runtime-regressions.test.js:16,36,51,85` reject nonexistent, stale or wrong governing evidence."
- `pre-v3-shipped-capability-audit:94` "Present as policy; specific model behavior unverified"

## S2. Independent review: "It's grading its own homework"

### S2.1 A reviewer that became controller could not count its own review

*designed, hard, strength 5.* The literal refusal of self-grading.

- `run-adoption-and-continuation:20` "A real Codex reviewer later became the controller: its own unimported d140 receipt was refused after resume, stayed unchanged and unimported, and a fresh independent ae9 assessment was accepted."
- `run-adoption-and-continuation:20` "Failed or incomplete assessments remained recorded and were recovered rather than counted clean."

### S2.2 Both strong reviewers unavailable, and the gate held

*organic, hard gate with a soft choice, strength 5.* Astra's allowance was gone and the host refused Fable for exceeding its limit. An available Opus review was recorded as advisory only, and publication waited for a real strong review.

- `automatic-plugin-preparation:62` "Independent assurance for this repair is incomplete. The supported strong reviewers are `claude-fable-5-1` and `gpt-6-astra`; the Codex allowance carrying Astra was unavailable, and a dispatch attempting Fable was refused by the host for exceeding its limit, preserved as a failed attempt under the run's review records. A fresh Opus pass was used as an advisory review only and is deliberately not recorded as the cumulative assessment."
- `automatic-plugin-preparation:62` "The user's standing requirement is that a supported strong reviewer assess this change before any publication."
- `automatic-plugin-preparation:66` "The supported strong cumulative assessment then ran on Fable: receipt `694f7f33`, complete, with no critical or important findings."
- `run-adoption-and-continuation:38` "Formal strong Claude-authored receipts remain unavailable under the candidate's Fable-only classifier while Fable is capped; the user-approved Opus validation fallback does not bypass that formal gate."

### S2.3 Self-review was the easy path, and it was refused

*designed unavailability, hard in the dispatcher and organic in the controller, strength 5.* With the required reviewer unavailable, the dispatcher failed closed at zero cost, and a controller told to use that reviewer recorded a blocker instead of reviewing its own work.

- `v3-acceptance-16m:38` "A complementary native case requiring only the unavailable Fable model failed closed as expected, produced one failure record and no receipt, and reported zero tokens. Supplying a forbidden substitute alongside that explicit requirement was rejected before another call."
- `v3-acceptance-32m:77` "The actual Astra controller preserved the Fable-only requirement and recorded a capability blocker instead of substituting available Astra. No review dispatch or participant ran."
- `v3-acceptance-32m:79` "The structured final report accurately leaves both required work and the run incomplete."
- `v3-acceptance-272m:18` "Required unavailable Astra work remained incomplete while permitted Fable review continued"

### S2.4 Green tests were not trust

*organic, soft, strength 5.* An independent read-only audit treated the earlier accounting as leads and found eight more issues, including data loss (L1), while every selected test passed. It was an audit of setup tooling requested during triage, not a lifecycle gate; present it that way.

- `pre-v3-shipped-capability-audit:5` "This is an independent, read-only product assessment requested while the controller conducts triage. It is not a clean implementation review, delivery run, or publication gate."
- `pre-v3-shipped-capability-audit:15` "There were 231 passing deterministic cases in the selected checks and eleven ordinary setup probes, plus two interruption probes. Passing existing tests did not detect the confirmed regressions."
- `v3-capability-reconciliation:11` "55 initially captured items plus eight additional audit findings."
- `v3-capability-reconciliation:25` "Passing existing tests does not turn these counterexamples into successful preservation."

### S2.5 The reviewer insisted on execution, and its test exposed three bugs

*organic, soft, strength 5.* Two of three code reviews came back incomplete because descriptions were not evidence. The fixture the first reviewer proposed exposed three real defects.

- `handover-transition-and-morning-report:13` "The implementation received three code assessments by `gpt-6-astra`. The first two returned incomplete and asked for execution evidence. An observation fixture proposed by the first exposed three real gaps, which were fixed before re-dispatch: a run created unattended stays blocked after a mechanism-less handover, so an unverifiable handover now starts attended; the SessionStart notice used one wording for every state; and a still-running handed-over run received no notice."
- `self-hosting-lifecycle-activation:11` "Those descriptions alone are not acceptance evidence for execution."

### S2.6 Cross-host review in both directions, read-only

*designed, hard, strength 3.* Each host's work was reviewed by the other host's model in a read-only sandbox; when the reviewer needed test output, the controller ran it in a private copy and returned the evidence.

- `v3-acceptance-16m:3` "Both Windows hosts have now completed a controlled small-change handover through durable closure and actual cross-host review."
- `v3-acceptance-16m:26` "Its reviewer could not execute the requested test command in its read-only sandbox. The controller ran a bounded private-copy probe and returned evidence for independent assessment."
- `v3-acceptance:41` "Each returned exactly its assigned verdict, passed native attribution and strict receipt validation, and ended with verified process cleanup."

### S2.7 No strong reviewer, so repairs pause

*designed, soft, strength 4.* Decision probes on both hosts: with only an advisory reviewer, affected repairs pause while unrelated work continues. Pair with S2.2 for the real-work version.

- `paused-strong-gate:18` "| Only an advisory reviewer available | Pause affected repairs; advisory read supplies no required coverage | Pass | Pass |"
- `paused-strong-gate:21` "| Earlier batch applied but lacks strong assessment | Preserve its unresolved review obligation and pause the next batch | Pass | Pass |"
- `paused-strong-gate:23` "Both hosts allowed unrelated authorized work to continue in every checkpoint and retained the requirement for strong assessment of the full cumulative change after repairs."
- `paused-strong-gate:9` "They do not exercise native skill activation, runtime dispatch, actual file repair, real rate limits, recovery from provider failure or Stop-hook behavior. No such end-to-end claim is made."

**Numbers:** 10 of 10 decisions correct, 5 checkpoints on 2 hosts; 32,908 tokens (`paused-strong-gate:29`).

### S2.8 Weak, narrow, failed or empty reviews cannot pass

*descriptive, hard, strength 3.* Test-backed gate rules, with attribution and tampering covered.

- `pre-v3-shipped-capability-audit:77` "`:110` rejects missing, narrow, weak, failed and empty-evidence assessments."
- `v3-capability-reconciliation:55` "cover native report tampering, model fallback and rerouting, complete skeptic assignments and reviewed-input drift."

## S3. Staleness: "They'll change it after it's approved"

### S3.1 A paid review was thrown away because its inputs changed

*organic, hard, strength 5.* The controller's own concurrent documentation work changed files under a running spec review. The review was refused as evidence and its cost stayed on the books. The runtime documents this refusal as `invalid-receipt` (`internal/runtime/REFERENCE.md:87`); the report does not name the code.

- `v3-acceptance-32m:27` "The first spec assessment failed when concurrent documentation work changed captured inputs. It produced no usable receipt, and its 125,622 tokens remain charged. The controller recovered with later valid assessments."

### S3.2 One stray image blocked a finished review

*organic, hard, strength 5.* The spec was unchanged, but an unrelated file appeared after the review snapshot, so the completed review could not be imported until a replacement excluded that exact path.

- `adoption-session-triage:28` "An unrelated image materialized under `.codex-remote-attachments/` after the snapshot for review `516fb299-3276-4804-a65b-75df021f4afe`. The spec was unchanged, but the completed assessment could not be imported because the input inventory had changed."
- `adoption-session-triage:30` "The user chose: "skip, but log a memory. if it happens again, we'll do something about it then.""

### S3.3 What strictness costs

*organic, hard, strength 4.* Honest cost of byte-bound evidence: edits to a report alone invalidated behavioral checks, and a known bug discards more evidence than it needs to.

- `adoption-session-triage:68` "Comparison of the saved 279-input source-check snapshots shows two report-only edits triggering 306-test checks, with two unchanged-input retries between them."
- `adoption-session-triage:68` "Their test runtimes were approximately 145.6, 161.5, 420.1 and 281.0 seconds, totaling about seventeen minutes."
- `adoption-session-triage:70` "The upstream problem was the broad input declaration making a report edit invalidate unrelated behavioral checks."
- `v3-capability-reconciliation:209` "The active bug "Probe evidence about the host is discarded on any edit" is a concrete subset"

### S3.4 The product's freshness check was stricter than its testers

*organic, hard, strength 4.* The acceptance harness tried to validate a superseded receipt; production validation rejected it.

- `v3-acceptance-32m:31` "Its external verifier selected the engine's older task-owned receipt after a later cumulative receipt had covered both engine and CLI. Production freshness validation correctly rejected the obsolete receipt."
- `v3-acceptance-32m:110` "Verification must follow actual coverage and freshness, not assume each task's last locally attached receipt is authoritative."

### S3.5 Earlier failures stay failures

*organic, hard, strength 3.* Evidence is bound to the inputs it ran against, in both directions.

- `recoverable-unwrap:15` "later source changes do not turn those earlier failures into passing evidence."
- `paused-strong-gate:23` "Checks recorded in the runtime are tied to current input hashes."
- `pre-v3-shipped-capability-audit:93` "`tests/runtime-review.test.js:600` rejects changed subject and governing-spec commitments"

### S3.6 The auditor bound its own evidence to bytes

*organic, hard in the audit's own tooling, strength 3.* The audit's conclusions apply to exactly the code it examined.

- `pre-v3-shipped-capability-audit:241` "Final source verification compared 98 current source/test/tool/package files with the executed snapshot and found no changed bytes; HEAD is unchanged."

## S4. Skeptic and cumulative re-review: "Reviewers hallucinate, and fixes break things"

### S4.1 Tests passed; cumulative re-review found a regression

*organic, soft finding behind a hard gate, strength 5.* Steps 4 and 5 of the running example. The best single answer to "fixes break things".

- `v3-acceptance-64m:94` "The Fable repair also shows why passing tests cannot replace broad re-review: the reviewer found sparse-input behavior outside the limited oracle."

### S4.2 The skeptic rejected 15 of 20 findings

*organic, hard requirement with soft verdicts, strength 5.* In the largest Codex run, most findings did not survive validation, the agreed contract stayed unchanged, and the accepted improvements were re-reviewed cumulatively.

- `v3-acceptance-32m:15` "13 findings independently refuted; the supplied contract stayed unchanged"
- `v3-acceptance-32m:18` "Two code concerns refuted; diagnostic-label consistency and empty-batch file creation explicitly skipped as optional"
- `v3-acceptance-32m:19` "All three accepted improvements received subsequent strong broad review; the latest receipt covers engine and CLI together"
- `v3-acceptance-32m:25` "All 20 finding dispositions have attributable independent skeptical evidence. The external audit reproduced the deciding behavior, including historical before/after controls for diagnostic and test improvements. It did not treat agent agreement as proof."

**Numbers:** 15 refuted (13 spec, 2 code), 3 implemented, 2 skipped; a 75% refutation rate is *derived*. 17 assessment attempts cost 12,502,283 tokens (`v3-acceptance-32m:100`).

### S4.3 Cross-host spec review converged

*organic, mixed, strength 5.* Astra on Codex reviewed a spec written under a Fable controller; fresh Fable skeptics validated every finding.

- `handover-transition-and-morning-report:11` "The governing spec received five whole-spec assessments by `gpt-6-astra` on Codex, each strong, independent and broad. Fourteen findings were confirmed by fresh `claude-fable-5-1` skeptics and repaired in four batches; the single fifth-pass finding was refuted with evidence and needed no edit."
- `handover-transition-and-morning-report:69` "they totalled 10,463,681 tokens across the thirteen dispatches before the final cycle and 14,869,844 across all eighteen (six spec, six code and six skeptic dispatches)."

### S4.4 The recoverable-unwrap arc

*organic, soft, strength 5.* One delivery shows the whole loop. Inside the lifecycle: reviewers found bugs, the next pass found variants the fixes missed, repeated findings forced a shared-cause repair, and one suspected bug was refuted by running the code. After the lifecycle, see L2.

- `recoverable-unwrap:15` "Independent private probes found and fresh skeptical validation confirmed three implementation gaps: a replaced alias hid an orphan canonical-target record, a writer failure during Ready's read bypassed its initial preflight, and migration omitted locks outside the prose catalog."
- `recoverable-unwrap:17` "Further assessment and skeptical validation identified the write-mode no-op variant of the read race, the directory-junction variant of orphan discovery, and omitted predecessor results in setup errors."
- `recoverable-unwrap:19` "The repeated selection/reporting findings led to a shared-cause repair: coordination artifacts are classified by their guarded directory or file rather than by the artifact's own filename, and the complete standalone input set is validated before recovery can mutate anything."
- `recoverable-unwrap:19` "A separate suspected legacy-junction clean-success case was refuted by actual setup execution: existing Ready validation already blocks it; its diagnostic now retains the parser's complete recovery-location details."

### S4.5 A clean review, then a bug, a half fix, and tests proven able to fail

*organic, mixed, strength 5.* A clean review preceded the discovery that a user's hook opt-out was ignored. The first repair covered two of three paths; independent assessment caught the gap. Tests were then shown to fail against the old behavior, and a strong assessment found the one site that had not been checked that way.

- `automatic-plugin-preparation:7` "The 3.1.1 implementation had a clean cumulative code assessment when this report was written, before the hook-disabling defect was found and repaired; the reassessment covering that repair is outstanding."
- `automatic-plugin-preparation:56` "An initial pass covered only registration and Ready, which left the two paths resolving different directories inside one session; independent assessment identified that gap and it was closed by resolving every admission path against the same project."
- `automatic-plugin-preparation:58` "The repaired admission, registration, Ready-view and bootstrap-routing sites were probed for vacuity by restoring their pre-repair semantics and confirming the covering cases fail, with the source restored byte-identically and verified by digest; the hook path's working-directory fallback was not among them until a strong assessment noted the gap, and is now covered by its own case."
- `automatic-plugin-preparation:15` "Independent assessment found and freshly validated interrupted-first-registration recovery, old-session administrative routing, contradictory activation prose, the old-binding admission boundary, and recovery rewriting already-applied hooks. Those findings were repaired with cumulative reassessment."

**Note:** the report does not say who first found the hook-disabling defect; do not claim more on a slide.

### S4.6 Each fix introduced the next bug

*organic bugs found by designed probes, soft, strength 4.* A relatable, low-stakes version of S4.4.

- `ready-exploring-presentation:11` "Earlier probes exposed plain source paths, a wrong directory base in the first link clarification, and Windows backslash escaping in a subsequent clarification. Each finding received independent review and skeptical validation before repair."
- `ready-exploring-presentation:9` "A deterministic check verified all 16 final Exploring link destinations"

### S4.7 A skeptic overstepped, and the whole report was rejected

*organic, hard, strength 4.* The skeptic did its assigned job, then slipped in an unassigned finding. The consumer rejected the entire report; the fix bound verdicts to assignments rather than loosening the check.

- `v3-acceptance:33` "The skeptic corrected the count to nine of ten and returned the assigned verdict, but also inserted an unassigned README observation into its findings list. The producer schema permitted the extra item; the strict consumer correctly rejected the entire report."
- `v3-acceptance:35` "No failed native output was rewritten or imported as a fabricated receipt."
- `v3-acceptance:80` "No assurance rule was weakened to obtain a pass."

### S4.8 Cumulative review kept finding holes in Nightshift's own gates

*organic, hard once repaired, strength 4.* Reviewing Nightshift's own source, successive passes found gaps in the trust machinery itself. Also usable as a limit: the staleness seam had leaks until review found them.

- `v3-acceptance-32m:51` "They also found that reviewed docs could complete after their reviewed inputs changed, including a change after task completion but before final run acceptance."
- `v3-acceptance-32m:55` "The next cumulative review found that non-code tasks could also ignore failed or stale registered checks. Independent validation confirmed this across 31 public-runtime controls, including reviewed specs, unreviewed maintenance and failures registered after task completion."
- `v3-acceptance-32m:57` "Cumulative assessment revalidated the repair and identified the separate artifact issue, so the commit was not treated as clean overall acceptance."
- `v3-acceptance-32m:67` "Further review found that Windows case aliases could bypass an explicit exclusion or cause duplicate copies."

### S4.9 Skepticism also corrects false alarms

*organic, soft, strength 4.* The audit overturned an earlier claim that was too pessimistic and split the real problem into separate defects.

- `pre-v3-shipped-capability-audit:19` "The provisional accounting and follow-up report supplied leads, not acceptance authority."
- `pre-v3-shipped-capability-audit:13` "The earlier blanket non-Git description needs correction: fresh non-Git initialization does run successfully. It nevertheless writes Git ignore files, and non-Git legacy migration fails."

### S4.10 Before and after: v2's review ceremony against cumulative re-review

*designed, hard, strength 4.* v2 used fixed budgets and a literal LGTM. v3 has one rule: a repair voids the pass, and only a new cumulative assessment restores it.

- `pre-v3-shipped-capability-audit:82` "Hard-coded 30-round, 10-verifier and three-repair budgets"
- `pre-v3-shipped-capability-audit:81` "Full per-cell wave, N/A remap, mandatory second holistic look and literal-LGTM rule"
- `pre-v3-shipped-capability-audit:78` "`tests/runtime.test.js:123` applies a repair, proves gate false, imports a new cumulative assessment, proves true, then changes a sibling and proves false."
- `pre-v3-shipped-capability-audit:81` "`tests/runtime.test.js:140` proves a no-edit refutation can close under a completed broad assessment."
- `v3-capability-reconciliation:85` "they do not certify that every controller notices recurrence."

### S4.11 Before and after: every finding gets its own skeptic

*designed, hard, strength 4.* v2's cheap judge could share one verdict across findings and failed open. v3 rejects a missing or mismatched verdict.

- `pre-v3-shipped-capability-audit:130` "Dedup-before-verify: low-effort judge, chained sharedVerdictFrom protocol and fail-open judge path"
- `pre-v3-shipped-capability-audit:79` "`review.js:113-140` rejects missing/mismatched skeptic claims. `tests/runtime-review.test.js:301` rejects an empty answer for an assigned finding"
- `pre-v3-shipped-capability-audit:80` "Required findings cannot be skipped merely for cost."
- `pre-v3-shipped-capability-audit:131` "These tests do not prove that a model never merges materially different claims before assignment."

## S5. Continuity: "It forgets when the context fills up"

### S5.1 Open findings survived compaction on both hosts

*designed pressure, hard state, strength 5.* Findings were captured in durable state before a real compaction, and recovery read that state rather than relying on the model's memory. Step 2 of the running example is the Claude side.

- `v3-acceptance-64m:39` "The saved revision 9 checkpoint preserves all four real unresolved findings and the complete agreement, worker and evidence projection."
- `v3-acceptance-64m:41` "Recovery correctly rereads durable state; this is not a memory-only recall claim."
- `v3-acceptance-64m:92` "The dedicated pressure scenario now exercises the original concern directly: a real finding must survive compaction before independent validation and repair."
- `v3-acceptance-272m:54` "Compaction evidence establishes behavior at the observed reduced window, not attention throughout a full one-million-token context."

### S5.2 The Codex session died, and Claude took over the same run

*organic, hard, strength 5.* Continuity across hosts in real work, under the user's explicit authority, recorded in the run's history, finished and published.

- `automatic-plugin-preparation:3` "Work was paused at the user's request because tokens were running low, and resumed on 2026-09-17."
- `automatic-plugin-preparation:52` "Run `c675a074-6431-46e2-85b7-e3b8616e9220` was adopted by a Claude controller after the original Codex session became unavailable, and resumed under explicit user authority. The runtime records the previous owner, the adopting identity and that authority; the transfer used the store's own transaction and is in the run history."
- `automatic-plugin-preparation:66` "Version 3.1.1 was then published to `main` at the user's direction in commit `95ed0b4`."

### S5.3 All eight takeover combinations, with real refusals

*designed, hard, strength 4.* Same-host and cross-host takeovers on installed hosts: live controllers, former owners and unknown activity were all refused.

- `run-adoption-and-continuation:3` "The 3.2.3 candidate demonstrated all eight same-host and cross-host takeover combinations on installed Claude Code and Codex."
- `run-adoption-and-continuation:5` "Active or unknown work prevents takeover. Adoption leaves the new owner stopped and attended until reconciliation and explicit resumption."
- `run-adoption-and-continuation:18` "Both hosts obtained real controller claims, refused a live controller and rejected a former owner's mutation. Both refused unknown worker activity, then adopted after receiving a genuine completed helper's native export and reconciled its nonterminal record before resuming."
- `run-adoption-and-continuation:30` "Each host then attempted ordinary adoption of the opposite running source and received controller-activity-unknown, preserving the original state and owner."

### S5.4 `stale-owner` fired without being planned

*organic event in a designed campaign, hard, strength 4.* The Stop hook's reminder had advanced the revision, so the controller's first claim was refused until it re-read status.

- `unattended-stop-hook:30` "In both resumed attempts the first claim was refused with `stale-owner`, because the Stop hook's reminder had advanced the revision, and the controller re-read status before claiming."

### S5.5 A second session could not take over an occupied run

*designed, hard, strength 4.* The one-time side effect happened exactly once.

- `v3-acceptance-272m:36` "preserved the occupied run when a distinct native session attempted to continue it."
- `v3-acceptance-272m:36` "Reopening that same native session and delivering resume authority led to the once-only 90-byte CRLF note, unchanged sentinel and completion of the same run at revision 7."
- `v3-acceptance-128m:23` "The owner reconciles stopped state, files and the absent waiter before invoking runtime resume under the actual new authority."

### S5.6 Restart and compaction on an installed release

*designed, hard, strength 3.*

- `retained-plugin-releases:52` "A real bound Codex fixture run survived process restart and native compaction. A distinct post-compaction model turn read the retained runtime and recovered the same run id, resource identity and unresolved decision."

### S5.7 A gap only the publication reviewer found

*organic, strength 4.* Replaying an old adoption request returned current state instead of forcing fresh reconciliation. No harm resulted, and at the time of the report it had not yet been validated or repaired. Also usable as a limit.

- `adoption-session-triage:86` "The independent publication reviewer reported a minor mismatch in `internal/runtime/store.js`: a stopped revision 1 run was adopted at revision 2, resumed at revision 3, and an old revision 1 adoption request was then replayed. It returned current running state instead of requiring fresh reconciliation. The reproduction observed no second ownership mutation or data loss."

### S5.8 Before and after: durable state replaced a scratch checkpoint

*descriptive, hard, strength 3.*

- `pre-v3-shipped-capability-audit:83` "Replaces scratch checkpoint and terminal deletion mechanics. Native continuation beyond prior recorded cases remains unverified here."
- `v3-capability-reconciliation:89` "The current single-run baseline rejects foreign/stale owners and preserves commitments across reopening."

## S6. Handover and autonomy: "It'll stall at 2am, or quit early"

### S6.1 Prompting failed, so the behavior became a seam

*designed with an organic origin, hard plus soft, strength 5.* Users were confused when Claude handovers reported "attended". Five prompt wordings failed to make the model tell the user they could leave, so the acknowledgement became the turn-ending message and a verified Stop hook now blocks that stop and resumes the work. When hooks were not live, admission was refused and the user was told not to leave.

- `ready-selection-boundary:30` "Both handover acknowledgements observed during this delivery, in this repository and in the fixture, reported the handover as recorded with the run attended because Claude exposes no verifiable native goal. The user found that confusing; it is a separate follow-up, not a defect of this candidate."
- `unattended-stop-hook:7` "the scripted user agreed its readback, handed it over and said they were going to bed."
- `unattended-stop-hook:23` "The acknowledgement did not appear under five earlier wordings, each run once on Opus"
- `unattended-stop-hook:23` "The Fable attempt composed the acknowledgement ("I've accepted the handover ... Starting now") only in a thinking block."
- `unattended-stop-hook:25` "The Stop hook blocked the yield with its continuation reminder, and the controller resumed, completed the task and closed the run through the morning report."
- `unattended-stop-hook:21` "Two further attempts ran in sessions that began before the fixture's hooks existed; the runtime refused admission and the controller told the user not to leave yet and how to recover, without claiming acceptance."
- `unattended-stop-hook:25` "These are two observations of a model-owned behavior, one per model."

**Numbers:** 21 attempts, 18,857,805 metered tokens (`unattended-stop-hook:9`). **Note:** the "user" was scripted, not a person asleep.

### S6.2 A hung reviewer, and the refusal that now fires in real work

*organic, hard, strength 5.* The whitespace-streaming reviewer from the running example recurred. The runtime now ends such an attempt as `output-loop` and tries the next permitted reviewer. It has fired eight times in real work since shipping, the only named refusal with real-work sightings on record.

- `.nightshift/BUGS_HISTORY.md:134` "then streamed only whitespace deltas for 29 minutes (58,926 deltas, a 16.9 MB event log) until the controller terminated it on that content evidence; dispatch would otherwise have waited for its 50-minute timeout."
- `internal/runtime/REFERENCE.md:87` "A Codex attempt whose agent message streams only whitespace for at least 120 seconds and 1000 consecutive deltas fails with `output-loop`, recording the count, duration and time of the last text; its event log is kept and the next candidate is tried."
- `.nightshift/BUGS_HISTORY.md:132` "Live firings on retained releases, found on 2026-09-28 by scanning the receipts and failure records of every dispatch in this repository: eight, each a Claude Code controller's Codex `gpt-6-astra` attempt ended as an output loop after about 4,000 whitespace deltas over 120 seconds, with its event log kept."
- `.nightshift/BUGS_HISTORY.md:132` "In the six dispatches with a receipt the listed Claude `claude-fable-5-1` fallback then finished its attempt"
- `.nightshift/BUGS_HISTORY.md:132` "These are incidental sightings of the ordinary path, not a designed probe, and they do not exercise the negative case of genuine long output."

### S6.3 The model quit early, and continuation took the next step

*organic, soft, strength 4.* The "quits early" objection happened for real and is recorded as a defect.

- `adoption-session-triage:48` "The earlier delivery report declared a capability blocker with the live allowance untouched, although an independent accounting assessment had identified further authorized investigation and distinguished controller-added restrictions from the accepted scope. Automatic continuation then pursued that avenue without a new grant."
- `adoption-session-triage:56` "After the blocked outcome had been reported, two automatic goal continuations checked unchanged barriers. The controller emitted another blocker-status final and repeated the full handover report without a new delivery result. The user called out triple reports"

### S6.4 The Stop hook blocks early exits, has a bound, and fails visibly

*designed and organic, hard, strength 4.* It resists a premature stop, gives up after three reminders without progress, offers nothing when disabled, and once over-fired against a present user.

- `run-adoption-and-continuation:24` "Both hosts produced three consecutive no-progress reminders, then allowed the diagnostic turn to end while work remained unfinished."
- `run-adoption-and-continuation:28` "Both hosts refused ordinary claim admission after deliberate hook disablement, preserving run state and history."
- `run-adoption-and-continuation:28` "Disabled hooks supplied no protection."
- `self-hosting-lifecycle-activation:28` "The installed Stop hook actually resumed this session and restored its obligations."
- `handover-transition-and-morning-report:55` "The Stop hook resisted a pause that a still-present user had asked for, because the run had just become unattended; the controller held correctly through three reminders, but a user-requested hold after handover is only permitted when recorded as a user decision."

### S6.5 On Codex, the native goal resumed the run

*organic, hard, strength 3.* The report credits only the mechanism it actually observed.

- `ready-exploring-presentation:23` "Automatic resumption of the native goal was observed on this session before runtime task execution. Native hook execution was not observed and is not claimed as the continuation mechanism."

## S7. Closing: "It'll just say it's done"

### S7.1 The record beat the model's own summary

*organic, hard records, strength 5.* Step 7 of the running example. The durable record and a fresh skeptic corrected the model's account of its own run.

- `v3-acceptance-272m:52` "Durable records show 10 findings across four imported assessments: six implemented, three skipped and one deferred. Its summary says nine findings, three rounds and two skips."
- `v3-acceptance-272m:40` "The native retrospective overstated convention compliance: one inline PowerShell body violated the supplied conventions."

### S7.2 The report admitted which workflows did not run

*organic, soft, strength 5.* The readout rule applied against the system's own lapse, including that catching up later does not count backwards.

- `ready-exploring-presentation:23` "The original work used direct reviewer and skeptic agents and did not run revise-code, revise-docs or revise-lore through the Nightshift lifecycle."
- `ready-exploring-presentation:23` "Completing the missing work in this run does not itself repair the workflow-selection defect."

### S7.3 "The report is saved" is not a report

*designed fixture with an unplanned deviation, soft wording backed by hard ordering, strength 4.* A controller pointed at the saved report instead of showing it. The rule was tightened, delivery is recorded only from an actual reply, and completion is refused before the closing stages.

- `handover-transition-and-morning-report:51` "In Codex scenario 1 the controller ended with a summary and "The morning report is saved in this session" instead of presenting the report, and on the user's return it presented a condensed version. The user's direction is that a user is never pointed at report files."
- `handover-transition-and-morning-report:51` "`internal/workflow.md` and `skills/handover/SKILL.md` were tightened to say that the final message is the full report itself, never a summary or a pointer to where it was saved, including when a run closes blocked."
- `run-adoption-and-continuation:26` "Codex adopted 21 to 22, preserved the real undelivered report, presented its full body, and recorded delivery at 23 only after an actual acknowledgement."
- `self-hosting-lifecycle-activation:13` "Deterministic controls reject completion before the task and closing stages, and reject triage before retrospective."

### S7.4 113 passes and one failure is not "passed"

*organic, soft, strength 4.*

- `recoverable-unwrap:29` "reported 113 passing Node subtests and one failure"
- `recoverable-unwrap:29` "this delivery does not claim that deep-copy verification infrastructure is repaired or that the private suite passed completely."

### S7.5 Unfinished work named plainly

*organic, soft, strength 4.*

- `v3-acceptance-32m:79` "The structured final report accurately leaves both required work and the run incomplete."
- `v3-acceptance-128m:41` "A local commit attempt fails because the isolated fixture lacks an author identity; the controller accurately reports staged-only delivery and does not change identity settings."

### S7.6 What did not run

*organic, soft, strength 5.* Candidate closing line for the limits section: "These were not silently passed."

- `v3-capability-reconciliation:347` "No full repository suite, current installed-model campaign, additional-platform campaign or implementation repair ran."
- `pre-v3-shipped-capability-audit:219` "Present instruction text means the instruction exists. A named older host observation means that bounded behavior was observed under its recorded candidate and context. Neither means every branch works in current 3.2.0."
- `pre-v3-shipped-capability-audit:237` "These were not silently passed."

### S7.7 A decision is not done work

*organic, soft, strength 3.* Triage records decisions without passing them off as delivery, and the reconciliation replaced "consolidated" labels with evidence or a route.

- `v3-migration-followups:3` "All 63 items are resolved for tracking: 56 are tracked, three were skipped and four were closed as superseded. These are tracking dispositions, not completed implementations."
- `v3-migration-followups:7` "No implementation or publication is authorized by these dispositions."
- `v3-capability-reconciliation:7` "The original 83 retained needs were mostly labeled consolidated without individual delivery evidence or an actionable destination."
- `v3-capability-reconciliation:19` "Missing capabilities themselves are not marked shipped or fixed."

### S7.8 The runtime checks that a retrospective exists, not that it is good

*organic, a limit, strength 3.*

- `adoption-session-triage:82` "The runtime records nonempty retrospective evidence rather than evaluating reflection quality."

## L. Limits: what the seams did not catch

### L1 Data loss that the tests missed

*designed fault injection inside an organic audit, strength 5.* A disk-full error cut a backlog file to six bytes and a rerun reported success. v2 had made verified backups first. The fix began by reproducing the defect. Keep it scoped to setup tooling.

- `v3-migration-followups:785` "The independent actual-CLI ENOSPC probe reduced an existing 115-byte backlog file to 6 bytes. There was no recovery copy, and a rerun succeeded with no ready entries, errors or notices."
- `v3-migration-followups:799` "A partial FEATURES.md creation left only "# Feat". Setup skipped that existing target on retry and reported completion without a parser problem."
- `pre-v3-shipped-capability-audit:166` "Historical `publication.js:1291-1310` created and verified all repair backups before publication"
- `recoverable-unwrap:7` "An isolated actual setup CLI probe against the unchanged baseline reproduced the defect: an injected ENOSPC reduced a 95-byte FEATURES.md to 6 bytes, and setup without unwrap then returned success with no ready entries or structural errors."

### L2 After the full lifecycle, a later review still found a bug

*organic, strength 5.* The continuation of S4.4. A review the user requested after delivery found a bug the lifecycle had missed. That repair was itself too broad, and cumulative reassessment caught it.

- `recoverable-unwrap:21` "A subsequent user-requested direct review found that migration inventory applied ownership to a recovery record's filename while discovery applied it to the target. An individually preserved damaged file could therefore lose its sibling record to migration, leaving later unwrap to report success."
- `recoverable-unwrap:21` "Cumulative reassessment caught an overbroad suffix classification in that repair; ordinary directories now retain literal ownership decisions, with empty-directory preservation and migration covered through the setup CLI."
- `recoverable-unwrap:21` "These repairs belong to the additional direct review loop after the completed Nightshift delivery lifecycle."

### L3 Models got ahead of procedural rules

*organic, soft, strength 5.* "Create the run before implementing" is procedure, and nothing stopped Fable from breaking it.

- `v3-acceptance:74` "Fable's two controller attempts consumed 1,247,904 observed tokens without a durable run and wrote product files before the required queue."
- `v3-acceptance-64m:23` "The case therefore establishes dependency-controlled admission and integration, with early speculative drafting explicitly retained as a coverage qualification."

### L4 The budget guard failed, and the overrun stays on record

*organic, strength 5.*

- `self-hosting-lifecycle-activation:24` "A scratch review monitor swallowed its threshold exception and allowed another 427,223 reported tokens before the controller stopped its processes: at least 1,250,632 in total, exceeding the original 1M allowance by at least 250,632."
- `self-hosting-lifecycle-activation:24` "This does not retroactively authorize or repair the overrun."
- `self-hosting-lifecycle-activation:34` "Historical outcome files and their later accounting corrections remain preserved; they are not rewritten as if the original accounting had been correct."

### L5 Out of budget and honestly unfinished

*organic budget stop in a designed campaign, strength 4.* The run was left as it was rather than closed through a fabricated operation. It was adopted and completed later.

- `run-adoption-claude-source:19` "After 39 physical requests settled, the next request could not fit its conservative reservation, so the controller shut down the actor and campaign."
- `run-adoption-claude-source:19` "The run was not stopped or completed through a fabricated runtime operation: its actual source process ended while its saved status remains running."
- `run-adoption-claude-source:27` "The measured cost of reaching this first increment reinforces the already tracked acceptance-tooling proportionality concern."

### L6 The cost

*descriptive, strength 4.* Assurance is expensive, and the reports say so. Do not convert to money: the reports decline to.

- `v3-acceptance-16m:66` "The cost remains high for a tiny helper: 7,315,934 gross tokens across the two successful handovers."
- `v3-acceptance-32m:108` "The catalog controller accounts for 79.8% of gross tokens."
- `v3-acceptance-32m:108` "These measurements do not establish monetary cost or guaranteed savings"

### L7 Observations, not guarantees

*descriptive, strength 4.* Model behavior evidence is labelled as bounded observation.

- `paused-strong-gate:11` "No pre-change control was run."
- `paused-strong-gate:40` "A passing oracle means the listed decision fields matched, not that the unexercised lifecycle operations succeeded."
- `ready-exploring-presentation:17` "The tests are observations of model behavior, not a guarantee of identical future responses."
- `pre-v3-shipped-capability-audit:217` "Historical shipping labels do not retroactively make those model-owned claims verified."
- `v3-capability-reconciliation:23` "Policy present means the rule exists, not universal model compliance."

### L8 What is not claimed

*descriptive, strength 4.*

- `v3-capability-reconciliation:321` "Automatic relaunch was deliberately deferred; a host exit can currently end an unattended night."
- `v3-capability-reconciliation:255` "Current runtime limits cover deadlines and dispatch attempts; token/cost limits require a separate verified mechanism."
- `v3-acceptance-272m:54` "No macOS/Linux, automatic host relaunch, active-controller transfer or concurrent independent runs in one checkout are claimed."

### L9 Not a security boundary, and not independent errors

*descriptive, strength 3.*

- `internal/workflow.md:43` "This uses controller privileges, so the private directory and inventory drift check are not a security sandbox."
- `v3-capability-reconciliation:175` "state explicitly that ACLs do not isolate agents sharing the same principal."
- `WORKFLOW.md:45` "Cross-host placement does not guarantee independent errors."

### L10 A gate once required an untrue claim

*organic, strength 3.* The checks get checked too: a packaging test demanded that an unpublished candidate claim publication, and the gate was changed to accept the truthful statement.

- `ready-exploring-presentation:19` "Packaging then had four passing tests and one failure: the shared README status expression required an unpublished candidate to claim publication."

## The acceptance campaign as an arc

The v3 acceptance reports are named by the user-authorized token allowance in millions, not by run length.

- `v3-acceptance:45` "Cached input, auxiliary evaluators and every participating test agent count."

| Allowance | What happened | Entries |
|---|---|---|
| 8M | `v3-acceptance:3` "Neither installed handover reached verified completion." A skeptic report was rejected whole and the schema fixed; Fable wrote files before the run existed. | S4.7, L3 |
| 16M | `v3-acceptance-16m:64` "The additional allowance produced the first complete native handovers on both hosts." A required unavailable model failed closed. | S2.3, S2.6 |
| 32M | First substantial feature with a dependent queue: 15 of 20 findings refuted, a review discarded for input drift, gaps found in Nightshift's own gates. | S4.2, S3.1, S4.8 |
| 64M | Compaction with open findings on both hosts, a hung reviewer reclaimed, a regression caught after green tests, a budget stop with the finding still open. | R, S5.1 |
| 128M | Material mid-run change blocked on the user; `v3-acceptance-128m:3` "Claude authentication prevents the preserved Fable continuation." | S1.3, S1.4 |
| 272M | All cases completed and 3.0.0 published, with limits kept on record. | S5.5, S7.1, L8 |

## Headline numbers

| Figure | What it shows | Source |
|---|---|---|
| 231 tests green, 8 more issues found | Tests are not trust | `pre-v3-shipped-capability-audit:15`, `v3-capability-reconciliation:11` |
| 15 of 20 findings refuted (75% *derived*) | The skeptic stops hallucinated work | `v3-acceptance-32m:15`, `:18`, `:25` |
| 14 confirmed, 1 refuted, 5 cross-host passes | Review converges | `handover-transition-and-morning-report:11` |
| 125,622 tokens discarded | Stale evidence is refused even when paid for | `v3-acceptance-32m:27` |
| 215,588 to 17,531 tokens, 3 findings kept | Obligations survive compaction | `v3-acceptance-64m:55` |
| `[10]` became `[15]` after 14 green tests | Cumulative re-review catches regressions | `v3-acceptance-64m:57`, `:59` |
| 10 findings recorded, 9 claimed | The record beats the narrative | `v3-acceptance-272m:52` |
| 8 of 8 takeover combinations | Continuity across sessions and hosts | `run-adoption-and-continuation:3` |
| 5 prompt wordings failed | Mechanism over instruction | `unattended-stop-hook:23` |
| 8 real `output-loop` firings, 6 finished by fallback | A seam firing in real work | `.nightshift/BUGS_HISTORY.md:132` |
| 115 bytes to 6 | What slipped through | `v3-migration-followups:785` |
| at least 250,632 tokens over a 1M allowance | Admitted, not rewritten | `self-hosting-lifecycle-activation:24` |
| 7,315,934 tokens for two tiny handovers | The price of assurance | `v3-acceptance-16m:66` |

The campaign's final usage of 210,220,926 tokens (`v3-acceptance-272m:64`) includes inexact lower bounds; do not present it as exact.

## Gaps in the evidence

- The refusal codes `review-required`, `invalid-receipt`, `report-required`, `report-stale` and `unverified-continuation` never appear by name in the reports; the behaviors are described (S3.1, S3.2, S7.3). Named codes that do appear are `stale-owner`, `controller-activity-unknown` and `output-loop`. To show real refusal output on a slide, capture it from a fixture run rather than implying these incidents printed it.
- S1 has no example of the seam refusing a premature handover; its strongest material is a leak (S1.1).
- No incident shows a same-named check superseding an earlier pass, a commitment change staling a running review, a refused force-adopt, or an attempt to skip a required finding.
- No real overnight run with a human asleep is quoted; morning-report evidence comes from scripted fixtures (S6.1, S7.3).
- The "three related passes" recurrence signal has no incident; S4.4's shared-cause repair is the closest.

## Slide cautions

- Private project names appear in `inbox-triage:9` and `:51`; local paths such as `C:/Git/nightshift` appear in `adoption-session-triage:5`.
- Production credentials were copied into test fixtures (`unattended-stop-hook:29`, `handover-transition-and-morning-report:61`); do not quote those passages.
- Account quota details appear in `adoption-session-triage:76` and `ready-selection-boundary:7`.
- `v3-acceptance-272m:3` and `:5` carry a GitHub username, a commit URL and a timezone.
- Model names (Fable, Astra, Opus) appear throughout; decide whether to name them.
- Remove run, session, review and probe UUIDs, hashes and `.tmp` paths from anything shown.
- Jargon to translate on slides: controller (the session running the work), receipt (a saved review result), principal (an operating-system user), ENOSPC (disk full).

## Sources

Reports live in `.nightshift/reports/`; the abbreviation is the filename without its date.

| Abbreviation | File |
|---|---|
| `adoption-session-triage` | [adoption-session-triage-20260922.md](../../.nightshift/reports/adoption-session-triage-20260922.md) |
| `automatic-plugin-preparation` | [automatic-plugin-preparation-20260915.md](../../.nightshift/reports/automatic-plugin-preparation-20260915.md) |
| `handover-transition-and-morning-report` | [handover-transition-and-morning-report-20260919.md](../../.nightshift/reports/handover-transition-and-morning-report-20260919.md) |
| `paused-strong-gate` | [paused-strong-gate-20260921.md](../../.nightshift/reports/paused-strong-gate-20260921.md) |
| `pre-v3-shipped-capability-audit` | [pre-v3-shipped-capability-audit-20260921.md](../../.nightshift/reports/pre-v3-shipped-capability-audit-20260921.md) |
| `ready-exploring-presentation` | [ready-exploring-presentation-20260912.md](../../.nightshift/reports/ready-exploring-presentation-20260912.md) |
| `ready-selection-boundary` | [ready-selection-boundary-20260924.md](../../.nightshift/reports/ready-selection-boundary-20260924.md) |
| `recoverable-unwrap` | [recoverable-unwrap-20260921.md](../../.nightshift/reports/recoverable-unwrap-20260921.md) |
| `retained-plugin-releases` | [retained-plugin-releases-20260914.md](../../.nightshift/reports/retained-plugin-releases-20260914.md) |
| `run-adoption-and-continuation` | [run-adoption-and-continuation-20260921.md](../../.nightshift/reports/run-adoption-and-continuation-20260921.md) |
| `run-adoption-claude-source` | [run-adoption-claude-source-20260922.md](../../.nightshift/reports/run-adoption-claude-source-20260922.md) |
| `self-hosting-lifecycle-activation` | [self-hosting-lifecycle-activation-20260913.md](../../.nightshift/reports/self-hosting-lifecycle-activation-20260913.md) |
| `unattended-stop-hook` | [unattended-stop-hook-20260926.md](../../.nightshift/reports/unattended-stop-hook-20260926.md) |
| `v3-acceptance` | [v3-acceptance-20260908.md](../../.nightshift/reports/v3-acceptance-20260908.md) (the 8M checkpoint) |
| `v3-acceptance-16m` | [v3-acceptance-16m-20260908.md](../../.nightshift/reports/v3-acceptance-16m-20260908.md) |
| `v3-acceptance-32m` | [v3-acceptance-32m-20260908.md](../../.nightshift/reports/v3-acceptance-32m-20260908.md) |
| `v3-acceptance-64m` | [v3-acceptance-64m-20260908.md](../../.nightshift/reports/v3-acceptance-64m-20260908.md) |
| `v3-acceptance-128m` | [v3-acceptance-128m-20260909.md](../../.nightshift/reports/v3-acceptance-128m-20260909.md) |
| `v3-acceptance-272m` | [v3-acceptance-272m-20260910.md](../../.nightshift/reports/v3-acceptance-272m-20260910.md) |
| `v3-capability-reconciliation` | [v3-capability-reconciliation-20260920.md](../../.nightshift/reports/v3-capability-reconciliation-20260920.md) |
| `v3-migration-followups` | [v3-migration-followups-20260920.md](../../.nightshift/reports/v3-migration-followups-20260920.md) |

Other sources are cited by repository path: [.nightshift/BUGS_HISTORY.md](../../.nightshift/BUGS_HISTORY.md), [internal/runtime/REFERENCE.md](../../internal/runtime/REFERENCE.md), [internal/workflow.md](../../internal/workflow.md) and [WORKFLOW.md](../../WORKFLOW.md).
