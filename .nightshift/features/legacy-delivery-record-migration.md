---
name: legacy-delivery-record-migration
description: Convert or retire delivery records saved before 3.3.10 so the creation gate can authenticate their discharge and the project can hand over again
metadata:
  type: feature
---

# Migrate delivery records saved before 3.3.10

Raised on 2026-10-09 in run `67af3471-c7c7-4e28-ab57-88e3ba299126` while delivering [Handover as the delivery boundary](handover-only-delivery.md). Asked how 3.3.10 should treat delivery records that earlier releases saved, the user kept the creation gate fail-closed and chose a migration as the next work: "let's go with migration. that'll be the next thing after 3.3.10 is finished. as of yet, there are (probably) no other users of this plugin, so that should be safe."

## Problem

In 3.3.10 a new handover is admitted only when every surviving delivery in the project's run store has authenticated discharge. When the selected delivery itself still has unfinished work or obligations, `handover` refuses with `overlapping-run`; missing or unsupported provenance, an exceeded verification bound, or an undischarged delivery other than the selected one makes it refuse with `delivery-consistency-unavailable`. Records saved by earlier releases carry no independent accounting provenance. The deterministic case "creation accepts an authenticated completion and refuses delivery records it cannot authenticate" in `tests/runtime-creation-consistency.test.js` refuses a record stripped of its schema-2 accounting. On 2026-10-09 a read-only measurement against a copy of this repository's store found 43 such records besides the selected run, none with provenance, and authenticated none of them: of 42 replay failures attributed to individual records, 24 reported closing evidence contradicting its established discharge context and 18 exceeded the accounting recovery byte bound, after which the assessment still refused on unresolved or unavailable obligations.

A project holding earlier-release records is therefore expected to refuse every new handover under 3.3.10 until they are migrated, and the refusal names those replay failures rather than an unmigrated record. This repository is such a project, so once 3.3.10 governs handover here this work cannot itself be handed over; it runs while an earlier release is installed here, or as direct work.

## Questions before implementation

- How a migrated record establishes its earlier discharge without weakening the gate: authenticated conversion of a completed record's surviving lifecycle evidence, explicit archival that keeps the record outside the active inventory, or a user-confirmed retirement, and which of these avoids erasing unknown evidence.
- What happens to stopped or unfinished earlier-release records, whose obligations may be genuinely unresolved. Under 3.3.10 such a record cannot resume engineering as it stands: engineering actions need a current acknowledgement obligation, which an earlier-release record lacks, and setup's move of a run store from `.claude/runs` (`rebindRun` in `internal/setup.js`) raises every task's requirements revision without renewing one, so `add-spec-review` and the other engineering actions refuse with `acknowledgement-obligation-unavailable`. The runtime renews the obligation only at creation, at adoption and when a user-decision blocker is unblocked. The setup test "a migrated stopped run keeps current paths and original history but refuses engineering without a current acknowledgement" in `tests/setup.test.js` pins the refusal; its earlier form expected the migrated run to resume and failed in CI for the pushed 3.3.10 on 2026-10-09.
- How the refusal identifies unmigrated records and points to the migration, instead of reporting a replay contradiction or a byte bound.
- Whether migration runs during setup, through its own operation or on demand at refusal, and how an interrupted migration is verified and recovered.

Settle these in a concise governing spec in `.nightshift/specs`; the change ships with a version increase.
