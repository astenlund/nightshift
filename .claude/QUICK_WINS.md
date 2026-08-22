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
in `skills/ready/ready.js`. Quick wins carry neither a `**Requires:**` nor an `**External:**` line; the
failure mode to catch is an entry that doesn't parse as a `- ` bullet or
`###` heading (ready reports it as a prose-only-section notice) while you
can still fix it in the same session.

## Rigor calibration

- **Recalibrate the audience-category judgment so public visibility alone does not
  read as `public`.** Today the audience component-to-category judgment (revise-spec
  grounding step in `internal/revise/spec.md` and `internal/revise/rigor.js`) maps a repo that is public on GitHub to category `public`
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

## Handover dispatch hygiene

- **Tell implementation subagents where their scratch files go.** `skills/handover/SKILL.md`
  says nothing about scratch locations, so dispatched
  subagents write working files into the project's `.tmp/` root, which is also the revise
  engine's state home (`revise-state.md`, `revise-round-result.md`, the payload files, the
  cumulative patch). Observed 2026-08-15 as a near-miss: task subagents left `cmp_a.txt`
  and `pre_b.txt` there and the controller cleared them before the next review run; nothing
  was clobbered. Preferred shape: one clause in the implementation step requiring each
  dispatch prompt to name a task-scoped subdirectory under `.tmp/` (never `.tmp/` itself),
  keeping scratch inside `.tmp/` so it stays consistent with the global no-`/tmp` rule.
  Check against [Durable run identity and concurrency protection](FEATURES.md) first: it
  designs a scope-hashed scratch home for the workflow's own state and may reshape which
  side of the collision needs fixing.

## Handover live-claim surfacing

- **Make the governing spec the durable record that a provisional live-claim is a
  designed carry-forward.** The clean-detection non-flag for designed `(live-claim:
  provisional)` markers in `skills/handover/SKILL.md` relies on the probe precondition
  being recorded per the spec-gate rules, but that record is the morning-report
  follow-up item in `.tmp/` scratch, which dies with the run. A fresh-session resume
  after a crash before the morning report has no on-artifact evidence that the marker
  is designed, so detection fails closed into the confirm the 2026-08-11 ruling meant
  to skip. Preferred shape: record the precondition on the spec at the marker site
  (for example `(live-claim: provisional, awaiting <precondition>)`, or the probe
  bullet naming its precondition inline), let the Validate-before-proceeding step read
  designed-ness from the artifact, and derive the morning-report item from that record
  instead of making the report the sole record.

- **Reconcile the Validate-before-proceeding step's general live-claim flag sentence
  with its carve-outs.** In `skills/handover/SKILL.md`, "they surface in the stated
  conclusion as a flag with the claim's context" still asserts every surviving
  `(live-claim: ...)` marker surfaces as a flag, while later sentences carve out
  `probed`, `deferred`, and designed-`provisional` markers as notes. The
  later-more-specific-wins pattern works but ships a contradiction each reader must
  arbitrate. Preferred shape: soften the general sentence to "as a flag or note per
  the classification below" so the paragraph asserts one thing.

## Agreement-gate follow-ups (deferred during present-spec-for-agreement revise-code)

Refactors the agreement-gate revise run reviewed and agreed are valid but deferred, because each either expands the shipped feature's scope or is an optimization beyond the approval gate's required behavior. Land independently.

- **Consolidate the duplicated spec-agreement preflight shared by the three revise wrappers.** `skills/revise-code/SKILL.md`, `skills/revise-plan/SKILL.md`, and `skills/revise-spec/SKILL.md` each repeat the same agreement sequence: resolution of agreement state, diagnostics, scope forwarding, authority gating, engine resolution, and engine diagnostics. Preferred shape: one shared configured helper the three wrappers invoke, preserving each wrapper's caller-specific authority. A README.md table entry mirrors the current three-way surface; keep it in sync.

- **Reuse one resolution-local artifact snapshot across governing-set expansion.** During one governing-set resolution the controller reads the same whole-file artifact more than once, redoing canonicalization and scanning. Preferred shape: snapshot each resolved artifact's canonical bytes and scan result once, then reuse it across expansion. Constraint: resolution-local only, never a persistent cache.

- **Reuse parsed ready-entry metadata for Requires and Slices instead of rescanning entry bodies.** `skills/ready/ready.js` scans the index during extraction, then `findRequires` and `parseSlices` each re-encode and rescan the same entry bodies. Preferred shape: the scan pass emits the parsed Requires and Slices records once per entry for reuse. Preserve the post-split Requires and External grammar in `ready.js` (the breakout-dependency-drift fix lands first and owns that grammar).

- **Break the agreement controller and its ready dependency cycle into narrower scanner and controller modules.** `skills/spec-agreement/spec-agreement.js` spans many concerns (scanning, selection, mutation, resolution, state, diffing, CLI) and imports `skills/ready/ready.js` while ready imports back, creating a feature-layer cycle. Preferred shape: extract the scanner/parser to a lower module both consume, and the controller keeps its closed skill CLI contract. Preserve the public skill and CLI/command surface unchanged. Lands after the breakout-dependency-drift fix, which extends `ready.js` with the External grammar and the breakout scan this extraction then moves.

- **Replace handover's duplicated agreement sequence with a narrow delegation to the shared agreement skill.** `skills/handover/SKILL.md` repeats the agreement flow rather than delegating. Preferred shape: a narrow delegation to the shared agreement skill while preserving handover-only completion-stamp and migration ordering.

- **Pass the already-validated derived diff through a compatible refresh.** A within-contract refresh recomputes a derived diff the controller has already validated. Preferred shape: reuse the validated derived diff through refresh without weakening the public closed contracts or adding a second trusted path. Requires a deliberate internal contract addition; not a silent internal change.

- **Restate the all-inactive staleness boundary at the round-boundary site only if a misread is observed.** The boundary is already stated at `internal/revise/SKILL.md` (sweep gate "when every applicable cell is inactive"; `Reactivate stale cells` "applies only at an all-inactive boundary"; the evaluated-boundary transition "with all applicable cells inactive"; sibling reactivation "only through the staleness sweep at an all-inactive boundary"). A vetted restatement was deferred because it changes no behavior today. If a wave incident ever shows a controller reading the boundary wrong, promote to a fix with the incident as evidence.

## Review dimension sourcing

- **Update the review dimensions against the latest superpowers guidance.** The dimension sets
  in `internal/revise/code.md`, `plan.md`, and `spec.md` were authored against an earlier
  superpowers plugin; diff them against the current superpowers review skills
  (requesting-code-review and neighbors) and fold in criteria that have since improved,
  keeping nightshift-specific dimensions intact.
## Wave lifecycle tuning

- **Stop counting verifier rounds toward the per-run round cap.** `internal/revise/SKILL.md`
  today counts verifier rounds against the per-run round cap (its limits sentence says
  "verifier rounds included"), whatever value that cap carries, so a long convergence eats the
  budget the verifier tail then needs; observed in the 2026-08-20 review-orchestration-tests
  spec run, which needed repeated user cap raises with the wave converged and only verifier
  work left. Preferred shape: the round cap governs reviewer rounds only, with the existing
  separate verifier-launch cap as the verifier tail's own budget. This edits a shipped
  lifecycle invariant, so it lands as a SKILL.md edit plus the matching update to the
  review-orchestration-tests spec and the shipped orchestration module fixtures in the same
  change set (the limits sentence is pinned verbatim by `internal/revise/orchestration.test.js`,
  so CI forces the pairing).

## Revise engine verification

- **Run the deferred Workflow-runtime ordering probe.** The immediate-skeptic-dispatch
  design record ([features/immediate-skeptic-dispatch.md](features/immediate-skeptic-dispatch.md))
  validates its dispatch ordering only through the deterministic test double; its
  Verification section defers the live probe through the real Workflow runtime
  (`(live-claim: deferred 2026-08-10)`) and it was never run. Preferred shape: run the
  spec's blocked-sibling scenario through the real Workflow runtime, capturing reviewer
  and skeptic submission-call initiation plus controller-observed completion events, and
  pass only under the ordering assertions the spec states; also inspect the shipped
  fan-out loop for the construction-and-submission-only body. Account for drift since
  the spec was written: the engine lives in `internal/revise/`, and the Workflow path
  now runs a low-effort dedup judge before each skeptic dispatch (a recorded dedup
  judgment replaces a skeptic submission for duplicate-shape findings), so the probe's
  assertions must treat a dedup-judge call as part of the fan-out rather than as an
  unrelated wait between sibling submissions.

## Migration pin retirement

- **Retire the 2.4.5 legacy baseline together with its fidelity pin.** The
  `tests/fixtures/legacy-plugin-2.4.5` fixture serves two consumers: the procedure
  fidelity test in `tests/universal-skill-topology.test.js` byte-compares
  `skills/revise-docs/SKILL.md` and `skills/revise-lore/SKILL.md` against the fixture's
  legacy command files modulo the `PROCEDURE_REPLACEMENTS` whitelist in
  `tests/entry-contract.js`, and `loadLegacyBaseline` in
  `tests/host-discovery-smoke-lib.js` installs the fixture as the upgrade baseline in
  the host-discovery smoke harness's repeat mode. The pin's maintenance cost grows with
  every substantive edit to either skill (each edit needs a whitelisted phrase pair, and
  revise-docs carries only the pairs noted at the end of this bullet, so its body must
  stay byte-identical to the 2.4.5 command modulo those), while its value decays as the
  skill migration ages. Preferred shape:
  once the migration is considered proven, remove the fidelity test, the fixture, and
  the smoke repeat-mode baseline in one change set. Removing the fixture alone is not
  an option: it breaks the topology suite in CI and silently breaks the live smoke
  run's repeat mode, which fabricates its own replica only in the deterministic tests.
  The breakout-dependency-drift fix adds two `revise-docs` phrase pairs to `PROCEDURE_REPLACEMENTS`; retiring the pin removes them with it.

## Release integrity

- **Detect shipped behavior changes that carry no version increase.** Nothing in the
  repository enforces the convention it most cares about. `tests/release-surface.test.js`
  checks the version's shape and manifest/marketplace parity, but no check correlates a
  change set's file list against a version increase, so shipping a `SKILL.md` edit with a
  stale `version` passes every suite. The retired literal pin (`assert.equal(manifest.version,
  '2.5.6')`) never covered this either: it fired only when someone bumped the version, the
  correct action, and stayed silent on the violation. Preferred shape: a check that reads the
  unpushed range's changed paths, classifies them against the convention's shipped-behavior
  list (public and internal `SKILL.md`, bundled non-test skill resources, `hooks/**`, and every
  `plugin.json` field other than `version`), and requires exactly one monotonic increase when
  any of them changed. Needs git access from the check, which is why it was deferred rather
  than folded into the relocation that surfaced it.

## Agreement digest economy

- **Shorten the decision-complete digest and cut what it costs to produce.** The digest
  contract in `skills/spec-agreement/SKILL.md` mandates all eleven fields rendered every
  time "without omitting a material decision for brevity", over a baseline built by
  reading the full governing set, selecting and hashing each artifact, then rerunning
  complete resolution and byte capture to prove stability. For a small single-bug scope
  the render runs longer than the governing spec it summarizes, and the presentation
  baseline costs two full resolution passes before a single word is shown. Preferred
  shape: keep decision-completeness as the invariant and attack the rest, for example a
  density pass on the mandated field prose, collapsing source-empty fields into one line
  rather than eleven labelled stanzas, and reusing the first pass's artifact bytes for
  the stability re-check instead of a second cold read. Constraint: no field may become
  optional and no material decision may be dropped; the two `none explicitly stated` and
  `none found after full governing-set review` tokens stay distinguishable, since they
  encode different evidence. Check against
  [Reuse one resolution-local artifact snapshot across governing-set expansion](#agreement-gate-follow-ups-deferred-during-present-spec-for-agreement-revise-code)
  first: it already proposes a resolution-local snapshot and may cover the re-read half.

## (add sections as work emerges)

## History

Implemented quick wins are archived in
[`QUICK_WINS_HISTORY.md`](QUICK_WINS_HISTORY.md), consulted only on
demand so the active backlog above stays scannable. When a quick win
lands, append its entry there rather than to this file.
