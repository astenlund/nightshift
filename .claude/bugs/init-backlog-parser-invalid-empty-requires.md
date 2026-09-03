# Init-backlog templates prescribe parser-invalid empty Requires syntax

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
