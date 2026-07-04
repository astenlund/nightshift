#!/usr/bin/env node
'use strict';

// Fixture-based tests for ready.js. Run with: node ready.test.js
// No test framework; plain asserts with a tiny harness. Exit code 1 on
// any failure.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  analyze,
  stripStable,
  normalizeSliceName,
  splitTopLevelCommas,
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

// ---------- fixtures ----------

const QUICK_WINS = `# Quick wins

Intro prose.

## Extractions

### Shared helper extraction

Dedupe the path-joining helper across the three scripts.

## Misc

- **Rename the thing.** Quick rename across call sites.

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

**Requires:** [Alpha](features/alpha.md), vendor SDK
support for streaming, [shared helper extraction](../QUICK_WINS.md#shared-helper-extraction).

### [Gamma](features/gamma.md)

Missing requires line entirely.

### [Delta](features/delta.md)

Sliced feature, MVP struck.

**Slices:**

- ~~MVP — floating-reference core.~~ (Shipped — see FEATURES_HISTORY.md.)
- **Re-anchor events.** Manual UI re-anchor plumbing.
- **Late-join replay.** Pull endpoint.
  **Requires:** [Delta: re-anchor events](features/delta.md).
- **\`RepertoireSource\`.** Drop-in replacement.
  **Requires:** [Epsilon](features/epsilon.md).

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

- **MVP — base layer.** The base.
- **Extension.** Extra layer with no explicit gates.

**Requires:** none.

### [Iota](features/iota.md)

Empty slices block; still being scoped.

**Slices:**

**Requires:** none.

### [Kappa](features/kappa.md)

All slices shipped, parent not graduated.

**Slices:**

- ~~MVP — first.~~ (Shipped.)
- ~~Second bit.~~ (Shipped.)

**Requires:** none.
`;

// ---------- unit tests ----------

test('stripStable unwraps nested markers until stable', () => {
  assert.strictEqual(stripStable('**`Identifier`.**'), 'Identifier');
  assert.strictEqual(stripStable('~~MVP — core.~~'), 'MVP — core');
  assert.strictEqual(stripStable('  plain.  '), 'plain');
});

test('normalizeSliceName strips slice-type prefix and case-folds', () => {
  assert.strictEqual(normalizeSliceName('~~MVP — floating-reference core.~~'), 'floating-reference core');
  assert.strictEqual(normalizeSliceName('floating-reference core'), 'floating-reference core');
  assert.strictEqual(normalizeSliceName('Slice 2 — Foo Bar.'), 'foo bar');
  assert.strictEqual(normalizeSliceName('**`RepertoireSource`.**'), 'repertoiresource');
});

test('splitTopLevelCommas ignores commas inside links', () => {
  const items = splitTopLevelCommas('a, [b, c](x), d');
  assert.deepStrictEqual(items, ['a', '[b, c](x)', 'd']);
});

// ---------- analyze() on the main fixture set ----------

const result = analyze({ QUICK_WINS, FEATURES, BUGS, PATTERNS: '# Patterns\n' });

test('quick wins are always ready, both h3 and bullet shapes', () => {
  const ready = titles(result.ready);
  assert.ok(ready.includes('Shared helper extraction'), `missing h3 QW in ${ready}`);
  assert.ok(ready.includes('Rename the thing'), `missing bullet QW in ${ready}`);
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

test('wrapped Requires line joins across physical lines; mixed link+external is Blocked', () => {
  const beta = findByTitle(result.blocked, 'Beta');
  assert.ok(beta, `Beta not in blocked: ${titles(result.blocked)}`);
  assert.ok(beta.blockers.includes('Alpha'), JSON.stringify(beta.blockers));
  assert.ok(beta.blockers.includes('Shared helper extraction'), JSON.stringify(beta.blockers));
  assert.deepStrictEqual(beta.externals, ['vendor SDK support for streaming']);
  assert.ok(!findByTitle(result.external, 'Beta'), 'Beta must not double-report under External');
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

// ---------- analyze() on the gates fixture ----------

const gates = analyze({ FEATURES: FEATURES_GATES });

test('missing indexes are reported and do not abort', () => {
  assert.ok(gates.indexes.missing.includes('QUICK_WINS.md'));
  assert.ok(gates.indexes.missing.includes('BUGS.md'));
  assert.ok(gates.indexes.found.includes('FEATURES.md'));
});

test('first unshipped slice uses the top-level Requires line', () => {
  assert.ok(
    titles(gates.ready).includes('[Theta: MVP — base layer]'),
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

// ---------- CLI smoke test ----------

test('CLI reads a .claude dir and emits the same JSON shape', () => {
  const tmpRoot = path.join(__dirname, '..', '..', '.tmp', `ready-test-${process.pid}`);
  const claudeDir = path.join(tmpRoot, '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(claudeDir, 'QUICK_WINS.md'), QUICK_WINS);
    fs.writeFileSync(path.join(claudeDir, 'FEATURES.md'), FEATURES);
    fs.writeFileSync(path.join(claudeDir, 'BUGS.md'), BUGS);
    const stdout = execFileSync(process.execPath, [path.join(__dirname, 'ready.js'), tmpRoot], { encoding: 'utf8' });
    const cli = JSON.parse(stdout);
    assert.ok(Array.isArray(cli.ready) && cli.ready.length > 0);
    assert.ok(cli.indexes.missing.includes('PATTERNS.md'));
    assert.ok(
      cli.notices.some((n) => n.includes('features/alpha.md')),
      `broken breakout-file links should be noticed: ${JSON.stringify(cli.notices)}`,
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
