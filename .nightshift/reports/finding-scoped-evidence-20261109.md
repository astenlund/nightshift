# Finding-scoped evidence: suite evidence

Evidence for the 3.3.33 change governed by [its spec](../specs/finding-scoped-evidence.md). Deterministic coverage is in `tests/runtime-finding-scope.test.js` and the affected runtime suites.

## Run

Whole seeded-defect suite, 23 fixtures twice, on Opus 5.5 through the commit `ed7b8d05` state of the harness and runtime, Claude Code 2.1.319, on Windows. It spent 2,942,243 tokens against a budget of 5,500,000 inside the delivery's 8,000,000 cap. Six probe requests across five fixture runs were inspected and approved. Five ran in a private copy; the sixth, on `port-validation`, was refused as `invalid-probe` before running because its source was not ASCII. Raw artifacts are in `.tmp/session-5b312f10/suite-opus`.

The comparison run is the 2026-10-29 rerun, regraded with the current grader in a copy. Its figures reproduced the original report, which is the evidence that grading did not change. The harness requires decoy surfaces only when a new run starts, so a frozen run from before them is graded unchanged. Both runs here were graded with the final grader identity `fe8909b06bc8`; the earlier run's copy is otherwise as it was saved.

## Figures

| Figure | 2026-10-29 regraded | This run |
|---|---|---|
| Detection | 100.0% (42/42) | 100.0% (42/42) |
| Clean-change false positives per clean fixture | 0.33 (2/6) | 0.00 (0/5) |
| Unmatched confirmations per other fixture | 0.23 (9/40) | 0.00 (0/37) |
| Out of scope raised | 33.3% (2/6) | 33.3% (2/6) |
| Severity accuracy | 83.3% (35/42) | 85.7% (36/42) |
| Skeptic accuracy | 100.0% (92/92) | 100.0% (85/85) |
| Tokens per fixture run | 56,655 | 63,962 |

The comparison is confounded and these changes are not attributed to the feature. The harness and review machinery differ. One fixture run ended incomplete and four had no complete skeptic, against none in the earlier run. Four fixture runs were graded with executed probes, against none. The one unmatched finding, on the `quick-win-dependencies` fixture, was adjudicated real on 2026-11-09: the fixture's `REQUIRES` pattern is looser than its clause, which no truth entry describes, so it counts in no false-positive figure and no finding awaits adjudication. The targets are stale because the fixture set changed when decoys gained surfaces. Whether a real lead's surfaces differ in distribution from the authored decoys was not measured.

## Surfaces and probes

All 48 lead findings named surfaces, and all their paths resolved, a share of 1.0 for this run. Five named more than one surface and 20 named a basis file. All 92 skeptic verdicts answered surfaces in a report the runtime accepted. All six requested probes declared `paths`, one of them empty for a host question.

These show that leads named resolvable surfaces and skeptics answered per surface on Claude Code. They do not show that a finding's surfaces were complete, that basis files were separated correctly or that a per-surface judgment was right, since the grader compares finding-level results and each planted defect has one location.

## Sol subset on Codex

A first attempt ended on the host's usage limit before any fixture completed, with no token usage recorded for it. By the user's triage decision on 2026-11-09 the subset ran again: four fixtures (`retry-argument-order`, `registry-reconcile`, `latency-percentile`, `line-ending-freshness`) once each on Codex `gpt-6.1-sol`. It spent 1,742,368 tokens against a budget of 5,000,000, which brings the suite's known spending in this delivery to 4,684,611 of the 8,000,000 cap. Three probe requests were inspected and approved; each ran in a private copy. Raw artifacts are in `.tmp/session-5b312f10/suite-sol-2`. Fixture set `0ffc65575816`, grader `fe8909b06bc8`. The suite gives each dispatch a single candidate, so these figures are Sol's alone.

| Figure | This subset |
|---|---|
| Detection | 100.0% (4/4) |
| Unmatched confirmations per other fixture | 0.00 (0/2) |
| Out of scope raised | 0.0% (0/1) |
| Severity accuracy | 100.0% (4/4) |
| Skeptic accuracy | 100.0% (5/5) |
| Tokens per fixture run | 435,592 |

All four first-pass lead findings named surfaces, and the skeptic reports answered with surfaces in all four fixture runs, nine claims in total. The fixture runs on `line-ending-freshness` and `registry-reconcile` have no complete skeptic, each with one claim left unverified, and the cause was not examined. Four fixtures run once are a small sample, the targets are stale and this subset is not comparable with the Opus run above. It shows that the surface mechanics worked on Codex in these runs, not the rate at which they do.

## Not verified

Beyond the Sol subset above, model-owned claims stay provisional on Codex. Vibe was not run. The closure turn over confirmed surfaces, skeptic dialogue turns, the use of a host result handed over after a repair and spec-review basis confinement were not exercised by the suite and stay provisional on each host.
