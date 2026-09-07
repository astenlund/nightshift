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

- The drop file shape: a JSON line like the handover follow-up items, or Markdown with optional frontmatter. The initial reports used Markdown, usually with fields such as `name`, `description`, `metadata.type`, `captured`, and `proposed-home`; this was an ad-hoc convention rather than a specified format.
- How a dropping agent learns the convention: a note in the repository guidance file, a note in the plugin skills, or both.
- Whether the shift-start read surfaces a non-empty inbox as a note, and whether a stale item (dropped long ago, never triaged) is surfaced differently from a fresh one.
- What promotion does with the dropped file: delete it, or leave it for the ignored folder to accumulate.

## Initial report triage

The user requested clearing the inbox on 2026-09-07. The actual inventory contained five reports, covering agreement replay, guidance ignore state, eager cell reactivation, missed cell deactivation, and inherited manual dispatch after a host takeover.

Their evidence, surviving requirements, and dispositions are preserved in the [v3 inbox triage](../../V3-MIGRATION.md#inbox-triage). They map to existing agreed migration work or retired legacy scheduling mechanisms. This closes their triage without adding duplicate backlog entries or claiming runtime fixes.

The ledger records cleanup status. Future triage must inspect the actual directory contents; this historical inventory does not enumerate future drops or settle the general retention policy.

## Verification

Fixtures cover an empty inbox (no note, no triage prompt), a populated inbox at shift start and at the morning report, promotion into each of the three destination indexes, discard, a malformed drop file, and a commit made while the inbox is populated (nothing from the inbox is staged). The ignore-shape behavior is covered by whichever election shape the init-backlog work settles on.
