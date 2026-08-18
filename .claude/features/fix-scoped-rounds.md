# Fix-scoped follow-up rounds

Feature: within a wave-lifecycle review run, a round 2+ reviewer whose dimension had fixes applied at the previous round boundary receives a payload containing only those own-dimension fixes plus surrounding context, instead of the whole cumulative review patch; a dimension active without applied fixes keeps its normal delivery. The reactivation wave restores whole-scope delivery, preserving full coverage over the fixed artifact. Primary rationale: this reduces a within-run asymmetry in who gets to weigh in on fixes; reduced token spend and wall-clock time are a hoped-for secondary benefit, and the narrower model is preferred even if the savings do not materialize. This file is the authoritative design record.

## What it does

Today every round delivers each active dimension's reviewer its full normal payload: the whole-scope cumulative patch and in-scope live file set, or the shard's pathspec-cut slice when the scope is sharded. A dimension stays active into round 2+ after every finding-bearing review. Its previous findings may have produced own-dimension fixes, an authoritative deferred follow-up without an artifact edit, or only refuted or acknowledgement-only dispositions. Only a later explicit clean LGTM certifies the dimension.

This feature narrows the payload only when a round 2+ reviewer had own-dimension fixes applied at the previous round boundary: it receives only those fixes plus surrounding context, because its open question is "are the fixes sound, and did they leave the dimension clean?". A dimension active with zero own-dimension applied fixes keeps its normal whole-scope or shard-slice delivery, whether the prior round produced deferred, refuted, or acknowledgement-only findings, because its open question is still the artifact's cleanliness, not any fix's soundness. A cell's first review of any fingerprint remains whole-scope, unchanged.

## Design decisions (settled with the user, 2026-08-13)

- **Own-dimension fixes only.** Dimension X's round 2+ reviewer sees only the fixes traced to X's own adjudicated findings, not every fix applied at the previous round boundary. This is the narrowest payload; cross-dimension damage from a fix (a Correctness fix opening a Security hole) waits for the reactivation wave's whole-scope pass.
- **Context findings are flagged normally.** When a narrowed reviewer notices a problem in the surrounding context rather than in a fix itself, the finding enters the normal skeptic/adjudication pipeline. Context is delivered for judgment, and judgment sometimes indicts the context; suppressing that discards free signal.
- **Symmetry over savings.** Today, which dimensions get an early look at applied fixes is an accident of activity: a still-active dimension incidentally re-reviews every sibling dimension's fixes in its whole-scope round 2+, while an inactive dimension sees nothing until the reactivation wave. Fix-scoping reduces the accidental privilege by leveling down: a dimension re-reviewing its own fixes no longer sees sibling fixes, and the wave uniformly restores every dimension's full view. The residual exception is a dimension active with zero own-dimension fixes, which keeps normal delivery and hence incidental sight of sibling fixes in its cumulative patch; the asymmetry is reduced, not eliminated. This improved uniformity is the deciding rationale; the token and wall-clock savings are welcome but not load-bearing.

## Why the completion guarantee is unaffected

Under the wave-convergence lifecycle (`wave-lifecycle.md`), this feature operates under a hard constraint that lifecycle imposes: **a narrowed-payload review never certifies a fingerprint**. A narrowed round reviews at the post-fix fingerprint while seeing only the fixes, so an LGTM there must not mark the cell current; certification requires a full-payload review. Narrowed rounds therefore validate fixes and keep the cell active, and the cell's next full-payload review (typically via the reactivation wave, which restores whole-scope delivery) is what certifies. Completion still requires every applicable cell to certify the final fingerprint plus the verifier stamp, and every certification rests on a full-payload look, so narrowing never weakens what completion attests.

This extends a deferral the design already accepts: today a dimension that goes clean in round 1 stays inactive while sibling dimensions' later fixes mutate the code, with the staleness sweep and verifier gate as the backstop. Fix-scoping applies the same philosophy to *what an active dimension re-reads*, not just *which dimensions re-look*.

## Costs and open points

- **Discovery latency.** A fix in file A that breaks an invariant in unseen file B is now caught a wave later instead of a round later. In some runs that means extra rounds, partially or wholly offsetting the token and wall-clock savings. The savings postulation should be sanity-checked against observed run shapes during hardening, but the feature stands on the symmetry rationale even if the net savings turn out to be zero.
- **Surrounding context sizing** is open: hunk-level context, enclosing function, or whole containing file. Whole containing file is the simplest honest boundary for code; smaller windows save more but invite context-starved false positives.
- **Sharded scopes**: how fix-scoping composes with shard cells (does a narrowed payload replace the shard slice, and what happens to a shard cell none of whose files received own-dimension fixes) is left to the spec.
- **Plan/spec artifacts**: document reviewers read one whole file and delivery is `whole-artifact`; whether narrowing applies there (e.g., focusing the reviewer on sections edited by the previous round's fixes) or the feature is code-only is left to the spec. Code is the primary target and carries most of the cost.
- **Fix attribution**: delivering own-dimension fixes requires the applied-changes ledger to record each fix's originating dimension. The current `.tmp/revise-state.md` applied-changes entries carry dimension text informally; the spec must make the attribution a first-class field.
- **Delivery-rule interaction**: `code.md`'s "always include prior-round fixes in subsequent-round patches" rule exists to prevent fresh reviewers re-flagging resolved issues from a stale patch. Narrowed rounds satisfy the rule's intent differently: the reviewer cannot see unrelated resolved issues at all, and the fixes it does see are presented in their live fixed form. The rule's prose needs restating, not repealing, since whole-scope deliveries (a cell's first review of any fingerprint, and round 2+ deliveries to zero-fix active dimensions) still rely on it.

## Status

Captured 2026-08-13 from a user idea, with the design decisions above settled in the same dialogue. The zero-fix active-dimension branch keeps normal delivery for every active cell without an own-dimension fix, including cells carried forward by deferred, refuted, or acknowledgement-only findings. Reconciled on 2026-08-18 after clean-LGTM certification shipped. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The wave-convergence lifecycle in `internal/revise/SKILL.md` (existing; the delivery rules this feature narrows).
- The code delivery rules in `internal/revise/code.md` (existing; cumulative-patch generation is the whole-scope baseline the narrowed payload replaces in round 2+).
- Fix attribution by originating dimension in the applied-changes state (new; see open points).

**Requires:** [Agent-host-agnostic Nightshift: MVP - Universal skill entry points](agent-host-agnostic-nightshift.md) (FEATURES.md index entry).

## Hardening

- (None entered yet; this file has not been through a revise-spec review.)
