---
name: controller-owned-session-experiment-ledger
description: Explore a durable controller-owned ledger for material session experiment evidence and morning-report disposition
metadata:
  type: feature
status: exploring
---

# Controller-owned session experiment ledger

Draft exploring a controller-owned, run-scoped experiment ledger that persists only material decisions and evidence at revise-round adjudication and other evidence-producing boundaries, then feeds complete morning-report disposition. `.tmp/handover-report-notes.md` remains the low-noise run-local implementation until the lifecycle is agreed and hardened.

## Settled exploration boundary

- The record is controller-owned and scoped to one lifecycle run rather than generated revise state or an agent transcript.
- Persistence is evaluated at revise-round adjudication and at other boundaries that produce evidence about an experiment, including repair decisions, fix-wave completion, convergence, verification, classifier recovery, and tool-surface failure.
- Only material conclusions and deciding evidence belong in the ledger. Dialogue transcripts and routine progress do not.
- The morning report disposes every retained experiment toward workflow machinery, instructions, backlog work, continued experimentation, or rejection.

## Open design questions

- Choose the canonical home and define creation, stable run identity, refresh, invalidation, and every reader's behavior when the record is absent, stale, or malformed.
- Define atomic append or replacement and deterministic resume behavior after every partially persisted transition.
- Define compaction without losing evidence needed for the morning report or creating a noisy second run log.
- Decide whether a fully dispositioned ledger is archived or deleted, when that transition occurs, and what durable provenance remains afterward.
