---
name: dimension-derived-authoring-fallback
description: Explore a nightshift-native plan and spec authoring fallback derived from the revise dimension files, closing the gap when superpowers is not installed
metadata:
  type: feature
status: exploring
---

# Dimension-derived authoring fallback

Draft exploring whether nightshift should ship its own plan- and spec-authoring guidance, prompted by a 2026-08-21 morning-report discussion of the superpowers dependency. Captured from two user pulls in tension:

1. Superpowers is widely used and actively maintained; forking its authoring skills means a maintenance race nightshift would lose, over general-purpose process (task right-sizing, TDD step granularity, worktree discipline) that nightshift does not differentiate on.
2. When superpowers (or an equivalent) is not installed, plan authoring inside the handover pipeline degrades silently to model defaults, and `revise-plan` then catches the shortfall at review-round prices. The wave-round-economy evidence says authoring-time levers are an order of magnitude cheaper than review rounds, so a missing authoring skill maximizes exactly the cost that feature exists to cut.

## Candidate shape (none committed)

Not a fork: a thin inversion of files nightshift already maintains. The `internal/revise/plan.md` and `internal/revise/spec.md` dimension files are nightshift's operative definition of a good plan and spec (they are the acceptance criteria reviewers enforce). The fallback is a bundled authoring preamble that says "write to satisfy these dimensions", derived from the same files so there is a single source of truth; every dimension calibration automatically upgrades the authoring guidance.

- With superpowers installed: defer to it for process, layering the dimension-derived checklist on top (roughly today's implicit behavior).
- Without it: the planning step invokes the nightshift-native fallback instead of silently degrading. Fits the host-adapter philosophy: detect the capability, adapt, never hard-depend.

Accepted trade: plans authored through the two paths differ in shape, with `revise-plan` as the equalizer; the fallback stays deliberately leaner than superpowers.

## Open questions

- Detection seam: how the planning step discovers whether a capable authoring skill is installed (skill listing probe, host adapter, or configuration), and where the preference order lives.
- Derivation mechanics: whether the preamble is generated from the dimension files at authoring time (read-and-invert instruction) or a hand-maintained summary with a drift check against the dimension files.
- Scope: plans only, or specs too (brainstorming is a larger surface than plan writing; the spec-side gap may be better covered by the existing grounding step).
- Whether the authoring-lever content accumulating in wave-round-economy's Catch-earlier levers section feeds this preamble directly.

## Requirements

- The revise dimension files this inverts: `internal/revise/plan.md`, `internal/revise/spec.md` (existing; single source of truth for the derived guidance).
- Handover's planning step as the invocation site (existing).
