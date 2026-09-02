# Features

Product-level feature ideas captured during brainstorming. Each entry points at a standalone file under `.claude/features/<slug>.md` with the full design sketch. Check this index before proposing new feature directions in the same territory.

This file is **one of four repo-local indexes** agents consult on demand when relevant (alongside `QUICK_WINS.md`, `BUGS.md`, `PATTERNS.md`). Each entry here is a short paragraph summary plus a `**Requires:**` line, an optional `**External:**` line, and optionally a `**Slices:**` block (formal MVP plus continuations; see `## Slicing` below). For features that are partially done without a formal slice breakdown, describe the partial progress in the entry's own prose: there is no separate marker convention for "partially shipped". The detailed design lives in the linked file. When a feature (or a slice of a sliced feature) ships, append its entry to [`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); do not keep an `## Implemented` section inline.

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice and `/nightshift:init-backlog` unwraps it.

## Requires lines

**Every feature index entry carries a `**Requires:**` line** declaring the upstream gates that block the feature. The line is comma-separated and stays on one physical line (the parser joins a wrapped line, but the line discipline above forbids wrapping). Each item is one of two forms:

- A markdown link to a feature, quick win, or bug entry tracked in one of the four indexes. The reference is a current blocker; under the walk-and-remove convention below, a satisfied dependency is edited out of the line at the moment it ships, so `/nightshift:ready` treats every in-backlog reference as actively blocking.
- The literal word `none.` if there are no upstream gates. An empty label is a structural error; `none.` is the only empty form.

Bare text in `**Requires:**` is a structural error. External primitives (an SDK feature, infrastructure capability, library, hardware, a user decision) go on a separate, optional `**External:**` line directly below it, with the same comma-separated grammar: `**External:** vendor SDK 3.0, hardware enclosure.` Absence is its only empty form, so `none.`, an empty label, or a markdown link in it is a structural error (a link parked there would be invisible to the walk-and-remove convention). A link means an item that is entirely a markdown link; prose that merely contains a link is bare text. `/nightshift:ready` classifies a work unit with at least one in-backlog blocker as Blocked with its externals noted parenthetically, and a work unit with externals and no blocker as External. Every structural error names its remedy.

A missing `Requires:` line is a structural error: every entry must say something. Silence is not the same as `none.`; it indicates the dependency review hasn't been done. The `/nightshift:ready` command parses these lines to compute the unblocked work set.

Downstream relationships (this feature **enables** what) are not encoded structurally. They can be derived by walking the upstream graph in reverse, and over-codifying them creates a second source of truth that drifts. Mention downstream relationships in design prose where they aid understanding.

**Carve-outs:** sections like `## Working hypotheses`, `## Staging`, `## Future directions (not yet designed)`, `## Author tooling`, and `## Exploring` describe pre-feature material (orienting prose, shipping order, shallow placeholders, workflow notes, exploratory brainstorms) rather than ready-to-implement entries. Items in those sections do not carry `Requires:` lines (or, in `## Exploring`'s case, may carry them as historical artifacts only). `/nightshift:ready` ignores the bulleted sections entirely and keeps `## Exploring` out of the readiness set, reporting its entries separately as titles-only drafts; `/nightshift:exploring` renders them in full. Working hypotheses / Staging / Future directions (not yet designed) / Author tooling are bulleted rather than `###` headings, so the `###`-only candidate filter handles them naturally; `## Exploring` holds `###` entries, collected as drafts and never classified.

Concrete entry shape inside the index. The example shows a feature link, a quick-win link, and an External line to show both lines; a real entry only includes whatever it actually depends on:

```markdown
### [<Feature name>](features/slug.md)

<Short paragraph summary.>

**Requires:** [other-feature](features/other-feature.md), [shared
helper extraction](../QUICK_WINS.md#shared-helper-extraction).
**External:** some external primitive.
```

**When a feature is implemented**, move its index entry to [`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); drop its `Requires:` and `External:` lines in the move (history entries don't need them). The feature file stays in place as a historical design record.

**Then walk every other `**Requires:**` line in `FEATURES.md` and `BUGS.md`** and remove references to the just-shipped feature: if it was the only item on the line, set the line to `Requires: none.`. This keeps `Requires:` lines as a literal record of what is *currently* blocking and means `/nightshift:ready` never needs to consult the history file.

**Partially-implemented features** have two routes. If the shipped and remaining work is scoped clearly enough to name a named MVP plus named continuations, use the formal `**Slices:**` block described in `## Slicing` below; `/nightshift:ready` then expands per-slice work units and downstream features can reference specific slices via the `[Feature: slice-name]` link suffix. If the shipped work is real but not yet sliceable (e.g., one layer landed, remaining layers are a wishlist not a planned breakdown), describe the partial progress in the entry's own prose without any special markers. `/nightshift:ready` treats such entries as the `**Requires:**` line dictates; partial progress is editorial context for the reader, not a machine-readable signal.

**After adding a new entry (or a feature breakout file), and after graduating a draft from `## Exploring`, run `/nightshift:ready`** from the repo root so the bundled `skills/ready/ready.js` validates the post-edit backlog. A new entry must parse and its `**Requires:**` line must resolve. A graduation is incomplete until the selected entry is absent from `exploring`, the selected entry or its unshipped slice work units appear in `ready`, `blocked`, or `external`, the selected entry has no structural error or notice, and the transition introduced no new structural error or notice. Surface pre-existing unrelated problems again, but they do not alone block that graduation. A failed parser invocation, missing work index, missing active classification, selected-entry problem, or newly introduced problem stops graduation until corrected and rechecked.

## Slicing

Features that bundle multiple shippable layers under one design split into a named **MVP** plus one or more **continuations**. The MVP is the smallest surface that unblocks downstream features whose `Requires:` line points at this feature; continuations layer extensions on top.

A sliced feature entry carries a `**Slices:**` block listing each slice (MVP first, then continuations) with one or two sentences on what each delivers. The entry's `**Requires:**` line reflects the *next-to-ship* slice (initially MVP).

After MVP ships, the MVP entry moves to [`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); the MVP bullet in the parent's `**Slices:**` block is struck through with a pointer to the history file; the parent entry stays in its themed section; the top-level `**Requires:**` and `**External:**` lines advance to the next-to-ship slice's gates; and every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced the just-shipped slice (bare-link defaults to MVP) is edited to drop the now-satisfied reference. When later continuations have independent gates (they can ship in any order rather than sequentially), each slice bullet may carry inline `**Requires:**` and `**External:**` annotations for documentation. Example shape post-MVP:

````
**Slices:**

- ~~MVP - floating-reference core.~~ (Shipped; see FEATURES_HISTORY.md.)
- **Re-anchor events.** Manual UI re-anchor + `AnchorEvent` plumbing.
- **Late-join replay.** `GetSessionHistory` pull endpoint.
- **`RepertoireChordSource`.** Drop-in replacement consuming chart repertoire.
  **Requires:** [chart-repertoire](features/chart-repertoire.md).

**Requires:** none.
````

Downstream features that need a specific continuation (not just the MVP) encode the slice name in the link's display text:

```
[feature-title: continuation name](features/slug.md)
```

A link without a `: slice-name` suffix resolves to the MVP: the default unblock point.

As each slice ships, append a line to `FEATURES_HISTORY.md`:

```
- [Feature title: slice name](features/slug.md): brief note.
```

The parent entry stays in its themed section until the **last** slice ships, at which point it graduates with the final history line.

`/nightshift:ready` reads the top-level `**Requires:**` and `**External:**` lines and any inline `**Requires:**` and `**External:**` annotations on slice bullets, then reports each unshipped slice as a separate work unit (`[Feature title: slice name]`). A slice is "unshipped" when its bullet in the `**Slices:**` block is *not* struck through; the strikethrough is the live slice-status indicator that `/nightshift:ready` reads. The **first unshipped slice** (top-most non-struck bullet) uses the top-level lines as its gates; other unshipped slices use their inline annotations if present, or have no extra gates if no annotation. All non-MVP slices **implicitly depend on MVP being struck through**, regardless of top-level or inline gates; a continuation is never reported as Ready while MVP is unshipped. A slice may declare an inline `**Requires:**` pointing at another slice of the same feature via the suffixed-link form, useful when one continuation builds directly on another; resolve the reference by checking whether the target slice's bullet is struck through. As each slice ships, append its entry to `FEATURES_HISTORY.md`, strike through its bullet in the parent's `**Slices:**` block, advance the top-level `**Requires:**` and `**External:**` lines to the new next-to-ship slice's gates (dropping `**External:**` when that slice declares none), and walk every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` to drop now-satisfied references.

## Exploring

Pre-dependency-analysis brainstorms live here. An entry is a draft feature whose breakout file carries `status: exploring` in its frontmatter; the design is being firmed up and a `**Requires:**` line isn't expected yet. `/nightshift:ready` lists these drafts titles-only in a clearly-marked not-ready section, never in the readiness set, and `/nightshift:exploring` renders the full draft list. When a draft firms up enough to declare its upstream gates, move it out of `## Exploring` into the appropriate themed `##` section, add the `**Requires:**` line, and drop the `status: exploring` frontmatter on the breakout file. The post-edit `/nightshift:ready` gate in `## Requires lines` is part of graduation, not a later cleanup.

### [Light revise mode](features/light-revise-mode.md)

Draft exploring a lightened variant of the revise review workflows: one fresh reviewer per iteration instead of the full per-dimension swarm, and a curated dimension set that skips the least-relevant dimensions. Prompted by the single-reviewer revise-spec run over `.claude/features/dependency-cycle-detection.md` (2026-08-11).

### [Wave round economy](features/wave-round-economy.md)

Draft exploring how to cut the round count a revise run consumes to converge, prompted by the 2026-08-20 spec run needing three user cap raises. Observed amplifiers: whole-artifact fingerprint granularity, single-finding tail rounds, fix-authored surface, and verifier rounds inside the round cap (the last already a queued quick win). Candidate directions include delta-scoped re-review, convergence-aware batching, and round-economy telemetry first; none committed.

### [Immutable accepted authority for compatible refreshes](features/immutable-accepted-authority.md)

Draft exploring a controller-owned immutable agreement baseline for compatible review fixes. After agreement, confirmed findings either fit the accepted product shape, route to follow-up when they would expand it, or block only when a necessary correction cannot fit and progress cannot safely continue; routine tweaks never trigger renewed user agreement.

### [Controller-owned revise convergence recovery](features/controller-owned-revise-convergence-recovery.md)

Draft exploring longitudinal run-health reflection in the revise controller: persist finding provenance, detect review-induced expansion or non-convergence before mutation, recover against immutable accepted authority, and distinguish issues introduced by, exposed by, or independent of earlier fixes.

### [Review dimension deferral](features/review-dimension-deferral.md)

Draft exploring a dimension-resolution step at review setup: adopt review dimensions from another installed skill carrying rigorous review specs, falling back to the nightshift defaults when none qualifies. Open questions at capture: the detection contract, precedence among qualifying skills, mid-run stability (the resolved set freezes at run start), and fixture impact. Captured 2026-08-20.

### [Authoring guidance overlay](features/authoring-guidance-overlay.md)

Draft exploring a dimension-derived authoring overlay for specs and plans: nightshift's hard-earned lessons (dimension criteria, catch-earlier levers, plan-contract requirements) applied on top of superpowers' authoring process whenever it is installed, and inverted into a native authoring fallback when it is not, so planning never silently degrades to model defaults. Single source of truth is the existing dimension files. Captured 2026-08-21.

### [Review report JSON schema](features/review-report-json-schema.md)

Draft exploring a JSON schema that review agents validate their final report against before the session ends, so malformed output is caught by the reviewer itself instead of forcing the controller to salvage-parse an erroneous report or re-run the review after the agent session has been cleared.

### [Backlog index version](features/backlog-index-version.md)

Draft exploring a durable version marker on each backlog index file (a "backlog index version", distinct from the plugin version), with an instruction and an on-demand check that compares it against the plugin's latest and notifies the user to run `init-backlog` when an index predates the current template.

### [Revise prompt-prefix caching](features/revise-prompt-prefix-caching.md)

Draft exploring two mechanisms for sharing the revise engine's common context across its N concurrent reviewers at cache-read prices with zero independence loss: a byte-identical prompt prefix (identical system prompt and first message, dimension criteria only in the divergent tail; hinges on unprobed cache-boundary mechanics) and a fork-of-primer variant (a fresh agent ingests only the common payload, then forks per dimension; provably caches today but reroutes attribution, repair, and model pinning through the primer). Fork-of-controller is the recorded anti-goal: it would contaminate fresh-eyes review with the controller's context.

### [Bounded revise acknowledgement context](features/bounded-revise-acknowledgement-context.md)

Draft exploring how to bound or scope the revise engine's whole-run acknowledgement context so retry rounds cannot grow every later reviewer and verifier payload without limit. The design must preserve the evidence that suppresses repeated findings while defining compaction, persistence, invalidation, verifier visibility, failure behavior, and parity between Workflow and manual dispatch.

### [Pre-implementation context reset](features/pre-implementation-context-reset.md)

Draft exploring an explicit compaction boundary after plan hardening and before implementation, followed by a mandatory full re-read of the governing spec and hardened plan before implementation dispatch.

### [Lifecycle shape proposal](features/lifecycle-shape-proposal.md)

Draft exploring a lifecycle-shape proposal presented right after the user accepts the decision-complete digest: the controller proposes which lifecycle steps the work warrants (the full ladder of harden spec, write plan, harden plan, implement, review code, verify, docs, lore for a complex feature; a direct jump to implement then revise-code for a trivial bug or quick win), and the user accepts or tweaks that shape before any work begins. Captured 2026-08-23 while a quick-win handover was running the full ladder over a twelve-line backlog bullet.

### [Controller-owned session experiment ledger](features/controller-owned-session-experiment-ledger.md)

Draft exploring a controller-owned, run-scoped experiment ledger that persists only material decisions and evidence at revise-round adjudication and other evidence-producing boundaries, then feeds complete morning-report disposition. `.tmp/handover-report-notes.md` remains the low-noise run-local implementation until the lifecycle is agreed and hardened.

### [Night manager and shift supervisor](features/night-manager-shift-supervisor.md)

Draft exploring a two-level management hierarchy for autonomous Nightshift runs: the Night Manager owns intent, executive judgment, convergence and stop authority, controlled experiments, recovery governance, and the morning report, while an on-demand Shift Supervisor manages workers and minute-by-minute orchestration. Long revise waves produce hourly convergence packets, clean crash or compaction recovery continues automatically, and managerial second opinions remain same-role and same-model until a formal cross-host or cross-provider consultation contract exists.

### [Class-level review deferral valve](features/class-level-review-deferral-valve.md)

Draft exploring a controller-owned diminishing-returns valve for a fuzzy issue family reported in a second consecutive round. The controller may designate the class deferrable then and there, route and log the current finding with a narrow boundary, and acknowledge only that family while every review, staleness, convergence, and verifier gate continues normally.

### [Stage-altitude finding routing](features/stage-altitude-finding-routing.md)

Draft exploring controller-owned routing of valid review findings to the pipeline stage that owns their altitude, including durable `valid-but-plan-altitude` seeds that plan authoring must consume or explicitly reject with a verified record.

### [Code simplifier workflow placement](features/code-simplifier-workflow-placement.md)

Draft exploring whether code simplification belongs in each implementation task, in a Nightshift-owned lifecycle boundary, or in a host-side workflow. The design must select one owner and entry condition without duplicating revise-code's Code Quality dimension or `/simplify`.

### [Review-run command enforcement](features/review-run-command-enforcement.md)

Draft exploring mechanical enforcement that blocks prohibited controller-suite entry points during active review rounds without interfering with legitimate local or post-convergence runs. Authoritative run state, false-positive policy, and recovery behavior remain open design boundaries.

### [Marketplace installation surface](features/marketplace-installation-surface.md)

Draft exploring an explicit, tested policy for which repository paths ship in marketplace installations, prompted by backlog files appearing in the installed plugin. The design must separate runtime resources from repository-maintenance and development-only content, preserve `${CLAUDE_PLUGIN_ROOT}` dependencies, and keep Claude Code and Codex installation surfaces equivalent.

## Review hardening

### [Bundled revise controller](features/bundled-revise-controller.md)

Ship a deterministic revise-state controller under `internal/revise/` (fingerprint, init with pre-seeded acknowledgements, start-round, persist-result with the drift guard, boundary adjudication, and a staleness sweep that refuses to run unless every applicable cell is inactive) so a session stops hand-rolling one per artifact type. The engine prose is already exact; the gap is that the state machine has no executable guard. Prompted by the 2026-08-22 handover, which hand-rolled three near-identical controllers and ran two premature sweeps the prose forbids.

**Requires:** none.

### [Rigor-steered lifecycle](features/rigor-steered-lifecycle.md)

The spec's rigor tier becomes an executable budget every lifecycle step reads: a five-tier scale (minimal, low, medium, high, max) where max is today's full machinery and each lower tier is defined by what it subtracts (count gates and verbatim blocks from the plan, wording dimensions from the spec loop, the plan loop, per-task reviews, the code loop), a severity floor so only behavior-changing findings reopen certified cells, and derivation that starts at minimal and climbs one step per uplift, with an existing safety net and change size as new inputs. Prompted by the 2026-08-22 breakout-dependency-drift handover, a 12-hour run for a 150-line parser fix. Sits above Light revise mode, Wave round economy, and Authoring guidance overlay as their selector.

**Requires:** [Bundled revise controller](features/bundled-revise-controller.md).

### [Audience-category recalibration](features/audience-category-recalibration.md)

Sharpen the audience component-to-category judgment so a repository that is merely public on GitHub does not read as category `public` and earn the top baseline tier: `public` requires actual external adoption signals (forks, stars, known downstream installs), and an unadopted open-source repo maps to `personal use`. Decide whether `AUDIENCE_BASELINE` needs a distinct category or only sharper judgment prose, and sweep the recorded judgments in existing Operating context sections. Uplift predicates stay as-is. Promoted from a quick win on 2026-08-22 because the baseline table it edits is rebased by Rigor-steered lifecycle.

**Requires:** [Rigor-steered lifecycle](features/rigor-steered-lifecycle.md).

### [Second-opinion gates](features/second-opinion-gates.md)

Gate the lifecycle with cheap single-pass reads from a different-model-family agent: one at the completed requirements list before a spec exists, one at the freshly written decision-complete spec after current-session agreement, and one at the hardened spec after exact candidate reuse, cited contract-fit continuation, or renewed agreement. Each read lands before the artifact feeds the next stage. Finding-driven design edits return through the agreement gate for classification; compatible changes continue autonomously, while changed or uncertain contracts require fresh presentation. Over the final artifact the hardened gate replaces the holistic third-phase reviewer role. Findings enter the normal factual-verification and contract-admission pipeline before repair; the gate is a reader, not an authority. Two co-equal cross-family channels are feature-detected at runtime: a `consult`-style MCP tool (reference implementation: McpConsultant) and a non-interactive agent-harness CLI from a different vendor (reference implementation: Codex `codex exec`); the same-family higher-tier or higher-effort read is the fallback only when neither is present.

Present chosen spec for agreement before work shipped before Second-opinion gates.

**Requires:** [Contract-calibrated revise admission](features/contract-calibrated-revise-admission.md).

### [Adversarial repair dialogue](features/adversarial-repair-dialogue.md)

Resolves a skeptic-confirmed, controller-admitted finding through an agent-to-agent repair dialogue: the confirming skeptic proposes and revises an exact repair while the originating reviewer accepts or rejects it with notes. A named follow-up carve-out must prove the current slice remains correct and complete under an enforcing guard; governing-text changes remain a last resort and cannot clear the current review. Accepted repairs may execute through controller-issued disjoint file leases with execution-start EOL baselines, while release, fingerprint advancement, certification, and convergence remain controller-wide barriers. Reviewer acceptance validates the proposal only and never produces LGTM.

**Requires:** [Contract-calibrated revise admission](features/contract-calibrated-revise-admission.md).

### [Verified fixup transactions](features/verified-fixup-transactions.md)

Routes every Nightshift-created fixup through one private deterministic service that proves disjoint repair ownership and an unpublished target, runs normal hooks in an isolated worktree, simulates the complete pending autosquash, and publishes only the verified fixup commit as an ordinary fast-forward. The MVP never rewrites live history and records compact promotion evidence for a manually approved continuation.

**Slices:**

- **MVP - verified fixup creation.** Own fixup creation, simulation, deterministic recovery, and evidence while forbidding autonomous autosquash.
- **Checkpoint autosquash.** After manual promotion from MVP evidence, permit actual autosquash at safe revise-run and lifecycle checkpoints with recovery refs and post-rewrite verification.
  **External:** manual promotion based on sufficient MVP evidence.

**Requires:** none.

### [Durable run identity and concurrency protection](features/durable-run-identity-concurrency.md)

Gives each Nightshift run a frozen durable identity and a scope-hash-scoped scratch home, and protects concurrent same-scope runs from silently overwriting each other. Reverses `internal/revise/SKILL.md`'s "do not add a lock" invariant: a start-of-session boundary check classifies found state as resume (stale heartbeat), live concurrent run (fresh heartbeat, user picks abort or force-break), or foreign/stale (interactive asks, autonomous fails closed). An opaque validated handover-queue persistence binding owns the fixed path, physical identity, ignored and untracked Git policy, stable reads, compare-before-replace, atomic replacement, readback, and stale-state refusal while pure queue transitions remain path-free. Its migration carries queue protocol version 2's `implementationAuditBase` plus `resumeQueue`, `bindImplementationAuditBase`, and `advanceQueue` together, retiring direct buffer/evidence I/O without changing the field lifecycle.

**Requires:** none.

### [Manual review dedup parity](features/manual-review-dedup-parity.md)

Gives Workflow and capable manual dispatch the same conservative same-round finding deduplication. Findings share a verdict only when premise, affected surface, deciding evidence, and frozen contract context when present establish that one fresh skeptic decides both complete claims. Manual registration is completion-driven across earlier in-flight and completed same-round verdicts, failed or uncertain matching launches a fresh skeptic, completed results retain the canonical verdict and source identity, and interruption recovery never relies on a durable pre-verdict dedup decision. Cross-round and cross-run verdict reuse remain explicitly deferred.

**Requires:** none.

### [Content fingerprint helper](features/content-fingerprint-helper.md)

Centralizes selector-aware content extraction, canonical byte framing, and hashing in one bundled Node helper so no controller or reviewer reimplements the recipe. Its byte-oriented core returns selected bytes plus the full digest consumed by the shared agreement skill from one captured baseline, while tagged `partial` (`p-` + 12 hex) and `whole-file` (`w-` + 12 hex) path wrappers serve existing consumers; `partial` excludes only `## Hardening`, so a `Status:` line moves both modes. It replaces the awk/sha256sum recipes in handover and revise, including the code-review patch path, and pins cross-generation parity with the agreement-owned golden corpus.

Present chosen spec for agreement before work shipped before Content fingerprint helper.

Follows the breakout-dependency-drift bug fix (shipped 2026-08-22).

**Requires:** none.

### [Durable scope anchor](features/durable-scope-anchor.md)

Every design spec carries a short, durable `## Scope anchor` near its goal with stable `Requested outcome:` and `Material exclusions:` labels. `Material exclusions: None stated.` is the sole deliberate-empty form and requires agreement; a missing line is incomplete. The anchor is frozen unless the user revises the outcome or exclusions, with the revision recorded, and copied verbatim into reviewer, skeptic, dedup-judge, controller-admission, and verifier context. Interactive legacy specs are backfilled before launch, unattended fresh runs fail closed, and existing checkpoints continue their recorded legacy policy or restart explicitly. It grounds scope expansion without immunizing the chosen design's wiring from findings.

Present chosen spec for agreement before work shipped before Durable scope anchor because the accepted digest authorizes its deliberate-empty exclusion and legacy backfill.

**Requires:** [Pick-time breakouts](features/pick-time-breakouts.md).

### [Contract-calibrated revise admission](features/contract-calibrated-revise-admission.md)

Separates factual verification from authority to change an artifact. Every confirmed or judgment-call finding receives a controller-owned `admitted`, `out-of-contract`, or `uncertain` actionability record grounded in an exact scope-anchor, run-basis, verified-constraint, or correctness-floor citation; only admitted findings may enter repair or authoritative follow-up. Necessary enablers are admitted through a causal trace rather than a separate class, while adjacent improvements and explicit exclusions remain distinguishable out-of-contract cases. A narrow `contract-clean` certification lets a cell or verifier complete when every true finding is outside the frozen contract, with full fingerprint invalidation, crash-resume behavior, spec-less run-basis handling, legacy checkpoint isolation, and conditional durable provenance for nontrivial hardening-derived machinery.

**Requires:** [Durable scope anchor](features/durable-scope-anchor.md).

### [Fix-scoped follow-up rounds](features/fix-scoped-rounds.md)

Narrows the round 2+ payload for a dimension whose own admitted findings produced applied fixes to those fixes plus surrounding context; every active dimension without an own-dimension fix keeps normal delivery. A `contract-clean` result is a no-fix certification and never causes narrowing from an out-of-contract observation. The reactivation wave restores full coverage, and context findings still enter the normal skeptic and admission pipeline. Completion is unaffected because a narrowed-payload review never certifies a fingerprint: certification requires a full-payload review, so completion still rests on full-coverage certifications plus the verifier stamp. Primary rationale is symmetry: a dimension re-reviewing its own fixes no longer incidentally adjudicates siblings' fixes, reducing the accidental privilege still-active dimensions hold today; token and wall-clock savings are a hoped-for secondary benefit, at the cost of catching cross-file fix damage a wave later.

**Requires:** [Contract-calibrated revise admission](features/contract-calibrated-revise-admission.md).

## Host portability

### [Agent-host-agnostic Nightshift](features/agent-host-agnostic-nightshift.md)

Moves Nightshift's canonical workflow surfaces and internal contracts from Claude-specific commands, tools, model names, instruction files, and resource paths to provider-neutral skills plus capability adapters. Claude Code and Codex remain the first supported hosts, while any future local coding-agent host can qualify by implementing the same filesystem, shell, interaction, and fresh-agent capabilities. The shared `.claude/` backlog-data namespace stays unchanged.

The universal-skill MVP and the agreement gate are shipped; every later migration slice preserves that gate.

**Slices:**

- ~~MVP - Universal skill entry points.~~ Shipped in 2.5.0; see [FEATURES_HISTORY.md](FEATURES_HISTORY.md).
- **Portable resource and fingerprint contract.** Remove host-named plugin-root and shell-specific hashing assumptions from bundled-resource consumers.
  **Requires:** [Content fingerprint helper](features/content-fingerprint-helper.md).
- **Host-neutral scaffolding and instruction routing.** Make `init-backlog`, project instructions, and global instructions work without assuming one host's filenames or instruction runtime.
  **Requires:** none.
- **Review host adapters.** Express questions, fresh-agent dispatch, completion, recovery identities, tool guidance, model tiers, optional handover-queue mirroring, and host-compatible turn-state coupling through capability contracts with Claude Code and Codex adapters; runtime and dialogue validators remain authoritative.
  **Requires:** none.
- **Host-neutral documentation and lore.** Route documentation and durable learning updates to canonical instruction sources while preserving host adapters and optional helper integrations.
  **Requires:** [Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Review host adapters](features/agent-host-agnostic-nightshift.md).
- **Packaging and cross-host validation.** Add provider-neutral metadata, supported manifest forms, installation guidance, isolated credential provisioning and preflight, no-secret evidence, and clean-environment behavior checks for every supported host path.
  **Requires:** [Agent-host-agnostic Nightshift: Portable resource and fingerprint contract](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Review host adapters](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Host-neutral documentation and lore](features/agent-host-agnostic-nightshift.md).

**Requires:** [Content fingerprint helper](features/content-fingerprint-helper.md).

## Communication standards

### [Communicate for technically sophisticated, time-constrained users](features/sophisticated-user-communication.md)

Gives Nightshift's user-facing surfaces a declared audience model and communication contract: the user is an accomplished engineer who owns the requirements but is time-constrained, so decisions are surfaced at the behavioral, architectural, and risk level with full precision, routine mechanics are resolved autonomously, and the user is consulted only when a decision materially affects the work. The delegation boundary is phase-split: spec work involves the user, while autonomous execution decides and flags at session end, including scope changes handled naive-first with a backlog refactoring entry in the follow-up.

**Requires:** none.

## Backlog tooling

### [Pick-time breakouts](features/pick-time-breakouts.md)

Materializes each selected index-only Quick Win, feature, or bug into its own permanent governing breakout after the user confirms the complete source entry, then adds only the canonical title link and presents one decision-complete digest over the new file and companion index entry. Quick Win text remains a frozen, grep-friendly captured request with exact drift detection; feature and bug excerpts retain their live synchronization contract. The two-write transition has deterministic crash recovery, dependency authority stays in the index, and no file is created before an entry is picked. It lands after deterministic init-backlog extraction and extends that controller's closed inspection, approval, fingerprint, recovery, and semantic-ownership boundaries to Quick Win breakout prose.

**Requires:** none.

### [Filesystem metadata preservation](features/filesystem-metadata-preservation.md)

Defines which filesystem metadata Nightshift preserves beyond bytes, BOM state, newline form, controlled regions, and meaningful mode bits. The design must separate supported Windows metadata from portable guarantees and define capture, revalidation, failure, and recovery behavior without claiming support for every filesystem attribute.

**Requires:** none.

### [Request-spool Windows DACL hardening](features/request-spool-windows-dacl.md)

Adds protected creation-time Windows DACLs for request-spool confidentiality beyond protocol version 1's inherited repository DACL. The design must define allowed principals, inheritance, creation and verification ordering, failure policy, recovery handling, and security regressions without weakening the existing contract.

**Requires:** none.

### [Recovery artifact physical identity](features/recovery-artifact-physical-identity.md)

Binds owner temporaries, recovery gates, backup stages, and backups to physical filesystem identities before later recovery mutation. The design must select supported platform identity primitives and define capture, revalidation, stale or missing identity behavior, failure handling, and compatibility for existing recovery records.

**Requires:** none.

### [No-replace action destination binding](features/no-replace-action-destination-binding.md)

Maps every no-replace action temporary to its approved final target so stale-owner recovery can recognize the exact post-publication shared-identity topology while rejecting unverified external hard links. The lock-schema and recovery design must preserve current fail-closed topology validation until the required physical-identity evidence exists.

**Requires:** [Recovery artifact physical identity](features/recovery-artifact-physical-identity.md).

### [Executable identity revalidation for Windows launches](features/executable-identity-revalidation.md)

Defines the complete identity lifecycle for trusted executables used by supported Windows launches, including the host, Git, PowerShell, credential probe, and job runner. The design must cover initial capture, per-launch refresh or revalidation, invalidation, same-path replacement, path-component retargeting, stale state, and fail-closed launch behavior.

**Requires:** none.

### [Bounded guidance discovery](features/bounded-guidance-discovery.md)

Bounds recursive guidance discovery deterministically so dependency and build trees cannot impose unbounded traversal and Windows attribute-probe cost. The design must choose a conventional-directory skip policy, a depth or entry budget, or both, then define reporting and fixtures that prove which guidance remains discoverable.

**Requires:** none.

### [Publication lock and resume lifecycle](features/publication-lock-resume-lifecycle.md)

Settles whether publication acquires its runtime lock before durable-state resume detection so one protected inspection can be reused, or formally retains the current safe double read. Any single-pass design must reconcile bootstrap-lock creation and every recoverable crash state before reducing the existing validation work.

**Requires:** none.

### [Turn-sequencer timer ownership](features/turn-sequencer-timer-ownership.md)

Resolves the mismatch between the accepted turn-sequencer timer contract and the settle guard that currently owns live timer handles. The design must either give the sequencer real timer ownership or remove the duplicate timer model, then reconcile phase, deadline, clear and install lifecycles, the governing contract, and tests.

**Requires:** none.

## History

Implemented features are archived in [`FEATURES_HISTORY.md`](FEATURES_HISTORY.md), loaded on demand so the active backlog above stays scannable. When a feature (or slice) ships, append its entry there rather than to this file, AND walk every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`: remove the now-satisfied reference (if it was the only one, set the line to `Requires: none.`). The active `Requires:` lines describe what is *currently* blocking, so `/nightshift:ready` never has to consult the history file; the dependency graph settles as features ship.
