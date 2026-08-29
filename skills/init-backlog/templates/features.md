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

A missing `Requires:` line is a structural error: every entry must say something. Silence is not the same as `none.`; it indicates the dependency review hasn't been done. The `/nightshift:ready` skill parses these lines to compute the unblocked work set.

**After adding a new entry (or a feature breakout file), and after graduating a draft from `## Exploring`, run `/nightshift:ready`** from the repo root so the bundled `skills/ready/ready.js` validates the post-edit backlog. A new entry must parse and its `**Requires:**` line must resolve. A graduation is incomplete until the selected entry is absent from `exploring`, the selected entry or its unshipped slice work units appear in `ready`, `blocked`, or `external`, the selected entry has no structural error or notice, and the transition introduced no new structural error or notice. Surface pre-existing unrelated problems again, but they do not alone block that graduation. A failed parser invocation, missing work index, missing active classification, selected-entry problem, or newly introduced problem stops graduation until corrected and rechecked.

Downstream relationships (this feature **enables** what) are not encoded structurally. They can be derived by walking the upstream graph in reverse, and over-codifying them creates a second source of truth that drifts. Mention downstream relationships in design prose where they aid understanding.

**Carve-outs:** sections like `## Working hypotheses`, `## Staging`, `## Future directions (not yet designed)`, `## Author tooling`, and `## Exploring` describe pre-feature material (orienting prose, shipping order, shallow placeholders, workflow notes, exploratory brainstorms) rather than ready-to-implement entries. Items in those sections do not carry `Requires:` lines (or, in `## Exploring`'s case, may carry them as historical artifacts only). `/nightshift:ready` ignores the bulleted sections entirely and keeps `## Exploring` out of the readiness set, reporting its entries separately as titles-only drafts; `/nightshift:exploring` renders them in full. Working hypotheses / Staging / Future directions (not yet designed) / Author tooling are bulleted rather than `###` headings, so the `###`-only candidate filter handles them naturally; `## Exploring` holds `###` entries, collected as drafts and never classified.

Concrete entry shape inside the index. The example shows a feature link, a quick-win link, and an External line to show both lines; a real entry only includes whatever it actually depends on:

```markdown
### [<Feature name>](features/slug.md)

<Short paragraph summary.>

**Requires:** [other-feature](features/other-feature.md), [shared helper extraction](QUICK_WINS.md#shared-helper-extraction).
**External:** some external primitive.
```

**When a feature is implemented**, move its index entry to [`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); drop its `Requires:` and `External:` lines in the move (history entries don't need them). The feature file stays in place as a historical design record.

**Then walk every other `**Requires:**` line in `FEATURES.md` and `BUGS.md`** and remove references to the just-shipped feature: if it was the only item on the line, set the line to `Requires: none.`. This keeps `Requires:` lines as a literal record of what is *currently* blocking and means `/nightshift:ready` never needs to consult the history file.

**Partially-implemented features** have two routes. If the shipped and remaining work is scoped clearly enough to name a named MVP plus named continuations, use the formal `**Slices:**` block described in `## Slicing` below; `/nightshift:ready` then expands per-slice work units and downstream features can reference specific slices via the `[Feature: slice-name]` link suffix. If the shipped work is real but not yet sliceable (e.g., one layer landed, remaining layers are a wishlist not a planned breakdown), describe the partial progress in the entry's own prose without any special markers. `/nightshift:ready` treats such entries as the `**Requires:**` line dictates; partial progress is editorial context for the reader, not a machine-readable signal.

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

Nothing being explored yet.

## (add sections as features emerge)

Nothing captured yet.

## History

Implemented features are archived in [`FEATURES_HISTORY.md`](FEATURES_HISTORY.md), loaded on demand so the active backlog above stays scannable. When a feature (or slice) ships, append its entry there rather than to this file, AND walk every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`: remove the now-satisfied reference (if it was the only one, set the line to `Requires: none.`). The active `Requires:` lines describe what is *currently* blocking, so `/nightshift:ready` never has to consult the history file; the dependency graph settles as features ship.
