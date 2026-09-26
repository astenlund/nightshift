# Unattended Stop hook acceptance

The 3.2.10 candidate lets a verified Stop hook carry unattended work for a Claude Code controller, keeps the native goal requirement on Codex, and makes the acknowledgement of a verified unattended handover say plainly that the handover is accepted and the user can leave, as the turn-ending message, without naming run mode or mechanism. A continuation mechanism records its `kind`, `goal` or `stop-hook`; the runtime refuses an unknown kind and a `stop-hook` for a Codex controller. This resolves [Unattended mode requires a native goal on hosts that do not need one](../BUGS_HISTORY.md#unattended-mode-requires-a-native-goal-on-hosts-that-do-not-need-one).

## Method

Environment: Windows 11, Node v22.23.2, PowerShell 7, Claude Code 2.1.283 with `claude-opus-5-5` (the user's default controller model) and one `claude-fable-5-1` attempt, Codex CLI 0.155.1. Each Claude attempt ran the staged candidate payload as an installed plugin in an isolated profile with its own retained store, driven through `--print` with scripted user turns by the retained `.tmp/handover-live` harness. A fixture project held one ready quick win; the scripted user agreed its readback, handed it over and said they were going to bed. Grading used each attempt's native event log and the fixture's own `state.sqlite`, not the model's prose. The payload was restaged after each wording change, so each attempt below names the acknowledgement wording it ran.

The user authorized an aggregate live-verification allowance of 32,000,000 tokens, accounted in the harness ledger from each host's usage records, cached input included. Implementation and independent assessment are outside this allowance.

## Results

| Case | Claude Code | Codex |
|------|-------------|-------|
| Handed-over new run recorded unattended with a verified `stop-hook` mechanism | Observed | Not applicable |
| Unattended run carried through the lifecycle and morning report without the user | Observed | Not run |
| Session without activation refused, acknowledgement names the reopen recovery and claims no acceptance | Observed | Not run |
| Verified goal path unchanged under the new kind rule | Deterministic only | Blocked |
| Acknowledgement says plainly that the handover is accepted and the user can leave | Pending | Blocked |

Six attempts, five Opus and one Fable, recorded their handed-over run in `unattended` mode with a verified `stop-hook` mechanism whose evidence cited the registration, enablement and session activation from the retained-resource status. Four ran to `complete` through the morning report; the other two were ended by the harness at their metered ceiling while still running, as intended for acknowledgement-only probes. Two further attempts ran in sessions that began before the fixture's hooks existed; the runtime refused admission and the controller told the user not to leave yet and how to recover, without claiming acceptance.

The acknowledgement did not appear under five successive wordings, each run once on Opus: the acknowledgement as a separate paragraph after the procedure; the same marked as a message of its own; with the reason that the user is waiting for it; with the operation it follows named for a new run; and as a step inside the procedure with a calibrating example, which Fable also ran once. In all six attempts the controller went straight from recording the mechanism into the work, and its user-visible text between tool calls stayed short progress notes. The Fable attempt composed the acknowledgement ("I've accepted the handover ... Starting now") only in a thinking block. The committed wording makes the acknowledgement the turn-ending message of a verified unattended handover and lets the Stop hook resume the work; its result is recorded below.

## Qualifications and observations

- The Codex lane is blocked. Codex fixtures received a copy of the production ChatGPT credential; one refreshed it, rotating the shared refresh token, after which the provider rejected it and a production `codex exec` failed with `refresh_token_reused`. The production Codex login needs a fresh `codex login`. No Codex evidence exists for this candidate, and the Claude results are not evidence for Codex.
- One fixture controller passed the verified mechanism to `create` as a `continuation` field, which `create` ignored; it then recorded the mechanism with the `continuation` operation. The runtime reference now says the evidence is recorded afterwards by an operation, not a `create` field. Whether `create` should reject unknown fields is a separate follow-up.
- The harness auto-approval judged a command by its first word, so commands beginning with a variable assignment or `printf` timed out as denials and some first-use sessions registered no hooks. The harness now looks past leading assignments; the retries are counted in the ledger.

## Evidence

Raw native records, decisions and results are retained under `.tmp/handover-live/`, with the ledger in `.tmp/handover-live/budget.json`.
