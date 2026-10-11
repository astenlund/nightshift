---
name: mid-run-carve-outs
description: Let the user carve a queued task out of a running run, parking its work and tracking it separately, so the rest of the run can complete
metadata:
  type: feature
status: exploring
---

# Carve a task out of a running run

## Origin

Raised by the user in Hermes (`C:/Users/asten/AppData/Local/hermes`), run `451da04e` on installed 3.3.9, and reported to the maintainer inbox on 2026-10-11 at the user's request, in their words: "add mid-run scope carve-outs as an idea in the nightshift inbox", after asking "i want to complete the run. so splitting things off isn't possible?". Tracked as Exploring at inbox triage on 2026-10-11.

## Current understanding

Partway through a long run the user decided to carve one queued code task out of it: park its finished but unreviewed code on a local branch, record it as its own backlog item and finish the rest. The controller blocked the task as a user decision, parked the code and wrote the backlog item as tracking edits. When the user then asked to complete the run, the carve-out had no runtime form. The task stayed in the queue, blocked; a documentation task that depended on it could not proceed, so its agreed edits went in as closing tracking edits; `complete` requires every queued task to be complete; and `stop` is not to be used to sidestep incomplete work, while the operating brief forbids replacing an unfinished run, so a later run for the carved-out work would have had to resume this one. The only way to complete was to bring the task back into the run. In the 3.3.10 runtime no operation removes or withdraws a task from a run. The run's other remaining tasks waited on live steps the user had reserved, a different kind of pending work that also kept it from completing.

[Keep a handed-over run open for triage after delivery](handover-open-for-triage.md) plans the inverse, an add-task operation for follow-on work agreed at the report or during triage. [State the expected size and offer slices before handover](../QUICK_WINS.md#state-the-expected-size-and-offer-slices-before-handover) would offer slicing before a run starts, which would make carve-outs rarer but not unnecessary.

## Open questions

- How a carve-out treats tasks that depend on the carved-out task, and whether their agreed edits move with it.
- How it changes the run's agreement and what the user confirms, including whether the carved-out code is parked, kept in place or reverted, and who records its backlog item.
- What closing evidence, the retrospective and the morning report say about carved-out work, and whether the run then completes normally.
- How it relates to the planned add-task operation, to adoption, and to resuming the carved-out work later in a new run.
