---
name: check-external-dependencies
description: State the agreed limit that a matching content digest does not show unchanged external dependencies, and have the controller rerun a check after a known change outside the project that it depends on, so a check does not stay current across a changed toolchain or environment
metadata:
  type: feature
---

# Check currency and external dependencies

## Origin

Found on 2026-09-29 by the audit of the v3 migration accounting that the user asked for after finding capabilities recorded as delivered that were never shipped. [MIGRATION_STATUS.md](../MIGRATION_STATUS.md) recorded "Content fingerprint helper" as Present; independent auditors and verifiers found its last clause neither stated nor handled. Drafted overnight for the user's triage.

## Agreed disposition

Agreed on 2026-09-06, in [V3-MIGRATION.md](../../V3-MIGRATION.md#identity-and-evidence): "Share deterministic identification of the material actually reviewed or validated. Generate its identity from the same captured content used as evidence, reusing existing selection and hashing code where suitable instead of reconstructing shell recipes in each run. Drop prescribed tag lengths, mode migration, and old stamp compatibility as automatic v3 requirements. Choose representation rules for the new consumers while preserving meaningful byte differences. A digest identifies content; it does not establish approval, run ownership, or unchanged external dependencies."

## Current behavior

Checked on 2026-09-29:

- Carried: the shared snapshot and freshness helpers in `internal/runtime/evidence.js` identify the reviewed or validated material from the captured content, byte differences that matter are kept (only line-ending normalization is tolerated), and approval and ownership rest on attribution and controller identity, not on a digest.
- Missing: a check stays current as long as the digests of its covered project files match, and records only the resolved executable path. Nothing states that a matching digest says nothing about external dependencies such as a changed toolchain or environment outside the project, and nothing tells the controller to run a check again after such a change. [The runtime reference](../../internal/runtime/REFERENCE.md) states comparable limits only for probes.
- Whether the clause binds how check currency is judged is a matter of reading: taken only as a warning against treating a digest as approval, the row would be delivered. The audit read it as binding.

Checked again on 2026-10-03: a check is current when it passed and `fresh` finds its covered project files unchanged (`verificationGate` in `internal/runtime/lifecycle.js`), and [the runtime reference](../../internal/runtime/REFERENCE.md#delivery-and-evidence) still records only the resolved executable path and states no limit on external dependencies.

## Direction

State the limit where a run loads it, and have the controller rerun a check after a known change outside the project that the check depends on. The runtime keeps judging check currency by project inputs alone.

## Settled questions

The user agreed these answers on 2026-10-03, when the entry graduated from Exploring to current work. Each question is kept with its answer.

- Which external dependencies matter for a check (executable identity and version, runtime version, environment), and whether recording them is proportionate. Settled: any of them can matter, and none is recorded automatically. The runtime reference, beside `check`, and the operating brief state that a current check shows only that its listed project inputs match what passed, and says nothing about the executable or its version, the Node or host runtime, packages installed outside the project or the environment. When the controller makes or learns of a change outside the project that a passed check depends on, such as updating Node or a host CLI, installing a global package or changing an environment variable the check reads, it reruns the affected checks before relying on them for task completion or delivery. Without a known change, a check's currency stands as before. Recording or invalidating by external dependencies is a deliberate non-goal: fingerprinting the toolchain or environment on every check costs time and would mark checks stale on unrelated changes, and this record cites no run in which a changed toolchain let a stale check pass; revisit if one is observed. The smallest mechanical alternative, recording the check executable's size and modification time and marking the check stale when either changes, was considered and not adopted: it would catch a replaced Node or tool binary, but not packages, tools a check calls internally or environment changes.
- How this relates to [Complete executable identity assurance for Windows launches](v3-launch-identity.md), which covers launch-time identity rather than check currency, and to [Capture review content once within an operation](v3-review-snapshot-reuse.md). Settled as independent: launch identity asks whether the launched program is the trusted one, and snapshot reuse captures review bytes once per operation; neither decides whether an earlier pass still holds. The bug [Probe evidence about the host is discarded on any edit](../BUGS.md#probe-evidence-about-the-host-is-discarded-on-any-edit) is the mirror case, evidence about the host lost on project edits where this entry keeps evidence about the project across host changes; it is related, and neither depends on the other.

## Before implementation

The change is shipped guidance in the operating brief and the runtime reference, so it rides with a plugin version increase. The rerun after a known change is model-owned behavior, so the start of the work decides between a budgeted installed-host check and deterministic evidence only with that behavior marked unverified. Tracking and readiness do not authorize implementation.
