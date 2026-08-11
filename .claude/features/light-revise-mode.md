---
name: light-revise-mode
description: Explore a lightened variant of the revise review commands (one fresh reviewer per iteration, curated dimension set) for interactive use
metadata:
  type: feature
status: exploring
---

# Light revise mode

Codify a lightened shape of the revise review commands for interactive sessions: one fresh reviewer per iteration instead of the full per-dimension swarm, and a curated dimension set that skips the dimensions least relevant to the artifact under review.

Prompted by the 2026-08-11 revise-spec run over `.claude/features/dependency-cycle-detection.md`, where the swarm was deliberately collapsed to a single reviewer carrying five of seven dimensions (D3 scope/decomposition and D6 reasoning-preservation skipped as least relevant for a small, non-sliced parser feature).

Open questions to settle when it graduates to a designed feature: how the dimension-curation rule is chosen (artifact-type defaults vs per-run judgment), how the two-phase convergence invariant maps onto single-reviewer iterations, whether skeptic verification of every finding still holds at lower cost, and whether it rides the existing revise syntax (e.g. a `--light` flag) or is a separate entry point.