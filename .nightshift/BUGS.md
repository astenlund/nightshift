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

### Init-backlog flags non-document files that mention unmigrated `.claude` paths

Reported from an init-backlog run in another project on 2026-09-11. `inspect` listed a shell script under `referenceDecisions` and `apply` refused to run until it was classified, although the script only mentioned `.claude/` paths that were not part of the migration and `rewriteReferences` with the run's actual move list left its bytes unchanged. In `Setup.referenceDecisions` (`internal/setup.js`), the branch for files outside the Markdown, JSON, TOML and YAML set pushes the file whenever it is not declared as an active reference or the rewrite would be a no-op, so the byte-level check never clears an undeclared file; the only way through was an `excludeReferences` or `historicalReferences` entry and a rerun of inspect.

Flag a non-document file only when it mentions a migrated path or the rewrite would change its bytes, and it is not declared as an active reference; keep flagging a declared active file whose rewrite is a no-op, since that is how a consumer with a computed or unsupported path literal is surfaced. Add a fixture with a script that references an unmigrated `.claude/` path and expect no decision.

**Requires:** none.

### Init-backlog translates every `.claude/` ignore rule into a `.nightshift/` twin

Reported from an init-backlog run in another project on 2026-09-11. After apply, `.gitignore` gained a "Nightshift migrated ignore rules" block containing `.nightshift/superpowers/`, `.nightshift/skills/`, `.nightshift/commands/` and a lock-file rule, all mirrors of host-side paths under `.claude/` with no `.nightshift/` counterpart, and the block header was appended directly after the previous last line. `Setup.preservePolicies` (`internal/setup.js`) translates every non-comment line containing `.claude/` with a plain replacement without checking whether the rule matched anything that moved. The user removed the wrong rules by hand.

Translate a rule only when it matches a migrated file or an owned directory, and emit a blank line before the block header when the existing content does not end with one. Add a fixture whose legacy `.gitignore` mixes migrated and host-only `.claude/` rules.

**Requires:** none.

### Directory ignore probe can misreport tracked backlog directories as ignored

Reported from an init-backlog run in another project on 2026-09-11. The reproduction is unverified. `inspect` reported `.claude/features`, `.claude/bugs` and `.claude/patterns` as ignored although all three held tracked files. `Setup.inspect` and `Setup.preservePolicies` (`internal/setup.js`) derive that flag from `git check-ignore --no-index -q -- <dir>/`. While the failure was live on git 2.55.0.windows.3, that command reported a match on a blank `.gitignore` line for every directory in the tree, a copied `.gitignore` reproduced it in a fresh probe repository, and deleting any single line cleared it; the same probe without `--no-index` or without the trailing slash answered correctly. Forty-five minutes later the identical bytes no longer triggered it anywhere, so no deterministic trigger exists. Apply wrote no spurious rules only because the destination probe returned the same false positive; had it cleared between the source and destination checks, the tool would have ignored the new backlog directories while the migrated tracked files still passed the final tracking check.

Treat this as a robustness gap: classify a directory containing tracked files as visible regardless of the probe result, avoid the `--no-index` plus trailing-slash combination, and add a fixture asserting that a directory with tracked children is never reported as ignored. The full observation record is in [`bugs/init-backlog-check-ignore-directory-false-positive.md`](bugs/init-backlog-check-ignore-directory-false-positive.md).

**Requires:** none.

### Auto-mode classifier denies the runtime CLI

Observed on 2026-09-11 in this repository under Claude Code auto mode while starting an explicitly handed-over run. `node internal/runtime/cli.js <project> <request.json>` with a `create` request was refused by the auto-mode permission classifier twice, first as "Unauthorized Persistence" when chained with the `continuation` and `status` calls, then as "Instruction Poisoning" on its own. The request described an unattended run, hooks-based continuation and the controller session binding, which appears to read as a persistence or injection attempt. Without the create step no lifecycle operation can run, so an auto-mode controller cannot start, review, close or resume a run; the user had to run the create manually.

Establish which part of the invocation triggers the classifier (the CLI path, the request prose, or the chained calls) with a reproducible probe, then decide between documenting a permission rule for auto-mode users in the README and skills, restructuring the request or invocation so routine run operations are not misclassified, or both. Treat the denial as a capability blocker in the handover skill until then, so a controller reports it instead of retrying.

**Requires:** none.
**External:** Claude Code auto-mode classifier behavior that the plugin cannot change.

## History

Prior delivered work remains in [BUGS_HISTORY.md](BUGS_HISTORY.md).
