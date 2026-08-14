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

`/nightshift:ready` does **not** scan this file. When a feature ships, every
other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced
it is edited at the same time to drop the now-satisfied reference (see
the convention in `FEATURES.md`'s `## Requires lines` and `## Slicing`
sections). The active `Requires:` lines therefore describe what is
*currently* blocking and the dependency graph settles as work ships.
This file is purely archaeological; read it when you want to know
what already shipped, not to resolve dependencies.

## Entries

- [Dependency-cycle detection](features/dependency-cycle-detection.md): /nightshift:ready now surfaces dependency cycles as structural errors (edges from top-level `**Requires:**` lines; SCCs of two or more entries). Shipped 2026-08-11 in the 2.0.27 batch (commits aa667f6..d4b28dd).
- [Calibrate first-draft rigor to deployment context](features/calibrate-first-draft-rigor.md): revise-spec and revise-plan grounding steps check for a complete `Operating context` section and derive/fill it at the shift-start entry point (consulting the user when durable knowledge runs short, persisting only gap facts), raise `structural-precondition-error` for absent/skeletal sections, and propagate the section unchanged into reviewer payloads as a calibration channel; a deterministic `rigor.js` helper maps audience category + uplift count to a capped tier and per-dimension effort. Shipped 2026-08-13 in the 2.0.29 batch (commits d547c7d..aae4ff6).
- [Simplify the revise lifecycle around rounds](features/revise-lifecycle-rounds.md): superseded 2026-08-13 without shipping by [Wave-convergence lifecycle with a holistic gate](features/wave-lifecycle.md), which removes the phase model the restatement would have clarified. The file remains as a historical design record; its round cap, cap-end asymmetry rule, change-free-final-state rationale, and all-refuted trade note were absorbed into the wave feature.
- [Wave-convergence lifecycle with a holistic gate](features/wave-lifecycle.md): the revise engine's phase model replaced by staleness-driven reactivation waves, per-cell fingerprint certifications, and a holistic opus verifier whose stamp gates completion. Shipped 2026-08-14 in the 2.2.0 batch.
- Dedup-before-verify (no breakout file): the Workflow path's reviewer-to-skeptic fan-out gained a low-effort dedup judge letting a finding that makes the same claim about the same code as one already under verification share that sibling's fresh skeptic verdict (surfaced as `sharedVerdictFrom`, persisted as `Shared verdict from:`), failing open to a fresh skeptic on any uncertain or failed judgment; SKILL.md contract amendments scope the exception to the Workflow path, and the safety suite grew to 51 cases covering sharing, chaining, indexing, and fail-open. Proposed in a revise-run dimension retrospective and shipped the same day, 2026-08-14, in the 2.3.0 batch (commits 0daca47..813a489).
