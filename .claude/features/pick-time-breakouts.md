# Pick-time breakouts

Index-only backlog entries gain a permanent governing file when they are selected for lifecycle work. Materialization happens after a narrow confirmation of the selected source entry and before design agreement, so the user approves one decision-complete digest over the artifact that will actually govern the work.

## Motivation

Working an index-only entry through the lifecycle accretes content that its one-line index representation cannot hold cleanly: Operating context, review clarifications and decisions, verification evidence, hardening stamps, and completion records. Indented continuation lines violate the one-paragraph-or-bullet-per-physical-line discipline, editing the selected entry changes the structural agreement target, and index-only entries provide no durable whole-file home for lifecycle records. A pick-time breakout gives selected work the same whole-file lifecycle surface as an entry that started with a breakout, without creating files for work that has not been picked.

## Operating context

- **Deployment environment and operational criticality**: public GitHub plugin used primarily by one expert developer on Claude Code and Codex. The feature changes a write boundary in the daily backlog-selection and agreement path but touches no production system or external data.
- **Audience**: judgment recorded as `personal use`; public availability does not change the single present decision-maker for materialization and agreement.
- **Failure consequence and data or security sensitivity**: a wrong transition can lose or obscure backlog wording, link the wrong governing artifact, or resume against inconsistent state. Git makes the content recoverable, and no sensitive data is introduced. The failure-consequence uplift does not fire.
- **Concurrency and compatibility risk**: materialization spans two durable writes, must resume deterministically after either write, and must behave consistently across Claude Code and Codex. This uplift fires.
- **Reversibility and recovery cost**: files and index edits are git-tracked and versioned, so reversal is cheap. This uplift does not fire.
- **Expected feature lifetime**: long-lived; this becomes the permanent lifecycle entry contract for selected index-only work. This uplift fires.

Derivation per `internal/revise/rigor.js`: audience `personal use` gives baseline `low`; concurrency and compatibility plus expected lifetime fire two uplifts. `node internal/revise/rigor.js "personal use" 2` yields tier `high`, with high effort for validation, recovery, compatibility, observability, and proof.

## Artifact model

The feature applies when a selected entry in `QUICK_WINS.md`, `FEATURES.md`, or `BUGS.md` has no breakout link. Each selected entry gets its own breakout. Selecting several entries produces several independent breakout seeds and never a grouped artifact.

Canonical locations are `.claude/quick_wins/<slug>.md`, `.claude/features/<slug>.md`, and `.claude/bugs/<slug>.md`. A deterministic slug is derived from the existing title. If the canonical path already belongs to a different source identity, materialization fails closed and asks the user for a different slug rather than overwriting or silently suffixing the path.

A breakout records source identity in a top-level `## Source identity` section immediately after its opening summary. The section contains exactly four single-line fields in fixed order: `Index: <repo-relative index path>`, `Parent section: <exact heading text without Markdown heading markers>`, `Original title: <exact display title before linking>`, and `Entry fingerprint: sha256:<64 lowercase hexadecimal characters>`. A Quick Win adds `Original entry: <exact original unlinked Markdown bullet>` as a required fifth line; that field is forbidden for feature and bug breakouts. The separator is one colon followed by one space, values cannot be empty, fields never wrap or join, duplicates and unknown fields are structural errors, and the section occurs exactly once.

The entry fingerprint covers the original complete entry after line endings are normalized to LF and the terminal newline is omitted. For a Quick Win this is its single bullet. For a feature or bug it runs from the unlinked `###` heading through the final line before the next `###` or `##` heading, including its description, dependency fields, and slice fields. Source identity is created once during materialization, is scoped to that breakout, never refreshes when later design prose changes, and is consumed only by collision checks and partial-transition recovery. It is not an agreement stamp or persisted authorization and remains in the permanent breakout after shipping.

For a Quick Win, `## Source identity` is followed immediately by a top-level `## Captured request` section containing exactly one single-line field, `Captured entry: <current agreed unlinked Markdown bullet>`. It uses the same separator, nonempty-value, no-wrap, exactly-once, and no-unknown-field rules as the source fields. `Original entry` and `Captured entry` are identical at materialization. `Original entry` is immutable; `Captured entry` is frozen as design work evolves and changes only through explicit source-drift reconciliation.

The active Quick Win index bullet remains the durable captured request, while the breakout governs operating context, design decisions, review, implementation, hardening, and completion. After stripping the canonical title link, the current bullet must equal `Captured entry` exactly. If reconciliation adopts corrected index wording, the controller atomically replaces `Captured entry` with the agreed unlinked bullet while leaving `Original entry` and the other source-identity fields unchanged; if it keeps the captured wording, only the index is restored. A failed reconciliation write leaves the mismatch visible and blocks continuation. This frozen-capture contract preserves detailed wording and grepability without pretending that the index bullet is a live design synopsis.

Feature and bug entries retain their existing companion-excerpt contract. Their index descriptions remain current summaries of the breakout design and are synchronized whenever material design prose changes. Their immutable materialization identity records where the breakout came from but does not freeze the live excerpt.

The breakout carries no `Requires:` or `External:` field. Dependency authority remains solely in the index. The breakout is the whole-file governing artifact for agreement and every later lifecycle record.

No breakout is created for an unpicked entry. A capture already too large for its index should be promoted through the existing feature or bug breakout convention instead of invoking pick-time materialization early.

## Link grammar and text preservation

Quick Wins use `- **[Title](quick_wins/<slug>.md).** <original remainder>`. Materialization adds the link around the existing title and changes no other title text, punctuation, spacing, or remainder text.

Features and bugs use their existing linked-heading grammar, `### [Title](features/<slug>.md)` or `### [Title](bugs/<slug>.md)`. Materialization changes only the heading link; the existing description, dependency fields, slice fields, spacing, and other entry text remain unchanged.

All rewritten index entries remain on their existing physical lines. Writes preserve the index file's BOM and line-ending convention, and every new breakout ends with a newline.

## Materialization and agreement flow

1. The user selects an index-only entry.
2. The agent displays the complete current index entry and asks whether to materialize it at the stated canonical path. This confirmation authorizes only breakout creation and the title-link rewrite. It does not approve a design digest or authorize later lifecycle work.
3. On confirmation, a deterministic controller creates the breakout first using an exclusive, atomic destination write. It seeds the breakout with the complete source information and the design content derivable from the entry without inventing new decisions.
4. After verifying the created breakout, the controller atomically rewrites the index to add only the canonical title link.
5. Because the governing target has changed structurally, the agreement controller presents one decision-complete digest over the whole breakout together with its companion index entry. The digest includes the rewritten index line, and for a Quick Win it verifies exact equality with the captured entry after stripping the link.
6. Explicit agreement on that digest authorizes the normal review, planning, implementation, or handover lifecycle. If the user declines or revises it, the linked breakout remains as paused proposal state and no rollback or deletion occurs.

Materialization confirmation and design agreement are intentionally distinct. The first permits a deterministic representation change; the second approves the resulting governing decisions. No agreement authority is persisted across sessions.

## Durable transition and recovery

The two writes produce expected durable states with deterministic resume behavior:

- **Neither breakout nor link exists**: ordinary initial state. Display the complete current entry and request materialization confirmation.
- **Breakout exists and the index entry remains unlinked**: verify that the breakout source identity matches the current entry and that the path is canonical. During the same uninterrupted confirmed run, complete the index rewrite. In a later session, display the complete entry and request materialization confirmation again before adding the link. Preserve any proposal edits already present in a matching breakout rather than overwriting them.
- **Matching breakout and canonical index link both exist**: materialization is complete. Treat the breakout as governing and present or resume its single design-agreement digest.
- **The canonical path exists with a different source identity**: path collision. Fail closed, preserve both artifacts, and request a different slug.
- **The index links to a missing or unreadable breakout**: structural error. Do not reconstruct or overwrite the target from the index alone.
- **The index carries a malformed, noncanonical, or ambiguous breakout link**: structural error. Report the expected grammar and do not guess the intended target.
- **A Quick Win differs from its immutable captured entry after the link is stripped**: source drift. Present the current index bullet and captured entry for explicit reconciliation before any digest; never select or overwrite one silently.
- **A feature or bug companion excerpt conflicts materially with its breakout**: ordinary companion drift. Reconcile the excerpt and breakout under the existing synchronized-excerpt rule before agreement or continuation.

If a write or verification fails, the controller reports the exact durable state and stops. It never treats a failed probe as a clean state. A later session derives recovery from the artifacts above rather than from retained conversational authority.

## Lifecycle integration

`skills/ready/ready.js` recognizes canonical linked Quick Win titles, resolves `quick_wins/<slug>.md`, and applies the existing breakout hygiene rules. A linked breakout that contains `Requires:` or `External:` is a structural error because the index remains the sole dependency authority. Ready output preserves the entry title and full index wording.

`skills/spec-agreement/spec-agreement.js` and its skill procedure own the confirmation, materialization, post-write target transition, and companion mapping. A materialized breakout uses the whole-file candidate selector. A multi-entry agreement receives one governing seed per breakout.

`skills/handover/SKILL.md` treats the materialized file as the governing artifact for hardening and completion stamps. The index-only no-stamp special case applies only before materialization and cannot bypass the confirmation flow.

`internal/revise/spec.md` sends picked work through the breakout and retires the indented-continuation prescription for selected index-only entries. Review receives the companion index entry as a consistency surface, including the Quick Win captured-entry equality rule, while the breakout alone is the reviewed governing artifact.

`skills/init-backlog/` creates `.claude/quick_wins/`, documents the linked-title and persistent-history conventions, and includes Quick Win breakouts in backlog line-discipline discovery. The directory may be absent in an older repository until initialization or the first materialization creates it.

## Retention and shipping

A materialized breakout is permanent, including when the user pauses or declines its first digest. The workflow does not delete orphan-looking breakouts automatically because they may contain proposal edits or recovery evidence.

When a Quick Win ships, its active linked bullet is removed from `QUICK_WINS.md` and the same linked bullet is appended to `QUICK_WINS_HISTORY.md`. The breakout remains at `.claude/quick_wins/<slug>.md` with its hardening and completion provenance. Features and bugs keep their existing history and retention behavior.

## Validation contract

Fixture coverage includes all three index types, single and multiple selections, exact Quick Win text preservation, feature and bug companion synchronization, canonical path and link parsing, source identity collisions, missing linked files, forbidden dependency fields in breakouts, and permanent Quick Win history links.

Recovery fixtures exercise every durable state after each successful write, same-session completion, later-session reconfirmation, declined design agreement, Quick Win captured-entry drift, feature and bug excerpt drift, write failure, verification failure, and unreadable targets. Each cautionary probe must fail closed rather than classifying an error as a clean or absent state.

Repository verification covers the ready parser suite, agreement controller suite, init-backlog unwrap suite, handover and revise prose pins, release-surface expectations, host-discovery smoke tests, universal-skill topology, and the repository's own hard-wrap gate. Cross-host fixtures prove that canonical paths, normalized fingerprints, line endings, and link resolution behave identically on Claude Code and Codex.

## Explicit non-goals

- Grouping several selected entries into one breakout.
- Creating breakouts for entries that have not been selected.
- Persisting design agreement or materialization authority across sessions.
- Moving `Requires:` or `External:` authority out of the indexes.
- Automatically deleting, merging, overwriting, or repairing divergent durable artifacts.
- Summarizing, shortening, or otherwise rewriting a Quick Win's captured index text.
