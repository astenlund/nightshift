# Ready selection boundary acceptance

The 3.2.4 candidate changes the selection guidance in `skills/ready/SKILL.md`. A Ready report with ready work always closes with a small recommendation citing ready-set numbers, and a report with nothing ready says so and recommends nothing. A reply that expresses intent without identifying items leads to a proposed selection the user confirms, and nothing is edited before the user agrees the readback. Once the readback is agreed the agent proceeds in the current session without asking about handover, a separate task or a new conversation; handover happens when the user directs it. This resolves three backlog items: [Ready reports omit actionable recommendations](../BUGS_HISTORY.md#ready-reports-omit-actionable-recommendations), [Ready follow-up proceeds to implementation without selection or readback](../BUGS_HISTORY.md#ready-follow-up-proceeds-to-implementation-without-selection-or-readback) and the quick win Continue agreed Ready work in the current session, now in [QUICK_WINS_HISTORY.md](../QUICK_WINS_HISTORY.md).

## Method

Environment: Windows 11, Node v22.23, PowerShell 7, Claude Code 2.1.281 with `claude-opus-5-5`, Codex CLI 0.155.1 with `gpt-6-astra`. Fable was not used for the Claude fixtures because its weekly allowance was exhausted; Opus is the user's default controller model. Each host ran the staged 3.2.4 payload as an installed plugin in an isolated profile with its own retained store. Two fixture shapes were used: a work backlog with three quick wins, one bug and one Exploring draft, and an empty backlog whose only work entry is an External-blocked bug plus the same draft. User turns were scripted. Grading used each attempt's native event log (tool calls and file changes per turn) and, for the handover case, the fixture's own `state.sqlite` history, not the model's prose.

The user authorized an aggregate live budget of 2,000,000 tokens and, when the Codex handover case did not fit it, a further 2,000,000 (4,000,000 in total). The campaign metered 2,857,992 tokens across seven attempts and holds 128,000 as uncertain for the two requests interrupted at their ceilings, 2,985,992 charged in total. Cached input is included. Implementation and independent assessment are outside this allowance.

## Results

| Case | Claude | Codex |
|------|--------|-------|
| Report with ready work closes with a numbered recommendation and reasons | Observed | Observed |
| Reply naming no items leads to a proposed selection, no edits | Observed | Observed |
| Confirmed selection leads to investigation and readback, no edits | Observed | Observed |
| Agreed readback proceeds in session, no handover or separate-task question | Observed | Observed |
| Empty ready set says so and recommends nothing | Observed | Observed |
| Explicit user handover after readback is honored | Observed | Observed |

In both work attempts the event logs show project edits only in the turn after the readback was agreed; earlier turns wrote only launcher request files in the project's ignored `.tmp`. In both handover attempts the controller proposed a readback without edits, then honored the user's handover words in the next turn: the Claude fixture history reads `created, invalidate-continuation, handover` and the Codex fixture history begins `created, handover`, each with those words as authority, and project edits appear only after the handover turn began. Both attempts then reached their metered ceilings during work that was not under test: implementation on Claude, and the fixture run's own closing after its small fix completed on Codex.

## Qualifications and observations

- The first Claude empty-backlog attempt used a fixture whose External line sat on a quick win. Quick wins are always ready by grammar, so it produced one ready item; the fixture was corrected and the case rerun. That attempt is retained and counted in the budget. Its controller noticed the External line and declined to recommend implementation unconditionally. That wasted attempt is why the Codex handover case first did not fit the initial allowance.
- Both handover acknowledgements in fixtures recorded the run in attended mode; this is the continuation-eligibility behavior tracked separately, not part of this candidate.
- In the Codex work attempt the controller quoted the Ready skill's own instructions to the user in two turns. This matches the tracked quick win about agent-directed rules leaking into user-facing prose; the candidate does not address it.
- The retained campaign harness auto-approval rejected shell commands beginning with a variable assignment, so two early Claude launcher calls timed out as denials before a scoped approval watcher applying the same confinement rule took over. The controller retried and the evidence was unaffected.
- Both handover acknowledgements observed during this delivery, in this repository and in the fixture, reported the handover as recorded with the run attended because Claude exposes no verifiable native goal. The user found that confusing; it is a separate follow-up, not a defect of this candidate.

## Evidence

Raw native records, decisions and results are retained under `.tmp/ready-live/`. SHA-256 digests of the graded event logs:

- `dd9f742074f791b94ccfc1ebfde8ccfa2ab01a9b425798c3b7db2a59a84e5595` `claude-empty-e15085d0/live-2026-09-24T02-17-27-901Z-s-empty/events.jsonl` (invalid fixture with one ready quick win; retained, not evidence for the empty case)
- `97da88311823b618a63ecdb6012f04c341df06544dfa14006469735e36b4e988` `claude-empty-e15085d0/live-2026-09-24T02-18-39-061Z-s-empty2/events.jsonl` (corrected empty fixture; the Claude empty-case evidence)
- `bdd915acc6e8ca35d51dc677ed274ce9b5238d83c7eaeed050f96a87229cfe2c` `claude-work-bd038c83/live-2026-09-24T02-14-48-455Z-s-work/events.jsonl`
- `160d338d9dc454c0790c74bc0aef94d7116f873b307a5bbf7b6b3dbbecd016d0` `claude-work-bd038c83/live-2026-09-24T02-24-54-416Z-s-handover/events.jsonl`
- `8f261ddbca91e52e9ce2d0c1e099125294b7fde741de575660e60afa44829937` `codex-empty-d43cd40a/live-2026-09-24T02-23-07-680Z-c-empty/events.jsonl`
- `06197aff1f56a844682deef0793c45e5b3d728c60f719c3d39626198f62f307e` `codex-work-f3c5d95f/live-2026-09-24T02-19-21-251Z-c-work/events.jsonl`
- `f43f9975ee85ff2939b3f38ec5ade587998c5c99ba53862b4ed7d3aeb9392210` `codex-work-f3c5d95f/live-2026-09-24T06-44-37-556Z-c-handover/events.jsonl`
