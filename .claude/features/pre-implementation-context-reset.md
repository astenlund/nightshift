---
status: exploring
---

# Pre-implementation context reset

Feature: add an explicit context-compaction boundary after plan hardening and immediately before implementation begins. Once compaction completes, the controller re-reads the governing spec and hardened plan in full before dispatching implementation work, so implementation starts with the durable decisions restored and review churn removed from active context.

The design must define the host-neutral compaction capability, the behavior when compaction is unavailable or fails, preservation of the active handover queue and scratch authorities across the boundary, and evidence that both artifacts were reloaded before implementation dispatch.

## Open questions

- Should the workflow also compact after spec hardening and before plan authoring, followed by a full re-read of the hardened spec? This may give planning the same clean-context boundary as implementation, but the design must weigh that benefit against extra workflow latency and the loss of still-useful review context.

## Status

Captured for exploration during the 2026-08-18 universal-skill-entry-points handover. No dependency analysis or implementation design has been completed.
