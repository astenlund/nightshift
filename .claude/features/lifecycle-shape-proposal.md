---
status: exploring
---

# Lifecycle shape proposal

Feature: after the user accepts the decision-complete digest, the controller proposes the lifecycle shape the work warrants and the user accepts or tweaks it before any work begins. A complex feature gets the full ladder (harden spec, write plan, harden plan, implement, revise-code, verify, docs, lore); a trivial bug or quick win can jump straight to implement then revise-code. The accepted shape becomes the handover queue, so every step the user agreed to still runs and nothing the user struck is run by default.

Captured 2026-08-23 while a quick-win handover ran the full ladder (a seven-cell revise-spec run with skeptics) over a twelve-line backlog bullet.

## Open questions

- Which signals drive the default proposal (rigor tier from the Operating context, artifact kind, entry size, dependency depth), and who records the judgment boundary.
- How the proposal relates to the agreement gate: part of the digest exchange, or a second confirm line after agreement.
- Whether a struck step still leaves a deferred morning-report item, and how the completion stamp records a shortened shape.
