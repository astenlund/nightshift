---
name: review-dimension-deferral
description: Explore deferring revise review dimensions to other installed skills with rigorous review specs, falling back to the nightshift defaults
metadata:
  type: feature
status: exploring
---

# Review dimension deferral

Draft exploring a dimension-resolution step at review setup: when another installed skill carries rigorous review dimension specs, the revise engine adopts those dimensions; when none qualifies, it falls back to the nightshift defaults currently bundled in `internal/revise/code.md`, `plan.md`, and `spec.md`. Captured from a user directive on 2026-08-20, promoted from a quick-win capture to a draft because the detection contract needs real design.

## Open questions

- **Detection contract**: what marks another skill's review specs as rigorous enough to adopt? A declared marker in the skill's own files, a structural check (named dimensions with criteria), or a curated allowlist?
- **Precedence**: when several installed skills qualify, which wins, and is the choice user-visible or configured?
- **Mid-run stability**: the resolved dimension set must freeze at run start (the wave's cells must stay stable across rounds and resumes), so resolution is a run-creation step, recorded in the checkpoint, never re-evaluated mid-run.
- **Fixture impact**: the orchestration transition module treats dimensions as data, so deferral should compose without module changes; confirm the delivery-map and payload machinery carry foreign dimension criteria unchanged.

## Requirements

- The revise engine's dimension parameter files (shipped).
- Skill discovery on the host (varies by host; interacts with the agent-host-agnostic work).
