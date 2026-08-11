# Quick wins

Refactors ready to land when time allows; not blocking any feature, but
would improve the codebase meaningfully.

This file is **one of four repo-local indexes** Claude reads on every
session start (alongside `FEATURES.md`, `BUGS.md`, `PATTERNS.md`). Active
entries are kept inline, organized under thematic `##` sections you
invent as work emerges. When a quick win lands, append a shipped-note
entry to [`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md); do not move
it within this file. Negative-knowledge findings (approaches attempted
and reverted) are first-class promotion candidates from the history
into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections.

Capture shorthand: name the refactor, describe the current smell in a
sentence or two, sketch the preferred shape. A reader should be able to
start work from the entry alone. Anchor entries on identifiers that
survive refactors -- symbol names, entry titles, commit hashes, config
keys -- never on line numbers, plan-phase ordinals, bullet positions,
or temporal qualifiers ("new", "recent"): a precise locator that rots
misleads harder than a coarse one that holds.

## Handover shift-start confirmation heuristic

- **Do not raise the shift-start confirm for designed provisional live-claims plus a
  mid-flight implementation resume.** Today handover stops at the confirm line when the
  only flags are `(live-claim: provisional)` markers that are cutover-gated/designed AND
  an in-progress implementation resume. The user ruled 2026-08-11 that neither is
  confirm-worthy: skip straight to building the queue. Keep the confirm only for real
  ambiguity, artifact-selection doubt, validation findings, or drift. Refine the
  "Clean detection" paragraphs in `commands/handover.md` (or the shift-start section) to
  state that designed/cutover-gated provisional markers and same-session mid-flight
  resumes are non-flags.

## Backlog-entry parsing verification

- **Make `/init-backlog` scaffold an instruction to run `nightshift:ready` after adding a new entry** to `FEATURES.md`, `BUGS.md`, `QUICK_WINS.md`, or `PATTERNS.md` (or a new per-item breakout file), confirming the new entry parses and its `**Requires:**` line resolves against the real grammar in `skills/ready/ready.js`. Today the four index templates document the `Requires:`-line shape in prose but never require the author to verify a new entry, so a malformed line (typo'd link target, misplaced `none.`, wrapped without the parser's join rule, missing line entirely) sits in the backlog until `/nightshift:ready` surfaces it. Shipping the instruction inside the init-backlog index templates covers both halves: fresh scaffolds carry it at creation, and re-running the idempotent command patches already-scaffolded projects, because `init-backlog`'s staleness rule flags a template-controlled portion missing a concept the current template documents (`commands/init-backlog.md` #Process inventory). At the end of the implementation session, run `/init-backlog` on this project as the acceptance step: it both tests the command's function (A) and patches this repository's own backlog with the new instruction (B), exercising the exact re-run path the change relies on.

## (add sections as work emerges)

## History

Implemented quick wins are archived in
[`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md), read only when
consulted (not at session start) so the active backlog above stays
scannable. When a quick win lands, append its entry there rather
than to this file.
