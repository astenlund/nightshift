---
name: ready-sized-recommendations
description: Have Ready recommend, besides a few high-value entries, one or two small ones for a quick session and a larger entry or group of entries for a longer session, such as a night's worth of work
metadata:
  type: feature
status: exploring
---

# Size-aware Ready recommendations

## Origin

Raised by the user on 2026-09-29, outside any run, right after a Ready report in this repository, in their words: "idea: ready suggests not only a few individual high-value entries to work with, but also one or two smaller ones for something quick and a larger entry or a group of entries for a longer session (e.g. to fill a night's worth of work)".

## Current behavior

[The Ready skill](../../skills/ready/SKILL.md) asks for one recommendation whenever work is ready: a small selection grounded in the user's goals and the invariant priorities of reliability, through autonomy and trust, before efficiency, with a brief reason for each choice, cited by ready-set number so that a bare numeric reply selects one item unambiguously. It says nothing about how large the recommended work is or what length of session it fits. A selection the user confirms starts interactive investigation and a readback that ends by asking whether to begin the work, and the user directs any handover. No field records size or effort. The index an entry sits in is the only structured signal, and a coarse one, since a quick win can still need installed-host evidence, as [Verify the Codex handover path of 3.2.10](../QUICK_WINS.md#verify-the-codex-handover-path-of-3210) does; entry text carries others, such as the steps an entry says remain before implementation. Recommendation behavior is model-owned; [the Ready selection boundary acceptance report](../reports/ready-selection-boundary-20260924.md) holds installed-host evidence for the skill's 3.2.4 wording, which later releases have changed.

## Direction

- Keep the few individual high-value recommendations.
- Add one or two smaller entries for a quick session.
- Add one larger entry, or a group of entries, sized to fill a longer session, such as a night's worth of work.

## Settled questions

- **Size.** Answered by the user on 2026-09-29 when asked how Ready judges size without a recorded estimate: "the size doesn't have to be super accurate; it'll be up to the model to pick something that makes some sort of sense". Ready's model judges size and duration from the entries and records it reads, rather than from a recorded estimate.

## Open questions

- What makes a group coherent for one session, such as shared files, one governing spec, one release or one review.
- How a pick meant for a night fits handover, which [the handover skill](../../skills/handover/SKILL.md) accepts only once every queued item has its readback or concise-spec agreement and known user-owned decisions are settled before the user leaves: whether the pick favors entries that are quick to settle, whether it may include an entry that still needs a governing spec, which is then written, reviewed and agreed while the user is present, and whether that attended settlement counts toward the pick's size.
- How a group is cited and selected, given that recommendations cite ready-set numbers so that a bare numeric reply selects one item.
- Whether the added picks always appear or scale with the size of the ready set, and what Ready says when no candidate fits one of them.
- How it relates to [Ready offers to pick up an interrupted run](ready-interrupted-run-pickup.md) and [Project inboxes](project-inboxes.md), which would also add to the Ready report, and to [Preserve run preferences and enforce supported resource budgets](v3-run-preferences.md), whose budgets would bound a night's worth of work.
