# Patterns

Cross-cutting design patterns that apply across multiple features or feature families. Each entry points at a standalone file under `.claude/patterns/<slug>.md` with the full treatment.

This file is **one of four repo-local indexes** agents consult on demand when relevant (alongside `QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`).

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice and `/nightshift:init-backlog` unwraps it.

A pattern graduates here when the same structure would otherwise be re-described in two or more feature files. Lifting it into a shared home lets features link at the pattern rather than duplicating it, and makes design decisions about the pattern uniform across its members.

**Adding a pattern (or its breakout file) is not grammar-checked:** `/nightshift:ready` does not parse PATTERNS.md (it is a pattern registry, not a work backlog). When you add a pattern, verify its breakout-file link targets a real file under `.claude/patterns/` and run `/nightshift:ready` afterward as a whole-session sanity pass, so a stray malformed entry in the three work indexes is caught before it ships.

## Current patterns

Nothing captured yet.
