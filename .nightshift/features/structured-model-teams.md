---
name: structured-model-teams
description: Explore explicit multi-model team arrangements beyond the v3 controller's assignment judgment
metadata:
  type: feature
status: exploring
---

# Structured model teams

Explore optional declared multi-model team arrangements, such as a Fable controller with an Astra implementer, and structured assignments of models to lifecycle roles. The user requested this as a later feature on 2026-09-07 while refining cross-host review placement.

The [v3 MVP](nightshift-v3.md) supports cross-host reviewer dispatch and a complete Claude Code or Codex controller path. Current lead placement follows [the brief](../../internal/workflow.md#model-roles-and-ownership): GLM on Vibe, then Sol on Codex, then Opus on Claude. Current [VISION.md](../../VISION.md) requires approval for each role; fresh qualified same-host review remains valid. This later feature would add deliberate team arrangements while respecting availability, role ownership, required review strength, independent contexts, and the invariant priorities. Configuration, selection, and fallback details remain open; no particular team layout is prescribed yet.

The agreed policy for [initial spec/code reviewer selection](initial-reviewer-selection.md) is tracked separately; on 2026-10-03 its enforcement was settled as guidance backed by the existing strong-model checks. It does not prescribe the broader team arrangements explored here.
