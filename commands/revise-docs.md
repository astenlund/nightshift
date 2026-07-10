---
description: "Use after implementation work lands, when project documentation may still describe the old behavior or list the work as planned."
---

# revise-docs

## Scope

The scope to document is: `$ARGUMENTS`

If the scope is empty, determine it automatically from the conversation context: what was just implemented, discussed, or changed in this session. If unclear, ask the user what was implemented.

## Process

1. **Discover documentation files.** Search for documentation that might reference the implemented work:
   - `README.md` in the repo root
   - `CLAUDE.md` in the repo root
   - All `.md` files inside the `.claude/` directory
   - Any other project-level documentation (e.g., `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/` directory)

   Read each discovered file and identify which ones reference the implemented feature (by name, by phase number, by description, or as a planned/future item).

   Also assemble a short list of the key code identifiers the session's work changed, renamed, retired, or relocated (classes, methods, endpoints, pipeline stages, config keys), and grep `.claude/` for them. A spec or index entry making present-tense claims about a touched identifier is an update candidate even if it never names the implemented feature -- "current state" sections rot by referencing the mechanisms work changed, not the work's name. Do the same for the titles of backlog entries the session shipped or retired: sibling feature and pattern files cross-reference entries by title (absorbed-lists, "tracked as" notes, fold-in plans), and those cross-references invert from plan to fact when the entry ships.

2. **Identify what needs updating.** For each relevant file, look for:
   - **Planned/future items** that should now be marked as done, following the project's completion convention (see the Completed features guideline below)
   - **Phase lists or roadmaps** where the feature should be marked complete
   - **Architecture descriptions** that should reflect the new behavior
   - **Detailed design sections** for the implemented feature that are now redundant; consider collapsing verbose "implemented" sections into concise summary lines
   - **Stale references** to old behavior that the implementation changed
   - **Rot-prone anchors** in any entry the sweep touches: line numbers, plan-phase or task ordinals, bullet positions, and temporal qualifiers ("new", "recent") standing in for an identifier. Replace with the stable anchor they point at (see the Coarse-and-stable anchors guideline below).
   - **Forward-looking notes in `.claude/patterns/*.md` and `.claude/features/*.md`** — any future-tense instruction whose trigger condition shipped in this session: rewrite the note to describe what was done and state the updated trigger condition. These are the most failure-prone items because future-tense imperatives are easy to overlook as stale instructions rather than stale references.

3. **Apply the updates.** Announce briefly which files will be touched and what kind of change each gets, then make the edits. The user can interrupt or toggle off auto-accept if they want to review before edits land. Keep it concise:
   - Prefer summary lines over detailed paragraphs for completed work
   - Remove struck-through items from "future" lists when the functionality is captured in a "completed" section
   - Update descriptions to reflect what was actually built (not just the original plan)
   - Don't add new documentation sections; only update existing ones

4. **Show a summary** of all files changed and what was updated in each.

## Guidelines

- **Completed features:** In projects with the four-index `.claude/` layout, follow its shipping protocol: append the entry to the relevant `*_HISTORY.md` archive (dropping its `Requires:` line in the move); never create or grow an inline "completed" / `## Implemented` / `## Fixed` section in an active index; when a slice ships, strike through its bullet in the parent's `**Slices:**` block and advance the parent's top-level `**Requires:**` line to the next-to-ship slice's gates; and run the walk-and-remove sweep, dropping the now-satisfied reference from every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` (a line left empty becomes `Requires: none.`). In projects without that layout, mark with ~~strikethrough~~ + checkmark or move to an existing "completed" section, per the file's own convention. Either way, update the description to be past-tense and reflect what was actually implemented.
- **Landed claims must match git:** Verify "landed/shipped" claims against git before writing them. If the session reverted work (git revert, DROPME drop), sweep the `.claude/` files touched this session for claims recording that work as landed -- a spec Status updated optimistically mid-session and never rolled back after the revert is the canonical false record.
- **Collapse verbose details:** When a feature has a detailed design section AND is now fully implemented, the detail section can often be collapsed into the summary list. Keep details only if they serve as useful reference for future maintenance.
- **Don't over-update:** Only touch documentation that actually references the feature. Don't add the feature to files that don't mention it.
- **CLAUDE.md is for constraints, not descriptions:** CLAUDE.md documents traps, non-obvious rules, and behavioral constraints, not what the code does. Don't add architectural descriptions or service overviews to it. If a new feature introduces a non-obvious constraint (e.g., "must update five ingestion points"), add that; if it just adds a new service, don't.
- **Coarse-and-stable anchors:** Durable entries (backlog indexes, specs, feature files) locate code and work by identifiers that survive refactors -- symbol names, entry titles, commit hashes, config keys, subsystem names -- never by line numbers, plan-phase or task ordinals, or bullet positions, and never by temporal qualifiers ("new", "recent") that stop being true as the code ages. When precision and stability conflict, choose the coarser stable anchor (a method name over a line number): a precise locator that rots misleads harder than a coarse one that holds.
- **Preserve structure:** Follow each file's existing conventions for how completed items are formatted.
- **Balance check:** After making changes, re-read each modified section and flag anything that feels off-balance: too verbose for what it covers, or too thin for the feature's actual impact. Ask the user before adjusting in either direction.
- **Lift your gaze:** While updating, notice if the surrounding section could use a light cleanup (e.g., other stale items nearby), but ask before making changes beyond the immediate scope.
