# Run adoption and reliable continuation

Executive governing scope agreed on 2026-09-21: "scope looks good, handing over". The [technical design](run-adoption-and-continuation.md) supplies implementation detail within these commitments.

## Outcome

Let the user resume the same interrupted Nightshift work in another Claude Code or Codex session on the same Windows machine and project. Preserve the agreed work and make renewed handover reliable.

## What will change

- **Safe takeover.** With the user's direction, an explicitly stopped run can move to another session while the original chat remains open. Workers, checks and other operations must be confirmed inactive. An abandoned run still marked running additionally requires confirmed inactivity of its former controller. Unknown activity blocks takeover.
- **Continuity without lost work.** Keep the run's progress, agreements, valid review evidence, limits, history and report duties. The former owner loses authority to change the run. Subsequent reviews remain independent.
- **Honest continuation.** On resumption or renewed handover, verify what can actually keep working. Recover failed workers and continue useful authorized work in the current turn. When unattended continuation is unavailable, explain the required user action and preserve progress. A functioning Stop hook protects handed-over work against premature yielding, while user pauses and limits take precedence.

## First-delivery boundaries

Abandoned-running recovery initially requires proof that the former host process has ended. Supported stopped runs do not require closing the original chat. Runs need a compatible release and sufficient recovery evidence; older retained releases are not silently upgraded. Missing evidence may leave a run blocked.

Active-controller transfer, moves between machines, automatic host relaunch, adoption of completed or replaced runs, and a new interrupted-run notice in Ready are outside this scope.

## Done means

Both hosts demonstrate successful takeover and continuation, including switching between them. Verification also covers unsafe-takeover refusal, interrupted recovery, preserved limits and evidence, independent review, and user-stop behavior. Required review, documentation and closing work are completed.

## Delivery authority and verification allowance

The user approved this scope and handed over delivery, then granted 4,000,000 aggregate tokens for live-model verification across both hosts. The allowance includes retries and interrupted-attempt exposure; ordinary implementation and independent reviews are outside it. Reliable usage accounting is required before the campaign starts. Unverified cases remain explicit if the allowance is exhausted. Publication is not authorized.
