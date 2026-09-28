---
name: review-mode
description: Validate a feature implementation made by someone else against user-supplied material, reporting first and then offering repairs one finding at a time
metadata:
  type: feature
status: exploring
---

# Review mode for someone else's implementation

## Origin

Raised by the user on 2026-09-28, outside any run: "idea: review mode. this would be for validating a feature implementation made by someone else (human or non-participating ai)." The direction below records the user's answers to clarifying questions asked the same day.

## Current behavior

[revise-code](../../skills/revise-code/SKILL.md) establishes the agreed outcome and the full cumulative change, validates each finding with a fresh skeptic, and applies authorized repairs itself. Through [handover](../../skills/handover/SKILL.md), Nightshift can take over work already underway, establishing its requirements, actual state and evidence, and then carries it through unattended delivery, repairs included, rather than stopping at a verdict. A plain `review` asks one independent agent to review the code and report back with no repairs, and the [review request vocabulary decision](../../V3-MIGRATION.md#review-request-vocabulary-and-ownership) keeps the plugin from activating for it. None of them reviews someone else's change against material the user brings and then offers repairs finding by finding.

## Direction

- **Subject.** A feature implementation made by someone else: a human, or an AI not participating in the session.
- **Baseline.** Whatever material the user provides, in the user's words "one or more bits links, word documents, text in chat, etc."
- **Input.** A local branch, commit range or worktree already on this machine; a GitHub pull request fetched by number or URL, together with its description and existing review comments; or uncommitted changes in the working tree.
- **Scope.** Beyond reviewing the code: running the project's checks and tests and recording their evidence; live verification of boundaries the tests fake, as [Verify faked boundaries live](live-boundary-verification.md) describes; checking that README, specs and backlog entries match what was delivered, and whether the backlog entry can move to history; and posting the verdict to the pull request as review comments. Posting was offered as an outward-facing step that needs the user's explicit go-ahead each time.
- **Findings.** Report first, then offer repairs as patch files or direct edits, taking the findings one at a time once repair is initiated; in the user's words "report, then offer repairs in the form of patch files or direct edits. one by one once initiated."

## Open questions

- Whether it is a new public skill or a mode of revise-code, and its name. The review request vocabulary decision keeps plain `review` and `review-loop` requests from activating the plugin, and a plain `review` already reports back with no repairs, so the entry point must stay distinct from both.
- Whether it creates a runtime run, given [Run-free revise](run-free-revise.md), and which runtime records (receipts, skeptic verdicts, dispositions) it keeps.
- Whether findings get fresh skeptic validation before the report, as revise-code's do, and who disposes each finding when the user decides its repair.
- How baseline material is ingested (fetching links, reading Word documents), whether the controller reads it back as the governing requirement before assessing, how gaps, contradictions or silent areas in it are reported, and how a pull request's own description and review comments are treated when they are not part of the user's material.
- What trust boundary applies to running someone else's code. A runtime check runs its command in the user's own checkout (`reservedCheck` in `internal/runtime/operations.js`), a probe runs in a private copy that the runtime reference's [Independent assessment](../../internal/runtime/REFERENCE.md#independent-assessment) section says is not a security sandbox, and both run with the user's privileges, as live verification would.
- How a pull request or someone else's branch is checked out and assessed without disturbing the user's checkout or uncommitted work, how uncommitted changes by another author are protected until repair is chosen, and how review copies are made from a change that is not checked out, since the dispatcher captures its inputs from the checkout. [Deliver each run on its own branch or worktree](run-worktree-delivery.md) has overlapping open questions on worktree-derived review copies, uncommitted user changes and draft pull request publication.
- Who initiates the repair walk and who chooses between a patch file and a direct edit, per finding or once; where patch files are written and in what form; whose branch a direct edit lands on and whether a repair commits; and how revise-code's checks and cumulative reassessment after every repair batch apply to one-at-a-time repairs and to a patch file that is never applied. Pushing to the author's pull request branch would be publication and needs its own authority.
- The verdict's shape (for example accept, accept with findings, or reject) and how posting to the pull request maps findings to review comments.
- How the documentation and backlog check works in a project without a Nightshift backlog, and whether the documentation part uses the review kind that [Independent documentation review](independent-documentation-review.md) is to add.
- How live verification is budgeted and how its evidence and limits are reported.
