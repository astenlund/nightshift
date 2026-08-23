# CI Gate Fetch Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the version-increase gate in `tests/release-surface.test.js` enforce on pull-request CI runs by giving the checkout full history, and pin that workflow setting so it cannot be dropped silently.

**Architecture:** One YAML edit adds `fetch-depth: 0` to the single `actions/checkout@v5` step in `.github/workflows/ci.yml`, so `refs/remotes/origin/main` exists on a pull-request checkout and the gate's existing `origin/main` fallback in `tests/release-gate.js` resolves the base. One assertion added to the existing CI conformance test (the one test in `tests/release-surface.test.js` that already reads `ci.yml`) fails the suite if the setting is ever removed. No code in `tests/release-gate.js` changes; local behavior (upstream, then `origin/main`, then skip with a diagnostic) is untouched.

**Tech Stack:** GitHub Actions YAML, Node 22 `node:test` plus `node:assert/strict` (the suite runs as a plain script: `node tests/release-surface.test.js`).

**Spec:** [.claude/QUICK_WINS.md](.claude/QUICK_WINS.md)

## Governing specs

- Spec JSON: {"kind":"bullet-entry","path":".claude/QUICK_WINS.md","selectors":[{"parentHeading":"## Release gate follow-ups","entryTitle":"**Let the version-increase gate fire on pull requests in CI.** `.github/workflows/ci.yml` checks out at the `actions/checkout` default depth 1, so `tests/release-surface.test.js`'s gate sees an empty range on a push to `main` and takes the skip branch on a pull-request checkout (no `origin/main` ref); enforcement today is the local pre-push suite run only. Preferred shape: `fetch-depth: 0` on the checkout step plus a base ref the gate can resolve on a pull request (the PR base branch, passed through the environment or fetched as `origin/main`), keeping the local behavior unchanged."}],"workUnit":null}

## Global Constraints

- Shell for every command in this plan: Git Bash on Windows (forward slashes, no `cd`, full paths).
- Edit the clone at `C:/Git/nightshift`, never an installed plugin cache.
- No plugin version bump: `.github/workflows/ci.yml` and `*.test.js` are repository-only surfaces (pinned as exempt samples in `tests/release-surface.test.js`).
- Never use em-dashes, en-dashes, or emoji in any text written.
- Commit subjects follow Conventional Commits, subject only, no body, no trailers.
- Keep `.claude/plans/2026-08-23-ci-gate-fetch-depth.md` out of every implementation commit.
- The governing entry's archive move (QUICK_WINS.md to QUICK_WINS_HISTORY.md) is owned by handover's bookkeeping step, never by a task in this plan.

---

### Task 1: Pin and set `fetch-depth: 0` on the CI checkout step

**Files:**
- Modify: `tests/release-surface.test.js` (the test titled `CI runs every suite exactly once and runs no undeclared suite`, which begins at the line `test('CI runs every suite exactly once and runs no undeclared suite', () => {`)
- Modify: `.github/workflows/ci.yml` (the line `      - uses: actions/checkout@v5`)

**Interfaces:**
- Consumes: `readRepositoryFile(relativePath)` and `countExact(haystack, needle)` already defined near the top of `tests/release-surface.test.js`; the `node:assert/strict` import bound as `assert`.
- Produces: nothing consumed by later tasks (this is the only task).

- [ ] **Step 1: Write the failing assertion**

In `tests/release-surface.test.js`, append a second test directly after the existing conformance test. Current text (occurs exactly once):

```js
test('CI runs every suite exactly once and runs no undeclared suite', () => {
  const ci = readRepositoryFile('.github/workflows/ci.yml')
  const runLines = ci.split(/\r?\n/).filter((line) => line.startsWith('      - run: node '))

  assert.equal(runLines.length, CI_SUITE_COMMANDS.length, `CI must run exactly ${CI_SUITE_COMMANDS.length} suites`)
  for (const command of CI_SUITE_COMMANDS) {
    assert.equal(countExact(ci, `      - run: ${command}\n`), 1, `CI must run ${command} exactly once`)
  }
})
```

Replace with:

```js
test('CI runs every suite exactly once and runs no undeclared suite', () => {
  const ci = readRepositoryFile('.github/workflows/ci.yml')
  const runLines = ci.split(/\r?\n/).filter((line) => line.startsWith('      - run: node '))

  assert.equal(runLines.length, CI_SUITE_COMMANDS.length, `CI must run exactly ${CI_SUITE_COMMANDS.length} suites`)
  for (const command of CI_SUITE_COMMANDS) {
    assert.equal(countExact(ci, `      - run: ${command}\n`), 1, `CI must run ${command} exactly once`)
  }
})

// The version-increase gate resolves its range against origin/main, which a
// pull-request checkout only has at full depth. Pinning the checkout input
// keeps a later workflow edit from regressing the gate to its skip branch,
// which passes green and would hide the loss.
test('CI checks out full history so the version-increase gate can resolve origin/main on a pull request', () => {
  const ci = readRepositoryFile('.github/workflows/ci.yml')

  assert.equal(countExact(ci, '      - uses: actions/checkout@v5\n        with:\n          fetch-depth: 0\n'), 1, 'the checkout step must carry fetch-depth: 0')
})
```

- [ ] **Step 2: Run the suite to verify the new test fails**

Run: `node C:/Git/nightshift/tests/release-surface.test.js 2>&1 | grep -E "^(not ok|ok) " `
Expected: exactly one `not ok` line (`not ok 2 - CI checks out full history ...`), naming `CI checks out full history so the version-increase gate can resolve origin/main on a pull request` (the `countExact` call returns 0 because `ci.yml` has a bare `- uses: actions/checkout@v5` with no `with:` block); every other test line reads `ok`.

- [ ] **Step 3: Add `fetch-depth: 0` to the checkout step**

In `.github/workflows/ci.yml`, the line `      - uses: actions/checkout@v5` occurs exactly once. Replace it with these three lines (six-space indent on the first, eight and ten on the next two, matching the existing `setup-node` step's `with:` block):

```yaml
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
```

The file must keep its existing line endings; verify with `git -C C:/Git/nightshift ls-files --eol .github/workflows/ci.yml` that the `w/` value is unchanged from before the edit.

- [ ] **Step 4: Run the suite to verify it passes**

Run: `node C:/Git/nightshift/tests/release-surface.test.js 2>&1 | grep -cE "^not ok "`
Expected: `0` (grep prints the count; its exit status is 1 on zero matches and must not be treated as failure).

Then run: `node C:/Git/nightshift/tests/release-surface.test.js 2>&1 | grep -E "^# (pass|fail)"`
Expected: exactly the two lines `# pass 13` and `# fail 0` (baseline recorded while writing this plan: `# pass 12` on commit ef3d777; the new test adds one).

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add .github/workflows/ci.yml tests/release-surface.test.js
git -C C:/Git/nightshift commit -m "ci: fetch full history so the version gate fires on pull requests"
```

Verify the plan file was not swept in: `git -C C:/Git/nightshift show --stat HEAD` lists exactly `.github/workflows/ci.yml` and `tests/release-surface.test.js`.
