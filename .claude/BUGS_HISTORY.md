# Bugs (history)

Fixed bugs, archived from `BUGS.md` so the active list stays scannable. **Archaeological**: read only when consulted. When a bug is fixed, append its entry here rather than to the active file.

The bug breakout file at `bugs/<slug>.md` (when present) stays in place as the historical diagnosis record; the entry here is a brief description of the fix and the commit it landed in.

## Cross-reference resolution

`/nightshift:ready` does **not** parse this file for work; only the line-discipline check reads it. When a bug is fixed, every other `**Requires:**` line in `FEATURES.md` / `BUGS.md` that referenced it is edited at the same time to drop the now-satisfied reference (mirror of the `FEATURES.md` convention). The active `Requires:` lines therefore describe what is *currently* blocking; this file is purely archaeological.

## Entries

- **Shared sync-gists skill names the wrong backlog command.** Corrected the canonical personal `sync-gists` skill's Nightshift suite note from `init-workflow` to `init-backlog`, so the documented command matches the repository and shipped plugin. Shipped in this commit.
- **Feature breakout dependency lines drift from the active index.** The index is now the sole dependency authority: `**Requires:**` holds in-backlog links only and a new optional `**External:**` line holds external primitives, every breakout file under `features/` and `bugs/` lost its dependency line, and `skills/ready/ready.js` reports bare text in Requires, links or none. in External, an empty label, and any dependency line found in a linked breakout file as structural errors carrying a remedy. Every prose surface (index headers, ready/exploring/handover/revise-docs/init-backlog skills, README, AGENTS.md) describes the two-line convention. Shipped 2026-08-22 in the range 17d24cd..HEAD (plugin 2.6.0); diagnosis stays in [`bugs/feature-breakout-dependency-drift.md`](bugs/feature-breakout-dependency-drift.md).
- **Plan refreshed stamps are rejected by the provenance grammar.** `REFRESHED_PROVENANCE` in `skills/spec-agreement/spec-agreement.js` accepted only `revise-spec refreshed` lines while the graduated grammar already accepted both loops, so a plan edited after its graduated stamp could not carry the `revise-plan refreshed` stamp that handover's post-stamp-edits rule prescribes. The regex now accepts `revise-(?:spec|plan) refreshed`, and a spec-agreement test writes a plan refreshed stamp through `writeProvenanceStamp` and reads it back, including the applied-retry path. Shipped 2026-08-22 (plugin 2.6.1).
