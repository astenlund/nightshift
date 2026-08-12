# Communicate for technically sophisticated, time-constrained users

Feature: every Nightshift user-facing surface assumes its user is an accomplished engineer who owns the requirements but is time-constrained, and communicates technical decisions at the behavioral, architectural, and risk level with full precision, resolving routine mechanics autonomously and consulting the user only when a decision materially affects the work. This file is the authoritative design record.

## What it does

Today the commands and skills have no declared audience model or communication contract. Handover's report, revise's findings, and the prompts they produce are written in whatever register the acting model happens to produce: sometimes code-level exposition the user must reconstruct to evaluate, sometimes hand-waving that hides the actual decision. There is no rule for when a session stops to ask versus decides and flags, so the same material decision can block an unattended run in one session and pass unremarked in another.

This feature fixes the audience assumption and the communication contract Nightshift operates under, so that every surfaced decision is decidable by an accomplished engineer without reconstructing the project's internals, and so that the only questions that reach the user are ones that genuinely require their judgment.

## The audience model

Nightshift assumes the user is an accomplished engineer who owns the requirements but is time-constrained and not necessarily familiar with the code-level details of the project. The assumption is deliberately sharp rather than diluted. The plugin is public on the Anthropic marketplace, but in practice serves its author as the primary user; casting communication at an accomplished engineer matches the real user exactly and stays correct for any stranger on the marketplace, while a diluted persona would degrade the actual experience. The marketplace presence is therefore not a reason to widen the audience.

## Communication altitude

Decisions and findings are communicated at the behavioral, architectural, and risk level, with full precision, without requiring the user to reconstruct the project's internals. Precision applies to the decision-relevant facts (what changed, what architecture implies it, what risk it carries), not to source exposition. Unfamiliarity with the codebase is not treated as lack of technical sophistication; condescending simplification and unexplained implementation detail are equally out of bounds.

## Delegation boundary

Whether the user is consulted depends on the lifecycle phase, and the boundary is drawn per phase:

- During design and spec work, a material decision involves the user. The spec is the contract being built; this is the phase where the user's judgment is cheapest to apply and shapes everything downstream.
- During autonomous execution of an approved design, material decisions are made and recorded as session-end follow-up flags (surfaced in the handover morning report) rather than stopping the run to ask. This includes decisions that change approved scope: execute, flag, and surface the change in the report.

When a scope change is judged necessary during execution, the default is naive-first: implement the cheapest version that satisfies the new need, and make the follow-up flag include adding a refactoring entry to the backlog. The cheap implementation is easier to revert or correct after the user reviews the flag, and the refactor becomes a tracked backlog item rather than an executed-but-unrecorded design decision.

Reversibility is one consideration alongside the other materiality criteria (requirements, scope, observable behavior, risk tolerance, cost, reversibility) and does not stand above them. With agents available to do the work, most changes are reversible at some time cost; a reversible change is still a design decision that the phase rule decides whether to surface, not a license to skip surface mechanics.

### Reconciliation with the existing revise triage halt

`commands/handover.md` currently halts the run on any finding that changes implementation scope: block and ask, treating it as genuinely blocked work. Under the phase split, that halt keeps its genuine survivals:

- a scope finding raised while the spec or plan is still being settled is design-phase work, where the split involves the user;
- an execution-phase scope gap with no decidable path is a real brainstorm block and stays halted rather than being implemented blind.

Decidable execution-phase scope adjustments to an approved design move to the decide-and-flag channel with the naive-first guard. Amending the triage rule's wording in `commands/handover.md` to draw this line is part of this feature's future implementation, not of this migration.

## Evidence policy

Code-level evidence is provided when it is necessary to explain a concern or when the user requests it. Evidence is for verification, not education: the judge of a decision gets the receipts when a claim is risky or hard to trust, and the user can always ask. Routine decisions do not default to code excerpts.

## Acceptance criterion

The default communication lets an experienced engineer make the decisions that actually require their judgment without first reconstructing the project's internals. Every judgment call that reaches the user, and every decision recorded as a follow-up flag, must be decidable from what was presented, in the project's own vocabulary.

## Relationships

- The handover morning report is the surfacing channel the phase-split delegation rule relies on (existing; `commands/handover.md`).
- The revise triage halt in `commands/handover.md` surfaces the opposite consultation contract on scope changes; this feature reconciles it by phase, keeping the halt for design-phase and genuinely-blocked findings and moving decidable execution-phase scope adjustments to decide-and-flag. Amending the halt's wording is part of this feature's implementation (see Delegation boundary).
- The naive-first scope-change convention feeds refactoring entries into the four-index backlog (existing; `QUICK_WINS.md` / `FEATURES.md`).
- The audience here is the personal use context; the rigor profile's operating-context section records the same context for spec-level rigor decisions (see [calibrate-first-draft-rigor](calibrate-first-draft-rigor.md)).

## Status

Migrated into the backlog on 2026-08-11. Five design decisions were confirmed one at a time during migration, and a sixth reconciliation was confirmed during the post-migration review on 2026-08-12: (1) the audience model, an accomplished engineer who owns the requirements and is time-constrained, sharpened rather than diluted by the single-user plus public-marketplace reality; (2) the communication altitude, behavioral/architectural/risk level with full precision and no source-familiarity requirement; (3) the phase-split delegation boundary, which involves the user during spec work and decides-and-flags during execution, with scope changes also flagged naive-first and reversibility treated as a co-equal materiality criterion rather than a trump; (4) the evidence policy, code-level evidence when needed to explain a concern or on request; (5) the acceptance criterion, that an experienced engineer can make judgment-call decisions from what is presented; (6) the reconciliation with handover's revise triage halt, which keeps its design-phase and genuinely-blocked survivals while decidable execution-phase scope adjustments decide-and-flag. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The handover morning report as the session-end flag surface (existing; `commands/handover.md`).
- The four-index backlog and its refactoring-entry convention, which the naive-first rule's follow-up flag points into (existing).
- The communication surfaces this contract would steer: handover, the revise commands, and the ready and init-backlog output (existing).

**Requires:** none.

## Hardening

- (None yet; this file has not been through a revise-spec run.)
