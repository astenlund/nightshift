---
name: light-revise-mode
description: Explore a lightened variant of the revise review workflows (one fresh reviewer per iteration, curated dimension set) for interactive use
metadata:
  type: feature
status: exploring
---

# Light revise mode

Codify a lightened shape of the revise review workflows for interactive sessions: one fresh reviewer per iteration instead of the full per-dimension swarm, and a curated dimension set that skips the dimensions least relevant to the artifact under review.

Prompted by the 2026-08-11 revise-spec run over `.claude/features/dependency-cycle-detection.md`, where the swarm was deliberately collapsed to a single reviewer carrying five of seven dimensions (D3 scope/decomposition and D6 reasoning-preservation skipped as least relevant for a small, non-sliced parser feature).

Observed evidence from the same 2026-08-11 handover: the lightened shape ran well in practice for BOTH artifact types. The spec review (D1/D2/D4/D5/D7, one fresh opus reviewer per iteration, fresh-skeptic verification of every finding) converged over four phases and caught two genuine false-deadlock design vectors plus a code-fidelity wording error; the plan review (D1 plan-correctness + D7 commit hygiene, cut to the two durability-relevant dimensions) caught one instruction-precision defect over two phases. Conclusion: a single fresh reviewer carrying a curated dimension set is a viable interactive proxy for the full swarm when cost constraints apply, and the dimension-curation choice is the mechanism that keeps it lossless. The mapping of reviewer convergence->SCC-not-truth held unchanged.

Open questions to settle when it graduates to a designed feature: how the dimension-curation rule is chosen (artifact-type defaults vs per-run judgment), how the wave-convergence-plus-verifier-stamp completion conjunction maps onto single-reviewer iterations (iterations map onto rounds and certifications; the mandatory opus verifier launch is a per-run cost floor a light run must absorb or explicitly re-dispose, and the empty-applicable-set failure bounds how far dimension curation can shrink the set), whether skeptic verification of every finding still holds at lower cost, and whether it rides the existing revise syntax (e.g. a `--light` flag) or is a separate entry point.
