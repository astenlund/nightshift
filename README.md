# Flightdeck

A feature-lifecycle workflow plugin for [Claude Code](https://claude.com/claude-code): four-index project backlogs, dependency-resolved work selection, and iterative multi-agent review loops for specs, plans, and code, orchestrated end to end by takeoff/land commands.

The core idea: every durable artifact gets fresh-eyes review before it ships. Review agents are dispatched with no prior conversation context, per focused dimension, in pairs, with an adversarial verification stage for their findings, and the loop repeats until every dimension comes back clean. Same-context self-review is the shortcut this plugin exists to avoid.

## Install

```
/plugin marketplace add astenlund/flightdeck
/plugin install flightdeck@astenlund
```

All commands and skills are namespaced: `/flightdeck:takeoff`, `/flightdeck:ready`, and so on.

## The workflow

1. **Scaffold** a project once with `/flightdeck:init-workflow`. This creates the four-index backlog under `.claude/` (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), history archives, a `plans/` directory, and a SessionStart hook so Claude reads the indexes at the start of every session. Idempotent; re-run to add anything missing.
2. **Capture** feature ideas, bugs, refactors, and cross-cutting patterns in the indexes as they come up. Every feature and bug entry declares its upstream gates on a `**Requires:**` line.
3. **Pick work** with `/flightdeck:ready`, which resolves the declared dependency graph (via a deterministic, fixture-tested parser) and reports what's unblocked, what's blocked and on what, and any structural errors in the backlog.
4. **Ship a feature** with `/flightdeck:takeoff` after a brainstorm has produced a signed-off spec: it hardens the spec, writes and hardens an implementation plan, implements via parallel subagents, then hands off to `/flightdeck:land`.
5. **Land** finishes the job: code review to graduation, end-to-end verification, doc updates, backlog bookkeeping, lore persistence, full test suite, and a follow-up triage of everything deferred along the way. `/flightdeck:land` also works standalone at the end of a manually driven session.

## Commands and skills

|                 Name                  |                                                   What it's for                                                   |
|---------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `/flightdeck:init-workflow`           | Scaffold or update the four-index backlog structure in a project                                                  |
| `/flightdeck:ready`                   | Report the unblocked work set by resolving `**Requires:**` lines (skill; bundles the parser script)               |
| `/flightdeck:takeoff`                 | Autonomous feature lifecycle: spec gate, plan, implement, then land                                               |
| `/flightdeck:land`                    | Late-stage workflow: review, verify, docs, bookkeeping, lore, tests, triage                                       |
| `/flightdeck:revise code\|plan\|spec` | Iterative fresh-agent review loop (skill); `revise-code` / `revise-plan` / `revise-spec` commands are short forms |
| `/flightdeck:revise-docs`             | Update project documentation to reflect implemented work                                                          |
| `/flightdeck:revise-lore`             | Persist session learnings into CLAUDE.md files and the plugin itself                                              |

The revise skill reviews per-dimension (8 dimensions for code, 7 each for plans and specs), two fresh agents per dimension per iteration, with skeptic agents refuting each finding before it's acted on. A dimension graduates only on an iteration that produced no change for it. When the Workflow tool is available, the fan-out runs as a deterministic workflow script with structured findings; otherwise it falls back to Agent-tool dispatch.

## Dependencies

- **Node.js** on PATH (the ready parser and the project SessionStart hook use `node`).
- **[superpowers](https://github.com/obra/superpowers)** (optional but recommended): takeoff uses its `brainstorming`, `writing-plans`, and `subagent-driven-development` skills.
- **claude-md-management** plugin (optional): `revise-lore` builds on its `revise-claude-md` skill.

Without the optional plugins, the corresponding steps degrade gracefully; substitute your own brainstorm/planning approach and drive the revise loops directly.

## Development

```
git clone https://github.com/astenlund/flightdeck
/plugin marketplace add ./flightdeck
/plugin install flightdeck@astenlund
```

Edits to a locally added marketplace apply on plugin reload; no reinstall loop. Run the parser tests with `node skills/ready/ready.test.js`. The plugin is self-hosting: its own revise loops are used to review changes to it, and `revise-lore` routes workflow learnings back into these files.

## License

MIT
