---
name: incremental-revise-finding-delivery
description: Explore reviewer-to-controller delivery of individual findings before the reviewer's final result
metadata:
  type: feature
status: exploring
---

# Incremental revise finding delivery

Let each revise reviewer deliver findings to the controller one at a time while the reviewer continues inspecting its assigned scope. Each accepted finding can then enter same-round deduplication and fresh-skeptic dispatch immediately instead of waiting for the reviewer's complete final result. A future Shift Supervisor may own this minute-by-minute fan-out while the controller retains adjudication and convergence authority.

This extends [Immediate Skeptic Dispatch](immediate-skeptic-dispatch.md), which currently reacts when a reviewer cell completes, and [Manual review dedup parity](manual-review-dedup-parity.md), which deduplicates findings as completed reviewer results arrive. The new boundary is inside one reviewer session: partial finding delivery may reduce skeptic latency, but it must not let partial output authorize fixes, dimension transitions, certification, or any departure from the whole-round adjudication barrier.

The design must define a bounded finding-frame protocol, stable reviewer and finding identities, sequence and duplicate handling, an explicit reviewer-complete record, checkpoint and crash recovery for every partial state, backpressure when skeptic work outpaces review, malformed or lost frame behavior, and parity across Workflow, capable manual dispatch, and supervisor-owned orchestration. It must also decide whether a reviewer can revise or withdraw an earlier finding and how the controller represents that without letting a late correction race an in-flight skeptic verdict.

Captured 2026-09-02 during a long revise-plan convergence run.
