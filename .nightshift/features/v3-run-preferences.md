---
name: v3-run-preferences
description: Preserve run preferences and enforce supported resource budgets
metadata:
  type: feature
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

## Settled questions

The user agreed these answers on 2026-10-13, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: `validateLimits` in `internal/runtime/limits.js` accepts only `deadlineUtc` and `maxDispatches` and refuses any other limit with `unsupported-limit`, and [the runtime reference](../../internal/runtime/REFERENCE.md) has `resume` keep existing limits unchanged; a model requirement exists only per dispatch, as `requiredModel`, so nothing durable carries a user's stated model choice across compaction or adoption; each dispatch attempt records its host, model, effort and usage, with usage unknown (null) in stated cases such as a resumed session whose earlier total is missing, and registered workers record host, model and effort; and the runtime records usage only for the attempts it dispatches, not for the controller's own session or helpers it launches in-session.

- The preference source, scope and refresh rules. Settled: model and effort preferences or requirements the user states for a run, at handover or later, are recorded in the run with the user's words. They survive compaction, adoption and resume, and the runtime refuses a dispatch that contradicts a recorded requirement. There is no settings interview: nothing is recorded when the user states nothing, and the controller's task-fit choices stay its own. A recorded preference changes only on the user's direction. Standing preferences across runs stay with [the model policy file](model-policy-file.md), which governs which models are permitted, and the user's own instructions.
- Which additional budget metrics can actually be enforced. Settled: a token limit over the runtime's own dispatches, counted from each attempt's recorded usage; unknown usage never counts as zero, and the governing spec settles how it is bounded. Money cost is not enforced, since prices change and the runtime holds no verified pricing. Usage the runtime cannot observe, the controller's own and that of helpers launched in-session, stays outside any enforced limit, and handover and the report say so.
- How the user raises a recorded limit mid-run. Settled: on the user's explicit authority, a limit of a running or stopped run can be raised or lowered, recorded with the user's words and the previous value. Raising a limit never resumes a stopped run by itself, which still needs explicit resumption. The controller never changes a recorded limit on its own judgment, while its internal ceilings within the user's allowance stay its own, as the [budget-controls bug](../BUGS.md#controller-treats-internal-token-ceilings-as-user-owned-budget-decisions) records.
- How the closing report states the model behind each role, including the substitution report missing today. Settled: the closing report gives the host, model and effort of each role that ran, taken from receipts and worker records, with every substitution marked with its reason. A role the record does not cover shows as unknown, never as a guess.
- Relations. Settled: the budget-controls bug keeps its own repair. [Verify faked boundaries live](live-boundary-verification.md) keeps the settlement of the live-evidence allowance at handover and uses the same usage accounting. The quick wins [Fit each role's model to the strength it needs](../QUICK_WINS.md#fit-each-roles-model-to-the-strength-it-needs) and [Keep every role below max reasoning effort](../QUICK_WINS.md#keep-every-role-below-max-reasoning-effort) set guidance defaults, and a run's recorded preference wins within that run. The entry requires none of them.

## Before implementation

Settle the recorded preference form and where the runtime checks it, the token limit's grammar and the bound on unknown usage, the operation that changes a recorded limit, and the closing report's role table in a concise governing spec in `.nightshift/specs`. The change alters the runtime, its reference, the operating brief and the morning report, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check and deterministic evidence only. Verify continuation of recorded preferences across compaction, adoption and resume, allowed substitution, an unavailable required model, delayed and unknown usage, real exhaustion, and a limit raised on a stopped run. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Run-shaping settings: round cap and review lanes](../reports/v3-migration-followups-20260920.md#run-shaping-settings-round-cap-and-review-lanes).

[The migration decision](../../V3-MIGRATION.md#run-configuration) preserves the surviving requirement; earlier records: [run-shaping-settings](run-shaping-settings.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
