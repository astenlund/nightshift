---
name: design-principles
description: Keep Nightshift's reusable design principles in a reference file and a run-time file split by role, linked by GUID anchors, so design decisions cite them instead of re-deriving them
metadata:
  type: feature
status: exploring
---

# Design principles in a reference file and a run-time file

## Origin

Raised by the user on 2026-10-05, outside any run, during a backlog session that graduated a series of Exploring entries, in their words: "wondering if we also should add a PRINCIPLES.md file next to VISION.md and WORKFLOW.md -- what do you think?", then "as with WORKFLOW.md vs workflow.md, we could have one file for reference and one file for run-time", and "to protect against unnoticed corruption, we should probably use guid anchors".

## Current state

Checked on 2026-10-05. [VISION.md](../../VISION.md) states the purpose, the invariant priorities and the direction, and some of its sentences are design principles, such as "Models own engineering and product judgment. Deterministic tools own mechanics where a mistake would lose work, corrupt state, or misrepresent what happened" and "The amount of machinery should be proportionate to the consequence it prevents". [WORKFLOW.md](../../WORKFLOW.md) describes how a run proceeds. No file collects the reusable rules that settled decisions produce. They live in the feature records that settled them, and during the 2026-10-04 to 2026-10-05 session the controller re-derived several of them in successive graduation discussions instead of citing them.

The repository already splits workflow guidance by role: the root `WORKFLOW.md` is design reference that no run loads, and [the operating brief](../../internal/workflow.md) ships in the plugin and is what runs load. [Rename one of the two workflow files](../QUICK_WINS.md#rename-one-of-the-two-workflow-files) records that their names, differing only in case and folder, let readers and agents mix them up.

## Direction

- Two files split by role. A reference `PRINCIPLES.md` at the repository root, beside `VISION.md` and `WORKFLOW.md`, gives each principle its reasoning and links the decisions that established it. A run-time file shipped in the plugin states each rule in one sentence for the agent that applies it.
- The run-time file is the only home of each rule's wording. The reference file links to each rule rather than restating it, and adds only reasoning and evidence.
- Every rule carries a GUID anchor, so that rewording or retitling a rule cannot silently break a link or redirect it to another rule, as a heading-derived anchor would. A packaging test checks that every run-time rule has a reference entry and that every reference entry points at an existing rule.
- The run-time file is loaded by the work that makes design decisions rather than by every run step: revise-spec, the repair guidance in revise-code, and the Exploring skill, whose graduation discussions are where such decisions are settled.

## Guardrails

- A principle needs at least two settled decisions behind it, linked from its reference entry, so the files do not become a dumping ground or a checklist that grows with every decision.
- Neither file restates VISION.md. A principle VISION.md already states either moves or is linked, so the two do not drift.
- Names follow role, not topic, so the pair does not repeat the confusion the workflow rename addresses.

## Candidate principles

Drawn from the 2026-10-04 to 2026-10-05 graduations; each lists the decisions behind it.

- Silence writes nothing: an unanswered or declined question, or one with no user present, never becomes permission. [Restore fresh-scaffold track, ignore or defer choice](setup-tracking-choice.md) for the backlog and the inbox, the tie in [Restore controlled mixed-line-ending repair](v3-mixed-ending-repair.md), and the escape hatch of [User-configurable model policy file](model-policy-file.md).
- A failed check is uncertainty, never evidence of absence. The failed Git check in [Restore fresh-scaffold track, ignore or defer choice](setup-tracking-choice.md) and the recognition rule it carried over from the retired [Init-backlog ignore-shape election](init-backlog-ignore-shape-election.md).
- Personal choices stay out of shared files. The self-ignoring folders of [Restore fresh-scaffold track, ignore or defer choice](setup-tracking-choice.md), and the project policy file that may only narrow the user's in [User-configurable model policy file](model-policy-file.md).
- Plugin defaults stay plugin-owned; user files layer on top and win. [Model knowledge base](model-knowledge-base.md) and [User-configurable model policy file](model-policy-file.md).
- A correction fixes form, never claims. [Recover review report formatting without repeating the assessment](v3-review-result-recovery.md), whose evidence gaps may only be downgraded, and [Restore controlled mixed-line-ending repair](v3-mixed-ending-repair.md), which changes only line terminators.
- One canonical home per rule; everywhere else links. [Complete the spec-review safeguard and authoring guidance](spec-review-safeguard.md), [Complete shared backlog parsing and template consistency](v3-parser-consistency.md) for the file vocabulary, and [Keep the review lens text in one place](../QUICK_WINS.md#keep-the-review-lens-text-in-one-place).

## Open questions

- The two files' names, coordinated with [Rename one of the two workflow files](../QUICK_WINS.md#rename-one-of-the-two-workflow-files) so that both pairs follow one convention, for example a run-time file named for its role such as `internal/design-rules.md`.
- The GUID anchor's form in Markdown and how the packaging test reads it, given that Ready's link checks cover only links between backlog files.
- The route into what a run loads, coordinated with [Separate run-time guidance from reference material](runtime-guidance-separation.md), which draws the same line between run-time guidance and reference.
- Which of VISION.md's principle sentences move to the new files and which stay and are linked.
- Whether a graduation or spec that applies a principle cites its GUID, and whether a decision that contradicts a principle must say so.
- How it relates to [Ground Ready recommendations in the project's direction](ready-project-direction.md), which reads the project's durable direction.

Tracking does not authorize implementation.
