# Bugs

Known bugs awaiting attention. Short entries live here; bugs that need more than a few lines of description graduate to a dedicated file under `.nightshift/bugs/<slug>.md`.

This file is **one of four repo-local indexes** agents consult on demand when relevant (alongside `QUICK_WINS.md`, `FEATURES.md`, `PATTERNS.md`). When a bug is fixed, append its entry to [`BUGS_HISTORY.md`](BUGS_HISTORY.md); do not keep a `## Fixed` section inline.

Readiness and graduation are not approval. Agree meaningful commitments through an investigated understanding readback or concise spec; preserve valid agreement through compatible corrections and compaction.

Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice so it can receive a scoped repair before handover.

**Before adding an entry, look for a feature to fold it into.** If an active feature in `FEATURES.md` would remove or rewrite the lines the fix touches, so that the fix would not survive the feature in its current form, add the fix as one line under that feature record's `## Carried fixes` heading, giving the observed failure, its location, what the replacement must do and a link to the evidence, and create no entry here. When the feature would remove only part of what the fix changes, and that part fails and can be verified on its own, carry that part the same way and add an entry here for the rest that names the part carried and links the feature's `## Carried fixes` heading; a fix whose parts cannot be separated stays whole. A feature that merely touches the same module does not qualify, and neither does an Exploring draft, which has not settled what it replaces. A repeat adds a date to that line, never a paragraph. A tenuous match, or a feature invented so there is somewhere to fold into, means an entry here as before. A defect that blocks runs now gets the smallest stopgap, noted on its carried line, without an entry of its own. `FEATURES.md` describes how carried fixes ship and what happens to them when a feature is retired.

## Requires lines

**Every open bug entry carries a `**Requires:**` line** declaring what must be in place before the fix can land. Comma-separated on one physical line, same shape as `FEATURES.md` (the parser joins a wrapped line, but the line discipline above forbids wrapping):

- A markdown link to a feature, quick win, or bug. The reference is a current blocker; under the walk-and-remove convention below, a satisfied dependency is edited out of the line at the moment it ships or is fixed.
- The literal word `none.` if the fix is unblocked. An empty label is a structural error; `none.` is the only empty form.

Bare text in `**Requires:**` is a structural error. An external primitive (driver release, vendor support, user decision) goes on a separate, optional `**External:**` line directly below it, same grammar; `none.`, an empty label, or a link in it is a structural error. Every structural error names its remedy.

A missing `Requires:` line is a structural error. `/nightshift:ready` parses these lines. History entries carry neither line.

**After adding a new entry (or a bug breakout file), run `/nightshift:ready`** from the repo root to confirm the new entry parses and its `**Requires:**` line resolves against the real grammar in `skills/ready/ready.js`. A malformed line (wrapped without the parser's join rule, a misplaced `none.`, a broken or ambiguous link target, or a missing line entirely) otherwise sits in the backlog until the next readiness pass surfaces it.

**When a bug is fixed**, move its entry to [`BUGS_HISTORY.md`](BUGS_HISTORY.md) with a brief note on the fix and the commit it landed in; drop its `Requires:` and `External:` lines in the move. If the bug had its own file, keep the file in place as a historical record of the diagnosis.

**Then walk every other `**Requires:**` line in `FEATURES.md` and `BUGS.md`** and remove references to the just-fixed bug: if it was the only item on the line, set the line to `**Requires:** none.`. Mirror of the `FEATURES.md` walk-and-remove convention; `/nightshift:ready` never has to consult `BUGS_HISTORY.md` to resolve dependencies.

## Open

Nothing currently tracked.

## History

Fixed bugs are archived in [`BUGS_HISTORY.md`](BUGS_HISTORY.md), loaded on demand so the active list above stays scannable. When a bug is fixed, append its entry there rather than to this file, AND walk every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`: remove the now-satisfied reference (if it was the only one, set the line to `**Requires:** none.`). The active `Requires:` lines describe what is *currently* blocking, so `/nightshift:ready` never has to consult the history file; the dependency graph settles as bugs are fixed.
