# Missing session activation blocks agreed work until restart

- Date: 2026-09-18
- Source project: `C:/Git/nightshift` (the clone itself)
- Host: Claude Code, native `claude.exe`, pid 33276, started 2026-09-18T11:57:27+02:00
- Installed plugin: 3.1.1, identity `3.1.1-64747f538f7c592f0f3daf430b57567708ac7718bb8569cb43909981af96dbbd`, bundle `9821ad22-1d53-46ee-bbda-adb3e8534914`
- Registration: `70ed84ac1c863f69870f5ddefec6377176098e9b3d5724b96fe9fa74d912df6c`, generation `9f3b32317c02853df52c86f6b0a2f0fef30d0c5c9b3c2489038878b84dd45cd6`
- Session id in use: `8a6964ca-b815-4285-8a22-6b78bba11819` (expanded from the Ready skill's native marker)
- Operation: `run` with entry `runtime`, request `create`, for an attended self-hosting run

## What happened

The user ran `/clear` and then `/nightshift:ready`. Preparation with entry `ready` succeeded and created a session binding at the recorded time 2026-09-18T11:59:32Z. Ready ran normally. Later, after a spec was agreed, preparation with entry `runtime` and `request: {action: "create"}` also returned `state: prepared`. The following `run` was refused:

```text
{"error":"retained-bootstrap-unavailable","message":"This native session has not observed the current Nightshift hook generation; open or reopen it before protected work"}
```

A `status` request with the registration and session showed `native: {configured: true, disabled: false, usable: true}` and `activationUsable: false`. The `activations` list held exactly one record, for a different session (`22566d03-1326-45dd-82e8-3408e3d189af`, owner `claude.exe` pid 9992, observed 2026-09-18T12:01:51Z), which is another Claude Code window the user opened at 14:01 local time. There was no activation for `8a6964ca-...` and none for any earlier session id of pid 33276.

## Observed versus expected

Expected: the registered SessionStart hook records an activation when the session starts and again when `/clear` issues a new session id, so a later runtime operation in the same window is admitted.

Observed: no activation exists for this window under any id. The only SessionStart context that reached the model after `/clear` came from the output-style hook; no `Nightshift session binding:` context was present.

## Confirmed facts

- The three registered hooks in `~/.claude/settings.json` (SessionStart, PreCompact, Stop) launch the retained bootstrap with `--hook` and carry no `matcher`, so they are not restricted to a startup source.
- The same registration and generation recorded an activation for another window at 12:01:51Z, so the hook works on this machine today.
- The user then had to quit and resume the session to continue, which is the recovery the error message names.

## Not established

- Whether the SessionStart hook ran at all in this window at startup or at `/clear`, and if it ran, whether it failed, timed out or wrote a record that was later removed.
- Whether an activation recorded under the pre-clear session id existed and was pruned or replaced, or never existed. The pre-clear session id is not known.
- Whether `/clear` fires SessionStart with the new session id on this Claude Code version, and whether the hook's stdin carried it.
- Whether this reproduces. It was observed once.

## Hypotheses (unverified)

- `/clear` changes the session id and the activation is keyed by the old id, so every cleared session loses runtime admission until it is reopened.
- The hook exceeded its budget or failed during startup of this window (the backlog already tracks a 1.4 to 1.7 second settings resolution per hook call) and failed silently, since `hook.js` writes `{}` and exits 0 on any error.

## After quit and resume

The user exited and resumed the conversation. SessionStart context then carried `Nightshift session binding: 8a6964ca-b815-4285-8a22-6b78bba11819`, the same session id as before, together with the bound resources, launcher and registration. The unchanged create request was retried and succeeded at 2026-09-18T13:11:08Z, creating run `d4a44daa-96be-4ac4-bcaa-d16d8596584f` with `resourceMode: bound`. So the hook fires and records an activation for this id on resume; the id itself was never the obstacle. This is consistent with the hook not having produced an activation at the original startup or at `/clear`, and does not distinguish between those two.

## Evidence

The status output quoted above was read from a scratch file that has since been removed; its relevant fields are reproduced here. The saved create request file `.tmp/ns-create.json` was later overwritten and deleted during scratch cleanup on 2026-09-28; the content it created survives as the first history record (revision 0) of run `d4a44daa-96be-4ac4-bcaa-d16d8596584f` in `.nightshift/runs/state.sqlite`. The initial refused attempt created no run; the later successful recovery created the run identified above.

Timing qualification: the original inbox narrative described process startup as "a few minutes earlier" than Ready and the refused attempt as "about three hours later". Those intervals conflict with the recorded timestamps: process start at 11:57:27+02:00 converts to 09:57:27Z, about two hours before recorded Ready preparation, while successful recovery at 13:11:08Z is only 1:11:36 after it. The original timestamps are preserved above; the elapsed intervals and any timestamp or timezone error remain unresolved.

## Recurrence on 2026-10-03

- Host: Claude Code 2.1.288, native `claude.exe`. Installed plugin 3.3.2, identity `3.3.2-ee5eb29c7efa95ea9bc74e3ea147bb46e6e91bf04c8585741e2b37eb048f33c3`, bundle `34616005-9851-4c58-b6b2-5c6ac4ef77be`. Registration `70ed84ac1c863f69870f5ddefec6377176098e9b3d5724b96fe9fa74d912df6c`, generation `3eb9393a98766420b7b422f996b15e1509a67ce5842b43caec719ec17cd7059f`. Session `fee3b1e2-8d10-4c81-8d00-26227ad73218`.
- The conversation began with two `/mcp` commands, and no `/clear` appears in it. The only SessionStart context that reached the model came from the output-style hook, with no `Nightshift session binding:` line.
- Ready preparation created the session binding at 2026-10-02T23:32:49Z and Ready ran normally. At handover, status showed `native: {configured: true, disabled: false, usable: true}`, an empty `activations` list and `activationUsable: false`, and the runtime `create` was refused with the same `retained-bootstrap-unavailable` message.
- After the user quit and resumed the conversation, SessionStart context carried the Nightshift session binding for the same session id, status showed an activation observed at 2026-10-03T00:12:07.582Z by `claude.exe` pid 29460, and `create`, now for an unattended run, succeeded and created run `e92922e8-d20f-4674-907c-bf3277f5f184`.
- A second observation without a visible `/clear` weakens the hypothesis that `/clear` causes the loss. Whether the hook ran at startup, and if so why it recorded nothing, remains unverified.
- Evidence: the status snapshots `.tmp/nightshift/activation-missing-20261003-status.json` (before) and `.tmp/nightshift/activation-after-resume-status.json` (after), kept locally in the clone's ignored `.tmp`.
