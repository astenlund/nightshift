# New setup templates ignore effective project newline policy

## Current evidence

In the audit git-newline-policy probe Git reported text:set and eol:lf, but new FEATURES.md bytes used CRLF. Current initialize converts template text unconditionally to CRLF.

The migration accounting audit of 2026-09-29 found the same fault in setup's always-on `.gitignore` write for the runs exclusion, which the retained need Ignore election cannot initialize a missing .gitignore covers. `internal/setup.js` picks CRLF unless the existing file uses LF alone, with no look at Git attributes or configuration, so probes in fresh repositories with `* text eol=lf` created a missing or empty `.gitignore` as `/.nightshift/runs/` followed by CRLF. A `.gitignore` with mixed endings had the rule appended with CRLF, although the agreed disposition says "Genuine unresolved write ambiguity still prevents mutation." A test covers creating a missing `.gitignore` only through a check-ignore assertion; none pins the created bytes or covers an existing empty file.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Materialize missing templates according to the effective supported project newline policy, keeping logical template content and existing files intact. Resolve genuine ambiguity rather than silently overriding an established convention.

## Verification and related work

Cover explicit LF and CRLF policies, defaults, existing files, missing targets and interruption. This concerns new-file creation, not normalization of an existing mixed-ending file.

The related but separate [mixed-ending repair feature](../features/v3-mixed-ending-repair.md) preserves its own acceptance cases.

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [New setup templates ignore effective project newline policy](../reports/v3-migration-followups-20260920.md#new-setup-templates-ignore-effective-project-newline-policy).

Tracking is not implementation authority.
