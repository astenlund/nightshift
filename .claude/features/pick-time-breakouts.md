# Break out index-only entries at pick time

status: exploring

Draft exploring a pick-time breakout for index-only backlog entries (quick wins especially): when an entry is picked for lifecycle work, its design record moves to a breakout file that becomes the governing artifact, and the index entry stays exactly one physical line.

## Motivation (2026-08-23 CI-gate run evidence)

Working an index-only entry through the lifecycle accretes content the index line cannot hold cleanly: the Operating context rigor profile, review clarifications and decisions, live-claim probe bullets. The whole bullet line is also the bullet-entry agreement selector, so any edit to the line is a structural changes-contract; the workaround (indented continuation lines) contradicts the one-line-per-entry discipline (the unwrap detector flags them as hard wraps), and index-only entries can take no hardening stamps, so handover's stage detection falls back to weaker evidence. A breakout created at pick time dissolves all three: the agreement target becomes the breakout with the whole-file `design-before-hardening` selector the machinery already fully supports (stamps, fingerprints, completion detection), the index line never changes during the run, and the hardening churn lands in a file with its own lifecycle.

## Shape being explored

- **Breakout timing: at digest acceptance** (user lean, 2026-08-23): the controller creates the breakout when the user accepts the decision-complete digest, seeding it from the accepted digest plus the entry text. Agreement creation is the natural moment: the accepted decision surface exists to be recorded, and a pick that fizzles before agreement leaves no orphan file. Alternative considered: at nomination (ready pick), rejected as premature.
- **Grouping**: several quick wins picked together share one breakout; the agreement controller already handles multi-seed governing sets, so the grouped breakout carries one digest section per entry (or one merged digest, open below).
- The Operating context, review-run decisions, and verification/live-claim bullets land in the breakout; the grounding step's indented-continuation prescription for index-only entries (`internal/revise/spec.md`) is retired.
- Hardening and completion stamps land on the breakout per the existing breakout-stamp rules in `skills/handover/SKILL.md` (index-only entries stop being the no-stamp special case for picked work).
- The earlier follow-ups about anchoring the bullet-entry selector on the bold title and teaching the unwrap detector the indented-continuation shape both retire into this draft; neither is needed under it.

## Open questions

- Location: a `quick-wins/` directory beside `features/` and `bugs/`, or reuse `features/`? The four-index layout and `init-backlog` scaffold would grow a fifth directory.
- Link grammar: `ready.js` reads breakout links only in `FEATURES.md` and `BUGS.md` today, and breakouts must carry no `Requires:`/`External:` line; does the quick-win entry link its breakout (grammar change plus hygiene check), or is the breakout discoverable by slug only?
- Ship-time disposition: fold the breakout into the history entry and delete it, or archive it alongside; the history entry is today the sole durable record for quick wins.
- Grouped breakout identity: one digest per member entry or one merged digest; how a resume re-associates the group after some members ship.
- Whether an unpicked entry may ever grow a breakout early (a capture too big for one line but not yet picked).
