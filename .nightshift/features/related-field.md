---
name: related-field
description: Add an optional Related field that declares relations between backlog entries that are not dependencies, declared on both related entries and free to form cycles
metadata:
  type: feature
---

# Related field for non-dependency relations

## Origin

Raised by the user on 2026-10-03 during the dual review of that day's backlog changes, after the reviewers found three records whose prose offered options that exist only once another of them ships, a relation that declaring `**Requires:**` both ways would have turned into a cycle. In the user's words: "we could add a formal optional Related field for these situations. what do you think, another quick win?", then "Related would allow circular edges", and "for Related, the rule should be that all such instances must be declared on both the related entries (i.e. both directions)".

## Current behavior

Checked on 2026-10-03. Backlog entries declare ordering with `**Requires:**`, which the Ready parser resolves and treats as dependencies, reporting any dependency cycle (`buildCycleAnalysis` in `skills/ready/ready.js`). Relations that are not dependencies, such as shared work that whichever entry ships first builds, a mirror case, or a feature that offers more once another ships, live only in prose, where a reader or reviewer cannot always tell them from dependencies; the 2026-10-03 review raised that ambiguity in three records at once, as [Dual strong review for critical work](dual-strong-review.md) records.

## Direction

Settled by the user on 2026-10-03:

- An optional `**Related:**` field lists the entries related to this one without ordering them.
- Every Related relation is declared on both entries.
- Related relations may form cycles; only `**Requires:**` orders work.

The field names the relation; the prose still says how the entries relate where that matters, such as what an entry offers before the related one ships.

## Settled questions

The user agreed these answers on 2026-10-04, when the entry graduated from Exploring to current work. Each question is kept with its answer. Checked the same day: a `**Requires:**` reference to an Exploring draft does not resolve, since the parser registers only tracked entries; `attachEntryMetadata` in `skills/ready/ready.js` drops every label on a quick win, as [Ready silently ignores dependency lines on quick wins](../BUGS.md#ready-silently-ignores-dependency-lines-on-quick-wins) records; a `**Requires:**` reference that does not resolve is a structural error, which keeps its entry out of the ready set; and `--check` fails on any structural error or notice.

- Grammar: whether each reference carries a short note saying how the entries relate, which dependency declarations do not offer today (their indented lines are a slice's own `**Requires:**` and `**External:**` fields, not notes on a reference), and where the field sits relative to `**Requires:**` and `**External:**`. Settled: `**Related:** [Title](link), [Title](link).`, mirroring `**Requires:**` in its in-backlog link references, comma separator, optional trailing period and joining of wrapped continuation lines. It differs in four points: it has no `none.` form, since absence is its only empty form, as for `**External:**`; it takes no bare text; it names whole entries, never slices; and a reference carries no note, since the prose says how the entries relate. It sits at entry level only, after `**Requires:**` and any `**External:**`.
- Where the field may appear. Settled: on tracked entries in all three work indexes, quick wins included. Related does not order work, so it does not wait on how the quick-win dependency bug is settled; a shared mechanism such as the evidence record that [Proportionate review of tracking edits](tracking-review-cost.md) shares with [Acceptance reports carry a checkable evidence digest](../QUICK_WINS.md#acceptance-reports-carry-a-checkable-evidence-digest), built by whichever ships first, relates a feature and a quick win. It does not appear on Exploring drafts: a draft's relations stay in prose and graduation adds the line, as it adds `**Requires:**`.
- What the parser checks: that references resolve and that each declaration has its counterpart on the other entry, reported as structural errors or as notices; no cycle check. Settled: each reference resolves to a tracked entry and has its counterpart on the other entry, and a self-reference or duplicate reference is reported; there is no cycle check. Every such problem is a notice, not a structural error, so `--check` still fails on it while a broken Related line never takes an entry out of the ready set.
- What happens when a related entry ships or is retired. Settled: its Related references are removed from active entries, as satisfied `**Requires:**` references are, and the prose keeps its link.
- Whether Ready shows related entries, for example beside a recommendation or a pickup. Settled: yes. The parser's output carries each item's related entries, and Ready names them in one line beside a recommendation or a pickup.
- Whether and how existing prose relations are converted to Related lines. Settled: the implementing work converts the clear cases, the three records the 2026-10-03 review found and shared-mechanism pairs such as the evidence record, and lists them in its report; ambiguous prose stays prose.

## Before implementation

The consumers are the parser and its fixtures, and the feature, bug and quick-win templates of init-backlog, whose quick-win template today says quick wins carry neither dependency line; [Complete shared backlog parsing and template consistency](v3-parser-consistency.md) touches the same shared metadata. Unwrap needs no change: it already treats a bold label at line start as a block boundary (`LABEL_AT_START` in `internal/backlog-catalog.js`), so a Related line keeps its own line. Setup migration has no Related lines to carry. The record states the grammar, so an agreed readback is enough without a separate spec. The parser and template changes ship with a version increase. Once this ships, [Have docs reviews check dependency declarations and the links Ready cannot](../QUICK_WINS.md#have-docs-reviews-check-dependency-declarations-and-the-links-ready-cannot) covers Related lines too. Tracking and readiness do not authorize implementation.
