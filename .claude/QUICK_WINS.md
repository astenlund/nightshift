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
  "Clean detection" paragraphs in `commands/handover.md` (or the shift-start section) to
  state that designed/cutover-gated provisional markers and same-session mid-flight
  resumes are non-flags.

## Revise engine prose structure

- **Restructure the Manual Agent path session-reconciliation paragraph in
  `skills/revise/SKILL.md` into a labeled case list.** The paragraph beginning
  "Controller interruption, drift, and explicit abandon retain the existing
  best-effort semantics" is a single ~4900-character block bundling roughly eight
  separately-conditioned recovery branches (reviewer/skeptic session available vs
  unavailable, in-flight vs needs-retry row mismatches, both-Session-ID-none) in
  run-on prose, nearly 3x the file's next-largest paragraph and against the file's
  own bullet-list convention for enumerated branch rules ("Use only these values",
  "Then adjudicate"). Preferred shape: one labeled case per branch stating its
  state precondition and its result-then-state replacement action, byte-level
  semantics preserved. This is load-bearing crash-recovery prose, so the
  restructure is its own reviewed change (confirmed by the 2026-08-14 wave-batch
  revise-code run and deliberately deferred there).

## Rigor calibration

- **Recalibrate the audience-category judgment so public visibility alone does not
  read as `public`.** Today the audience component-to-category judgment (revise-spec
  grounding step in `skills/revise/spec.md`, feeding `AUDIENCE_BASELINE` in
  `skills/revise/rigor.js`) maps a repo that is public on GitHub to category `public`
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

## Revise engine convergence

- **Require a clean LGTM to certify a fingerprint; a refuted-findings round no
  longer suffices.** Today `skills/revise/SKILL.md`'s round-boundary rule makes a
  cell inactive when every skeptic-verified finding landed refuted or
  acknowledgement-only accepted, certifying the fingerprint with the skeptic
  evidence as rationale. User ruling 2026-08-15: revert to requiring a proper
  clean conclusion (LGTM plus concrete verification note) against the
  fingerprint before a cell certifies; a reviewer locked onto a doomed finding
  has demonstrably misread part of the artifact and its implicit all-clear is
  weak, and valid-but-deferred findings (equally content-preserving) already
  keep the cell active, so this restores symmetric treatment of no-edit
  outcomes. Touches the lifecycle bullet, the adjudication round-boundary
  bullet, and repair safety rule 1's refuted-round clause in SKILL.md, plus
  README's dimension-convergence sentence. Livelock countermeasure is the
  existing acknowledgements ledger (the refuted finding's acknowledgement rides
  into the next round's payload) with the 30-round cap as backstop; note that
  in the edit. Open question to settle at implementation: whether the verifier
  keeps its current stamp-on-refuted-only behavior (its deferred-findings
  never-block rationale is separately recorded) or gets the same clean-pass
  requirement at the cost of extra verifier launches. Field evidence
  (2026-08-15, exploring-visibility code review): the ruling was honored as
  controller behavior and fired once. Structural-health's round-2 finding was
  refuted, so the shipped rule would have certified the cell there; the extra
  pass cost one agent and returned a clean LGTM whose verification note covered
  ground the refuted round never touched (the `ready.js` header-comment JSON
  shape, the completeness of the five-file prose sweep, and the README and
  AGENTS.md consumer updates). One datapoint, but it is the argument's own
  claim: the extra pass buys coverage rather than repetition.

## Handover dispatch hygiene

- **Tell implementation subagents where their scratch files go.** `commands/handover.md`'s
  implementation step says nothing about scratch locations, so dispatched subagents write
  working files into the project's `.tmp/` root, which is also the revise engine's state
  home (`revise-state.md`, `revise-round-result.md`, the payload files, the cumulative
  patch). Observed 2026-08-15 as a near-miss: task subagents left `cmp_a.txt` and
  `pre_b.txt` there and the controller cleared them before the next review run; nothing was
  clobbered. Preferred shape: one clause in the implementation step requiring each dispatch
  prompt to name a task-scoped subdirectory under `.tmp/` (never `.tmp/` itself), keeping
  scratch inside `.tmp/` so it stays consistent with the global no-`/tmp` rule. Check
  against [Durable run identity and concurrency protection](FEATURES.md) first: it designs a
  scope-hashed scratch home for the workflow's own state and may reshape which side of the
  collision needs fixing.

## (add sections as work emerges)

## History

Implemented quick wins are archived in
[`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md), read only when
consulted (not at session start) so the active backlog above stays
scannable. When a quick win lands, append its entry there rather
than to this file.
