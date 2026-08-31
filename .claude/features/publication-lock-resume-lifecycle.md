# Publication lock and resume lifecycle

Feature: settle the lock lifecycle around durable-state resume detection and publication validation. This file is the authoritative capture record for the feature direction.

## Problem and goal

Publication currently detects a full durable-state resume before acquiring the runtime lock. Because that first inspection occurs in a lockless window, validation must repeat the complete manifest-target read after acquisition; an intervening writer is refused safely, but the work is duplicated. The goal is either an honest single-pass design protected by the lock or an explicit permanent contract for the current safe double read.

## Required design surface

- Evaluate lock acquisition before resume detection against bootstrap-lock creation, which currently depends on the resume decision.
- If selecting a single-pass design, define acquisition, inspection reuse, validation, publication, release, and recovery under one protected lifecycle.
- Enumerate every crash state around bootstrap-lock creation, runtime-lock acquisition, resume classification, validated inspection, publication, cleanup, and lock release, with deterministic resume behavior.
- Define stale, missing, changing, malformed, or conflicting lock and durable-progress states and the safe user or controller disposition for each.
- If retaining the double read, state it as intentional permanent behavior and preserve evidence that the second pass is the pre-publication byte authority.
- Add tests that prove intervening edits are refused and that no optimization reuses lockless evidence as publication authority.

## Current boundary

The current double read is safe and is not a correctness bug. This capture does not select the single-pass or permanent double-read design. No implementation may remove the second validation pass until an agreed lock lifecycle makes reuse authoritative and covers every durable crash state.

## Status

Tracked as an active publication-lifecycle feature after the deterministic init-backlog review. Lock ordering, bootstrap behavior, recovery states, failure policy, and verification require a governing design before implementation.
