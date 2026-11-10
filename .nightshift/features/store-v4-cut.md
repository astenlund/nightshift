---
name: store-v4-cut
description: Cut store v4 and reduce the release system
metadata:
  type: feature
---

# Cut store v4 and reduce the release system

Created on 2026-11-10 from a step of [the assessment worklist](../reports/assessment-worklist-20261018.md), at the user's decision, so that the cut has one owner. It covers the worklist's Remove 1, 2 and 4 and Add 12.

## Scope

One breaking release: a new store version that refuses older ones; legacy migration and the provenance tables deleted; the release system reduced to the bundle copy, bootstrap, locator, registration and lookup in the same cut, since the run state carries the registry's identifiers. Keep the runtime-derived reminder cap and, for now, the PowerShell process inspection. Running runs complete before the upgrade, the run that delivers v4 runs on 3.3.x, and the first v4 run starts fresh.

The cut keeps what the conditions work on the current store built, and adds the open run from [Keep a handed-over run open for triage after delivery](handover-open-for-triage.md): reopening after triage, a live defect returning as a repair, a spec amended under a recorded decision, and a settled run reopened by a later decision of the user until a later run supersedes it. It also adds the three condition classes in its gate design and the recorded-decision operation. Its derived reminder cap writes no revision, which closes the Stop hook race recorded under the worklist's Remove 1.

A release that adds a dependency on a slated module records here what the cut must keep.

## Decisions

- 2026-11-09, the user: `close`, `close-manifest` and `compact-history`, which today enter through `migration-cli.js` and `legacy-migration.js`, move to a small administrative entry that survives the cut, with the constants and table definitions they share with the legacy modules relocated. `store.js` imports its table definition from the same place.
- 2026-11-09, the user: a run settled in a store older than v4 does not reopen across the cut, and a defect found in its work goes to a new run.

## Open

- The v4 store design, including whether `compact-history` is still needed; if it is not, it goes too.

## Carried fixes

- A hook generation change strands a running run's session: a new generation in the locator leaves a session that observed the old one refused with "This session has not observed the registered hook generation", under `internal/releases`, even from an automatic preparation. The replacement drops generations and activations, so a running session keeps working across a plugin update or setup. Evidence: [the moved bug report](../bugs/hook-generation-strands-running-session.md).
