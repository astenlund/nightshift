# Nightshift

A feature-lifecycle workflow plugin for [Claude Code](https://claude.com/claude-code): four-index project backlogs, dependency-resolved work selection, iterative multi-agent review loops for specs, plans, and code, and a single handover command that takes over the remaining lifecycle from wherever the session stands.

The name is about attendance, not clock time: the human works the day shift (brainstorming, specs, sign-offs), and the plugin runs the night shift (planning, implementation, review, shipping) whenever the human steps out of the loop, at any hour. The core idea underneath: every durable artifact gets fresh-eyes review before it ships. Each round starts one fresh reviewer with no prior conversation context for every active dimension. As each reviewer returns, its findings immediately fan out to fresh skeptics while unrelated reviewers may still be running; the controller waits for the whole round before any finding can influence an edit. A dimension becomes inactive on a clean conclusion, or when a round's findings all land as skeptic-refuted or accepted without an actionable follow-up, certifying the fingerprint it reviewed; settled dimensions are re-reviewed by a reactivation wave whenever the artifact moves past their certification. Once every dimension certifies the current fingerprint, a single fresh holistic verifier reviews the whole artifact, and the run completes only when its stamp lands on that same fingerprint. Markdown scratch checkpoints preserve controller-owned run state, while resumable agent IDs provide best-effort recovery when sessions remain available. Same-context self-review is the shortcut this plugin exists to avoid.

## Install

```
/plugin marketplace add astenlund/nightshift
/plugin install nightshift@astenlund
```

All commands and skills are namespaced: `/nightshift:handover`, `/nightshift:ready`, and so on.

## The workflow

1. **Scaffold** a project once with `/nightshift:init-backlog`. This creates the four-index backlog under `.claude/` (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), history archives, a `plans/` directory, and a SessionStart hook so Claude reads the indexes at the start of every session. It also asks once whether the backlog files should be git-tracked or ignored. Idempotent; re-run to add anything missing.
2. **Capture** feature ideas, bugs, refactors, and cross-cutting patterns in the indexes as they come up. Every feature and bug entry declares its upstream gates on a `**Requires:**` line.
3. **Pick work** with `/nightshift:ready`, which resolves the declared dependency graph (via a deterministic, fixture-tested parser) and reports what's unblocked, what's blocked and on what, and any structural errors in the backlog.
4. **Hand over** with `/nightshift:handover` once a brainstorm has produced a signed-off spec. Handover detects where the feature stands (spec hardened? plan written? implementation done?), states its read in one line (asking for confirmation only when the detection is not clean), then drives the rest: spec gate (including live-system probes for spec claims the repo cannot settle), plan, plan review, implementation via parallel subagents, code review to completion, end-to-end verification, doc updates, backlog bookkeeping, lore capture, full test suite, and a closing morning report that triages everything deferred along the way and persists approved workflow edits. Plan and spec review append content-fingerprinted hardening stamps to their document artifacts, and handover uses those stamps for the corresponding stage gates. Code review does not stamp source files; its completion is consumed within the active revise or handover flow.
5. **Return in the morning** to the report: lore and retrospective outcomes, follow-up items presented one at a time with proposed routes, approved workflow edits persisted, a separate handover-owned completion record on the spec, and an offer to remove the now-ephemeral plan.

## Commands and skills

|                 Name                  |                                                   What it's for                                                   |
|---------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `/nightshift:init-backlog`            | Scaffold or update the four-index backlog structure in a project                                                  |
| `/nightshift:ready`                   | Report the unblocked work set by resolving `**Requires:**` lines (skill; bundles the parser script)               |
| `/nightshift:handover`                | Take over the remaining feature lifecycle from the detected stage, through to shipped                             |
| `/nightshift:revise-code`             | Iterative fresh-agent review of a code change before it ships                                                     |
| `/nightshift:revise-plan`             | Iterative fresh-agent review of an implementation plan before execution                                           |
| `/nightshift:revise-spec`             | Iterative fresh-agent review of a design spec before planning                                                     |
| `/nightshift:revise-docs`             | Update project documentation to reflect implemented work                                                          |
| `/nightshift:revise-lore`             | Persist session learnings into CLAUDE.md files and the plugin itself                                              |

The three `revise-*` review commands share one engine (the `revise` skill), which reviews per dimension (8 dimensions for code, 7 each for plans and specs). Each round starts one fresh reviewer for every active dimension, and each completed reviewer's findings immediately fan out to fresh skeptics while the controller preserves the whole-round adjudication barrier. Dimensions converge independently: a dimension goes inactive on a clean LGTM or when a round's findings are all skeptic-refuted (or accepted without follow-up), certifying the reviewed fingerprint, and a staleness-driven reactivation wave re-reviews settled dimensions once the artifact moves; a holistic verifier gate stamps the converged fingerprint before completion. Markdown scratch checkpoints and resumable agent IDs provide best-effort recovery across interruptions. When the Workflow tool is available, `revise-round.workflow.js` is the preferred fan-out engine; otherwise the controller falls back to manual Agent dispatch with the same scheduling contract. Completed plan and spec review runs append provenance stamps with the date and time, repo HEAD, scope, and content fingerprint, which handover reads for their stage gates. Code review does not stamp source files; its completion remains within the active flow, while final handover completion is recorded separately by handover.

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

Edits to a locally added marketplace apply on plugin reload; no reinstall loop. Run the parser suite with `node skills/ready/ready.test.js`, the Workflow safety suite with `node skills/revise/revise-round.test.js`, and the rigor derivation suite with `node skills/revise/rigor.test.js`. The plugin is self-hosting: its own revise loops are used to review changes to it, and `revise-lore` routes workflow learnings back into these files.

## License

MIT
