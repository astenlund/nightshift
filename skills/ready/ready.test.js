#!/usr/bin/env node
'use strict';

// Fixture-based tests for ready.js. Run with: node ready.test.js
// No test framework; plain asserts with a tiny harness. Exit code 1 on
// any failure.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const {
  analyze,
  analyzeCatalog,
  stripStable,
  normalizeSliceName,
  splitTopLevelCommas,
  nodeKey,
  findCycles,
  extractEntries,
  findRequires,
  parseSlices,
  findSlicesByNormalizedName,
  buildRegistry,
  EXCLUDED_SECTIONS,
  collectEntryEdges,
  scanBreakoutLines,
  scanBreakoutTargets,
} = require('./ready.js');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`FAIL - ${name}\n  ${e.message}`);
  }
}

function titles(arr) {
  return arr.map((x) => x.title);
}

function findByTitle(arr, title) {
  return arr.find((x) => x.title === title);
}

test('extractEntries ignores a fenced heading lookalike', () => {
  const parsed = extractEntries(`## Area
\`\`\`
### [Fake](features/fake.md)
\`\`\`
### [Real](features/real.md)`, []);

  assert.deepStrictEqual(parsed.entries.map((entry) => entry.title), ['Real'], 'fenced heading must not create an entry');
});

test('extractEntries recognizes only column-zero backlog entry tokens', () => {
  const features = extractEntries(`  ## Indented section
  ### [Indented parent](features/indented-parent.md)
##\tTabbed section
###\t[Tabbed entry](features/tabbed.md)
## Area
  ### [Indented entry](features/indented-entry.md)
### [Real](features/real.md)`, []);
  const quickWins = extractEntries(`## Area
* Star entry
+ Plus entry
  - Indented entry
- Real entry`, EXCLUDED_SECTIONS.QUICK_WINS, { bullets: true, noticeProse: true });

  assert.deepStrictEqual(features.entries.map((entry) => entry.title), ['Real']);
  assert.deepStrictEqual(quickWins.entries.map((entry) => entry.title), ['Real entry']);
});

test('extractEntries closes an active section at an outside-fence column-zero level-one heading', () => {
  const features = extractEntries(`## Area
### [Real](features/real.md)
# Appendix
### [Ghost](features/ghost.md)`, []);
  const fenced = extractEntries(`## Area
### [Real](features/real.md)
\`\`\`
# Fenced appendix
\`\`\`
### [Still real](features/still-real.md)`, []);
  const quickWins = extractEntries(`## Area
- Real entry
  continuation
# Appendix
- Ghost entry`, EXCLUDED_SECTIONS.QUICK_WINS, { bullets: true, noticeProse: true });

  assert.deepStrictEqual(features.entries.map((entry) => entry.title), ['Real']);
  assert.deepStrictEqual(fenced.entries.map((entry) => entry.title), ['Real', 'Still real']);
  assert.deepStrictEqual(quickWins.entries.map((entry) => entry.title), ['Real entry continuation']);
});

test('analyze keeps unambiguous fixture JSON byte-for-byte stable', () => {
  const output = JSON.stringify(analyze({ FEATURES: `## Area
### [Real](features/real.md)

**Requires:** none.
` }));

  assert.strictEqual(output, '{"indexes":{"found":["FEATURES.md"],"missing":["QUICK_WINS.md","BUGS.md","PATTERNS.md"]},"ready":[{"index":"FEATURES.md","title":"Real","excerpt":""}],"blocked":[],"external":[],"exploring":[],"structuralErrors":[],"notices":[],"breakoutTargets":[{"index":"FEATURES.md","title":"Real","target":"features/real.md"}]}');
});

test('analyzeCatalog reproduces CLI JSON from exact catalog records and uses predicted contents without filesystem access', () => {
  const items = [
    { target: 'features/beta.md', contents: '# Beta\n' },
    { target: 'FEATURES.md', contents: `## Area
### [Alpha](features/alpha.md)

**Requires:** none.

### [Beta](features/beta.md)

**Requires:** [Alpha](features/alpha.md).

### [Missing](features/missing.md)

**Requires:** none.
` },
    { target: 'features/alpha.md', contents: '# Alpha\n' },
  ];
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-catalog-test-${process.pid}`);
  const claudeDir = path.join(tmpRoot, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'features'), { recursive: true });
  try {
    for (const item of items) {
      fs.writeFileSync(path.join(claudeDir, item.target), item.contents);
    }
    const cli = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'ready.js'), tmpRoot], { encoding: 'utf8' }));
    const readFileSync = fs.readFileSync;
    let catalog;
    try {
      fs.readFileSync = () => {
        throw new Error('analyzeCatalog must not read the filesystem');
      };
      catalog = analyzeCatalog(items);
    } finally {
      fs.readFileSync = readFileSync;
    }

    const { evidence, ...publicCatalog } = catalog;
    assert.deepStrictEqual(publicCatalog, cli);
    assert.deepStrictEqual(evidence, {
      structuralErrors: [],
      notices: [{ kind: 'notices', ordinal: 0, evidencePaths: ['FEATURES.md'] }],
      legacyHistory: [],
    });
    assert.deepStrictEqual(catalog.ready.map((entry) => entry.title), ['Alpha', 'Missing']);
    assert.deepStrictEqual(catalog.blocked.map((entry) => entry.title), ['Beta']);
    assert.ok(catalog.notices.some((notice) => notice.includes('features/missing.md')));
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('analyzeCatalog carries parser-owned structural, breakout, cycle, and notice evidence', () => {
  const features = `## Area
### [Bad](features/bad.md)

### [Cycle A](features/a.md)

**Requires:** [Cycle B](features/b.md).

### [Cycle B](features/b.md)

**Requires:** [Cycle A](features/a.md).

### [Missing](features/missing.md)

**Requires:** none.
`;
  const result = analyzeCatalog([
    { target: 'FEATURES.md', contents: features },
    { target: 'features/a.md', contents: '# A\n' },
    { target: 'features/b.md', contents: '# B\n' },
    { target: 'features/bad.md', contents: '# Bad\n\n**Requires:** none.\n' },
  ]);

  assert.deepStrictEqual(result.evidence.structuralErrors, [
    { kind: 'structuralErrors', ordinal: 0, evidencePaths: ['FEATURES.md'] },
    { kind: 'structuralErrors', ordinal: 1, evidencePaths: ['FEATURES.md', 'features/a.md', 'features/b.md'] },
    { kind: 'structuralErrors', ordinal: 2, evidencePaths: ['FEATURES.md', 'features/bad.md'] },
  ]);
  assert.deepStrictEqual(result.evidence.notices, [
    { kind: 'notices', ordinal: 0, evidencePaths: ['FEATURES.md'] },
  ]);
  assert.ok(!Object.hasOwn(result, 'breakoutTargets'));
});

test('analyzeCatalog preserves recursively discovered nested catalog identities in evidence', () => {
  const result = analyzeCatalog([
    { target: 'FEATURES.md', contents: `## Area
### [Nested](features/deep/nested.md)

**Requires:** none.
` },
    { target: 'features/deep/nested.md', contents: '# Nested\n\n**Requires:** none.\nwrapped\n' },
    { target: 'features/deep/unlinked.md', contents: '# Unlinked\nFirst\nSecond\n' },
  ]);

  assert.deepStrictEqual(result.evidence.structuralErrors, [
    { kind: 'structuralErrors', ordinal: 0, evidencePaths: ['FEATURES.md', 'features/deep/nested.md'] },
  ]);
  assert.deepStrictEqual(result.evidence.notices, [
    { kind: 'notices', ordinal: 0, evidencePaths: ['features/deep/nested.md'] },
    { kind: 'notices', ordinal: 1, evidencePaths: ['features/deep/unlinked.md'] },
  ]);
});

test('analyzeCatalog requires whitespace before an ATX trailing closure', () => {
  const result = analyzeCatalog([
    { target: 'QUICK_WINS.md', contents: '## Implemented#\n\n- Not a legacy section.\n' },
    { target: 'FEATURES.md', contents: '## Implemented #\n\n- Legacy section.\n' },
    { target: 'BUGS.md', contents: '## Fixed #\n\n- Legacy bug.\n' },
  ]);

  assert.deepStrictEqual(result.evidence.legacyHistory, [
    { indexPath: '.claude/BUGS.md', historyPath: '.claude/BUGS_HISTORY.md' },
    { indexPath: '.claude/FEATURES.md', historyPath: '.claude/FEATURES_HISTORY.md' },
  ]);
});

test('analyzeCatalog evidence uses only exact catalog identities', () => {
  const missing = analyzeCatalog([
    { target: 'FEATURES.md', contents: `## Area
### [Missing](features/missing.md)

**Requires:** none.
` },
  ]);
  assert.deepStrictEqual(missing.evidence.notices, [
    { kind: 'notices', ordinal: 0, evidencePaths: ['FEATURES.md'] },
  ]);

  // A malformed breakout link is the entry's own defect: it surfaces as the
  // broken-link notice whose evidence carries only the exact catalog identity
  // of the index file, never the malformed target itself.
  for (const target of [
    'features\\alpha.md',
    'features/foo:bar.md',
    'features/foo?.md',
    'features/./alpha.md',
    'features/deep/../alpha.md',
    'features//alpha.md',
  ]) {
    const malformed = analyzeCatalog([
      { target: 'FEATURES.md', contents: `## Area
### [Malformed](${target})

**Requires:** none.
` },
    ]);
    assert.deepStrictEqual(malformed.notices, [
      `FEATURES.md entry "Malformed" links to ${target}, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)`,
    ], target);
    assert.deepStrictEqual(malformed.evidence.notices, [
      { kind: 'notices', ordinal: 0, evidencePaths: ['FEATURES.md'] },
    ], target);
  }
});

test('analyzeCatalog reports only populated unmasked legacy sections when history is missing', () => {
  const result = analyzeCatalog([
    { target: 'QUICK_WINS.md', contents: '## Implemented\n\n- Shipped.\n' },
    { target: 'FEATURES.md', contents: '## Implemented\n\n<!-- populated -->\n\n## Area\n' },
    { target: 'BUGS.md', contents: '## Fixed\n\n```markdown\nold\n```\n' },
    { target: 'QUICK_WINS_HISTORY.md', contents: '# Existing history\n' },
  ]);

  assert.deepStrictEqual(result.evidence.legacyHistory, [
    { indexPath: '.claude/BUGS.md', historyPath: '.claude/BUGS_HISTORY.md' },
    { indexPath: '.claude/FEATURES.md', historyPath: '.claude/FEATURES_HISTORY.md' },
  ]);
});

test('analyzeCatalog ignores bare, whitespace-only, wrong-pairing, and masked legacy headings', () => {
  const result = analyzeCatalog([
    { target: 'QUICK_WINS.md', contents: '## Implemented\n\n## Area\n' },
    { target: 'FEATURES.md', contents: '## Fixed\n\n- Wrong pairing.\n\n## Area\n' },
    { target: 'BUGS.md', contents: '```markdown\n## Fixed\n\n- Masked.\n```\n' },
    { target: 'FEATURES_HISTORY.md', contents: '# Existing\n' },
    { target: 'BUGS_HISTORY.md', contents: '# Existing\n' },
  ]);

  assert.deepStrictEqual(result.evidence.legacyHistory, []);
});

test('analyzeCatalog rejects duplicate, out-of-scope, and non-portable catalog targets with TypeError', () => {
  const contents = '# Features\n';

  assert.throws(() => analyzeCatalog([{ target: 'FEATURES.md', contents }, { target: 'FEATURES.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: '../FEATURES.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'features\\alpha.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'plans/stale.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'AGENTS.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'features/foo:bar.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'features/foo?.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'features/CON.md', contents }]), TypeError);
});

test('analyzeCatalog rejects control characters, trailing dot/space components, and malformed item shapes with TypeError', () => {
  const contents = '# Features\n';

  assert.throws(() => analyzeCatalog([{ target: `features/foo${String.fromCharCode(1)}bar.md`, contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'features/sub./file.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'features/sub /file.md', contents }]), TypeError);
  assert.throws(() => analyzeCatalog('FEATURES.md'), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'FEATURES.md', contents, extra: 1 }]), TypeError);
  assert.throws(() => analyzeCatalog([{ target: 'FEATURES.md', contents: 123 }]), TypeError);
});

test('ready structural parsing ignores fenced lookalikes and unclosed fences', () => {
  const fenced = `## Area
### [Parent](features/parent.md)

\`\`\`markdown
### [Fake](features/fake.md)
- Fake work unit
**Requires:** [Fake](features/fake.md)
**Slices:**
- **MVP - Fake slice.**
  **Requires:** [Fake](features/fake.md)
\`\`\`not-a-closer
### [Still fake](features/still-fake.md)
`;
  const unclosed = `## Area
### [Real](features/real.md)

**Requires:** none.

\`\`\`
### [Hidden](features/hidden.md)
**Requires:** [Real](features/real.md)
`;
  const fencedResult = analyze({ FEATURES: fenced });
  const unclosedResult = analyze({ FEATURES: unclosed });

  assert.deepStrictEqual(fencedResult.ready.map((entry) => entry.title), []);
  assert.deepStrictEqual(fencedResult.structuralErrors.map((entry) => entry.title), ['Parent']);
  assert.match(fencedResult.structuralErrors[0].problem, /missing \*\*Requires:\*\* line/);
  assert.deepStrictEqual(fencedResult.blocked, []);
  assert.deepStrictEqual(unclosedResult.ready.map((entry) => entry.title), ['Real']);
  assert.deepStrictEqual(unclosedResult.blocked, []);
});

test('Requires ignores a following fenced fake declaration and its opener', () => {
  const result = analyze({ FEATURES: `## Area
### [Real](features/real.md)

**Requires:** none.
\`\`\`
**Requires:** outside system approval
\`\`\`
` });

  assert.deepStrictEqual(result.ready.map((entry) => entry.title), ['Real']);
  assert.deepStrictEqual(result.external, []);
});

test('Slices skips a fenced fake bullet and resumes at a real outside-fence slice', () => {
  const slices = parseSlices([
    '**Slices:**',
    '\`\`\`',
    '- **MVP - Fake slice.**',
    '\`\`\`',
    '- **MVP - Real slice.**',
  ]);

  assert.deepStrictEqual(slices.map((slice) => slice.declaration), ['- **MVP - Real slice.**']);
});

test('parseSlices preserves colliding declarations and finds every normalized match', () => {
  const slices = parseSlices([
    '**Slices:**',
    '- **MVP - Shared work.**',
    '- **Continuation - Shared work.**',
  ]);

  assert.deepStrictEqual(slices.map((slice) => slice.declaration), ['- **MVP - Shared work.**', '- **Continuation - Shared work.**']);
  assert.deepStrictEqual(findSlicesByNormalizedName(slices, 'shared work').map((slice) => slice.declaration), ['- **MVP - Shared work.**', '- **Continuation - Shared work.**']);
});

test('colliding slice dependency suffix is structural ambiguity', () => {
  const result = analyze({ FEATURES: `## Area
### [Parent](features/parent.md)

**Requires:** none.

**Slices:**
- **MVP - Shared work.**
- **Continuation - Shared work.**

### [Child](features/child.md)

**Requires:** [Parent: Shared work](features/parent.md).
` });

  assert.match(findByTitle(result.structuralErrors, 'Child').problem, /matches multiple bullets/);
});

// ---------- fixtures ----------

const QUICK_WINS = `# Quick wins

Intro prose.

## Extractions

### Shared helper extraction

Dedupe the path-joining helper across the three scripts.

## Misc

- **Rename the thing.** Quick rename across call sites.

## Wrapped title

- **A title that wraps
  onto the next line.** Description after title.

## Loose notes

A paragraph-style item that is neither a bullet nor a heading.

## History

Pointer prose.
`;

const FEATURES = `# Features

Intro prose.

## Requires lines

Convention prose that must not produce entries or notices.

## Slicing

More convention prose.

## Progression

### [Alpha](features/alpha.md)

Core engine for the thing.

**Requires:** none.

### [Beta](features/beta.md)

Depends on alpha, an external, and a quick win.

**Requires:** [Alpha](features/alpha.md),
[shared helper extraction](QUICK_WINS.md#shared-helper-extraction).
**External:** vendor SDK
support for streaming.

### [Gamma](features/gamma.md)

Missing requires line entirely.

### [Delta](features/delta.md)

Sliced feature, MVP struck.

**Slices:**

- ~~MVP \u2014 floating-reference core.~~ (Shipped \u2014 see FEATURES_HISTORY.md.)
- **Re-anchor events.** Manual UI re-anchor plumbing.
- **Late-join replay.** Pull endpoint.
  **Requires:** [Delta: re-anchor events](features/delta.md).
- **\`RepertoireSource\`.** Drop-in replacement.
  **Requires:** [Epsilon](features/epsilon.md).
  **External:** approval from
  the platform team.
- **Freebie.** Independent extension with no gates of its own.

**Requires:** none.

### [Epsilon](features/epsilon.md)

References a struck slice (stale).

**Requires:** [Delta: floating-reference core](features/delta.md).

### [Zeta](features/zeta.md)

Bare link to sliced parent whose MVP already shipped (stale).

**Requires:** [Delta](features/delta.md).

### [Eta](features/eta.md)

Broken reference.

**Requires:** [Nonexistent](features/nonexistent.md).

### [Sigma](features/sigma.md)

Purely external gate.

**Requires:** none.
**External:** vendor firmware update.

## Exploring

### [Draft thing](features/draft.md)

Pre-dependency brainstorm; must be excluded.

## Implemented

### [Old thing](features/old.md)

Legacy section; must be excluded.

## History

Pointer prose.
`;

const BUGS = `# Bugs

Intro prose.

## Requires lines

Convention prose.

## Open

### Flaky reconnect

Dropped websocket reconnect loops forever.

**Requires:** [Alpha](features/alpha.md).

### Torn config write

Config file can tear on concurrent write.

**Requires:** none.

## Fixed

### Old fixed bug

Legacy section; must be excluded.

## History

Pointer prose.
`;

const FEATURES_GATES = `# Features

## Area

### [Theta](features/theta.md)

Sliced, MVP unshipped.

**Slices:**

- **MVP \u2014 base layer.** The base.
- **Extension.** Extra layer with no explicit gates.

**Requires:** none.

### [Iota](features/iota.md)

Empty slices block; still being scoped.

**Slices:**

**Requires:** none.

### [Kappa](features/kappa.md)

All slices shipped, parent not graduated.

**Slices:**

- ~~MVP \u2014 first.~~ (Shipped.)
- ~~Second bit.~~ (Shipped.)

**Requires:** none.
`;

const EDGE_FEATURES = `# Features

## Area

### [Anna](features/anna.md)

A.

**Requires:** [Bob](features/bob.md).

### [Bob](features/bob.md)

B.

**Requires:** none.

### [Self](features/self.md)

Self-reference.

**Requires:** [Self: later](features/self.md).

**Slices:**

- **First.**
- **later.**

### [Broken](features/broken.md)

Broken + valid link -> masked.

**Requires:** [Dead](features/dead.md), [Anna](features/anna.md).
`;

// ---------- unit tests ----------

test('stripStable unwraps nested markers until stable', () => {
  assert.strictEqual(stripStable('**`Identifier`.**'), 'Identifier');
  assert.strictEqual(stripStable('~~MVP \u2014 core.~~'), 'MVP \u2014 core');
  assert.strictEqual(stripStable('  plain.  '), 'plain');
});

test('normalizeSliceName strips slice-type prefix and case-folds', () => {
  assert.strictEqual(normalizeSliceName('~~MVP \u2014 floating-reference core.~~'), 'floating-reference core');
  assert.strictEqual(normalizeSliceName('floating-reference core'), 'floating-reference core');
  assert.strictEqual(normalizeSliceName('Slice 2 \u2014 Foo Bar.'), 'foo bar');
  assert.strictEqual(normalizeSliceName('**`RepertoireSource`.**'), 'repertoiresource');
});

test('normalizeSliceName accepts hyphen and en-dash prefix separators', () => {
  assert.strictEqual(normalizeSliceName('MVP - base layer'), 'base layer');
  assert.strictEqual(normalizeSliceName('Slice 2 \u2013 foo'), 'foo');
  assert.strictEqual(normalizeSliceName('floating-reference core'), 'floating-reference core');
});

test('normalizeSliceName drops only the leading marker, never an internal dash phrase', () => {
  assert.strictEqual(normalizeSliceName('MVP - collector - phase one'), 'collector - phase one');
  assert.strictEqual(normalizeSliceName('Slice 2 \u2014 alpha \u2014 beta.'), 'alpha \u2014 beta');
  assert.strictEqual(normalizeSliceName('Continuation \u2013 parser \u2013 second pass'), 'parser \u2013 second pass');
  assert.strictEqual(normalizeSliceName('MVP - base layer'), 'base layer');
  assert.strictEqual(normalizeSliceName('~~MVP \u2014 floating-reference core.~~'), 'floating-reference core');
});

test('splitTopLevelCommas ignores commas inside links', () => {
  const items = splitTopLevelCommas('a, [b, c](x), d');
  assert.deepStrictEqual(items, ['a', '[b, c](x)', 'd']);
});

test('nodeKey uses path-qualified self link, else index+title', () => {
  assert.strictEqual(
    nodeKey({ index: 'FEATURES.md', entry: { selfTarget: 'features/ann.md', title: 'Ann' } }),
    'features/ann',
  );
  assert.strictEqual(
    nodeKey({ index: 'BUGS.md', entry: { selfTarget: null, title: 'Torn config write' } }),
    'BUGS.md::torn config write',
  );
});

test('findCycles reports only >=2-node components, deterministically', () => {
  assert.deepStrictEqual(findCycles([{ from: 'a', to: 'b' }]), []);
  assert.deepStrictEqual(findCycles([{ from: 'a', to: 'a' }]), []); // self-loop excluded
  assert.strictEqual(findCycles([{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]).length, 1);
  assert.strictEqual(
    findCycles([{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }])[0].members.join(','),
    'a,b,c',
  );
});

test('collectEntryEdges sources edges only from top-level Requires, drops intra-entry, masks structural', () => {
  const parsed = Object.fromEntries(
    ['FEATURES'].map((n) => [n, extractEntries(EDGE_FEATURES, EXCLUDED_SECTIONS[n], { bullets: false, noticeProse: false })]),
  );
  const records = [];
  for (const name of ['FEATURES']) {
    for (const e of parsed[name].entries) {
      const req = findRequires(e.bodyLines);
      e.requiresContent = req ? req.content : null;
      e.slices = parseSlices(e.bodyLines);
      records.push({ index: `${name}.md`, entry: e });
    }
  }
  const registry = buildRegistry(records);
  const edges = collectEntryEdges(records.filter((r) => r.index !== 'QUICK_WINS.md'), registry);
  // Anna -> Bob is a real edge; Self intra-entry dropped; Broken masked.
  assert.deepStrictEqual(
    edges.map((e) => `${e.from}|${e.to}`).sort(),
    ['features/anna|features/bob'],
  );
});

// ---------- analyze() on the main fixture set ----------

const result = analyze({ QUICK_WINS, FEATURES, BUGS, PATTERNS: '# Patterns\n' });

test('quick wins are always ready, both h3 and bullet shapes', () => {
  const ready = titles(result.ready);
  assert.ok(ready.includes('Shared helper extraction'), `missing h3 QW in ${ready}`);
  assert.ok(ready.includes('Rename the thing'), `missing bullet QW in ${ready}`);
});

test('wrapped quick-win title and excerpt join continuation lines', () => {
  const wrapped = findByTitle(result.ready, 'A title that wraps onto the next line');
  assert.ok(wrapped, `missing wrapped QW in ${titles(result.ready)}`);
  assert.strictEqual(wrapped.excerpt, '**A title that wraps onto the next line.** Description after title.');
});

test('wrapped quick-win titles finalize at every entry boundary', () => {
  const boundaries = [
    { name: 'h2', tail: '\n## Next section\n' },
    { name: 'h3', tail: '\n### Next entry\n' },
    { name: 'next bullet', tail: '\n- **Next title.** Next body.\n' },
    { name: 'non-indented prose', tail: '\nLoose prose.\n' },
    { name: 'end of file', tail: '' },
  ];

  for (const boundary of boundaries) {
    const content = `# Quick wins\n\n## Section\n\n- **A title that wraps\n  across lines.** Body.${boundary.tail}`;
    const parsed = extractEntries(content, EXCLUDED_SECTIONS.QUICK_WINS, { bullets: true, noticeProse: true });
    const entry = parsed.entries[0];
    assert.strictEqual(entry.title, 'A title that wraps across lines', `${boundary.name} title`);
    assert.deepStrictEqual(entry.bodyLines, ['**A title that wraps across lines.** Body.'], `${boundary.name} body`);
  }
});

test('prose-only quick-win section produces a notice', () => {
  assert.ok(
    result.notices.some((n) => n.includes('Loose notes')),
    `no notice for Loose notes in ${JSON.stringify(result.notices)}`,
  );
});

test('convention sections produce no notices', () => {
  assert.ok(!result.notices.some((n) => n.includes('Requires lines')));
  assert.ok(!result.notices.some((n) => n.includes('Slicing')));
});

test('Requires: none. classifies as ready', () => {
  assert.ok(titles(result.ready).includes('Alpha'));
  assert.ok(titles(result.ready).includes('Torn config write'));
});

test('wrapped Requires and External lines join across physical lines; a link plus an External line is Blocked', () => {
  const beta = findByTitle(result.blocked, 'Beta');
  assert.ok(beta, `Beta not in blocked: ${titles(result.blocked)}`);
  assert.ok(beta.blockers.includes('Alpha'), JSON.stringify(beta.blockers));
  assert.ok(beta.blockers.includes('Shared helper extraction'), JSON.stringify(beta.blockers));
  assert.deepStrictEqual(beta.externals, ['vendor SDK support for streaming']);
  assert.ok(!findByTitle(result.external, 'Beta'), 'Beta must not double-report under External');
});

test('hard-wrapped prose in an index file produces one notice per file naming the count and first line', () => {
  const wrapped = analyze({
    QUICK_WINS: '# Quick wins\n\nIntro line one\nintro line two\n\n## Area\n\n- **Entry.** Starts\n  and continues.\n',
    FEATURES: '# Features\n\n## Area\n### [Real](features/real.md)\n\n**Requires:** none.\n',
    PATTERNS: '# Patterns\n\nline one\nline two\n',
  });
  assert.deepStrictEqual(wrapped.notices, [
    'QUICK_WINS.md has 2 hard-wrapped lines (first at line 4); backlog prose is one paragraph or bullet per physical line; run /nightshift:init-backlog to unwrap',
    'PATTERNS.md has 1 hard-wrapped line (first at line 4); backlog prose is one paragraph or bullet per physical line; run /nightshift:init-backlog to unwrap',
  ]);
  assert.ok(result.notices.some((n) => n.startsWith('FEATURES.md has ') && n.includes('hard-wrapped')), 'the main fixture wraps its Requires lines on purpose and must be reported');
});

test('missing Requires line is a structural error', () => {
  const gamma = findByTitle(result.structuralErrors, 'Gamma');
  assert.ok(gamma, titles(result.structuralErrors).join(', '));
  assert.ok(gamma.problem.includes('missing **Requires:**'));
});

test('sliced feature expands into per-slice work units', () => {
  assert.ok(titles(result.ready).includes('[Delta: Re-anchor events]'), titles(result.ready).join(' | '));
  const lateJoin = findByTitle(result.blocked, '[Delta: Late-join replay]');
  assert.ok(lateJoin, titles(result.blocked).join(' | '));
  assert.ok(lateJoin.blockers.some((b) => b.includes('Re-anchor events')), JSON.stringify(lateJoin.blockers));
  const repertoire = findByTitle(result.blocked, '[Delta: RepertoireSource]');
  assert.ok(repertoire, titles(result.blocked).join(' | '));
  assert.deepStrictEqual(repertoire.blockers, ['Epsilon']);
});

test('reference to a struck slice is a stale-reference structural error', () => {
  const eps = findByTitle(result.structuralErrors, 'Epsilon');
  assert.ok(eps, titles(result.structuralErrors).join(', '));
  assert.ok(eps.problem.includes('stale reference'), eps.problem);
});

test('bare link to sliced parent with struck MVP is a stale-reference structural error', () => {
  const zeta = findByTitle(result.structuralErrors, 'Zeta');
  assert.ok(zeta, titles(result.structuralErrors).join(', '));
  assert.ok(zeta.problem.includes('MVP has shipped'), zeta.problem);
});

test('unresolvable reference is a structural error', () => {
  const eta = findByTitle(result.structuralErrors, 'Eta');
  assert.ok(eta, titles(result.structuralErrors).join(', '));
  assert.ok(eta.problem.includes('does not resolve'), eta.problem);
});

test('bug entry blocks on an in-backlog feature', () => {
  const bug = findByTitle(result.blocked, 'Flaky reconnect');
  assert.ok(bug);
  assert.deepStrictEqual(bug.blockers, ['Alpha']);
});

test('Exploring and legacy Implemented/Fixed sections are excluded everywhere', () => {
  const all = [
    ...titles(result.ready), ...titles(result.blocked),
    ...titles(result.external), ...titles(result.structuralErrors),
  ].join(' | ');
  assert.ok(!all.includes('Draft thing'), all);
  assert.ok(!all.includes('Old thing'), all);
  assert.ok(!all.includes('Old fixed bug'), all);
});

test('exploring drafts are collected with full item shape', () => {
  assert.deepStrictEqual(result.exploring, [{
    index: 'FEATURES.md',
    title: 'Draft thing',
    link: 'features/draft.md',
    excerpt: 'Pre-dependency brainstorm; must be excluded.',
  }]);
});

test('draft breakout targets are recorded with the draft flag', () => {
  const draft = result.breakoutTargets.find((t) => t.target === 'features/draft.md');
  assert.deepStrictEqual(draft, {
    index: 'FEATURES.md',
    title: 'Draft thing',
    target: 'features/draft.md',
    draft: true,
  });
});

// ---------- analyze() on the gates fixture ----------

const gates = analyze({ FEATURES: FEATURES_GATES });

test('missing indexes are reported and do not abort', () => {
  assert.ok(gates.indexes.missing.includes('QUICK_WINS.md'));
  assert.ok(gates.indexes.missing.includes('BUGS.md'));
  assert.ok(gates.indexes.found.includes('FEATURES.md'));
});

test('exploring is always present and empty without an Exploring section', () => {
  assert.deepStrictEqual(gates.exploring, []);
  assert.deepStrictEqual(analyze({}).exploring, []);
});

test('first unshipped slice uses the top-level Requires line', () => {
  assert.ok(
    titles(gates.ready).includes('[Theta: MVP \u2014 base layer]'),
    titles(gates.ready).join(' | '),
  );
});

test('continuation is never ready while MVP is unshipped (implicit gate)', () => {
  const ext = findByTitle(gates.blocked, '[Theta: Extension]');
  assert.ok(ext, titles(gates.blocked).join(' | '));
  assert.ok(ext.blockers.some((b) => b.includes('implicit MVP gate')), JSON.stringify(ext.blockers));
});

test('empty Slices block is not flagged; entry classifies normally', () => {
  assert.ok(titles(gates.ready).includes('Iota'), titles(gates.ready).join(' | '));
  assert.ok(!findByTitle(gates.structuralErrors, 'Iota'));
});

test('all slices shipped flags the parent as ready to graduate', () => {
  const kappa = findByTitle(gates.structuralErrors, 'Kappa');
  assert.ok(kappa, titles(gates.structuralErrors).join(', '));
  assert.ok(kappa.problem.includes('graduate parent'), kappa.problem);
});

test('purely external entry classifies as External with its primitives', () => {
  const sigma = findByTitle(result.external, 'Sigma');
  assert.ok(sigma, `Sigma not in external: ${titles(result.external)}`);
  assert.deepStrictEqual(sigma.primitives, ['vendor firmware update']);
  assert.ok(!titles(result.ready).includes('Sigma'), 'Sigma must not be Ready');
  assert.ok(!findByTitle(result.blocked, 'Sigma'), 'Sigma must not be Blocked');
});

test('gateless continuation is ready even while a sibling continuation is unshipped', () => {
  assert.ok(titles(result.ready).includes('[Delta: Freebie]'), titles(result.ready).join(' | '));
});

test('wrapped inline slice annotations join their continuation lines', () => {
  const repertoire = findByTitle(result.blocked, '[Delta: RepertoireSource]');
  assert.ok(repertoire, titles(result.blocked).join(' | '));
  assert.deepStrictEqual(repertoire.blockers, ['Epsilon']);
  assert.deepStrictEqual(repertoire.externals, ['approval from the platform team']);
});

// ---------- analyze() on the collision fixture ----------

const COLLISION_FEATURES = `# Features

## Area

### [Shared](features/shared.md)

Feature that shares a file basename with a bug.

**Requires:** none.

### [Twin](features/twin.md)

Directory-qualified reference must resolve to the bug, not the feature.

**Requires:** [shared bug](bugs/shared.md).

### [Ambi](features/ambi.md)

Bare-basename reference cannot pick between the two shared.md files.

**Requires:** [Shared thing](shared.md).

### [Plain](features/plain.md)

No slices block.

**Requires:** none.

### [Suffixer](features/suffixer.md)

Slice-suffixed reference at a parent without slices.

**Requires:** [Plain: some slice](features/plain.md).

### [Foo: Bar](features/foo-bar.md)

Colon-titled entry without slices.

**Requires:** none.

### [Colonref](features/colonref.md)

Reference whose display text is exactly the colon-containing title.

**Requires:** [Foo: Bar](features/foo-bar.md).
`;

const COLLISION_BUGS = `# Bugs

## Open

### [Shared bug](bugs/shared.md)

Bug that shares a file basename with a feature.

**Requires:** none.
`;

const collisions = analyze({ FEATURES: COLLISION_FEATURES, BUGS: COLLISION_BUGS });

test('directory-qualified reference resolves across same-basename files', () => {
  const twin = findByTitle(collisions.blocked, 'Twin');
  assert.ok(twin, titles(collisions.blocked).join(' | '));
  assert.deepStrictEqual(twin.blockers, ['Shared bug']);
});

test('bare-basename reference to colliding files is an ambiguity structural error', () => {
  const ambi = findByTitle(collisions.structuralErrors, 'Ambi');
  assert.ok(ambi, titles(collisions.structuralErrors).join(', '));
  assert.ok(ambi.problem.includes('ambiguous reference'), ambi.problem);
});

test('colon-titled whole-entry reference resolved via path is a plain blocker, not a structural error', () => {
  const colonref = findByTitle(collisions.blocked, 'Colonref');
  assert.ok(colonref, `Colonref not in blocked: ${titles(collisions.blocked).join(' | ')}`);
  assert.deepStrictEqual(colonref.blockers, ['Foo: Bar']);
  assert.ok(!findByTitle(collisions.structuralErrors, 'Colonref'), JSON.stringify(collisions.structuralErrors));
});

test('slice-suffixed reference to a slice-less parent is a structural error', () => {
  const suffixer = findByTitle(collisions.structuralErrors, 'Suffixer');
  assert.ok(suffixer, titles(collisions.structuralErrors).join(', '));
  assert.ok(suffixer.problem.includes('no Slices block'), suffixer.problem);
});

// ---------- analyze() on the cycle fixtures ----------

const CYCLE_FEATURES = `# Features

## Area

### [Anna](features/anna.md)

A.

**Requires:** [Bob](features/bob.md).

### [Bob](features/bob.md)

B.

**Requires:** [Anna](features/anna.md).
`;

const CONT_FEATURES = `# Features

## Area

### [X](features/x.md)

**Requires:** [Y](features/y.md).

### [Y](features/y.md)

**Slices:**

- **MVP.** Base.
- **Cont.** Extra.
  **Requires:** [X](features/x.md).

**Requires:** none.
`;

const INTRA_FEATURES = `# Features

## Area

### [R](features/r.md)

**Slices:**

- **MVP.** Base.
- **Later.** Extra.

**Requires:** [R: Later](features/r.md).
`;

const RING_FEATURES = `# Features

## Area

### [Anna](features/anna.md)

**Requires:** [Bob](features/bob.md).

### [Bob](features/bob.md)

**Requires:** [Cara](features/cara.md).

### [Cara](features/cara.md)

**Requires:** [Anna](features/anna.md).
`;

const MIX_FEATURES = `# Features

## Area

### [Anna](features/anna.md)

**Requires:** [Bob](features/bob.md).

### [Bob](features/bob.md)

**Requires:** [Anna](features/anna.md).

### [Charlie](features/charlie.md)

Genuinely blocked on Delta.

**Requires:** [Delta](features/delta.md).

### [Delta](features/delta.md)

**Requires:** none.
`;

const EXTCYCLE_FEATURES = `# Features

## Area

### [Anna](features/anna.md)

**Requires:** [Bob](features/bob.md).

### [Bob](features/bob.md)

**Requires:** [Anna](features/anna.md).
**External:** vendor integration SDK.
`;

const BARECYCLE_FEATURES = `# Features

## Area

### [Carl](features/carl.md)

**Requires:** [Dana](features/dana.md), vendor SDK.

### [Dana](features/dana.md)

**Requires:** [Carl](features/carl.md).
`;

const EXTLINK_CYCLE_FEATURES = `# Features

## Area

### [Anna](features/anna.md)

**Requires:** [Bob](features/bob.md).

### [Bob](features/bob.md)

**Requires:** [Anna](features/anna.md).
**External:** [Anna](features/anna.md).
`;

const SLICED_CYCLE_FEATURES = `# Features

## Area

### [Anna](features/anna.md)

**Requires:** [Bob](features/bob.md).

### [Bob](features/bob.md)

**Slices:**

- **MVP.** Base.
- **Cont.** Extra.
  **Requires:** [Anna](features/anna.md), vendor SDK.
  **External:** [Anna](features/anna.md).

**Requires:** [Anna](features/anna.md).
`;

const MISSING_REQ_EXT_FEATURES = `# Features

## Area

### [Gamma](features/gamma.md)

No Requires line at all.

**External:** none.
`;

const cycleRs = analyze({ FEATURES: CYCLE_FEATURES });
const contRs = analyze({ FEATURES: CONT_FEATURES });
const intraRs = analyze({ FEATURES: INTRA_FEATURES });
const ringRs = analyze({ FEATURES: RING_FEATURES });
const mixRs = analyze({ FEATURES: MIX_FEATURES });
const extCycleRs = analyze({ FEATURES: EXTCYCLE_FEATURES });
const bareCycleRs = analyze({ FEATURES: BARECYCLE_FEATURES });
const extLinkCycleRs = analyze({ FEATURES: EXTLINK_CYCLE_FEATURES });
const slicedCycleRs = analyze({ FEATURES: SLICED_CYCLE_FEATURES });
const missingReqExtRs = analyze({ FEATURES: MISSING_REQ_EXT_FEATURES });

test('two-entry mutual cycle is a structural error; both members excluded', () => {
  assert.ok(!titles(cycleRs.ready).includes('Anna'));
  assert.ok(!titles(cycleRs.ready).includes('Bob'));
  assert.ok(!findByTitle(cycleRs.blocked, 'Anna'));
  assert.ok(!findByTitle(cycleRs.blocked, 'Bob'));
  const cyc = findByTitle(cycleRs.structuralErrors, '2-node cycle');
  assert.ok(cyc, titles(cycleRs.structuralErrors).join(', '));
  assert.ok(cyc.index === '[cycle]', cyc.index);
  assert.ok(cyc.problem.includes('Anna') && cyc.problem.includes('Bob'), cyc.problem);
});

test('continuation inline Requires never forms a false cross-entry cycle', () => {
  assert.ok(findByTitle(contRs.blocked, 'X'), titles(contRs.blocked).join(' | '));
  assert.ok(findByTitle(contRs.ready, '[Y: MVP]'), titles(contRs.ready).join(' | '));
  assert.ok(findByTitle(contRs.blocked, '[Y: Cont]'), titles(contRs.blocked).join(' | '));
  assert.ok(!titles(contRs.structuralErrors).some((t) => t.includes('cycle')), JSON.stringify(contRs.structuralErrors));
});

test('intra-feature slice reference produces no self-loop error (anti-goal)', () => {
  assert.ok(findByTitle(intraRs.blocked, '[R: MVP]'), titles(intraRs.blocked).join(' | '));
  assert.ok(findByTitle(intraRs.blocked, '[R: Later]'), titles(intraRs.blocked).join(' | '));
  assert.ok(!titles(intraRs.structuralErrors).some((t) => t.includes('cycle')), JSON.stringify(intraRs.structuralErrors));
});

test('three-entry ring is one structural error; all members excluded', () => {
  const cyc = findByTitle(ringRs.structuralErrors, '3-node cycle');
  assert.ok(cyc, titles(ringRs.structuralErrors).join(', '));
  for (const n of ['Anna', 'Bob', 'Cara']) {
    assert.ok(!titles(ringRs.ready).includes(n), `ring member ${n} must not be ready`);
    assert.ok(!findByTitle(ringRs.blocked, n), `ring member ${n} must not be blocked`);
  }
  assert.ok(cyc.problem.includes('Anna') && cyc.problem.includes('Cara'), cyc.problem);
});

test('a cycle coexists with a genuinely blocked non-member; non-member stays blocked', () => {
  const cyc = findByTitle(mixRs.structuralErrors, '2-node cycle');
  assert.ok(cyc, titles(mixRs.structuralErrors).join(', '));
  assert.ok(!findByTitle(mixRs.blocked, 'Anna'));
  assert.ok(!findByTitle(mixRs.blocked, 'Bob'));
  const charlie = findByTitle(mixRs.blocked, 'Charlie');
  assert.ok(charlie, titles(mixRs.blocked).join(' | '));
  assert.ok(charlie.blockers.includes('Delta'), JSON.stringify(charlie.blockers));
  assert.ok(titles(mixRs.ready).includes('Delta'), titles(mixRs.ready).join(' | '));
  // Only one per-cycle record for the single cycle.
  assert.strictEqual(mixRs.structuralErrors.filter((e) => e.index === '[cycle]').length, 1);
});

test('a cycle member\'s external blocker is subsumed by whole-entry exclusion', () => {
  const cyc = findByTitle(extCycleRs.structuralErrors, '2-node cycle');
  assert.ok(cyc, titles(extCycleRs.structuralErrors).join(', '));
  assert.ok(!findByTitle(extCycleRs.blocked, 'Bob'));
  assert.ok(!findByTitle(extCycleRs.external, 'Bob'), 'Bob must not appear under External (whole-entry exclusion)');
});

test('a link in External on a cycle member is reported alongside the cycle error', () => {
  assert.ok(findByTitle(extLinkCycleRs.structuralErrors, '2-node cycle'), titles(extLinkCycleRs.structuralErrors).join(', '));
  const bob = findByTitle(extLinkCycleRs.structuralErrors, 'Bob');
  assert.ok(bob, `Bob must file its own External grammar error: ${titles(extLinkCycleRs.structuralErrors).join(', ')}`);
  assert.ok(bob.problem.includes('link "Anna" in **External:**'), bob.problem);
  assert.ok(!findByTitle(extLinkCycleRs.blocked, 'Bob'), 'an excluded member is never Blocked');
  assert.ok(!findByTitle(extLinkCycleRs.external, 'Bob'), 'an excluded member is never External');
  assert.ok(!findByTitle(extLinkCycleRs.structuralErrors, 'Anna'), 'a well-formed member files nothing of its own');
});

test('a sliced cycle member reports its continuation slice grammar problems in one joined error', () => {
  assert.ok(findByTitle(slicedCycleRs.structuralErrors, '2-node cycle'), titles(slicedCycleRs.structuralErrors).join(', '));
  const cont = findByTitle(slicedCycleRs.structuralErrors, '[Bob: Cont]');
  assert.ok(cont, `the continuation slice must file its own error: ${titles(slicedCycleRs.structuralErrors).join(', ')}`);
  const requiresAt = cont.problem.indexOf('bare text "vendor SDK" in **Requires:**');
  const externalAt = cont.problem.indexOf('link "Anna" in **External:**');
  assert.ok(requiresAt >= 0 && externalAt > requiresAt, `Requires problem first, then External, in one error: ${cont.problem}`);
  assert.strictEqual(slicedCycleRs.structuralErrors.filter((e) => e.title === '[Bob: Cont]').length, 1);
  assert.ok(!findByTitle(slicedCycleRs.structuralErrors, '[Bob: MVP]'), 'a well-formed first slice files nothing');
  assert.ok(!slicedCycleRs.blocked.some((e) => e.title.startsWith('[Bob:')), 'excluded slices are never Blocked');
  assert.ok(!slicedCycleRs.external.some((e) => e.title.startsWith('[Bob:')), 'excluded slices are never External');
});

test('an entry with no Requires line and External none. reports only the missing-line error', () => {
  const gamma = missingReqExtRs.structuralErrors.filter((e) => e.title === 'Gamma');
  assert.strictEqual(gamma.length, 1, titles(missingReqExtRs.structuralErrors).join(', '));
  assert.ok(gamma[0].problem.startsWith('missing **Requires:** line'), gamma[0].problem);
  assert.ok(!gamma[0].problem.includes('**External:**'), `External must not be validated past the missing-Requires return: ${gamma[0].problem}`);
});

test('bare text on a top-level Requires line masks the entry edge set, so no cycle is reported', () => {
  assert.ok(findByTitle(bareCycleRs.structuralErrors, 'Carl'), 'Carl must carry the bare-text error');
  assert.ok(!bareCycleRs.structuralErrors.some((e) => e.index === '[cycle]'), JSON.stringify(bareCycleRs.structuralErrors));
  assert.ok(findByTitle(bareCycleRs.blocked, 'Dana'), 'Dana still resolves its link to Carl and is Blocked');
});

test('acyclic existing fixtures produce no cycle structural errors', () => {
  for (const r of [result, gates, collisions]) {
    assert.ok(!titles(r.structuralErrors).some((t) => t.includes('cycle')), JSON.stringify(r.structuralErrors));
  }
});

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

### [Empty target]()

Draft whose heading link has no target.
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

test('http exploring links produce no breakout target', () => {
  assert.ok(!exploringRs.breakoutTargets.some((t) => t.title === 'External idea'));
});

test('empty exploring link target normalizes to link: null', () => {
  const empty = exploringRs.exploring.find((e) => e.title === 'Empty target');
  assert.deepStrictEqual(empty, {
    index: 'FEATURES.md',
    title: 'Empty target',
    link: null,
    excerpt: 'Draft whose heading link has no target.',
  });
  assert.ok(!exploringRs.breakoutTargets.some((t) => t.title === 'Empty target'));
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

// ---------- Requires/External grammar ----------

const GRAMMAR_FEATURES = `# Features

## Area

### [BareTop](features/bare-top.md)

Bare text on the top-level line.

**Requires:** [Anchor](features/anchor.md), vendor SDK.

### [EmptyReq](features/empty-req.md)

Empty Requires label.

**Requires:**

### [Anchor](features/anchor.md)

**Requires:** none.

### [LinkExt](features/link-ext.md)

A link parked in External.

**Requires:** none.
**External:** [Anchor](features/anchor.md).

### [NoneExt](features/none-ext.md)

none. in External.

**Requires:** none.
**External:** none.

### [EmptyExt](features/empty-ext.md)

Empty External label.

**Requires:** none.
**External:**

### [ProseLink](features/prose-link.md)

External prose that merely contains a link.

**Requires:** none.
**External:** vendor support tracked in [RFC 9110](https://example.invalid).

### [Wrapped](features/wrapped.md)

Wrapped External line.

**Requires:** none.
**External:** first primitive,
second primitive.

### [Sliced](features/sliced.md)

Sliced with inline annotations.

**Slices:**

- **MVP \u2014 base.** The base.
- **Ext only.** Later slice gated only on a primitive.
  **External:** Node 24 test runner.
- **Bare inline.** Later slice with bare text in its inline Requires.
  **Requires:** [Anchor](features/anchor.md), vendor SDK.

**Requires:** none.
**External:** vendor toolchain.
`;

const grammarRs = analyze({ FEATURES: GRAMMAR_FEATURES });

function problemFor(rs, title) {
  const rec = findByTitle(rs.structuralErrors, title);
  assert.ok(rec, `${title} not in structuralErrors: ${titles(rs.structuralErrors)}`);
  return rec.problem;
}

test('bare text in a top-level Requires line is a structural error with a move-to-External remedy', () => {
  const problem = problemFor(grammarRs, 'BareTop');
  assert.ok(problem.includes('bare text "vendor SDK" in **Requires:**'), problem);
  assert.ok(problem.includes('move it to **External:**'), problem);
  assert.ok(!findByTitle(grammarRs.blocked, 'BareTop') && !findByTitle(grammarRs.external, 'BareTop'), 'entry-level error replaces classification');
});

test('an empty Requires label is a structural error telling the author to write none.', () => {
  const problem = problemFor(grammarRs, 'EmptyReq');
  assert.ok(problem.includes('empty **Requires:** label'), problem);
  assert.ok(problem.includes('write none.'), problem);
});

test('a link in External is a structural error with a move-to-Requires remedy', () => {
  const problem = problemFor(grammarRs, 'LinkExt');
  assert.ok(problem.includes('link "Anchor" in **External:**'), problem);
  assert.ok(problem.includes('move it to **Requires:**'), problem);
});

test('none. in External is a structural error telling the author to delete the line', () => {
  const problem = problemFor(grammarRs, 'NoneExt');
  assert.ok(problem.includes('none. in **External:**'), problem);
  assert.ok(problem.includes('delete the line'), problem);
});

test('an empty External label is a structural error telling the author to delete the line', () => {
  const problem = problemFor(grammarRs, 'EmptyExt');
  assert.ok(problem.includes('empty **External:** label'), problem);
  assert.ok(problem.includes('delete the line'), problem);
});

test('External prose that merely contains a link is bare text, classified External with no error', () => {
  const entry = findByTitle(grammarRs.external, 'ProseLink');
  assert.ok(entry, titles(grammarRs.external).join(' | '));
  assert.deepStrictEqual(entry.primitives, ['vendor support tracked in [RFC 9110](https://example.invalid)']);
  assert.ok(!findByTitle(grammarRs.structuralErrors, 'ProseLink'));
});

test('a wrapped External line joins across physical lines', () => {
  const entry = findByTitle(grammarRs.external, 'Wrapped');
  assert.ok(entry, titles(grammarRs.external).join(' | '));
  assert.deepStrictEqual(entry.primitives, ['first primitive', 'second primitive']);
});

test('bare text in an inline per-slice Requires annotation is a structural error with its remedy', () => {
  const problem = problemFor(grammarRs, '[Sliced: Bare inline]');
  assert.ok(problem.includes('bare text "vendor SDK" in **Requires:**'), problem);
  assert.ok(problem.includes('move it to **External:**'), problem);
});

test('a continuation slice with an External line and an unshipped MVP is Blocked, externals parenthetical', () => {
  const unit = findByTitle(grammarRs.blocked, '[Sliced: Ext only]');
  assert.ok(unit, titles(grammarRs.blocked).join(' | '));
  assert.deepStrictEqual(unit.blockers, ['Sliced: MVP \u2014 base (implicit MVP gate)']);
  assert.deepStrictEqual(unit.externals, ['Node 24 test runner']);
  assert.ok(!findByTitle(grammarRs.external, '[Sliced: Ext only]'), 'must not double-report');
});

test('the top-level External line governs the first unshipped slice, not later continuations', () => {
  const mvp = findByTitle(grammarRs.external, '[Sliced: MVP \u2014 base]');
  assert.ok(mvp, titles(grammarRs.external).join(' | '));
  assert.deepStrictEqual(mvp.primitives, ['vendor toolchain']);
  const extOnly = findByTitle(grammarRs.blocked, '[Sliced: Ext only]');
  assert.ok(extOnly, titles(grammarRs.blocked).join(' | '));
  assert.deepStrictEqual(extOnly.externals, ['Node 24 test runner']);
});

// ---------- breakout scan ----------

test('scanBreakoutLines finds Requires and External labels at any indentation, outside fences, never in inline backticks', () => {
  const contents = [
    '# Title',
    '',
    'Prose mentioning `**Requires:**` inline never matches.',
    '```',
    '**Requires:** fenced example never matches',
    '```',
    '  **External:** indented primitive.',
    '',
    '**Requires:** none.',
    '',
  ].join('\n');

  assert.deepStrictEqual(scanBreakoutLines(contents), [
    { label: 'External', line: 7 },
    { label: 'Requires', line: 9 },
  ]);
});

test('scanBreakoutLines returns an empty array for a clean breakout', () => {
  assert.deepStrictEqual(scanBreakoutLines('# Title\n\n## Requirements\n\n- Needs a parser.\n'), []);
});

test('scanBreakoutTargets classifies a missing file, a directory, and a dependency line without a pre-read existence probe', () => {
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-scan-${process.pid}`);
  const claudeDir = path.join(tmpRoot, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'features', 'as-dir.md'), { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'features', 'dirty.md'), '# Dirty\n\n**Requires:** none.\n');
  fs.writeFileSync(path.join(claudeDir, 'features', 'clean.md'), '# Clean\n\nProse only.\n');
  fs.writeFileSync(path.join(claudeDir, 'features', 'wrapped.md'), '# Wrapped\n\nProse line one\nprose line two\n');
  try {
    const targets = [
      { index: 'FEATURES.md', title: 'Missing', target: 'features/missing.md', draft: false },
      { index: 'FEATURES.md', title: 'Missing draft', target: 'features/missing-draft.md', draft: true },
      { index: 'FEATURES.md', title: 'Missing structural', target: 'features/missing-structural.md', outcome: 'structural' },
      { index: 'FEATURES.md', title: 'Missing cycle', target: 'features/missing-cycle.md', outcome: 'cycle' },
      { index: 'FEATURES.md', title: 'As dir', target: 'features/as-dir.md', draft: false },
      { index: 'BUGS.md', title: 'Dirty', target: 'features/dirty.md#anchor', draft: false },
      { index: 'FEATURES.md', title: 'Clean', target: 'features/clean.md', draft: false },
      { index: 'FEATURES.md', title: 'Wrapped', target: 'features/wrapped.md', draft: false },
      { index: 'BUGS.md', title: 'Wrapped again', target: 'features/wrapped.md#other', draft: false },
    ];
    const scanned = scanBreakoutTargets(targets, claudeDir);
    assert.deepStrictEqual(scanned.notices, [
      'FEATURES.md entry "Missing" links to features/missing.md, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)',
      'FEATURES.md entry "Missing draft" links to features/missing-draft.md, which does not exist; remove the broken link or create the file (exploring draft; Requires lines do not apply)',
      'FEATURES.md entry "Missing structural" links to features/missing-structural.md, which does not exist; remove the broken link or create the file (its own classification already reports a structural error)',
      'FEATURES.md entry "Missing cycle" links to features/missing-cycle.md, which does not exist; remove the broken link or create the file (it is a dependency-cycle member; see the cycle error)',
      'FEATURES.md entry "As dir" links to features/as-dir.md, which exists but cannot be read as a file (EISDIR); fix the link',
      'breakout file features/wrapped.md has 1 hard-wrapped line (first at line 4); backlog prose is one paragraph or bullet per physical line; run /nightshift:init-backlog to unwrap',
    ]);
    assert.deepStrictEqual(scanned.structuralErrors, [{
      index: 'BUGS.md',
      title: 'Dirty',
      problem: 'breakout file features/dirty.md#anchor carries a **Requires:** line (line 3); delete the breakout line, the index entry is the sole dependency authority (hygiene error: the entry\'s classification stands)',
    }]);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('scanBreakoutTargets treats traversal, absolute, and backslash targets as broken links and never reads outside the backlog', () => {
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-confine-${process.pid}`);
  const claudeDir = path.join(tmpRoot, '.claude');
  fs.mkdirSync(path.join(claudeDir, 'features'), { recursive: true });
  // A real file outside the backlog directory that the traversal target would
  // reach; its dependency line and hard wrap must never surface in the scan.
  fs.writeFileSync(path.join(tmpRoot, 'outside.md'), '# Outside\n\n**Requires:** none.\n\nwrapped line one\nwrapped line two\n');
  try {
    const targets = [
      { index: 'FEATURES.md', title: 'Traversal', target: '../outside.md', draft: false },
      { index: 'FEATURES.md', title: 'Absolute', target: '/outside.md', draft: false },
      { index: 'FEATURES.md', title: 'Backslash', target: 'features\\outside.md', draft: false },
    ];
    const scanned = scanBreakoutTargets(targets, claudeDir);
    assert.deepStrictEqual(scanned.notices, [
      'FEATURES.md entry "Traversal" links to ../outside.md, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)',
      'FEATURES.md entry "Absolute" links to /outside.md, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)',
      'FEATURES.md entry "Backslash" links to features\\outside.md, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)',
    ]);
    assert.deepStrictEqual(scanned.structuralErrors, [], 'the outside file\'s Requires line must never be scanned');
    assert.deepStrictEqual([...scanned.scannedFiles], [], 'no file may be read for a rejected target');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('scanBreakoutTargets treats a breakout through an external directory link as broken and never reads it', () => {
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-linked-breakout-${process.pid}`);
  const claudeDir = path.join(tmpRoot, '.claude');
  const outside = path.join(tmpRoot, 'outside');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'leak.md'), '# Leak\n\n**Requires:** none.\n');
  fs.symlinkSync(outside, path.join(claudeDir, 'bugs'), 'junction');
  try {
    const scanned = scanBreakoutTargets([
      { index: 'BUGS.md', title: 'Leak', target: 'bugs/leak.md', draft: false },
    ], claudeDir);
    assert.deepStrictEqual(scanned.notices, [
      'BUGS.md entry "Leak" links to bugs/leak.md, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)',
    ]);
    assert.deepStrictEqual(scanned.structuralErrors, [], 'the external file dependency line must never be scanned');
    assert.deepStrictEqual([...scanned.scannedFiles], [], 'the external file must never enter the scanned identity set');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('the ready CLI ignores a top-level index link outside the backlog root', () => {
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-linked-index-${process.pid}`);
  const claudeDir = path.join(tmpRoot, '.claude');
  const outside = path.join(tmpRoot, 'outside-features.md');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(outside, '# Features\n\n## External heading\n\n### Secret\n\n**Requires:** none.\n');
  fs.symlinkSync(outside, path.join(claudeDir, 'FEATURES.md'), 'file');
  try {
    const output = execFileSync(process.execPath, [path.join(__dirname, 'ready.js'), tmpRoot], { encoding: 'utf8' });
    assert.ok(!output.includes('External heading'), output);
    assert.ok(!output.includes('Secret'), output);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('the ready CLI rejects a backlog root junction outside the repository root', () => {
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-linked-root-${process.pid}`);
  const repoRoot = path.join(tmpRoot, 'repo');
  const claudeDir = path.join(repoRoot, '.claude');
  const outside = path.join(tmpRoot, 'outside');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'FEATURES.md'), '# Features\n\n## External heading\n\n### Secret root link\n\n**Requires:** none.\n');
  try {
    try {
      fs.symlinkSync(outside, claudeDir, 'junction');
    } catch {
      return;
    }
    const completion = spawnSync(process.execPath, [path.join(__dirname, 'ready.js'), repoRoot], { encoding: 'utf8' });
    assert.notStrictEqual(completion.status, 0, 'an escaping backlog root must fail closed');
    assert.ok(!completion.stdout.includes('External heading'), completion.stdout);
    assert.ok(!completion.stdout.includes('Secret root link'), completion.stdout);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('analyzeCatalog treats traversal, absolute, and backslash breakout links as broken links and never throws', () => {
  const features = `# Features

## Area

### [Traversal](../outside.md)

**Requires:** none.

### [Absolute](/outside.md)

**Requires:** none.

### [Backslash](features\\outside.md)

**Requires:** none.
`;
  const result = analyzeCatalog([{ target: 'FEATURES.md', contents: features }]);
  assert.deepStrictEqual(result.notices, [
    'FEATURES.md entry "Traversal" links to ../outside.md, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)',
    'FEATURES.md entry "Absolute" links to /outside.md, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)',
    'FEATURES.md entry "Backslash" links to features\\outside.md, which does not exist; remove the broken link or create the file (its Requires line still resolves normally)',
  ]);
  assert.deepStrictEqual(result.evidence.notices, [
    { kind: 'notices', ordinal: 0, evidencePaths: ['FEATURES.md'] },
    { kind: 'notices', ordinal: 1, evidencePaths: ['FEATURES.md'] },
    { kind: 'notices', ordinal: 2, evidencePaths: ['FEATURES.md'] },
  ]);
  assert.deepStrictEqual(result.structuralErrors, [], 'a broken link is a notice, not a structural error');
});

const HOSTILE_CYCLE_FEATURES = `# Features

## Area

### [Alpha](../outside.md)

**Requires:** [Beta](/elsewhere.md).

### [Beta](/elsewhere.md)

**Requires:** [Alpha](../outside.md).
`;

test('a cycle whose members carry hostile self-targets is a structural error, never a throw', () => {
  const result = analyzeCatalog([{ target: 'FEATURES.md', contents: HOSTILE_CYCLE_FEATURES }]);
  const cycle = result.structuralErrors.find((e) => e.index === '[cycle]');
  assert.ok(cycle, JSON.stringify(result.structuralErrors));
  assert.strictEqual(cycle.title, '2-node cycle');
  assert.deepStrictEqual(
    result.evidence.structuralErrors,
    [{ kind: 'structuralErrors', ordinal: 0, evidencePaths: ['FEATURES.md'] }],
    'a traversing or absolute self-target is never offered as an evidence path',
  );
});

const DUPLICATE_SELF_TARGET_FEATURES = `# Features

## Area

### [First claimant](features/dup.md)

**Requires:** none.

### [Second claimant](features/dup.md)

**Requires:** none.

### [Dependent](features/dependent.md)

**Requires:** [First claimant](features/dup.md).
`;

test('a duplicate self-target path is a structural error naming every claimant', () => {
  const result = analyze({ FEATURES: DUPLICATE_SELF_TARGET_FEATURES });
  const duplicate = result.structuralErrors.find((e) => e.index === '[duplicate]');
  assert.ok(duplicate, JSON.stringify(result.structuralErrors));
  assert.strictEqual(duplicate.title, 'features/dup');
  assert.strictEqual(
    duplicate.problem,
    'duplicate self-target "features/dup" declared by FEATURES.md "First claimant" and FEATURES.md "Second claimant"; give each entry its own breakout file',
  );
});

test('a link to a duplicated self-target resolves to neither claimant', () => {
  const result = analyze({ FEATURES: DUPLICATE_SELF_TARGET_FEATURES });
  const dependent = findByTitle(result.structuralErrors, 'Dependent');
  assert.ok(dependent, JSON.stringify(result.structuralErrors));
  assert.ok(
    dependent.problem.includes('several active entries declare the self-target path "features/dup"'),
    dependent.problem,
  );
  assert.ok(dependent.problem.includes('give each entry its own breakout file'), dependent.problem);
  assert.ok(
    !titles(result.blocked).includes('Dependent'),
    `an ambiguous link must not silently block on one claimant: ${titles(result.blocked).join(' | ')}`,
  );
  assert.ok(!titles(result.ready).includes('Dependent'), titles(result.ready).join(' | '));
});

const HOSTILE_DUPLICATE_SELF_TARGET_FEATURES = `# Features

## Area

### [First hostile](../dup.md)

**Requires:** none.

### [Second hostile](../dup.md)

**Requires:** none.

### [Dependent](features/dependent.md)

**Requires:** [First hostile](../dup.md).
`;

test('a link to a self-target path claimed twice outside the catalog grammar resolves to neither claimant', () => {
  const result = analyze({ FEATURES: HOSTILE_DUPLICATE_SELF_TARGET_FEATURES });
  const dependent = findByTitle(result.structuralErrors, 'Dependent');
  assert.ok(dependent, JSON.stringify(result.structuralErrors));
  assert.ok(dependent.problem.includes('ambiguous reference'), dependent.problem);
  assert.ok(
    !titles(result.blocked).includes('Dependent'),
    `a hostile duplicate must not silently block on one claimant: ${titles(result.blocked).join(' | ')}`,
  );
  assert.ok(!titles(result.ready).includes('Dependent'), titles(result.ready).join(' | '));
  assert.deepStrictEqual(
    result.structuralErrors.filter((e) => e.index === '[duplicate]'),
    [],
    'a self-target outside the catalog grammar stays a broken-link notice, never a duplicate report',
  );
});

const HOSTILE_SLUG_COLLISION_FEATURES = `# Features

## Area

### [Valid claimant](features/dup.md)

**Requires:** none.

### [Hostile claimant](../dup.md)

**Requires:** none.

### [Dependent](features/dependent.md)

**Requires:** [Hostile claimant](../dup.md).
`;

test('a link to a lone hostile self-target sharing a basename is ambiguous, and the valid entry still classifies', () => {
  const result = analyze({ FEATURES: HOSTILE_SLUG_COLLISION_FEATURES });
  const dependent = findByTitle(result.structuralErrors, 'Dependent');
  assert.ok(dependent, JSON.stringify(result.structuralErrors));
  assert.ok(dependent.problem.includes('several active entries share the file slug "dup"'), dependent.problem);
  assert.ok(
    !titles(result.blocked).includes('Dependent'),
    `the link must not silently resolve to either claimant: ${titles(result.blocked).join(' | ')}`,
  );
  assert.ok(!titles(result.ready).includes('Dependent'), titles(result.ready).join(' | '));
  assert.ok(titles(result.ready).includes('Valid claimant'), titles(result.ready).join(' | '));
  assert.deepStrictEqual(
    result.structuralErrors.filter((e) => e.index === '[duplicate]'),
    [],
    'one catalog-grammar claimant and one hostile claimant are not a duplicate self-target',
  );
});

const HOSTILE_CYCLE_NODE_IDENTITY_FEATURES = `# Features

## Area

### [Alpha](../dup.md)

**Requires:** [Beta](FEATURES.md#beta).

### [Beta](/other.md)

**Requires:** [Alpha](FEATURES.md#alpha).

### [Gamma](/dup.md)

**Requires:** none.
`;

test('two hostile self-targets sharing a path are distinct cycle nodes', () => {
  const result = analyze({ FEATURES: HOSTILE_CYCLE_NODE_IDENTITY_FEATURES });
  const cycle = result.structuralErrors.find((e) => e.index === '[cycle]');
  assert.ok(cycle, JSON.stringify(result.structuralErrors));
  assert.strictEqual(cycle.title, '2-node cycle');
  assert.ok(
    cycle.problem.includes('FEATURES.md/Alpha') && cycle.problem.includes('FEATURES.md/Beta'),
    `the cycle must name its own members, not a same-path bystander: ${cycle.problem}`,
  );
  assert.ok(!cycle.problem.includes('FEATURES.md/Gamma'), cycle.problem);
  assert.ok(
    titles(result.ready).includes('Gamma'),
    `a bystander sharing a hostile self-target path must not inherit the cycle exclusion: ${titles(result.ready).join(' | ')}`,
  );
});

test('breakoutTargets include entries whose classification terminated in a structural error', () => {
  assert.ok(gates.breakoutTargets.some((t) => t.target === 'features/kappa.md'), JSON.stringify(gates.breakoutTargets));
});

const MIXED_SLICE_FEATURES = `# Features

## Area

### [Mu](features/mu.md)

**Slices:**

- **MVP.** Base.
- **Cont.** Extra.
  **Requires:** vendor SDK.

**Requires:** none.
`;

const mixedSliceRs = analyze({ FEATURES: MIXED_SLICE_FEATURES });

function breakoutOutcome(rs, target) {
  const rec = rs.breakoutTargets.find((t) => t.target === target);
  assert.ok(rec, `${target} not in breakoutTargets: ${JSON.stringify(rs.breakoutTargets)}`);
  return rec.outcome;
}

test('breakoutTargets carry a structural outcome for a non-sliced entry whose classification failed', () => {
  assert.strictEqual(breakoutOutcome(gates, 'features/kappa.md'), 'structural');
  assert.strictEqual(breakoutOutcome(missingReqExtRs, 'features/gamma.md'), 'structural');
});

test('breakoutTargets carry a cycle outcome for a well-formed cycle member and structural for a malformed one', () => {
  assert.strictEqual(breakoutOutcome(extCycleRs, 'features/anna.md'), 'cycle');
  assert.strictEqual(breakoutOutcome(extCycleRs, 'features/bob.md'), 'cycle');
  assert.strictEqual(breakoutOutcome(extLinkCycleRs, 'features/anna.md'), 'cycle');
  assert.strictEqual(breakoutOutcome(extLinkCycleRs, 'features/bob.md'), 'structural', 'structural wins over cycle');
});

test('breakoutTargets carry a structural outcome for a sliced entry mixing a ready slice with a structural slice', () => {
  assert.ok(findByTitle(mixedSliceRs.ready, '[Mu: MVP]'), titles(mixedSliceRs.ready).join(', '));
  assert.ok(findByTitle(mixedSliceRs.structuralErrors, '[Mu: Cont]'), titles(mixedSliceRs.structuralErrors).join(', '));
  assert.strictEqual(breakoutOutcome(mixedSliceRs, 'features/mu.md'), 'structural');
});

test('breakoutTargets omit the outcome field for a resolved entry', () => {
  const iota = gates.breakoutTargets.find((t) => t.target === 'features/iota.md');
  assert.ok(iota, JSON.stringify(gates.breakoutTargets));
  assert.ok(!('outcome' in iota), JSON.stringify(iota));
});

test('real structural and cycle outcomes reach the missing-breakout notice end to end', () => {
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-outcome-${process.pid}`);
  const claudeDir = path.join(tmpRoot, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  try {
    const structural = scanBreakoutTargets(mixedSliceRs.breakoutTargets, claudeDir);
    assert.deepStrictEqual(structural.notices, [
      'FEATURES.md entry "Mu" links to features/mu.md, which does not exist; remove the broken link or create the file (its own classification already reports a structural error)',
    ]);
    const cycle = scanBreakoutTargets(extCycleRs.breakoutTargets, claudeDir);
    assert.deepStrictEqual(cycle.notices, [
      'FEATURES.md entry "Anna" links to features/anna.md, which does not exist; remove the broken link or create the file (it is a dependency-cycle member; see the cycle error)',
      'FEATURES.md entry "Bob" links to features/bob.md, which does not exist; remove the broken link or create the file (it is a dependency-cycle member; see the cycle error)',
    ]);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------- CLI smoke test ----------

test('CLI reads a .claude dir and emits the same JSON shape', () => {
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-test-${process.pid}`);
  const claudeDir = path.join(tmpRoot, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(claudeDir, 'QUICK_WINS.md'), QUICK_WINS);
    fs.writeFileSync(path.join(claudeDir, 'FEATURES.md'), FEATURES
      .replace('### [Draft thing](features/draft.md)', '### [Linked draft](features/draft-linked.md)\n\nSecond draft, whose breakout exists on disk.\n\n### [Draft thing](features/draft.md)')
      .replace('Core engine for the thing.', 'Core engine for the thing. See [stale plan](plans/stale-plan.md) for historical context (body prose, not a breakout target).'));
    fs.writeFileSync(path.join(claudeDir, 'BUGS.md'), BUGS);
    fs.mkdirSync(path.join(claudeDir, 'features'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'features', 'beta.md'), '# Beta\n\n**Requires:** [Alpha](alpha.md).\n');
    fs.writeFileSync(path.join(claudeDir, 'features', 'draft-linked.md'), '# Draft\n\n  **External:** something.\n');
    fs.writeFileSync(path.join(claudeDir, 'features', 'gamma.md'), '# Gamma\n\nSee `**Requires:**` in the index.\n\n```\n**Requires:** example\n```\n');
    fs.mkdirSync(path.join(claudeDir, 'features', 'sigma.md'));
    const HISTORY_ONLY_TITLE = 'Retired baseline';
    fs.writeFileSync(path.join(claudeDir, 'FEATURES_HISTORY.md'), `# Features history\n\n## Entries\n\n### [${HISTORY_ONLY_TITLE}](features/retired-baseline.md)\n\n**Requires:** [Alpha](features/alpha.md).\n`);
    fs.mkdirSync(path.join(claudeDir, 'plans'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'plans', 'stale-plan.md'), '# Plan\n\nWrapped plan prose\nstays out of scope.\n\n**Requires:** [Alpha](features/alpha.md).\n');
    fs.writeFileSync(path.join(claudeDir, 'BUGS_HISTORY.md'), '# Bugs history\n\nA fixed bug whose entry\nis hard-wrapped.\n');
    fs.mkdirSync(path.join(claudeDir, 'patterns'), { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'patterns', 'wrapped.md'), '# Pattern\n\nPattern prose\nhard-wrapped.\n');
    fs.writeFileSync(path.join(claudeDir, 'features', 'orphan.md'), '# Orphan\n\nNo index entry links here\nand it is hard-wrapped.\n');
    const stdout = execFileSync(process.execPath, [path.join(__dirname, 'ready.js'), tmpRoot], { encoding: 'utf8' });
    const cli = JSON.parse(stdout);
    const hardWrapNotices = cli.notices.filter((n) => n.startsWith('backlog file ') && n.includes('hard-wrapped'));
    assert.deepStrictEqual(hardWrapNotices.map((n) => n.split(' has ')[0]), [
      'backlog file BUGS_HISTORY.md',
      'backlog file features/orphan.md',
      'backlog file patterns/wrapped.md',
    ], `every unlinked backlog file is noticed once and plans are not: ${JSON.stringify(hardWrapNotices)}`);
    assert.ok(Array.isArray(cli.ready) && cli.ready.length > 0);
    assert.ok(cli.indexes.missing.includes('PATTERNS.md'));
    assert.ok(
      cli.notices.some((n) => n.includes('features/alpha.md')),
      `broken breakout-file links should be noticed: ${JSON.stringify(cli.notices)}`,
    );
    assert.ok(
      cli.notices.some((n) => n.includes('features/alpha.md') && n.includes('(its Requires line still resolves normally)')),
      `non-draft notices must keep the Requires-resolution tail: ${JSON.stringify(cli.notices)}`,
    );
    assert.ok(
      cli.notices.some((n) => n.includes('features/draft.md') && n.includes('(exploring draft; Requires lines do not apply)')),
      `broken exploring links should carry the draft tail: ${JSON.stringify(cli.notices)}`,
    );
    assert.ok(
      !cli.notices.some((n) => n.includes('features/draft.md') && n.includes('Requires line still resolves')),
      'draft notices must not claim Requires resolution',
    );
    const betaError = cli.structuralErrors.find((e) => e.title === 'Beta');
    assert.ok(betaError, JSON.stringify(cli.structuralErrors));
    assert.ok(betaError.problem.includes('breakout file features/beta.md carries a **Requires:** line'), betaError.problem);
    assert.ok(betaError.problem.includes('delete the breakout line'), betaError.problem);
    assert.ok(cli.blocked.some((b) => b.title === 'Beta'), 'hygiene error coexists with the entry classification');
    const draftError = cli.structuralErrors.find((e) => e.title === 'Linked draft');
    assert.ok(draftError && draftError.problem.includes('**External:**'), JSON.stringify(cli.structuralErrors));
    assert.ok(!cli.structuralErrors.some((e) => e.title === 'Gamma' && e.problem.includes('breakout file')), 'backticked and fenced mentions never match');
    assert.ok(
      cli.notices.some((n) => n.includes('features/sigma.md') && n.includes('cannot be read as a file')),
      `directory target must be a notice: ${JSON.stringify(cli.notices)}`,
    );
    assert.ok(Array.isArray(cli.ready) && cli.ready.length > 0, 'report still emitted');
    assert.ok(
      !cli.structuralErrors.some((e) => e.index.includes('HISTORY')),
      `no structural error is attributed to a history archive index: ${JSON.stringify(cli.structuralErrors)}`,
    );
    assert.ok(
      !cli.notices.some((n) => n.includes('HISTORY') && !n.includes('hard-wrapped')),
      `no dependency notice references a history archive (only the line-discipline sweep reads it): ${JSON.stringify(cli.notices)}`,
    );
    assert.ok(
      !cli.structuralErrors.some((e) => e.title === HISTORY_ONLY_TITLE) &&
        !cli.ready.some((r) => r.title === HISTORY_ONLY_TITLE) &&
        !cli.blocked.some((b) => b.title === HISTORY_ONLY_TITLE) &&
        !cli.external.some((x) => x.title === HISTORY_ONLY_TITLE),
      'the entry that lives only in FEATURES_HISTORY.md must never surface in any classification',
    );
    assert.ok(
      !cli.structuralErrors.some((e) => e.problem.includes('plans/stale-plan.md')),
      `a body-prose link into plans/ is never treated as a breakout target: ${JSON.stringify(cli.structuralErrors)}`,
    );
    assert.ok(
      !cli.notices.some((n) => n.includes('plans/stale-plan.md')),
      `a body-prose link into plans/ never produces a breakout notice: ${JSON.stringify(cli.notices)}`,
    );
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

// ---------- summary ----------

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  process.exitCode = 1;
}
