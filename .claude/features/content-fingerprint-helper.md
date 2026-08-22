# Content fingerprint helper

Feature: centralize selection, normalization, and hashing of reviewable document content in one bundled Node helper so no controller or reviewer reimplements the recipe. This file is the authoritative design record.

## What it does

Controllers and review agents currently reproduce the content-selection recipe themselves. Before the universal-entry MVP, the durable provenance stamp lives in `commands/handover.md` (`awk '/^## Hardening$/{exit} !/^Status:/' | sha256sum | cut -c1-8`) and the transient review fingerprint lives in `skills/revise/SKILL.md` (same `awk` filter, `cut -c1-12`); the code-review path there hashes a generated cumulative review patch with a bare `sha256sum` and no section filter. The MVP relocates those consumers to `skills/handover/SKILL.md` and `internal/revise/SKILL.md`. This hand-reproduction creates two recurring failure modes:

- hashing the whole file instead of the reviewable content;
- producing different hashes because the active shell or checkout uses different byte framing, including line endings, a UTF-8 byte-order mark, or trailing newlines.

This feature makes one bundled Node helper the sole authority for selecting, normalizing, and hashing reviewable document content. Its core API accepts captured source bytes plus a selector and returns the normalized selected bytes together with their full SHA-256 digest. A path convenience wrapper reads one artifact and returns the full digest, while the compatibility wrapper accepts the existing named mode and derives the tagged 12-hex-character fingerprint from that same digest. Shell tools (`awk`, `sha256sum`) are no longer fingerprinting dependencies, which also removes the shell-specific variance the feature exists to kill.

This follows the established `skills/ready/ready.js` precedence: deterministic behavior bundled as a Node helper with a framework-free fixture suite beside it, runnable with `node`.

## The mode taxonomy

Fingerprints are computed over line-ending-normalized content, and the tag letter discriminates the mode. The tag letters (`p`, `w`) are outside the hex alphabet, so the emitted shape is validatable as a regex and a value can never be misread as another mode.

```text
partial     -> p-<12 hex>    excludes only the ## Hardening section
whole-file  -> w-<12 hex>    exclusions empty; whole normalized content
```

- `partial` implements the agreement-gate contract: it excludes everything from the `## Hardening` heading to end of file, but treats a `Status:` header as ordinary design content. It is the design-content fingerprint.
- `whole-file` hashes the entire normalized content with no section exclusion. Its first consumer is the code-review cumulative-patch fingerprint, which today hashes a patch (not a document) with no section filter and therefore maps to this mode unchanged in spirit.
- The transient review fingerprint and the durable provenance stamp are **the same `partial` computation in different storage contexts**. A value in scratch state is transient; a value recorded in the artifact's `content:` stamp field is durable. There is deliberately no third "durable" mode; the distinction lives where the value is stored, not in the hash.
- Both modes emit 14 characters, 48 bits of SHA-256 prefix each, sharing one collision budget. The old length asymmetry (12 transient vs 8 durable) is gone; the durable value is no longer the shorter one.
- An unknown mode is rejected loudly (fail closed), never silently defaulted.

## The helper contract

The byte-oriented core function `selectAndHashContent(sourceBytes, selector)` synchronously copies its input on entry and returns an object with `selectedBytes`, the normalized selected UTF-8 bytes, and `digest`, their full 64-character lowercase SHA-256 digest. It never reads a path, so a caller that already captured a baseline can derive review text and identity from exactly the same bytes without caller mutation changing an in-flight computation. `selector` is exactly one of:

- `{ kind: "design-before-hardening" }`: select the complete artifact before the first exact `## Hardening` heading outside a CommonMark fenced code block;
- `{ kind: "index-entry", parentHeading, entryHeading }`: concatenate the exact enclosing `##` heading line and one normalized LF with the matching `###` entry and every line through the line before the next outside-fence heading of level one through three;
- `{ kind: "bullet-entry", parentHeading, entryTitle }`: concatenate the exact enclosing `##` heading line and one normalized LF with the matching top-level quick-win bullet and every immediately following nonblank indented continuation line, ending outside a fenced code block at a blank, another top-level bullet, a heading, or any other non-indented line;
- `{ kind: "whole-file" }`: select the complete artifact.

Heading values are exact, case-sensitive text including their Markdown prefix. `entryTitle` is the title produced by the ready parser's existing bullet-title grammar. The implementation extracts one shared raw-entry locator used by both `skills/ready/ready.js` and this helper so bullet boundaries and titles cannot drift while existing non-fenced parser output remains unchanged. A missing or duplicate requested heading or bullet title, an entry outside the requested parent, an unknown selector kind, or an unreadable artifact raises a typed error. The helper never guesses a boundary or silently selects the first ambiguous match.

All selectors share one fenced-code scanner. It recognizes an opener as zero to three spaces followed by at least three backticks or at least three tildes; a backtick opener's trailing info string may not contain a backtick. A closer has zero to three leading spaces, the same character repeated at least the opener's length, and only spaces or tabs afterward. Fence-like body lines with other trailing content do not close, and an unclosed fence protects through end of file. Headings, top-level bullets, backlog labels, and slice declarations inside a fence are content, never selector candidates, entry boundaries, or work units; while a selected entry is inside a fence, blank and non-indented body lines likewise remain content until the fence closes. Only an exact outside-fence `## Hardening` line ends `design-before-hardening` selection. The shared raw-entry locator and slice parser make the ready parser use the same structural-token rule while preserving its existing output for non-fenced entries.

The byte-oriented core owns, in order:

1. taking a defensive copy of the byte buffer supplied by the caller;
2. stripping one leading UTF-8 byte-order mark when present;
3. normalizing CRLF and bare CR line endings to LF unconditionally;
4. applying the selector to produce the content to hash;
5. making the selected content end with exactly one LF;
6. computing SHA-256 over the normalized, selected bytes;
7. returning those exact `selectedBytes` and all 64 lowercase hexadecimal characters of `digest`.

`hashContent(artifactPath, selector)` is a path convenience wrapper that reads the artifact once, delegates to `selectAndHashContent`, and returns its full digest. `fingerprint(artifactPath, mode)` is a wrapper over `hashContent`; `partial` maps to `design-before-hardening`, `whole-file` maps to `whole-file`, and the wrapper returns `p-` or `w-` plus the first 12 digest characters. Callers state a selector or named mode, never a digest length or an inline filtering recipe. The agreement skill passes each already captured baseline buffer to `selectAndHashContent` and uses both returned fields; provenance, revise state, and the code-review patch path call the path wrappers with their existing modes.

## The fixture suite

The fixture set binds the full contract so controllers and reviewers cannot accidentally regress to whole-file hashing, and the line-ending variance is pinned. Each fixture asserts both modes where a regression could hide:

The suite consumes the agreement-owned `skills/spec-agreement/fixtures/fingerprint-v1.json` cross-generation corpus directly. It must not copy, reinterpret, or regenerate those expected values: each entry's `sourceBytesHex`, selector, `selectedBytesHex`, and full digest are the independent oracle for `selectAndHashContent`. Agreement implementation creates and validates this versioned corpus before the helper exists; helper implementation adds its consumer assertions to the same file so parity is proven across the two landing generations.

- **Byte-framing normalization**: identical semantic content using LF, CRLF, or bare CR; with or without one leading UTF-8 byte-order mark; and with zero, one, or multiple terminal line endings produces identical `partial` and `whole-file` fingerprints, including for empty selected content.
- **Captured-byte authority**: `selectedBytes` decode to the exact text used for the paired digest, mutating the source file after capture cannot affect a byte-core call, and the path wrapper observes the later file independently.
- **A `Status:` header**: its presence and value move both `partial` and `whole-file` fingerprints.
- **A `## Hardening` section**: appending stamp lines under `## Hardening` leaves `partial` unchanged and changes `whole-file`.
- **Fenced Hardening lookalikes**: an exact `## Hardening` line inside backtick and tilde fences remains hash input; fence-like lines with non-whitespace suffixes do not close the fence, and an unclosed fence protects through end of file.
- **Index-entry selection**: the parent heading and selected entry move the full digest; outside-fence level-one, level-two, and level-three headings end the entry; sibling entries do not move it; fenced heading lookalikes remain content and do not create duplicates or boundaries; missing, duplicate, or cross-parent headings raise the documented typed error.
- **Bullet-entry selection**: multiline bullet boundaries and titles match ready-parser fixtures exactly; sibling bullets do not move the selected digest; fenced heading and bullet lookalikes remain content and do not create entries or boundaries; missing, duplicate, or cross-parent titles raise the documented typed error.
- **Ready-parser integration**: fenced fake headings, bullets, backlog labels, and slice declarations do not appear in parser output; the real outside-fence entry and slice remain authoritative, while every existing non-fenced fixture remains byte-for-byte unchanged.
- **Body changes**: any real design-content edit moves both fingerprints.
- **Digest and mode tagging**: every byte-core and path-wrapper digest matches `^[0-9a-f]{64}$`, every fingerprint matches `^[pw]-[0-9a-f]{12}$`, each fingerprint suffix equals its full-digest prefix, and the two modes over the same artifact are distinguishable by tag.
- **Invocation shape**: an unknown mode or selector is rejected loudly rather than defaulting silently.

## Relationship to neighboring features

- **present-spec-for-agreement**: this helper lands after the agreement gate removes durable sign-off and changes the canonical document fingerprint to exclude only `## Hardening`. The agreement identity is the first selector-aware, full-digest consumer and owns the versioned golden corpus. When this helper lands, `skills/spec-agreement/SKILL.md` replaces its inline `design-before-hardening`, `index-entry`, and `bullet-entry` selection and hashing with `selectAndHashContent`, passing its captured baseline bytes rather than rereading paths or retaining a second authority; the helper suite consumes the agreement-owned corpus to prove identical selected bytes and digests. Handover remains a caller of that shared agreement skill and owns no agreement-hashing recipe.
- **durable-run-identity-concurrency**: that design documents its identity block as carrying "the durable provenance stamp (8-character)." This feature changes the durable stamp's shape to `p` + 12 hex. When this feature lands, that file's language must be updated to the new stamp shape; the format change is recorded here so the identity design is not left describing the old 8-char stamp.
- **review-orchestration-tests** (shipped, landed before this feature): the transition module pattern that feature introduced (`ready.js`-style pure module plus fixture suite) is the same substrate this helper follows. The shipped module hard-codes the checkpoint fingerprint shape (`FINGERPRINT_RE`, `sha256:` plus 12 hex) across certifications, state fingerprint, verifier stamp, and failure records, so this feature's tagged-shape change updates the orchestration module's shape constant and fixtures atomically in this feature's change set. Both features add a framework-free suite; this one lands second, so the same change set adds the new command to `CI_SUITE_COMMANDS` in `tests/release-surface.test.js`, which is the authority for the suite count and derives the sentence `AGENTS.md` must state, and updates the README run-list and `ci.yml`. The count is no longer pinned as a literal inside `spec-agreement.test.js`; that relocation shipped with the generic release and conformance assertions.

## Status

Migrated into the backlog on 2026-08-11, with six design decisions confirmed one at a time during migration: sole-authority bundled Node helper; unconditional normalization; exclusions as a named mode; the `partial`/`whole-file` tag taxonomy (48 bits each, tagged, no third durable mode); shell-tool removal including the code-patch path; and a fixture suite covering the full contract. The later agreement-gate design extends normalization to all canonical byte framing and adds selector-aware full digests without changing those tagged-mode decisions. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The fingerprint consumers this centralizes are shipped before the universal-entry MVP in `commands/handover.md` and `skills/revise/SKILL.md`, then move to `skills/handover/SKILL.md` and `internal/revise/SKILL.md`; this feature relocates the computation from whichever active sources exist when it lands.
- The `skills/ready/ready.js` / `ready.test.js` framework-free fixture convention this helper follows (existing).

Present chosen spec for agreement before work shipped before Content fingerprint helper.

Landing order: the wave-convergence lifecycle shipped 2026-08-14 in the 2.2.0 batch; SKILL.md's lifecycle sections are wave-era prose. Derive lifecycle-touching edits from that prose. The agreement gate shipped first and removed the `Status:` exclusion from every inline recipe before this helper centralizes the resulting contract.

## Hardening

- (None yet; this file has not been through a revise-spec run.)
