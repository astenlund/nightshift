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

- Shipped behavior already steers strong roles to Fable: `STRONG_MODELS` in `internal/runtime/review.js` admits only `claude-fable-5-1` on Claude and `gpt-6-astra` on Codex, enforced at review dispatch (`review-strength`) and at receipt import (`invalid-receipt`), and `internal/workflow.md` names Fable and Astra as the strong-role references. Using Opus for lead review, skeptical validation or reassessment therefore needs a runtime change, not only guidance. Coordinate with [Degraded assessment mode](degraded-assessment-mode.md), which records that Opus findings cannot be recorded under this gate today, and whose commitments, agreed on 2026-09-29, have a weaker model carry a labeled degraded assessment when no strong model is available or the user explicitly selects one. Widening the strong list was left to this investigation until the user's decision of 2026-10-10, recorded below.
- The [initial reviewer selection](initial-reviewer-selection.md) policy restricts the initial lead to Fable or Astra, read since 2026-10-03 as the models on the strong list, and prefers Astra over Opus when Fable is unavailable. Its amendments of 2026-10-11 note that this ranking predates the user's decision below and is to be updated with it.
- [Permitted validation fallbacks are lost between runs](../BUGS.md#permitted-validation-fallbacks-are-lost-between-runs) records that prior agreements already permitted Opus for Claude-specific checks while keeping strong assessment on Fable or Astra.
- Repository guidance prefers describing roles by capability and required strength rather than naming models; any outcome should follow that, retaining concrete identities only in configuration and evidence.

## Field observation

As of 2026-09-24 the user runs Opus (in this session's context, Opus 5.5) as the default controller and subjectively reports it working very well. This is unmeasured controller-role experience only; lead review, skeptical validation and the other roles remain untested. The user wants live testing, not this impression, to settle the question.

## Strong-list decision

On 2026-10-10, during a run in another project, the user decided, in their words: "gpt-6-sol and opus 5.5 should be considered strong enough for code reviews agents and skeptics. it's no longer worth the considerable premium you pay for fable/astra." At inbox triage on 2026-10-11 the user chose to admit `claude-opus-5-5` and `gpt-6-sol` to the shipped strong list for every gated assessment, with the brief preferring them by default on cost grounds and Fable and Astra staying admissible, tracked as [Admit Opus 5.5 and Sol as strong reviewers](../QUICK_WINS.md#admit-opus-55-and-sol-as-strong-reviewers). That settles, by the user's decision rather than by a measured comparison, whether the strong-model gate widens for lead review, skeptical validation and reassessment.

## Open before commitment

- The capability gap is unmeasured; no comparison has been run. Settle a comparison method and budget for any further policy change, such as implementation or controller roles.
- Current pricing for both models has not been checked.
- Whether roles outside the strong-model gate should change, or a separately labeled role is wanted, is undecided. [User-configurable model policy file](model-policy-file.md) proposes moving the strong-model list into a file the user can edit.
