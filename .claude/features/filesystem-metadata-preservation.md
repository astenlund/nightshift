# Filesystem metadata preservation

Feature: define which filesystem metadata Nightshift preserves beyond its existing content and meaningful-mode guarantees. This file is the authoritative capture record for the feature direction.

## Problem and goal

The current workflow contract preserves exact bytes where required, BOM state, newline form, controlled semantic regions, and meaningful mode bits. It does not define what happens to other filesystem metadata when a target is inspected, replaced, restored, or recovered. The goal is an explicit preservation boundary that callers and recovery logic can enforce without implying that every attribute on every filesystem is supported.

## Required design surface

- Inventory the metadata that matters on supported Windows filesystems and separate it from portable byte and mode guarantees.
- Define when metadata is captured, refreshed, revalidated, restored, or deliberately changed across inspection, publication, rollback, and recovery.
- Define the result when metadata is unavailable, unsupported, stale, missing, or changed between validation and mutation.
- Enumerate durable partial states when content and metadata operations can succeed separately, with deterministic resume or recovery behavior for each state.
- Add platform-specific and portable fixtures that prove both preserved metadata and explicit non-guarantees.

## Current boundary

No specific metadata inventory, platform primitive, write order, or compatibility encoding is settled by this capture. Existing byte, BOM, newline, controlled-region, and meaningful-mode guarantees remain authoritative until a later design is agreed. The feature does not promise preservation of every filesystem attribute or portable behavior for a Windows-only primitive.

## Status

Tracked as an active feature after the deterministic init-backlog review. The preservation categories, lifecycle, failure semantics, recovery states, and verification matrix require a governing design before implementation.
