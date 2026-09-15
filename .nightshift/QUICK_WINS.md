# Quick wins

V2 entries are preserved in [the historical index](migration/v2/QUICK_WINS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Acknowledge accepted handovers clearly

Proposed by the user during retained-release delivery in this repository, run `2a89bde5-9c0c-4ba5-b67f-dadc545bfcc4`, Codex session `01a09c60-dd6e-7d42-b8a0-7333fd211d92`: a clear "Handover accepted" message would tell the user when they can leave the keyboard. The idea was preserved as the `clear-handover-acceptance` run follow-up, and the user chose to track it on 2026-09-15.

Make acceptance of an explicit handover unmistakable once the agreed scope and essential continuation prerequisites are settled. Briefly carry forward the accepted work and relevant limits without reopening settled requirements or bundling publication authority into the acknowledgment. If a material decision or continuation prerequisite remains unresolved, identify it instead of claiming acceptance. Verify the model-owned acknowledgment on both supported hosts for new runs, existing runs and unresolved prerequisites. This is distinct from [switching an existing run to unattended mode](BUGS.md#handover-leaves-existing-runs-in-attended-mode) and [delivering the morning report](BUGS.md#handover-omits-the-morning-report). Tracking does not authorize implementation.

**Requires:** none.

### Expose a project-relative receipt path in dispatch results

Reported on 2026-09-12 from an unattended Claude handover in FeatherPod-Private, run prefix `216f01e8`, plugin 3.0.6. The dispatch result supplies `receiptFile` as an absolute Windows path, while `review` and `validate` import requests need a project-relative receipt path; the controller derived it from `receipt.requestId`. The current `internal/runtime/review.js` still returns `{receiptFile, receipt}` with an absolute file path and the receipt object. The newer runtime `wait` operation supplies a project-relative `receipt` path, so the report's original claim that dispatch is the only place the path appears no longer describes the current surface; direct dispatch results still require conversion. Original inbox report: observation 3 of `2026-09-12-probe-returns-full-state-and-foreground-wait-recurrence.md`.

Expose the project-relative receipt path consistently for controllers consuming a direct dispatch result. Settle an unambiguous response field without overwriting the existing `receipt` object or silently breaking its consumers; reconcile the dispatch and wait documentation and affected consumers. Add focused coverage that the returned path is accepted by receipt-import operations, including Windows paths with spaces. Runtime behavior changes ship with a version increase.

**Requires:** none.

### Standardize the probe response and expose its recorded result

Reported on 2026-09-12 from an unattended Claude handover in FeatherPod-Private, run prefix `216f01e8`, plugin 3.0.6. Unlike ordinary lifecycle mutations that return an obligation brief, `probe` returns the complete `store.update` result. A controller helper expecting `next`, `closing` and summarized workers consequently printed the full worker list and raw closing state. The current `internal/runtime/cli.js` probe branch still returns `store.update(...)` directly. Stored probe evidence contains `{path, sha256, snapshotDigest}`, while the command, exit code and output require a separate read of the referenced `result.json`. Evidence in the source project: `.nightshift/runs/reviews/e5be77fd-cdf1-46b9-850f-841524931038/probes/01699ed2-8463-45ca-9df0-dbd5bbc80865/result.json`. Original inbox report: observation 1 of `2026-09-12-probe-returns-full-state-and-foreground-wait-recurrence.md`.

Align the probe response with the runtime's focused obligation brief and expose the recorded result clearly enough for the controller to locate and interpret the evidence without inspecting full run state. Settle the result metadata and update the runtime reference and affected consumers together, preserving the saved raw command/output and independent interpretation requirement. Add focused coverage for the response shape and result reference, including a probe whose command exits unsuccessfully. Runtime behavior changes ship with a version increase.

**Requires:** none.

### Align Exploring source-link guidance with Ready

Confirmed during review and skeptical validation of the Ready presentation change on 2026-09-13: `skills/exploring/SKILL.md` requests breakout links but lacks the explicit index-relative resolution, index-file fallback, absolute-link preservation and Windows Markdown formatting guidance now present in `skills/ready/SKILL.md`. Earlier Ready probes exposed failures under similarly thin guidance; the Exploring skill itself was not probed, so a corresponding behavior failure remains an inference. The user chose to track this follow-up rather than implement it. See [the Ready presentation evidence](reports/ready-exploring-presentation-20260912.md).

Reconcile the Exploring skill's source-link guidance with Ready and verify its own output on installed hosts, including relative records, drafts without record links, absolute links and Windows paths containing spaces. Preserve the Exploring view's full draft presentation and separation from ready work.

**Requires:** none.

### Settle a spare token allowance for every implementation run at handover

User idea from an unattended run in this repository on 2026-09-12, refined at triage. That run needed two separate budget questions after handover (a 500000 token installed-host campaign, then a re-probe of about 350000), and a controller estimate for one more probe overran the second cap by 101971 tokens because the runner enforced an estimated admission check rather than a spending ceiling. The pending entry [Settle the installed-host evidence budget before handover](#settle-the-installed-host-evidence-budget-before-handover) covers planned live evidence only.

On 2026-09-13 the user proposed a generous default of 4,000,000 tokens, adjustable up or down at handover, following discussion of campaigns the controller cannot credibly estimate. The user further proposed powers-of-two adjustment steps for simplicity: each upward step doubles the allowance and each downward step halves it, giving 1M, 2M, 4M, 8M, 16M and so on around the default; M denotes 1,000,000 tokens. Present this as an aggregate live-verification allowance, not an estimate or spending target. Its scope includes planned and unexpected live probes, associated review, retries and cached input; the spare allowance and planned evidence share one aggregate limit rather than receiving separate default grants.

Extend `skills/handover/SKILL.md` so every implementation run presents that default and settles the user's allowance and accounting source in the interactive phase, whether or not live probes are planned at the start. State uncertainty when no credible estimate is available; use concrete evidence to recommend an adjustment when appropriate. Within the accepted allowance, the controller owns probe sizing, internal ceilings and reservations and adapts them autonomously. If remaining allowance cannot cover a probe, first assess an adequate bounded approach within that allowance; if none is available, defer optional verification for the user's decision or record required verification as a blocker. Never exceed or automatically renew the user's aggregate allowance. Reliable finalized usage accounting and effective spending controls remain necessary independently of the generous default. Reconcile this work with the [internal-ceiling authority and accounting defect](BUGS.md#controller-treats-internal-token-ceilings-as-user-owned-budget-decisions). Shipped text changes model-owned behavior, so it rides with the next version increase and needs installed-host evidence.

**Requires:** none.

### Probe proposals with implausible timeouts run as specified

Observed in this repository on 2026-09-12 during an unattended run. An independent assessor returned a `deterministic-regressions` probe with `timeoutMs` 600 for five test suites that take about a minute; the `probe` operation executed it as written, `spawnSync` reported `ETIMEDOUT` after 613 ms, and the spurious failure cost a full re-dispatch to explain. The runtime accepts any positive timeout, and neither the reference nor the dispatch rules state the unit or a floor.

Make the `probe` operation reject a proposal whose `timeoutMs` is below a plausible floor (for example 5000) with an error naming the unit, state in `internal/runtime/REFERENCE.md` that `timeoutMs` is milliseconds, and add a runtime fixture for the rejection. Runtime code, so it ships with a version increase.

**Requires:** none.

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

## History

Prior delivered work remains in [QUICK_WINS_HISTORY.md](QUICK_WINS_HISTORY.md).
