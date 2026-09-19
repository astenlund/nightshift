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

The status output quoted above was read from a scratch file that has since been removed; its relevant fields are reproduced here. The saved create request remains at `.tmp/ns-create.json`. The initial refused attempt created no run; the later successful recovery created the run identified above.

Timing qualification: the original inbox narrative described process startup as "a few minutes earlier" than Ready and the refused attempt as "about three hours later". Those intervals conflict with the recorded timestamps: process start at 11:57:27+02:00 converts to 09:57:27Z, about two hours before recorded Ready preparation, while successful recovery at 13:11:08Z is only 1:11:36 after it. The original timestamps are preserved above; the elapsed intervals and any timestamp or timezone error remain unresolved.
