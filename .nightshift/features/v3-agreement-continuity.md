---
name: v3-agreement-continuity
description: Verify compatible agreement continuity across representation changes
metadata:
  type: feature
status: exploring
---

# Verify compatible agreement continuity across representation changes

Complete evidence for retained agreement behavior: qualified assent, compatible title or description edits, archival moves and repeated spec refinements preserve accepted commitments without enlarging the approval burden.

## Selected outcome

Stable task IDs and commitment revisions exist, and policy separates compatible corrections from material decisions. The original re-keying and digest-drift needs require end-to-end evidence for ordinary index-only work and repeated revisions, beyond removal of the old digest implementation.

## Evidence and limits

`lifecycle.js` keeps stable task IDs and commitment records; review tests bind assessments to requirements and spec bytes. The active permission-only recovery bug identifies one remaining invalidation boundary and stays the owner of that concrete repair.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Verify qualified assent, unchanged commitments under representation-only edits, archive movement and actual scope expansion on both hosts. Reconcile with the permission-recovery bug, retain material-decision gates and distinguish product gaps from missing acceptance evidence.

The existing [permission-only recovery bug](../BUGS.md#permission-only-recovery-invalidates-accepted-specs) retains its concrete repair. The [earlier digest-drift diagnosis](../bugs/agreement-digest-revision-detail-drift.md) remains provenance for repeated-revision acceptance; the old digest protocol is retired.

## Instruction gaps found by the migration accounting audit

The audit of 2026-09-29 found that two agreed behaviors this entry verifies are not yet instructions a run loads, so delivery needs instruction changes as well as evidence:

- Qualified assent. The agreed disposition under [Agreement and informed user decisions](../../V3-MIGRATION.md#agreement-and-informed-user-decisions) says: "Clear agreement with an explicit adjustment authorizes the adjusted commitments. Reflect the resulting change back to the user and continue, while preserving independent review of a revised spec before implementation. Clarify genuine ambiguity or consequences requiring another decision." [The operating brief](../../internal/workflow.md) says only that a yes to the plain question is agreement, that compatible corrections preserve it and that material changes need the user's decision; nothing says a yes with an adjustment authorizes the adjusted commitments, that the controller reflects the change back and continues, or that clarification is kept for genuine ambiguity or consequences requiring another decision.
- Understandable deltas. The disposition in the same section says "material changes are presented as understandable deltas, with the full spec and supporting evidence accessible." No instruction directs how a material change to the agreement is presented.

## Added at the section-level audit's triage

[The section-level audit of v2 records](../reports/v2-section-audit-20261004.md) found four agreement behaviors that either left v2 without a disposition naming them or were retained by a disposition with nothing tracking them, and the user chose on 2026-10-04 to fold all four into this entry. The first three share one record of what the user was shown, what they accepted and how the accepted version later changed.

- Judging an edit made after acceptance. v2's shipped agreement gate ([Present chosen spec for agreement before work](present-spec-for-agreement.md)) ran a fit check on an edit after agreement, continuing on compatible edits and presenting changed decisions again, and two v2 proposals sharpened it: judge against the accepted version, since "A mutable after-image is never evidence for its own compatibility" ([immutable-accepted-authority](immutable-accepted-authority.md)), and record the judgment in a recognizable form ([bullet-entry-selector-rekeying](bullet-entry-selector-rekeying.md)). In v3 a repair that answers a review finding carries a recorded classification and basis against the accepted commitments, but an edit no finding drove leaves no judgment; `spec-accepted` keeps only content hashes, not the accepted text, so there is nothing to compare against, and nothing says what to do when materiality is unclear. Keep the accepted text or a diff base, record a judgment against it for every post-acceptance edit no finding drove, and take unclear materiality back to the user.
- Binding acceptance to the presented text. v2 discarded a yes given while the spec changed under it. v3's `spec-accepted` binds the spec as it stands when the acceptance is recorded, and [the 2026-09-21 audit](../reports/pre-v3-shipped-capability-audit-20260921.md) records that the old digest protocol was intentionally replaced. Record what was presented, and refuse the acceptance or present the spec again when it changed between presentation and acceptance.
- Recording a qualified yes. The decision quoted in the section above keeps the behavior, and also asks to "Reassess the existing classifier and write protocol with the agreement machinery" ([Agreement and informed user decisions](../../V3-MIGRATION.md#agreement-and-informed-user-decisions)). The user settled that reassessment: a qualified yes records the presented version, the user's adjustment and the adjusted commitments in the same record, with fixtures for each outcome.
- Reviewing one index entry. The retired v2 draft [Wave round economy](../migration/v2/features/wave-round-economy.md) found that a spec review of one quick-win entry fingerprinted the whole index, and its disposition under [Repair coverage and progress](../../V3-MIGRATION.md#repair-coverage-and-progress) keeps "Reviewing an index entry does not automatically make the entire index the target." Spec assessments in v3 snapshot whole files and go stale on any change to them ([the runtime reference](../../internal/runtime/REFERENCE.md#independent-assessment)), so an index named as the governing text is reviewed and made stale as a whole. When an index entry is the governing text, review scope and staleness are to follow that entry.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Accept an unambiguous qualified agreement without re-presentation](../reports/v3-migration-followups-20260920.md#accept-an-unambiguous-qualified-agreement-without-re-presentation).
- [Keep the governing entry's archive move out of implementation plans](../reports/v3-migration-followups-20260920.md#keep-the-governing-entrys-archive-move-out-of-implementation-plans).
- [Bullet-entry selector re-keying and within-digest continuation](../reports/v3-migration-followups-20260920.md#bullet-entry-selector-re-keying-and-within-digest-continuation).
- [Agreement digests drift toward micro-detail through review revisions](../reports/v3-migration-followups-20260920.md#agreement-digests-drift-toward-micro-detail-through-review-revisions).
- [Immutable accepted authority for compatible refreshes](../reports/v3-migration-followups-20260920.md#immutable-accepted-authority-for-compatible-refreshes).

[The migration decision](../../V3-MIGRATION.md#agreement-and-informed-user-decisions) preserves the surviving requirement; earlier records: [bullet-entry-selector-rekeying](bullet-entry-selector-rekeying.md), [immutable-accepted-authority](immutable-accepted-authority.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
