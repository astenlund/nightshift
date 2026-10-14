---
name: run-worktree-delivery
description: Implement each run in a dedicated Git worktree on a run-owned branch and deliver a reviewable diff instead of changing the user's checkout
metadata:
  type: feature
---

# Deliver each run on its own branch or worktree

## Origin

From a user-supplied ideas document, "Workflow ideas adopted from other agent tools", raised on 2026-09-26 in a discussion comparing Nightshift with other agent workflows (Codex cloud, Devin, Copilot coding agent, Claude Code on the web, Superpowers, SWE-agent, Aider). The document notes that its comparison comes from general knowledge, not a systematic survey, so it is motivation rather than evidence. Tracked as Exploring at the triage of run `f87356d8-8613-45a8-93e5-d79c48f2254b` on 2026-09-27.

## Observation

Nightshift works directly in the user's checkout. The runtime refuses to create another run on that checkout while the current one is neither complete nor stopped, or still has active workers (`create` in `internal/runtime/store.js`), and the operating brief tells controllers never to replace an unfinished run. Review and probe copies are isolated, but the implementation itself is not. Cloud agents typically work in isolation and deliver a branch or draft pull request.

## Proposal

Run implementation in a dedicated Git worktree on a run-owned branch. The morning report then points at a reviewable diff that the user can merge, adjust or discard. The user can keep working in the main checkout during an unattended run, which supports autonomy; discarding or rolling back a delivery becomes trivial; and the agent proposes a change rather than taking over the user's working copy, which reinforces the authority model.

## Settled questions

The user agreed these answers on 2026-10-14, when the entry graduated from Exploring to current work. Each question is kept with its answer, and the first two were settled with them. Checked the same day: the run store lives at `.nightshift/runs/state.sqlite` in the checkout and binds each run to that root, refusing another with `wrong-project` (`internal/runtime/store.js`), and creation is refused with `overlapping-run` while an unfinished record or an active or uncertain worker owns the context; [the operating brief](../../internal/workflow.md) already captures the intended branch and checkout at handover; review and probe copies are complete project copies below the ignored `.nightshift/runs/c`; and publication needs recorded authority and current independent review.

- Whether a worktree run is opt-in or the default. Settled: the user chooses at handover, and the controller may recommend a worktree in the readback; running in place stays the default until installed-host evidence shows worktree runs are reliable, since a fresh worktree lacks ignored dependencies such as `node_modules` or virtual environments.
- Where worktrees live. Settled: inside the project under `.nightshift/runs/w/<run>`, which is ignored and writable under the Codex sandbox, unlike a sibling directory outside the project. Tools that scan the whole tree may see a second copy there, as they already may with probe copies.
- How it interacts with the checkout lease, the run's recorded project path and adoption. Settled: the run store stays in the main checkout, so status, Ready, hooks and adoption find it as today, and the run also records its worktree path, branch and starting commit. Checks, probes and reviews act on the worktree. A project keeps one active run; parallel runs in separate worktrees stay with [Execution plan for a multi-item selection](multi-item-execution-plan.md). An adopting session continues in the recorded worktree.
- Whether review copies should derive from the worktree rather than from the main checkout. Settled: from the worktree, with the cumulative diff measured from the branch's starting commit.
- Where worktrees live, how they are cleaned up, and how uncommitted user changes in the main checkout are treated at run start. Settled, beyond the location above: the worktree starts from the agreed base commit, the user's uncommitted changes are not carried over and the user's checkout is never stashed or touched, and the readback warns when uncommitted changes touch files the work concerns, so the user can commit first. The worktree's dependencies are installed by a setup command settled in the readback. After delivery the branch and worktree remain, the morning report names the branch and how to merge or discard it, nothing is removed or merged into the user's branch without the user's direction, and leftover worktrees show in status.
- Whether publication authority can extend to pushing the branch or opening a draft pull request. Settled: either is publication, needing recorded authority that names the action and current independent review, and that authority never extends to pushing the base branch.
- How this relates to the isolated worktree in the v2 [verified fixup transactions](verified-fixup-transactions.md) design archive and to its retained successor, [Verify repair-commit and autosquash safety in ordinary delivery](v3-git-repair-evidence.md). Settled: the disposable copy for that entry's autosquash dry run may be a worktree, which its own governing spec decides; the entry requires nothing.

## Before implementation

Settle the recorded worktree fields, how each runtime operation finds the worktree, the setup command's place in the readback, the status listing of leftover worktrees and the morning report's merge and discard guidance in a concise governing spec in `.nightshift/specs`. The change alters the runtime, its reference, the operating brief and the handover skill, so it rides with a plugin version increase. Whether the controller edits in the worktree rather than the user's checkout is model-owned behavior, so the work needs evidence on both hosts, with its budget decided when it starts. Tracking and readiness do not authorize implementation.
