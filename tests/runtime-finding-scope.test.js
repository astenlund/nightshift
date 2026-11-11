'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { fixtureContinuation } = require('./fixtures/continuation');
const { fixtureControllerClaim, executeWithFixtureController } = require('./fixtures/controller-claim');
const { claimSurfaces, consolidatedSurfaces, receiptCurrency, recordedSurfaces, scopeOf, validateLeadSurfaces, validateSurfaceAnswers } = require('../internal/runtime/finding-scope');
const { PROBE_ATTACHMENT_LIMIT, loadProbeEvidence, runProbe } = require('../internal/runtime/probes');
const { DIMENSIONS, causeText, docsCause, reviewGateCause, staleCause } = require('../internal/runtime/lifecycle');
const { specReadiness } = require('../internal/runtime/spec-readiness');
const { inventorySnapshot, snapshot, hash } = require('../internal/runtime/evidence');
const { RunStore } = require('../internal/runtime/store');
const { dispatchReview, validateReport } = require('../internal/runtime/review');
const suite = require('../tools/seeded-defects');

function project(t, files = { 'a.txt': 'alpha\n', 'b.txt': 'beta\n', 'spec.md': 'requirements\n' }) {
  const parent = path.resolve(__dirname, '../.tmp/finding-scope');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  const closing = [];
  t.after(() => {
    closing.forEach(close => close());
    fs.rmSync(root, { recursive: true, force: true });
  });
  const git = args => {
    const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(['init', '--quiet']);
  for (const [file, content] of Object.entries(files)) fs.writeFileSync(path.join(root, file), content);
  git(['add', '.']);
  git(['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish scope baseline']);

  return { root, baseSha: git(['rev-parse', 'HEAD']), git, closing };
}

const surface = (file, location = '') => ({ path: file, location, evidence: `${file} shows it` });
const lead = (overrides = {}) => ({ id: 'claim', severity: 'important', required: true, consequence: 'It breaks', evidence: 'Concrete evidence', surfaces: [surface('a.txt')], basis: [], ...overrides });
const answer = (file, verdict, location = '') => ({ path: file, location, verdict, evidence: 'Examined it' });

test('surfaces consolidate by path and trimmed location and refuse malformed entries before any identity', () => {
  assert.deepEqual(consolidatedSurfaces([surface('a.txt', ' f '), { ...surface('a.txt', 'f'), evidence: 'second' }, surface('b.txt', 'f')]), [{ path: 'a.txt', location: 'f', evidence: 'a.txt shows it\nsecond' }, { path: 'b.txt', location: 'f', evidence: 'b.txt shows it' }]);
  for (const entry of [null, 'a.txt', { location: '', evidence: 'x' }, { path: '', location: '', evidence: 'x' }, { path: 'a', evidence: 'x' }, { path: 'a', location: 1, evidence: 'x' }, { path: 7, location: '', evidence: 'x' }, { path: 'a', location: '', evidence: ' ' }]) {
    assert.throws(() => consolidatedSurfaces([entry]), { code: 'invalid-finding' });
  }
  assert.throws(() => validateLeadSurfaces({ surfaces: [], basis: 'a.txt' }), { code: 'invalid-finding' });
  assert.throws(() => validateLeadSurfaces({ surfaces: [], basis: [''] }), { code: 'invalid-finding' });
  assert.throws(() => validateLeadSurfaces({ basis: [] }), { code: 'invalid-finding' });
  assert.deepEqual(claimSurfaces({ id: 'decoy' }), {});
  assert.throws(() => claimSurfaces({ id: 'supplied', surfaces: [{ path: '' }] }), { code: 'invalid-finding' });
  assert.throws(() => claimSurfaces({ id: 'supplied', surfaces: [], basis: [3] }), { code: 'invalid-finding' });
});

test('a supplied malformed claim is refused before a dispatch writes anything, and supplied duplicates are one assigned surface', async t => {
  const { root, baseSha } = project(t);
  const options = findings => ({ runId: 'run', taskId: 'task', kind: 'skeptic', baseSha, requirements: 'Fixture', rules: 'Fixture', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }], findings });
  await assert.rejects(dispatchReview(root, options([{ id: 'F1', evidence: 'x', surfaces: [{ path: 'a.txt' }], basis: [] }])), { code: 'invalid-finding' });
  assert.equal(fs.existsSync(path.join(root, '.nightshift/runs/reviews')), false);
  const report = (surfaces, verdict) => ({ requestId: 'r', status: 'complete', coverage: [], findings: [{ id: 'F1', verdict, evidence: 'x', value: 'y', repairProposal: 'z', surfaces }], summary: 's', toolFailure: '', probes: [] });
  const request = { id: 'r', kind: 'skeptic', findings: [{ id: 'F1', surfaces: consolidatedSurfaces([surface('a.txt'), surface('a.txt')]) }], dimensions: [] };
  assert.doesNotThrow(() => validateReport(report([answer('a.txt', 'confirmed')], 'confirmed'), request));
  assert.throws(() => validateReport(report([answer('a.txt', 'confirmed'), answer('a.txt', 'confirmed')], 'confirmed'), request), { code: 'missing-validation' });
});

test('the finding verdict follows its surfaces, and a claim without surfaces keeps finding-level rules', () => {
  const assigned = [surface('a.txt'), surface('b.txt')];
  const judge = (verdict, ...verdicts) => validateSurfaceAnswers(assigned, { verdict, surfaces: [answer('a.txt', verdicts[0]), answer('b.txt', verdicts[1])] });
  for (const [expected, left, right] of [['confirmed', 'confirmed', 'confirmed'], ['confirmed', 'confirmed', 'refuted'], ['refuted', 'refuted', 'refuted'], ['unverified', 'confirmed', 'unverified'], ['unverified', 'refuted', 'unverified'], ['unverified', 'unverified', 'unverified']]) {
    assert.doesNotThrow(() => judge(expected, left, right), `${expected} from ${left} and ${right}`);
    for (const wrong of ['confirmed', 'refuted', 'unverified'].filter(verdict => verdict !== expected)) assert.throws(() => judge(wrong, left, right), { code: 'invalid-verdict' });
  }
  assert.throws(() => validateSurfaceAnswers(assigned, { verdict: 'confirmed', surfaces: [answer('a.txt', 'confirmed')] }), { code: 'missing-validation' });
  assert.throws(() => validateSurfaceAnswers(assigned, { verdict: 'confirmed', surfaces: [answer('a.txt', 'confirmed'), answer('a.txt', 'confirmed')] }), { code: 'missing-validation' });
  assert.throws(() => validateSurfaceAnswers([], { verdict: 'confirmed', surfaces: [answer('a.txt', 'confirmed')] }), { code: 'missing-validation' });
  assert.doesNotThrow(() => validateSurfaceAnswers([], { verdict: 'refuted', surfaces: [] }));
  assert.doesNotThrow(() => validateSurfaceAnswers([], { verdict: 'refuted' }));
});

test('scope is resolved at import with its governing spec, and every unusable shape has no scope', t => {
  const { root } = project(t);
  const context = inventorySnapshot(root);
  const review = { snapshot: context, contextSnapshot: context, commitments: { task: { agreement: { spec: 'spec.md' } } } };
  const finding = extra => ({ ...lead(extra), reviewKind: 'code' });
  const recorded = extra => ({ ...finding(extra), ...recordedSurfaces(finding(extra), review, false) });
  assert.deepEqual(recorded({}).scope, ['a.txt', 'spec.md']);
  assert.deepEqual(recorded({ basis: ['b.txt', 'b.txt'] }).scope, ['a.txt', 'b.txt', 'spec.md']);
  assert.deepEqual(scopeOf(recorded({ basis: ['b.txt'] })), ['a.txt', 'b.txt', 'spec.md']);
  assert.equal(recorded({ surfaces: [] }).scope, undefined, 'names nothing');
  assert.equal(recorded({ surfaces: [], basis: ['b.txt'] }).scope, undefined, 'a basis alone names no affected place');
  assert.equal(recorded({ surfaces: [surface('missing.txt')] }).scope, undefined, 'unresolved path');
  assert.equal(recorded({ basis: ['missing.txt'] }).scope, undefined, 'unresolved basis');
  assert.deepEqual(recordedSurfaces({ id: 'old' }, review, false), {});
  const good = recorded({ basis: ['b.txt'] });
  for (const scope of [[], 'a.txt', [''], [3], ['a.txt', 'spec.md'], ['b.txt', 'spec.md']]) assert.equal(scopeOf({ ...good, scope }), null, JSON.stringify(scope));
  assert.equal(scopeOf({ ...good, surfaces: 'a.txt' }), null);
  assert.equal(scopeOf({ ...good, basis: [1] }), null);
  assert.equal(scopeOf(undefined), null);
  const spec = { snapshot: snapshot(root, ['spec.md']), contextSnapshot: context, commitments: {} };
  for (const named of [{ surfaces: [], basis: [] }, { surfaces: [surface('a.txt')], basis: ['b.txt'] }, { surfaces: [surface('missing.txt')], basis: [] }]) {
    const saved = { ...lead(named), reviewKind: 'spec', ...recordedSurfaces(lead(named), spec, true) };
    assert.deepEqual(scopeOf(saved), ['spec.md'], 'a spec finding is bound to its deciding inputs');
  }
});

test('a scoped comparison follows its files, falls back without a scope and refuses a damaged snapshot', t => {
  const { root } = project(t);
  const context = inventorySnapshot(root);
  const receipt = { kind: 'skeptic', snapshot: context, contextSnapshot: context };
  fs.writeFileSync(path.join(root, 'b.txt'), 'edited\n');
  assert.deepEqual(receiptCurrency(root, receipt, [['a.txt']]), { current: true, established: true, changedPaths: [] });
  assert.deepEqual(receiptCurrency(root, receipt, [['b.txt']]), { current: false, established: true, changedPaths: ['b.txt'] });
  assert.deepEqual(receiptCurrency(root, receipt, [['a.txt'], ['b.txt']]).changedPaths, ['b.txt'], 'a union');
  for (const scopes of [[], [null], [['a.txt'], null], [['absent.txt']]]) assert.equal(receiptCurrency(root, receipt, scopes).current, false, `falls back: ${JSON.stringify(scopes)}`);
  const damaged = { ...context, digest: 'wrong' };
  assert.deepEqual(receiptCurrency(root, { kind: 'skeptic', snapshot: damaged, contextSnapshot: damaged }, [['a.txt']]), { current: false, established: false, changedPaths: null });
  const deciding = snapshot(root, ['spec.md']);
  const dialogue = { kind: 'spec', snapshot: deciding, contextSnapshot: context };
  assert.equal(receiptCurrency(root, dialogue, []).current, true, 'a spec dialogue without a scope compares its deciding inputs');
  assert.equal(receiptCurrency(root, { ...dialogue, contextSnapshot: damaged }, []).established, false, 'a damaged context snapshot refuses a spec dialogue');
  assert.equal(receiptCurrency(root, { kind: 'skeptic', snapshot: context }, [['a.txt']]).current, false, 'an absent context snapshot takes the fallback');
  assert.equal(receiptCurrency(root, { kind: 'skeptic', snapshot: context }, [['a.txt']]).established, true);
});

function receiptFor(root, selection = {}) {
  const context = inventorySnapshot(root, selection.excluded ?? [], selection.included ?? []);

  return { requestId: randomUUID(), runId: 'fixture', taskId: 'work', snapshot: context, contextSnapshot: context };
}

const nodeProbe = (paths, extra = {}) => ({ id: 'p', purpose: 'Observe', executable: process.execPath, args: ['--version'], files: [], timeoutMs: 20000, paths, ...extra });
const stored = (root, reference) => JSON.parse(fs.readFileSync(path.join(root, reference.path), 'utf8'));

test('a pending probe follows its declared files, and a host probe declares none', t => {
  const { root } = project(t);
  const receipt = receiptFor(root);
  fs.writeFileSync(path.join(root, 'b.txt'), 'edited\n');
  assert.equal(stored(root, runProbe(root, receipt, nodeProbe(['a.txt']))).canonicalUnchanged, true);
  assert.deepEqual(stored(root, runProbe(root, receipt, nodeProbe([]))).declared.paths, []);
  assert.throws(() => runProbe(root, receipt, nodeProbe(['b.txt'])), { code: 'stale-probe', message: /b\.txt/ });
  assert.throws(() => runProbe(root, receipt, nodeProbe(['absent.txt'])), { code: 'stale-probe' }, 'an unresolved declaration keeps the whole comparison');
  assert.throws(() => runProbe(root, receipt, nodeProbe(undefined)), { code: 'stale-probe' }, 'a receipt without the field keeps the whole comparison');
  fs.rmSync(path.join(root, 'a.txt'));
  assert.throws(() => runProbe(root, receipt, nodeProbe(['a.txt'])), { code: 'stale-probe', message: /a\.txt/ });
  assert.throws(() => runProbe(root, { ...receipt, contextSnapshot: { ...receipt.contextSnapshot, digest: 'wrong' } }, nodeProbe([])), { code: 'stale-probe', message: /null/ }, 'integrity holds for a probe declaring nothing');
});

test('execution integrity is independent of what a probe declares', t => {
  const { root } = project(t);
  const receipt = receiptFor(root);
  const writing = file => (_copy, _command) => {
    fs.writeFileSync(path.join(root, file), 'written by the probe\n');

    return { exitCode: 0, error: null, output: '', resourceMode: 'development', startedAt: 'a', finishedAt: 'b' };
  };
  assert.throws(() => runProbe(root, receipt, nodeProbe(['a.txt']), writing('b.txt')), { code: 'probe-input-drift' });
  fs.writeFileSync(path.join(root, 'b.txt'), 'beta\n');
  assert.throws(() => runProbe(root, receiptFor(root), nodeProbe([]), writing('new.txt')), { code: 'probe-input-drift' });
});

test('a probe copy follows the recorded selection, with a selected file, an exclusion and an unrelated deletion together', t => {
  const { root } = project(t);
  fs.mkdirSync(path.join(root, '.tmp'));
  fs.writeFileSync(path.join(root, '.gitignore'), '.tmp/\n');
  fs.writeFileSync(path.join(root, '.tmp/selected.txt'), 'selected\n');
  fs.writeFileSync(path.join(root, '.tmp/other.txt'), 'scratch\n');
  const receipt = receiptFor(root, { included: ['.tmp/selected.txt'], excluded: ['b.txt'] });
  fs.rmSync(path.join(root, 'spec.md'));
  const result = stored(root, runProbe(root, receipt, nodeProbe(['a.txt'])));
  const copy = name => fs.existsSync(path.join(root, result.copy, name));
  assert.deepEqual(['a.txt', '.tmp/selected.txt', 'b.txt', '.tmp/other.txt', 'spec.md'].map(copy), [true, true, false, false, false]);
});

function reference(root, result, name = randomUUID()) {
  const relative = `.nightshift/runs/reviews/req/probes/${name}/result.json`;
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), JSON.stringify(result));

  return { path: relative, sha256: hash(fs.readFileSync(path.join(root, relative))), snapshotDigest: result.snapshotDigest };
}

const declaredResult = (root, paths, extra = {}) => {
  const files = paths.length ? snapshot(root, paths).files : [];

  return { snapshotDigest: 'old', contextDigest: 'old', canonicalUnchanged: true, probe: { executable: 'node', args: extra.args ?? [], files: [] }, declared: { paths, files, digest: hash(JSON.stringify(files)) } };
};

test('a host result survives a repair edit, and a content result is withheld and reported once its file changes', t => {
  const { root } = project(t);
  const references = [reference(root, declaredResult(root, []), 'host'), reference(root, declaredResult(root, ['a.txt'], { args: ['content'] }), 'content'), reference(root, declaredResult(root, ['b.txt'], { args: ['other'] }), 'other')];
  const current = inventorySnapshot(root);
  assert.equal(loadProbeEvidence(root, references, current).attached.length, 3);
  fs.writeFileSync(path.join(root, 'a.txt'), 'repaired\n');
  const after = loadProbeEvidence(root, references, inventorySnapshot(root));
  assert.deepEqual(after.attached.map(entry => entry.name), ['context/probes/other.json', 'context/probes/host.json']);
  assert.deepEqual(after.withheld, [{ name: 'context/probes/content.json', comparison: 'declared', paths: ['a.txt'] }]);
});

test('a stored result from before declarations needs identical digests and is reported with null paths otherwise', t => {
  const { root } = project(t);
  const current = inventorySnapshot(root);
  const old = digest => ({ snapshotDigest: digest, contextDigest: digest, canonicalUnchanged: true, probe: {} });
  assert.equal(loadProbeEvidence(root, [reference(root, old(current.digest), 'same')], current).attached.length, 1);
  assert.deepEqual(loadProbeEvidence(root, [reference(root, old('earlier'), 'earlier')], current).withheld, [{ name: 'context/probes/earlier.json', comparison: 'digest', paths: null }]);
});

test('a renormalized declared file and an added selected artifact keep a stored result', t => {
  const { root, git } = project(t, { '.gitattributes': '* text=auto\n', 'a.txt': 'alpha\n' });
  git(['add', '.']);
  const result = declaredResult(root, ['a.txt']);
  const entry = reference(root, result, 'kept');
  fs.writeFileSync(path.join(root, 'a.txt'), 'alpha\r\n');
  fs.writeFileSync(path.join(root, 'selected.md'), 'added\n');
  assert.equal(loadProbeEvidence(root, [entry], inventorySnapshot(root)).attached.length, 1);
});

test('selection keeps the newest eligible repeat, bounds what attaches, and names what it left out without moving a citation', t => {
  const { root } = project(t);
  const older = reference(root, declaredResult(root, ['a.txt']), 'older');
  const middle = reference(root, declaredResult(root, ['a.txt'], { args: ['distinct'] }), 'distinct');
  const newer = reference(root, declaredResult(root, ['a.txt']), 'newer');
  const current = inventorySnapshot(root);
  const handoff = loadProbeEvidence(root, [older, middle, newer], current);
  assert.deepEqual(handoff.attached.map(entry => entry.name), ['context/probes/newer.json', 'context/probes/distinct.json']);
  assert.deepEqual(handoff.leftOut, [{ name: 'context/probes/older.json', supersededBy: 'context/probes/newer.json' }]);
  const without = loadProbeEvidence(root, [older, middle], current);
  assert.ok(without.attached.some(entry => entry.name === 'context/probes/distinct.json'), 'a dropped sibling does not rename a result');
  const scoped = reference(root, declaredResult(root, ['b.txt']), 'scope-b');
  const repeated = reference(root, declaredResult(root, ['a.txt']), 'scope-a');
  fs.writeFileSync(path.join(root, 'b.txt'), 'edited\n');
  assert.deepEqual(loadProbeEvidence(root, [repeated, scoped], inventorySnapshot(root)).attached.map(entry => entry.name), ['context/probes/scope-a.json'], 'an ineligible newer result hides no older eligible one');
  const many = Array.from({ length: PROBE_ATTACHMENT_LIMIT + 2 }, (_, index) => reference(root, declaredResult(root, [], { args: [String(index)] }), `host-${index}`));
  const bounded = loadProbeEvidence(root, many, inventorySnapshot(root));
  assert.equal(bounded.attached.length, PROBE_ATTACHMENT_LIMIT);
  assert.deepEqual(bounded.leftOut, [{ name: 'context/probes/host-1.json', supersededBy: null }, { name: 'context/probes/host-0.json', supersededBy: null }]);
});

// One delivery task carrying a skeptic-validated finding, driven through the real operations with a fixture reviewer.
function delivery(t, tasks) {
  const { root, baseSha, closing } = project(t);
  fs.writeFileSync(path.join(root, 'a.txt'), 'alpha changed\n');
  fs.writeFileSync(path.join(root, 'b.txt'), 'beta changed\n');
  const store = new RunStore(root, { create: true });
  closing.push(() => store.close());
  const actor = { host: 'claude', session: 'controller' };
  store.create({ mechanism: fixtureContinuation(), objective: 'Scoped evidence', authority: 'User', controller: actor, controllerClaim: fixtureControllerClaim(actor), tasks: tasks ?? [{ id: 'work', title: 'Work', agreement: { source: 'User', outcome: 'Scoped evidence holds' } }] });
  const act = request => executeWithFixtureController(root, { actor, revision: store.read().revision, taskId: 'work', ...request });
  const request = options => JSON.parse(fs.readFileSync(path.join(options.artifacts, '..', 'request.json'), 'utf8'));
  const agent = (findings, session, probes = []) => options => {
    const assigned = request(options);
    const positions = assigned.dialogue && assigned.kind !== 'skeptic' ? assigned.dialogue.findingIds.map(id => ({ id, position: 'maintain', evidence: 'Still holds' })) : [];
    const report = { requestId: assigned.id, status: probes.length ? 'incomplete' : 'complete', coverage: (assigned.kind === 'skeptic' ? [] : DIMENSIONS[assigned.kind === 'spec' ? 'spec' : 'code']).map(dimension => ({ dimension, evidence: 'Assessed' })), findings: typeof findings === 'function' ? findings(assigned) : findings, probes, summary: 'Done', toolFailure: '', ...(assigned.kind === 'skeptic' ? {} : { closures: [], positions, applicability: [] }) };
    const events = [{ type: 'assistant', session_id: session, message: { model: options.model, content: [] } }, { type: 'result', session_id: session, subtype: 'success', is_error: false, structured_output: report }];
    fs.mkdirSync(options.artifacts, { recursive: true });
    fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');

    return { host: options.host, model: options.model, effort: options.effort, session, attributionVerified: true, status: 'complete', output: report, tokens: 0 };
  };
  const review = { baseSha, requirements: 'Fixture', rules: 'Fixture', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
  const dispatch = (kind, findings, session, extra = {}, probes = []) => executeWithFixtureController(root, { action: 'dispatch', actor, revision: store.read().revision, taskId: 'work', review: { ...review, kind, ...extra } }, { runAgent: agent(findings, session, probes) });
  const receiptPath = result => path.relative(root, result.receiptFile).split(path.sep).join('/');
  const verdicts = assigned => assigned.findings.map(claim => ({ id: claim.id, verdict: 'confirmed', evidence: 'Checked', value: 'Worth it', repairProposal: 'Fix it', surfaces: (claim.surfaces ?? []).map(item => answer(item.path, 'confirmed', item.location)) }));

  return { root, baseSha, store, actor, act, dispatch, receiptPath, verdicts };
}

const dispose = (act, id) => act({ action: 'dispose', findingId: id, disposition: 'implement', reason: 'Worth it', obligation: { classification: 'required', basis: 'Agreed' } });

test('an edit outside a finding\'s files leaves validate and dispose working, and one repair leaves another finding usable', async t => {
  const f = delivery(t);
  const lead1 = await f.dispatch('code', [lead({ id: 'one', surfaces: [surface('a.txt')] }), lead({ id: 'two', surfaces: [surface('b.txt')] })], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(lead1) });
  const [one, two] = f.store.read().tasks[0].findings;
  assert.deepEqual([one.scope, two.scope], [['a.txt'], ['b.txt']]);
  const skeptic = await f.dispatch('skeptic', f.verdicts, 'skeptic', { findings: f.store.read().tasks[0].findings });
  fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'elsewhere\n');
  await f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: one.id });
  await f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: two.id });
  await dispose(f.act, one.id);
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'alpha repaired\n');
  await f.act({ action: 'repair', findingIds: [one.id] }).catch(error => { assert.fail(error.message); });
  await dispose(f.act, two.id);
  fs.writeFileSync(path.join(f.root, 'b.txt'), 'beta repaired\n');
  await assert.rejects(f.act({ action: 'dispose', findingId: two.id, disposition: 'skip', reason: 'Changed', obligation: { classification: 'optional', basis: 'x' } }), { code: 'stale-validation', message: /b\.txt/ });
});

test('an edit to a basis file refuses the validation', async t => {
  const f = delivery(t);
  const reviewed = await f.dispatch('code', [lead({ basis: ['b.txt'] })], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const [finding] = f.store.read().tasks[0].findings;
  const skeptic = await f.dispatch('skeptic', f.verdicts, 'skeptic', { findings: [finding] });
  fs.writeFileSync(path.join(f.root, 'b.txt'), 'moved\n');
  await assert.rejects(f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: finding.id }), { code: 'invalid-receipt', message: /b\.txt/ });
});

test('a skeptic takes its surfaces from the record, and importing a verdict needs exactly those', async t => {
  const f = delivery(t);
  const reviewed = await f.dispatch('code', [lead()], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const [finding] = f.store.read().tasks[0].findings;
  const honest = await f.dispatch('skeptic', f.verdicts, 'skeptic', { findings: [{ id: finding.id, evidence: 'x', consequence: 'y', surfaces: [], basis: [] }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(honest.receiptFile), 'request.json'), 'utf8')).findings[0].surfaces.map(item => item.path), ['a.txt']);
  await f.act({ action: 'validate', receipt: f.receiptPath(honest), findingId: finding.id });
});

test('a skeptic dispatched before its finding was imported cannot supply a verdict for other surfaces', async t => {
  const f = delivery(t);
  const reviewed = await f.dispatch('code', [lead()], 'lead');
  const id = `${reviewed.receipt.requestId}:claim`;
  const early = await f.dispatch('skeptic', assigned => assigned.findings.map(claim => ({ id: claim.id, verdict: 'refuted', evidence: 'Checked', value: 'None', repairProposal: '', surfaces: [] })), 'skeptic', { findings: [{ id, evidence: 'x', consequence: 'y', surfaces: [], basis: [] }] });
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  await assert.rejects(f.act({ action: 'validate', receipt: f.receiptPath(early), findingId: id }), { code: 'missing-validation' });
});

test('in a delivery an edit to the governing spec refuses dispose after a reassessment, and an unrelated edit leaves validate and dispose usable', async t => {
  const f = delivery(t, [{ id: 'work', title: 'Work', agreement: { source: 'User', outcome: 'Governed', spec: 'spec.md', specReviewed: true } }]);
  const reviewed = await f.dispatch('code', [lead({ id: 'one' }), lead({ id: 'two' })], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const [one, two] = f.store.read().tasks[0].findings;
  assert.deepEqual(one.scope, ['a.txt', 'spec.md']);
  const skeptic = await f.dispatch('skeptic', f.verdicts, 'skeptic', { findings: [one, two] });
  fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'elsewhere\n');
  await f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: one.id });
  await f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: two.id });
  await dispose(f.act, one.id);
  fs.writeFileSync(path.join(f.root, 'spec.md'), 'requirements amended\n');
  // A later whole-spec reassessment is what lets the delivery act again on a code task after its spec changes.
  f.store.update(f.actor, f.store.read().revision, 'fixture-reassessed', state => { state.tasks[0].agreement.specSnapshot = snapshot(f.root, ['spec.md']); });
  await assert.rejects(dispose(f.act, two.id), { code: 'stale-validation', message: /spec\.md/ });
});

test('in a review context an edit to the governing spec named in neither list refuses validate, and an unrelated edit does not', async t => {
  const { root, baseSha, closing } = project(t);
  fs.writeFileSync(path.join(root, 'a.txt'), 'alpha changed\n');
  const actor = { host: 'claude', session: 'controller' };
  const context = await executeWithFixtureController(root, { action: 'open-review', reviewContextId: randomUUID(), controller: actor, authority: 'Fixture', objective: 'Assess', kind: 'code', agreement: { source: 'User', outcome: 'Governed', spec: 'spec.md' } });
  const { ReviewStore } = require('../internal/runtime/review-store');
  const store = new ReviewStore(root, { contextId: context.id });
  closing.push(() => store.close());
  const request = options => JSON.parse(fs.readFileSync(path.join(options.artifacts, '..', 'request.json'), 'utf8'));
  const agent = (findings, session) => options => {
    const assigned = request(options);
    const report = { requestId: assigned.id, status: 'complete', coverage: (assigned.kind === 'skeptic' ? [] : DIMENSIONS.code).map(dimension => ({ dimension, evidence: 'Assessed' })), findings: findings(assigned), probes: [], summary: 'Done', toolFailure: '', ...(assigned.kind === 'skeptic' ? {} : { closures: [], positions: [], applicability: [] }) };
    fs.mkdirSync(options.artifacts, { recursive: true });
    fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), [{ type: 'assistant', session_id: session, message: { model: options.model, content: [] } }, { type: 'result', session_id: session, subtype: 'success', is_error: false, structured_output: report }].map(event => JSON.stringify(event)).join('\n') + '\n');

    return { host: options.host, model: options.model, effort: options.effort, session, attributionVerified: true, status: 'complete', output: report, tokens: 0 };
  };
  const act = (body, dependencies) => executeWithFixtureController(root, { actor, reviewContextId: context.id, taskId: '#review', revision: store.read().revision, ...body }, dependencies);
  const review = { baseSha, requirements: 'Fixture', rules: 'Fixture', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
  const receipt = result => path.relative(root, result.receiptFile).split(path.sep).join('/');
  const lead1 = await act({ action: 'dispatch', review: { ...review, kind: 'code' } }, { runAgent: agent(() => [lead()], 'lead') });
  await act({ action: 'review', receipt: receipt(lead1) });
  const [finding] = store.read().tasks[0].findings;
  assert.deepEqual(finding.scope, ['a.txt', 'spec.md']);
  const verdicts = assigned => assigned.findings.map(claim => ({ id: claim.id, verdict: 'confirmed', evidence: 'Checked', value: 'Worth it', repairProposal: 'Fix it', surfaces: claim.surfaces.map(item => answer(item.path, 'confirmed', item.location)) }));
  const skeptic = await act({ action: 'dispatch', review: { ...review, kind: 'skeptic', findings: [finding] } }, { runAgent: agent(verdicts, 'skeptic') });
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'elsewhere\n');
  fs.writeFileSync(path.join(root, 'spec.md'), 'requirements amended\n');
  await assert.rejects(act({ action: 'validate', receipt: receipt(skeptic), findingId: finding.id }), { code: 'invalid-receipt', message: /spec\.md/ });
  fs.writeFileSync(path.join(root, 'spec.md'), 'requirements\n');
  await act({ action: 'validate', receipt: receipt(skeptic), findingId: finding.id });
  fs.writeFileSync(path.join(root, 'spec.md'), 'requirements amended\n');
  await assert.rejects(act({ action: 'dispose', findingId: finding.id, disposition: 'implement', reason: 'Worth it', obligation: { classification: 'required', basis: 'Agreed' } }), { code: 'stale-validation', message: /spec\.md/ });
  fs.writeFileSync(path.join(root, 'spec.md'), 'requirements\n');
  fs.writeFileSync(path.join(root, 'more.txt'), 'elsewhere too\n');
  await act({ action: 'dispose', findingId: finding.id, disposition: 'implement', reason: 'Worth it', obligation: { classification: 'required', basis: 'Agreed' } });
});

test('a review context refusing on a check names the check', async t => {
  const { root, closing } = project(t);
  const actor = { host: 'claude', session: 'controller' };
  const context = await executeWithFixtureController(root, { action: 'open-review', reviewContextId: randomUUID(), controller: actor, authority: 'Fixture', objective: 'Assess', kind: 'docs', agreement: { source: 'User', outcome: 'Mechanical' } });
  const { ReviewStore } = require('../internal/runtime/review-store');
  const store = new ReviewStore(root, { contextId: context.id });
  closing.push(() => store.close());
  const act = body => executeWithFixtureController(root, { actor, reviewContextId: context.id, taskId: '#review', revision: store.read().revision, ...body });
  await act({ action: 'check', check: { name: 'Docs fixture check', executable: process.execPath, args: ['--version'], paths: ['a.txt'] } });
  fs.writeFileSync(path.join(root, 'a.txt'), 'changed\n');
  await assert.rejects(act({ action: 'advance', docsExemption: 'A mechanical rename', evidence: 'Done' }), { code: 'verification-required', message: /Docs fixture check" inputs-changed/ });
});

test('a repair keeps stored probe evidence, and closure context names confirmed and refuted surfaces', async t => {
  const f = delivery(t);
  const reviewed = await f.dispatch('code', [lead({ surfaces: [surface('a.txt'), surface('b.txt')] })], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const [finding] = f.store.read().tasks[0].findings;
  const skeptic = await f.dispatch('skeptic', assigned => [{ id: assigned.findings[0].id, verdict: 'confirmed', evidence: 'Checked', value: 'Worth it', repairProposal: 'Fix it', surfaces: [answer('a.txt', 'confirmed'), answer('b.txt', 'refuted')] }], 'skeptic', { findings: [finding] });
  await f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: finding.id });
  await dispose(f.act, finding.id);
  f.store.update({ host: 'claude', session: 'controller' }, f.store.read().revision, 'fixture-probe', state => { state.tasks[0].probeEvidence = [{ path: 'kept', sha256: 'x', snapshotDigest: 'y' }]; });
  const repaired = await f.act({ action: 'repair', findingIds: [finding.id] });
  assert.deepEqual(f.store.read().tasks[0].probeEvidence, [{ path: 'kept', sha256: 'x', snapshotDigest: 'y' }]);
  assert.deepEqual(repaired.next[0].unresolvedFindings[0].surfaceVerdicts.map(item => item.verdict), ['confirmed', 'refuted']);
  f.store.update({ host: 'claude', session: 'controller' }, f.store.read().revision, 'fixture-clear', state => { state.tasks[0].probeEvidence = []; });
  let closure;
  await f.dispatch('code', assigned => { closure = assigned.continuationContext.pendingClosures; return []; }, 'lead', { resume: reviewed.receipt.requestId, candidates: undefined }).catch(() => {});
  assert.deepEqual(closure[0].confirmedSurfaces, [{ path: 'a.txt', location: '' }]);
  assert.deepEqual(closure[0].refutedSurfaces, [{ path: 'b.txt', location: '' }]);
});

test('staleCause separates changed paths, changed commitments and an unestablished comparison', () => {
  assert.deepEqual(staleCause({ changedPaths: ['a'], commitmentsChanged: false, status: 'pending' }), { kind: 'changed-inputs', changedPaths: ['a'] });
  assert.deepEqual(staleCause({ changedPaths: [], commitmentsChanged: true, status: 'pending' }), { kind: 'changed-commitments', changedPaths: null });
  assert.deepEqual(staleCause({ changedPaths: null, commitmentsChanged: false, status: 'structural-failure' }), { kind: 'unestablished', changedPaths: null });
});

test('a review-gate cause names changed paths, and a gate refusal states them', async t => {
  const f = delivery(t);
  const task = () => f.store.read().tasks[0];
  await f.act({ action: 'start-task' });
  await f.act({ action: 'check', check: { name: 'Named fixture check', executable: process.execPath, args: ['--version'], paths: ['a.txt'] } });
  await f.act({ action: 'advance' });
  const reviewed = await f.dispatch('code', [], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  fs.writeFileSync(path.join(f.root, 'unrelated-check-input.txt'), 'x\n');
  const state = f.store.read();
  assert.equal(reviewGateCause(f.root, task(), { ...state, root: f.root }).kind, 'changed-inputs');
  assert.match(causeText(task(), reviewGateCause(f.root, task(), { ...state, root: f.root })), /unrelated-check-input\.txt/);
  await assert.rejects(f.act({ action: 'advance' }), { code: 'review-required', message: /unrelated-check-input\.txt/ });
});

test('a verification refusal names the check and its reason', async t => {
  const f = delivery(t);
  await f.act({ action: 'start-task' });
  await f.act({ action: 'check', check: { name: 'Named fixture check', executable: process.execPath, args: ['--version'], paths: ['a.txt'] } });
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'changed after the check\n');
  await assert.rejects(f.act({ action: 'advance' }), { code: 'verification-required', message: /Named fixture check" inputs-changed/ });
});

test('the suite gives decoys and lead findings the same claim shape', () => {
  const claims = suite.shuffledClaims([{ id: 'L1', severity: 'minor', required: false, consequence: 'c', evidence: 'e', surfaces: [surface('a.txt')], basis: ['b.txt'] }], [{ severity: 'minor', required: false, consequence: 'c', evidence: 'e', reason: 'r', surfaces: [surface('c.txt')], basis: [] }], 7);
  const shape = claim => Object.keys(claim.claim).sort();
  assert.deepEqual(shape(claims[0]), shape(claims[1]));
  assert.ok(claims.every(claim => claim.claim.surfaces.length === 1 && Array.isArray(claim.claim.basis)));
});

test('a stale review and a failing check are both named, and a check-only failure names the check', async t => {
  const f = delivery(t);
  const task = () => f.store.read().tasks[0];
  await f.act({ action: 'start-task' });
  await f.act({ action: 'check', check: { name: 'Named fixture check', executable: process.execPath, args: ['--version'], paths: ['a.txt'] } });
  await f.act({ action: 'advance' });
  const reviewed = await f.dispatch('code', [], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const state = () => ({ ...f.store.read(), root: f.root });
  // The only input the check declares changes, so the review is stale too; restoring nothing else, both causes must appear.
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'alpha changed again\n');
  const mixed = reviewGateCause(f.root, task(), state());
  assert.equal(mixed.kind, 'changed-inputs');
  assert.match(causeText(task(), mixed), /a\.txt.*Named fixture check" inputs-changed/);
  await assert.rejects(f.act({ action: 'advance' }), { code: 'review-required', message: /Named fixture check" inputs-changed/ });
  const fresh = await f.dispatch('code', [], 'lead-two');
  await f.act({ action: 'review', receipt: f.receiptPath(fresh) });
  const checkOnly = reviewGateCause(f.root, task(), state());
  assert.equal(checkOnly.kind, 'check');
  assert.match(causeText(task(), checkOnly), /Named fixture check" inputs-changed/);
});

test('a scoped dialogue import survives an unrelated edit and is refused for an edit to its finding\'s file', async t => {
  const f = delivery(t);
  const reviewed = await f.dispatch('code', [lead()], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const [finding] = f.store.read().tasks[0].findings;
  const turn = resume => f.dispatch('code', [], 'lead', { resume, candidates: undefined, dialogue: { findingIds: [finding.id], message: 'Does it stand?' } });
  const first = await turn(reviewed.receipt.requestId);
  fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'elsewhere\n');
  await f.act({ action: 'dialogue', receipt: f.receiptPath(first) });
  const second = await turn(first.receipt.requestId);
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'moved\n');
  await assert.rejects(f.act({ action: 'dialogue', receipt: f.receiptPath(second) }), { code: 'invalid-receipt', message: /a\.txt/ });
});

test('the probe action follows declared files after an edit, for a lead and for a skeptic with an unscoped finding', async t => {
  const f = delivery(t);
  const probes = [{ ...nodeProbe(['a.txt'], { id: 'content' }) }, { ...nodeProbe([], { id: 'host' }) }];
  const leadReceipt = await f.dispatch('code', [], 'lead', {}, probes);
  fs.writeFileSync(path.join(f.root, 'unrelated.txt'), 'elsewhere\n');
  await f.act({ action: 'probe', receipt: f.receiptPath(leadReceipt), probeId: 'content' });
  const complete = await f.dispatch('code', [lead({ surfaces: [] })], 'lead-final');
  await f.act({ action: 'review', receipt: f.receiptPath(complete) });
  const [unscoped] = f.store.read().tasks[0].findings;
  assert.equal(unscoped.scope, undefined);
  const skeptic = await f.dispatch('skeptic', assigned => [{ id: assigned.findings[0].id, verdict: 'unverified', evidence: 'Needs execution', value: 'Unknown', repairProposal: '', surfaces: [] }], 'skeptic', { findings: [unscoped] }, [nodeProbe([], { id: 'skeptic-host' }), nodeProbe(['a.txt'], { id: 'skeptic-content' })]);
  fs.writeFileSync(path.join(f.root, 'b.txt'), 'beta edited elsewhere\n');
  await f.act({ action: 'probe', receipt: f.receiptPath(skeptic), probeId: 'skeptic-host' });
  await f.act({ action: 'probe', receipt: f.receiptPath(skeptic), probeId: 'skeptic-content' });
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'moved\n');
  await assert.rejects(f.act({ action: 'probe', receipt: f.receiptPath(skeptic), probeId: 'skeptic-content' }), { code: 'stale-probe', message: /a\.txt/ });
  await f.act({ action: 'probe', receipt: f.receiptPath(skeptic), probeId: 'skeptic-host' });
});

test('a dispatch reports withheld stored results and tells the reviewer what it left out', async t => {
  const f = delivery(t);
  const references = [reference(f.root, declaredResult(f.root, ['a.txt']), 'older'), reference(f.root, declaredResult(f.root, ['a.txt']), 'newer'), reference(f.root, declaredResult(f.root, ['b.txt'], { args: ['other'] }), 'stale')];
  f.store.update(f.actor, f.store.read().revision, 'fixture-probes', state => { state.tasks[0].probeEvidence = references; });
  fs.writeFileSync(path.join(f.root, 'b.txt'), 'beta moved\n');
  let prompt;
  const result = await f.dispatch('code', assigned => { prompt = assigned; return []; }, 'lead');
  assert.deepEqual(result.receipt.withheldProbes, [{ name: 'context/probes/stale.json', comparison: 'declared', paths: ['b.txt'] }]);
  assert.deepEqual(prompt.probeFiles, ['context/probes/newer.json']);
  assert.deepEqual(prompt.probeLeftOut, [{ name: 'context/probes/older.json', supersededBy: 'context/probes/newer.json' }]);
});

test('a damaged recorded snapshot is refused at receipt read and at dispose, naming no paths', async t => {
  const f = delivery(t);
  const reviewed = await f.dispatch('code', [lead()], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const [finding] = f.store.read().tasks[0].findings;
  const skeptic = await f.dispatch('skeptic', f.verdicts, 'skeptic', { findings: [finding] });
  await f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: finding.id });
  f.store.update(f.actor, f.store.read().revision, 'fixture-damage', state => { state.tasks[0].findings[0].validation.snapshot.digest = 'damaged'; });
  await assert.rejects(dispose(f.act, finding.id), { code: 'stale-validation', message: /integrity check.*null/ });
  const second = await f.dispatch('skeptic', f.verdicts, 'skeptic-two', { findings: [finding] });
  const damage = name => {
    const target = path.join(path.dirname(second.receiptFile), name);
    const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    saved.contextSnapshot.digest = 'damaged';
    fs.writeFileSync(target, JSON.stringify(saved));
  };
  damage('receipt.json');
  damage('request.json');
  await assert.rejects(f.act({ action: 'validate', receipt: f.receiptPath(second), findingId: finding.id }), { code: 'invalid-receipt', message: /integrity check/ });
});

test('a spec review finding is bound to its deciding inputs, and an edit elsewhere leaves it usable', async t => {
  const f = delivery(t, [{ id: 'work', title: 'Spec', kind: 'spec', agreement: { source: 'User', outcome: 'Specified', spec: 'spec.md' } }]);
  const reviewed = await f.dispatch('spec', [lead({ surfaces: [surface('a.txt')], basis: [] })], 'lead', { artifactPaths: ['spec.md'] });
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const [finding] = f.store.read().tasks[0].findings;
  assert.deepEqual(finding.scope, ['spec.md']);
  const skeptic = await f.dispatch('skeptic', f.verdicts, 'skeptic', { findings: [finding] });
  fs.writeFileSync(path.join(f.root, 'a.txt'), 'implementation edit\n');
  await f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: finding.id });
  fs.writeFileSync(path.join(f.root, 'spec.md'), 'requirements amended\n');
  await assert.rejects(dispose(f.act, finding.id), { code: 'stale-validation', message: /spec\.md/ });
});

test('carried and closing-record findings show surface verdicts in status, and a carried finding keeps its scope', async t => {
  const f = delivery(t);
  const carried = { id: 'carried', localId: 'c', severity: 'minor', consequence: 'c', evidence: 'e', reviewKind: 'docs', surfaces: [surface('a.txt')], basis: [], scope: ['a.txt'], validation: { verdict: 'confirmed', surfaces: [answer('a.txt', 'confirmed'), answer('b.txt', 'refuted')] }, disposition: null };
  f.store.update(f.actor, f.store.read().revision, 'fixture-carried', state => { state.closing = { ...(state.closing ?? {}), carriedFindings: [carried], docs: { id: '#closing', kind: 'closing', baseline: null, reviews: [], findings: [{ ...carried, id: 'on-record' }], checks: [], probeEvidence: [] } }; });
  const brief = await f.act({ action: 'status' });
  assert.deepEqual(brief.closing.docsReview.surfaceVerdicts.map(item => item.id), ['on-record']);
  assert.deepEqual(scopeOf(f.store.read().closing.carriedFindings[0]), ['a.txt']);
  assert.deepEqual(brief.closing.carriedSurfaceVerdicts, [{ id: 'carried', surfaces: [{ path: 'a.txt', location: '', verdict: 'confirmed' }, { path: 'b.txt', location: '', verdict: 'refuted' }] }]);
});

test('a damaged saved finding is validated as naming nothing, and its skeptic is assigned no surfaces', async t => {
  const f = delivery(t);
  const reviewed = await f.dispatch('code', [lead()], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  f.store.update(f.actor, f.store.read().revision, 'fixture-damage', state => { state.tasks[0].findings[0].surfaces = 'not a list'; });
  const [finding] = f.store.read().tasks[0].findings;
  assert.equal(scopeOf(finding), null);
  const skeptic = await f.dispatch('skeptic', assigned => { assert.deepEqual(assigned.findings[0].surfaces, []); return f.verdicts(assigned); }, 'skeptic', { findings: [finding] });
  await f.act({ action: 'validate', receipt: f.receiptPath(skeptic), findingId: finding.id });
});

test('an older repeat names its newer result even when the limit left that result out', t => {
  const { root } = project(t);
  const older = reference(root, declaredResult(root, []), 'repeat-older');
  const newer = reference(root, declaredResult(root, []), 'repeat-newer');
  const distinct = Array.from({ length: PROBE_ATTACHMENT_LIMIT }, (_, index) => reference(root, declaredResult(root, [], { args: [String(index)] }), `distinct-${index}`));
  const handoff = loadProbeEvidence(root, [older, newer, ...distinct], inventorySnapshot(root));
  assert.deepEqual(handoff.leftOut, [{ name: 'context/probes/repeat-newer.json', supersededBy: null }, { name: 'context/probes/repeat-older.json', supersededBy: 'context/probes/repeat-newer.json' }]);
});

test('a report issued before surfaces stays readable, and a new report must carry them', () => {
  const report = { requestId: 'r', status: 'complete', coverage: [], findings: [{ id: 'old', severity: 'minor', required: false, consequence: 'c', evidence: 'e' }], summary: 's', toolFailure: '', applicability: [] };
  const request = { id: 'r', kind: 'code', dimensions: [] };
  assert.throws(() => validateReport(report, request), { code: 'invalid-finding' });
  assert.doesNotThrow(() => validateReport(report, request, { issued: true }));
});

test('a true basis observation leaves a refuted finding refuted and a confirmed defect elsewhere confirmed', () => {
  const assigned = [surface('a.txt')];
  assert.doesNotThrow(() => validateSurfaceAnswers(assigned, { verdict: 'refuted', surfaces: [answer('a.txt', 'refuted')] }));
  assert.doesNotThrow(() => validateSurfaceAnswers(assigned, { verdict: 'confirmed', surfaces: [answer('a.txt', 'confirmed')] }));
  assert.throws(() => validateSurfaceAnswers(assigned, { verdict: 'confirmed', surfaces: [answer('a.txt', 'refuted'), answer('b.txt', 'confirmed')] }), { code: 'missing-validation' });
});

test('a dialogue with a damaged snapshot is refused at its operation, a spec-kind one included', async t => {
  for (const specKind of [false, true]) {
    const f = delivery(t, specKind ? [{ id: 'work', title: 'Spec', kind: 'spec', agreement: { source: 'User', outcome: 'Specified', spec: 'spec.md' } }] : undefined);
    const reviewed = await f.dispatch(specKind ? 'spec' : 'code', [lead()], 'lead', specKind ? { artifactPaths: ['spec.md'] } : {});
    await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
    const [finding] = f.store.read().tasks[0].findings;
    const reply = await f.dispatch(specKind ? 'spec' : 'code', [], 'lead', { resume: reviewed.receipt.requestId, candidates: undefined, dialogue: { findingIds: [finding.id], message: 'Does it stand?' }, ...(specKind ? { artifactPaths: ['spec.md'] } : {}) });
    for (const name of ['receipt.json', 'request.json']) {
      const target = path.join(path.dirname(reply.receiptFile), name);
      const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
      saved.contextSnapshot.digest = 'damaged';
      fs.writeFileSync(target, JSON.stringify(saved));
    }
    await assert.rejects(f.act({ action: 'dialogue', receipt: f.receiptPath(reply) }), { code: 'invalid-receipt', message: /integrity check/ });
  }
});

test('a fresh skeptic receives stored results that still apply', async t => {
  const f = delivery(t);
  const reviewed = await f.dispatch('code', [lead()], 'lead');
  await f.act({ action: 'review', receipt: f.receiptPath(reviewed) });
  const [finding] = f.store.read().tasks[0].findings;
  const stored = reference(f.root, declaredResult(f.root, ['a.txt']), 'kept-for-skeptic');
  f.store.update(f.actor, f.store.read().revision, 'fixture-probes', state => { state.tasks[0].probeEvidence = [stored]; });
  let assigned;
  await f.dispatch('skeptic', request => { assigned = request; return f.verdicts(request); }, 'skeptic', { findings: [finding] });
  assert.deepEqual(assigned.probeFiles, ['context/probes/kept-for-skeptic.json']);
});

test('a spec-raised saved finding with malformed surfaces or basis has no scope', () => {
  const saved = { reviewKind: 'spec', scope: ['spec.md'], surfaces: [], basis: [] };
  assert.deepEqual(scopeOf(saved), ['spec.md']);
  for (const damage of [{ surfaces: 'not a list' }, { surfaces: [{ path: '' }] }, { basis: 'spec.md' }, { basis: [''] }, { surfaces: undefined }, { basis: undefined }]) assert.equal(scopeOf({ ...saved, ...damage }), null, JSON.stringify(damage));
});

test('the docs gate names a closing record\'s check, while a spec hold leaves its linked task\'s check to that task', t => {
  const { root } = project(t);
  fs.writeFileSync(path.join(root, 'spec.md'), '# Spec\n');
  const review = { kind: 'docs', status: 'complete', strength: 'strong', independent: true, broad: true, coverageEvidence: 'Assessed', coveredTaskIds: ['work'], revision: 1, requestId: 'closing-review', snapshot: inventorySnapshot(root), contextSnapshot: inventorySnapshot(root), dimensions: DIMENSIONS.docs, commitments: {} };
  const closing = { id: '#closing', kind: 'closing', reviews: [review], findings: [], checks: [{ name: 'Ready parser', passed: false, exitCode: 1, snapshot: snapshot(root, ['a.txt']) }], probeEvidence: [] };
  const work = { id: 'work', kind: 'code', agreement: { source: 'User', outcome: 'x', spec: 'spec.md', specReviewTaskId: 'spec-task' }, findings: [], reviews: [], checks: [] };
  const specTask = { id: 'spec-task', kind: 'spec', status: 'complete', agreement: { source: 'User', outcome: 'y', spec: 'spec.md' }, findings: [], reviews: [], checks: [{ name: 'Spec check', passed: false, exitCode: 1, snapshot: snapshot(root, ['a.txt']) }] };
  const state = { root, id: 'run', controller: { session: 'c' }, workers: [], tasks: [work, specTask], closing: { docs: closing } };
  assert.match(causeText(work, docsCause(root, work, state, 'unmet')), /#closing: check "Ready parser" failed/);
  const reading = specReadiness(state, work);
  assert.match(reading.cause, /spec task spec-task has no complete independent spec assessment/);
  assert.doesNotMatch(`${reading.cause} ${reading.next}`, /Spec check/);
});
