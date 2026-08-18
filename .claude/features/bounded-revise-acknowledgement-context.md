---
status: exploring
---

# Bounded revise acknowledgement context

Feature: bound or scope the revise engine's acknowledgement context so retry rounds cannot grow every later reviewer and verifier payload without limit. This file is an exploring draft, not yet a settled design.

## What it does

The revise engine persists reasoned acknowledgements for the whole run and includes the complete common context in later reviewer and verifier payloads. That evidence helps fresh agents avoid repeating refuted or deliberately deferred findings, but its count and text size are unbounded. Round and verifier caps limit launches, not the size or aggregate token cost of each launch.

This feature will preserve the anti-repetition value while bounding repeated context. It must not weaken the clean-LGTM certification rule, discard an acknowledgement that is still needed to interpret an accepted decision, or let compaction failure appear as a clean review state.

## Design questions

- Scope: decide which acknowledgements every cell needs and which can be delivered only to the originating cell, related cells, or the holistic verifier.
- Identity and deduplication: define the stable semantic identity used to consolidate repeated findings without conflating distinct wiring defects with an acknowledged design choice.
- Bound: choose a decidable count, byte, or token-estimate limit and define what happens when the limit is reached.
- Compaction: define the lossless minimum record retained for each acknowledgement and whether an agent, deterministic helper, or both may produce summaries.
- Verifier visibility: state which detailed or compacted evidence the holistic verifier receives so reduced reviewer payloads do not create a coverage gap.

## State lifecycle and failure behavior

The settled design must specify creation, refresh, invalidation, scope, and consumption of compacted acknowledgement state. It must cover resume from every checkpoint shape, artifact and scope-map changes, follow-up resolution, and successful scratch cleanup.

If acknowledgement classification, compaction, or restoration cannot run, the workflow must preserve the uncompressed evidence or fail closed with diagnostics. It must never silently drop evidence or treat an infrastructure failure as permission to certify or stamp.

Workflow and manual-agent dispatch must implement the same delivery semantics. Fixture coverage should exercise growth bounds, deduplication boundaries, invalidation, resume, verifier visibility, and every failure fallback once the Review orchestration tests feature provides the deterministic transition surface.

## Relationships

- Review orchestration tests is the likely implementation prerequisite because the new state and boundary behavior need executable lifecycle coverage. This draft does not declare a formal dependency until it graduates from exploring.
- Revise prompt-prefix caching reduces the price of repeated common context but does not bound its size. The features are complementary and neither substitutes for the other.
- Fix-scoped follow-up rounds narrows some repeat-review delivery. This feature owns acknowledgement retention and compaction regardless of the artifact slice delivered beside it.

## Status

Captured from a confirmed Efficiency finding during the clean-LGTM fingerprint-certification revise-code run on 2026-08-18. The finding was deferred because a correct repair requires explicit state ownership, compaction, invalidation, and resume semantics rather than a local text-size cap.

No Requires line yet. Graduate this draft to Review hardening after the delivery scope, bound, compaction authority, and fail-closed lifecycle are settled.
