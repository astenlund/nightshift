# Recovery artifact physical identity

Feature: bind recovery artifacts to physical filesystem identities before later recovery mutation. This file is the authoritative capture record for the feature direction.

## Problem and goal

Recovery currently reasons about owner temporaries, recovery gates, backup stages, and backups without a complete durable binding to their physical filesystem identities. A path can continue to spell the approved location while naming a different object later. The goal is to make physical identity part of recovery authority so a later mutation cannot rely on path spelling alone.

## Required design surface

- Select the physical identity primitives for each supported platform and define their canonical durable representation.
- Define identity creation, capture, refresh, revalidation, invalidation, and scope for owner temporaries, recovery gates, backup stages, and backups.
- Define how missing, stale, changed, ambiguous, unsupported, or multiply linked identities affect inspection and mutating recovery.
- Enumerate every durable transition state when artifact creation, identity persistence, publication, and cleanup can land separately, with deterministic resume behavior.
- Define compatibility for existing recovery records that do not carry physical identities without silently granting them new mutation authority.
- Add fixtures for replacement, aliasing, link changes, stale records, partial writes, recovery, and unsupported identity probes.

## Current boundary

No identity primitive, schema field, refresh interval, legacy migration rule, or operation ordering is settled by this capture. Existing recovery remains fail closed at its current authority boundary. A path match alone must not be promoted to physical-identity evidence by implementation convenience.

## Status

Tracked as an active recovery feature after the deterministic init-backlog review. Its identity grammar, complete lifecycle, compatibility policy, crash states, and tests require a governing design before implementation.
