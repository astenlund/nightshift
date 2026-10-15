---
name: legacy-delivery-record-migration
description: Retire earlier delivery records by explicit approval while preserving their evidence, so the creation gate can distinguish retirement from authenticated discharge
metadata:
  type: feature
---

# Migrate delivery records without schema-2 accounting

Raised on 2026-10-09 in run `67af3471-c7c7-4e28-ab57-88e3ba299126` while delivering [Handover as the delivery boundary](handover-only-delivery.md). Asked how 3.3.10 should treat delivery records that earlier releases saved, the user kept the creation gate fail-closed and chose a migration as the next work: "let's go with migration. that'll be the next thing after 3.3.10 is finished. as of yet, there are (probably) no other users of this plugin, so that should be safe."

## Problem

In 3.3.10 a new handover is admitted only when every surviving delivery in the project's run store has authenticated discharge. When the selected delivery itself still has unfinished work or obligations, `handover` refuses with `overlapping-run`; missing or unsupported provenance, an exceeded verification bound, or an undischarged delivery other than the selected one makes it refuse with `delivery-consistency-unavailable`. Records saved by earlier releases carry no independent accounting provenance. The deterministic case "creation accepts an authenticated completion and refuses delivery records it cannot authenticate" in `tests/runtime-creation-consistency.test.js` refuses a record stripped of its schema-2 accounting. On 2026-10-09 a read-only measurement against a copy of this repository's store found 43 such records besides the selected run, none with provenance, and authenticated none of them: of 42 replay failures attributed to individual records, 24 reported closing evidence contradicting its established discharge context and 18 exceeded the accounting recovery byte bound, after which the assessment still refused on unresolved or unavailable obligations.

The installed 3.3.10 creation gate refused new handovers on the unauthenticated records it saw, reporting replay failures rather than identifying all unmigrated records. Retained older sessions still use their own creation rules: this repository's selected record was created on 2026-10-14 UTC under a 3.3.8 binding and has no schema-2 accounting. This 3.3.11 migration feature proceeded as direct work after its attempted handover was refused. Eligibility therefore follows saved accounting and provenance, not the date a record was written.

A setup-migrated stopped run cannot simply resume engineering under 3.3.10. `rebindRun` in `internal/setup.js` raises each task's requirements revision without renewing its acknowledgement obligation, so `add-spec-review` and other engineering actions refuse with `acknowledgement-obligation-unavailable`. The setup test "a migrated stopped run keeps current paths and original history but refuses engineering without a current acknowledgement" records that boundary; retirement requires the separate unfinished-work decision in the governing spec.

## Agreed design

The [governing spec](../specs/legacy-delivery-record-migration.md) defines a reusable current-release administrative migration entry. It inventories historical records without changing them, presents an exact bounded manifest and requires explicit approval of every retirement, owed report and pending follow-up. The runtime saves immutable retirement certificates and protects retired records from later writes. It does not infer that a completed or stopped status proves discharge. New handover identifies unmigrated records and directs the controller to migration inventory. A stopped record requires an individual decision about its unfinished work. The existing handover skill advertises direct legacy delivery-record migration and routes that request to the current administrative entry without accepting handover or creating a delivery run; backlog-index migration stays with init-backlog.

The 2026-10-15 read-only inventory found 45 records without independent accounting in this repository's store: 43 complete and two stopped. One complete record had an unconfirmed saved report, and two complete records held four pending follow-ups. The user chose a policy of retiring completed records and deciding the stopped records separately, then authorized building the reusable feature and applying it here after assessment. That preliminary policy did not approve an exact manifest or any report, follow-up or stopped-work disposition; the later exact approvals are recorded in the [application report](../reports/legacy-delivery-migration-20261015.md).

## Release and local application

The reusable runtime shipped in 3.3.11. On 2026-10-15 its installed Codex administrative route retired all 45 legacy deliveries in this repository under five exact user-approved manifests. The final three-page inventory found 45 valid retirements, zero unretired records and zero unavailable retirements, with both tracked follow-up destinations current. Original state and latest-history hashes remained unchanged, as did the selected run. The [application report](../reports/legacy-delivery-migration-20261015.md) records the decisions and evidence.

The installed Codex preparation, inventory, `raw-inspect` report preview, manifest and retirement paths were exercised for this repository. The handover skill's plain-language migration route, a new handover after retirement and its older-session refusal, and certificate supersession remain unprobed here (live-claim: provisional); other installed behavior not listed is unverified by this record. The user reports a separate successful Claude Code migration; its native evidence was not inspected here. The [application report](../reports/legacy-delivery-migration-20261015.md) records the evidence scope.
