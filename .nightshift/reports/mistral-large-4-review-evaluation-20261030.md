# Mistral Large 4 review evaluation

The user asked on 2026-10-30 for Mistral Large 4, newly offered in Mistral Vibe, to be evaluated as a lead reviewer and as a skeptic, under a 16,000,000-token budget. This evaluation runs it through the [seeded-defect suite](../specs/seeded-defect-suite.md) under the same prompts, conventions and report validation as the latest Opus 5.5 run, as evidence for a later admission decision. It admits nothing: no family in the runtime's reviewer gate covers `mistral-large-4`, and admission stays the user's separate decision.

## Method

Environment: Windows 11, Node 22, Mistral Vibe 3.0.3. Release 3.3.20 added `mistral-large-4` to the Vibe launcher's table of model entries, pinned through the launcher's isolated agent file with its two thinking levels, `off` for low effort and `high` otherwise, and with image support off, which Vibe otherwise derives from its own model table and which the launcher's effective-configuration check then refused. The suite's evaluation override, which dispatches a Vibe stage through `tools/seeded-defects/vibe-launcher.js` behind a gate candidate the runtime admits (Sol on Codex), now applies to any stage the gate does not admit, so it carried both the lead and the skeptic, as [the suite spec](../specs/seeded-defect-suite.md) and [the Vibe reviewer host spec](../specs/vibe-reviewer-host.md) record. Because that gate candidate is a Codex one, every prompt was built for Codex: none of the 128 attempt prompts carries the guidance a runtime Vibe lead's prompt adds (its working directory, to be read by relative path, and the rule that sandbox runs are not execution evidence of the project), and all of them carry the probe instruction every host gets. Every stage ran at `high`. Attribution came from Vibe's session journal: all 128 attempts, retried ones included, have a `session/meta.json` naming `mistral-large-4`. Tokens come from the `usage.total_tokens` of the `export.json` Vibe writes.

The run covered all 23 fixtures, two repetitions each, lead and skeptic both on Mistral Large 4, then two `--retry` passes. Pairing the skeptic with the same model, as the GLM 5.3 evaluation did, kept the run inside the budget, which cross-pairing with Opus would not have done; lead figures do not depend on the skeptic, and skeptic accuracy is measured against the planted decoys. Every dispatch shares one review machinery hash (`cfd1cc644cf7`) and one dispatching harness hash (`7811b0024a19`), so the run is not mixed; the first pass ran from commit `1712b0c6` and the retries from `58cc3694`, which changed only specs.

The comparison run is the Opus 5.5 run of 2026-10-29 (`.tmp/4722571d-suite/prompt-change`), regraded with the current grader (`5291c5192d04`) on the same fixture set (`71d708fb5ea5`) and conventions (`fefb60b9ff27`); regrading left its figures unchanged. `compare` reports the pair as confounded: the review machinery (`fe9c0a9c5bf5` for Opus) and the dispatching harness (`93320e133e26`) both differ, besides the model and host, and Mistral has incomplete fixture runs.

## Results

| Figure | Opus 5.5 | Mistral Large 4 |
|---|---|---|
| Detection | 42/42 | 27/27 |
| Clean-change false positives per clean fixture | 0.33 (2/6) | 0.00 (0/6) |
| Unmatched confirmations per other fixture | 0.23 (9/40) | 0.21 (5/24) |
| Out of scope raised | 2/6 | 1/5 |
| Severity accuracy | 35/42 | 22/27 |
| Skeptic accuracy | 92/92 | 59/59 |
| Tokens per fixture run | 56,655 | 173,650 |
| Seconds per fixture run | 98 | 227 |
| Complete fixture runs | 46/46 | 31/46 |

Mistral's figures cover only its 31 complete fixture runs, and the fifteen it could not complete are not a random sample: six fixtures (branch-switch-shell, check-environment, check-exit-status, journal-append-race, lock-contention-test, revision-history) have no complete run in either repetition, and three more (line-ending-freshness, quiet-flag, registry-reconcile) have one. The tests-evidence dimension, whose only fixture is lock-contention-test, is therefore unmeasured. Where it was measured, Mistral matched Opus on detection and skeptic accuracy, raised no confirmed finding on a clean fixture, and was within Opus's spread across repetitions on unmatched confirmations and severity. One more fixture run, registry-reconcile's second repetition, has a complete lead but no complete skeptic, so it counts in the lead figures alone.

Seven unmatched Mistral findings were adjudicated, all false, five of them on precedents from the GLM evaluation and its cross-paired run: an unknown run id surfacing as a `TypeError` (two findings), a recorded request id not bound to its run although the requirement makes ids unique across runs, query results returning the registry's stored records, and the duplicated host list. The other two, one in each review-context-routing repetition, are new: `accept` returns a delivery that shares the caller's `tasks` array, false because `accept` keeps no state and the requirement asks for no copy. Mistral's skeptic confirmed every one of the five it judged; the other two had no complete skeptic. No adjudication was real, so no fixture correction follows.

Tokens are Vibe's own total, not the Claude accounting of the Opus figures; whether both count cached input the same way is unverified, so the token and time comparison is indicative only. Taken at face value, Mistral spent about three times Opus's tokens and over twice its time per fixture run.

## Probe requests

The suite runs no probes, so a lead whose report requests one is graded incomplete and its skeptic is not dispatched. Mistral's first lead attempt requested probes in 21 of 46 fixture runs, against one of 48 Opus lead dispatches. Two retry passes converted six of them; the other fifteen requested probes on all three attempts. In the receipts read, the probes are confirmations of findings already made rather than missing reads: running the check with the runner's environment to show `RUNNER_TOKEN` reaching the child process, running the committed lock tests, and running them against a lock with its mutual exclusion removed to show that a test does not guard what it is named for. Their summaries name the decisive defect in the receipts read, check-environment's leaked credential among them, but no incomplete receipt was graded, so detection on those fixtures is unmeasured, not missed.

The rate does not come from the runtime's Vibe-only rule that a sandbox run is not execution evidence of the project, so that "a deciding claim that needs execution goes through a probe request" (`vibeRules` in `internal/runtime/review.js`): as Method records, no Mistral prompt carried it. The GLM 5.3 evaluation's prompts lack it too, since that run predates the rule, and carry the probe instruction every host gets. On the 17 fixtures both runs share, GLM's first lead attempts requested probes in 2 of 34 fixture runs and Mistral's in 18 of 34. The review machinery differs between the two runs, so the comparison is not controlled. A runtime Vibe lead's prompt would carry the rule, so Mistral's probe rate in runtime use is unmeasured. In a runtime review the probes would run and the review continue, at a cost this suite does not measure.

## Protocol failures

Apart from probe requests, 16 stage dispatches failed: 4 leads and 12 skeptics. The leads: one report without findings or coverage (`invalid-result`), one Vibe host failure ("Core rejected durable input", `unusable-review`), one finding without its severity and obligation assessment (`invalid-finding`) and one report marked complete although its assessment needed probe evidence (`incomplete-evidence`). The skeptics: seven replies that were not valid JSON, four reports without findings or coverage (`invalid-result`) and one more marked complete although it needed probe evidence. The retries spent 51 stage dispatches in all (36 incomplete reports, 15 known failures), against two lead stages for Opus's 2026-10-29 run, one probe request and one exhausted structured-output retry.

The evaluation spent 14,125,044 tokens: 325,379 on two smoke runs, the first of which failed on the image-support mismatch above, and 13,799,665 in the run, of which the final fixture runs' records hold 7,987,921. The first pass spent 7,066,686, the first retry pass 4,354,483 and the second 2,378,496, which converted one stage; retrying further would have kept paying for the same fifteen probe requests.

## Observations for the admission decision

- On the fixture runs it completed, Mistral Large 4 matched Opus on detection and skeptic accuracy, with no clean-change false positive, and was within Opus's spread on unmatched confirmations and severity.
- Almost half of its first lead attempts (21 of 46) end with probe requests under the probe instruction every host gets, and a third (15 of 46) on every attempt, against 2 of 34 for GLM 5.3 on the fixtures both ran, so in runtime use it would lean on probes far more than Opus or GLM; the suite cannot say what that costs or whether those reviews would then be correct.
- Its report protocol fails more often than Opus's, skeptic JSON above all, so a runtime launcher must keep the retry path.
- It spent about three times Opus's tokens per fixture run by Vibe's accounting.
- Attribution and the Windows job worked as for GLM: every attempt's journal names `mistral-large-4`.

## Qualifications

- Two repetitions on 23 fixtures, of which fifteen fixture runs, covering six fixtures entirely and the tests-evidence dimension, have no complete lead; the figures describe the fixtures Mistral completed, not the suite.
- Confounded comparison: model and host, review machinery and dispatching harness all differ from the Opus run, and Mistral's prompts, built for the Codex gate candidate, lack the guidance a runtime Vibe lead's prompt carries.
- Same-model pairing: the skeptic figures describe Mistral judging Mistral, as in the GLM evaluation, not Mistral judging another model's leads.
- Findings report execution in Vibe's sandbox, as GLM's did; those claims were not checked call by call here.
- Token figures are Vibe's accounting and not comparable with Claude's; the targets describe Opus 5.5 and are out of scope for this model.
- The raw run folder lives in the session's scratch space under `.tmp` and is not durable.
