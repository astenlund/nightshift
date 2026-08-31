---
name: code-simplifier-workflow-placement
description: Explore one authoritative placement and entry condition for code simplification
metadata:
  type: feature
status: exploring
---

# Code simplifier workflow placement

Draft exploring whether code simplification belongs in each implementation task, in a Nightshift-owned lifecycle boundary, or in a host-side workflow. The design must select one owner and entry condition without duplicating revise-code's Code Quality dimension or `/simplify`.

## Candidate placements

- Task-local placement would run immediately before a task's built-in review and could keep simplification close to the implementation context.
- Nightshift-owned placement could make simplification an explicit lifecycle boundary or plan-authoring contract shared across supported hosts.
- Host-side placement could keep an optional personal plugin outside Nightshift while allowing plans to invoke it through a capability boundary.

## Open design questions

- Select exactly one authoritative owner and define the entry condition, scope, and ordering relative to task verification and review.
- Define how simplifier output differs from revise-code's Code Quality dimension and `/simplify` so the same judgment is not purchased twice.
- Decide whether the step is mandatory, advisory, or capability-gated, and define behavior when the selected simplifier is unavailable or fails.
- Define whether simplifier changes re-enter task-local review, the full revise loop, or another verification boundary before they can land.
