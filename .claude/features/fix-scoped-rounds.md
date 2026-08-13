# Fix-scoped follow-up rounds

Feature: within a revise phase, round 2 and later deliver each active dimension's reviewer a payload containing only the fixes applied at the previous round boundary that originated from that dimension's own findings, plus surrounding context, instead of the whole cumulative review patch. The next phase resets to whole-scope delivery as today, restoring full coverage over the fixed artifact. Primary rationale: this removes a within-phase asymmetry in who gets to weigh in on fixes; reduced token spend and wall-clock time are a hoped-for secondary benefit, and the narrower model is preferred even if the savings do not materialize. This file is the authoritative design record.

## What it does

Today every round of every phase delivers the full cumulative patch (and, for code, the full in-scope live file set) to every active dimension's reviewer. But a round 2+ reviewer exists for exactly one reason: its dimension's previous reviewer produced findings whose fixes were applied, and the dimension therefore stayed active. The open question that round answers is "are the fixes sound, and did they leave the dimension clean?", yet the reviewer pays the whole-scope reading cost to answer it.

This feature narrows the round 2+ payload to the previous round's own-dimension fixes plus surrounding context. Round 1 of every phase remains whole-scope, unchanged.

## Design decisions (settled with the user, 2026-08-13)

- **Own-dimension fixes only.** Dimension X's round 2+ reviewer sees only the fixes traced to X's own adjudicated findings, not every fix applied at the previous round boundary. This is the narrowest payload; cross-dimension damage from a fix (a Correctness fix opening a Security hole) waits for the next phase's whole-scope pass.
- **Context findings are flagged normally.** When a narrowed reviewer notices a problem in the surrounding context rather than in a fix itself, the finding enters the normal skeptic/adjudication pipeline. Context is delivered for judgment, and judgment sometimes indicts the context; suppressing that discards free signal.
- **Symmetry over savings.** Today, which dimensions get an early look at applied fixes is an accident of activity: a still-active dimension incidentally re-reviews every sibling dimension's fixes in its whole-scope round 2+, while an inactive dimension sees nothing until the next phase's reset. Fix-scoping removes the accidental privilege by leveling down: within a phase, no dimension adjudicates another dimension's fixes, and the phase boundary uniformly restores every dimension's full view. This uniformity is the deciding rationale; the token and wall-clock savings are welcome but not load-bearing.

## Why the completion guarantee is unaffected

Post-review entry requires the current phase to have converged **and** applied no reviewable-content changes. A change-free converged phase never ran a narrowed round: its whole-scope round 1 came back clean across every applicable dimension, which is exactly the full-coverage clean pass completion has always rested on. Narrowed rounds exist only inside phases that applied fixes, and such phases can never complete the run; their deferred coverage is picked up by the next phase's whole-scope reset.

This extends a deferral the design already accepts: today a dimension that goes clean in round 1 stays inactive while sibling dimensions' later fixes mutate the code, with the phase boundary as the backstop. Fix-scoping applies the same philosophy to *what an active dimension re-reads*, not just *which dimensions re-look*.

## Costs and open points

- **Discovery latency.** A fix in file A that breaks an invariant in unseen file B is now caught a phase later instead of a round later. In some runs that means an extra phase, partially or wholly offsetting the token and wall-clock savings. The savings postulation should be sanity-checked against observed run shapes during hardening, but the feature stands on the symmetry rationale even if the net savings turn out to be zero.
- **Surrounding context sizing** is open: hunk-level context, enclosing function, or whole containing file. Whole containing file is the simplest honest boundary for code; smaller windows save more but invite context-starved false positives.
- **Sharded scopes**: how fix-scoping composes with shard cells (does a narrowed payload replace the shard slice, and what happens to a shard cell none of whose files received own-dimension fixes) is left to the spec.
- **Plan/spec artifacts**: document reviewers read one whole file and delivery is `whole-artifact`; whether narrowing applies there (e.g., focusing the reviewer on sections edited by the previous round's fixes) or the feature is code-only is left to the spec. Code is the primary target and carries most of the cost.
- **Fix attribution**: delivering own-dimension fixes requires the applied-changes ledger to record each fix's originating dimension. The current `.tmp/revise-state.md` applied-changes entries carry dimension text informally; the spec must make the attribution a first-class field.
- **Delivery-rule interaction**: `code.md`'s "always include prior-round fixes in subsequent-round patches" rule exists to prevent fresh reviewers re-flagging resolved issues from a stale patch. Narrowed rounds satisfy the rule's intent differently: the reviewer cannot see unrelated resolved issues at all, and the fixes it does see are presented in their live fixed form. The rule's prose needs restating, not repealing, since whole-scope rounds (round 1 of every phase) still rely on it.

## Status

Captured 2026-08-13 from a user idea, with the two design decisions above settled in the same dialogue. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The round and phase lifecycle in `skills/revise/SKILL.md` (existing; the delivery rules this feature narrows).
- The code delivery rules in `skills/revise/code.md` (existing; cumulative-patch generation is the whole-scope baseline the narrowed payload replaces in round 2+).
- Fix attribution by originating dimension in the applied-changes state (new; see open points).

**Requires:** [Simplify the revise lifecycle around rounds](revise-lifecycle-rounds.md).

## Hardening

- (None entered yet; this file has not been through a revise-spec review.)
