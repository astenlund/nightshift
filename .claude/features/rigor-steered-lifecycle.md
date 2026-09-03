---
name: rigor-steered-lifecycle
description: Make the spec's rigor tier an executable budget that steers plan shape, review-loop churn, and spec hardening depth, on a five-tier scale (minimal, low, medium, high, max)
metadata:
  type: feature
---

# Rigor-steered lifecycle

Feature: the rigor tier declared in a spec's `Operating context` section steers the whole lifecycle instead of only calibrating reviewers. This file is the authoritative design record; the tier table and mechanism below are the firming design, the open questions are what brainstorming still owes. Prompted by the 2026-08-22 breakout-dependency-drift handover: a medium-tier bug fix whose landed change was about 150 lines of parser plus 19 one-line deletions and a prose sweep, delivered through a 12-hour run (25 spec rounds with 57 findings, 26 plan rounds with 60 findings, a 1370-line plan, 8 implementation tasks with per-task reviews, a 6-round code loop). The tier was confirmed at shift start and then consumed by nothing as a budget; superpowers' writing-plans shape and the engine's reopen-everything convergence rule set the effort regardless.

## Observed

- **The tier is advisory.** `internal/revise/rigor.js` derives a tier and per-dimension effort, the spec grounding step records it, and payloads pass it to reviewers as "a grounding input". No step reads it to cap rounds, select dimensions, shape the plan, or gate which fixes reopen certified cells.
- **Plan shape is set by the authoring skill, not the change.** writing-plans produces verbatim before/after blocks and per-file count gates at every size. Those gates then became the plan loop's dominant subject: roughly a third of its 60 findings were gate-arithmetic defects, and several were introduced by earlier rounds' fixes.
- **Every confirmed finding reopens every cell.** A wording fix moves the fingerprint, the sweep reactivates all certified cells, and the tail chains. The loop has no notion of a finding too small to reopen its siblings.
- **Six review surfaces, no stopping rule between them.** Spec loop, plan loop, per-task review, final branch review, code loop, lore fresh-eyes. The layers that found real defects (the plan loop's fingerprint-invalidation chain, the final branch review's two Important items) would have found them with far less preceding work.
- **Tier derivation ignores the safety net and the size.** A fixture suite covering the changed code is what made this fix low-risk; `code.md` already uses exactly that reasoning to justify its cheaper model pin, but the derivation does not weigh it, and nothing estimates the change's size.

## Five tiers, defined by subtraction from max

Extend the scale from `low | medium | high` to `minimal | low | medium | high | max`. `max` is today's full machinery, so nothing that exists today is lost; every lower tier is defined by what it subtracts from the tier above it, which keeps the definitions checkable (a tier is a list of removed mechanisms, never a restated process) and gives the derivation room to climb one step at a time. `rigor.js` stays the single derivation authority: the audience baseline starts at `minimal` for personal use and `TIER_CAP` rises to `max`, so each fired uplift buys one step of machinery instead of today's two-step jump from `low` to `high`.

| Tier | Subtracts from the tier above |
|---|---|
| max | nothing: today's spec loop, superpowers plan shape, plan loop, full SDD with per-task reviews and the final branch review, code loop, round caps as today |
| high | the second verifier pass and refute passes on Important findings (neither exists today, so `high` equals `max` until they are added); otherwise identical |
| medium | verbatim before/after blocks and per-file count gates from the plan (suites are the gates; a grep gate only where no suite covers the text); the wording, balance, and structure dimensions from the spec loop; per-task reviews on transcription tasks (judgment tasks keep theirs); round cap halves |
| low | the plan loop; per-task reviews entirely (final branch review stays); the severity floor rises so only behavior-changing findings reopen certified cells; spec loop capped at one wave |
| minimal | the spec loop (the spec must still yield a decision-complete digest); the plan becomes a task list naming files, intent, and the proving command; the code loop, leaving one verifier pass over the final diff plus the suite |

Floors that no tier subtracts: agreement on a decision-complete digest before work, the full test suite, the final verifier pass, and the morning report. The table is a starting point; the firm parts are the five names, the ordinal order, that `max` is today's behavior, that every tier is stated as a subtraction, and that each tier is a budget every step reads.

## Mechanism

1. **Plan shape (handover step 2).** Handover hands writing-plans a tier-derived authoring brief (the authoring-guidance-overlay draft is the natural carrier): granularity, whether verbatim edit blocks are allowed, what counts as a verification gate. Minimal through medium forbid per-file count gates where a suite covers the text.
2. **Severity floor in the engine.** A confirmed finding below the tier's floor is applied, but only the fixing cell re-certifies; siblings keep their certification. Above the floor the current reopen-everything rule stands. The floor gates fix churn, never dimension coverage: every applicable dimension still gets its first pass, so the plan loop's best catch (a deep read of an embedded script against a real library) is not what a lower tier skips. Reuse candidate: the agreement controller's `buildDerivedDiff` already separates representation-only hunks from canonical ones; certification staleness could adopt the same split instead of raw fingerprint inequality.
3. **Dimension and round profile per tier.** One table in `internal/revise/SKILL.md` mapping tier to round cap, active dimension set (tier-inactive dimensions become N/A with the tier as the recorded reason), and floor. The spec loop reads the tier its own grounding step derived, since derivation runs before the rounds.
4. **Derivation inputs.** Rebase `rigor.js` on the five-tier scale: audience baselines start one step lower than today (`personal use` and `trusted circle` at `minimal`, `paying customers` at `low`, `organization` and `public` at `medium`), `TIER_CAP` becomes `max`, and two inputs join the five uplifts: an executable safety net covering the change (a fixture suite, a type checker, a build) subtracts one step, and a change-size estimate (files and lines the spec's acceptance criteria imply) adds one step above a threshold and caps plan length independently of tier. Existing specs that declare `low`, `medium`, or `high` keep their meaning as ordinals on the new scale; the derivation note in each is what changes on the next refresh.
5. **User election.** The tier stays user-confirmed at shift start (the Operating context consult already exists); the user may set it above or below the derived value. [Operating context at shift start](operating-context-at-shift-start.md) is the digest-time form of this election, and its rigor line grammar and fixtures depend on the derivation's input set: when this feature rebases the derivation on more inputs, that grammar and those fixtures change with it.

## Relation to sibling drafts

- **Light revise mode** is one row of the profile table (a reduced dimension set and a single reviewer); this draft supplies the selector it lacked.
- **Wave round economy** attacks the same tail churn from the lifecycle side (delta-scoped re-review, batching); the severity floor here is the rigor-side complement and can land first.
- **Authoring guidance overlay** is where the plan-shape brief would live.
- **Bundled revise controller** (a deterministic revise-state controller that enforces the sweep boundary) is the formal upstream gate: round caps and severity floors are enforced by that controller, not by controller prose, so it lands first.

## Open questions

- Does the severity floor need a skeptic verdict of its own ("below floor" as a classification), or is it the reviewer's call with the skeptic confirming?
- Can a tier be raised mid-run when a finding above the floor reveals the change is larger than estimated, and what does that do to certifications already held?
- Where does the size estimate come from before a plan exists: the spec's acceptance criteria, or a scout pass over the tree?
- Whether `minimal` should exist as a spec tier at all, or only as a plan and review tier under a low spec.
- Whether `high` should subtract something real from `max` today (a candidate: the lore fresh-eyes pass and the code loop's cross-cutting dimensions), or stay equal to it until the refute and second-verifier machinery exists.
