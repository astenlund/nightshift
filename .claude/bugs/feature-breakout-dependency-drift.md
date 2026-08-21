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

The arbitration design change corrected the copies in the four breakout files it otherwise touched: `review-orchestration-tests.md`, `fix-scoped-rounds.md`, `durable-scope-anchor.md`, and `adversarial-repair-dialogue.md`. The agreement-gate release later corrected `present-spec-for-agreement.md`. The other three remain concrete open instances.

`skills/ready/ready.js` correctly treats the top-level `**Requires:**` lines in `FEATURES.md` and `BUGS.md` as the active dependency authority. It does not read breakout-file copies, so `/nightshift:ready` reports a healthy graph while a human or agent reading the authoritative design record sees stale ordering. The `(FEATURES.md index entry)` suffix makes those lines look intentionally synchronized even when they are not.

## Impact

- An implementation session can wait on already shipped work or describe the wrong landing order.
- A review can "fix" the correct index excerpt back toward stale breakout prose.
- Search results expose contradictory dependency state without identifying which copy is authoritative.
- The walk-and-remove convention appears complete while leaving durable design records inconsistent.

## Operating context

Nightshift is a locally installed, personal-use coding-agent plugin; `ready.js` runs as a read-only parser on demand, never as a service. The audience is one expert developer: the repository is public on GitHub but has no adoption signals, so the category is `personal use` per the 2026-08-15 calibration ruling.

A defect here misreports the work set or raises a spurious structural error in a backlog index; no data, credentials, or outward state are touched, and the wrong report is visible on the next `/nightshift:ready` run. The change is host-neutral Node with no concurrent use. Recovery is a git revert plus a plugin release, so reversibility is cheap. The index grammar is long-lived: every backlog consumer (`ready`, `exploring`, `spec-agreement`, `init-backlog` templates) reads it and the two-line convention is expected to outlast this fix.

Rigor derivation: `personal use` gives a low baseline. The expected-lifetime predicate fires because the grammar is foundation for every backlog consumer; criticality, failure-consequence, compatibility, and reversibility predicates do not. One uplift yields a `medium` tier: validation, recovery, compatibility, observability, and proof effort are all medium.

## Expected behavior

The index is the sole authority for queue state. Breakout files carry no active dependency line; their `## Requirements` sections hold only standing architectural prerequisites, never queue status.

The root cause of the undecidable "architectural capability versus queue status" boundary is that one `**Requires:**` field holds two things with opposite lifecycles: in-backlog links, which the walk-and-remove convention deletes the moment their upstream ships, and external primitives, which are standing properties of the design and are never walked. The fix splits the field:

1. `**Requires:**` holds only in-backlog markdown links or the literal `none.`. Bare text in it becomes a structural error.
2. A new `**External:**` line on index entries holds bare-text external primitives (SDK features, infrastructure, hardware). It is optional; absence means no external prerequisite. `/nightshift:ready` feeds its External classification from this line only.
3. Breakout files under `.claude/features/` and `.claude/bugs/` carry neither line. The three stale universal-MVP copies are removed along with every other breakout `**Requires:**` line, including `none.` forms.

The rule covers features and bugs, and excludes plans and history archives. Enforcement lives in `skills/ready/ready.js`: it scans each linked breakout file for either line and reports a structural error naming both the index entry and the breakout path, so `/nightshift:ready` surfaces the drift and a fixture in `skills/ready/ready.test.js` pins it.

## Acceptance criteria

- No breakout file under `.claude/features/` or `.claude/bugs/` carries a `**Requires:**` or `**External:**` line; the three stale universal-MVP copies are gone with the rest.
- `ready.js` rejects bare text in `**Requires:**` as a structural error, classifies External from `**External:**` only, and reports a structural error naming both paths when a linked breakout carries either line.
- Fixtures in `ready.test.js` cover each new structural error and confirm `## Requirements` prose, slice-local gates, history archives, and plans do not trigger one.
- `AGENTS.md`, the `FEATURES.md` and `BUGS.md` headers, the `ready` and `exploring` skill prose, and the `init-backlog` templates describe the two-line convention consistently.
- The shipped-item walk cannot leave an undetected stale breakout dependency behind, because a breakout has no line to go stale.

## Status

Confirmed by repository-wide search on 2026-08-18; the three open instances re-verified on 2026-08-22 (`sophisticated-user-communication.md`, `deterministic-init-backlog.md`, `durable-run-identity-concurrency.md`). Design settled 2026-08-22: index-only authority with the Requires/External field split. The bare-text branch of `**Requires:**` has no live users, so the split needs no data migration.

**Requires:** none.
