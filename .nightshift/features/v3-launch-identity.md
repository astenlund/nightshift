---
name: v3-launch-identity
description: Complete executable identity assurance for Windows launches
metadata:
  type: feature
---

# Complete executable identity assurance for Windows launches

Reconcile retained launch roles with the selected executable identity and trust boundary, including replacement and path retargeting between discovery and launch. Verify the boundary rather than inferring it from a resolved path.

## Selected outcome

The retained requirement allows legitimate re-resolution and updates but requires missing identity proof to block the affected launch. Cover runtime hosts, their PowerShell runner, setup Git and retained-release administration according to their actual trust policy.

## Evidence and limits

`resolveTrustedExecutable` performs two identity checks while resolving; runtime and release host launchers use it. `internal/setup.js` invokes Git by name. This establishes partial mechanisms, not one verified launch-time contract across every role or closure of all races.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

The local 3.3.9 repair recognizes verified Windows Codex standalone packages for profile-scoped retained-release administration, as [its acceptance report](../reports/codex-standalone-trust-20261006.md) records. It checks canonical package metadata and a valid OpenAI Authenticode signature, preserving project exclusions and ordinary concurrent-change detection. This closes the standalone profile-resolution refusal, not the broader atomic signature-to-launch identity requirement tracked here.

## Decisions and acceptance

Choose the per-role contract and document residual race limits. Verify retargeting, replacement, permitted updates and unavailable proof on the supported Windows host without treating a last-moment path check as atomic launch binding.

The migration accounting audit of 2026-09-29 found a launch role this entry did not name: the runtime's own Git launches, which run `git` by bare name with no identity check, in `internal/runtime/evidence.js` (repository detection, blob hashing and the file inventory), `internal/runtime/review.js` (the cumulative diff and new-file diffs) and `internal/runtime/probes.js` (initializing and checking a probe copy). The per-role contract needs to cover them as well as setup Git.

## Settled questions

The user agreed these answers on 2026-10-13, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: `resolveTrustedExecutable` in `internal/filesystem-primitives.js` walks the absolute PATH entries, skips a candidate inside the project or another protected root unless the caller allows it, and checks the candidate's identity twice while resolving; host CLIs (`internal/runtime/hosts.js`, `internal/releases/native-host.js`), `pwsh` (`internal/runtime/windows-job.js`, `internal/releases/processes.js`, `internal/releases/host-config.js`, `internal/releases/codex-executable.js`) and check commands (`internal/runtime/operations.js`) resolve through it. Every Git launch bypasses it: `internal/runtime/review.js`, `internal/runtime/evidence.js`, `internal/runtime/probes.js`, `internal/runtime/scratch.js` and `internal/setup.js` start a bare `git` with the project, or a review or probe copy of it, as the working directory. Node's libuv documents, in its Windows process source, that a bare name with no path is looked up in the working directory before PATH; if that holds on the supported host, a `git.exe` inside a project would run whenever Nightshift reads that project or a copy of it. This was not probed on Windows.

- The per-role contract. Settled: every executable Nightshift launches resolves through the trusted resolver, host CLIs, `pwsh`, and Git in setup and the runtime alike, and no bare-name launch remains; a test fails when one reappears. Retained-release administration keeps the signature check that 3.3.9 added for verified Codex standalone packages.
- Binding between resolution and launch, and permitted updates. Settled: an operation resolves once and launches by the absolute path, rechecking the resolved file's identity immediately before launch, and a changed identity refuses the launch. A host that updates itself is picked up by the next operation, never within one. The window between that last check and Windows starting the process cannot be closed from Node; it is documented as a residual limit and never claimed closed.
- Signature verification. Settled: none beyond the Codex standalone case. The threat this entry addresses is an executable planted in a project, which the location rule refuses; replacing a system binary already needs a compromised account, and a signature check would add a PowerShell start to every resolution.
- Unavailable proof. Settled: when no candidate qualifies, the launch is refused with a named error and never falls back to a bare name.
- Order of work. Settled: the work starts with a Windows probe of whether a bare `git` launch runs a `git.exe` placed in the project or in a probe copy. If it does, that is a security defect, and moving Git onto the trusted resolver ships first as its own slice, ahead of the rest of the contract.
- Evidence and relations. Settled: no behavior here is model-owned, so deterministic fixtures on the Windows CI suffice, with no live campaign: a planted `git.exe` in the project and in a probe copy, a PATH entry retargeted to another file, replacement between resolution and launch, a permitted update across operations and no qualifying candidate. [Native helper for Windows process work](native-process-helper.md) would need the same treatment for its own binary, and the entry requires nothing.

## Before implementation

Run the Windows probe first, then settle the resolution points for each role, the identity recheck before launch, the named refusal and, if the probe confirms the defect, the boundary of the Git slice in a concise governing spec in `.nightshift/specs`. The change alters shipped runtime and setup code, so it rides with a plugin version increase. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Executable identity revalidation for Windows launches](../reports/v3-migration-followups-20260920.md#executable-identity-revalidation-for-windows-launches).

[The migration decision](../../V3-MIGRATION.md#launches-and-discovery) preserves the surviving requirement; earlier records: [executable-identity-revalidation](executable-identity-revalidation.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
