---
name: ready
description: Use when picking what to work on next in a project with the four-index .claude/ backlog.
---

# ready

Report what's ready to work on now versus what's blocked and on what, by resolving each backlog entry's declared `**Requires:**` line.

The parsing is deterministic and lives in a script bundled with this skill; this skill runs it and presents the result. The full grammar (Requires-line joining and terminators, slice-suffix normalization, implicit MVP gates, the structural-error taxonomy) is implemented and documented in `ready.js` beside this file, with fixture tests in `ready.test.js`.

## Process

1. **Run the parser** from the repo root:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/ready/ready.js"
   ```

   (Pass the repo root as an argument if the working directory is elsewhere.) The script reads `.claude/QUICK_WINS.md`, `.claude/FEATURES.md`, and `.claude/BUGS.md`, and emits JSON with `ready`, `blocked`, `external`, `structuralErrors`, and `notices`. It never reads the history archives: the walk-and-remove convention keeps active `Requires:` lines authoritative. `PATTERNS.md` is a pattern registry, not a work backlog, and is not parsed.

   If the script reports that `.claude/` is missing, suggest `/flightdeck:init-workflow` and stop. If the script itself cannot run (node missing, script file absent), report that and stop — suggest reinstalling or updating the flightdeck plugin; do NOT hand-approximate the dependency graph from the raw markdown. A failed check is not a clean check.

2. **Present the report.** Output up to four sections, omitting any that are empty:

   - **Ready**: bulleted list, grouped by index (Quick Wins / Features / Bugs). For each item give the title and a short shape hint drawn from the excerpt in the JSON (size, area touched, what's involved). One line per item where possible.
   - **Blocked**: items with their blocker(s) named explicitly; mention any external primitives parenthetically. One line per item.
   - **External**: items whose readiness depends on judging an external primitive; name the primitive.
   - **Structural errors**: missing `**Requires:**` lines, stale or broken references, and parents whose slices have all shipped (ready to graduate to the history archive). These need fixing by hand; surface them prominently.

   Include the script's `notices` (broken breakout-file links, sections the parser could not interpret) as a short trailing list.

   Keep the report compact: this is a "what should I work on next" view, not a full backlog dump. If there are more than ~10 ready items, surface the top 5 or so and note the remaining count.

## Notes

- This is a read-only skill. Do not modify any files.
- The authoritative upstream list is the index `**Requires:**` line. Breakout files under `.claude/features/` and `.claude/bugs/` don't carry structured dependency sections; neither the script nor this skill crawls them.
- Semantics of the classifications, for interpreting and explaining results:
  - **Ready**: `Requires: none.` (quick wins are atomic, carry no Requires line, and are always ready).
  - **Blocked**: at least one in-backlog reference; under the walk-and-remove discipline every in-backlog reference is a current blocker. Mixed link + external classifies as Blocked with the external noted parenthetically, never double-reported.
  - **External**: only bare-text upstream items (SDK features, infrastructure, hardware) that the user confirms case by case.
  - **Structural error**: a missing Requires line (silence is not `none.` — it means the dependency review hasn't been done), a reference whose target isn't in the active backlog (broken link, or stale reference the walk-and-remove sweep missed), or an all-slices-shipped parent awaiting graduation.
  - Sliced features expand into per-slice work units (`[Feature title: slice name]`); a continuation is never ready while its MVP is unshipped.
- If the script's output looks wrong for a given entry (a shape the grammar doesn't cover yet), fix the grammar in `ready.js` (in the plugin repo clone, not the installed cache) and add a fixture test to `ready.test.js` — don't work around it in the report. Run the tests with `node ready.test.js` from the skill directory.
