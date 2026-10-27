---
name: vibe-controller-host
description: Support Mistral Vibe as a Nightshift controller host
metadata:
  type: feature
status: exploring
---

# Support Mistral Vibe as a controller host

The user approved GLM in the Vibe host context for the controller role on 2026-10-26, recorded in [the approval report](../reports/glm-controller-role-approval-20261026.md); that approval is settled and must not be asked for again. The integration is separate and not built: the Vibe reviewer host delivery excluded Vibe as a controller, and `internal/runtime/ownership.js` admits only Claude and Codex controllers today. Tracked in [the feature index](../FEATURES.md#support-mistral-vibe-as-a-controller-host). The original capture is follow-up `vibe-controller-host-support` in run `dcd9e840-e8b6-4f28-9c6e-b5aaaaac9847`.

## Requested direction

- Let a Vibe session own a Nightshift delivery as controller with the same durability, ownership and reconciliation guarantees as a Claude or Codex controller.
- Preserve the recorded GLM controller approval and the per-role approval direction; formal controller approval criteria remain open.

## Details to settle

Design the controller-host integration: ownership admission and actor identity for a Vibe session, execution resources and the operation lease, native identity and continuation equivalents for a host with no persistent goal or Stop hook, admission of a Vibe controller's own sessions to independent review, and the formal controller approval criteria the user left open. A Vibe controller also changes how a controller-authored receipt is judged, since the runtime's independence rules key on controller sessions. Tracking does not authorize implementation and does not claim any of these capabilities exist.
