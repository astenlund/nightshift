---
name: present-spec-for-agreement
description: Instruct agents (via the index files and init-backlog templates) to present any chosen spec to the user for agreement before starting implementation work
metadata:
  type: feature
  status: exploring
---

# Present chosen spec for agreement before work

Have the agent present any spec it is about to implement to the user for
agreement before starting work, whether the spec is a feature, quick win,
bug fix, or pattern that the agent picked from the backlog.

Idea sketch (2026-08-12 capture): update the index files (`FEATURES.md`,
`QUICK_WINS.md`, `BUGS.md`, `PATTERNS.md` guidance) and the
`init-backlog` scaffolds to instruct the agent to surface the chosen
spec's design to the user and get an explicit agreement before beginning
implementation. The `/nightshift:ready` command picks an unblocked work
set but does not itself gate a single item on user agreement; this idea
adds that gate at the point of picking.

Motivating incident: a user asked to review a feature spec
(calibrate-first-draft-rigor) before it passed to revise-spec and then
implementation, and noted this should not have to be requested ad hoc.

Open questions to settle when it graduates to a designed feature: the
exact trigger (at selection from `/ready`, at the start of the handover
flow, at first edit of the breakout file, or all), whether it gates only
agent-initiated picks or also user-nominated work, how it interacts with
the durable-scope-anchor / rigor-profile spec sections the agent would
need to present, and whether it belongs as a prompt instruction in the
index templates, in `init-backlog`, or in a command-driven check. It is
related to the existing `## Exploring` graduation path but concerns the
agreement gate before implementation rather than design firmness.
