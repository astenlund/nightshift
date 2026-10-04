---
name: v3-mixed-ending-repair
description: Restore controlled mixed-line-ending repair
metadata:
  type: feature
---

# Restore controlled mixed-line-ending repair

Restore inspected normalization of mixed LF/CRLF endings on the controlled backlog surface, using the effective project convention and preserving recoverability.

## Selected outcome

This previously shipped capability is absent from reduced setup. Restore a concrete repair proposal, compose it safely with optional hard-wrap repair, and ask only when the newline choice is genuinely unresolved. Existing-file normalization and new-template materialization are different behaviors.

## Evidence and limits

The audit mixed-endings probe leaves mixed bytes unchanged even with unwrap enabled, with no parser error or notice. The historical bug record describes the earlier approved mechanical repair and byte-exact backups.

The [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md) distinguishes actual code/probe evidence, instruction policy and unverified installed-host behavior. No capability in this entry is declared delivered by its restoration to the backlog.

## Settled questions

The user agreed these answers on 2026-10-04, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: Ready parses entries through `scanMarkdown` in `internal/markdown.js`, which keeps each line's terminator but reports nothing about it and treats a lone carriage return as a line break, while unwrap and Ready's hard-wrap check read through `splitLines` in `internal/backlog-catalog.js`, which removes each line's carriage return before its checks and keeps the original ending for unwrap's writes, so nothing reports a mixed file today; the files Ready and unwrap read are `BACKLOG_FILES` and the Markdown under `BACKLOG_DIRECTORIES` in the same module; and this repository's `.gitattributes` sets `* text=auto eol=lf`.

- The controlled target set. Settled: the backlog files Ready and unwrap already read, meaning the seven top-level backlog files and the Markdown under `features/`, `bugs/` and `patterns/`; specs, reports and the inbox stay out. Only a file that actually mixes LF and CRLF is repaired; a file that uses one ending throughout is left alone, even when Git would check it out with the other.
- How a mixed file is reported. Settled: Ready reports each one as a notice naming the file and the repair command, so `--check` fails on it.
- Where the repair lives and how it composes with hard-wrap repair. Settled: in `unwrap.js`, beside the hard-wrap joins, so both repairs land in one write through unwrap's recoverable write. Without `--write` unwrap reports; with `--write` it repairs, and setup's existing `unwrap` option applies it too.
- Convention precedence. Settled: first, the ending Git would write for that path on checkout, according to its attributes and configuration; when Git leaves the path's bytes unconverted, the ending most of the file's own lines already use.
- Ambiguity handling. Settled: on a tie in the second step, the repair stops for that file and reports the tie, so the controller asks the user which ending to use and reruns with that choice; with no user available the file stays unchanged and the notice remains. Only line terminators change: a byte-order mark and the presence or absence of a final newline are kept, and a file with invalid UTF-8 or a carriage return not followed by a line feed is reported but never repaired.
- How this relates to new-file line endings. Settled: [New setup templates ignore effective project newline policy](../BUGS.md#new-setup-templates-ignore-effective-project-newline-policy) remains a distinct bug, since materializing a new template is a different behavior from normalizing an existing file, but the first step of the precedence is the same rule, built once by whichever ships first.

## Before implementation

The change alters the Ready parser, unwrap, their fixtures and the guidance that describes unwrap, so it rides with a plugin version increase. An agreed readback is enough, since the repair reuses unwrap's recoverable write, which the fix of [Setup unwrap can lose existing backlog content after a partial write](../BUGS_HISTORY.md#setup-unwrap-can-lose-existing-backlog-content-after-a-partial-write) made dependable, and deterministic fixtures are enough evidence, since no model-owned behavior changes. Verify BOM and byte preservation outside intended newline edits, composition with hard-wrap joins, each step of the precedence and the tie with and without a user, interruptions and idempotence, and that invalid encodings and files outside the set are never normalized. Tracking and readiness do not authorize implementation.

## Triage and provenance

Selected for tracking during the 2026-09-20 to 2026-09-21 triage. Related obligations share this outcome while retaining their own deciding cases:

- [Restore controlled mixed-line-ending repair](../reports/v3-migration-followups-20260920.md#restore-controlled-mixed-line-ending-repair).

[The migration decision](../../V3-MIGRATION.md#initialization) preserves the surviving requirement; earlier records: [deterministic-init-backlog](deterministic-init-backlog.md). Historical mechanisms are context, not automatic v3 requirements. Tracking does not authorize implementation.
