# Quick wins (history)

Implemented quick wins, archived from `QUICK_WINS.md` so the active
backlog stays scannable. **Archaeological**: loaded on demand, not at
session start. When a quick win lands, append its entry here rather
than to the active file.

Entries appear in the order they shipped. Write each with enough
context to recover the reasoning from the entry alone: investigation
findings, reverted approaches, benchmarks, the commit or scope it
landed in. Negative-knowledge findings (approaches attempted and
reverted, with the reason) are the most valuable content here for
preventing re-attempts; consider promoting those into the relevant
`.claude/patterns/<slug>.md` Cautionary tales section when touching
the pattern doc, leaving a one-line redirect here if cross-referenced.

## Cross-reference resolution

`/nightshift:ready` does **not** scan this file. When a quick win lands, every
other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced
it is edited at the same time to drop the now-satisfied reference. The
active `Requires:` lines therefore describe what is *currently*
blocking. This file is purely archaeological; read it when you want
to know what already shipped or to mine negative-knowledge findings,
not to resolve dependencies.

## Entries

- **Scaffold a run-`/nightshift:ready`-after-adding-an-entry instruction in `/init-backlog`** (`commands/init-backlog.md`): the four index templates now instruct the author to run `/nightshift:ready` after adding a new entry (or per-item breakout file) to confirm it parses and its `**Requires:**` line resolves against the real grammar in `skills/ready/ready.js`. Scoped per index to what the parser actually validates: FEATURES/BUGS resolve `Requires:` links and flag structural errors; QUICK_WINS surfaces prose-only-section notices; PATTERNS.md is not parsed (it is a registry), so its note directs a breakout-file link check plus a whole-session sanity pass. A matching `## Concept checklists` item per index makes the idempotent `init-backlog` re-run detect the missing concept on already-scaffolded projects and propose a targeted patch. Validated by a fresh-context acceptance re-run of `init-backlog` against this repo: exactly the four stale indexes were targeted-patched and every other target skipped. Shipped in this commit.
