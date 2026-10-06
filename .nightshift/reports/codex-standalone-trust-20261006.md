# Codex standalone executable trust

## Outcome and scope

Candidate plugin 3.3.9 repairs profile-scoped retained-release administration when the Windows Codex standalone installation lives inside the selected host profile. The accepted readback covers explicit setup, first-time preparation, status and removal, while preserving project exclusions and refusal of arbitrary profile placements. The work is attended in run `bfab19a0-a9bc-4f33-ab7b-b600cf275ef8` in `C:/Git/nightshift`, based on `6deb68475fda03bceb5f4377ce29e8be0a4b5a2a`.

## Trust boundary

The general executable resolver resolves every declared protection root to a physical directory before considering PATH candidates, refusing unavailable roots. Retained Codex administration opts into the package exception only for a physical profile context. An explicitly named project remains independently protected, including when it equals or contains the profile. Both signature inspection and the Windows job runner receive that exclusion. Setup normalizes its explicit project before recovery, discovery, hook writes and inspection; configuration recovery uses the current native snapshot reader while retaining the owning release's journal comparison.

The exception accepts only a canonical `packages/standalone/releases/<version>-<target>/bin/codex.exe` location inside the selected profile. Package directories must be ordinary canonical directories, and layout version 1 metadata must identify the release directory, Windows target, Codex variant, entry point, resources directory and PATH directory. An installer PATH junction is resolved to its physical package; a redirected release directory does not receive the exception.

Windows Authenticode must report a valid signature whose publisher is exactly `OpenAI OpCo, LLC`. Inspection uses a PowerShell executable outside the protected profile and project, has a 30-second timeout and bounded output, and fails closed on an unavailable helper, invalid output, timeout, failed signature or other publisher. No certificate fingerprint or trust result is persisted. Each protected candidate is checked anew. Package metadata is read again after inspection, and executable identity, size and modification time are compared around it.

This establishes the scoped package exception and ordinary concurrent-change detection. It does not prove an atomic binding between the signature check and the eventual process launch. That wider requirement remains in [the Exploring launch-identity feature](../features/v3-launch-identity.md).

## Evidence

The regression test failed before the repair with `No trusted executable was found`, then passed. The recorded retained-release check passed 140 tests, including the new executable tests; packaging and release-policy fixtures passed 19 tests; all 50 host tests passed. The public setup tests cover canonical and junction project spellings, missing projects and missing eligible runners. Snapshot tests distinguish profile-only administration, a separately protected project and explicitly treating the profile as the project. The missing-working-directory negative host test now supplies an existing protection root so it still reaches the runner-start failure it is intended to cover.

The zero-inference live driver ran Codex CLI 0.160.1 with candidate plugin 3.3.9 in two isolated profiles. Each contained a copied signed standalone package exposed by a PATH junction; every other PATH directory containing `codex.exe` was removed. The 3.3.8 resolver rejected each fixture. The explicit fixture passed maintenance setup, status and removal. The automatic fixture passed first-time preparation, Ready, status and removal. Both preserved the unrelated model setting in their profile. These were explicit native administration requests without a controller session for maintenance operations; no model turn or inference campaign was run, and no production profile was changed.

Raw requests, command outputs and the final two-case summary remain in `.tmp/codex-standalone-live-bb84e058-0bf4-49bc-b38d-6e5654bbe5b8`. Earlier fixture executions and deciding private probes remain with their original evidence. Runtime checks and review receipts remain with the run. The live evidence covers the x86_64 standalone layout on this machine; ARM64, other operating systems, other installer layouts and production rollout are not verified by this fixture.

## Independent review and repair

The first Fable attempt timed out without an attributable completed assessment and with verified descendant cleanup. Astra supplied the assessment, and the user then required Astra for every remaining review in the session. The lead requested private probes and reported an important dropped project exclusion in PowerShell runner selection. A fresh Astra skeptic confirmed it. After that repair, the lead found the junction variant: candidate paths were physical while exclusion roots were lexical. A public-route probe and a fresh Astra skeptic confirmed that variant. Both probes explicitly simulated signature success and intercepted launch before any marker executable ran.

The repair carries project protection into runner selection, resolves protection roots by physical directory, and preserves profile administration as a separate condition from project exclusion. Astra closed both findings in receipt `a0a26256-59ed-4829-b08c-3d62b489aedc`; the fresh cumulative code assessment `dad15909-bc5f-4deb-b87b-a9afa4f725a4` returned complete with no findings. The implementation is committed locally as `c22341a` (`fix(releases): trust verified standalone Codex packages`). The release gate passed against the locally recorded `origin/main` baseline, from 3.3.8 to 3.3.9. Publication and production rollout remain separate.

Resumed review cache use is measured from the first token-usage update correlated to the new native turn, not the restored prior turn or its cumulative total. The probe-return resume had 137,869 input tokens and zero cached input tokens; the runner-repair resume had 163,643 input tokens and zero cached input tokens; the physical-root repair resume had 214,144 input tokens and zero cached input tokens. All three were cache misses. They do not invalidate review and do not establish the cause of the misses.

## Documentation sweep

The claim sweep used `standalone`, `trusted executable`, `protected root`, executable/profile combinations, `No trusted` and `Authenticode` across the four active indexes, README, WORKFLOW, the retained release reference and the launch-identity feature record. The active bug was the relevant current claim; unrelated uses of standalone for revision workflows were excluded. An exact-title dependency sweep across all four active indexes found only the bug heading, so no satisfied dependency needed removal. The repair is archived in BUGS_HISTORY, installation support is described in README, and the Exploring launch-identity record links this report while retaining its broader scope.
