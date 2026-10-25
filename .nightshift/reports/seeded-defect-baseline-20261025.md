# Corrected seeded-defect baseline

This report records the Opus 5.5 baseline the user set the [seeded-defect suite](../specs/seeded-defect-suite.md)'s targets from on 2026-10-25. It supersedes the targets set on 2026-10-24 from the baseline in [the earlier baseline report](seeded-defect-baseline-20261024.md), which also holds the cross-paired GLM 5.3 run.

## Why the targets were reset

After the 2026-10-24 targets were set, a review found that the harness had dropped `retry-argument-order`'s change from the reviewer's diff, so that baseline's two runs of that fixture reviewed it without its diff. The harness was fixed and hardened, and an Opus baseline on the fixed harness then ruled two findings real: `quiet-flag` still carried a shebang without an executable bit, the artifact already removed from two other fixtures, and check-environment's timeout sent only SIGTERM, so on POSIX untrusted check code that ignores it could hang the runner. Both fixtures were corrected: `quiet-flag` lost its shebang, which moved its planted defect and decoy up one line, and check-environment's `spawnSync` call now kills with SIGKILL. The fixture set hash changed with them, which left the 2026-10-24 targets stale.

## Method

Environment: Windows 11, Node 22, Claude Code 2.1.310, Opus 5.5 as lead and skeptic. The suite held the same 23 fixtures, with those two corrected. Each fixture ran twice, then one `--retry` pass, which dispatched one lead again after an unusable report (`quick-win-dependencies`, first repetition). Every dispatch shares one identity: review machinery `3b7229cc6b1c`, dispatching harness `a8c46c2be2a2`, commit `f63d2346`, so the run is not mixed, and the harness is the current one, unchanged since commit `72ad4569`. The fixture set hash is `71d708fb5ea5`, the conventions hash `fefb60b9ff27` and the grader hash `7748b65c6b16`. The run spent 2,453,053 tokens, the superseded attempt included. Raw artifacts stay in `.tmp/9fe31e9c-suite/baseline-5`.

## Results and targets

| Figure | Baseline | Spread between repetitions | Target |
|---|---|---|---|
| Detection | 100% (42/42) | 100% to 100% | 100% |
| Clean-change false positives per clean fixture | 0.33 (2/6) | 0.33 to 0.33 | at most 2 in 6 (recorded as 0.3334) |
| Unmatched confirmations per other fixture | 0.10 (4/40) | 0.00 to 0.20 | at most 0.20 |
| Severity accuracy | 64.3% (27/42) | 61.9% to 66.7% | at least 61.9% (recorded as 0.619) |
| Skeptic accuracy | 100% (92/92) | 100% to 100% | 100% |
| Tokens per fixture run | 53,051 | 52,546 to 53,557 | at most 60,000 |

Each target other than tokens sits at the worse edge of the spread between the two repetitions, so a later change reads as a regression only outside what identical runs already produce. The token target stays at the 60,000 the user set on 2026-10-24, about 12% above the higher repetition here, since two repetitions understate run-to-run variation: the 2026-10-24 baseline's repetitions averaged 53,451 and 55,662 tokens on an unchanged suite. The targets are recorded in `tools/seeded-defects/targets.json` with this report and the fixture set hash; graded reports print each as a target and the current value, without the direction, which this table gives.

The targets were set from Opus 5.5 alone and describe its figures. `targets.json` holds one number per figure, not one per model, so a report on another model is printed against them all the same, but that comparison is out of their scope: Sol used about 446,000 tokens per fixture run in the first baseline and GLM 5.3 about 138,000, against Opus's 54,776, so the token target in particular would not carry over. A change of model is compared as its own input, as the spec's comparison section describes, not against these targets.

Detection is 100% in every dimension (requirements 6/6, correctness 18/18, security and data safety 8/8, design 2/2, performance 6/6, tests 2/2), so detection can show a regression but not an improvement. Out of scope: 2 of 6 out-of-scope entries raised, both with `required` false. `retry-argument-order`'s lead received its full diff. Thirteen of the fifteen severity misses rate a defect one step too high: important defects as critical in latency-percentile, registry-timeout, retry-argument-order and revision-history (twice each) and resume-targets (once), and minor defects as important in quick-win-dependencies and tag-rule-duplicate (twice each). The other two rate a critical defect as important, in instruction-file-freshness and review-context-routing, once each.

## Adjudication

All seven unmatched findings were adjudicated false. Six follow earlier rulings: not making `bin/switch.js` runnable directly, message quoting in port-validation (both clean-fixture false positives), the duplicated host list in registry-reconcile, re-exporting from `src/index.js`, and validating a change's shape. The seventh is new: check-environment's timeout stops only the command it started, so a hung grandchild under a wrapper such as npm would outlive it. It was adjudicated false because `runCheck` still returns and the runner cannot hang, which was the substance of the SIGTERM finding, and stopping a whole process tree goes beyond what the requirement asks.

## Qualifications

Each figure rests on two complete repetitions of one model on one host version, so the spread is a lower bound on run-to-run variation. Adjudication is the maintainer's judgment on the controller's proposals, made against the fixtures' requirements and the earlier rulings. The suite measures a lead and a skeptic only; it does not measure the fresh-gate catch rate, which needs fixtures that run a repair, a closure and a fresh gate.
