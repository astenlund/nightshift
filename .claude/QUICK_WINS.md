# Quick wins

Refactors ready to land when time allows; not blocking any feature, but
would improve the codebase meaningfully.

This file is **one of four repo-local indexes** agents consult on demand
when relevant (alongside `FEATURES.md`, `BUGS.md`, `PATTERNS.md`). Active
entries are kept inline, organized under thematic `##` sections you
invent as work emerges. When a quick win lands, append a shipped-note
entry to [`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md); do not move
it within this file. Negative-knowledge findings (approaches attempted
and reverted) are first-class promotion candidates from the history
into the relevant `.claude/patterns/<slug>.md` Cautionary tales sections.

Readiness and graduation are not approval: before spec-governed work, present the current decision-complete digest and obtain explicit agreement in this session.

Capture shorthand: name the refactor, describe the current smell in a
sentence or two, sketch the preferred shape. A reader should be able to
start work from the entry alone. Anchor entries on identifiers that
survive refactors -- symbol names, entry titles, commit hashes, config
keys -- never on line numbers, plan-phase ordinals, bullet positions,
or temporal qualifiers ("new", "recent"): a precise locator that rots
misleads harder than a coarse one that holds.

**After adding a new entry, run `/nightshift:ready`** from the repo root
to confirm it parses as a quick-wins work item against the real grammar
in `skills/ready/ready.js`. Quick wins carry no `**Requires:**` line; the
failure mode to catch is an entry that doesn't parse as a `- ` bullet or
`###` heading (ready reports it as a prose-only-section notice) while you
can still fix it in the same session.

## Handover shift-start confirmation heuristic

- **Do not raise the shift-start confirm for designed provisional live-claims plus a
  mid-flight implementation resume.** Today handover stops at the confirm line when the
  only flags are `(live-claim: provisional)` markers that are cutover-gated/designed AND
  an in-progress implementation resume. The user ruled 2026-08-11 that neither is
  confirm-worthy: skip straight to building the queue. Keep the confirm only for real
  ambiguity, artifact-selection doubt, validation findings, or drift. Refine the
  "Clean detection" paragraphs in the active handover entry source (`commands/handover.md`
  before the universal-entry MVP, `skills/handover/SKILL.md` after it) to
  state that designed/cutover-gated provisional markers and same-session mid-flight
  resumes are non-flags. Prefer landing the universal-entry MVP first; if this quick
  win lands earlier, apply it to the pre-MVP source and carry its behavior forward
  unchanged during relocation.

## Rigor calibration

- **Recalibrate the audience-category judgment so public visibility alone does not
  read as `public`.** Today the audience component-to-category judgment (revise-spec
  grounding step in the active revise engine (`skills/revise/spec.md` and
  `skills/revise/rigor.js` before the universal-entry MVP, `internal/revise/spec.md`
  and `internal/revise/rigor.js` after it) maps a repo that is public on GitHub to category `public`
  and thus baseline `high`, even with no adoption signals; nightshift's own specs
  (the wave-lifecycle Operating context, the ready-exploring-visibility one) recorded
  exactly that judgment. User ruling 2026-08-15: a public repo with no forks and no
  or few stars is a solo project that happens to have its source open; it should not
  earn a `high` baseline from visibility alone. Preferred shape: sharpen the judgment
  guidance so `public` requires actual external adoption signals (forks, stars, known
  downstream installs), with an unadopted open-source repo mapping to `personal use`;
  decide whether `AUDIENCE_BASELINE` needs a distinct category or only sharper
  judgment prose, and sweep existing recorded judgments in specs' Operating context
  sections for recalibration. Uplift predicates stay as-is.
  Prefer landing the universal-entry MVP first; if this quick win lands earlier, apply
  it to the pre-MVP sources and carry its behavior forward unchanged during relocation.

## Handover dispatch hygiene

- **Tell implementation subagents where their scratch files go.** The active handover entry
  source (`commands/handover.md` before the universal-entry MVP,
  `skills/handover/SKILL.md` after it) says nothing about scratch locations, so dispatched
  subagents write working files into the project's `.tmp/` root, which is also the revise
  engine's state home (`revise-state.md`, `revise-round-result.md`, the payload files, the
  cumulative patch). Observed 2026-08-15 as a near-miss: task subagents left `cmp_a.txt`
  and `pre_b.txt` there and the controller cleared them before the next review run; nothing
  was clobbered. Preferred shape: one clause in the implementation step requiring each
  dispatch prompt to name a task-scoped subdirectory under `.tmp/` (never `.tmp/` itself),
  keeping scratch inside `.tmp/` so it stays consistent with the global no-`/tmp` rule.
  Check against [Durable run identity and concurrency protection](FEATURES.md) first: it
  designs a scope-hashed scratch home for the workflow's own state and may reshape which
  side of the collision needs fixing. Prefer landing the universal-entry MVP first; if
  this quick win lands earlier, apply it to the pre-MVP source and carry its behavior
  forward unchanged during relocation.

## Agreement-gate follow-ups (deferred during present-spec-for-agreement revise-code)

Refactors the agreement-gate revise run reviewed and agreed are valid but deferred, because each either expands the shipped feature's scope or is an optimization beyond the approval gate's required behavior. Land independently.

- **Consolidate the duplicated spec-agreement preflight shared by the three revise wrappers.** `skills/revise-code/SKILL.md`, `skills/revise-plan/SKILL.md`, and `skills/revise-spec/SKILL.md` each repeat the same agreement sequence: resolution of agreement state, diagnostics, scope forwarding, authority gating, engine resolution, and engine diagnostics. Preferred shape: one shared configured helper the three wrappers invoke, preserving each wrapper's caller-specific authority. A README.md table entry mirrors the current three-way surface; keep it in sync.

- **Reuse one resolution-local artifact snapshot across governing-set expansion.** During one governing-set resolution the controller reads the same whole-file artifact more than once, redoing canonicalization and scanning. Preferred shape: snapshot each resolved artifact's canonical bytes and scan result once, then reuse it across expansion. Constraint: resolution-local only, never a persistent cache.

- **Reuse parsed ready-entry metadata for Requires and Slices instead of rescanning entry bodies.** `skills/ready/ready.js` scans the index during extraction, then `findRequires` and `parseSlices` each re-encode and rescan the same entry bodies. Preferred shape: the scan pass emits the parsed Requires and Slices records once per entry for reuse. Preserve the exact Requires-line grammar in `ready.js`.

- **Break the agreement controller and its ready dependency cycle into narrower scanner and controller modules.** `skills/spec-agreement/spec-agreement.js` spans many concerns (scanning, selection, mutation, resolution, state, diffing, CLI) and imports `skills/ready/ready.js` while ready imports back, creating a feature-layer cycle. Preferred shape: extract the scanner/parser to a lower module both consume, and the controller keeps its closed skill CLI contract. Preserve the public skill and CLI/command surface unchanged.

- **Move generic release and conformance assertions out of the agreement controller suite.** The agreement controller test suite also covers generic repository-release state and command/CLI conformance, so version bumps and doc changes unnecessarily edit feature-specific tests. Preferred shape: relocate generic assertions to a generic suite that exercises release and command surface, so browsing the feature tests stays feature-scoped.

- **Replace handover's duplicated agreement sequence with a narrow delegation to the shared agreement skill.** `skills/handover/SKILL.md` repeats the agreement flow rather than delegating. Preferred shape: a narrow delegation to the shared agreement skill while preserving handover-only completion-stamp and migration ordering.

- **Pass the already-validated derived diff through a compatible refresh.** A within-contract refresh recomputes a derived diff the controller has already validated. Preferred shape: reuse the validated derived diff through refresh without weakening the public closed contracts or adding a second trusted path. Requires a deliberate internal contract addition; not a silent internal change.

- **Restate the all-inactive staleness boundary at the round-boundary site only if a misread is observed.** The boundary is already stated at `internal/revise/SKILL.md` (sweep gate "when every applicable cell is inactive"; `Reactivate stale cells` "applies only at an all-inactive boundary"; the evaluated-boundary transition "with all applicable cells inactive"; sibling reactivation "only through the staleness sweep at an all-inactive boundary"). A vetted restatement was deferred because it changes no behavior today. If a wave incident ever shows a controller reading the boundary wrong, promote to a fix with the incident as evidence.

## (add sections as work emerges)

## History

Implemented quick wins are archived in
[`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md), consulted only on
demand so the active backlog above stays scannable. When a quick win
lands, append its entry there rather than to this file.
