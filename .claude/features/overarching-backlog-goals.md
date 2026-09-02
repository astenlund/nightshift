---
name: overarching-backlog-goals
description: Explore durable project goals that inform ready recommendations without becoming hidden workflow authority
metadata:
  type: feature
status: exploring
---

# Overarching backlog goals

Add an `## Overarching goals` section to the feature backlog so the project can retain what it is trying to achieve while individual entries, dependencies, and maturity change. Goals may be absolute invariants, directional improvements relative to current maturity, or a north-star vision that guides choices without pretending to be an immediately reachable acceptance criterion.

`/nightshift:ready` should use the current goals when arguing its recommendations, explaining which goal a candidate advances and any meaningful tension between near-term work and the longer direction. Goals are recommendation context only: they do not create hidden `Requires:` edges, change parser readiness, authorize work, replace same-session spec agreement, or silently reject a user-selected task.

The design must define the section grammar, goal identity and ordering, how directional goals may be revised as the project matures, whether superseded goals retain history, how absolute versus mutable language is distinguished, and what `/ready` does when the section is absent, malformed, internally conflicting, or irrelevant to the ready set. It must also keep recommendation reasoning bounded so a long vision document does not overwhelm the concrete dependency report.

Captured 2026-09-02 during the implementation-scratch-isolation handover.
