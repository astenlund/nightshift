---
name: v3-host-relaunch
description: Relaunch unfinished work after host exit or restart
metadata:
  type: feature
status: exploring
---

# Relaunch unfinished work after host exit or restart

Restore unattended execution after a host exits or Windows restarts, beyond the currently supported user-driven reopen and reconciliation. Coordinate with Night Guard checkpointing without assuming it already restarts execution.

## Selected outcome

Automatic relaunch was deliberately deferred; a host exit can currently end an unattended night. Resume only authorized unfinished work after reconciling real files, ownership and surviving processes.

## Evidence and limits

The MVP and acceptance report explicitly exclude automatic host relaunch. Night Guard explores persistent checkpoints and shutdown coordination but leaves relaunch as a separate decision.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Settle the activation mechanism, user opt-in, credentials, restart bounds and stop/limit semantics. Verify crash, orderly exit, reboot and failed recovery without treating every exit as permission to restart.

Link with [Night Guard](night-guard.md), preserving the distinction between checkpointing and automatic relaunch. Active controller transfer and independent same-checkout runs were declined during this triage.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Relaunch unfinished work after host exit or restart](../reports/v3-migration-followups-20260920.md#relaunch-unfinished-work-after-host-exit-or-restart).

[The migration decision](../../V3-MIGRATION.md#resumption-after-host-exit-or-windows-restart) preserves the surviving requirement; earlier records: [night-guard](night-guard.md), [v3-continuations](v3-continuations.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
