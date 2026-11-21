#!/usr/bin/env node
'use strict';

// The settled-record verdict tripwire (.nightshift/specs/settled-record-verdicts.md, Rule identity): pins a digest of the sources the
// checks a verdict vouches for reach, so a release that changes them cannot keep the rule identity without saying so. A change fails
// the release gate until the release re-pins with --write, either after changing the rule identity in
// internal/runtime/settled-verdicts.js and listing the replaced identity as an earlier one, which any change to what those checks
// accept or refuse requires, or, only when that is unchanged, under the same identity with --statement, whose statement the changelog
// must carry verbatim.

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const PIN = 'tools/verdict-rule-pin.json';
const IDENTITY_SOURCE = 'internal/runtime/settled-verdicts.js';
const CHANGELOG = 'CHANGELOG.md';
// The modules whose judgments a verdict stands in for: record identity and shape, state and latest-row agreement, discharge, the
// verification of the evidence a retired record's state references, and the retired-record certificate checks, together with the
// refusal helpers every one of them uses, which decide whether a condition refuses and which refusals keep a pass's writes.
const SOURCES = Object.freeze([
  'internal/runtime/applicability.js',
  'internal/runtime/artifact-hydration.js',
  'internal/runtime/closing-hold.js',
  'internal/runtime/creation-consistency.js',
  'internal/runtime/delivery-outcome.js',
  'internal/runtime/discharge.js',
  'internal/runtime/documentation-paths.js',
  'internal/runtime/errors.js',
  'internal/runtime/evidence.js',
  'internal/runtime/finding-scope.js',
  'internal/runtime/history-store.js',
  'internal/runtime/legacy-approval-v1.js',
  'internal/runtime/legacy-backlog.js',
  'internal/runtime/legacy-certificates.js',
  'internal/runtime/legacy-store.js',
  'internal/runtime/lifecycle.js',
  'internal/runtime/progress-store.js',
  'internal/runtime/progress.js',
  'internal/runtime/provenance-store.js',
  'internal/runtime/records.js',
  'internal/runtime/relevance.js',
  'internal/runtime/report-delivery.js',
  'internal/runtime/review-context.js',
  'internal/runtime/review-inputs.js',
  'internal/runtime/safe-directory.js',
  'internal/runtime/settled-verdicts.js',
  'internal/runtime/spec-readiness.js',
  'internal/runtime/statuses.js',
  'internal/runtime/workers.js',
]);
// Modules a pinned source requires that cannot change what a vouched check accepts or refuses, each with the reason. A pinned source
// requiring a module in neither list fails the gate, so the pinned set keeps covering what the vouched checks reach.
const EXCLUDED = Object.freeze({
  'internal/backlog-catalog.js': 'reached only through legacy-backlog targetEntry, which followupsValid runs at every pass, vouched records included',
  'internal/backlog-links.js': 'reached only through legacy-backlog targetEntry, which followupsValid runs at every pass, vouched records included',
  'internal/filesystem-primitives.js': 'reached only through legacy-backlog targetEntry, which followupsValid runs at every pass, vouched records included',
  'internal/releases/io.js': 'reached only through legacy-backlog targetEntry, which followupsValid runs at every pass, vouched records included',
  'internal/releases/entry.js': 'resolves the executing release binding for operations, not a judgment of a saved record',
  'internal/releases/service.js': 'admits release operations for running work, not a judgment of a saved record',
  'internal/runtime/close.js': 'supplies the close verdict a refusal message names beside the routes of a blocking record, not a judgment of whether a record is discharged',
  'internal/runtime/actions.js': 'admits runtime operations, not a judgment of a saved record',
  'internal/runtime/continuation.js': 'observes host continuation for running work',
  'internal/runtime/continuation-health.js': 'observes host continuation for running work',
  'internal/runtime/limits.js': 'validates requested run limits at acceptance',
  'internal/runtime/ownership.js': 'judges adoption eligibility of unfinished work',
  'internal/runtime/project-ownership.js': 'guards canonical writes of running work',
  'internal/runtime/scratch.js': 'reports scratch tracking for status',
});
const scriptName = path.basename(__filename, '.js');

// Reads a revision through Git, so the digest follows committed content whatever a checkout's line endings are.
function gitTree(root) {
  const run = args => spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return {
    blob: (revision, file) => {
      const result = run(['rev-parse', '--verify', '--quiet', `${revision}:${file}`]);
      return result.status === 0 ? result.stdout.trim() : null;
    },
    text: (revision, file) => {
      const result = run(['show', `${revision}:${file}`]);
      return result.status === 0 ? result.stdout : null;
    },
  };
}

function digest(tree, revision) {
  return createHash('sha256').update(SOURCES.map(file => `${file} ${tree.blob(revision, file) ?? 'missing'}\n`).join('')).digest('hex');
}

// The rule identity and earlier identities of the identity module's IDENTITY declaration, or null when they cannot be read without
// ambiguity: the source must hold exactly one assignment-shaped occurrence of IDENTITY, written as a line-start declaration whose
// earlier list holds only plain string literals. A second occurrence anywhere, a comment or string included, refuses rather than risk
// reading an example instead of the declaration the runtime executes.
function identityOf(text) {
  if (typeof text !== 'string' || [...text.matchAll(/\bIDENTITY\s*=(?!=)/g)].length !== 1) return null;
  const declaration = text.match(/^const IDENTITY = \{ rule: '([^']+)', earlier: \[([^\]]*)\] \};$/m);
  if (!declaration) return null;
  const earlier = declaration[2].split(',').map(item => item.trim()).filter(item => item.length > 0).map(item => item.match(/^'([^']+)'$/)?.[1]);

  return earlier.every(rule => rule !== undefined) ? { rule: declaration[1], earlier } : null;
}

function ruleOf(text) {
  return identityOf(text)?.rule ?? null;
}

function earlierOf(text) {
  return identityOf(text)?.earlier ?? null;
}

// The index just past whitespace and comments from a position.
function skipTrivia(text, index) {
  for (;;) {
    while (index < text.length && /\s/.test(text[index])) index++;
    if (text.startsWith('/*', index)) {
      const end = text.indexOf('*/', index + 2);
      index = end < 0 ? text.length : end + 2;
    } else if (text.startsWith('//', index)) {
      const end = text.indexOf('\n', index);
      index = end < 0 ? text.length : end + 1;
    } else return index;
  }
}

// What the pinned sources require at a revision: the local modules neither pinned nor excluded, and the sources holding a reference to
// a module loader the scan cannot positively read. Every occurrence of require or import is read past whitespace and comments: one
// followed by a word is prose in a comment or string; a require called with a plain string literal is a dependency; anything else
// fails closed, a dynamic import call, a computed argument, an alias or a method call on require among it.
function dependencies(tree, revision) {
  const missing = new Set();
  const unreadable = new Set();
  for (const source of SOURCES) {
    const text = tree.text(revision, source);
    if (text === null) continue;
    for (const match of text.matchAll(/\b(require|import)\b/g)) {
      let index = skipTrivia(text, match.index + match[0].length);
      if (/[A-Za-z0-9_]/.test(text[index] ?? '')) continue;
      if (match[1] === 'import') {
        if (text[index] === '(' || text.startsWith('?.', index)) unreadable.add(source);
        continue;
      }
      if (text.startsWith('?.', index)) index = skipTrivia(text, index + 2);
      if (text[index] !== '(') {
        unreadable.add(source);
        continue;
      }
      const end = text.indexOf(')', index);
      const literal = end < 0 ? null : text.slice(index + 1, end).trim().match(/^(['"`])([^'"`]*)\1$/);
      if (!literal || literal[1] === '`' && literal[2].includes('${')) {
        unreadable.add(source);
        continue;
      }
      if (!/^\.{1,2}\//.test(literal[2])) continue;
      let target = path.posix.normalize(path.posix.join(path.posix.dirname(source), literal[2]));
      if (!/\.(js|json)$/.test(target)) target += '.js';
      if (!SOURCES.includes(target) && !Object.hasOwn(EXCLUDED, target)) missing.add(target);
    }
  }
  return { missing: [...missing].sort(), unreadable: [...unreadable].sort() };
}

// The local modules a pinned source requires at a revision that are neither pinned nor excluded.
function uncovered(tree, revision) {
  return dependencies(tree, revision).missing;
}

function parsePin(text) {
  if (text === null) return null;
  try { return JSON.parse(text); } catch { return undefined; }
}

// Problems with the pin at head, given the baseline the release is compared against. A tree without the verdict module predates the
// tripwire and has none.
function pinProblems(tree, baseline, head) {
  const identity = tree.text(head, IDENTITY_SOURCE);
  if (identity === null) return [];
  const pin = parsePin(tree.text(head, PIN));
  if (!pin) return [`${PIN} is ${pin === null ? 'missing' : 'unreadable'} at ${head}; run node tools/${scriptName}.js --write`];
  const rule = ruleOf(identity);
  const reached = dependencies(tree, head);
  const problems = [
    ...reached.missing.map(file => `A source the settled-record verdict checks reach requires ${file}, which tools/${scriptName}.js neither pins in SOURCES nor excludes with a reason in EXCLUDED`),
    ...reached.unreadable.map(file => `${file} requires a module it does not name literally, so tools/${scriptName}.js cannot tell whether the pinned set covers it`),
  ];
  if (!rule) problems.push(`${IDENTITY_SOURCE} at ${head} has no readable rule identity`);
  else if (pin.rule !== rule) problems.push(`${PIN} pins rule ${pin.rule} but ${IDENTITY_SOURCE} at ${head} declares ${rule}; run node tools/${scriptName}.js --write`);
  if (pin.digest !== digest(tree, head)) problems.push(`Sources the settled-record verdict checks reach changed since ${PIN} was pinned: change the rule identity in ${IDENTITY_SOURCE}, listing the old one as earlier, and run node tools/${scriptName}.js --write, or, when what those checks accept and refuse is unchanged, run node tools/${scriptName}.js --write --statement "<why>" and record that statement in ${CHANGELOG}`);
  const earlier = parsePin(tree.text(baseline, PIN));
  if (!earlier || problems.length > 0) return problems;
  if (earlier.rule === pin.rule && earlier.digest !== pin.digest) {
    if (typeof pin.statement !== 'string' || !pin.statement.trim()) problems.push(`${PIN} was re-pinned since ${baseline} under the same rule identity without a statement`);
    else if (!(tree.text(head, CHANGELOG) ?? '').includes(pin.statement)) problems.push(`${CHANGELOG} at ${head} does not carry the re-pin statement of ${PIN}: ${pin.statement}`);
  }
  if (earlier.rule !== pin.rule) {
    const listed = earlierOf(identity);
    if (listed === null) problems.push(`${IDENTITY_SOURCE} at ${head}: its earlier rule identities cannot be read as a list of string literals`);
    else if (!listed.includes(earlier.rule)) problems.push(`${IDENTITY_SOURCE} at ${head} replaces rule identity ${earlier.rule} without listing it as an earlier one`);
  }

  return problems;
}

// Pins the working tree's sources, as Git would store them, so the pin can be committed together with them.
function write(root, statement) {
  const working = { blob: (_, file) => spawnSync('git', ['hash-object', file], { cwd: root, windowsHide: true, encoding: 'utf8' }).stdout.trim() || null };
  const rule = ruleOf(fs.readFileSync(path.join(root, IDENTITY_SOURCE), 'utf8'));
  if (!rule) throw new Error(`${IDENTITY_SOURCE} has no readable rule identity`);
  const pin = { rule, digest: digest(working, null), statement: statement ?? null };
  fs.writeFileSync(path.join(root, PIN), JSON.stringify(pin, null, 2) + '\n');
  return pin;
}

function main(argv) {
  const root = process.cwd();
  if (argv[0] === '--write') {
    const index = argv.indexOf('--statement');
    const pin = write(root, index >= 0 ? argv[index + 1] : undefined);
    console.log(JSON.stringify(pin));
    return 0;
  }
  const baseline = argv[0] ?? 'origin/main';
  const problems = pinProblems(gitTree(root), baseline, 'HEAD');
  for (const problem of problems) console.error(`${scriptName}: ${problem}`);
  return problems.length ? 1 : 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { EXCLUDED, PIN, SOURCES, digest, gitTree, identityOf, pinProblems, uncovered };
