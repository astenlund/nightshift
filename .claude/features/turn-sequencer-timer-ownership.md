# Turn-sequencer timer ownership

Feature: reconcile the accepted turn-sequencer timer contract with the component that owns live timer handles. This file is the authoritative capture record for the feature direction.

## Problem and goal

The accepted plan requires each turn-sequencer timer slot to carry phase, deadline, and a live handle with clear and install lifecycles. The implemented sequencer leaves its handle null while the settle guard separately owns the live timer handles. The goal is one explicit timer owner and one governing lifecycle rather than two models that describe different state.

## Required design surface

- Decide whether the turn sequencer owns the real timer handles or whether the duplicate sequencer timer model is removed.
- Define ownership and transitions for phase, deadline, handle installation, replacement, clearing, timeout observation, completion, failure, cancellation, and disposal.
- Define the empty and complementary branches when no timer is installed or a clear or install operation fails.
- Reconcile the governing plan or successor design, production implementation, dialogue and runtime validation, and tests in the same change.
- Add transition tests that prove the selected owner cannot leak, duplicate, orphan, or observe a stale timer handle.

## Current boundary

This capture does not choose which component becomes the timer owner or settle the exact timer API. Deleting only the inert sequencer handle field is prohibited because it would erase the visible mismatch while leaving ownership undefined. Current runtime behavior remains authoritative until an agreed design reconciles the contract.

## Status

Tracked as an active workflow-runtime feature after the deterministic init-backlog review. Ownership, transition semantics, failure behavior, contract reconciliation, and tests require a governing design before implementation.
