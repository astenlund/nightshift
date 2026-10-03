---
name: related-field
description: Add an optional Related field that declares relations between backlog entries that are not dependencies, declared on both related entries and free to form cycles
metadata:
  type: feature
status: exploring
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

## Open questions

- Grammar: whether each reference carries a short note saying how the entries relate, which dependency declarations do not offer today (their indented lines are a slice's own `**Requires:**` and `**External:**` fields, not notes on a reference), and where the field sits relative to `**Requires:**` and `**External:**`.
- What the parser checks: that references resolve and that each declaration has its counterpart on the other entry, reported as structural errors or as notices; no cycle check.
- Whether Ready shows related entries, for example beside a recommendation or a pickup.
- Consumers: the parser, unwrap's handling of dependency declarations, the init-backlog templates and migration, and fixture coverage for the new grammar, which [Complete shared backlog parsing and template consistency](v3-parser-consistency.md) also touches.
- Whether and how existing prose relations are converted to Related lines.
- Docs reviews: [Have docs reviews check dependency declarations and the links Ready cannot](../QUICK_WINS.md#have-docs-reviews-check-dependency-declarations-and-the-links-ready-cannot) is to cover Related lines too once this ships.

Tracking does not authorize implementation.
