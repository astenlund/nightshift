---
name: native-process-helper
description: Replace the pwsh helpers for Windows process inspection and job containment with a small native helper, for performance and to remove their pwsh startup and runtime compilation
metadata:
  type: feature
status: exploring
---

# Native helper for Windows process work

## Origin

Raised by the user on 2026-09-30: "idea: a small native helper for Windows process inspection, removing the pwsh dependency and its potential issues". Asked about scope, the user added: "could 3 reasonably be replaced with something else? this is mostly about performance, though, so 1 and 2 would be enough", where 1 and 2 are the process inspection helper and the job runner below and 3 is the settings writer.

## Current behavior

Checked on 2026-09-30, the runtime starts PowerShell 7 for three helpers:

1. `internal/releases/process-info.ps1`, run by `information()` in `internal/releases/processes.js` with a fixed 10 s bound (since 3.3.6, 30 s in total with one retry, 10 s for a registered hook, except SessionStart's owner lookup, which keeps 30 s since 3.3.7), reads a process's identity (its name and creation time, which guards against a reused process id), its liveness and, for an owner lookup, its ancestry through `Get-CimInstance Win32_Process`. Each controller observation runs it twice, an owner lookup and then a liveness check (`observeController` in `internal/runtime/ownership.js`), at `handover`, `claim-controller` and `resume` and before every action that needs an engineering claim, such as `check`, `probe`, `dispatch`, `start-task` and `advance`. A check or probe then runs it three more times, for its helper, the job runner and the command (`internal/runtime/operations.js`), and a review dispatch once for its helper and once for each attempt's reviewer process (`internal/runtime/cli.js`). Through the retained launcher, admission of every call that is not read-only, maintenance or Ready, and of every registered hook that reaches admission, adds a liveness check of the session's activation owner, and SessionStart an owner lookup (`internal/releases/service.js`), after which, since 3.3.7, SessionStart skips the liveness check of the owner it has just found. On 2026-09-30, on a lightly loaded machine, plain lookups took 340 to 521 ms each over two runs of five, of which bare pwsh startup took about 170 ms, and owner lookups with the ancestry walk 582 to 681 ms. Under heavy load a check was refused because this inspection failed, most likely by exceeding its bound; [Helper-identity inspection refuses checks under heavy load](../BUGS_HISTORY.md#helper-identity-inspection-refuses-checks-under-heavy-load) records the 3.3.6 fix and later measurements of 8.5 to 11.6 s per owner lookup with 48 busy-loop processes on a 24-CPU machine.
2. `internal/runtime/windows-job-runner.ps1`, started by `spawnWindowsJob` in `internal/runtime/windows-job.js`, contains a process tree in a Windows job object through C# interop that `Add-Type` compiles at each start. It starts for every check, probe and reviewer attempt, and also whenever admission inspects the host's native settings by launching the host itself in a job (`claudeSettings` and `withCodex` in `internal/releases/native-host.js`): in every launcher call and registered hook that needs admission, since the settings cache lasts only for one process. The time from launching a runner to its child starting, which covers PowerShell startup and that compilation, was about 0.6 seconds idle and 14 to 25 seconds with two to three busy processes per CPU, as [Contained-process tests fail intermittently on the Windows CI runner](../BUGS_HISTORY.md#contained-process-tests-fail-intermittently-on-the-windows-ci-runner) records; the runtime reference gives a requested termination 30 seconds partly for a runner still starting.
3. `internal/releases/settings-write.ps1`, run by `host-config.js` only when setup writes Claude Code settings, compares and rewrites `settings.json` while holding it open with no sharing, then flushes it to disk.

## Direction

A small native helper replaces helpers 1 and 2, for performance. Helper 3 is off the hot path and can stay on pwsh. If it is ever moved, two ways were checked on 2026-09-30:

- Node 22.23.2 on Windows honors libuv's exclusive-share open flag when it is passed as the raw value `0x10000000`. It is not exposed in `fs.constants`, so this relies on undocumented behavior. A probe showed a second reader refused with `EBUSY` while the file was held, and truncate, write and fsync working.
- A subcommand of the same native helper can use the documented `CreateFile` share mode and `FlushFileBuffers`.

## Open questions

- Language and build: for example a .NET NativeAOT executable, which could reuse the runner's existing C# interop, or a minimal Rust or C executable. Where the source lives, how the build is reproducible, and which architectures ship.
- Packaging and trust: the plugin ships only JavaScript and PowerShell scripts, using Node built-ins with no package installation, beside its PowerShell 7 and Git prerequisites. A shipped binary needs a hash in the release manifest and a trust check replacing the current trusted-executable resolution of `pwsh.exe`, and may meet signing, antivirus or SmartScreen friction. This relates to [Complete executable identity assurance for Windows launches](v3-launch-identity.md) and [Define and verify marketplace installation contents](v3-marketplace-surface.md).
- Behavior to preserve, including at least: the runner's job-empty termination proof, ordered input acknowledgements and pending-input bound; its start-failure report naming the executable, the launch stage and the Windows error; the listing and ending of descendants still running 5 seconds after a command exits; the inspection's creation-time identity check, its exited-parent diagnosis for a broken ancestry, its failure-closed result that grants no authority when inspection fails, and the failure cause that the refusals name since 3.3.6.
- Inside the Codex sandbox the launcher cannot start the host process it inspects ([Codex sandbox blocks the launcher from starting the host](../QUICK_WINS.md#codex-sandbox-blocks-the-launcher-from-starting-the-host)); whether a native helper meets the same refusal.
- How this relates to [Maintain bounded host transports and explicit runtime ownership](v3-transport-maintenance.md) (Exploring), which covers the runner's protocol and bounds; to [Windows job pipe and containment fixtures fail outside the code they cover](../BUGS.md#windows-job-pipe-and-containment-fixtures-fail-outside-the-code-they-cover); and to [Hook-path native settings resolution cost](../QUICK_WINS.md#hook-path-native-settings-resolution-cost), whose settings inspections are the admission launches described above.
- Whether PowerShell 7 stays a requirement, in AGENTS.md's verified host target and the README, while helper 3 uses it.
