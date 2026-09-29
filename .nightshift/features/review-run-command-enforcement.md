---
name: review-run-command-enforcement
description: Explore mechanical blocking of prohibited commands during active review rounds
metadata:
  type: feature
status: exploring
---

> Deferred beyond the v3 MVP. The agreed boundary is under [Command enforcement](../../V3-MIGRATION.md#command-enforcement) in V3-MIGRATION.md, and the current accounting is in [MIGRATION_STATUS.md](../MIGRATION_STATUS.md). The original sketch below is design context; a v3 implementation still needs a scoped agreement and independent assessment.

# Review-run command enforcement

Draft exploring mechanical enforcement that blocks prohibited controller-suite entry points during active review rounds without interfering with legitimate local or post-convergence runs. Authoritative run state, false-positive policy, and recovery behavior remain open design boundaries.

## Problem boundary

A review skeptic invoked the prohibited init-backlog controller-suite entry point with a name filter during an active round despite explicit controller instructions and dispatch guidance. This draft evaluates a mechanical boundary rather than another wording-only reminder.

## Settled exploration boundary

- Enforcement targets prohibited controller-suite entry points only while the relevant review round is active.
- Legitimate local development, focused checks that are not prohibited entry points, and post-convergence verification must remain available.
- A failed or unavailable enforcement probe cannot be interpreted as permission to run a prohibited command.

## Open design questions

- Choose the authoritative run-state source and define creation, refresh, invalidation, resume, and stale-state behavior.
- Define where enforcement intercepts direct commands, filters, aliases, wrappers, and alternate shell forms without relying on brittle text matching.
- Define the false-positive policy, diagnostic evidence, and behavior when run-state classification or enforcement infrastructure fails.
- Define an auditable recovery or override path that cannot silently weaken the active review boundary.

## Re-scoping found by the migration accounting audit

The audit of 2026-09-29 found this sketch still written for the v2 controller-suite entry points, which no longer exist. The agreed v3 disposition asks a different question: "Determine which restrictions v3 needs and where host controls or owned command entry points can enforce them. Preserve legitimate focused checks and avoid a general shell-interception framework. Until enforcement exists, restrictions still apply without a claim of mechanical enforcement. Missing or failed enforcement does not grant permission; do not advertise a protected mode without its required control." The open question above about intercepting aliases, wrappers and alternate shell forms leans toward the general interception the disposition rules out. Dispatched reviewers and skeptics already run under read-only host controls: Claude with only the Read, Glob and Grep tools, and Codex in a read-only sandbox that never asks for approval. The rule that failed enforcement grants no permission is so far only in this record.
