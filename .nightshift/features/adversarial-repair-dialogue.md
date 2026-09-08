> V2 design/diagnostic archive. The agreed disposition and surviving needs are recorded in [MIGRATION_STATUS.md](../MIGRATION_STATUS.md). Current implementation is governed by [the v3 MVP](../features/nightshift-v3.md); this historical design is not a separate active work item.

# Adversarial repair dialogue

Feature: evaluate verified findings through an adversarial skeptic-reviewer dialogue, decide whether each warrants implementation, deferral, or acceptance without change, and develop repairs only where worthwhile. This file is the authoritative design record.

## What it does

Every reported finding receives skeptic validation against concrete evidence before disposition. Factual validity, authority to change the artifact, and the value of making that change are separate judgments. A confirmed finding does not by itself justify implementation. A skeptic-identified judgment call retains that verdict and can enter value assessment after its factual premises are checked; missing factual evidence is not a matter of taste.

After factual verification and controller admission against the frozen contract, resume the skeptic and originating reviewer to assess the finding's consequence and the available responses. Admission permits this assessment; it does not preselect repair. Refuted findings receive reasoned acknowledgements. True out-of-contract findings retain the admission feature's acknowledgement-only route, without unauthorized edits or automatic backlog entries. Missing verification or unresolved authority returns to the existing verification or agreement boundary and cannot be treated as a skip.

The relationship remains adversarial throughout:

- the reviewer explains the consequence of leaving the finding unresolved, and the skeptic challenges its evidence, likelihood, and significance;
- either agent may recommend implementation, deferral, or skipping, and the other challenges that recommendation;
- when implementation is warranted, the skeptic proposes and revises a repair while the reviewer checks closure, regressions, ambiguity, and adjacent invariants;
- neither agent edits the artifact during the dialogue.

## Value and disposition

Assess the consequence and likelihood of the problem against the benefit, implementation and validation effort, regression risk, added complexity, and ongoing maintenance of the proposed response. Relate that assessment to the accepted outcome and operating context. Greater completeness or a defensible best-practice argument alone does not establish value. Prefer the smallest response that meets the obligation, including removing unnecessary machinery or leaving implementation choices out of a spec when its behavioral commitments are already complete.

- **Implement now:** the response is necessary to meet an agreed requirement or its practical benefit warrants the cost. Develop a concrete repair and the evidence that will validate it.
- **Defer:** the improvement merits future work, but there is a concrete reason to do it later. State the reason, the condition or timing for reconsideration, and the durable follow-up route. Show why the current result still meets its commitments, citing an enforcing guard or test when the deferral depends on one.
- **Skip:** accept the current behavior or tradeoff because changing it is insufficiently valuable or the remedy would be worse. Record the consequence being accepted and the rationale. A skip creates no automatic backlog debt.

A missed agreed requirement or applicable correctness obligation cannot be waived merely because repair is expensive. It must be repaired or the user must explicitly change the agreement. Where a safe deferral depends on a narrower boundary, prove that boundary; without it, the obligation remains unresolved. When the user is unavailable to resolve a required agreement change, stop that work without claiming completion.

## Termination and disagreement

Allow several exchanges while they add evidence or improve the proposed disposition or repair. Retain the same participants through revisions. Terminate when they have no remaining objection, reach a narrow unresolved disagreement, or exhaust the dialogue safety allowance. Repetition, agreement between agents, and a limit exit are not evidence that a finding is resolved. The controller decides from the returned evidence; when that evidence is insufficient, the finding remains pending. Keep productive dialogue separate from execution-repair budgets for malformed or missing output.

## Resolution package

Return a compact resolution package to the controller containing:

- the factual verdict and supporting evidence, with the controller's admission basis;
- the practical consequence, likelihood, and benefit-versus-cost assessment;
- the recommended disposition and each agent's acceptance or remaining objection;
- for implementation, the exact proposed change, closure reasoning, adjacent invariants checked, and required validation;
- for deferral, the reason, reconsideration condition, durable route, and evidence that current commitments still hold; for skipping, the accepted consequence and rationale;
- any independently discovered findings, each sent through normal intake and fresh-skeptic verification.

## Controller's role

The controller makes the final disposition, enforces scope, assigns accepted repairs to fixers, and runs validation. It may accept an evidenced recommendation without reconstructing the whole argument, but must resolve material objections before acting. Dialogue output is a report; certification, routing, fingerprint advancement, and convergence remain controller acts.

Use the existing review checkpoint and follow-up handoff machinery to retain each finding's evidence, disposition, rationale, and reviewed artifact and contract identities. Persist the decision before applying a repair or marking the finding resolved. A deferral resolves only after its durable follow-up or handover transfer is verified: after interruption, recover a recorded decision before repeating its effect, reuse an existing matching follow-up, or complete the missing handoff. Missing or malformed evidence stays pending. Reconsider a disposition when later edits, new evidence, or changed requirements invalidate its basis; unrelated changes do not by themselves reopen the same accepted tradeoff. Retain the decision through the run and its closing report, then use normal review-state cleanup rather than introducing a separate decision ledger.

## Concurrent repair pipelines

Accepted repair packages may execute concurrently when the controller can issue disjoint file leases. Each lease names the complete owned file set and records every file's execution-start working-tree EOL form. The controller owns a deterministic acquisition order, rejects overlapping leases, and requires a fixer that discovers a cross-file dependency to request scope expansion before touching the additional file. A conflicting expansion waits or returns for controller disposition; it never edits outside the lease.

Lease state defines acquisition, stale-owner recovery, the atomic commit boundary, release, and a protected-worktree verification after every lease drains. Repair pipelines may advance independently while their leases are disjoint, but asynchronous landing does not create per-pipeline certification. The controller recomputes the shared fingerprint after accepted fixes land, waits for all applicable cells to become inactive before the staleness sweep, and applies certification and latest-fingerprint convergence barriers across the whole run.

## Session continuity

Resume the same skeptic and reviewer sessions when available: their retained, role-specific understanding supports both value assessment and repair quality, while prompt caching reduces cost. The same skeptic continues through rejected proposals and, when selected as the fixer, through execution of an accepted repair. Discard dialogue sessions at every reactivation-wave boundary; reviewers for the resulting artifact remain fresh. If either session is unavailable, use a fresh replacement with the persisted finding, evidence, and dialogue state, recording the loss of continuity. Never infer an unrecorded disposition from a lost session.

## Resolution and convergence

Reviewer acceptance validates a recommendation, not the implemented artifact. An applied repair still requires validation and fresh review of the resulting artifact under the existing fingerprint and convergence rules.

A controller-accepted skip, a verified durable deferral, or a skeptic refutation resolves that finding without requiring another round solely to obtain literal reviewer LGTM. A cell whose current review is complete and whose findings are all resolved without an artifact edit may finish on that recorded basis. With no findings, the existing LGTM path applies. Pending verification, authority, disposition, repair, or validation prevents closure. This extends the admission feature's narrower contract-clean path: acknowledged findings and accepted discretionary tradeoffs must not keep an otherwise completed cell active indefinitely.

The same rule applies to the holistic verifier. Report completion by disposition distinctly from reviewer LGTM, with the reasons available in the closing report. Other applicable cells and the holistic review remain required; resolving a finding does not waive review coverage. Existing fingerprint changes can require fresh coverage, while still-valid skip and deferral decisions accompany that review to prevent repeated litigation. New evidence that defeats a decision's basis reopens the finding through normal verification and disposition.

## Relationship to neighboring features

[Second-opinion gates](second-opinion-gates.md) lets the controller probe a recommendation with another reader; this feature lets the skeptic and originating reviewer challenge the value and proposed response together. [Contract-calibrated revise admission](contract-calibrated-revise-admission.md) establishes authority before that assessment. Its admitted findings become eligible for a value decision, and this feature extends its completion rules to respect resolved discretionary findings. [Wave lifecycle](wave-lifecycle.md) supplies the shared review and fingerprint machinery; disposition-based completion extends its literal-LGTM rules while preserving fresh coverage after repairs. These relationships also apply to findings from a second-opinion reviewer.

## Status

Draft design updated with the agreed validity, value, and disposition distinction; not implemented or hardened. Contract-calibrated admission remains an upstream dependency. This update does not settle the wider redesign of Nightshift's review dimensions, agent allocation, or implementation planning.

## Requirements

- The review engine's round machinery and skeptic/controller pipeline (shipped, so no upstream backlog dependency).
- Per-finding fresh-skeptic verification before adjudication (shipped); value assessment never substitutes for factual verification.
- Resumable agent sessions carrying the complete persisted role-specific finding and dialogue state (the session identity mechanism already used by the revise engine).
- The orchestration transition module and fixtures (`internal/revise/orchestration.js`, `internal/revise/orchestration.test.js`; shipped, landed before this feature): `preflightLaunch`'s launch-kind enumeration is closed (`round`, `verifier`, `repair`), and the repair preflight refuses a dispatch naming an Agents row already `completed`. Dialogue dispatch resumes exactly such completed skeptic and reviewer rows. The implementation must therefore update dispatch admission and the dimension and verifier completion rules, with fixtures covering both recorded dispositions and unresolved work, in the same change set as the engine instructions.

Landing order: the wave-convergence lifecycle (wave-lifecycle.md) shipped 2026-08-14 in the 2.2.0 batch; SKILL.md's lifecycle sections are wave-era prose. Derive lifecycle-touching edits from that prose.

## Acceptance criteria

- Every finding receives skeptic validation; missing evidence cannot become a convenient skip.
- A true, authorized improvement can be skipped when its benefit does not warrant its cost, or deferred with a verified durable route and a reason to revisit it.
- Either participant can argue for any disposition; acceptance of current behavior needs no invented repair proposal or backlog entry.
- A violated agreed requirement remains unresolved until repaired or explicitly changed by the user.
- No finding is marked resolved on a lost decision, unverified handoff, unresolved material objection, or unvalidated repair.
- Fully disposed findings can close a dimension or holistic review without another pass solely to elicit LGTM; applied repairs still receive fresh review, and invalidated dispositions reopen.
