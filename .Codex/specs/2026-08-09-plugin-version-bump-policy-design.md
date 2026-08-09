# Plugin Version Bump Policy Design

Status: signed off 2026-08-09

## Goal

Prevent shipped Nightshift plugin changes from remaining in an unpushed local batch without a corresponding plugin version increase. The current review-phase workflow batch must move the plugin from `2.0.24` to `2.0.25`.

## Policy

Every unpushed batch that changes shipped plugin behavior must contain exactly one monotonic version increase in `.claude-plugin/plugin.json`. One version increase covers the complete batch, including later fix commits made before it is pushed.

Shipped plugin behavior consists of:

- `commands/**`
- `skills/**`, excluding files whose names end in `.test.js`
- `hooks/**`
- every `.claude-plugin/plugin.json` field other than `version`

Repository-only documentation, tests, CI configuration, marketplace metadata, and repository guidance do not independently require a version increase.

## Changes

Update `.claude-plugin/plugin.json` from version `2.0.24` to `2.0.25`.

Update `AGENTS.md` so the repository convention describes the policy above as a required part of every unpushed plugin-change batch, not only as a release-time action. Keep the existing rule that pushing remains user-directed and that the updater observes the `plugin.json` version field.

No CI guard, helper script, test, hook, marketplace change, or release push is included.

## Verification

- Parse `.claude-plugin/plugin.json` as JSON and verify its version is exactly `2.0.25`.
- Verify the old release-only wording is absent from `AGENTS.md`.
- Verify the new policy names every included and excluded surface without contradiction.
- Run `git diff --check` over both changed files.
- Confirm the final commits remain on `main`, the index is empty, and no push occurred.

## Commit structure

Create one atomic documentation commit for the policy and one atomic metadata commit for the version increase. The policy commit does not itself alter shipped plugin behavior, while the metadata commit closes the outstanding version requirement for the already-committed plugin changes.
