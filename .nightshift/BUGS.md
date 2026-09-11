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

## History

Prior delivered work remains in [BUGS_HISTORY.md](BUGS_HISTORY.md).
