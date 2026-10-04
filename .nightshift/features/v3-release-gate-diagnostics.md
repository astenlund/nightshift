---
name: v3-release-gate-diagnostics
description: Complete release-gate history diagnostics and checkout verification
metadata:
  type: feature
---

# Complete release-gate history diagnostics and checkout verification

Finish the retained release-gate follow-ups for stale-branch versus genuine version decreases and robust verification of required checkout depth. Preserve current release policy and avoid reviving obsolete assertion shapes.

## Selected outcome

The non-ASCII Git path issue now has a NUL-delimited reader and a real-Git regression. The other two retained outcomes still need explicit accounting: an accurate history-based diagnosis and a checkout/depth check that tolerates benign action-version or input-order edits.

## Evidence and limits

`tools/release-gate.js` compares baseline and HEAD versions and emits a generic decrease message. CI currently has fetch-depth: 0, but current package tests do not check that requirement. The old brittle release-surface test was removed rather than repaired.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Settled questions

The user agreed these answers on 2026-10-04, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day in `tools/release-gate.js`: `evaluateRelease` compares only the baseline and HEAD snapshots, through a two-dot `git diff` and the two manifests, and reports any lower HEAD version as `Version decreases from X to Y`; the pre-push path confirms the baseline commit is present (`requireLocalCommit`) and asks for a fetch, while the CI path, which `.github/workflows/ci.yml` runs with the pull request's base or the push's previous commit as the baseline, reaches `git diff` and fails with Git's own error when the baseline is missing. The original v2 wording of both follow-ups is in [the historical quick wins](../migration/v2/QUICK_WINS.md#release-gate-follow-ups).

- The exact history semantics and the pass/fail policy. Settled: pass/fail stays as it is. The gate still compares HEAD with the baseline, and a lower version still fails; only the diagnostics change.
- How a stale branch is told apart from a genuine decrease. Settled: when the baseline is not an ancestor of HEAD, every failure leads with a note that the branch is behind the baseline, which moved from the merge base's version to its own since the branch forked, that the changed-file list includes the baseline's newer changes, and that the branch should integrate the baseline and rerun. A decrease is reported as genuine only when HEAD's version is lower than its merge base's, or when the baseline is an ancestor of HEAD.
- How the required checkout depth is verified. Settled: the CI path confirms the baseline commit is present before comparing, as the pre-push path already does, and when it is missing the failure names the checkout's fetch depth as the likely cause. This replaces v2's pinned workflow lines: it checks the history the gate actually needs, so a benign workflow edit, such as a new action version or reordered inputs, cannot trip it and a real depth regression cannot pass it. When shallow history hides the merge base, the stale-branch note says so rather than guessing.
- The existing unusual-path regression. Settled: the test that non-ASCII shipped paths are not hidden by path quoting stays.

## Before implementation

The change is repository tooling and tests, outside the shipped plugin, so it needs no plugin version increase, and an agreed readback is enough. Fixtures in `tests/release-gate.test.js` cover a genuine decrease, a stale branch with and without shipped changes, a missing baseline on the CI path, and shallow history without a merge base, beside the existing cases. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Let the fetch-depth pin fail honestly on a benign checkout edit](../reports/v3-migration-followups-20260920.md#let-the-fetch-depth-pin-fail-honestly-on-a-benign-checkout-edit).
- [Name the stale-branch case in the version gate's decrease message](../reports/v3-migration-followups-20260920.md#name-the-stale-branch-case-in-the-version-gates-decrease-message).

[The migration decision](../../V3-MIGRATION.md#release-gate-accuracy) preserves the surviving requirement. Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
