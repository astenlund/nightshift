# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

Nightshift is a Claude Code plugin: a feature-lifecycle workflow built from markdown slash commands and skills, plus one Node.js parser. Most of the "source" is instruction prose that Claude executes, not code. The repo is also its own plugin marketplace (`.claude-plugin/marketplace.json` with `source: "./"`).

## Commands

- Run tests: `node skills/ready/ready.test.js` (the only test suite; fixture-based, no framework, exit code 1 on failure). CI runs exactly this on Node 22.
- Run the ready parser manually: `node skills/ready/ready.js [repo-root-or-.claude-dir]` (emits JSON on stdout).
- There is no build or lint step.

## Architecture

Two kinds of artifacts, with a deliberate split:

- `commands/*.md` are the slash commands. `handover.md` is the orchestrator: it detects the feature's current stage (via provenance stamps with content fingerprints that the revise loops write at graduation), confirms the read, and drives the remaining lifecycle from spec gate through the morning report. `revise-code.md` / `revise-plan.md` / `revise-spec.md` are thin entry points that delegate to the `revise` skill (the shared review engine, not itself a user-facing command). `init-workflow.md` is the large self-contained scaffolder for the four-index `.claude/` backlog layout (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), including the track-vs-ignore version-control election.
- `skills/` hold the procedures that need bundled files:
  - `skills/revise/`: `SKILL.md` owns *how* the review loop runs (iteration state, graduation criteria, skeptic verification, follow-up logging); the artifact parameter files `code.md` / `plan.md` / `spec.md` own *what* to review (dimensions, model pin, delivery rules, edit surface). Loop-mechanics changes go in SKILL.md; dimension or artifact-specific changes go in the parameter file. `revise-iteration.workflow.js` is the Workflow-tool script for one iteration (2 reviewers per dimension, then one skeptic per finding); the SKILL.md Agent-tool fallback must stay behaviorally equivalent to it.
  - `skills/ready/`: `ready.js` is the deterministic backlog-dependency parser (also exports its internals for tests); `ready.test.js` holds the fixture tests. The Requires-line grammar lives only in `ready.js`. If output looks wrong for some backlog shape, fix the grammar and add a fixture test; never hand-approximate the graph in the skill prose.

Skill prose references bundled files via `${CLAUDE_PLUGIN_ROOT}` so paths resolve in the installed cache.

## Conventions

- Edit this clone, never the installed plugin cache. Propagate local edits to the installed copy with `claude plugin update nightshift@astenlund`.
- The plugin is self-hosting: review changes to it with its own revise loops, and `revise-lore` routes workflow learnings back into these files.
- `plugin.json` carries the version; bump it when releasing. Its `description` must stay in sync with the copy in `marketplace.json`.
- Cross-file consistency matters more than usual here: commands and skills describe each other (handover's procedure names the revise commands, the revise parameter files reference handover's fingerprint recipe, README's table and dimension counts mirror the skill files). When changing one file, grep the others for descriptions of it.
