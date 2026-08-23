# Skip-notice git cause Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the version-increase gate's skip notice carry the last git error so a broken git (missing binary, corrupt object store) is distinguishable from a genuinely missing ref.

**Architecture:** `resolveUnpushedRange(run)` in `tests/release-gate.js` keeps its two-probe loop and its skip-with-notice contract; the bare `catch` gains a binding that retains the last caught error, and the exhaustion return appends that error's message (whitespace-collapsed to one line) to the unchanged `SKIP_NOTICE` prefix. The live-gate consumer in `tests/release-surface.test.js` is untouched: it still reports the notice through `t.diagnostic` and never fails. One unit test pins the appended cause and the no-error fallback.

**Tech Stack:** Node.js 22, `node:test` + `node:assert/strict`, no build step. Shell for every command in this plan: Git Bash (POSIX sh), run from inside the checkout being edited; use forward slashes, never `cd`. Every command resolves the checkout root itself with `ROOT=$(git rev-parse --show-toplevel)` so a worktree run edits, verifies, and commits the same checkout; never substitute the canonical clone path.

**Spec:** [.claude/QUICK_WINS.md](.claude/QUICK_WINS.md)

## Governing specs

- Spec JSON: {"kind":"bullet-entry","path":".claude/QUICK_WINS.md","selectors":[{"parentHeading":"## Release gate follow-ups","entryTitle":"**Name the git failure in the version-increase gate's skip notice.** `resolveUnpushedRange` in `tests/release-gate.js` catches every error from both `merge-base` probes and returns the no-upstream skip notice, so a missing git binary or a corrupt object store reads as a skip (a `t.diagnostic`, never a failure). Skip-with-notice is the accepted behavior; preferred shape: append the last caught error message to the notice so a broken git is distinguishable from a missing ref."}],"workUnit":null}

## Global Constraints

- Skip-with-notice stays the accepted behavior: the change never turns a skip into a failure (governing entry and accepted digest, material exclusions).
- The notice keeps its exact prefix `version-increase check skipped` (pinned by `assert.match(skipped.notice, /version-increase check skipped/)` in `tests/release-surface.test.js`).
- The appended message is the error from the final probe (`origin/main`); a probe that throws nothing appends nothing new (accepted digest, material decisions).
- No plugin version bump: `tests/**` is not shipped behavior under the AGENTS.md convention.
- Prose and code style: no em-dashes, en-dashes, emoji; files end with a newline; the repository's JS files use no semicolons and two-space indentation (match `tests/release-gate.js`).
- Conventional Commits subjects, max 72 chars, subject-only, no trailers.

---

### Task 1: Append the last git error to the skip notice

**Files:**
- Modify: `tests/release-gate.js` (the `resolveUnpushedRange` function and the comment above it)
- Test: `tests/release-surface.test.js` (the test titled `the unpushed-range resolver prefers the upstream, falls back to origin/main, and reports a skip`)

**Interfaces:**
- Consumes: `resolveUnpushedRange(run)` where `run(args: string[]): string` runs git and throws on failure (the live runner is `execFileSync`, whose error message embeds git's stderr).
- Produces: unchanged signature; return shape stays `{ base: string, notice: null }` on success and `{ base: null, notice: string }` on exhaustion. The exhaustion notice is now `SKIP_NOTICE` alone when no probe threw, otherwise `` `${SKIP_NOTICE} (last git error: ${message})` `` where `message` is the last caught error's message with runs of whitespace collapsed to single spaces and trimmed.

- [ ] **Step 1: Write the failing assertions**

In `tests/release-surface.test.js`, the quoted block below appears exactly once. Replace it:

```js
  const detachedRunner = () => { throw new Error('fatal: no upstream and no origin/main') }
  const skipped = resolveUnpushedRange(detachedRunner)
  assert.equal(skipped.base, null)
  assert.match(skipped.notice, /version-increase check skipped/, 'the skip branch must report a notice')
```

with:

```js
  const detachedRunner = () => { throw new Error('fatal: no upstream and no origin/main') }
  const skipped = resolveUnpushedRange(detachedRunner)
  assert.equal(skipped.base, null)
  assert.match(skipped.notice, /^version-increase check skipped/, 'the skip branch must report a notice')
  assert.match(skipped.notice, /\(last git error: fatal: no upstream and no origin\/main\)$/, 'the skip notice must name the last git error')

  const missingBinaryRunner = () => { throw new Error('Command failed: git merge-base HEAD origin/main\nspawnSync git ENOENT\n') }
  assert.match(resolveUnpushedRange(missingBinaryRunner).notice, /\(last git error: Command failed: git merge-base HEAD origin\/main spawnSync git ENOENT\)$/, 'a multi-line git error is collapsed onto the notice line')

  const silentRunner = () => ''
  assert.equal(resolveUnpushedRange(silentRunner).notice, 'version-increase check skipped: no upstream and no origin/main to resolve the unpushed range', 'a probe that throws nothing appends nothing')
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `ROOT=$(git rev-parse --show-toplevel); node --test --test-name-pattern "unpushed-range resolver" "$ROOT/tests/release-surface.test.js"`

Expected: FAIL. The first new assertion fires: `AssertionError ... the skip notice must name the last git error` (the current notice is the bare `SKIP_NOTICE`, which does not end in `(last git error: ...)`).

- [ ] **Step 3: Implement the change**

In `tests/release-gate.js`, the quoted block below appears exactly once. Replace it:

```js
// The base is the merge-base with the upstream when one exists (the unpushed
// commits are exactly base..HEAD), otherwise with origin/main; when neither
// resolves the caller skips and reports the notice.
function resolveUnpushedRange(run) {
  for (const ref of ['@{upstream}', 'origin/main']) {
    try {
      const base = run(['merge-base', 'HEAD', ref]).trim()
      if (base !== '') {
        return { base, notice: null }
      }
    } catch {
      // The ref does not exist here; try the next one.
    }
  }

  return { base: null, notice: SKIP_NOTICE }
}
```

with:

```js
// The base is the merge-base with the upstream when one exists (the unpushed
// commits are exactly base..HEAD), otherwise with origin/main; when neither
// resolves the caller skips and reports the notice. The notice carries the
// last probe's error so a broken git (missing binary, corrupt object store)
// reads differently from a missing ref.
function resolveUnpushedRange(run) {
  let lastError = null
  for (const ref of ['@{upstream}', 'origin/main']) {
    try {
      const base = run(['merge-base', 'HEAD', ref]).trim()
      if (base !== '') {
        return { base, notice: null }
      }
    } catch (error) {
      lastError = error
    }
  }
  if (lastError === null) {
    return { base: null, notice: SKIP_NOTICE }
  }
  const message = lastError.message.replace(/\s+/g, ' ').trim()

  return { base: null, notice: `${SKIP_NOTICE} (last git error: ${message})` }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `ROOT=$(git rev-parse --show-toplevel); node --test --test-name-pattern "unpushed-range resolver" "$ROOT/tests/release-surface.test.js"`

Expected: PASS (`# pass 1`, `# fail 0`).

- [ ] **Step 5: Run the whole release-surface suite**

Run: `ROOT=$(git rev-parse --show-toplevel); node "$ROOT/tests/release-surface.test.js"`

Expected: every test passes (`# fail 0`). The live gate test either passes or prints a `version-increase check skipped` diagnostic; on this checkout with `origin/main` present it resolves a base and passes.

- [ ] **Step 6: Verify the byte sweep and file ending**

Run: `ROOT=$(git rev-parse --show-toplevel); rg -n --crlf "[^ -~]" "$ROOT/tests/release-gate.js" "$ROOT/tests/release-surface.test.js"; echo "rg exit $?"`

Expected: no matching lines printed and `rg exit 1` (exit 1 is ripgrep's zero-matches status; exit 0 with printed lines means a non-ASCII byte landed and must be removed; exit 2 means the check did not run and must be investigated). `--crlf` is required: the working-tree files are CRLF on a Windows checkout (`core.autocrlf=true`, and `.gitattributes` forces LF only for `*.workflow.js`), and without it the carriage return on every line matches the negated printable class.

Run: `ROOT=$(git rev-parse --show-toplevel); tail -c 1 "$ROOT/tests/release-gate.js" | od -An -c`

Expected: ` \n`

- [ ] **Step 7: Commit**

```bash
git add tests/release-gate.js tests/release-surface.test.js
git commit -m "test(release): name the last git error in the skip notice"
```

### Task 2: Archive the quick win

**Files:**
- Modify: `.claude/QUICK_WINS.md` (remove the entry under `## Release gate follow-ups`)
- Modify: `.claude/QUICK_WINS_HISTORY.md` (append the shipped entry)

**Interfaces:**
- Consumes: the commit SHA produced by Task 1 Step 7 (read it with `git log --oneline -1 -- tests/release-gate.js`).
- Produces: nothing downstream.

- [ ] **Step 1: Remove the entry from the active index**

In `.claude/QUICK_WINS.md`, delete the bullet that starts with `- **Name the git failure in the version-increase gate's skip notice.**` together with its six indented `Operating context` continuation lines (the continuation ends with `tier low, every dimension effort low.`) and the blank line that follows them. The two sibling bullets in `## Release gate follow-ups` stay. Use a script (Python, `newline=''` to preserve CRLF if present) or the Edit tool; verify afterwards with:

Run: `ROOT=$(git rev-parse --show-toplevel); grep -c "Name the git failure in the version-increase gate's skip notice" "$ROOT/.claude/QUICK_WINS.md"; echo "exit $?"`

Expected: `0` and `exit 1` (grep -c exits 1 on zero matches; that is the pass signal here).

- [ ] **Step 2: Append the history entry**

The file is a flat list of `- **Title** (files): body. Shipped <date>.` bullets. Append this bullet as the new last line (keep the trailing newline):

```markdown
- **Name the git failure in the version-increase gate's skip notice** (`tests/release-gate.js`, `tests/release-surface.test.js`): `resolveUnpushedRange` now retains the last error caught across its two `merge-base` probes and appends its message (whitespace-collapsed) to the skip notice as `(last git error: ...)`, so a missing git binary or a corrupt object store reads differently from a missing ref; a probe that throws nothing leaves the bare notice. Skip-with-notice stays the behavior and the `version-increase check skipped` prefix is unchanged. Shipped 2026-08-23 in <sha from Task 1>.
```

Replace `<sha from Task 1>` with the short SHA from Task 1 Step 7. Append with a script that preserves the file's line endings (Python, `newline=''`, matching the file's existing terminator) or the Edit tool; then verify:

Run: `ROOT=$(git rev-parse --show-toplevel); grep -c "Name the git failure in the version-increase gate's skip notice" "$ROOT/.claude/QUICK_WINS_HISTORY.md"; echo "exit $?"`

Expected: `1` and `exit 0` (exactly one history bullet carries the title).

Run: `ROOT=$(git rev-parse --show-toplevel); grep -c "<sha from Task 1>" "$ROOT/.claude/QUICK_WINS_HISTORY.md"; echo "exit $?"`

Expected: `0` and `exit 1` (the placeholder was substituted; `grep -c` exits 1 on zero matches, which is the pass signal here).

- [ ] **Step 3: Confirm the backlog still parses**

Run: `ROOT=$(git rev-parse --show-toplevel); node "$ROOT/skills/ready/ready.js" "$ROOT" | node -e "const r=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify({errors:r.structuralErrors.length,notices:r.notices.length,skipNotice:r.ready.some(e=>e.title.includes('skip notice'))}))"`

Expected: `{"errors":0,"notices":0,"skipNotice":false}`

- [ ] **Step 4: Commit**

```bash
git add .claude/QUICK_WINS.md .claude/QUICK_WINS_HISTORY.md
git commit -m "docs(quick-wins): archive the skip-notice git cause"
```

No walk-and-remove sweep is needed: quick wins carry no `**Requires:**` line and no `FEATURES.md` or `BUGS.md` entry references this one (verify with `ROOT=$(git rev-parse --show-toplevel); grep -rn "skip notice" "$ROOT/.claude/FEATURES.md" "$ROOT/.claude/BUGS.md"`; expected: no output).
## Hardening

- revise-plan graduated 2026-08-23 04:13 at e614b05, scope: whole file, content: 569f8e4c
