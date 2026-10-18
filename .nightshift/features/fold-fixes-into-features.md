---
name: fold-fixes-into-features
description: Fold a fix into the active feature that would remove or rewrite the lines it touches, as a carried-fix line, instead of creating a separate quick win or bug entry
metadata:
  type: feature
---

# Fold fixes into the feature that replaces their code

## Origin

Raised by the user on 2026-10-18 after the assessment of 3.3.12 found that roughly a dozen of the 68 quick wins patch code a tracked feature would delete or substantially rework, each costing a review cycle of its own if shipped alone. The expensive unit in this workflow is the delivery, not the edit, so fixes folded into the feature that replaces their code cost one cycle instead of one each, and the feature gets built with its real requirements in hand.

## Direction

The rule, for this repository's AGENTS.md now and for the init-backlog templates when shipped: before creating a quick win or bug entry, look for an active feature that would remove or rewrite the lines the fix touches, so that the fix would not survive the feature in its current form; a feature that merely touches the same module does not qualify. If one exists, add the fix as one line under that record's `## Carried fixes` heading, giving the observed failure, its location, what the replacement must do and a link to the evidence, and create no separate entry. A repeat adds a date to that line, never a paragraph. A tenuous match, or a feature invented so there is somewhere to fold into, means a quick win or bug entry as before. A defect that blocks runs now gets the smallest stopgap, noted on its carried line, without an entry of its own. A feature's acceptance covers every carried fix, and its history entry lists them. When a feature is retired, deferred indefinitely or marked won't fix, each carried fix is re-triaged on its own merits: it becomes a quick win or bug entry if it still describes a live defect, or is dropped with a one-line reason in the feature's history entry.

## Slices and scope

Optional slice: Ready shows the carried-fix count beside each ready feature, so folded fixes become the demand signal for what to build next. The parser and template changes ship with a version increase; the AGENTS.md rule alone needs none. Apply the rule once retroactively over the current quick wins and bugs as the first pruning pass.
