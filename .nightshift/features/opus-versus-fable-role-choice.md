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

Which roles (implementation, lead review, skeptical validation, cumulative reassessment, documentation reconciliation, retrospective) could use Opus 5.5 without falling below the role's required capability and strength, and what the cost difference would be. Weekly Fable usage caps make availability a practical factor alongside price.

## Current state and related records

- The [initial reviewer selection](initial-reviewer-selection.md) draft restricts the initial lead to Fable or Astra and prefers Astra over Opus when Fable is unavailable. This investigation would re-examine that ranking rather than assume it.
- [Permitted validation fallbacks are lost between runs](../BUGS.md#permitted-validation-fallbacks-are-lost-between-runs) records that prior agreements already permitted Opus for Claude-specific checks while keeping strong assessment on Fable or Astra.
- Repository guidance prefers describing roles by capability and required strength rather than naming models; any outcome should follow that, retaining concrete identities only in configuration and evidence.

## Open before commitment

- The capability gap is unmeasured; no comparison has been run. Settle a comparison method and budget.
- Current pricing for both models has not been checked.
- Whether shipped guidance or defaults steer toward Fable specifically has not been established.
