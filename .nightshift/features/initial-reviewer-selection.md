---
name: initial-reviewer-selection
description: Define initial spec/code lead-reviewer selection while leaving additional enforcement undecided
metadata:
  type: feature
status: exploring
---

# Initial reviewer selection

Captured on 2026-09-11. The user agreed a tighter selection policy for the initial spec/code lead reviewer and requested tracking it with the enforcement approach left open. This is future work; tracking does not authorize implementation or change the shipped runtime.

## Agreed policy

Use the spec author's host and effort for initial spec review, and the implementer's for initial code review:

| Author or implementer host | Preferred initial reviewer |
| --- | --- |
| Codex | Claude Fable |
| Claude Code | Codex Astra |

- The initial lead is restricted to Fable or Astra. Reviewer strength takes precedence over using a different host.
- Reviewer effort must be at least the author or implementer's known effort. Unknown effort defaults to **hard**. This is a minimum; a demanding review may use more effort. Translate the policy into supported host settings when implementing it.
- If the preferred strong model is unavailable, use a permitted fresh reviewer with the other strong model, even on the implementer's own host. In particular, when Fable is unavailable but Opus or lower models are available, prefer Astra over those weaker alternatives.
- Explicit user model requirements still bind. If no eligible strong reviewer is available, keep the review gate pending and continue independent authorized work. Preserve the actual availability evidence and fallback reason.
- These rules select the initial lead. Subsequent passes can resume that reviewer. They are not blanket rules for skeptics, reviewer peers, supervisors or implementation helpers; those roles retain their own policies, including peer cloning.

This narrows reviewer-assignment discretion. It does not by itself prevent the author from influencing the review brief; neutral briefing and credible broad coverage remain necessary.

## Open question: enforcement style, if any

Should the additional policy remain instructional guidance, become automatic assignment defaults with checks, or use hard runtime gates? A combination may be appropriate. No enforcement style has been chosen. Retain existing strong-model checks while deciding how author settings, effort translation and availability evidence should inform any additional mechanism.

The broader [structured model teams](structured-model-teams.md) proposal remains separate. This policy can be considered without adopting a fixed controller/implementer team arrangement.
