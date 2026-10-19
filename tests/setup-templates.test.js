'use strict';

// Setup adjudication of index text against its template (.nightshift/specs/setup-index-text-adjudication.md).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { BACKLOG_FILES } = require('../internal/backlog-catalog');
const { currentBacklogStatus, initialize } = require('../internal/setup');
const { targetEntry } = require('../internal/runtime/legacy-backlog');
const { RECOVERY_SUFFIX } = require('../internal/unwrap-recovery');
const { adjudicate, inspectTemplates, validateDecisions } = require('../internal/template-text');
const { describeDocument, sha256 } = require('../internal/template-text/document');
const { loadTemplates, templateModel } = require('../internal/template-text/templates');
const { entriesProblem } = require('../internal/template-text/entries');
const { plannedChanges } = require('../internal/template-text/certificates');
const { replaceAtomically } = require('../internal/template-text/storage');
const { LOCK_NAME, acquireLock } = require('../internal/unwrap-lock');

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);
const text = (...rows) => rows.join(LF) + LF;
const headingHash = title => sha256(title.trim().toLowerCase().replace(/\.$/, ''));

function project(t) {
  const parent = path.resolve(__dirname, '../.tmp/setup-template-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.nightshift'));
  spawnSync('git', ['init', '--quiet'], { cwd: root });

  return fs.realpathSync.native(root);
}

const write = (root, file, content) => fs.writeFileSync(path.join(root, '.nightshift', file), content);
const read = (root, file) => fs.readFileSync(path.join(root, '.nightshift', file), 'utf8');

// The bundled templates, with given files replaced and a given retired list.
function context({ templates = {}, retired = {} } = {}) {
  const models = loadTemplates();
  for (const [file, content] of Object.entries(templates)) models.set(file, templateModel(content));
  const lists = new Map(BACKLOG_FILES.map(file => [file, { blocks: new Set(retired[file]?.blocks ?? []), headings: new Set(retired[file]?.headings ?? []) }]));

  return { templates: models, retired: lists };
}

const QUICK_TEMPLATE = text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## (add sections as work emerges)', '', 'Nothing tracked yet.', '', '## History', '', 'History guidance.');
const quickContext = (retired = {}) => context({ templates: { 'QUICK_WINS.md': QUICK_TEMPLATE }, retired: { 'QUICK_WINS.md': retired } });
const run = (root, decisions, ctx) => adjudicate(root, validateDecisions(decisions, ctx), { context: ctx });
const inspect = (root, ctx) => inspectTemplates(root, { context: ctx });
const fileReport = (report, file) => report.files.find(entry => entry.file === file);

// A run store holding one retirement certificate that tracks the given destinations, as boundDestinations reads it.
function seedCertificates(root, destinations) {
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.join(root, '.nightshift', 'runs'), { recursive: true });
  const database = new DatabaseSync(path.join(root, '.nightshift', 'runs', 'state.sqlite'));
  try {
    database.exec('CREATE TABLE legacy_retirements (run_id TEXT PRIMARY KEY, artifact TEXT NOT NULL); CREATE TABLE artifacts (id TEXT PRIMARY KEY, body TEXT NOT NULL);');
    const body = JSON.stringify({ followups: destinations.map(destination => ({ disposition: 'tracked', destination })) });
    database.prepare('INSERT INTO artifacts VALUES (?, ?)').run(sha256(body), body);
    database.prepare('INSERT INTO legacy_retirements VALUES (?, ?)').run('run-1', sha256(body));
  } finally { database.close(); }
}

// Binds a destination as a certificate does, then checks after apply that no template edit changed its value.
function bindDestination(root, destination) {
  const bound = targetEntry(root, destination);
  seedCertificates(root, [bound]);

  return () => assert.deepEqual(targetEntry(root, destination), bound, 'apply left the bound destination unchanged');
}

test('a fresh setup scaffolds the templates and presents no difference, also on a rerun', t => {
  const root = project(t);
  const first = initialize(root);
  assert.deepEqual(first.templates.decisions, []);
  for (const file of first.templates.files) assert.deepEqual(file.pendingDifferences, []);
  assert.equal(fs.existsSync(path.join(root, '.nightshift', LOCK_NAME)), false, 'nothing to adjudicate creates no lock file');
  const report = inspectTemplates(root);
  assert.ok(report.files.every(file => file.count === 0));
});

test('a missing preamble block is presented after the title and inserted on decision, idempotently', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  const presented = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences;
  assert.equal(presented.length, 1);
  assert.equal(presented[0].kind, 'missing-block');
  assert.equal(presented[0].text, 'Second guidance.');
  assert.deepEqual(presented[0].insertion, { after: 'Intro guidance.', line: 3 });
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: presented[0].templateHash, action: 'insert' }], ctx);
  assert.equal(result.decisions[0].outcome, 'applied');
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.'));
  assert.equal(fileReport(inspect(root, ctx), 'QUICK_WINS.md').count, 0);
});

test('CRLF files keep CRLF, and a file mixing endings gets no edit', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', ['# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.', ''].join(CRLF));
  const hash = sha256('Second guidance.');
  run(root, [{ file: 'QUICK_WINS.md', templateHash: hash, action: 'insert' }], ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), ['# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.', ''].join(CRLF));
  write(root, 'QUICK_WINS.md', `# Quick wins${CRLF}${LF}Intro guidance.${LF}`);
  const mixed = run(root, [{ file: 'QUICK_WINS.md', templateHash: hash, action: 'insert' }], ctx);
  assert.equal(mixed.decisions[0].reason, 'ambiguous-newline');
  assert.equal(read(root, 'QUICK_WINS.md'), `# Quick wins${CRLF}${LF}Intro guidance.${LF}`);
});

test('no decision changes nothing and leaves the difference pending', t => {
  const root = project(t);
  const ctx = quickContext();
  const original = text('# Quick wins', '', 'Intro guidance.');
  write(root, 'QUICK_WINS.md', original);
  const result = run(root, [], ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), original);
  assert.equal(fileReport(result, 'QUICK_WINS.md').pendingDifferences.length, 2);
  assert.equal(result.decisionsFile.written, false);
  assert.equal(fs.existsSync(path.join(root, '.nightshift', LOCK_NAME)), false);
});

test('a keep is remembered, presented again only when its template text changes, and kept as an inert record', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  const hash = sha256('Second guidance.');
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: hash, action: 'keep' }], ctx);
  assert.equal(result.decisionsFile.written, true);
  assert.deepEqual(JSON.parse(read(root, 'template-decisions.json')), { schema: 1, kept: [{ file: 'QUICK_WINS.md', templateHash: hash }] });
  const again = fileReport(inspect(root, ctx), 'QUICK_WINS.md');
  assert.equal(again.count, 0);
  assert.deepEqual(again.kept, [hash]);
  const changed = context({ templates: { 'QUICK_WINS.md': QUICK_TEMPLATE.replace('Second guidance.', 'Second guidance, revised.') } });
  const report = inspect(root, changed);
  assert.equal(fileReport(report, 'QUICK_WINS.md').count, 1);
  assert.deepEqual(report.inertKeeps, [`QUICK_WINS.md:${hash}`]);
  run(root, [], changed);
  assert.deepEqual(JSON.parse(read(root, 'template-decisions.json')).kept, [{ file: 'QUICK_WINS.md', templateHash: hash }]);
});

test('a malformed decisions file is reported without differences and refuses apply before any write', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins'));
  write(root, 'template-decisions.json', '{"schema": 1, "kept": [{"file": "NOTES.md", "templateHash": "x"}]}');
  const report = inspect(root, ctx);
  assert.equal(report.decisionsFile.status, 'unreadable');
  assert.equal(fileReport(report, 'QUICK_WINS.md').differences, undefined);
  assert.ok(fileReport(report, 'QUICK_WINS.md').count > 0);
  assert.throws(() => initialize(root), error => error.code === 'template-decisions-unreadable');
});

test('a decisions file is read as a set and rewritten canonically at the next write', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins'));
  const first = sha256('Second guidance.');
  const second = sha256('Intro guidance.');
  write(root, 'template-decisions.json', JSON.stringify({ schema: 1, kept: [{ file: 'QUICK_WINS.md', templateHash: first }, { file: 'QUICK_WINS.md', templateHash: first }] }));
  run(root, [{ file: 'QUICK_WINS.md', templateHash: second, action: 'keep' }], ctx);
  assert.deepEqual(JSON.parse(read(root, 'template-decisions.json')).kept, [first, second].sort().map(templateHash => ({ file: 'QUICK_WINS.md', templateHash })));
});

test('a replace puts template text at the candidate, quoting what it replaced', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance, old wording.', '', '## History', '', 'History guidance.'));
  const difference = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences[0];
  assert.equal(difference.candidates.length, 1);
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: difference.templateHash, action: 'replace', replaces: difference.candidates[0].hash }], ctx);
  assert.equal(result.decisions[0].replacedText, 'Second guidance, old wording.');
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.'));
});

test('a replace consumes a retired candidate, reported applied through it and no longer pending, unless a remove names it', t => {
  const root = project(t);
  const old = 'Second guidance, retired wording.';
  const ctx = quickContext({ blocks: [sha256(old)] });
  const outdated = text('# Quick wins', '', 'Intro guidance.', '', old, '', '## History', '', 'History guidance.');
  write(root, 'QUICK_WINS.md', outdated);
  const presented = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences;
  assert.deepEqual(presented.map(difference => difference.kind).sort(), ['missing-block', 'retired-block']);
  const missing = presented.find(difference => difference.kind === 'missing-block');
  const replace = { file: 'QUICK_WINS.md', templateHash: missing.templateHash, action: 'replace', replaces: sha256(old) };
  const result = run(root, [replace], ctx);
  assert.equal(result.decisions[0].outcome, 'applied');
  assert.deepEqual(result.decisions[0].through, [{ kind: 'retired-block', templateHash: sha256(old) }]);
  assert.deepEqual(fileReport(result, 'QUICK_WINS.md').pendingDifferences, []);
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.'));
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', old, '', '## History', '', 'History guidance.', '', old));
  const both = run(root, [replace, { file: 'QUICK_WINS.md', templateHash: sha256(old), action: 'remove' }], ctx);
  assert.deepEqual(both.decisions.map(decision => [decision.outcome, decision.through]), [['applied', []], ['applied', []]]);
  assert.deepEqual(fileReport(both, 'QUICK_WINS.md').pendingDifferences, []);
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.'));
});

test('a missing section goes before the first section after the template entry slot, and at the end when none follows', t => {
  const root = project(t);
  const bugs = text('# Bugs', '', 'Bug guidance.', '', '## Requires lines', '', 'Requires guidance.', '', '## Open', '', 'Nothing currently tracked.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'BUGS.md': bugs } });
  write(root, 'BUGS.md', text('# Bugs', '', 'Bug guidance.', '', '## Current', '', '### A bug', '', 'Body.', '', '**Requires:** none.', '', '## History', '', 'History guidance.'));
  const presented = fileReport(inspect(root, ctx), 'BUGS.md').differences;
  assert.deepEqual(presented.map(difference => [difference.kind, difference.insertion]), [['missing-section', { before: '## Current', line: 5 }]]);
  run(root, [{ file: 'BUGS.md', templateHash: presented[0].templateHash, action: 'insert' }], ctx);
  assert.equal(read(root, 'BUGS.md'), text('# Bugs', '', 'Bug guidance.', '', '## Requires lines', '', 'Requires guidance.', '', '## Current', '', '### A bug', '', 'Body.', '', '**Requires:** none.', '', '## History', '', 'History guidance.'));
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## Themed', '', '- [A quick win](x.md)'));
  const quick = fileReport(inspect(root, quickContext()), 'QUICK_WINS.md').differences;
  assert.deepEqual(quick[0].insertion, { atEnd: true });
});

test('a tight template list stays tight when inserted', t => {
  const root = project(t);
  const template = text('# Quick wins', '', 'Intro guidance.', '', '- First rule.', '- Second rule.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'QUICK_WINS.md': template } });
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  const decisions = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences.map(difference => ({ file: 'QUICK_WINS.md', templateHash: difference.templateHash, action: 'insert' }));
  run(root, decisions, ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), template);
});

test('retired text is presented for removal, removed or kept, and a duplicate is covered once', t => {
  const root = project(t);
  const old = 'Old guidance a template dropped.';
  const ctx = quickContext({ blocks: [sha256(old)] });
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', old, '', '## History', '', 'History guidance.', '', old));
  const retired = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences;
  assert.equal(retired.length, 1);
  assert.equal(retired[0].kind, 'retired-block');
  assert.equal(retired[0].occurrences.length, 2);
  run(root, [{ file: 'QUICK_WINS.md', templateHash: retired[0].templateHash, action: 'remove' }], ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.'));
});

test('a retired section is removable only without entries, and renames in place into its replacement when Ready classifies both alike', t => {
  const root = project(t);
  const template = text('# Features', '', 'Intro.', '', '## Current work', '', 'Work guidance.', '', '## Exploring', '', 'Drafts guidance.', '', 'Nothing being explored yet.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'FEATURES.md': template }, retired: { 'FEATURES.md': { headings: [headingHash('Work'), headingHash('Drafts')], blocks: [sha256('Old work guidance.')] } } });
  const entry = ['### [An item](features/a.md)', '', 'Body.', '', '**Requires:** none.'];
  write(root, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Work', '', 'Work guidance.', '', 'Old work guidance.', '', ...entry, '', '## Drafts', '', 'Drafts guidance.', '', '### [A draft](features/b.md)', '', 'Draft body.', '', '## History', '', 'History guidance.'));
  const presented = fileReport(inspect(root, ctx), 'FEATURES.md').differences;
  const work = presented.find(difference => difference.kind === 'missing-section' && difference.heading === '## Current work');
  const exploring = presented.find(difference => difference.kind === 'missing-section' && difference.heading === '## Exploring');
  const retiredWork = presented.find(difference => difference.kind === 'retired-section' && difference.section === '## Work');
  const retiredBlock = presented.find(difference => difference.kind === 'retired-block');
  assert.equal(retiredWork.removable, false);
  assert.equal(retiredWork.reason, 'has-entries');
  assert.equal(work.rename.heading, '## Work');
  assert.equal(exploring.rename, null, 'a work section with entries is not renamed into a drafts section');
  const result = run(root, [
    { file: 'FEATURES.md', templateHash: work.templateHash, action: 'replace', replaces: work.rename.hash },
    { file: 'FEATURES.md', templateHash: retiredBlock.templateHash, action: 'remove' },
  ], ctx);
  assert.deepEqual(result.decisions.map(decision => decision.outcome), ['applied', 'applied']);
  assert.equal(result.decisions[0].renamedHeading, '## Work');
  assert.deepEqual(result.decisions[0].through, [{ kind: 'retired-section', templateHash: headingHash('Work') }]);
  assert.equal(fileReport(result, 'FEATURES.md').pendingDifferences.includes(headingHash('Work')), false);
  assert.match(read(root, 'FEATURES.md'), new RegExp(['## Current work', '', 'Work guidance.', '', '### \\[An item\\]'].join(LF)));
});

test('a removable retired section is removed with its retired text and placeholders', t => {
  const root = project(t);
  const ctx = quickContext({ headings: [headingHash('Old notes')], blocks: [sha256('Old notes guidance.')] });
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## Old notes', '', 'Old notes guidance.', '', 'Nothing yet.', '', '## History', '', 'History guidance.'));
  const section = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences.find(difference => difference.kind === 'retired-section');
  assert.equal(section.removable, true);
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: section.templateHash, action: 'remove' }], ctx);
  assert.deepEqual(result.decisions[0].through, [{ kind: 'retired-block', templateHash: sha256('Old notes guidance.') }]);
  assert.deepEqual(fileReport(result, 'QUICK_WINS.md').pendingDifferences, []);
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.'));
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## Old notes', '', 'Old notes guidance.', '', '## History', '', 'History guidance.'));
  const kept = run(root, [{ file: 'QUICK_WINS.md', templateHash: section.templateHash, action: 'remove' }, { file: 'QUICK_WINS.md', templateHash: sha256('Old notes guidance.'), action: 'keep' }], ctx);
  assert.equal(kept.decisions[0].reason, 'not-removable');
  assert.equal(kept.decisions[1].outcome, 'kept');
  const remembered = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences.find(difference => difference.kind === 'retired-section');
  assert.deepEqual([remembered.removable, remembered.reason], [false, 'holds-kept-block']);
});

test('stale and already applied decisions are reported without refusing the run', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.'));
  const result = run(root, [
    { file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' },
    { file: 'QUICK_WINS.md', templateHash: sha256('History guidance.'), action: 'insert' },
  ], ctx);
  assert.equal(result.decisions[0].outcome, 'applied');
  assert.equal(result.decisions[0].already, true);
  assert.equal(result.decisions[1].reason, 'template-text-stale');
});

test('malformed, duplicate, ill-fitting and contradictory decisions are refused before any write', t => {
  const root = project(t);
  const ctx = quickContext({ blocks: [sha256('Old.')] });
  const hash = sha256('Second guidance.');
  const refused = decisions => assert.throws(() => validateDecisions(decisions, ctx), error => error.code === 'invalid-template-decisions');
  refused([{ file: 'NOTES.md', templateHash: hash, action: 'insert' }]);
  refused([{ file: 'QUICK_WINS.md', templateHash: hash, action: 'insert', replaces: hash }]);
  refused([{ file: 'QUICK_WINS.md', templateHash: hash, action: 'insert' }, { file: 'QUICK_WINS.md', templateHash: hash, action: 'keep' }]);
  refused([{ file: 'QUICK_WINS.md', templateHash: sha256('Old.'), action: 'insert' }]);
  refused([{ file: 'QUICK_WINS.md', templateHash: hash, action: 'remove' }]);
  refused([{ file: 'QUICK_WINS.md', templateHash: sha256('Not in any template.'), action: 'keep' }]);
  write(root, 'QUICK_WINS.md', text('# Quick wins'));
  assert.throws(() => initialize(root, { templateDecisions: [{ file: 'QUICK_WINS.md', templateHash: 'xyz', action: 'insert' }] }), error => error.code === 'invalid-template-decisions');
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins'));
  assert.equal(fs.existsSync(path.join(root, '.nightshift', 'FEATURES.md')), false);
});

test('an unreadable index presents nothing and holds its decisions', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', '```', 'never closed'));
  assert.equal(fileReport(inspect(root, ctx), 'QUICK_WINS.md').unreadable, 'unclosed-fence');
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' }], ctx);
  assert.equal(result.decisions[0].reason, 'template-text-unreadable');
});

test('entries are never compared, and quick-win bullets in a themed section are entries', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## Themed', '', '- History guidance.', '', '## History', '', 'History guidance.'));
  assert.equal(fileReport(inspect(root, ctx), 'QUICK_WINS.md').count, 0);
  write(root, 'BUGS.md', text('# Bugs', '', '## Current', '', '### A bug', '', '  ## Requires lines', '', 'Setext paragraph', '---', '', '**Requires:** none.'));
  const bugs = text('# Bugs', '', '## Requires lines', '', 'Requires guidance.', '', '## History', '', 'History guidance.');
  const bugContext = context({ templates: { 'BUGS.md': bugs } });
  const differences = fileReport(inspect(root, bugContext), 'BUGS.md').differences;
  assert.ok(differences.some(difference => difference.kind === 'missing-section' && difference.heading === '## Requires lines'));
  run(root, differences.map(difference => ({ file: 'BUGS.md', templateHash: difference.templateHash, action: 'insert' })), bugContext);
  assert.match(read(root, 'BUGS.md'), /### A bug\n\n {2}## Requires lines\n\nSetext paragraph\n---\n\n\*\*Requires:\*\* none\./);
});

test('the entries check refuses a plan that moves an entry or adds a structural error', () => {
  const before = text('## Area', '', '### [Item](features/item.md)', '', '**Requires:** none.');
  assert.equal(entriesProblem('FEATURES.md', before, before), null);
  assert.match(entriesProblem('FEATURES.md', before, text('## Other area', '', '### [Item](features/item.md)', '', '**Requires:** none.')), /moves entry/);
  assert.notEqual(entriesProblem('FEATURES.md', before, text('## Slicing', '', '### [Item](features/item.md)', '', '**Requires:** none.')), null, 'an entry moved into an excluded section is refused');
  assert.equal(entriesProblem('FEATURES.md', before, text('## Renamed', '', '### [Item](features/item.md)', '', '**Requires:** none.'), new Map([['area', 'renamed']])), null);
  assert.match(entriesProblem('FEATURES.md', before, text('## Area', '', '### [Item](features/item.md)')), /structural error/);
});

test('the certificate guard charges an anchored destination to its own file and ignores one already stale', t => {
  const root = project(t);
  write(root, 'FEATURES.md', text('# Features', '', '## Area', '', '### [Item](features/item.md)', '', '**Requires:** none.'));
  const { targetEntry } = require('../internal/runtime/legacy-backlog');
  const bound = targetEntry(root, { path: '.nightshift/FEATURES.md', anchor: 'area' });
  const planned = new Map([['.nightshift/FEATURES.md', Buffer.from(text('# Features', '', '## Area', '', 'Inserted guidance.', '', '### [Item](features/item.md)', '', '**Requires:** none.'))]]);
  assert.deepEqual(plannedChanges(root, [bound], planned).changed.map(change => change.files), [['.nightshift/FEATURES.md']]);
  const stale = { ...bound, entryHash: sha256('something else') };
  assert.deepEqual(plannedChanges(root, [stale], planned), { changed: [], stale: [stale] });
});

test('leftover temporary files are reported and removed under the lock, and a held lock refuses apply as busy', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins'));
  const leftover = path.join(root, '.nightshift', '.QUICK_WINS.md.nightshift-template-00000000-0000-0000-0000-000000000000.tmp');
  fs.writeFileSync(leftover, 'partial');
  assert.equal(inspect(root, ctx).leftovers.length, 1);
  const result = run(root, [], ctx);
  assert.deepEqual(result.leftoversRemoved, ['.nightshift/.QUICK_WINS.md.nightshift-template-00000000-0000-0000-0000-000000000000.tmp']);
  const lock = acquireLock(path.join(root, '.nightshift'));
  try { assert.throws(() => run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Intro guidance.'), action: 'keep' }], ctx), error => error.code === 'unwrap-busy'); }
  finally { lock.close(); }
});

test('only an apply that can write takes the unwrap lock, naming the file it creates, so a lock copied from another clone fails only such an apply', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', '## History', '', 'History guidance.'));
  const keep = [{ file: 'QUICK_WINS.md', templateHash: sha256('Intro guidance.'), action: 'keep' }];
  const first = run(root, keep, ctx);
  assert.deepEqual(first.lockFile, { path: `.nightshift/${LOCK_NAME}`, created: true });
  assert.deepEqual(run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'keep' }], ctx).lockFile, { path: `.nightshift/${LOCK_NAME}`, created: false });
  const foreign = project(t);
  write(foreign, 'QUICK_WINS.md', text('# Quick wins', '', '## History', '', 'History guidance.'));
  write(foreign, LOCK_NAME, 'a lock committed from another clone');
  assert.equal(run(foreign, [], ctx).lockFile, null);
  assert.throws(() => run(foreign, keep, ctx), error => error.code === 'unwrap-lock-invalid');
  assert.equal(read(foreign, LOCK_NAME), 'a lock committed from another clone');
});

test('a leftover whose target is absent or unreadable is kept under a preserved name that later runs leave alone', t => {
  const root = project(t);
  const name = '.QUICK_WINS.md.nightshift-template-00000000-0000-0000-0000-000000000001.tmp';
  const preservedName = '.QUICK_WINS.md.nightshift-preserved-00000000-0000-0000-0000-000000000001.tmp';
  const content = 'the only copy of an earlier quick-wins file';
  fs.writeFileSync(path.join(root, '.nightshift', name), content);
  assert.deepEqual(inspectTemplates(root).leftovers.map(entry => [entry.target, entry.targetState, entry.safeToDelete]), [['QUICK_WINS.md', 'absent', false]]);
  const scaffolded = initialize(root);
  assert.deepEqual(scaffolded.templates.leftoversKept, [{ path: `.nightshift/${preservedName}`, from: `.nightshift/${name}`, target: 'QUICK_WINS.md', reason: 'absent' }]);
  assert.deepEqual(scaffolded.templates.leftoversRemoved, []);
  initialize(root);
  const again = inspectTemplates(root);
  assert.deepEqual([again.leftovers, again.preserved.map(entry => [entry.path, entry.target])], [[], [[`.nightshift/${preservedName}`, 'QUICK_WINS.md']]]);
  assert.equal(read(root, preservedName), content);
  const damaged = project(t);
  fs.writeFileSync(path.join(damaged, '.nightshift', 'QUICK_WINS.md'), Buffer.from([0x23, 0x20, 0xff]));
  fs.writeFileSync(path.join(damaged, '.nightshift', name), 'planned output');
  const kept = run(damaged, [], quickContext());
  assert.deepEqual([kept.leftoversKept.map(entry => entry.reason), kept.leftoversRemoved, kept.preserved.map(entry => entry.path)], [['unreadable'], [], [`.nightshift/${preservedName}`]]);
  assert.equal(read(damaged, preservedName), 'planned output');
});

test('a lock failure before an unsafe leftover is preserved stops setup before it scaffolds the target, and a rerun preserves it', t => {
  const name = '.QUICK_WINS.md.nightshift-template-00000000-0000-0000-0000-000000000002.tmp';
  const preservedName = '.QUICK_WINS.md.nightshift-preserved-00000000-0000-0000-0000-000000000002.tmp';
  const target = root => path.join(root, '.nightshift', 'QUICK_WINS.md');
  const busy = project(t);
  fs.writeFileSync(path.join(busy, '.nightshift', name), 'earlier content');
  const lock = acquireLock(path.join(busy, '.nightshift'));
  try { assert.throws(() => initialize(busy), error => error.code === 'unwrap-busy'); }
  finally { lock.close(); }
  assert.deepEqual([fs.existsSync(target(busy)), fs.existsSync(path.join(busy, '.nightshift', name))], [false, true]);
  assert.deepEqual(initialize(busy).templates.leftoversKept.map(entry => entry.path), [`.nightshift/${preservedName}`]);
  const foreign = project(t);
  fs.writeFileSync(path.join(foreign, '.nightshift', name), 'earlier content');
  write(foreign, LOCK_NAME, 'a lock committed from another clone');
  assert.throws(() => initialize(foreign), error => error.code === 'unwrap-lock-invalid');
  assert.equal(fs.existsSync(target(foreign)), false);
  fs.rmSync(path.join(foreign, '.nightshift', LOCK_NAME));
  initialize(foreign);
  assert.equal(read(foreign, preservedName), 'earlier content');
});

test('inspect does not judge a keep of an unreadable file inert', t => {
  const root = project(t);
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.'));
  fs.writeFileSync(path.join(root, '.nightshift', 'BUGS.md'), Buffer.from([0x23, 0x20, 0xff]));
  write(root, 'template-decisions.json', JSON.stringify({ schema: 1, kept: [{ file: 'BUGS.md', templateHash: sha256('Bug guidance.') }, { file: 'QUICK_WINS.md', templateHash: sha256('Gone guidance.') }] }));
  assert.deepEqual(inspect(root, quickContext()).inertKeeps, [`QUICK_WINS.md:${sha256('Gone guidance.')}`]);
});

test('a replacement refuses to overwrite a file that changed after its differences were computed', t => {
  const root = project(t);
  write(root, 'QUICK_WINS.md', text('# Quick wins'));
  assert.throws(() => replaceAtomically(root, '.nightshift/QUICK_WINS.md', Buffer.from('new'), Buffer.from('old')), error => error.code === 'template-text-drift');
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins'));
});

test('a legacy migration presents the relocated backlog differences after relocation', t => {
  const root = project(t);
  fs.rmSync(path.join(root, '.nightshift'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude', 'QUICK_WINS.md'), text('# Quick wins', '', '## Current', '', '### A quick win', '', 'Body.'));
  const result = initialize(root);
  assert.ok(result.templates.files.find(file => file.file === 'QUICK_WINS.md').pendingDifferences.length > 0);
});

test('a backlog Ready rejects holds every non-keep decision with backlog-invalid and still records its keeps', t => {
  const root = project(t);
  const ctx = quickContext();
  const original = text('# Quick wins', '', '## History', '', 'History guidance.');
  write(root, 'QUICK_WINS.md', original);
  const decisions = validateDecisions([{ file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' }, { file: 'QUICK_WINS.md', templateHash: sha256('Intro guidance.'), action: 'keep' }], ctx);
  const broken = adjudicate(root, decisions, { context: ctx, validate: () => ({ ok: true, report: { structuralErrors: [{ message: 'broken entry' }] } }) });
  assert.deepEqual(broken.decisions.map(decision => [decision.outcome, decision.reason]), [['pending', 'backlog-invalid'], ['kept', undefined]]);
  assert.equal(broken.decisionsFile.written, true);
  assert.equal(read(root, 'QUICK_WINS.md'), original);
  const failed = adjudicate(root, decisions.slice(0, 1), { context: ctx, validate: () => ({ ok: false, error: 'invalid-utf8' }) });
  assert.equal(failed.decisions[0].reason, 'backlog-invalid');
  assert.equal(read(root, 'QUICK_WINS.md'), original);
});

test('inspect reports the Ready parser structural errors of the current backlog', t => {
  const root = project(t);
  write(root, 'FEATURES.md', text('# Features', '', '## Area', '', '### [Item](features/item.md)', '', 'No requires line.'));
  const report = inspectTemplates(root, { validate: () => currentBacklogStatus(root) });
  assert.equal(report.ready.ok, true);
  assert.ok(report.ready.structuralErrors.length > 0);
});

test('an unreadable certificate store holds edits to the four active indexes only', t => {
  const root = project(t);
  const history = text('# Quick wins history', '', 'History intro.', '', '## Entries');
  const ctx = context({ templates: { 'QUICK_WINS.md': QUICK_TEMPLATE, 'QUICK_WINS_HISTORY.md': history } });
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  write(root, 'QUICK_WINS_HISTORY.md', text('# Quick wins history', '', '## Entries'));
  fs.mkdirSync(path.join(root, '.nightshift', 'runs'));
  fs.writeFileSync(path.join(root, '.nightshift', 'runs', 'state.sqlite'), 'not a database');
  const report = inspect(root, ctx);
  assert.equal(report.certificates.status, 'unverifiable');
  assert.deepEqual(fileReport(report, 'QUICK_WINS.md').holds, [{ reason: 'certificate-unverifiable' }]);
  assert.deepEqual(fileReport(report, 'QUICK_WINS_HISTORY.md').holds, []);
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' }, { file: 'QUICK_WINS_HISTORY.md', templateHash: sha256('History intro.'), action: 'insert' }], ctx);
  assert.deepEqual(result.decisions.map(decision => decision.reason ?? decision.outcome), ['certificate-unverifiable', 'applied']);
  assert.equal(read(root, 'QUICK_WINS_HISTORY.md'), history);
});

test('a pending unwrap recovery record holds its file with unwrap-recovery-pending', t => {
  const root = project(t);
  const ctx = quickContext();
  const original = text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.');
  write(root, 'QUICK_WINS.md', original);
  write(root, 'QUICK_WINS.md' + RECOVERY_SUFFIX, '{}');
  assert.deepEqual(fileReport(inspect(root, ctx), 'QUICK_WINS.md').holds, [{ reason: 'unwrap-recovery-pending' }]);
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' }], ctx);
  assert.equal(result.decisions[0].reason, 'unwrap-recovery-pending');
  assert.equal(read(root, 'QUICK_WINS.md'), original);
});

test('template text that would become an entry where it is placed is held as unplaceable', t => {
  const root = project(t);
  const ctx = context({ templates: { 'QUICK_WINS.md': text('# Quick wins', '', 'Intro guidance.', '', '## Current', '', '- A guidance bullet.', '', '## History', '', 'History guidance.') } });
  const original = text('# Quick wins', '', 'Intro guidance.', '', '## Current', '', '- [A quick win](x.md)', '', '## History', '', 'History guidance.');
  write(root, 'QUICK_WINS.md', original);
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('- A guidance bullet.'), action: 'insert' }], ctx);
  assert.equal(result.decisions[0].reason, 'template-text-unplaceable');
  assert.equal(read(root, 'QUICK_WINS.md'), original);
});

test('a destination anchored on a level-two or level-one heading holds its own file, while keeps are recorded and other files proceed', t => {
  const root = project(t);
  const ctx = context({ templates: { 'FEATURES.md': text('# Features', '', 'Intro.', '', '## Area', '', 'Area guidance.', '', '## History', '', 'History guidance.'), 'QUICK_WINS.md': QUICK_TEMPLATE } });
  const original = text('# Features', '', '## Area', '', '### [Item](features/item.md)', '', '**Requires:** none.', '', '## History', '', 'History guidance.');
  write(root, 'FEATURES.md', original);
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  const unchanged = bindDestination(root, { path: '.nightshift/FEATURES.md', anchor: 'area' });
  const area = fileReport(inspect(root, ctx), 'FEATURES.md').differences.find(difference => difference.text === 'Area guidance.');
  assert.equal(area.certificateBound.length, 1);
  const result = run(root, [
    { file: 'FEATURES.md', templateHash: sha256('Area guidance.'), action: 'insert' },
    { file: 'FEATURES.md', templateHash: sha256('Intro.'), action: 'keep' },
    { file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' },
  ], ctx);
  assert.deepEqual(result.decisions.map(decision => decision.reason ?? decision.outcome), ['certificate-bound', 'kept', 'applied']);
  assert.equal(result.decisions[0].destinations[0].anchor, 'area');
  assert.equal(result.decisionsFile.written, true);
  assert.equal(read(root, 'FEATURES.md'), original);
  unchanged();
  const titled = project(t);
  write(titled, 'FEATURES.md', original);
  const titleUnchanged = bindDestination(titled, { path: '.nightshift/FEATURES.md', anchor: 'features' });
  assert.equal(run(titled, [{ file: 'FEATURES.md', templateHash: sha256('Intro.'), action: 'insert' }], ctx).decisions[0].reason, 'certificate-bound');
  titleUnchanged();
});

test('an inserted heading that would renumber a later duplicate anchor holds its file', t => {
  const root = project(t);
  const ctx = context({ templates: { 'BUGS.md': text('# Bugs', '', 'Bug guidance.', '', '## Requires lines', '', 'Requires guidance.', '', '## Open', '', 'Nothing currently tracked.', '', '## History', '', 'History guidance.') } });
  const original = text('# Bugs', '', 'Bug guidance.', '', '## Open', '', '### Requires lines', '', 'A bug titled like the section.', '', '**Requires:** none.', '', '## History', '', 'History guidance.');
  write(root, 'BUGS.md', original);
  const unchanged = bindDestination(root, { path: '.nightshift/BUGS.md', anchor: 'requires-lines' });
  const section = fileReport(inspect(root, ctx), 'BUGS.md').differences.find(difference => difference.kind === 'missing-section');
  const result = run(root, [{ file: 'BUGS.md', templateHash: section.templateHash, action: 'insert' }], ctx);
  assert.equal(result.decisions[0].reason, 'certificate-bound');
  assert.equal(read(root, 'BUGS.md'), original);
  unchanged();
});

test('a last entry before an appended section keeps its bound value, with and without a final line break', t => {
  const ctx = context({ templates: { 'BUGS.md': text('# Bugs', '', 'Bug guidance.', '', '## Open', '', 'Nothing currently tracked.', '', '## History', '', 'History guidance.') } });
  for (const ending of [LF, '']) {
    const root = project(t);
    write(root, 'BUGS.md', ['# Bugs', '', 'Bug guidance.', '', '## Open', '', '### A bug', '', 'Body.', '', '**Requires:** none.'].join(LF) + ending);
    const unchanged = bindDestination(root, { path: '.nightshift/BUGS.md', anchor: 'a-bug' });
    const section = fileReport(inspect(root, ctx), 'BUGS.md').differences.find(difference => difference.kind === 'missing-section');
    const outcome = run(root, [{ file: 'BUGS.md', templateHash: section.templateHash, action: 'insert' }], ctx).decisions[0];
    assert.ok(outcome.outcome === 'applied' || outcome.reason === 'certificate-bound', JSON.stringify(outcome));
    unchanged();
  }
});

test('a replace removing the only index link to a bound breakout record holds all four active indexes', t => {
  const root = project(t);
  const ctx = context({ templates: { 'FEATURES.md': text('# Features', '', 'Intro.', '', '## History', '', 'History guidance.'), 'QUICK_WINS.md': QUICK_TEMPLATE } });
  fs.mkdirSync(path.join(root, '.nightshift', 'features'));
  fs.writeFileSync(path.join(root, '.nightshift', 'features', 'item.md'), text('# Item', '', 'A breakout record.'));
  const original = text('# Features', '', 'Intro, see [the item](features/item.md).', '', '## History', '', 'History guidance.');
  write(root, 'FEATURES.md', original);
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  const unchanged = bindDestination(root, { path: '.nightshift/features/item.md', anchor: null });
  const result = run(root, [
    { file: 'FEATURES.md', templateHash: sha256('Intro.'), action: 'replace', replaces: sha256('Intro, see [the item](features/item.md).') },
    { file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' },
  ], ctx);
  assert.deepEqual(result.decisions.map(decision => decision.reason), ['certificate-bound', 'certificate-bound']);
  assert.equal(read(root, 'FEATURES.md'), original);
  unchanged();
});

test('a destination already stale before the edit is reported and holds nothing', t => {
  const root = project(t);
  const ctx = context({ templates: { 'FEATURES.md': text('# Features', '', 'Intro.', '', '## Area', '', 'Area guidance.', '', '## History', '', 'History guidance.') } });
  write(root, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Area', '', '### [Item](features/item.md)', '', '**Requires:** none.', '', '## History', '', 'History guidance.'));
  const stale = { ...targetEntry(root, { path: '.nightshift/FEATURES.md', anchor: 'area' }), entryHash: sha256('an earlier state of the entry') };
  seedCertificates(root, [stale]);
  const result = run(root, [{ file: 'FEATURES.md', templateHash: sha256('Area guidance.'), action: 'insert' }], ctx);
  assert.equal(result.decisions[0].outcome, 'applied');
  assert.deepEqual(result.staleCertificates, [stale]);
});

test('a byte-order mark, front matter and a missing final line break are kept, and a file without a line break gets the template ending', t => {
  const root = project(t);
  const ctx = quickContext();
  const bom = String.fromCharCode(0xfeff);
  const insert = [{ file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' }];
  write(root, 'QUICK_WINS.md', bom + text('---', 'title: x', '---', '# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  run(root, insert, ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), bom + text('---', 'title: x', '---', '# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.'));
  write(root, 'QUICK_WINS.md', ['# Quick wins', '', 'Intro guidance.'].join(LF));
  run(root, insert, ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), ['# Quick wins', '', 'Intro guidance.', '', 'Second guidance.'].join(LF));
  write(root, 'QUICK_WINS.md', '# Quick wins');
  run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Intro guidance.'), action: 'insert' }], ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), ['# Quick wins', '', 'Intro guidance.'].join(CRLF));
});

test('an index that is not valid UTF-8 is reported unreadable and its decisions are held', t => {
  const root = project(t);
  const ctx = quickContext();
  const bytes = Buffer.concat([Buffer.from(text('# Quick wins', '', 'Intro guidance.')), Buffer.from([0xff, 0xfe])]);
  fs.writeFileSync(path.join(root, '.nightshift', 'QUICK_WINS.md'), bytes);
  assert.equal(fileReport(inspect(root, ctx), 'QUICK_WINS.md').unreadable, 'invalid-utf8');
  assert.equal(run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' }], ctx).decisions[0].reason, 'template-text-unreadable');
  assert.deepEqual(fs.readFileSync(path.join(root, '.nightshift', 'QUICK_WINS.md')), bytes);
});

test('a file that cannot be replaced is held while an earlier file is written, listed in completed with its mode kept', t => {
  const root = project(t);
  const ctx = context({ templates: { 'QUICK_WINS.md': QUICK_TEMPLATE, 'FEATURES.md': text('# Features', '', 'Intro.', '', '## History', '', 'History guidance.') } });
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  const features = text('# Features', '', '## History', '', 'History guidance.');
  write(root, 'FEATURES.md', features);
  const quickWins = path.join(root, '.nightshift', 'QUICK_WINS.md');
  const readOnly = path.join(root, '.nightshift', 'FEATURES.md');
  const mode = fs.statSync(quickWins).mode;
  fs.chmodSync(readOnly, 0o444);
  try {
    const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' }, { file: 'FEATURES.md', templateHash: sha256('Intro.'), action: 'insert' }], ctx);
    assert.deepEqual(result.decisions.map(decision => decision.reason ?? decision.outcome), ['applied', 'template-text-unwritable']);
    assert.deepEqual(result.completed, [{ kind: 'template-edit', file: '.nightshift/QUICK_WINS.md', decisions: [{ templateHash: sha256('Second guidance.'), action: 'insert' }] }]);
    assert.equal(fs.statSync(quickWins).mode, mode);
    assert.equal(read(root, 'FEATURES.md'), features);
  } finally { fs.chmodSync(readOnly, 0o666); }
});

test('a failure after adjudication lists its writes in completed', t => {
  const root = project(t);
  write(root, 'FEATURES.md', text('# Features', '', '## Area', '', '### [Item](features/item.md)', '', 'No requires line.'));
  const intro = loadTemplates().get('QUICK_WINS.md').preamble[0].hash;
  assert.throws(() => initialize(root, { templateDecisions: [{ file: 'QUICK_WINS.md', templateHash: intro, action: 'keep' }] }), error => error.completed.some(entry => entry.kind === 'template-decisions'));
  assert.deepEqual(JSON.parse(read(root, 'template-decisions.json')).kept, [{ file: 'QUICK_WINS.md', templateHash: intro }]);
});

test('a linked index is refused', t => {
  const root = project(t);
  const target = path.join(root, 'elsewhere.md');
  fs.writeFileSync(target, text('# Quick wins'));
  try { fs.symlinkSync(target, path.join(root, '.nightshift', 'QUICK_WINS.md'), 'file'); } catch (error) {
    t.skip(`symbolic links are unavailable here: ${error.code}`);

    return;
  }
  assert.throws(() => run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Intro guidance.'), action: 'insert' }], quickContext()));
  assert.equal(fs.readFileSync(target, 'utf8'), text('# Quick wins'));
});

test('a rename pair answered keep both remembers both, two qualifying candidates offer no rename, and a stale candidate or a keep of a renamed section is refused', t => {
  const root = project(t);
  const template = text('# Features', '', 'Intro.', '', '## Current work', '', 'Work guidance.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'FEATURES.md': template }, retired: { 'FEATURES.md': { headings: [headingHash('Work'), headingHash('Doing')] } } });
  write(root, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Work', '', 'Work guidance.', '', '## History', '', 'History guidance.'));
  const work = fileReport(inspect(root, ctx), 'FEATURES.md').differences.find(difference => difference.kind === 'missing-section');
  assert.deepEqual([work.rename.heading, work.rename.retired], ['## Work', true]);
  assert.throws(() => validateDecisions([
    { file: 'FEATURES.md', templateHash: work.templateHash, action: 'replace', replaces: work.rename.hash },
    { file: 'FEATURES.md', templateHash: work.rename.hash, action: 'keep' },
  ], ctx), error => error.code === 'invalid-template-decisions');
  run(root, [{ file: 'FEATURES.md', templateHash: work.templateHash, action: 'keep' }, { file: 'FEATURES.md', templateHash: work.rename.hash, action: 'keep' }], ctx);
  const again = fileReport(inspect(root, ctx), 'FEATURES.md');
  assert.equal(again.count, 0);
  assert.deepEqual(again.kept.sort(), [work.templateHash, work.rename.hash].sort());
  const two = project(t);
  write(two, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Work', '', 'Work guidance.', '', '## Doing', '', 'Work guidance.', '', '## History', '', 'History guidance.'));
  assert.equal(fileReport(inspect(two, ctx), 'FEATURES.md').differences.find(difference => difference.kind === 'missing-section').rename, null);
  const stale = project(t);
  write(stale, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Work', '', 'Work guidance.', '', '## History', '', 'History guidance.'));
  const offered = fileReport(inspect(stale, ctx), 'FEATURES.md').differences.find(difference => difference.kind === 'missing-section');
  write(stale, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Work', '', 'Work guidance.', '', 'Project notes about work.', '', '## History', '', 'History guidance.'));
  const result = run(stale, [{ file: 'FEATURES.md', templateHash: offered.templateHash, action: 'replace', replaces: offered.rename.hash }], ctx);
  assert.equal(result.decisions[0].reason, 'template-text-stale');
});

test('a missing section partly present elsewhere inserts its absent blocks, and its keep is presented again only when its own text changes', t => {
  const root = project(t);
  const bugs = text('# Bugs', '', 'Bug guidance.', '', '## Requires lines', '', 'Requires guidance.', '', 'Requires detail.', '', '## Open', '', 'Nothing currently tracked.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'BUGS.md': bugs } });
  const open = ['## Open', '', '### A bug', '', 'Body.', '', '**Requires:** none.', '', '## History', '', 'History guidance.'];
  write(root, 'BUGS.md', text('# Bugs', '', 'Bug guidance.', '', 'Requires guidance.', '', ...open));
  const section = fileReport(inspect(root, ctx), 'BUGS.md').differences.find(difference => difference.kind === 'missing-section');
  assert.deepEqual([section.text, section.presentElsewhere, section.recommendKeep], [['Requires detail.'], ['Requires guidance.'], false]);
  run(root, [{ file: 'BUGS.md', templateHash: section.templateHash, action: 'insert' }], ctx);
  assert.equal(read(root, 'BUGS.md'), text('# Bugs', '', 'Bug guidance.', '', 'Requires guidance.', '', '## Requires lines', '', 'Requires detail.', '', ...open));
  const kept = project(t);
  write(kept, 'BUGS.md', text('# Bugs', '', 'Bug guidance.', '', ...open));
  const missing = fileReport(inspect(kept, ctx), 'BUGS.md').differences.find(difference => difference.kind === 'missing-section');
  run(kept, [{ file: 'BUGS.md', templateHash: missing.templateHash, action: 'keep' }], ctx);
  const elsewhere = context({ templates: { 'BUGS.md': bugs.replace('Bug guidance.', 'Bug guidance, revised.') } });
  assert.equal(fileReport(inspect(kept, elsewhere), 'BUGS.md').differences.some(difference => difference.kind === 'missing-section'), false);
  const revised = context({ templates: { 'BUGS.md': bugs.replace('Requires detail.', 'Requires detail, revised.') } });
  assert.equal(fileReport(inspect(kept, revised), 'BUGS.md').differences.some(difference => difference.kind === 'missing-section'), true);
  const added = context({ templates: { 'BUGS.md': bugs.replace('Requires detail.', text('Requires detail.', '', 'Requires addendum.').trimEnd()) } });
  assert.equal(fileReport(inspect(kept, added), 'BUGS.md').differences.some(difference => difference.kind === 'missing-section'), true);
});

test('inserts sharing one anchor are placed in template order whatever the order of the decisions', t => {
  const root = project(t);
  const template = text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', 'Third guidance.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'QUICK_WINS.md': template } });
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', '## History', '', 'History guidance.'));
  run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Third guidance.'), action: 'insert' }, { file: 'QUICK_WINS.md', templateHash: sha256('Second guidance.'), action: 'insert' }], ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), template);
});

test('the report quotes replaced, renamed and removed text as the file held it', t => {
  const root = project(t);
  const ctx = quickContext({ blocks: [sha256('Old guidance a template dropped.')] });
  const wrapped = ['Second guidance, old ', '  wording.'];
  write(root, 'QUICK_WINS.md', ['# Quick wins', '', 'Intro guidance.', '', ...wrapped, '', 'Old guidance', 'a template dropped.', '', '## History', '', 'History guidance.', ''].join(CRLF));
  const replaced = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences.find(difference => difference.kind === 'missing-block');
  const result = run(root, [
    { file: 'QUICK_WINS.md', templateHash: replaced.templateHash, action: 'replace', replaces: replaced.candidates[0].hash },
    { file: 'QUICK_WINS.md', templateHash: sha256('Old guidance a template dropped.'), action: 'remove' },
  ], ctx);
  assert.equal(result.decisions[0].replacedText, wrapped.join(CRLF));
  assert.equal(result.decisions[1].removedText, ['Old guidance', 'a template dropped.'].join(CRLF));
  assert.equal(read(root, 'QUICK_WINS.md'), ['# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## History', '', 'History guidance.', ''].join(CRLF));
  const section = project(t);
  const sectionContext = quickContext({ headings: [headingHash('Old notes')], blocks: [sha256('Old notes guidance.')] });
  write(section, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## Old notes', '', 'Old notes guidance.', '', 'Nothing yet.', '', '## History', '', 'History guidance.'));
  const removed = run(section, [{ file: 'QUICK_WINS.md', templateHash: headingHash('Old notes'), action: 'remove' }], sectionContext);
  assert.equal(removed.decisions[0].removedText, ['## Old notes', '', 'Old notes guidance.', '', 'Nothing yet.'].join(LF));
});

test('a second apply after a legacy migration applies decisions to the relocated backlog without migrating again', t => {
  const root = project(t);
  fs.rmSync(path.join(root, '.nightshift'), { recursive: true });
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude', 'QUICK_WINS.md'), text('# Quick wins', '', '## Current', '', '### A quick win', '', 'Body.'));
  const first = initialize(root);
  assert.ok(fileReport(first.templates, 'QUICK_WINS.md').pendingDifferences.length > 0);
  const presented = fileReport(inspectTemplates(root), 'QUICK_WINS.md').differences;
  assert.deepEqual(presented.map(difference => difference.templateHash).sort(), [...fileReport(first.templates, 'QUICK_WINS.md').pendingDifferences].sort(), 'a second inspect describes what the migrating apply reported pending');
  assert.ok(presented.every(difference => difference.text !== undefined));
  const decisions = presented.map(difference => ({ file: 'QUICK_WINS.md', templateHash: difference.templateHash, action: difference.kind.startsWith('retired') ? 'remove' : 'insert' }));
  const second = initialize(root, { templateDecisions: decisions });
  assert.equal(second.migration.status, 'complete');
  assert.deepEqual(second.templates.decisions.map(decision => decision.outcome), decisions.map(() => 'applied'));
  assert.equal(fileReport(inspectTemplates(root), 'QUICK_WINS.md').count, 0);
  assert.equal(fs.existsSync(path.join(root, '.claude', 'QUICK_WINS.md')), false);
});

test('a missing section whose guidance sits under a project heading is renamed in place, and a replace naming another heading is stale', t => {
  const root = project(t);
  const ctx = context({ templates: { 'BUGS.md': text('# Bugs', '', 'Bug guidance.', '', '## Requires lines', '', 'Requires guidance.', '', '## Open', '', 'Nothing currently tracked.', '', '## History', '', 'History guidance.') } });
  const rest = ['## Open', '', '### A bug', '', 'Body.', '', '**Requires:** none.', '', '## History', '', 'History guidance.'];
  write(root, 'BUGS.md', text('# Bugs', '', 'Bug guidance.', '', '## Our requirements', '', 'Requires guidance.', '', ...rest));
  const section = fileReport(inspect(root, ctx), 'BUGS.md').differences.find(difference => difference.kind === 'missing-section');
  assert.deepEqual([section.rename.heading, section.rename.retired], ['## Our requirements', false]);
  assert.throws(() => validateDecisions([{ file: 'BUGS.md', templateHash: section.rename.hash, action: 'keep' }], ctx), error => error.code === 'invalid-template-decisions', 'a project heading is no difference to keep');
  const keptBoth = project(t);
  write(keptBoth, 'BUGS.md', text('# Bugs', '', 'Bug guidance.', '', '## Our requirements', '', 'Requires guidance.', '', ...rest));
  run(keptBoth, [{ file: 'BUGS.md', templateHash: section.templateHash, action: 'keep' }], ctx);
  assert.equal(fileReport(inspect(keptBoth, ctx), 'BUGS.md').count, 0, 'keeping the section alone keeps both');
  const stale = run(root, [{ file: 'BUGS.md', templateHash: section.templateHash, action: 'replace', replaces: sha256('another heading') }], ctx);
  assert.equal(stale.decisions[0].reason, 'template-text-stale');
  run(root, [{ file: 'BUGS.md', templateHash: section.templateHash, action: 'replace', replaces: section.rename.hash }], ctx);
  assert.equal(read(root, 'BUGS.md'), text('# Bugs', '', 'Bug guidance.', '', '## Requires lines', '', 'Requires guidance.', '', ...rest));
  assert.equal(fileReport(inspect(root, ctx), 'BUGS.md').count, 0);
});

test('a template release that renames a heading and changes a block under it, adopted as recommended, leaves no difference and the entries under the new heading', t => {
  const root = project(t);
  const template = text('# Features', '', 'Intro.', '', '## Current work', '', 'Work guidance.', '', 'Work detail, revised.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'FEATURES.md': template }, retired: { 'FEATURES.md': { headings: [headingHash('Work')], blocks: [sha256('Work detail.')] } } });
  const entry = ['### [An item](features/a.md)', '', 'Body.', '', '**Requires:** none.'];
  write(root, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Work', '', 'Work guidance.', '', 'Work detail.', '', ...entry, '', '## History', '', 'History guidance.'));
  const presented = fileReport(inspect(root, ctx), 'FEATURES.md').differences;
  const section = presented.find(difference => difference.kind === 'missing-section');
  assert.deepEqual([section.rename.heading, section.text], ['## Work', ['Work detail, revised.']]);
  const result = run(root, [
    { file: 'FEATURES.md', templateHash: section.templateHash, action: 'replace', replaces: section.rename.hash },
    { file: 'FEATURES.md', templateHash: sha256('Work detail.'), action: 'remove' },
  ], ctx);
  assert.deepEqual(result.decisions.map(decision => decision.outcome), ['applied', 'applied']);
  assert.deepEqual(result.decisions[0].through, [{ kind: 'retired-section', templateHash: headingHash('Work') }]);
  assert.equal(read(root, 'FEATURES.md'), text('# Features', '', 'Intro.', '', '## Current work', '', 'Work guidance.', '', 'Work detail, revised.', '', ...entry, '', '## History', '', 'History guidance.'));
  assert.equal(fileReport(inspect(root, ctx), 'FEATURES.md').count, 0);
});

test('a section with no compared text is offered no rename, and a heading matches its template heading under normalization', t => {
  const root = project(t);
  const template = text('# Features', '', 'Intro.', '', '## Current work', '', 'Work guidance.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'FEATURES.md': template }, retired: { 'FEATURES.md': { headings: [headingHash('Work')] } } });
  write(root, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Work', '', '### [An item](features/a.md)', '', '**Requires:** none.', '', '## HISTORY.', '', 'History guidance.'));
  const presented = fileReport(inspect(root, ctx), 'FEATURES.md').differences;
  assert.equal(presented.find(difference => difference.kind === 'missing-section' && difference.heading === '## Current work').rename, null);
  assert.equal(presented.some(difference => difference.kind === 'missing-section' && difference.heading === '## History'), false);
});

test('a missing section whose guidance all sits elsewhere, with no rename candidate, is recommended keep', t => {
  const root = project(t);
  const ctx = context({ templates: { 'BUGS.md': text('# Bugs', '', 'Bug guidance.', '', '## Requires lines', '', 'Requires guidance.', '', '## Open', '', 'Nothing currently tracked.', '', '## History', '', 'History guidance.') } });
  write(root, 'BUGS.md', text('# Bugs', '', 'Bug guidance.', '', 'Requires guidance.', '', '## Open', '', '### A bug', '', 'Body.', '', '**Requires:** none.', '', '## History', '', 'History guidance.'));
  const section = fileReport(inspect(root, ctx), 'BUGS.md').differences.find(difference => difference.kind === 'missing-section');
  assert.deepEqual([section.text, section.presentElsewhere, section.rename, section.recommendKeep], [[], ['Requires guidance.'], null, true]);
});

test('container headings are not compared, and missing sections are placed consecutively by template order counting containers', t => {
  const root = project(t);
  const template = text('# Features', '', 'Intro.', '', '## Alpha', '', 'Alpha guidance.', '', '## Beta', '', 'Beta guidance.', '', '## Container', '', '## Gamma', '', 'Gamma guidance.', '', '## History', '', 'History guidance.');
  const ctx = context({ templates: { 'FEATURES.md': template } });
  const entry = ['### [Item](features/item.md)', '', '**Requires:** none.'];
  write(root, 'FEATURES.md', text('# Features', '', 'Intro.', '', '## Project', '', ...entry, '', '## History', '', 'History guidance.'));
  const presented = fileReport(inspect(root, ctx), 'FEATURES.md').differences;
  assert.deepEqual(presented.map(difference => difference.heading).sort(), ['## Alpha', '## Beta', '## Gamma']);
  run(root, presented.map(difference => ({ file: 'FEATURES.md', templateHash: difference.templateHash, action: 'insert' })).reverse(), ctx);
  assert.equal(read(root, 'FEATURES.md'), text('# Features', '', 'Intro.', '', '## Alpha', '', 'Alpha guidance.', '', '## Beta', '', 'Beta guidance.', '', '## Project', '', ...entry, '', '## Gamma', '', 'Gamma guidance.', '', '## History', '', 'History guidance.'));
});

test('a remove decided while a retired section was removable is pending once the section gains an entry', t => {
  const root = project(t);
  const ctx = quickContext({ headings: [headingHash('Old notes')], blocks: [sha256('Old notes guidance.')] });
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## Old notes', '', 'Old notes guidance.', '', '## History', '', 'History guidance.'));
  const section = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences.find(difference => difference.kind === 'retired-section');
  assert.equal(section.removable, true);
  const grown = text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', '## Old notes', '', 'Old notes guidance.', '', '- [A quick win](x.md)', '', '## History', '', 'History guidance.');
  write(root, 'QUICK_WINS.md', grown);
  const result = run(root, [{ file: 'QUICK_WINS.md', templateHash: section.templateHash, action: 'remove' }], ctx);
  assert.equal(result.decisions[0].reason, 'not-removable');
  assert.equal(read(root, 'QUICK_WINS.md'), grown);
});

test('kept retired text is remembered: a retired block occurring twice, and a retired section with entries kept with its reason', t => {
  const root = project(t);
  const old = 'Old guidance a template dropped.';
  const ctx = context({ templates: { 'QUICK_WINS.md': QUICK_TEMPLATE, 'FEATURES.md': text('# Features', '', 'Intro.', '', '## History', '', 'History guidance.') }, retired: { 'QUICK_WINS.md': { blocks: [sha256(old)] }, 'FEATURES.md': { headings: [headingHash('Work')], blocks: [sha256('Old work guidance.')] } } });
  const quick = text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', old, '', '## History', '', 'History guidance.', '', old);
  const features = text('# Features', '', 'Intro.', '', '## Work', '', 'Old work guidance.', '', '### [An item](features/a.md)', '', '**Requires:** none.', '', '## History', '', 'History guidance.');
  write(root, 'QUICK_WINS.md', quick);
  write(root, 'FEATURES.md', features);
  const section = fileReport(inspect(root, ctx), 'FEATURES.md').differences.find(difference => difference.kind === 'retired-section');
  assert.deepEqual([section.removable, section.reason], [false, 'has-entries']);
  const result = run(root, [
    { file: 'QUICK_WINS.md', templateHash: sha256(old), action: 'keep' },
    { file: 'FEATURES.md', templateHash: section.templateHash, action: 'keep' },
    { file: 'FEATURES.md', templateHash: sha256('Old work guidance.'), action: 'keep' },
  ], ctx);
  assert.deepEqual(result.decisions.map(decision => decision.outcome), ['kept', 'kept', 'kept']);
  assert.deepEqual([read(root, 'QUICK_WINS.md'), read(root, 'FEATURES.md')], [quick, features]);
  const again = inspect(root, ctx);
  assert.deepEqual([fileReport(again, 'QUICK_WINS.md').count, fileReport(again, 'FEATURES.md').count], [0, 0]);
});

test('a replace names the first occurrence of a candidate whose text occurs twice', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance, old.', '', 'Second guidance, old.', '', '## History', '', 'History guidance.'));
  const missing = fileReport(inspect(root, ctx), 'QUICK_WINS.md').differences[0];
  assert.deepEqual(missing.candidates.map(candidate => candidate.line), [5]);
  run(root, [{ file: 'QUICK_WINS.md', templateHash: missing.templateHash, action: 'replace', replaces: missing.candidates[0].hash }], ctx);
  assert.equal(read(root, 'QUICK_WINS.md'), text('# Quick wins', '', 'Intro guidance.', '', 'Second guidance.', '', 'Second guidance, old.', '', '## History', '', 'History guidance.'));
});

test('a remembered keep for an unreadable file is kept when apply records other keeps', t => {
  const root = project(t);
  const ctx = quickContext();
  write(root, 'QUICK_WINS.md', text('# Quick wins', '', '## History', '', 'History guidance.'));
  fs.writeFileSync(path.join(root, '.nightshift', 'BUGS.md'), Buffer.from([0x23, 0x20, 0xff]));
  const unreadable = { file: 'BUGS.md', templateHash: sha256('Bug guidance.') };
  write(root, 'template-decisions.json', JSON.stringify({ schema: 1, kept: [unreadable] }));
  run(root, [{ file: 'QUICK_WINS.md', templateHash: sha256('Intro guidance.'), action: 'keep' }], ctx);
  assert.deepEqual(JSON.parse(read(root, 'template-decisions.json')).kept, [unreadable, { file: 'QUICK_WINS.md', templateHash: sha256('Intro guidance.') }]);
});

test('the comparison model pins its hashes for a fixed sample document', () => {
  const sample = text('# Title', '', 'A paragraph', 'continued on a second line.', '', '- A list item', '  with a continuation.', '- Another item.', '', '```markdown', 'a fence', '```', '', '| a | b |', '| - | - |', '| 1 | 2 |', '', '## Section.', '', 'Under a heading.');
  const blocks = describeDocument(sample).blocks.map(block => [block.kind, block.hash.slice(0, 16)]);
  assert.deepEqual(blocks, [
    ['heading', sha256('title').slice(0, 16)],
    ['text', sha256('A paragraph continued on a second line.').slice(0, 16)],
    ['text', sha256('- A list item with a continuation.').slice(0, 16)],
    ['text', sha256('- Another item.').slice(0, 16)],
    ['text', sha256(['```markdown', 'a fence', '```'].join(LF)).slice(0, 16)],
    ['text', sha256(['| a | b |', '| - | - |', '| 1 | 2 |'].join(LF)).slice(0, 16)],
    ['heading', sha256('section').slice(0, 16)],
    ['text', sha256('Under a heading.').slice(0, 16)],
  ]);
});
