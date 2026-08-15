# Surface Exploring Entries in Ready Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/nightshift:ready` lists `## Exploring` drafts titles-only in a clearly-marked not-ready section, and a new thin `/nightshift:exploring` command renders the full draft list, both fed by one new always-present `exploring` array in the ready parser's JSON.

**Architecture:** One parser change in `skills/ready/ready.js` collects `## Exploring` `###` entries (FEATURES-only) into a new top-level `exploring` output array instead of dropping them, and routes their breakout links into the existing broken-link notice check with a draft-specific wording tail. Two renderers project that one array: the ready skill (titles only) and a new bundle-less command `commands/exploring.md` (full items). A prose sweep retires every "ready skips/ignores Exploring" claim across the template and repo instruction files.

**Tech Stack:** Node.js (no framework; plain-assert fixture tests), markdown command/skill prose.

**Spec:** `.claude/features/ready-exploring-visibility.md` (hardened, stamp content `b6e8b045`). The plan argues from the spec; executors read both.

## Global Constraints

- Never use em-dashes, en-dashes, or emoji in any generated text; ASCII throughout (repo convention).
- All files end with a trailing newline; `ready.js` and `ready.test.js` are LF files.
- Commits are subject-only Conventional Commits (`type(scope): subject`, max 72 chars), no body, no `Co-Authored-By` trailer.
- Stage ONLY the files each task names (`git add <exact paths>`). Never `git add -A`. Never stage this plan file, anything under `.claude/`, or `.tmp/`.
- Test command (works from any cwd): `node C:/Git/nightshift/skills/ready/ready.test.js`. Expected pass count BEFORE this plan: the suite prints `N passed, 0 failed`; each task states its expected delta.
- Exactly one version bump for the whole batch, in Task 6. Do not bump in any other task.
- Edit the clone at `C:/Git/nightshift`, never an installed plugin cache.

---

### Task 1: Parser collects the `exploring` array

**Files:**
- Modify: `skills/ready/ready.js` (extractEntries at lines ~151-236, analyze at ~549-576 and ~620)
- Test: `skills/ready/ready.test.js`

**Interfaces:**
- Consumes: existing `extractEntries(content, excludedSectionTitles, opts)`, `firstExcerpt(bodyLines)`, `analyze(files)`.
- Produces: `extractEntries` gains `opts.collectSections` (array of lowercase section titles; when absent or empty, the returned `collectedEntries` is always `[]`, so every existing caller is unaffected) and returns `{ entries, proseOnlySections, collectedEntries }`. `analyze` output gains `exploring: [{ index, title, link, excerpt }]`, always present (possibly empty), `link` verbatim from the heading (`null` for an unlinked heading). Later tasks rely on `out.exploring` and on `parsed.FEATURES.collectedEntries`.

- [ ] **Step 1: Write the failing tests**

In `skills/ready/ready.test.js`, insert immediately AFTER the closing `});` of the test named `'Exploring and legacy Implemented/Fixed sections are excluded everywhere'` (before the `// ---------- analyze() on the gates fixture ----------` comment):

```js
test('exploring drafts are collected with full item shape', () => {
  assert.deepStrictEqual(result.exploring, [{
    index: 'FEATURES.md',
    title: 'Draft thing',
    link: 'features/draft.md',
    excerpt: 'Pre-dependency brainstorm; must be excluded.',
  }]);
});
```

Insert immediately AFTER the closing `});` of the test named `'missing indexes are reported and do not abort'`:

```js
test('exploring is always present and empty without an Exploring section', () => {
  assert.deepStrictEqual(gates.exploring, []);
  assert.deepStrictEqual(analyze({}).exploring, []);
});
```

Insert immediately BEFORE the `// ---------- CLI smoke test ----------` comment:

```js
// ---------- analyze() on the exploring fixture ----------

const FEATURES_EXPLORING = `# Features

## Progression

### [Consumer](features/consumer.md)

References a draft; must be a structural error.

**Requires:** [Bare draft idea](features/draft-b.md).

## Exploring

### Bare draft idea

Unlinked heading draft.

### [Linked draft](features/draft-b.md)

Draft with a historical Requires line.

**Requires:** [Consumer](features/consumer.md).

### [External idea](https://example.com/idea)

Draft whose heading links off-repo.
`;

const exploringRs = analyze({ FEATURES: FEATURES_EXPLORING });

test('unlinked exploring heading yields link: null', () => {
  const bare = exploringRs.exploring.find((e) => e.title === 'Bare draft idea');
  assert.deepStrictEqual(bare, {
    index: 'FEATURES.md',
    title: 'Bare draft idea',
    link: null,
    excerpt: 'Unlinked heading draft.',
  });
});

test('http exploring heading keeps its link verbatim', () => {
  const ext = exploringRs.exploring.find((e) => e.title === 'External idea');
  assert.strictEqual(ext.link, 'https://example.com/idea');
});

test('a Requires reference at an exploring draft stays a structural error', () => {
  const err = findByTitle(exploringRs.structuralErrors, 'Consumer');
  assert.ok(err, JSON.stringify(exploringRs.structuralErrors));
  assert.ok(err.problem.includes('does not resolve'), err.problem);
});

test('a historical Requires line on an exploring draft is ignored', () => {
  assert.ok(!findByTitle(exploringRs.blocked, 'Linked draft'));
  assert.ok(!titles(exploringRs.ready).includes('Linked draft'));
  const linked = exploringRs.exploring.find((e) => e.title === 'Linked draft');
  assert.strictEqual(linked.link, 'features/draft-b.md');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node C:/Git/nightshift/skills/ready/ready.test.js`
Expected: FAIL. First new failure is `'exploring drafts are collected with full item shape'` with an `AssertionError` (deepStrictEqual of `undefined` against the expected array, because `analyze` emits no `exploring` field yet). The five other new tests fail the same way (reading `.exploring` of the result yields `undefined`, so `.find` throws `TypeError: Cannot read properties of undefined`). All pre-existing tests still pass.

- [ ] **Step 3: Implement the collection**

In `skills/ready/ready.js`, three edits.

Edit 3a. The `extractEntries` head. Replace:

```js
function extractEntries(content, excludedSectionTitles, opts = {}) {
  const lines = content.split(/\r?\n/);
  const excluded = new Set(excludedSectionTitles.map((t) => t.toLowerCase()));
  const entries = [];
  const proseOnlySections = [];

  let sectionTitle = null;
  let sectionExcluded = false;
```

with:

```js
function extractEntries(content, excludedSectionTitles, opts = {}) {
  const lines = content.split(/\r?\n/);
  const excluded = new Set(excludedSectionTitles.map((t) => t.toLowerCase()));
  const collectSections = new Set((opts.collectSections || []).map((t) => t.toLowerCase()));
  const entries = [];
  const proseOnlySections = [];
  const collectedEntries = [];

  let sectionTitle = null;
  let sectionExcluded = false;
  let sectionCollected = false;
```

Edit 3b. The `##` and `###` branches. Replace:

```js
      sectionTitle = h2[1].trim();
      sectionExcluded = excluded.has(sectionTitle.toLowerCase().replace(/\.$/, ''));
      sectionHasEntry = false;
      sectionHasProse = false;
      continue;
    }
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      current = null;
      if (!sectionExcluded) {
        sectionHasEntry = true;
        const heading = h3[1].trim();
        const link = heading.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
        current = {
          kind: 'h3',
          title: link ? link[1].trim() : heading,
          selfTarget: link ? link[2].trim() : null,
          section: sectionTitle,
          bodyLines: [],
        };
        entries.push(current);
      }
      continue;
    }
```

with:

```js
      sectionTitle = h2[1].trim();
      sectionExcluded = excluded.has(sectionTitle.toLowerCase().replace(/\.$/, ''));
      sectionCollected = collectSections.has(sectionTitle.toLowerCase().replace(/\.$/, ''));
      sectionHasEntry = false;
      sectionHasProse = false;
      continue;
    }
    const h3 = line.match(/^### (.+)$/);
    if (h3) {
      current = null;
      if (!sectionExcluded || sectionCollected) {
        const heading = h3[1].trim();
        const link = heading.match(/^\[([^\]]*)\]\(([^)]*)\)$/);
        current = {
          kind: 'h3',
          title: link ? link[1].trim() : heading,
          selfTarget: link ? link[2].trim() : null,
          section: sectionTitle,
          bodyLines: [],
        };
        if (sectionExcluded) {
          collectedEntries.push(current);
        } else {
          sectionHasEntry = true;
          entries.push(current);
        }
      }
      continue;
    }
```

(A collected section stays excluded from `entries`, notices, and prose tracking; `current` is set so `bodyLines` accumulate for the excerpt. `sectionCollected` only matters when the section is also excluded; the classification pipeline never sees collected entries.)

Edit 3c. Still in `extractEntries`, replace the closing:

```js
  closeSection();
  return { entries, proseOnlySections };
}
```

with:

```js
  closeSection();
  return { entries, proseOnlySections, collectedEntries };
}
```

Edit 3d. In `analyze`, replace the output initializer:

```js
  const out = {
    indexes: { found: [], missing: [] },
    ready: [],
    blocked: [],
    external: [],
    structuralErrors: [],
    notices: [],
  };
```

with:

```js
  const out = {
    indexes: { found: [], missing: [] },
    ready: [],
    blocked: [],
    external: [],
    exploring: [],
    structuralErrors: [],
    notices: [],
  };
```

Edit 3e. In `analyze`, replace the parse call:

```js
    parsed[name] = extractEntries(files[name], EXCLUDED_SECTIONS[name], {
      bullets: name === 'QUICK_WINS',
      noticeProse: name === 'QUICK_WINS',
    });
```

with:

```js
    parsed[name] = extractEntries(files[name], EXCLUDED_SECTIONS[name], {
      bullets: name === 'QUICK_WINS',
      noticeProse: name === 'QUICK_WINS',
      collectSections: name === 'FEATURES' ? ['exploring'] : [],
    });
```

Edit 3f. In `analyze`, replace:

```js
  // Features and bugs.
  const breakoutTargets = [];
```

with:

```js
  // Exploring drafts: collected, never classified. FEATURES-only by
  // design; no other index has an Exploring concept.
  if (parsed.FEATURES) {
    for (const entry of parsed.FEATURES.collectedEntries) {
      out.exploring.push({
        index: 'FEATURES.md',
        title: entry.title,
        link: entry.selfTarget,
        excerpt: firstExcerpt(entry.bodyLines),
      });
    }
  }

  // Features and bugs.
  const breakoutTargets = [];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node C:/Git/nightshift/skills/ready/ready.test.js`
Expected: PASS, `0 failed`, pass count = pre-plan count + 6.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add skills/ready/ready.js skills/ready/ready.test.js
git -C C:/Git/nightshift commit -m "feat(ready): collect Exploring drafts into an exploring output array"
```

---

### Task 2: Broken-link notices for exploring drafts

**Files:**
- Modify: `skills/ready/ready.js` (the Task 1 collection loop; runCli at ~713-722)
- Test: `skills/ready/ready.test.js`

**Interfaces:**
- Consumes: Task 1's collection loop over `parsed.FEATURES.collectedEntries`; the existing `breakoutTargets` records `{ index, title, target }` and the runCli filesystem check.
- Produces: draft breakout records carry `draft: true`; the runCli notice for a draft ends with `(exploring draft; Requires lines do not apply)` instead of `(its Requires line still resolves normally)`. No other task consumes these shapes; the SKILL/command prose (Tasks 3-4) describes the behavior.

- [ ] **Step 1: Write the failing tests**

In `skills/ready/ready.test.js`, insert immediately AFTER the closing `});` of the test named `'exploring drafts are collected with full item shape'`:

```js
test('draft breakout targets are recorded with the draft flag', () => {
  const draft = result.breakoutTargets.find((t) => t.target === 'features/draft.md');
  assert.deepStrictEqual(draft, {
    index: 'FEATURES.md',
    title: 'Draft thing',
    target: 'features/draft.md',
    draft: true,
  });
});
```

Insert immediately AFTER the closing `});` of the test named `'http exploring heading keeps its link verbatim'`:

```js
test('http exploring links produce no breakout target', () => {
  assert.ok(!exploringRs.breakoutTargets.some((t) => t.title === 'External idea'));
});
```

In the CLI smoke test (`'CLI reads a .claude dir and emits the same JSON shape'`), insert immediately AFTER the existing assertion block that ends with `` `broken breakout-file links should be noticed: ${JSON.stringify(cli.notices)}`,`` and its closing `);`:

```js
    assert.ok(
      cli.notices.some((n) => n.includes('features/draft.md') && n.includes('(exploring draft; Requires lines do not apply)')),
      `broken exploring links should carry the draft tail: ${JSON.stringify(cli.notices)}`,
    );
    assert.ok(
      !cli.notices.some((n) => n.includes('features/draft.md') && n.includes('Requires line still resolves')),
      'draft notices must not claim Requires resolution',
    );
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node C:/Git/nightshift/skills/ready/ready.test.js`
Expected: FAIL. `'draft breakout targets are recorded with the draft flag'` fails with an `AssertionError` (deepStrictEqual of `undefined` against the expected record: exploring entries are not yet pushed to `breakoutTargets`, so `.find` returns `undefined`). The CLI smoke test fails its new first assertion (no notice exists for `features/draft.md`). `'http exploring links produce no breakout target'` passes vacuously (no draft targets at all yet); that is expected.

- [ ] **Step 3: Implement**

In `skills/ready/ready.js`, two edits.

Edit 3a. In the Task 1 collection loop, replace:

```js
  if (parsed.FEATURES) {
    for (const entry of parsed.FEATURES.collectedEntries) {
      out.exploring.push({
        index: 'FEATURES.md',
        title: entry.title,
        link: entry.selfTarget,
        excerpt: firstExcerpt(entry.bodyLines),
      });
    }
  }

  // Features and bugs.
  const breakoutTargets = [];
```

with:

```js
  // Features and bugs.
  const breakoutTargets = [];

  if (parsed.FEATURES) {
    for (const entry of parsed.FEATURES.collectedEntries) {
      out.exploring.push({
        index: 'FEATURES.md',
        title: entry.title,
        link: entry.selfTarget,
        excerpt: firstExcerpt(entry.bodyLines),
      });
      if (entry.selfTarget && !entry.selfTarget.startsWith('http')) {
        breakoutTargets.push({ index: 'FEATURES.md', title: entry.title, target: entry.selfTarget, draft: true });
      }
    }
  }
```

(The `breakoutTargets` declaration moves above the loop so the loop can push into it; the `// Features and bugs.` comment moves with the declaration it labels.)

Edit 3b. In `runCli`, replace:

```js
    if (!fs.existsSync(resolved)) {
      result.notices.push(
        `${rec.index} entry "${rec.title}" links to ${rec.target}, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)`,
      );
    }
```

with:

```js
    if (!fs.existsSync(resolved)) {
      const tail = rec.draft
        ? '(exploring draft; Requires lines do not apply)'
        : '(its Requires line still resolves normally)';
      result.notices.push(
        `${rec.index} entry "${rec.title}" links to ${rec.target}, which does not exist; remove the broken link or create the file ${tail}`,
      );
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node C:/Git/nightshift/skills/ready/ready.test.js`
Expected: PASS, `0 failed`, pass count = Task 1's count + 3.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add skills/ready/ready.js skills/ready/ready.test.js
git -C C:/Git/nightshift commit -m "feat(ready): notice broken exploring draft links with draft wording"
```

---

### Task 3: Ready skill renders exploring titles and missing indexes

**Files:**
- Modify: `skills/ready/SKILL.md`

**Interfaces:**
- Consumes: Task 1's `exploring` array and the parser's existing `indexes.missing`.
- Produces: renderer prose only. Task 4's command cross-references `/nightshift:exploring` by name.

- [ ] **Step 1: Update the JSON field enumeration and missing-index rule**

In `skills/ready/SKILL.md`, replace:

```
   (Pass the repo root as an argument if the working directory is elsewhere.) The script reads `.claude/QUICK_WINS.md`, `.claude/FEATURES.md`, and `.claude/BUGS.md`, and emits JSON with `ready`, `blocked`, `external`, `structuralErrors`, and `notices`. It never reads the history archives: the walk-and-remove convention keeps active `Requires:` lines authoritative. `PATTERNS.md` is a pattern registry, not a work backlog, and is not parsed.
```

with:

```
   (Pass the repo root as an argument if the working directory is elsewhere.) The script reads `.claude/QUICK_WINS.md`, `.claude/FEATURES.md`, and `.claude/BUGS.md`, and emits JSON with `indexes` (found and missing index files), `ready`, `blocked`, `external`, `exploring`, `structuralErrors`, and `notices`. It never reads the history archives: the walk-and-remove convention keeps active `Requires:` lines authoritative. `PATTERNS.md` is a pattern registry, not a work backlog, and is not parsed.

   If `indexes.missing` names any of the three work indexes, surface that prominently as a broken backlog before anything else; an absent index file is never silent and never renders as an empty report. (`PATTERNS.md` in the missing list is a note, not a broken backlog.)
```

- [ ] **Step 2: Update the report sections**

Replace:

```
2. **Present the report.** Output up to four sections, omitting any that are empty:
```

with:

```
2. **Present the report.** Output up to five sections, omitting any that are empty:
```

Then replace:

```
   Include the script's `notices` (broken breakout-file links, sections the parser could not interpret) as a short trailing list.
```

with:

```
   - **Exploring (drafts, not ready)**: after the sections above, the `exploring` entries as a titles-only list, one line total where possible. These are informational drafts, never part of the ready set; end with a one-line pointer to `/nightshift:exploring` for the full draft list (excerpts and breakout links).

   Include the script's `notices` (broken breakout-file links, sections the parser could not interpret) as a short trailing list.
```

- [ ] **Step 3: Update the classification semantics list**

Replace:

```
  - Sliced features expand into per-slice work units (`[Feature title: slice name]`); a continuation is never ready while its MVP is unshipped.
```

with:

```
  - Sliced features expand into per-slice work units (`[Feature title: slice name]`); a continuation is never ready while its MVP is unshipped.
  - **Exploring**: `## Exploring` drafts, reported titles-only as informational not-ready items; they carry no resolvable `Requires:` semantics (a reference pointing at a draft stays a structural error) and never enter the ready set. `/nightshift:exploring` renders the same array in full.
```

- [ ] **Step 4: Verify**

Run: `grep -c "exploring" C:/Git/nightshift/skills/ready/SKILL.md`
Expected: at least 3 lines match (the field enumeration line, the Exploring section bullet with its `/nightshift:exploring` pointer, and the semantics bullet).
Run: `grep -c "up to five sections" C:/Git/nightshift/skills/ready/SKILL.md` and `grep -c "up to four sections" C:/Git/nightshift/skills/ready/SKILL.md`
Expected: 1 and 0 respectively.

- [ ] **Step 5: Commit**

```bash
git -C C:/Git/nightshift add skills/ready/SKILL.md
git -C C:/Git/nightshift commit -m "docs(ready): render exploring titles and missing indexes in the report"
```

---

### Task 4: New command `commands/exploring.md`

**Files:**
- Create: `commands/exploring.md`

**Interfaces:**
- Consumes: the parser JSON from Task 1 (`exploring`, `structuralErrors`, `notices`, `indexes`) via `${CLAUDE_PLUGIN_ROOT}/skills/ready/ready.js`.
- Produces: the `/nightshift:exploring` surface Task 5's prose references.

- [ ] **Step 1: Create the file with exactly this content**

```markdown
---
description: "Use when reviewing the ## Exploring draft pipeline: renders every pre-feature draft in full (titles, excerpts, breakout links), separate from the ready set."
---

# exploring

Report what is simmering in `FEATURES.md`'s `## Exploring` section: the pre-feature drafts, in full, so the user can decide what to firm up or graduate next. This is the complementary view to `/nightshift:ready`, which lists these drafts titles-only; drafts are never part of the ready set in either view.

## Process

1. **Run the parser** from the repo root:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/skills/ready/ready.js"
   ```

   (Pass the repo root as an argument if the working directory is elsewhere.) If the script reports that `.claude/` is missing, suggest `/nightshift:init-backlog` and stop. If the script itself cannot run (node missing, script file absent), report that and stop: suggest reinstalling or updating the nightshift plugin. A failed check is not a clean check.

2. **Surface problems first.** Always report, in full, the parser's problem channels: `structuralErrors`, `notices`, and any entry in `indexes.missing` (an absent index file, `FEATURES.md` included, is a broken backlog, never an empty draft list; `PATTERNS.md` in the missing list is a note, not a broken backlog). A user may run only this command, so a broken backlog must not read as clean here.

3. **Present the drafts.** For each item in the `exploring` array, render title, excerpt, and breakout link. The `link` value is `.claude/`-relative; print it prefixed with the index directory (for example `.claude/features/<slug>.md`) so the path resolves from the repo root. When `link` is `null`, omit the link entirely; when it is an absolute `http(s)` URL, print it verbatim with no prefix. Only when the parser ran clean and the `exploring` array is empty, say explicitly that nothing is in `## Exploring`.

## Notes

- This is a read-only command. Do not modify any files.
- Render index excerpts only; never crawl the breakout files or their `status: exploring` frontmatter. The index excerpt is the authoritative summary surface, exactly as in the ready skill.
- Deliberately omitted: `ready`, `blocked`, and `external`. Picking buildable work is `/nightshift:ready`'s mandate.
```

- [ ] **Step 2: Verify**

Run: `grep -c "CLAUDE_PLUGIN_ROOT" C:/Git/nightshift/commands/exploring.md`
Expected: 1.
Run: `node C:/Git/nightshift/skills/ready/ready.js C:/Git/nightshift | node -e "const d=JSON.parse(require('fs').readFileSync(0)); console.log(Array.isArray(d.exploring) ? 'exploring:' + d.exploring.length : 'MISSING')"`
Expected: `exploring:5` (the repo currently has five drafts), confirming the command's data source exists end to end.

- [ ] **Step 3: Commit**

```bash
git -C C:/Git/nightshift add commands/exploring.md
git -C C:/Git/nightshift commit -m "feat(exploring): add /nightshift:exploring draft-list command"
```

---

### Task 5: Prose sweep of the retired "ready skips Exploring" claim

**Files:**
- Modify: `commands/init-backlog.md` (5 sites)
- Modify: `.claude/FEATURES.md` (2 sites)
- Modify: `CLAUDE.md` (1 site)
- Modify: `README.md` (1 table row)
- Modify: `AGENTS.md` (1 sentence)

**Interfaces:**
- Consumes: the `/nightshift:exploring` name from Task 4.
- Produces: prose only.

Anchor uniqueness: each quoted old string below occurs exactly once in its named file. Verify before editing with `grep -c` when in doubt; if a count is not 1, stop and report rather than guessing.

- [ ] **Step 1: `commands/init-backlog.md`, FEATURES template Exploring preamble**

Replace:

```
isn't expected yet. `/nightshift:ready` excludes this section from the readiness
set on purpose. When a draft firms up enough to declare its upstream
```

with:

```
isn't expected yet. `/nightshift:ready` lists these drafts titles-only in a
clearly-marked not-ready section, never in the readiness set, and
`/nightshift:exploring` renders the full draft list. When a draft firms
up enough to declare its upstream
```

- [ ] **Step 2: `commands/init-backlog.md`, FEATURES template Requires-lines carve-outs**

Replace:

```
sections do not carry `Requires:` lines (or, in `## Exploring`'s
case, may carry them as historical artifacts only) and `/nightshift:ready`
ignores them. Working hypotheses / Staging / Future directions
(not yet designed) / Author tooling are bulleted rather than `###`
headings, so the `###`-only candidate filter handles them naturally;
`## Exploring` holds `###` entries but is excluded by name in the
`/nightshift:ready` filter.
```

with:

```
sections do not carry `Requires:` lines (or, in `## Exploring`'s
case, may carry them as historical artifacts only). `/nightshift:ready`
ignores the bulleted sections entirely and keeps `## Exploring` out of
the readiness set, reporting its entries separately as titles-only
drafts; `/nightshift:exploring` renders them in full. Working
hypotheses / Staging / Future directions (not yet designed) / Author
tooling are bulleted rather than `###` headings, so the `###`-only
candidate filter handles them naturally; `## Exploring` holds `###`
entries, collected as drafts and never classified.
```

- [ ] **Step 3: `commands/init-backlog.md`, CLAUDE.md template backlog sentence**

Replace:

```
Brainstorming output lives in feature files (or in patterns when cross-cutting / in bugs when diagnostic) rather than as separate dated specs. Pre-feature exploratory brainstorms land as draft features with `status: exploring` frontmatter and an entry in `FEATURES.md`'s `## Exploring` section; `/nightshift:ready` skips them. They graduate to a themed `##` section with a `**Requires:**` line once the design firms up.
```

(this exact paragraph appears once in `commands/init-backlog.md`; the sibling copy in the repo root `CLAUDE.md` is Step 6's edit) with:

```
Brainstorming output lives in feature files (or in patterns when cross-cutting / in bugs when diagnostic) rather than as separate dated specs. Pre-feature exploratory brainstorms land as draft features with `status: exploring` frontmatter and an entry in `FEATURES.md`'s `## Exploring` section; `/nightshift:ready` lists them titles-only as drafts, never in the ready set, and `/nightshift:exploring` shows the full draft list. They graduate to a themed `##` section with a `**Requires:**` line once the design firms up.
```

- [ ] **Step 4: `commands/init-backlog.md`, freshness checklist item 7**

Replace:

```
7. Notes pre-dependency-analysis brainstorms, `/nightshift:ready` ignores the section, `Requires:` lines optional. *(`## Exploring` preamble: the prose before the first `###` entry inside that section; if the section has no `###` entries yet, the entire section body IS the preamble)*
```

with:

```
7. Notes pre-dependency-analysis brainstorms, `/nightshift:ready` reports the section separately as titles-only drafts (never in the ready set) with `/nightshift:exploring` as the full view, `Requires:` lines optional. *(`## Exploring` preamble: the prose before the first `###` entry inside that section; if the section has no `###` entries yet, the entire section body IS the preamble)*
```

- [ ] **Step 5: `commands/init-backlog.md`, either-location note**

Replace:

```
**Either-location satisfaction.** When a concept could plausibly live in more than one templated section (e.g., the FEATURES.md "`/nightshift:ready` ignores `## Exploring`" claim is teachable in both the `## Exploring` preamble and the `## Requires lines` carve-outs paragraph), the checklist item is satisfied if covered in EITHER location. Annotation names the primary expected location; secondary locations are acceptable substitutes.
```

with:

```
**Either-location satisfaction.** When a concept could plausibly live in more than one templated section (e.g., the FEATURES.md "`/nightshift:ready` reports `## Exploring` separately as drafts, never in the ready set" claim is teachable in both the `## Exploring` preamble and the `## Requires lines` carve-outs paragraph), the checklist item is satisfied if covered in EITHER location. Annotation names the primary expected location; secondary locations are acceptable substitutes.
```

- [ ] **Step 6: Repo-local `.claude/FEATURES.md` and root `CLAUDE.md`**

In `.claude/FEATURES.md`, apply the same two rewordings as Steps 1 and 2: the file carries byte-identical copies of both the Exploring preamble sentence and the carve-outs paragraph (same wording, same line wrapping, one occurrence each), so Step 1's and Step 2's exact old/new blocks apply verbatim to this file too.

In the repo root `CLAUDE.md`, apply exactly Step 3's replacement (the same paragraph, one occurrence).

- [ ] **Step 7: `README.md` command table row**

Replace:

```
| `/nightshift:ready`                   | Report the unblocked work set by resolving `**Requires:**` lines (skill; bundles the parser script)               |
```

with:

```
| `/nightshift:ready`                   | Report the unblocked work set by resolving `**Requires:**` lines (skill; bundles the parser script)               |
| `/nightshift:exploring`               | Render the `## Exploring` draft list in full (titles, excerpts, breakout links); drafts never enter the ready set |
```

- [ ] **Step 8: `AGENTS.md` commands sentence**

Replace:

```
`init-backlog.md` is the large self-contained scaffolder for the four-index `.claude/` backlog layout (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), including the track-vs-ignore version-control election.
```

with:

```
`init-backlog.md` is the large self-contained scaffolder for the four-index `.claude/` backlog layout (`QUICK_WINS.md`, `FEATURES.md`, `BUGS.md`, `PATTERNS.md`), including the track-vs-ignore version-control election. `exploring.md` is a thin bundle-less entry point over the ready skill's parser: it renders the `## Exploring` draft list in full, while `/nightshift:ready` lists those drafts titles-only.
```

- [ ] **Step 9: Verify the sweep is complete**

Run: `grep -rn "excludes this section from the readiness" C:/Git/nightshift/commands C:/Git/nightshift/.claude/FEATURES.md C:/Git/nightshift/CLAUDE.md C:/Git/nightshift/AGENTS.md C:/Git/nightshift/README.md`
Expected: zero hits.
Run: `grep -rn "ready\` skips them" C:/Git/nightshift/commands C:/Git/nightshift/CLAUDE.md`
Expected: zero hits.
Run: `grep -rn "excluded by name in the" C:/Git/nightshift/commands C:/Git/nightshift/.claude/FEATURES.md`
Expected: zero hits.
(Do NOT sweep `.claude/features/`, `.claude/plans/`, or the history archives: the spec and plan describe the change and are excluded by convention.)

- [ ] **Step 10: Commit**

```bash
git -C C:/Git/nightshift add commands/init-backlog.md .claude/FEATURES.md CLAUDE.md README.md AGENTS.md
git -C C:/Git/nightshift commit -m "docs(backlog): reword ready-skips-Exploring claims for the two-view split"
```

(Exception to the never-stage-`.claude/` constraint: `.claude/FEATURES.md` is itself a named consumer in this task and is staged deliberately.)

---

### Task 6: Version bump and full suite

**Files:**
- Modify: `.claude-plugin/plugin.json`

**Interfaces:**
- Consumes: nothing.
- Produces: the release marker for the whole batch.

- [ ] **Step 1: Bump the version**

In `.claude-plugin/plugin.json`, replace:

```json
  "version": "2.3.0",
```

with:

```json
  "version": "2.4.0",
```

- [ ] **Step 2: Run all three suites**

Run:
```bash
node C:/Git/nightshift/skills/ready/ready.test.js
node C:/Git/nightshift/skills/revise/revise-round.test.js
node C:/Git/nightshift/skills/revise/rigor.test.js
```
Expected: every suite prints `0 failed` (or its passing summary) and exits 0.

- [ ] **Step 3: Commit**

```bash
git -C C:/Git/nightshift add .claude-plugin/plugin.json
git -C C:/Git/nightshift commit -m "chore(release): bump version to 2.4.0"
```
