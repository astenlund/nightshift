---
description: "Use when the user hands the remaining feature lifecycle to the AI, at any stage from signed-off spec to implemented-but-unshipped; detects the stage, confirms it, and drives the rest to shipped."
---

# handover

## Scope

Triggered by `/nightshift:handover`, "hand over", "handover", "take over from here", or close conversational variants. Handover is the autonomous portion of a feature's lifecycle: it detects where the feature currently stands (shift-start below), confirms the read with the user, then drives the remaining steps through to shipped. If the late-stage tail (steps 5-12) already ran in this session, handover is a no-op.

Build a single flat TaskCreate queue from the detected entry step onward before starting work; mark each step completed as its sub-skill graduates and pull through to completion. Accumulate user-decision-required items (`/nightshift:revise-spec` and `/nightshift:revise-plan` findings deferred for later, implementation-phase questions and out-of-scope findings, `/nightshift:revise-code` tech-debt findings) into a single "follow-up items" list maintained in conversation memory; the morning report (step 12) presents this list. Per-step user gates inside sub-skills (follow-up triage, brainstorming sign-off, etc.) still apply: an auto-accept or autonomous mode that suppresses routine tool-permission prompts does not bypass workflow-level confirmation steps embedded in a skill or command.

## Artifact locations and selection

Handover looks for specs and plans in the project's established locations; when a project has none, the standard fallback is `.claude/specs/` for specs and `.claude/plans/` for plans.

When multiple candidate files coexist (stale plans persist because removal is only offered, never forced), select the artifact for the feature under discussion using the same resolution order the revise skill's scope rules use: the artifact named or implied by the invocation and conversation context first, then the most recently modified candidate, with `git status` recency as tiebreaker where the candidates are tracked (untracked candidates, ignored or simply new, fall back to file modification time alone). The confirm line names the chosen file paths explicitly, so a wrong pick is visible before any work starts. Handover operates on one in-flight feature per invocation; coexisting artifacts are disambiguated here, not orchestrated in parallel.

## Backlog entries count as specs

The spec role is filled by a dedicated spec file when one exists; otherwise by the backlog entry or entries whose text carries the design (a feature entry and its breakout file especially, but bug and quick-win entries too when their text is the design record). "Spec" throughout this command means whichever artifact fills that role.

Stamp targets and completion recording follow the form. A spec file takes hardening stamps and the step-12 completion stamp as written. When the entry has a breakout file (`features/<slug>.md`, `bugs/<slug>.md`), that file is the stamp target: revise-spec hardening stamps and the step-12 completion stamp land there exactly as on a spec file, and the file's persistence after shipping makes the stamps durable. Index-only entries take no stamps: per-entry stamps inside a shared index defeat the file-scoped fingerprint and clutter the scannable backlog; their completion record is the walk-and-remove archive move (gone from the active index, present in the history archive), and their currency check is the shift-start validation below. At step 12, backlog-entry-specced work with no breakout file skips the stamp with a one-line note.

## Shift-start: stage detection

**Target scope first.** Before walking the ladder, resolve which feature and which scope this handover takes over: from the invocation, then session context, then the spec's own phasing declaration (a phased spec names its phases and the sections each covers), and, when none of those establish it, by asking the user. A spec with no phasing declaration defaults to `whole file`, so the ask is reserved for genuinely phased or ambiguous cases. "Phase" is the conversational term; durably, a phase always resolves to a stamp-comparable scope in the grammar below.

**Coverage** is containment plus currency: a stamp covers the target scope when its recorded scope contains it AND the artifact's in-scope content is unchanged since the stamp (the artifact-drift check below supplies the currency signal; drift that cannot be localized to sections counts as in-scope). Drift within the target scope defeats coverage outright, and the ladder treats the artifact as not hardened (or not completed) for that scope; this is a rung decision, not a soft flag, though the user's confirm-line answer still overrides.

**Validate before confirming.** Between resolving the artifacts and the confirm line, dispatch one fresh agent to validate the governing spec (or backlog entries) and plan against the current repo: does the described problem, design, and every file reference still hold? Stamps prove a hardening loop ran when the stamp was written; this validates content against today's tree, and for backlog-entry specs, which carry no stamps, it is the only currency check available. Fold the findings into the confirm line so the user's confirmation covers both the detected stage and the artifacts' validity before autonomous work starts.

Walk the ladder top-down and enter the procedure at the first rung whose condition holds. State the conclusion in one line, naming the chosen spec/plan paths, the target scope, and any stamp or staleness details, and ask the user to confirm before building the task queue, for example: "Spec .claude/specs/foo.md hardened for sections 3-5 (stamped 2026-07-04 09:41 at a1b2c3d), matching the target scope; no plan found; taking over from planning. Correct?" The user's answer always overrides inference.

Throughout the ladder, "same-session evidence" means the event demonstrably happened earlier in the current conversation. Where evidence is inconclusive, the rung reads as not satisfied (a failed check is not a clean check), and the confirm line states which question could not be answered, in that rung's own terms.

1. **Late-stage tail already ran this session**: no-op; say so.
2. **Spec carries a completion stamp covering the target scope** (containment plus currency, per the coverage definition above): the work already shipped; report that and stop, unless the user indicates a further scope is intended (which re-enters the ladder for it).
3. **Implementation complete**: the plan's tasks are committed. Commits are deliberately not labeled with plan-task numbers (plan hygiene forbids it), so the evidence is correspondence between plan-named files and commits since the plan's hardening stamp, or same-session evidence; inconclusive reads as not complete. A history rewrite breaks this evidence entirely (the stamp SHA is no longer an ancestor of HEAD); the confirm line must then say outright that handover cannot tell whether the implementation already landed, since the ladder would otherwise propose re-implementation at rung 4. If complete: enter at step 5 (the late-stage tail).
4. **Plan exists.** Hardened (stamp or same-session evidence): enter at step 4 (implementation). Not hardened: enter at step 3 (revise-plan).
5. **Signed-off spec exists** (see Sign-off marker below). Hardened for the target scope (coverage, per the definition above): enter at step 2 (planning). Not: enter at step 1 (the spec gate). Currency is what makes the phase rule work: a whole-file stamp from an earlier phase contains later sections by grammar, but sections added or edited after that stamp fail currency, which is exactly what mandates re-hardening for a later phase.
6. **No signed-off spec**: halt and direct the user to the brainstorming skill. Producing specs is the human's work by design. When sign-off is merely undeterminable (as opposed to determinably absent), ask the user rather than halting.

## Sign-off marker

A spec is signed off when the user has approved the design. The durable marker is a `Status: signed off <date and time>, content: <fingerprint>` line in the spec's header (fingerprint per the recipe below). Handover is the marker's only writer, and writes it lazily: at shift-start, sign-off is established by the marker, by same-session evidence of the approval, or by asking the user; whenever it is established and the line is absent, write it so future sessions have the signal. Approval itself happens in the brainstorming flow, which this plugin deliberately does not modify, so lazy first-contact writing is the normal path, not a migration special case.

## Provenance stamps

The revise loop writes a hardening stamp when a spec or plan graduates (see the post-loop steps in the revise skill's `spec.md` / `plan.md`); handover writes the completion stamp at step 12. All stamps live under a `## Hardening` section at the end of the artifact, created if absent:

```
- revise-spec graduated 2026-07-05 14:32 at a1b2c3d, scope: sections 3-5, content: 9f3a2b1c
- handover completed 2026-07-06 09:15 at e4f5a6b, scope: sections 3-5, content: 1c2d3e4f
```

- **Scope grammar**: `scope: whole file` for a whole-file pass, or `scope: sections <headings or ranges>` for a section-scoped pass. Plans are typically hardened whole-file. Rung comparisons are scope against scope, one grammar everywhere.
- **The SHA** is the repo HEAD commit at write time. The hardening edits themselves are uncommitted at stamp time, so a hardening stamp's SHA is the pre-hardening baseline; the artifact file itself is therefore always excluded from any SHA-based overlap diff (it would otherwise self-flag its own hardening edits), and edits to the artifact are instead owned by the fingerprint-based drift check below.
- **The fingerprint** is a short hash of the artifact's design content, excluding provenance lines (the `## Hardening` section and the `Status:` header). Canonical recipe, run from the repo root:

  ```bash
  awk '/^## Hardening$/{exit} !/^Status:/' <artifact-path> | sha256sum | cut -c1-8
  ```

  The fingerprint, not any timestamp, is the drift signal: it is machine-independent (clones and sync tools rewrite modification times) and inherently blind to the workflow's own stamp appends and marker writes. Timestamps in stamps serve the age check and latest-provenance ordering only.
- **Migration**: artifacts hardened before stamps existed carry none; detection treats them as not hardened and the confirm line is the correction point (self-healing: any future graduation stamps the artifact). A stamp that is present but lacks a `content:` fingerprint (hand-edited or malformed) is treated the same way for currency: not current, fail closed, surfaced in the confirm line.

## Staleness sanity check

When a detection rung rests on a stamp, sanity-check it before trusting it:

- **Age**: flag if the stamp is more than 48 hours old. Hardening normally immediately precedes planning or implementation; anything older deserves a look. The number is a deliberate default guideline, not a gate.
- **Content overlap**: list files changed since the stamp commit (`git diff --name-only <sha>..HEAD`, excluding the artifact itself) and judge whether any are in the vicinity of the artifact's subject matter. A plan names its files explicitly; for a spec, infer the affected areas from the stamped scope. Unrelated churn passes silently. There is deliberately no commit-count threshold; relatedness is the signal, not volume.
- **Artifact drift**: compare the artifact's current content fingerprint against the recorded one. For hardening or completion currency, compare against the most recent covering stamp; for sign-off currency, compare against the latest provenance event (marker or any later stamp), because edits between the marker and a later hardening were re-vetted by that loop and its user-review gate. For section-scoped targets, true drift must additionally be localized: diff the artifact's current content against its content at the commit that introduced the stamp line (the post-hardening baseline; never baseline on the recorded time, which unavoidably predates the commit that carries it), and map the changed lines to sections. Drift within the target scope defeats coverage at the rung level; drift demonstrably elsewhere is a soft flag; drift that cannot be localized (untracked artifacts, unusable history) is treated as in-scope, fail closed, and the confirm line says so. Sign-off drift needs no localization: approval covers the whole design.
- **Degraded mode**: the overlap diff is only meaningful when the stamp SHA is an ancestor of HEAD. After a rebase, squash, or on a machine that never had the commit, it is not; the overlap check is then inconclusive and reported as such, never silently treated as clean. The same ancestry break invalidates rung 3's implementation-completeness evidence; rung 3 owns how that surfaces.

The age flag, the overlap check, and out-of-scope drift are soft judgment calls, never hard gates; they surface in the confirm line together with an offer: (a) quick validity check (one fresh agent reads the artifact against the current repo state and reports whether it still holds), (b) full re-run of the scoped revise loop, (c) proceed as-is. Sign-off drift (a fingerprint mismatch against the latest provenance event) carries one extra requirement: re-confirming sign-off with the user (refreshing the marker) before proceeding, since neither a validity check nor re-hardening substitutes for approval.

## Version-control-optional artifacts

Specs, plans, and backlog files may be git-ignored by user election; the `.gitignore` is the election, checked per file (`git check-ignore`, tracked status). Never attempt to commit an ignored artifact (write the edit, skip the commit with at most a one-line note). When an ignore entry matches a still-tracked file, the ignore entry wins as the statement of intent; note once that the untracking is incomplete and suggest `git rm --cached`. Git-based recency evidence applies only to tracked artifacts; untracked ones use file modification time (selection tiebreak only; nothing load-bearing).

## Triage during revise iterations

If a finding changes the implementation scope (what we're building, not how we describe it), block and ask: that's a brainstorm gap that needs resolving before code lands. Polish-shaped findings (clarity, naming, missing context) go to the follow-up list and the loop continues.

## Procedure

1. **Spec gate.** `/nightshift:revise-spec` scoped to the target scope, run to graduation per the skill's own criteria, then the user-review gate on the hardened spec. Keeping this gate ahead of planning puts the natural context-compaction boundary here: run it at the brainstorm tail while the design context is warm, then compact, and a fresh handover session starts directly at planning with the spec already hardened. Findings flow into the follow-up items list.
2. **Write the implementation plan** via the `superpowers:writing-plans` skill.
3. `/nightshift:revise-plan`: run to graduation per the skill's own criteria.
4. **Implement the plan** using the `superpowers:subagent-driven-development` skill. One fresh subagent per plan task; dispatch in parallel where the dependency graph allows. Verify each batch's commits landed on the intended branch: a subagent that inherits a git-worktree skill may create a worktree and commit on a separate branch even when told to work on the current one, so check `git log` after each batch rather than assuming. Use subagents even when the plan contains complete verbatim code: dispatch keeps implementation churn (file contents, test output) out of the controller's context window, which is a primary benefit on its own, separate from the fresh-context review. On projects that track the plan file in git, revise-plan's uncommitted hardening stamp dirties the working tree throughout implementation: keep the plan file out of every implementation commit. When the plan is later removed (per the step-12 offer, or a plan task that prescribes its own cleanup), plain `git rm` refuses the stamp-modified file; use `git rm -f`. The committed deletion loses nothing: git history keeps the plan retrievable, and a landed plan left in the working tree reads as in-flight work to stage detection.
5. `/nightshift:revise-code`: run to graduation per the skill's own criteria. Valid-but-deferred findings flow into the follow-up items list across all iterations; do not prompt on them at end-of-loop.
6. **Verify end-to-end.** Drive the affected flow in the running app or tool and observe the behavior (the `verify` skill's discipline, if that skill is available: exercise the change, don't just trust tests or typecheck). Skip with a one-line note when the session's diff has no runtime surface to drive (docs-only or test-only changes).
7. `/nightshift:revise-docs`: update project docs to reflect what shipped.
8. **Backlog bookkeeping check.** In projects with the four-index `.claude/` layout, confirm the shipping protocol ran for everything that landed this session: history-archive entries appended (`FEATURES_HISTORY.md` / `BUGS_HISTORY.md` / `QUICK_WINS_HISTORY.md`), slice bullets struck through and the parent's top-level `**Requires:**` line advanced where a slice shipped, and the walk-and-remove sweep applied to every other `**Requires:**` line in `FEATURES.md` / `BUGS.md`. `/nightshift:revise-docs`' Completed-features guideline owns the protocol; this step exists as an explicit checkpoint because `/nightshift:ready`'s correctness depends on the sweep having run. Skip with a one-line note in projects without the layout.
9. `/nightshift:revise-lore`: review the session for CLAUDE.md / plugin updates worth persisting.
10. **Persist workflow edits.** If step 9 changed nightshift plugin files (commands, skills), apply the edits in the plugin repo clone (not the installed cache) and commit them there; leave pushing to the user unless directed. If changes touched files outside the plugin (e.g. a global CLAUDE.md), persist them via whatever mechanism backs those files locally.
11. **Full test suite.** Run the project's full test suite as defined in the project's CLAUDE.md. This phrase is the explicit ask that overrides any per-project "never run the full suite without filter" rule. If the suite is not green, halt and surface failures before triage; test failures are not follow-up items.
12. **Morning report.** Surface the accumulated follow-up items (from all prior steps) with a default route proposed for each: (a) fix now (small, scout-rule, low-risk), (b) track as `QUICK_WINS.md` entry, (c) skip. The user picks one top-level action:
    - **apply as presented**: execute the proposed routes verbatim.
    - **apply with edits**: wait for the user to name which items deviate and the replacement route, then execute the stated deviations plus the proposed defaults for everything else in one pass.
    - **defer all to a single QW**: log every item as one `QUICK_WINS.md` entry under a descriptive section header (typically the feature/area touched). Useful when the user wants to ship promptly and triage later.

    When the session ran unattended, do not present the follow-up list as one bulk-approval summary: the user saw none of the churn behind it. Present items one at a time, each with the background needed to decide in isolation (where the item came from, what changed since, the exact proposed edit), asking fix/track/skip per item.

    After triage completes, everything is verified, and the user has signed off: append the completion stamp to the spec (format and fingerprint per Provenance stamps above; write it BEFORE the next offer, so a session that dies in between leaves the plan in place and the next handover merely re-runs the tail, wasteful but safe), then offer to remove the plan file (plans are ephemeral scaffolding once work lands; the spec stays). Re-entry after any partial run re-runs the whole detected stage; sub-step resume is deliberately not tracked across sessions.
