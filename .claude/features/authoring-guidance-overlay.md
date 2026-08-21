---
name: authoring-guidance-overlay
description: Explore a dimension-derived authoring overlay for specs and plans, applied on top of superpowers when installed and as the native fallback when not
metadata:
  type: feature
status: exploring
---

# Authoring guidance overlay

Draft exploring how nightshift supplies spec- and plan-authoring guidance. Prompted at the 2026-08-21 review-orchestration-tests morning report by the observation that handover's planning step leans on `superpowers:writing-plans` being installed, and by the wave-round-economy evidence that authoring-time levers are an order of magnitude cheaper than the review rounds that otherwise catch the same defects.

## The two pulls (captured from the user)

- Superpowers is widely used and actively maintained; forking its authoring procedures means maintaining a parallel copy of general-purpose material (task sizing, TDD granularity, worktrees, subagent execution) that nightshift does not differentiate on and would struggle to keep current.
- When superpowers (or an equivalent) is not installed, plan authoring falls back to model defaults, and `revise-plan` then catches the shortfall at review-round prices. That is a serious gap.

## Candidate shape (none committed)

Nightshift already owns the insight in review form: `internal/revise/plan.md` and `internal/revise/spec.md` dimensions are the de facto acceptance criteria for a good plan and spec, and the catch-earlier levers collected in `wave-round-economy.md` are the authoring-time complement. The candidate is a thin inversion of those files into an authoring overlay with a single source of truth inside the repo, so every dimension calibration automatically upgrades the authoring guidance:

- **Superpowers installed**: defer to it for authoring process, and always apply the nightshift overlay of hard-earned lessons on top (user decision at capture: the overlay is not skipped just because superpowers is present; its content is nightshift-specific and complements rather than duplicates the upstream process).
- **Superpowers absent**: the planning step invokes a nightshift-native authoring fallback derived from the same dimension files, instead of silently degrading to model defaults.

Accepted trade at capture: plans authored through the two paths will differ in shape, with `revise-plan` as the equalizer; the fallback is deliberately leaner than superpowers.

## Open questions

- Detection contract for "an authoring skill is installed" and precedence when several qualify (compare the same question in [Review dimension deferral](review-dimension-deferral.md), which resolves the mirror problem for review dimensions).
- Whether the overlay is generated from the dimension files at invocation time or maintained as a curated companion file that cites them.
- Where the overlay hooks into handover's planning step and the standalone planning entry.
- How the overlay stays honest about scope: authoring pedagogy that superpowers already owns stays out; only nightshift-specific lessons (dimension criteria, catch-earlier levers, plan-contract requirements) go in.

## Requirements

- The dimension files this inverts: `internal/revise/plan.md`, `internal/revise/spec.md` (existing).
- The catch-earlier levers collected in [Wave round economy](wave-round-economy.md) (draft; the lever list is an input, not a blocker).
