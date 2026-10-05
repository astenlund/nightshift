---
name: model-instinct-map
description: Log each observed case of a model acting against its prompt or instructions in a per-model instinct map, and counter recurring instincts mechanically through tools, permissions or hooks rather than only through stronger wording
metadata:
  type: feature
status: exploring
---

# Model instinct map

## Origin

Raised by the user on 2026-10-05, mid-run in run `253965ee-2713-4140-bbd4-622bfa55eb61` after a handover, in their words: "idea: whenever a model is found to do something that goes against their prompt or other instructions, log the error into a model instinct map. this could then be applied as a sort of per-model strategy by giving the models the tools they expect, removing permissions for unwanted actions, or any other means that might steer more strongly than strengthened instructions alone. should probably be part of the model profile feature." The user then corrected the spelling to "instinct". It was recorded as a run follow-up and tracked as Exploring at that run's triage the same day. No entry is named "model profile"; the user chose a separate draft whose observations land in the [Model knowledge base](model-knowledge-base.md), leaving that entry's settled commitments unchanged.

## Current understanding

The idea has two parts. Logging: each case of a model acting against its prompt or instructions is recorded against that model. Steering: a recurring case is countered by changing what the model can do rather than only how it is told, such as providing the tool it reaches for, removing the permission for the unwanted action or adding a hook that refuses it.

The same run showed the difference. The user's global instructions forbid passing a script body through an inline interpreter argument, and the controller still issued two inline `node` script bodies; the `no-inline-scripts` hook of the user's agent-hooks plugin refused both, where the written rule had not prevented them. The controller also began one Bash command with a directory change that the same instructions forbid, which no hook catches.

The logging part fits the [Model knowledge base](model-knowledge-base.md), whose settled design records dated, sourced observations about models, weaknesses included, proposed by the session retrospective and landing only with the user's yes, with Nightshift's own entries naming the exact model identifier. The steering part goes beyond that entry, which informs only the choice among permitted models, and overlaps [Review-run command enforcement](review-run-command-enforcement.md), which asks which explicit command restrictions need stronger enforcement and where.

## Open questions

- What counts as an instinct: instruction-contrary behavior seen in hook refusals, reviewer findings, user corrections or the retrospective; how a case is attributed to a model and version when the controller and dispatched workers run different models; and how many recurrences justify a steer.
- How entries sit in the knowledge base: as ordinary observations or as a distinct kind naming the behavior, the instruction it contradicts and the steer applied, within that entry's settled form of model, version, date and source.
- Which steers each host supports: tools Nightshift can provide, permission rules, hooks or different instructions per model; which of them Nightshift may write on the user's machine, given that it already registers user hooks through `internal/releases`; and what a host without a given steer does instead.
- How a steer is scoped to one model and role (controller, reviewer, skeptic, helper), approved by the user, measured for effect through later recurrence, and retired when a model changes.
- How it relates to the [Model knowledge base](model-knowledge-base.md), [User-configurable model policy file](model-policy-file.md) and [Review-run command enforcement](review-run-command-enforcement.md).
