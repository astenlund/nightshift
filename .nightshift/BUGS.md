# Bugs

V2 entries are preserved in [the historical index](migration/v2/BUGS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Fable-only acceptance gate rejects supported worker roles

Minor issue in the temporary acceptance-test harness, tracked on 2026-09-10 for repair when that harness is reused. `verifyFableAssessors` in `.tmp/v3-fable-assessor-policy.cjs` accepts only reviewer and skeptic workers, so a permitted implementer, supervisor or reviewer peer can incorrectly fail a case. Completed MVP cases were unaffected; the Nightshift runtime supports these roles.

Reconcile the gate with the staffing permitted by the test scenario while retaining applicable host/model restrictions. Add focused controls for permitted roles and rejected models before reuse. Preserve historical case evidence. The original diagnosis and reproduced implementer rejection are in `.tmp/fable-allocation-review-f4c6f3c6-7ae5-4248-b938-ed7bb5e14fc7/audit/report.md` and its `private/fable-policy-probe.json`.

**Requires:** none.
**External:** User decision to reuse the temporary acceptance harness.

### Temporary acceptance controls are unsafe to rerun in place

Minor test-infrastructure issue, tracked on 2026-09-10 for repair before these controls are reused. In `.tmp/v3-fable256-preparation/controls`, `start-order-control.cjs` writes its generated helper and result beside itself, so an in-place rerun can overwrite saved evidence. `docs-diff-assessment.cjs` compares against the current Git HEAD, so committing the assessed changes makes its original check fail on an empty diff.

Give retained controls explicit output locations and fixed input baselines, with focused checks that reruns preserve earlier artifacts and evaluate the intended change. Until then, use private copies and preserve the recorded results. The historical verdicts remain supported; this is a reuse limitation. Evidence: `.tmp/fable-allocation-review-f4c6f3c6-7ae5-4248-b938-ed7bb5e14fc7/audit/report.md` and its `private/tests/start-order-control.json`.

**Requires:** none.
**External:** User decision to reuse the temporary acceptance controls.

### Compaction/resume acceptance harness needs precision repairs

Minor test-infrastructure follow-up, tracked on 2026-09-10 for recheck and repair before harness reuse. A review of `.tmp/v3-claude-pressure-resume.cjs` and its preparation material recorded five issues: an incorrect grant-path instruction, overstated preflight coverage, incomplete hash binding of closed-segment artifacts, non-malformed stops labeled as malformed evidence, and a monitoring race that can misclassify a successful completion. The last two issues did not change the recorded token charge basis.

Reconcile these findings against the retained versions before changing anything. Align instructions and coverage claims with actual launch checks, make retained evidence dependencies explicit, and distinguish stop causes and successful completion accurately. Add focused model-free controls for whichever defects remain. Preserve the original artifacts and accepted case qualifications; do not replay completed native cases merely to tidy their reports. Evidence: `.tmp/fable-pressure69-review-241e0b96-348a-4894-ba82-85da528ab537/audit/report.md`, including its reviewed hashes and deciding controls.

**Requires:** none.
**External:** User decision to reuse the temporary compaction/resume harness.

### Directory ignore probe can misreport tracked backlog directories as ignored

Reported from an init-backlog run in another project on 2026-09-11. The original reproduction is unverified; a deterministic trigger found later is recorded at the end of this paragraph. `inspect` reported `.claude/features`, `.claude/bugs` and `.claude/patterns` as ignored although all three held tracked files. `Setup.inspect` and `Setup.preservePolicies` (`internal/setup.js`) derive that flag from `git check-ignore --no-index -q -- <dir>/`. While the failure was live on git 2.55.0.windows.3, that command reported a match on a blank `.gitignore` line for every directory in the tree, a copied `.gitignore` reproduced it in a fresh probe repository, and deleting any single line cleared it; the same probe without `--no-index` or without the trailing slash answered correctly. Forty-five minutes later the identical bytes no longer triggered it anywhere, so no deterministic trigger was known at that point. On 2026-09-11 a second probe in this repository reproduced it deterministically: with a CRLF root `.gitignore` containing a blank line, trailing or interior, `git check-ignore --no-index --verbose -z --stdin` reported that empty line (pattern `''`) as matching every directory path given with a trailing slash (`.claude/bugs/`, `.claude/plans/`, tracked `.claude/features/`), while file paths in the same call were unaffected and the same content with LF endings did not trigger it. Under that trigger, consulting the index but keeping the trailing slash still misreports the untracked directory; only dropping the trailing slash answers correctly for both. The probe shape is recorded in the breakout file. Apply wrote no spurious rules only because the destination probe returned the same false positive; had it cleared between the source and destination checks, the tool would have ignored the new backlog directories while the migrated tracked files still passed the final tracking check.

Treat this as a robustness gap: classify a directory containing tracked files as visible regardless of the probe result, avoid the `--no-index` plus trailing-slash combination, and add a fixture asserting that a directory with tracked children is never reported as ignored. The full observation record is in [`bugs/init-backlog-check-ignore-directory-false-positive.md`](bugs/init-backlog-check-ignore-directory-false-positive.md).

**Requires:** none.

### Auto-mode classifier denies the runtime CLI

Observed on 2026-09-11 in this repository under Claude Code auto mode while starting an explicitly handed-over run. `node internal/runtime/cli.js <project> <request.json>` with a `create` request was refused by the auto-mode permission classifier twice, first as "Unauthorized Persistence" when chained with the `continuation` and `status` calls, then as "Instruction Poisoning" on its own. The request described an unattended run, hooks-based continuation and the controller session binding, which appears to read as a persistence or injection attempt. Without the create step no lifecycle operation can run, so an auto-mode controller cannot start, review, close or resume a run; the user had to run the create manually.

Establish which part of the invocation triggers the classifier (the CLI path, the request prose, or the chained calls) with a reproducible probe, then decide between documenting a permission rule for auto-mode users in the README and skills, restructuring the request or invocation so routine run operations are not misclassified, or both. Treat the denial as a capability blocker in the handover skill until then, so a controller reports it instead of retrying.

**Requires:** none.
**External:** Claude Code auto-mode classifier behavior that the plugin cannot change.

### Unattended Stop hook blocks yielding to a present user for a blocking decision

Observed on 2026-09-11 in this repository during an unattended self-hosting run. With the single task blocked on a user-decision, no workers active and the user present in the interactive session, the Stop hook kept resisting the controller yield, so the controller could not end its turn to ask the question; it had to record the session closing first to obtain a turn, and later used the host question tool to avoid yielding at all. The hook is documented as resisting premature yields while actionable work, final reconciliation or workers remain, which was not the case, and after three consecutive reminders without a runtime transition it would have ended continuation with an incomplete-recovery report.

In unattended mode, permit the yield when every remaining blocker is a user decision, the next list is empty and no workers are active, with a reminder that says the run is waiting on the user; keep resisting in every other state. Add a hook fixture for that state and for the states that must still resist. This changes `internal/runtime/hook.js`, so it ships with its own version increase. Sibling of [Unattended Stop hook blocks yielding while a background dispatch runs](#unattended-stop-hook-blocks-yielding-while-a-background-dispatch-runs), where the hook resists a yield the controller needs in order to await a running dispatch worker; design the two permitted states together.

**Requires:** none.

### Unattended Stop hook blocks yielding while a background dispatch runs

Reported from an unattended handover run in another project on 2026-09-11 (Claude Code 2.1.268, Windows). Each review or skeptic dispatch ran two to eight minutes. The controller launched it through the host background-process facility, as `internal/runtime/REFERENCE.md` prescribes for long dispatches, whose completion notification only arrives after the controller ends its turn, but in unattended mode the Stop hook resists that yield with a continuation reminder while actionable work remains, and three reminders without a runtime transition end continuation, so waiting for a dispatch by yielding would have spent the reminder budget on every dispatch. The controller improvised a Node poller in the scratch directory that exits when the dispatch redirect file becomes non-empty and ran it in the foreground under a ten-minute tool timeout after each background dispatch; it worked for six dispatches, but the runtime reference describes no such pattern, so every controller has to rediscover it. Sibling of [Unattended Stop hook blocks yielding to a present user for a blocking decision](#unattended-stop-hook-blocks-yielding-to-a-present-user-for-a-blocking-decision): both are the hook resisting a yield the controller needs, but that entry's permitted state, no workers active, still resists here, where the running dispatch worker is the reason to wait.

Give the controller one documented, supported way to wait for a background dispatch inside an unattended turn: a hook exception while a registered dispatch worker is running and nothing else is actionable, guidance to run the dispatch in the foreground with the tool timeout raised and its tradeoffs stated, which amends the reference's background-facility instruction, or a runtime wait operation. Record the chosen mechanism in `internal/runtime/REFERENCE.md` and `skills/handover/SKILL.md`; if the hook changes, add fixtures for the permitted state and for the states that must still resist, designed together with the sibling's, and ship with a version increase.

**Requires:** none.

## History

Prior delivered work remains in [BUGS_HISTORY.md](BUGS_HISTORY.md).
