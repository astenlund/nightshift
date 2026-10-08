---
name: revise-spec
description: "Use for explicit revise-spec or revise spec intent, or required spec revision inside an authorized Nightshift lifecycle. Plain review and review-loop requests do not activate this skill."
---

# Revise spec

Use [automatic preparation and resource binding](../../internal/releases/REFERENCE.md#skill-activation) before this skill. Claude native session marker: `${CLAUDE_SESSION_ID}`.

Use [the shared operating brief](../../internal/workflow.md) and [runtime review operations](../../internal/runtime/REFERENCE.md#independent-assessment). Give a fresh strong lead the complete current spec, user commitments, relevant project context and all four spec dimensions. Assess meaningful commitments, soundness, failure/recovery and proportionality. Do not demand an unchosen implementation in prose or pseudocode.

Within accepted delivery, use its governing-spec task. Otherwise use `open-review` with kind `spec`, a preserved UUID `reviewContextId`, actual controller identity, authority, objective and agreement naming the spec. Subsequent operations name that context, its current revision, actor and target `#review`. Preserve native ownership, resources, exact snapshots and repair obligations; no delivery run, continuation or session closing is created. A standalone result lists pending follow-ups directly. An assessment before implementation agreement uses this context without premature delivery creation, and its actual independent evidence can later supply the agreed delivery's governing-spec assessment.

Create a new standalone Nightshift-owned governing spec in `.nightshift/specs`. Preserve an existing or user-selected governing document's location; reviewing it does not make it a Nightshift-owned file to relocate.

When developing a substantial feature, start the assessment through the host's background-process facility and preserve its handle. Present the same complete stable draft for the user's review as soon as dispatch has started, before waiting for results or processing findings. Keep the draft available while assessment runs; announcing that review has started does not present the draft. If nonblocking dispatch is unavailable, disclose the sequencing limitation and obtain both reviews without claiming overlap. Implementation waits for agreed commitments and resolved assessment. Record the user's acceptance with the runtime `spec-accepted` operation rather than in the spec, which states its commitments only, as the brief describes. Compatible corrections preserve agreement; material commitment changes require the user.

Every finding needs fresh skeptical validation against evidence, with the skeptic's repair proposal, and a separate value/authority decision. Apply authorized corrections and, after each repair batch, resume the reviewer that raised them for whole-spec reassessment and their closure; the spec passes only on a fresh lead's whole-spec assessment, as the brief describes. A spec cannot pass on weak, narrow, failed, stale or partial coverage. Preserve unresolved decisions, and continue independent work while the user is unavailable.
