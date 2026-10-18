# Migration turns private exclusions into shared ignore rules

## Current evidence

The audit private-ignore-source probe began with .git/info/exclude owning the legacy file exclusion. After migration the new destination was ignored by a root .gitignore rule. The ignored boolean survived, but its private storage choice did not.

Evidence was examined during the 2026-09-20 migration reconciliation and [independent shipped-capability audit](../reports/pre-v3-shipped-capability-audit-20260921.md); the code baseline was f032030, plugin 3.2.0. Native-host behavior is not inferred from deterministic probes.

The defect occurred in a real project on 2026-10-12, with installed 3.3.10 on Claude Code, in a customer repository shared with other developers. Its legacy `.claude/` backlog was kept out of Git only by `/.claude/` in `.git/info/exclude`, the tracked `.gitignore` had no rule for it, and inspect reported every relocated file and directory policy as untracked and ignored. Apply completed without structural errors and appended `/.nightshift/FEATURES.md`, `/.nightshift/BUGS.md`, `/.nightshift/QUICK_WINS.md`, `/.nightshift/PATTERNS.md`, `/.nightshift/FEATURES_HISTORY.md`, `/.nightshift/BUGS_HISTORY.md`, `/.nightshift/QUICK_WINS_HISTORY.md` and `/.nightshift/runs/` to the tracked `.gitignore`, an unstaged modification that neither the inspect output nor the apply result mentioned. The project's setup journal lists no legacy `.claude/runs` among the relocated folders, so by the code the `/.nightshift/runs/` line came from the runs exclusion that a project's first setup run writes when it relocates no such folder. The relocated `features`, `bugs` and `patterns` directories, empty at the time, were not covered by the new rules, although their `.claude/` sources had been ignored with the rest of `.claude/`. The user reverted the change and added `/.nightshift/` to `.git/info/exclude` instead. By the code, a rerun returns early once the setup journal records completion, so it would not add the rules again while the journal survives. Not checked: whether setup records the ignore source it found, and whether anything depends on the rules being in `.gitignore`. The account comes from that project's maintainer inbox report; the user chose at inbox triage on 2026-10-17 to record it here.

## Required outcome

Preserve the effective private/shared policy choice when relocating backlog content. Do not convert clone-local exclusions into shared repository rules merely to restore an ignored flag.

## Verification and related work

Cover local, shared and global sources, masking parent rules, tracked exceptions, interrupted relocation and reruns. Distinguish preservation of an existing choice from choosing a destination for new exclusions.

Since 2026-10-04 the agreed direction, recorded in [Restore fresh-scaffold track, ignore or defer choice](../features/setup-tracking-choice.md), is that Nightshift ignores content only through self-ignoring folders, whose own `.gitignore` is never committed, and adds no rule to the project's `.gitignore` or `.git/info/exclude`. Setup does not follow it yet: `preservePolicies` in `internal/setup.js`, which a project's first setup run reaches, fresh or migrating, as does the resumption of an interrupted one, still writes ignore rules to the project's `.gitignore`: `/.nightshift/runs/` unless the run relocates a legacy `.claude/runs` folder, the write that [New setup templates ignore effective project newline policy](../BUGS.md#new-setup-templates-ignore-effective-project-newline-policy) also describes, and on migration translated `.gitignore` rules for relocated content plus the per-file rules this defect is about, and by the code directory rules as well, although the observed run added none for its relocated directories, for a reason not established. A fix can restore an ignored flag through a self-ignoring `.gitignore` beside the moved content rather than through any shared rule. The defect was linked to [Init-backlog ignore-shape election](../features/init-backlog-ignore-shape-election.md), retired that day; it remains a distinct acceptance obligation.

## Triage

The user selected tracking during migration triage. The source decision and its scope remain recorded:

- [Migration turns private exclusions into shared ignore rules](../reports/v3-migration-followups-20260920.md#migration-turns-private-exclusions-into-shared-ignore-rules).

Tracking is not implementation authority.
