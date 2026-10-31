'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const suite = require('../tools/seeded-defects');
const { buildPrompt, dispatchReview } = require('../internal/runtime/review');
const { DIMENSIONS } = require('../internal/runtime/lifecycle');
const { pathIsContained } = require('../internal/filesystem-primitives');

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
// The attribution files a Vibe attempt leaves: its export and the one generation of its session journal.
function vibeAttribution(options) {
  const exportDirectory = path.join(options.artifacts, 'vibe');
  const state = path.join(exportDirectory, 'session', 'generations', '0000000000000000', 'runtime-state.json');
  writeTree(exportDirectory, { 'export.json': JSON.stringify({ session_id: 's1', outcome: 'finished', vibe_version: '3.0.0' }), 'session/generations/0000000000000000/runtime-state.json': JSON.stringify({ session_metadata: { active_model: options.model } }) });

  return { version: '3.0.0', uncomparedKeys: [], attributionFiles: [path.join(exportDirectory, 'export.json'), state] };
}

function mockAgent(scenario, calls) {
  return async options => {
    const request = requestOf(options);
    const probeFolder = path.join(options.cwd, 'context', 'probes');
    const evidence = fs.existsSync(probeFolder) ? fs.readdirSync(probeFolder).sort().map(file => JSON.parse(fs.readFileSync(path.join(probeFolder, file), 'utf8'))) : [];
    calls.push({ kind: request.kind, request, options, evidence });
    fs.mkdirSync(options.artifacts, { recursive: true });
    // A scenario's failure stands for a host that did not start; a real host runner reports its process as it spawns.
    if (scenario.throwFor?.(request)) throw Object.assign(new Error('host failed'), { code: 'unusable-review', tokens: 5 });
    options.onProcess?.(4242);
    // A host that started, spent tokens and then failed, with its termination proven.
    if (scenario.failAfterLaunch?.(request)) return { host: options.host, model: options.model, effort: options.effort, session: 's1', attributionVerified: true, status: 'failed', output: null, tokens: 777, hostFailure: 'host crashed', exit: { code: 1, descendantsReclaimed: true } };
    let report;
    if (request.kind === 'skeptic') {
      const status = scenario.skepticStatus?.(request) ?? 'complete';
      report = { requestId: request.id, status, coverage: [], findings: request.findings.map(claim => ({ id: claim.id, verdict: scenario.verdict(claim), evidence: 'Checked the cited line', value: 'Worth fixing', repairProposal: 'Restore the addition' })), probes: status === 'incomplete' ? [{ id: 'p1', purpose: 'run the test', executable: 'node', args: ['-v'], timeoutMs: 1000, files: [] }] : [], summary: 'Claims checked', toolFailure: '' };
    } else {
      const findings = scenario.lead(request);
      const status = scenario.leadStatus?.(request, evidence) ?? 'complete';
      // An incomplete lead requests the scenario's probes, and none by default.
      report = { requestId: request.id, status, coverage: DIMENSIONS.code.map(dimension => ({ dimension, evidence: 'Assessed' })), findings, probes: status === 'incomplete' ? scenario.leadProbes?.(request) ?? [] : [], summary: 'Lead assessment', toolFailure: '', closures: [], positions: [] };
    }
    const events = [{ type: 'assistant', session_id: 's1', message: { model: options.model, content: [] } }, { type: 'result', session_id: 's1', subtype: 'success', is_error: false, structured_output: report, note: scenario.eventNote?.(request) ?? '' }];
    fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');

    return { host: options.host, model: options.model, effort: options.effort, session: 's1', attributionVerified: true, status: 'complete', output: report, tokens: scenario.tokens ? scenario.tokens(request) : 1000, ...(scenario.exit ? { exit: scenario.exit(request) } : {}), ...(options.host === 'vibe' ? { vibe: vibeAttribution(options) } : {}) };
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
  // Both sides are real paths, and the repository's own containment check treats a cross-drive path, as on a runner with the checkout
  // on D: and the temporary directory on C:, as outside, unlike a bare '..' prefix test, which a child named '..foo' would also pass.
  const checkout = fs.realpathSync.native(path.resolve(__dirname, '..'));
  assert.equal(pathIsContained(checkout, repository.root) || repository.root === checkout, false);
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

test('a Vibe lead runs as an admitted candidate while a Vibe skeptic passes the gate as its gate candidate, and the records name both', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const evaluated = { host: 'vibe', id: 'glm-5-3' };

  // Act
  const result = await suite.run(options(root, root, { models: [evaluated] }), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'no-targets.json'));
  const key = suite.fixtureRunKey('alpha', evaluated, 1);
  const read = file => JSON.parse(fs.readFileSync(path.join(root, 'run', 'runs', key, file), 'utf8'));
  const [lead, skeptic, leadReceipt, skepticReceipt] = ['lead.result.json', 'skeptic.result.json', 'lead/receipt.json', 'skeptic/receipt.json'].map(read);

  // Assert
  assert.equal(result.stopped, null);
  assert.deepEqual(calls.map(call => [call.kind, call.options.host, call.options.model]), [['code', 'vibe', 'glm-5-3'], ['skeptic', 'vibe', 'glm-5-3']]);
  assert.equal(lead.evaluation, undefined);
  assert.deepEqual(skeptic.evaluation, { host: 'vibe', model: 'glm-5-3', gateCandidate: { host: 'codex', model: 'gpt-6-sol' } });
  assert.deepEqual([leadReceipt.host, leadReceipt.model, leadReceipt.attempts[0].host], ['vibe', 'glm-5-3', 'vibe']);
  assert.deepEqual([skepticReceipt.host, skepticReceipt.model, skepticReceipt.attempts[0].host, skepticReceipt.attempts[0].model], ['vibe', 'glm-5-3', 'codex', 'gpt-6-sol']);
  assertVibePrompts(calls);
  assert.deepEqual(Object.keys(report.byModel), ['vibe:glm-5-3']);
});

// Every Vibe stage, direct or behind a gate candidate, gets the prompt the runtime builds for a Vibe host.
function assertVibePrompts(calls) {
  for (const call of calls) {
    assert.equal(call.options.prompt, buildPrompt(call.request, { workspace: call.options.cwd, host: 'vibe' }));
    assert.match(call.options.prompt, /Your run_typescript sandbox/);
  }
}

test('a Vibe model no family admits passes the gate as its gate candidate in both stages, and the records name it', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const evaluated = { host: 'vibe', id: 'mistral-large-4' };
  const gateCandidate = { host: 'codex', model: 'gpt-6-sol' };

  // Act
  const result = await suite.run(options(root, root, { models: [evaluated] }), dependencies(LEAD_FINDS_DEFECT, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'no-targets.json'));
  const key = suite.fixtureRunKey('alpha', evaluated, 1);
  const read = file => JSON.parse(fs.readFileSync(path.join(root, 'run', 'runs', key, file), 'utf8'));
  const [lead, skeptic, leadReceipt] = ['lead.result.json', 'skeptic.result.json', 'lead/receipt.json'].map(read);

  // Assert
  assert.equal(result.stopped, null);
  assert.deepEqual(calls.map(call => [call.kind, call.options.host, call.options.model]), [['code', 'vibe', 'mistral-large-4'], ['skeptic', 'vibe', 'mistral-large-4']]);
  assert.deepEqual([lead.evaluation, skeptic.evaluation], [{ host: 'vibe', model: 'mistral-large-4', gateCandidate }, { host: 'vibe', model: 'mistral-large-4', gateCandidate }]);
  assert.deepEqual([leadReceipt.host, leadReceipt.model, leadReceipt.attempts[0].host, leadReceipt.attempts[0].model], ['vibe', 'mistral-large-4', 'codex', 'gpt-6-sol']);
  assertVibePrompts(calls);
  assert.deepEqual(Object.keys(report.byModel), ['vibe:mistral-large-4']);
});

test('an evaluated stage whose saved request does not rebuild the runtime prompt fails before its host starts', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const base = dependencies(LEAD_FINDS_DEFECT, calls);
  // A runtime that builds its prompt from more than it saves, standing in for request fields the rebuild cannot see.
  const drifting = { ...base, dispatchReview: (project, dispatch, injected) => dispatchReview(project, dispatch, { ...injected, runAgent: agent => injected.runAgent({ ...agent, prompt: `${agent.prompt}Unsaved rule.\n` }) }) };

  // Act
  const result = await suite.run(options(root, root, { models: [{ host: 'vibe', id: 'mistral-large-4' }] }), drifting);
  const paths = suite.runPaths(path.join(root, 'run'), suite.fixtureRunKey('alpha', { host: 'vibe', id: 'mistral-large-4' }, 1));
  const record = JSON.parse(fs.readFileSync(paths.result('lead'), 'utf8'));

  // Assert
  assert.equal(calls.length, 0);
  assert.deepEqual([record.outcome, record.code, record.prelaunch], ['failed', 'evaluation-prompt-drift', true]);
  assert.equal(result.stopped, null);
  assert.equal(result.spending.spent, 0);
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

const NODE_VERSION_PROBE = { id: 'p1', purpose: 'print the Node version', executable: 'node', args: ['--version'], timeoutMs: 30000, files: [] };
// A lead that requests a probe until it has received probe evidence, then finds the defect.
const PROBING_LEAD = { ...LEAD_FINDS_DEFECT, leadStatus: (_request, evidence) => evidence.length ? 'complete' : 'incomplete', leadProbes: () => [NODE_VERSION_PROBE] };

test('a lead requesting probes awaits a decision, and approved probes run contained before a fresh probed lead that is graded', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const key = suite.fixtureRunKey('alpha', MODEL, 1);
  const paths = suite.runPaths(path.join(root, 'run'), key);

  // Act
  const first = await suite.run(options(root, root), dependencies(PROBING_LEAD, calls));
  const waiting = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));
  const retried = await suite.run(options(root, root, { retry: true }), dependencies(PROBING_LEAD, calls));
  const callsBeforeApproval = calls.length;
  const approved = await suite.run(options(root, root, { approveProbes: [key] }), dependencies(PROBING_LEAD, calls));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const probed = read(paths.result('probed'));
  const result = read(paths.probeResult(1));

  // Assert
  assert.deepEqual([first.awaitingProbes, retried.awaitingProbes, callsBeforeApproval], [[key], [key], 1]);
  assert.deepEqual([first.pendingProbes, approved.pendingProbes], [{ [key]: paths.pending }, {}]);
  assert.deepEqual(read(paths.pending).probes, [NODE_VERSION_PROBE]);
  assert.deepEqual([waiting.incomplete, waiting.awaitingProbes, waiting.probed], [[key], [key], []]);
  assert.deepEqual(approved.awaitingProbes, []);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'code', 'skeptic']);
  assert.notEqual(calls[1].request.id, calls[0].request.id);
  assert.deepEqual(calls[1].evidence.map(item => [item.probeId, item.exitCode, item.canonicalUnchanged]), [['p1', 0, true]]);
  assert.match(calls[1].evidence[0].output, /^v\d+\./);
  assert.match(calls[1].options.prompt, /Returned probe evidence for this assessment: context\/probes\/1\.json/);
  assert.deepEqual(calls[2].request.findings.map(claim => claim.evidence).sort(), [decoy().evidence, 'src/calc.js:3 addTotal subtracts b'].sort());
  assert.deepEqual([result.exitCode, probed.probes, read(paths.decision).decision], [0, [{ id: 'p1', result: '1.result.json' }], 'approved']);
  assert.match(result.copy, /^\.nightshift\/runs\/c\/[0-9a-f]{8}$/);
  assert.ok(probed.probeElapsedMs <= probed.elapsedMs);
  assert.deepEqual([report.incomplete, report.probed, report.pooled.detection.value], [[], [key], 1]);
  assert.equal(report.pooled.tokensPerFixture.value, 3000);
  assert.match(fs.readFileSync(path.join(root, 'run', 'report.md'), 'utf8'), new RegExp(`Graded with executed probes: ${key}\\.`));
});

test('declined probes leave the lead incomplete for --retry, and a decision on no pending probes or on both sides is refused', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  let probing = true;
  const scenario = { ...LEAD_FINDS_DEFECT, leadStatus: () => probing ? 'incomplete' : 'complete', leadProbes: () => [NODE_VERSION_PROBE] };
  const key = suite.fixtureRunKey('alpha', MODEL, 1);
  const paths = suite.runPaths(path.join(root, 'run'), key);

  // Act
  await suite.run(options(root, root), dependencies(scenario, calls));
  const both = suite.run(options(root, root, { approveProbes: [key], declineProbes: [key] }), dependencies(scenario, calls));
  const unknown = suite.run(options(root, root, { approveProbes: ['beta__claude-claude-opus-5-5__r1'] }), dependencies(scenario, calls));
  await assert.rejects(both, { code: 'invalid-arguments' });
  await assert.rejects(unknown, { code: 'probes-not-pending' });
  const declined = await suite.run(options(root, root, { declineProbes: [key] }), dependencies(scenario, calls));
  const graded = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));
  const again = suite.run(options(root, root, { declineProbes: [key] }), dependencies(scenario, calls));
  await assert.rejects(again, { code: 'probes-not-pending' });
  probing = false;
  await suite.run(options(root, root, { retry: true }), dependencies(scenario, calls));
  const retried = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));
  const superseded = fs.readdirSync(paths.superseded).map(entry => path.join(paths.superseded, entry));

  // Assert
  assert.deepEqual(declined.awaitingProbes, []);
  assert.deepEqual([graded.incomplete, graded.awaitingProbes], [[key], []]);
  assert.deepEqual(calls.map(call => call.kind), ['code', 'code', 'skeptic']);
  assert.deepEqual([retried.incomplete, retried.probed, retried.pooled.retries], [[], [], { 'incomplete-report': 1 }]);
  assert.equal(fs.existsSync(paths.probes), false);
  assert.ok(fs.existsSync(path.join(superseded[0], 'probes', 'decision.json')));
});

test('approved probes whose pending record changed are refused, and a probed lead with no evidence settles without dispatching', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  writeFixture(root, 'beta');
  const calls = [];
  // The runtime refuses a timeout below its floor, so this probe yields no evidence.
  const scenario = { ...PROBING_LEAD, leadProbes: () => [{ ...NODE_VERSION_PROBE, timeoutMs: 1000 }] };
  const [alpha, beta] = ['alpha', 'beta'].map(name => suite.fixtureRunKey(name, MODEL, 1));
  const paths = suite.runPaths(path.join(root, 'run'), alpha);
  const selected = { selected: ['alpha', 'beta'] };

  // Act
  await suite.run(options(root, root, selected), dependencies(scenario, calls));
  await suite.run(options(root, root, { ...selected, approveProbes: [beta] }), dependencies(scenario, calls));
  // A decision recorded by an earlier invocation over a pending record that has since changed.
  suite.writeJson(paths.decision, { decision: 'approved', pendingSha256: 'another', decided: new Date().toISOString() });
  const altered = suite.run(options(root, root, selected), dependencies(scenario, calls));
  await assert.rejects(altered, { code: 'probes-altered' });
  const probed = JSON.parse(fs.readFileSync(suite.runPaths(path.join(root, 'run'), beta).result('probed'), 'utf8'));
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.deepEqual(calls.map(call => call.kind), ['code', 'code']);
  assert.deepEqual([probed.outcome, probed.code, probed.prelaunch, probed.attemptTokens], ['failed', 'probes-not-run', true, []]);
  assert.deepEqual(probed.probes.map(probe => [probe.id, probe.code]), [['p1', 'invalid-probe-timeout']]);
  assert.deepEqual([report.incomplete.sort(), report.probed], [[alpha, beta].sort(), []]);
  assert.equal(fs.existsSync(paths.result('probed')), false);
});

test('a probe whose descendants are not reclaimed blocks the run with its repository kept', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const key = suite.fixtureRunKey('alpha', MODEL, 1);
  const paths = suite.runPaths(path.join(root, 'run'), key);
  const unproven = async () => { throw Object.assign(new Error('Guarded operation descendants could not be reconciled'), { code: 'operation-termination-unverified' }); };
  const injected = { ...dependencies(PROBING_LEAD, calls), probeRunner: unproven };

  // Act
  await suite.run(options(root, root), injected);
  const result = await suite.run(options(root, root, { approveProbes: [key] }), injected);
  const blocking = JSON.parse(fs.readFileSync(path.join(root, 'run', 'blocking.json'), 'utf8'));
  t.after(() => fs.rmSync(blocking.repository, { recursive: true, force: true }));
  const probed = JSON.parse(fs.readFileSync(paths.result('probed'), 'utf8'));

  // Assert
  assert.match(result.stopped, /Host termination is unproven/);
  assert.deepEqual([blocking.fixtureRun, blocking.stage], [key, 'probed']);
  assert.ok(fs.existsSync(blocking.repository));
  assert.deepEqual([probed.code, probed.unproven, probed.probes[0].code], ['termination-unverified', true, 'operation-termination-unverified']);
  assert.deepEqual(calls.map(call => call.kind), ['code']);
});

test('an evaluated probed lead receives the Vibe prompt naming its probe evidence', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const evaluated = { host: 'vibe', id: 'mistral-large-4' };
  const key = suite.fixtureRunKey('alpha', evaluated, 1);
  const succeeds = async (_root, check) => ({ ...check, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), exitCode: 0, error: null, output: 'v22.23.0\n' });
  const injected = { ...dependencies(PROBING_LEAD, calls), probeRunner: succeeds };

  // Act
  await suite.run(options(root, root, { models: [evaluated] }), injected);
  const result = await suite.run(options(root, root, { models: [evaluated], approveProbes: [key] }), injected);
  const probed = calls[1];

  // Assert
  assert.equal(result.stopped, null);
  assert.deepEqual(calls.map(call => [call.kind, call.options.host]), [['code', 'vibe'], ['code', 'vibe'], ['skeptic', 'vibe']]);
  assert.equal(probed.options.prompt, buildPrompt(probed.request, { workspace: probed.options.cwd, host: 'vibe', probeFiles: ['context/probes/1.json'] }));
  assert.match(probed.options.prompt, /Your run_typescript sandbox/);
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
  const probedIdentity = { identities: [{ machinery: 'm2', harness: 'h1', commit: 'c1', hostVersion: 'v1' }] };
  for (const [name, value] of [['base', report()], ['prompt', report({ identities: [{ machinery: 'm2', harness: 'h1', commit: 'c2', hostVersion: 'v2' }] })], ['both', report({ identities: [{ machinery: 'm2', harness: 'h1', commit: 'c1', hostVersion: 'v1' }], rulesHash: 'r2' })], ['probed', report({ ...probedIdentity, probed: ['alpha__claude-claude-opus-5-5__r1'] })]]) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'report.json'), JSON.stringify({ ...value, pooled: { ...value.pooled, provisional: false } }));
  }

  // Act
  const prompt = suite.compare(path.join(root, 'base'), path.join(root, 'prompt'));
  const both = suite.compare(path.join(root, 'base'), path.join(root, 'both'));
  const probed = suite.compare(path.join(root, 'base'), path.join(root, 'probed'));

  // Assert
  assert.deepEqual(prompt.confounded, []);
  assert.deepEqual(prompt.informational.hostVersions.sort(), ['v1', 'v2']);
  assert.equal(both.confounded.length, 1);
  assert.match(both.confounded[0], /more than one varied input/);
  assert.deepEqual(probed.confounded, ['fixture runs graded with executed probes (baseline 0, later 1)']);
});

test('a comparison counts a changed dispatching harness as a confound and gives each change beside the spread and the targets', t => {
  // Arrange
  const root = scratch(t);
  const pooled = values => ({ ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])), detectionByDimension: { 'correctness-integration': { value: 1 } }, provisional: false });
  const base = { fixtureSetHash: 'f1', graderHash: 'g1', rulesHash: 'r1', mixed: false, identities: [{ machinery: 'm1', harness: 'h1', commit: 'c1', hostVersion: 'v1' }], byModel: { 'claude:claude-opus-5-5': { spread: { unmatchedConfirmations: { min: 0.1, max: 0.2 } } } }, pooled: pooled({ unmatchedConfirmations: 0.15, tokensPerFixture: 50000 }) };
  const reports = {
    base,
    small: { ...base, identities: [{ machinery: 'm2', harness: 'h1', commit: 'c2', hostVersion: 'v1' }], pooled: pooled({ unmatchedConfirmations: 0.2, tokensPerFixture: 56000 }), targets: { status: 'none' } },
    large: { ...base, identities: [{ machinery: 'm2', harness: 'h1', commit: 'c2', hostVersion: 'v1' }], pooled: pooled({ unmatchedConfirmations: 0.4, tokensPerFixture: 50000 }) },
    harness: { ...base, identities: [{ machinery: 'm1', harness: 'h2', commit: 'c2', hostVersion: 'v1' }] },
    incomplete: { ...base, incomplete: ['alpha__claude-claude-opus-5-5__r2'] },
    skeptic: { ...base, skepticIncomplete: ['alpha__claude-claude-opus-5-5__r1'] },
  };
  for (const [name, value] of Object.entries(reports)) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'report.json'), JSON.stringify(value));
  }

  // The current targets file supplies the target, not the snapshot the later report took when it was graded.
  const targetsFile = path.join(root, 'targets.json');
  fs.writeFileSync(targetsFile, JSON.stringify({ baseline: 'b', fixtureSetHash: 'f1', figures: { unmatchedConfirmations: 0.2 } }));

  // Act
  const small = suite.compare(path.join(root, 'base'), path.join(root, 'small'), targetsFile);
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

test('a failed dispatch whose host started but that left no failure record makes spending unknown, not zero', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  // As when the runtime's write of failure.json fails after a host ran: the attempt folder exists and the error still propagates.
  const failing = { ...dependencies(LEAD_FINDS_DEFECT, []), dispatchReview: async (repository, request) => {
    fs.mkdirSync(path.join(repository, '.nightshift/runs/reviews', request.id, 'attempt-1'), { recursive: true });
    request.onProcess(1234);
    throw Object.assign(new Error('host failed; recording failure.json failed: disk full'), { code: 'unusable-review' });
  } };

  // Act
  const result = await suite.run(options(root, root), failing);
  const record = JSON.parse(fs.readFileSync(suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1').result('lead'), 'utf8'));

  // Assert
  assert.deepEqual([record.outcome, record.prelaunch, record.attemptTokens], ['failed', undefined, [null]]);
  assert.match(result.stopped, /recorded no tokens/);
  assert.equal(result.spending.unknown, true);
});

test('a host that launched and then failed is charged the tokens its failure record holds', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const scenario = { ...LEAD_FINDS_DEFECT, failAfterLaunch: request => request.kind === 'code' };

  // Act
  const result = await suite.run(options(root, root), dependencies(scenario, calls));
  const record = JSON.parse(fs.readFileSync(suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1').result('lead'), 'utf8'));

  // Assert
  assert.deepEqual([record.outcome, record.prelaunch, record.attemptTokens], ['failed', undefined, [777]]);
  assert.equal(result.stopped, null);
  assert.deepEqual([result.spending.spent, result.spending.unknown], [777, false]);
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
  const intent = JSON.parse(fs.readFileSync(paths.intent('skeptic'), 'utf8'));
  const repository = path.join(root, 'left-skeptic');
  fs.cpSync(paths.artifacts('skeptic'), path.join(repository, '.nightshift/runs/reviews', intent.requestId), { recursive: true });
  fs.rmSync(paths.complete);
  fs.rmSync(paths.result('skeptic'));
  fs.writeFileSync(paths.intent('skeptic'), JSON.stringify({ ...intent, done: false, repository }));

  // Act
  await suite.run(options(root, root, { models: [evaluated] }), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  assert.deepEqual(JSON.parse(fs.readFileSync(paths.result('skeptic'), 'utf8')).evaluation, { host: 'vibe', model: 'glm-5-3', gateCandidate: { host: 'codex', model: 'gpt-6-sol' } });
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

test('the loader refuses a .git path and a linked entry in a fixture tree', t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'gitdir', { base: { 'src/calc.js': BASE_CALC, '.git/config': '[filter "x"]\n\tclean = calc\n' } });
  writeFixture(root, 'linked');
  fs.mkdirSync(path.join(root, 'outside'));
  fs.symlinkSync(path.join(root, 'outside'), path.join(root, 'linked', 'base', 'elsewhere'), 'junction');

  writeFixture(root, 'upper', { base: { 'src/calc.js': BASE_CALC, '.GIT/config': '[core]\n' } });
  writeFixture(root, 'ignore', { change: { 'src/calc.js': CHANGED_CALC, 'src/.Gitignore': 'x\n' } });

  // Act and Assert
  assert.throws(() => suite.loadFixture(path.join(root, 'gitdir')), /\.git\/config lies in a \.git folder/);
  assert.throws(() => suite.loadFixture(path.join(root, 'linked')), /base\/elsewhere is a link or special file/);
  assert.throws(() => suite.loadFixture(path.join(root, 'upper')), /\.GIT\/config lies in a \.git folder/);
  assert.throws(() => suite.loadFixture(path.join(root, 'ignore')), /src\/\.Gitignore would be hidden/);
});

test('a control record write interrupted partway leaves the earlier record and no partial file', t => {
  // Arrange
  const root = scratch(t);
  const file = path.join(root, 'blocking.json');
  suite.writeJson(file, { attempt: 1 });
  const original = fs.writeFileSync;
  fs.writeFileSync = (target, content) => {
    original(target, String(content).slice(0, 5));
    throw new Error('disk full');
  };
  t.after(() => { fs.writeFileSync = original; });

  // Act
  assert.throws(() => suite.writeJson(file, { attempt: 2 }), /disk full/);
  fs.writeFileSync = original;

  // Assert
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { attempt: 1 });
  assert.deepEqual(fs.readdirSync(root), ['blocking.json']);
});

test('resume and grading refuse a frozen copy or rules.md that no longer matches the manifest', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const runFolder = path.join(root, 'run');
  const frozenCalc = path.join(runFolder, 'frozen', 'alpha', 'change', 'src', 'calc.js');
  const original = fs.readFileSync(frozenCalc, 'utf8');
  fs.appendFileSync(frozenCalc, '// edited after the run started\n');

  // Act
  const resumed = suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  await assert.rejects(resumed, /frozen fixtures no longer match/);
  assert.throws(() => suite.grade(runFolder, path.join(root, 'none.json')), /frozen fixtures no longer match/);
  fs.writeFileSync(frozenCalc, original);
  fs.appendFileSync(path.join(runFolder, 'rules.md'), 'Another rule.\n');
  assert.throws(() => suite.grade(runFolder, path.join(root, 'none.json')), /rules\.md no longer matches/);
  await assert.rejects(suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls)), /rules\.md no longer matches/);
});

test('a stage retried under another machinery hash leaves the run mixed', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  let failing = true;
  const scenario = { ...LEAD_FINDS_DEFECT, throwFor: request => failing && request.kind === 'code' };
  await suite.run(options(root, root), dependencies(scenario, calls));
  failing = false;

  // Act
  await suite.run(options(root, root, { retry: true }), { ...dependencies(scenario, calls), machineryHash: () => 'retry machinery' });
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.equal(report.mixed, true);
  assert.deepEqual([...new Set(report.identities.map(identity => identity.machinery))].sort(), ['machinery', 'retry machinery']);
});

test('two supersessions with the same timestamp keep separate folders', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const scenario = { ...LEAD_FINDS_DEFECT, leadStatus: () => 'incomplete' };
  const original = Date.prototype.toISOString;
  Date.prototype.toISOString = () => '2026-10-24T00:00:00.000Z';
  t.after(() => { Date.prototype.toISOString = original; });

  // Act
  await suite.run(options(root, root), dependencies(scenario, calls));
  await suite.run(options(root, root, { retry: true }), dependencies(scenario, calls));
  await suite.run(options(root, root, { retry: true }), dependencies(scenario, calls));
  Date.prototype.toISOString = original;
  const report = suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.equal(fs.readdirSync(suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1').superseded).length, 2);
  assert.deepEqual(report.pooled.retries, { 'incomplete-report': 2 });
  assert.equal(suite.spending(path.join(root, 'run')).spent, 3000);
});

test('the loader refuses a tree root that is itself a link', t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const outside = path.join(root, 'outside');
  fs.renameSync(path.join(root, 'alpha', 'base'), outside);
  fs.symlinkSync(outside, path.join(root, 'alpha', 'base'), 'junction');

  writeFixture(root, 'dangling');
  fs.rmSync(path.join(root, 'dangling', 'change'), { recursive: true });
  const gone = path.join(root, 'gone');
  fs.mkdirSync(gone);
  fs.symlinkSync(gone, path.join(root, 'dangling', 'change'), 'junction');
  fs.rmSync(gone, { recursive: true });

  // Act and Assert
  assert.throws(() => suite.loadFixture(path.join(root, 'alpha')), /alpha: base is a link or special file/);
  assert.throws(() => suite.loadFixture(path.join(root, 'dangling')), /dangling: change is a link or special file/);
});

test('a run that passes its budget on its last dispatch reports the overrun', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  const scenario = { ...LEAD_FINDS_DEFECT, tokens: request => request.kind === 'skeptic' ? 3000000 : 100 };

  // Act
  const result = await suite.run(options(root, root, { budget: 2000000 }), dependencies(scenario, calls));

  // Assert
  assert.equal(result.stopped, null);
  assert.deepEqual([result.budget, result.spending.spent, result.overrun], [2000000, 3000100, 1000100]);
});

test('a comparison of the same models in another order does not vary the models', t => {
  // Arrange
  const root = scratch(t);
  const report = models => ({ fixtureSetHash: 'f1', graderHash: 'g1', rulesHash: 'r1', mixed: false, identities: [{ machinery: 'm1', harness: 'h1', commit: 'c1', hostVersion: 'v1' }], byModel: Object.fromEntries(models.map(model => [model, {}])), pooled: { detection: { value: 1 }, provisional: false } });
  for (const [name, models] of [['ab', ['a:x', 'b:y']], ['ba', ['b:y', 'a:x']]]) {
    fs.mkdirSync(path.join(root, name));
    fs.writeFileSync(path.join(root, name, 'report.json'), JSON.stringify(report(models)));
  }

  // Act
  const comparison = suite.compare(path.join(root, 'ab'), path.join(root, 'ba'));

  // Assert
  assert.deepEqual([comparison.varied, comparison.confounded], [[], []]);
});

test('a short-name segment is refused by the loader, and a tree entry aliasing .git is refused before anything is copied', t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'short', { change: { 'src/calc.js': CHANGED_CALC, 'GIT~1/config': '[core]\n\tfsmonitor = node marker.js\n' } });
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'nsr-'));
  t.after(() => fs.rmSync(probe, { recursive: true, force: true }));
  fs.mkdirSync(path.join(probe, '.git'));
  const aliased = fs.existsSync(path.join(probe, 'GIT~1'));

  // Act and Assert
  assert.throws(() => suite.loadFixture(path.join(root, 'short')), /GIT~1\/config has a segment shaped like a short name/);
  if (!aliased) {
    t.skip('the temporary volume creates no 8.3 short names, so the materialization half cannot run here');

    return;
  }
  // Materializing straight from the trees, as a fixture that slipped past the loader would be, still refuses the alias.
  assert.throws(() => suite.materialize(path.join(root, 'short'), { deletions: [] }), /change\/GIT~1 resolves to the repository's \.git folder/);
});

test('a launch that never starts a host records no spending even when failure.json holds a null placeholder', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  // As when the host executable cannot be found: the runtime begins the attempt, the runner throws before spawning, and onProcess never fires.
  const neverStarts = { ...dependencies(LEAD_FINDS_DEFECT, []), dispatchDependencies: { runAgent: async options => {
    fs.mkdirSync(options.artifacts, { recursive: true });
    throw Object.assign(new Error('claude executable not found'), { code: 'executable-missing' });
  } } };

  // Act
  const result = await suite.run(options(root, root), neverStarts);
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  const record = JSON.parse(fs.readFileSync(paths.result('lead'), 'utf8'));
  const failure = JSON.parse(fs.readFileSync(path.join(paths.artifacts('lead'), 'failure.json'), 'utf8'));

  // Assert
  assert.deepEqual(failure.attempts.map(attempt => attempt.tokens), [null]);
  assert.deepEqual([record.outcome, record.prelaunch, record.attemptTokens], ['failed', true, []]);
  assert.equal(result.stopped, null);
  assert.deepEqual([result.spending.spent, result.spending.unknown], [0, false]);
});

test('a global attributes file cannot normalize the committed base', t => {
  // Arrange
  const root = scratch(t);
  const directory = writeFixture(root, 'alpha', { base: { 'src/calc.js': BASE_CALC, 'notes.txt': 'one\r\ntwo\r\n' } });
  const attributes = path.join(root, 'global-attributes');
  fs.writeFileSync(attributes, '* text=auto\n');
  const config = path.join(root, 'global-config');
  fs.writeFileSync(config, `[core]\n\tattributesFile = ${attributes.split(path.sep).join('/')}\n`);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });

  // Act
  const repository = suite.materialize(directory, suite.loadFixture(directory).fixture);
  t.after(() => fs.rmSync(repository.root, { recursive: true, force: true }));
  const committed = spawnSync('git', ['show', `${repository.baseSha}:notes.txt`], { cwd: repository.root, encoding: 'utf8' }).stdout;

  // Assert
  assert.equal(committed, 'one\r\ntwo\r\n');
});

test('models that differ only in case are refused as the same model', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];

  // Act
  const refused = suite.run(options(root, root, { models: [{ host: 'vibe', id: 'glm-5-3' }, { host: 'vibe', id: 'GLM-5-3' }] }), dependencies(LEAD_FINDS_DEFECT, calls));

  // Assert
  await assert.rejects(refused, /given more than once/);
  assert.equal(calls.length, 0);
});

test('global diff settings cannot change the diff of a materialized repository', t => {
  // Arrange
  const root = scratch(t);
  const directory = writeFixture(root, 'alpha');
  const config = path.join(root, 'global-config');
  fs.writeFileSync(config, '[diff]\n\tnoprefix = true\n\tcontext = 0\n[color]\n\tui = always\n');
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });

  // Act
  const repository = suite.materialize(directory, suite.loadFixture(directory).fixture);
  t.after(() => fs.rmSync(repository.root, { recursive: true, force: true }));
  const diff = spawnSync('git', ['diff', '--no-ext-diff', repository.baseSha], { cwd: repository.root, encoding: 'utf8' }).stdout;

  // Assert
  assert.match(diff, /^diff --git a\/src\/calc\.js b\/src\/calc\.js$/m);
  assert.match(diff, /^ function addTotal\(a, b\) \{$/m);
  assert.equal(diff.includes(String.fromCharCode(27) + '['), false);
});

test('a change file the same size as its base file, with the same source mtime, still appears in the diff', t => {
  // Arrange
  const root = scratch(t);
  const before = 'function order(a, b) {\n  return [a, b];\n}\n';
  const after = 'function order(a, b) {\n  return [b, a];\n}\n';
  const directory = writeFixture(root, 'alpha', { base: { 'src/calc.js': BASE_CALC, 'src/order.js': before }, change: { 'src/calc.js': CHANGED_CALC, 'src/order.js': after } });
  const stamp = new Date('2026-10-01T12:00:00.000Z');
  for (const tree of ['base', 'change']) fs.utimesSync(path.join(directory, tree, 'src', 'order.js'), stamp, stamp);

  // Act
  const repository = suite.materialize(directory, suite.loadFixture(directory).fixture);
  t.after(() => fs.rmSync(repository.root, { recursive: true, force: true }));
  const changed = spawnSync('git', ['diff', '--name-only', repository.baseSha], { cwd: repository.root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

  // Assert
  assert.equal(before.length, after.length);
  assert.deepEqual(changed.sort(), ['src/calc.js', 'src/order.js']);
});

test('global diff prefix and order settings cannot change the diff either', t => {
  // Arrange
  const root = scratch(t);
  const directory = writeFixture(root, 'alpha', { base: { 'src/calc.js': BASE_CALC, 'src/zeta.js': 'z\n' }, change: { 'src/calc.js': CHANGED_CALC, 'src/zeta.js': 'zz\n' } });
  const order = path.join(root, 'order.txt');
  fs.writeFileSync(order, 'src/zeta.js\n');
  const config = path.join(root, 'global-config');
  fs.writeFileSync(config, `[diff]\n\tsrcPrefix = SRC/\n\tdstPrefix = DST/\n\torderFile = ${order.split(path.sep).join('/')}\n`);
  const previous = process.env.GIT_CONFIG_GLOBAL;
  process.env.GIT_CONFIG_GLOBAL = config;
  t.after(() => {
    if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previous;
  });

  // Act
  const repository = suite.materialize(directory, suite.loadFixture(directory).fixture);
  t.after(() => fs.rmSync(repository.root, { recursive: true, force: true }));
  const headers = spawnSync('git', ['diff', '--no-ext-diff', repository.baseSha], { cwd: repository.root, encoding: 'utf8' }).stdout.split('\n').filter(line => line.startsWith('diff --git'));

  // Assert
  assert.deepEqual(headers, ['diff --git a/src/calc.js b/src/calc.js', 'diff --git a/src/zeta.js b/src/zeta.js']);
});

test('report.md marks an estimated token figure', async t => {
  // Arrange
  const root = scratch(t);
  writeFixture(root, 'alpha');
  const calls = [];
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));
  const paths = suite.runPaths(path.join(root, 'run'), 'alpha__claude-claude-opus-5-5__r1');
  const intent = JSON.parse(fs.readFileSync(paths.intent('skeptic'), 'utf8'));
  for (const file of [paths.complete, paths.result('skeptic')]) fs.rmSync(file);
  fs.writeFileSync(paths.intent('skeptic'), JSON.stringify({ ...intent, done: false, repository: path.join(root, 'gone') }));
  await suite.run(options(root, root), dependencies(LEAD_FINDS_DEFECT, calls));

  // Act
  suite.grade(path.join(root, 'run'), path.join(root, 'none.json'));

  // Assert
  assert.match(fs.readFileSync(path.join(root, 'run', 'report.md'), 'utf8'), /\| Tokens per fixture run \| \d+ \(estimated\) \|/);
});

test('the shipped suite loads whole and meets its composition rules', () => {
  // Act
  const loaded = suite.loadSuite(path.resolve(__dirname, '../tools/seeded-defects/fixtures'));

  // Assert
  assert.equal(loaded.whole, true);
  assert.ok(loaded.fixtures.length >= 23);
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
