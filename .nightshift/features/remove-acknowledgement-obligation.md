---
name: remove-acknowledgement-obligation
description: Remove the handover acknowledgement obligation
metadata:
  type: feature
---

# Remove the handover acknowledgement obligation

Created on 2026-11-10 from a step of [the assessment worklist](../reports/assessment-worklist-20261018.md), at the user's decision, so that this removal has one owner. It covers the worklist's Remove 3.

## Scope

The runtime observes the handover acknowledgement in the owning session's native history before it admits engineering. Remove that obligation under a 3.3.x version increase, ahead of [the store cut](store-v4-cut.md). No store table changes, but this is the removal of an obligation, not of two modules: it is written into run state at creation, renewed on unblock and adoption, gated on every engineering action in `cli.js`, and exposed in status and the progress markers, and three instruction files, its two suites and fixtures in other suites, plus the shared claim fixture several more suites load, depend on it. The continuation outcome stays gated independently.

The precondition that `ci.yml` run every deterministic suite was met on 2026-11-12, when [CI omits several deterministic suites](../BUGS_HISTORY.md#ci-omits-several-deterministic-suites) was fixed.

## Decisions

- 2026-11-09, the user: keep the native-history reader and drop only the acknowledgement obligation. VISION.md requires the runtime to verify the user's reply to an exception briefing independently and bind it to the exact briefing, and reading the session history is how that can work without a confirmation code. The code that locates a session's file and reads it within its size bounds stays. What reads the acknowledgement paragraph and gates on it goes. The reader today extracts assistant messages only, so reply verification is new work, owned by [Manual gate bypass on the user's responsibility](manual-gate-bypass.md).
- WORKFLOW.md's acknowledgement paragraph and the operating brief's counterpart lose the observation and change with this feature.

## Open

- Whether the acknowledgement paragraph remains as model-owned guidance in the `handover` result or goes with the check.

## Carried fixes

- The in-turn handover acknowledgement can sit where the observer misses it: Claude Code can store it as a thinking block, and `acknowledgementText` in `internal/runtime/acknowledgement.js` anchors its match at the start of the trimmed block, so `status` keeps reporting it missing. The replacement removes the gate, and nothing that survives may gate on the paragraph. Evidence: [the moved bug report](../bugs/handover-acknowledgement-as-thinking.md). 2026-11-12: the start anchor also missed a turn-ending acknowledgement that followed another paragraph in the same text block, costing one more Stop-hook continuation cycle than an acknowledgement opening the message would have, of the two extra cycles the whole recovery took (disco-elysium-companion delivery `f6fa1942-23b6-4bb5-bc47-ca2b9a5ff0a4` on 3.3.34, maintainer inbox report `2026-11-12-turn-ending-ack-not-at-block-start-f6fa1942.md`).
