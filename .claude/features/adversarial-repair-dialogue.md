# Adversarial repair dialogue

Feature: resolve confirmed findings through an adversarial skeptic-reviewer repair dialogue. This file is the authoritative design record.

## What it does

After a skeptic confirms a finding and the controller admits it against the frozen contract, keep the detailed repair reasoning out of the controller context. Resume that skeptic as the repair author and the originating reviewer as its adversarial critic. A factually true out-of-contract finding receives its reasoned acknowledgement and never enters repair dialogue.

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

The second-opinion gates feature ([second-opinion-gates](second-opinion-gates.md)) distinguishes its controller-probes-recommendation from this design: there the controller exchanges a few bounded messages with a second-opinion agent to probe the motivation behind a change recommendation; here the skeptical verifier of a confirmed and admitted finding defends an exact repair against the originating reviewer's criticism. The two are complementary. [Contract-calibrated revise admission](contract-calibrated-revise-admission.md) is the mandatory boundary between factual confirmation and this repair path. This feature builds on the shipped review-round machinery and skeptic/controller pipeline under `internal/revise/SKILL.md`, and its post-repair reviewer check mirrors the hardened gate's post-fix re-certification pattern.

## Status

Draft design in the backlog; not yet hardened by a revise-spec review. The review-round machinery and skeptic/controller pipeline it builds on are shipped. Contract-calibrated admission must land before this repair path can treat factual truth and change authority as separate decisions.

## Requirements

- The review engine's round machinery and skeptic/controller pipeline (shipped, so no upstream backlog dependency).
- Per-finding fresh-skeptic verification of reported findings before adjudication (shipped; this feature changes what happens *after* a CONFIRMED verdict, not the verdict itself).
- Resumable agent sessions carrying the complete persisted role-specific finding and dialogue state (the session identity mechanism already used by the revise engine).
- The orchestration transition module and fixtures (`internal/revise/orchestration.js`, `internal/revise/orchestration.test.js`; shipped, landed before this feature): `preflightLaunch`'s launch-kind enumeration is closed (`round`, `verifier`, `repair`), and the repair preflight refuses a dispatch naming an Agents row already `completed`. Dialogue dispatch resumes exactly such completed skeptic and reviewer rows, so this feature's change extends the launch-kind enumeration (or the repair kind's row-status domain; a spec-run decision) and updates the fixtures atomically in the same change set.

Landing order: the wave-convergence lifecycle (wave-lifecycle.md) shipped 2026-08-14 in the 2.2.0 batch; SKILL.md's lifecycle sections are wave-era prose. Derive lifecycle-touching edits from that prose.

**Requires:** [Contract-calibrated revise admission](contract-calibrated-revise-admission.md) (FEATURES.md index entry).
