# Simplify the revise lifecycle around rounds

Feature: the revise review lifecycle in `skills/revise/SKILL.md` is restated around its actual moving parts (dimensions, rounds, and shards when the artifact is large), with a phase ending when every applicable dimension is inactive or after 10 rounds whichever comes first, the clean/dirty phase model removed, and the "no applied changes" requirement relocated to a post-review entry condition. This file is the authoritative design record.

## What it does

Today `skills/revise/SKILL.md` expresses phase progress through a "clean"/"dirty" phase and a per-cell launch limit. Both over-complicate the story, and the phrasing lets a controller short-circuit phase 1: observed twice on 2026-08-12, an agent applied accepted round-1 fixes, marked the phase dirty, and treated that as the trigger to start phase 2, skipping the mandatory re-verification rounds inside phase 1. Both times the human had to interrupt and correct the flow.

The lifecycle's real moving parts are dimensions, rounds, and shards (when the artifact is large). This feature states phase-ending and post-review entry directly in terms of those parts, counts rounds rather than per-cell launches, and expresses the "the final phase made no changes" requirement as a post-review gate rather than a phase-level flag.

## The round-based lifecycle

A phase runs on rounds. Each round launches one fresh reviewer per currently active dimension (per shard cell when the artifact is split). A phase is alive while it has active dimensions and the round cap has not been reached. A dimension becomes inactive on its first clean conclusion with a concrete, nonblank verification rationale, or at a round boundary where every skeptic-verified finding from the current round was refuted or accepted without an actionable follow-up; it stays active across rounds otherwise (an applied fix or an open follow-up in the current round keeps it active), and an accepted edit records an applied change for the phase. The all-refuted deactivation route is an accepted trade: such a convergence rests on skeptic-refutation evidence rather than an affirmative reviewer LGTM, and a reviewer who latched onto a weak finding may have scrutinized the rest of its scope less than an LGTM implies; the two-phase completion floor and full phase-boundary reactivation are the backstop.

A phase ends when every applicable dimension is inactive, or after 10 rounds, whichever comes first. Dirtiness alone never ends a phase; a phase persists until one of these two ends.

## The two ends are not equal

- The all-inactive end is a convergence: it records the phase and either enters `post-review` or starts the next phase with every dimension reset.
- The 10-round end also starts the next phase with every dimension reset, but it is an advance without convergence: it never increments the converged count and cannot manufacture LGTM.

Only the all-inactive path may reach `post-review`.

## Removal of the clean/dirty model

The `dirty` flag leaves the lifecycle terms and the phase state. An accepted artifact edit no longer "dirties" a phase; it keeps the edited dimension active and records an applied change. A controller-coordinated reviewable edit likewise records an applied change (consulted only at the post-review gate) and preserves each dimension's current active or inactive state until the next phase.

The per-cell launch limit ("10 original reviewer launches per stable dimension or shard cell per phase") becomes a round cap of 10 per phase, because rounds already batch every active dimension at once and are the natural unit the reviewer pool is scheduled by.

## Post-review entry condition

Post-review entry requires the current phase to have ended with every applicable dimension inactive **and** to have applied no reviewable-content changes. A phase that converged but applied changes advances to the next phase rather than entering post-review. This is the durable form of the old "clean phase" rule: an inactive dimension is not re-reviewed by a sibling's later edit, so the final phase must be change-free for every dimension to have reviewed the true final artifact.

## Status

Migrated into the backlog on 2026-08-12 after the design was settled in dialogue: the round-based lifecycle, the all-inactive-or-round-cap phase end, the clean/dirty model removal, and the "no applied changes" rule as a post-review entry condition (not folded into convergence counting). Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The revise lifecycle terms and completion rules in `skills/revise/SKILL.md` (existing; the extraction subject).
- The revise Workflow execution-safety suite in `skills/revise/revise-round.test.js` (existing; the tests that must still pass once the lifecycle prose changes).

**Requires:** none.

## Hardening

- (None entered yet; this file has not been through a revise-spec review.)
