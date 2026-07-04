---
description: Use when a project needs the four-index .claude/ backlog structure scaffolded, or re-run idempotently on an already-scaffolded project to add whatever is missing.
---

# /flightdeck:init-workflow

Scaffold the four-index backlog structure under `.claude/` for the current project, plus the on-demand `plans/` subdirectory, the on-demand `QUICK_WINS_HISTORY.md` / `FEATURES_HISTORY.md` / `BUGS_HISTORY.md` archives, a SessionStart hook that makes Claude read the indexes on every session start, and a `CLAUDE.md` section that documents the layout. The command is idempotent: re-running on an existing project adds only what's missing and proposes merges for paired wiring whose template-controlled portions have drifted from the current template. Paths are relative to the current working directory (typically the repo root). Brainstorming output lives in feature files (or in patterns when cross-cutting / in bugs when diagnostic). Pre-feature exploratory work lands as a draft feature with `status: exploring` frontmatter and an entry in `FEATURES.md`'s `## Exploring` section.

## Targets

**Index files** (four, top-level under `.claude/`):

- `.claude/QUICK_WINS.md`
- `.claude/FEATURES.md`
- `.claude/BUGS.md`
- `.claude/PATTERNS.md`

**Subdirectories** (four, under `.claude/`):

- `.claude/features/`: one file per feature, named by slug. Brainstorm output for new features lands here; existing features evolve in place.
- `.claude/bugs/`: one file per bug that needs more than a few lines, named by slug
- `.claude/patterns/`: one file per cross-cutting pattern, named by slug
- `.claude/plans/`: implementation plans, named `<date>-<slug>.md`

QUICK_WINS, FEATURES, and BUGS have no subdirectory at the archive level; active entries stay inline in the index file, and shipped / fixed entries are appended to sibling `QUICK_WINS_HISTORY.md` / `FEATURES_HISTORY.md` / `BUGS_HISTORY.md` archives (single files, top-level under `.claude/`).

The on-demand locations have different lifecycles:

- **Plans are ephemeral.** A plan exists while the implementation is in flight and is deleted once the work lands. Plans are purely mechanical step-by-step instructions for the agent doing the work; the code, tests, and commits are the durable record of what was built. There is no "implemented plans" archive.
- **Feature breakout files are durable.** A feature file under `.claude/features/<slug>.md` captures the design reasoning that led to what's implemented and evolves with the feature over its lifetime. Brainstorming output lands directly in feature files (or in patterns when cross-cutting / bugs when diagnostic) rather than as separate dated specs. The `## Exploring` section in `FEATURES.md` plus a `status: exploring` frontmatter on the breakout file handles pre-dependency-analysis brainstorms; these graduate into themed `##` sections with `**Requires:**` lines once the design firms up.
- **History archives are archaeological.** `QUICK_WINS_HISTORY.md`, `FEATURES_HISTORY.md`, and `BUGS_HISTORY.md` are appended to as soon as a quick win, feature (or slice), or bug-fix lands; the files themselves are consulted only when something pulls them in (an archaeological lookup, a pattern-doc cross-reference, a negative-knowledge sweep). Splitting shipped entries out keeps the active backlogs scannable on session start. Negative-knowledge entries in `QUICK_WINS_HISTORY.md` (approaches attempted and reverted, with reasons) are first-class promotion candidates into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections. **`/flightdeck:ready` never reads these archives**: when an item ships or is fixed, every active `**Requires:**` line referencing it is edited at the same time to drop the now-satisfied reference, so the active `Requires:` lines describe what is *currently* blocking.

**Paired wiring** (two plus a conditional):

- SessionStart hook entry in `.claude/settings.json`.
- `## Backlogs and indexes` section in the repo-root `CLAUDE.md`.
- If `CLAUDE.md` does not exist, create a minimal one containing just that section.

## Process

1. **Inventory.** Check each scaffold target and classify as `missing`, `present`, or `stale`. `Stale` is the state where the file exists but its *template-controlled portion* is missing concepts the current template now documents; the user's content (entries, customizations) is never classified as stale, and **enriched supersets are not stale**.
   - **Index files** are stale only if their **template-controlled portion** is missing concepts the current template documents. The template-controlled portion is **the H1 + every `##` section the template documents as a convention section** (e.g., FEATURES.md template's `## Requires lines`, `## Slicing`, `## Exploring`; BUGS.md template's `## Requires lines`; history templates' `## Cross-reference resolution`). It does NOT include **user-controlled sections**: the inline-entries area like `## (add sections as features emerge)` / `## Open` / `## Current patterns` and the themed entry sections the user creates (e.g., `## Progression`, `## Analysis` in FEATURES.md). Two sections have **special user-controlled treatment** worth calling out:
     - **`## Entries`** in history archives: the heading is templated as a bootstrap landing pad, but once any user content lands beneath it the section becomes user-controlled and is skipped. Treat the heading as fixed; don't inspect the body.
     - **`## History`** pointer in the active indexes: the body is fixed boilerplate templated content, but drift in the pointer text doesn't affect dependency-graph correctness, so treat as intentionally-untracked user-controlled territory. Don't propose patches against it.

     The per-file concept checklists in `## Concept checklists` below specify exactly which sections each checklist item covers and are authoritative — judge each checklist item as present-in-equivalent-prose vs absent on the live template-controlled portion, and only flag stale if at least one is absent. Identical-or-enriched template-controlled content (the live file covers everything on the checklist, possibly with additional project-specific prose) is NOT stale — leave it alone. Drift in wording, paragraph order, or added emphasis is not staleness; missing checklist coverage is. User-controlled sections are never inspected for staleness.
   - **`QUICK_WINS_HISTORY.md`**, **`FEATURES_HISTORY.md`**, and **`BUGS_HISTORY.md`** follow the same staleness rule as index files (template-controlled portion = H1 + `## Cross-reference resolution` section; `## Entries` is the user-controlled section). If any history file is missing on a project that still has a populated `## Implemented` / `## Fixed` section inside its parent index, surface the migration opportunity in the plan output but do not auto-move entries; the user decides when to perform the split.
   - The **SessionStart hook** is stale if its `additionalContext` is missing any of: all four indexes, the plans/ location, the `/flightdeck:ready` command, the `**Requires:**`-line parsing target it operates on. Coverage check, not literal-string match.
   - The **CLAUDE.md `Backlogs and indexes` section** is stale if it is missing any of: all four subdirectories (features, bugs, patterns, plans), all three history archives (`QUICK_WINS_HISTORY.md`, `FEATURES_HISTORY.md`, `BUGS_HISTORY.md`), the walk-and-remove convention for satisfied `Requires:` references, the `## Exploring` convention in FEATURES.md, the `/flightdeck:ready` command. Coverage check, not literal-string match — project-specific phrasing or added detail is fine.

2. **Plan.** Present a concise table to the user: target, state, action. Actions are `create` (missing), `skip` (present and up to date, never clobber), `merge` (template-controlled portion is stale; propose replacing only that portion), or `ask` (existing content is project-specific custom enough that we don't want to silently overwrite).

3. **Confirm.** Wait for explicit user confirmation before any writes. If the user wants to adjust the plan, accept their edits and re-confirm.

4. **Apply.** Execute the approved actions. Never overwrite an existing top-level index file or an existing subdirectory's contents.

5. **Report.** One-line summary of created, merged, skipped, and flagged targets. Do not print full file contents.

## Concept checklists

For each templated file, these are the load-bearing concepts its template-controlled portion must convey. Use the checklists to make the "missing concepts" judgment in step 1 objective: judge each item as **present-in-equivalent-prose** vs **absent** on the live file's template-controlled portion. Equivalent prose means the live file makes the same claim — subject and predicate match, paraphrase is fine, the live file may carry extra context or different examples. Only mark the file stale if at least one checklist item is absent. If a borderline item could plausibly be read either way, prefer `ask` over silent merge.

**Scope of each check.** Each checklist item below names the section(s) it inspects in parentheses when the section is not the H1 header. Items without a section annotation are H1-header content (when a whole checklist is H1-only the annotations are omitted as redundant). The convention sections to inspect for staleness are exactly those the checklist items name, **matched on exact `##` heading text** — if a project renames the section (e.g., `## Cross-references` instead of `## Cross-reference resolution`), the checklist won't find it and that counts as a missing concept. Everything else (user-entries sections like `## Open` / `## Entries` / themed sections, the trailing `## History` pointer's fixed boilerplate) is user-controlled and skipped.

**Either-location satisfaction.** When a concept could plausibly live in more than one templated section (e.g., the FEATURES.md "`/flightdeck:ready` ignores `## Exploring`" claim is teachable in both the `## Exploring` preamble and the `## Requires lines` carve-outs paragraph), the checklist item is satisfied if covered in EITHER location. Annotation names the primary expected location; secondary locations are acceptable substitutes.

**`QUICK_WINS.md`** (all H1):
1. Names this file as one of four repo-local indexes loaded at session start.
2. States that active entries stay inline organized under thematic `##` sections invented as work emerges.
3. Points at `QUICK_WINS_HISTORY.md` as the archive for shipped entries.
4. Notes the negative-knowledge → patterns Cautionary tales promotion path.
5. Describes the capture shorthand (name + smell + preferred shape).

**`QUICK_WINS_HISTORY.md`:**
1. Names this file as archival / archaeological — loaded on demand, not at session start. *(H1)*
2. States that shipped quick wins are appended here, not to the active file. *(H1)*
3. Carries forward-looking guidance on entry shape (enough context to recover reasoning, including investigation findings, reverted approaches, benchmarks, the commit or scope it landed in). *(H1)*
4. Notes the negative-knowledge → patterns promotion path with one-line redirect convention. *(H1)*
5. States `/flightdeck:ready` does not scan this file (because the walk-and-remove convention keeps active `Requires:` lines authoritative). *(`## Cross-reference resolution` section)*

**`FEATURES.md`:**
1. Names this file as one of four repo-local indexes loaded at session start. *(H1)*
2. States that each entry is a short paragraph + a `**Requires:**` line, optionally with a `**Slices:**` block for formal MVP + continuations. *(H1)*
3. Notes informal prose as the fallback for partially-done features that aren't formally sliceable. *(H1)*
4. Points at `FEATURES_HISTORY.md` for shipped entries; no inline `## Implemented` section. *(H1)*
5. Explains the comma-separated form (with line-wrap allowed), the three reference shapes, walk-and-remove, and carve-outs for `## Working hypotheses` / `## Staging` / `## Future directions (not yet designed)` / `## Author tooling` / `## Exploring`. *(`## Requires lines` section)*
6. Explains MVP + named continuations, the strikethrough-as-shipped convention on bullets, slice-suffix link form for downstream references, and the walk-and-remove obligation when a slice ships. *(`## Slicing` section)*
7. Notes pre-dependency-analysis brainstorms, `/flightdeck:ready` ignores the section, `Requires:` lines optional. *(`## Exploring` preamble — the prose before the first `###` entry inside that section; if the section has no `###` entries yet, the entire section body IS the preamble)*

**`FEATURES_HISTORY.md`:**
1. Names this file as archival / archaeological — loaded on demand, not at session start. *(H1)*
2. States that shipped features and shipped slices are appended here, not to the active file. *(H1)*
3. Notes that breakout files at `features/<slug>.md` stay in place as design records. *(H1)*
4. States `/flightdeck:ready` does not scan this file (because the walk-and-remove convention keeps active `Requires:` lines authoritative). *(`## Cross-reference resolution` section)*

**`BUGS.md`:**
1. Names this file as one of four repo-local indexes loaded at session start. *(H1)*
2. States the inline-or-breakout convention (short entries inline, longer diagnoses graduate to `bugs/<slug>.md`). *(H1)*
3. Points at `BUGS_HISTORY.md` for fixed entries; no inline `## Fixed` section. *(H1)*
4. Explains the comma-separated form (with line-wrap allowed), the three reference shapes, walk-and-remove obligation when a bug is fixed. *(`## Requires lines` section)*

**`BUGS_HISTORY.md`:**
1. Names this file as archival / archaeological — loaded on demand, not at session start. *(H1)*
2. States that fixed bugs are appended here, not to the active file. *(H1)*
3. Notes that breakout files at `bugs/<slug>.md` stay in place as diagnosis records. *(H1)*
4. States `/flightdeck:ready` does not scan this file (because the walk-and-remove convention keeps active `Requires:` lines authoritative). *(`## Cross-reference resolution` section)*

**`PATTERNS.md`** (all H1):
1. Names this file as one of four repo-local indexes loaded at session start.
2. Defines a pattern as cross-cutting structure that would otherwise be re-described in two or more feature files.
3. States the graduation rule (lift into shared home, link from features rather than duplicating).
4. Optionally: describes recognition-sufficiency on the index (entry should let readers recognize when a pattern applies without first reading the breakout file).

**SessionStart hook `additionalContext`** (concepts already enumerated inline in step 1's bullet — see line for index list, plans/ location, `/flightdeck:ready`, `**Requires:**` parsing target).

**Root `CLAUDE.md` `Backlogs and indexes` section** (concepts already enumerated inline in step 1's bullet — see line for four subdirs, three history archives, walk-and-remove convention, `## Exploring` convention, `/flightdeck:ready`).

## Rules

- **Targeted-patch insertion rules** (shared across all rules below that say "propose a targeted patch"): (a) **append** the missing concept as a new paragraph at the end of the relevant template-controlled portion (after its last existing paragraph), unless the missing concept is naturally a sub-clause of an existing paragraph — then propose an **in-place edit** that adds the clause to that paragraph, quoting both before and after in the plan output so the user sees the exact change. (b) **Never re-flow** surrounding prose to "integrate" the addition; mechanical append is the safe default. (c) If multiple checklist items are missing, propose them as separate patches in the plan, not a single rewrite. The user can accept, reject, or hand-edit each patch.
- **Index files.** Create from template if missing. If present and the template-controlled portion covers every concept on the per-file checklist in `## Concept checklists` (verbatim or in equivalent project-specific prose), skip — including the enriched-superset case where the live content carries extra material the template doesn't. If present and missing checklist items, propose a **targeted patch** per the shared insertion rules above. User-controlled sections (per the template-controlled-portion definition in step 1) are never touched. If the live content is clearly project-specific custom enough that you can't confidently identify which concepts are missing vs. just-worded-differently, prefer `ask` over an automatic merge proposal.
- **`QUICK_WINS_HISTORY.md`**, **`FEATURES_HISTORY.md`**, and **`BUGS_HISTORY.md`.** Create from template if missing. If present, follow the index-file rule: skip when concept-coverage is complete, propose a targeted patch (per shared insertion rules above) when concepts are missing, never touch the user-controlled `## Entries` section. If the parent index still has a populated `## Implemented` / `## Fixed` section while its history sibling is missing, surface the situation in the plan output but do not auto-migrate; the user decides whether to move them by hand.
- **Subdirectories.** Create if missing. Never touch existing contents. Applies to the four subdirs (`features/`, `bugs/`, `patterns/`, `plans/`). Any pre-existing subdirectory outside that set is left alone untouched.
- **`.claude/settings.json`.** Create from template if missing. If present without a SessionStart hook, offer to merge the hook in. If the additionalContext is missing concepts the SessionStart staleness rule above lists (the four indexes, the `plans/` location, the `/flightdeck:ready` command, the `**Requires:**`-line parsing target) and the rest of the hook structure matches the current template, propose a targeted patch (per shared insertion rules above; the additionalContext string is the "template-controlled portion" here). Enriched-superset additionalContext (covers everything the template covers, plus project-specific extras) is NOT stale — skip. If the hook structure itself has been customized (different command shape, additional event handlers, reads fewer or different files than the current template), show the diff and ask rather than auto-propose.
- **`CLAUDE.md`.** Create minimally from template if missing. If present without a `Backlogs and indexes` section, offer to append it. If present with a section that's missing concepts the CLAUDE.md staleness rule above lists, propose a targeted patch (per shared insertion rules above; the section is the "template-controlled portion" here). Enriched-superset sections (cover everything the template covers, plus project-specific phrasing or extras) are NOT stale — skip. If present with a similar section (any `##` heading containing "backlog" or "index") that's clearly project-specific custom content, show it and ask before editing.
- Do not add content to `CLAUDE.md` beyond the Backlogs-and-indexes block. Users have their own conventions for the rest of `CLAUDE.md`.

### Re-run on existing projects

The command is idempotent. Re-running on a project that was scaffolded against an earlier version of these templates will:

- Skip every up-to-date index file and every existing subdirectory.
- Create any newly-required subdirectories that don't exist yet (commonly `plans/` on projects that predate that addition).
- Detect any stale template-controlled content (index file headers, the SessionStart hook, the CLAUDE.md `Backlogs and indexes` section) and propose a header- or section-level merge that preserves user content (entries, custom hook fields, custom CLAUDE.md prose).

Always confirm the planned merge with the user before any file is rewritten.

## Templates

The content blocks below are authoritative. When creating `missing` files, write the template verbatim. When merging into existing files, adapt the relevant block only.

### `.claude/QUICK_WINS.md`

~~~markdown
# Quick wins

Refactors ready to land when time allows; not blocking any feature, but
would improve the codebase meaningfully.

This file is **one of four repo-local indexes** Claude reads on every
session start (alongside `FEATURES.md`, `BUGS.md`, `PATTERNS.md`). Active
entries are kept inline, organized under thematic `##` sections you
invent as work emerges. When a quick win lands, append a shipped-note
entry to [`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md); do not move
it within this file. Negative-knowledge findings (approaches attempted
and reverted) are first-class promotion candidates from the history
into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections.

Capture shorthand: name the refactor, describe the current smell in a
sentence or two, sketch the preferred shape. A reader should be able to
start work from the entry alone.

## (add sections as work emerges)

Nothing tracked yet.

## History

Implemented quick wins are archived in
[`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md), read only when
consulted (not at session start) so the active backlog above stays
scannable. When a quick win lands, append its entry there rather
than to this file.
~~~

### `.claude/QUICK_WINS_HISTORY.md`

~~~markdown
# Quick wins (history)

Implemented quick wins, archived from `QUICK_WINS.md` so the active
backlog stays scannable. **Archaeological**: loaded on demand, not at
session start. When a quick win lands, append its entry here rather
than to the active file.

Entries appear in the order they shipped. Write each with enough
context to recover the reasoning from the entry alone: investigation
findings, reverted approaches, benchmarks, the commit or scope it
landed in. Negative-knowledge findings (approaches attempted and
reverted, with the reason) are the most valuable content here for
preventing re-attempts; consider promoting those into the relevant
`.claude/patterns/<slug>.md` Cautionary tales section when touching
the pattern doc, leaving a one-line redirect here if cross-referenced.

## Cross-reference resolution

`/flightdeck:ready` does **not** scan this file. When a quick win lands, every
other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced
it is edited at the same time to drop the now-satisfied reference. The
active `Requires:` lines therefore describe what is *currently*
blocking. This file is purely archaeological — read it when you want
to know what already shipped or to mine negative-knowledge findings,
not to resolve dependencies.

## Entries

Nothing yet.
~~~

### `.claude/FEATURES.md`

~~~markdown
# Features

Product-level feature ideas captured during brainstorming. Each entry
points at a standalone file under `.claude/features/<slug>.md` with the
full design sketch. Check this index before proposing new feature
directions in the same territory.

This file is **one of four repo-local indexes** Claude reads on every
session start (alongside `QUICK_WINS.md`, `BUGS.md`, `PATTERNS.md`). Each
entry here is a short paragraph summary plus a `**Requires:**` line, and
optionally a `**Slices:**` block (formal MVP plus continuations; see
`## Slicing` below). For features that are partially done without a
formal slice breakdown, describe the partial progress in the entry's
own prose — there is no separate marker convention for "partially
shipped". The detailed design lives in the linked file. When a feature
(or a slice of a sliced feature) ships, append its entry to
[`FEATURES_HISTORY.md`](FEATURES_HISTORY.md); do not keep an
`## Implemented` section inline.

## Requires lines

**Every feature index entry carries a `**Requires:**` line** declaring
the upstream gates that block the feature. The line is comma-separated;
long lines may wrap across multiple physical lines and `/flightdeck:ready` joins
them before parsing. Each item is one of three forms:

- A markdown link to a feature, quick win, or bug entry tracked in one
  of the four indexes. The reference is a current blocker; under the
  walk-and-remove convention below, a satisfied dependency is edited
  out of the line at the moment it ships, so `/flightdeck:ready` treats every
  in-backlog reference as actively blocking.
- Bare text. Names an external primitive (SDK feature, infrastructure
  capability, project-level invariant, library, hardware) that the user
  confirms case by case. `/flightdeck:ready` flags these as `external`.
- The literal word `none.` if there are no upstream gates.

A missing `Requires:` line is a structural error: every entry must say
something. Silence is not the same as `none.`; it indicates the
dependency review hasn't been done. The `/flightdeck:ready` command parses these
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
case, may carry them as historical artifacts only) and `/flightdeck:ready`
ignores them. Working hypotheses / Staging / Future directions
(not yet designed) / Author tooling are bulleted rather than `###`
headings, so the `###`-only candidate filter handles them naturally;
`## Exploring` holds `###` entries but is excluded by name in the
`/flightdeck:ready` filter.

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
blocking and means `/flightdeck:ready` never needs to consult the history file.

**Partially-implemented features** have two routes. If the shipped
and remaining work is scoped clearly enough to name a named MVP plus
named continuations, use the formal `**Slices:**` block described in
`## Slicing` below — `/flightdeck:ready` then expands per-slice work units and
downstream features can reference specific slices via the
`[Feature: slice-name]` link suffix. If the shipped work is real but
not yet sliceable (e.g., one layer landed, remaining layers are a
wishlist not a planned breakdown), describe the partial progress in
the entry's own prose without any special markers. `/flightdeck:ready` treats
such entries as the `**Requires:**` line dictates; partial progress
is editorial context for the reader, not a machine-readable signal.

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

- ~~MVP — floating-reference core.~~ (Shipped — see FEATURES_HISTORY.md.)
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

A link without a `: slice-name` suffix resolves to the MVP — the
default unblock point.

As each slice ships, append a line to `FEATURES_HISTORY.md`:

```
- [Feature title: slice name](features/slug.md): brief note.
```

The parent entry stays in its themed section until the **last** slice
ships, at which point it graduates with the final history line.

`/flightdeck:ready` reads the top-level `**Requires:**` line and any inline
`**Requires:**` annotations on slice bullets, then reports each
unshipped slice as a separate work unit (`[Feature title: slice
name]`). A slice is "unshipped" when its bullet in the `**Slices:**`
block is *not* struck through — the strikethrough is the live
slice-status indicator that `/flightdeck:ready` reads. The **first unshipped
slice** (top-most non-struck bullet) uses the top-level line as its
gates; other unshipped slices use their inline annotation if present,
or have no extra gates if no annotation. All non-MVP slices
**implicitly depend on MVP being struck through**, regardless of
top-level or inline gates — a continuation is never reported as Ready
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
isn't expected yet. `/flightdeck:ready` excludes this section from the readiness
set on purpose. When a draft firms up enough to declare its upstream
gates, move it out of `## Exploring` into the appropriate themed `##`
section, add the `**Requires:**` line, and drop the `status: exploring`
frontmatter on the breakout file.

Nothing being explored yet.

## (add sections as features emerge)

Nothing captured yet.

## History

Implemented features are archived in
[`FEATURES_HISTORY.md`](FEATURES_HISTORY.md), loaded on demand only
(not at session start) so the active backlog above stays scannable.
When a feature (or slice) ships, append its entry there rather than
to this file, AND walk every other `**Requires:**` line in
`FEATURES.md` / `BUGS.md`: remove the now-satisfied reference (if it
was the only one, set the line to `Requires: none.`). The active
`Requires:` lines describe what is *currently* blocking, so `/flightdeck:ready`
never has to consult the history file — the dependency graph settles
as features ship.
~~~

### `.claude/FEATURES_HISTORY.md`

~~~markdown
# Features (history)

Implemented features, archived from `FEATURES.md` so the active backlog
stays scannable on session start. **Archaeological**: read only when
consulted, not at session start. When a feature (or a slice of a sliced
feature) ships, append its entry here rather than to the active file.

The feature breakout file at `features/<slug>.md` stays in place as the
historical design record; the entry here is a brief one-line note on
what shipped and in which feature scope or commit. If follow-up work on
the same feature changes the design meaningfully, prefer editing the
original breakout file (and adding a second entry here for the
follow-up) over creating a new file.

## Cross-reference resolution

`/flightdeck:ready` does **not** scan this file. When a feature ships, every
other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced
it is edited at the same time to drop the now-satisfied reference (see
the convention in `FEATURES.md`'s `## Requires lines` and `## Slicing`
sections). The active `Requires:` lines therefore describe what is
*currently* blocking and the dependency graph settles as work ships.
This file is purely archaeological — read it when you want to know
what already shipped, not to resolve dependencies.

## Entries

Nothing yet.
~~~

### `.claude/BUGS.md`

~~~markdown
# Bugs

Known bugs awaiting attention. Short entries live here; bugs that need
more than a few lines of description graduate to a dedicated file under
`.claude/bugs/<slug>.md`.

This file is **one of four repo-local indexes** Claude reads on every
session start (alongside `QUICK_WINS.md`, `FEATURES.md`, `PATTERNS.md`).
When a bug is fixed, append its entry to
[`BUGS_HISTORY.md`](BUGS_HISTORY.md); do not keep a `## Fixed` section
inline.

## Requires lines

**Every open bug entry carries a `**Requires:**` line** declaring what
must be in place before the fix can land. Comma-separated, same shape
as `FEATURES.md` (long lines may wrap; `/flightdeck:ready` joins them before
parsing):

- A markdown link to a feature, quick win, or bug. The reference is a
  current blocker; under the walk-and-remove convention below, a
  satisfied dependency is edited out of the line at the moment it
  ships or is fixed.
- Bare text. An external primitive (driver release, vendor support,
  user decision) the user confirms case by case.
- The literal word `none.` if the fix is unblocked.

A missing `Requires:` line is a structural error. `/flightdeck:ready` parses these
lines. History entries don't carry `Requires:` lines.

**When a bug is fixed**, move its entry to
[`BUGS_HISTORY.md`](BUGS_HISTORY.md) with a brief note on the fix and
the commit it landed in; drop its `Requires:` line in the move. If the
bug had its own file, keep the file in place as a historical record of
the diagnosis.

**Then walk every other `**Requires:**` line in `FEATURES.md` and
`BUGS.md`** and remove references to the just-fixed bug: if it was the
only item on the line, set the line to `Requires: none.`. Mirror of the
`FEATURES.md` walk-and-remove convention — `/flightdeck:ready` never has to
consult `BUGS_HISTORY.md`.

## Open

Nothing currently tracked.

## History

Fixed bugs are archived in [`BUGS_HISTORY.md`](BUGS_HISTORY.md), loaded
on demand only (not at session start) so the active list above stays
scannable. When a bug is fixed, append its entry there rather than to
this file, AND walk every other `**Requires:**` line in `FEATURES.md`
/ `BUGS.md`: remove the now-satisfied reference (if it was the only
one, set the line to `Requires: none.`). The active `Requires:` lines
describe what is *currently* blocking, so `/flightdeck:ready` never has to consult
the history file — the dependency graph settles as bugs are fixed.
~~~

### `.claude/BUGS_HISTORY.md`

~~~markdown
# Bugs (history)

Fixed bugs, archived from `BUGS.md` so the active list stays scannable
on session start. **Archaeological**: read only when consulted, not at
session start. When a bug is fixed, append its entry here rather than
to the active file.

The bug breakout file at `bugs/<slug>.md` (when present) stays in place
as the historical diagnosis record; the entry here is a brief
description of the fix and the commit it landed in.

## Cross-reference resolution

`/flightdeck:ready` does **not** scan this file. When a bug is fixed, every other
`**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced it is
edited at the same time to drop the now-satisfied reference (mirror of
the `FEATURES.md` convention). The active `Requires:` lines therefore
describe what is *currently* blocking; this file is purely
archaeological.

## Entries

Nothing yet.
~~~

### `.claude/PATTERNS.md`

~~~markdown
# Patterns

Cross-cutting design patterns that apply across multiple features or
feature families. Each entry points at a standalone file under
`.claude/patterns/<slug>.md` with the full treatment.

This file is **one of four repo-local indexes** Claude reads on every
session start (alongside `QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`).

A pattern graduates here when the same structure would otherwise be
re-described in two or more feature files. Lifting it into a shared home
lets features link at the pattern rather than duplicating it, and makes
design decisions about the pattern uniform across its members.

## Current patterns

Nothing captured yet.
~~~

### `.claude/settings.json` (fresh)

~~~json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node -e \"process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:'Before responding to the first user turn of this session, read .claude/QUICK_WINS.md, .claude/FEATURES.md, .claude/BUGS.md, and .claude/PATTERNS.md. These index the repo refactor backlog, feature ideas, known bugs, and cross-cutting design patterns. Implementation plans live under .claude/plans/<date>-<slug>.md (ephemeral; only present while work is in flight). Read those on demand, not at session start. Any task the user raises may already be queued, designed, diagnosed, or covered. When the user asks what to work on next, run /flightdeck:ready to parse the **Requires:** line on each entry into an unblocked work set.'}}));\""
          }
        ]
      }
    ]
  }
}
~~~

The hook invokes `node -e` to produce the JSON stdout output Claude Code expects. Node is typically available in any dev environment; if the target environment lacks it, the user can adapt the command to python, jq, or any other JSON-producing one-liner.

### `CLAUDE.md` (fresh minimal file)

~~~markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Backlogs and indexes

Four repo-local indexes live under `.claude/`. A `SessionStart` hook in `.claude/settings.json` injects a directive so Claude reads them on the first turn of every session; any task the user raises may already be queued, designed, diagnosed, or covered by an existing pattern:

- `.claude/QUICK_WINS.md`: refactors ready to land when time allows. Shipped entries are appended to `.claude/QUICK_WINS_HISTORY.md` (described below).
- `.claude/FEATURES.md`: product-level feature ideas, with one file per feature under `.claude/features/`. Shipped entries are appended to `.claude/FEATURES_HISTORY.md` (described below). When sibling feature files start duplicating shared concerns (machinery, patterns, conventions), promote an umbrella file that hosts the shared content and trim the siblings to deltas; cross-references through an umbrella scale better than pairwise cross-references.
- `.claude/BUGS.md`: known bugs awaiting fix, with one file per bug under `.claude/bugs/` when more than a few lines of description is needed. Fixed entries are appended to `.claude/BUGS_HISTORY.md` (described below).
- `.claude/PATTERNS.md`: cross-cutting design patterns that span multiple features, with one file per pattern under `.claude/patterns/`. Complementary to the umbrella-promotion heuristic above: umbrellas cluster children of one family; patterns cluster concerns that span families. A pattern graduates here when the same structure would otherwise be re-described in two or more feature files.

Four locations sit alongside the indexes that are not read at session start; consult them when relevant work is in flight:

- `.claude/plans/<date>-<slug>.md`: implementation plans produced by the writing-plans workflow. **Ephemeral**: a plan exists while the implementation is in flight and is deleted once the work lands. The code, tests, and commits are the durable record. Plans are purely mechanical step-by-step instructions for the agent doing the work. There is no "implemented plans" archive.
- `.claude/QUICK_WINS_HISTORY.md`: archive of shipped quick wins, split out from `QUICK_WINS.md` so the active backlog stays scannable on session start. Append entries here as soon as the quick win lands; the file itself is consulted only when something pulls it in (a pattern-doc cross-reference, an archaeological lookup, a negative-knowledge sweep). Negative-knowledge entries (approaches attempted and reverted) are first-class promotion candidates into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections.
- `.claude/FEATURES_HISTORY.md`: archive of shipped features and shipped slices, split out from `FEATURES.md` so the active backlog stays scannable on session start. Append entries here as soon as a feature or slice lands.
- `.claude/BUGS_HISTORY.md`: archive of fixed bugs, split out from `BUGS.md`. Append entries here as soon as a bug is fixed.

**Walk-and-remove convention.** When a feature, slice, quick win, or bug-fix ships, the same change set that appends its entry to the relevant history archive ALSO walks every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` and drops references to the just-shipped item; if the dropped reference was the only one on the line, the line becomes `Requires: none.`. Active `Requires:` lines therefore describe what is *currently* blocking, and `/flightdeck:ready` never has to consult the history archives to resolve dependencies — the dependency graph settles as work ships.

Brainstorming output lives in feature files (or in patterns when cross-cutting / in bugs when diagnostic) rather than as separate dated specs. Pre-feature exploratory brainstorms land as draft features with `status: exploring` frontmatter and an entry in `FEATURES.md`'s `## Exploring` section; `/flightdeck:ready` skips them. They graduate to a themed `##` section with a `**Requires:**` line once the design firms up.

The `/flightdeck:ready` command parses each entry's `**Requires:**` line in `FEATURES.md` and `BUGS.md` and reports the unblocked work set. Run it when picking what to work on next.
~~~

### `CLAUDE.md` section (to append when `CLAUDE.md` exists without it)

Use the `## Backlogs and indexes` heading and its bullet list from the fresh `CLAUDE.md` template above, minus the `# CLAUDE.md` header and intro line. Append with one blank line before the heading.
