# Adversarial repair dialogue

Feature: resolve confirmed findings through an adversarial skeptic-reviewer repair dialogue. This file is the authoritative design record; it absorbs the design formerly drafted as proposal #23 in `nightshift-proposals.md`.

## What it does

After a skeptic confirms an in-scope finding, keep the detailed repair reasoning out of the controller context. Resume that skeptic as the repair author and the originating reviewer as its adversarial critic.

The relationship remains adversarial throughout:

- the skeptic proposes and defends an exact repair;
- the reviewer tries to expose incomplete closure, regressions, ambiguity, and violated adjacent invariants;
- the skeptic revises the proposal in response;
- neither agent edits the artifact during the dialogue.

## Termination

Allow several exchanges when they continue to improve the repair. A few focused turns are cheaper than extra full review iterations caused by a shallow fix. Terminate when the reviewer has no remaining objection to the repair, the agents reach a narrow unresolved disagreement, or a safety limit prevents further exchanges. Keep productive repair dialogue separate from execution-repair budgets for malformed or missing agent output.

## Resolution package

Return a compact resolution package to the controller containing:

- the exact proposed change;
- why it closes the confirmed finding;
- the adjacent invariants checked;
- the required validation;
- the reviewer's acceptance or remaining objection;
- any independently discovered findings.

## Controller's role

The controller remains responsible for disposition, edit-surface enforcement, applying the repair, and running validation. It should not reconstruct the solution unless the agents disagree.

## Session continuity

Resume the same skeptic and reviewer sessions when available: their retained, role-specific understanding of the artifact area is a repair-quality mechanism, while prompt caching reduces cost. If either session is unavailable, use a fresh replacement with the complete persisted role-specific finding and dialogue state, and record the loss of session continuity. This recovery path preserves progress but is not equivalent to continued same-session deliberation.

## Reviewer acceptance is not LGTM

Reviewer acceptance validates only the repair proposal. It does not produce LGTM, deactivate the dimension, or replace the next fresh review of the actual artifact. Any independent pre-existing problem discovered during the dialogue enters the normal finding pipeline and receives verification from a fresh skeptic rather than the repair-author skeptic.

## Relationship to neighboring features

The second-opinion gates feature ([second-opinion-gates](second-opinion-gates.md)) distinguishes its controller-probes-recommendation from this design: there the controller exchanges a few bounded messages with a second-opinion agent to probe the motivation behind a change recommendation; here the skeptical verifier of a confirmed finding defends an exact repair against the originating reviewer's criticism. The two are complementary. This feature builds on the shipped review-phase machinery and skeptic/controller pipeline, and its post-repair reviewer check mirrors the hardened gate's post-fix re-certification pattern.

## Status

Draft proposal migrated from `nightshift-proposals.md` (#23) into the backlog; not yet hardened by a revise-spec review. Depends on nothing outstanding: the review-phase machinery and skeptic/controller pipeline it builds on are shipped.

## Requirements

- The review engine's phase/round machinery and skeptic/controller pipeline (shipped, so no upstream backlog dependency).
- Per-finding fresh-skeptic verification of reported findings before adjudication (shipped; this feature changes what happens *after* a CONFIRMED verdict, not the verdict itself).
- Resumable agent sessions carrying the complete persisted role-specific finding and dialogue state (the session identity mechanism already used by the revise engine).

**Requires:** none.