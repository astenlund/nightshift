# Finding-scoped evidence: suite evidence

Evidence for the 3.3.33 change governed by [its spec](../specs/finding-scoped-evidence.md). Deterministic coverage is in `tests/runtime-finding-scope.test.js` and the affected runtime suites.

## Run

Whole seeded-defect suite, 23 fixtures twice, on Opus 5.5 through the commit `ed7b8d05` state of the harness and runtime, Claude Code 2.1.319, on Windows. It spent 2,942,243 tokens against a budget of 5,500,000 inside the delivery's 8,000,000 cap. Six probe requests across five fixture runs were inspected and approved; each ran in a private copy. Raw artifacts are in `.tmp/session-5b312f10/suite-opus`.

The comparison run is the 2026-10-29 rerun, regraded with the current grader in a copy. Its figures reproduced the original report, which is the evidence that grading did not change. The current fixture loader refuses a frozen run whose decoys lack surfaces, so that copy's frozen decoys received the same mechanical surfaces the fixtures now carry, which no grading step reads, and its manifest hash was updated.

## Figures

| Figure | 2026-10-29 regraded | This run |
|---|---|---|
| Detection | 100.0% (42/42) | 100.0% (42/42) |
| Clean-change false positives per clean fixture | 0.33 (2/6) | 0.00 (0/5) |
| Unmatched confirmations per other fixture | 0.23 (9/40) | 0.03 (1/37) |
| Out of scope raised | 33.3% (2/6) | 33.3% (2/6) |
| Severity accuracy | 83.3% (35/42) | 85.7% (36/42) |
| Skeptic accuracy | 100.0% (92/92) | 100.0% (85/85) |
| Tokens per fixture run | 56,655 | 63,962 |

The comparison is confounded and these changes are not attributed to the feature. The harness and review machinery differ. One fixture run ended incomplete and four had no complete skeptic, against none in the earlier run. Four fixture runs were graded with executed probes, against none. One unmatched finding still awaits adjudication, so the figures are provisional. The targets are stale because the fixture set changed when decoys gained surfaces. Whether a real lead's surfaces differ in distribution from the authored decoys was not measured.

## Surfaces and probes

All 48 lead findings named surfaces, and all their paths resolved, a share of 1.0 for this run. Five named more than one surface and 20 named a basis file. All 92 skeptic verdicts answered surfaces in a report the runtime accepted. All six requested probes declared `paths`, one of them empty for a host question.

These show that leads named resolvable surfaces and skeptics answered per surface on Claude Code. They do not show that a finding's surfaces were complete, that basis files were separated correctly or that a per-surface judgment was right, since the grader compares finding-level results and each planted defect has one location.

## Not verified

A Sol subset on Codex was attempted and ended on the host's usage limit before any fixture completed, with no token usage recorded for it, so no Codex evidence exists and the suite's known spending is the Opus figure above; every model-owned claim stays provisional on Codex. Vibe was not run. The closure turn over confirmed surfaces, skeptic dialogue turns, the use of a host result handed over after a repair and spec-review basis confinement were not exercised by the suite and stay provisional on each host.
