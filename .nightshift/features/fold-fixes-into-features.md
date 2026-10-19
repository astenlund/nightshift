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

The rule: before creating a quick win or bug entry, look for an active feature that would remove or rewrite the lines the fix touches, so that the fix would not survive the feature in its current form; a feature that merely touches the same module does not qualify. If one exists, add the fix as one line under that record's `## Carried fixes` heading, giving the observed failure, its location, what the replacement must do and a link to the evidence, and create no separate entry. A repeat adds a date to that line, never a paragraph. A tenuous match, or a feature invented so there is somewhere to fold into, means a quick win or bug entry as before. A defect that blocks runs now gets the smallest stopgap, noted on its carried line, without an entry of its own. A feature's acceptance covers every carried fix, and its history entry lists them. When a feature is retired, deferred indefinitely or marked won't fix, each carried fix is re-triaged on its own merits: it becomes a quick win or bug entry if it still describes a live defect, or is dropped with a one-line reason in the feature's history entry.

## Slices and scope

Optional slice: Ready shows the carried-fix count beside each ready feature, so folded fixes become the demand signal for what to build next. The parser and template changes ship with a version increase; the AGENTS.md rule alone needs none. Apply the rule once retroactively over the current quick wins and bugs as the first pruning pass.

## Delivered

On 2026-10-19 the user chose to ship the rule in the plugin rather than in this repository's AGENTS.md, since guidance for how the plugin runs belongs in plugin files, to include the Ready count, to exclude Exploring drafts as fold targets, with a Ready notice for a draft whose record carries fixes, and to verify it on both installed hosts within a 24,000,000-token allowance. It was delivered the same day as direct work in the 3.3.13 batch: the operating brief's follow-up triage, the quick-wins, bugs and features templates, revise-docs and the Ready skill carry the rule, and Ready reports `carriedFixes` on each ready work unit of a feature whose record carries fixes, and the draft notice. Setup writes a template only for a missing index, so the template paragraphs reach only indexes it creates from then on; existing indexes keep their preambles and get the rule only through the brief's delivery triage, and this repository's own `QUICK_WINS.md`, `BUGS.md` and `FEATURES.md` received the paragraphs by hand at the user's choice after the review of the change. [The live check](../reports/carried-fixes-live-20261019.md) records the evidence and its limits. The first pruning pass checked the 70 quick wins and 51 bugs then tracked against the active features and found two that qualified, both folded at the user's choice: the null-usage fix now carried by [Show review progress without being asked](visible-revise-progress.md#carried-fixes) and the migration ignore-rule fix now carried by [Restore fresh-scaffold track, ignore or defer choice](setup-tracking-choice.md#carried-fixes). Most other overlaps between entries and features are recorded as coordination, which the rule does not count as replacement. The same day the user chose to add partial folds rather than widen the replacement test, delivered in the same batch with [a live check of their own](../reports/partial-folds-live-20261019.md): when a feature would remove only part of what a fix changes, and that part fails and can be verified on its own, that part is carried and the rest stays an entry that names it. The first split carries the runs-rule newline fix of [New setup templates ignore effective project newline policy](../BUGS.md#new-setup-templates-ignore-effective-project-newline-policy) in [Restore fresh-scaffold track, ignore or defer choice](setup-tracking-choice.md#carried-fixes).
