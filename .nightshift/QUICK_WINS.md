# Quick wins

V2 entries are preserved in [the historical index](migration/v2/QUICK_WINS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Confirm when marketplace auto-update applies a pushed release

Observed on 2026-09-28 in run `7f0cb8e1-8a73-4a4c-b5f9-f8ec62661471`. The user restarted Claude Code expecting the published 3.2.13 release, but the `astenlund` marketplace snapshot under `~/.claude/plugins/marketplaces/` stayed at `5b24ffa`, the last commit pushed before 3.2.13, `known_marketplaces.json` kept `lastUpdated` 2026-09-28T00:16:19Z with `autoUpdate: true`, and `installed_plugins.json` still named 3.2.12, although 3.2.13 was pushed at 07:40:53Z (the `origin/main` reflog), before the restart, whose session activation was observed at 08:38Z. The snapshot was still unrefreshed when the run ended. Earlier refreshes did happen: 3.2.12, pushed at 19:07Z on 2026-09-27, was installed by 20:15Z (`installed_plugins.json` `lastUpdated`; whether by startup auto-update or a manual update is not recorded), and the marketplace refreshed again at 00:16Z. The user's global AGENTS.md says a pushed release propagates to the installed copy at the next Claude Code or Codex startup; this observation covers Claude Code only, and Codex is unobserved. The cause is unverified: the refresh may be throttled, or may run in the background and apply only on a later start. Separately, the resumed session kept its 3.2.12 binding, which is intended. The user chose to track it at triage.

Establish when a startup auto-update refreshes the marketplace snapshot and installs a newer version, for example by comparing those timestamps after a later fresh start, then correct the Claude Code half of the global AGENTS.md sentence if needed, leaving the Codex half to its own evidence; the README makes no such claim. Tracking does not authorize implementation.

**Requires:** none.

### Backlog conventions recommend commit hashes that a pre-push rewrite invalidates

Found on 2026-09-28 in run `32ce50cd-22de-4211-a488-b82ed9726ec0`. The history files and their shipped init-backlog templates ask archived entries to name where the work landed: the `BUGS_HISTORY.md` header and the `bugs.md` and `bugs-history.md` templates ask for the commit, the `QUICK_WINS_HISTORY.md` header and the `quick-wins-history.md` template for the commit or scope, and the `FEATURES_HISTORY.md` header and the `features-history.md` template for the feature scope or commit; the `quick-wins.md` template also recommends commit hashes as anchors that survive refactors. A hash recorded before publication goes stale when history is rewritten before the push, as the owner's convention of autosquashing review-repair fixup commits does; the plugin itself prescribes no fixup or autosquash step. That run's history entry cited three local hashes beside its run id when first committed, and a review-repair fixup dropped them while keeping the run id, so they will not reach the remote once the fixups are autosquashed. The user chose to track it at triage.

Decide whether entries written before publication cite a run id or scope, optionally with commit subjects, or record hashes only after publication, then align the three history headers, the affected templates and the anchor advice in `quick-wins.md`. The templates ship with the plugin, so that change needs a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Hand stored probe results over after a line-ending renormalization

Found on 2026-09-27 by the cumulative assessment of run `d42fe76e-3954-4ef8-99db-727790f12ee2` and confirmed by a skeptic. Review freshness now tolerates a line-ending renormalization, so a probe still runs after a commit or rebase renormalizes a reviewed file, but `loadProbeEvidence` in `internal/runtime/probes.js` hands a stored result to the next assessment only when the stored snapshot and context digests equal the new ones exactly. The result is then withheld with no diagnostic, costing a wasted dispatch and a repeated probe; the skeptic found it neither unsafe nor a stall. [The runtime reference](../internal/runtime/REFERENCE.md) and the README state the limit. The user chose to track it at triage.

Let the handoff accept a stored result whose recorded snapshot is equivalent under the same Git-normalized identity `fresh()` uses, which needs the originating snapshot files rather than only digests, report withheld probe references to the controller, and add a handoff test after a renormalization. Runtime code, so it ships with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Say at handover when the session runs an older release than the installed one

Observed on 2026-09-27 in run `d42fe76e-3954-4ef8-99db-727790f12ee2`. The session was bound to release 3.2.8 when the user handed over, although 3.2.11 was installed and reloaded, because an existing session keeps its exact bound release. Under 3.2.8 rules a Claude Code handover is recorded attended, since only a native goal counts as continuation, so the run stayed attended under Stop hook protection. Nothing told the user at handover that a fresh session would have run it unattended with the newer behavior. The user chose to track it at triage.

When a handover or run creation happens in a session bound to an older release than the installed one, say so plainly in the acknowledgement or readback and name the fresh-session recovery, so the user can choose before leaving. Shipped skill or runtime text, so it ships with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Tell reviewers the bound release's probe copy layout

Observed on 2026-09-27 in run `b6ca7513-7450-4d3d-9e5d-ec8fcf0da095`, bound to installed 3.2.8 while the checkout carried the 3.2.10 runtime. An Astra reviewer (receipt `bc46bddc-9684-4497-b556-5801f00da3ef`) returned `incomplete` and proposed an evidence probe that asserted its working directory matched `.nightshift/runs/c/<eight hex digits>`, the private-copy layout the checkout's 3.2.10 runtime defines in `internal/runtime/copies.js`, which is where that reviewer read the pattern. The bound 3.2.8 runtime placed the copy under the dispatch directory, so the probe failed its own assertion with exit code 1, and the evidence was then supplied as selected artifacts at the cost of another assessment round of 659,428 tokens. Reviewers read the checkout's runtime source and documentation rather than the bound release's, so this recurs whenever the two differ, which is routine in this repository while a candidate is unpublished or not yet installed. The user chose to track it at triage as low priority.

Tell reviewers the executing release's probe working-directory layout, or its version, in the assessment request, so a probe does not hardcode a layout taken from the checkout. Tracking does not authorize implementation.

**Requires:** none.

### Name the host's own failure in review attempt errors

Reported on 2026-09-26 from FeatherPod-Private, run `5081dcdc-8956-4ff9-9870-4672f39a17f8`, installed 3.2.8. The first Codex review dispatch of the run completed; every later Codex attempt (workers `33bf017f`, `79fa6d05` and `cba72102`) failed, and each receipt attempt recorded only the generic `unusable-review` message "Host did not return an attributable completed assessment" from `dispatchReview` in `internal/runtime/review.js`. The actual cause was visible only in the attempt's native `events.jsonl`: a `systemError` status and a failed turn carrying `unexpected status 401 Unauthorized: Incorrect API key provided`, while `result.json` showed exit code 0. The Fable fallback completed every assessment, so the run was not blocked, but its review silently degraded from cross-host to same-host for the rest of the run. The timing matches the evening the acceptance harness revoked the production Codex login, as [Codex acceptance fixtures copy the live credential](#codex-acceptance-fixtures-copy-the-live-credential) records, but that link is a hypothesis; whether the credential changed between the first and second dispatch was not investigated. The user chose to track it at inbox triage.

Carry the host-reported terminal failure, such as an authentication error and its re-login recovery, into the attempt error and the dispatch result, so a controller can tell a credential problem from a model or attribution failure without reading raw events, and can say when a fallback cost the review its cross-host independence. Runtime code, so it ships with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Codex acceptance fixtures copy the live credential

Observed on 2026-09-25 in run `36aad5de-2825-4818-ba8c-e1ea8c8e72a4` (candidate 3.2.10). The retained `.tmp/handover-live` harness copies the production Codex ChatGPT-mode `auth.json` into every Codex fixture profile, with no remaining-life guard like the one it applies to Claude credentials. One fixture refreshed its copied token, rotating the shared refresh token; the fixture then failed with 401 and a production `codex exec` failed with `refresh_token_reused` until the user ran `codex login`. The Codex lane of that campaign produced no evidence, and cross-host Codex review was unavailable for the rest of the run. The user chose to track it at triage on 2026-09-26.

Give Codex acceptance fixtures their own login or an API key and never copy the live Codex credential, and state the rule beside the Claude credential-copy guard that [Acceptance reports carry a checkable evidence digest](#acceptance-reports-carry-a-checkable-evidence-digest) records. Tracking does not authorize implementation.

**Requires:** none.

### Verify the Codex handover path of 3.2.10

Raised at triage of run `36aad5de-2825-4818-ba8c-e1ea8c8e72a4` on 2026-09-26. 3.2.10 requires a Codex controller to record its goal with `kind: "goal"` and changes the handover acknowledgement text, but its installed-host evidence covers Claude Code only: the Codex lane was blocked when the production Codex login was revoked, as recorded in [the acceptance report](reports/unattended-stop-hook-20260926.md). The runtime rules are covered by deterministic tests on both hosts. The user chose to track the verification.

Run a Codex first-use and new-run handover scenario against 3.2.10, with a fixture-owned login or API key per [Codex acceptance fixtures copy the live credential](#codex-acceptance-fixtures-copy-the-live-credential), before or right after publishing 3.2.10, and record the goal kind, the acknowledgement wording and continuation in the acceptance report. Tracking does not authorize implementation.

**Requires:** none.

### Create silently ignores unknown request fields

Observed on 2026-09-25 in an installed 3.2.10 fixture of run `36aad5de-2825-4818-ba8c-e1ea8c8e72a4`. The fixture controller passed its verified Stop hook mechanism to the runtime `create` operation in a `continuation` field; `create` created the run unattended with the handover recorded and silently dropped the field, so continuation stayed empty until a separate `continuation` operation. Execution is refused until continuation is verified, so nothing ran unverified. The runtime reference sentence that invited the reading was clarified in 3.2.10; unknown `action` values are already refused with the accepted list, unknown fields inside a request are not. The user chose to track it at triage.

Make `create` reject unknown request fields with the accepted field list, as unknown actions already are, and consider the same for other operations. Runtime code, so it ships with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Honor escaped punctuation in heading anchors

Found by the final assessment of run `6e70931a-3760-46e2-b628-fdaa4a29f0e3` on 2026-09-25 and confirmed by a skeptic. `plainText` in `internal/backlog-links.js` ignores backslash escapes in heading text, so several escaped headings slug differently from GitHub and a correct link to them draws a false broken-anchor notice: `## \_private\_` slugs to `private` (GitHub `_private_`), `## \_\_init\_\_` to `_init_` (GitHub `__init__`), `## \<b\> tag` to `-tag` (GitHub `b-tag`) and `## \[text\](url)` to `text` (GitHub `texturl`), because the link, tag and emphasis passes all run on the raw, still-escaped text. Escaped asterisks, `#` and backticks already match. Notices only; no heading in this repository contains an escape. The user chose to track it at triage rather than extend the 3.2.9 review.

Honor backslash escapes in heading and title text before every markup pass in `plainText` (links, tags and emphasis), as destinations already do, with fixtures for escaped underscores, tags and brackets in both Ready front ends. Parser changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Reviewers re-request checks the controller already recorded

Observed throughout run `6e70931a-3760-46e2-b628-fdaa4a29f0e3` on 2026-09-25. After every repair, the read-only code reviewer (Codex `gpt-6-astra`) returned `incomplete` and requested probes of the same deterministic suites (Ready fixtures, unwrap fixtures, setup, package and release-gate tests) that the controller had just recorded as passing runtime checks on identical inputs. In 13 of the Codex reviewer's 15 incomplete returns the request also carried a genuinely new boundary probe, and only two asked for the suites alone, so handing over the recorded checks would mainly save the repeated suite executions in private copies (three or four suites per round, with the setup suite failing on path depth every time) rather than whole dispatches. Whether dispatch should hand reviewers the recorded check evidence, or reviewers should accept it, is undecided. The user chose to track it at triage. Run `32ce50cd-22de-4211-a488-b82ed9726ec0` on 2026-09-28 added three suite-only instances: the first Codex assessment, the one after the documentation edits and the one after the repair batch each returned `incomplete` asking only to rerun test files the controller had already recorded as passing checks, and each probe passed with nothing skipped. After the first and the third the next dispatch came back clean; after the second, the Codex attempt of the next dispatch was ended as an output loop and its same-host fallback asked for a genuinely new boundary probe of the real `sh` and `bash -c` shapes beside further suite reruns. Stored probe results from an earlier round did not carry over because the intervening edits changed the reviewed inputs. The user chose at triage to record this as further evidence here.

Supply each task's latest passing named checks (command, exit status, input hashes) to the reviewer as evidence when their inputs match the reviewed snapshot, and state in the review brief when a probe rerun is still warranted. Runtime and review-brief changes ship with a version increase. Tracking does not authorize implementation.

Recurred on 2026-09-27 in run `d42fe76e-3954-4ef8-99db-727790f12ee2`: the Astra lead returned `incomplete` with probe requests on 11 of its 20 completed passes (a 21st failed), and nine of those asked to rerun suites the controller had already recorded as passing checks on the same inputs, while boundary fixtures in five of them exposed real issues. The run spent 26 review and skeptic dispatches and about 18.1M reported tokens (15.7M Astra lead, 2.4M Fable skeptic; two failed attempts reported none) on a change of a few hundred lines. The user chose to add this recurrence at triage.

A contrasting observation on 2026-09-28 in run `7f0cb8e1-8a73-4a4c-b5f9-f8ec62661471`: the controller listed its recorded passing checks (commands, exit 0, inputs unchanged) in the review rules and asked for a probe only for evidence those checks could not supply, and both Codex `gpt-6-astra` assessments (`766b8fe7`, 479,520 tokens; `56e7b81d`, 703,257 tokens) returned complete and clean with no probe requests. The change was small, about 200 words of reference text across four paragraphs, one error message and two tests (46 insertions and 16 deletions before the backlog archive), with little to probe, so this is a single confounded data point rather than evidence that supplying the checks suppresses reruns. The user chose at triage to record it here.

**Requires:** none.

### Codex sandbox blocks the launcher from starting the host

Observed on 2026-09-19 in every Codex fixture of the handover acceptance campaign (Codex CLI 0.154.0, plugin 3.2.0), recorded in [the acceptance report](reports/handover-transition-and-morning-report-20260919.md). Inside the Codex sandbox the launcher cannot start the host process it inspects, at two sites. Preparation fails with `{"error":"EPERM","message":"spawn EPERM"}` at first use and again in some later sessions of the same, already prepared profile (the new-run handover and refused-admission sessions). Resolving resources through the retained bootstrap fails with `{"error":"retained-bootstrap-unavailable","message":"spawn EPERM"}` in later sessions (new-run handover, in-place handover and refused admission). The resumed returning-user session showed no fresh failure. Each time the model has to request an out-of-sandbox retry. With the escalation approved, preparation is silent and the operation proceeds; with it denied at first use, the Ready report correctly says the parser never ran and does not present an empty backlog. A real Codex user therefore sees approval prompts that work against preparation needing no setup conversation; whether every session prompts, or only the first command of each, was not separately established, because the harness answered these requests automatically. Claude Code shows no equivalent prompt.

Establish whether the launcher can start the host inside the Codex sandbox or avoid doing so on that host at both sites, for example by carrying an earlier result, which [Hook-path native settings resolution cost](#hook-path-native-settings-resolution-cost) already considers. If it cannot, document the approval and how often it recurs in the README installation guidance so the prompt is expected. Verify first use and a later session on an installed Codex host in a fresh profile. Tracking does not authorize implementation.

**Requires:** none.

### Acceptance reports carry a checkable evidence digest

Three lessons from the handover acceptance campaign of 2026-09-18 to 19, recorded in [the acceptance report](reports/handover-transition-and-morning-report-20260919.md). First, the final independent assessor could not verify the report, because all campaign evidence lived in the ignored `.tmp` directory; once a script-generated, credential-free digest (ledger, staged payload hashes, each fixture's saved run history and closing state, verbatim final assistant text) was supplied through `artifactPaths`, it found a real overstatement in the per-host table. Second, copying a host credential into an isolated profile races with token refresh: the production credential refreshed during the first attempt and invalidated the copy, and the reverse order could have logged out production sessions; the harness now copies a Claude credential only with more than three hours of token life left and removes every copy at the end. Third, a handover scenario costs roughly one to two and a half million tokens per host process, almost all of it context re-reading, so the agreed 4,000,000 allowance had to become 16,000,000 mid-campaign.

State in the shared brief that an acceptance report's installed-host claims are backed by a generated evidence digest supplied to the assessor as a selected artifact, derived per host from that host's own record. Record the credential-copy guard and the measured per-scenario costs where live budgets are settled, reconciling with [Verify faked boundaries live](features/live-boundary-verification.md), which carries the live-evidence budget and allowance decisions. Decide whether the multi-turn harness retained under `.tmp/handover-live` (drivers for both hosts, scoped approvals, ledger, reconciliation and digest scripts) graduates into the repository's test tooling. Tracking does not authorize implementation.

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

### Agent-directed rules leak into user-facing prose

Reported from a `/ready` run in another project on 2026-09-11 and repaired for that skill in plugin 3.0.4; the pattern is broader than one skill. Skill texts state constraints for the agent, such as readiness not being agreement, a draft not being authorized implementation work, or a previous review not authorizing a narrowed new pass, and agents echo them to the user as stiff rule quotations, for example "Readiness is not a selection". The user wrote these conventions and does not need them restated. Fresh evidence on 2026-09-24 from [the Ready selection campaign](reports/ready-selection-boundary-20260924.md): with the 3.2.4 candidate, the Codex controller told the user in two turns what the Ready skill "says" and "requires" ("The Ready skill says to propose a concrete selection by ready-set number ...", "... requires that nothing is edited before the user agrees that readback"), although the skill states those constraints are guidance for the agent; the Claude controller did not. Evidence: `.tmp/ready-live/codex-work-f3c5d95f/live-2026-09-24T02-19-21-251Z-c-work/events.jsonl`.

Add a shared rule to `internal/workflow.md` that separates agent-directed constraints from user-facing phrasing, sweep all eight skills for constraint sentences that read as user-facing prose and rephrase them as closing offers or actions, and check the result with an installed-host probe, since the behavior is model-owned.

**Requires:** none.

### Documentation and backlog edits land before the first cumulative assessment

Observed in this repository on 2026-09-11 during an unattended run. The agreed outcome committed to archiving two fixed BUGS.md entries, the controller left that for the documentation stage, the first cumulative assessment raised it as a minor finding, and the archive edit then invalidated the review snapshot, so a second full dispatch was needed for a change the reviewer had already covered. The lifecycle places documentation after review, but the runtime requires the cumulative assessment to be fresh at task completion and any tracked-file edit invalidates it, so every documentation or backlog edit made in that stage forces a reassessment. `internal/workflow.md` "Close and report" currently reads as if those edits belong after review.

Add one sentence to the brief, under Durable execution or Review and repair, stating that documentation, skill text and backlog closure the agreed outcome commits to are part of implementation and land before the first cumulative assessment, so the documentation stage only records evidence and a reassessment is needed only when findings change files; mirror it in `skills/handover/SKILL.md` if the handover text implies the later ordering. Shipped text changes model-owned behavior, so it rides with the next version increase.

**Requires:** none.

## History

Prior delivered work remains in [QUICK_WINS_HISTORY.md](QUICK_WINS_HISTORY.md).
