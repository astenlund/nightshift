'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PIN, SOURCES, digest, identityOf, pinProblems, uncovered } = require('../tools/verdict-rule-pin');

const IDENTITY = 'internal/runtime/settled-verdicts.js';
const identityText = (rule, earlier = []) => `const IDENTITY = { rule: '${rule}', earlier: [${earlier.map(value => `'${value}'`).join(', ')}] };\n`;

// A fake Git tree per revision: source blob ids and file texts.
function trees(revisions) {
  return {
    blob: (revision, file) => revisions[revision].blobs[file] ?? null,
    text: (revision, file) => revisions[revision].files[file] ?? null,
  };
}

function revision({ rule = 'rule-1', earlier = [], changed = null, pin = 'match', statement = null, changelog = '' } = {}) {
  const blobs = Object.fromEntries(SOURCES.map(file => [file, file === changed ? 'changed-blob' : 'original-blob']));
  const files = { [IDENTITY]: identityText(rule, earlier), 'CHANGELOG.md': changelog };
  const value = { blobs, files };
  const actual = digest(trees({ self: value }), 'self');
  if (pin === 'match') files[PIN] = JSON.stringify({ rule, digest: actual, statement });
  else if (pin !== null) files[PIN] = JSON.stringify({ rule, digest: pin, statement });
  return value;
}

test('a tree without the verdict module has no tripwire', () => {
  // Arrange
  const tree = trees({ base: { blobs: {}, files: {} }, head: { blobs: {}, files: {} } });

  // Act
  const problems = pinProblems(tree, 'base', 'head');

  // Assert
  assert.deepEqual(problems, []);
});

test('an unchanged pin passes and a missing pin fails', () => {
  assert.deepEqual(pinProblems(trees({ base: revision(), head: revision() }), 'base', 'head'), []);
  assert.match(pinProblems(trees({ base: revision(), head: revision({ pin: null }) }), 'base', 'head')[0], /verdict-rule-pin\.json is missing/);
});

test('a changed vouched source with neither a new rule identity nor a re-pin fails the gate', () => {
  // Arrange
  const base = revision();
  const stale = revision({ changed: SOURCES[0], pin: digest(trees({ base }), 'base') });

  // Act
  const problems = pinProblems(trees({ base, head: stale }), 'base', 'head');

  // Assert
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Sources the settled-record verdict checks reach changed/);
});

test('a change to the refusal helpers every vouched check uses fails the gate like any pinned source', () => {
  // Arrange
  const base = revision();
  const changed = revision({ changed: 'internal/runtime/errors.js', pin: digest(trees({ base }), 'base') });

  // Act
  const problems = pinProblems(trees({ base, head: changed }), 'base', 'head');

  // Assert
  assert.match(problems[0] ?? '', /Sources the settled-record verdict checks reach changed/);
});

test('a re-pin under the same rule identity needs a statement the changelog carries', () => {
  const base = revision();
  const unstated = revision({ changed: SOURCES[1] });
  assert.match(pinProblems(trees({ base, head: unstated }), 'base', 'head')[0], /re-pinned .* without a statement/);
  const unrecorded = revision({ changed: SOURCES[1], statement: 'Refactor only; the vouched checks accept and refuse the same records.' });
  assert.match(pinProblems(trees({ base, head: unrecorded }), 'base', 'head')[0], /does not carry the re-pin statement/);
  const recorded = revision({ changed: SOURCES[1], statement: 'Refactor only; the vouched checks accept and refuse the same records.', changelog: '- Refactor only; the vouched checks accept and refuse the same records.\n' });
  assert.deepEqual(pinProblems(trees({ base, head: recorded }), 'base', 'head'), []);
});

test('a new rule identity passes only when it lists the one it replaces as earlier', () => {
  const base = revision();
  const forgotten = revision({ rule: 'rule-2', changed: SOURCES[2] });
  assert.match(pinProblems(trees({ base, head: forgotten }), 'base', 'head')[0], /replaces rule identity rule-1 without listing it/);
  const mentioned = revision({ rule: 'rule-2', changed: SOURCES[2] });
  mentioned.files[IDENTITY] += "// Replaces 'rule-1'.\n";
  assert.match(pinProblems(trees({ base, head: mentioned }), 'base', 'head')[0], /replaces rule identity rule-1 without listing it/, 'A mention outside the earlier list does not count');
  const unread = revision({ rule: 'rule-2', changed: SOURCES[2] });
  unread.files[IDENTITY] = unread.files[IDENTITY].replace('earlier: []', 'earlier: PREVIOUS_RULES');
  assert.ok(pinProblems(trees({ base, head: unread }), 'base', 'head').some(problem => /no readable rule identity|earlier rule identities cannot be read/.test(problem)), 'An earlier list that cannot be read fails closed');
  const example = revision({ rule: 'rule-2', changed: SOURCES[2] });
  example.files[IDENTITY] = "// For example: IDENTITY = { rule: 'rule-2', earlier: ['rule-1'] }\n" + example.files[IDENTITY];
  assert.ok(pinProblems(trees({ base, head: example }), 'base', 'head').some(problem => /no readable rule identity/.test(problem)), 'A second IDENTITY occurrence, even in a comment, makes the declaration ambiguous');
  const listed = revision({ rule: 'rule-2', earlier: ['rule-1'], changed: SOURCES[2] });
  assert.deepEqual(pinProblems(trees({ base, head: listed }), 'base', 'head'), []);
});

test('a pinned source requiring a module neither pinned nor excluded fails the gate', () => {
  // Arrange
  const base = revision();
  const head = revision();
  head.files[SOURCES[0]] = "const helper = require('./a-new-judgment-helper');\n";

  // Act
  const problems = pinProblems(trees({ base, head }), 'base', 'head');

  // Assert
  assert.ok(problems.some(problem => /requires internal\/runtime\/a-new-judgment-helper\.js, which .* neither pins/.test(problem)));
});

test('a pinned source requiring the run store fails the gate, since bindings it re-exports would escape the digest', () => {
  // Arrange
  const base = revision();
  const head = revision();
  head.files[SOURCES[0]] = "const { text } = require('./store');\n";

  // Act
  const problems = pinProblems(trees({ base, head }), 'base', 'head');

  // Assert
  assert.ok(problems.some(problem => /requires internal\/runtime\/store\.js, which .* neither pins/.test(problem)));
});

test('every require spelling of an unpinned module fails the gate, and a require it cannot read fails closed', () => {
  const problemsFor = source => {
    const base = revision();
    const head = revision();
    head.files[SOURCES[0]] = source;
    return pinProblems(trees({ base, head }), 'base', 'head');
  };
  for (const source of ['const helper = require("./a-new-judgment-helper");', "const helper = require( './a-new-judgment-helper' );", 'const helper = require(`./a-new-judgment-helper`);']) {
    assert.ok(problemsFor(source).some(problem => /requires internal\/runtime\/a-new-judgment-helper\.js, which .* neither pins/.test(problem)), source);
  }
  assert.ok(problemsFor("const helper = require /* local judgment */ ('./a-new-judgment-helper');").some(problem => /requires internal\/runtime\/a-new-judgment-helper\.js, which .* neither pins/.test(problem)), 'a comment before the parenthesis');
  for (const source of ["const helper = require(`./${name}`);", 'const helper = require(name);', 'const load = require; load("./x");', "require.call(null, './x');", "const helper = import('./x.js');", "const helper = import /* local judgment */ ('./x.js');", "const helper = import // local judgment\n('./x.js');"]) {
    assert.ok(problemsFor(source).some(problem => /requires a module it does not name literally/.test(problem)), source);
  }
});

test('the identity the gate reads is the one the runtime module exports', () => {
  const text = fs.readFileSync(path.resolve(__dirname, '../internal/runtime/settled-verdicts.js'), 'utf8');
  assert.deepEqual(identityOf(text), { ...require('../internal/runtime/settled-verdicts').IDENTITY });
});

test('the checkout\'s pinned sources cover every module they require, apart from the named exclusions', () => {
  const root = path.resolve(__dirname, '..');
  const working = { text: (_, file) => (fs.existsSync(path.join(root, file)) ? fs.readFileSync(path.join(root, file), 'utf8') : null) };
  assert.deepEqual(uncovered(working, null), []);
  assert.deepEqual(pinProblems({ ...working, blob: () => null }, null, null).filter(problem => /does not name literally/.test(problem)), [], 'Every require in the pinned sources names its module literally');
});

test('a pin naming another rule identity than the source declares fails', () => {
  const base = revision();
  const head = revision();
  head.files[PIN] = JSON.stringify({ ...JSON.parse(head.files[PIN]), rule: 'rule-0' });
  assert.match(pinProblems(trees({ base, head }), 'base', 'head')[0], /pins rule rule-0 but/);
});
