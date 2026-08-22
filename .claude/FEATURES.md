# Features

Product-level feature ideas captured during brainstorming. Each entry
points at a standalone file under `.claude/features/<slug>.md` with the
full design sketch. Check this index before proposing new feature
directions in the same territory.

This file is **one of four repo-local indexes** agents consult on demand
when relevant (alongside `QUICK_WINS.md`, `BUGS.md`, `PATTERNS.md`). Each
entry here is a short paragraph summary plus a `**Requires:**` line, an
optional `**External:**` line, and optionally a `**Slices:**` block (formal MVP plus continuations; see
`## Slicing` below). For features that are partially done without a
formal slice breakdown, describe the partial progress in the entry's
own prose: there is no separate marker convention for "partially
shipped". The detailed design lives in the linked file. When a feature
(or a slice of a sliced feature) ships, append its entry to
[`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); do not keep an
`## Implemented` section inline.

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

## Requires lines

**Every feature index entry carries a `**Requires:**` line** declaring
the upstream gates that block the feature. The line is comma-separated;
long lines may wrap across multiple physical lines and `/nightshift:ready` joins
them before parsing. Each item is one of two forms:

- A markdown link to a feature, quick win, or bug entry tracked in one
  of the four indexes. The reference is a current blocker; under the
  walk-and-remove convention below, a satisfied dependency is edited
  out of the line at the moment it ships, so `/nightshift:ready` treats every
  in-backlog reference as actively blocking.
- The literal word `none.` if there are no upstream gates. An empty
  label is a structural error; `none.` is the only empty form.

Bare text in `**Requires:**` is a structural error. External
primitives (an SDK feature, infrastructure capability, library,
hardware, a user decision) go on a separate, optional
`**External:**` line directly below it, with the same comma-separated
and wrap-join grammar: `**External:** vendor SDK 3.0, hardware
enclosure.` Absence is its only empty form, so `none.`, an empty
label, or a markdown link in it is a structural error (a link parked
there would be invisible to the walk-and-remove convention). A link
means an item that is entirely a markdown link; prose that merely
contains a link is bare text. `/nightshift:ready` classifies a work unit
with at least one in-backlog blocker as Blocked with its externals
noted parenthetically, and a work unit with externals and no blocker
as External. Every structural error names its remedy.

A missing `Requires:` line is a structural error: every entry must say
something. Silence is not the same as `none.`; it indicates the
dependency review hasn't been done. The `/nightshift:ready` command parses these
lines to compute the unblocked work set.

Downstream relationships (this feature **enables** what) are not
encoded structurally. They can be derived by walking the upstream graph
in reverse, and over-codifying them creates a second source of truth
that drifts. Mention downstream relationships in design prose where
they aid understanding.

**Carve-outs:** sections like `## Working hypotheses`, `## Staging`,
`## Future directions (not yet designed)`, `## Author tooling`, and
`## Exploring` describe pre-feature material (orienting prose,
shipping order, shallow placeholders, workflow notes, exploratory
brainstorms) rather than ready-to-implement entries. Items in those
sections do not carry `Requires:` lines (or, in `## Exploring`'s
case, may carry them as historical artifacts only). `/nightshift:ready`
ignores the bulleted sections entirely and keeps `## Exploring` out of
the readiness set, reporting its entries separately as titles-only
drafts; `/nightshift:exploring` renders them in full. Working
hypotheses / Staging / Future directions (not yet designed) / Author
tooling are bulleted rather than `###` headings, so the `###`-only
candidate filter handles them naturally; `## Exploring` holds `###`
entries, collected as drafts and never classified.

Concrete entry shape inside the index. The example shows a feature
link, a quick-win link, and an External line to show both lines; a
real entry only includes whatever it actually depends on:

```markdown
### [<Feature name>](features/slug.md)

<Short paragraph summary.>

**Requires:** [other-feature](features/other-feature.md), [shared
helper extraction](../QUICK_WINS.md#shared-helper-extraction).
**External:** some external primitive.
```

**When a feature is implemented**, move its index entry to
[`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); drop its `Requires:` and `External:` lines
in the move (history entries don't need them). The feature file stays
in place as a historical design record.

**Then walk every other `**Requires:**` line in `FEATURES.md` and
`BUGS.md`** and remove references to the just-shipped feature: if it
was the only item on the line, set the line to `Requires: none.`. This
keeps `Requires:` lines as a literal record of what is *currently*
blocking and means `/nightshift:ready` never needs to consult the history file.

**Partially-implemented features** have two routes. If the shipped
and remaining work is scoped clearly enough to name a named MVP plus
named continuations, use the formal `**Slices:**` block described in
`## Slicing` below; `/nightshift:ready` then expands per-slice work units and
downstream features can reference specific slices via the
`[Feature: slice-name]` link suffix. If the shipped work is real but
not yet sliceable (e.g., one layer landed, remaining layers are a
wishlist not a planned breakdown), describe the partial progress in
the entry's own prose without any special markers. `/nightshift:ready` treats
such entries as the `**Requires:**` line dictates; partial progress
is editorial context for the reader, not a machine-readable signal.

**After adding a new entry (or a feature breakout file), run `/nightshift:ready`**
from the repo root to confirm the new entry parses and its `**Requires:**`
line resolves against the real grammar in `skills/ready/ready.js`. A
malformed line (wrapped without the parser's join rule, a misplaced
`none.`, a broken or ambiguous link target, or a missing line entirely)
otherwise sits in the backlog until the next readiness pass surfaces it.

## Slicing

Features that bundle multiple shippable layers under one design split
into a named **MVP** plus one or more **continuations**. The MVP is
the smallest surface that unblocks downstream features whose
`Requires:` line points at this feature; continuations layer
extensions on top.

A sliced feature entry carries a `**Slices:**` block listing each
slice (MVP first, then continuations) with one or two sentences on
what each delivers. The entry's `**Requires:**` line reflects the
*next-to-ship* slice (initially MVP).

After MVP ships, the MVP entry moves to
[`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); the MVP bullet in the
parent's `**Slices:**` block is struck through with a pointer to the
history file; the parent entry stays in its themed section; the
top-level `**Requires:**` and `**External:**` lines advance to the next-to-ship slice's
gates; and every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`
that referenced the just-shipped slice (bare-link defaults to MVP) is
edited to drop the now-satisfied reference. When later continuations
have independent gates (they can ship in any order rather than
sequentially), each slice bullet may carry inline `**Requires:**` and `**External:**`
annotations for documentation. Example shape post-MVP:

````
**Slices:**

- ~~MVP - floating-reference core.~~ (Shipped; see FEATURES_HISTORY.md.)
- **Re-anchor events.** Manual UI re-anchor + `AnchorEvent` plumbing.
- **Late-join replay.** `GetSessionHistory` pull endpoint.
- **`RepertoireChordSource`.** Drop-in replacement consuming chart repertoire.
  **Requires:** [chart-repertoire](features/chart-repertoire.md).

**Requires:** none.
````

Downstream features that need a specific continuation (not just the
MVP) encode the slice name in the link's display text:

```
[feature-title: continuation name](features/slug.md)
```

A link without a `: slice-name` suffix resolves to the MVP: the
default unblock point.

As each slice ships, append a line to `FEATURES_HISTORY.md`:

```
- [Feature title: slice name](features/slug.md): brief note.
```

The parent entry stays in its themed section until the **last** slice
ships, at which point it graduates with the final history line.

`/nightshift:ready` reads the top-level `**Requires:**` and `**External:**` lines and any inline
`**Requires:**` and `**External:**` annotations on slice bullets, then reports each
unshipped slice as a separate work unit (`[Feature title: slice
name]`). A slice is "unshipped" when its bullet in the `**Slices:**`
block is *not* struck through; the strikethrough is the live
slice-status indicator that `/nightshift:ready` reads. The **first unshipped
slice** (top-most non-struck bullet) uses the top-level lines as its
gates; other unshipped slices use their inline annotations if present,
or have no extra gates if no annotation. All non-MVP slices
**implicitly depend on MVP being struck through**, regardless of
top-level or inline gates; a continuation is never reported as Ready
while MVP is unshipped. A slice may declare an inline `**Requires:**`
pointing at another slice of the same feature via the suffixed-link
form, useful when one continuation builds directly on another;
resolve the reference by checking whether the target slice's bullet
is struck through. As each slice ships, append its entry to
`FEATURES_HISTORY.md`, strike through its bullet in the parent's
`**Slices:**` block, advance the top-level `**Requires:**` and `**External:**` lines to the
new next-to-ship slice's gates (dropping `**External:**` when that slice declares none), and walk every other `**Requires:**`
line in `FEATURES.md` / `BUGS.md` to drop now-satisfied references.

## Exploring

Pre-dependency-analysis brainstorms live here. An entry is a draft
feature whose breakout file carries `status: exploring` in its
frontmatter; the design is being firmed up and a `**Requires:**` line
isn't expected yet. `/nightshift:ready` lists these drafts titles-only in a
clearly-marked not-ready section, never in the readiness set, and
`/nightshift:exploring` renders the full draft list. When a draft firms
up enough to declare its upstream
gates, move it out of `## Exploring` into the appropriate themed `##`
section, add the `**Requires:**` line, and drop the `status: exploring`
frontmatter on the breakout file.

### [Rigor-steered lifecycle](features/rigor-steered-lifecycle.md)

Draft exploring how the spec's rigor tier becomes an executable budget every lifecycle step reads: a five-tier scale (minimal, low, medium, high, max) mapping to plan shape (no verbatim blocks or count gates below high), a severity floor so only behavior-changing findings reopen certified cells, per-tier dimension sets and round caps, and derivation inputs for an existing safety net and change size. Prompted by the 2026-08-22 breakout-dependency-drift handover, a 12-hour run for a 150-line parser fix. Sits above Light revise mode, Wave round economy, and Authoring guidance overlay as their selector.

### [Light revise mode](features/light-revise-mode.md)

Draft exploring a lightened variant of the revise review workflows: one fresh reviewer per iteration instead of the full per-dimension swarm, and a curated dimension set that skips the least-relevant dimensions. Prompted by the single-reviewer revise-spec run over `.claude/features/dependency-cycle-detection.md` (2026-08-11).

### [Wave round economy](features/wave-round-economy.md)

Draft exploring how to cut the round count a revise run consumes to converge, prompted by the 2026-08-20 spec run needing three user cap raises. Observed amplifiers: whole-artifact fingerprint granularity, single-finding tail rounds, fix-authored surface, and verifier rounds inside the round cap (the last already a queued quick win). Candidate directions include delta-scoped re-review, convergence-aware batching, and round-economy telemetry first; none committed.

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

## Review hardening

### [Second-opinion gates](features/second-opinion-gates.md)

Gate the lifecycle with cheap single-pass reads from a different-model-family agent: one at the completed requirements list before a spec exists, one at the freshly written decision-complete spec after current-session agreement, and one at the hardened spec after exact candidate reuse, cited contract-fit continuation, or renewed agreement. Each read lands before the artifact feeds the next stage. Finding-driven design edits return through the agreement gate for classification; compatible changes continue autonomously, while changed or uncertain contracts require fresh presentation. Over the final artifact the hardened gate replaces the holistic third-phase reviewer role. Findings enter the normal factual-verification and contract-admission pipeline before repair; the gate is a reader, not an authority. Two co-equal cross-family channels are feature-detected at runtime: a `consult`-style MCP tool (reference implementation: McpConsultant) and a non-interactive agent-harness CLI from a different vendor (reference implementation: Codex `codex exec`); the same-family higher-tier or higher-effort read is the fallback only when neither is present.

Present chosen spec for agreement before work shipped before Second-opinion gates.

**Requires:** [Contract-calibrated revise admission](features/contract-calibrated-revise-admission.md).

### [Adversarial repair dialogue](features/adversarial-repair-dialogue.md)

Resolves a skeptic-confirmed, controller-admitted finding through an agent-to-agent repair dialogue: the confirming skeptic resumes as repair author and the originating reviewer as its adversarial critic, iterating focused turns until the critic accepts the repair, a narrow disagreement blocks, or a safety limit stops the exchange. Neither agent edits the artifact; the controller applies the repair from a returned resolution package. Reviewer acceptance validates the proposal only and never produces LGTM, and any independent pre-existing problem found during the dialogue enters the normal fresh-skeptic and admission pipeline.

**Requires:** [Contract-calibrated revise admission](features/contract-calibrated-revise-admission.md).

### [Durable run identity and concurrency protection](features/durable-run-identity-concurrency.md)

Gives each Nightshift run a frozen durable identity and a scope-hash-scoped scratch home, and protects concurrent same-scope runs from silently overwriting each other. Reverses `internal/revise/SKILL.md`'s "do not add a lock" invariant: a start-of-session boundary check classifies found state as resume (stale heartbeat), live concurrent run (fresh heartbeat, user picks abort or force-break), or foreign/stale (interactive asks, autonomous fails closed). Path relocation only; preserves the Markdown state schema and atomic staging.

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

**Requires:** none.

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
  **Requires:** [Move deterministic init-backlog mechanics out of promptspace](features/deterministic-init-backlog.md).
- **Review host adapters.** Express questions, fresh-agent dispatch, completion, recovery identities, tool guidance, model tiers, and optional handover-queue mirroring through capability contracts with Claude Code and Codex adapters.
  **Requires:** none.
- **Host-neutral documentation and lore.** Route documentation and durable learning updates to canonical instruction sources while preserving host adapters and optional helper integrations.
  **Requires:** [Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Review host adapters](features/agent-host-agnostic-nightshift.md).
- **Packaging and cross-host validation.** Add provider-neutral metadata, supported manifest forms, installation guidance, and clean-environment behavior checks for every supported host path.
  **Requires:** [Agent-host-agnostic Nightshift: Portable resource and fingerprint contract](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Review host adapters](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Host-neutral documentation and lore](features/agent-host-agnostic-nightshift.md).

**Requires:** [Content fingerprint helper](features/content-fingerprint-helper.md).

## Communication standards

### [Communicate for technically sophisticated, time-constrained users](features/sophisticated-user-communication.md)

Gives Nightshift's user-facing surfaces a declared audience model and communication contract: the user is an accomplished engineer who owns the requirements but is time-constrained, so decisions are surfaced at the behavioral, architectural, and risk level with full precision, routine mechanics are resolved autonomously, and the user is consulted only when a decision materially affects the work. The delegation boundary is phase-split: spec work involves the user, while autonomous execution decides and flags at session end, including scope changes handled naive-first with a backlog refactoring entry in the follow-up.

**Requires:** none.

## Backlog tooling

### [Move deterministic init-backlog mechanics out of promptspace](features/deterministic-init-backlog.md)

Moves `init-backlog`'s deterministically-answerable behavior (static template bodies, directory and missing-file creation, and structural edits) out of the prompt and into bundled plugin code or static files, so one-correct-answer steps are executed rather than re-derived, while the genuinely semantic judgments (concept coverage in customized prose, ambiguous merges, when a user decision is required) remain with Claude. Boundary rule: if there is one objectively correct answer, get it out of promptspace. The per-candidate code-vs-file attribution is left open for the implementing session.

Follows the breakout-dependency-drift bug fix (shipped 2026-08-22).

**Requires:** none.

## History

Implemented features are archived in
[`FEATURES_HISTORY.md`](FEATURES_HISTORY.md), loaded on demand so the
active backlog above stays scannable.
When a feature (or slice) ships, append its entry there rather than
to this file, AND walk every other `**Requires:**` line in
`FEATURES.md` / `BUGS.md`: remove the now-satisfied reference (if it
was the only one, set the line to `Requires: none.`). The active
`Requires:` lines describe what is *currently* blocking, so `/nightshift:ready`
never has to consult the history file; the dependency graph settles
as features ship.
