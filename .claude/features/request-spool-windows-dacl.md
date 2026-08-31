# Request-spool Windows DACL hardening

Feature: add protected creation-time Windows DACL hardening for request-spool confidentiality. This file is the authoritative capture record for the feature direction.

## Problem and goal

Protocol version 1 relies on the request spool inheriting the repository DACL. That contract does not provide a separately protected creation-time boundary for sensitive request material. The goal is an additive Windows security layer that establishes and verifies an explicit request-spool DACL without weakening the current repository-inheritance contract before the new path is complete.

## Required design surface

- Define every principal that may access the request spool and the rights each principal receives.
- Define whether and how inheritance is protected, retained, or replaced at creation time.
- Define directory creation, DACL assignment, identity revalidation, and first-write ordering so sensitive bytes are not exposed through an intermediate state.
- Define fail-closed behavior, cleanup, retained recovery evidence, and deterministic resume behavior for every partial creation or permission state.
- Add Windows fixtures for allowed access, denied access, inheritance behavior, permission failure, recovery, and protocol version 1 compatibility.

## Current boundary

The allowed-principal set, access mask, inheritance policy, Windows API, and recovery encoding are not settled by this capture. The live execution surface is Windows. Protocol version 1's inherited repository-DACL behavior remains the baseline until an agreed design proves the protected path and its compatibility behavior.

## Status

Tracked as an active security feature after the deterministic init-backlog review. Its DACL grammar, creation lifecycle, failure policy, recovery states, and verification contract require a governing design before implementation.
