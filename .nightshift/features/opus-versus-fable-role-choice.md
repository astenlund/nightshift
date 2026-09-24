---
name: opus-versus-fable-role-choice
description: Investigate which Nightshift roles could use Opus 5.5 instead of Fable, and the cost difference
metadata:
  type: feature
status: exploring
---

# Model choice per role: Opus 5.5 versus Fable

Raised by the user on 2026-09-22 in this repository after the release of Opus 5.5 (`claude-opus-5-5`) and triaged on 2026-09-24. The user's impression is that the capability gap between Opus and Fable (`claude-fable-5-1`) is shrinking while the price gap grows, so Opus may be preferable for some Nightshift work. This is an improvement idea, not a defect. Tracking does not authorize implementation or change any current model policy.

## Question

Which roles (implementation, lead review, skeptical validation, cumulative reassessment, documentation reconciliation, retrospective) could use Opus 5.5 without falling below the role's required capability and strength, and what the cost difference would be. The weekly Fable usage cap the user identified during run adoption (see the fallback entry below) makes availability a practical factor alongside price.

## Current state and related records

- Shipped behavior already steers strong roles to Fable: `STRONG_MODELS` in `internal/runtime/review.js` admits only `claude-fable-5-1` on Claude and `gpt-6-astra` on Codex, enforced at review dispatch (`review-strength`) and at receipt import (`invalid-receipt`), and `internal/workflow.md` names Fable and Astra as the strong-role references. Using Opus for lead review, skeptical validation or reassessment therefore needs a runtime change, not only guidance. Coordinate with [Degraded assessment mode](degraded-assessment-mode.md), which already records that Opus findings cannot be recorded under this gate.
- The [initial reviewer selection](initial-reviewer-selection.md) draft restricts the initial lead to Fable or Astra and prefers Astra over Opus when Fable is unavailable. This investigation would re-examine that ranking rather than assume it.
- [Permitted validation fallbacks are lost between runs](../BUGS.md#permitted-validation-fallbacks-are-lost-between-runs) records that prior agreements already permitted Opus for Claude-specific checks while keeping strong assessment on Fable or Astra.
- Repository guidance prefers describing roles by capability and required strength rather than naming models; any outcome should follow that, retaining concrete identities only in configuration and evidence.

## Field observation

As of 2026-09-24 the user runs Opus (in this session's context, Opus 5.5) as the default controller and subjectively reports it working very well. This is unmeasured controller-role experience only; lead review, skeptical validation and the other roles remain untested. The user wants live testing, not this impression, to settle the question.

## Open before commitment

- The capability gap is unmeasured; no comparison has been run. Settle a comparison method and budget.
- Current pricing for both models has not been checked.
- Whether any change should widen the runtime strong-model gate, add a separately labeled role, or leave strong roles unchanged is undecided.
