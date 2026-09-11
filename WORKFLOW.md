# Nightshift workflow design

Working draft, updated 2026-09-07, developing [the vision](VISION.md). The workflow and dimension brief below record the agreed walkthrough and review coverage. This document guides later transformation; it does not change the current plugin or authorize implementation of the redesign.

## Governing priorities

The [vision's invariant priorities](VISION.md#invariant-priorities) govern every workflow decision: autonomy first, quality second, speed, efficiency, and economy third. Handover should support the user going to bed without routine stalls, and independent review and verification must carry quality without depending on the user auditing the code. Efficiency improvements remain valuable when they preserve those higher priorities and respect explicit limits.

## Project files

Use `.nightshift` at the project root for Nightshift-owned backlog, feature and spec documents, and durable run records on both hosts. Fresh setup uses that home. The MVP migrates existing Nightshift-owned files from `.claude`, preserving content, links, tracking choices, and recoverable work while keeping the backlog format. Preserve host-owned configuration in its required location.

## User-facing review requests

For standalone review requests, Nightshift's review skills activate only for explicit `revise` intent. Plain `review` and `review-loop` requests use the user's global direct-agent routines and do not activate the plugin. Reviews required within an authorized Nightshift lifecycle still use the shared machinery described below. The detailed global routines belong in the user's canonical global instructions, outside the plugin skills.

## Start with a shared understanding

For a small fix, the controller investigates enough to understand the behavior and gives a brief readback before implementation. For example: "Refresh should reload the list while preserving the selected status filter. Did I understand that correctly?" It waits for confirmation before changing code. The exchange supplies the agreed outcome without a separate spec, formal digest, or implementation plan. An already-confirmed scope does not need another routine confirmation at each later stage.

For a substantial feature, the controller explores the project and resolves consequential product decisions with the user, then writes a concise spec. It launches independent spec review immediately before presenting that same draft to the user. The human and AI reviews proceed concurrently against a stable version. User feedback and skeptic-validated review findings inform the next draft; a revised spec returns to the reviewer as a whole.

For the substantial-feature path, implementation starts only when the user has confirmed the commitments and independent spec review is resolved. Earlier user confirmation remains valid through compatible corrections. A material change to the commitments requires confirmation of the changed decisions, without repeating the entire agreement exchange. If the user is unavailable, preserve the unanswered decision and pause dependent work while continuing independent authorized work.

Before handing work over for unattended execution, ensure every queued item has the required user agreement through the small-change or substantial-feature path and resolve known blocking user decisions. One agreement or shared spec may cover multiple items; independent review and engineering can continue unattended. Check essential execution and review capabilities within the agreed scope and limits. During the run, the controller handles routine decisions and recoverable failures autonomously, using allowed fallbacks and sound continuation. A newly discovered material decision requiring the user pauses dependent work while independent items continue. Ordinary follow-up questions wait for the closing triage; a genuine authority or capability blocker remains explicit and does not count as completed work.

## Implement directly

A capable model implements from the agreed request or spec, using the repository and real execution feedback to choose and refine its approach. Fable and Astra are interchangeable; a run need not use both. Subagents get bounded assignments where they offer a clear benefit, and one owner remains responsible for the complete result. A written implementation plan is exceptional guidance for a deliberately chosen weaker or cheaper implementer that needs it.

The controller chooses assignments using task fit, observed model strengths, availability, context, and cost within the invariant priorities. The user's reported tendencies inform that judgment without prescribing a fixed team or a fixed model for each stage; structured model teams are deferred beyond the MVP. Respect explicit model choices and preserve control of an existing run. Investigation establishes the problem before editing regardless of the implementer.

When coordination load warrants it, the controller may use a lower-tier shift supervisor for assignments, progress, result collection, and routine recovery. The controller retains consequential engineering decisions, scope and authority judgments, finding dispositions, and final acceptance. Direct coordination remains available, with ownership and activity reconciled before a handoff. The optional layer is justified by autonomy and quality before cost savings.

Tests, builds, and live verification establish the agreed behavior and meaningful failure handling throughout implementation. A repair includes investigating the shared cause and relevant sibling occurrences. Additional checks need a reason tied to the change or unresolved evidence.

## Maintain continuity throughout the run

Preserve accepted commitments, current work, unresolved findings, dispositions, and evidence through growing context and compaction. Supply focused current obligations and applicable rules at consequential decision boundaries. Reliable workflow operations check transition prerequisites so omitted review work, stale evidence, or failed bookkeeping cannot become successful completion. Models retain engineering judgment.

After compaction or takeover, reconcile the record with the actual project and in-flight work before dependent actions. Resolve recoverable gaps autonomously; a genuine blocker leaves dependent work incomplete while independent authorized work continues. MVP acceptance must exercise long runs and deliberate compaction during implementation and review, including findings still awaiting resolution and repairs awaiting cumulative re-review.

## Independent review owns coverage and staffing

Include cross-host lead-reviewer dispatch in both directions in the MVP. Prefer the other host when a permitted, equally qualified reviewer is available, while leaving placement to the controller's judgment about task fit, independence from the reasoning that shaped the artifact, availability, and run constraints. A fresh same-host reviewer of the required strength is valid when the counterpart is unavailable or the controller judges that placement more suitable. Explicit model requirements, the strong review gate, and peer-cloning rules remain binding. Fable/Astra and Opus/Sol are corresponding-tier examples, not permission to lower required review strength. Cross-host placement does not guarantee independent errors. Verify the dispatch capability, review context, model and result attribution, and unavailable-counterpart fallback on both hosts.

One fresh strong reviewer starts with the complete dimension brief, the agreed outcome, full cumulative change, applicable constraints, and access to surrounding code. The author supplies factual context rather than excluding dimensions or predeclaring them irrelevant. The reviewer assesses every lens and can briefly explain an inapplicable one without producing an elaborate report for it.

A small change normally needs that one reviewer. For substantial work, the independent reviewer decides whether to recruit additional reviewers after examining the complete change. Helpers use the lead reviewer's model and effort in fresh contexts and receive the full dimension brief for their assigned area and the shared requirements and constraints. The original reviewer retains the integrated assessment, including interactions across areas, and can challenge the initial size or risk classification.

The controller may advance past the review gate only on a completed assessment by a strong independent reviewer with credible broad coverage of the complete artifact or cumulative change across all dimensions, and with required work resolved. Judge coverage from the actual scope examined, supporting evidence, and review behavior; neither a model label nor literal LGTM establishes it alone. A returned assessment from only weaker reviewers, or one whose coverage is incomplete or narrowly focused, requires a fresh strong integrated assessment even when no edit occurred. If that assessment cannot run, preserve progress, do not advance past that gate, and continue independent authorized work.

## Validate findings and decide their value

Every finding receives skeptic validation and its own evidence and verdict. One fresh skeptic can validate the initial findings from a small review together; no findings means no skeptic is needed. How to allocate skepticism across larger reviews remains a design choice, while individual validation is mandatory.

Factual validity, authority, and practical value are separate decisions. Straightforward findings can be disposed of from the reviewer and skeptic's existing evidence. Where consequences, value, or repair quality remain unclear or disputed, those agents continue the adversarial dialogue. The controller decides whether to implement, defer with a concrete reason and durable route, or skip with an accepted tradeoff. Missing evidence is unresolved; a required commitment cannot be waived because repairing it is expensive.

The controller or assigned implementer applies accepted repairs and runs the relevant checks. After every repair batch, the independent reviewer re-examines the complete cumulative change across all dimensions. It checks affected surrounding code, sibling paths, earlier fixes, and continued fulfillment of the agreed outcome. The latest patch explains what changed but does not limit the review. A revised spec likewise receives another whole-spec review. Small repairs receive no exemption from this coverage.

New findings receive skeptic validation. When the reviewed artifact is unchanged and the required strong, broad independent assessment is already complete, resolved skips, verified deferrals, and refutations do not require another pass solely to obtain literal LGTM. Resolved findings cannot substitute for that coverage, and every repair batch still receives full cumulative review. New evidence can invalidate earlier dispositions. The existing qualified reviewer can provide the final integrated assessment; a separate holistic reviewer is not mandatory merely because the work reached its end.

## Recognize repeated failure to make progress

Use three successive review passes raising related findings in something already subject to attempted repairs as an initial investigation signal. Count recurrence across repair attempts, not several findings reported together. Same area alone is weak evidence; missed sibling paths, the same violated invariant, or fixes undoing earlier fixes are stronger signals.

The controller pauses routine patching to determine whether separate defects are being closed or the repair approach is missing a shared cause. It may reconsider the implementation or seek a fresh specialist assessment, explaining the conclusion briefly. The signal does not automatically fail the run, launch a swarm, or require user approval. Act earlier when the evidence warrants it; a clean round with no edits is progress. Tune the heuristic from actual runs.

## Close with evidence and the existing follow-up triage

The controller reports what was delivered, how it meets the agreed outcome, what verification established, meaningful limitations, deferred work, and incomplete work or decisions. It updates relevant documentation and backlog records for completed work. Already-resolved findings remain available as evidence; only consequential accepted tradeoffs need attention in the summary.

After documentation and backlog updates, perform the session retrospective, retaining revise-lore's purpose before follow-up triage. Examine how the run went, identify useful lessons and workflow problems, and prepare worthwhile proposed improvements for user decision. Proposed instruction changes receive the agreed independent review and approval. If reflection yields no worthwhile proposal, complete the retrospective without creating one.

Keep the existing follow-up triage. Present decision-requiring items one at a time, with the context and concrete content needed to decide, a recommended route, and the consequences of the options. Use fix now, track, or skip where applicable. Deferred approval questions retain their own approve, adjust, or revert terms. Wait for the user's decision before presenting the next item, and place tracked work in its appropriate project or workflow home.

No follow-ups means no empty triage ceremony. If the user is unavailable, preserve the items and distinguish completed engineering work from outstanding decisions. Do not imply that a pending answer has been given. Publication remains subject to explicit authorization. Proposed changes to workflow instructions are follow-ups for user decision, not automatic additions to the rules.

## Review dimensions

These are the agreed coverage lenses for the reviewer, independent of the number of agents. They consolidate overlapping criteria and make requirements and verification explicit. The current engine still uses its earlier profiles; these lenses guide their later replacement.

### Spec review

| Lens | Main question |
|---|---|
| Intent, scope, and acceptance | Does the spec express the desired outcome, consequential behavior, boundaries, and evidence of success? |
| Soundness and integration | Can the proposed approach satisfy those commitments in the actual project and operating environment, with its real dependencies and assumptions? |
| Failure, safety, and recovery | Are consequential failure outcomes, trust and data boundaries, concurrency, and recovery expectations understood where the behavior requires them? |
| Clarity, consistency, and proportionality | Can the user and implementer understand the commitments and their important reasoning without contradictions, missing decisions, or unnecessary prescription? |

Spec review checks the mechanisms the design actually commits to. It does not invent an implementation and then report gaps in that invention. Field grammars, concrete values, and exact technical shapes belong in the spec when they define a meaningful contract. Important tradeoffs need reasons; every imaginable alternative does not need a rejection paragraph. Future work constrains the design through real commitments and credible consequences, rather than the mere existence of a backlog entry.

### Code review

| Lens | Main question |
|---|---|
| Requirements and user experience | Does the implemented flow fulfill the agreed behavior and constraints, and can its intended users use and understand it, including relevant accessibility needs? |
| Correctness and integration | Does it work across normal, boundary, concurrent, and failure conditions, including callers, consumers, state transitions, wiring, and affected sibling paths? |
| Security and data safety | Are trust boundaries, permissions, confidentiality, data integrity, and consequential preservation and recovery obligations respected? |
| Design and maintainability | Is the local code and overall system decomposition understandable and proportionate, with suitable reuse, ownership, abstraction boundaries, and coupling? |
| Performance and resources | Does it avoid consequential latency, throughput, resource, or operating-cost problems under realistic conditions? |
| Tests and evidence | Do meaningful assertions, realistic execution, integration checks, and regression protection establish the required behavior and expose remaining uncertainty? |

Design and maintainability explicitly covers two scales:

- **Local structure:** clarity, state ownership, reuse, duplication, responsibilities, and abstraction boundaries.
- **System structure:** module boundaries, dependency direction, service decomposition, shared contracts, and coupling across components.

Tests and evidence examine assurance across the other lenses, without automatically creating another verifier role or repeating every test. Similar code, a long method, or an opportunity to introduce concurrency is a reason to investigate, not sufficient evidence that a change is beneficial.

### Shared review discipline

Reviewers and skeptics on either host must not change reviewed project inputs. Checks that would mutate those inputs run in isolated fixtures or copies; ordinary verification may run against the project when it leaves reviewed inputs unchanged. Repairs belong to the controller or assigned implementer. Acceptance verifies reviewer and skeptic write isolation on both hosts.

Findings identify a concrete consequence and its supporting evidence. Verify claims about existing code and external behavior against the actual relevant source or execution; state uncertainty where that evidence is unavailable. Examine related pre-existing code and structural problems, but finding one does not automatically authorize a repair or backlog entry. Applicable project conventions remain in view.

Report one underlying problem once, even when several lenses expose it. Retain sibling sweeps, cumulative review, and the agreed finding-disposition process as common instructions rather than duplicating them in each lens. Looking through every lens does not require equal depth, a finding quota, or a separate narrative per lens.
