---
name: controller-run-experiments
description: Let the controller design and run bounded experiments within the user's authority, such as comparing reviewer models or review framings, record them in a separate experiments ledger, and report each result for the user to adopt, repeat, revise, track or discard
metadata:
  type: feature
status: exploring
---

# Controller-run experiments

## Origin

Raised again by the user on 2026-10-03, after a backlog session that ran several experiments by hand (a dual review by two reviewer models, compacting a reviewer thread before its resume, explicit dependency and link checks), when proposing to compare a reviewer guided by the review lenses with an unguided one, in their words: "i was thinking this could be part of the "controller running experiments" feature; the controller decides which experiment to run (astra vs fable, guided vs unguided, etc.)". On learning that nothing in the backlog tracked it any longer: "that's unfortunate, i definitely want it back."

## How it was lost

Nightshift v2 carried the capability inside an Exploring draft for a two-level run management design, a run manager with an optional shift supervisor, which never shipped. On 2026-09-06 the v3 migration simplified that draft into the optional supervisor now tracked by [Spawn a shift supervisor when admin work fills the controller's context](context-triggered-supervisor.md), and its disposition did not name the experiment authority. A sibling draft for an experiment evidence ledger was simplified into recording material conclusions in the ordinary run record, "without a separate ledger or experiment framework" ([V3-MIGRATION.md](../../V3-MIGRATION.md)), now tracked by [Carry settled decisions and experiment evidence into later reviews](v3-review-decision-context.md). The 2026-10-01 audit of capabilities that left v2 without a disposition covered shipped capabilities, so this part of an unshipped draft went unnoticed until 2026-10-03.

## Direction

Restated from the v2 draft as the starting point, not yet agreed:

- The controller may devise, authorize and run bounded experiments without asking first when every variant stays within the authority already granted, keeps every mandatory gate, and does not put the primary result at material risk. An experiment that risks the outcome, permissions, publication, destructive actions or the user's intent needs the user's authority before it runs.
- Each experiment records its hypothesis, control and treatment arms when comparable work exists, how work is assigned to arms, what is measured, its stop conditions and cost limit, how contamination between arms is avoided, its rollback, and the result that would decide the hypothesis.
- Arms are kept isolated and every variant is identified, with enough evidence to tell a treatment effect from differences between tasks; a separate evaluator judges the outcome where practical. A/B control is preferred when comparable work exists; otherwise a weaker design may be used, with its confounders reported and an inconclusive result allowed.
- Instruction variants run as temporary overlays, never by silently rewriting the canonical instructions during a run.
- A variant joins real work only when every arm stays compliant and useful; one that could jeopardize the primary result runs in shadow or waits for the user.
- Results never promote themselves. The report states the hypothesis, method, sample, observed effects, costs, limits, side effects, conclusion and recommendation, and offers adopting, repeating, revising, tracking or discarding the change for the user to decide.
- In the v2 draft a shift supervisor executed experiments that dispatch workers and the run manager ran only one-step probes itself; in v3 the controller can coordinate directly, and the optional supervisor is still Exploring.
- Added by the user the same day, in their words: "revise-lore could suggest experiments too, recorded somewhere durable for future sessions". A session retrospective may then propose experiments grounded in that session's evidence, kept where a later session can find and run them.
- Added by the user the same day, in their words: "`/ready` should perhaps ask the user upon task selection whether it's allowed to spend extra tokens on experiments or not". Spending extra tokens on experiments would then be part of the authority granted when work is selected, not assumed under the first point above. The user refined it at once, in their words: "perhaps only ask if it actually aims to run any experiments, to reduce noise"; the question is asked only when the controller plans an experiment for the selected work. The user then suggested how that plan is made, in their words: "the "should we run any experiments?" question could be a subagent task running in parallel with the readback review". A background agent decides whether the selected work warrants an experiment and proposes it while the user reads the readback, alongside the background work of [Background review and assessment of selected work](selection-review-and-assessment.md), so the permission question arrives with a concrete proposal without delaying the readback. The user settled its form, in their words: "permission and token allowance should be settled in a single question-response. the controller should suggest a number that the user can adjust". One question proposes the experiment with a suggested token allowance, and the user's single answer grants it, adjusts the number or declines.

## Settled

- **A separate experiments ledger.** The user decided on 2026-10-03, in their words: "a separate experiments ledger would be good too, not fond of the simplification". This reverses the part of the 2026-09-06 migration decision that kept experiment evidence only in the ordinary run record "without a separate ledger". Restated as the starting point: the controller owns the ledger; it records only material conclusions and the evidence that decides them, never dialogue transcripts or routine progress; entries are written at the boundaries that produce evidence about an experiment, such as a review round's adjudication, a repair decision, a verification or a recovery; and the report disposes every retained experiment toward workflow machinery, instructions, backlog work, further experimentation or rejection, for the user to decide.

## Candidate experiments

From 2026-10-03: the reviewer model (Astra versus Fable); a reviewer guided by the review lenses versus an unguided one that receives the change and the governing requirement but no lenses; dual versus single review; and compacting a Codex reviewer thread before its resume, and above which threshold. That day's manual trials are recorded in [Dual strong review for critical work](dual-strong-review.md) and [Make resumed reviewers actually cheap](resumed-reviewer-cost.md).

## Open questions

- The 2026-09-06 migration agreed on no separate experiment framework; the user has since asked for controller-run experiments and a separate ledger, so how much further structure they need, such as a recorded design with arms and a report section, is to be settled with the user.
- Budgets, arm assignment, contamination controls, evaluator independence, and what evidence counts as directional, conclusive or inconclusive.
- The ledger's home and lifecycle: where it lives and whether it is scoped to one run or outlives runs; its creation, identity, refresh and invalidation, and what every reader does when it is absent, stale or malformed; atomic appends and deterministic resume after a partly persisted write; compaction without losing evidence the report needs; and whether a fully disposed ledger is archived or deleted, and what provenance remains.
- The permission asked at selection: how the suggested allowance is estimated and what the controller does when an experiment approaches it; what the background agent that proposes experiments receives, such as the selected entries, the readback, the ledger and pending proposals from retrospectives, and how its proposal reaches the user; what happens when an experiment only suggests itself later in the work; how it combines with the other questions at the end of Ready, such as [Choose how agreed work proceeds](agreed-work-choice.md) and the quick win [Offer to revisit an entry's settled decisions before starting work](../QUICK_WINS.md#offer-to-revisit-an-entrys-settled-decisions-before-starting-work), so that the questions stay few; how it relates to a run's budgets in [Preserve run preferences and enforce supported resource budgets](v3-run-preferences.md); and what the controller may still do without it, such as analysing evidence already recorded at no extra token cost.
- Where experiments that a retrospective proposes are kept so that later sessions find them, such as the ledger outliving runs or a section of the backlog, and how a later session learns of them and picks one up, for example through Ready; how a proposal differs from an experiment already run, and who decides to run it; and how that destination sits beside those that [Retrospective routing by audience and instruction precedence](revise-lore-audience-routing.md) settles for the retrospective's other output. [Answer open backlog questions cheaply in retrospectives](retrospective-open-questions.md) would hand questions too costly to answer cheaply to this entry as proposed experiments.
- How the ledger relates to [Carry settled decisions and experiment evidence into later reviews](v3-review-decision-context.md), which records material conclusions in the run record and delivers them to later reviews.
- Whether experiments run only inside agreed runs or also on their own, and how the authority boundary is stated where a run loads it.
- How it relates to [Measure whether the lifecycle catches defects](defect-detection-measurement.md), whose planted-bug suite is a controlled harness for comparing review arms, and to [Model knowledge base](model-knowledge-base.md), where results about models would land.

Tracking does not authorize implementation.
