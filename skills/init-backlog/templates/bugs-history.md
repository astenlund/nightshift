# Bugs (history)

Fixed, resolved and retired bug entries, archived from `BUGS.md` so the active list stays scannable. **Archaeological**: read only when consulted. When closing a bug, append it here and state its disposition.

The bug breakout file at `bugs/<slug>.md` (when present) stays in place as the historical diagnosis record; the entry here records the fix and where it landed, or the reason for retirement.

## Cross-reference resolution

`/nightshift:ready` does **not** parse this file for work; it reads it only for the line-discipline check and the link checks, which verify links into it and count its links as keeping the records they name reachable. When a bug is fixed, every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced it is edited at the same time to drop the now-satisfied reference, while each reference to a retired bug is re-decided instead (mirror of the `FEATURES.md` convention). The active `Requires:` lines therefore describe what is *currently* blocking; this file is purely archaeological.

## Entries

Nothing yet.
