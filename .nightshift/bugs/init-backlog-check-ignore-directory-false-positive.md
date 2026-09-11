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

## Impact

The apply step did not write spurious `.nightshift/*/` ignore rules, but only because the destination check returned the same false positive, so `directory.ignored && !ignored` was false. If the false positive had cleared between the source check in `inspect` and the destination check in `preservePolicies` (the migrated-rules block is appended to `.gitignore` between them, changing the file's shape), the tool would have ignored `.nightshift/features/`, `.nightshift/bugs/`, and `.nightshift/patterns/`, hiding new backlog files from `git add` while the migrated tracked files still passed the final tracking check.

## Suggested fix

Treat this as a robustness gap rather than a reproducible git bug. The reporter cannot hand over a deterministic trigger. The defensive change stands on its own: a directory containing tracked files (`git ls-files -- <dir>` non-empty) should be classified as visible regardless of what `check-ignore` says, and the ignore probe should avoid the `--no-index` plus trailing-slash combination, since both alternatives answered correctly while the failure was live. Add a fixture that asserts a directory with tracked children is never reported as ignored.
