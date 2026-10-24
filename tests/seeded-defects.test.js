'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const suite = require('../tools/seeded-defects');
const { dispatchReview } = require('../internal/runtime/review');
const { DIMENSIONS } = require('../internal/runtime/lifecycle');

const MODEL = { host: 'claude', id: 'claude-opus-5-5' };

function scratch(t) {
  const parent = path.resolve(__dirname, '../.tmp/seeded-defects-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  return root;
}

function writeTree(root, files) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
}

const BASE_CALC = 'function addTotal(a, b) {\n  return a + b;\n}\n\nmodule.exports = { addTotal };\n';
const CHANGED_CALC = 'function addTotal(a, b) {\n  // Totals now include a fee.\n  return a - b + 1;\n}\n\nmodule.exports = { addTotal };\n';

function defect(overrides = {}) {
  return { id: 'D1', dimension: 'correctness-integration', file: 'src/calc.js', lines: [3, 3], symbol: 'addTotal', severity: 'important', consequence: 'Totals subtract instead of adding.', origin: 'synthetic', ...overrides };
}

function decoy(overrides = {}) {
  return { severity: 'minor', consequence: 'The export list is incomplete.', evidence: 'src/calc.js:6 exports only one function', required: false, reason: 'The module defines only one function.', ...overrides };
}

function writeFixture(fixturesRoot, name, { base = { 'src/calc.js': BASE_CALC }, change = { 'src/calc.js': CHANGED_CALC }, fixture = {} } = {}) {
  const directory = path.join(fixturesRoot, name);
  writeTree(path.join(directory, 'base'), base);
  writeTree(path.join(directory, 'change'), change);
  const document = { requirements: 'Add a flat fee of one to every total without changing the addition.', audited: '2026-10-23', defects: [defect()], outOfScope: [], incidental: [], decoys: [decoy()], ...fixture };
  fs.writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify(document, null, 2) + '\n');

  return directory;
}

function requestOf(options) {
  return JSON.parse(fs.readFileSync(path.join(options.artifacts, '..', 'request.json'), 'utf8'));
}

// A host stand-in: the lead reports scenario.lead(request) findings, the skeptic answers each claim with scenario.verdict(claim).
function mockAgent(scenario, calls) {
  return async options => {
    const request = requestOf(options);
    calls.push({ kind: request.kind, request, options });
    fs.mkdirSync(options.artifacts, { recursive: true });
    if (scenario.throwFor?.(request)) throw Object.assign(new Error('host failed'), { code: 'unusable-review', tokens: 5 });
    let report;
    if (request.kind === 'skeptic') {
      const status = scenario.skepticStatus?.(request) ?? 'complete';
      report = { requestId: request.id, status, coverage: [], findings: request.findings.map(claim => ({ id: claim.id, verdict: scenario.verdict(claim), evidence: 'Checked the cited line', value: 'Worth fixing', repairProposal: 'Restore the addition' })), probes: status === 'incomplete' ? [{ id: 'p1', purpose: 'run the test', executable: 'node', args: ['-v'], timeoutMs: 1000, files: [] }] : [], summary: 'Claims checked', toolFailure: '' };
    } else {
      const findings = scenario.lead(request);
      const status = scenario.leadStatus?.(request) ?? 'complete';
      report = { requestId: request.id, status, coverage: DIMENSIONS.code.map(dimension => ({ dimension, evidence: 'Assessed' })), findings, probes: status === 'incomplete' ? [{ id: 'p1', purpose: 'run the test', executable: 'node', args: ['-v'], timeoutMs: 1000, files: [] }] : [], summary: 'Lead assessment', toolFailure: '', closures: [], positions: [] };
    }
    const events = [{ type: 'assistant', session_id: 's1', message: { model: options.model, content: [] } }, { type: 'result', session_id: 's1', subtype: 'success', is_error: false, structured_output: report, note: scenario.eventNote?.(request) ?? '' }];
    fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');

    return { host: options.host, model: options.model, effort: options.effort, session: 's1', attributionVerified: true, status: 'complete', output: report, tokens: scenario.tokens ? scenario.tokens(request) : 1000, ...(scenario.exit ? { exit: scenario.exit(request) } : {}) };
  };
}

const LEAD_FINDS_DEFECT = { lead: () => [{ id: 'L1', severity: 'important', consequence: 'Totals are wrong.', evidence: 'src/calc.js:3 addTotal subtracts b', required: true }], verdict: claim => claim.evidence.includes('addTotal') ? 'confirmed' : 'refuted' };

function dependencies(scenario, calls) {
  return { dispatchReview, materialize: suite.materialize, hostVersion: () => 'test-host 1.0', machineryHash: () => 'machinery', commit: () => 'commit', dispatchDependencies: { runAgent: mockAgent(scenario, calls) } };
}

function options(root, fixtures, overrides = {}) {
  const rules = path.join(root, 'rules.md');
  if (!fs.existsSync(rules)) fs.writeFileSync(rules, 'Name the file and line of every finding in its evidence.\n');

  return { fixtures, out: path.join(root, 'run'), rules, models: [MODEL], repeat: 1, budget: 10000000, selected: ['alpha'], ...overrides };
}

test('the loader refuses overlapping truth, missing fields, unknown dimensions, misplaced origins, hidden paths and supplied tokens', t => {
  // Arrange
  const root = scratch(t);
  const cases = [
    ['overlap', { fixture: { defects: [defect(), defect({ id: 'D2', lines: [5, 5], symbol: undefined })] } }, /overlap/],
    ['missing', { fixture: { defects: [{ ...defect(), consequence: undefined }] } }, /missing consequence/],
    ['dimension', { fixture: { defects: [defect({ dimension: 'style' })] } }, /unknown dimension/],
    ['origin', { fixture: { defects: [defect({ origin: 'adjudicated:run-1' })] } }, /adjudicated origin outside incidental/],
    ['incidental', { fixture: { incidental: [defect({ id: 'I1', origin: 'synthetic', file: 'src/calc.js', lines: [6, 6], symbol: 'exports' })] } }, /must have origin adjudicated/],
    ['hidden', { change: { 'src/calc.js': CHANGED_CALC, '.gitignore': 'x\n' } }, /hidden from the reviewer/],
    ['tree-token', { change: { 'src/calc.js': CHANGED_CALC + '// see fixture.json\n' } }, /contains fixture\.json/],
    ['decoy-token', { fixture: { decoys: [decoy({ evidence: 'seeded-defects layout' })] } }, /contains seeded-defects/],
  ];

  for (const [name, spec, pattern] of cases) {
    writeFixture(root, name, spec);

    // Act and Assert
    assert.throws(() => suite.loadFixture(path.join(root, name)), pattern, name);
  }
});

test('composition rules are checked for the whole suite and skipped for a subset', t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');

  // Act
  const problems = suite.compositionProblems([suite.loadFixture(path.join(root, 'alpha'))]);

  // Assert
  assert.ok(problems.some(problem => problem.includes('three clean fixtures')));
  assert.ok(problems.some(problem => problem.includes('fresh-gate')));
  assert.throws(() => suite.loadSuite(root), /composition rules/);
  assert.equal(suite.loadSuite(root, ['alpha']).whole, false);
});

test('materialization lies outside the checkout, commits the base untouched by line-ending settings, applies deletions and omits the truth', t => {
  // Arrange
  const root = scratch(t);
  const directory = writeFixture(root, 'alpha', { base: { 'src/calc.js': BASE_CALC, 'old.txt': 'line\r\n' }, fixture: { deletions: ['old.txt'] } });
  const fixture = suite.loadFixture(directory).fixture;

  // Act
  const repository = suite.materialize(directory, fixture);
  t.after(() => fs.rmSync(repository.root, { recursive: true, force: true }));

  // Assert
  assert.equal(repository.root.startsWith(fs.realpathSync.native(os.tmpdir())), true);
  assert.equal(path.relative(path.resolve(__dirname, '..'), repository.root).startsWith('..'), true);
  assert.equal(fs.existsSync(path.join(repository.root, 'old.txt')), false);
  assert.equal(fs.existsSync(path.join(repository.root, 'fixture.json')), false);
  const committed = spawnSync('git', ['show', `${repository.baseSha}:old.txt`], { cwd: repository.root, encoding: 'utf8' }).stdout;
  assert.equal(committed, 'line\r\n');
  assert.equal(spawnSync('git', ['config', 'core.autocrlf'], { cwd: repository.root, encoding: 'utf8' }).stdout.trim(), 'false');
});

test('materialization refuses a fixture whose files a global ignore file hides', t => {
  // Arrange
  const root = scratch(t);
  const directory = writeFixture(root, 'alpha');
  const ignore = path.join(root, 'global-ignore');
  fs.writeFileSync(ignore, 'calc.js\n');
  const config = path.join(root, 'global-config');
  fs.writeFileSync(config, `[core]\n\texcludesFile = ${ignore.split(path.sep).join('/')}\n`);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });

  // Act and Assert
  assert.throws(() => suite.materialize(directory, suite.loadFixture(directory).fixture), /hidden from the reviewer/);
});

test('a run dispatches a lead and a skeptic in separate repositories, shuffles claims and grades every figure', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];

  // Act
  const result = await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'no-targets.json'));

  // Assert
  assert.equal(result.stopped, null);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic']);
  assert.notEqual(calls[0].options.protectedRoot, calls[1].options.protectedRoot);
  assert.deepEqual(calls[1].request.findings.map(claim => claim.id).sort(), ['F1', 'F2']);
  assert.equal(fs.existsSync(path.join(calls[1].options.protectedRoot, '.nightshift/runs/reviews', calls[0].request.id)), false);
  assert.deepEqual([report.pooled.detection.numerator, report.pooled.detection.denominator], [1, 1]);
  assert.deepEqual([report.pooled.skepticAccuracy.numerator, report.pooled.skepticAccuracy.denominator], [2, 2]);
  assert.equal(report.pooled.severityAccuracy.value, 1);
  assert.equal(report.pooled.tokensPerFixture.value, 2000);
  assert.equal(report.pooled.provisional, false);
  assert.equal(report.targets.status, 'none');
  assert.equal(report.whole, false);
});

test('an evaluated host passes the reviewer gate as its gate candidate while its runner gets the evaluated model, and the records name both', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const evaluated = { host: 'vibe', id: 'glm-5-3' };

  // Act
  const result = await suite.run(options(root, root, { models: [evaluated] }), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'no-targets.json'));
  const key = suite.fixtureRunKey('alpha', evaluated, 1);
  const lead = JSON.parse(fs.readFileSync(path.join(root, 'run', 'runs', key, 'lead.result.json'), 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(path.join(root, 'run', 'runs', key, 'lead', 'receipt.json'), 'utf8'));

  // Assert
  assert.equal(result.stopped, null);
  assert.deepEqual(calls.map(call => [call.options.host, call.options.model]), [['vibe', 'glm-5-3'], ['vibe', 'glm-5-3']]);
  assert.deepEqual(lead.evaluation, { host: 'vibe', model: 'glm-5-3', gateCandidate: { host: 'codex', model: 'gpt-6-sol' } });
  assert.deepEqual([receipt.host, receipt.model], ['vibe', 'glm-5-3']);
  assert.deepEqual([receipt.attempts[0].host, receipt.attempts[0].model], ['codex', 'gpt-6-sol']);
  assert.deepEqual(Object.keys(report.byModel), ['vibe:glm-5-3']);
});

test('the Vibe launcher takes the report from a fenced block or the outermost braces, and the model from a single journal value', t => {
  // Arrange
  const vibe = require('../tools/seeded-defects/vibe-launcher');
  const root = scratch(t);
  const journal = (name, model) => writeTree(path.join(root, name, 'session', 'generations'), { '1/runtime-state.json': JSON.stringify({ session_metadata: { active_model: model } }), '8/runtime-state.json': JSON.stringify({ session_metadata: { active_model: 'glm-5-3' } }) });
  journal('same', 'glm-5-3');
  journal('mixed', 'mistral-medium-3.5');

  // Act
  const fenced = vibe.reportText('I have checked it.\n\n```json\n{"a": {"b": 1}}\n```');
  const braces = vibe.reportText('Report: {"a": 1} done');

  // Assert
  assert.equal(fenced, '{"a": {"b": 1}}');
  assert.equal(braces, '{"a": 1}');
  assert.equal(vibe.reportText(null), null);
  assert.equal(vibe.sessionModel(path.join(root, 'same')), 'glm-5-3');
  assert.equal(vibe.sessionModel(path.join(root, 'mixed')), null);
  assert.equal(vibe.sessionModel(path.join(root, 'absent')), null);
});

test('a run refuses to start without a budget and stops before a dispatch the budget cannot cover', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];

  // Act
  const missing = suite.run(options(root, root, { budget: undefined }), dependencies(LEAD_FINDS_DEFECT, calls));
  const result = await suite.run(options(root, root, { budget: 1000 }), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  await assert.rejects(missing, /budget/);
  assert.match(result.stopped, /budget/);
  assert.equal(calls.length, 0);
});

test('an attempt without a token reading stops the run before the next dispatch', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];

  // Act
  const result = await suite.run(options(root, root), dependencies({ ...LEAD_FINDS_DEFECT, tokens: () => null }, calls));

  // Assert
  assert.match(result.stopped, /recorded no tokens/);
  assert.deepEqual(calls.map(call => call.kind), ['code']);
  assert.equal(result.spending.unknown, true);
});

test('an incomplete lead skips the skeptic, grades incomplete, and --retry supersedes it with its cause recorded', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  let incomplete = true;
  const scenario = { ...LEAD_FINDS_DEFECT, leadStatus: () => incomplete ? 'incomplete' : 'complete' };

  // Act
  await suite.run(options(root, root), dependencies(scenario, calls));
  const first = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));
  const rerun = await suite.run(options(root, root), dependencies(scenario, calls));
  incomplete = false;
  await suite.run(options(root, root, { retry: true }), dependencies(scenario, calls));
  const second = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(first.incomplete, ['alpha__claude-claude-opus-5-5__r1']);
  assert.equal(rerun.stopped, null);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'code', 'skeptic']);
  assert.deepEqual(second.incomplete, []);
  assert.deepEqual(second.pooled.retries, { 'incomplete-report': 1 });
  assert.equal(second.pooled.tokensPerFixture.value, 2000);
  assert.equal(suite.spending(path.join(root, 'run')).spent, 3000);
});

test('resume reconciles a pending intent from its repository or counts a lost outcome as estimated, and writes a missing completion record', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const key = 'alpha__claude-claude-opus-5-5__r1';
  const paths = suite.runPaths(path.join(root, 'run'), key);
  fs.rmSync(paths.complete);
  const skepticIntent = JSON.parse(fs.readFileSync(paths.intent('skeptic'), 'utf8'));
  const missingRepository = path.join(root, 'gone');
  fs.writeFileSync(paths.intent('skeptic'), JSON.stringify({ ...skepticIntent, done: false, repository: missingRepository }));
  fs.rmSync(paths.result('skeptic'));
  fs.rmSync(paths.artifacts('skeptic'), { recursive: true });

  // Act
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic']);
  const record = JSON.parse(fs.readFileSync(paths.result('skeptic'), 'utf8'));
  assert.equal(record.outcome, 'lost');
  assert.equal(record.estimated, 1000);
  assert.equal(fs.existsSync(paths.complete), true);
  assert.equal(report.pooled.tokensEstimated, true);
  assert.deepEqual([report.pooled.detection.numerator, report.pooled.skepticAccuracy.denominator], [1, 0]);
});

test('after a done lead with no skeptic intent, resume dispatches the skeptic next', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  for (const file of [paths.complete, paths.intent('skeptic'), paths.result('skeptic'), paths.claims]) fs.rmSync(file);
  fs.rmSync(paths.artifacts('skeptic'), { recursive: true });

  // Act
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic', 'skeptic']);
});

test('unproven host termination blocks the run folder until the termination is confirmed', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const scenario = { ...LEAD_FINDS_DEFECT, exit: () => ({ descendantsReclaimed: false }) };

  // Act
  const first = await suite.run(options(root, root), dependencies(scenario, calls));
  const refused = suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.match(first.stopped, /termination is unproven/);
  await assert.rejects(refused, /termination-checked/);
  const blocking = JSON.parse(fs.readFileSync(path.join(root, 'run', 'blocking.json'), 'utf8'));
  assert.equal(fs.existsSync(blocking.repository), true);
  fs.rmSync(blocking.repository, { recursive: true, force: true });
  const resumed = await suite.run(options(root, root, { terminationChecked: true }), dependencies(LEAD_FINDS_DEFECT, calls));
  assert.equal(resumed.stopped, null);
});

test('a paired model dispatches its skeptic on the named model and is keyed and reported as the pair', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const paired = suite.parseArguments(['run', '--out', 'x', '--budget', '1', '--model', 'claude:claude-opus-5-5@codex:gpt-6-sol']).models[0];

  // Act
  await suite.run(options(root, root, { models: [paired] }), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(calls.map(call => [call.kind, call.options.host, call.options.model]), [['code', 'claude', 'claude-opus-5-5'], ['skeptic', 'codex', 'gpt-6-sol']]);
  assert.deepEqual(Object.keys(report.byModel), ['claude:claude-opus-5-5@codex:gpt-6-sol']);
  assert.equal(report.fixtureRuns[0].key, 'alpha__claude-claude-opus-5-5__s-codex-gpt-6-sol__r1');
  assert.deepEqual([report.pooled.skepticAccuracy.numerator, report.pooled.skepticAccuracy.denominator], [2, 2]);
});

test('a model pair parses to a lead and a different skeptic, and a pair naming one model twice is that model alone', () => {
  // Arrange
  const parse = value => suite.parseArguments(['run', '--out', 'x', '--budget', '1', '--model', value]).models[0];

  // Act and assert
  assert.deepEqual(parse('vibe:glm-5-3@claude:claude-opus-5-5'), { host: 'vibe', id: 'glm-5-3', skeptic: { host: 'claude', id: 'claude-opus-5-5' } });
  assert.deepEqual(parse('codex:gpt-6-sol@codex:gpt-6-sol'), { host: 'codex', id: 'gpt-6-sol' });
  for (const value of ['codex:gpt-6-sol@codex', 'codex:gpt-6-sol@a:b@c:d', 'codex:']) assert.throws(() => parse(value), /--model takes/);
});

test('matching assigns one finding to one entry, nearest first, and leaves the rest unmatched', () => {
  // Arrange
  const truth = [defect({ id: 'A', file: 'a.js', lines: [10, 10], symbol: undefined }), defect({ id: 'B', file: 'b.js', lines: [20, 20], symbol: undefined })];
  const findings = [{ id: 'X', evidence: 'a.js:10 and b.js:21 both break', consequence: 'Broken' }, { id: 'Y', evidence: 'b.js:20 breaks', consequence: 'Broken' }, { id: 'Z', evidence: 'c.js:1', consequence: 'Other' }];

  // Act
  const { byFinding } = suite.assign(findings, truth);

  // Assert
  assert.deepEqual([...byFinding.entries()].sort(), [[0, 0], [1, 1]]);
  assert.equal(byFinding.has(2), false);
});

test('a cited range enclosing the entry matches at distance zero, ahead of a nearby single line', () => {
  // Arrange
  const entry = defect({ id: 'A', file: 'src/runs.js', lines: [18, 21], symbol: undefined });
  const enclosing = { id: 'F1', evidence: 'src/runs.js:15-26 (update) writes the recorded owner', consequence: 'Broken' };
  const nearby = { id: 'F2', evidence: 'src/runs.js:4-12 and the guard at src/runs.js:23', consequence: 'Broken' };
  const pair = { id: 'F3', evidence: 'lines 4 and 25 of runs.js', consequence: 'Broken' };

  // Act
  const { byFinding } = suite.assign([nearby, enclosing], [entry]);

  // Assert
  assert.equal(suite.distance(enclosing, entry, ['src/runs.js']), 0);
  assert.equal(suite.distance(nearby, entry, ['src/runs.js']), 2);
  assert.equal(suite.distance(pair, entry, ['src/runs.js']), null);
  assert.deepEqual([...byFinding.entries()], [[1, 0]]);
});

test('a symbol matches from the evidence only, so a caller named in a consequence does not claim the entry', () => {
  // Arrange
  const entry = defect({ id: 'O1', file: 'src/report.js', lines: [3, 3], symbol: 'summarize' });
  const passing = { id: 'F2', evidence: 'src/fresh.js:13 (fresh) throws', consequence: 'Breaks callers such as summarize in src/report.js' };
  const locating = { id: 'F3', evidence: 'src/report.js (summarize) subtracts one', consequence: 'Undercounts' };

  // Act
  const { byFinding } = suite.assign([passing, locating], [entry]);

  // Assert
  assert.equal(suite.distance(passing, entry, ['src/report.js']), null);
  assert.equal(suite.distance(locating, entry, ['src/report.js']), 0);
  assert.deepEqual([...byFinding.entries()], [[1, 0]]);
});

test('grading handles clean fixtures, out-of-scope flags, unverified verdicts, adjudications and contamination', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha', { change: { 'src/calc.js': BASE_CALC.replace('return a + b;', 'return a + b; // unchanged') }, fixture: { defects: [], outOfScope: [defect({ id: 'O1', dimension: 'design-maintainability', lines: [1, 1], symbol: undefined, consequence: 'The name is vague.' })], decoys: [decoy()] } });
  const calls = [];
  const scenario = {
    lead: () => [
      { id: 'L1', severity: 'minor', consequence: 'Vague name.', evidence: 'src/calc.js:1 addTotal is vague', required: false },
      { id: 'L2', severity: 'important', consequence: 'Missing input checks.', evidence: 'src/calc.js:9 no validation', required: true },
      { id: 'L3', severity: 'minor', consequence: 'Comment noise.', evidence: 'src/calc.js:12 comment', required: true },
    ],
    verdict: claim => claim.evidence.includes('validation') ? 'confirmed' : claim.evidence.includes('comment') ? 'unverified' : claim.evidence.includes('vague') ? 'confirmed' : 'refuted',
  };
  await suite.run(options(root, root), dependencies(scenario, calls));
  const runFolder = path.join(root, 'run');
  const key = 'alpha__claude-claude-opus-5-5__r1';

  // Act
  const provisional = suite.grade(runFolder, path.join(root, 'none.json'));
  fs.writeFileSync(path.join(runFolder, 'adjudications.json'), JSON.stringify({ [key]: { L2: { outcome: 'false', reason: 'No input reaches it' }, L3: { outcome: 'real', reason: 'A stale comment', file: 'src/calc.js', lines: [2, 2] } } }));
  const adjudicated = suite.grade(runFolder, path.join(root, 'none.json'));

  // Assert
  assert.equal(provisional.pooled.provisional, true);
  assert.deepEqual(provisional.pendingAdjudication[key].sort(), ['L2', 'L3']);
  assert.equal(adjudicated.pooled.provisional, false);
  assert.deepEqual([adjudicated.pooled.outOfScope.numerator, adjudicated.pooled.outOfScope.requiredFalse], [1, 1]);
  // L3 adjudicated real makes the fixture not clean for this run, so L2's confirmation counts among unmatched confirmations.
  assert.deepEqual([adjudicated.pooled.cleanChangeFalsePositives.denominator, adjudicated.pooled.unmatchedConfirmations.numerator], [0, 1]);
  // Out-of-scope finding confirmed agrees, decoy refuted agrees.
  assert.deepEqual([adjudicated.pooled.skepticAccuracy.numerator, adjudicated.pooled.skepticAccuracy.denominator], [2, 2]);
  const leadEvents = path.join(suite.runPaths(runFolder, key).artifacts('lead'), 'attempt-1', 'events.jsonl');
  fs.appendFileSync(leadEvents, JSON.stringify({ type: 'note', text: 'read fixture.json' }) + '\n');
  assert.deepEqual(suite.grade(runFolder, path.join(root, 'none.json')).contaminated, [key]);
});

test('a run whose skeptic failed keeps its lead figures, leaves both false-positive figures and is listed', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const scenario = {
    lead: () => [...LEAD_FINDS_DEFECT.lead(), { id: 'L2', severity: 'minor', consequence: 'Missing input checks.', evidence: 'src/calc.js:12 no validation', required: false }],
    verdict: () => 'confirmed',
    throwFor: request => request.kind === 'skeptic',
  };
  await suite.run(options(root, root), dependencies(scenario, calls));
  const runFolder = path.join(root, 'run');
  fs.writeFileSync(path.join(runFolder, 'adjudications.json'), JSON.stringify({ 'alpha__claude-claude-opus-5-5__r1': { L2: { outcome: 'false', reason: 'No input reaches it' } } }));

  // Act
  const report = suite.grade(runFolder, path.join(root, 'none.json'));

  // Assert
  assert.deepEqual([report.pooled.detection.numerator, report.pooled.detection.denominator], [1, 1]);
  assert.deepEqual([report.pooled.unmatchedConfirmations.denominator, report.pooled.cleanChangeFalsePositives.denominator, report.pooled.skepticAccuracy.denominator], [0, 0, 0]);
  assert.deepEqual(report.skepticIncomplete, ['alpha__claude-claude-opus-5-5__r1']);
  assert.match(fs.readFileSync(path.join(runFolder, 'report.md'), 'utf8'), /Without a complete skeptic: alpha__claude-claude-opus-5-5__r1\./);
});

test('an attribution to an unmatched entry counts as its match, and one to a matched entry is a duplicate', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const scenario = { lead: () => [{ id: 'L1', severity: 'important', consequence: 'Totals are wrong for callers.', evidence: 'The checkout total in the cart is off by the fee', required: true }], verdict: () => 'refuted' };
  await suite.run(options(root, root), dependencies(scenario, calls));
  const runFolder = path.join(root, 'run');
  const key = 'alpha__claude-claude-opus-5-5__r1';

  // Act
  const before = suite.grade(runFolder, path.join(root, 'none.json'));
  fs.writeFileSync(path.join(runFolder, 'adjudications.json'), JSON.stringify({ [key]: { L1: { outcome: 'attributed', entry: 'D1', reason: 'Reported at the symptom' } } }));
  const after = suite.grade(runFolder, path.join(root, 'none.json'));

  // Assert
  assert.equal(before.pooled.detection.numerator, 0);
  assert.equal(after.pooled.detection.numerator, 1);
  assert.equal(after.pooled.attributions, 1);
});

test('comparisons flag confounding, informational differences and stale targets', t => {
  // Arrange
  const root = scratch(t);
  const report = overrides => ({ fixtureSetHash: 'f1', graderHash: 'g1', rulesHash: 'r1', mixed: false, identities: [{ machinery: 'm1', harness: 'h1', commit: 'c1', hostVersion: 'v1' }], byModel: { 'claude:claude-opus-5-5': {} }, pooled: Object.fromEntries(['detection', 'cleanChangeFalsePositives', 'unmatchedConfirmations', 'severityAccuracy', 'skepticAccuracy'].map(key => [key, { value: 0.5 }])), ...overrides });
  for (const [name, value] of [['base', report()], ['prompt', report({ identities: [{ machinery: 'm2', harness: 'h1', commit: 'c2', hostVersion: 'v2' }] })], ['both', report({ identities: [{ machinery: 'm2', harness: 'h1', commit: 'c1', hostVersion: 'v1' }], rulesHash: 'r2' })]]) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'report.json'), JSON.stringify({ ...value, pooled: { ...value.pooled, provisional: false } }));
  }

  // Act
  const prompt = suite.compare(path.join(root, 'base'), path.join(root, 'prompt'));
  const both = suite.compare(path.join(root, 'base'), path.join(root, 'both'));

  // Assert
  assert.deepEqual(prompt.confounded, []);
  assert.deepEqual(prompt.informational.hostVersions.sort(), ['v1', 'v2']);
  assert.equal(both.confounded.length, 1);
  assert.match(both.confounded[0], /more than one varied input/);
});

test('a comparison counts a changed dispatching harness as a confound and gives each change beside the spread and the targets', t => {
  // Arrange
  const root = scratch(t);
  const pooled = values => ({ ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), detectionByDimension: { 'correctness-integration': { value: 1 } }, provisional: false });
  const base = { fixtureSetHash: 'f1', graderHash: 'g1', rulesHash: 'r1', mixed: false, identities: [{ machinery: 'm1', harness: 'h1', commit: 'c1', hostVersion: 'v1' }], byModel: { 'claude:claude-opus-5-5': { spread: { unmatchedConfirmations: { min: 0.1, max: 0.2 } } } }, pooled: pooled({ unmatchedConfirmations: 0.15, tokensPerFixture: 50000 }) };
  const reports = {
    base,
    small: { ...base, identities: [{ machinery: 'm2', harness: 'h1', commit: 'c2', hostVersion: 'v1' }], pooled: pooled({ unmatchedConfirmations: 0.2, tokensPerFixture: 56000 }), targets: { status: 'current', baseline: 'b', figures: { unmatchedConfirmations: 0.2 } } },
    large: { ...base, identities: [{ machinery: 'm2', harness: 'h1', commit: 'c2', hostVersion: 'v1' }], pooled: pooled({ unmatchedConfirmations: 0.4, tokensPerFixture: 50000 }) },
    harness: { ...base, identities: [{ machinery: 'm1', harness: 'h2', commit: 'c2', hostVersion: 'v1' }] },
    incomplete: { ...base, incomplete: ['alpha__claude-claude-opus-5-5__r2'] },
    skeptic: { ...base, skepticIncomplete: ['alpha__claude-claude-opus-5-5__r1'] },
  };
  for (const [name, value] of Object.entries(reports)) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'report.json'), JSON.stringify(value));
  }

  // Act
  const small = suite.compare(path.join(root, 'base'), path.join(root, 'small'));
  const large = suite.compare(path.join(root, 'base'), path.join(root, 'large'));
  const harness = suite.compare(path.join(root, 'base'), path.join(root, 'harness'));

  // Assert
  assert.deepEqual(small.varied, ['review machinery']);
  assert.deepEqual(small.confounded, []);
  assert.equal(small.changes.unmatchedConfirmations.withinSpread, true);
  assert.equal(small.changes.unmatchedConfirmations.target, 0.2);
  assert.equal(small.changes.tokensPerFixture.change, 6000);
  assert.equal(small.detectionByDimension['correctness-integration'].change, 0);
  assert.equal(large.changes.unmatchedConfirmations.withinSpread, false);
  assert.deepEqual(harness.confounded, ['dispatching harness']);
  assert.deepEqual(suite.compare(path.join(root, 'base'), path.join(root, 'incomplete')).confounded, ['incomplete, contaminated or skeptic-incomplete fixture runs (baseline 0, later 1)']);
  assert.deepEqual(suite.compare(path.join(root, 'skeptic'), path.join(root, 'base')).confounded, ['incomplete, contaminated or skeptic-incomplete fixture runs (baseline 1, later 0)']);
});

test('a run refuses a model id that is not a plain name and a model given twice', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];

  // Act
  const escaping = suite.run(options(root, root, { models: [{ host: 'codex', id: 'x/../../escape' }] }), dependencies(LEAD_FINDS_DEFECT, calls));
  const repeated = suite.run(options(root, root, { models: [MODEL, MODEL] }), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  await assert.rejects(escaping, /must be letters, digits/);
  await assert.rejects(repeated, /given more than once/);
  assert.equal(fs.existsSync(path.join(root, 'run')), false);
  assert.equal(calls.length, 0);
});

test('a resumed run reads its frozen copy even after the source fixture is gone', async t => {
  // Arrange
  const root = scratch(t);
  const fixtures = path.join(root, 'fixtures');
  writeFixture(fixtures, 'alpha');
  const calls = [];
  await suite.run(options(root, fixtures), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  for (const file of [paths.complete, paths.intent('skeptic'), paths.result('skeptic'), paths.claims]) fs.rmSync(file);
  fs.rmSync(paths.artifacts('skeptic'), { recursive: true });
  fs.rmSync(path.join(fixtures, 'alpha'), { recursive: true });

  // Act
  const result = await suite.run(options(root, fixtures), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.equal(result.stopped, null);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic', 'skeptic']);
});

test('an interrupted supersession is finished before the stage dispatches again, so no spending is lost', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  let incomplete = true;
  const scenario = { ...LEAD_FINDS_DEFECT, leadStatus: () => incomplete ? 'incomplete' : 'complete' };
  await suite.run(options(root, root), dependencies(scenario, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  // A retry interrupted after moving the completion record and the lead intent, before the lead result.
  const target = path.join(paths.superseded, 'interrupted');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'moving.json'), JSON.stringify({ stages: ['lead', 'skeptic'], retried: ['lead'], cause: 'incomplete-report' }));
  for (const file of [paths.complete, paths.intent('lead')]) fs.renameSync(file, path.join(target, path.basename(file)));
  incomplete = false;

  // Act
  await suite.run(options(root, root), dependencies(scenario, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'code', 'skeptic']);
  assert.equal(fs.existsSync(path.join(target, 'moving.json')), false);
  assert.equal(fs.existsSync(path.join(target, 'lead.result.json')), true);
  assert.equal(suite.spending(path.join(root, 'run')).spent, 3000);
  assert.deepEqual(report.pooled.retries, { 'incomplete-report': 1 });
});

test('a contaminated run counts both superseded stages as retried', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  fs.appendFileSync(path.join(paths.artifacts('lead'), 'attempt-1', 'events.jsonl'), JSON.stringify({ type: 'note', text: 'read fixture.json' }) + '\n');

  // Act
  await suite.run(options(root, root, { retry: true }), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic', 'code', 'skeptic']);
  assert.deepEqual(report.pooled.retries, { contamination: 2 });
});

test('reconciliation records the identity the intent was dispatched with, and refuses an intent without one', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  const intent = JSON.parse(fs.readFileSync(paths.intent('skeptic'), 'utf8'));
  const pending = () => {
    fs.rmSync(paths.complete, { force: true });
    fs.rmSync(paths.result('skeptic'), { force: true });
  };
  pending();
  fs.writeFileSync(paths.intent('skeptic'), JSON.stringify({ ...intent, done: false, repository: path.join(root, 'gone') }));
  const later = { ...dependencies(LEAD_FINDS_DEFECT, calls), machineryHash: () => 'later machinery' };

  // Act
  await suite.run(options(root, root), later);
  const record = JSON.parse(fs.readFileSync(paths.result('skeptic'), 'utf8'));
  pending();
  fs.writeFileSync(paths.intent('skeptic'), JSON.stringify({ ...intent, done: false, repository: path.join(root, 'gone'), identity: undefined }));
  const refused = suite.run(options(root, root), later);

  // Assert
  assert.equal(record.identity.machinery, 'machinery');
  await assert.rejects(refused, /records no dispatch identity/);
});

test('a fixture run never dispatched counts in no cost average, and every unmatched finding stays listed after adjudication', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const scenario = { lead: () => [...LEAD_FINDS_DEFECT.lead(), { id: 'L2', severity: 'minor', consequence: 'Comment noise.', evidence: 'src/calc.js:12 comment', required: false }], verdict: claim => claim.evidence.includes('addTotal') ? 'confirmed' : 'refuted' };
  await suite.run(options(root, root), dependencies(scenario, calls));
  const runFolder = path.join(root, 'run');
  const manifestFile = path.join(runFolder, 'manifest.json');
  fs.writeFileSync(manifestFile, JSON.stringify({ ...JSON.parse(fs.readFileSync(manifestFile, 'utf8')), repeat: 2 }));
  fs.writeFileSync(path.join(runFolder, 'adjudications.json'), JSON.stringify({ 'alpha__claude-claude-opus-5-5__r1': { L2: { outcome: 'false', reason: 'No such comment' } } }));

  // Act
  const report = suite.grade(runFolder, path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(report.incomplete, ['alpha__claude-claude-opus-5-5__r2']);
  assert.equal(report.pooled.tokensPerFixture.value, 2000);
  assert.equal(report.pooled.tokensIncomplete, false);
  assert.deepEqual(report.fixtureRuns[0].unmatched, ['L2']);
});

test('an adjudication with an unknown outcome or no reason is refused', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const scenario = { lead: () => [...LEAD_FINDS_DEFECT.lead(), { id: 'L2', severity: 'minor', consequence: 'Comment noise.', evidence: 'src/calc.js:12 comment', required: false }], verdict: () => 'confirmed' };
  await suite.run(options(root, root), dependencies(scenario, calls));
  const runFolder = path.join(root, 'run');
  const key = 'alpha__claude-claude-opus-5-5__r1';

  for (const decision of [{ outcome: 'attibuted', entry: 'D1', reason: 'Typo' }, { outcome: 'false' }]) {
    fs.writeFileSync(path.join(runFolder, 'adjudications.json'), JSON.stringify({ [key]: { L2: decision } }));

    // Act and Assert
    assert.throws(() => suite.grade(runFolder, path.join(root, 'none.json')), /needs an outcome of false, attributed, real and a reason/);
  }
});

test('a report shows targets set on its fixture set hash and marks targets from another hash stale', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const runFolder = path.join(root, 'run');
  const { fixtureSetHash } = JSON.parse(fs.readFileSync(path.join(runFolder, 'manifest.json'), 'utf8'));
  const write = (name, hash) => {
    fs.writeFileSync(path.join(root, name), JSON.stringify({ baseline: 'report.md', fixtureSetHash: hash, figures: { detection: 1 } }));

    return path.join(root, name);
  };

  // Act
  const current = suite.grade(runFolder, write('current.json', fixtureSetHash));
  const currentText = fs.readFileSync(path.join(runFolder, 'report.md'), 'utf8');
  const stale = suite.grade(runFolder, write('stale.json', 'another'));

  // Assert
  assert.deepEqual(current.targets, { status: 'current', baseline: 'report.md', figures: { detection: 1 } });
  assert.match(currentText, /- detection: target 1, now 1/);
  assert.deepEqual(stale.targets, { status: 'stale', baseline: 'report.md' });
  assert.match(fs.readFileSync(path.join(runFolder, 'report.md'), 'utf8'), /Targets are stale/);
});

test('a model id cannot imitate a pair\'s key, and a host cannot imitate the host separator', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];

  for (const [model, pattern] of [[{ host: 'vibe', id: 'foo__s-codex-bar' }, /without '__'/], [{ host: 'vi-be', id: 'foo' }, /host must be letters and digits/]]) {
    // Act
    const refused = suite.run(options(root, root, { models: [model] }), dependencies(LEAD_FINDS_DEFECT, calls));

    // Assert
    await assert.rejects(refused, pattern);
  }
  assert.equal(calls.length, 0);
});

test('--retry dispatches again in the same pass a stage whose outcome reconciliation finds lost', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  const intent = JSON.parse(fs.readFileSync(paths.intent('skeptic'), 'utf8'));
  for (const file of [paths.complete, paths.result('skeptic')]) fs.rmSync(file);
  fs.writeFileSync(paths.intent('skeptic'), JSON.stringify({ ...intent, done: false, repository: path.join(root, 'gone') }));

  // Act
  await suite.run(options(root, root, { retry: true }), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic', 'skeptic']);
  assert.deepEqual(report.pooled.retries, { 'lost-outcome': 1 });
  assert.equal(JSON.parse(fs.readFileSync(paths.result('skeptic'), 'utf8')).outcome, 'complete');
});

test('a resumed run records the host version it finds when it resumes', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  for (const file of [paths.complete, paths.intent('skeptic'), paths.result('skeptic'), paths.claims]) fs.rmSync(file);
  fs.rmSync(paths.artifacts('skeptic'), { recursive: true });

  // Act
  await suite.run(options(root, root), { ...dependencies(LEAD_FINDS_DEFECT, calls), hostVersion: () => 'test-host 2.0' });

  // Assert
  assert.equal(JSON.parse(fs.readFileSync(paths.result('lead'), 'utf8')).identity.hostVersion, 'test-host 1.0');
  assert.equal(JSON.parse(fs.readFileSync(paths.result('skeptic'), 'utf8')).identity.hostVersion, 'test-host 2.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'run', 'manifest.json'), 'utf8')).hostVersions.claude, 'test-host 1.0');
});

test('the loader refuses a deleted base .gitignore and a contamination token in a decoy reason', t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'deleted', { base: { 'src/calc.js': BASE_CALC, '.gitignore': 'x\n' }, fixture: { deletions: ['.gitignore'] } });
  writeFixture(root, 'reason', { fixture: { decoys: [decoy({ reason: 'fixture.json says otherwise' })] } });

  // Act and Assert
  assert.throws(() => suite.loadFixture(path.join(root, 'deleted')), /hidden from the reviewer/);
  assert.throws(() => suite.loadFixture(path.join(root, 'reason')), /contains fixture\.json/);
});

test('an adjudication is checked even when its finding is no longer unmatched', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const runFolder = path.join(root, 'run');
  fs.writeFileSync(path.join(runFolder, 'adjudications.json'), JSON.stringify({ 'alpha__claude-claude-opus-5-5__r1': { L9: { outcome: 'misspelled', reason: 'Orphan' } } }));

  // Act and Assert
  assert.throws(() => suite.grade(runFolder, path.join(root, 'none.json')), /L9 needs an outcome/);
});

test('a two-repetition baseline gives every compared figure a spread, detection per dimension included', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  let repetition = 0;
  const scenario = { ...LEAD_FINDS_DEFECT, lead: () => (repetition++ === 0 ? LEAD_FINDS_DEFECT.lead() : []) };
  await suite.run(options(root, root, { repeat: 2 }), dependencies(scenario, calls));
  const runFolder = path.join(root, 'run');
  suite.grade(runFolder, path.join(root, 'none.json'));

  // Act
  const comparison = suite.compare(runFolder, runFolder);

  // Assert
  assert.deepEqual(comparison.changes.detection.spread, { min: 0, max: 1 });
  assert.deepEqual(comparison.detectionByDimension['correctness-integration'].spread, { min: 0, max: 1 });
  assert.notEqual(comparison.changes.tokensPerFixture.spread, null);
  assert.equal(comparison.changes.detection.withinSpread, true);
});

test('a dispatch that fails before any attempt records no tokens spent and grades incomplete', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const failing = { ...dependencies(LEAD_FINDS_DEFECT, []), dispatchReview: async () => { throw Object.assign(new Error('request refused'), { code: 'invalid-request' }); } };

  // Act
  const result = await suite.run(options(root, root), failing);
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));
  const record = JSON.parse(fs.readFileSync(suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1').result('lead'), 'utf8'));

  // Assert
  assert.equal(result.stopped, null);
  assert.deepEqual([record.outcome, record.code, record.prelaunch, record.attemptTokens], ['failed', 'invalid-request', true, []]);
  assert.equal(result.spending.spent, 0);
  assert.equal(result.spending.unknown, false);
  assert.deepEqual(report.incomplete, ['alpha__claude-claude-opus-5-5__r1']);
});

test('each dispatch repository is deleted after its dispatch, and the claims record keeps the seed that reproduces its shuffle', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];

  // Act
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const runFolder = path.join(root, 'run');
  const key = 'alpha__claude-claude-opus-5-5__r1';
  const paths = suite.runPaths(runFolder, key);
  const manifest = JSON.parse(fs.readFileSync(path.join(runFolder, 'manifest.json'), 'utf8'));
  const recorded = JSON.parse(fs.readFileSync(paths.claims, 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(path.join(paths.artifacts('lead'), 'receipt.json'), 'utf8'));
  const decoys = JSON.parse(fs.readFileSync(path.join(runFolder, 'frozen', 'alpha', 'fixture.json'), 'utf8')).decoys;

  // Assert
  for (const call of calls) assert.equal(fs.existsSync(call.options.protectedRoot), false);
  assert.equal(recorded.seed, suite.seedFor(manifest.seed, key));
  assert.deepEqual(recorded.claims, suite.shuffledClaims(receipt.findings, decoys, recorded.seed));
});

test('a lead with no findings sends the decoys alone, and a run with no claims dispatches no skeptic', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  writeFixture(root, 'beta', { fixture: { decoys: [] } });
  const calls = [];
  const silent = { lead: () => [], verdict: () => 'refuted' };

  // Act
  await suite.run(options(root, root, { selected: ['alpha', 'beta'] }), dependencies(silent, calls));
  const runFolder = path.join(root, 'run');
  const complete = name => JSON.parse(fs.readFileSync(suite.runPaths(runFolder, `${name}__claude-claude-opus-5-5__r1`).complete, 'utf8'));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic', 'code']);
  assert.deepEqual(calls[1].request.findings.map(claim => claim.consequence), ['The export list is incomplete.']);
  assert.deepEqual(complete('alpha').stages, ['lead', 'skeptic']);
  assert.deepEqual(complete('beta').stages, ['lead']);
});

test('a failed lead skips the skeptic and grades incomplete, and --retry dispatches it again as a known failure', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  let failing = true;
  const scenario = { ...LEAD_FINDS_DEFECT, throwFor: request => failing && request.kind === 'code' };

  // Act
  await suite.run(options(root, root), dependencies(scenario, calls));
  const first = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));
  failing = false;
  await suite.run(options(root, root, { retry: true }), dependencies(scenario, calls));
  const second = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(first.incomplete, ['alpha__claude-claude-opus-5-5__r1']);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'code', 'skeptic']);
  assert.deepEqual(second.incomplete, []);
  assert.deepEqual(second.pooled.retries, { 'known-failure': 1 });
});

test('an incomplete skeptic leaves the lead figures and is listed without a complete skeptic', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];

  // Act
  await suite.run(options(root, root), dependencies({ ...LEAD_FINDS_DEFECT, skepticStatus: () => 'incomplete' }, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual([report.pooled.detection.numerator, report.pooled.skepticAccuracy.denominator], [1, 0]);
  assert.deepEqual(report.skepticIncomplete, ['alpha__claude-claude-opus-5-5__r1']);
});

test('reconciliation copies a receipt or failure record left in the repository instead of dispatching again', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const runFolder = path.join(root, 'run');
  const paths = suite.runPaths(runFolder, 'alpha__claude-claude-opus-5-5__r1');
  const leave = (stage, write) => {
    const intent = JSON.parse(fs.readFileSync(paths.intent(stage), 'utf8'));
    const repository = path.join(root, `left-${stage}`);
    const directory = path.join(repository, '.nightshift/runs/reviews', intent.requestId);
    fs.mkdirSync(directory, { recursive: true });
    write(directory);
    fs.rmSync(paths.result(stage));
    fs.rmSync(paths.artifacts(stage), { recursive: true });
    fs.writeFileSync(paths.intent(stage), JSON.stringify({ ...intent, done: false, repository }));
  };
  const leadArtifacts = path.join(root, 'lead-artifacts');
  fs.cpSync(paths.artifacts('lead'), leadArtifacts, { recursive: true });
  fs.rmSync(paths.complete);
  leave('lead', directory => fs.cpSync(leadArtifacts, directory, { recursive: true }));
  leave('skeptic', directory => fs.writeFileSync(path.join(directory, 'failure.json'), JSON.stringify({ code: 'unusable-review', attempts: [{ tokens: 7 }] })));

  // Act
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const lead = JSON.parse(fs.readFileSync(paths.result('lead'), 'utf8'));
  const skeptic = JSON.parse(fs.readFileSync(paths.result('skeptic'), 'utf8'));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic']);
  assert.deepEqual([lead.outcome, lead.reportStatus, lead.attemptTokens], ['complete', 'complete', [1000]]);
  assert.deepEqual([skeptic.outcome, skeptic.code, skeptic.attemptTokens], ['failed', 'unusable-review', [7]]);
  // These repositories lie outside the temporary directory, so the harness did not make them and does not delete them.
  assert.equal(fs.existsSync(path.join(root, 'left-lead')), true);
});

test('reconciliation deletes only a repository the harness materialized, never another path a saved intent names', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  const intent = JSON.parse(fs.readFileSync(paths.intent('skeptic'), 'utf8'));
  const unrelated = path.join(root, 'precious');
  fs.mkdirSync(unrelated);
  fs.writeFileSync(path.join(unrelated, 'data.txt'), 'keep\n');
  // A directory of the repository's shape that the harness did not make, and a repository it did.
  const lookalike = fs.mkdtempSync(path.join(os.tmpdir(), 'nsr-'));
  const frozen = path.join(root, 'run', 'frozen', 'alpha');
  const owned = suite.materialize(frozen, suite.loadFixture(frozen).fixture);
  const other = suite.materialize(frozen, suite.loadFixture(frozen).fixture);
  t.after(() => [lookalike, owned.root, other.root].forEach(directory => fs.rmSync(directory, { recursive: true, force: true })));
  const lose = (repository, owner) => {
    fs.rmSync(paths.complete, { force: true });
    fs.rmSync(paths.result('skeptic'), { force: true });
    fs.writeFileSync(paths.intent('skeptic'), JSON.stringify({ ...intent, done: false, repository, owner }));
  };

  // Act
  lose(unrelated, intent.owner);
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  lose(lookalike, intent.owner);
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  lose(other.root, owned.owner);
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  lose(owned.root, owned.owner);
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.equal(fs.readFileSync(path.join(unrelated, 'data.txt'), 'utf8'), 'keep\n');
  assert.equal(fs.existsSync(lookalike), true);
  assert.equal(fs.existsSync(other.root), true);
  assert.equal(fs.existsSync(owned.root), false);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic']);
});

test('a run refuses an output folder that holds files but no manifest', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  fs.mkdirSync(path.join(root, 'run', 'frozen', 'alpha'), { recursive: true });
  fs.writeFileSync(path.join(root, 'run', 'frozen', 'alpha', 'stale.js'), 'left from an interrupted start\n');

  // Act
  const refused = suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  await assert.rejects(refused, /holds files but no manifest/);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(path.join(root, 'run', 'frozen', 'alpha', 'stale.js')), true);
});

test('--retry dispatches a lost lead again with its skeptic, counting both superseded stages', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  const intent = JSON.parse(fs.readFileSync(paths.intent('lead'), 'utf8'));
  for (const file of [paths.complete, paths.result('lead')]) fs.rmSync(file);
  fs.rmSync(paths.artifacts('lead'), { recursive: true });
  fs.writeFileSync(paths.intent('lead'), JSON.stringify({ ...intent, done: false, repository: path.join(root, 'gone') }));

  // Act
  await suite.run(options(root, root, { retry: true }), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic', 'code', 'skeptic']);
  assert.deepEqual(report.pooled.retries, { 'lost-outcome': 2 });
  assert.deepEqual(report.incomplete, []);
});

test('a fixture run whose materialized inventory misses a change file is refused before any dispatch', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha', { change: { 'src/calc.js': CHANGED_CALC, 'src/extra.js': 'module.exports = {};\n' } });
  const ignore = path.join(root, 'global-ignore');
  fs.writeFileSync(ignore, 'extra.js\n');
  const config = path.join(root, 'global-config');
  fs.writeFileSync(config, `[core]\n\texcludesFile = ${ignore.split(path.sep).join('/')}\n`);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });
  const calls = [];

  // Act
  const refused = suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  await assert.rejects(refused, /src\/extra\.js would be hidden from the reviewer/);
  assert.equal(calls.length, 0);
});

test('out-of-scope findings with required true, incidental truth and an attribution to a matched entry grade as the spec says', async t => {
  // Arrange
  const root = scratch(t);
  const incidental = defect({ id: 'I1', dimension: 'design-maintainability', file: 'src/notes.js', lines: [2, 2], symbol: undefined, consequence: 'The export list is stale.', origin: 'adjudicated:earlier-run' });
  writeFixture(root, 'alpha', { base: { 'src/calc.js': BASE_CALC, 'src/notes.js': '// Notes\nmodule.exports = { stale: true };\n' }, change: { 'src/calc.js': BASE_CALC.replace('return a + b;', 'return a + b; // unchanged') }, fixture: { defects: [], incidental: [incidental], outOfScope: [defect({ id: 'O1', dimension: 'design-maintainability', lines: [1, 1], symbol: undefined, consequence: 'The name is vague.' })], decoys: [decoy()] } });
  writeFixture(root, 'beta');
  const calls = [];
  const scenario = {
    // Alpha's lead runs first and beta's second, since fixtures run in name order.
    lead: () => calls.filter(call => call.kind === 'code').length === 2
      ? [...LEAD_FINDS_DEFECT.lead(), { id: 'L2', severity: 'important', consequence: 'Callers see wrong totals.', evidence: 'The cart total is off', required: true }]
      : [{ id: 'L1', severity: 'minor', consequence: 'Vague name.', evidence: 'src/calc.js:1 addTotal is vague', required: true }, { id: 'L3', severity: 'minor', consequence: 'Stale exports.', evidence: 'src/notes.js:2 exports', required: false }],
    verdict: () => 'confirmed',
  };
  await suite.run(options(root, root, { selected: ['alpha', 'beta'] }), dependencies(scenario, calls));
  const runFolder = path.join(root, 'run');
  fs.writeFileSync(path.join(runFolder, 'adjudications.json'), JSON.stringify({ 'beta__claude-claude-opus-5-5__r1': { L2: { outcome: 'attributed', entry: 'D1', reason: 'The same defect at its symptom' } } }));

  // Act
  const report = suite.grade(runFolder, path.join(root, 'none.json'));
  const alpha = report.fixtureRuns.find(item => item.fixture === 'alpha');
  const beta = report.fixtureRuns.find(item => item.fixture === 'beta');

  // Assert
  assert.deepEqual([report.pooled.outOfScope.numerator, report.pooled.outOfScope.requiredFalse], [1, 0]);
  assert.deepEqual([alpha.clean, alpha.unmatched, alpha.falseConfirmed], [false, [], 0]);
  assert.deepEqual([report.pooled.cleanChangeFalsePositives.denominator, report.pooled.unmatchedConfirmations.denominator], [0, 2]);
  assert.deepEqual([beta.detected, beta.attributions, beta.duplicates, beta.falseConfirmed], [1, 0, 1, 0]);
  // Alpha's verdicts: the out-of-scope finding and the decoy; the incidental match is not a skeptic pair.
  assert.equal(alpha.skepticTotal, 2);
});

test('records carry the dispatching harness hash, the report its grading hash, and a resume across a machinery change is mixed', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const sha = buffer => require('node:crypto').createHash('sha256').update(buffer).digest('hex');
  const harnessFile = path.resolve(__dirname, '../tools/seeded-defects.js');
  const launcherFile = path.resolve(__dirname, '../tools/seeded-defects/vibe-launcher.js');
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const runFolder = path.join(root, 'run');
  const paths = suite.runPaths(runFolder, 'alpha__claude-claude-opus-5-5__r1');
  const unmixed = suite.grade(runFolder, path.join(root, 'none.json'));
  for (const file of [paths.complete, paths.intent('skeptic'), paths.result('skeptic'), paths.claims]) fs.rmSync(file);
  fs.rmSync(paths.artifacts('skeptic'), { recursive: true });

  // Act
  await suite.run(options(root, root), { ...dependencies(LEAD_FINDS_DEFECT, calls), machineryHash: () => 'changed machinery' });
  const mixed = suite.grade(runFolder, path.join(root, 'none.json'));
  const lead = JSON.parse(fs.readFileSync(paths.result('lead'), 'utf8'));

  // Assert
  assert.equal(lead.identity.harness, sha(Buffer.concat([fs.readFileSync(harnessFile), Buffer.from('\0'), fs.readFileSync(launcherFile)])));
  assert.equal(unmixed.graderHash, sha(fs.readFileSync(harnessFile)));
  assert.equal(unmixed.mixed, false);
  assert.equal(mixed.mixed, true);
  assert.deepEqual(mixed.identities.map(identity => identity.machinery).sort(), ['changed machinery', 'machinery']);
});

test('a planted defect in a sibling the change leaves untouched is located in the base tree and graded', async t => {
  // Arrange
  const root = scratch(t);
  const sibling = 'function format(total) {\n  return String(total);\n}\n\nmodule.exports = { format };\n';
  writeFixture(root, 'alpha', { base: { 'src/calc.js': BASE_CALC, 'src/format.js': sibling }, fixture: { defects: [defect({ file: 'src/format.js', lines: [2, 2], symbol: 'format', consequence: 'Totals lose their currency.' })] } });
  const calls = [];
  const scenario = { lead: () => [{ id: 'L1', severity: 'important', consequence: 'No currency.', evidence: 'src/format.js:2 format drops the currency', required: true }], verdict: () => 'confirmed' };

  // Act
  const fixture = suite.loadFixture(path.join(root, 'alpha'));
  await suite.run(options(root, root), dependencies(scenario, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.equal(fixture.truth[0].file, 'src/format.js');
  assert.deepEqual([report.pooled.detection.numerator, report.pooled.detection.denominator], [1, 1]);
});

test('a reconciled dispatch with unproven host termination blocks the run until the user confirms, then settles without blocking again', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const runFolder = path.join(root, 'run');
  const paths = suite.runPaths(runFolder, 'alpha__claude-claude-opus-5-5__r1');
  const intent = JSON.parse(fs.readFileSync(paths.intent('lead'), 'utf8'));
  const repository = path.join(root, 'left-lead');
  fs.mkdirSync(path.join(repository, '.nightshift/runs/reviews', intent.requestId), { recursive: true });
  fs.writeFileSync(path.join(repository, '.nightshift/runs/reviews', intent.requestId, 'failure.json'), JSON.stringify({ code: 'termination-unverified', attempts: [{ tokens: 9 }] }));
  for (const file of [paths.complete, paths.result('lead')]) fs.rmSync(file);
  fs.rmSync(paths.artifacts('lead'), { recursive: true });
  fs.writeFileSync(paths.intent('lead'), JSON.stringify({ ...intent, done: false, repository }));

  // Act
  const blocked = await suite.run(options(root, root, { retry: true }), dependencies(LEAD_FINDS_DEFECT, calls));
  const blocking = JSON.parse(fs.readFileSync(path.join(runFolder, 'blocking.json'), 'utf8'));
  const refused = suite.run(options(root, root, { retry: true }), dependencies(LEAD_FINDS_DEFECT, calls));
  await assert.rejects(refused, /termination-checked/);
  const confirmed = await suite.run(options(root, root, { terminationChecked: true }), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.match(blocked.stopped, /termination is unproven/);
  assert.deepEqual([blocking.requestId, blocking.repository], [intent.requestId, repository]);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic']);
  assert.equal(confirmed.stopped, null);
  assert.equal(fs.existsSync(path.join(runFolder, 'blocking.json')), false);
  assert.equal(JSON.parse(fs.readFileSync(paths.result('lead'), 'utf8')).unproven, true);
  assert.equal(fs.existsSync(repository), true);
});

test('a settlement interrupted after its blocking record settles without blocking again once termination is confirmed, and the report shows an active block', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const runFolder = path.join(root, 'run');
  const key = 'alpha__claude-claude-opus-5-5__r1';
  const paths = suite.runPaths(runFolder, key);
  const intent = JSON.parse(fs.readFileSync(paths.intent('lead'), 'utf8'));
  const repository = path.join(root, 'left-lead');
  fs.mkdirSync(path.join(repository, '.nightshift/runs/reviews', intent.requestId), { recursive: true });
  fs.writeFileSync(path.join(repository, '.nightshift/runs/reviews', intent.requestId, 'failure.json'), JSON.stringify({ code: 'termination-unverified', attempts: [{ tokens: 9 }] }));
  for (const file of [paths.complete, paths.result('lead')]) fs.rmSync(file);
  fs.rmSync(paths.artifacts('lead'), { recursive: true });
  // Interrupted after the blocking record and before the result: the intent is still pending.
  fs.writeFileSync(paths.intent('lead'), JSON.stringify({ ...intent, done: false, repository }));
  fs.writeFileSync(path.join(runFolder, 'blocking.json'), JSON.stringify({ fixtureRun: key, stage: 'lead', requestId: intent.requestId, repository, recorded: '2026-10-24T00:00:00.000Z' }));

  // Act
  const blockedReport = suite.grade(runFolder, path.join(root, 'none.json'));
  const blockedText = fs.readFileSync(path.join(runFolder, 'report.md'), 'utf8');
  const confirmed = await suite.run(options(root, root, { terminationChecked: true }), dependencies(LEAD_FINDS_DEFECT, calls));
  const settledReport = suite.grade(runFolder, path.join(root, 'none.json'));

  // Assert
  assert.equal(blockedReport.blocking.repository, repository);
  assert.match(blockedText, /Blocked: host termination is unproven for alpha__claude-claude-opus-5-5__r1 lead/);
  assert.equal(confirmed.stopped, null);
  assert.equal(fs.existsSync(path.join(runFolder, 'blocking.json')), false);
  assert.equal(JSON.parse(fs.readFileSync(paths.result('lead'), 'utf8')).unproven, true);
  assert.equal(settledReport.blocking, null);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'skeptic']);
});

test('a reconciled evaluated-host dispatch keeps its evaluation attribution', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const evaluated = { host: 'vibe', id: 'glm-5-3' };
  await suite.run(options(root, root, { models: [evaluated] }), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), suite.fixtureRunKey('alpha', evaluated, 1));
  const intent = JSON.parse(fs.readFileSync(paths.intent('lead'), 'utf8'));
  const repository = path.join(root, 'left-lead');
  fs.cpSync(paths.artifacts('lead'), path.join(repository, '.nightshift/runs/reviews', intent.requestId), { recursive: true });
  fs.rmSync(paths.complete);
  fs.rmSync(paths.result('lead'));
  fs.writeFileSync(paths.intent('lead'), JSON.stringify({ ...intent, done: false, repository }));

  // Act
  await suite.run(options(root, root, { models: [evaluated] }), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.result('lead'), 'utf8')).evaluation, { host: 'vibe', model: 'glm-5-3', gateCandidate: { host: 'codex', model: 'gpt-6-sol' } });
  assert.equal(calls.length, 2);
});

test('the lead repository is gone before the skeptic dispatch starts', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const seen = [];
  const scenario = { ...LEAD_FINDS_DEFECT, verdict: claim => (seen.push(fs.existsSync(calls[0].options.protectedRoot)), LEAD_FINDS_DEFECT.verdict(claim)) };

  // Act
  await suite.run(options(root, root), dependencies(scenario, calls));

  // Assert
  assert.ok(seen.length > 0);
  assert.deepEqual([...new Set(seen)], [false]);
});

test('a fixture whose only truth is incidental is not clean and counts among the other fixtures', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha', { fixture: { defects: [], incidental: [defect({ id: 'I1', origin: 'adjudicated:earlier-run' })], decoys: [decoy()] } });
  const calls = [];

  // Act
  await suite.run(options(root, root), dependencies({ ...LEAD_FINDS_DEFECT, verdict: () => 'confirmed' }, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));
  const run = report.fixtureRuns[0];

  // Assert
  assert.deepEqual([run.clean, run.planted, run.unmatched, run.falseConfirmed], [false, 0, [], 0]);
  assert.deepEqual([report.pooled.cleanChangeFalsePositives.denominator, report.pooled.unmatchedConfirmations.denominator], [0, 1]);
  assert.equal(report.pooled.detection.denominator, 0);
});

test('a fixture name holding the key separator is refused', t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'a__vibe-foo');

  // Act and Assert
  assert.throws(() => suite.loadSuite(root, ['a__vibe-foo']), /fixture name must be/);
});

test('a contamination token in the requirements or in rules.md refuses the run', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'tainted', { fixture: { requirements: 'Follow the seeded-defects notes.' } });
  writeFixture(root, 'alpha');
  const calls = [];
  const rules = path.join(root, 'tainted-rules.md');
  fs.writeFileSync(rules, 'Read fixture.json first.\n');

  // Act
  const refused = suite.run(options(root, root, { rules }), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.throws(() => suite.loadFixture(path.join(root, 'tainted')), /supplied text contains seeded-defects/);
  await assert.rejects(refused, /rules\.md contains fixture\.json/);
  assert.equal(calls.length, 0);
});

test('a bug origin counts toward the composition rules only when it names a bug entry', t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha', { fixture: { defects: [defect({ origin: 'Totals subtract the fee' })] } });
  const fixtures = [suite.loadFixture(path.join(root, 'alpha'))];

  // Act
  const unknown = suite.compositionProblems(fixtures, new Set(['Another bug']));
  const known = suite.compositionProblems(fixtures, new Set(['Totals subtract the fee']));

  // Assert
  assert.ok(unknown.some(problem => problem.includes('names no BUGS.md or BUGS_HISTORY.md entry')));
  assert.equal(known.some(problem => problem.includes('names no')), false);
});

test('a section heading of the bug index is no entry title for an origin', t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'section', { fixture: { defects: [defect({ origin: 'Current' })] } });
  writeFixture(root, 'entry', { fixture: { defects: [defect({ origin: 'Registry lock holds grow with session bindings' })] } });

  // Act
  const section = suite.compositionProblems([suite.loadFixture(path.join(root, 'section'))]);
  const entry = suite.compositionProblems([suite.loadFixture(path.join(root, 'entry'))]);

  // Assert
  assert.ok(section.some(problem => problem.includes('"Current" names no')));
  assert.equal(entry.some(problem => problem.includes('names no')), false);
});

test('the harness writes nothing in the checkout outside its run folder', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const status = () => spawnSync('git', ['status', '--porcelain', '--untracked-files=all', '--', '.', ':!.tmp'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).stdout;
  const before = status();

  // Act
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.equal(status(), before);
});
