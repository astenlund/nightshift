---
name: runtime-guidance-separation
description: Separate the guidance agents follow during a run from reference material that only informs design
metadata:
  type: feature
---

# Separate run-time guidance from reference material

Raised by the user on 2026-09-25 while revising the global review-loop and publication-gate rules; the user settled its commitments and graduated it from Exploring the same day. Tracked in [the feature index](../FEATURES.md#separate-run-time-guidance-from-reference-material). Tracking and readiness do not authorize implementation.

## Problem

Handover and the four revise skills link to [the operating brief](../../internal/workflow.md) and [the runtime interface](../../internal/runtime/REFERENCE.md), and all eight public skills link to [the retained resource interface](../../internal/releases/REFERENCE.md); agents read these files while operating a run. The two REFERENCE files both describe the implementation and direct agents. The user's global review rules now review behavior-changing files (code, skills, instructions and anything an agent follows while working) separately from descriptive documentation, and a file that mixes the two counts as code until it is split. As long as they mix, a factual edit to a reference gets a full behavioral review, and what agents follow is not kept separately reviewable as behavior.

## Agreed direction

- Keep instructions and reference material in separate files. A reference file can inform how a feature is defined and implemented, but no run loads it and no skill directs an agent to follow it during a run.
- The operating brief stays run-time guidance.
- The passages of the two REFERENCE files that agents need to operate a run (request shapes, gates, sequencing and other operating rules) move into a run-time operations guide beside the runtime, which the skills link to. What remains of each REFERENCE file is explanation of design and behavior, kept as a design reference.
- Implementation starts with an inventory that classifies every passage of the three files as directing or describing and maps each directing sentence to its new location. The independent review verifies that mapping one-for-one, because a dropped or weakened sentence is a behavior change.

## Before implementation

- The change touches every public skill and all three shared files, so it needs a concise governing spec in `.nightshift/specs` with independent spec review before code, and a plugin version increase.
- It changes model-owned behavior on both hosts, so at start the user decides between a budgeted installed-host campaign and deterministic evidence only with the model-owned behavior marked unverified.
- No dependency blocks it. Coordinate with the [shared BACKLOG.md meta-index](backlog-meta-index.md), which moves shared guidance in the opposite direction.
