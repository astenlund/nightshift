# Unattended Stop hook acceptance

The 3.2.10 candidate lets a verified Stop hook carry unattended work for a Claude Code controller, keeps the native goal requirement on Codex, and makes the acknowledgement of a verified unattended handover say plainly that the handover is accepted and the user can leave, without naming run mode or mechanism. On Claude Code it is the turn-ending message and the Stop hook resumes the work; a Codex controller acknowledges and continues in the active turn as before. A continuation mechanism records its `kind`, `goal` or `stop-hook`; the runtime refuses an unknown kind and a `stop-hook` for a Codex controller. This resolves [Unattended mode requires a native goal on hosts that do not need one](../BUGS_HISTORY.md#unattended-mode-requires-a-native-goal-on-hosts-that-do-not-need-one) for Claude Code; the Codex side is unverified.

## Method

Environment: Windows 11, Node v22.23.2, PowerShell 7, Claude Code 2.1.283 with `claude-opus-5-5` (the user's default controller model) and two `claude-fable-5-1` attempts, Codex CLI 0.155.1. Each Claude attempt ran the staged candidate payload as an installed plugin in an isolated profile with its own retained store, driven through `--print` with scripted user turns by the retained `.tmp/handover-live` harness. A fixture project held one ready quick win; the scripted user agreed its readback, handed it over and said they were going to bed. Grading used each attempt's native event log and the fixture's own `state.sqlite`, not the model's prose. The payload was restaged after each wording change, and the last attempt ran the committed candidate.

The user authorized an aggregate live-verification allowance of 32,000,000 tokens, accounted in the harness ledger from each host's usage records, cached input included. The campaign metered 18,857,805 tokens across 21 attempts and holds 1,028,000 as uncertain: 900,000 for a Codex attempt whose usage the harness cannot reconcile and 64,000 for each of two Claude attempts ended at their ceiling. 19,885,805 is charged in total. Implementation and independent assessment are outside this allowance.

## Results

| Case | Claude Code | Codex |
|------|-------------|-------|
| Handed-over new run recorded unattended with a verified `stop-hook` mechanism | Observed, 8 runs | Not applicable |
| Unattended run carried through the lifecycle and morning report without the user | Observed, 6 runs | Not run |
| Session without activation refused; the acknowledgement names the reopen recovery and claims no acceptance | Observed, 2 runs | Not run |
| Verified goal path unchanged under the new kind rule | Deterministic tests only | Blocked |
| Acknowledgement says plainly that the handover is accepted and the user can leave | Observed, 2 runs (Opus, Fable) | Blocked |

Eight attempts, six Opus and two Fable, recorded their handed-over run in `unattended` mode with a verified `stop-hook` mechanism whose evidence cited the registration, enablement and session activation from the retained-resource status. Six ran to `complete` through the morning report; the other two were ended by the harness at their metered ceiling while still running, as intended for acknowledgement-only probes. Two further attempts ran in sessions that began before the fixture's hooks existed; the runtime refused admission and the controller told the user not to leave yet and how to recover, without claiming acceptance.

The acknowledgement did not appear under five earlier wordings, each run once on Opus: the acknowledgement as a separate paragraph after the procedure; the same marked as a message of its own; with the reason that the user is waiting for it; with the operation it follows named for a new run; and as a step inside the procedure with a calibrating example, which Fable also ran once. In those six attempts the controller went straight from recording the mechanism into the work, and its user-visible text between tool calls stayed short progress notes. The Fable attempt composed the acknowledgement ("I've accepted the handover ... Starting now") only in a thinking block.

An Opus attempt ran the wording that made the acknowledgement the turn-ending message of a verified unattended handover on both hosts; independent review then scoped the turn-ending yield to Claude Code, leaving the Claude instruction unchanged in substance. In it, the Opus controller recorded the mechanism and ended its turn with "Handover accepted. I'll add the line ... and move the ... quick win to history, as a small documentation task. ... You can go. A morning report will be waiting here in this session." The Stop hook blocked the yield with its continuation reminder, and the controller resumed, completed the task and closed the run through the morning report. A Fable attempt on the committed candidate did the same, ending its turn with "Handover accepted: I'll finish the agreed work. You can go; a morning report will be waiting here." followed by a sentence restating the scope and the unpublished delivery, then resuming through completion. Its wording follows the skill's calibrating example closely. These are two observations of a model-owned behavior, one per model.

## Qualifications and observations

- The Codex lane is blocked. Codex fixtures received a copy of the production ChatGPT credential; one refreshed it, rotating the shared refresh token, after which the provider rejected it and a production `codex exec` failed with `refresh_token_reused`. The production Codex login needs a fresh `codex login`. No Codex evidence exists for this candidate, and the Claude results are not evidence for Codex. Because a Codex goal has previously ended blocked and needed manual resumption, the turn-ending yield is not prescribed on Codex; its controller records the goal with `kind: "goal"` and acknowledges within the active turn, which is also unverified until the lane runs.
- The turn-ending acknowledgement adds one fresh `claim-controller` per handover when the Stop hook resumes the work. In both resumed attempts the first claim was refused with `stale-owner`, because the Stop hook's reminder had advanced the revision, and the controller re-read status before claiming. In the Opus attempt the claims invoked through Git Bash then returned no identified host process, and the same claim through PowerShell 7 succeeded. Whether the Git Bash failure predates this candidate was not established.
- One fixture controller passed the verified mechanism to `create` as a `continuation` field, which `create` ignored; it then recorded the mechanism with the `continuation` operation. The runtime reference now says the evidence is recorded afterwards by an operation, not a `create` field. Whether `create` should reject unknown fields is a separate follow-up.
- The harness auto-approval judged a command by its first word, so commands beginning with a variable assignment or `printf` timed out as denials and some first-use sessions registered no hooks. The harness now looks past leading assignments and accepts a few more ordinary verbs under the same fixture-path confinement; the retries are counted in the ledger.

## Evidence

Raw native records, decisions and results are retained under `.tmp/handover-live/`, with the ledger in `.tmp/handover-live/budget.json`. SHA-256 digests of every attempt's event log, oldest first; the two handover entries marked Opus and Fable at the end are the acknowledgement evidence:

- `2229829c014e2bf6cc50796e6015186f653ab8bd63a6ca84202811eb0f448c1e` `claude-343f0e02/live-2026-09-25T22-52-00-160Z-t26-claude-new-run-handover/events.jsonl` (refused admission)
- `e91ea75bd15f3bd199d7d457da5b0545f2116cf777864009a1bcae6174bbbc8d` `claude-343f0e02/live-2026-09-25T22-53-44-994Z-t26-claude-new-run-handover/events.jsonl`
- `acafc62e2ebe943f8d78f3c320fc26a1c70e33a638a18ab3722805c6bc4947d3` `claude-32784a2a/live-2026-09-25T23-01-35-156Z-t26-claude-first-use/events.jsonl`
- `42435e9e454115c199ff71fa87f1a3139e7b3bb1f6cdd14c86517d2fe34a7690` `claude-32784a2a/live-2026-09-25T23-02-12-743Z-t26-claude-new-run-handover/events.jsonl`
- `c7cc126b70c098b4aedcadb67c5486dcbf9db4504b2476623c9c8a99649b262e` `claude-9dd86e22/live-2026-09-25T23-07-34-720Z-t26-claude-first-use/events.jsonl`
- `f256f4094dc3387a7678141bc65d46ee613837fcf7b42611aa09411fad04f9f9` `claude-9dd86e22/live-2026-09-25T23-08-36-033Z-t26-claude-new-run-handover/events.jsonl`
- `097d7bd36a7f9a866eda5b8d595719648723bd4880ab3be1f6b2af8d0a0169c9` `claude-60b933af/live-2026-09-25T23-15-58-094Z-t26-claude-first-use/events.jsonl` (no hooks registered)
- `edf18ca2aa2dc19614cb8a80c0869a8dbb8ac59467d45435178503e51d21b883` `claude-60b933af/live-2026-09-25T23-16-52-365Z-t26-claude-new-run-handover/events.jsonl` (refused admission)
- `5bfa8b6580e48e18d926068a41f4c54b80313438905e317ee67074db961aa270` `claude-60b933af/live-2026-09-25T23-18-40-623Z-t26-claude-new-run-handover/events.jsonl`
- `cdca739585403b69159899ddcac6486ce81e5db3106b8f0d82468bdb9f03bca8` `claude-813f07eb/live-2026-09-25T23-25-44-721Z-t26-claude-first-use/events.jsonl` (no hooks registered)
- `7b46ff588121399ef276583dd6c67e9e682714c68341dfaf9bb83f249b3724a1` `claude-813f07eb/live-2026-09-25T23-26-52-866Z-t26-claude-first-use/events.jsonl`
- `1c39cb3420739a1c0f6eb662770dec40df4f2d0e4549d409f438b961e98a269e` `claude-813f07eb/live-2026-09-25T23-27-32-022Z-t26-claude-new-run-handover/events.jsonl` (ended at ceiling)
- `277ceabe821bb1d2e95a04e3c55cc2e57a14edf0a38f6e33e570456a0b06d407` `claude-a787806e/live-2026-09-25T23-31-02-788Z-t26-claude-first-use/events.jsonl` (no hooks registered)
- `5b73d60409a0da4c48cc8b21520b1feeee789d18c4f143836ca28282fefd930b` `claude-a787806e/live-2026-09-25T23-32-12-955Z-t26-claude-first-use/events.jsonl`
- `42bcca09ad6a311472c2ecd34e6a93b8e92f5c8d6070e16d656e33c4a9cdcf6f` `claude-a787806e/live-2026-09-25T23-32-51-821Z-t26-claude-fable-handover/events.jsonl` (Fable, ended at ceiling)
- `eaec41f52f65e5e7e63f61dff27885df13dee9de3d2855ece5b9be07ac79713d` `codex-ca7b20fd/live-2026-09-25T23-39-09-944Z-t26-codex-first-use/events.jsonl` (stream disconnect)
- `51462d145e873f8db06197b85ef59b7f5c71f0052030f7df624ada1ece46970d` `codex-ca7b20fd/live-2026-09-25T23-39-23-908Z-t26-codex-first-use/events.jsonl` (401 after the credential refresh)
- `df230b1830224ae84e6cfabb53d5afc5e7b35fb41481e217174f078a9898a659` `claude-443f4b3f/live-2026-09-26T01-18-32-680Z-t26-claude-first-use/events.jsonl`
- `c41f6b4a24b1862f9508c2fc094ff1e7472ba32b0c418956f35a06b16120a8b9` `claude-443f4b3f/live-2026-09-26T01-19-18-510Z-t26-claude-new-run-handover/events.jsonl` (Opus, turn-ending wording before its Claude-only scoping)
- `0058e82d2544e3da175a35024c05ecb5e4c7b3c0a88fab8ecb89422fa5b5ccaf` `claude-ca2cf3ce/live-2026-09-26T02-06-52-583Z-t26-claude-first-use/events.jsonl`
- `8a1c17d4e076292971bf3316c6dd9d70db8f17062fbf06f7fa8366b061c9a1e7` `claude-ca2cf3ce/live-2026-09-26T02-07-31-079Z-t26-claude-fable-handover/events.jsonl` (Fable, committed candidate)
