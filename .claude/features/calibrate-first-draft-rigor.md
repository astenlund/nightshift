# Calibrate first-draft rigor to deployment context

Feature: every first design-spec draft states an explicit rigor profile derived from the feature's operating context, with correctness as a non-negotiable floor and validation, recovery, compatibility, observability, and proof effort scaling with consequences and context. This file is the authoritative design record.

## What it does

Today the first design-spec draft carries no declared standard for how hard it will be validated, how much recovery and compatibility machinery is warranted, or how far observability and proof effort must go. Rigor is whatever the author's default habits happen to produce, and fresh reviewers have no shared reference for the standard the draft holds itself to. In high-consequence deployment contexts that risks under-engineering; in low-consequence personal tooling it risks over-investment out of proportion to the trust and exposure at stake.

This feature adds an explicit rigor profile to the first spec draft: a statement of the operating context the feature will live in and the rigor warranted above the correctness floor. Correctness is never negotiable; the dimensions above it scale with consequences.

## The profile's content

The profile records the operating context drawn from these inputs:

- deployment environment and operational criticality;
- audience (see below);
- failure consequence and data or security sensitivity;
- concurrency and compatibility risk;
- reversibility and recovery cost;
- expected feature lifetime.

From these it derives the rigor standard for validation, recovery, compatibility, observability, and proof effort above the correctness floor. Dimension effort scales with consequences; it never drops below the correctness floor, and a profile that reads "low rigor" still means low effort on the *scaling* dimensions, never permission to relax correctness or omit known requirements.

## Placement: an operating-context section in the spec

The profile lands as a prose `Operating context` section in the spec body, paired with the [durable scope anchor](durable-scope-anchor.md). The two sections split cleanly and do not overlap:

- the scope anchor records the requested outcome and the material exclusions that bound it: *what* the user asked for;
- the operating-context section records the environment the answer must hold in and the rigor it warrants: *in what context*, at what rigor.

The profile does not re-open the anchor's exclusions, and the anchor does not lift rigor. Both are sections of prose, not machine-parseable fields, consistent with the anchor's decision form.

## The audience classification

Audience ("who is this for") is a derived classification, not an independent hidden input: it summarizes the userbase size, trust boundary, and exposure inputs together with the commercial and deployment relationship. The category set, surfaced from the durable-scope-anchor migration:

- single-dev/personal use;
- trusted circle;
- paying customers;
- organization;
- public.

The set is non-exhaustive. The spec records the closest match and, when no category fits cleanly, states the mismatch rather than silently forcing a label. Treating audience as a derived classification avoids double-counting it against the size, trust, and exposure inputs it summarizes.

## Derivation: durable project knowledge first

The profile is derived from durable project knowledge before the user is consulted. If repository guidance, architecture documents, or established project conventions already answer a question about the operating context, those answers are used. The user is asked only when the feature differs materially from the documented defaults, or when unresolved ambiguity would change a design decision.

Any feature-specific deviation from the project's documented defaults is recorded in the spec, so fresh reviewers apply the intended standard without repeatedly reopening the question.

## Stability: frozen unless the user revises

The profile is written once at spec creation and remains stable as implementation mechanics are refined, mirroring the scope anchor's freeze. If the user's operating context genuinely changes mid-flight, the profile is revised and the revision itself is recorded (old text, new text, why), so reviewers who saw the previous context know what shifted.

## Propagation: reviewer payloads as context

The operating-context section is copied unchanged into reviewer payloads as common context, alongside the scope anchor, so fresh reviewers in every dimension and phase calibrate findings against the same environment and rigor standard. It is a grounding input to review, not a review outcome.

## Constraint semantics: proportionate engineering

A profile derived from a low-consequence context is a statement of the environment the answer must hold in, not a license to skip required work: correctness stays the floor, and known requirements still bind. A profile derived from a high-consequence context raises the proof and validation bar but does not change what the user asked for, which remains the scope anchor's domain.

## Relationship to neighboring features

- **[durable-scope-anchor](durable-scope-anchor.md)** is this section's paired half. That feature deliberately deferred operating-context profiling here on 2026-08-11; the audience category set proposed there is adopted here as a derived classification, and the two sections combine at the spec level.
- **[second-opinion-gates](second-opinion-gates.md)** references "the rigor profile" as the basis for classifying post-fix re-certification buckets. That phrase predates this feature and has no link to resolve; this feature gives the concept a declared home, and the gate's wording can be linked here when next edited.

## Status

Migrated into the backlog on 2026-08-11, with five design decisions confirmed one at a time during migration: in-spec operating-context section paired with the durable scope anchor; the six operating-context inputs; knowledge-first derivation with user consultation only when materially different, deviations recorded; the audience category set adopted as a derived classification with closest-match semantics; freeze-and-propagate stability matching the anchor. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The spec authoring shape this feature extends: the `Feature:` first line and `## What it does` convention in `.claude/features/` house shape (existing).
- The durable scope anchor and its placement convention, which this section pairs with (existing; see [durable-scope-anchor](durable-scope-anchor.md)).
- The common-context-block machinery in `skills/revise/SKILL.md` that assembles reviewer payloads (existing; this feature adds the operating-context text to that block).

**Requires:** none.

## Hardening

- (None yet; this file has not been through a revise-spec run.)