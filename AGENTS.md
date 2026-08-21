# Nightshift repository instructions

This file provides guidance to coding agents working with this repository.

## What this repo is

Nightshift is a Claude Code and Codex plugin: a feature-lifecycle workflow built from markdown slash commands and skills, plus one Node.js parser. Most of the "source" is instruction prose that an agent executes, not code. The repo is also its own plugin marketplace (`.claude-plugin/marketplace.json` with `source: "./"`).

The operational host-neutralization work is tracked by [Agent-host-agnostic Nightshift](.claude/features/agent-host-agnostic-nightshift.md), which preserves `.claude/` as the shared backlog-data namespace on every host.

## Backlogs and indexes

Four repo-local indexes live under `.claude/`. Consult the relevant indexes before proposing or starting related work because a task may already be queued, designed, diagnosed, or covered by an existing pattern:

- `.claude/QUICK_WINS.md`: refactors ready to land when time allows. Shipped entries are appended to `.claude/QUICK_WINS_HISTORY.md` (described below).
- `.claude/FEATURES.md`: product-level feature ideas, with one file per feature under `.claude/features/`. When a change edits a feature file's design content, sync its `FEATURES.md` excerpt in the same change; excerpt-vs-file drift is a recurring review-finding class (three confirmed findings across the 2026-08-13 wave-lifecycle reviews). Shipped entries are appended to `.claude/FEATURES_HISTORY.md` (described below). When sibling feature files start duplicating shared concerns (machinery, patterns, conventions), promote an umbrella file that hosts the shared content and trim the siblings to deltas; cross-references through an umbrella scale better than pairwise cross-references.
- `.claude/BUGS.md`: known bugs awaiting fix, with one file per bug under `.claude/bugs/` when more than a few lines of description is needed. Fixed entries are appended to `.claude/BUGS_HISTORY.md` (described below).
- `.claude/PATTERNS.md`: cross-cutting design patterns that span multiple features, with one file per pattern under `.claude/patterns/`. Complementary to the umbrella-promotion heuristic above: umbrellas cluster children of one family; patterns cluster concerns that span families. A pattern graduates here when the same structure would otherwise be re-described in two or more feature files.

Four locations sit alongside the indexes and are consulted only on demand when relevant work is in flight:

- `.claude/plans/<date>-<slug>.md`: implementation plans produced by the writing-plans workflow. **Ephemeral**: a plan exists while the implementation is in flight and is deleted once the work lands. The code, tests, and commits are the durable record. Plans are purely mechanical step-by-step instructions for the agent doing the work. There is no "implemented plans" archive.
- `.claude/QUICK_WINS_HISTORY.md`: archive of shipped quick wins, split out from `QUICK_WINS.md` so the active backlog stays scannable. Append entries here as soon as the quick win lands; the file itself is consulted only when something pulls it in (a pattern-doc cross-reference, an archaeological lookup, a negative-knowledge sweep). Negative-knowledge entries (approaches attempted and reverted) are first-class promotion candidates into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections.
- `.claude/FEATURES_HISTORY.md`: archive of shipped features and shipped slices, split out from `FEATURES.md` so the active backlog stays scannable. Append entries here as soon as a feature or slice lands.
- `.claude/BUGS_HISTORY.md`: archive of fixed bugs, split out from `BUGS.md`. Append entries here as soon as a bug is fixed.

**Walk-and-remove convention.** When a feature, slice, quick win, or bug-fix ships, the same change set that appends its entry to the relevant history archive ALSO walks every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` and drops references to the just-shipped item; if the dropped reference was the only one on the line, the line becomes `Requires: none.`. Active `Requires:` lines therefore describe what is *currently* blocking, and `/nightshift:ready` never has to consult the history archives to resolve dependencies; the dependency graph settles as work ships.

Brainstorming output lives in feature files (or in patterns when cross-cutting / in bugs when diagnostic) rather than as separate dated specs. Pre-feature exploratory brainstorms land as draft features with `status: exploring` frontmatter and an entry in `FEATURES.md`'s `## Exploring` section; `/nightshift:ready` lists them titles-only as drafts, never in the ready set, and `/nightshift:exploring` shows the full draft list. They graduate to a themed `##` section with a `**Requires:**` line once the design firms up.

The `/nightshift:ready` command parses each entry's `**Requires:**` line in `FEATURES.md` and `BUGS.md` and reports the unblocked work set. Run it when picking what to work on next.

## Development commands

- Run the agreement controller suite: `node skills/spec-agreement/spec-agreement.test.js`.
- Run the ready parser suite: `node skills/ready/ready.test.js` (fixture-based, no framework, exit code 1 on failure).
- Run the revise Workflow safety suite: `node internal/revise/revise-round.test.js`.
- Run the revise rigor derivation suite: `node internal/revise/rigor.test.js`.
- Run the revise orchestration suite: `node internal/revise/orchestration.test.js`.
- Run the universal-skill topology suite: `node --test tests/universal-skill-topology.test.js`.
- Run the host-discovery smoke suite: `node tests/host-discovery-smoke.test.js`.
- CI runs all seven suites on Node 22.
- Run the ready parser manually: `node skills/ready/ready.js [repo-root-or-.claude-dir]` (emits JSON on stdout).
- There is no build or lint step.

## Architecture

The public surface is ten skills under `skills/`: `exploring`, `handover`, `init-backlog`, `ready`, `revise-code`, `revise-docs`, `revise-lore`, `revise-plan`, `revise-spec`, and `spec-agreement`. `handover` is the orchestrator: it detects plan and spec stage gates from content-fingerprinted hardening stamps written by those document review loops, states the read (confirming only when detection is not clean), and drives the remaining lifecycle from spec gate through the morning report. Code review does not stamp source files; its completion is consumed within the active revise or handover flow. Final completion is a separate handover-owned record. `init-backlog` is the large self-contained scaffolder for the four-index `.claude/` backlog layout (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), including the track-vs-ignore version-control election. The public `revise-code`, `revise-plan`, and `revise-spec` wrappers delegate to the shared private engine in `internal/revise/`.

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

Compatible governing-text changes that remain within the accepted digest continue autonomously after a cited contract-fit check.

Most public skills bundle the files they need; a procedure that bundles nothing still belongs here when it is a user-facing surface, since skills reach every host that runs them. The `internal/revise/` engine owns *how* the review run, rounds, reactivation waves, the holistic gate, checkpoints, skeptic verification, and follow-up logging work; the artifact parameter files `code.md` / `plan.md` / `spec.md` own *what* to review (dimensions, model pin, delivery rules, edit surface). Loop-mechanics changes go in `SKILL.md`; dimension or artifact-specific changes go in the parameter file. `.tmp/revise-state.md` is the controller-owned state authority. `revise-round.workflow.js` starts every active review cell concurrently, fans out a completed reviewer's skeptic work immediately (running a low-effort dedup judge first so duplicate-shape findings share one skeptic verdict, surfaced as `sharedVerdictFrom`), and reconciles returned cells and findings by stable ID. The `SKILL.md` manual Agent fallback must preserve the same scheduling and whole-round adjudication barrier while implementing the documented checkpoint and recovery contract; it has no dedup judge and submits one fresh skeptic per finding. `revise-round.test.js` exercises Workflow execution safety. `skills/ready/` is the deterministic backlog-dependency parser (also exports its internals for tests); `ready.test.js` holds the fixture tests. The Requires-line grammar lives only in `ready.js`. If output looks wrong for some backlog shape, fix the grammar and add a fixture test; never hand-approximate the graph in the skill prose. `skills/exploring/` is the second view over that same parser output, rendering `## Exploring` drafts in full (titles, excerpts, breakout links) while `/nightshift:ready` lists them titles-only. It bundles no files of its own and invokes `skills/ready/ready.js`.

The holistic verifier never launches before every applicable cell has certified the current fingerprint.
A run completes only on the conjunction of that wave convergence and a verifier stamp over the same fingerprint. A clean LGTM with a concrete nonblank verification note earns that stamp; only a current verifier round that applies no fix and creates an authoritative deferred follow-up may stamp without one.

Skill prose references bundled files via `${CLAUDE_PLUGIN_ROOT}` so paths resolve in the installed cache.

## Conventions

- Edit this clone, never an installed plugin cache. Every unpushed batch that changes shipped plugin behavior must include exactly one monotonic version increase in `.claude-plugin/plugin.json`. Shipped plugin behavior is public and internal `SKILL.md` procedures, bundled non-test skill resources, `hooks/**`, and every `.claude-plugin/plugin.json` field other than `version`. Repository-only documentation, tests, CI configuration, marketplace metadata, and repository guidance do not independently require a version increase. Pushing remains user-directed. Claude Code installations with auto-update enabled receive a pushed release automatically; manual refresh commands are `claude plugin update nightshift@astenlund` for Claude Code and `codex plugin marketplace upgrade astenlund` for Codex.
- The plugin is self-hosting: review changes to it with its own revise loops, and `revise-lore` routes workflow learnings back into these files.
- `.claude-plugin/plugin.json` carries the version used for update detection. Its `description` must stay in sync with the copy in `.claude-plugin/marketplace.json`.
- Cross-file consistency matters more than usual here: commands and skills describe each other (handover's procedure names the revise commands, the revise parameter files reference handover's fingerprint recipe, README's table and dimension counts mirror the skill files). When changing one file, grep the others for descriptions of it.
- When a live probe or plan verification is intended to exercise the checkout under review, resolve that checkout's root once and derive payload paths, embedded repository references, invocation arguments, and cleanup targets from it. Do not hardcode the canonical clone path, which can cause an isolated worktree run to inspect or clean up a different checkout.
