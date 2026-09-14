---
name: revise-spec
description: "Use for explicit revise-spec or revise spec intent, or required spec revision inside an authorized Nightshift lifecycle. Plain review and review-loop requests do not activate this skill."
---

# Revise spec

Follow [shared resource binding](../../internal/releases/REFERENCE.md#skill-activation) before this skill. Claude native session marker: `${CLAUDE_SESSION_ID}`.

Use [the shared operating brief](../../internal/workflow.md) and [runtime review operations](../../internal/runtime/REFERENCE.md#independent-assessment). Give a fresh strong lead the complete current spec, user commitments, relevant project context and all four spec dimensions. Assess meaningful commitments, soundness, failure/recovery and proportionality. Do not demand an unchosen implementation in prose or pseudocode.

Create a new standalone Nightshift-owned governing spec in `.nightshift/specs`. Preserve an existing or user-selected governing document's location; reviewing it does not make it a Nightshift-owned file to relocate.

When developing a substantial feature, start the assessment through the host's background-process facility and preserve its handle. Present the same complete stable draft for the user's review as soon as dispatch has started, before waiting for results or processing findings. Keep the draft available while assessment runs; announcing that review has started does not present the draft. If nonblocking dispatch is unavailable, disclose the sequencing limitation and obtain both reviews without claiming overlap. Implementation waits for agreed commitments and resolved assessment. Compatible corrections preserve agreement; material commitment changes require the user.

Every finding needs fresh skeptical validation against evidence and a separate value/authority decision. Apply authorized corrections and return the whole spec for cumulative assessment after each repair batch. A spec cannot pass on weak, narrow, failed, stale or partial coverage. Preserve unresolved decisions, and continue independent work while the user is unavailable.
