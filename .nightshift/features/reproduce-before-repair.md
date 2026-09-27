---
name: reproduce-before-repair
description: For defect work, record a check that fails before the repair and passes after it under the same name
metadata:
  type: feature
status: exploring
---

# Reproduce a bug with a failing check before repairing it

## Origin

From the user-supplied ideas document "Workflow ideas adopted from other agent tools" (raised 2026-09-26; its comparison with other tools comes from general knowledge, not a systematic survey). Tracked as Exploring at the triage of run `f87356d8-8613-45a8-93e5-d79c48f2254b` on 2026-09-27.

## Observation

[The operating brief](../../internal/workflow.md) requires relevant, meaningful checks, but it does not require evidence that a bug fix addresses a reproduced failure. Superpowers' test-driven discipline and SWE-agent's reproduction step both make that evidence explicit.

## Proposal

For defect work, record a runtime `check` that fails before the repair and passes afterwards under the same check name. The runtime already records exit codes and input hashes, and a later invocation of a named check supersedes the earlier one, so the before/after pair fits the existing evidence model. It strengthens quality at low cost and extends evidence over assurance to the fix itself.

## Open questions

- Whether the pair is enforced by the runtime or remains guidance for the controller and reviewers.
- How a task is marked as defect work.
- What counts as an acceptable exemption when no automated reproduction is practical, such as host-only or timing-dependent behavior, and how that exemption is recorded. Settle this together with [Verify faked boundaries live](live-boundary-verification.md): its proposed live-evidence rule covers changes at boundaries the tests fake, and whether it widens to other conditions the tests do not reproduce is still open there, so neither feature yet covers every case without an automated reproduction.
