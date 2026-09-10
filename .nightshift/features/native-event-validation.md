---
name: native-event-validation
description: Explore consistent validation of malformed native model events across attribution and evidence consumers
metadata:
  type: feature
status: exploring
---

# Native event validation

Tracked for after the v3 MVP by user decision on 2026-09-10. Explore consistent handling of native assistant messages that omit required model metadata, alongside other malformed evidence. This strengthens defensive validation beyond the accepted MVP attribution contract; the recorded examples did not demonstrate an incorrectly attributed participant or model substitution.

## Evidence and direction

Some Claude attribution filters skip assistant events without `message.model` when other events identify the expected model. The source locations include `internal/runtime/hosts.js`, `internal/runtime/review.js` and the temporary acceptance helpers. A private probe confirmed that a turn with an omitted model field can retain a favorable attribution result. Independent skeptical validation classified this as optional hardening: valid model/session evidence still existed, and the accepted contract did not require separate model proof on every assistant record.

Define which native event shapes require model identity, distinguish assistant content from legitimate synthetic or non-content events, and apply consistent validation across live controllers, participant reconciliation and receipt import. Verify current host event contracts before choosing the policy. Missing or unusable evidence must remain explicit, while legitimate event variations need a reliable path that avoids unnecessary stalls. Keep existing required-model, independence and contradictory-evidence rules intact.

Autonomy remains first, quality second, and speed and economy third. Use focused controls to verify valid, missing, malformed and contradictory evidence and their recovery outcomes. Preserve historical evidence and qualifications; tracking this exploration does not authorize runtime changes or replay of completed acceptance cases.

Evidence: `.tmp/codex-attribution-and-observer-skeptic-ba8f5361-41ab-49cb-b671-885363b3003c/report.md`, including its attribution and observer assessments. The [acceptance report](../reports/v3-acceptance-272m-20260910.md) records the completed MVP scope and follow-up decisions.
