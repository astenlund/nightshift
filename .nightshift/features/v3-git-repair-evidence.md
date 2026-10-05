---
name: v3-git-repair-evidence
description: Verify repair-commit and autosquash safety in ordinary delivery
metadata:
  type: feature
---

# Verify repair-commit and autosquash safety in ordinary delivery

Complete the retained reliable repair-commit outcome using ordinary Git and project policy: establish ownership and the current safe fixup target, preserve unrelated work, honor hooks and verify the intended autosquash.

## Selected outcome

The elaborate transaction engine and routine checkpoint autosquash remain retired. V3 relies on controller judgment and applicable Git conventions; the retained requirement still calls for concrete Git evidence and safe recovery when a fixup cannot be applied reliably.

## Evidence and limits

`internal/workflow.md` delegates coherent commits and publication to project policy. The runtime records publication authority but exposes no repair-commit validation operation. No shipped instruction or check covers repair commits, as described below; closing that gap is not a requirement to build the old transaction engine.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Decisions and acceptance

Establish the minimal shared checks and actual remaining failure cases. Verify blame-based targeting, intervening edits, hook failure, authorized autosquash and interrupted operations using isolated repositories; never infer rewrite or publication authority from a review checkpoint.

The migration accounting audit of 2026-09-29 found that this is missing instruction as well as missing evidence: [the operating brief](../../internal/workflow.md) says only "Commit coherent local work under the user's Git policy and required hooks", and no instruction or check a run loads mentions fixups, autosquash, a follow-up commit or history rewriting. The agreed disposition under [Repair commits and history rewriting](../../V3-MIGRATION.md#repair-commits-and-history-rewriting) also retains two rules this entry did not name: where fixup form is unsafe, "use an ordinary follow-up commit only when policy and current state permit it; otherwise preserve the repair and report the affected blocker while continuing independent work", and "Do not defer accepted repairs merely for tidier history."

Since 3.3.2 the operating brief names history rewriting in one place: after every commit the controller confirms it landed on the run's intended branch and checkout, and a reconciliation of a mismatch that would rewrite history or discard work needs the user's decision, as does any destructive or irreversible action that recorded authority does not cover. That is an authority rule only; fixup targeting, autosquash verification and repair recovery remain uncovered, so this entry's checks and evidence obligations stand.

## Added at the section-level audit's triage

[The section-level audit of v2 records](../reports/v2-section-audit-20261004.md) found two parts of v2's [verified fixup transactions](verified-fixup-transactions.md) that the dispositions under [Repair commits and history rewriting](../../V3-MIGRATION.md#repair-commits-and-history-rewriting) did not carry into tracking. The user chose on 2026-10-04 to fold both into this entry and noted, in their words: "we had some autosquash conflicts yesterday".

- One entry point. v2's design required that no Nightshift path create a fixup outside one checked mechanism; it never shipped, and v2's revise instructions still had the controller run `git commit --fixup` directly. The shared checks this entry establishes are to be the only way Nightshift creates a fixup, for the controller and its helpers alike, so that no fixup skips the target and autosquash checks.
- Conditions on an authorized rewrite. The retirement of checkpoint autosquash keeps that "An authorized rewrite still needs a safe range, reconciled concurrent activity, recoverable original refs, and verification that content and required history properties are preserved." Nothing shipped or tracked states the first three. An authorized rewrite, including a pre-push autosquash the repository requires, is to confirm that its range is safe, such as holding only commits that never left the machine, that no other writer is changing the branch, and that the original refs stay recoverable, besides verifying the result.

## Settled questions

The user agreed these answers on 2026-10-05, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: about commits, [the operating brief](../../internal/workflow.md) still carries only "Commit coherent local work under the user's Git policy and required hooks" and the 3.3.2 landing-confirmation rule described above, and no instruction or check a run loads covers fixup targeting or autosquash verification.

- The minimal shared checks, and how they are reached. Settled: one runtime operation is the only way Nightshift creates a fixup, for the controller and its helpers alike, and the operating brief says so. Whether a project uses fixups at all still comes from its Git policy; the checks apply whenever fixups are used.
- How a fixup's target is chosen. Settled: by blame over the unpushed range, the commit that last touched the repaired lines, never the commit that introduced the feature, so a later commit that reshaped the region is the target. Hunks with different targets are split, or fall back as below, and a target that has already been pushed means no fixup.
- How the intended autosquash is verified. Settled: before anything is written to the branch, the operation runs the autosquash against a disposable copy with the repair as a fixup, and creates the real fixup commit only when that applies cleanly. The real commit takes only the repair's own paths and runs the required hooks, never skipping them. A failed check therefore leaves no fixup to remove, and recovery never needs a history-altering reset.
- What happens when a fixup is unsafe, whether its target was pushed, its hunks have different targets, the dry run conflicts or a hook fails. Settled, in the words of the agreed disposition: "use an ordinary follow-up commit only when policy and current state permit it; otherwise preserve the repair and report the affected blocker while continuing independent work", and "Do not defer accepted repairs merely for tidier history."
- The conditions on an authorized rewrite, including a pre-push autosquash the repository requires. Settled: before rewriting, it confirms that the range holds only commits that no remote branch contains, that no other writer is active, through the runtime's project lease and a branch tip unchanged between the check and the rewrite, and that the original tip is recorded so it stays recoverable; afterwards it verifies that the final tree is unchanged and that no `fixup!` subject remains. Rewrite and publication authority are never inferred from a review checkpoint.
- The remaining failure cases to verify. Settled: isolated-repository fixtures cover blame targeting, an intervening commit that reshaped the region, a pushed target, a dry-run conflict, a hook failure, an interrupted operation that leaves nothing written to the branch, and each rewrite precondition.

## Before implementation

Settle the operation's interface, the disposable copy used for the dry run, how hunks are split by target, and the rewrite preconditions' checks in a concise governing spec in `.nightshift/specs`. The change alters the runtime, the operating brief and revise-code, so it rides with a plugin version increase, and the start of the work decides between a budgeted installed-host check that the controller routes every fixup through the one entry point, which is model-owned, and deterministic evidence only. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Verified fixup transactions: MVP - verified fixup creation](../reports/v3-migration-followups-20260920.md#verified-fixup-transactions-mvp---verified-fixup-creation).

[The migration decision](../../V3-MIGRATION.md#repair-commits-and-history-rewriting) preserves the surviving requirement; earlier records: [verified-fixup-transactions](verified-fixup-transactions.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
