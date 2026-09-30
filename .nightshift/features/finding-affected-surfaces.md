---
name: finding-affected-surfaces
description: When one finding covers a problem that appears in several places, keep every affected surface and its evidence, as the v3 migration agreed for consolidating findings
metadata:
  type: feature
---

# Keep every affected surface when merging findings

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded "Manual review dedup parity" as Present; independent auditors and verifiers found one clause of its agreed disposition not carried. Drafted overnight for the user's triage.

## Agreed disposition

Agreed on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md#finding-delivery-and-retained-context): "Absorb deduplication into ordinary finding consolidation. One skeptic can validate a small batch without a separate dedup judge. Report the same underlying problem once while preserving every affected surface and relevant evidence. Shared reasoning must resolve each claim it covers; different surfaces, stronger evidence, and uncertainty still need examination. Preserve per-finding authority and value decisions. Retire the old per-arrival judge and copied-verdict protocol as prerequisites; larger-review staffing remains open."

## Current behavior

Checked on 2026-09-29:

- Carried: [the operating brief](../../internal/workflow.md) says "One problem is one finding even if several lenses expose it", and the reviewer prompt says "One underlying problem is one finding". One skeptic can validate a small batch, each assigned claim gets exactly one verdict, and each finding gets its own authority and value decision.
- Missing: nothing tells the reviewer, a lead integrating peers or the controller to keep every affected surface and its evidence when one finding covers several places, and the finding schema (id, severity, consequence, evidence, required) has no place for them beyond free-text evidence. The skeptic prompt's "affected siblings" scope and the sibling-path review lens point the same way without requiring it.

## Direction

Have a consolidated finding list every affected surface with its evidence, so validation, disposition and repair reach each one.

## Settled questions

The user agreed these answers at triage on 2026-09-30, and the entry graduated from Exploring to current work on 2026-10-01. Each question is kept with its answer.

- Whether this is an instruction alone or also a structured field in the finding schema, and how a skeptic's verdict covers several surfaces with different evidence. Settled as a structured field: the reviewer's finding schema in `internal/runtime/review.js` gains a list of affected surfaces, each with its location and its own evidence, beside the instruction that a consolidated finding lists every surface it covers. The skeptic addresses every listed surface, and a surface it cannot confirm is split off as its own finding or marked unverified, so validation, disposition and repair reach each one; the spec settles the exact verdict shape.
- How it applies to peer staffing, where a lead would merge its peers' findings into its integrated assessment. Settled: the same rule covers a lead merging its peers' findings once [peer dispatch](reviewer-peer-dispatch.md) exists, and this entry does not depend on it.

## Before implementation

The change alters the runtime's finding schema, possibly its verdict schema, and the reviewer and skeptic prompts, so it needs a concise governing spec, a plugin version increase, and a decision at the start of the work between a budgeted installed-host check and deterministic evidence only with the model-owned behavior marked unverified. Tracking and readiness do not authorize implementation.
