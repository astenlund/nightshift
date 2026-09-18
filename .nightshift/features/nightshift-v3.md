---
name: nightshift-v3
description: Deliver an unattended workflow for strong models with independent assurance and a host-neutral project directory
metadata:
  type: feature
---

# Nightshift v3

Implementation was authorized on 2026-09-07. Version 3.0.0 was published to `main` on 2026-09-10, with implementation and required Windows acceptance complete. The [acceptance report](../reports/v3-acceptance-272m-20260910.md) records the evidence and its qualifications. This feature consolidates the agreed [vision](../../VISION.md), [workflow](../../WORKFLOW.md), and [migration assessment](../../V3-MIGRATION.md) for the first v3 release.

## Outcome and priorities

Hand over an agreed task or finite queue, go to bed, and return to useful work supported by independent review and execution evidence. The fixed priority order is autonomy, quality, then speed, efficiency, and economy, within explicit user authority and limits. Routine decisions and recoverable failures must not require the user's return. The user must not need to audit the code personally. Genuine blockers remain explicit, and incomplete obligations cannot be declared complete.

The MVP supports the complete lifecycle independently in Claude Code and Codex on Windows. Fable 5.1 and GPT-6 Astra are interchangeable reference models for strong roles; either alone must support the workflow through independent contexts. Cross-model collaboration is optional.

The controller chooses model assignments using task fit, observed strengths, availability, context, and cost within the invariant priorities. The user's reported model strengths inform that judgment without prescribing a fixed team or a fixed model for each stage. Structured model teams are deferred. Model selection does not automatically transfer control of an existing run. Establish the problem before editing regardless of the implementer.

Explicit model requirements are binding. Preferences guide selection; if a preferred model is unavailable, another permitted, adequately capable model may be used, with the substitution and reason reported. If no suitable permitted model is available, pause affected work and continue independent authorized work. Substitutions must satisfy the strong-review requirements and supported host capabilities. Honor effort preferences and enforceable resource limits, checking essential execution, review, and any authorized publication capabilities before handover.

## Agree on the work and implement directly

Direct requests need no mandatory backlog entry. Small work gets an investigated understanding readback and confirmation. Substantial work gets a concise spec of consequential behavior, constraints, tradeoffs, and acceptance evidence. Launch independent spec review immediately before presenting the same stable draft to the user. Implementation requires both agreed commitments and resolved spec review. Compatible corrections preserve agreement; material commitment changes require the user's decision.

Retain the four-index backlog format, dependency handling, Exploring drafts, and the `ready` and `exploring` selection tools. Before handover, ensure every queued item has the required user agreement through the appropriate entry path, with known user-owned decisions settled. One agreement or shared spec may cover multiple items. Independent review and engineering can continue unattended; newly discovered material decisions requiring the user pause dependent work while independent items continue. Queue ordering respects dependencies and the authorized work set. Handover can enter work already underway after establishing its requirements, authority, actual state, and valid evidence. Backlog presence, a controller-edited spec, or a saved stage label cannot establish authority or completion.

A strong controller implements directly and owns consequential decisions, finding dispositions, and final acceptance. Bounded helpers receive clear assignments and write ownership. The controller may use a lower-tier supervisor for assignments, progress collection, and routine recovery when coordination consumes too much attention. Direct management remains available, including when a suitable supervisor is unavailable, provided it reliably handles the workload. Delegation preserves access to underlying evidence and the controller's meaningful oversight.

Sequential dispatch is an acceptable baseline when it reliably handles the authorized workload within its constraints. It preserves independent review contexts, complete coverage, and all completion obligations. Use parallel dispatch where available and useful; missing parallelism cannot justify weaker assurance, omitted work, or avoidable stalls.

Written implementation plans are exceptional guidance for deliberately selected weaker or cheaper implementers who need them. Such guidance can receive appropriate review. Routine plans, the dedicated routine plan-review entry point, and the Superpowers dependency are retired.

## Independent assurance

Cross-host lead-reviewer dispatch is an MVP capability in both directions. Prefer the other host when a permitted, equally qualified reviewer is available, while letting the controller choose placement using task fit, independence from the reasoning that shaped the artifact, availability, and the run's constraints. A fresh same-host reviewer of the required strength is valid when the counterpart is unavailable or the controller judges that placement more suitable. Explicit model requirements still bind. Corresponding-tier examples such as Fable/Astra and Opus/Sol do not lower the strong review required by MVP gates or change peer-cloning rules. Cross-host placement does not guarantee independent errors.

One fresh strong reviewer starts with the requirements, complete artifact or cumulative change, surrounding project context, and the complete [dimension brief](../../WORKFLOW.md#review-dimensions). The author does not filter dimensions or supply its argument for correctness. The reviewer may recruit peers of the same model and effort in fresh contexts while retaining the integrated assessment.

Reviewers and skeptics on either host must not change reviewed project inputs. Checks that would mutate those inputs run in isolated fixtures or copies. Ordinary verification can run against the project when it leaves reviewed inputs unchanged. Repairs belong to the controller or assigned implementer.

Every finding receives fresh skeptic validation against evidence; one skeptic may handle a small batch, and no findings means no skeptic. Separate factual validity, authority, and practical value. The controller chooses implement, defer with a reason and durable route, or skip with an accepted tradeoff. Refuted claims are recorded as such; missing evidence remains unresolved. Extended dialogue addresses uncertainty or disagreement. Deferral or cost cannot waive an agreed obligation.

Every repair batch, including tiny fixes, receives relevant verification and full cumulative re-review across all dimensions, including affected siblings and earlier fixes. Revised specs receive whole-spec review. Three successive passes with related findings after attempted repairs prompt investigation of the repair approach; the signal is not an automatic failure or user interruption.

Only a completed strong independent assessment with credible broad coverage and resolved required work can pass the review gate. Weak, narrow, failed, or partial assessments cannot substitute. No-edit resolutions may avoid an extra LGTM-only pass when that coverage is already complete. A separate final holistic reviewer is not mandatory. New evidence can reopen an earlier disposition.

Standalone spec and code revision use explicit `revise` intent. Plain `review` and `review-loop` requests use the user's global direct-agent routines and must not activate Nightshift skills. An authorized Nightshift lifecycle still invokes its required internal review machinery.

## Dependable continuation

Preserve accepted commitments, current work, ownership, findings, dispositions, evidence, and pending decisions through growing context and compaction. Supply focused current obligations and applicable rules at consequential boundaries. Reliable operations check prerequisites, result attribution, evidence freshness, and required state changes. Failed bookkeeping or missing review work cannot become successful completion.

The running host must recover from recoverable failures, including failed tools or workers, interrupted reviews, transient provider failures, and premature controller yields. Evaluate persistent goals first as the continuation mechanism, based on the user's prior successful experience, and verify the chosen mechanism on each host. If persistent goals do not provide reliable continuation, establish another verified mechanism; until then, the affected host's unattended path remains unavailable. Both Windows hosts are required for MVP acceptance, so shipping with only one supported host requires an explicit scope change. Continue while actionable authorized work remains; stop at verified completion, an explicit stop or resource limit, or when all remaining work is blocked with no authorized recovery available. Goal status alone does not establish completion.

After compaction or reopening a host, reconcile durable context with actual files and surviving activity before dependent actions. Preserve another writer's work and reject stale results. Repeated failed attempts require reconsideration of the approach. A reopened host can resume safely, but automatic relaunch after host exit or Windows restart is outside the MVP. Such an exit can end the night's execution until the user restarts it, with unfinished work preserved.

## Project files and setup

Use root `.nightshift` for project-owned Nightshift files, including the backlog, feature and spec documents, and durable run records. Include migration of those files from `.claude`, preserving content, links, tracking and ignore choices, and recoverable work. Retain one authoritative home. Update active consumers and navigable references to relocated Nightshift files, including references in files that remain in place. Preserve host-owned paths and deliberate legacy test inputs according to their purpose. Verify that links resolve and consumers use the correct locations. Host-owned configuration and plugin packaging stay in their required locations.

The current backlog set to migrate, when present, is `FEATURES.md`, `BUGS.md`, `QUICK_WINS.md`, `PATTERNS.md`, `FEATURES_HISTORY.md`, `BUGS_HISTORY.md`, and `QUICK_WINS_HISTORY.md`, with the `features/`, `bugs/`, and `patterns/` breakout directories and `inbox/`. Include existing Nightshift-owned plans and any other Nightshift-owned spec or run files. Preserve existing plans and their tracking policy; retiring routine plan generation neither deletes them nor requires an empty plans directory.

Reduced `init-backlog` supports fresh, existing, and partially initialized projects and safe reruns after interrupted setup or migration. Reconcile existing destination content and uncertain ownership before moving files; preserve unrelated content. Make any required transition of active runs explicit. Validate the resulting backlog with the real parser. Instruction changes retain user approval. Broader incompatible structures are diagnosed before handover and handled as scoped repairs.

Keep visible progress and inspectable run history. The ignored `.nightshift/inbox` is a maintainer-only drop box in the Nightshift repository for reports about Nightshift itself; setup migrates an existing inbox but does not create one in other projects, and the maintainer triages it on request without disrupting authorized work. New execution records are ignored by default, while explicit existing tracking choices are preserved. Lasting conclusions can enter documentation or the backlog through retrospective and triage. Exact storage and transport mechanics are implementation choices subject to these preservation and continuity obligations.

## Finish and report

Update relevant documentation and backlog records, perform the session retrospective, then use the existing follow-up triage. After an explicit handover, a recorded morning report sits between the retrospective and triage, its delivery is recorded from the user's reply, and an existing run is handed over in place; [the governing spec](../specs/handover-transition-and-morning-report.md) holds the commitments. Documentation and retrospective operations also remain independently callable. Present decision-requiring follow-ups one at a time with concrete context and a recommended route; preserve unanswered items when the user is unavailable. No useful retrospective proposal or follow-up means no manufactured ceremony. Proposed instruction changes retain independent review and user approval.

Local commits follow project policy, required hooks, and preservation of unrelated work. Carry authorized publication through after review and verification without repeating an already-settled approval. Otherwise finish locally and report the unpublished state. Use dependable Git operations and existing release tooling; no dedicated fixup transaction engine or routine checkpoint autosquash is required. Applicable fixup and pre-push autosquash policies remain binding.

Report delivered work, verification and its limits, accepted tradeoffs, deferred work, and incomplete obligations or decisions. Uncertain publication and exhausted budgets cannot become success claims.

## Deliberately deferred

- Verified macOS and Linux support.
- Streaming findings before review completion.
- Interactive terminal pairing, pane launch, and pane reuse.
- [Structured model teams](structured-model-teams.md), including prescribed controller/implementer combinations and fixed model assignments for each stage.
- Automatic transfer of an active run between hosts.
- Multiple independent Nightshift runs sharing one checkout.
- Automatic relaunch after host exit or Windows restart.
- Bulk conversion of legacy guidance and general-purpose structural repair.

One coordinated run still supports bounded helpers, reviewer peers, and optional supervision. Deferred capabilities must not be prerequisites for the supported path. Retiring the old review cells, waves, and mandatory verifier stage preserves their surviving assurance and operational-integrity requirements through the new workflow.

## Acceptance evidence and test budget

Automated integration tests carry most acceptance. Frequent model-free integration checks cover deterministic behavior such as migration, persistence, partial writes, ownership, result validation, and completion prerequisites. Budgeted real-host integration tests use the actual installed plugin and real agents in controlled projects to establish model-owned behavior. Equivalent automated evidence replaces manual live repetition.

Acceptance covers both Windows hosts:

- Installation and upgrade, fresh setup, migration, and interrupted reruns preserve required content, links, tracking choices, and host configuration. Include migration with an unfinished run, preserving accepted commitments, outstanding findings, ownership, and evidence. Cover a supported safe transition and refusal of an unsafe move while conflicting writers remain active.
- A small change, substantial feature, and finite queue exercise delivery through verification, documentation, retrospective, and follow-up triage, including entry into existing work. Exercise standalone documentation and retrospective operations on both hosts, preserving their approval and follow-up boundaries.
- Strong broad review, skeptic validation, finding disposition, and cumulative re-review hold through repairs. Missing, stale, partial, or failed evidence cannot pass a gate.
- Cross-host reviewer dispatch works in both directions with the complete review context, verified model and result attribution, and same-host fallback when the counterpart is unavailable. Verify reviewer and skeptic write isolation on both hosts. Placement remains a controller judgment within the agreed preference and strength requirements.
- Long runs exercise context pressure, premature yields, worker recovery, and safe resumption. Reserve budget for a genuine host compaction on each host with unfinished work, including an outstanding finding or repair awaiting cumulative re-review. Verify that accepted decisions, ownership, obligations, and evidence survive and that actionable work continues afterward.
- Scope, delegation, resource limits, explicit stops, publication authority, and standalone review-trigger boundaries hold. Permitted model substitutions and their reasons are reported, and explicit model requirements are honored. Helpers and supervision preserve meaningful controller oversight; unsupported overlapping runs cannot adopt or overwrite existing work.

Tests use observable outcomes and failure detection, not the tested model's completion claim. Record coverage and limitations per host. Simulated state transitions complement the genuine compaction case without replacing it.

Start the compaction cases with a per-test automatic-compaction threshold around 250,000 tokens. Apply overrides to the test sessions and verify the effective setting and actual native compaction event. A higher threshold may be used when more history is needed for a meaningful scenario. If the reduced threshold cannot be verified, investigate the configuration or try another supported control; testing at the verified native threshold is permitted only within the agreed remaining budget. Otherwise, record compaction acceptance as unverified and explain the blocker, leaving MVP acceptance incomplete. This establishes compaction and continuation at the observed history size; qualify claims about attention near the model's full context window separately. Measure total usage, since more frequent compaction can offset some savings.

The approved budget for the initial v3 MVP test run was 2,000,000 tokens total across both hosts and every participating test agent, including compaction testing. The user subsequently raised the total campaign allowance in stages to 4,000,000, 8,000,000, 16,000,000, 32,000,000, 64,000,000, 128,000,000 and 256,000,000 tokens, retaining all earlier usage and uncertainty reservations. The user then designated 256M as a planning target, authorized delayed-reporting overruns, and subsequently raised the target to 272M, 280M and 296M. Plan new spending against that remaining target, preserving every actual charge and uncertainty hold; it is a run-specific allowance, not a permanent product default. Favor Claude/Fable for execution and independent reviews, with Codex audit and preparation authorized during Claude unavailability and either host available for its required evidence. Bound Fable acceptance cases still require Fable. Start with a small probe on each host, run comprehensive acceptance once the candidate is coherent, then rerun affected cases for failures or relevant changes. Another comprehensive run needs a concrete reason and must fit the remaining planned allowance. Editorial documentation changes alone do not trigger expensive repetition; changes to active skill instructions or prompts are behavior changes and require appropriate revalidation. An exhausted planning allowance leaves failed or unverified requirements incomplete; planning additional work beyond the target requires the user's direction.

## Backlog transformation

Use [V3-MIGRATION.md](../../V3-MIGRATION.md) to reconcile Nightshift's own backlog as the implementation changes, preserving surviving requirements, source references, and reasons for retirement. Old proposals are not automatic prerequisites for the rewrite. Retired proposals must not be recorded as shipped features or fixed bugs. Project backlogs being relocated retain their own work and decisions.

Delivery is recorded in [FEATURES_HISTORY.md](../FEATURES_HISTORY.md); this file remains the governing scope and historical design record. The .nightshift relocation has been applied; [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) preserves the source-backlog dispositions separately from delivery.

The [local acceptance report](../reports/v3-acceptance-272m-20260910.md) reconciles the completed continuations and remaining host observations. It includes the accepted Claude explicit-stop boundary and preserves reduced-window and native-goal qualifications, parent-assisted fixture delivery, interrupted accounting, observed convention slips and the private presentation harness limitation. Historical failed outcomes remain intact beside independent adjudications; no incomplete fixture lifecycle is relabeled complete.
