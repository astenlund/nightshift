---
name: degraded-assessment-mode
description: Let a weaker model carry an independent assessment when no supported strong reviewer is available, clearly labeled as degraded and refused at the gates that require strength
metadata:
  type: feature
status: exploring
---

# Degraded assessment mode

## Origin

Raised by the user on 2026-09-17 during run `c675a074-6431-46e2-85b7-e3b8616e9220`, which was the live case. The supported strong reviewers are `claude-fable-5-1` and `gpt-6-astra`. The Codex allowance carrying Astra was unavailable for three days, and a dispatch attempting Fable was refused by the host for exceeding its limit, so the lifecycle could obtain no admissible assessment at all. Work continued only by running Opus as an advisory reviewer outside the runtime: `internal/runtime/review.js` enforces the strong list at dispatch and again at receipt import, and `validate` and `dispose` operate only on findings from an imported receipt, so a weaker model could read the change but none of its findings, verdicts or dispositions could be recorded and `reviewCurrent` stayed false. The user improvised the split by hand: Opus advisory now, a supported strong review before any push. This record absorbs the earlier `opus-review-gate` follow-up, which tracked the inability to use an explicitly user-selected substitute.

## Shape

A degraded assessment is recordable, so obligations survive compaction and the loop can proceed, while remaining visibly distinct from a strong one everywhere it is consumed. The label is the substance: it has to be legible at every gate, because `reviewGate` checks `strength`, receipt import re-checks the model, and `dispose` and `validate` accept only imported findings. A tier that satisfies one gate and is invisible to the next would be worse than none.

## Open question

Which gates may a degraded assessment satisfy on its own. The candidate split, taken from what the user did manually, is that it may advance a task and record findings, verdicts and dispositions, while publication still requires a supported strong assessment of the same content. Whether the label rides on the review record, the task or the run, and whether a later strong assessment supersedes or merely supplements a degraded one, are unsettled. The controller's model-choice policy in [Initial reviewer selection](initial-reviewer-selection.md) is the natural home for the selection rule once the gate split is decided.

## Anti-goals

Not a general weakening of the review gate: a degraded assessment never counts as strong, and its existence must not make a strong assessment optional where one is required today. Not a substitute for cross-host review when the other host is available.
