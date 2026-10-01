---
name: reviewer-peer-dispatch
description: Make the agreed reviewer-peer staffing executable, so a lead can have bounded peer assignments dispatched and their evidence returned for its integrated assessment
metadata:
  type: feature
---

# Dispatch reviewer peers and return their evidence to the lead

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded two retained needs as Present, "Use a single-agent review loop outside active Nightshift implementation" and "Agent-host-agnostic Nightshift: Review host adapters", whose agreed peer staffing independent auditors and verifiers found not executable. Drafted overnight for the user's triage.

## Agreed staffing

The v3 migration agreed, in [V3-MIGRATION.md](../../V3-MIGRATION.md):

- Under [MVP staffing](../../V3-MIGRATION.md#mvp-staffing): "A strong reviewer begins with the complete change and every dimension, recruiting peers of the same model and effort where useful."
- Under [Agreed staffing refinement](../../V3-MIGRATION.md#agreed-staffing-refinement), on 2026-09-06: "Additional review staff are peers of the strong lead reviewer: the same model and effort, in fresh contexts. They extend review capacity while the lead retains the integrated assessment."
- Under Review scale and spec discipline: "Absorb proportionate staffing into the shared review behavior, including active lifecycle work. Staffing follows the change's complexity rather than how work was invoked."
- Under [Portability umbrella and continuations](../../V3-MIGRATION.md#portability-umbrella-and-continuations), for the review host adapters: "Rebuild the legacy adapter design around v3's review and supervision roles, using capabilities each host actually exposes and honoring the agreed model and effort rules."

## Current behavior

Checked on 2026-09-29:

- The instructions promise the flow. [The operating brief](../../internal/workflow.md) says the lead decides whether peer assistance is needed and "A lead can ask the controller to dispatch peers and incorporate their assessments; the lead owns credible integrated coverage", and [the runtime reference](../../internal/runtime/REFERENCE.md#independent-assessment) says to "register peers with the same model and effort, dispatch their bounded assignments, and return the evidence to the lead for integrated assessment".
- The runtime cannot carry it out. `dispatch` accepts only `code`, `spec` and `skeptic` assessments (and `docs`, added later on 2026-09-29) with the fixed lead prompt, which tells every dispatched reviewer it is the strong lead and requires every dimension; every dispatched worker is recorded as a reviewer or skeptic with no lead link. The `worker` operation only registers a peer and checks that it clones its lead's model and effort.
- A lead cannot delegate: dispatched reviewers get only read-only tools (Read, Glob and Grep on Claude, and Codex runs without multi-agent support). A finished lead cannot be resumed to integrate peer evidence, since the runtime cannot resume a reviewer.
- A same-host peer could run as a registered in-host helper, and a fresh lead dispatch could receive peer evidence through `artifactPaths`, but no instruction describes that route, it does not return evidence to the same lead, and a peer that clones a lead on the other host has no peer-shaped launch path.
- Tests cover only peer registration.
- Carried: one reviewer as the normal start, staffing that follows complexity in policy, and the lead and skeptic adapters on both hosts with fresh contexts, attribution, validated results, coverage and ownership protections.

## Direction

Give peers a bounded, peer-shaped dispatch on either host and a route that returns their evidence to the lead, which keeps the integrated assessment.

## Settled questions

The user agreed these answers on 2026-10-01, when the entry graduated from Exploring to current work. Each question is kept with its answer, and the one that was not put to the user is marked as such.

- How a lead requests peers, since a dispatched lead is read-only and ends when it reports. Settled: through its report. The lead prompt already tells a lead whose assignment is too large for credible coverage to return `incomplete` and describe the needed peer coverage; that report is the request, and the controller dispatches bounded, peer-shaped assignments of the lead's model and effort on either host from it. The controller does not staff peers ahead of the lead's request.
- Whether evidence returns to the same lead, which needs a resumable reviewer, or to a fresh integrating lead; [Resumable reviewer and adversarial repair dialogue](resumable-reviewer-dialogue.md) tracks resuming reviewers. Settled: to the same lead, resumed, which keeps the integrated assessment as the v3 staffing agreed. This entry therefore required the resumable reviewer entry, which was delivered on 2026-10-01 in the local 3.3.0 candidate; the lead can now be resumed through `review.resume`.
- How peer receipts are attributed, validated and counted toward the lead's coverage. Settled: peer receipts are attributed and skeptic-validated like any other receipt, and peer coverage counts only through the lead's integrated assessment; peer reports alone never pass the review gate.
- Which installed-host evidence peer staffing needs on each host. Not asked at triage; left to the start of the work, as below.

## Before implementation

The change adds peer-shaped dispatch, peer worker records linked to their lead and a resumed-lead integration step to the runtime, and changes the lead and peer prompts, so it needs a concise governing spec, a plugin version increase, and a decision at the start of the work, for each host, between a budgeted installed-host check and deterministic evidence only with the model-owned behavior marked unverified. Tracking and readiness do not authorize implementation.
