---
name: selection-review-and-assessment
description: When the readback or spec for selected work is presented, dispatch a review agent and a separate assessment agent that suggests tweaks, both running while the user reads
metadata:
  type: feature
status: exploring
---

# Background review and assessment of selected work

## Origin

Raised by the user on 2026-09-29, outside any run, while a review loop was running, in their words: "idea: when picking one or more entries to work on, the model should give a short assessment and suggest tweaks where appropriate. the assessment will run in parallel with the model and user reviews after the readback has been presented. it'll be an opportunity for the user to receive feedback from the model before work starts. this is valuable, since the original entry might have been entirely user-directed without any ai input and this is the last opportunity before implementation starts."

Asked how the second sentence was meant, the user explained: "not sure if it works like this today, but as the readback is presented, the model should launch a review agent for the selected entry or entries. the idea is that the review happens while the user reads the readback. this is so any issues will reach the user without much delay after the readback is accepted by the user and handover is invoked. i'd like this new assessment to run in parallel with the agent review."

## Current behavior

[The Ready skill](../../skills/ready/SKILL.md) turns a confirmed selection into interactive investigation and a readback that ends with a plain question asking whether to begin the work. [The operating brief](../../internal/workflow.md#priorities-and-authority) asks for a short understanding readback and confirmation for small work, and a concise spec for substantial work. Only the spec gets an independent review while the user reads it: the controller starts the spec assessment through a nonblocking dispatch and promptly presents the same draft, and implementation waits for agreed commitments and a resolved assessment, as [revise-spec](../../skills/revise-spec/SKILL.md) also states; its lead assesses meaningful commitments, soundness, failure and recovery, and proportionality. A plain readback gets no review agent, only the user's confirmation. Neither path asks for a separate assessment of the selected entries themselves with suggested tweaks. [The handover skill](../../skills/handover/SKILL.md) accepts a handover only once every queued item has its readback or concise-spec agreement and known user-owned decisions are settled before the user leaves. Investigation without implementation agreement does not create a delivery run.

## Settled questions

Answered by the user on 2026-09-29, after being told that today only a spec gets a background review while the user reads it.

- **Readbacks too.** Every readback, like every spec, is to get a background review agent while the user reads it, with the new assessment running alongside.
- **Separate agent.** The assessment is to come from a second background agent, dispatched at the same time as the review agent.

## Direction

- When the readback or spec for the selected entries is presented, dispatch the review agent and the assessment agent together, so both run while the user reads.
- The assessment is short: a view of the selected entries with suggested tweaks where appropriate, giving the user the model's feedback before work starts, since an entry may have been written by the user without any AI input.

## Open questions

- What each agent covers and how they differ: what the readback review checks the readback against, how far the assessment of an entry's value and shape overlaps the spec dimensions, and whether one agent covers several selected entries or each gets its own.
- When results must arrive relative to the user's yes and to handover. The user expects issues to reach them "without much delay after the readback is accepted by the user and handover is invoked", while handover is accepted only once decisions are settled before the user leaves: whether the yes or the handover waits for both results, and what happens to results that arrive after the user has left.
- How findings and tweaks are handled: whether assessment suggestions get skeptical validation like review findings or reach the user as advice, and how an accepted tweak changes the agreement, given that compatible corrections preserve it and material changes need the user's decision.
- Scope: selections from Ready, as the idea's first words say, or every readback, including graduations and requests from outside the backlog.
- How the review and the assessment are recorded, since no run exists before implementation agreement; compare [Run-free revise](run-free-revise.md), and `create`, which records a governing spec as reviewed only for an already observed valid independent assessment.
- Models, strength and cost for each agent, especially for small work, and the installed-host evidence this model-owned behavior needs.
- Relations: [Size-aware Ready recommendations](ready-sized-recommendations.md) shapes the selections this would assess, and the v2 design archive [Second-opinion gates](second-opinion-gates.md) proposed a similar fresh-eyes read, its requirements gate, before the spec was written, which [the migration status](../MIGRATION_STATUS.md) records as replaced by the supported review path.
