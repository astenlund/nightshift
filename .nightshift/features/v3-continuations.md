---
name: v3-continuations
description: Historical umbrella and final dispositions of capabilities outside the first v3 release
metadata:
  type: feature
status: historical
---

# V3 continuations

This was the umbrella for capabilities deliberately outside [the v3 MVP](nightshift-v3.md). The 2026-09-20 to 2026-09-21 [individual triage](../reports/v3-migration-followups-20260920.md) resolved its tracking destinations; it is no longer a separate Exploring work item. Original scope exclusions remain historical facts, not claims of implementation.

| Capability | Current user disposition |
|---|---|
| Verify macOS and Linux | Skipped. No additional-platform feature is planned by this triage; those platforms remain unverified. |
| Transfer active control between hosts | Skipped. The user identified post-switch adoption as the actual use case, retained in [the ownership bug](../BUGS_HISTORY.md#run-ownership-is-locked-to-the-creating-host-session). |
| Multiple independent runs in one checkout | Skipped. The supported single coordinated run and its helpers remain unchanged. |
| Relaunch after host exit or restart | Tracked in [automatic host relaunch](v3-host-relaunch.md), linked to [Night Guard](night-guard.md). |
| Broader guidance conversion and structural repair | Tracked in [scoped setup repair](v3-setup-compatibility.md), with [canonical instruction routing](v3-guidance-routing.md) and concrete setup bugs separately visible. |

Streaming findings, command enforcement, structured model teams and interactive pairing keep their existing Exploring entries. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) maps every original work unit to current evidence or its selected destination. [The reconciliation](../reports/v3-capability-reconciliation-20260920.md) and [shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) preserve scope and evidence limits.
