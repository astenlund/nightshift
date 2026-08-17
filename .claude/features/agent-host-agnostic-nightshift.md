# Agent-host-agnostic Nightshift

Feature: make Nightshift's canonical workflow independent of Claude Code or Codex vocabulary while preserving the behavioral guarantees that make the workflow useful. This file is the authoritative design sketch for the migration.

## Goal and support boundary

A supported host can discover every public Nightshift workflow, scaffold and read the shared backlog, run the revise loops when independent fresh agents are available, complete handover, and persist documentation and workflow learnings without canonical instructions naming that host's commands, tools, models, instruction files, or plugin-root variable.

Claude Code and Codex are the first required adapters. A future local coding-agent host qualifies through the same capability contract. A conversational surface without a repository filesystem or shell is outside this feature's support boundary. Missing optional capabilities degrade only their dependent behavior; missing a capability required for correctness fails that workflow closed with a concrete diagnostic. In particular, a host without independent fresh-agent dispatch can still run `ready`, `exploring`, scaffolding, and documentation workflows, but revise and the review-dependent handover stages do not substitute same-context self-review.

The `.claude/` directory remains the provider-neutral backlog-data namespace. Renaming it would migrate user data without improving workflow portability and is an explicit anti-goal.

## Current host coupling

The migration closes these observed gaps:

- Seven public entry points exist only as Claude command files: `init-backlog`, `handover`, `revise-code`, `revise-plan`, `revise-spec`, `revise-docs`, and `revise-lore`. Skill hosts currently surface only `ready`, `exploring`, and the internal `revise` engine.
- Handover names `TaskCreate` and `AskUserQuestion`. Revise prefers the Claude Workflow runtime and otherwise describes an Agent tool with Claude-shaped session and completion semantics.
- Review profiles pin `sonnet`, `opus`, and the `Explore` agent type, while payloads name host tools such as Read, Grep, and Glob.
- `init-backlog` creates only `CLAUDE.md`; `revise-spec`, `revise-docs`, and `revise-lore` also hardcode Claude instruction destinations.
- Bundled-resource references use `${CLAUDE_PLUGIN_ROOT}`, and fingerprint recipes assume Bash utilities even when the active host shell is PowerShell.
- Plugin descriptions, installation guidance, and the primary manifest layout present Nightshift as Claude-only even though Codex accepts part of the package through compatibility behavior.
- CI verifies the deterministic Node components but does not exercise discovery, scaffolding, review dispatch, recovery, or handover through both supported host adapters.

## Slices

### MVP: universal skill entry points

Move each public workflow to `skills/<name>/SKILL.md` as its canonical source. Retain `commands/*.md` only as thin Claude compatibility shims that invoke the matching skill and contain no duplicated procedure. `revise-code`, `revise-plan`, and `revise-spec` remain separate public skills that supply a fixed artifact type to the internal `revise` engine. Natural-language invocation and explicit scope both remain supported; a missing or ambiguous scope follows the existing inference and ask rules.

Update every cross-reference to name workflows as skills or provider-neutral entry points. This includes handover's nested calls, README tables, failure suggestions emitted by `ready.js`, and repository architecture guidance. The MVP is complete when a clean Claude Code install and a clean Codex install discover the same public workflow set and each compatibility command resolves to exactly one canonical skill.

### Portable resource and fingerprint contract

Resolve bundled files relative to the active skill or through one provider-neutral plugin-root resolver. Canonical skill prose does not depend on a host-named environment variable. A host adapter may consume native variables, including compatibility aliases, but converts them to the common resource contract before workflow logic uses them. A missing or outside-plugin resource path fails closed and names the unresolved resource.

Land the Content fingerprint helper before this slice, then replace the `awk`, `sha256sum`, and `cut` recipes in handover and revise with that Node helper. Moving handover into a skill also moves the canonical provenance rules out of `commands/handover.md`; revise parameter files reference the new skill resource or helper rather than the compatibility shim.

### Host-neutral scaffolding and instruction routing

Land the deterministic init-backlog extraction first, then teach it host-neutral targets. `AGENTS.md` is the canonical project instruction source for a fresh scaffold, and host files such as `CLAUDE.md` are adapters to it. Existing projects are preserved:

- If only one substantive supported instruction file exists, append or merge the backlog section there and create a missing adapter only when it can point at that durable source without duplicating prose.
- If both canonical and host files contain substantive independent instructions, treat consolidation as ambiguous, show the proposed routing, and ask. Do not overwrite either file or silently create a second authority.
- If no supported instruction file exists, create the canonical file and the adapters required by the detected hosts.

The canonical instruction section tells agents to consult relevant indexes on demand before related work.

Project and global instruction discovery returns both the host-facing adapter and the durable source it resolves to. Callers edit the durable source. A pointer, include file, or symbolic link is never replaced merely to normalize the layout.

### Review host adapters

Separate the review invariants from dispatch mechanics. The orchestration transition module and tests land first so adapter work cannot silently change convergence, skeptic verification, repair budgets, stale-result rejection, or the verifier-stamp conjunction.

At run start, select one adapter from observed capabilities and freeze that selection in durable state. The adapter contract covers:

- task queue creation and updates;
- structured user questions with a plain-text fallback;
- fresh reviewer, skeptic, verifier, and dedup-judge submission;
- attributable completion observation;
- optional resume, retry, interruption, and availability checks;
- stable dispatch identity distinct from any optional resume handle;
- semantic model roles and tool-independent payload guidance.

Claude's Workflow script remains an optional acceleration path. Claude manual agents and Codex collaboration agents implement the same manual contract. Workflow or adapter failure maps to the existing cautionary failed state, never a clean or permissive result. Durable handover state, rather than a host task list, becomes the stop authority; hosts may mirror that queue into native task tools.

The frozen adapter selection lives in one immutable `Dispatch adapter` field in the existing run-state body, beside a frozen resolved model-role map. Neither field belongs to the durable-run identity block or its scope hash: adapter choice is execution machinery, not work identity, and excluding it lets the same logical run find its existing state after resuming on another host. A fresh run selects the adapter before its first durable write. A resume reads the state at the work-derived scope hash and reuses the recorded adapter and role map without reselecting. If the current host cannot provide that recorded adapter or one of its mapped models, fail closed with a diagnostic; only an explicit abandon and restart may choose a different adapter. For legacy state with no adapter field, an idle round boundary may select and persist one before any new dispatch, while state with in-flight or partial agent work fails closed for user disposition because its original dispatch semantics cannot be reconstructed safely.

Replace provider model literals in canonical profiles with semantic roles that preserve the present cost and judgment tradeoffs. Each adapter maps only to models it actually exposes, records the resolved mapping in run state, and fails before dispatch when a required role cannot be satisfied. Replace instructions to use named tools with outcomes such as batch search, bounded file reads, or exact edits. Adapter documentation may name host tools where it explains the mapping.

The Durable run identity and concurrency protection feature is adjacent but not a prerequisite. Whichever lands second must preserve the other's frozen run identity, scratch-home, heartbeat, and dispatch-adapter fields rather than introducing a parallel state authority.

### Host-neutral documentation and lore

Make `revise-docs` discover project documentation and every supported instruction adapter, then edit only the durable source behind an adapter. Make `revise-lore` own provider-neutral reflection and routing rather than requiring the Claude-specific `claude-md-management` plugin. A compatible external skill can accelerate the scan, but its absence does not remove the Nightshift workflow.

Discover project, local, and global instruction destinations through the active host adapter, but write every learning only to the resolved durable source. When no durable global destination can be identified, report the proposed learning in the session or handover follow-up list and do not guess a path. Preserve the existing fresh-eyes and user-approval gates for workflow-instruction changes on every host.

### Packaging and cross-host validation

Make the manifest description and README provider-neutral. Ship the manifest forms required for the supported plugin directories from one synchronized metadata source or with a parity check, while retaining compatibility with Claude's marketplace. Document install, update, and invocation for Claude Code and Codex.

Add fixture or smoke coverage for the adapter boundaries and generated files. The completion matrix includes:

- public skill discovery and Claude command-shim delegation;
- fresh and repeated scaffold runs with no instructions, one substantive instruction source, and conflicting substantive sources;
- `ready` and `exploring` from both installed layouts;
- spec, plan, and code review through Claude Workflow, Claude manual agents, and Codex collaboration agents;
- interrupted review recovery with available and unavailable agent handles;
- handover queue persistence, follow-up questions, documentation, lore, and morning-report completion;
- Windows and Linux resource paths and fingerprints.

Every matrix cell either passes or records a deliberate unsupported-capability diagnostic. An unavailable host installation is marked provisional rather than claimed from prose inspection. Release is blocked on clean Claude Code and Codex paths for every capability both hosts expose.

## Related backlog work

- [Content fingerprint helper](content-fingerprint-helper.md) is a prerequisite for the portable resource and fingerprint slice.
- [Move deterministic init-backlog mechanics out of promptspace](deterministic-init-backlog.md) is a prerequisite for host-neutral scaffolding.
- [Review orchestration tests](review-orchestration-tests.md) is a prerequisite for review host adapters.
- [Durable run identity and concurrency protection](durable-run-identity-concurrency.md) shares durable state and scratch-path concerns but can land on either side of the adapter slice under the reconciliation rule above.
- [Second-opinion gates](second-opinion-gates.md) remains responsible for cross-model-family review. Semantic model roles introduced here must not collapse that feature's distinct-family requirement into a same-provider tier choice.

## Status

Captured and sliced from the 2026-08-17 cross-host audit, with the backlog shape approved by the user. Each slice still requires its normal brainstorming and revise-spec hardening before implementation.

## Requirements

- Preserve every current review invariant while changing dispatch mechanics.
- Keep `.claude/` as the shared backlog-data namespace.
- Keep canonical workflow procedures single-sourced in skills; compatibility surfaces contain delegation only.
- Treat absent correctness-critical host capabilities as explicit fail-closed states.

**Requires:** none (FEATURES.md index entry; slice-level gates are authoritative).

## Hardening

- (None yet; this file has not been through a revise-spec run.)
