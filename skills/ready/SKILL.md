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

   (Pass the repo root as an argument if the working directory is elsewhere.) The script reads `.claude/QUICK_WINS.md`, `.claude/FEATURES.md`, and `.claude/BUGS.md`, and emits JSON with `indexes` (found and missing index files), `ready`, `blocked`, `external`, `exploring`, `structuralErrors`, and `notices`. It never reads the history archives: the walk-and-remove convention keeps active `Requires:` lines authoritative. `PATTERNS.md` is a pattern registry, not a work backlog, and is not parsed.

   If `indexes.missing` names any of the three work indexes, surface that prominently as a broken backlog before anything else; an absent index file is never silent and never renders as an empty report. (`PATTERNS.md` in the missing list is a note, not a broken backlog.)

   If the script reports that `.claude/` is missing, suggest `/nightshift:init-backlog` and stop. If the script itself cannot run (node missing, script file absent), report that and stop: suggest reinstalling or updating the nightshift plugin; do NOT hand-approximate the dependency graph from the raw markdown. A failed check is not a clean check.

2. **Present the report.** Output up to five sections, omitting any that are empty:

   - **Ready**: exhaustive bulleted list, grouped by index (Quick Wins / Features / Bugs). For each item give the title and a short shape hint drawn from the excerpt in the JSON (size, area touched, what's involved). One line per item where possible.
   - **Blocked**: partition items by their exact in-backlog blocker set, then render one bullet per blocker set that names the blocker(s) followed by every item title in that partition. Each blocked item appears in exactly one bullet. When an item also names external primitives, keep them parenthetical immediately after that item's title.
   - **External**: items whose readiness depends on judging an external primitive; name the primitive.
   - **Structural errors**: missing `**Requires:**` lines, stale or broken references, and parents whose slices have all shipped (ready to graduate to the history archive), or a dependency cycle (two or more entries that block each other's next shipment). These need fixing by hand; surface them prominently.
   - **Exploring (drafts, not ready)**: after the sections above, the `exploring` entries as a titles-only list, one line total where possible. These are informational drafts, never part of the ready set; end with a one-line pointer to `/nightshift:exploring` for the full draft list (excerpts and breakout links).

   Include the script's `notices` (broken breakout-file links, sections the parser could not interpret) as a short trailing list.

   Keep the report centered on choosing work. Compactness comes from concise one-line Ready entries and Blocked grouping. All parsed Ready and Blocked items remain visible by title.

3. **Recommend a few candidates.** Close the report with a short recommendation naming two or three Ready items worth picking now and the reason each earns the slot, so the user is choosing between argued options rather than scanning an undifferentiated list. Draw the reasons from what the parsed data actually shows: an item that unblocks the most downstream entries, a root of a long dependency chain, an item whose excerpt reports that the current instruction cannot execute or that a documented behavior is already broken, or a small self-contained item when the session is short. Name the leverage explicitly (which entries a pick unblocks, how deep the chain behind it runs). Recommend only from the Ready set; a Blocked, External, or Exploring item is never a candidate. When the Ready set is empty, or holds one item, or offers no basis to prefer any item over the others, say so in one line instead of manufacturing a ranking.

4. **Hand off to work, never to authority.** This report is work nomination. Readiness means an entry's declared dependencies resolve, not that its design is agreed, and neither the report nor a recommendation above authorizes an edit. When the user picks an item, from this report or from the recommendation, that pick is a natural-language implementation entry: run the `spec-agreement` skill in `lifecycle` mode over the picked entry, with the entry and its breakout file where one exists as the governing spec, and obtain explicit agreement in this session before touching any file. A backlog entry counts as a spec; a ready classification never substitutes for the decision-complete digest. Extracting a single entry with a search tool is the normal way to read one, and it skips the index file header where this same rule is written, so treat this step as the binding statement rather than assuming the header was read.

## Notes

- This is a read-only skill. Do not modify any files.
- The authoritative upstream list is the index `**Requires:**` line. Breakout files under `.claude/features/` and `.claude/bugs/` don't carry structured dependency sections; neither the script nor this skill crawls them.
- Semantics of the classifications, for interpreting and explaining results:
  - **Ready**: `Requires: none.` (quick wins are atomic, carry no Requires line, and are always ready).
  - **Blocked**: at least one in-backlog reference; under the walk-and-remove discipline every in-backlog reference is a current blocker. Mixed link + external classifies as Blocked with the external noted parenthetically, never double-reported.
  - **External**: only bare-text upstream items (SDK features, infrastructure, hardware) that the user confirms case by case.
  - **Structural error**: a missing Requires line (silence is not `none.`: it means the dependency review hasn't been done), a reference whose target isn't in the active backlog (broken link, or stale reference the walk-and-remove sweep missed), or an all-slices-shipped parent awaiting graduation, or a dependency cycle (two or more entries that block each other's next shipment).
  - Sliced features expand into per-slice work units (`[Feature title: slice name]`); a continuation is never ready while its MVP is unshipped.
  - **Exploring**: `## Exploring` drafts, reported titles-only as informational not-ready items; they carry no resolvable `Requires:` semantics (a reference pointing at a draft stays a structural error) and never enter the ready set. `/nightshift:exploring` renders the same array in full.
- If the script's output looks wrong for a given entry (a shape the grammar doesn't cover yet), fix the grammar in `ready.js` (in the plugin repo clone, not the installed cache) and add a fixture test to `ready.test.js`; don't work around it in the report. Run the tests with `node ready.test.js` from the skill directory.
