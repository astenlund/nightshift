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

Later the same day the user added: "it would be good if we could make the bypass approval impossible (or at least difficult) to counterfeit". Asked whether the approval must resist a model that records approval it did not get, by misreading or fabrication, or an agent that deliberately tampers with the run store or the runtime, the user answered: "guarding against the first one: a confused agent making a mistake, not an adversarial one".

## Direction

Taken from those answers. None of it is designed or implemented.

- **Informed decision.** The controller gives the user the context an informed bypass decision needs, and the user assumes responsibility for the continuation.
- **Per-gate shape.** Each kind of gate gets its own shape rather than one generic bypass, such as renegotiating a spec or deferring a code defect.
- **Degraded run.** Any bypass makes the run degraded.
- **User acceptance.** A degraded run can complete once the user accepts its outcome. This is new: [Degraded assessment mode](degraded-assessment-mode.md) agreed that a run cannot complete until a supported strong assessment covers the same content.
- **Publication.** After a bypass the user takes over publication responsibility and confirms publication at run completion. A confirmation given earlier, such as publication authority recorded at handover, does not carry past the bypass.
- **Defect report.** The controller offers to file a report about the refusal and files one only when the user agrees, because the model can only guess the user's reason for the bypass.
- **Approval that resists counterfeiting.** A bypass approval should be impossible, or at least difficult, to counterfeit by a confused agent making a mistake. Resisting a deliberately adversarial agent is out of scope.

## Current understanding

The runtime has no bypass, and some of its rules say so. A search of [the runtime reference](../../internal/runtime/REFERENCE.md) on 2026-10-12 for "bypass", "force", "override" and "waive" found these rules against getting past a refusal or obligation, which a bypass design has to reconcile: `adopt` has "no force-adopt or replacement-run escape for missing evidence"; admission says "Never use development mode to bypass the binding"; `dispose` says "Required obligations cannot be deferred or skipped" and "Do not use classification to waive an agreed commitment", and edits made before a disposition re-establish current evidence "instead of bypassing freshness". The other hits are out of scope: paused goals and usage or budget limits, which the reference calls holds or limits "not technical failures to bypass", are native host states rather than runtime refusals; the adoption export route's statement that it does not override managed-process reservations defines that route's reach; and the rest are unrelated uses of the words. Refusals that state no such rule refuse all the same.

[VISION.md](../../VISION.md#invariant-priorities) says the invariant priorities "do not create authority to expand scope, bypass restrictions, or exceed a user-set limit", which concerns the controller's own authority; a bypass here rests on the user's. Under [Review for useful decisions](../../VISION.md#review-for-useful-decisions) it says "A failure to meet an agreed requirement must be repaired or explicitly renegotiated; cost alone cannot waive it", which the user's spec example fits.

Tracked cases where a refusal left no supported route, found by reading the active indexes on 2026-10-12 and offered as examples rather than a complete classification: [Recover a run whose owner can no longer act while its host process lives on](stalled-owner-recovery.md), whose live case needed an administrative stop outside the public interface; [A resource blocker refuses read-only diagnostic review of saved evidence](../BUGS.md#a-resource-blocker-refuses-read-only-diagnostic-review-of-saved-evidence); and [Carve a task out of a running run](mid-run-carve-outs.md), whose run could complete only by taking the task back.

## Counterfeit resistance

Today nothing the runtime records about the user's assent resists counterfeiting. User authority is nonempty text the controller supplies, as for `adopt`, `hold` and `open-review` in the runtime reference. The runtime's independent provenance (`internal/runtime/provenance-store.js`) cross-checks saved state against content hashes in a separate table, which catches an inconsistent direct save, but the hashes are unkeyed, so it holds no secret a forger would lack. A search of the repository's scripts on 2026-10-12 for `createHmac`, `createSign`, `createVerify`, `generateKeyPair`, WebCrypto `subtle` and DPAPI found no keyed cryptography. The controller also runs as the same operating-system user, so operating-system permissions do not separate it from the user. What limits it is the host's sandbox and approval rules, which vary by host and mode, as [Codex sandbox blocks the launcher from starting the host](../QUICK_WINS.md#codex-sandbox-blocks-the-launcher-from-starting-the-host) shows, so a secret stored where the user can read it is out of the controller's reach only as far as those rules keep it there.

Candidate approaches, recorded on 2026-10-12 for the design to weigh; none is verified on either host:

- **Host-native approval.** A hook or permission rule makes the bypass operation raise the host's own permission prompt, which the model cannot answer. It is cheap and stops a model from recording approval by writing text, but the runtime cannot tell that the prompt was shown, a permission mode that approves automatically may skip it, and a direct write to the run store still forges the record. Whether each host prompts this way under its automatic modes is unverified (live-claim: provisional).
- **Runtime-owned confirmation.** The runtime's bypass operation shows its own confirmation on the user's desktop, naming the refusal and the briefing, and records the answer it received itself. It does not depend on the host's permission modes, and the model cannot answer it by writing text; getting past it would take deliberate interface automation. It needs the user at the machine's interactive desktop, so a user reached over SSH or through a remote client would need another route.
- **Signed approval from a key that needs the user.** The approval is a WebAuthn assertion, from Windows Hello, a security key or a phone passkey, over a challenge that hashes the exact refusal, briefing and run revision. Its signed authenticator data carries the user-verified flag, and every consumer, such as `complete`, the publication confirmation and the reports, verifies it against a credential enrolled while the user was present. The model cannot produce one without the user's PIN, biometric or device, and a browser-driven virtual authenticator can sign only for its own credentials, not the enrolled one. Node has no built-in WebAuthn client, so the prompt would come through a browser page, for which the local server of [Graphical run view](run-graph-view.md) is a natural home, or through a native helper, either a separate one or the one [Native helper for Windows process work](native-process-helper.md) proposes for process inspection and job containment, with its scope widened.
- **The local limit.** An agent willing and permitted to replace the enrolled credential or patch the verifier, which lives in the user-writable plugin cache, defeats any check made on the same machine. Keeping the enrollment where changing it needs elevation, which Windows confirms on the secure desktop by default, or verifying away from the machine raises that bar.

The user's answer on 2026-10-12 sets the threat: a confused agent making a mistake, such as reading assent into an ambiguous reply, applying an approval to a different refusal, or recording one with no user present. Deliberate tampering, and so the local limit, are out of scope. Against that threat, what the host-native prompt and the runtime-owned confirmation offer is that the approval comes from an interaction with the user rather than from approval text the controller relays, and binding it to one refusal guards against applying it to another. A signed approval exceeds the need but stays recorded in case the threat changes. The host-native prompt can be skipped silently under a permission mode that approves automatically, which leaves a mistake path open under this threat.

## Open questions

- Which gates and refusals exist and the shape for each, starting from the user's examples of renegotiating a spec and deferring a code defect, and whether any stay beyond a bypass, for example where proceeding could lose work or corrupt saved state.
- How the briefing tells a technical refusal from available recovery or a genuine unmet obligation, since [Available recovery is mistaken for a terminal blocker](../BUGS.md#available-recovery-is-mistaken-for-a-terminal-blocker) shows a controller misjudging that line, and what the briefing contains.
- What a bypass records: the refusal it covers, the briefing shown, the user's words and whether the user's own reason; and whether the gate judges afresh once the inputs of the refusal it covers change.
- Whether a bypass is possible only with the user present, as an informed decision implies, and what happens to the refusal otherwise.
- What a degraded run is at the run level, where status, the obligation brief and the completion and morning reports show it, and what the user's acceptance records; and whether that acceptance also completes a run whose only degraded coverage comes from [Degraded assessment mode](degraded-assessment-mode.md), whose agreed commitments rule that out today.
- How the publication confirmation at completion relates to the publication authority recorded at handover, and what may be published before completion once a bypass has happened.
- Which approval channel guards against a confused agent's mistakes on each host: the host's own prompt, a runtime-owned confirmation or a combination, and how it reaches a user who is not at the machine's interactive desktop.
- How it relates to the stalled-owner recovery and carve-out records above, which could each become one gate's shape.

## Before implementation

It reverses rules stated in the runtime reference and, if user acceptance reaches degraded assessments, commitments agreed for Degraded assessment mode, so it needs a concise governing spec, a version increase and a decision on installed-host evidence. Tracking does not authorize implementation.
