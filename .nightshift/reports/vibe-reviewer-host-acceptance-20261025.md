# Vibe reviewer host verification, 2026-10-25

This report assembles the 2026-10-25 live evidence and the code-repair evidence checked during the adopted delivery. Documentation was assembled on 2026-10-26.

Candidate 3.3.16 adds GLM on Mistral Vibe as a lead reviewer for code, spec and docs assessments, with Claude or Codex skeptics, and repairs completed-record release pinning. This record describes observed behavior and remaining limits against [the governing spec](../specs/vibe-reviewer-host.md). The candidate remains local until separately published. The delivery controller executes the retained 3.3.15 runtime; the live fixtures execute the candidate development runtime against the installed Vibe 3.0.0 executable on Windows. These are installed-host observations, not an installation test of a published 3.3.16 plugin.

## Isolation and configuration

The isolation probe of 2026-10-25 used a fixture with distinct root and subdirectory AGENTS.md canaries. The trusted control let those instructions reach the model. Under the launcher-owned Vibe home, moved user home and untrusted project, the canaries were not followed, user skills disappeared, the keyring credential continued working, and GLM resolved from the launcher's model entry with experiments off. The launcher prompt appeared as core_system_instructions; Vibe's fixed harness preamble and capability text remained built-in inputs. A bare slash line did not inject the worktree skill body in that probe. Write, edit, shell and skill calls were denied and the fixture was unchanged. These observations cover the channels exercised by the probe, not every possible future Vibe channel.

The effective-config implementation classifies the 89 keys in the 3.0.0 isolation export as 49 whole-key comparisons, 38 allowlisted keys, and the two per-entry keys models and providers. A comparison of those sets against the saved export found no missing or additional key. The active model and its provider are compared; other model and provider entries are allowlisted. The source classification initially proposed comparing session_logging; the governing spec treats logging as operational, and the implementation leaves it allowlisted. Vibe sessions are not resumed here. The headless disabled_tools pair is compared with the observed ask_user_question and cron values rather than the schema's empty default.

The managed admin layer remains inside the provider boundary. Later Vibe versions are accepted without another isolation probe; unknown configuration keys are recorded and not compared. New non-configuration instruction channels would also require another probe to detect. These are accepted limits of the governing design.

The classification identified a separate unresolved image-fallback concern: when GLM receives image blocks, Vibe may describe them with the first image-capable model on its provider, today the allowlisted mistral-medium-3.5 entry. Changing that entry could alter descriptions without failing the active-model comparison. The installed read_file tool returns text; the reachability of image blocks through the Rust prompt-file path used here remains unchecked. This is a pending investigation, not an observed isolation breach.

Source evidence: the isolation exports and probe record under .tmp/7da5235c/probe; the per-key classification under .tmp/3787faae-0b2b-4421-bd4d-58feeef71d31/vibe-classify; and internal/runtime/vibe-config.js. Raw artifacts are ignored local evidence and are not part of the plugin payload.

The live and seeded runs preceded the later version-observation and governing-guidance repairs. Those repairs have the deterministic and static evidence described below; the live campaign was not repeated after them. The prior runs do not establish final-candidate byte equivalence.

## Live runtime flows

The fixture projects and their imported receipts are under .tmp/3787faae-0b2b-4421-bd4d-58feeef71d31/live. Each claim below names its own receipt or transition rather than inheriting another kind's result.

| Flow | Observed evidence | Limit |
| --- | --- | --- |
| Fresh code lead and alias | 65f31bc0 resolved glm to glm-5-3 (live/req/lead1.json and lead1-out.json), requested project execution and did not follow the project canaries. After a probe, 788e0194 completed and raised the CRC mismatch. | The first lead was incomplete pending execution; code fixture completion is not claimed. |
| Fresh spec lead and gate | a984db74 produced a complete spec report; de37fee6 imported replacement closure; later fresh assessments and dispositions let spec context f0f489a6 advance its task to complete. | The context itself remains open. |
| Fresh docs lead and gate | cac68ae7 produced a complete docs report; 42d7fcfc imported replacement closure; 477fb3dc supplied the later fresh assessment and docs context a702ec25 completed. | An earlier docs attempt failed on absolute-path access and was not credited. |
| Replacement requiring execution | On the recalibrated fixture, bd984859 requested a probe and remained incomplete. After the probe, a9e004f9 completed, imported and re-reported the still-open finding under its local id; pending closure remained outstanding. | Re-reporting met the spec alternative, but did not close the finding or complete the code fixture. |
| Lead dialogue through replacement | a23fd9ef produced a complete positions report and its dialogue import succeeded. | It maintains the minor refusal-test finding rather than claiming a repair. |

An earlier replacement, bc193f47, closed the original CRC mismatch using prior project probe output and a sandbox recomputation as corroboration. It stated that the repaired test now passed without a fresh post-repair execution. The earlier project output already supplied the relevant checksum in that fixture. This observation is preserved separately from the later recalibrated fixture, where the replacement requested a probe before completing. It must not be described as evidence that sandbox transcription is acceptable project execution.

The incomplete code lead 4b6009d8 asserted CRC 0xcbfaa392 and an inventory divergence based on its own transcription. The request snapshot records the table's f5613313... digest, and the saved project-execution probe for the same snapshot reports CRC 0xdd46ed94. Its underlying constant-mismatch observation was real, but its checksum and claimed manifest/file divergence were not established facts. This attempt already had working-directory guidance and still used the generic returned-probe-directory wording; the record does not establish that this attempt alone caused the later probe-file naming change.

Two prompt changes came from live failures: the Vibe attempt now states its working directory and directs relative paths, and returned probe evidence is named by file so the lead can read it without listing a directory. These changes were exercised by subsequent fixture dispatches. All three fresh code requests carried a mid-line /worktree token. A literal search of their complete saved attempt directories found neither the installed worktree skill's heading, Worktree Management, nor its creating-step marker, Compute the bucket from the repo root. This found no evidence of that builtin body being injected; it is a bounded text check, not a claim about every builtin skill.

## Live-verification budget

The 6,000,000-token authorization includes all hosts used for live verification and excludes review, skeptic and dialogue dispatches assessing the candidate change itself. Summing saved attempt tokens, including failed attempts, gives 2,577,745 for the live fixture projects. The graded seeded-defect run adds 2,172,665, for 4,750,410 total and 1,249,590 remaining. These totals were independently recomputed after adoption; the inspected attempt records had known token counts. Vibe accounting is its own measure and is not comparable with Claude or Codex accounting, even though the authorization charges all of them against one budget.

### Live fixture attempts

| Dispatch | Kind | Host attempts | Tokens | Outcome |
| --- | --- | --- | ---: | --- |
| 30b2397f | skeptic | codex:gpt-6-sol | 161,395 | complete |
| 4b6009d8 | code | vibe:glm-5-3 | 445,072 | incomplete |
| 5966d51a | skeptic | codex:gpt-6-sol | 216,297 | complete |
| 65f31bc0 | code | vibe:glm-5-3 | 162,217 | incomplete |
| 788e0194 | code | vibe:glm-5-3 | 54,372 | complete |
| a23fd9ef | code | vibe:glm-5-3 | 38,488 | complete |
| a9e004f9 | code | vibe:glm-5-3 | 432,981 | complete |
| bc193f47 | code | vibe:glm-5-3 | 189,585 | complete |
| bd984859 | code | vibe:glm-5-3 | 156,100 | incomplete |
| 3b01e37e | skeptic | claude:claude-opus-5-5 | 26,037 | complete |
| 42d7fcfc | docs | vibe:glm-5-3 | 74,616 | complete |
| 477fb3dc | docs | vibe:glm-5-3 | 82,039 | complete |
| 8bee63e4 | skeptic | claude:claude-opus-5-5 | 32,367 | incomplete |
| a4b94eb5 | spec | vibe:glm-5-3 | 63,530 | complete |
| a984db74 | spec | vibe:glm-5-3 | 155,267 | complete |
| b49c69f4 | spec | vibe:glm-5-3 | 62,994 | invalid-request |
| cac68ae7 | docs | vibe:glm-5-3 | 90,773 | complete |
| de37fee6 | spec | vibe:glm-5-3 | 22,684 | complete |
| dedd7d25 | docs | vibe:glm-5-3 | 57,359 | reviewer-tools-unavailable |
| f2bbe54a | skeptic | claude:claude-opus-5-5 | 25,471 | complete |
| f2f8c234 | skeptic | claude:claude-opus-5-5 | 28,101 | complete |

The fixture-attempt subtotal is 2,577,745; the separate seeded campaign adds 2,172,665.

## Seeded-defect campaign

The saved suite-glm-opus run used GLM leads and Opus skeptics through the runtime launcher, with a 3,000,000-token campaign allowance. Grading on 2026-10-25 dispatched no model. It reports 15/15 seeded-defect detection, 0/3 clean-fixture false positives, 13/14 unmatched confirmations on other fixtures, 11/15 severity accuracy and 32/32 skeptic accuracy. Known total spend is 2,172,665 tokens over 23 fixture runs.

The report is provisional. Six fixture runs are incomplete: branch-switch-shell, check-exit-status, journal-append-race, latency-percentile, line-ending-freshness and tag-rule-duplicate. Unmatched findings await adjudication. These figures describe the scored observations; they do not establish success on incomplete runs or qualification against the Opus-scoped baseline targets. The higher unmatched-confirmation figure remains visible rather than being treated as a passing result.

Source evidence: suite-glm-opus/report.json and report.md under the former controller's scratch folder. The candidate code's fresh-lead detection on harder defects remains unmeasured, as the governing spec already records.

## Deterministic verification and release pinning

Before documentation reconciliation, recorded release-tests, pinning-reproduction, review1-reproductions, warning-and-thread-reproductions, vibe-deterministic-tests, fortnight-tests, version-preflight-reproduction, placement-guidance-check, dialogue-routing-evidence and package-tests checks passed after the repairs. The warning-and-thread regression check first failed for the intended reasons: a second preparation blamed the session binding instead of the still-unfinished run, and known failed-attempt spend allowed a finite thread total despite a missing Claude, Codex or unknown-host receipt. After repair, all five selected cases passed, including Vibe-only failure remaining separate.

The completed-record fix keeps an unbound session on the registration's current release when it encounters a completed delivery or review record, preserves existing bindings for bookkeeping, and retains unfinished-run pinning. Repeated preparation names the unfinished run; a warning caused only by an existing binding states that retention without promising a new-session remedy. Tests cover completed delivery and review records, an unfinished stopped record, repeated preparation and a bound owner performing completed-run report work.

The version regression first reproduced eligibility at 3.0.0 followed by an accepted launch/export at 3.0.1. The repair retains the eligibility observation outside the strict candidate fields, requires it on CLI-preflighted attempts and compares both launch and export readings with it. Tests cover malformed and missing observations, launch/export disagreement and filtered or repeated candidates. The CLI fixture uses the real Windows job wrapper so rejection preserves observed termination proof. The governing root directions were aligned with the placement rule, and dialogue guidance now permits replacement when native resume is unavailable. The latter correction rests on static instruction evidence and the existing refusal/replacement test; no controller was observed choosing the wrong route.

A deterministic addendum on 2026-10-27 covers eligibility provenance and the remaining creating-request guidance. Selection observations are now retained on the registered worker before preparation and mirrored in prepared request, receipt and terminal failure records. Five selected regression cases pass: exhausted fallback, aborting failure, an unwritable failure artifact, registered preparation failure and failed fallback after dropping Vibe. The eligibility check first failed on missing metadata; its actual-attempt counts remain separate from dropped candidates. The shared releases reference now names handover and open-review in both generic creating-request instructions; its static guidance check failed before correction and passed afterward. These are deterministic and static observations, not a repeated installed-model campaign.

A further deterministic repair on 2026-10-27 preserves completed-job facts across Vibe post-exit failures. A real Windows-job fixture, using a fake Vibe process rather than a model, reported three empty jobs while malformed journal handling discarded proof and known fixture usage, changed ENOTDIR to termination-unverified and retained the copy. After repair the same reproduction preserves ENOTDIR, positive termination proof and usage, and releases the ended copy. Five regression cases cover malformed-journal fallback, ordinary/frozen/non-Error callback rejection and missing proof remaining unknown. Post-finish reads, validation, callbacks and report extraction share the error boundary. This is process/error-path evidence, not an additional live-model campaign.

Final review coverage, remaining release checks and local commit identities belong in the delivery report after they finish. This verification record alone does not discharge those obligations.
