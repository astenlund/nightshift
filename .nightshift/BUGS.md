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

### Published version surfaces can drift on release

Release-process defect observed on 2026-09-11 while publishing plugin 3.0.1. Both plugin manifests were increased in `a4e4ee8` and the packaging test confirmed they were equal, but the README status line still announced 3.0.0 as the published version when the push landed and needed the follow-up commit `9d26ded`. A third surface is still drifted: `internal/runtime/hosts.js` sends `clientInfo.version` `3.0.0` in the Codex app-server initialize handshake, unchanged since `8ca3cb4`, so the shipped plugin identifies itself to Codex with the wrong version. Nothing mechanical ties either surface to the manifests, and no deterministic check confirms that a batch changing shipped plugin behavior carries a version increase over upstream at all; both rules currently rest on agent recall.

Add deterministic coverage so no plugin-altering change can be pushed without a version increase and every version surface moves with the manifests: assert in the packaging test that the README status version equals the manifest version, make the Codex handshake read its version from the manifest at runtime or assert it in the same test, and add a check that fails when bundled non-test paths under `skills`, `internal` and `hooks` or non-version manifest fields differ from the published baseline without a version increase. That last check must run before publication (a pre-push gate or a pull-request job), since a CI run on the pushed `main` has no diff against itself. Keep the existing equal-manifest assertion. Correcting the handshake version is itself a shipped-behavior change and needs its own version increase. Evidence: commits `a4e4ee8`, `9d26ded` and `8ca3cb4`, and `internal/runtime/hosts.js`.

**Requires:** none.

## History

Prior delivered work remains in [BUGS_HISTORY.md](BUGS_HISTORY.md).
