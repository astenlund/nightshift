# Feature breakout dependency lines drift from the active index

Bug: feature breakout files duplicate active `Requires:` state from `FEATURES.md`, but the shipped-dependency walk updates only the index and no validation detects the copies that become stale.

## Observed behavior

The universal-skill MVP shipped and its active dependency references were removed from `FEATURES.md` under the walk-and-remove convention. A repository sweep on 2026-08-18 found eight breakout files still claiming that the shipped MVP was required:

- `sophisticated-user-communication.md`
- `review-orchestration-tests.md`
- `deterministic-init-backlog.md`
- `present-spec-for-agreement.md`
- `fix-scoped-rounds.md`
- `durable-scope-anchor.md`
- `durable-run-identity-concurrency.md`
- `adversarial-repair-dialogue.md`

The arbitration design change corrected the copies in the four breakout files it otherwise touched: `review-orchestration-tests.md`, `fix-scoped-rounds.md`, `durable-scope-anchor.md`, and `adversarial-repair-dialogue.md`. The other four remain concrete open instances.

`skills/ready/ready.js` correctly treats the top-level `**Requires:**` lines in `FEATURES.md` and `BUGS.md` as the active dependency authority. It does not read breakout-file copies, so `/nightshift:ready` reports a healthy graph while a human or agent reading the authoritative design record sees stale ordering. The `(FEATURES.md index entry)` suffix makes those lines look intentionally synchronized even when they are not.

## Impact

- An implementation session can wait on already shipped work or describe the wrong landing order.
- A review can "fix" the correct index excerpt back toward stale breakout prose.
- Search results expose contradictory dependency state without identifying which copy is authoritative.
- The walk-and-remove convention appears complete while leaving durable design records inconsistent.

## Expected behavior

Declare and enforce one durable representation:

1. Prefer removing active top-level `**Requires:**` copies from breakout files when the index already owns dependency state, leaving stable prerequisite prose under `## Requirements` only when it describes architectural capabilities rather than queue status; or
2. If copies remain a deliberate convention, extend the shipped-item walk and an executable validation to keep every copy synchronized with the index.

The selected rule must cover features and bugs, distinguish active dependency lines from historical prose and slice-local future gates, and exclude plans and history archives. A mismatch must fail a repository test or `/nightshift:ready` sanity check with both conflicting paths named.

## Acceptance criteria

- The four remaining stale universal-MVP copies are removed or synchronized.
- Every active feature and bug has exactly one unambiguous dependency authority.
- An executable fixture fails on an index-versus-breakout mismatch and passes on legitimate architectural-prerequisite prose, slice-local gates, history, and plans.
- `AGENTS.md`, `FEATURES.md`, `BUGS.md`, and `init-backlog` templates describe the selected convention consistently.
- The normal shipped-item walk cannot leave an undetected stale breakout dependency behind.

## Status

Confirmed by repository-wide search on 2026-08-18. Four instances were corrected opportunistically in files touched by the arbitration design; four remain open. No parser or topology test currently detects the class.

**Requires:** none.
