> Maintainer inbox report captured 2026-09-11 and triaged into [BUGS.md](../BUGS.md) the same day. Source: an init-backlog run in another project on git 2.55.0.windows.3.

# Directory ignore probe can misreport tracked backlog directories as ignored

## Observed

In `C:/Git/FeatherPod-Private`, `init-backlog.js inspect` reported `directoryPolicies[].ignored: true` for `.claude/features`, `.claude/bugs`, and `.claude/patterns`. All three directories held tracked files and were not ignored.

`Setup.inspect` and `Setup.preservePolicies` (`internal/setup.js`) derive that flag from `git check-ignore --no-index -q -- <dir>/`. Run by hand with `-v` in the same repo, roughly 13:25 local time, the command reported a match for every directory in the tree:

```
$ git -C C:/Git/FeatherPod-Private check-ignore --no-index -v -- .claude/features/ .claude/bugs/ .claude/patterns/ .nightshift/ .nightshift/features/
.gitignore:68:	.claude/features/
.gitignore:68:	.claude/bugs/
.gitignore:68:	.claude/patterns/
.gitignore:68:	.nightshift/
.gitignore:68:	.nightshift/features/

$ git -C C:/Git/FeatherPod-Private check-ignore --no-index -v -- FeatherPod.Server/ docs/ README.md hooks/
.gitignore:68:	FeatherPod.Server/
.gitignore:68:	docs/
.gitignore:68:	hooks/
exit=0
```

Note the empty pattern field between `:68:` and the tab. Line 68 of that `.gitignore` is a blank line (verified with `cat -A`: `$` only, no `^M`). `README.md`, a file, was correctly not matched.

Three variants returned the correct answer at the same moment:

```
$ git check-ignore --no-index -v -- FeatherPod.Server docs      # no trailing slash
exit=1
$ git check-ignore -v -- FeatherPod.Server/ .claude/features/    # with index
exit=1
$ git config --get core.excludesFile
exit=1 (unset)
```

## Reproduction while it was live

Copying the repo's `.gitignore` into a fresh `git init` repo under the scratchpad with one empty `sub/` directory reproduced it:

```
$ cp C:/Git/FeatherPod-Private/.gitignore "$d/.gitignore"
$ git -C "$d" check-ignore --no-index -v -- sub/
.gitignore:68:	sub/
exit=0
```

A bisect that deleted one line at a time from that 70-line file and re-ran the check found that deleting any single line, including comment and blank lines, made the match disappear. The same probe repo with the post-migration 77-line variant (the original plus the seven rules `preservePolicies` appends) still reported `.gitignore:68` for `sub/` and `.nightshift/features/`. A three-line `foo`, blank, `bar` file in the same probe did not trigger it.

## Reproduction after the fact

About 45 minutes later, in the same session, the identical bytes no longer trigger it anywhere:

- The exact committed file (`git show 5a7019a:.gitignore`, 70 lines, 817 bytes, LF, no BOM, sha256 prefix `4d1ced3bd7dd484e`) in a fresh probe repo: exit 1.
- The current 73-line repo file in the probe: exit 1.
- The real repo itself, same command as above: exit 1.
- Replaying the exact earlier probe sequence (three-line file, two-line file, then the committed file, then adding `.nightshift/setup/.gitignore` containing `*`): exit 1 at every step.
- 65 runs with an environment variable padded from 0 to 4096 bytes in 64-byte steps, to perturb heap layout: 0 hits.

Environment facts that did not change between the positive and negative observations: `git version 2.55.0.windows.3`; `core.autocrlf=true` (system), `core.fsmonitor=false` and `core.untrackedcache=true` (user), `core.ignorecase=true` (repo); `~/.config/git/ignore` untouched since 2026-06-18 and containing only two `**/.claude...settings.local.json` patterns; `.git/info/exclude` empty of rules.

What did change in between: the migration itself (files moved, `.gitignore` grew from 70 to 73 lines, `.nightshift/` came into existence), and unrelated activity on the machine. None of those explains why the copied 70-line file in an isolated probe repo reproduced then and does not now.

## Reproduction in the nightshift repository on 2026-09-11

While probing the verbose output format for the ignore-translation fix, a fresh `git init` repo under the session scratchpad reproduced the match deterministically with a six-line CRLF `.gitignore` whose content ends in a blank line:

```
/.claude/plans/*
!/.claude/plans/keep.md
.claude/skills/
.claude/runs/
*.lock
<empty line 6>
```

With one tracked file `.claude/features/a.md`, `git check-ignore --no-index --verbose -z --stdin` over `.claude/plans/keep.md`, `.claude/plans/private.md`, `.claude/features/a.md`, `.claude/runs/`, `.claude/runs/state.sqlite`, `.claude/bugs/` and `.claude/plans/` returned exit 0 and, after the four genuine matches, `.gitignore`, `6`, `''`, `.claude/bugs/` and `.gitignore`, `6`, `''`, `.claude/plans/`: the empty line 6 reported as the matching pattern for both trailing-slash directory paths, while the file paths were judged correctly. Variants run the same day on git 2.55.0.windows.3 with `core.autocrlf=true`: the identical content with LF endings produced no empty-pattern match; a CRLF file with the blank line interior at line 3 reported line 3 the same way; a CRLF file with no blank line produced no match; a trailing bare CR behaved like the CRLF blank line. The tracked directory `.claude/features/` was reported too when given with a trailing slash. So the trigger is a CRLF blank line at any position, not its trailing placement; the original observation was on a file verified as LF, which this reproduction does not explain. Under this trigger, `git check-ignore -q -- .claude/bugs/` with the index consulted still exits 0 for the untracked directory, while dropping the trailing slash (`.claude/bugs`, `.claude/features`) exits 1 in every variant. The probe scripts were scratchpad files and are not committed; the recipe above is sufficient to rebuild them.

## Impact

The apply step did not write spurious `.nightshift/*/` ignore rules, but only because the destination check returned the same false positive, so `directory.ignored && !ignored` was false. If the false positive had cleared between the source check in `inspect` and the destination check in `preservePolicies` (the migrated-rules block is appended to `.gitignore` between them, changing the file's shape), the tool would have ignored `.nightshift/features/`, `.nightshift/bugs/`, and `.nightshift/patterns/`, hiding new backlog files from `git add` while the migrated tracked files still passed the final tracking check.

## Suggested fix

Treat this as a robustness gap rather than a reproducible git bug. The original reporter could not hand over a deterministic trigger; the 2026-09-11 reproduction above supplies one shape (a CRLF `.gitignore` with a blank line, probed with `--no-index` and a trailing slash) that a fixture can start from. The defensive change stands on its own: a directory containing tracked files (`git ls-files -- <dir>` non-empty) should be classified as visible regardless of what `check-ignore` says, and the ignore probe should drop the trailing slash rather than merely the `--no-index` flag, since both alternatives answered correctly while the original failure was live but only the slash-free form clears the CRLF trigger. Add a fixture that asserts a directory with tracked children is never reported as ignored.
