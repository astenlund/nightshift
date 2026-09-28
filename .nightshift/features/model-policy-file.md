---
name: model-policy-file
description: Move the supported strong-model list into a user-configurable file that can also hold general allow and deny lists of models
metadata:
  type: feature
status: exploring
---

# User-configurable model policy file

## Origin

Raised by the user on 2026-09-29, outside any run, while graduating [Degraded assessment mode](degraded-assessment-mode.md), in their words: "we should also move the set of acceptable strong models to a user-configurable file, but that could be a separate entry. that file could contain a general whitelist and/or blacklist as well as the strong list."

## Current behavior

The supported strong models are the constant `STRONG_MODELS` in `internal/runtime/review.js`: `claude-fable-5-1` on Claude and `gpt-6-astra` on Codex. The runtime checks it for every assessment kind at dispatch (`validateRequest`) and again at receipt import (`readReceipt`), and [the runtime reference](../../internal/runtime/REFERENCE.md#independent-assessment) names the same two as the current strong reference models. Prose names the pair too: README.md, WORKFLOW.md (Implement directly), VISION.md (Built around capable, interchangeable models), [the operating brief](../../internal/workflow.md) (Model roles and ownership) and [the v3 feature](nightshift-v3.md) (Outcome and priorities) present Fable and Astra as interchangeable or as the current reference models. Because the list is a constant in code, changing it takes a plugin release. There is no general allow or deny list: the controller supplies each dispatch's ordered `candidates`, and `requiredModel` carries an explicit user model requirement.

## Direction

- The set of acceptable strong models moves out of the code into a file the user can edit.
- The same file can also hold a general allow list, a deny list, or both.

## Open questions

- Where the file lives and at what scope (user-global, per project, or both with a precedence rule), and whether a project's file, which arrives with a clone, may widen the strong list or only narrow it, since widening it lowers the review gate for anyone who works in that project.
- Its format and validation, and what happens when it is missing, empty or malformed: whether the plugin still ships defaults, and how a release that supports a new model reaches users who already have a file.
- What the allow and deny lists govern: every role, including implementation helpers, or only assessments; whether they apply per host; how they combine with each other, with the strong list and with an explicit user model requirement; and whether entries name exact model identifiers or also families and effort.
- Whether each receipt records the policy in force when it was made, and whether changing the file during a run affects assessments already imported.
- How it relates to [Degraded assessment mode](degraded-assessment-mode.md), whose minimum model is unsettled and which the allow list could bound; to [Model choice per role: Opus 5.5 versus Fable](opus-versus-fable-role-choice.md), where widening the strong list would become a file edit; to the undecided preference source in [Preserve run preferences and enforce supported resource budgets](v3-run-preferences.md); to [Initial reviewer selection](initial-reviewer-selection.md); and to the bug [Permitted validation fallbacks are lost between runs](../BUGS.md#permitted-validation-fallbacks-are-lost-between-runs), which asks for concrete model identities to live in configuration and evidence where necessary.
