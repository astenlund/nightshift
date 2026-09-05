# Dimension duration tracking and split suggestions

Records per-dimension review durations across revise rounds and surfaces a suggestion to split any dimension that runs persistently long relative to its siblings, with the split proposed along the profile's own numbered criteria.

## Motivation

A revise round finishes when its slowest cell finishes, so one oversized dimension sets the wall-clock cost of every round it participates in. During the 2026-09-03 plan run the plan-correctness cell was the straggler in every multi-cell round: it applies all seventy-eight before-and-after blocks and executes every embedded fixture and both patched suites in memory each time, roughly twice the work of its siblings. At one round the last remaining cell had been running for over fifteen minutes against the user's calibration that a good revise agent run sits in the three-to-five-minute range.

That pattern was visible only because a human was watching. The workflow already returns per-agent usage, so the data exists; nothing consumes it.

## What gets recorded

The workflow returns `duration_ms`, tokens, and tool-use counts per agent. The controller propagates the duration into the round result and the checkpoint, keyed by cell, and keeps a per-run summary. Nothing here needs a new measurement mechanism; it needs the existing measurement to survive into the round record.

The per-round duration joins the convergence log line described in [Revise progress visible by default](revise-progress-visible-by-default.md), so the straggler is visible while the run is happening rather than only in retrospect.

## The suggestion

At the dimension retrospective, or in the morning report, the controller surfaces any cell whose median duration exceeds a threshold of its siblings. The candidate threshold is twice the round median sustained over three or more rounds; the number is a starting point to calibrate, not a settled value, and the user's three-to-five-minute band is the absolute reference the relative threshold should stay consistent with.

The suggestion names the cell, the observed ratio and round count, and a proposed split along the profile's numbered criteria, since those criteria are already the dimension's own decomposition and a split along them needs no new taxonomy.

## Cross-run memory

Cross-run suggestions would need a durable ledger the engine deliberately does not keep; it keeps no cross-run ledger for finding counts either, and adding one is a larger decision than this feature should make on its own. A first slice is per-run only: the suggestion draws on the current run's rounds and says so. If a cross-run ledger is ever introduced for another reason, this feature reads it rather than creating a second one.

## First suggested split

The concrete split this feature would propose on its first run already has its own entry: [Split the plan-correctness dimension into a static cell and an executable cell](../QUICK_WINS.md#review-dimension-sourcing), which separates static claims (file paths, anchors, cited API surfaces, cross-file claims, embedded literals) from executable claims (embedded test code execution and spec-derived mappings re-derived from source). That quick win stands on its own evidence and does not wait for this feature; it is named here because it is the worked example of the output this feature produces, and because the two must agree on how a split is described.

## Files this touches

- `internal/revise/SKILL.md`: the round result cell shape and the dimension retrospective.
- `internal/revise/revise-round.workflow.js`: propagating agent usage into the cell result.
- The convergence log and the morning report's review of it.

## Verification

Fixtures cover a run with balanced cells (no suggestion), a run with one sustained straggler (suggestion, naming the cell, ratio, and round count), a straggler over fewer rounds than the threshold requires (no suggestion), a run where usage is missing for some agents (no suggestion rather than a suggestion from partial data), and a resumed run whose checkpoint carries prior rounds' durations.
