# Durable scope anchor

Feature: every design spec carries a short, durable scope anchor near its goal, and controllers copy it unchanged into every reviewer payload as common context. This file is the authoritative design record.

## What it does

Today a design spec records what it does and how, but the *requested outcome* behind it lives only in the session that produced it: the brainstorm transcript, the controller's notes, or the author's memory. Fresh reviewers read the finished spec and reconstruct what the user actually asked from the design's teleological drift. When completeness or soundness pressure starts pulling the design into neighboring systems, there is no shared durable reference for "what was actually requested, and what was explicitly out of scope."

This feature adds a **scope anchor**: a short statement near the spec's goal that paraphrases the user's requested outcome and the material exclusions that bound it. The anchor is written once, frozen, and propagated verbatim into every reviewer payload so controllers and fresh reviewers always hold the same durable reference to what the user asked for.

## The anchor's content

The anchor states exactly two things:

- the **requested outcome**: a paraphrase of what the user actually asked to achieve;
- the **material exclusions**: explicit boundaries that distinguish the requested behavior from adjacent improvements.

It deliberately does **not** restate the detailed design. The design lives in the body of the spec; the anchor compresses the *request* it serves, not the mechanism that serves it. A reader must be able to answer "what did the user ask for, and what did they explicitly not ask for?" from the anchor alone, without reconstructing either from the design.

The section uses one stable, human-readable shape:

```markdown
## Scope anchor

Requested outcome: <approved outcome>

Material exclusions: <approved exclusions>
```

When the agreement process deliberately establishes that the user stated no material exclusions, the exact empty representation is:

```text
Material exclusions: None stated.
```

An absent `Material exclusions:` line is incomplete capture, never an empty set. `None stated.` is valid only after the normal agreement gate confirms the decision-complete digest; an agent must not infer it merely because the source request omitted exclusions. Verified repository constraints may supplement the contract during review, but they are labeled as constraints and never rewritten as user-stated exclusions.

## Placement: near the goal, in the spec body

The anchor lives in the spec body near its goal: immediately below the `Feature:` first line (the goal condensation) and above `## What it does`. It is structurally identifiable prose with exact labels, not JSON or frontmatter. The spec body is the anchor's home because the spec is the durable artifact that travels: session memory is ephemeral, and a raw conversation transcript is not a stable reference. Until this feature lands no spec is required to carry an anchor; once it does, a new or newly reviewed spec without the complete section is incomplete.

The anchor is not the `Feature:` line itself and does not replace it: the `Feature:` line is a one-line goal condensation for index scannability, while the anchor is a short section carrying the outcome and exclusions in a form reviewers use as ground truth.

## Stability: frozen unless the user revises

The anchor is written once and remains stable as implementation mechanics are refined. Design iteration happens under the anchor, against it; the anchor does not drift to follow the design.

If the user's *requested outcome* genuinely changes mid-flight, the anchor is revised, and the revision itself is recorded: old text, new text, and why. Reviewers who saw the previous payload know what shifted and what motivated it. Without the recorded revision, a changed anchor silently moves the ground truth each reviewer calibrates against. The default is freeze; revision is an exceptional, recorded event, not a teleological drift.

## Lifecycle and legacy behavior

The anchor is created from the user-approved decision digest before a new spec enters validation or lifecycle work. It is refreshed only through a later user-approved outcome or exclusion change. A revision invalidates any approval identity, reviewer certification, actionability decision, or verifier stamp derived from the prior text. The controller records the revision before dispatching against the new anchor.

At the first interactive review of an existing spec without an anchor, the controller presents and obtains approval for a backfilled anchor before reviewer launch. It may quote durable goal and anti-goal text as evidence, but it may not silently promote implementation detail into the requested outcome. A fresh unattended run without a complete approved anchor fails closed with one durable handover question and produces no review-driven edit or stamp. An already active checkpoint created before anchor enforcement continues under its recorded legacy policy or is explicitly abandoned and restarted; a plugin update never silently reinterprets it.

The complete anchor remains in the spec after implementation and review scratch cleanup. It becomes stale only when the user revises the requested outcome or exclusions. Repository edits, reviewer suggestions, and implementation discoveries cannot refresh it by themselves.

## Propagation: every review decision, verbatim

The anchor is copied **unchanged** into every reviewer, skeptic, dedup-judge, controller-admission, and verifier context, whichever cell and round runs. It is the common-context block's scope ground truth. A fresh agent always receives the same text the author wrote, so factual verification and actionability use one contract. This is the durable reference the anchor exists to supply when completeness or soundness pressure starts pulling the design into neighboring systems.

For plan review, the controller propagates every governing spec's anchor. Incompatible requested outcomes or exclusions are a structural precondition error; the controller does not select one by convenience. For code review, the governing plan and spec set supplies the anchors. The contract-calibrated admission feature owns the complementary legitimately spec-less plan and code branches, including the approved run-local fallback and unattended failure behavior.

The anchor is a grounding input to review, not a review outcome; it is written at spec-creation time and consumed by every later review stage. The run freezes the exact anchor set and a digest of that set. Any source-anchor or governing-set change invalidates decisions and certifications derived from the prior digest even when the artifact under direct review did not change.

## Constraint semantics: ground, do not immunize

The anchor constrains scope expansion **without** suppressing findings about how the chosen design is wired. It says "this is what the user asked for, and these exclusions are explicit" so reviewers do not flag the deliberate boundaries as gaps. It does **not** say "the design is correct because it satisfies the request": a reviewer must still flag a real defect inside the anchor's scope, a dependency or reference problem, a lint violation, or any concrete issue in the mechanism itself.

This mirrors the revise-* acknowledgement rule: an acknowledgement scopes to the design *choice*, not to the mechanics around it. The anchor is the durable form of that rule's groundwork: it marks what is intentional (the requested outcome and its exclusions) and leaves the wiring fully open to findings.

## Relationship to neighboring features

- **[second-opinion-gates](second-opinion-gates.md)** already names "the durable scope anchor" as the concrete carrier for its requirements gate: the reqs list persists the user's requirement description(s) plus settled Q&A and forwards them unchanged into every gate. This feature is that concept made concrete. The requirements-gate reqs list is the anchor's capture moment (the user statement the anchor paraphrases), and the anchor is the stable form that travels in gate payloads.
- **[Calibrate first-draft rigor to deployment context](calibrate-first-draft-rigor.md)** is the natural home for operating-context profiling, including audience ("who is this for"). Per the 2026-08-11 migration decision, this feature deliberately leaves operating context to that feature and confines itself to outcome plus exclusions; the two anchor areas combine at the spec level now that the operating-context section ships next to the anchor. The candidate audience category set (personal use, trusted circle, paying customers, organization, public) proposed here was adopted there as a derived classification.
- **[Contract-calibrated revise admission](contract-calibrated-revise-admission.md)** consumes the frozen anchor after factual verification and before repair. It owns the compact actionability record, contract-clean certification, spec-less run basis, and failure behavior; this feature owns only durable spec capture and propagation.
- The spec-review pre-seed scan in `internal/revise/spec.md` harvests anti-goal and "out of scope" language into the acknowledgements list. The anchor gives that scan a declared source to read instead of an inferred one: the anchored exclusions are seeded directly, so the scan's remaining wording-based seeding then only covers what the anchor did not already state.

## Status

Migrated into the backlog on 2026-08-11, with five design decisions confirmed one at a time during migration: in-spec anchor section near the goal; outcome-plus-exclusions content without restating the design; frozen unless the user revises, with the revision recorded; propagation to all reviewer payloads verbatim; grounding (not immunity) constraint semantics. The session's audience-context idea was deliberately deferred to the rigor-to-context calibration migration (durable-proposal title: Calibrate first-draft rigor to deployment context) rather than absorbed here. Cross-project arbitration on 2026-08-18 added the exact labeled shape, deliberate-empty semantics, lifecycle, legacy boundary, complete review-consumer set, and admission-feature relationship. The feature is decision-complete but has not been through revise-spec hardening.

## Requirements

- The spec authoring shape this feature extends: the `Feature:` first line and `## What it does` convention in `.claude/features/` house shape (existing).
- The common-context-block machinery in `internal/revise/SKILL.md` assembles reviewer payloads (existing; this feature adds the anchor text to that block's scope ground truth).
- The spec-review pre-seed acknowledgement scan in `internal/revise/spec.md` harvests acknowledgements (existing; this feature feeds it a declared source).

Landing order: the wave-convergence lifecycle (wave-lifecycle.md) shipped 2026-08-14 in the 2.2.0 batch; SKILL.md's lifecycle sections are wave-era prose. Derive lifecycle-touching edits from that prose.

**Requires:** [Present chosen spec for agreement before work](present-spec-for-agreement.md) (FEATURES.md index entry).

## Hardening

- (None yet; this file has not been through a revise-spec run.)
