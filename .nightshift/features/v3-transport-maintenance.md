---
name: v3-transport-maintenance
description: Maintain bounded host transports and explicit runtime ownership
metadata:
  type: feature
---

# Maintain bounded host transports and explicit runtime ownership

Assess current host transports for bounded efficient buffering, independently testable protocol decisions and one owner for every live timer. Preserve cancellation, stream closure and termination guarantees.

## Selected outcome

The user selected the surviving transport outcomes without requiring the old Windows runner layout or inert timer fields. Separate protocol validation, sequencing, budgets and completion decisions from process wiring, as the agreed disposition requires; keep byte and fragment bounds, framing and failure behavior intact.

## Evidence and limits

Current runtime and release host transports use pending maps, timers and stream parsing. Old controller-harness targets are gone. No current copying bottleneck or timer leak is asserted by the migration capture; characterize the actual implementation first.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Measure fragmentation/copying costs before optimizing. Verify malformed and partial frames, limits, timeout replacement, completion/cancellation and stale callbacks, plus process-tree closure. Share mechanics with existing native-control helper work only when their contracts agree.

Coordinate with [Shared native control session helper](../QUICK_WINS.md#shared-native-control-session-helper) and [Windows containment fixtures](../BUGS.md#windows-job-pipe-and-containment-fixtures-fail-outside-the-code-they-cover).

## Found by the migration accounting audit

The audit of 2026-09-29 characterized part of the current implementation:

- Streaming buffers. All shipped framing now uses Node's `readline`, and a probe outside the repository fed it one 16 MiB line in 64 KiB fragments (26 ms) and in 256-byte fragments (42 ms), so the whole-frame recopying the retained need targeted does not appear to occur. What remains of [its agreed disposition](../../V3-MIGRATION.md#reuse-and-streaming-cost): no repository test shows unchanged output across chunk boundaries or reduced copying, the Windows runner checks a frame against `MAX_FRAME_BYTES` only after a whole line has been assembled, so an oversized frame is not rejected promptly, and host output lines have only the 32 MiB aggregate bound, not a per-line bound.
- Runner protocol state. Two frame validators are extracted and tested directly, but sequencing, output budgets and completion decisions still live inside the process wiring of `internal/runtime/windows-job.js`, with no direct state tests of failure precedence, termination, stream closure or cancellation. [The agreed disposition](../../V3-MIGRATION.md#protocol-and-evidence-boundaries) asks for that separation and for direct state tests; this entry's outcome used to add a "where useful" qualifier the disposition does not have, and now states the separation as agreed.

## Settled questions

The user agreed these answers on 2026-10-13, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: `spawnWindowsJob` in `internal/runtime/windows-job.js` reads runner frames through Node's `readline` and compares a frame with `MAX_FRAME_BYTES` only once the whole line has been assembled; the host event streams in `internal/runtime/hosts.js` also read through `readline`, bounded only by the 32 MiB aggregate; and the runner's ordinal checks, output budget and exit and failure decisions all sit inside the per-line callback that also writes to the child's streams, so none of them can be tested apart from a process.

- Whether fragmentation and copying costs warrant optimizing. Settled: no. The audit's probe found that `readline` does not recopy whole frames, so optimizing copying is dropped. A repository test still shows output unchanged across chunk boundaries, including a multi-byte character split between chunks.
- How an oversized frame is rejected promptly. Settled: one bounded line reader, shared by the Windows runner and the host transports, replaces `readline` and refuses a line as soon as its buffered part passes the limit. The refusal keeps today's failure path, ending the contained process tree and recording the failure.
- Whether host output gets a per-line bound. Settled: yes, beside the 32 MiB aggregate, with its value set in the governing spec from the largest observed host events plus a margin. A line over it fails the attempt with a named error, and usage the host already reported is kept, as for other attempt failures.
- How runner state is separated from process wiring. Settled: sequencing, output budgets, completion and failure precedence move into a module without process input or output, with direct state tests of failure precedence, termination, stream closure, cancellation, timeout replacement and stale callbacks. Each live timer has one owner.
- How this relates to [Native helper for Windows process work](native-process-helper.md). Settled: independently. A native helper would replace the PowerShell runner while speaking the same protocol, so a separated protocol module makes that replacement easier rather than being lost to it, and neither requires the other. The coordination with the native control session helper and the containment fixtures named above stands.
- Evidence. Settled: no behavior here is model-owned, so deterministic fixtures on the Windows CI suffice, with no live campaign; the runtime change rides with a plugin version increase.

## Before implementation

Settle the bounded reader's interface and the limits it enforces, the per-line host bound and its observed basis, and the boundary of the runner's protocol module in a concise governing spec in `.nightshift/specs`. Verify malformed and partial frames, an oversized frame refused before it is fully buffered, chunk-boundary and multi-byte splits, timeout replacement, completion and cancellation, stale callbacks and process-tree closure. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Avoid quadratic streaming buffer concatenation](../reports/v3-migration-followups-20260920.md#avoid-quadratic-streaming-buffer-concatenation).
- [Extract Windows runner protocol state](../reports/v3-migration-followups-20260920.md#extract-windows-runner-protocol-state).
- [Turn-sequencer timer ownership](../reports/v3-migration-followups-20260920.md#turn-sequencer-timer-ownership).

[The migration decision](../../V3-MIGRATION.md#protocol-and-evidence-boundaries) preserves the surviving requirement; earlier records: [turn-sequencer-timer-ownership](turn-sequencer-timer-ownership.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
