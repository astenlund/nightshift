# Bugs

V2 entries are preserved in [the historical index](migration/v2/BUGS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Release status check requires an unpublished candidate to claim publication

Observed in this repository on 2026-09-12 while changing the ready skill. Both manifests were bumped from published 3.0.10 to candidate 3.0.11, and README.md truthfully described the candidate as in development. The shared README_STATUS expression in tools/release-gate.js accepts only the literal published-on-main wording. tests/package.test.js therefore fails on the working tree, and evaluateRelease rejects the same content once committed, even though all three version numbers agree. This unnecessarily couples version consistency to a claim that publication has already happened and stalls ordinary local verification.

Allow truthful candidate and published status while preserving manifest equality, monotonic release version checks and README version consistency. Cover accepted statuses and mismatched or missing versions with deterministic fixtures, and reconcile the packaging assertions and status documentation so local preparation does not require a false publication claim. The current presentation change can be probed independently; this defect remains a release-preparation check failure until repaired.

**Requires:** none.

### Retained v3 continuation needs lack actionable backlog visibility

Observed in this repository on 2026-09-12 when ready reported ten ready entries after a migration of 122 original work units. The migration ledger records 39 retired proposals and 83 retained needs, but marks retained needs as consolidated rather than individually distinguishing delivered work from unfinished work. FEATURES.md points to an Exploring V3 continuations umbrella, whose record sends other surviving needs back to the migration ledger. The ready parser reads active indexes, so retained needs represented only in that ledger cannot appear as individually actionable work. Consolidation is explicitly not delivery; the number of unfinished retained needs has not yet been established.

Reconcile every retained need in MIGRATION_STATUS.md and V3-MIGRATION.md against MVP implementation and acceptance evidence. Restore unfinished needs to active tracking with explicit readiness, dependencies or unsettled design decisions, preserving useful grouping and source traceability. Record delivery only where evidence supports it, preserve retirement separately, and keep indexes and breakout records consistent. Verify the resulting visibility with the actual ready parser; do not promote all retained needs to ready automatically.

**Requires:** none.

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

### Windows job pipe and containment fixtures fail outside the code they cover

Observed on 2026-09-12 in this repository on Windows 11 with Node v26.6.0 while running the deterministic suite for an unrelated runtime change. In `tests/runtime-hosts.test.js`, the `--no-input-leaf` case of "Windows pipes keep output and cancellation live while stdin is pending" fails deterministically, also on a checkout without the unrelated change: the test writes 256 KiB to a child that reads no input and kills it after 500 ms, and the assertion that the job emptied fails with the collected error `write EOF`. The case "Windows job containment carries the actual host protocol and proves descendants have ended" fails only when the whole CI file list runs in one `node --test` invocation: the `descendant` fixture's `descendant.pid` does not exist when the test reads it after a 2.5 second timeout, and the same case passes when the file runs alone. Both cases are skipped off Windows, so CI on `windows-latest` is where they can surface.

Establish whether the `write EOF` comes from the job runner closing the child's stdin before the 256 KiB write drains under Node 26, or from a Node change in pipe semantics, and make the fixture assert the intended containment property rather than the incidental write outcome; give the descendant fixture a start-up signal or a longer budget so the containment case does not depend on scheduler load. Evidence: full-suite run and isolated reruns on 2026-09-12, recorded in the session that shipped the unattended wait and pause change.

**Requires:** none.

## History

Prior delivered work remains in [BUGS_HISTORY.md](BUGS_HISTORY.md).
