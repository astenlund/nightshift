---
name: revise-lore
description: "Use when a session has produced learnings worth persisting: user corrections, workflow gaps, or conventions that should outlive the session."
---

# revise-lore

Invoke the `claude-md-management:revise-claude-md` skill (see the README's dependency note if it is not installed), with these additions:

In Step 2 (Find CLAUDE.md Files), also include `~/.claude/CLAUDE.md` as a third destination:

- `CLAUDE.md` - Team-shared (checked into git)
- `.claude.local.md` - Personal/local only (gitignored)
- `~/.claude/CLAUDE.md` - Global cross-project preferences (coding style, tool usage, workflow patterns)

Route learnings to the global file when they aren't specific to this project.

## Reflection prompts: session evidence beyond technical signals

The skill's "Step 1: Reflect" list is technical-skill focused (bash commands, code style, environment quirks, gotchas). It systematically misses two session-evidence classes:

- **Workflow gaps surfaced by earlier revise steps** in the same session. For each repair a sibling skill made, ask "could the upstream step have prevented this if a CLAUDE.md rule, skill checklist item, or project convention had been in place?" If yes, the repair itself is signal, not just the technical fix it applied. The technical fix is in the code; the process fix belongs here.

- **Rationalization around existing rules.** For each point in the session where the user pushed back, corrected, or redirected my approach, ask: was I drifting from a rule that already exists in CLAUDE.md, a memory file, or a skill file? If yes, the abstract rule didn't fire when I needed it. Surface a memory entry that pins the failure mode in closer-to-the-moment language than the abstract rule alone, with a back-reference. Reinforcement, not duplication.

## Additional scope: the nightshift plugin itself

After updating CLAUDE.md files, also review whether any session learnings apply to the nightshift public and internal skills used in this session. Include this skill (`revise-lore`) itself, the meta-loop currently running. Was the CLAUDE.md routing decision (project vs global vs local) clear? Did the skill sweep catch the right files? Did the structure-drift signals fire correctly? The instructions in this file are no more sacred than the instructions they govern; if anything in this run felt awkward, fix it at the source.

Plugin edits go to the nightshift repo clone (find it via `git -C` on the plugin source path, or ask the user where the clone lives), never to the installed plugin cache. For each public or internal skill, check:
- Were any instructions ambiguous or misinterpreted during this session?
- Did the user correct a behavior that the skill should have prevented?
- Is there a workflow pattern that worked well but isn't captured?

Propose changes the same way as CLAUDE.md updates: show the diff, explain why, apply with approval, and commit in the clone (pushing is the user's call).

## Fresh-eyes pass before applying

CLAUDE.md files and plugin files are the most durable, highest-leverage artifacts this workflow touches: an error persisted here shapes every future session on every machine, and same-context self-review is exactly the shortcut the revise skill exists to avoid. Before presenting proposed edits for approval, dispatch one fresh agent (no prior context) over the full set of proposed diffs plus the current content of each target file, checking:

- **Conflicts and overlaps**: does a proposed rule contradict or duplicate an existing rule in the same file or a sibling destination (global vs project CLAUDE.md, public skill file vs internal revise SKILL.md)?
- **Principle shape**: is the rule stated as a principle rather than an enumerated example? (Fresh-eyes complement to the same-context scan below.)
- **Firing conditions**: will the rule actually fire when needed: does its wording contain the concrete trigger words a future session will encounter in the moment, or only abstract vocabulary that won't be top-of-mind?

Fold the agent's findings into the proposals before showing them to the user. This is a single pass, not a dimension loop; its cost is one agent.

## Principles-over-examples scan

Scan every edit produced during this revise-lore run under the rule "prefer principles over enumerated examples." Flag illustrating cases and propose tightenings, catching the regression in the same loop that produces it.
