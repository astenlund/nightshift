---
name: run-worktree-delivery
description: Implement each run in a dedicated Git worktree on a run-owned branch and deliver a reviewable diff instead of changing the user's checkout
metadata:
  type: feature
status: exploring
---

# Deliver each run on its own branch or worktree

## Origin

From a user-supplied ideas document, "Workflow ideas adopted from other agent tools", raised on 2026-09-26 in a discussion comparing Nightshift with other agent workflows (Codex cloud, Devin, Copilot coding agent, Claude Code on the web, Superpowers, SWE-agent, Aider). The document notes that its comparison comes from general knowledge, not a systematic survey, so it is motivation rather than evidence. Tracked as Exploring at the triage of run `f87356d8-8613-45a8-93e5-d79c48f2254b` on 2026-09-27.

## Observation

Nightshift works directly in the user's checkout. The runtime refuses to create another run on that checkout while the current one is neither complete nor stopped, or still has active workers (`create` in `internal/runtime/store.js`), and the operating brief tells controllers never to replace an unfinished run. Review and probe copies are isolated, but the implementation itself is not. Cloud agents typically work in isolation and deliver a branch or draft pull request.

## Proposal

Run implementation in a dedicated Git worktree on a run-owned branch. The morning report then points at a reviewable diff that the user can merge, adjust or discard. The user can keep working in the main checkout during an unattended run, which supports autonomy; discarding or rolling back a delivery becomes trivial; and the agent proposes a change rather than taking over the user's working copy, which reinforces the authority model.

## Open questions

- How it interacts with the checkout lease, the run's recorded project path and adoption.
- Whether review copies should derive from the worktree rather than from the main checkout.
- Where worktrees live, how they are cleaned up, and how uncommitted user changes in the main checkout are treated at run start.
- Whether publication authority can extend to pushing the branch or opening a draft pull request.
- How this relates to the isolated worktree in the v2 [verified fixup transactions](verified-fixup-transactions.md) design archive and to its retained successor, [Verify repair-commit and autosquash safety in ordinary delivery](v3-git-repair-evidence.md).
