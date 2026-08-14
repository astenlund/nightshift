# Content fingerprint helper

Feature: centralize selection, normalization, and hashing of reviewable document content in one bundled Node helper so no controller or reviewer reimplements the recipe. This file is the authoritative design record.

## What it does

Controllers and review agents currently reproduce the content-selection recipe themselves. Two prose recipes embed the same pipeline: the durable provenance stamp in `commands/handover.md` (`awk '/^## Hardening$/{exit} !/^Status:/' | sha256sum | cut -c1-8`) and the transient review fingerprint in `skills/revise/SKILL.md` (same `awk` filter, `cut -c1-12`). The code-review path in `skills/revise/SKILL.md` hashes a generated cumulative review patch with a bare `sha256sum` and no section filter. This hand-reproduction creates two recurring failure modes:

- hashing the whole file instead of the reviewable content;
- producing different hashes because the active shell or checkout uses different line endings (LF on one system, CRLF on another: identical semantic content, different byte-level hash).

This feature makes one bundled Node helper the sole authority for selecting and hashing reviewable document content. Callers pass the artifact path and a named mode rather than reimplementing filtering. The helper reads the artifact, normalizes line endings, applies the requested exclusion mode, computes SHA-256 over the normalized content, and emits the tagged 12-hex-character fingerprint. Shell tools (`awk`, `sha256sum`) are no longer fingerprinting dependencies, which also removes the shell-specific variance the feature exists to kill.

This follows the established `skills/ready/ready.js` precedence: deterministic behavior bundled as a Node helper with a framework-free fixture suite beside it, runnable with `node`.

## The mode taxonomy

Fingerprints are computed over line-ending-normalized content, and the tag letter discriminates the mode. The tag letters (`p`, `w`) are outside the hex alphabet, so the emitted shape is validatable as a regex and a value can never be misread as another mode.

```text
partial     -> p-<12 hex>    excludes the Status: header line and the ## Hardening section
whole-file  -> w-<12 hex>    exclusions empty; whole normalized content
```

- `partial` reproduces exactly the exclusion set today's document recipes apply everywhere: the `Status:` header line and everything from the `## Hardening` heading to end of file. It is the design-content fingerprint.
- `whole-file` hashes the entire normalized content with no section exclusion. Its first consumer is the code-review cumulative-patch fingerprint, which today hashes a patch (not a document) with no section filter and therefore maps to this mode unchanged in spirit.
- The transient review fingerprint and the durable provenance stamp are **the same `partial` computation in different storage contexts**. A value in scratch state is transient; a value recorded in the artifact's `content:` stamp field is durable. There is deliberately no third "durable" mode; the distinction lives where the value is stored, not in the hash.
- Both modes emit 14 characters, 48 bits of SHA-256 prefix each, sharing one collision budget. The old length asymmetry (12 transient vs 8 durable) is gone; the durable value is no longer the shorter one.
- An unknown mode is rejected loudly (fail closed), never silently defaulted.

## The helper contract

A single function of the form `fingerprint(artifactPath, mode)` returns the tagged fingerprint. It owns, in order:

1. reading the artifact;
2. normalizing line endings (`\r\n` -> `\n`) unconditionally;
3. applying the mode's exclusion set to produce the content to hash;
4. computing SHA-256 over the normalized, excluded content;
5. returning `p-` or `w-` prefixed with the first 12 hex characters of the digest.

Callers state a named mode, not a digest length: the helper owns the mapping from mode to length and tag, so a future change to either touches one file instead of every call site.

## The fixture suite

The fixture set binds the full contract so controllers and reviewers cannot accidentally regress to whole-file hashing, and the line-ending variance is pinned. Each fixture asserts both modes where a regression could hide:

- **LF vs CRLF input**: identical semantic content with `\n` and `\r\n` encodings produces identical `partial` and `whole-file` fingerprints.
- **A `Status:` header**: its presence and value do not move the `partial` fingerprint, but do move `whole-file`.
- **A `## Hardening` section**: appending stamp lines under `## Hardening` leaves `partial` unchanged and changes `whole-file`.
- **Body changes**: any real design-content edit moves both fingerprints.
- **Mode tagging**: every emitted value matches `^[pw]-[0-9a-f]{12}$`, and the two modes over the same artifact are distinguishable by tag.
- **Invocation shape**: an unknown mode is rejected loudly rather than defaulting silently.

## Relationship to neighboring features

- **durable-run-identity-concurrency**: that design documents its identity block as carrying "the durable provenance stamp (8-character)." This feature changes the durable stamp's shape to `p` + 12 hex. When this feature lands, that file's language must be updated to the new stamp shape; the format change is recorded here so the identity design is not left describing the old 8-char stamp.
- **review-orchestration-tests**: the transition module pattern that feature introduces (`ready.js`-style pure module plus fixture suite) is the same substrate this helper follows; they do not overlap on shared code.

## Status

Migrated into the backlog on 2026-08-11, with six design decisions confirmed one at a time during migration: sole-authority bundled Node helper; unconditional line-ending normalization; exclusions as a named mode; the `partial`/`whole-file` tag taxonomy (48 bits each, tagged, no third durable mode); shell-tool removal including the code-patch path; and the six-group fixture suite. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The fingerprint consumers this centralizes are shipped: the provenance stamp recipe in `commands/handover.md`, the transient review fingerprint recipe in `skills/revise/SKILL.md`, and the code-review cumulative-patch hash in `skills/revise/SKILL.md` (existing; this feature relocates the computation they currently embed).
- The `skills/ready/ready.js` / `ready.test.js` framework-free fixture convention this helper follows (existing).

Landing order: the wave-convergence lifecycle (wave-lifecycle.md) shipped 2026-08-14 in the 2.2.0 batch; SKILL.md's lifecycle sections are wave-era prose. Derive lifecycle-touching edits from that prose.

**Requires:** none (FEATURES.md index entry).

## Hardening

- (None yet; this file has not been through a revise-spec run.)
