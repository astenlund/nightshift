---
name: per-role-model-approval
description: Complete the per-role model approval migration across runtime and guidance
metadata:
  type: feature
status: exploring
---

# Complete the per-role model approval migration

Raised by the user on 2026-10-26 during the Vibe reviewer host delivery and routed to the backlog on 2026-10-27, in their words: "we've discovered that a model can be a good reviewer and yet not suited as a skeptic. in fact, i think it might be best to retire the 'strong model' concept altogether. instead, we'll continue evaluating the models for each individual role and update the allow lists whenever a new model family has been approved." Tracked in [the feature index](../FEATURES.md#complete-the-per-role-model-approval-migration). The original capture is follow-up `role-specific-model-approval-direction` in run `dcd9e840-e8b6-4f28-9c6e-b5aaaaac9847`.

## Requested direction

- Keep evaluating model families per role, and admit a family to a role only after that role's approval, recording the supporting evidence, scope and limits; approval for one role does not transfer to another.
- Retire the remaining universal strong-model terminology in runtime errors, guidance and records in favor of role-specific admission language.
- Extend role-specific approval beyond reviewer leads and skeptics to the other roles, such as implementers and peers, where a single strength category still governs.

## Details to settle

The 3.3.16 runtime already admits reviewer families per role, and [VISION.md](../../VISION.md) now records the per-role approval direction with role-specific allowlists; the remaining migration scope, its compatibility with existing runs and receipts, and its relationship to the active [user-configurable model policy file](model-policy-file.md) are unsettled. Settle how each role's allowlist is recorded, evaluated and surfaced, and what replaces the retired terminology at each site, before implementation. Tracking preserves the direction; it does not authorize implementation and does not infer approval for any new family or role.
