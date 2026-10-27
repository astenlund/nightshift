---
name: initial-reviewer-selection
description: Define initial spec/code lead-reviewer selection, enforced as guidance backed by the existing strong-model checks
metadata:
  type: feature
---

# Initial reviewer selection

Captured on 2026-09-11. The user agreed a tighter selection policy for the initial spec/code lead reviewer and requested tracking it with the enforcement approach left open. This is future work; tracking does not authorize implementation or change the shipped runtime.

## Agreed policy

The policy below records the earlier agreement, not the current default placement. The 3.3.16 Vibe candidate now places GLM leads on Vibe first, then Sol on Codex, then Opus on Claude under [the operating brief](../../internal/workflow.md#model-roles-and-ownership). Before implementing this feature, reconcile its older host table and strong-list terminology with that delivered placement and [VISION.md](../../VISION.md), which requires approval for each role. The earlier effort-floor agreement remains recorded here; this note does not implement that future selection mechanism.

Use the spec author's host and effort for initial spec review, and the implementer's for initial code review:

| Author or implementer host | Preferred initial reviewer |
| --- | --- |
| Codex | Claude Opus |
| Claude Code | Codex Sol |

- The initial lead is restricted to the models on the strong list (see Settled questions), first written as Fable or Astra. Reviewer strength takes precedence over using a different host. The host table preferred Fable and Astra until 3.3.12 admitted Opus and Sol to the strong list, when the operating brief began preferring them on cost grounds; Fable and Astra stay admissible.
- Reviewer effort must be at least the author or implementer's known effort, but never max: an author or implementer known to have run at max sets a floor of the level below. Unknown effort defaults to **hard**. This is a minimum; a demanding review may use more effort, up to the level below max. Translate the policy into supported host settings when implementing it. The cap on max was added on 2026-10-11, as the amendments below record.
- If the preferred strong model is unavailable, use a permitted fresh reviewer with another strong model, even on the implementer's own host, in preference to any weaker alternative. Until 3.3.12 this bullet preferred Astra over Opus when Fable was unavailable; the user's decision of 2026-10-10 made Opus 5.5 strong, as the amendments below record.
- Explicit user model requirements still bind. If no eligible strong reviewer is available, keep the review gate pending and continue independent authorized work; since 2026-10-03 this applies only when degraded mode does not start (see Settled questions). Preserve the actual availability evidence and fallback reason.
- These rules select the initial lead. Subsequent passes can resume that reviewer. They are not blanket rules for skeptics, reviewer peers, supervisors or implementation helpers; those roles retain their own policies, including peer cloning.

This narrows reviewer-assignment discretion. It does not by itself prevent the author from influencing the review brief; neutral briefing and credible broad coverage remain necessary.

## Relationship to degraded assessment mode

[Degraded assessment mode](degraded-assessment-mode.md), graduated on 2026-09-29 and not yet implemented, is to let a weaker model carry a labeled, recorded assessment when no supported strong model can take the role or the user explicitly selects one: tasks advance on it, and the run completes only after strong coverage of the same content or the user's acceptance of its listed degraded outcome at completion. With only degraded coverage, publication waits for that acceptance and the user's confirmation at completion. The latter path was added on 2026-10-14 by [Manual gate bypass on the user's responsibility](manual-gate-bypass.md). When degraded mode starts, it departs from two points of the agreed policy above, restricting the initial lead to the strong list and keeping the review gate pending when no eligible strong reviewer is available. That record left open how the two fit together, naming this policy as the natural home for its selection rule, until the settled questions below answered it on 2026-10-03.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work.

- **Enforcement style.** The record asked: "Should the additional policy remain instructional guidance, become automatic assignment defaults with checks, or use hard runtime gates? A combination may be appropriate. No enforcement style has been chosen. Retain existing strong-model checks while deciding how author settings, effort translation and availability evidence should inform any additional mechanism." Settled: instructional guidance in the operating brief, backed by the checks the runtime already has, with no new hard gate. In the 3.3.16 candidate, internal/runtime/models.js defines ADMITTED_FAMILIES with minimum versions and permitted lead/skeptic roles. Dispatch uses requireAdmittedModel and import uses isAdmittedModel with roleFor; a receipt records the substitution reason when a fallback candidate ran. GLM on Vibe is lead-only, while the admitted Claude and Codex families support both assessment roles.
- **Degraded assessment mode.** This policy chooses among strong reviewers. When no strong reviewer is available and the user is present, the user chooses among widening the strong list through the escape hatch that [User-configurable model policy file](model-policy-file.md) records, a labeled degraded review under [Degraded assessment mode](degraded-assessment-mode.md), or waiting. Each of the first two options is offered only once the feature behind it has shipped, while waiting is always available, so before either ships the agreed policy holds as written: the review gate stays pending and independent authorized work continues. Degraded mode applies only when the user picks it, or, with no user available, on the recorded evidence. The review gate stays pending, as the agreed policy says, only when degraded mode does not start, for example because the user declines it or an explicit model requirement rules it out.
- **Strong list.** "Fable or Astra" reads as the models on the strong list, which since 3.3.12 are Opus, Fable, Sol and Astra from a minimum version of each family and which the model policy file is to make user-editable, so a change to that list needs no change here; the effort floor remains part of this earlier agreement, while the other-host preference needs reconciliation with the Vibe placement described above before implementation. Once [Model knowledge base](model-knowledge-base.md) exists, it can inform the order among strong models.
- **Scope.** Unchanged: these rules select only the initial lead; skeptics, peers, supervisors and helpers keep their own policies.

## Amendments

- **No max effort.** At inbox triage on 2026-10-11 the user decided that no Nightshift role uses max reasoning effort, since its token spend is not worthwhile. The effort floor and the allowance for more effort on a demanding review therefore stop at the level below max, and an author or implementer known to have run at max sets a floor of that level. [Keep every role below max reasoning effort](../QUICK_WINS_HISTORY.md#keep-every-role-below-max-reasoning-effort) carried the rule into the operating brief in 3.3.12, before this feature ships, and the runtime now refuses effort above xhigh for the assessments it launches.
- **Strong models.** On 2026-10-10, during a run in another project, the user decided that Opus 5.5 and Sol are strong enough for reviewers and skeptics, and at inbox triage on 2026-10-11 chose to add them to the shipped strong list through [Admit Opus 5.5 and Sol as strong reviewers](../QUICK_WINS_HISTORY.md#admit-opus-55-and-sol-as-strong-reviewers), delivered in 3.3.12 with a minimum version per family, so later versions qualify too. Under the strong-list answer above this policy covers them without a change to its rules; that delivery updated the host table to prefer Opus and Sol, matching the operating brief's cost preference, and replaced the bullet that preferred Astra over Opus when Fable was unavailable.

## Before implementation

The change is shipped guidance in the operating brief and possibly a line in revise-spec and revise-code, so it rides with a plugin version increase, and effort is translated into supported host settings then. Reviewer choice is model-owned behavior, so the start of the work decides between a budgeted installed-host check and deterministic evidence only with that behavior marked unverified. Tracking and readiness do not authorize implementation.

The broader [structured model teams](structured-model-teams.md) proposal remains separate. This policy can be considered without adopting a fixed controller/implementer team arrangement.
