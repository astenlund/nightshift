---
name: controller-owned-revise-convergence-recovery
description: Explore longitudinal revise run-health reflection and recovery from review-induced expansion
metadata:
  type: feature
status: exploring
---

# Controller-owned revise convergence recovery

Feature: make longitudinal convergence health a controller-owned lifecycle boundary rather than a judgment the user must notice after many locally valid rounds. This file is an exploring draft, not yet a settled design.

## Problem

The revise controller records rounds, findings, applied changes, and fingerprints but does not causally reflect on whether its own fixes are producing later findings or moving an artifact below its intended abstraction level. The deterministic-init-backlog run reached dozens of rounds before user intervention because every local fix remained admissible while the run as a whole became self-expanding.

## Candidate contract

- After skeptic adjudication and before any artifact mutation, persist finding provenance and evaluate whether the accumulated delta still reduces unresolved artifact-level decisions without implementation-detail expansion.
- Require both a healthy longitudinal verdict and the per-finding artifact-layer gate before continuing.
- Classify later findings as introduced by, exposed by, or independent of earlier fixes, with evidence sufficient for cumulative run reporting.
- When review-induced expansion or non-convergence is detected, suspend incremental mutations and launches while preserving the complete round.
- Audit the accumulated delta against immutable accepted authority, retain artifact-owned decisions, carry mechanisms into implementation-plan scratch, route scope expansion to follow-up, and rebuild mutable excerpts only after containment is proved.
- Restart review from the simplified fingerprint when recovery proves containment. Escalate only when a necessary correction cannot fit the accepted product shape and progress is genuinely blocked.

## Design questions

- Define the longitudinal signals and thresholds without turning a fixed round count into a false convergence oracle.
- Define provenance identity across deduplicated findings, shared skeptic verdicts, reactivated cells, manual fallback, and verifier rounds.
- Define recovery checkpoints and deterministic resume behavior for every partially persisted controller transition.
- Define how this feature composes with immutable accepted authority, wave round economy, fix-scoped follow-up rounds, and the existing holistic verifier.
- Preserve Workflow and manual fallback parity, including immediate reviewer-to-dedup-to-skeptic scheduling.

## Status

Promoted from a Quick Win during the 2026-08-25 deterministic-init-backlog recovery because controller state, longitudinal provenance, recovery transitions, and orchestration parity make it feature-scale.
