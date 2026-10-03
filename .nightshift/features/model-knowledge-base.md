---
name: model-knowledge-base
description: Keep a user-editable knowledge base where Nightshift and the user record observations about models, such as strengths, weaknesses, cost and availability, and consult it when choosing models
metadata:
  type: feature
status: exploring
---

# Model knowledge base

## Origin

Raised by the user on 2026-10-03, outside any run, while graduating [User-configurable model policy file](model-policy-file.md), in their words: "we should also have a user-editable knowledge base where both Nightshift and the user can put model observations, strengths/weaknesses, etc. maybe a separate but related feature", and shortly after: "this file could be consulted when making model choices".

## Current state

Checked on 2026-10-03. [The operating brief](../../internal/workflow.md) (Model roles and ownership) asks the controller to "Choose assignments using task fit, observed strengths, availability, context and cost", and carries its model observations as fixed text, such as "Astra tends toward fast precise coding, computer use, quantitative work and skeptical evaluation of plausible prose", to be used "as preferences to test against actual task evidence". [The v3 feature](nightshift-v3.md) likewise lets "the user's reported model strengths" inform model assignments. Those observations ship with the plugin, so only a release changes them, and neither the user nor a run can add to them. Other observations are scattered across backlog records, such as the field observation in [Model choice per role: Opus 5.5 versus Fable](opus-versus-fable-role-choice.md) that the user runs Opus 5.5 as default controller and finds it working well, and the measured resume costs per host in [Make resumed reviewers actually cheap](../QUICK_WINS.md#make-resumed-reviewers-actually-cheap).

## Direction

- One knowledge base of model observations, such as strengths, weaknesses, cost and availability, that the user can edit and Nightshift can add to.
- Consulted when making model choices, within the limits the model policy file sets: the policy decides which models are permitted, and the knowledge base informs which permitted model fits a role.

## Open questions

- Where it lives and its format: for example beside the model policy file in the Nightshift store, so that it covers both hosts, as readable Markdown or structured data, and whether a project can add observations of its own.
- What Nightshift writes and when: for example the retrospective, which already examines the session's evidence, proposing entries with that evidence; whether an entry needs the user's approval before it lands, as instruction proposals do; and how an observation is dated, sourced and retired as models change.
- How it is consulted: which choices read it, such as the candidates for each dispatch and helper assignments, how much of it reaches the controller's context, and how its influence on a choice is recorded in that choice's evidence.
- Whether the brief's fixed model observations move into it, so the brief keeps only the rule to choose by task fit and observed strengths.
- Relations: [User-configurable model policy file](model-policy-file.md), which it informs without changing what is permitted; [Model choice per role: Opus 5.5 versus Fable](opus-versus-fable-role-choice.md), whose evidence would land here; [Initial reviewer selection](initial-reviewer-selection.md); and [Structured model teams](structured-model-teams.md).

Tracking does not authorize implementation.
