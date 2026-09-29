---
name: check-external-dependencies
description: State and handle the agreed limit that a matching content digest does not show unchanged external dependencies, so a check does not stay current across a changed toolchain or environment
metadata:
  type: feature
status: exploring
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

## Direction

State the limit where a run loads it, and decide whether check evidence should also record, or be invalidated by, the external dependencies that matter.

## Open questions

- Which external dependencies matter for a check (executable identity and version, runtime version, environment), and whether recording them is proportionate.
- How this relates to [Complete executable identity assurance for Windows launches](v3-launch-identity.md), which covers launch-time identity rather than check currency, and to [Capture review content once within an operation](v3-review-snapshot-reuse.md).
