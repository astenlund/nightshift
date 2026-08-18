# Agent-host-agnostic Nightshift

Feature: make Nightshift's canonical workflow independent of Claude Code or Codex vocabulary while preserving the behavioral guarantees that make the workflow useful. This file is the authoritative design sketch for the migration.

## Goal and support boundary

A supported host can discover every public Nightshift workflow, scaffold and read the shared backlog, run the revise loops when independent fresh agents are available, complete handover, and persist documentation and workflow learnings without canonical instructions naming that host's commands, tools, models, instruction files, or plugin-root variable.

Claude Code and Codex are the first required adapters. A future local coding-agent host qualifies through the same capability contract. A conversational surface without a repository filesystem or shell is outside this feature's support boundary. Missing optional capabilities degrade only their dependent behavior; missing a capability required for correctness fails that workflow closed with a concrete diagnostic. In particular, a host without independent fresh-agent dispatch can still run `ready`, `exploring`, scaffolding, and documentation workflows, but revise and the review-dependent handover stages do not substitute same-context self-review.

The `.claude/` directory remains the provider-neutral backlog-data namespace. Renaming it would migrate user data without improving workflow portability and is an explicit anti-goal.

## Operating context

Nightshift is a locally installed, personal-use coding-agent plugin. The migration is reversible through git and a versioned plugin release, but its entry points are the foundation for every later host-neutralization slice. Compatibility therefore warrants strong cross-host validation even though the feature is not an always-on service.

The workflows run with the developer's repository permissions. Validation may need isolated host profiles, but credentials must never enter repository evidence, logs, fixtures, or committed files. Temporary host state must be isolated from the developer's normal profile and cleaned after the run, with failures reported rather than hidden.

The audience is one expert developer using a personal plugin. A failed migration can temporarily hide workflows or run an unintended local procedure, but it does not directly affect production users or irreplaceable data. Concurrent product use is not expected; compatibility across Claude Code and Codex is the material coordination risk. Git and versioned releases make recovery cheap, while the public entry topology is expected to remain the long-lived foundation for later portability slices.

Rigor derivation: audience category `personal use` gives a low baseline. The compatibility predicate fires because the same release must work on two independently evolving hosts, and the expected-lifetime predicate fires because later slices build on this topology. Deployment criticality, failure consequence, and reversibility predicates do not fire. Two uplifts produce a high tier, so validation, recovery, compatibility, observability, and proof effort are high. This governs the strength of observable acceptance and implementation verification; it does not require implementation protocols to be designed in this spec.

## Design provenance

This ledger records why the MVP's nontrivial decisions exist. It calibrates review but does not make any decision immune from challenge. When a finding targets hardening-derived machinery, first test whether that machinery belongs at this abstraction level; prefer removing or generalizing unnecessary machinery over specifying it more deeply. Any new machinery added during hardening must gain an entry here in the same edit and name the observable requirement it serves. If that link cannot be stated, it belongs in the implementation plan or not at all.

**User-directed:** use skills as the universal entry surface; expose the three artifact-specific revise wrappers rather than a generic public revise entry; keep the shared revise engine internal so public discovery shows the workflows users can actually choose; and preserve `.claude/` as the shared backlog-data namespace.

**Existing constraints:** keep every workflow and shared engine single-sourced; preserve current production behavior while discovery moves; retain revise scope inference when a wrapper receives no scope; keep correctness-critical missing capabilities fail-closed; and leave dispatch, instruction routing, lore routing, resource resolution, and packaging to their named later slices.

**Hardening-derived:** user-visible `REVISE_ENGINE_UNAVAILABLE` diagnostics make the wrapper failure boundary observable; wrapper source owns one exact stable fallback line, while installed-host smoke accepts a nonempty provider-rendered diagnostic because Codex may replace source literals at its native error boundary; the topology test proves public and private ownership without freezing private implementation contents; distinct artifact-specific wrapper triggers preserve the discoverability rationale without freezing exact wording; clean and repeat host smoke proves fresh discovery, the legacy transition, and same-candidate replacement; a committed offline `2.4.5` baseline makes that transition reproducible; side-effect-free entry and wrapper checks prove dispatch without starting production workflows; a procedure-fidelity check prevents routing-only smoke from accepting stubbed migrations; installed-engine resolution prevents packaging from silently omitting production resources; candidate-byte binding prevents stale results; and provisional local completion plus an all-host release gate distinguishes honest local progress from release authority.

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

Move every public workflow to `skills/<name>/SKILL.md` as its canonical source and remove `commands/` entirely. Current Claude Code exposes plugin skills directly through the same namespaced slash-command surface and treats command files as legacy, so command shims would be duplicate sources rather than compatibility support.

The public set after this slice is exactly:

- `init-backlog`
- `ready`
- `exploring`
- `handover`
- `revise-code`
- `revise-plan`
- `revise-spec`
- `revise-docs`
- `revise-lore`

This set is the post-MVP baseline, not a permanent cap. A later feature that adds a public workflow must update the topology and host-discovery expectations in the same change.

Keep `revise-code`, `revise-plan`, and `revise-spec` as separate public skills for discoverability. Do not expose a generic public `revise` skill: alongside the wrappers it creates overlapping routes, while replacing them hides the artifact workflows behind a required type argument. Move the shared revise engine and its bundled files to `internal/revise/`, outside the public skill-discovery tree.

Each wrapper retains its distinct legacy artifact-specific description and trigger semantics so host discovery continues to present code, plan, and spec review as separate choices; exact wording is not frozen. Each wrapper supplies its fixed artifact type and forwards usable host-delivered scope text without intentional normalization. Missing, empty, or whitespace-only scope is treated as omitted, leaving the existing engine responsible for inference and clarification. Hosts may derive scope from their native invocation surface; raw command-line lexical fidelity is not required. A missing or unreadable engine makes wrapper source emit exactly `REVISE_ENGINE_UNAVAILABLE ../../internal/revise/SKILL.md`, then stop before review work begins; a host may instead render a provider-native diagnostic at that error boundary. The wrappers contain delegation and this failure boundary only.

Move `init-backlog`, `handover`, `revise-docs`, and `revise-lore` from command files into same-named public skills without redesigning their production behavior. Their complete legacy procedures and trigger contracts remain intact except for the topology and reference changes required by this slice. This slice changes discovery and ownership, not review convergence, task dispatch, instruction routing, lore routing, general bundled-resource resolution, or packaging. Those concerns remain in their dedicated later slices so a discovery regression has one clear source and rollback boundary.

Update active references to the new topology. This includes workflow-to-workflow calls, README inventory and invocation examples, CI paths, ready-parser suggestions, repository architecture and release guidance, the four backlog indexes, active feature designs that name moved files, and moved revise-engine self-references. Migration fixtures and historical records keep legacy paths because they describe the old state. Active runtime, CI, guidance, and future-work references must not treat `commands/**` or `skills/revise/**` as current locations after the migration.

#### Acceptance

A deterministic topology test must prove:

- the exact nine public skill directories and their `SKILL.md` entries exist;
- `commands/` and the public `skills/revise/` tree are absent;
- `internal/revise/` contains the relocated shared engine, artifact profiles, runtime support, and tests needed to preserve current behavior, with no stale or publicly discoverable copy left under `skills/revise/`;
- each revise wrapper targets the internal engine, fixes the correct artifact type, forwards representative usable scope text without intentional normalization, and maps omitted or blank scope to engine inference;
- each revise wrapper retains distinct artifact-specific trigger semantics in its public discovery metadata;
- static wrapper source contains exactly the single fallback line `REVISE_ENGINE_UNAVAILABLE ../../internal/revise/SKILL.md` and stops before review work;
- CI runs the topology test, the relocated revise suites, and the existing ready suite.

Installed-host smoke covers Claude Code and Codex through the plugin mechanisms each host supports. For each host it runs:

- `clean`: install the candidate into an empty isolated profile and verify discovery and invocation;
- `repeat`: install the committed `2.4.5` legacy fixture, verify its old topology, replace it with the candidate and verify the new topology, then apply the same candidate once more and verify it again.

The legacy baseline is a committed offline representation of the `2.4.5` public topology so the migration input cannot drift. Baseline checks require discovery of `ready`, `exploring`, and public `revise`; Claude also proves its seven legacy command entries, while Codex proves those command-only entries are not skills. The implementation plan chooses the smallest faithful baseline and invocation fixtures.

Every candidate checkpoint requires all nine public skills, no public `revise`, no legacy command surface, no installed `skills/revise` tree, and a side-effect-free host invocation check for each newly migrated substantial entry: `init-backlog`, `handover`, `revise-docs`, and `revise-lore`. Success means the intended installed entry is reached and identified by an entry-specific observation without starting its production workflow. `ready` and `exploring` require discovery only because they are already public skills before this slice. The three revise wrappers are checked separately for artifact-type selection, forwarding of representative usable scope text, omitted or blank scope inference, and a nonempty schema-valid provider-rendered missing or unreadable engine diagnostic without running a production review loop. Each installed candidate checkpoint also proves that every production wrapper can resolve the installed shared engine, its artifact-specific profile, and its required bundled runtime resources without executing the engine.

Acceptance also proves that each migrated substantial entry preserves its complete legacy procedure and trigger contract except for the approved topology and reference changes. The implementation plan chooses the proof technique; entry routing alone is insufficient.

The smoke must bind every result to the candidate bytes it installed, reject stale or mixed evidence, isolate host state from the developer's normal profile, avoid recording credentials, and clean its disposable state. The implementation plan owns the fixtures, safe invocation technique, engine-isolation technique, and the simplest reliable evidence mechanism. This design does not prescribe a process architecture, event grammar, serialization format, lock protocol, or recovery state machine.

An unavailable required host may be recorded as provisional for local completion, with the missing host and required external run named in the report. A push or release containing this MVP still requires clean and repeat passes on both Claude Code and Codex against the same candidate. Prose inspection or a pass from an older candidate cannot satisfy that gate.

#### Explicit non-goals

- Command shims are not retained.
- Production revise execution is not part of the wrapper smoke; later review-adapter validation owns it.
- This slice does not redesign host dispatch, instruction files, lore routing, resource resolution, manifests, or installation guidance.
- The host smoke is acceptance infrastructure, not a new general-purpose plugin conformance framework.

### Portable resource and fingerprint contract

Resolve bundled files relative to the active skill or through one provider-neutral plugin-root resolver. Canonical skill prose does not depend on a host-named environment variable. A host adapter may consume native variables, including compatibility aliases, but converts them to the common resource contract before workflow logic uses them. A missing or outside-plugin resource path fails closed and names the unresolved resource.

Land the Content fingerprint helper before this slice, then consume and verify its provider-neutral fingerprint contract from handover and revise. That prerequisite owns replacing the inline shell recipes and relocating their consumers; this slice owns provider-neutral bundled-resource resolution. The handover skill owns the canonical provenance rules after the MVP, and revise parameter files reference that skill resource or the helper rather than a retired command file.

### Host-neutral scaffolding and instruction routing

Land the deterministic init-backlog extraction and the spec-agreement gate first, then teach init-backlog host-neutral targets while preserving that gate's project-guidance reinforcement. `AGENTS.md` is the canonical project instruction source for a fresh scaffold, and host files such as `CLAUDE.md` are adapters to it. Existing projects are preserved:

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

This combined slice requires both host-neutral scaffolding and the Review host adapters slice: `revise-docs` remains usable without independent dispatch, but `revise-lore` cannot certify or apply instruction edits until a fresh-agent adapter is available. On a host without that optional capability, lore candidates may be surfaced as unapplied follow-ups; they do not bypass the fresh-eyes gate.

Discover project, local, and global instruction destinations through the active host adapter, but write every learning only to the resolved durable source. When no durable global destination can be identified, report the proposed learning in the session or handover follow-up list and do not guess a path. Preserve the existing fresh-eyes and user-approval gates for workflow-instruction changes on every host.

### Packaging and cross-host validation

Make the manifest description and README provider-neutral. Ship the manifest forms required for the supported plugin directories from one synchronized metadata source or with a parity check, while retaining compatibility with Claude's marketplace. Document install, update, and invocation for Claude Code and Codex.

This slice must explicitly extend or replace the MVP host smoke rather than create a second release authority. Add fixture or smoke coverage for the adapter boundaries and generated files. The completion matrix includes:

- public skill discovery, absence of legacy command surfaces, and exclusion of the internal revise engine;
- fresh and repeated scaffold runs with no instructions, one substantive instruction source, and conflicting substantive sources;
- `ready` and `exploring` from both installed layouts;
- spec, plan, and code review through Claude Workflow, Claude manual agents, and Codex collaboration agents;
- interrupted review recovery with available and unavailable agent handles;
- handover queue persistence, follow-up questions, documentation, lore, and morning-report completion;
- Windows and Linux resource paths and fingerprints.

Every matrix cell either passes or records a deliberate unsupported-capability diagnostic. An unavailable host installation is marked provisional rather than claimed from prose inspection. Release is blocked on clean Claude Code and Codex paths for every capability both hosts expose.

## Related backlog work

- [Content fingerprint helper](content-fingerprint-helper.md) is a prerequisite for the portable resource and fingerprint slice.
- [Move deterministic init-backlog mechanics out of promptspace](deterministic-init-backlog.md) and [Present chosen spec for agreement before work](present-spec-for-agreement.md) are prerequisites for host-neutral scaffolding.
- [Review orchestration tests](review-orchestration-tests.md) is a prerequisite for review host adapters.
- [Durable run identity and concurrency protection](durable-run-identity-concurrency.md) shares durable state and scratch-path concerns but can land on either side of the adapter slice under the reconciliation rule above.
- [Second-opinion gates](second-opinion-gates.md) remains responsible for cross-model-family review. Semantic model roles introduced here must not collapse that feature's distinct-family requirement into a same-provider tier choice.
- [Present chosen spec for agreement before work](present-spec-for-agreement.md) depends on the universal-skill MVP so it can broaden the canonical handover skill's trigger to direct spec-governed lifecycle work in both supported hosts. Later migration slices preserve that gate rather than moving authorization back into a host adapter.
- [Adversarial repair dialogue](adversarial-repair-dialogue.md), [Durable scope anchor](durable-scope-anchor.md), and [Fix-scoped follow-up rounds](fix-scoped-rounds.md) depend on this MVP before adding or changing `internal/revise/` behavior. [Communicate for technically sophisticated, time-constrained users](sophisticated-user-communication.md) depends on the migrated public workflow surfaces. These entries should land after the topology move to avoid editing paths that the MVP immediately relocates.
- The active quick wins `Handover shift-start confirmation heuristic`, `Rigor calibration`, and `Handover dispatch hygiene` edit handover or revise sources that this MVP relocates. Prefer landing the MVP first; if any of those quick wins lands earlier, carry its behavior forward unchanged during relocation.

## Status

Captured and sliced from the 2026-08-17 cross-host audit, with the backlog shape approved by the user. The universal-skill MVP design was approved on 2026-08-18 and pruned to product behavior plus observable acceptance after its first hardening attempt over-specified the validation harness. Every later slice still requires its own brainstorming, and every slice requires revise-spec hardening before implementation.

## Requirements

- Preserve every current review invariant while changing dispatch mechanics.
- Keep `.claude/` as the shared backlog-data namespace.
- Keep each public workflow single-sourced in its public skill and each shared engine single-sourced outside the public skill-discovery tree; public wrappers contain only delegation and the specified engine-availability failure boundary.
- Treat absent correctness-critical host capabilities as explicit fail-closed states.

**Requires:** none (FEATURES.md index entry; slice-level gates are authoritative).

## Hardening

- revise-spec graduated 2026-08-18 12:23 at 00477d1, scope: whole file, content: 7bd65df7
- revise-spec refreshed 2026-08-18 16:51 at a71e414, scope: whole file, content: 93ee0ad0 (host-rendered diagnostic reconciliation)
