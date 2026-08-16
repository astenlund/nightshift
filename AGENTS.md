# Nightshift repository instructions

This file provides guidance to coding agents working with this repository.

## What this repo is

Nightshift is a Claude Code and Codex plugin: a feature-lifecycle workflow built from markdown slash commands and skills, plus one Node.js parser. Most of the "source" is instruction prose that an agent executes, not code. The repo is also its own plugin marketplace (`.claude-plugin/marketplace.json` with `source: "./"`).

The operational host-neutralization work is tracked by [Agent-host-agnostic Nightshift](.claude/features/agent-host-agnostic-nightshift.md), which preserves `.claude/` as the shared backlog-data namespace on every host.

## Commands

- Run the ready parser suite: `node skills/ready/ready.test.js` (fixture-based, no framework, exit code 1 on failure).
- Run the revise Workflow safety suite: `node skills/revise/revise-round.test.js`.
- Run the revise rigor derivation suite: `node skills/revise/rigor.test.js`.
- CI runs all three suites on Node 22.
- Run the ready parser manually: `node skills/ready/ready.js [repo-root-or-.claude-dir]` (emits JSON on stdout).
- There is no build or lint step.

## Architecture

Two kinds of artifacts, with a deliberate split:

- `commands/*.md` are the slash commands. `handover.md` is the orchestrator: it detects plan and spec stage gates from content-fingerprinted hardening stamps written by those document review loops, states the read (confirming only when detection is not clean), and drives the remaining lifecycle from spec gate through the morning report. Code review does not stamp source files; its completion is consumed within the active revise or handover flow. Final completion is a separate handover-owned record. `revise-code.md` / `revise-plan.md` / `revise-spec.md` are thin entry points that delegate to the `revise` skill (the shared review engine, not itself a user-facing command). `init-backlog.md` is the large self-contained scaffolder for the four-index `.claude/` backlog layout (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), including the track-vs-ignore version-control election.
- `skills/` hold the procedures themselves. Most bundle the files they need; a procedure that bundles nothing still belongs here when it is a user-facing surface, since skills reach every host that runs them and commands do not:
  - `skills/revise/`: `SKILL.md` owns *how* the review run, rounds, reactivation waves, the holistic gate, checkpoints, skeptic verification, and follow-up logging work; the artifact parameter files `code.md` / `plan.md` / `spec.md` own *what* to review (dimensions, model pin, delivery rules, edit surface). Loop-mechanics changes go in SKILL.md; dimension or artifact-specific changes go in the parameter file. `.tmp/revise-state.md` is the controller-owned state authority. `revise-round.workflow.js` starts every active review cell concurrently, fans out a completed reviewer's skeptic work immediately (running a low-effort dedup judge first so duplicate-shape findings share one skeptic verdict, surfaced as `sharedVerdictFrom`), and reconciles returned cells and findings by stable ID. The `SKILL.md` manual Agent fallback must preserve the same scheduling and whole-round adjudication barrier while implementing the documented checkpoint and recovery contract; it has no dedup judge and submits one fresh skeptic per finding. `revise-round.test.js` exercises Workflow execution safety.
  - `skills/ready/`: `ready.js` is the deterministic backlog-dependency parser (also exports its internals for tests); `ready.test.js` holds the fixture tests. The Requires-line grammar lives only in `ready.js`. If output looks wrong for some backlog shape, fix the grammar and add a fixture test; never hand-approximate the graph in the skill prose.
  - `skills/exploring/`: the second view over that same parser output, rendering `## Exploring` drafts in full (titles, excerpts, breakout links) while `/nightshift:ready` lists them titles-only. It bundles no files of its own and invokes `skills/ready/ready.js`; it lives here rather than in `commands/` so both views of one JSON contract are the same artifact kind, reachable on every host that runs skills, and so its plugin-root reference is the settled skill-prose kind.

The holistic verifier never launches before every applicable cell has certified the current fingerprint.
A run completes only on the conjunction of that wave convergence and a clean verifier stamp over the same fingerprint.

Skill prose references bundled files via `${CLAUDE_PLUGIN_ROOT}` so paths resolve in the installed cache.

## Conventions

- Edit this clone, never an installed plugin cache. Every unpushed batch that changes shipped plugin behavior must include exactly one monotonic version increase in `.claude-plugin/plugin.json`. Shipped plugin behavior is `commands/**`, `skills/**` except files ending in `.test.js`, `hooks/**`, and every `.claude-plugin/plugin.json` field other than `version`. Repository-only documentation, tests, CI configuration, marketplace metadata, and repository guidance do not independently require a version increase. Pushing remains user-directed. Claude Code installations with auto-update enabled receive a pushed release automatically; manual refresh commands are `claude plugin update nightshift@astenlund` for Claude Code and `codex plugin marketplace upgrade astenlund` for Codex.
- The plugin is self-hosting: review changes to it with its own revise loops, and `revise-lore` routes workflow learnings back into these files.
- `.claude-plugin/plugin.json` carries the version used for update detection. Its `description` must stay in sync with the copy in `.claude-plugin/marketplace.json`.
- Cross-file consistency matters more than usual here: commands and skills describe each other (handover's procedure names the revise commands, the revise parameter files reference handover's fingerprint recipe, README's table and dimension counts mirror the skill files). When changing one file, grep the others for descriptions of it.
- When a live probe or plan verification is intended to exercise the checkout under review, resolve that checkout's root once and derive payload paths, embedded repository references, invocation arguments, and cleanup targets from it. Do not hardcode the canonical clone path, which can cause an isolated worktree run to inspect or clean up a different checkout.
