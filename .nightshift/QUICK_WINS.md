# Quick wins

V2 entries are preserved in [the historical index](migration/v2/QUICK_WINS.md) and [MIGRATION_STATUS.md](MIGRATION_STATUS.md). Their retained needs are consolidated into the agreed v3 work or its continuations; this is not a statement that old bugs were fixed or proposals shipped.

## Current

### Init-backlog leaves rewritten files half-staged

Reported from an init-backlog run in another project on 2026-09-11. After apply, `git status` showed `RM` for the five files whose contents the reference rewrite changed: the rename was staged with the pre-rewrite blob and the rewritten content sat unstaged on top, so the agent had to stage them again before committing. `relocateIndex` runs inside the per-file move loop before `updateReferences`, and nothing restages afterwards.

Either restage rewritten destinations at the end of `updateReferences`, which is idempotent on reruns because the journal records the after-hash, or stop touching the index and document that staging is the agent's job. The skill text must describe whichever index state results.

**Requires:** none.

### Init-backlog validates the backlog only after relocating everything

Reported from an init-backlog run in another project on 2026-09-11. The first apply relocated 42 files, rewrote references, updated `.gitignore` and marked the journal complete, then failed with `backlog-validation` because one breakout file carried its own `**Requires:**` line. The message embedded the entire ready report as JSON, about 10 kB, with the single actionable structural error near the end, and the terminal truncated it.

Run the parser's structural checks during `inspect` against the legacy location so the user can repair the backlog before anything moves (the parser currently resolves its backlog directory from the project root, so this needs a root or path parameter), and on failure in `initialize` print only `structuralErrors` and `notices`.

**Requires:** none.

### Init-backlog hard-wrap notices demand one unwrap run per file

Reported from an init-backlog run in another project on 2026-09-11. A successful apply returned ten hard-wrap notices, one per file, each repeating the instruction to run `unwrap.js` on that file, and the skill text prescribes the same per-file loop. `unwrap.js` already accepts multiple targets and prints a per-file report, so the loop is ceremony without a safety benefit.

Either add an opt-in `--unwrap` option to apply that runs the unwrap over every flagged file and includes the per-file report in the result, or collapse the notices into one entry listing all flagged files and the single multi-target command. Keep initialization non-destructive by default.

**Requires:** none.

### Agent-directed rules leak into user-facing prose

Reported from a `/ready` run in another project on 2026-09-11 and repaired for that skill in plugin 3.0.4; the pattern is broader than one skill. Skill texts state constraints for the agent, such as readiness not being agreement, a draft not being authorized implementation work, or a previous review not authorizing a narrowed new pass, and agents echo them to the user as stiff rule quotations, for example "Readiness is not a selection". The user wrote these conventions and does not need them restated.

Add a shared rule to `internal/workflow.md` that separates agent-directed constraints from user-facing phrasing, sweep all eight skills for constraint sentences that read as user-facing prose and rephrase them as closing offers or actions, and check the result with an installed-host probe, since the behavior is model-owned.

**Requires:** none.

## History

Prior delivered work remains in [QUICK_WINS_HISTORY.md](QUICK_WINS_HISTORY.md).
