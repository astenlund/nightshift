---
name: full-suite-before-delivery
description: Run the project's full test suite before a run delivers, as the explicit ask a user's no-full-suite rule needs, and halt delivery on failure, as v2's handover did
metadata:
  type: feature
status: exploring
---

# Run the full test suite before delivery

## Origin

Found on 2026-10-01 by [the audit of capabilities that left v2 without a disposition](../reports/v2-capability-audit-20261001.md). v2's handover ran the project's full test suite as its step 11, before the morning report: "Run the project's full test suite as defined in the project's CLAUDE.md. This phrase is the explicit ask that overrides any per-project \"never run the full suite without filter\" rule. If the suite is not green, halt and surface failures before triage; test failures are not follow-up items." (`skills/handover/SKILL.md` at `8ca3cb4^`; the v2 queue carried it as a named step in `skills/handover/handover-queue.js`). The v3 change `8ca3cb4` removed the step. [The operating brief](../../internal/workflow.md) asks for relevant verification after every repair batch, and [the runtime reference](../../internal/runtime/REFERENCE.md) requires at least one check per code task, but nothing runs the full suite, and only the retired rigor-steered-lifecycle record named the step, whose retirement concerned its tier ladder. The user chose at the audit's triage to restore it as an Exploring entry.

## Direction

Before a run delivers, at least a handed-over one, run the project's full test suite as the explicit ask that a user's rule against unrequested full-suite runs needs, and halt delivery on failure rather than recording the failures as follow-ups.

## Open questions

- How a run finds a project's full-suite command: the project's instructions, its CI configuration or a recorded check, and what happens when none is found.
- Time cost in large projects, and how the run fits it within deadlines and limits.
- Whether attended runs run it too, and whether it replaces or follows the last relevant verification.
- How it relates to [Verify faked boundaries live](live-boundary-verification.md), which reports what stayed test-only as a verification limit.
