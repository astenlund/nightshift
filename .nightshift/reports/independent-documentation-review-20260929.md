# Independent documentation review: acceptance

Acceptance evidence for the [governing spec](../specs/independent-documentation-review.md) of [Independent documentation review](../features/independent-documentation-review.md), delivered in run `f440497c-a0cc-4375-bada-e834e32b49a6` as the local 3.2.16 candidate on 2026-09-29. Nothing is published.

## What was delivered

- A `docs` assessment kind with five documentation dimensions (`claim-accuracy`, `sweep-completeness`, `backlog-conventions`, `sibling-consistency`, `proportionality`) and a documentation-lens brief that also asks the reviewer to report changed operating-instruction files.
- A docs gate on code and docs tasks of runs created by 3.2.16, with a mechanical exemption bound to the project inventory, and a per-kind rule for which findings and repairs each gate counts.
- Backlog relief: a code assessment stale only because backlog paths changed counts as current when a current docs review covers the task (lore only through the closing review, spec never).
- A run-level closing record for tracking edits after triage, with a triage baseline, a backlog-only import boundary, admission on running runs after triage and on complete runs without an engineering claim, completion requiring a current resolved closing review whenever anything changed since triage, a baseline that survives re-recorded triage and a cleared record while the changes since it lack review, and `wait` support for its workers on complete runs. Outside Git, where no review can be dispatched, the triage baseline is read from the backlog files on disk and any backlog change after triage refuses completion; a Git failure inside a repository leaves no baseline and fails closed.
- Guidance in the operating brief, the runtime reference and the revise-docs and handover skills.

## Independent review

The spec took six whole-spec assessments on Codex `gpt-6-astra`; nine findings were confirmed by fresh skeptics and repaired, and the last two passes found no gaps. The user accepted it on 2026-09-29. After the user's two decisions of 2026-09-30 below amended it, a seventh assessment of the whole amended spec found no gaps; its first attempt was discarded with `review-input-drift` because the controller edited project files while it ran. An eighth found no gaps after the docs gate sentence gained the reopened-task checkpoint described below.

The implementation took repeated cumulative code assessments on `gpt-6-astra`; where an Astra attempt was ended as a whitespace output loop, the assessment fell back to `claude-fable-5-1`, and the run history records each attempt. Five dispatches returned incomplete with an execution probe, which the controller ran in a private copy and returned to a fresh dispatch for independent interpretation. Fifteen findings were confirmed by fresh skeptics and repaired. Four were fail-open defects found by those probes: a run whose task gates do not depend on the closing review completed with unreviewed tracking edits, a Git failure read as a project outside Git, an invalid `GIT_DIR` or broken `.git` pointer read the same way, and a project outside Git completed after post-triage backlog edits. For the last, the user chose on 2026-09-30 to fail closed rather than disclose an exemption. After a clean cumulative assessment, a controller probe found a fifth: recording triage again took a fresh baseline that absorbed earlier unreviewed tracking edits, so a run whose task gates do not depend on the closing review completed without one. The user chose on 2026-09-30 to keep such a baseline until a review covers its changes; the decision was recorded on the task, which reopened the governing spec, and the spec, the runtime, its reference and a regression test were amended. A further probe then showed that a completed task reopened by an assessment import returned to completion without its docs gate, which only run completion still caught; the task gate now holds on that path, and the completion refusal names the tasks that lack a docs review. The run completes only under a clean current cumulative assessment, and its history records every receipt.

## Deterministic evidence

The recorded runtime suite check passed on the final inputs: `node --test` over `tests/runtime.test.js`, `runtime-review`, `runtime-regressions`, `runtime-handover`, `runtime-adoption`, `runtime-probes`, `runtime-hooks`, `runtime-continuation` and the new `runtime-docs-review` suite (25 cases), which CI now runs. The release manifest check passed. Six mutation probes (removing the backlog relief, letting a closing review clear closing evidence, taking a fresh baseline at every triage, ignoring fresh task assessments when keeping an earlier baseline, skipping the docs gate when a reopened task returns to completion, and leaving the tasks unnamed in the completion refusal) turned the relevant new cases red before they were restored.

## Live campaign

Claude Code 2.1.285 on Windows with Node 22.23.2, the 3.2.16 candidate installed in isolated profiles, and `claude-opus-5-5` as the fixture controller. Reviews dispatched inside fixtures reached Codex CLI 0.158.0 `gpt-6-astra` through the user's own Codex profile. Fixtures authenticated with a long-lived token the user created once with `claude setup-token`, supplied through `CLAUDE_CODE_OAUTH_TOKEN`; a verification call first showed that this authenticates an empty profile and leaves the user's own credential file byte-identical with an unchanged modification time. The driver refuses to start a fixture whose profile holds a credential file, and a sweep of the campaign folder after the last scenario found none. Raw evidence stays in the ignored `.tmp/docs-review-live-f440497c`.

| Branch | Claude Code (Opus) | Evidence |
| --- | --- | --- |
| Attended close with triage and a tracking edit | Observed | Fixture run `5b4ffe28`: code review, docs review, code reassessment after the NOTES.md edit, retrospective, triage decision "track", a `QUICK_WINS.md` edit after triage and a closing docs review (`9f6c2e7d`) before `complete`. |
| Handover close with tracking after completion | Observed | Fixture run `a64f7816`: unattended delivery under a verified `stop-hook` continuation, which resisted one premature yield, morning report, completion with the follow-up pending; on return, report delivery, triage "track", a committed backlog edit and a closing docs review (`fac53be1`) on the complete run as bookkeeping. |
| Standalone revise-docs with instruction routing | Observed | Fixture run `322c458e`: the docs review (`7bb0c42a`) reported the edited `AGENTS.md` as operating instructions needing code assessment; a skeptic confirmed it, a code assessment (`7c9498bd`) followed, and a fresh docs review came back clean before completion. |
| Mechanical exemption | Observed | Fixture run `9d7c26da`: a VERSION bump completed as a docs task with a recorded exemption and reason and no review. The resumed session's first reply, which reported the completed pass, named the skipped docs review and its recorded reason; its later reply, answering a turn after completion, did not repeat it, and the fixture evidence keeps both. |
| Completed-run deferral of a non-backlog finding, and a required one left unresolved | Unverified | The handover fixture's stale README statement was corrected during the documentation stage, so the closing review raised no finding outside the backlog. |
| Every branch on Codex | Unverified | Out of scope by agreement; the runtime is host-neutral and covered by the deterministic suites. |

## Limits and incidents

- The first fixture's first session had to be reopened before Nightshift admitted run creation, which is the designed first-use activation behavior; later fixtures registered their hooks with explicit maintenance setup before their first session.
- Inside fixtures the Fable fallback cannot authenticate: Claude Code removes `CLAUDE_CODE_OAUTH_TOKEN` from the environment of commands its tools start, and fixture profiles deliberately hold no credential. Three revise-docs dispatches failed as Astra output loops followed by an unauthenticated Fable fallback before a fourth succeeded; the Fable fallback path is therefore not live-verified here.
- The first revise-docs session reached its 4,000,000-token controller ceiling and was resumed in a second process; its run state was intact.
- Outside Git a docs task cannot complete, since it can neither be reviewed nor record an exemption, which needs a Git inventory; the campaign covered only projects inside Git, and the outside-Git behavior rests on the deterministic suite.
- After a handed-over run completes, triage evidence can no longer be re-recorded, so the recorded triage still reads as deferred while the follow-up itself records the user's "track" decision.

## Usage

The agreed aggregate ceiling was 64,000,000 tokens. The ledger records 16,263,775 measured tokens (14,824,439 for fixture controllers and 1,439,336 for reviews dispatched inside fixtures) and holds 3,000,000 for three Astra attempts ended as output loops that reported no usage, 19,263,775 in total.
