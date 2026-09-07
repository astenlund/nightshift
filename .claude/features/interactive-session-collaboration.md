---
name: interactive-session-collaboration
description: Connect interactive Codex and Claude Code sessions for visible collaboration and direct user steering
metadata:
  type: feature
status: exploring
---

# Interactive Codex and Claude Code collaboration

Let the user start Codex and Claude Code in separate interactive terminals, pair those running sessions for a project, and have them exchange messages, tasks, and results. Both sessions remain visible side by side in Windows Terminal, and the user can steer either directly. The desired interaction uses the existing interactive participants rather than requiring one agent to launch a separate headless query process for each exchange.

Explore how to connect the sessions through supported host capabilities, coordinate work and direct user steering, preserve edit ownership, and handle interrupted communication. Ongoing collaboration must preserve the independent contexts required for fresh review. Transport and leadership arrangements remain open; the initial investigation below identifies candidates without establishing live integration.

Captured 2026-09-07 during v3 MVP discussion. Related to the [v3 host-adapter direction](../../V3-MIGRATION.md#portability-umbrella-and-continuations) and [run continuity](../../V3-MIGRATION.md#identity-and-evidence). This exploration was captured after the completed backlog assessment and has no four-way migration disposition. The user agreed to defer it beyond the v3 MVP; it remains available for later investigation.

## Optional partner launch

The user expanded the idea on 2026-09-07: the current agent could ask Windows Terminal to split its pane and launch the other interactive agent there. Their offhand example was `wt -w 0 sp -V -s .333`. The user clarified that its arguments are illustrative: window targeting, pane layout, size, working directory, and partner launch arguments must be chosen for the actual integration. Adding the working directory and executable gives this illustrative PowerShell invocation for the current checkout, not a prescribed launcher:

```powershell
wt -w 0 sp -V -s .333 -d C:/Git/nightshift C:/Users/asten/.local/bin/claude.exe
```

Microsoft documents `sp` as `split-pane`, vertical splitting, a fractional size for the new pane, a starting directory, and an executable command line. `-w 0` selects the most recently used window. Reliable automation must establish the intended window and pane rather than assume focus has stayed put. Pane creation and process launch do not establish a messaging connection. [Windows Terminal command-line documentation](https://learn.microsoft.com/en-us/windows/terminal/command-line-arguments).

## Discover and reuse an existing pane

Further ideas captured 2026-09-07: before opening another pane, inspect a neighboring pane for a suitable existing shell or partner session. The user's intended reuse rules are:

- If the pane contains a shell in the same project directory, no command is running, and it has a clear prompt, use it to launch the partner AI. Preserve any pending user input and existing work; a prompt-like display alone does not establish that these conditions hold.
- If the pane already contains an AI host of a different flavor from the controller, ask that session whether it is available to collaborate on this project. Establish the matching project, accepted assignment, and edit ownership before sharing work. An existing conversation still needs fresh independent contexts for review duties.

Explore reliable pane-to-session identification and fresh evidence at the point of reuse. Busy, ambiguous, unrelated, or declining sessions remain untouched. An unanswered availability request must not stall the controller indefinitely or count as acceptance. Where reuse cannot be established, consider a new partner pane if that supported mode is appropriate, or continue through the independent single-host baseline. Discovery, reuse, and partner launch remain exploratory capabilities, deferred beyond the v3 MVP.

Microsoft documents shell integration that reports the working directory and marks prompts, commands, and output. Those are candidate signals; this documentation does not establish an external controller interface for querying an arbitrary neighboring pane or safely submitting a command to it. Pane inspection, empty-input detection, session matching, and safe reuse remain unverified. [Windows Terminal shell integration](https://learn.microsoft.com/en-us/windows/terminal/tutorials/shell-integration).

## Initial feasibility evidence

Read-only investigation on 2026-09-07 found Windows Terminal 1.24.11911.0, Codex CLI 0.153.4, and Claude Code 2.1.263 locally. The Codex process had a Windows Terminal ancestor, although `WT_SESSION` and `WT_WINDOW_ID` were absent from tool subprocesses. Missing terminal environment variables therefore did not establish that this session was outside Windows Terminal. Claude's local help confirms interactive mode is the default.

- Codex's installed `queue --help` exposes `--thread` for a session UUID or exact name and `--message` for queued text. This establishes the advertised local interface; delivery to an active or idle interactive session was not exercised. The documented [App Server](https://learn.chatgpt.com/docs/app-server) also provides turn submission and steering, whose suitability for attaching to the same visible session needs verification.
- Claude documents a session inbox usable by scripts and hooks, using authenticated named pipes on native Windows. This offers a candidate receiver, subject to its session identity, authentication, and inbound-message controls. A bridge must preserve message origin and user authority when connecting the two agents. [Claude cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging).
- Claude's MCP channels offer another documented route into a running interactive session, with a reply tool for two-way communication. Custom channels currently require the development-channel flag and startup consent. Notifications alone do not confirm processing, and events arriving while busy are queued. [Claude channels reference](https://code.claude.com/docs/en/channels-reference).

These interfaces justify a small future integration experiment. No neighboring pane was inspected, no pane or Claude session was launched, no message was sent, and no host settings were changed in this investigation. Correct pane targeting, safe reuse, session pairing, visible bidirectional delivery, busy and idle behavior, direct user steering, acknowledgements, and interruption recovery remain unverified. This evidence does not place the capability in the MVP.
