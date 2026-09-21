---
name: init-backlog-ignore-shape-election
description: Choose shared or clone-local destinations for new backlog exclusions
metadata:
  type: feature
status: exploring
---

# Init-backlog ignore-shape election

When new backlog exclusions are needed, let the user choose shared .gitignore rules or clone-local .git/info/exclude rules. Inspect effective policy first, preserve existing tracking and rule-source choices, and recognize the selected destination on reruns. This extends the separate fresh-scaffold track, ignore or defer feature.

## Current v3 direction

The user chose to track this retained proposal on 2026-09-20 during [migration triage](../reports/v3-migration-followups-20260920.md#init-backlog-ignore-shape-election). It remains unimplemented design work. The [fresh-scaffold choice](setup-tracking-choice.md) decides whether to track, ignore or defer; this feature decides where newly authorized exclusions belong. Tracking neither feature authorizes implementation.

Use the actual tracked state and effective shared, private, global and parent-directory rules for backlog and applicable instruction files. Explain which effects are shared with other clones and which are local. Existing policy should be recognized rather than prompting again or converting a private choice to a shared one. A failed policy probe is uncertainty, not evidence that no rule exists.

Settle whether the destination is chosen for the whole path set or per path, how mixed existing policies are handled, and what completion means when parent rules mask narrower rules. Support missing and empty ignore files, preserve unrelated content and conventions, and make interrupted application recoverable. A track or defer decision does not authorize an exclusion write.

Verify both destinations, existing rule sources, tracked files, masking parent rules, missing and empty targets, repeated runs, probe failures and interrupted writes. Current setup primarily writes .gitignore through Setup.preservePolicies. The independent audit confirmed that ignored status can survive migration while a private rule source becomes shared; the linked preservation bug tracks that outcome.

## Historical v2 proposal

The original proposal and incident context follow for traceability. Its old module paths, mandatory plans-directory policy and controller mechanics are historical, not current v3 requirements. The current direction above and [agreed migration disposition](../../V3-MIGRATION.md#git-tracking-choices-and-concrete-defects) govern the retained outcome.

Extends `/nightshift:init-backlog`'s track-versus-ignore election with a second choice: when the user elects to ignore rather than track, and the paths are not already ignored, the user picks which ignore shape to use, the tracked `.gitignore` or the clone-local `.git/info/exclude`.

## Motivation

Git has at least two ignore shapes with materially different consequences. A `.gitignore` entry is shared with every clone and visible in history, which is right for a convention the project adopts. A `.git/info/exclude` entry is private to one clone and never committed, which is right for tooling one developer keeps out of a shared repository. Today the controller writes only the repository `.gitignore`, so a user working in a shared corporate repository who wants the backlog out of the shared tree has no supported election; the observed workaround was to edit `.git/info/exclude` by hand after the fact.

The guidance-ignore-state report, preserved in the [v3 inbox triage](../../V3-MIGRATION.md#inbox-triage), describes the election presenter recommending `track` because it never probed whether the resolved guidance file was privately excluded. Its addendum describes an `ignore` election that applies every action successfully yet cannot report complete, because a private `/.claude/` rule masks the eleven repository-local lines the controller just wrote. A second shape is not only a preference; the reported completion check is unreachable in exactly the clones the private shape exists for.

## Scope of the election

The election covers the durable backlog files and anything else the controller ignores on the user's behalf, including `.nightshift/plans/`, whose git-ignored status is unconditional but whose shape is not. The [Nightshift inbox](nightshift-inbox.md) folder is one more path in the same set once it exists.

The choice is presented only when it is live: the user has elected to ignore, and the paths are not already ignored by an existing rule. When the paths are already ignored, the controller reports the matching source and its classification rather than asking again.

## Design points to settle

- Whether the shape is one choice for the whole path set or per path; one choice is simpler and matches how the paths are elected today.
- What the completion check means under each shape. The addendum's failure is that a diagnostic parent-directory match is currently read as absence of the repository-local rule; the classifier needs to treat a masking match as masking, or evaluate the repository-local `.gitignore` in isolation for the policy decision. This must be settled here, because a private-shape election makes the masking case ordinary rather than exceptional.
- How the presentation cites evidence. The election question should say which shape the clone already shows evidence for, using the guidance-file tracking and ignore-source classification retained in the inbox triage.
- What the controller does on a re-run over a clone that elected the private shape: it must recognize the prior election from the clone's own state, since the private shape leaves no tracked record.

## Files this touches

- `skills/init-backlog/init-backlog.js` and its `lib/`, in particular the ignore probes, the classifier that marks a source repository-local or diagnostic, and the apply path that writes ignore lines.
- `skills/init-backlog/templates/`, for any template text that names `.gitignore` specifically.
- `skills/init-backlog/SKILL.md`, for the election prose and the presentation step.
- `tests/init-backlog-controller.test.js` and the prompt baseline manifest, which pin the election's presented text.
- The deterministic init-backlog feature file, which records the current election design and gains the second shape.

## Verification

Fixtures cover an ignore election in a clone with no existing rules under each shape, an election in a clone whose paths are already ignored by a repository-local rule, one already ignored by a private rule, a clone with a masking parent-directory rule (the election reports complete under the settled classifier semantics), a re-run over a clone that previously elected the private shape, and a track election (unchanged behavior). Every cautionary probe fails closed rather than classifying an unreadable git state as absence of a rule.

## Applied migration triage

Keep Git evidence gathering separate from policy assembly and preserve failed-probe uncertainty. The audit reproduced migration converting a private exclusion to a shared rule; [that preservation bug](../bugs/migration-private-ignore-source.md) has its own acceptance case. Choosing new exclusions is not proof that migration preserves an existing source.

- [Separate Git-policy probes from policy assembly](../reports/v3-migration-followups-20260920.md#separate-git-policy-probes-from-policy-assembly).
- [Init-backlog ignore-shape election](../reports/v3-migration-followups-20260920.md#init-backlog-ignore-shape-election).
