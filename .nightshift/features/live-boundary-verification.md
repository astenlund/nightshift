---
name: live-boundary-verification
description: Exercise changes live where tests fake the boundary, report what stayed test-only, and settle the live-evidence allowance at handover
metadata:
  type: feature
---

# Verify faked boundaries live

Raised by the user on 2026-09-26 after inbox triage, observing that live tests tend to find what unit tests and reviews miss, and asking whether the plugin workflow encourages them adequately. The user chose to track it and to fold two pending quick wins into it: [Settle the installed-host evidence budget before handover](#installed-host-evidence-budget-approved-2026-09-11) and [Settle a spare token allowance for every implementation run at handover](#spare-token-allowance-proposed-2026-09-12-to-13), whose decisions are carried below with their original terms. Tracked in [the feature index](../FEATURES.md#verify-faked-boundaries-live). Tracking and readiness do not authorize implementation.

## Problem

The guidance agents follow during a run does not ask for live verification. [The operating brief](../../internal/workflow.md) asks for "relevant verification" after each repair, and its Tests and evidence code dimension asks for "meaningful assertions and realistic execution", but it never asks for the changed behavior to be exercised in the real environment. Live use appears in [VISION.md](../../VISION.md) ("Tests, builds, targeted experiments, and live use of the affected flow resolve uncertainties against the actual system") and [WORKFLOW.md](../../WORKFLOW.md) ("Tests, builds, and live verification establish the agreed behavior"), which inform design and are not loaded by a run. This repository's [AGENTS.md](../../AGENTS.md) requires installed-host evidence only when model-owned behavior changes, and frames it chiefly as a cost ("repository prose edits do not justify replaying the native acceptance campaign"); other projects receive nothing.

Most defects recent live use found were not model-owned. Each came from something the deterministic tests do not exercise, though not always a stand-in:

- [Runtime claims through Git Bash lose the host process](../BUGS.md#runtime-claims-through-git-bash-lose-the-host-process): a faked boundary. The tests inject the controller's native process identity (`tests/fixtures/controller-claim.js`), and in an installed 3.2.10 fixture claims through the real Git Bash failed while the same claim through PowerShell succeeded; the native process-ancestry walk is the plausible but unconfirmed cause.
- [Codex acceptance fixtures copy the live credential](../QUICK_WINS.md#codex-acceptance-fixtures-copy-the-live-credential): the real credential lifecycle, which no deterministic test involves. A credential hazard in the acceptance tooling, found when a fixture's token refresh revoked the production login.
- [Checks hang until their time bound when dotnet leaves build servers running](../BUGS.md#checks-hang-until-their-time-bound-when-dotnet-leaves-build-servers-running): a real third-party toolchain the tests never run, found in ordinary use in another project; the reporter suspects, without a captured process list, that build-server processes outlived the command inside the check's Windows job.
- [Create silently ignores unknown request fields](../QUICK_WINS.md#create-silently-ignores-unknown-request-fields): a real call with an input the tests never sent, found when a real fixture controller passed an unexpected field.
- [Private review copies fail at Windows path depth](../QUICK_WINS_HISTORY.md#private-review-copies-fail-at-windows-path-depth): the real filesystem and Git at a depth the tests do not reproduce. The deterministic suites use real directories and Git and pass at ordinary checkout depth, but failed inside real private review copies.

One recent live finding was model-owned: the 3.2.10 handover acknowledgement did not appear under five wordings, recorded in [the acceptance report](../reports/unattended-stop-hook-20260926.md). A stand-in encodes its author's belief about the boundary it replaces, and the tests and reviewers share that belief, so only a live run checks it; the same holds for inputs and environment conditions the tests never reproduce.

## Proposed direction

Proposed by the controller on 2026-09-26 and accepted by the user for tracking; the commitments are not yet agreed.

- The operating brief gains one principle: a change crossing a boundary that the deterministic tests fake (processes, the host or shell, the filesystem, credentials, the network, model behavior) is exercised in the real environment (the installed plugin, the real application, the real shell) once the deterministic checks pass.
- Verification reports state what was exercised live and what was verified only through stand-ins, the latter as a stated verification limit, so the gap reaches the completion report and the morning report instead of staying silent.
- The Tests and evidence code dimension asks whether such a boundary was exercised live.
- Live verification that consumes model tokens is paid from the allowance settled at handover, as carried below.
- This repository's AGENTS.md sentence on installed-host evidence shrinks to a pointer at the brief's rule.

## Carried decisions

### Installed-host evidence budget (approved 2026-09-11)

Approved as written by the user on 2026-09-11 after a self-hosting run whose first independent assessment came back incomplete: the change altered model-owned skill text, the repository requires installed-host evidence for such changes, and no probe budget had been settled before handover, so the run had to stop and ask. The evidence budget is a governing decision that belongs in the interactive settlement.

Add to `skills/handover/SKILL.md`, directly after the sentence about settling known user-owned decisions before the user leaves: "When the queue changes model-owned behavior, settle the installed-host evidence budget and accounting in the same interactive phase, since an assessment without that evidence stays incomplete." Shipped text: ride with the next version increase and obtain independent assessment before it lands.

### Spare token allowance (proposed 2026-09-12 to 13)

User idea from an unattended run in this repository on 2026-09-12, refined at triage. That run needed two separate budget questions after handover (a 500000 token installed-host campaign, then a re-probe of about 350000), and a controller estimate for one more probe overran the second cap by 101971 tokens because the runner enforced an estimated admission check rather than a spending ceiling. The installed-host evidence budget above covers planned live evidence only.

On 2026-09-13 the user proposed a generous default of 4,000,000 tokens, adjustable up or down at handover, following discussion of campaigns the controller cannot credibly estimate. The user further proposed powers-of-two adjustment steps for simplicity: each upward step doubles the allowance and each downward step halves it, giving 1M, 2M, 4M, 8M, 16M and so on around the default; M denotes 1,000,000 tokens. Present this as an aggregate live-verification allowance, not an estimate or spending target. Its scope includes planned and unexpected live probes, associated review, retries and cached input; the spare allowance and planned evidence share one aggregate limit rather than receiving separate default grants.

Extend `skills/handover/SKILL.md` so every implementation run presents that default and settles the user's allowance and accounting source in the interactive phase, whether or not live probes are planned at the start. State uncertainty when no credible estimate is available; use concrete evidence to recommend an adjustment when appropriate. Within the accepted allowance, the controller owns probe sizing, internal ceilings and reservations and adapts them autonomously. If remaining allowance cannot cover a probe, first assess an adequate bounded approach within that allowance; if none is available, defer optional verification for the user's decision or record required verification as a blocker. Never exceed or automatically renew the user's aggregate allowance. Reliable finalized usage accounting and effective spending controls remain necessary independently of the generous default. Reconcile this work with the [internal-ceiling authority and accounting defect](../BUGS.md#controller-treats-internal-token-ceilings-as-user-owned-budget-decisions). Shipped text changes model-owned behavior, so it rides with the next version increase and needs installed-host evidence.

## Before implementation

- Decide whether the principle's trigger stays with boundaries the tests fake or widens to real inputs and environment conditions the tests do not reproduce: as proposed it covers the Git Bash case, the credential and toolchain cases arguably, and neither the unknown-field nor the path-depth case.
- Reconcile the two carried decisions with each other and with the proposed principle: the allowance becomes the one aggregate that pays for live verification, and the 2026-09-11 sentence's model-owned trigger widens or yields to the boundary principle, which is the user's decision.
- The change alters the operating brief and the handover skill, so it needs a concise governing spec in `.nightshift/specs` with independent spec review, a plugin version increase, and a decision at start between a budgeted installed-host campaign and deterministic evidence only with the model-owned behavior marked unverified.
- No dependency blocks it. Coordinate with [Acceptance reports carry a checkable evidence digest](../QUICK_WINS.md#acceptance-reports-carry-a-checkable-evidence-digest), which records the credential-copy guard and per-scenario costs where live budgets are settled, with [Separate run-time guidance from reference material](runtime-guidance-separation.md), which decides where run-time rules live, and with [Preserve run preferences and enforce supported resource budgets](v3-run-preferences.md), which leaves allowance settlement at handover to this entry.
