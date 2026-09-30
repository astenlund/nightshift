---
name: ready-project-direction
description: Have Ready use the project's durable direction, where the project names or states it, to explain its recommendations and their tradeoffs, as the v3 migration agreed
metadata:
  type: feature
---

# Ground Ready recommendations in the project's direction

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded "Overarching backlog goals" as Policy present, saying that Ready uses project goals and that a recommendation-omission bug owns the remaining repair; independent auditors and verifiers found both statements stale and the direction part missing. Drafted overnight for the user's triage.

## Agreed disposition

Agreed on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md#capture-and-project-direction): "Use durable project direction, including an existing vision document, to explain recommendations and tradeoffs without a duplicate goal registry or mandatory backlog section where that context already exists. Goals guide prioritization without silently changing readiness, creating dependencies, authorizing work, or overriding the user's selection. Make binding constraints explicit when settling the work. Keep recommendation reasoning proportionate to the decision."

## Current behavior

Checked on 2026-09-29:

- [The Ready skill](../../skills/ready/SKILL.md) grounds its recommendation in "the user's goals and the invariant priorities of reliability, through autonomy and trust, before efficiency, with a brief reason for each choice". Nothing directs it to consult the project's durable direction, such as a vision document, or to explain tradeoffs against it. Hosts load project instruction files, which may carry some direction, but that is not the same as reading the project's stated direction.
- Carried: no duplicate goal registry or mandatory backlog section, readiness and authority unchanged by goals, and brief, proportionate reasons.
- The recommendation-omission bug the migration row cited was fixed on 2026-09-24 and is in [BUGS_HISTORY.md](../BUGS_HISTORY.md#ready-reports-omit-actionable-recommendations); it concerned whether recommendations appear at all, not project direction.
- Whether binding constraints are made explicit when settling small work was left unverified: a spec names boundaries, and an understanding readback plausibly states binding limits.

## Direction

Have Ready use the project's durable direction where the project names or states it, and explain each recommendation and its tradeoffs against it, briefly.

## Settled questions

The user agreed these answers at triage on 2026-09-30, and the entry graduated from Exploring to current work on 2026-10-01. Each question is kept with its answer.

- How Ready finds the direction (a vision document by convention, a link from the backlog indexes, the project instructions), and what it does when there is none. At triage the user suggested [the shared BACKLOG.md meta-index](backlog-meta-index.md) as one more place for project goals or direction. Settled: Ready reads the documents that the project's instruction files or backlog indexes name as its direction, such as this repository's instructions naming VISION.md and WORKFLOW.md, and, if it ships, the BACKLOG.md meta-index as one more direction source. There is no filename convention, so a vision document nothing names is not read, and no new registry is added. When Ready finds no direction source, it recommends on the invariant priorities alone and says briefly that it found no stated direction.
- How this relates to [Size-aware Ready recommendations](ready-sized-recommendations.md), which adds picks sized for a quick or a long session. Settled as independent: neither depends on the other. Direction explains why an item is picked, and sizing decides how many and how large.

## Before implementation

The change is shipped Ready skill text that alters model-owned behavior, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check and deterministic evidence only with the model-owned behavior marked unverified. Tracking and readiness do not authorize implementation.
