# Nightshift repository instructions

This file provides guidance to coding agents working with this repository.

## What this repo is

Nightshift is a Claude Code and Codex plugin: a feature-lifecycle workflow built from markdown slash commands and skills, plus one Node.js parser. Most of the "source" is instruction prose that an agent executes, not code. The repo is also its own plugin marketplace (`.claude-plugin/marketplace.json` with `source: "./"`).

<!-- TODO(cross-host-migration): Make Nightshift operationally host-agnostic. Resolve canonical project and global instruction files, Claude and Codex SessionStart hooks, Workflow/Agent/TaskCreate/AskUserQuestion tool adapters, plugin-root path resolution, and revise-lore/revise-docs routing. Keep `.claude/` as the shared backlog-data namespace. -->

## Commands

- Run the ready parser suite: `node skills/ready/ready.test.js` (fixture-based, no framework, exit code 1 on failure).
- Run the revise Workflow safety suite: `node skills/revise/revise-round.test.js`.
- CI runs both suites on Node 22.
- Run the ready parser manually: `node skills/ready/ready.js [repo-root-or-.claude-dir]` (emits JSON on stdout).
- There is no build or lint step.

## Architecture

Two kinds of artifacts, with a deliberate split:

- `commands/*.md` are the slash commands. `handover.md` is the orchestrator: it detects plan and spec stage gates from content-fingerprinted hardening stamps written by those document review loops, states the read (confirming only when detection is not clean), and drives the remaining lifecycle from spec gate through the morning report. Code review does not stamp source files; its completion is consumed within the active revise or handover flow. Final completion is a separate handover-owned record. `revise-code.md` / `revise-plan.md` / `revise-spec.md` are thin entry points that delegate to the `revise` skill (the shared review engine, not itself a user-facing command). `init-backlog.md` is the large self-contained scaffolder for the four-index `.claude/` backlog layout (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), including the track-vs-ignore version-control election.
- `skills/` hold the procedures that need bundled files:
  - `skills/revise/`: `SKILL.md` owns *how* the review run, phases, rounds, checkpoints, skeptic verification, and follow-up logging work; the artifact parameter files `code.md` / `plan.md` / `spec.md` own *what* to review (dimensions, model pin, delivery rules, edit surface). Loop-mechanics changes go in SKILL.md; dimension or artifact-specific changes go in the parameter file. `.tmp/revise-state.md` is the controller-owned phase authority. `revise-round.workflow.js` starts every active review cell concurrently, fans out a completed reviewer's skeptic work immediately, and reconciles returned cells and findings by stable ID. The `SKILL.md` manual Agent fallback must preserve the same scheduling and whole-round adjudication barrier while implementing the documented checkpoint and recovery contract. `revise-round.test.js` exercises Workflow execution safety.
  - `skills/ready/`: `ready.js` is the deterministic backlog-dependency parser (also exports its internals for tests); `ready.test.js` holds the fixture tests. The Requires-line grammar lives only in `ready.js`. If output looks wrong for some backlog shape, fix the grammar and add a fixture test; never hand-approximate the graph in the skill prose.

Phase 1 cannot complete the review stage.
Phase 2 or later completes only after at least two phases have converged and the current phase ended with every applicable dimension inactive and no reviewable-content changes.

Skill prose references bundled files via `${CLAUDE_PLUGIN_ROOT}` so paths resolve in the installed cache.

## Conventions

- Edit this clone, never an installed plugin cache. Every unpushed batch that changes shipped plugin behavior must include exactly one monotonic version increase in `.claude-plugin/plugin.json`. Shipped plugin behavior is `commands/**`, `skills/**` except files ending in `.test.js`, `hooks/**`, and every `.claude-plugin/plugin.json` field other than `version`. Repository-only documentation, tests, CI configuration, marketplace metadata, and repository guidance do not independently require a version increase. Pushing remains user-directed. Claude Code installations with auto-update enabled receive a pushed release automatically; manual refresh commands are `claude plugin update nightshift@astenlund` for Claude Code and `codex plugin marketplace upgrade astenlund` for Codex.
- The plugin is self-hosting: review changes to it with its own revise loops, and `revise-lore` routes workflow learnings back into these files.
- `.claude-plugin/plugin.json` carries the version used for update detection. Its `description` must stay in sync with the copy in `.claude-plugin/marketplace.json`.
- Cross-file consistency matters more than usual here: commands and skills describe each other (handover's procedure names the revise commands, the revise parameter files reference handover's fingerprint recipe, README's table and dimension counts mirror the skill files). When changing one file, grep the others for descriptions of it.
