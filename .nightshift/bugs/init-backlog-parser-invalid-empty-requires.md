# Init-backlog templates prescribe parser-invalid empty Requires syntax

## Current evidence

Current feature and bug template archive-cleanup prose still prescribes bare Requires: none., while the parser recognizes the bold **Requires:** label. Fresh scaffold success does not exercise the invalid later edit. The independent audit confirms this retained defect remains.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

## Required outcome

Make every current shipped empty-dependency instruction use the parser-valid complete line. Keep producer and consumer consistent without changing the established dependency grammar.

## Verification and related work

Validate the actual retained template instructions against the parser and inspect sibling guidance. Historical root-guidance paths below are provenance; they are not proof that removed assets still exist.

Coordinate with [shared parser maintenance](../features/v3-parser-consistency.md).

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Init-backlog templates prescribe parser-invalid empty Requires syntax](../reports/v3-migration-followups-20260920.md#init-backlog-templates-prescribe-parser-invalid-empty-requires-syntax).

Tracking is not implementation authority.

## Historical diagnosis

The earlier diagnosis follows for provenance. References to removed assets and the old controller are historical; the current outcome above governs the retained repair.

Bug: shipped init-backlog guidance tells maintainers to write `Requires: none.` after removing the final dependency, while the ready parser recognizes only a line beginning with `**Requires:**`.

## Observed behavior

A fresh-context review of an init-backlog rerun on 2026-09-01 found the generated instruction in `templates/bugs.md`. A sibling sweep confirmed the same parser-invalid fallback in `templates/features.md` and `templates/root-guidance.md`, including both active convention sections and trailing history boilerplate.

`internal/backlog-catalog.js` defines `REQUIRES_LABEL` as `^\*\*Requires:\*\*`, which `skills/ready/ready.js` imports, so a maintainer who follows `Requires: none.` creates a line the parser does not recognize. The next ready pass reports a missing-Requires structural error even though the maintainer followed Nightshift's own generated guidance.

## Expected behavior

Every shipped instruction that describes the empty dependency form spells the complete parser-valid line as `**Requires:** none.`. An init-backlog rerun must not introduce or preserve guidance that recommends the unrecognized bare label.

## Fix boundary

- Correct every parser-invalid empty-form instruction in `skills/init-backlog/templates/bugs.md`, `features.md`, and `root-guidance.md`.
- Sweep the init-backlog skill prose and repository guidance for the same instruction so the source, concept checklist, and generated targets remain consistent.
- Do not change the ready grammar; the bold label is the established syntax used by live backlog entries.
- Add a regression over the template assets so a future wording refresh cannot reintroduce the bare label.

## Regression needs

- The source templates contain no instruction that prescribes `Requires: none.` as a complete line.
- Every empty-form instruction contains `**Requires:** none.` and remains consistent with `REQUIRES_LABEL`.
- The init-backlog controller suite proves a rerun produces parser-valid walk-and-remove guidance in BUGS, FEATURES, and resolved root guidance targets.
- The ready parser still reports no structural error for the repository's active backlog after the template correction.

## Status

Confirmed on 2026-09-01 against Nightshift 2.6.20 source and the installed 2.6.20 package. The defect is in shipped template guidance, not in ready parser behavior.

Fixed on 2026-09-25 in the 3.2.9 candidate (commit `61a663e`): every shipped empty-dependency instruction spells `**Requires:** none.`, guarded by a template regression in `tests/setup.test.js`. See [the history entry](../BUGS_HISTORY.md#init-backlog-templates-prescribe-parser-invalid-empty-requires-syntax).
