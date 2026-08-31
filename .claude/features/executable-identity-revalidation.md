# Executable identity revalidation for Windows launches

Feature: define and enforce the complete physical-identity lifecycle for executables used by supported Windows launches. This file is the authoritative capture record for the feature direction.

## Problem and goal

The current harness resolves and validates trusted executable paths once, then retains those paths for later launches. A same-path replacement or a retargeted path component can therefore change the executable object before a later launch while preserving the stored spelling. The goal is to fail closed unless the identity of every executable used by a supported Windows launch can be re-proven at the required boundary.

## Required design surface

- Cover trusted host, Git, PowerShell, credential-probe, and job-runner launches under one explicit executable-identity contract.
- Define initial identity creation and capture, per-launch refresh or revalidation, invalidation, scope, and stale-state behavior.
- Detect in-place replacement, same-path replacement, path-component retargeting, aliases, and identity-probe failure before launch authority is granted.
- Define process creation and revalidation ordering, including any remaining race boundary and its fail-closed disposition.
- Retain only host-neutral logic that remains relevant after unsupported POSIX live execution paths are removed.
- Add Windows fixtures covering each executable role, replacement shape, stale state, probe failure, and refusal before process launch.

## Current boundary

This capture does not choose between refresh and revalidation mechanisms, select a Windows identity primitive, or settle process-launch sequencing. It creates no live POSIX compatibility contract. Retaining a previously trusted path is not sufficient evidence after its executable identity can no longer be proved.

## Status

Tracked as an active Windows security feature after the deterministic init-backlog review. The identity grammar, launch boundary, race handling, invalidation rules, and verification matrix require a governing design before implementation.
