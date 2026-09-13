# Nightshift repository instructions

## Purpose and workflow

Nightshift is a Claude Code and Codex plugin for carrying agreed engineering work through implementation, independent review, verification, documentation, session retrospective and follow-up triage. Its invariant priorities are autonomy first, quality second, then speed and economy, within the user's authority and limits.

Use [VISION.md](VISION.md) and [WORKFLOW.md](WORKFLOW.md) for the agreed direction, [the v3 feature](.nightshift/features/nightshift-v3.md) for supported scope, and [the operating brief](internal/workflow.md) for execution. Historical proposals and migration records preserve reasoning; they do not reinstate retired requirements or authorize implementation.

Investigate the request and settle consequential commitments. Small work can use an agreed readback; substantial work needs a concise governing spec. Preserve valid agreement through compatible corrections and compaction. Implement directly with a strong model. Written implementation plans are exceptional guidance for deliberately chosen weaker or cheaper implementers, not a routine stage. There is no Superpowers dependency or plan-stamp/wave-verifier ladder.

The repository is self-hosting: agreed implementation work on Nightshift uses its complete lifecycle. After the user agrees the implementation scope, create or reconcile an attended runtime run before implementation, following [the operating brief](internal/workflow.md). An explicit handover selects unattended operation and its continuation requirements. Use [revise-code](skills/revise-code/SKILL.md) for independent review and repair, [revise-docs](skills/revise-docs/SKILL.md) for documentation and backlog reconciliation, then [revise-lore](skills/revise-lore/SKILL.md) for the session retrospective before follow-up triage. Record the actual work and evidence through runtime operations. Direct reviews, ordinary documentation edits or a retrospective label alone do not complete those workflows.

Within that lifecycle, every review considers the full dimension brief, every finding receives fresh skeptical validation and a value/authority disposition, and every repair batch receives relevant checks and strong cumulative reassessment. Fable and Astra are interchangeable strong roles; prefer equivalent-strength cross-host review when suitable, with fresh same-host review valid. Plain `review` and `review-loop` requests retain the global direct-agent routines and do not activate this lifecycle; explicit `revise` invokes Nightshift. Investigation and discussion before implementation agreement remain interactive and do not start a delivery run. If required machinery is unavailable, preserve progress and report the missing capability and obligations. Completion reports identify which required workflows actually ran and which remain incomplete; later recovery does not retroactively complete an earlier omitted stage.

Use [the runtime interface](internal/runtime/REFERENCE.md) before operating a run. `.nightshift/runs/state.sqlite` owns durable run state; native goals and hooks support continuation. Read focused status at consequential boundaries and after compaction, reconcile actual files and surviving workers, and use runtime operations instead of editing saved state. Scratch notes do not replace that authority. Finish documentation before the session retrospective, then triage follow-ups one at a time.

## Project artifacts and backlog

Project-owned Nightshift artifacts live under `.nightshift` on both hosts. Host-owned configuration stays in its required location. `CLAUDE.md` imports this file; keep repository guidance canonical here.

Consult relevant indexes before proposing or starting related work:

- [FEATURES.md](.nightshift/FEATURES.md): features and Exploring drafts, with design records under `.nightshift/features`.
- [BUGS.md](.nightshift/BUGS.md): known defects; longer diagnoses belong under `.nightshift/bugs`.
- [QUICK_WINS.md](.nightshift/QUICK_WINS.md): smaller work items.
- [PATTERNS.md](.nightshift/PATTERNS.md): reusable concerns spanning features, with supporting files under `.nightshift/patterns`.

Keep index excerpts consistent with their feature or bug records. Share genuinely repeated design concerns through a pattern or family umbrella instead of duplicating them. Readiness and graduation are not implementation authority. Exploring entries remain outside the ready set until their commitments and dependencies are settled.

Dependency declarations belong in the indexes, not breakout files. Preserve the `Requires`/`External` grammar and use the real ready parser to evaluate it. When work ships or a bug is fixed, move its entry to the corresponding `FEATURES_HISTORY.md`, `QUICK_WINS_HISTORY.md` or `BUGS_HISTORY.md`, remove satisfied dependency references from active indexes, and re-run the parser. Retired proposals are recorded as retired, never as shipped or fixed. [MIGRATION_STATUS.md](.nightshift/MIGRATION_STATUS.md) and [V3-MIGRATION.md](V3-MIGRATION.md) retain the v2 dispositions; `.nightshift/migration/v2` holds the original indexes.

Keep backlog paragraphs and bullets on single physical lines. Run `unwrap.js` against the relevant file for hard-wrap repairs, inspect its diff, then run ready again. Initialization does not automatically unwrap existing prose.

Feature brainstorming belongs in feature records; new standalone governing specs belong in `.nightshift/specs`, and durable acceptance reports belong in `.nightshift/reports`. Respect explicitly selected document locations.

Exceptional implementation plans belong in ignored `.nightshift/plans` and are temporary working aids; preserve existing plans unless their cleanup is authorized. `.nightshift/inbox` and `.nightshift/runs` are ignored here; the inbox is the maintainer's drop box for reports about Nightshift raised in any project, created on demand and triaged only when the user asks. When presenting ready work in this repository, also list the files currently in `.nightshift/inbox` by name as untriaged maintainer reports, in a separate section after the ready set, and omit that section when the inbox is empty or absent; they are not backlog entries and confer no authority until triaged. Setup writes its self-ignored recovery journal under `.nightshift/setup`; preserve that journal when resolving migration conflicts. Temporary scripts, probes and raw acceptance evidence belong in `.tmp`; preserve evidence still needed for resumption or assessment.

## Architecture

The eight public skills are `exploring`, `handover`, `init-backlog`, `ready`, `revise-code`, `revise-docs`, `revise-lore` and `revise-spec`. Their instructions live under `skills`; shared operating rules live in `internal/workflow.md`.

- `internal/runtime/cli.js` exposes the operations documented in `internal/runtime/REFERENCE.md`. Runtime modules separate SQLite storage, lifecycle gates, evidence and review, host dispatch, private probes and worker ownership.
- `hooks/hooks.json` and `internal/runtime/hook.js` provide SessionStart, PreCompact and Stop integration. Hook configuration is not proof that continuation is loaded or trusted on a host.
- `skills/init-backlog/init-backlog.js` delegates setup and migration to `internal/setup.js`, with reference translation in `internal/migration-references.js`.
- `skills/ready/ready.js` owns dependency analysis, using `internal/backlog-catalog.js` for catalog primitives and `internal/markdown.js` for scanning. Unwrapping shares `internal/backlog-catalog.js`. Keep setup, parser and unwrap consumers coherent when changing these shared modules; add meaningful fixture coverage for grammar changes.

Resolve bundled resources from the executing skill/plugin root and target-project paths from the actual checkout under review. Derive probe payloads, commands and cleanup paths from that root rather than hardcoding the canonical clone.

## Development and verification

The verified host target is Windows with Node.js 22.23 or later, Git, PowerShell 7 and native Claude Code/Codex executables. Other operating systems and command-shim-only installations remain unverified. Node uses built-in modules, including SQLite; no package installation is needed.

Run commands from the repository root, using `pwsh -NoProfile` for PowerShell:

- Catalog: `node skills/ready/ready.js .`
- Backlog line check: `node skills/init-backlog/unwrap.js .nightshift` (add `--write` only for an intended repair).
- Parser fixtures: `node skills/ready/ready.test.js`
- Unwrap fixtures: `node skills/init-backlog/unwrap.test.js`
- Packaging: `node --test tests/package.test.js`
- Release gate: `node tools/release-gate.js` compares `HEAD` with `origin/main` (or `--baseline <ref>`); fixtures: `node --test tests/release-gate.test.js`
- Runtime or migration changes: use `node --test` with the relevant explicit filenames from `tests/runtime*.test.js` and `tests/setup.test.js`.

[CI](.github/workflows/ci.yml) defines the full deterministic suite on Windows and Node 22. Choose checks appropriate to the change; repository prose edits do not justify replaying the native acceptance campaign. Actual model-owned behavior needs installed-host evidence when changed. Real-model campaigns require an explicit aggregate budget and reliable usage accounting; unverified or interrupted outcomes stay qualified.

## Packaging and publication

Edit this clone, never an installed plugin cache. Keep `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` versions equal. Each unpublished batch changing shipped plugin behavior needs one monotonic version increase over upstream. Behavior includes bundled non-test code and resources under `skills`, `internal` and `hooks`, plus non-version fields in either plugin manifest. Repository-only documentation, tests, CI, marketplace metadata and repository guidance do not independently require a version increase. `tools/release-gate.js` enforces these rules mechanically against the published baseline and also requires the README status line to carry the manifest version; enable it as the pre-push hook once per clone with `git config core.hooksPath .githooks`; the hook gates pushes to `main` against the remote tip and skips other refs, CI runs it against the push or pull-request baseline, and a rewritten `main` leaves that baseline unreachable so the CI step fails closed until the baseline exists again. Versions must be plain `x.y.z`; anything else is rejected.

Keep the Claude plugin description synchronized with its plugin entry in `.claude-plugin/marketplace.json`; the marketplace uses `source: "./"`. Cross-check documentation and consumers when changing public skills, runtime operations, artifact locations or packaging. Pushes remain user-directed and require current independent review coverage. Use [README.md](README.md) for installation guidance, and verify candidate installations separately from the published release.

For manual maintenance, `claude plugin update nightshift@astenlund` updates the Claude Code plugin (restart to apply); `codex plugin marketplace upgrade astenlund` refreshes the configured Codex Git marketplace snapshot. Check current CLI help for scope and confirmation options.
