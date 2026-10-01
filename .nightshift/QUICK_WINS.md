# Quick wins

V2 entries are preserved in [the historical index](migration/v2/QUICK_WINS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Protect projects from committed scratch files

Found on 2026-10-01 by [the audit of capabilities that left v2 without a disposition](reports/v2-capability-audit-20261001.md). v2's implementation dispatch (`skills/handover/implementation-dispatch.js` at `8ca3cb4^`, shipped in 2.6.21) refused to start when the project's root `.gitignore` lacked the `/.tmp/` rule, refused staged `.tmp/` paths, audited every commit since the plan for committed `.tmp/` paths, and gave each dispatch a fresh scratch directory. The v3 change `8ca3cb4` removed all of it, and no disposition names the removal. v3 still writes its own request files under the project's `.tmp/nightshift`, assuming the directory is ignored ([the retained resource interface](../internal/releases/REFERENCE.md)), and excludes `.tmp` from review inventories, but nothing checks the ignore rule or keeps scratch out of commits. The user chose to restore it as a quick win at the audit's triage.

Confirm that `.tmp` is ignored before Nightshift or its agents write scratch there, and flag staged or committed `.tmp` paths before delivery completes, naming the exact policy or commits to repair rather than editing the user's ignore policy. The `.superpowers/` half of the v2 check went with the Superpowers dependency. Guidance and runtime changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Block unattended work before destructive or outward-facing actions

Found on 2026-10-01 by [the audit of capabilities that left v2 without a disposition](reports/v2-capability-audit-20261001.md). v2's handover stopped a handed-over run "for destructive, irreversible, or outward-facing actions" (`skills/handover/SKILL.md` at `8ca3cb4^`). The v3 operating brief gates publication on recorded authority but names neither destructive nor irreversible actions, and no disposition names the change. [VISION.md](../VISION.md) says "deployment or other external actions require the user's authorization", but runs do not load it, so what remains are host permission modes and each user's own rules. The user chose to restore it as a quick win at the audit's triage.

Have [the operating brief](../internal/workflow.md) tell unattended work to block with a user-decision blocker before any destructive, irreversible or outward-facing action that recorded authority does not cover, and to continue independent work meanwhile. Guidance changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Restore the revise-docs writing rules

Found on 2026-10-01 by [the audit of capabilities that left v2 without a disposition](reports/v2-capability-audit-20261001.md). v2's revise-docs (`skills/revise-docs/SKILL.md` at `8ca3cb4^`) verified landed claims against Git and, after a revert or a `DROPME` drop, swept the session's tracking files for claims recording reverted work as landed; kept `CLAUDE.md` for constraints and traps rather than descriptions of the code; added no new documentation sections; and asked the user before balance adjustments or cleanups beyond the immediate scope. [The v3 revise-docs](../skills/revise-docs/SKILL.md) asks for proportionate updates of stale claims, and its docs review checks claim accuracy and proportionality afterwards, but none of those writing rules survives and no disposition names their removal; the coarse-and-stable anchors rule survives in the init-backlog templates. The user chose to restore them as a quick win at the audit's triage.

Carry the missing rules into revise-docs: the revert sweep for landed claims, instruction files holding constraints rather than descriptions of the code, no new sections without need, and balance or beyond-scope adjustments asked first, or recorded as follow-ups when no user is available. Skill changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Confirm commits land on the run's intended branch

Found on 2026-10-01 by the verification of [the audit of capabilities that left v2 without a disposition](reports/v2-capability-audit-20261001.md), whose draft had listed it as accounted for. v2's handover had the controller verify after each implementation batch that its commits landed on the intended branch (`skills/handover/SKILL.md` at `8ca3cb4^`). The check went with the v3 change; the retirement of the Superpowers dispatch skill beside it does not name the check, and [the operating brief](../internal/workflow.md) still lets the controller dispatch helpers that can commit. The user chose to restore it as a quick win at the audit's triage.

Have the operating brief ask the controller to confirm, after it or a helper commits, that the commits landed on the run's intended branch and checkout, and to treat a mismatch as a blocker to reconcile. Relates to [Deliver each run on its own branch or worktree](features/run-worktree-delivery.md) (Exploring). Guidance changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Detect review input drift before the reviewer's usage is spent

Raised in run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9` on 2026-09-30, which delivered [State that project edits during a dispatch discard its result](QUICK_WINS_HISTORY.md#state-that-project-edits-during-a-dispatch-discard-its-result) and deliberately left this part out. An assessment whose watched inputs change while it runs, meaning any code, docs or skeptic assessment and a spec assessment whose governing artifact changes, still spends its whole attempt before `dispatchReview` in `internal/runtime/review.js` detects the change and fails with `review-input-drift`. The run records retained in this checkout hold two dispatches that failed this way, 2,512,151 tokens for request `516fb299` (recorded in [the adoption session triage report](reports/adoption-session-triage-20260922.md)) and 938,943 Codex `gpt-6-astra` tokens for request `7a6fddbb`; both were whole-spec assessments discarded by changes outside their spec, which 3.2.17 no longer discards, and the records hold none of the remaining class. The host adapters in `internal/runtime/hosts.js` already end an attempt on its timeout, on a host failure and, on Codex, on a detected output loop, but the dispatcher has no way to cancel a running attempt when it sees drift. Separately, an attempt that fails before the drift check, for example with a malformed report, is followed by the next candidate, which spends its own usage on the same changed inputs. [The runtime reference](../internal/runtime/REFERENCE.md) now tells controllers to hold such edits until the result returns. The user chose to track it at triage.

Two sizes of fix: before launching a fallback candidate, check the inputs and stop with `review-input-drift` when they changed, which saves only fallback usage; or poll the inputs during an attempt and cancel it through a new contained cancellation route on both hosts. Size the work by how often drift still occurs once the documented rule is in force. Runtime changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Present a governing spec as a link with a change list

Raised by the user on 2026-09-29 in run `f440497c-a0cc-4375-bada-e834e32b49a6` during the spec review: to make a governing spec and its amendments easier to read, link to the spec file instead of writing it out in a message, clickable in the CLI and in the web app over Remote Control, and let a helper agent apply spec edits so their diffs do not bury the spec. Windows Terminal rendered a relative link as invalid, so the session used absolute `file:///` links and also sent the file for the web app, presenting each revision as a link with a short change list. After acceptance the user said "edit it directly. the helper is not needed at this point, it's mostly useful to reduce noise before the user accepts", and later amendments were edited directly. On 2026-10-01 the user chose to amend the proposed change below to require absolute local targets and line links.

Have the operating brief and revise-spec present a governing spec and each amendment as a link with a concise change list, written with an absolute local target and, where `NIGHTSHIFT_LINE_LINK_FORMAT` is set and non-empty, linking each amendment at its line through it, as [Make Ready and Exploring links open at their target](features/source-link-targets.md) describes for the shared link form, plus a sent copy where the host supports it, and let edits before acceptance be applied by a registered helper that owns only the spec file while the controller keeps every disposition. Settle how this fits the brief's requirement to "present that same complete stable draft for the user's review". Guidance changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

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

Widened at triage on 2026-09-29 to both hosts and to cleanup. The migration accounting audit that night found 19 credential-named files, Claude `.credentials.json` and Codex `auth.json`, retained in ignored `.tmp` fixture profiles from campaigns dated 2026-09-07 to 2026-09-26, beside raw evidence that reports cite; nobody opened them, so whether they were live is unknown. The user chose to delete those retained copies and noted, in their words: "there's an issue where a refreshed token doesn't reach my own profile, which requires me to login again later." A fix therefore also covers the Claude harness copies and removing every credential copy when its fixture ends, so retained evidence never holds one.

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

A second observation on 2026-09-28 in run `f6288235-b263-4394-8f83-4d0474cb6708`, on a larger change (a Windows job runner protocol change with runtime and test code across about ten files, plus documentation): every dispatch's rules named the recorded passing checks (the CI runtime file list, the release tests, the manifest check, a live dotnet check and later the backlog parser check), stated that rerunning those suites as probes adds nothing, and asked for a probe only for evidence the checks could not supply. Across four Codex `gpt-6-astra` assessments (`678cd7c0`, 656,424 tokens; `195d85f0`, 572,295; `1ac2cdd5`, 681,653; `336224cb`, 833,115) and one Claude Fable skeptic (`7a402328`, 312,477), none requested a suite rerun or any probe; the one incomplete return asked for investigation evidence instead. It is still a single run without a control. The user chose at triage to record it here.

A third observation on 2026-09-30 in run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9`, a change of 183 inserted lines across runtime code, tests, guidance and packaging, plus backlog edits: every dispatch's rules again named the recorded passing checks (the runtime suites, the packaging tests, the release manifest and, once recorded, a strict ready parser check and the backlog line check) and said rerunning them as probes adds nothing. None of the eight dispatches, five Codex `gpt-6-astra` code and docs assessments of 661,511 to 1,000,908 tokens each and three Claude Fable skeptics, requested a probe or a suite rerun, and every one returned complete. Still no control. The user chose at triage to record it here.

**Requires:** none.

### Codex sandbox blocks the launcher from starting the host

Observed on 2026-09-19 in every Codex fixture of the handover acceptance campaign (Codex CLI 0.154.0, plugin 3.2.0), recorded in [the acceptance report](reports/handover-transition-and-morning-report-20260919.md). Inside the Codex sandbox the launcher cannot start the host process it inspects, at two sites. Preparation fails with `{"error":"EPERM","message":"spawn EPERM"}` at first use and again in some later sessions of the same, already prepared profile (the new-run handover and refused-admission sessions). Resolving resources through the retained bootstrap fails with `{"error":"retained-bootstrap-unavailable","message":"spawn EPERM"}` in later sessions (new-run handover, in-place handover and refused admission). The resumed returning-user session showed no fresh failure. Each time the model has to request an out-of-sandbox retry. With the escalation approved, preparation is silent and the operation proceeds; with it denied at first use, the Ready report correctly says the parser never ran and does not present an empty backlog. A real Codex user therefore sees approval prompts that work against preparation needing no setup conversation; whether every session prompts, or only the first command of each, was not separately established, because the harness answered these requests automatically. Claude Code shows no equivalent prompt.

Establish whether the launcher can start the host inside the Codex sandbox or avoid doing so on that host at both sites, for example by carrying an earlier result, which [Hook-path native settings resolution cost](#hook-path-native-settings-resolution-cost) already considers. If it cannot, document the approval and how often it recurs in the README installation guidance so the prompt is expected. Verify first use and a later session on an installed Codex host in a fresh profile. Tracking does not authorize implementation.

**Requires:** none.

### Acceptance reports carry a checkable evidence digest

Three lessons from the handover acceptance campaign of 2026-09-18 to 19, recorded in [the acceptance report](reports/handover-transition-and-morning-report-20260919.md). First, the final independent assessor could not verify the report, because all campaign evidence lived in the ignored `.tmp` directory; once a script-generated, credential-free digest (ledger, staged payload hashes, each fixture's saved run history and closing state, verbatim final assistant text) was supplied through `artifactPaths`, it found a real overstatement in the per-host table. Second, copying a host credential into an isolated profile races with token refresh: the production credential refreshed during the first attempt and invalidated the copy, and the reverse order could have logged out production sessions; the harness now copies a Claude credential only with more than three hours of token life left and removes every copy at the end. Third, a handover scenario costs roughly one to two and a half million tokens per host process, almost all of it context re-reading, so the agreed 4,000,000 allowance had to become 16,000,000 mid-campaign.

A second occurrence on 2026-09-28 in run `f6288235-b263-4394-8f83-4d0474cb6708`, outside acceptance reports: a cumulative assessment (Codex `gpt-6-astra`, receipt `195d85f0-7414-4c04-b754-b3d117bf5d55`, 572,295 tokens) found no defect but returned incomplete, because an agreed requirement to investigate flaky tests under load before fixing them rested on results that existed only in the controller's conversation and background task outputs. Once the controller wrote a verbatim evidence record and supplied it through `artifactPaths`, the next assessment was complete and clean. The user chose at triage to add it here and to widen the brief sentence below to any agreed requirement whose evidence is gathered outside recorded checks.

State in the shared brief that evidence backing an agreed requirement that recorded checks do not carry reaches the assessor in the first dispatch as a verbatim evidence record supplied as a selected artifact; for an acceptance report's installed-host claims, that record is a generated evidence digest derived per host from that host's own record. Record the credential-copy guard and the measured per-scenario costs where live budgets are settled, reconciling with [Verify faked boundaries live](features/live-boundary-verification.md), which carries the live-evidence budget and allowance decisions. Decide whether the multi-turn harness retained under `.tmp/handover-live` (drivers for both hosts, scoped approvals, ledger, reconciliation and digest scripts) graduates into the repository's test tooling. Tracking does not authorize implementation.

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

### Expose recorded probe and check results in their responses

Reported on 2026-09-12 from an unattended Claude handover in FeatherPod-Private, run prefix `216f01e8`, plugin 3.0.6. Unlike ordinary lifecycle mutations that return an obligation brief, `probe` then returned the complete `store.update` result. A controller helper expecting `next`, `closing` and summarized workers consequently printed the full worker list and raw closing state. Since 3.2.3 (commit `6b3fdaa`, 2026-09-21) the probe branch of `internal/runtime/cli.js` returns the focused obligation brief like other mutations, which resolved that full-state response, but the brief carries no probe result. Stored probe evidence contains `{path, sha256, snapshotDigest}`, while the command, exit code and output require a separate read of the referenced `result.json`. Evidence in the source project: `.nightshift/runs/reviews/e5be77fd-cdf1-46b9-850f-841524931038/probes/01699ed2-8463-45ca-9df0-dbd5bbc80865/result.json`. Original inbox report: observation 1 of `2026-09-12-probe-returns-full-state-and-foreground-wait-recurrence.md`.

The `check` operation has the same remaining gap, observed on 2026-09-28 in run `a0eaaee7-6c97-4261-960d-346c6a4654aa` on installed 3.2.15: like `probe`, it returns the focused obligation brief, which carries no exit code, output or pass flag, so the controller read every check result through a full `inspect` of run state. The user chose at triage to widen this entry to cover it.

For both probe and check, expose the recorded result in the response clearly enough for the controller to locate and interpret the evidence without inspecting full run state. Settle the result metadata and update the runtime reference and affected consumers together, preserving the saved raw command/output and independent interpretation requirement. Add focused coverage for both response shapes and result references, including a probe and a check whose command exits unsuccessfully. Runtime behavior changes ship with a version increase.

Recurred on 2026-09-30 in run `7969bab6-360c-4bd5-a5bd-33dfe3ef28d9` on installed 3.2.16: each of its eleven `check` operations again returned only the obligation brief, so the controller read every exit code and pass flag through a full `inspect` of run state. The user chose at triage to record it here.

**Requires:** none.

### Agent-directed rules leak into user-facing prose

Reported from a `/ready` run in another project on 2026-09-11 and repaired for that skill in plugin 3.0.4; the pattern is broader than one skill. Skill texts state constraints for the agent, such as readiness not being agreement, a draft not being authorized implementation work, or a previous review not authorizing a narrowed new pass, and agents echo them to the user as stiff rule quotations, for example "Readiness is not a selection". The user wrote these conventions and does not need them restated. Fresh evidence on 2026-09-24 from [the Ready selection campaign](reports/ready-selection-boundary-20260924.md): with the 3.2.4 candidate, the Codex controller told the user in two turns what the Ready skill "says" and "requires" ("The Ready skill says to propose a concrete selection by ready-set number ...", "... requires that nothing is edited before the user agrees that readback"), although the skill states those constraints are guidance for the agent; the Claude controller did not. Evidence: `.tmp/ready-live/codex-work-f3c5d95f/live-2026-09-24T02-19-21-251Z-c-work/events.jsonl`.

Add a shared rule to `internal/workflow.md` that separates agent-directed constraints from user-facing phrasing, sweep all eight skills for constraint sentences that read as user-facing prose and rephrase them as closing offers or actions, and check the result with an installed-host probe, since the behavior is model-owned.

**Requires:** none.

### Documentation and backlog edits land before the first cumulative assessment

Observed in this repository on 2026-09-11 during an unattended run. The agreed outcome committed to archiving two fixed BUGS.md entries, the controller left that for the documentation stage, the first cumulative assessment raised it as a minor finding, and the archive edit then invalidated the review snapshot, so a second full dispatch was needed for a change the reviewer had already covered. The lifecycle places documentation after review, but the runtime requires the cumulative assessment to be fresh at task completion and any tracked-file edit invalidates it, so every documentation or backlog edit made in that stage forces a reassessment. `internal/workflow.md` "Close and report" currently reads as if those edits belong after review. Since the local 3.2.16 candidate, a backlog-only edit in that stage is covered by the docs review the task now needs, so the forced code reassessment remains for other documentation edits on a task under code assessment.

Add one sentence to the brief, under Durable execution or Review and repair, stating that documentation, skill text and backlog closure the agreed outcome commits to are part of implementation and land before the first cumulative assessment, so the documentation stage only records evidence and a reassessment is needed only when findings change files; mirror it in `skills/handover/SKILL.md` if the handover text implies the later ordering. Shipped text changes model-owned behavior, so it rides with the next version increase.

**Requires:** none.

### Test that resumed dispatches keep the limit refusal codes

Found on 2026-10-01 in run `edb0199e-f5f3-4fab-a55f-8fa909a08289` by a skeptic during the code review of [Resumable reviewer and adversarial repair dialogue](features/resumable-reviewer-dialogue.md). Its governing spec lists non-session failures keeping their codes among the deterministic evidence, but `tests/runtime-resume.test.js` has no resumed-dispatch case for the run-deadline, operation-window or dispatch-allowance refusals (`resource-limit`, `operation-time-limit`). They are raised before a host starts and listed among the session-independent failures in `internal/runtime/review.js`, so this is missing evidence, not a known defect.

Add resumed-dispatch tests showing that each refusal keeps its code rather than becoming `resume-failed`. A test-only change needs no version increase. Tracking does not authorize implementation.

**Requires:** none.

### Name the limit that capped a review attempt

Found on 2026-10-01 in run `edb0199e-f5f3-4fab-a55f-8fa909a08289` by a probe during the code review of [Resumable reviewer and adversarial repair dialogue](features/resumable-reviewer-dialogue.md). When the run deadline or the launcher operation window shortens a review attempt and the attempt then times out, its failure says only that the attempt timed out or the host closed; neither the message nor the attempt evidence names the limit, and the Codex runner, which throws when the host closes, leaves no timed-out record. A resumed attempt cut this way is reported as `resume-failed`, which the governing spec allows because it counts an attempt timeout as a session failure; the finding that it should keep a limit code was refuted.

Record which limit capped an attempt in its failure message and evidence on both runners, including a timed-out record on the Codex runner, without changing the classification. Runtime changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Say that an unparseable receipt counts as none

Found on 2026-10-01 in run `edb0199e-f5f3-4fab-a55f-8fa909a08289` by the final docs review of [Resumable reviewer and adversarial repair dialogue](features/resumable-reviewer-dialogue.md), confirmed by a skeptic and deferred to triage. [Its acceptance report](reports/resumable-reviewer-dialogue-20261001.md) (twice), [the runtime reference](../internal/runtime/REFERENCE.md) and the comment on `dispatchReceipt` in `internal/runtime/continuation.js` say a receipt that cannot be read counts as none. The code treats only a missing, unparseable or non-object receipt that way and lets other read errors surface, which is the cautious behavior.

Narrow the wording to a receipt that cannot be parsed in all four places, or fold it into the next change that touches them. The reference and the code comment ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

### Have revise-code trace the readers of state a repair changed

Found on 2026-10-01 in run `edb0199e-f5f3-4fab-a55f-8fa909a08289`, from the independent review of that run's retrospective proposal. The user approved a `~/AGENTS.md` rule: before a repair batch is declared done, when it changed which record, status or case a decision or obligation reads, list every reader and writer of that state and every form it can take, and on a second missed case fix the property the decision keys on. Two repairs in that run each broke a reader nobody traced. [revise-code](../skills/revise-code/SKILL.md) is read at exactly that moment and already asks for the shared cause after repeated related findings, but says nothing about the controller tracing readers and writers before closing a batch, and a global rule reaches only this user.

Add that habit as one clause to revise-code and the matching sentence of [the operating brief](../internal/workflow.md). Skill and guidance changes ship with a version increase. Tracking does not authorize implementation.

**Requires:** none.

## History

Prior delivered work remains in [QUICK_WINS_HISTORY.md](QUICK_WINS_HISTORY.md).
