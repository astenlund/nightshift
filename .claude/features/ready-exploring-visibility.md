# Surface exploring entries in ready

Feature: `/nightshift:ready` reports `## Exploring` entries in its
output, clearly marked as not-ready, so drafts stay visible instead of
silently aging out of the developer's awareness. Motivated 2026-08-15:
exploring drafts are excluded from the readiness set by design, which
is correct for "what can I build now" but means nothing ever resurfaces
them; the developer must remember to reread `FEATURES.md` for the
`## Exploring` section.

## Design sketch

- `ready.js` keeps excluding `## Exploring` entries from `ready` /
  `blocked` / `external`, but instead of dropping them it collects each
  `###` entry under that section into a new top-level output array
  (working name `exploring`), carrying the entry title as ready items
  do, plus the breakout-file link (parsed today as the entry's
  self-target but not emitted for ready items, which are
  `{ index, title, excerpt }` only). No `Requires:` parsing is
  expected there; a
  historical-artifact `Requires:` line on an exploring entry stays
  ignored, per the existing carve-out.
- The skill prose renders the array in the report under an
  unmistakable heading (for example "Exploring (drafts, not ready)"),
  visually separated from the unblocked work set so the two cannot be
  confused.

## Consumers of the changed output set

Adding an output array changes a value set other things describe or
consume; each consumer's handling:

- `skills/ready/ready.js`: the change site (section filter plus new
  collection).
- `skills/ready/ready.test.js`: new fixtures for an index with and
  without an `## Exploring` section; existing fixtures assert the new
  array is empty or absent, whichever shape is chosen.
- `skills/ready/SKILL.md`: renders the new marked section and states
  that exploring entries are informational only; its enumeration of
  the emitted JSON fields and its "up to four sections" report count
  both grow to include the new array.
- `commands/init-backlog.md`: the FEATURES.md index template's
  Exploring prose ("excludes this section from the readiness set on
  purpose") and the CLAUDE.md template's backlog section (home of the
  "`/nightshift:ready` skips them" wording) reword to "reported
  separately as drafts, never in the ready set". Distinct from the
  template bodies, the freshness checklist item and the
  either-location note that quote the "`/nightshift:ready` ignores
  `## Exploring`" concept need the same rewording, or staleness
  detection would judge correctly-updated scaffolds against the
  retired claim.
- This repo's root `CLAUDE.md` backlog section states the skip
  verbatim ("`/nightshift:ready` skips them") and rewords in the same
  change, as does the matching sentence in this repo's own
  `.claude/FEATURES.md`; `AGENTS.md` does not mention Exploring and
  stays untouched. Downstream projects' scaffolded index copies rot
  gently and get refreshed opportunistically or via a backlog-index
  version bump, not as a blocking part of this change.
- `README.md`'s one-line summary of the ready report: untouched; it
  is deliberately non-exhaustive (it already omits `external` and
  `notices`).

## Requirements

- None outstanding; the Exploring carve-out and the `###`-entry shape
  it parses are already shipped grammar.

**Requires:** none (FEATURES.md index entry).
