# Move deterministic init-backlog mechanics out of promptspace

Feature: `init-backlog` behavior that has one objectively correct answer, including template bodies, target-creation steps, and structural edits, moves out of the command prompt and into bundled code or static files, while the genuinely semantic judgments (concept coverage of customized prose, ambiguous merges, when a user decision is required) remain with Claude. This file is the authoritative design record.

## What it does

`skills/init-backlog/SKILL.md` is a large, self-contained scaffolder. It carries the authoritative content for the four index files, the three history archives, and the `CLAUDE.md` backlog section as verbatim bundled templates, and it drives the `missing / present / stale` classification and the `create / skip / merge / ask` apply table from that content. Much of that is deterministic: there is one correct result for what a fresh index file or directory should contain. Yet every scaffold run asks the model to reproduce it from the prompt, re-rendering the template corpus and re-deciding mechanical steps a script could produce exactly.

This feature moves the deterministically-answerable portion out of the prompt and into bundled plugin code or static files, using the same judgment the repository already applies to the `Requires:`-line grammar in `skills/ready/ready.js`.

## The boundary test

The boundary between what moves and what stays is a single decision rule:

> **If there is one objectively correct answer, get it out of promptspace.**

A mechanical step with a single correct result leaves the prompt. A step whose outcome depends on meaning, context, or a user preference stays with Claude.

## What moves: the deterministic set

- the static template bodies (the index, history, and `CLAUDE.md` section templates, today reproduced on every run);
- directory creation;
- missing-file creation;
- unambiguous structural edits.

For each of these there is one correct outcome, so deterministic code or a static file replaces prompt re-derivation.

## What stays: the semantic set

Claude keeps the genuinely judgment-dependent steps:

- whether customized existing prose already expresses a required concept;
- resolving ambiguous merges;
- deciding when user input is genuinely required.

These are the current skill's `stale`-classification and `ask`-preference decisions, and they stay in the prompt as purpose-driven judgments under the deterministic rework.

## Re-homing: bundled code or files

Where the deterministic behavior lands is a bundled runtime artifact shipped with the plugin, either code or static files, with `skills/ready/ready.js` as the house precedent: the `Requires:`-line grammar is a one-correct-answer computation, was moved out of promptspace, and is fixture-tested. Applying the same precedent here, template bodies become bundled static files and structure-changing steps become bundled Node.

The proposal deliberately leaves the code-versus-file attribution open per candidate, and this design keeps that: whether each candidate gets a bundled static file, bundled code, or stays in the prompt is a placement decision left to the implementing session, not a contract fixed here.

## Status

Migrated into the backlog on 2026-08-12, with three design decisions confirmed one at a time during migration: the one-objectively-correct-answer boundary test with its deterministic / semantic memberships; re-homing to bundled code or static files with the per-candidate code-vs-file attribution left open; and the boundary test as a standing codebase-wide directive to be recorded as a pattern only once a second carrier exists. Not yet designed as a buildable change; to be hardened by a revise-spec run before planning.

## Requirements

- The `init-backlog` scaffold content and its templates in `skills/init-backlog/SKILL.md` (existing after the universal-entry migration; the extraction subject). Note as of 2026-08-15: the shipped exploring-visibility work rewrote five passages in this file (the FEATURES.md template's Exploring preamble and Requires-lines carve-outs, the CLAUDE.md template's backlog sentence, the freshness checklist item for Exploring, and the either-location note) to the two-view wording. Extraction carries that wording forward; it is not a conflict, only a reminder to re-read the templates rather than working from an older mental copy.
- The bundled-runtime-artifact pattern in `skills/ready/ready.js` and its fixture suite (existing; the precedent this feature extends).

## Hardening

- (None entered yet; this file has not been through a revise-spec review.)
