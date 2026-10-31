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

The rate does not come from the runtime's Vibe-only rule that a sandbox run is not execution evidence of the project, so that "a deciding claim that needs execution goes through a probe request" (`vibeRules` in `internal/runtime/review.js`): as Method records, no Mistral prompt carried it. The GLM 5.3 evaluation's prompts lack it too, since that run predates the rule, and carry the probe instruction every host gets. On the 17 fixtures both runs share, GLM's first lead attempts requested probes in 2 of 34 fixture runs and Mistral's in 18 of 34. The review machinery differs between the two runs, so the comparison is not controlled. A runtime Vibe lead's prompt carries the rule. The rerun below measures Mistral's probe rate under that prompt, and it was no lower. In a runtime review the probes would run and the review continue, at a cost this suite does not measure.

## Protocol failures

Apart from probe requests, 16 stage dispatches failed: 4 leads and 12 skeptics. The leads: one report without findings or coverage (`invalid-result`), one Vibe host failure ("Core rejected durable input", `unusable-review`), one finding without its severity and obligation assessment (`invalid-finding`) and one report marked complete although its assessment needed probe evidence (`incomplete-evidence`). The skeptics: seven replies that were not valid JSON, four reports without findings or coverage (`invalid-result`) and one more marked complete although it needed probe evidence. The retries spent 51 stage dispatches in all (36 incomplete reports, 15 known failures), against two lead stages for Opus's 2026-10-29 run, one probe request and one exhausted structured-output retry.

The evaluation spent 14,125,044 tokens: 325,379 on two smoke runs, the first of which failed on the image-support mismatch above, and 13,799,665 in the run, of which the final fixture runs' records hold 7,987,921. The first pass spent 7,066,686, the first retry pass 4,354,483 and the second 2,378,496, which converted one stage; retrying further would have kept paying for the same fifteen probe requests.

## Sandbox execution claims

Findings and verdicts in both Vibe evaluations cite runs in Vibe's `run_typescript` sandbox as evidence. On 2026-10-30 two fresh-context agents checked those claims against the session journals: every claim whose text matched an execution keyword in the 27 GLM 5.3 final receipts that have one, and the same for a sample of 16 of Mistral's 58 such receipts (every fourth in sorted order, plus each receipt with no sandbox call). A claim counted as executed when every input and result it attributes to execution appears in a recorded call and its output. Each agent also compared the code the sandbox ran with the shipped files. The GLM agent found every `run_typescript` call in the journals present in the extracted calls it was given; the Mistral agent checked the journals its partial and not-executed verdicts rest on, with the same result.

| Claims | GLM 5.3 | Mistral Large 4 (sample) |
|---|---|---|
| Matching an execution keyword | 44 | 27 |
| Not claiming execution | 16 | 3 |
| Executed as claimed | 24 | 20 |
| Partly executed | 3 | 3 |
| Not executed | 0 | 1 |
| Output contradicts the claim | 1 | 0 |

Eight of the 52 claims that cite execution go beyond their recorded calls:

- GLM, port-validation's second lead credits a Symbol input's TypeError to sandbox execution; no call ran a Symbol input.
- GLM, port-validation's second skeptic reports `'-1'` throwing "invalid port: -80"; its call recorded "invalid port: -1", with the same error class. Another of its verdicts credits a second TypeError to a template literal that the shipped code never reaches, since the regular expression throws first.
- GLM, replay-after-adoption's second skeptic says execution confirmed an adoption by owner B; the call ran it, but no output records the owner after it.
- Mistral, branch-switch-shell's first lead says a finding was "Confirmed by" a probe it had only requested.
- Mistral, registry-timeout's first skeptic cites a "33000+ ms" figure that no call produced; the journal shows it copied from the lead's report.
- Mistral, replay-after-adoption's second lead, two findings: the read after each replay was an `adopt` call, which itself set the owner the findings attribute to the replay.

In each of the eight, the conclusion is still true of the shipped code. One conclusion among all the judged claims is incomplete: GLM's check-exit-status second skeptic refuted "comments are counted as problems" on a line starting with `#`, while its own output shows an indented comment reported as a problem, which `line.startsWith('#')` in the fixture's `src/config.js` does not skip.

Every hand-typed copy reproduced the shipped function. One Mistral run replaced the `node:crypto` digest and file reads with a hand-written SHA-256 over an in-memory map, keeping the freshness logic, after an earlier hand-written version failed its own known-answer test. Labels are unreliable: among the sampled Mistral claims, four describe a hand-typed copy as the real file ("exact file contents", "unmodified module", "byte-exact"), three say "verbatim" without saying which, and many GLM claims do not say that a copy ran.

The sandbox is not limited to transcription. Code in `run_typescript` can call `tools.file_system.read_file`. In 6 of the 16 sampled Mistral receipts the model read `project/src` files that way and ran the returned text with `new Function` under small `module` and `require` shims, so the shipped bytes ran; GLM read files from the sandbox too, but always ran copies it typed. Every shell call in both runs was refused, and code that needs Node's built-in modules did not run as shipped, since `require` had to be replaced. The runtime's Vibe rule, which then said the sandbox "runs only code you transcribe into it, never this project", was therefore inaccurate for self-contained modules; release 3.3.20 rewords it. Whether such a run should count as evidence is a separate question: unlike a probe, the runtime neither records nor checks it.

## Rerun with the Vibe prompt

The suite fix in 3.3.20 makes an evaluated Vibe stage receive the prompt `buildPrompt` builds for a Vibe host. The user then asked on 2026-10-30 for the evaluation to be rerun under a 32,000,000-token budget. The rerun's run folder was capped at 31,500,000 and used the same fixtures, repetitions, pairing and two `--retry` passes. All 132 attempt prompts, lead and skeptic, carry the working-directory guidance and the reworded sandbox rule. Every dispatch shares one review machinery hash (`9cb8575d249e`) and one dispatching harness hash (`135457cf5c92`), and all ran from commit `c36fae09`; every attempt's `session/meta.json` names `mistral-large-4`. Regraded with the current grader (`ceac00b71b1c`), the first run's figures are unchanged.

| Figure | First run | Rerun |
|---|---|---|
| Detection | 27/27 | 20/20 |
| Clean-change false positives per clean fixture | 0.00 (0/6) | 0.00 (0/4) |
| Unmatched confirmations per other fixture | 0.21 (5/24) | 0.22 (4/18) |
| Out of scope raised | 1/5 | 1/5 |
| Severity accuracy | 22/27 | 16/20 |
| Skeptic accuracy | 59/59 | 41/41 |
| Tokens per fixture run | 173,650 | 104,529 |
| Seconds per fixture run | 227 | 125 |
| Fixture runs with a complete lead | 31/46 | 24/46 |

`compare` varies the review machinery and reports the pair as confounded by the dispatching harness and by the incomplete fixture runs. It places every quality figure within the first run's spread across repetitions. Only tokens and time per fixture run fall outside it, and those figures count each fixture run's final stages only. The rerun completed fewer fixture runs, so its figures rest on fewer fixtures. Eight fixtures have no complete lead in either repetition: branch-switch-shell, check-exit-status, journal-append-race, latency-percentile, lock-contention-test, port-validation, quick-win-dependencies and registry-reconcile. Six more have one: check-environment, instruction-file-freshness, line-ending-freshness, replay-after-adoption, revision-history and tag-rule-duplicate. The tests-evidence dimension is unmeasured again. All 22 fixture runs without a complete lead end with a probe request. Two more fixture runs have a complete lead but no complete skeptic.

Probe requests did not fall. First lead attempts requested probes in 25 of 46 fixture runs, against 21 of 46 in the first run, on the same 23 fixtures. Seventeen fixture runs requested probes on all three attempts, against fifteen. These prompts match what a runtime Vibe lead receives, and the suite's tests check that. So in runtime use about half of Mistral's lead reviews would stop for probes. The suite still does not run probes, so it cannot measure whether those reviews would then be correct.

Six unmatched findings were adjudicated, all false. The skeptic confirmed the four it judged; check-environment's two had no complete skeptic:

- Two repeat precedents from the first run: an unknown run id surfacing as a `TypeError`, and `accept` sharing the caller's `tasks` array.
- Four go beyond what their requirements ask: check-environment's joined output streams and its timeout leaving grandchild processes running, revision-history's package entry not exporting `Store`, and `apply` accepting a non-object change.

Apart from probe requests, 15 stage dispatches failed: 6 leads and 9 skeptics. Four replies were not valid JSON (two leads, two skeptics), against seven in the first run. Three lead findings lacked their severity and obligation assessment. Eight reports, one lead and seven skeptics, were marked complete although their assessment needed probe evidence, against two in the first run. That pattern fits skeptics that now treat a sandbox run as non-evidence but still mark the verdict complete; it was not checked report by report.

The share of dispatches that used the sandbox fell. Distinct `run_typescript` calls in the session journals fell from 569, in 123 of 128 dispatches, to 128, in 61 of 132. The rerun's sandbox claims were not audited, so whether they keep to the reworded rule is unchecked. Which prompt change reduced the calls, the working-directory guidance or the rule, is also unchecked.

The rerun spent 10,157,541 tokens: 4,833,870 on the first pass, 2,882,345 on the first retry pass and 2,441,326 on the second. Its final fixture runs' records hold 4,808,342. The retries redispatched 62 stages (49 incomplete reports, 13 known failures) and raised fixture runs with complete lead and skeptic from 14 to 22. Together with the first evaluation's 14,125,044, the two runs spent 24,282,585 tokens.

## Observations for the admission decision

- On the fixture runs it completed, Mistral Large 4 matched Opus on detection and skeptic accuracy, with no clean-change false positive, and was within Opus's spread on unmatched confirmations and severity.
- Almost half of its first lead attempts (21 of 46) end with probe requests under the probe instruction every host gets, and a third (15 of 46) on every attempt, against 2 of 34 for GLM 5.3 on the fixtures both ran. Under the runtime's Vibe prompt the rerun's rate was 25 of 46, and 17 of 46 on every attempt. So in runtime use it would lean on probes far more than Opus or GLM; the suite cannot say what that costs or whether those reviews would then be correct.
- The rerun reproduced the first run's quality figures within their spread, on fewer completed fixture runs (24 against 31).
- Its sandbox execution claims mostly match their recorded calls, but in the sample one credits a probe it never ran and three go beyond their calls, so a sandbox claim alone is weaker evidence than a probe.
- Its report protocol fails more often than Opus's, skeptic JSON above all, so a runtime launcher must keep the retry path.
- It spent about three times Opus's tokens per fixture run by Vibe's accounting.
- Attribution and the Windows job worked as for GLM: every attempt's journal names `mistral-large-4`.

## Qualifications

- Two repetitions on 23 fixtures, of which fifteen fixture runs, covering six fixtures entirely and the tests-evidence dimension, have no complete lead; the figures describe the fixtures Mistral completed, not the suite.
- The rerun leaves 22 fixture runs, covering eight fixtures entirely and the tests-evidence dimension, without a complete lead.
- Confounded comparison: model and host, review machinery and dispatching harness all differ from the Opus run, and the first run's prompts, built for the Codex gate candidate, lack the guidance a runtime Vibe lead's prompt carries. The rerun's prompts carry it, but its review machinery and harness differ from the first run's as well.
- The rerun's sandbox claims were not audited.
- Same-model pairing: the skeptic figures describe Mistral judging Mistral, as in the GLM evaluation, not Mistral judging another model's leads.
- The sandbox audit checked a sample of 16 of Mistral's 58 receipts with execution keywords, and its Mistral figures describe that sample.
- Token figures are Vibe's accounting and not comparable with Claude's; the targets describe Opus 5.5 and are out of scope for this model.
- The raw run folders and the audit's reports live in the session's scratch space under `.tmp` and are not durable.
