---
name: v3-run-preferences
description: Preserve run preferences and enforce supported resource budgets
metadata:
  type: feature
status: exploring
---

# Preserve run preferences and enforce supported resource budgets

Complete the retained run-settings outcome across continuation: durable model and effort preferences, explicit requirements and substitutions, plus enforceable requested budgets with accurate accounting and honest unsupported limits.

## Selected outcome

The old tier-derived caps and verifier lanes remain retired. Current runtime limits cover deadlines and dispatch attempts; token/cost limits require a separate verified mechanism. Restore any missing preference persistence and shared budget support without inventing a settings interview for each run.

## Evidence and limits

`limits.js` accepts only deadlineUtc and maxDispatches; dispatch accepts candidates, requiredModel and substitutionReason per request. Existing budget bugs own concrete accounting repairs, and [Verify faked boundaries live](live-boundary-verification.md) owns allowance settlement at handover.

The agreed model rule under [Supported hosts](../../V3-MIGRATION.md#supported-hosts) allows a permitted substitute "with the substitution and reason reported". The migration accounting audit found on 2026-09-29 that the review receipt records the substitution and its reason, but no instruction reports them to the user, and the brief says only that the reason is recorded.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Decide the preference source, scope and refresh rules, and which additional budget metrics can actually be enforced. Verify continuation, allowed substitution, unavailable required models, delayed usage and real exhaustion. Coordinate with existing budget entries instead of declaring their problems solved.

Coordinate with the [budget-controls bug](../BUGS.md#controller-treats-internal-token-ceilings-as-user-owned-budget-decisions) and the handover allowance and evidence-budget decisions that [Verify faked boundaries live](live-boundary-verification.md) carries. Their separate defects are not declared resolved.

## Added at the section-level audit's triage

[The section-level audit of v2 records](../reports/v2-section-audit-20261004.md) found two run-settings capabilities that left v2 without a disposition naming them, and the user chose on 2026-10-04 to fold both into this entry:

- Raising a recorded limit mid-run. v2's [run-shaping settings](run-shaping-settings.md) kept that "Raising it mid-run stays possible". v3's deadline and dispatch limit are fixed when `handover` creates the run, and resume, renewed handover and adoption keep them, so a run that reaches a limit stops for good, while [the operating brief](../../internal/workflow.md) forbids replacing an unfinished run. [Run configuration](../../V3-MIGRATION.md#run-configuration) says only that limits "cannot be silently raised". Let the user raise a recorded limit of a running or stopped run on explicit authority, recorded in the run, never silently and never on the controller's own judgment.
- Reporting the model behind each role. The v2 run-shaping proposal had the run report its resolved lanes, the host, model and effort of each role, once, so the morning report would not have to reconstruct them; v3 reports only substitutions, and even that report is the gap noted above. Have the closing report state the model and effort that ran each role, with substitutions and their reasons marked.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Run-shaping settings: round cap and review lanes](../reports/v3-migration-followups-20260920.md#run-shaping-settings-round-cap-and-review-lanes).

[The migration decision](../../V3-MIGRATION.md#run-configuration) preserves the surviving requirement; earlier records: [run-shaping-settings](run-shaping-settings.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
