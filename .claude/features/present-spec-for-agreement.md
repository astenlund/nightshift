# Present chosen spec for agreement before work

Feature: every governing spec is presented to the user as a decision-complete digest and explicitly approved before lifecycle work begins. Approval is evidence in the current session, never durable backlog state. This file is the authoritative design record.

## Goal and scope anchor

Prevent an agent from treating backlog readiness, work-item nomination, an old approval, or a legacy marker as authorization to begin work. Before validation, review, planning, or implementation, the user sees the current governing design and agrees to it.

This feature governs every spec that supplies the design contract, not only four-index backlog entries. A governing spec can be a dedicated spec, a feature breakout plus its index entry, a bug breakout plus its index entry, an index-only feature, bug, or quick win, a pattern used as the implementation contract, or an ordered set of artifacts that jointly governs the selected scope.

Artifact discovery, target-scope resolution, legacy-marker cleanup, and read-only digest construction are in scope before approval. Validation dispatch, task-queue creation, revise loops, planning, implementation, and other substantive lifecycle work are out of bounds until approval exists for the current design content.

## Operating context

- **Deployment environment and operational criticality**: public GitHub plugin (`github.com/astenlund/nightshift`, self-hosted marketplace with autoUpdate); the primary consumer is the author's daily Claude Code and Codex workflow. The feature changes the authorization boundary for every handover run but touches no production system or external data directly.
- **Audience**: judgment recorded as `personal use`. Public availability alone does not change the component's actual decision-maker: the engineer who owns the selected requirements and is present at the approval gate.
- **Failure consequence and data or security sensitivity**: a false positive can launch a long autonomous run against a design the user has not seen or no longer agrees with; a false negative costs one redundant digest and response. No data or security sensitivity. Fired.
- **Concurrency and compatibility risk**: the rule must survive Claude Code and Codex entry points, standalone and backlog specs, same-session compaction, and future host-neutral command-to-skill migration. Approval never crosses sessions or concurrent runs. Fired.
- **Reversibility and recovery cost**: high reversibility; git-tracked instruction prose and versioned plugin releases can be reverted or downgraded. Not fired.
- **Expected feature lifetime**: long-lived; this is a permanent human-authorization boundary. Fired.

Derivation per `skills/revise/rigor.js`: audience `personal use` gives baseline `low`; failure consequence, concurrency and compatibility, and expected lifetime fire three uplifts. The settled tier is `high`, with high effort for validation, recovery, compatibility, observability, and proof.

## Approval contract

### Governing artifact and scope resolution

Handover first resolves the governing artifact set and target scope using its existing selection order. Resolution may read repository and conversation state but may not dispatch the validation agent or build the handover task queue.

When no governing spec exists, or the available text cannot produce a decision-complete digest, handover stops and routes the work to brainstorming. When multiple artifacts jointly govern the scope, the digest and approval identity cover the ordered set rather than silently choosing one.

### Decision-complete digest

The user-facing digest contains the complete decision surface needed for agreement:

- governing artifact path or paths and selected target scope;
- requested goal or outcome;
- material exclusions and non-goals;
- material design decisions;
- upstream backlog dependencies and external prerequisites;
- unresolved questions and every provisional or deferred live claim, with an explicit `none` when no such item exists.

The digest links to the full artifact or artifacts. It does not dump a long file verbatim, but it cannot omit a decision merely to stay short. If a required field is absent or ambiguous, that is an incomplete spec, not permission to invent a digest.

Direct nomination such as "implement X" selects work but does not approve the current design. Agreement must respond to a digest presented in the current session, except when the same conversation already proves that the exact current design was presented and approved during brainstorming or an earlier gate.

### Session-local approval identity

After explicit agreement, handover creates a transient approval identity in current-run controller state. It is never written to a backlog artifact, provenance section, committed file, or cross-session cache.

The identity contains:

- the ordered governing artifact paths;
- the target scope;
- the content fingerprint for each artifact's governing content.

For a whole-file spec, governing content is the complete design content before `## Hardening`. For a section-scoped spec, it is the selected section bodies plus the spec-global goal or scope anchor, operating context, requirements and dependencies, and unresolved or live-claim passages included in the digest. For an index-only spec, it is the exact selected entry block rather than the shared index file. Content is normalized with the canonical fingerprint rules before hashing.

The identity lifecycle is complete:

- **Creation**: only after explicit agreement to the presented digest, or when same-session evidence proves that the same current content was already presented and approved.
- **Refresh**: only after another explicit agreement to a refreshed digest.
- **Invalidation**: any change to governing content, artifact set, or target scope; loss or ambiguity of controller state; handover completion or abandonment; or the end of the session.
- **Consumers**: the initial pre-work gate and every pre-implementation transition after a step that can edit the governing spec.
- **Absent or stale state**: present the current digest again and wait. Never infer approval.

The controller may retain this identity in host-provided session or task state. It must not add a repository file solely to make approval durable. If compaction or host limitations lose the identity, the safe recovery is another digest, not reconstruction from old markers or timestamps.

### Re-gating after design changes

Handover compares current governing content with the approved identity after every pre-implementation step that can edit a spec. The known consumers are:

- `revise-spec`, including controller-applied review fixes;
- live-claim probe fold-back before planning;
- revise-plan Spec Reconciliation;
- any other design correction made before implementation starts.

When content changed, handover presents a refreshed digest and waits before the next lifecycle phase. Provenance-only changes under `## Hardening` do not move the identity and do not prompt again. If the comparison cannot be completed, handover treats the identity as stale and presents the digest.

If the user requests changes, the work returns to brainstorming or localized design editing and is presented again. If the user declines, is unavailable, or provides an ambiguous response, handover stops. This approval gate is a narrow exception to the unattended rule and cannot be deferred to the morning report.

Once implementation starts under an approved current design, Nightshift's existing execution-phase decision and follow-up rules continue to apply. This feature governs authorization to enter work and reauthorization after pre-implementation design changes; it does not introduce a new mid-implementation approval loop.

## Legacy sign-off removal

Durable sign-off is rejected because it becomes stale as soon as design content changes and creates a second firmness signal beside the existing Exploring-to-graduated distinction. `## Exploring` plus `status: exploring` remains the durable marker for an unfinished draft. Graduation into a themed section with a `**Requires:**` line remains sufficient evidence that the design is firm enough to present, not evidence that a user currently approves it.

When handover selects a governing artifact, it removes each legacy line matching the old `Status: signed off ...` marker and any provenance refresh line whose reason is exactly `(sign-off marker)`. It does this before building the digest, never treats the removed text as approval, and stops with a concrete error if the cleanup cannot be written safely. The migration does not remove `status: exploring`, ordinary `revise-spec graduated` or `refreshed` stamps, handover completion stamps, or historical prose that merely discusses the rejected approach.

Runtime migration is scoped to the selected governing artifacts. Read-only surfaces such as `ready` and `exploring` never sweep or mutate a repository. The Nightshift repository's implementation removes its known legacy markers in the release change.

## Enforcement and reinforcement

### Handover enforcement

`commands/handover.md` owns the universal gate. Its order becomes:

1. resolve governing artifacts and target scope;
2. strip legacy sign-off markers from those artifacts;
3. construct and present the digest unless unchanged same-session approval already exists;
4. obtain or recover the session-local approval identity;
5. validate the spec against the repository, build the flat task queue, and enter the detected lifecycle stage;
6. re-gate before planning or implementation whenever a preceding step changed governing content.

The stage ladder distinguishes whether a spec exists and whether it is hardened, planned, implemented, or completed. It no longer contains signed-off and not-signed-off rungs. A completed scope remains a no-op, but selecting a further uncompleted scope re-enters the approval gate for that scope.

### Backlog and project guidance

The universal rule is reinforced where agents select work outside handover:

- each of the `QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, and `PATTERNS.md` template-controlled headers states that readiness or graduation is not approval and requires a decision-complete digest before work;
- the generated root `CLAUDE.md` backlog section carries the same rule;
- `commands/init-backlog.md` adds the concept to its freshness checklist so existing projects receive a targeted merge rather than a destructive rewrite;
- this repository's four indexes and `AGENTS.md` carry the corresponding current guidance.

These are reinforcement surfaces, not independent approval stores. Handover remains the enforcement owner. `/nightshift:ready` continues to report dependency readiness, and `/nightshift:exploring` continues to report draft designs; neither command changes classification or output for approval.

## Fingerprint contract

With durable sign-off removed, document design fingerprints exclude only the `## Hardening` provenance section. A `Status:` header is ordinary content and moves the fingerprint. The inline recipes in `commands/handover.md`, `skills/revise/SKILL.md`, `skills/revise/spec.md`, and `skills/revise/plan.md` drop the `!/^Status:/` filter.

The pending Content fingerprint helper design changes in the same implementation: its `partial` mode excludes only `## Hardening`, its `Status:` fixture expects both `partial` and `whole-file` fingerprints to move, and its synchronized `FEATURES.md` excerpt no longer promises a Status exclusion. Approval identity uses the same line-ending normalization and Hardening-only exclusion before its scope selection is hashed.

## Complete implementation surface

The implementation updates every current consumer of this decision:

- `commands/handover.md`: gate order, unattended-rule exception, stage ladder, legacy cleanup, re-gating, sign-off removal, and canonical fingerprint recipe;
- `commands/init-backlog.md`: four index templates, root instruction template, freshness checklist, and targeted merge behavior;
- `skills/revise/SKILL.md`, `skills/revise/spec.md`, and `skills/revise/plan.md`: fingerprint recipes;
- `.claude/QUICK_WINS.md`, `.claude/FEATURES.md`, `.claude/BUGS.md`, `.claude/PATTERNS.md`, and `AGENTS.md`: current repository guidance;
- `README.md`: workflow and human-approval terminology;
- `.claude/features/content-fingerprint-helper.md` and its `.claude/FEATURES.md` excerpt: future helper contract;
- `.claude/features/dependency-cycle-detection.md` and `.claude/features/ready-exploring-visibility.md`: known legacy-marker cleanup;
- `.claude-plugin/plugin.json`: exactly one monotonic version increase for the shipped behavior change.

The marketplace description does not change. Hardening and completion stamps remain durable. Exploring frontmatter remains durable for drafts. Ready and exploring parser code and output remain unchanged.

Design graduation already removed `.claude/features/signed-off-stamp.md` and its Exploring entry, with the rejection preserved here. They are not implementation work.

## Rejected approaches

- **Durable signed-off stamp**: rejected because it duplicates the Exploring-to-graduated firmness signal and immediately becomes stale. Timestamp and content fingerprint variants still turn approval into backlog state that later sessions can over-trust.
- **Template guidance only**: rejected because it is advisory, misses standalone specs, and can be bypassed when work enters through handover.
- **Handover only**: rejected because agents can begin directly from backlog context without invoking handover. The templates must reinforce the same contract even though handover owns enforcement.
- **Full spec dump on every gate**: rejected because long verbatim artifacts obscure the decision. A decision-complete digest plus direct artifact links preserves reviewability without hiding material content.
- **Repository-wide cleanup during read-only commands**: rejected because a readiness or exploration read must not mutate unrelated files. Cleanup stays scoped to selected governing artifacts and explicit release migration.

## Verification

Behavioral scenario tracing covers:

- prior-session specs requiring a digest before validation or queue creation;
- unchanged same-session approval avoiding a duplicate prompt;
- `revise-spec`, live-claim fold-back, and Spec Reconciliation changes forcing a refreshed digest;
- new sessions losing approval by construction;
- legacy markers being removed but never trusted;
- index-only, breakout, multi-artifact, and standalone governing specs;
- missing or incomplete specs returning to brainstorming;
- rejection, absence, ambiguity, or failed comparison halting before the next phase;
- provenance-only edits proceeding without a redundant gate.

Static consistency checks prove that active instructions no longer create, trust, refresh, or fingerprint around durable sign-off, while this file remains the sole historical rejection record. The ready parser suite verifies the graduated and removed Exploring entries still leave a structurally valid backlog. The revise round and rigor suites verify that the touched revise skill remains green. A final sibling sweep covers handover, revise profiles, init-backlog templates, live indexes, repository instructions, README, and the fingerprint-helper design.

No new ready-parser fixture is required because approval does not change backlog parsing or classification. The implementation plan must still give each prose invariant a decidable post-edit search or scenario check.

## Status

Designed and approved on 2026-08-17. Settled decisions: universal coverage for every governing spec; a decision-complete digest rather than a full-file dump; initial gating before validation or work; refreshed approval after every pre-implementation design change; approval identity limited to current-run state; immediate selected-artifact cleanup of legacy sign-off markers; handover enforcement plus backlog-template reinforcement; and retirement of durable sign-off as a rejected approach.

Not yet hardened or implemented.

## Requirements

- Handover's governing-spec and target-scope resolution, stage ladder, task queue, unattended rule, and provenance fingerprints (existing; primary change surface).
- The four-index backlog templates and generated root instruction block in `commands/init-backlog.md` (existing; reinforcement and migration surface).
- The Exploring-to-graduated feature convention (existing; retained as the only durable firmness distinction).
- The canonical fingerprint recipes in handover and revise (existing; Status exclusion removed).

**Requires:** none.

## Hardening

- (None yet; this file has not been through a revise-spec run.)
