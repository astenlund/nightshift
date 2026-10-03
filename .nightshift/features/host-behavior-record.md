---
name: host-behavior-record
description: Keep observed Claude Code, Codex and model behavior in one findable, dated record that instructions cite and that shows when a claim needs checking again
metadata:
  type: feature
status: exploring
---

# Keep a findable record of host and model behavior

## Origin

Raised by the user on 2026-10-03, outside any run, after asking whether Nightshift has a knowledge base describing Claude and Codex behavior, in their words: "add an exploring entry for collecting knowledge in an easy-to-find place". The question came up while preparing a Claude Code hooks workshop built on Nightshift's Stop hook, whose rehearsals produced most of the seed observations below.

## Current behavior

Checked on 2026-10-03:

- The behavior claims that controllers load live in [the operating brief](../../internal/workflow.md). Line 21 says Codex models tend to yield their turn early, and that Claude Code's models do not and that it exposes no native goal; line 31 records the user's working hypotheses comparing Fable and Astra. [The runtime reference](../../internal/runtime/REFERENCE.md) repeats the Codex claim at line 61. None of these carries a date, a host version or an evidence link.
- Host mechanics are described in [the resource interface](../../internal/releases/REFERENCE.md) and [the runtime reference](../../internal/runtime/REFERENCE.md).
- Observations with dates, versions and stated limits sit in the acceptance and triage reports under `.nightshift/reports` and in bug records, organized by the feature that produced them rather than by host or model.
- Some host quirks exist only in code, such as `internal/runtime/output-loop.js` ending a Codex reviewer stuck streaming whitespace.
- [revise-lore](../../skills/revise-lore/SKILL.md) turns lessons into reviewed instruction proposals, routing project-specific conclusions to the project and cross-project conventions to global instructions. It has no destination for an observation that is evidence rather than a rule.
- [PATTERNS.md](../PATTERNS.md) tracks nothing.

The cost showed on 2026-10-03. The claim that Claude Code has no native goal had gone stale in README.md, the operating brief and [the v3 feature](nightshift-v3.md), since Claude Code 2.1.288 has `/goal`, and nothing flagged it. Correcting those claims is separate work and is not tracked yet.

## Direction

Keep observed host and model behavior in one place that is easy to find. Each observation carries its date, host and version, model, how it was observed, an evidence link and the version at which it was last confirmed. Instructions that rely on a behavior cite the observation, so that a host or model change shows which claims need checking again.

## Seed observations

From the workshop rehearsals on 2026-10-03, outside any Nightshift run, on Linux rather than the verified Windows target, with Claude Code 2.1.288 and Opus 5.5 unless noted. Each was seen in one or a few runs.

- Claude Code has `/goal`, which [its documentation](https://code.claude.com/docs/en/goal) calls a wrapper around a session-scoped prompt-based Stop hook. A separate small model judges the condition from the conversation and does not read files. A goal survived a manual `/compact` and two automatic compactions, and the documentation says resuming restores it; `/clear` and errors the user has to fix clear it, and an `Autocompact is thrashing` error cleared one in a probe. With a task only the user could do, the checker judged the goal not met until the block cap ended the turn; writing that exit into the condition let the goal be met on the first check.
- Claude Code overrides a Stop hook after nine consecutive blocks, reporting "A hook blocked the turn from ending 9 consecutive times — overriding and ending turn", and `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` changes the limit.
- Told "Do the first task in TASKS.md.", Claude kept to that scope over Stop hook feedback asking it to continue, nine times in a row.
- An `AskUserQuestion` dialog keeps the turn open, so no Stop hook or goal check runs while it waits, and by default it waits until someone answers. The `askUserQuestionTimeout` setting has documented limits: it does not count down while the terminal reports focus and never starts in a background session or while Remote Control is connected. Tracked as [Keep the question dialog from holding an unattended Claude Code run](../QUICK_WINS.md#keep-the-question-dialog-from-holding-an-unattended-claude-code-run).
- After compaction, Claude Code re-read a file Claude had edited with its Edit tool but not one Claude had changed with `sed`, consistent with [the documented rule](https://code.claude.com/docs/en/context-window#what-survives-compaction) that it re-reads up to five files Claude read or edited.
- SessionStart hooks matching `compact` ran after both manual and automatic compaction.
- A crashing command hook was reported as a non-blocking error, and the turn ended normally.
- On Codex, the user reports that a goal pauses whenever the agent yields to ask a question and has to be resumed by the user. The Codex version was not recorded.

## Open questions

- Location and shape: one file such as `.nightshift/HOSTS.md`, one file per host, or a new index beside the other four; and whether the plugin ships the record so controllers can read it, which would make its edits shipped behavior with a version increase.
- Entry format: the minimum fields, and how an entry is marked superseded rather than deleted.
- Staleness: whether automatic preparation or the release gate compares recorded versions with the installed hosts and lists entries to recheck, or whether checks stay manual.
- Writers: whether revise-lore, acceptance reports and investigations add entries, and how an observation made outside a run, like the seeds above, is admitted.
- The boundary with rules: when an observation should become an instruction through revise-lore, and how the operating brief cites entries without growing.
- Proportionality: [the vision](../../VISION.md) asks every artifact to justify its upkeep, so the record should cite reports rather than copy them.
- Relations: [Model choice per role: Opus 5.5 versus Fable](opus-versus-fable-role-choice.md), [User-configurable model policy file](model-policy-file.md), [Initial reviewer selection](initial-reviewer-selection.md) and [Structured model teams](structured-model-teams.md) all depend on model observations. [Retrospective routing by audience and instruction precedence](revise-lore-audience-routing.md) decides where lessons go. The archived [controller-owned session experiment ledger](controller-owned-session-experiment-ledger.md) explored run-scoped evidence, not a record that outlives runs.
