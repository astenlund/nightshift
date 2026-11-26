# Quick wins (history)

Completed and retired quick wins, archived from `QUICK_WINS.md` so the active backlog stays scannable. **Archaeological**: loaded on demand. When a quick win lands or is retired, append its entry here rather than to the active file.

Mark retirements as such and record why the work was closed. Write each with enough context to recover the reasoning from the entry alone: investigation findings, reverted approaches, benchmarks, the commit or scope it landed in. Negative-knowledge findings (approaches attempted and reverted, with the reason) are the most valuable content here for preventing re-attempts; consider promoting those into the relevant `.nightshift/patterns/<slug>.md` Cautionary tales section when touching the pattern doc, leaving a one-line redirect here if cross-referenced.

## Cross-reference resolution

`/nightshift:ready` does **not** parse this file for work; it reads it only for the line-discipline check and the link checks, which verify links into it and count its links as keeping the records they name reachable. When a quick win lands, every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced it is edited at the same time to drop the now-satisfied reference, while each reference to a retired quick win is re-decided instead, as `FEATURES.md` describes. The active `Requires:` lines therefore describe what is *currently* blocking. This file is purely archaeological; consult it for delivered work, retirement decisions and earlier approaches, not to resolve dependencies.

## Entries

Nothing yet.
