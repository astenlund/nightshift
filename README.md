# Nightshift

A feature-lifecycle workflow plugin for [Claude Code](https://claude.com/claude-code): four-index project backlogs, dependency-resolved work selection, iterative multi-agent review loops for specs, plans, and code, and a single handover command that takes over the remaining lifecycle from wherever the session stands.

The name is about attendance, not clock time: the human works the day shift (brainstorming, specs, sign-offs), and the plugin runs the night shift (planning, implementation, review, shipping) whenever the human steps out of the loop, at any hour. The core idea underneath: every durable artifact gets fresh-eyes review before it ships. Review agents are dispatched with no prior conversation context, per focused dimension, in pairs, with an adversarial verification stage for their findings, and the loop repeats until every dimension comes back clean. Same-context self-review is the shortcut this plugin exists to avoid.

## Install

```
/plugin marketplace add astenlund/nightshift
/plugin install nightshift@astenlund
```

All commands and skills are namespaced: `/nightshift:handover`, `/nightshift:ready`, and so on.

## The workflow

1. **Scaffold** a project once with `/nightshift:init-workflow`. This creates the four-index backlog under `.claude/` (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), history archives, a `plans/` directory, and a SessionStart hook so Claude reads the indexes at the start of every session. It also asks once whether the backlog files should be git-tracked or ignored. Idempotent; re-run to add anything missing.
2. **Capture** feature ideas, bugs, refactors, and cross-cutting patterns in the indexes as they come up. Every feature and bug entry declares its upstream gates on a `**Requires:**` line.
3. **Pick work** with `/nightshift:ready`, which resolves the declared dependency graph (via a deterministic, fixture-tested parser) and reports what's unblocked, what's blocked and on what, and any structural errors in the backlog.
4. **Hand over** with `/nightshift:handover` once a brainstorm has produced a signed-off spec. Handover detects where the feature stands (spec hardened? plan written? implementation done?), confirms its read in one line, then drives the rest: spec gate, plan, plan review, implementation via parallel subagents, code review to graduation, end-to-end verification, doc updates, backlog bookkeeping, lore persistence, full test suite, and a closing morning report that triages everything deferred along the way. Detection rests on durable provenance stamps (with content fingerprints) that the review loops write into the artifacts at graduation, so a fresh session, a compacted one, or another machine all resume from the same evidence.
5. **Return in the morning** to the report: follow-up items with proposed routes, a completion stamp on the spec, and an offer to remove the now-ephemeral plan.

## Commands and skills

|                 Name                  |                                                   What it's for                                                   |
|---------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `/nightshift:init-workflow`           | Scaffold or update the four-index backlog structure in a project                                                  |
| `/nightshift:ready`                   | Report the unblocked work set by resolving `**Requires:**` lines (skill; bundles the parser script)               |
| `/nightshift:handover`                | Take over the remaining feature lifecycle from the detected stage, through to shipped                             |
| `/nightshift:revise-code`             | Iterative fresh-agent review of a code change before it ships                                                     |
| `/nightshift:revise-plan`             | Iterative fresh-agent review of an implementation plan before execution                                           |
| `/nightshift:revise-spec`             | Iterative fresh-agent review of a design spec before planning                                                     |
| `/nightshift:revise-docs`             | Update project documentation to reflect implemented work                                                          |
| `/nightshift:revise-lore`             | Persist session learnings into CLAUDE.md files and the plugin itself                                              |

The three `revise-*` review commands share one engine (the `revise` skill), which reviews per-dimension (8 dimensions for code, 7 each for plans and specs), two fresh agents per dimension per iteration, with skeptic agents refuting each finding before it's acted on. A dimension graduates only on an iteration that produced no change for it. When the Workflow tool is available, the fan-out runs as a deterministic workflow script with structured findings; otherwise it falls back to Agent-tool dispatch. At graduation the loop stamps the artifact with a provenance line (date and time, repo HEAD, scope, content fingerprint); handover's stage detection reads those stamps.

## Roadmap

- `/nightshift:audit`: an unattended backlog-coherence loop (the night audit): dependency-graph soundness via the ready parser, index/history drift, entries obsoleted by shipped work, staleness against the current repo state.

## Dependencies

- **Node.js** on PATH (the ready parser and the project SessionStart hook use `node`).
- **[superpowers](https://github.com/obra/superpowers)** (optional but recommended): handover uses its `brainstorming`, `writing-plans`, and `subagent-driven-development` skills.
- **claude-md-management** plugin (optional): `revise-lore` builds on its `revise-claude-md` skill.

Without the optional plugins, the corresponding steps degrade gracefully; substitute your own brainstorm/planning approach and drive the revise loops directly.

## Development

```
git clone https://github.com/astenlund/nightshift
/plugin marketplace add ./nightshift
/plugin install nightshift@astenlund
```

Edits to a locally added marketplace apply on plugin reload; no reinstall loop. Run the parser tests with `node skills/ready/ready.test.js`. The plugin is self-hosting: its own revise loops are used to review changes to it, and `revise-lore` routes workflow learnings back into these files.

## License

MIT
