---
name: manual-gate-bypass
description: Let the user, informed by the controller, bypass a step the runtime refuses for technical reasons and take responsibility for the continuation, with the run marked degraded and completed on the user's acceptance
metadata:
  type: feature
status: exploring
---

# Manual gate bypass on the user's responsibility

## Origin

Raised by the user on 2026-10-12, in their words: "manual gate bypass for situations when the runtime refuses to complete a step for technical reasons. the agent provides the context the user needs for an informed bypass decision, and the user assumes responsibility for the continuation."

Asked whether a bypass should reach only refusals whose evidence is wrong or cannot be obtained, with genuine waivers such as accepting a result without strong review going through renegotiation of the agreement, or any gate at the user's discretion, the user answered: "we'd have to figure out the proper shape for each type of gate. e.g. a spec can be re-negotiated; code defects could be deferred."

Asked whether a run with a bypassed step may publish like any other or needs its own confirmation naming the bypass, the user answered: "the user takes over publication responsibility and has to provide confirmation at run completion (an earlier confirmation doesn't carry when a bypas has been executed). any bypass should make the run degraded. what's new for degraded runs is that the user can now accept the outcome, letting the run complete."

Asked whether every bypass should also produce a defect report, since a technical refusal points at a runtime defect, the user answered: "offer to file a report, don't do that automatically. the reason for a bypass can only be guessed by the model, and might be different than the actual reason the user had."

## Direction

Taken from those answers. None of it is designed or implemented.

- **Informed decision.** The controller gives the user the context an informed bypass decision needs, and the user assumes responsibility for the continuation.
- **Per-gate shape.** Each kind of gate gets its own shape rather than one generic bypass, such as renegotiating a spec or deferring a code defect.
- **Degraded run.** Any bypass makes the run degraded.
- **User acceptance.** A degraded run can complete once the user accepts its outcome. This is new: [Degraded assessment mode](degraded-assessment-mode.md) agreed that a run cannot complete until a supported strong assessment covers the same content.
- **Publication.** After a bypass the user takes over publication responsibility and confirms publication at run completion. A confirmation given earlier, such as publication authority recorded at handover, does not carry past the bypass.
- **Defect report.** The controller offers to file a report about the refusal and files one only when the user agrees, because the model can only guess the user's reason for the bypass.

## Current understanding

The runtime has no bypass, and some of its rules say so. A search of [the runtime reference](../../internal/runtime/REFERENCE.md) on 2026-10-12 for "bypass", "force", "override" and "waive" found these rules against getting past a refusal or obligation, which a bypass design has to reconcile: `adopt` has "no force-adopt or replacement-run escape for missing evidence"; admission says "Never use development mode to bypass the binding"; `dispose` says "Required obligations cannot be deferred or skipped" and "Do not use classification to waive an agreed commitment", and edits made before a disposition re-establish current evidence "instead of bypassing freshness". The other hits are out of scope: paused goals and usage or budget limits, which the reference calls holds or limits "not technical failures to bypass", are native host states rather than runtime refusals; the adoption export route's statement that it does not override managed-process reservations defines that route's reach; and the rest are unrelated uses of the words. Refusals that state no such rule refuse all the same.

[VISION.md](../../VISION.md#invariant-priorities) says the invariant priorities "do not create authority to expand scope, bypass restrictions, or exceed a user-set limit", which concerns the controller's own authority; a bypass here rests on the user's. Under [Review for useful decisions](../../VISION.md#review-for-useful-decisions) it says "A failure to meet an agreed requirement must be repaired or explicitly renegotiated; cost alone cannot waive it", which the user's spec example fits.

Tracked cases where a refusal left no supported route, found by reading the active indexes on 2026-10-12 and offered as examples rather than a complete classification: [Recover a run whose owner can no longer act while its host process lives on](stalled-owner-recovery.md), whose live case needed an administrative stop outside the public interface; [A resource blocker refuses read-only diagnostic review of saved evidence](../BUGS.md#a-resource-blocker-refuses-read-only-diagnostic-review-of-saved-evidence); and [Carve a task out of a running run](mid-run-carve-outs.md), whose run could complete only by taking the task back.

## Open questions

- Which gates and refusals exist and the shape for each, starting from the user's examples of renegotiating a spec and deferring a code defect, and whether any stay beyond a bypass, for example where proceeding could lose work or corrupt saved state.
- How the briefing tells a technical refusal from available recovery or a genuine unmet obligation, since [Available recovery is mistaken for a terminal blocker](../BUGS.md#available-recovery-is-mistaken-for-a-terminal-blocker) shows a controller misjudging that line, and what the briefing contains.
- What a bypass records: the refusal it covers, the briefing shown, the user's words and whether the user's own reason; and whether it covers only that refusal, so that the gate judges afresh once its inputs change.
- Whether a bypass is possible only with the user present, as an informed decision implies, and what happens to the refusal otherwise.
- What a degraded run is at the run level, where status, the obligation brief and the completion and morning reports show it, and what the user's acceptance records; and whether that acceptance also completes a run whose only degraded coverage comes from [Degraded assessment mode](degraded-assessment-mode.md), whose agreed commitments rule that out today.
- How the publication confirmation at completion relates to the publication authority recorded at handover, and what may be published before completion once a bypass has happened.
- How the runtime knows the user agreed, since user authority is text the controller supplies, as in `adopt`, so that a bypass record gives an audit trail rather than prevention.
- How it relates to the stalled-owner recovery and carve-out records above, which could each become one gate's shape.

## Before implementation

It reverses rules stated in the runtime reference and, if user acceptance reaches degraded assessments, commitments agreed for Degraded assessment mode, so it needs a concise governing spec, a version increase and a decision on installed-host evidence. Tracking does not authorize implementation.
