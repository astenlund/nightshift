---
name: user-proxy-consultation
description: Consult a strong model reasoning as the absent user on uncertain decisions, backed by an opt-in user profile
metadata:
  type: feature
status: exploring
---

# User proxy consultation and opt-in user profile

Raised by the user on 2026-09-24 during a handed-over run in this repository and tracked at that run's triage. This is an idea, not a commitment; tracking does not authorize implementation.

## Idea

When the controller is uncertain about a decision and the user is absent (a handed-over or unattended run), it consults "the spirit of the user": the strongest available model, instructed to use all available knowledge (memories, agent instructions, backlog entries and similar records) to reason as the user would and propose a plausible answer with a confidence. The proposal is added to the follow-up list for triage in the morning report. With high enough confidence the controller might proceed instead of deferring. It is a more controlled version of the situation where the controller asks itself whether something should be deferred.

The user's addendum: establish a user profile in which priorities, sensibilities and similar preferences accumulate over time for the proxy to draw on. It is opt-in, because collecting such information is sensitive.

## Relation to existing records

- [Degraded assessment mode](degraded-assessment-mode.md) covers a weaker model standing in for an unavailable strong reviewer; this idea covers a model standing in for an absent user's judgment, a different authority.
- Follow-up triage in `internal/workflow.md` already preserves unanswered decisions for the returning user; a proxy answer would enter that same flow with its own label.

## Open before commitment

- Which decisions a proxy may inform, and which stay reserved for the real user regardless of confidence, such as publication, budgets, scope changes and anything the user explicitly reserved.
- How confidence is established and what threshold, if any, lets the controller proceed; whether proceeding requires the change to be easily reversible.
- How proxy answers are labelled in run state, reports and triage so they are never mistaken for the user's own decisions, and how the user confirms or overturns them.
- Proxy inputs and independence: which records it reads, and whether it must be a fresh context separate from the controller.
- The profile's consent, location, format, review, correction and deletion; what may be recorded, and whether it is per machine, per project or global.
- Cost and model availability for the proxy consultation.
