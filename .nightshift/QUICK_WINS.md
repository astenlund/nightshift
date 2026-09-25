# Quick wins

V2 entries are preserved in [the historical index](migration/v2/QUICK_WINS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Honor escaped punctuation in heading anchors

Found by the final assessment of run `6e70931a-3760-46e2-b628-fdaa4a29f0e3` on 2026-09-25 and confirmed by a skeptic. `plainText` in `internal/backlog-links.js` ignores backslash escapes in heading text, so several escaped headings slug differently from GitHub and a correct link to them draws a false broken-anchor notice: `## \_private\_` slugs to `private` (GitHub `_private_`), `## \_\_init\_\_` to `_init_` (GitHub `__init__`), `## \<b\> tag` to `-tag` (GitHub `b-tag`) and `## \[text\](url)` to `text` (GitHub `texturl`), because the link, tag and emphasis passes all run on the raw, still-escaped text. Escaped asterisks, `#` and backticks already match. Notices only; no heading in this repository contains an escape. The user chose to track it at triage rather than extend the 3.2.9 review.

Honor backslash escapes in heading and title text before every markup pass in `plainText` (links, tags and emphasis), as destinations already do, with fixtures for escaped underscores, tags and brackets in both Ready front ends. Parser changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Reviewers re-request checks the controller already recorded

Observed throughout run `6e70931a-3760-46e2-b628-fdaa4a29f0e3` on 2026-09-25. After every repair, the read-only code reviewer (Codex `gpt-6-astra`) returned `incomplete` and requested probes of the same deterministic suites (Ready fixtures, unwrap fixtures, setup, package and release-gate tests) that the controller had just recorded as passing runtime checks on identical inputs. In 13 of the Codex reviewer's 15 incomplete returns the request also carried a genuinely new boundary probe, and only two asked for the suites alone, so handing over the recorded checks would mainly save the repeated suite executions in private copies (three or four suites per round, with the setup suite failing on path depth every time) rather than whole dispatches. Whether dispatch should hand reviewers the recorded check evidence, or reviewers should accept it, is undecided. The user chose to track it at triage.

Supply each task's latest passing named checks (command, exit status, input hashes) to the reviewer as evidence when their inputs match the reviewed snapshot, and state in the review brief when a probe rerun is still warranted. Runtime and review-brief changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Codex sandbox blocks the launcher from starting the host

Observed on 2026-09-19 in every Codex fixture of the handover acceptance campaign (Codex CLI 0.154.0, plugin 3.2.0), recorded in [the acceptance report](reports/handover-transition-and-morning-report-20260919.md). Inside the Codex sandbox the launcher cannot start the host process it inspects, at two sites. Preparation fails with `{"error":"EPERM","message":"spawn EPERM"}` at first use and again in some later sessions of the same, already prepared profile (the new-run handover and refused-admission sessions). Resolving resources through the retained bootstrap fails with `{"error":"retained-bootstrap-unavailable","message":"spawn EPERM"}` in later sessions (new-run handover, in-place handover and refused admission). The resumed returning-user session showed no fresh failure. Each time the model has to request an out-of-sandbox retry. With the escalation approved, preparation is silent and the operation proceeds; with it denied at first use, the Ready report correctly says the parser never ran and does not present an empty backlog. A real Codex user therefore sees approval prompts that work against preparation needing no setup conversation; whether every session prompts, or only the first command of each, was not separately established, because the harness answered these requests automatically. Claude Code shows no equivalent prompt.

Establish whether the launcher can start the host inside the Codex sandbox or avoid doing so on that host at both sites, for example by carrying an earlier result, which [Hook-path native settings resolution cost](#hook-path-native-settings-resolution-cost) already considers. If it cannot, document the approval and how often it recurs in the README installation guidance so the prompt is expected. Verify first use and a later session on an installed Codex host in a fresh profile. Tracking does not authorize implementation.

**Requires:** none.

### Acceptance reports carry a checkable evidence digest

Three lessons from the handover acceptance campaign of 2026-09-18 to 19, recorded in [the acceptance report](reports/handover-transition-and-morning-report-20260919.md). First, the final independent assessor could not verify the report, because all campaign evidence lived in the ignored `.tmp` directory; once a script-generated, credential-free digest (ledger, staged payload hashes, each fixture's saved run history and closing state, verbatim final assistant text) was supplied through `artifactPaths`, it found a real overstatement in the per-host table. Second, copying a host credential into an isolated profile races with token refresh: the production credential refreshed during the first attempt and invalidated the copy, and the reverse order could have logged out production sessions; the harness now copies a Claude credential only with more than three hours of token life left and removes every copy at the end. Third, a handover scenario costs roughly one to two and a half million tokens per host process, almost all of it context re-reading, so the agreed 4,000,000 allowance had to become 16,000,000 mid-campaign.

State in the shared brief that an acceptance report's installed-host claims are backed by a generated evidence digest supplied to the assessor as a selected artifact, derived per host from that host's own record. Record the credential-copy guard and the measured per-scenario costs where live budgets are settled, reconciling with [Settle the installed-host evidence budget before handover](#settle-the-installed-host-evidence-budget-before-handover) and [Settle a spare token allowance for every implementation run at handover](#settle-a-spare-token-allowance-for-every-implementation-run-at-handover). Decide whether the multi-turn harness retained under `.tmp/handover-live` (drivers for both hosts, scoped approvals, ledger, reconciliation and digest scripts) graduates into the repository's test tooling. Tracking does not authorize implementation.

**Requires:** none.

### Private review copies fail at Windows path depth

Observed throughout run `c675a074-6431-46e2-85b7-e3b8616e9220` on 2026-09-15 to 17. Every deterministic suite executed as a reviewer probe inside a private review copy failed exactly one case: the recovery suite's nested probe-inside-probe Git initialization refused with `probe-git-boundary` at that depth, and in one run the EOL autocrlf case failed with `Filename too long`. Both pass at ordinary checkout depth, which the recorded check `probe-isolation-at-supported-checkout-depth` exists to prove, so every strong reviewer had to be told the failure was environmental. The acceptance report already records process-only Git long-path support as the workaround for the EOL case.

Make private copies survive their own depth: shorten the copy path under the review directory, or enable process-only long-path support for the copy's Git operations, and make the nested-probe recovery case skip with a stated reason when it cannot establish a Git boundary rather than fail. Runtime code, so it ships with a version increase. Tracking does not authorize implementation.

Recurred in run `d4a44daa-96be-4ac4-bcaa-d16d8596584f` on 2026-09-18 to 19, the handover transition and morning report delivery, which spent 14,869,844 review tokens across 18 dispatches, summed from that run's review receipts, and 14,445,999 live-verification tokens on a change of roughly 400 lines, with four already tracked defects firing during it. Here, a requested probe of `tests/runtime-review.test.js` and `tests/runtime-probes.test.js` failed 39 cases with git's `Filename too long`, because those suites nest review copies inside an already deep probe copy, and the assessor had to be given the environmental explanation to weigh.

The run-adoption delivery on 2026-09-21 to 22 added a controlled comparison: the same saved source passed all three probe cases at a short project path and failed all three at the original deeper layout. Failing Git working directories were 272 or 280 characters; `spawnSync` returned null status, `ENOENT` and no output before Git started, despite process-local `core.longpaths=true`. Baseline and candidate also matched in separate shorter/deeper comparisons. Verification recovered through a shorter private copy. The exact Windows/process-launch cause and broader impact remain unknown. Distinguish this launch failure from the earlier Git-level error: Git configuration cannot repair a process that never starts, and a skipped or unavailable probe is not successful acceptance evidence. The user chose to track this recurrence; [triage evidence](reports/adoption-session-triage-20260922.md#deep-private-probe-paths) preserves its limits.

Recurred on 2026-09-25 in run `ff195382-31a4-4fea-bb48-ca56d20507bb`: an assessor probe running `tests/runtime-probes.test.js` inside a private copy failed six cases with "Could not establish an independent Git repository for the probe" (review `a108b64d-72ab-4e40-afb5-9bfe91da179c`), while the same file passed 9 of 9 at checkout depth as a recorded check, which the assessor accepted as the environmental explanation. The user chose to track this recurrence at triage.

Recurred again later on 2026-09-25 in run `6e70931a-3760-46e2-b628-fdaa4a29f0e3`: all 11 probes of `tests/setup.test.js` in private review copies failed one case, "a migrated stopped run resumes default spec assessment with current paths and original history", with git's `Filename too long`, while the recorded `setup-package-gate-tests` check passed in the canonical checkout. Every assessment in that run had to qualify its setup evidence as environmental. The user chose to add this recurrence at triage.

**Requires:** none.

### Acceptance harness waits on controller approval without a bound

Observed in run `c675a074-6431-46e2-85b7-e3b8616e9220`: a Claude acceptance run timed out while awaiting controller tool approval, and two earlier interrupted attempts each retain a 750,000-token uncertainty allowance because their usage could not be finalized. The user's aggregate budget, the harness's operational thresholds and the reserves for unreported usage are three different quantities that the harness currently blurs.

Give the private acceptance harness a bounded approval wait with a recorded outcome, finalize usage accounting on interruption, and report the three quantities separately. Tracking does not authorize implementation.

**Requires:** none.

### Shared native control session helper

Found by several strong assessments of the automatic-preparation change in run `c675a074-6431-46e2-85b7-e3b8616e9220`: `claudeSettings` in `internal/releases/native-host.js` reproduces the Codex control-session scaffold of `withCodex`, the pending map, failure latch, byte bound, timer and termination assertion, so a future transport fix must be made twice. It was deferred because the extraction rewrites the Codex transport and neither transport has deterministic coverage; a reviewer probe later showed Codex app-server inspection needs no model allowance, so a Codex-side verification probe is available at any time.

Extract one native session helper parameterized by request framing and default timeout, with an injected-process seam so both framings gain deterministic coverage, and verify the Codex side with an app-server probe. Runtime code, so it ships with a version increase under its own cumulative assessment. Tracking does not authorize implementation.

**Requires:** none.

### Settings inspection cleanup

Residual structural and coverage observations from the strong assessments in run `c675a074-6431-46e2-85b7-e3b8616e9220`, all confirmed minor: `preparation.js` reaches into ten service members and takes `locatorState` as an injected parameter to avoid a require cycle that moving `locatorState` beside the store primitives would remove; preparation capability is detected by the existence of `administration.js` rather than by the verified bootstrap bytes or a named constant; retained bootstrap routes and their launcher directories are never collected, so the set of permanently accepted entry points grows without a retirement rule; `claudeSettings` has no deterministic coverage of its own control framing, error subtype or timeout, which a fake child could pin; `resolve`'s unknown-entry guard has no test; and the Codex branch treats a non-boolean `enabled` field as untrusted where the Claude sibling fails closed, pending verification of the host's field contract.

Apply as one cleanup under its own cumulative assessment, deciding the route retention policy explicitly and stating it in the retained resource reference. Tracking does not authorize implementation.

**Requires:** none.

### Hook-path native settings resolution cost

Established by execution in run `c675a074-6431-46e2-85b7-e3b8616e9220`: resolving Claude's effective settings costs 1.4 to 1.7 seconds per call. Every SessionStart, PreCompact and Stop of a bound Claude session now pays one such call from the registered hook, and a session owning a running run pays a second from the bundled notice hook in a separate process that cannot share the memo, alongside the pre-existing plugin listing; a Codex skill invocation performs about seven app-server launches before the Ready parser runs where 3.1.0 performed four. The 20 second inspection bound plus the 30 second listing bound leave little of the 60 second hook budget on a loaded machine. This is operating cost, not correctness, and it is the one residual a user feels.

Decide the design: carry enablement and discovery results from prepare into resolve within one operation; drop the pre-registration Codex inspection whose only possible negative outcome is an inspection failure setup would surface anyway; and examine whether a firing hook is itself evidence that hooks are enabled on that host, separated carefully from the configured and trusted conditions, which would remove the resolution from the hook path entirely. Tracking does not authorize implementation.

**Requires:** none.

### Post-review minor repairs

Two of the three findings left by the clean strong assessment of the automatic-preparation change (Fable receipt `694f7f33`, run `c675a074-6431-46e2-85b7-e3b8616e9220`), each confirmed by a fresh skeptic and deferred only so the verdict stayed fresh: the `release-setup-required` guard defined in both `resolve` and `requireActivation`, the retired-binding message shared by `resolve`, `preparation.js` and, with different wording, `hook()`, and the `preparation-unavailable` message repeated in `setup` and `prepare`; and a missing test for the guard that maps a non-boolean `disableAllHooks` value to `host-configuration-unavailable`, which every fixture leaves boolean or absent so a regression to a truthiness check would pass the suite. The launch-count finding from the same receipt is carried by [the hook-path cost item](#hook-path-native-settings-resolution-cost).

Hoist the two messages and the predicate beside `REMOVED_MESSAGE`, deciding whether `hook()` shares the retired-binding wording, and add one rejection case to the unavailable-inspection test supplying a string value. Runtime code, so it ships with a version increase under its own cumulative assessment. Tracking does not authorize implementation.

**Requires:** none.

### Codex inline-script guard parity

On 2026-09-17 the user's global inline-script rule gained mechanical enforcement on Claude Code: a `PreToolUse` hook on the Bash and PowerShell tools refuses heredoc, pipe and inline script bodies, verified live in auto mode with a 48-case deterministic suite beside it. Codex sessions, including unattended Nightshift workers on Codex, have no equivalent and rely on the prose rule alone, which run `c675a074-6431-46e2-85b7-e3b8616e9220` showed is not recalled at typing time. Nightshift already registers Codex hooks through `internal/releases`; whether Codex hooks can refuse a tool call before it runs is unverified.

Establish whether Codex hooks support a pre-call deny. If they do, port the guard and its tests; if not, record the asymmetry as permanent in the rule. Tracking does not authorize implementation.

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

### Agent-directed rules leak into user-facing prose

Reported from a `/ready` run in another project on 2026-09-11 and repaired for that skill in plugin 3.0.4; the pattern is broader than one skill. Skill texts state constraints for the agent, such as readiness not being agreement, a draft not being authorized implementation work, or a previous review not authorizing a narrowed new pass, and agents echo them to the user as stiff rule quotations, for example "Readiness is not a selection". The user wrote these conventions and does not need them restated. Fresh evidence on 2026-09-24 from [the Ready selection campaign](reports/ready-selection-boundary-20260924.md): with the 3.2.4 candidate, the Codex controller told the user in two turns what the Ready skill "says" and "requires" ("The Ready skill says to propose a concrete selection by ready-set number ...", "... requires that nothing is edited before the user agrees that readback"), although the skill states those constraints are guidance for the agent; the Claude controller did not. Evidence: `.tmp/ready-live/codex-work-f3c5d95f/live-2026-09-24T02-19-21-251Z-c-work/events.jsonl`.

Add a shared rule to `internal/workflow.md` that separates agent-directed constraints from user-facing phrasing, sweep all eight skills for constraint sentences that read as user-facing prose and rephrase them as closing offers or actions, and check the result with an installed-host probe, since the behavior is model-owned.

**Requires:** none.

### Settle the installed-host evidence budget before handover

Approved as written by the user on 2026-09-11 after a self-hosting run whose first independent assessment came back incomplete: the change altered model-owned skill text, the repository requires installed-host evidence for such changes, and no probe budget had been settled before handover, so the run had to stop and ask. The evidence budget is a governing decision that belongs in the interactive settlement.

Add to `skills/handover/SKILL.md`, directly after the sentence about settling known user-owned decisions before the user leaves: "When the queue changes model-owned behavior, settle the installed-host evidence budget and accounting in the same interactive phase, since an assessment without that evidence stays incomplete." Shipped text: ride with the next version increase and obtain independent assessment before it lands.

**Requires:** none.

### Documentation and backlog edits land before the first cumulative assessment

Observed in this repository on 2026-09-11 during an unattended run. The agreed outcome committed to archiving two fixed BUGS.md entries, the controller left that for the documentation stage, the first cumulative assessment raised it as a minor finding, and the archive edit then invalidated the review snapshot, so a second full dispatch was needed for a change the reviewer had already covered. The lifecycle places documentation after review, but the runtime requires the cumulative assessment to be fresh at task completion and any tracked-file edit invalidates it, so every documentation or backlog edit made in that stage forces a reassessment. `internal/workflow.md` "Close and report" currently reads as if those edits belong after review.

Add one sentence to the brief, under Durable execution or Review and repair, stating that documentation, skill text and backlog closure the agreed outcome commits to are part of implementation and land before the first cumulative assessment, so the documentation stage only records evidence and a reassessment is needed only when findings change files; mirror it in `skills/handover/SKILL.md` if the handover text implies the later ordering. Shipped text changes model-owned behavior, so it rides with the next version increase.

**Requires:** none.

## History

Prior delivered work remains in [QUICK_WINS_HISTORY.md](QUICK_WINS_HISTORY.md).
