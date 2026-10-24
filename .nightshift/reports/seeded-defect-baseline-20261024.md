# Seeded-defect baseline

The [seeded-defect suite](../specs/seeded-defect-suite.md) measures one fresh code lead and one fresh skeptic per fixture. This report records the baseline the user set its targets from on 2026-10-24, the corrections that led to it, and the cross-paired GLM 5.3 run that followed [the GLM 5.3 review evaluation](glm-5-3-review-evaluation-20261023.md).

## Method

Environment: Windows 11, Node 22, Claude Code 2.1.310, Opus 5.5 as lead and skeptic. The suite held 23 fixtures: the seventeen of the first baseline, corrected to remove issues they did not plant, and six harder ones added on 2026-10-23, audited by Sol on Codex on 2026-10-23; three corrections made after the second baseline, described below, were checked by probes rather than audited again. Each fixture ran twice, then one `--retry` pass, which found nothing to retry.

Every dispatch shares one identity: review machinery `3b7229cc6b1c`, dispatching harness `f08f265cd263`, commit `048959a2`, so the run is not mixed. The fixture set hash is `c450f1e27c7d`, the conventions hash `fefb60b9ff27` and the grader hash `c5d6798ef511`. The run spent 2,509,587 tokens. Raw artifacts stay in `.tmp/9fe31e9c-suite/baseline-3`.

## Results and targets

| Figure | Baseline | Spread between repetitions | Target |
|---|---|---|---|
| Detection | 100% (42/42) | 100% to 100% | 100% |
| Clean-change false positives per clean fixture | 0.33 (2/6) | 0.33 to 0.33 | at most 2 in 6 (recorded as 0.3334) |
| Unmatched confirmations per other fixture | 0.15 (6/40) | 0.10 to 0.20 | at most 0.20 |
| Severity accuracy | 64.3% (27/42) | 57.1% to 71.4% | at least 57% |
| Skeptic accuracy | 100% (92/92) | 100% to 100% | 100% |
| Tokens per fixture run | 54,556 | not recorded | at most 60,000 |

Each target sits at the worse edge of the spread between the two repetitions, so a later change reads as a regression only outside what identical runs already produce. The token target is a judgment about 10% above the baseline, since the harness records no token spread. The targets are recorded in `tools/seeded-defects/targets.json` with this report and the fixture set hash; graded reports print them as a target and the current value, without the direction, which this table gives.

Detection is 100% in every dimension (requirements 6/6, correctness 18/18, security and data safety 8/8, design 2/2, performance 6/6, tests 2/2). Every run on record has found every planted defect, the harder fixtures included, so detection can show a regression but not an improvement. Out of scope: 2 of 6 out-of-scope entries raised, both with `required` false.

Fourteen of the fifteen severity misses rate a defect one step too high: important defects as critical in latency-percentile, registry-timeout, retry-argument-order and revision-history (twice each), resume-targets and resumed-usage (once each), and minor defects as important in quick-win-dependencies and tag-rule-duplicate (twice each). The one miss in the other direction rates review-context-routing's critical defect as important, once. That pattern is what the prompt change that defines severity is meant to move.

## Adjudication

All eight unmatched findings were adjudicated false, each by a ruling made on the same finding in the earlier runs below: not relaying git's output after a switch, concatenating stdout and stderr, an unquoted port in the error message (both clean-fixture false positives), re-exporting the new module from `src/index.js` (twice), no reader for the current state, and no validation of a change's shape.

## How the baseline was reached

The second baseline, on 2026-10-23 and 2026-10-24, ran the corrected 23 fixtures twice on four setups: Opus 5.5 alone, GLM 5.3 alone, GLM 5.3 as lead with an Opus skeptic, and Opus as lead with a GLM skeptic. It spent 19,453,055 tokens. Of its 81 unmatched findings, 73 were adjudicated false, 2 attributed and 6 real. The six real findings named three issues no fixture planted: port-validation's `describe()` fallback could itself throw for a revoked Proxy or a throwing `Symbol.toStringTag` getter, so `parsePort` threw a TypeError instead of the RangeError the requirement demands, which Opus raised in all four of its lead runs and GLM in none; journal-append-race's base `writeJournal` awaited its cleanup `rm` inside the catch, so a failed cleanup replaced the original error; and revision-history's `apply` deep-cloned the whole state once more than it needed. The fixtures were corrected (commit `27fdcf2c`), and a subset of the three ran on the same four setups, 24 fixture runs for 2,697,921 tokens, whose 25 unmatched findings were all adjudicated false or attributed.

That second baseline could not set targets: it ran on the fixture set before the correction, it had findings adjudicated real, and five GLM lead stages were still incomplete after the retry pass: two reports refused with `incomplete-evidence` for claiming a complete assessment that needed probe evidence, one report that was not valid JSON, and two reports GLM itself marked incomplete. That left 4 of GLM's 46 runs alone incomplete and 1 of 46 as lead with the Opus skeptic. This baseline therefore ran on Opus alone, which failed no stage in any run.

Three of the attributed findings, two in the second baseline and one in the subset, show a grader defect recorded in BUGS.md as "Seeded-defect grader gives a planted defect to a nearer unrelated finding": a GLM finding describing the planted defect cited a line or two away, and an unrelated finding citing the planted line took the match, so severity accuracy was judged on the wrong finding. No Opus run in this baseline was affected.

## Cross-paired GLM 5.3 run

The second baseline's four setups were agreed as the cross-paired run, to tell self-agreement from weak scope judgment behind GLM's high unmatched confirmations. Its figures (46 fixture runs per setup, lead / skeptic):

| Figure | Opus / Opus | GLM / GLM | GLM / Opus | Opus / GLM |
|---|---|---|---|---|
| Detection | 42/42 | 38/38 | 41/41 | 42/42 |
| Clean-change false positives per clean fixture | 0.00 (0/4) | 0.17 (1/6) | 0.00 (0/6) | 0.00 (0/4) |
| Unmatched confirmations per other fixture | 0.21 (9/42) | 0.58 (21/36) | 0.44 (17/39) | 0.36 (15/42) |
| Out of scope raised | 2/6 | 4/6 | 2/6 | 2/6 |
| Severity accuracy | 27/42 | 21/38 | 25/41 | 26/42 |
| Skeptic accuracy | 92/92 | 86/86 | 90/90 | 92/92 |
| Tokens per fixture run | 53,560 | 141,451 | 106,224 | 82,239 |
| Fixture runs incomplete | 0 | 4 | 1 | 0 |

The skeptic verdicts on the 81 unmatched findings, before adjudication, answer the question. GLM as skeptic confirmed all 41 it judged, 24 from its own lead and 17 from Opus's, while refuting every decoy, so it rejects claims that are wrong about the code but not true observations that are not defects; the weakness is scope judgment, not agreement with itself. Opus as skeptic refuted 8 of the 28 GLM lead findings it judged (19 confirmed, 1 unverified) and none of the 12 from its own lead (11 confirmed, 1 unverified), two of which were real. The subset is consistent but small: there the Opus skeptic confirmed 7 of 9 GLM lead findings and left 2 unverified, and the GLM skeptic confirmed all 11 it judged. Swapping the skeptic moves unmatched confirmations by about 0.15 (0.21 to 0.36 behind an Opus lead, 0.58 to 0.44 behind a GLM lead), and swapping the lead by about 0.22 (0.21 to 0.44 with an Opus skeptic, 0.36 to 0.58 with a GLM skeptic): a GLM lead raises more scope and preference findings in the first place.

These figures are evidence for the separate decision to admit Vibe and GLM as a reviewer host, tracked in FEATURES.md; the runtime's gate is unchanged and the targets above include no GLM figure.

## Qualifications

Each figure rests on two repetitions of one model on one host version, so the spread is a lower bound on run-to-run variation. Adjudication is the maintainer's judgment on the controller's proposals, made against the fixtures' requirements and the earlier rulings. Detection is at the ceiling and cannot rank models or changes. The suite measures a lead and a skeptic only; it does not measure the fresh-gate catch rate, which needs fixtures that run a repair, a closure and a fresh gate.
