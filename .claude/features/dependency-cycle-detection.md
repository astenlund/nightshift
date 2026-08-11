# Dependency-cycle detection

Feature: add deterministic dependency-cycle detection to the `/nightshift:ready` backlog parser. This file is the authoritative design record; it absorbs the design formerly drafted as proposal #14 in `nightshift-proposals.md`.

## What it does

The `/nightshift:ready` parser currently renders a deadlocked backlog indistinguishably from a legitimately-waiting one: a closure of mutual `**Requires:**` references (`A requires B`, `B requires A`) shows each member as an ordinary `blocked` row, which reads as "waiting on something that will ship." A cycle can never ship, so that framing is an unsatisfiable promise. This feature runs strongly-connected-component detection over the active in-backlog dependency graph and promotes every genuine cycle to a structural error, so a deadlock is surfaced as a repair problem rather than as a queue.

## The dependency graph

- **Nodes are whole backlog entries** (entry-level granularity). Every resolved in-backlog link — whole-feature, slice-suffixed, or MVP-default — is an edge from the requiring entry to the entry it points into, regardless of slice. Slice arithmetic is invisible to the detector: a slice-suffixed reference collapses onto its parent entry, so a cross-feature slice cycle still surfaces as an entry-level cycle.
- Edges are built **only from links that classify as `blocked`**. External primitives have no node and cannot participate; structural errors (broken or stale links, missing `Requires:` lines) are already reported and are not traversable dependency edges.
- The **implicit MVP gate** (a continuation requires its own feature's MVP) is intra-entry and excluded: it is a self-edge within one node, not a cross-entry edge, and must never manufacture a false cycle.
- **Direction:** `Requires:` means "blocked by," so the edge runs *requiring → required*. A directed cycle in this graph is a deadlock.

## Which SCCs are cycles

Not every strongly connected component is a cycle: in an acyclic graph every node is its own singleton component. Report a component as a cycle only when it has **≥2 nodes** or a **single node with a self-loop edge** (`A requires A`). A lone node with no self-edge is a normal singleton and keeps its ordinary classification. A two-node mutual pair and an N-node ring are cycles; a self-reference is a degenerate deadlock and is reported the same way.

## Reporting

Cycle members are **structural errors with precedence**: they are excluded from the `ready`/`blocked`/`external` classification entirely, matching how a broken `Requires:` link already returns early and never also appears under `blocked`. A deadlocked item must never present as merely waiting.

Emit **one structural-error record per cycle** (per reportable SCC). The record keeps the existing `structuralErrors` shape with degenerate `index`/`title` labels (`index: "[cycle]"`, `title: "<n>-node cycle"`) and carries, in `problem`, the complete member enumeration (each member's index and title) and the reciprocal edges including the entry whose reference closes the loop, so the user can identify and break the deadlock. Per-cycle records were chosen over per-member and both-forms during design: they are compact and avoid duplicating the same entries across multiple structural-error rows.

## Integration

- A new detection step inside `analyze()`, after per-unit classification, over the collected resolved `blocked` edges.
- A small refactor so `resolveLink()`'s blocked outcome exposes the resolved **parent-node identity** (today it returns only a display label string), letting the graph be built from real nodes rather than labels. The blast radius is the graph-construction path only.
- A new exported helper (e.g. `findCycles(edges)`) that returns the reportable SCCs, unit-testable in isolation.
- The `/nightshift:ready` SKILL.md structural-error taxonomy gains a cycle category alongside the existing ones (missing `Requires:` line, broken or stale reference, all-slices-shipped parent awaiting graduation).
- No durable state: the detector is pure analysis over already-parsed edges and recomputes on every run, consistent with a read-only deterministic tool.

## Tests

Add fixture tests to `ready.test.js` covering: a two-node mutual cycle (both members become structural errors, absent from `blocked`); a three-node ring; a self-loop (structural error); an acyclic chain of interlocking `Requires:` references (no false positive; all stay in their ordinary classifications); and a graph mixing one cycle with genuinely blocked entries (cycle members are errors, the legitimate blocked entries remain `blocked`). Per repository convention the grammar and behavior live in `ready.js` and are never hand-approximated in the skill prose.

## Status

Draft proposal migrated from `nightshift-proposals.md` (#14) into the backlog; not yet hardened by a revise-spec review. Depends on nothing outstanding: `/nightshift:ready` and its deterministic parser are shipped.

## Requirements

- The `/nightshift:ready` parser (`ready.js`) and its fixture test suite (shipped, so no upstream backlog dependency).
- The `Requires:`-line grammar, slice resolution, and implicit-MVP-gate logic already in `ready.js` (shipped; cycle detection builds its graph from their resolved blocked outcomes, refactored to expose node identity).

**Requires:** none (FEATURES.md index entry).
