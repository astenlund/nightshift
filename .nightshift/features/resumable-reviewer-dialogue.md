---
name: resumable-reviewer-dialogue
description: Keep the reviewer that found an issue available through its repair, and restore the adversarial dialogue between skeptic and reviewer when consequence, value or repair quality stays unclear
metadata:
  type: feature
status: exploring
---

# Resumable reviewer and adversarial repair dialogue

## Origin

Raised by the user on 2026-09-29, outside any run, first as a question: "quick investigation: before the v3 migration, we had a planned feature that described an adversarial conversation between a skeptic and a resumable reviewer. what happened to that? i can't find it in the backlog."

After the investigation below, the user chose to track it as its own feature, in their words: "this would be a valuable improvement; i've previously seen strong evidence that continuity can be very helpful when repairing brittle parts of the code. a fresh reviewer might miss something that the first one was a bit lucky to find. also. we'd have to re-evaluate if we want a direct exchange or not between the reviewer and the skeptic, as the controller makes all go/no-go decisions for fixes today. should responsibility move to the skeptic for small fixes, only escalating when a fix would require a bigger change?"

## History

The v2 design [Adversarial repair dialogue](adversarial-repair-dialogue.md), now a design archive that no active entry tracks, had the controller resume the skeptic and the originating reviewer to assess each admitted finding's consequence and the available responses. The two stayed adversarial throughout: the reviewer explained the consequence of leaving a finding unresolved while the skeptic challenged its evidence, likelihood and significance, and when a repair was warranted the skeptic proposed and revised it while the reviewer checked closure, regressions, ambiguity and adjacent invariants, with neither editing the artifact.

The v3 migration simplified it on 2026-09-06, in [its disposition](../../V3-MIGRATION.md#finding-decisions): "Keep skeptic validation of every finding, separate authority and value judgments, and controller-owned implement/defer/skip decisions. Use existing reviewer and skeptic evidence for straightforward decisions; extend dialogue when uncertainty or disagreement remains." [The migration status](../MIGRATION_STATUS.md) recorded it as Present, with "The supported replacement review path exists", until the migration accounting audit of 2026-09-29 corrected it to Partial with this entry as its tracked destination.

## Current behavior

[The operating brief](../../internal/workflow.md) and [revise-code](../../skills/revise-code/SKILL.md) keep the disposition's core: every finding receives fresh skeptic validation against concrete evidence, factual validity, authority and practical value stay distinct, and each finding is decided as implement, defer, skip or refuted. Reviewers and skeptics cannot edit reviewed inputs, and every repair batch needs a cumulative strong broad assessment. [WORKFLOW.md](../../WORKFLOW.md) says the controller decides whether to implement, defer or skip, and that where consequences, value or repair quality remain unclear or disputed, "those agents continue the adversarial dialogue"; [VISION.md](../../VISION.md) likewise says to extend the adversarial dialogue when consequence, likelihood, value or repair quality remains unclear or disputed. A search on 2026-09-29 found no mention of a dialogue, a dispute or resuming a reviewer in the brief, the skills or [the runtime reference](../../internal/runtime/REFERENCE.md#independent-assessment).

The runtime cannot resume a reviewer. Every review or skeptic dispatch starts a new session: `validateRequest` in `internal/runtime/review.js` admits only `host`, `model` and `effort` in each candidate, and the dispatch passes no session to the host runner. The Claude runner in `internal/runtime/hosts.js` has a `--resume` option that the dispatch never uses, and the Codex runner has none.

The user's own global review-loop routine, outside the plugin, already retains one reviewer per category across repair rounds and replaces one that cannot resume with a fresh reviewer given the full cumulative change and the prior findings.

## Direction

- Keep the reviewer that found an issue available through its repair, resuming it rather than always starting fresh, because continuity helps when repairing brittle code and a fresh reviewer might miss what the first one found partly by luck.
- Restore the escalation the v3 disposition kept: extend the dialogue when consequence, value or repair quality remains unclear or disputed.

## Open questions

- Whether the reviewer and the skeptic exchange directly or only through the controller, given that the controller makes every go/no-go decision on fixes today.
- Whether responsibility for small fixes moves to the skeptic, escalating to the controller only when a fix would need a bigger change; how small is judged; and how that fits the skeptic's independence and the rule that reviewers and skeptics cannot edit reviewed inputs. The v2 design kept edits away from both, with the skeptic proposing a repair and the reviewer checking its closure.
- How continuity coexists with the fresh reviews the brief requires: whether a resumed reviewer can supply the cumulative strong broad assessment after a repair batch, or verifies its own findings' repairs with a fresh assessment still owed, and whether skeptic validation stays fresh.
- Runtime support on both hosts: resuming a session through dispatch, how a resumed session's receipt is attributed and checked for fresh inputs, the context limits of a long-lived reviewer, and the fallback when a session cannot be resumed.
- Whether the migration status row for the v2 design stays Present once this entry tracks its missing dialogue.
- Relations: [Initial reviewer selection](initial-reviewer-selection.md) already says subsequent passes can resume the initial lead, and [Background review and assessment of selected work](selection-review-and-assessment.md) adds agents whose findings would face the same question.
