# No-replace action destination binding

Feature: bind each no-replace action temporary to its approved final destination for stale-owner recovery. This file is the authoritative capture record for the feature direction.

## Problem and goal

A valid crash after hard-link publication can leave an action temporary and its final target naming the same physical object with link count two. The current closed apply-owner record identifies the temporary but does not map it to the action's approved destination, so recovery cannot distinguish that exact owned post-publication topology from an unverified external hard link. The goal is a durable action-to-destination binding that recognizes only the approved topology and preserves rejection of every unproven link relationship.

## Required design surface

- Extend the lock or apply-owner schema with a closed mapping from every no-replace action temporary to its approved final target.
- Bind both paths to physical-identity evidence and define when the mapping and identities are captured, persisted, refreshed, revalidated, and invalidated.
- Enumerate the pre-publication, post-publication shared-identity, cleanup, crash, resume, and malformed-record states and the one legal recovery action for each.
- Require exact action ownership, destination identity, expected link topology, containment, and stale-owner evidence before recovery accepts a shared identity.
- Continue to reject external hard links, destination substitution, ambiguous mappings, and legacy records that cannot prove the relationship.
- Add regressions for the valid crash prefix and for every adjacent unverified topology the current validation rejects.

## Current boundary

The schema shape, platform identity carrier, write order, compatibility policy, and exact topology checks are not settled by this capture. Current fail-closed topology validation remains authoritative. This feature must not weaken it merely to make the valid crash prefix recoverable.

## Status

Tracked as an active feature after the deterministic init-backlog review. It depends on Recovery artifact physical identity because the approved hard-link topology is identity evidence. The lock schema, transition lifecycle, compatibility rules, and verification contract require a governing design before implementation.
