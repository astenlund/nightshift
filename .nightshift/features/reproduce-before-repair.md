---
name: reproduce-before-repair
description: For defect work, record a check that fails before the repair and passes after it under the same name
metadata:
  type: feature
---

# Reproduce a bug with a failing check before repairing it

## Origin

From the user-supplied ideas document "Workflow ideas adopted from other agent tools" (raised 2026-09-26; its comparison with other tools comes from general knowledge, not a systematic survey). Tracked as Exploring at the triage of run `f87356d8-8613-45a8-93e5-d79c48f2254b` on 2026-09-27.

## Observation

[The operating brief](../../internal/workflow.md) requires relevant, meaningful checks, but it does not require evidence that a bug fix addresses a reproduced failure. Superpowers' test-driven discipline and SWE-agent's reproduction step both make that evidence explicit.

## Proposal

For defect work, record a runtime `check` that fails before the repair and passes afterwards under the same check name. The runtime already records exit codes and input hashes, and a later invocation of a named check supersedes the earlier one, so the before/after pair fits the existing evidence model. It strengthens quality at low cost and extends evidence over assurance to the fix itself.

## Settled questions

The user agreed these answers on 2026-09-28, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- Whether the pair is enforced by the runtime or remains guidance for the controller and reviewers. Settled as guidance: [the operating brief](../../internal/workflow.md) is to ask the controller, for defect work, to run the reproducing check before the repair, confirm that it fails for the defect's reason rather than an unrelated one, and rerun it under the same name after the repair, and its Tests and evidence code dimension is to ask whether a fix carries that pair; neither says so yet. The runtime stays unchanged: a task keeps every check invocation, and acceptance reads the latest invocation of each name (`internal/runtime/lifecycle.js`), so a failing run before the repair stays on record and blocks acceptance until the rerun passes. Runtime enforcement is an explicit anti-goal, since the runtime cannot tell a genuine reproduction from an unrelated failure and would verify only the form.
- How a task is marked as defect work. Settled as the agreed scope: a BUGS.md entry, or any agreed fix of observed misbehavior. The existing task kinds stay unchanged and no marker is added.
- What counts as an acceptable exemption when no automated reproduction is practical, such as host-only or timing-dependent behavior, and how that exemption is recorded. Settled: when no practical automated reproduction exists, such as host-only, timing-dependent or external-service behavior, the controller is to record why and what evidence stands in, and the completion report is to state the missing reproduction as a verification limit. This matches the stated-limit form of [Verify faked boundaries live](live-boundary-verification.md), so the two features compose without either requiring the other; if that feature widens its live-evidence trigger to conditions the tests do not reproduce, keep the two consistent.

## Before implementation

The change is shipped instruction text that alters model-owned behavior, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check and deterministic evidence only with the model-owned behavior marked unverified. Tracking and readiness do not authorize implementation.
