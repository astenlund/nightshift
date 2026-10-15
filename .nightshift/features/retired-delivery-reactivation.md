---
name: retired-delivery-reactivation
description: Explore an explicit recovery path for retired legacy delivery work while retaining its retirement history and obligations
metadata:
  type: feature
status: exploring
---

# Reactivate retired delivery records

## Origin

Raised during the 2026-10-15 legacy delivery migration design as a separate future question: retirement preserves a saved run but makes its current state read-only.

## Problem

The [legacy delivery migration](legacy-delivery-record-migration.md) keeps retired runs and their evidence but makes their current state read-only. If a user later needs to continue work from one, the local 3.3.11 candidate runtime refuses mutation, adoption and resume. Creating a new delivery may cover new work, but it does not restore the old run's task identity or outstanding obligations.

## Open design

Settle whether reactivation is needed, what exact user decision authorizes it, how old certificates remain auditable, whether the same run ID can ever become writable again, and how controller ownership, acknowledgement, independent accounting, unfinished checks, reports and follow-ups would be reconciled. Define interruption recovery and interaction with the creation gate before graduation. No reactivation is part of the legacy retirement feature.
