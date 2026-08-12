---
name: signed-off-stamp
description: Distinguish half-cooked ideas from fully-designed backlog entries with a signed-off stamp, so unstamped entries trigger a brainstorming pass before implementation
metadata:
  type: feature
status: exploring
---

# Signed-off stamp

Give backlog entries a durable "signed-off" marker that distinguishes a
half-cooked idea from a fully-designed, ready-to-implement entry, so the
agent can tell at a glance whether a feature needs to go through a
brainstorm before it is built.

Idea sketch (2026-08-12 capture): an explicit stamp on entries in the
.FEATURES.md index (and the other indexes where entry firmness matters),
with an instruction in the template so future sessions pick it up and
kick off a brainstorming pass to settle non-stamped entries before
implementing them.

Open questions to settle when it graduates to a designed feature: the
stamp's representation (frontmatter field on the breakout file vs an
inline marker in the index entry), how it interacts with the existing
`## Exploring` / `status: exploring` conventions and the `##` themed
graduation path, whether `signed-off` is a dedicated command or a step
inside an existing flow, and how "kick off a brainstorm to settle
unstamped entries" is triggered and gated. The related `## Exploring`
graduation already handles pre-dependency-analysis drafts; this feature
is about the firmness of a designed entry's content, not its dependency
analysis.