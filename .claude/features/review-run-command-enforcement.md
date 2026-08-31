---
name: review-run-command-enforcement
description: Explore mechanical blocking of prohibited commands during active review rounds
metadata:
  type: feature
status: exploring
---

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
