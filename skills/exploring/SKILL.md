---
name: exploring
description: "Use when reviewing the `## Exploring` draft pipeline: renders every pre-feature draft in full (titles, excerpts, breakout links), separate from the ready set."
---

# exploring

Report what is simmering in `FEATURES.md`'s `## Exploring` section: the pre-feature drafts, in full, so the user can decide what to firm up or graduate next. This is the complementary view to `/nightshift:ready`, which lists these drafts titles-only; drafts are never part of the ready set in either view.

## Process

1. **Run the parser** from the repo root:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/ready/ready.js"
   ```

   (Pass the repo root as an argument if the working directory is elsewhere.) If the script reports that `.claude/` is missing, suggest `/nightshift:init-backlog` and stop. If the script itself cannot run (node missing, script file absent), report that and stop: suggest reinstalling or updating the nightshift plugin. A failed check is not a clean check.

2. **Surface problems first.** Always report, in full, the parser's problem channels: `structuralErrors`, `notices`, and any entry in `indexes.missing` (an absent index file, `FEATURES.md` included, is a broken backlog, never an empty draft list; `PATTERNS.md` in the missing list is a note, not a broken backlog). A user may run only this skill, so a broken backlog must not read as clean here.

3. **Present the drafts.** For each item in the `exploring` array, render title, excerpt, and breakout link. The `link` value is `.claude/`-relative; print it prefixed with the index directory (for example `.claude/features/<slug>.md`) so the path resolves from the repo root. When `link` is `null`, omit the link entirely; when it is an absolute `http(s)` URL, print it verbatim with no prefix. Only when the parser ran clean and the `exploring` array is empty, say explicitly that nothing is in `## Exploring`.

4. **Hand off to design, never to work.** This report is a draft inventory, and a draft is by definition not decision-complete: no entry here carries authority to implement, and a `## Exploring` listing never substitutes for agreement. When the user picks a draft, route it to brainstorming to firm the design up and graduate it out of `## Exploring` first; implementation authority is only available afterward, through the `spec-agreement` skill over the graduated entry, exactly as `/nightshift:ready` describes for the ready set. Extracting a single draft with a search tool is the normal way to read one, and it skips the index file header where the agreement rule is written, so treat this step as the binding statement rather than assuming the header was read.

## Notes

- This is a read-only skill. Do not modify any files.
- Render index excerpts only; never crawl the breakout files or their `status: exploring` frontmatter. The index excerpt is the authoritative summary surface, exactly as in the ready skill.
- Deliberately omitted: `ready`, `blocked`, and `external`. Picking buildable work is `/nightshift:ready`'s mandate.
