---
name: bundled-revise-controller
description: Ship a deterministic revise-state controller so sessions stop hand-rolling the engine's state machine per artifact type
metadata:
  type: feature
---

# Bundled revise controller

Feature: the revise engine ships an executable controller for its own state machine. This file is the authoritative design record.

## What it does

`internal/revise/SKILL.md` prescribes the checkpoint files (`.tmp/revise-state.md`, `.tmp/revise-round-result.md`, the payload files), the cell lifecycle, the drift guard on persisting a round result, the adjudication boundary, and the staleness sweep that runs only once every applicable cell is inactive. Nothing executes any of it: each session writes its own controller. The 2026-08-22 breakout-dependency-drift handover wrote three near-identical ones (spec, plan, code) in the session scratchpad, and the spec and code loops each ran one premature sweep that the prose forbids; both were caught and reverted by hand.

## Design

- One script, `internal/revise/revise-ctl.js`, parameterized by artifact type (spec, plan, code) and the profile file's dimension list, owning: `fingerprint` (the artifact-type fingerprint recipe), `init` with a pre-seeded acknowledgement file, `start-round` (emits the Workflow args envelope), `persist` (rejects a result whose round or fingerprint does not match, and a fingerprint that moved in flight), `boundary` (certify, applied changes, acknowledgements, follow-ups, verifier stamp), `sweep` (refuses unless every applicable cell is inactive or N/A), and `show`.
- The state file renders from one JSON checkpoint the controller owns; the markdown in `.tmp/revise-state.md` stays the documented authority and is regenerated on every transition.
- Payload rendering stays with the artifact parameter file (`code.md`, `plan.md`, `spec.md`) through a small renderer the controller calls, so dimension text never duplicates into the script.
- The manual Agent fallback in `SKILL.md` keeps working without the script; the script is the preferred path, not a new contract.

## Requirements

- `internal/revise/revise-round.workflow.js` and its result envelope (existing; the controller consumes it unchanged).
- The checkpoint and recovery contract in `internal/revise/SKILL.md` (existing; the script implements it rather than redefining it).
