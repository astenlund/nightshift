# Quick wins

V2 entries are preserved in [the historical index](migration/v2/QUICK_WINS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Agent-directed rules leak into user-facing prose

Reported from a `/ready` run in another project on 2026-09-11 and repaired for that skill in plugin 3.0.4; the pattern is broader than one skill. Skill texts state constraints for the agent, such as readiness not being agreement, a draft not being authorized implementation work, or a previous review not authorizing a narrowed new pass, and agents echo them to the user as stiff rule quotations, for example "Readiness is not a selection". The user wrote these conventions and does not need them restated.

Add a shared rule to `internal/workflow.md` that separates agent-directed constraints from user-facing phrasing, sweep all eight skills for constraint sentences that read as user-facing prose and rephrase them as closing offers or actions, and check the result with an installed-host probe, since the behavior is model-owned.

**Requires:** none.

### Settle the installed-host evidence budget before handover

Approved as written by the user on 2026-09-11 after a self-hosting run whose first independent assessment came back incomplete: the change altered model-owned skill text, the repository requires installed-host evidence for such changes, and no probe budget had been settled before handover, so the run had to stop and ask. The evidence budget is a governing decision that belongs in the interactive settlement.

Add to `skills/handover/SKILL.md`, directly after the sentence about settling known user-owned decisions before the user leaves: "When the queue changes model-owned behavior, settle the installed-host evidence budget and accounting in the same interactive phase, since an assessment without that evidence stays incomplete." Shipped text: ride with the next version increase and obtain independent assessment before it lands.

**Requires:** none.

### Ready selection proceeds to implementation without asking where the work runs

Reported from a `/ready` run in this repository on 2026-09-11. After the user picked two entries and the agent produced an agreed readback, the agent closed by asking whether to hand the selection to Nightshift or implement it in the session. The user's direction is that a selection plus agreed readback is the go-ahead for direct implementation in the session, and that a handover happens only when the user says so; asking which is ceremony that costs a turn.

Revise `skills/ready/SKILL.md` so that once a selection is agreed the agent proceeds to implementation in the session unless the user hands over, and keep the readback itself free of the handover question. The behavior is model-owned, so check the result with an installed-host probe.

**Requires:** none.

### Documentation and backlog edits land before the first cumulative assessment

Observed in this repository on 2026-09-11 during an unattended run. The agreed outcome committed to archiving two fixed BUGS.md entries, the controller left that for the documentation stage, the first cumulative assessment raised it as a minor finding, and the archive edit then invalidated the review snapshot, so a second full dispatch was needed for a change the reviewer had already covered. The lifecycle places documentation after review, but the runtime requires the cumulative assessment to be fresh at task completion and any tracked-file edit invalidates it, so every documentation or backlog edit made in that stage forces a reassessment. `internal/workflow.md` "Close and report" currently reads as if those edits belong after review.

Add one sentence to the brief, under Durable execution or Review and repair, stating that documentation, skill text and backlog closure the agreed outcome commits to are part of implementation and land before the first cumulative assessment, so the documentation stage only records evidence and a reassessment is needed only when findings change files; mirror it in `skills/handover/SKILL.md` if the handover text implies the later ordering. Shipped text changes model-owned behavior, so it rides with the next version increase.

**Requires:** none.

### Runtime CLI rejects an unrecognized request action with a clear error

Observed in this repository on 2026-09-11. `internal/runtime/REFERENCE.md` names the operations (`status`, `inspect`, `create` and so on) but never states the request key, and `internal/runtime/cli.js` dispatches on `request.action`. A request written as `{"operation": "status"}` fell through every branch to the owner check and failed with `stale-owner`, a message about controller identity, on a read-only status call; the controller spent two calls and a read of the CLI source to find the cause.

Make the CLI reject a request whose `action` is missing or unrecognized with an `invalid-request` error that names the key and lists the accepted actions, before any state check; the `unknown-action` default in `transition` (`internal/runtime/lifecycle.js`) already rejects unrecognized actions but only after the owner and run-state checks, so the new guard should precede it and the two should share one error code. Add one sentence at the top of the reference giving the request shape (`{action, actor, revision, ...}`), and a runtime fixture for the missing-key case. Runtime code, so it ships with a version increase.

**Requires:** none.

### Morning report ends by starting follow-up triage

Observed in this repository on 2026-09-11. An unattended run finished with two follow-ups preserved as pending user decisions. When the user returned, the controller's closing report listed them as awaiting a decision and stopped; the user had to ask for them, and they were then presented one at a time with a host question each, as the triage rule prescribes. The report and the triage are one hand-off: once the user is back, the pending decisions are the next thing to settle.

Add to `skills/handover/SKILL.md` and the brief's "Close and report" section that the report delivered to a returning user ends by presenting the first pending follow-up as a host question, with its concrete context, recommendation and the effect of each choice, then the next after each answer, rather than listing them for the user to request. Keep preserving them untouched when the user is still absent. Shipped text changes model-owned behavior, so it rides with the next version increase.

**Requires:** none.

## History

Prior delivered work remains in [QUICK_WINS_HISTORY.md](QUICK_WINS_HISTORY.md).
