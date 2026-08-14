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

**After adding a new entry, run `/nightshift:ready`** from the repo root
to confirm it parses as a quick-wins work item against the real grammar
in `skills/ready/ready.js`. Quick wins carry no `**Requires:**` line; the
failure mode to catch is an entry that doesn't parse as a `- ` bullet or
`###` heading (ready reports it as a prose-only-section notice) while you
can still fix it in the same session.

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

## Revise engine prose structure

- **Restructure the Manual Agent path session-reconciliation paragraph in
  `skills/revise/SKILL.md` into a labeled case list.** The paragraph beginning
  "Controller interruption, drift, and explicit abandon retain the existing
  best-effort semantics" is a single ~4900-character block bundling roughly eight
  separately-conditioned recovery branches (reviewer/skeptic session available vs
  unavailable, in-flight vs needs-retry row mismatches, both-Session-ID-none) in
  run-on prose, nearly 3x the file's next-largest paragraph and against the file's
  own bullet-list convention for enumerated branch rules ("Use only these values",
  "Then adjudicate"). Preferred shape: one labeled case per branch stating its
  state precondition and its result-then-state replacement action, byte-level
  semantics preserved. This is load-bearing crash-recovery prose, so the
  restructure is its own reviewed change (confirmed by the 2026-08-14 wave-batch
  revise-code run and deliberately deferred there).

## (add sections as work emerges)

## History

Implemented quick wins are archived in
[`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md), read only when
consulted (not at session start) so the active backlog above stays
scannable. When a quick win lands, append its entry there rather
than to this file.