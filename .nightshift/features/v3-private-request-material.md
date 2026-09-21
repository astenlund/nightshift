---
name: v3-private-request-material
description: Protect private request and review artifacts on Windows
metadata:
  type: feature
status: exploring
---

# Protect private request and review artifacts on Windows

Carry the retained request-confidentiality requirement into current request files, review copies and native evidence. Define and verify the appropriate Windows access boundary before sensitive material is written.

## Selected outcome

The original request-spool DACL proposal was conditional on retaining that transport. Current hosts use pipes, but review requests, source copies and native records are still written to disk. Reconcile that actual surface and its sensitivity rather than reintroducing the old spool or claiming inherited permissions are stronger isolation.

## Evidence and limits

`dispatchReview` writes request.json, a complete project copy and attempt evidence below `.nightshift/runs/reviews`; host transports also persist event and error output. No cross-principal access probe was performed in this reconciliation.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Decide which artifacts require restricted access, the allowed principals, creation order and interrupted cleanup. Verify the chosen permissions on Windows and state explicitly that ACLs do not isolate agents sharing the same principal.



## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Request-spool Windows DACL hardening](../reports/v3-migration-followups-20260920.md#request-spool-windows-dacl-hardening).

[The migration decision](../../V3-MIGRATION.md#preservation-and-recovery-authority) preserves the surviving requirement; earlier records: [request-spool-windows-dacl](request-spool-windows-dacl.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
