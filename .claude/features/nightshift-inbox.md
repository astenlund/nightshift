# Nightshift inbox

A git-ignored `.claude/inbox/` folder where other agents and sessions drop bug reports and suggestions about Nightshift itself, plus a triage step that promotes them into the four indexes. Drops never touch the tracked backlog, so a concurrent session cannot move a governing artifact's fingerprint while it is under review.

## Motivation

Work on this plugin runs almost around the clock, so a direct backlog edit from another session is disruptive rather than helpful: the backlog is a governing artifact under review, and a concurrent edit moves fingerprints and trips the agreement gate mid-run. At the same time, an agent that hits a Nightshift defect while doing unrelated work has nowhere to put it, and the finding is lost when that session ends.

An inbox separates capture from curation. Dropping is cheap, unsynchronized, and invisible to the tracked tree; promotion is a deliberate act at a moment when no run is holding the backlog.

## Ignore shape and safety

Settled by user ruling on 2026-09-03: the inbox folder is git-ignored, the same treatment `.claude/plans/` and `.tmp/` get, so drops never enter history and never touch the tracked backlog. Only promotion at triage writes tracked files.

During the batch the folder was excluded through the clone-local `.git/info/exclude` rather than the tracked `.gitignore`, which kept the working tree clean without committing anything. Whether the tracked `.gitignore` should carry the same entry for other clones is part of this work and connects to [Init-backlog ignore-shape election](init-backlog-ignore-shape-election.md), which lets the user choose between the two shapes; the inbox is one more path that election governs.

Commits made while the inbox is populated must use explicit pathspecs so an unignored inbox cannot be swept into a batch commit by accident.

## Triage

A triage step lists every file in the inbox at triage time and lets the user promote each item into `BUGS.md`, `QUICK_WINS.md`, or `FEATURES.md`, or discard it. It lists the folder's actual contents rather than a remembered set, because further drops arrive between sessions and during a run.

Candidate entry points, to be chosen at pick-up: the shift-start read, the morning report, and `/nightshift:ready`. They are not mutually exclusive; the likely shape is that the shift-start read and `/nightshift:ready` surface a non-empty inbox as a note while the morning report performs the actual triage, since that is where the user is already making routing decisions.

## Open questions

- The drop file shape: a JSON line like the handover follow-up items, or a Markdown stub with frontmatter. The two existing items are Markdown stubs with frontmatter carrying `name`, `description`, `metadata.type`, `captured`, and `proposed-home`, which is a workable starting point but was invented ad hoc rather than specified.
- How a dropping agent learns the convention: a note in the repository guidance file, a note in the plugin skills, or both.
- Whether the shift-start read surfaces a non-empty inbox as a note, and whether a stale item (dropped long ago, never triaged) is surfaced differently from a fresh one.
- What promotion does with the dropped file: delete it, or leave it for the ignored folder to accumulate.

## Attached items

The two files already in `.claude/inbox/` are this entry's first items and are triaged with it:

- `guidance-ignore-state-not-inspected.md`: init-backlog's inspection probes only `.claude/` targets, so the resolved guidance file's tracked or ignored state is invisible and the election presenter recommended `track` for a `CLAUDE.md` that was privately excluded; its addendum adds that a private `/.claude/` rule masks every repository-local rule below it, so the ignore election can never complete in such a clone.
- `revise-eager-staleness-interpretation.md`: an incident report in which a controller read fingerprint staleness as an immediate cell reactivation and relaunched every settled cell after each fix, instead of leaving certifications untouched until the all-inactive boundary where the wave reactivates only the stale ones.

Both are bug-shaped and each proposes its own breakout under `.claude/bugs/` with an entry under `BUGS.md`; triaging them is the first exercise of the promotion step this feature defines.

## Verification

Fixtures cover an empty inbox (no note, no triage prompt), a populated inbox at shift start and at the morning report, promotion into each of the three destination indexes, discard, a malformed drop file, and a commit made while the inbox is populated (nothing from the inbox is staged). The ignore-shape behavior is covered by whichever election shape the init-backlog work settles on.
