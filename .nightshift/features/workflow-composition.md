---
name: workflow-composition
description: Let the user change the workflow's steps, gates and model choices through configuration files over a shipped default, and later through the web UI, for example to accept some risk for speed on prototypes and one-offs
metadata:
  type: feature
status: exploring
---

# User-configurable workflow composition

## Origin

Raised by the user on 2026-10-12, in their words: "user-tweakable workflow composition. the includes the steps, gates, model choices, and probably more. the plugin ships the default, but the user can modify it via config files. when the web ui is shipped, there should be ways of modifying the workflow through the ui as well."

Asked whether a configuration may remove or weaken the gates that make a result trustworthy, with three options put to them (a fixed core that configuration cannot touch, full control with every deviation from the shipped default labeled, or the layering agreed for the model policy file, where the user-wide file can change anything and a project's file can only tighten it), the user answered: "i'm envisioning a scenario where the user might want to accept some risk for higher speed. the runtime still drives the execution, letting the user focus on other things. this could be useful for quick prototypes or one-offs. not sure how flexible we should make this, so leave it open for now."

Asked whether [User-configurable model policy file](model-policy-file.md) should stay its own entry, with a composition using it for model choices, rather than being absorbed here, the user answered: "keep separate for now, but we might want to refactor once more stuff around this gets built."

## Current understanding

Today the workflow's steps are instructions in the skills and [the operating brief](../../internal/workflow.md), and its gates are enforced by the runtime, for example the review gates in `reviewGateFailure` and the per-task action check in `assertAction`, both in `internal/runtime/lifecycle.js`. A composition the user edits would have to govern both.

The use the user describes trades assurance for speed by the user's own choice. [VISION.md](../../VISION.md#invariant-priorities) rules that trade out as written: speed, efficiency and economy "count only where they cost neither autonomy nor trust", and "A run that finishes unattended by lowering its standard is not reliable". A composition that lowers the bar therefore needs that direction amended, not only new machinery.

[Rigor-steered lifecycle](rigor-steered-lifecycle.md), a v2 proposal for a five-tier ladder steering the lifecycle, was retired on 2026-09-06; [V3-MIGRATION.md](../../V3-MIGRATION.md) records that it "can remove review dimensions or exempt sibling coverage after repairs" and that "Those mechanisms conflict with the agreed direction". Its tiers were a fixed set the plugin defined, each lower one by what it subtracts, and a spec's tier was derived by the engine, then confirmed by the user, who could set it above or below the derived value; a composition would let the user change the steps, gates and model choices themselves. A retired mechanism does not return by default, though, so the design has to say what differs. [Run-shaping settings](run-shaping-settings.md), a v2 proposal for a per-run round cap and per-role model pins, had its retained need consolidated into [Preserve run preferences and enforce supported resource budgets](v3-run-preferences.md).

Related records: the model policy file above, which settles the user-wide policy file for models; run preferences, which carries per-run model, effort and budget preferences; [Graphical run view](run-graph-view.md), whose Operational UI slice would be where the workflow can be edited in a web UI, since none is shipped; [Structured model teams](structured-model-teams.md), for later deliberate model-role arrangements; and [Manual gate bypass on the user's responsibility](manual-gate-bypass.md), raised the same day, a deviation the user accepts for one refusal, where a composition sets its deviations in advance.

## Open questions

- How flexible a composition may be, which the user left open on 2026-10-12: whether some gates stay fixed, whether a composition that removes or weakens a default gate marks its runs degraded and labels the deviation in status and reports, as a bypass does, and how VISION's invariant priorities change to allow the trade.
- Where configuration lives and at what scope, and whether a project's file, which arrives with a clone, may lower the bar or only raise it, as the model policy file lets a project's file only narrow the user's policy.
- Its format, and how a new shipped default reaches a user who already has a file, which the model policy file answers by recording only additions to and removals from the shipped defaults.
- How one definition governs both the instructions a run loads and the runtime's gates, and whether the same definition is what the graphical run view draws and its Operational UI slice edits.
- Whether a composition is chosen once, per project or per run, and how it relates to run preferences.
- What a run records about the composition in force, so that a resumed run and its reports reflect it, and what happens when the file changes during a run.
- When to fold the model policy file in, which the user left until more is built around both.
