---
name: full-suite-before-delivery
description: Run the project's full test suite before a run that changed more than documentation or the backlog delivers, as the explicit ask a user's no-full-suite rule needs, repair failures the run caused and stop for the user on any other failure, as v2's handover halted
metadata:
  type: feature
---

# Run the full test suite before delivery

## Origin

Found on 2026-10-01 by [the audit of capabilities that left v2 without a disposition](../reports/v2-capability-audit-20261001.md). v2's handover ran the project's full test suite as its step 11, before the morning report: "Run the project's full test suite as defined in the project's CLAUDE.md. This phrase is the explicit ask that overrides any per-project \"never run the full suite without filter\" rule. If the suite is not green, halt and surface failures before triage; test failures are not follow-up items." (`skills/handover/SKILL.md` at `8ca3cb4^`; the v2 queue carried it as a named step in `skills/handover/handover-queue.js`). The v3 change `8ca3cb4` removed the step. [The operating brief](../../internal/workflow.md) asks for relevant verification after every repair batch, and [the runtime reference](../../internal/runtime/REFERENCE.md) requires at least one check per code task, but nothing runs the full suite, and only the retired rigor-steered-lifecycle record named the step, whose retirement concerned its tier ladder. The user chose at the audit's triage to restore it as an Exploring entry.

## Direction

Before a run that changed more than documentation or the backlog delivers, attended or handed over, run the project's full test suite as the explicit ask that a user's rule against unrequested full-suite runs needs. Repair a failure the run's own changes caused, and stop for the user on any other failure rather than recording it as a follow-up.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- How a run finds a project's full-suite command: the project's instructions, its CI configuration or a recorded check, and what happens when none is found. Settled: the run takes the command from the project's instructions, or failing that from its CI configuration, and the agreement made before the work starts, the readback or, when the user is leaving, the handover, names it so the user can correct it or opt out while present. When no command is found, the agreement says so and the final report lists the full suite as not run among the verification limits.
- Time cost in large projects, and how the run fits it within deadlines and limits. Settled: the suite runs as an ordinary recorded check under its time limit, and a suite that does not finish counts as a failure, never a pass.
- Whether attended runs run it too, and whether it replaces or follows the last relevant verification. Settled: every run that changed more than documentation or the backlog runs it, attended or handed over; runs that touched only documentation or the backlog skip it. It runs once, after the last review and repair round and before the work counts as done, in addition to the targeted checks rather than instead of them, and because it is recorded as a check, a later edit to its inputs makes it stale and it runs again.
- What happens on failure, settled with the questions above. A failure the run's own changes caused is a defect in the run's work: the run repairs it with the usual review and runs the suite again. A failure the run did not cause, such as a test that was already failing, stops the run for the user's decision and is never recorded as a follow-up in its place; in a handed-over run the run ends blocked and the morning report shows the failure.
- How it relates to [Verify faked boundaries live](live-boundary-verification.md), which reports what stayed test-only as a verification limit. Settled as independent: a green suite proves nothing about behavior the tests fake, which stays a stated limit, and neither requires the other.

## Before implementation

The change is shipped guidance in the operating brief and the handover skill, with no new runtime machinery since the suite is recorded as an ordinary check, so it rides with a plugin version increase. Finding the command, judging what caused a failure and stopping for the user are model-owned behavior, so the start of the work decides between a budgeted installed-host check and deterministic evidence only with that behavior marked unverified. Tracking and readiness do not authorize implementation.
