# Handover transition, acknowledgment and morning report: acceptance evidence

## Status and scope

This report records the evidence for plugin 3.2.0, which implements [the governing spec](../specs/handover-transition-and-morning-report.md): an in-place `handover` of a run already underway, an unmistakable acknowledgment, and a morning report that is a recorded closing stage whose delivery is runtime state. It resolves "Handover omits the morning report", "Handover leaves existing runs in attended mode" and "Acknowledge accepted handovers clearly". Work ran as attended self-hosting run `d4a44daa-96be-4ac4-bcaa-d16d8596584f`, controlled by Claude Code with `claude-fable-5-1`. Nothing is published and publication is not authorized.

Installed-host evidence exists for the core claims on both hosts. Three items stay qualified and are listed under Qualifications; they are not claimed as verified.

## Implementation and independent assurance

The governing spec received five whole-spec assessments by `gpt-6-astra` on Codex, each strong, independent and broad. Fourteen findings were confirmed by fresh `claude-fable-5-1` skeptics and repaired in four batches; the single fifth-pass finding was refuted with evidence and needed no edit. During that review the user chose recorded report delivery over untracked delivery, and directed that continuity across sessions come from resuming the run, never from pointing the user at report files.

The implementation received three code assessments by `gpt-6-astra`. The first two returned incomplete and asked for execution evidence. An observation fixture proposed by the first exposed three real gaps, which were fixed before re-dispatch: a run created unattended stays blocked after a mechanism-less handover, so an unverifiable handover now starts attended; the SessionStart notice used one wording for every state; and a still-running handed-over run received no notice. The third assessment completed with no findings after reading two private-copy probes. One probe passed 49 cases. The other failed 39 cases with git's `Filename too long`, because `tests/runtime-review.test.js` and `tests/runtime-probes.test.js` nest review copies inside an already deep probe copy; that is the tracked defect "Private review copies fail at Windows path depth", and the same suites pass at checkout depth in the recorded check on the same bytes.

Deterministic coverage is `tests/runtime-handover.test.js` (15 cases) with adjusted fixtures in `tests/runtime-hooks.test.js` and `tests/runtime-regressions.test.js`. At the time of the clean assessment 113 runtime cases and 20 packaging and release-gate cases passed, the release gate reported 3.1.1 to 3.2.0, and the payload manifest verified.

After the clean code assessment, installed-host evidence led to one more shipped-text change, described under Codex deviation below, and the user raised the live-verification allowance, which the spec now states. Both are covered by the final cycle recorded in the run, not by the assessments described above: a sixth whole-spec assessment, three further code dispatches (the first incomplete for want of campaign evidence, the second complete with one finding once an evidence digest was supplied, the third clean after that finding was repaired) and one skeptic round that confirmed the finding.

## Installed-host evidence

Environment: Windows 11, Node v22.23.2, PowerShell 7, Claude Code 2.1.277 with `claude-fable-5-1`, Codex CLI 0.154.0 with `gpt-6-astra`. Each host ran the staged 3.2.0 payload as an installed plugin in an isolated profile with its own retained store and a tiny fixture project holding one quick win. Claims below were read from each fixture's own `state.sqlite` history and native transcript, not inferred from the model's prose. Fixtures are snapshots of the payload at staging time: scenario 1 on both hosts ran before the final-message text was tightened, and scenario 2, refused admission and the attended readout ran after it.

| Claim | Claude Code | Codex |
| --- | --- | --- |
| First use is silent, registers hooks, and Ready runs the bound parser | Observed | Observed after one harness defect, below |
| A fresh session records a native activation and the runtime admits it | Observed | Observed, with hook trust set by the harness |
| New-run handover is recorded with the user's words as authority | Observed, created unattended with the record at revision 0 | Observed, created attended then `handover` without a mechanism |
| Acknowledgment follows the recorded operation, names the failed prerequisite and its consequence, and says a report will be waiting | Observed | Observed, close to the shipped wording |
| Continuation evidence states its own limit | Observed: Stop blocking not separately seen, no goal tool in headless mode | Observed: native goal active, Stop enforcement unobserved, run stays attended |
| Interrupted before the report and resumed with the user away, without loss or replay | Observed across two interruptions | Not staged |
| Closing order retrospective, report, triage, complete, with follow-ups pending | Observed | Observed in scenario 2; scenario 1 closed blocked, below |
| Final message is the self-contained report ending with the first follow-up as a question | Observed | Deviated in scenario 1, observed in scenario 2 after the text fix |
| SessionStart notice on a completed handed-over run | Observed | Not separately captured |
| A changed report file is flagged stale, rewritten and recorded again before presentation | Observed (`complete, report, report-delivered`) | Not staged |
| The report is re-presented from the saved file for a user whose terminal was cleared | Observed in full | Observed in condensed form, scenario 1 |
| One reply records both delivery and the first decision, then the next follow-up is asked | Observed | Observed |
| Resumed engineering clears the report and its delivery, and closing is redone | Deterministic only | Observed (`report-delivered, unblock, ..., report, triage, complete, report-delivered`) |
| A denied approval becomes a capability blocker, is never bypassed, and the report is still recorded | Not staged | Observed |
| In-place handover of an attended run with an active registered worker, same run, nothing else changed | Observed, one `handover`, mode attended to unattended | Observed, mode stays attended with the limitation named |
| No repeated readback at handover | Observed | Observed |
| Repeated handover keeps the original record | Observed, revision 3 retained | Observed, revision 3 retained |
| Unattended Stop hook resists a premature yield and releases after three reminders | Observed: three `continuation-reminder` entries | Not applicable, run stayed attended |
| Refused admission: nothing recorded, handover not accepted, concrete recovery named | Not staged | Observed: no run state, "approve the Nightshift hooks ... then reopen this session" |
| A run without a handover keeps two-stage closing and ends by listing loose ends | Observed: "no morning report is due", uncommitted files and the pending follow-up listed | Not staged |

### Codex deviation and its repair

In Codex scenario 1 the controller ended with a summary and "The morning report is saved in this session" instead of presenting the report, and on the user's return it presented a condensed version. The user's direction is that a user is never pointed at report files. `internal/workflow.md` and `skills/handover/SKILL.md` were tightened to say that the final message is the full report itself, never a summary or a pointer to where it was saved, including when a run closes blocked. Codex scenario 2, staged from the tightened payload, ended with the report in the specified order and the first follow-up as a question. The returning-user presentation on Codex was not re-run after the fix.

### Observations for triage

These came out of the campaign and are not defects of this change. The Stop hook resisted a pause that a still-present user had asked for, because the run had just become unattended; the controller held correctly through three reminders, but a user-requested hold after handover is only permitted when recorded as a user decision. On Codex the launcher cannot start the host inside the sandbox: the native host inspection fails with `spawn EPERM` at first use, and the retained bootstrap fails the same way when resolving resources in later sessions of the same profile, each needing an escalation, which works against silent preparation on that host. The Codex Ready report asked whether to take the single item without an explicit recommendation, matching the tracked defect "Ready reports omit actionable recommendations". The Codex refused-admission answer quoted the skill's own instruction to the user, matching the tracked quick win about agent-directed rules leaking into prose. A fixture whose Git had no author email led the Claude controller to supply the account email for one local fixture commit, while Codex left the change staged and reported it.

### Harness

The retained single-turn harness was extended under `.tmp/handover-live` with multi-turn drivers for both hosts, scripted user replies, real session reopening (`--resume` on Claude, `thread/resume` on Codex), scoped automatic tool approvals confined to the fixture directory with credential-shaped input always denied, a fifteen-second bound on unapproved calls, and a token ledger. Two harness defects affected evidence and are disclosed: a path check that split a quoted `C:\Program Files` path declined a legitimate Codex escalation, costing one failed first-use attempt; and a verb check declined a confined PowerShell command that began with an expression, which produced the capability blocker in Codex scenario 1. That blocker was therefore induced by the harness, though the controller's handling of it is genuine evidence. Codex hook trust was set by the harness writing each listed `currentHash` as `trusted_hash` in the disposable profile's `config.toml`, which is how that host records a user's trust; neither the plugin nor a real user granted it.

Copying credentials into isolated profiles carries a hazard the previous campaign shared. During the first Claude attempt the production credential refreshed and rotated its refresh token, which invalidated the fixture copy; had the fixture refreshed first, production sessions could have been logged out. The harness now copies a Claude credential only while its access token has more than three hours left and refuses to start a process that could outlive it. All six credential copies were removed at the end and their absence verified. No production profile was changed.

## Qualifications

The busy-dispatch path, in which a bound `handover` is refused with `resource-operation-busy` while a runtime dispatch holds the lease and the controller waits and retries, has deterministic and documentary coverage only; staging it needs a real in-flight review dispatch inside a fixture, which the remaining allowance could not cover. The stale-report variant and the interrupted-then-resumed handover were observed on Claude only. Claude scenario 2 reached `handover, continuation-reminder x3, handover, worker-finished, start-task` and was stopped at its token ceiling before closing; Claude closing is evidenced by scenario 1. Headless Claude exposes no native persistent goal, so the Claude evidence uses the registered hooks as the continuation mechanism. The governing spec's second pass of scenario 2 is therefore not met on either host, and its second pass of scenario 1 is met on Claude only.

## Budget

The user first agreed 4,000,000 aggregate live-verification tokens. Measured handover scenarios cost roughly one to two and a half million tokens per host process, almost all of it cache re-reads of a growing controller context, so spending stopped at 2,480,811 and the decision went to the user, who raised the allowance to 16,000,000 on 2026-09-19. Final ledger in `.tmp/handover-live/budget.json`: 14,445,999 used and 192,000 reserved for three interrupted in-flight responses, 14,637,999 against 16,000,000. Interrupted attempts were reconciled against the host's persisted native transcript; one reconciliation briefly double-counted a resumed session because the transcript spans the whole session, and was corrected before any spending decision relied on it. Independent assessments are outside this allowance. Summed from the run's review receipts, they totalled 10,463,681 tokens across the thirteen dispatches before the final cycle and 14,869,844 across all eighteen (six spec, six code and six skeptic dispatches).

Raw transcripts, approval decisions, fixture stores and the ledger remain under `.tmp/handover-live`. Review receipts and probes belong to run `d4a44daa-96be-4ac4-bcaa-d16d8596584f`.
