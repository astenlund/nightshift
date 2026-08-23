---
name: init-backlog
description: Use when a project needs the four-index .claude/ backlog structure scaffolded, or re-run idempotently on an already-scaffolded project to add whatever is missing and unwrap hard-wrapped backlog prose.
---

# /nightshift:init-backlog

Scaffold the four-index backlog structure under `.claude/` for the
current project, plus the on-demand `plans/` subdirectory, the on-demand
`QUICK_WINS_HISTORY.md` / `FEATURES_HISTORY.md` / `BUGS_HISTORY.md`
archives, and a `CLAUDE.md` section that documents the layout and when
to consult it.

The skill is idempotent: re-running on an existing project adds only
what's missing and proposes merges for template-controlled guidance
that has drifted from the current template. Paths are relative to the
current working directory (typically the repo root).

**Line discipline.** Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice and `/nightshift:init-backlog` unwraps it. The discipline covers every markdown file under `.claude/`: the four indexes, the three history archives, and the breakout files. The detector and unwrapper are bundled as `${CLAUDE_PLUGIN_ROOT}/skills/init-backlog/unwrap.js`; the check form is `node "${CLAUDE_PLUGIN_ROOT}/skills/init-backlog/unwrap.js" .claude` (prints a JSON report of offending files with counts and first lines, exit 1 when any exist) and the repair form adds `--write`. The unwrapper joins only continuation lines the `ready` parser already treats as part of the same paragraph or bullet: it stops at ATX and setext headings, thematic breaks, list markers, blank lines, `**Label:**` lines, tables, block quotes, fenced and indented code, HTML blocks and comments, and frontmatter, and it keeps a deliberate two-space or backslash hard break. A correct repair changes exactly two things in `/nightshift:ready` output: the hard-wrap notices disappear, and `excerpt` fields grow to the joined first line. Run it before and after, compare with those two stripped, and treat any remaining difference as a stop.

Brainstorming output lives in feature files (or in patterns when
cross-cutting / in bugs when diagnostic). Pre-feature exploratory work
lands as a draft feature with `status: exploring` frontmatter and an
entry in `FEATURES.md`'s `## Exploring` section.

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
- **History archives are archaeological.** `QUICK_WINS_HISTORY.md`, `FEATURES_HISTORY.md`, and `BUGS_HISTORY.md` are appended to as soon as a quick win, feature (or slice), or bug-fix lands; the files themselves are consulted only when something pulls them in (an archaeological lookup, a pattern-doc cross-reference, a negative-knowledge sweep). Splitting shipped entries out keeps the active backlogs scannable. Negative-knowledge entries in `QUICK_WINS_HISTORY.md` (approaches attempted and reverted, with reasons) are first-class promotion candidates into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections. **`/nightshift:ready` never reads these archives**: when an item ships or is fixed, every active `**Requires:**` line referencing it is edited at the same time to drop the now-satisfied reference, so the active `Requires:` lines describe what is *currently* blocking.

**Project guidance:**

- `## Backlogs and indexes` section in the repo-root `CLAUDE.md`.
- If `CLAUDE.md` does not exist, create a minimal one containing just that section.

## Process

1. **Inventory.** Check each scaffold target and classify as `missing`, `present`, or `stale`. `Stale` is the state where the file exists but its *template-controlled portion* is missing concepts the current template now documents; the user's content (entries, customizations) is never classified as stale, and **enriched supersets are not stale**.
   - **Index files** are stale only if their **template-controlled portion** is missing concepts the current template documents. The template-controlled portion is **the H1 + every `##` section the template documents as a convention section** (e.g., FEATURES.md template's `## Requires lines`, `## Slicing`, `## Exploring`; BUGS.md template's `## Requires lines`; history templates' `## Cross-reference resolution`). It does NOT include **user-controlled sections**: the inline-entries area like `## (add sections as features emerge)` / `## Open` / `## Current patterns` and the themed entry sections the user creates (e.g., `## Progression`, `## Analysis` in FEATURES.md). Two sections have **special user-controlled treatment** worth calling out:
     - **`## Entries`** in history archives: the heading is templated as a bootstrap landing pad, but once any user content lands beneath it the section becomes user-controlled and is skipped. Treat the heading as fixed; don't inspect the body.
     - **`## History`** pointer in the active indexes: the body is fixed boilerplate templated content, but drift in the pointer text doesn't affect dependency-graph correctness, so treat as intentionally-untracked user-controlled territory. Don't propose patches against it.

     The per-file concept checklists in `## Concept checklists` below specify exactly which sections each checklist item covers and are authoritative: judge each checklist item as present-in-equivalent-prose vs absent on the live template-controlled portion, and only flag stale if at least one is absent. Identical-or-enriched template-controlled content (the live file covers everything on the checklist, possibly with additional project-specific prose) is NOT stale and must be left alone. Drift in wording, paragraph order, or added emphasis is not staleness; missing checklist coverage is. User-controlled sections are never inspected for staleness. A `## Requires lines` section that describes bare text as a legal `**Requires:**` form is stale regardless of concept coverage.
   - **`QUICK_WINS_HISTORY.md`**, **`FEATURES_HISTORY.md`**, and **`BUGS_HISTORY.md`** follow the same staleness rule as index files (template-controlled portion = H1 + `## Cross-reference resolution` section; `## Entries` is the user-controlled section). If any history file is missing on a project that still has a populated `## Implemented` / `## Fixed` section inside its parent index, surface the migration opportunity in the plan output but do not auto-move entries; the user decides when to perform the split.
   - **Hard-wrapped prose** is its own inventory state, `wrapped`, orthogonal to `present` / `stale`: run the bundled check form over `.claude/` and list each file the report names with its count and first offending line. A wrapped file is never `stale` on that ground alone; the two states combine (a file can be `stale` and `wrapped`).
   - The **CLAUDE.md `Backlogs and indexes` section** is stale if it is missing any concept named by its checklist below, including the current-session agreement boundary and autonomous within-contract continuation. When the section contains an earlier automatic-loading claim, replace that claim with the on-demand instruction. Coverage check, not literal-string match; other project-specific phrasing or added detail is fine.

2. **Plan.** Present a concise table to the user: target, state, action. Actions are `create` (missing), `skip` (present and up to date, never clobber), `merge` (template-controlled portion is stale; propose replacing only that portion), `unwrap` (the file carries hard-wrapped prose; rewrite it with the bundled repair form, which touches no content beyond joining continuation lines), or `ask` (existing content is project-specific custom enough that we don't want to silently overwrite). On a fresh scaffold (no `.claude/` yet), the plan also includes the **version-control election**: ask once whether the `.claude/` backlog files should be tracked in git or ignored. On `ignore`, the apply step appends the scaffolded paths to `.gitignore` (creating it if absent). On projects already scaffolded, skip the question; the election lives in `.gitignore` itself, and changing it later is a direct `.gitignore` edit (in the tracked-to-ignored direction that also means finishing the untracking with `git rm --cached`). Downstream skills check tracked-ness per file and never assume it.

3. **Confirm.** Wait for explicit user confirmation before any writes. If the user wants to adjust the plan, accept their edits and re-confirm.

4. **Apply.** Execute the approved actions. Never overwrite an existing top-level index file or an existing subdirectory's contents. For `unwrap` actions, capture `/nightshift:ready` output first, run the repair form over `.claude/`, then capture it again and compare with the hard-wrap notices and the `excerpt` fields stripped from both; any remaining difference means the unwrapper joined a line the parser reads as its own block, so stop and report the file rather than keeping the rewrite.

5. **Report.** One-line summary of created, merged, skipped, and flagged targets. Do not print full file contents.

## Concept checklists

For each templated file, these are the load-bearing concepts its template-controlled portion must convey. Use the checklists to make the "missing concepts" judgment in step 1 objective: judge each item as **present-in-equivalent-prose** vs **absent** on the live file's template-controlled portion. Equivalent prose means the live file makes the same claim: subject and predicate match, paraphrase is fine, the live file may carry extra context or different examples. Only mark the file stale if at least one checklist item is absent. If a borderline item could plausibly be read either way, prefer `ask` over silent merge.

**Scope of each check.** Each checklist item below names the section(s) it inspects in parentheses when the section is not the H1 header. Items without a section annotation are H1-header content (when a whole checklist is H1-only the annotations are omitted as redundant). The convention sections to inspect for staleness are exactly those the checklist items name, **matched on exact `##` heading text**: if a project renames the section (e.g., `## Cross-references` instead of `## Cross-reference resolution`), the checklist won't find it and that counts as a missing concept. Everything else (user-entries sections like `## Open` / `## Entries` / themed sections, the trailing `## History` pointer's fixed boilerplate) is user-controlled and skipped.

**Either-location satisfaction.** When a concept could plausibly live in more than one templated section (e.g., the FEATURES.md "`/nightshift:ready` reports `## Exploring` separately as drafts, never in the ready set, and `/nightshift:exploring` renders them in full" claim is teachable in both the `## Exploring` preamble and the `## Requires lines` carve-outs paragraph), the checklist item is satisfied if covered in EITHER location. Annotation names the primary expected location; secondary locations are acceptable substitutes.

**Agreement reinforcement.** The root-guidance checklist includes these presentation and freshness concepts, while the rerun rule governs how missing concepts are merged:

- When a final governing design is presented, invoke /nightshift:spec-agreement in final-presentation mode before asking for agreement.
- Existing agreement is fresh only when the complete current candidate matches or passes contract-fit evaluation in the same session.
- On rerun, add missing agreement guidance with a targeted patch; never rewrite user-controlled sections.

**`QUICK_WINS.md`** (all H1):
1. Names this file as one of four repo-local indexes consulted on demand when relevant.
2. States that active entries stay inline organized under thematic `##` sections invented as work emerges.
3. Points at `QUICK_WINS_HISTORY.md` as the archive for shipped entries.
4. Notes the negative-knowledge → patterns Cautionary tales promotion path.
5. Describes the capture shorthand (name + smell + preferred shape).
6. States the stable-anchor rule for entries (locate by symbol names, entry titles, commit hashes; never by line numbers, plan-phase ordinals, bullet positions, or temporal qualifiers).
7. Instructs the author to run `/nightshift:ready` after adding a new entry to confirm it parses as a work item against the real grammar in `skills/ready/ready.js`.
8. States the line discipline (one paragraph or bullet per physical line, never hard-wrapped).

**`QUICK_WINS_HISTORY.md`:**
1. Names this file as archival / archaeological and loaded on demand. *(H1)*
2. States that shipped quick wins are appended here, not to the active file. *(H1)*
3. Carries forward-looking guidance on entry shape (enough context to recover reasoning, including investigation findings, reverted approaches, benchmarks, the commit or scope it landed in). *(H1)*
4. Notes the negative-knowledge → patterns promotion path with one-line redirect convention. *(H1)*
5. States `/nightshift:ready` does not scan this file (because the walk-and-remove convention keeps active `Requires:` lines authoritative). *(`## Cross-reference resolution` section)*

**`FEATURES.md`:**
1. Names this file as one of four repo-local indexes consulted on demand when relevant. *(H1)*
2. States that each entry is a short paragraph + a `**Requires:**` line, an optional `**External:**` line, and optionally a `**Slices:**` block for formal MVP + continuations. *(H1)*
3. Notes informal prose as the fallback for partially-done features that aren't formally sliceable. *(H1)*
4. Points at `FEATURES_HISTORY.md` for shipped entries; no inline `## Implemented` section. *(H1)*
5. Explains the comma-separated form (one physical line; the parser tolerates a wrapped line but the line discipline forbids it), the two `**Requires:**` item shapes, the separate optional `**External:**` line for external primitives, walk-and-remove, and carve-outs for `## Working hypotheses` / `## Staging` / `## Future directions (not yet designed)` / `## Author tooling` / `## Exploring`. *(`## Requires lines` section)*
6. Explains MVP + named continuations, the strikethrough-as-shipped convention on bullets, slice-suffix link form for downstream references, and the walk-and-remove obligation when a slice ships. *(`## Slicing` section)*
7. Notes pre-dependency-analysis brainstorms, `/nightshift:ready` reports the section separately as titles-only drafts (never in the ready set) with `/nightshift:exploring` as the full view, `Requires:` lines optional. *(`## Exploring` preamble: the prose before the first `###` entry inside that section; if the section has no `###` entries yet, the entire section body IS the preamble)*
8. Instructs the author to run `/nightshift:ready` after adding a new entry (or breakout file) to confirm it parses and its `**Requires:**` line resolves against the real grammar in `skills/ready/ready.js`. *(`## Requires lines` section)*
9. States the line discipline (one paragraph or bullet per physical line, never hard-wrapped). *(H1)*

**`FEATURES_HISTORY.md`:**
1. Names this file as archival / archaeological and loaded on demand. *(H1)*
2. States that shipped features and shipped slices are appended here, not to the active file. *(H1)*
3. Notes that breakout files at `features/<slug>.md` stay in place as design records. *(H1)*
4. States `/nightshift:ready` does not scan this file (because the walk-and-remove convention keeps active `Requires:` lines authoritative). *(`## Cross-reference resolution` section)*

**`BUGS.md`:**
1. Names this file as one of four repo-local indexes consulted on demand when relevant. *(H1)*
2. States the inline-or-breakout convention (short entries inline, longer diagnoses graduate to `bugs/<slug>.md`). *(H1)*
3. Points at `BUGS_HISTORY.md` for fixed entries; no inline `## Fixed` section. *(H1)*
4. Explains the comma-separated form (one physical line; the parser tolerates a wrapped line but the line discipline forbids it), the two `**Requires:**` item shapes, the separate optional `**External:**` line for external primitives, walk-and-remove obligation when a bug is fixed. *(`## Requires lines` section)*
5. Instructs the author to run `/nightshift:ready` after adding a new entry (or breakout file) to confirm it parses and its `**Requires:**` line resolves against the real grammar in `skills/ready/ready.js`. *(`## Requires lines` section)*
6. States the line discipline (one paragraph or bullet per physical line, never hard-wrapped). *(H1)*

**`BUGS_HISTORY.md`:**
1. Names this file as archival / archaeological and loaded on demand. *(H1)*
2. States that fixed bugs are appended here, not to the active file. *(H1)*
3. Notes that breakout files at `bugs/<slug>.md` stay in place as diagnosis records. *(H1)*
4. States `/nightshift:ready` does not scan this file (because the walk-and-remove convention keeps active `Requires:` lines authoritative). *(`## Cross-reference resolution` section)*

**`PATTERNS.md`** (all H1):
1. Names this file as one of four repo-local indexes consulted on demand when relevant.
2. Defines a pattern as cross-cutting structure that would otherwise be re-described in two or more feature files.
3. States the graduation rule (lift into shared home, link from features rather than duplicating).
4. Optionally: describes recognition-sufficiency on the index (entry should let readers recognize when a pattern applies without first reading the breakout file).
5. Notes that `/nightshift:ready` does not parse PATTERNS.md (it is a pattern registry, not a work backlog), and directs the author to verify an added entry's breakout-file link target and run `ready` as a whole-session sanity pass.
6. States the line discipline (one paragraph or bullet per physical line, never hard-wrapped).

**Root `CLAUDE.md` `Backlogs and indexes` section:**
1. Instructs agents to consult relevant indexes on demand before proposing or starting related work.
2. Names the four subdirectories and three history archives.
3. Explains the walk-and-remove convention, `## Exploring`, and `/nightshift:ready`, including that `**Requires:**` carries in-backlog links only, that external primitives go on the optional `**External:**` line, and that breakout files carry neither line.
4. States that readiness and graduation do not authorize work without explicit current-session agreement to the current digest.
5. States that compatible governing-text changes continue autonomously after a cited contract-fit check.
6. Includes the final-presentation and agreement-freshness concepts under **Agreement reinforcement** above.
7. States the line discipline for every markdown file under `.claude/` (one paragraph or bullet per physical line, never hard-wrapped).

An earlier automatic-loading claim is replaced by the on-demand instruction rather than accepted as an enriched superset.

## Rules

- **Targeted-patch insertion rules** (shared across all rules below that say "propose a targeted patch"): (a) **append** the missing concept as a new paragraph at the end of the relevant template-controlled portion (after its last existing paragraph), unless the missing concept is naturally a sub-clause of an existing paragraph: then propose an **in-place edit** that adds the clause to that paragraph, quoting both before and after in the plan output so the user sees the exact change. (b) **Never re-flow** surrounding prose to "integrate" the addition; mechanical append is the safe default. (c) If multiple checklist items are missing, propose them as separate patches in the plan, not a single rewrite. The user can accept, reject, or hand-edit each patch.
- **Index files.** Create from template if missing. If present and the template-controlled portion covers every concept on the per-file checklist in `## Concept checklists` (verbatim or in equivalent project-specific prose), skip: including the enriched-superset case where the live content carries extra material the template doesn't. If present and missing checklist items, propose a **targeted patch** per the shared insertion rules above. User-controlled sections (per the template-controlled-portion definition in step 1) are never touched. If the live content is clearly project-specific custom enough that you can't confidently identify which concepts are missing vs. just-worded-differently, prefer `ask` over an automatic merge proposal. One replace rule sits beside the automatic-loading one: an index header whose `## Requires lines` section still describes bare text as a legal `**Requires:**` form (the pre-External grammar) has that whole template-controlled section replaced by the current template's section through the user-confirmed section-level merge, since the legacy section states the form in its bullet list and, in `FEATURES.md`, also in its form count and fenced example.
- **`QUICK_WINS_HISTORY.md`**, **`FEATURES_HISTORY.md`**, and **`BUGS_HISTORY.md`.** Create from template if missing. If present, follow the index-file rule: skip when concept-coverage is complete, propose a targeted patch (per shared insertion rules above) when concepts are missing, never touch the user-controlled `## Entries` section. If the parent index still has a populated `## Implemented` / `## Fixed` section while its history sibling is missing, surface the situation in the plan output but do not auto-migrate; the user decides whether to move them by hand.
- **Subdirectories.** Create if missing. Never touch existing contents. Applies to the four subdirs (`features/`, `bugs/`, `patterns/`, `plans/`). Any pre-existing subdirectory outside that set is left alone untouched.
- **`CLAUDE.md`.** Create minimally from template if missing. If present without a `Backlogs and indexes` section, offer to append it. If present with a section that's missing concepts the CLAUDE.md staleness rule above lists, propose a targeted patch (per shared insertion rules above; the section is the "template-controlled portion" here). Replace an earlier automatic-loading claim with the on-demand consultation rule in the same targeted patch. Enriched-superset sections (cover everything the template covers, plus non-contradictory project-specific phrasing or extras) are NOT stale and are skipped. If present with a similar section (any `##` heading containing "backlog" or "index") that's clearly project-specific custom content, show it and ask before editing.
- Do not add content to `CLAUDE.md` beyond the Backlogs-and-indexes block. Users have their own conventions for the rest of `CLAUDE.md`.

### Re-run on existing projects

The skill is idempotent. Re-running on a project that was scaffolded against an earlier version of these templates will:

- Skip every up-to-date index file and every existing subdirectory.
- Create any newly-required subdirectories that don't exist yet (commonly `plans/` on projects that predate that addition).
- Detect any stale template-controlled content (index file headers and the CLAUDE.md `Backlogs and indexes` section) and propose a header- or section-level merge that preserves user content (entries and custom CLAUDE.md prose).
- Detect hard-wrapped prose in any markdown file under `.claude/` and propose an `unwrap` action per file; the rewrite joins continuation lines and changes nothing else.

Always confirm the planned merge with the user before any file is rewritten.

## Templates

The content blocks below are authoritative. When creating `missing` files, write the template verbatim. When merging into existing files, adapt the relevant block only.

### `.claude/QUICK_WINS.md`

~~~markdown
# Quick wins

Refactors ready to land when time allows; not blocking any feature, but would improve the codebase meaningfully.

This file is **one of four repo-local indexes** agents consult on demand when relevant (alongside `FEATURES.md`, `BUGS.md`, `PATTERNS.md`). Active entries are kept inline, organized under thematic `##` sections you invent as work emerges. When a quick win lands, append a shipped-note entry to [`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md); do not move it within this file. Negative-knowledge findings (approaches attempted and reverted) are first-class promotion candidates from the history into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections.

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice and `/nightshift:init-backlog` unwraps it.

Capture shorthand: name the refactor, describe the current smell in a sentence or two, sketch the preferred shape. A reader should be able to start work from the entry alone. Anchor entries on identifiers that survive refactors -- symbol names, entry titles, commit hashes, config keys -- never on line numbers, plan-phase ordinals, bullet positions, or temporal qualifiers ("new", "recent"): a precise locator that rots misleads harder than a coarse one that holds.

**After adding a new entry, run `/nightshift:ready`** from the repo root to confirm it parses as a quick-wins work item against the real grammar in `skills/ready/ready.js`. Quick wins carry neither a `**Requires:**` nor an `**External:**` line; the failure mode to catch is an entry that doesn't parse as a `- ` bullet or `###` heading (ready reports it as a prose-only-section notice) while you can still fix it in the same session.

## (add sections as work emerges)

Nothing tracked yet.

## History

Implemented quick wins are archived in [`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md), consulted only on demand so the active backlog above stays scannable. When a quick win lands, append its entry there rather than to this file.
~~~

### `.claude/QUICK_WINS_HISTORY.md`

~~~markdown
# Quick wins (history)

Implemented quick wins, archived from `QUICK_WINS.md` so the active backlog stays scannable. **Archaeological**: loaded on demand. When a quick win lands, append its entry here rather than to the active file.

Entries appear in the order they shipped. Write each with enough context to recover the reasoning from the entry alone: investigation findings, reverted approaches, benchmarks, the commit or scope it landed in. Negative-knowledge findings (approaches attempted and reverted, with the reason) are the most valuable content here for preventing re-attempts; consider promoting those into the relevant `.claude/patterns/<slug>.md` Cautionary tales section when touching the pattern doc, leaving a one-line redirect here if cross-referenced.

## Cross-reference resolution

`/nightshift:ready` does **not** scan this file. When a quick win lands, every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced it is edited at the same time to drop the now-satisfied reference. The active `Requires:` lines therefore describe what is *currently* blocking. This file is purely archaeological; read it when you want to know what already shipped or to mine negative-knowledge findings, not to resolve dependencies.

## Entries

Nothing yet.
~~~

### `.claude/FEATURES.md`

~~~markdown
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

**After adding a new entry (or a feature breakout file), run `/nightshift:ready`** from the repo root to confirm the new entry parses and its `**Requires:**` line resolves against the real grammar in `skills/ready/ready.js`. A malformed line (wrapped without the parser's join rule, a misplaced `none.`, a broken or ambiguous link target, or a missing line entirely) otherwise sits in the backlog until the next readiness pass surfaces it.

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

Pre-dependency-analysis brainstorms live here. An entry is a draft feature whose breakout file carries `status: exploring` in its frontmatter; the design is being firmed up and a `**Requires:**` line isn't expected yet. `/nightshift:ready` lists these drafts titles-only in a clearly-marked not-ready section, never in the readiness set, and `/nightshift:exploring` renders the full draft list. When a draft firms up enough to declare its upstream gates, move it out of `## Exploring` into the appropriate themed `##` section, add the `**Requires:**` line, and drop the `status: exploring` frontmatter on the breakout file.

Nothing being explored yet.

## (add sections as features emerge)

Nothing captured yet.

## History

Implemented features are archived in [`FEATURES_HISTORY.md`](FEATURES_HISTORY.md), loaded on demand so the active backlog above stays scannable. When a feature (or slice) ships, append its entry there rather than to this file, AND walk every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`: remove the now-satisfied reference (if it was the only one, set the line to `Requires: none.`). The active `Requires:` lines describe what is *currently* blocking, so `/nightshift:ready` never has to consult the history file; the dependency graph settles as features ship.
~~~

### `.claude/FEATURES_HISTORY.md`

~~~markdown
# Features (history)

Implemented features, archived from `FEATURES.md` so the active backlog stays scannable. **Archaeological**: read only when consulted. When a feature (or a slice of a sliced feature) ships, append its entry here rather than to the active file.

The feature breakout file at `features/<slug>.md` stays in place as the historical design record; the entry here is a brief one-line note on what shipped and in which feature scope or commit. If follow-up work on the same feature changes the design meaningfully, prefer editing the original breakout file (and adding a second entry here for the follow-up) over creating a new file.

## Cross-reference resolution

`/nightshift:ready` does **not** scan this file. When a feature ships, every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced it is edited at the same time to drop the now-satisfied reference (see the convention in `FEATURES.md`'s `## Requires lines` and `## Slicing` sections). The active `Requires:` lines therefore describe what is *currently* blocking and the dependency graph settles as work ships. This file is purely archaeological; read it when you want to know what already shipped, not to resolve dependencies.

## Entries

Nothing yet.
~~~

### `.claude/BUGS.md`

~~~markdown
# Bugs

Known bugs awaiting attention. Short entries live here; bugs that need more than a few lines of description graduate to a dedicated file under `.claude/bugs/<slug>.md`.

This file is **one of four repo-local indexes** agents consult on demand when relevant (alongside `QUICK_WINS.md`, `FEATURES.md`, `PATTERNS.md`). When a bug is fixed, append its entry to [`BUGS_HISTORY.md`](BUGS_HISTORY.md); do not keep a `## Fixed` section inline.

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice and `/nightshift:init-backlog` unwraps it.

## Requires lines

**Every open bug entry carries a `**Requires:**` line** declaring what must be in place before the fix can land. Comma-separated on one physical line, same shape as `FEATURES.md` (the parser joins a wrapped line, but the line discipline above forbids wrapping):

- A markdown link to a feature, quick win, or bug. The reference is a current blocker; under the walk-and-remove convention below, a satisfied dependency is edited out of the line at the moment it ships or is fixed.
- The literal word `none.` if the fix is unblocked. An empty label is a structural error; `none.` is the only empty form.

Bare text in `**Requires:**` is a structural error. An external primitive (driver release, vendor support, user decision) goes on a separate, optional `**External:**` line directly below it, same grammar; `none.`, an empty label, or a link in it is a structural error. Every structural error names its remedy.

A missing `Requires:` line is a structural error. `/nightshift:ready` parses these lines. History entries carry neither line.

**After adding a new entry (or a bug breakout file), run `/nightshift:ready`** from the repo root to confirm the new entry parses and its `**Requires:**` line resolves against the real grammar in `skills/ready/ready.js`. A malformed line (wrapped without the parser's join rule, a misplaced `none.`, a broken or ambiguous link target, or a missing line entirely) otherwise sits in the backlog until the next readiness pass surfaces it.

**When a bug is fixed**, move its entry to [`BUGS_HISTORY.md`](BUGS_HISTORY.md) with a brief note on the fix and the commit it landed in; drop its `Requires:` and `External:` lines in the move. If the bug had its own file, keep the file in place as a historical record of the diagnosis.

**Then walk every other `**Requires:**` line in `FEATURES.md` and `BUGS.md`** and remove references to the just-fixed bug: if it was the only item on the line, set the line to `Requires: none.`. Mirror of the `FEATURES.md` walk-and-remove convention; `/nightshift:ready` never has to consult `BUGS_HISTORY.md`.

## Open

Nothing currently tracked.

## History

Fixed bugs are archived in [`BUGS_HISTORY.md`](BUGS_HISTORY.md), loaded on demand so the active list above stays scannable. When a bug is fixed, append its entry there rather than to this file, AND walk every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`: remove the now-satisfied reference (if it was the only one, set the line to `Requires: none.`). The active `Requires:` lines describe what is *currently* blocking, so `/nightshift:ready` never has to consult the history file; the dependency graph settles as bugs are fixed.
~~~

### `.claude/BUGS_HISTORY.md`

~~~markdown
# Bugs (history)

Fixed bugs, archived from `BUGS.md` so the active list stays scannable. **Archaeological**: read only when consulted. When a bug is fixed, append its entry here rather than to the active file.

The bug breakout file at `bugs/<slug>.md` (when present) stays in place as the historical diagnosis record; the entry here is a brief description of the fix and the commit it landed in.

## Cross-reference resolution

`/nightshift:ready` does **not** scan this file. When a bug is fixed, every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced it is edited at the same time to drop the now-satisfied reference (mirror of the `FEATURES.md` convention). The active `Requires:` lines therefore describe what is *currently* blocking; this file is purely archaeological.

## Entries

Nothing yet.
~~~

### `.claude/PATTERNS.md`

~~~markdown
# Patterns

Cross-cutting design patterns that apply across multiple features or feature families. Each entry points at a standalone file under `.claude/patterns/<slug>.md` with the full treatment.

This file is **one of four repo-local indexes** agents consult on demand when relevant (alongside `QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`).

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice and `/nightshift:init-backlog` unwraps it.

A pattern graduates here when the same structure would otherwise be re-described in two or more feature files. Lifting it into a shared home lets features link at the pattern rather than duplicating it, and makes design decisions about the pattern uniform across its members.

**Adding a pattern (or its breakout file) is not grammar-checked:** `/nightshift:ready` does not parse PATTERNS.md (it is a pattern registry, not a work backlog). When you add a pattern, verify its breakout-file link targets a real file under `.claude/patterns/` and run `/nightshift:ready` afterward as a whole-session sanity pass, so a stray malformed entry in the three work indexes is caught before it ships.

## Current patterns

Nothing captured yet.
~~~

### `CLAUDE.md` (fresh minimal file)

~~~markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Backlogs and indexes

Four repo-local indexes live under `.claude/`. Consult the relevant indexes before proposing or starting related work because a task may already be queued, designed, diagnosed, or covered by an existing pattern:

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

Backlog prose is one paragraph or one bullet per physical line, never hard-wrapped at a column: a search hit then shows the whole entry, the parsers anchor on whole lines, and an edit shows as one changed line instead of a reflowed block. `/nightshift:ready` reports a hard-wrapped file as a notice and `/nightshift:init-backlog` unwraps it.

Compatible governing-text changes that remain within the accepted digest continue autonomously after a cited contract-fit check.

When a final governing design is presented, invoke /nightshift:spec-agreement in final-presentation mode before asking for agreement.

Existing agreement is fresh only when the complete current candidate matches or passes contract-fit evaluation in the same session.

- `.claude/QUICK_WINS.md`: refactors ready to land when time allows. Shipped entries are appended to `.claude/QUICK_WINS_HISTORY.md` (described below).
- `.claude/FEATURES.md`: product-level feature ideas, with one file per feature under `.claude/features/`. Shipped entries are appended to `.claude/FEATURES_HISTORY.md` (described below). When sibling feature files start duplicating shared concerns (machinery, patterns, conventions), promote an umbrella file that hosts the shared content and trim the siblings to deltas; cross-references through an umbrella scale better than pairwise cross-references.
- `.claude/BUGS.md`: known bugs awaiting fix, with one file per bug under `.claude/bugs/` when more than a few lines of description is needed. Fixed entries are appended to `.claude/BUGS_HISTORY.md` (described below).
- `.claude/PATTERNS.md`: cross-cutting design patterns that span multiple features, with one file per pattern under `.claude/patterns/`. Complementary to the umbrella-promotion heuristic above: umbrellas cluster children of one family; patterns cluster concerns that span families. A pattern graduates here when the same structure would otherwise be re-described in two or more feature files.

Four locations sit alongside the indexes and are consulted only on demand when relevant work is in flight:

- `.claude/plans/<date>-<slug>.md`: implementation plans produced by the writing-plans workflow. **Ephemeral**: a plan exists while the implementation is in flight and is deleted once the work lands. The code, tests, and commits are the durable record. Plans are purely mechanical step-by-step instructions for the agent doing the work. There is no "implemented plans" archive.
- `.claude/QUICK_WINS_HISTORY.md`: archive of shipped quick wins, split out from `QUICK_WINS.md` so the active backlog stays scannable. Append entries here as soon as the quick win lands; the file itself is consulted only when something pulls it in (a pattern-doc cross-reference, an archaeological lookup, a negative-knowledge sweep). Negative-knowledge entries (approaches attempted and reverted) are first-class promotion candidates into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections.
- `.claude/FEATURES_HISTORY.md`: archive of shipped features and shipped slices, split out from `FEATURES.md` so the active backlog stays scannable. Append entries here as soon as a feature or slice lands.
- `.claude/BUGS_HISTORY.md`: archive of fixed bugs, split out from `BUGS.md`. Append entries here as soon as a bug is fixed.

**Walk-and-remove convention.** When a feature, slice, quick win, or bug-fix ships, the same change set that appends its entry to the relevant history archive ALSO walks every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` and drops references to the just-shipped item; if the dropped reference was the only one on the line, the line becomes `Requires: none.`. Active `Requires:` lines therefore describe what is *currently* blocking, and `/nightshift:ready` never has to consult the history archives to resolve dependencies; the dependency graph settles as work ships.

Brainstorming output lives in feature files (or in patterns when cross-cutting / in bugs when diagnostic) rather than as separate dated specs. Pre-feature exploratory brainstorms land as draft features with `status: exploring` frontmatter and an entry in `FEATURES.md`'s `## Exploring` section; `/nightshift:ready` lists them titles-only as drafts, never in the ready set, and `/nightshift:exploring` shows the full draft list. They graduate to a themed `##` section with a `**Requires:**` line once the design firms up.

The `/nightshift:ready` skill parses each entry's `**Requires:**` line (in-backlog links only) and optional `**External:**` line (external primitives only) in `FEATURES.md` and `BUGS.md` and reports the unblocked work set. Breakout files carry neither line; the index is the sole dependency authority and the parser reports a breakout that carries one. Run it when picking what to work on next.
~~~

### `CLAUDE.md` section (to append when `CLAUDE.md` exists without it)

Use the complete `## Backlogs and indexes` section from the fresh `CLAUDE.md` template above, minus the `# CLAUDE.md` header and intro line. Append with one blank line before the heading.
