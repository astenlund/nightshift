---
name: rigor-steered-lifecycle
description: Explore making the spec's rigor tier an executable budget that steers plan shape, review-loop churn, and spec hardening depth, on a five-tier scale (minimal, low, medium, high, max)
metadata:
  type: feature
status: exploring
---

# Rigor-steered lifecycle

Draft exploring how the rigor tier declared in a spec's `Operating context` section steers the whole lifecycle instead of only calibrating reviewers. Prompted by the 2026-08-22 breakout-dependency-drift handover: a medium-tier bug fix whose landed change was about 150 lines of parser plus 19 one-line deletions and a prose sweep, delivered through a 12-hour run (25 spec rounds with 57 findings, 26 plan rounds with 60 findings, a 1370-line plan, 8 implementation tasks with per-task reviews, a 6-round code loop). The tier was confirmed at shift start and then consumed by nothing as a budget; superpowers' writing-plans shape and the engine's reopen-everything convergence rule set the effort regardless.

## Observed

- **The tier is advisory.** `internal/revise/rigor.js` derives a tier and per-dimension effort, the spec grounding step records it, and payloads pass it to reviewers as "a grounding input". No step reads it to cap rounds, select dimensions, shape the plan, or gate which fixes reopen certified cells.
- **Plan shape is set by the authoring skill, not the change.** writing-plans produces verbatim before/after blocks and per-file count gates at every size. Those gates then became the plan loop's dominant subject: roughly a third of its 60 findings were gate-arithmetic defects, and several were introduced by earlier rounds' fixes.
- **Every confirmed finding reopens every cell.** A wording fix moves the fingerprint, the sweep reactivates all certified cells, and the tail chains. The loop has no notion of a finding too small to reopen its siblings.
- **Six review surfaces, no stopping rule between them.** Spec loop, plan loop, per-task review, final branch review, code loop, lore fresh-eyes. The layers that found real defects (the plan loop's fingerprint-invalidation chain, the final branch review's two Important items) would have found them with far less preceding work.
- **Tier derivation ignores the safety net and the size.** A fixture suite covering the changed code is what made this fix low-risk; `code.md` already uses exactly that reasoning to justify its cheaper model pin, but the derivation does not weigh it, and nothing estimates the change's size.

## Five tiers

Extend the scale from `low | medium | high` to `minimal | low | medium | high | max`, keeping `rigor.js` as the single derivation authority and `TIER_CAP` as the ceiling uplifts can reach (proposed: uplifts still cap at `high`; `max` is reachable only by explicit user election in the spec, since it spends without limit). Sketch of what each tier buys, to be firmed up:

| Tier | Spec hardening | Plan shape | Review loops | Implementation review |
|---|---|---|---|---|
| minimal | digest-complete only: goal, decisions, acceptance criteria decidable; no loop | a task list naming files, intent, and the proving command; no plan loop | none; one verifier pass over the final diff | none beyond the suite |
| low | one round of design-soundness and acceptance-decidability; no wording dimensions | same as minimal, plus red/green test steps named, not transcribed | cap 3 rounds; severity floor: only behavior-changing findings reopen siblings | final branch review only |
| medium | two-wave cap on the reduced dimension set | superpowers shape without verbatim blocks; suites are the gates, grep gates only where no suite covers the text | cap 6 rounds; floor as low | per-task review on judgment tasks, final branch review |
| high | today's full loop | today's full superpowers shape | today's rules, round cap as today | today's SDD loop |
| max | full loop plus a second independent verifier and refute passes on every Important finding | full shape plus dry-run of every embedded script | no round cap; no severity floor | full SDD plus a refute pass over the final review |

The table is a starting point, not a decision; the firm parts are the five names, the ordinal order, and that each tier is a budget every step reads.

## Mechanism

1. **Plan shape (handover step 2).** Handover hands writing-plans a tier-derived authoring brief (the authoring-guidance-overlay draft is the natural carrier): granularity, whether verbatim edit blocks are allowed, what counts as a verification gate. Minimal through medium forbid per-file count gates where a suite covers the text.
2. **Severity floor in the engine.** A confirmed finding below the tier's floor is applied, but only the fixing cell re-certifies; siblings keep their certification. Above the floor the current reopen-everything rule stands. The floor gates fix churn, never dimension coverage: every applicable dimension still gets its first pass, so the plan loop's best catch (a deep read of an embedded script against a real library) is not what a lower tier skips. Reuse candidate: the agreement controller's `buildDerivedDiff` already separates representation-only hunks from canonical ones; certification staleness could adopt the same split instead of raw fingerprint inequality.
3. **Dimension and round profile per tier.** One table in `internal/revise/SKILL.md` mapping tier to round cap, active dimension set (tier-inactive dimensions become N/A with the tier as the recorded reason), and floor. The spec loop reads the tier its own grounding step derived, since derivation runs before the rounds.
4. **Derivation inputs.** Add two inputs to `rigor.js`: whether an executable safety net covers the change (a fixture suite, a type checker, a build), which pulls the baseline down one tier; and a change-size estimate (files and lines the spec's acceptance criteria imply), which caps plan length and selects the plan shape independently of tier.
5. **User election.** The tier stays user-confirmed at shift start (the Operating context consult already exists); the user may set it above or below the derived value, and `max` is election-only.

## Relation to sibling drafts

- **Light revise mode** is one row of the profile table (a reduced dimension set and a single reviewer); this draft supplies the selector it lacked.
- **Wave round economy** attacks the same tail churn from the lifecycle side (delta-scoped re-review, batching); the severity floor here is the rigor-side complement and can land first.
- **Authoring guidance overlay** is where the plan-shape brief would live.
- The bundled-controller proposal from the same handover (a deterministic revise-state controller that enforces the sweep boundary) is a prerequisite for enforcing round caps and floors mechanically rather than by controller prose.

## Open questions

- Does the severity floor need a skeptic verdict of its own ("below floor" as a classification), or is it the reviewer's call with the skeptic confirming?
- Can a tier be raised mid-run when a finding above the floor reveals the change is larger than estimated, and what does that do to certifications already held?
- Where does the size estimate come from before a plan exists: the spec's acceptance criteria, or a scout pass over the tree?
- Whether `minimal` should exist as a spec tier at all, or only as a plan and review tier under a low spec.
