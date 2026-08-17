# Bugs (history)

Fixed bugs, archived from `BUGS.md` so the active list stays scannable.
**Archaeological**: read only when consulted. When a bug is fixed, append
its entry here rather than to the active file.

The bug breakout file at `bugs/<slug>.md` (when present) stays in place
as the historical diagnosis record; the entry here is a brief
description of the fix and the commit it landed in.

## Cross-reference resolution

`/nightshift:ready` does **not** scan this file. When a bug is fixed, every other
`**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced it is
edited at the same time to drop the now-satisfied reference (mirror of
the `FEATURES.md` convention). The active `Requires:` lines therefore
describe what is *currently* blocking; this file is purely
archaeological.

## Entries

- **Shared sync-gists skill names the wrong backlog command.** Corrected the canonical personal `sync-gists` skill's Nightshift suite note from `init-workflow` to `init-backlog`, so the documented command matches the repository and shipped plugin. Shipped in this commit.
