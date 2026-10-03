---
name: model-policy-file
description: Move the supported strong-model list into a user-configurable file that can also hold general allow and deny lists of models
metadata:
  type: feature
---

# User-configurable model policy file

## Origin

Raised by the user on 2026-09-29, outside any run, while graduating [Degraded assessment mode](degraded-assessment-mode.md), in their words: "we should also move the set of acceptable strong models to a user-configurable file, but that could be a separate entry. that file could contain a general whitelist and/or blacklist as well as the strong list."

## Current behavior

The supported strong models are the constant `STRONG_MODELS` in `internal/runtime/review.js`: `claude-fable-5-1` on Claude and `gpt-6-astra` on Codex. The runtime checks it for every assessment kind at dispatch (`validateRequest`) and again at receipt import (`readReceipt`), and [the runtime reference](../../internal/runtime/REFERENCE.md#independent-assessment) names the same two as the current strong reference models. Prose names the pair too: README.md, WORKFLOW.md (Implement directly), VISION.md (Built around capable, interchangeable models), [the operating brief](../../internal/workflow.md) (Model roles and ownership) and [the v3 feature](nightshift-v3.md) (Outcome and priorities) present Fable and Astra as interchangeable or as the current reference models. Because the list is a constant in code, changing it takes a plugin release. There is no general allow or deny list: the controller supplies each dispatch's ordered `candidates`, and `requiredModel` carries an explicit user model requirement.

## Direction

- The set of acceptable strong models moves out of the code into a file the user can edit.
- The same file can also hold a general allow list, a deny list, or both.

Checked again on 2026-10-03: `STRONG_MODELS` in `internal/runtime/review.js` still holds exactly those two models.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- Where the file lives and at what scope (user-global, per project, or both with a precedence rule), and whether a project's file, which arrives with a clone, may widen the strong list or only narrow it, since widening it lowers the review gate for anyone who works in that project. Settled: the user's policy lives in one user-wide file in the Nightshift store, by default `%LOCALAPPDATA%/Nightshift`, which both hosts already use, so one policy covers Claude Code and Codex. A project may carry its own file, which can only narrow the user's policy, never widen it.
- Its format and validation, and what happens when it is missing, empty or malformed: whether the plugin still ships defaults, and how a release that supports a new model reaches users who already have a file. Settled: the file is JSON and records additions to and removals from the defaults the plugin ships, not a full replacement, so a release that supports a new model still reaches users who have a file. A missing file means the shipped defaults. A malformed file refuses new dispatches with an error that names the file, never a silent fallback to defaults.
- What the allow and deny lists govern: every role, including implementation helpers, or only assessments; whether they apply per host; how they combine with each other, with the strong list and with an explicit user model requirement; and whether entries name exact model identifiers or also families and effort. Settled: the allow and deny lists govern every model Nightshift dispatches or registers, assessments, skeptics and helpers alike; the deny list always wins; a strong role's model must also be on the strong list; entries name exact model identifiers, with families and effort not supported at first. When an explicit user model requirement conflicts with the effective policy, whether because the deny list blocks the model, the allow list leaves it out or a project's file narrows it away, Nightshift stops and asks the user rather than choosing between the two; the user generalized this on 2026-10-03 from the deny-list case first agreed.
- Whether each receipt records the policy in force when it was made, and whether changing the file during a run affects assessments already imported. Settled: each receipt records the policy in force when it was made, and a change to the file during a run governs only dispatches made after it: an assessment is checked at import against the policy recorded when it was dispatched, and assessments already imported stay valid.
- How it relates to [Degraded assessment mode](degraded-assessment-mode.md), whose minimum model is unsettled and which the allow list could bound; to [Model choice per role: Opus 5.5 versus Fable](opus-versus-fable-role-choice.md), where widening the strong list would become a file edit; to the undecided preference source in [Preserve run preferences and enforce supported resource budgets](v3-run-preferences.md); to [Initial reviewer selection](initial-reviewer-selection.md); and to the bug [Permitted validation fallbacks are lost between runs](../BUGS.md#permitted-validation-fallbacks-are-lost-between-runs), which asks for concrete model identities to live in configuration and evidence where necessary. Settled as stated there: the Opus decision becomes a file edit once it is made, the allow list can bound degraded mode's minimum model, the file is a natural home for the permitted fallbacks the bug asks to keep, and run preferences and initial reviewer selection keep their own scope. This feature requires none of them.

## Before implementation

Settle the file's schema, its exact location under a custom store, the narrowing rule for a project file, enforcement at every dispatch and receipt import, and how receipts record the policy, in a concise governing spec in `.nightshift/specs`. The change is shipped runtime behavior that governs the review gate, so it rides with a plugin version increase, fixture tests for missing, malformed, narrowing and conflicting files, a README section and careful review; the start of the work decides between a budgeted installed-host check and deterministic evidence only. Tracking and readiness do not authorize implementation.
