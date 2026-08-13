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
