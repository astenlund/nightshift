# Patterns

Cross-cutting design patterns that apply across multiple features or feature families. Each entry points at a standalone file under `.nightshift/patterns/<slug>.md` with the full treatment.

This file is **one of four repo-local indexes** agents consult on demand when relevant (alongside `QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`).

Readiness and graduation are not approval. Agree meaningful commitments through an investigated understanding readback or concise spec; preserve valid agreement through compatible corrections and compaction.

Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice so it can receive a scoped repair before handover, such as the targeted unwrap `/nightshift:init-backlog` describes, run on request against the files ready names; inspect the repair's diff and run `/nightshift:ready` again afterwards, since a join can change a hyphenated word or a path without a notice.

A pattern graduates here when the same structure would otherwise be re-described in the feature files of two or more feature families; siblings within one family share an umbrella feature record instead, as `FEATURES.md` describes. Lifting it into a shared home lets features link at the pattern rather than duplicating it, and makes design decisions about the pattern uniform across its members.

**Adding a pattern (or its breakout file) is not grammar-checked:** `/nightshift:ready` does not parse PATTERNS.md for work (it is a pattern registry, not a work backlog). It does report a pattern link to a missing file or heading, a pattern title that differs from its breakout file's title, and a breakout file no index reaches. When you add a pattern, run `/nightshift:ready` afterward as a whole-session sanity pass, so those link notices and a stray malformed entry in the three work indexes are caught before it ships.

V2 entries are preserved in [the historical index](migration/v2/PATTERNS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### [Refusal friction](patterns/refusal-friction.md)

The shape most maintainer inbox reports of 2026-10-18 to 2026-11-03 share: the runtime enforces bookkeeping conditions (evidence made stale by an unrelated change, an edit outside a closing scope, a record left open) with the same hard refusal as its provenance and ownership checks, the owner's decision that a thing is settled has no recorded place to land, the lifecycle runs one way, and a refusal often names its condition but not the route out. Raised by the user on 2026-11-03 in Hermes, in their words: "we can't keep working like this. refusals. the 'can't do that now' sort of stuff. i realize we need som checks for provenance, but i've been dealing with a ridiculous amount of this sort of stuff lately. we need to change something." The record maps the seven directions the report offers to the entries and assessment-worklist items that own each, so no feature re-describes the concern, and carries the user's framing from that triage, agile over waterfall and recording a decision without locking it, which the VISION update of 2026-11-03 took up, its open questions decided on 2026-11-03 and 2026-11-04 in VISION.md and WORKFLOW.md. Recorded on 2026-11-03 from the maintainer inbox report `2026-11-03-refusal-friction-landscape.md` and agreed at the user's inbox triage that day.
