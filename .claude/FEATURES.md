# Features

Product-level feature ideas captured during brainstorming. Each entry
points at a standalone file under `.claude/features/<slug>.md` with the
full design sketch. Check this index before proposing new feature
directions in the same territory.

This file is **one of four repo-local indexes** agents consult on demand
when relevant (alongside `QUICK_WINS.md`, `BUGS.md`, `PATTERNS.md`). Each
entry here is a short paragraph summary plus a `**Requires:**` line, and
optionally a `**Slices:**` block (formal MVP plus continuations; see
`## Slicing` below). For features that are partially done without a
formal slice breakdown, describe the partial progress in the entry's
own prose: there is no separate marker convention for "partially
shipped". The detailed design lives in the linked file. When a feature
(or a slice of a sliced feature) ships, append its entry to
[`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); do not keep an
`## Implemented` section inline.

## Requires lines

**Every feature index entry carries a `**Requires:**` line** declaring
the upstream gates that block the feature. The line is comma-separated;
long lines may wrap across multiple physical lines and `/nightshift:ready` joins
them before parsing. Each item is one of three forms:

- A markdown link to a feature, quick win, or bug entry tracked in one
  of the four indexes. The reference is a current blocker; under the
  walk-and-remove convention below, a satisfied dependency is edited
  out of the line at the moment it ships, so `/nightshift:ready` treats every
  in-backlog reference as actively blocking.
- Bare text. Names an external primitive (SDK feature, infrastructure
  capability, project-level invariant, library, hardware) that the user
  confirms case by case. `/nightshift:ready` flags these as `external`.
- The literal word `none.` if there are no upstream gates.

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

Concrete entry shape inside the index. The example mixes a feature
link, a quick-win link, and a bare external primitive to show all
three forms; a real entry only includes whatever it actually depends
on:

```markdown
### [<Feature name>](features/slug.md)

<Short paragraph summary.>

**Requires:** [other-feature](features/other-feature.md), [shared
helper extraction](../QUICK_WINS.md#shared-helper-extraction), some
external primitive.
```

**When a feature is implemented**, move its index entry to
[`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); drop its `Requires:` line
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
top-level `**Requires:**` line advances to the next-to-ship slice's
gates; and every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`
that referenced the just-shipped slice (bare-link defaults to MVP) is
edited to drop the now-satisfied reference. When later continuations
have independent gates (they can ship in any order rather than
sequentially), each slice bullet may carry an inline `**Requires:**`
annotation for documentation. Example shape post-MVP:

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

`/nightshift:ready` reads the top-level `**Requires:**` line and any inline
`**Requires:**` annotations on slice bullets, then reports each
unshipped slice as a separate work unit (`[Feature title: slice
name]`). A slice is "unshipped" when its bullet in the `**Slices:**`
block is *not* struck through; the strikethrough is the live
slice-status indicator that `/nightshift:ready` reads. The **first unshipped
slice** (top-most non-struck bullet) uses the top-level line as its
gates; other unshipped slices use their inline annotation if present,
or have no extra gates if no annotation. All non-MVP slices
**implicitly depend on MVP being struck through**, regardless of
top-level or inline gates; a continuation is never reported as Ready
while MVP is unshipped. A slice may declare an inline `**Requires:**`
pointing at another slice of the same feature via the suffixed-link
form, useful when one continuation builds directly on another;
resolve the reference by checking whether the target slice's bullet
is struck through. As each slice ships, append its entry to
`FEATURES_HISTORY.md`, strike through its bullet in the parent's
`**Slices:**` block, advance the top-level `**Requires:**` to the
new next-to-ship slice's gates, and walk every other `**Requires:**`
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

### [Light revise mode](features/light-revise-mode.md)

Draft exploring a lightened variant of the revise review commands: one fresh reviewer per iteration instead of the full per-dimension swarm, and a curated dimension set that skips the least-relevant dimensions. Prompted by the single-reviewer revise-spec run over `.claude/features/dependency-cycle-detection.md` (2026-08-11).

### [Review report JSON schema](features/review-report-json-schema.md)

Draft exploring a JSON schema that review agents validate their final report against before the session ends, so malformed output is caught by the reviewer itself instead of forcing the controller to salvage-parse an erroneous report or re-run the review after the agent session has been cleared.

### [Backlog index version](features/backlog-index-version.md)

Draft exploring a durable version marker on each backlog index file (a "backlog index version", distinct from the plugin version), with an instruction and an on-demand check that compares it against the plugin's latest and notifies the user to run `init-backlog` when an index predates the current template.

### [Revise prompt-prefix caching](features/revise-prompt-prefix-caching.md)

Draft exploring two mechanisms for sharing the revise engine's common context across its N concurrent reviewers at cache-read prices with zero independence loss: a byte-identical prompt prefix (identical system prompt and first message, dimension criteria only in the divergent tail; hinges on unprobed cache-boundary mechanics) and a fork-of-primer variant (a fresh agent ingests only the common payload, then forks per dimension; provably caches today but reroutes attribution, repair, and model pinning through the primer). Fork-of-controller is the recorded anti-goal: it would contaminate fresh-eyes review with the controller's context.

### [Bounded revise acknowledgement context](features/bounded-revise-acknowledgement-context.md)

Draft exploring how to bound or scope the revise engine's whole-run acknowledgement context so retry rounds cannot grow every later reviewer and verifier payload without limit. The design must preserve the evidence that suppresses repeated findings while defining compaction, persistence, invalidation, verifier visibility, failure behavior, and parity between Workflow and manual dispatch.

## Review hardening

### [Second-opinion gates](features/second-opinion-gates.md)

Gate the lifecycle with cheap single-pass reads from a different-model-family agent: one at the completed requirements list before a spec exists, one at the freshly written, decision-complete, and currently approved spec, and one at the hardened and currently approved spec. Each read lands before the artifact feeds the next stage, finding-driven design edits return through the agreement gate, and over the final artifact the hardened gate replaces the holistic third-phase reviewer role. Findings enter the normal skeptic/controller pipeline; the gate is a reader, not an authority. Two co-equal cross-family channels are feature-detected at runtime: a `consult`-style MCP tool (reference implementation: McpConsultant) and a non-interactive agent-harness CLI from a different vendor (reference implementation: Codex `codex exec`); the same-family higher-tier or higher-effort read is the fallback only when neither is present.

**Requires:** [Present chosen spec for agreement before work](features/present-spec-for-agreement.md).

### [Adversarial repair dialogue](features/adversarial-repair-dialogue.md)

Resolves a skeptic-confirmed finding through an agent-to-agent repair dialogue: the confirming skeptic resumes as repair author and the originating reviewer as its adversarial critic, iterating focused turns until the critic accepts the repair, a narrow disagreement blocks, or a safety limit stops the exchange. Neither agent edits the artifact; the controller applies the repair from a returned resolution package. Reviewer acceptance validates the proposal only and never produces LGTM, and any independent pre-existing problem found during the dialogue enters the normal fresh-skeptic finding pipeline.

**Requires:** none.

### [Durable run identity and concurrency protection](features/durable-run-identity-concurrency.md)

Gives each Nightshift run a frozen durable identity and a scope-hash-scoped scratch home, and protects concurrent same-scope runs from silently overwriting each other. Reverses SKILL.md's "do not add a lock" invariant: a start-of-session boundary check classifies found state as resume (stale heartbeat), live concurrent run (fresh heartbeat, user picks abort or force-break), or foreign/stale (interactive asks, autonomous fails closed). Path relocation only; preserves the Markdown state schema and atomic staging.

**Requires:** none.

### [Review orchestration tests](features/review-orchestration-tests.md)

Turn the revise review engine's phase, convergence, and completion decisions into executable, fixture-tested invariants. Extracts the orchestration rules currently living only as SKILL.md prose into a deterministic `ready.js`-style transition module driven by mocked reviewer results: the wave-model invariant set (staleness sweep, certification clearing, and cap asymmetry; re-derived per the file's supersession note), the clean-LGTM disposition rule that keeps every finding-bearing cell active, every verifier-stamping branch including the exact no-fix authoritative-follow-up exception, run-level fail-closed execution, and a joined completion predicate refused in every non-completing combination.

**Requires:** none.

### [Content fingerprint helper](features/content-fingerprint-helper.md)

Centralizes selector-aware content extraction, canonical byte framing, and hashing in one bundled Node helper so no controller or reviewer reimplements the recipe. Its byte-oriented core returns selected bytes plus the full digest consumed by the shared agreement skill from one captured baseline, while tagged `partial` (`p-` + 12 hex) and `whole-file` (`w-` + 12 hex) path wrappers serve existing consumers; `partial` excludes only `## Hardening`, so a `Status:` line moves both modes. It replaces the awk/sha256sum recipes in handover and revise, including the code-review patch path, and pins cross-generation parity with the agreement-owned golden corpus.

**Requires:** [Present chosen spec for agreement before work](features/present-spec-for-agreement.md).

### [Durable scope anchor](features/durable-scope-anchor.md)

Every design spec carries a short, durable scope anchor near its goal: a paraphrase of the user's requested outcome plus the material exclusions bounding it, without restating the detailed design. The anchor is frozen unless the user revises the outcome (the revision itself recorded), and copied verbatim into every reviewer payload as common context so fresh reviewers in every cell and round calibrate against the same ground truth. It grounds scope expansion without immunizing the chosen design's wiring from findings.

**Requires:** none.

### [Fix-scoped follow-up rounds](features/fix-scoped-rounds.md)

Narrows the round 2+ payload for a dimension whose own findings produced applied fixes to those fixes plus surrounding context; every active dimension without an own-dimension fix keeps normal delivery, including cells carried by deferred, refuted, or acknowledgement-only findings. The reactivation wave restores full coverage, and context findings still enter the normal skeptic pipeline. Completion is unaffected because a narrowed-payload review never certifies a fingerprint: certification requires a full-payload review, so completion still rests on full-coverage certifications plus the verifier stamp. Primary rationale is symmetry: a dimension re-reviewing its own fixes no longer incidentally adjudicates siblings' fixes (only zero-fix active dimensions retain that sight via normal delivery), reducing the accidental privilege still-active dimensions hold today; token and wall-clock savings are a hoped-for secondary benefit, at the cost of catching cross-file fix damage a wave later.

**Requires:** none.

## Lifecycle gates

### [Present chosen spec for agreement before work](features/present-spec-for-agreement.md)

Requires every governing spec, whether backlog-backed or standalone, to be presented as a decision-complete digest and explicitly approved before validation or lifecycle work begins. The shared gate also owns final brainstorming presentation so same-session approval retains its pre-response identity without a duplicate prompt. Digest and approval identity come from one checked byte-and-scope baseline; approval is bound to current design content in volatile session state, checked again against disk after the response, re-required inside revise after pre-implementation design or governing-set changes, and never persisted or replaced by a durable design-status label. The gate protects canonical handover and every direct public revise entry, removes known legacy sign-off markers through the release migration, fails closed with exact reviewed-migration deletions when no raw-byte compare-and-replace provider is proved, and is reinforced by the index templates.

**Requires:** [Agent-host-agnostic Nightshift: MVP - Universal skill entry points](features/agent-host-agnostic-nightshift.md).

## Host portability

### [Agent-host-agnostic Nightshift](features/agent-host-agnostic-nightshift.md)

Moves Nightshift's canonical workflow surfaces and internal contracts from Claude-specific commands, tools, model names, instruction files, and resource paths to provider-neutral skills plus capability adapters. Claude Code and Codex remain the first supported hosts, while any future local coding-agent host can qualify by implementing the same filesystem, shell, interaction, and fresh-agent capabilities. The shared `.claude/` backlog-data namespace stays unchanged.

**Slices:**

- **MVP - Universal skill entry points.** Expose nine canonical public skills, remove legacy Claude command files, and keep the shared revise engine internal behind the three discoverable artifact-specific wrappers.
- **Portable resource and fingerprint contract.** Remove host-named plugin-root and shell-specific hashing assumptions from bundled-resource consumers.
  **Requires:** [Content fingerprint helper](features/content-fingerprint-helper.md).
- **Host-neutral scaffolding and instruction routing.** Make `init-backlog`, project instructions, and global instructions work without assuming one host's filenames or instruction runtime.
  **Requires:** [Move deterministic init-backlog mechanics out of promptspace](features/deterministic-init-backlog.md), [Present chosen spec for agreement before work](features/present-spec-for-agreement.md).
- **Review host adapters.** Express task queues, questions, fresh-agent dispatch, completion, recovery identities, tool guidance, and model tiers through capability contracts with Claude Code and Codex adapters.
  **Requires:** [Review orchestration tests](features/review-orchestration-tests.md).
- **Host-neutral documentation and lore.** Route documentation and durable learning updates to canonical instruction sources while preserving host adapters and optional helper integrations.
  **Requires:** [Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing](features/agent-host-agnostic-nightshift.md).
- **Packaging and cross-host validation.** Add provider-neutral metadata, supported manifest forms, installation guidance, and clean-environment behavior checks for every supported host path.
  **Requires:** [Agent-host-agnostic Nightshift: Portable resource and fingerprint contract](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Host-neutral scaffolding and instruction routing](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Review host adapters](features/agent-host-agnostic-nightshift.md), [Agent-host-agnostic Nightshift: Host-neutral documentation and lore](features/agent-host-agnostic-nightshift.md).

**Requires:** none.

## Communication standards

### [Communicate for technically sophisticated, time-constrained users](features/sophisticated-user-communication.md)

Gives Nightshift's user-facing surfaces a declared audience model and communication contract: the user is an accomplished engineer who owns the requirements but is time-constrained, so decisions are surfaced at the behavioral, architectural, and risk level with full precision, routine mechanics are resolved autonomously, and the user is consulted only when a decision materially affects the work. The delegation boundary is phase-split: spec work involves the user, while autonomous execution decides and flags at session end, including scope changes handled naive-first with a backlog refactoring entry in the follow-up.

**Requires:** none.

## Backlog tooling

### [Move deterministic init-backlog mechanics out of promptspace](features/deterministic-init-backlog.md)

Moves `init-backlog`'s deterministically-answerable behavior (static template bodies, directory and missing-file creation, and structural edits) out of the prompt and into bundled plugin code or static files, so one-correct-answer steps are executed rather than re-derived, while the genuinely semantic judgments (concept coverage in customized prose, ambiguous merges, when a user decision is required) remain with Claude. Boundary rule: if there is one objectively correct answer, get it out of promptspace. The per-candidate code-vs-file attribution is left open for the implementing session.

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
