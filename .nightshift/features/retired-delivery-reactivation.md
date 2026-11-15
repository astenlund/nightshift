---
name: retired-delivery-reactivation
description: Explore an explicit recovery path for retired legacy delivery work while retaining its retirement history and obligations
metadata:
  type: feature
---

# Reactivate retired delivery records

Retired on 2026-11-15 without shipping, as [its history entry](../FEATURES_HISTORY.md) records: the user's decision of 2026-11-09 in [Cut store v4 and reduce the release system](store-v4-cut.md#decisions), that a run settled in a store older than v4 does not reopen across the cut, settles the question the other way. The text below is the draft as it stood, kept as a historical design record.

## Origin

Raised during the 2026-10-15 legacy delivery migration design as a separate future question: retirement preserves a saved run but makes its current state read-only.

## Problem

The [legacy delivery migration](legacy-delivery-record-migration.md) keeps retired runs and their evidence but makes their current state read-only. If a user later needs to continue work from one, the 3.3.11 runtime refuses mutation, adoption and resume. Creating a new delivery may cover new work, but it does not restore the old run's task identity or outstanding obligations.

## Open design

Settle whether reactivation is needed, what exact user decision authorizes it, how old certificates remain auditable, whether the same run ID can ever become writable again, and how controller ownership, independent accounting, unfinished checks, reports and follow-ups would be reconciled. Define interruption recovery and interaction with the creation gate before graduation. No reactivation is part of the legacy retirement feature.
