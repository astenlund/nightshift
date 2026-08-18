# Surface exploring entries in ready

Status: signed off 2026-08-15 17:00, content: 75d266f0

Feature: exploring drafts stay visible through two views over one
parser output. `/nightshift:ready` lists `## Exploring` entry titles in
a clearly-marked not-ready section, and a new `/nightshift:exploring`
skill renders the full draft list (titles, excerpts, breakout links)
while deliberately omitting the ready set. Motivated 2026-08-15:
exploring drafts are excluded from the readiness set by design, which
is correct for "what can I build now" but means nothing ever resurfaces
them; the developer must remember to reread `FEATURES.md` for the
`## Exploring` section.

## Operating context

- **Deployment environment and operational criticality**: public GitHub
  plugin (`github.com/astenlund/nightshift`, self-hosted marketplace
  with autoUpdate); the ready parser is a daily work-selection surface
  for the author on Claude Code and Codex. This feature is additive
  read-only reporting; no production systems or external data are
  touched.
- **Audience**: judgment recorded: category `public` under the current
  component-to-category rule (repository, marketplace, and README
  address external installers, though the author is the primary
  consumer today; same judgment as the wave-lifecycle spec). A queued
  quick win (Recalibrate the audience-category judgment) may lower
  this category for unadopted open-source repos; the settled tier
  below is `high` from the fired uplifts even from a `low` baseline,
  so the derivation is robust to that recalibration.
- **Failure consequence and data or security sensitivity**: worst case
  is a misleading backlog report (a draft staying hidden, or a broken
  backlog reading as clean in the new view); recoverable by reading
  `FEATURES.md` directly. No data or security sensitivity. Not fired.
- **Concurrency and compatibility risk**: the parser is stateless and
  read-only; the risk is parity, both dual-host (Claude Code and Codex
  consume the same instruction prose) and dual-view (two renderers of
  one JSON schema must stay in sync). Fired.
- **Reversibility and recovery cost**: high reversibility; git-tracked
  prose and code with version-pinned releases, and consumers can pin
  or downgrade. Not fired.
- **Expected feature lifetime**: long-lived; a permanent shipped
  surface and output field, not an experiment. Fired.

Derivation per `internal/revise/rigor.js`: audience `public` gives
baseline `high`; fired uplifts recorded as judgments:
concurrency-and-compatibility, expected lifetime (2; deployment
criticality, failure consequence, and reversibility not fired).
`node internal/revise/rigor.js public 2` yields tier `high` with
per-dimension effort validation high, recovery high, compatibility
high, observability high, proof effort high (the cap applies; the
tier is `high` from the baseline alone).

## Design sketch

Two-view split, seamed at the parser/presentation boundary: the parser
emits one full-fidelity array, and the two views render different
projections of it, so the JSON schema never forks per view.

- `ready.js` keeps excluding `## Exploring` entries from `ready` /
  `blocked` / `external`, but instead of dropping them it collects each
  `###` entry under that section into a new top-level output array,
  `exploring`, always present (possibly empty) like the other output
  arrays. Each item carries `{ index, title, link, excerpt }`: `index`,
  `title`, and `excerpt` exactly as ready items do, plus `link`, the
  breakout-file target already parsed from a linked heading today but
  not emitted for ready items. `link` is emitted verbatim as parsed
  from the heading, which makes it `.claude/`-relative (index headings
  link `features/<slug>.md`); a renderer that prints it as a path
  prefixes the index directory (`.claude/features/<slug>.md`) so the
  printed path resolves from the repo root. Degenerate values follow
  two rules: when `link` is `null` the renderer omits the link line
  entirely, and a target that is not `.claude/`-relative (an absolute
  `http(s)` URL, which the shipped grammar admits and the broken-link
  check deliberately skips) prints verbatim with no prefix. A plain
  unlinked `###` heading still produces an item, with `link: null`.
  No `Requires:`
  parsing happens here; a historical-artifact `Requires:` line on an
  exploring entry stays ignored, per the existing carve-out.
- The collection is a FEATURES-only special case layered on the
  existing exclusion, not a general un-exclusion: the excluded-section
  machinery is shared across all three indexes, and no other index has
  an Exploring concept. Naming note: `classifyUnit` already uses an
  `excluded` flag to mean cycle membership; the new code must not
  overload that term for the exploring path.
- Collected exploring entries do not join the parser's entry
  registry: a `**Requires:**` reference pointing at an exploring
  draft keeps today's classification, a structural error for a
  reference whose target is not in the active backlog. Drafts are not
  schedulable targets, so readiness and dependency semantics stay
  byte-identical; this feature changes reporting only.
- Collected exploring entries join the existing broken-breakout-link
  notice check. Today excluded entries never reach it; once collected,
  a broken exploring link emits the same notice shape as a ready
  entry's would, with one wording carve-out: the shipped template's
  trailing "(its Requires line still resolves normally)" clause is
  false for drafts (no Requires parsing or resolution applies to
  them), so the exploring variant replaces that parenthetical with
  "(exploring draft; Requires lines do not apply)".
- `/nightshift:ready` renders titles only, under an unmistakable
  heading (for example "Exploring (drafts, not ready)"), placed after
  the existing sections and omitted when empty like them, with a
  one-line pointer to `/nightshift:exploring` for the detailed view.
  Titles-only keeps the "what can I build now" report compact while
  still resurfacing the drafts.
- `/nightshift:exploring` is a new skill
  (`skills/exploring/SKILL.md`, bundling no files of its own) that runs
  the same parser via `${CLAUDE_PLUGIN_ROOT}/skills/ready/ready.js` and
  answers the complementary question: what is simmering, and what
  should be firmed up or graduated next. A skill rather than a command,
  decided 2026-08-16 after the first implementation shipped it as a
  command: `/nightshift:ready`, the sibling view over the same array,
  is itself a skill with no wrapper, so both views of one JSON contract
  stay the same artifact kind; skills are the portable surface across
  hosts, while custom commands are not; and skill prose is the settled
  home for `${CLAUDE_PLUGIN_ROOT}`, which removes an otherwise
  unprobeable expansion question. The earlier bundles-nothing argument
  for a command was weak on its own terms, since the surface's entire
  job is invoking a bundled script. It renders each exploring
  entry with title, excerpt, and breakout link; deliberately omits
  `ready` / `blocked` / `external`; and always surfaces the parser's
  problem channels in full, because a user may run only this skill
  and a broken backlog must not read as clean: `structuralErrors`,
  `notices`, and the `indexes.missing` list (an absent index file,
  FEATURES.md included, surfaces as a broken backlog, never as an
  empty draft list). The skill carries the same failure contract as
  the ready skill's step 1: when the script reports `.claude/`
  missing it suggests `/nightshift:init-backlog` and stops, and when
  the script itself cannot run (node missing, script file absent) it
  reports that and stops; a failed check is not a clean check. Only
  when the parser ran clean and the exploring array is empty does the
  report say "no drafts in exploring" explicitly rather than printing
  nothing. Like ready, it is read-only and renders index excerpts; it
  never crawls breakout files or `status: exploring` frontmatter,
  keeping it a second renderer over the same parser output rather than
  a second data pipeline.
- Why a second surface instead of excerpts in the ready report: the
  two questions are distinct ("what can I build now" vs "what should I
  graduate next"), and a handful of drafts with paragraph excerpts
  would double the ready report. The middle option, an argument or
  mode on the existing surface (for example `/nightshift:ready
  exploring`), was considered and rejected: it would fork the ready
  skill's rendering rules inside one prose file, blur its single
  what-can-I-build-now mandate, and hide the draft view from the
  surface list, where a named surface is discoverable. The cost is a
  permanent cross-file-consistency obligation for one more shipped
  surface, accepted deliberately here; this rationale is recorded so
  a later review does not flag the surface as scope creep.

## Consumers of the changed output set

Adding an output array and a new surface changes value sets other
things describe or consume; each consumer's handling:

- `skills/ready/ready.js`: the change site (exploring collection plus
  the broken-link notice extension).
- `skills/ready/ready.test.js`: new fixtures asserting the full item
  shape (`{ index, title, link, excerpt }`), the `link: null`
  unlinked-heading branch, and the broken-exploring-link notice. The
  primary existing FEATURES fixture already contains an `## Exploring`
  section (`### [Draft thing](features/draft.md)`), so its assertions
  gain the expectation that `exploring` carries exactly that entry;
  fixtures without the section assert the always-present empty array.
- `skills/ready/SKILL.md`: its enumeration of the emitted JSON fields
  grows to include `exploring` and the existing `indexes` block (a
  pre-existing omission: the renderer never surfaces `indexes.missing`
  today), its "up to four sections" report count grows to five, and it
  states the titles-only rendering with the pointer to
  `/nightshift:exploring`. It also gains the same missing-index rule
  as the exploring view, so the two renderers stay in parity on every
  problem channel: an absent index file surfaces as a broken backlog
  in the ready report, never silently.
- `skills/exploring/SKILL.md`: the new surface, per the design sketch.
- `.claude/FEATURES.md` entry excerpt for this spec (the paragraph
  under `### [Surface exploring entries in ready]`): syncs to the
  spec body in the same change, per the excerpt-sync convention.
  Synced 2026-08-15 and re-synced 2026-08-16 when the surface moved
  back to a skill.
- `skills/init-backlog/SKILL.md`: the FEATURES.md index template's
  Exploring prose ("excludes this section from the readiness set on
  purpose") and the CLAUDE.md template's backlog section (home of the
  "`/nightshift:ready` skips them" wording) reword to name both views,
  along the lines of "listed titles-only by `/nightshift:ready`, never
  in the ready set; `/nightshift:exploring` shows the full drafts".
  The FEATURES.md template's `## Requires lines` carve-outs paragraph
  states the same retired claim ("excluded by name in the
  `/nightshift:ready` filter") and rewords in the same change.
  Distinct from the template bodies, the freshness checklist item and
  the either-location note that quote the "`/nightshift:ready` ignores
  `## Exploring`" concept need the same rewording, or staleness
  detection would judge correctly-updated scaffolds against the
  retired claim.
- `README.md`: the command table gains a `/nightshift:exploring` row
  (the table mirrors shipped surfaces); the rest of the summary stays
  deliberately non-exhaustive as today (it already omits `external`
  and `notices`).
- This repo's root `CLAUDE.md` backlog section states the skip
  verbatim ("`/nightshift:ready` skips them") and rewords in the same
  change, as do the matching sentence in this repo's own
  `.claude/FEATURES.md` Exploring preamble and that file's
  `## Requires lines` carve-outs paragraph (the "excluded by name in
  the `/nightshift:ready` filter" sentence).
- Same-file contention: the queued feature "Move deterministic
  init-backlog mechanics out of promptspace" also plans to rewrite
  `skills/init-backlog/SKILL.md` template bodies. Cheaper landing order:
  this feature's wording edits land first (small, prose-only), and
  the promptspace move carries the updated wording into whatever
  bundled artifacts it creates. The matching note in that feature's
  own entry is tracked as a follow-up of this review, since it is
  outside this spec's edit surface.
- This repo's `AGENTS.md`: the architecture section's `skills/`
  enumeration gains a `skills/exploring/` entry stating that it bundles
  no files of its own, invokes the ready skill's parser, and lives
  there so both views are the same artifact kind, host-portable, and
  on the settled plugin-root path. The universal-entry MVP later
  removed the legacy `commands/*.md` topology; no other Exploring
  wording needs revision.
- `.claude-plugin/plugin.json`: the shipping batch carries the standing
  one monotonic version bump (shipped surfaces change).
- Downstream projects' scaffolded index copies rot gently and get
  refreshed opportunistically or via a backlog-index version bump, not
  as a blocking part of this change.

## Verification

- The plugin-root dependency is settled by placement, not by probe:
  the surface is skill prose, and `${CLAUDE_PLUGIN_ROOT}` expansion in
  skill prose was confirmed live on 2026-08-15 (a `/nightshift:ready`
  invocation resolved it to the installed cache's absolute path). The
  provisional marker this section previously carried covered
  command-prose expansion, which no repository file could settle and
  no in-run probe could reach; moving the surface to a skill retired
  the question rather than deferring it. (live-claim: probed
  2026-08-16)
- Because the design is placement-independent (parser array, both
  renderings, problem channels, consumer rewording), the move cost one
  file relocation plus consumer prose; no behavior changed.

## Requirements

- None outstanding; the Exploring carve-out and the `###`-entry shape
  it parses are already shipped grammar.

**Requires:** none (FEATURES.md index entry).

## Hardening

- revise-spec graduated 2026-08-15 18:01 at 1a5cc8b, scope: whole file, content: b6e8b045
- revise-spec refreshed 2026-08-16 00:28 at 71d33ed, scope: whole file, content: ae790906 (surface moved to a skill at morning-report triage; live-claim fold-back)
- handover completed 2026-08-16 00:52 at fcd89d0, scope: whole file, content: 0d247294
- revise-spec refreshed 2026-08-18 20:17 at 476d8d8, scope: whole file, content: d01aadbf (universal-entry topology references)
