---
name: initial-reviewer-selection
description: Define initial spec/code lead-reviewer selection, enforced as guidance backed by the existing strong-model checks
metadata:
  type: feature
---

# Initial reviewer selection

Captured on 2026-09-11. The user agreed a tighter selection policy for the initial spec/code lead reviewer and requested tracking it with the enforcement approach left open. This is future work; tracking does not authorize implementation or change the shipped runtime.

## Agreed policy

Use the spec author's host and effort for initial spec review, and the implementer's for initial code review:

| Author or implementer host | Preferred initial reviewer |
| --- | --- |
| Codex | Claude Fable |
| Claude Code | Codex Astra |

- The initial lead is restricted to Fable or Astra, read since 2026-10-03 as the models on the strong list (see Settled questions). Reviewer strength takes precedence over using a different host.
- Reviewer effort must be at least the author or implementer's known effort. Unknown effort defaults to **hard**. This is a minimum; a demanding review may use more effort. Translate the policy into supported host settings when implementing it.
- If the preferred strong model is unavailable, use a permitted fresh reviewer with the other strong model, even on the implementer's own host. In particular, when Fable is unavailable but Opus or lower models are available, prefer Astra over those weaker alternatives.
- Explicit user model requirements still bind. If no eligible strong reviewer is available, keep the review gate pending and continue independent authorized work; since 2026-10-03 this applies only when degraded mode does not start (see Settled questions). Preserve the actual availability evidence and fallback reason.
- These rules select the initial lead. Subsequent passes can resume that reviewer. They are not blanket rules for skeptics, reviewer peers, supervisors or implementation helpers; those roles retain their own policies, including peer cloning.

This narrows reviewer-assignment discretion. It does not by itself prevent the author from influencing the review brief; neutral briefing and credible broad coverage remain necessary.

## Relationship to degraded assessment mode

[Degraded assessment mode](degraded-assessment-mode.md), graduated on 2026-09-29 and not yet implemented, is to let a weaker model carry a labeled, recorded assessment when no supported strong model can take the role or the user explicitly selects one: tasks are to advance on it, while the run is not to complete and nothing is to be published until a strong assessment covers the same content. When degraded mode starts, it departs from two points of the agreed policy above, restricting the initial lead to Fable or Astra and keeping the review gate pending when no eligible strong reviewer is available. That record leaves open how the two fit together and names this policy as the natural home for its selection rule. The settled questions below answer it.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work.

- **Enforcement style.** The record asked: "Should the additional policy remain instructional guidance, become automatic assignment defaults with checks, or use hard runtime gates? A combination may be appropriate. No enforcement style has been chosen. Retain existing strong-model checks while deciding how author settings, effort translation and availability evidence should inform any additional mechanism." Settled: instructional guidance in the operating brief, backed by the checks the runtime already has, with no new hard gate. The runtime already refuses models outside the strong list for every assessment kind at dispatch and at receipt import (`STRONG_MODELS` in `internal/runtime/review.js`), and a receipt already records the substitution reason when a fallback candidate ran.
- **Degraded assessment mode.** This policy chooses among strong reviewers. When no strong reviewer is available and the user is present, the user chooses among widening the strong list through the escape hatch that [User-configurable model policy file](model-policy-file.md) records, a labeled degraded review under [Degraded assessment mode](degraded-assessment-mode.md), or waiting. Each of the first two options is offered only once the feature behind it has shipped, while waiting is always available, so before either ships the agreed policy holds as written: the review gate stays pending and independent authorized work continues. Degraded mode applies only when the user picks it, or, with no user available, on the recorded evidence. The review gate stays pending, as the agreed policy says, only when degraded mode does not start, for example because the user declines it or an explicit model requirement rules it out.
- **Strong list.** "Fable or Astra" reads as the models on the strong list, which are Fable and Astra today and which the model policy file is to make user-editable, so a change to that list needs no change here; the preference for the other host and the effort floor stand. Once [Model knowledge base](model-knowledge-base.md) exists, it can inform the order among strong models.
- **Scope.** Unchanged: these rules select only the initial lead; skeptics, peers, supervisors and helpers keep their own policies.

## Before implementation

The change is shipped guidance in the operating brief and possibly a line in revise-spec and revise-code, so it rides with a plugin version increase, and effort is translated into supported host settings then. Reviewer choice is model-owned behavior, so the start of the work decides between a budgeted installed-host check and deterministic evidence only with that behavior marked unverified. Tracking and readiness do not authorize implementation.

The broader [structured model teams](structured-model-teams.md) proposal remains separate. This policy can be considered without adopting a fixed controller/implementer team arrangement.
