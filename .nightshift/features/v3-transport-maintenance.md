---
name: v3-transport-maintenance
description: Maintain bounded host transports and explicit runtime ownership
metadata:
  type: feature
status: exploring
---

# Maintain bounded host transports and explicit runtime ownership

Assess current host transports for bounded efficient buffering, independently testable protocol decisions and one owner for every live timer. Preserve cancellation, stream closure and termination guarantees.

## Selected outcome

The user selected the surviving transport outcomes without requiring the old Windows runner layout or inert timer fields. Separate sequencing, budgets and completion decisions from process wiring where useful; keep byte and fragment bounds, framing and failure behavior intact.

## Evidence and limits

Current runtime and release host transports use pending maps, timers and stream parsing. Old controller-harness targets are gone. No current copying bottleneck or timer leak is asserted by the migration capture; characterize the actual implementation first.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Measure fragmentation/copying costs before optimizing. Verify malformed and partial frames, limits, timeout replacement, completion/cancellation and stale callbacks, plus process-tree closure. Share mechanics with existing native-control helper work only when their contracts agree.

Coordinate with [Shared native control session helper](../QUICK_WINS.md#shared-native-control-session-helper) and [Windows containment fixtures](../BUGS.md#windows-job-pipe-and-containment-fixtures-fail-outside-the-code-they-cover).

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Avoid quadratic streaming buffer concatenation](../reports/v3-migration-followups-20260920.md#avoid-quadratic-streaming-buffer-concatenation).
- [Extract Windows runner protocol state](../reports/v3-migration-followups-20260920.md#extract-windows-runner-protocol-state).
- [Turn-sequencer timer ownership](../reports/v3-migration-followups-20260920.md#turn-sequencer-timer-ownership).

[The migration decision](../../V3-MIGRATION.md#protocol-and-evidence-boundaries) preserves the surviving requirement; earlier records: [turn-sequencer-timer-ownership](turn-sequencer-timer-ownership.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
