# Dependency-cycle detection

Feature: add deterministic dependency-cycle detection to the `/nightshift:ready` backlog parser. This file is the authoritative design record.

## What it does

The `/nightshift:ready` parser currently renders a deadlocked backlog indistinguishably from a legitimately-waiting one: a closure of mutual `**Requires:**` references (`A requires B`, `B requires A`) shows each member as an ordinary `blocked` row, which reads as "waiting on something that will ship." A cycle can never ship, so that framing is an unsatisfiable promise. This feature runs strongly-connected-component detection over the active in-backlog dependency graph and promotes every genuine cycle to a structural error, so a deadlock is surfaced as a repair problem rather than as a queue.

## The dependency graph

- **Nodes are whole backlog entries** (entry-level granularity). Each entry contributes outgoing edges from its **top-level `**Requires:**` line**: the next-to-ship gate. In the parser, the first unshipped slice of a sliced feature is gated by this same top-level line, so an unsliced entry and a sliced entry both edge from one place. Every resolved in-backlog link from that line (whole-feature, slice-suffixed, or MVP-default) is an edge from the entry to the entry it points into.
- A continuation's inline `**Requires:**` links **never enter the graph at all**: the parser sources the first unshipped slice's gate from the entry's top-level `**Requires:**` line, and a continuation's inline annotation is used only to classify queued (non-first) slices for display, never as an edge source. This is the crux of correctness: a continuation's inline reference reflects *future* ordering, not a *current* block, and admitting it as a live edge would turn a schedulable chain into a false deadlock. Because the top-level line is the single edge source, it must be kept in sync with the next-to-ship slice as slices ship (the existing walk-and-advance convention): a block that lives only in a continuation's inline annotation is invisible to the detector until the author promotes it into the top-level line.
- Edges are built **only from links that classify as `blocked`**. External primitives have no node and cannot participate; structural errors (broken or stale links, missing `Requires:` lines) are already reported and are not traversable dependency edges. Because each entry's edges come from a single next-to-ship unit, a structural-error unit contributes no edges without any per-unit/per-entry split.
- The **implicit MVP gate** (a continuation requires its own feature's MVP) never enters the graph: it is an intra-entry blocker string, not a resolved link. Nor do slice-suffixed references that resolve to a slice of the *same* entry: they are intra-feature ordering (the same relation as the gate), not cross-entry dependencies. Excluding them keeps a feature from deadlocking on itself; a single entry can therefore never form a self-loop.
- **Direction:** `Requires:` means "blocked by," so the edge runs *requiring → required*. A directed cycle in this graph is a deadlock.

## Which SCCs are cycles

Not every strongly connected component is a cycle: in an acyclic graph every node is its own singleton component. Because intra-entry references never produce edges, a single entry cannot form a self-loop, and only components with **two or more distinct entries** are reportable. A two-entry mutual pair and an N-entry ring are deadlocks; a lone entry is a normal singleton that keeps its ordinary classification. A single entry that lists itself (or one of its own slices) in `**Requires:**` is an authoring error, not a cross-entry deadlock: it is excluded from the graph and stays a visible "blocked on itself" row rather than being promoted to a structural error.

Most intra-feature slice references point *backward* (a continuation names its already-shipping predecessors) and are genuine ordering, correctly excluded. A *forward* reference, the top-level `**Requires:**` line naming a later, still-unshipped sibling (e.g. the MVP referencing `X: Slice 2`), is a real standoff: the MVP cannot ship until Slice 2 ships, and Slice 2's implicit MVP gate blocks it until the MVP ships, yet neither is surfaced as a deadlock. This is an accepted anti-goal forced by the drop-self-loops decision: intra-entry references never enter the graph, so an intra-feature standoff stays two ordinary `blocked` rows. It is an authoring anti-pattern (a feature depending on its own later slice), and the correct remedy is to restructure the feature or its slice order, not a detector behavior; the limit is documented here rather than left silent.

## Reporting

Cycle members are **structural errors with precedence**: they are excluded from the `ready`/`blocked`/`external` classification entirely, matching how a broken `Requires:` link already returns early and never also appears under `blocked`. A deadlocked item must never present as merely waiting. The exclusion applies to the **whole entry (every slice unit)** of a cycle-member feature, not just the slice whose reference closes the loop. This is declared semantics, not a side effect: a deadlocked slice makes the feature unschedulable as a whole, and showing a sibling slice as "waiting on Z" while its own MVP is deadlocked would be misinformation: the deadlock is the binding problem. The accepted cost is that a sibling slice's legitimate non-cyclic blocker (e.g. `X: Slice 2` blocked on `Z` while `X`'s MVP is in a cycle) is subsumed and not reported, because that sibling is unreachable work regardless.

Emit **one structural-error record per cycle** (per reportable SCC). The record keeps the existing `structuralErrors` shape with degenerate `index`/`title` labels (`index: "[cycle]"`, `title: "<n>-node cycle"`) and carries, in `problem`, the complete ordered member list (each member's index and title, in index-file order) and, for each member, the edge(s) that tie it into the cycle (the requiring entry and its resolved target), so the user can identify and break the deadlock. Because the detector returns components rather than a distinguished closing edge, the record lists every participating edge rather than naming a single "closing" reference. The member and edge enumeration order is fixed (index-file order, then `Requires:`-line order) so the emitted text is deterministic and the fixture tests can assert on it. Per-cycle records were chosen over per-member and both-forms during design: they are compact and avoid duplicating the same entries across multiple structural-error rows.

**Boundary: structural-error masking.** An entry whose **next-to-ship unit** is itself a structural error (a broken or stale link on the first unshipped slice, or a missing `**Requires:**` line) contributes no edges to the cycle graph; the parser reports the structural error and the unit's otherwise-valid blocked links are not traversed. A deadlock whose members include such an entry is therefore not detected until that reference is fixed; until then, the other member renders as an ordinary `blocked` row. This masking is an accepted boundary, not a gap: the structural error already forces an edit that will change the entry's dependency set, and detecting cycles over a graph that includes entries with known-broken references would report results that change under the imminent fix. Fix the reference first; the detector then sees the complete graph. (The boundary is defined at the entry level because an entry's edges come from a single next-to-ship unit, so a broken unit suppresses that entry's entire edge set, matching the declared consequence without a per-unit/per-entry split. A broken *continuation* slice does not mask the entry's current edges, because it does not affect what blocks next shipment.)

## Integration

- A detection step inside `analyze()`, after per-unit classification, that collects the resolved `blocked` edges each entry contributes from its **top-level `**Requires:**` line**, discards intra-entry references (MVP-gate strings and slice-suffixed same-feature links), and runs SCC detection over the resulting graph.
- The classification path must expose, for each entry, its resolved parent-node identities from the top-level line, so the edge set is scoped to that line only. `resolveLink()`'s blocked outcome returns only a display label string today; exposing the resolved **parent-node identity** (and the reference's slice-suffixed / intra-entry shape) lets the graph be built from real nodes and the intra-entry references be dropped. The blast radius is the graph-construction path only.
- A new exported helper (e.g. `findCycles(edges)`) that returns the reportable components (those with ≥2 distinct entries), unit-testable in isolation.
- The `/nightshift:ready` SKILL.md structural-error taxonomy gains a cycle category alongside the existing ones (missing `Requires:` line, broken or stale reference, all-slices-shipped parent awaiting graduation).
- No durable state: the detector is pure analysis over already-parsed edges and recomputes on every run, consistent with a read-only deterministic tool.

## Tests

Add fixture tests to `ready.test.js` covering: a two-entry mutual cycle (both members become structural errors, absent from `blocked`); a three-entry ring; the schedulable continuation case where `X` requires `Y`'s MVP and `Y`'s last continuation carries an inline `**Requires:**` to `X` (no cycle: the inline annotation is not an edge source, `Y`'s MVP keeps its real top-level gate, and `X` stays blocked on `Y`'s MVP); an intra-feature slice-suffixed reference (produces no self-loop error; the feature does not deadlock on itself, and a forward MVP-to-later-slice reference stays two blocked rows rather than an error); an acyclic chain of interlocking `Requires:` references (no false positive); and a graph mixing one cycle with genuinely blocked entries (cycle members are errors, the legitimate blocked entries remain `blocked`). Per repository convention the grammar and behavior live in `ready.js` and are never hand-approximated in the skill prose.

## Status

Migrated into the backlog and hardened by a lightened single-reviewer revise-spec review (collapsed swarm, curated dimension set) that converged over two phases on 2026-08-11; see `## Hardening`. Depends on nothing outstanding: `/nightshift:ready` and its deterministic parser are shipped.

## Requirements

- The `/nightshift:ready` parser (`ready.js`) and its fixture test suite (shipped, so no upstream backlog dependency).
- The `Requires:`-line grammar, slice resolution, and implicit-MVP-gate logic already in `ready.js` (shipped; cycle detection builds its graph from their resolved blocked outcomes, refactored to expose node identity).

## Hardening

- revise-spec graduated 2026-08-11 06:01 at 25acb7e, scope: whole file, content: 217a7720
- handover completed 2026-08-11 11:49 at 1948c82, scope: whole file, content: 00bd6d16
- revise-spec refreshed 2026-08-19 09:10 at 2fce9c2, scope: whole file, content: 2ec769df (legacy sign-off marker removal)
- revise-spec refreshed 2026-08-22 10:18 at 6022378, scope: whole file, content: 4c2769ab (breakout line removal)
