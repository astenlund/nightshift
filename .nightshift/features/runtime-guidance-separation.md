---
name: runtime-guidance-separation
description: Separate the guidance agents follow during a run from reference material that only informs design
metadata:
  type: feature
status: exploring
---

# Separate run-time guidance from reference material

Raised by the user on 2026-09-25 while revising the global review-loop and publication-gate rules, and approved for tracking the same day. Tracked in [the feature index](../FEATURES.md#separate-run-time-guidance-from-reference-material).

## Requested direction

- Keep instructions and reference material in separate files. A reference file can inform how a feature is defined and implemented, but the plugin should not direct an agent to follow it during a run.
- The motivation is review: the user's global rules now review behavior-changing files (code, skills, instructions and anything an agent follows while working) separately from descriptive documentation, and a file that mixes the two counts as code until it is split. Separation lets a factual edit to a reference get an accuracy review rather than a full behavioral one, and keeps what agents follow reviewable as behavior.

## Current state

Every public skill links to [the operating brief](../../internal/workflow.md), and agents read [the runtime interface](../../internal/runtime/REFERENCE.md) and [the retained resource interface](../../internal/releases/REFERENCE.md) while operating a run. Those files both describe the implementation and direct agents, so under the rule above they currently count as code.

## Details to settle

Inventory which passages of each file direct agents and which only describe, and decide where the directing passages live (skills, the operating brief, or new instruction files) and whether the brief itself stays run-time guidance. Decide what, if anything, remains of each REFERENCE file as design reference, and how skills reach the run-time operations surface without loading reference material. Preserve every current obligation during the move; a lost sentence is a behavior change. Coordinate with the [shared BACKLOG.md meta-index](backlog-meta-index.md), which moves shared guidance the other way. The change alters model-owned behavior, so it needs installed-host evidence.

Tracking preserves the idea for design; it does not authorize implementation or publication.
