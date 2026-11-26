'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { REVIEW_MODEL_PATH, bundledModel } = require('../internal/review-model');
const { Setup, initialize } = require('../internal/setup');
const { applyReviewModel, inspectReviewModel } = require('../internal/setup-review-model');
const { hash } = require('../internal/runtime/evidence');
const { RunStore } = require('../internal/runtime/store');
const { specReadiness } = require('../internal/runtime/spec-readiness');
const { captureReviewModel, reviewModelsForFindings, reviewModelBrief, reviewModelDigest, reviewModelInputChange } = require('../internal/runtime/review-model');

const LF = String.fromCharCode(10);
const CRLF = String.fromCharCode(13, 10);

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);

  return result.stdout.trim();
}

function mockPublication(t, observe) {
  const spawn = childProcess.spawnSync;

  return t.mock.method(childProcess, 'spawnSync', (executable, args, options) => {
    const file = args?.[args.indexOf('-File') + 1];
    const run = () => spawn(executable, args, options);
    if (!file || path.basename(file) !== 'review-model-move.ps1') return run();
    const part = args[args.indexOf('-Part') + 1];
    if (part === 'lock') return run();
    const project = args[args.indexOf('-ProjectRoot') + 1];

    return observe(path.join(project, REVIEW_MODEL_PATH), run, part);
  });
}

function fixture(t) {
  const parent = path.resolve(__dirname, '../.tmp/review-model-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.nightshift'));

  return { root, model: path.join(root, REVIEW_MODEL_PATH) };
}

function source(text) {
  const bytes = Buffer.from(text);

  return { text, bytes, sha256: hash(bytes) };
}

function approve(report, text) {
  return { projectSha256: report.project.sha256, bundledSha256: report.bundled.sha256, text };
}

test('init-backlog retries after interrupted creation of the review-model lock', t => {
  const { root } = fixture(t);
  git(root, ['init', '--quiet']);
  const directory = path.join(root, '.nightshift/setup');
  const lock = path.join(directory, 'review-model.lock.sqlite');
  const open = fs.openSync;
  const close = fs.closeSync;
  let creating;
  const watch = t.mock.method(fs, 'openSync', (file, flags, ...args) => {
    const descriptor = open(file, flags, ...args);
    if (flags === 'wx' && typeof file === 'string' && path.dirname(file) === directory &&
        (file === lock || path.basename(file).endsWith('.lock'))) creating = descriptor;
    return descriptor;
  });
  const interrupt = t.mock.method(fs, 'closeSync', descriptor => {
    close(descriptor);
    if (descriptor === creating) {
      creating = undefined;
      throw new Error('Interrupted before review lock initialization');
    }
  });
  assert.throws(() => initialize(root), { code: 'review-model-lock-invalid', message: /Interrupted before review lock initialization/ });
  interrupt.mock.restore();
  watch.mock.restore();

  assert.equal(fs.existsSync(lock), false);
  assert.equal(initialize(root).reviewModel.status, 'created');
  assert.equal(initialize(root).reviewModel.status, 'matching');
});

test('a concurrent review-model initializer keeps the lock that was published first', t => {
  const { root } = fixture(t);
  const bundle = source('Bundled review model');
  const lock = path.join(root, '.nightshift/setup/review-model.lock.sqlite');
  const spawn = childProcess.spawnSync;
  let competing = false;
  let published;
  t.mock.method(childProcess, 'spawnSync', (executable, args, options) => {
    if (!competing && args?.[args.indexOf('-Part') + 1] === 'lock') {
      competing = true;
      assert.equal(fs.existsSync(lock), false);
      assert.equal(applyReviewModel(root, undefined, bundle).status, 'created');
      published = fs.readFileSync(lock);
      const lost = spawn(executable, args, options);
      assert.notEqual(lost.status, 0);
      return lost;
    }
    return spawn(executable, args, options);
  });

  assert.equal(applyReviewModel(root, undefined, bundle).status, 'matching');
  assert.ok(published);
  assert.deepEqual(fs.readFileSync(lock), published);
});

test('setup preserves either one-sided edit and asks to merge when both sides diverge', t => {
  const { root, model } = fixture(t);
  const prior = source('Prior bundle');
  const later = source('Updated bundle');
  assert.deepEqual(applyReviewModel(root, undefined, prior), { status: 'created' });
  assert.equal(fs.readFileSync(model, 'utf8'), prior.text);
  assert.deepEqual(applyReviewModel(root, undefined, later), { status: 'preserved' });
  assert.equal(fs.readFileSync(model, 'utf8'), prior.text);

  fs.writeFileSync(model, 'Project guidance');
  assert.equal(inspectReviewModel(root, prior).status, 'preserved');
  const report = inspectReviewModel(root, later);
  assert.equal(report.status, 'merge');
  assert.equal(report.baseline, prior.text);
  assert.equal(applyReviewModel(root, undefined, later).status, 'merge');
  assert.equal(fs.readFileSync(model, 'utf8'), 'Project guidance');

  const decision = approve(report, 'Merged guidance');
  assert.throws(() => applyReviewModel(root, decision, source('Bundle changed again')), { code: 'review-model-drift' });
  fs.writeFileSync(model, 'Project guidance edited again');
  assert.throws(() => applyReviewModel(root, decision, later), { code: 'review-model-drift' });
  assert.equal(fs.readFileSync(model, 'utf8'), 'Project guidance edited again');

  const outcome = applyReviewModel(root, approve(inspectReviewModel(root, later), 'Approved merge'), later);
  assert.equal(outcome.status, 'merged');
  assert.equal(fs.readFileSync(path.join(root, outcome.preservedPrevious), 'utf8'), 'Project guidance edited again');
  assert.equal(fs.readFileSync(model, 'utf8'), 'Approved merge');
  assert.deepEqual(inspectReviewModel(root, later), { status: 'preserved' });
  const nextBundle = source('Third bundle');
  assert.deepEqual(inspectReviewModel(root, nextBundle), { status: 'preserved' });
  fs.appendFileSync(model, ' Another project change.');
  const nextMerge = inspectReviewModel(root, nextBundle);
  assert.equal(nextMerge.status, 'merge');
  assert.equal(nextMerge.baseline, later.text);
});

test('setup compares an existing project without known provenance and records matching versions', t => {
  const { root, model } = fixture(t);
  const bundled = source('Current bundle');
  fs.writeFileSync(model, 'Existing project policy');
  const report = inspectReviewModel(root, bundled);
  assert.equal(report.status, 'compare');
  assert.equal(report.baseline, null);
  assert.equal(report.project.text, 'Existing project policy');

  fs.writeFileSync(model, bundled.bytes);
  assert.deepEqual(applyReviewModel(root, undefined, bundled), { status: 'matching' });
  fs.writeFileSync(model, 'New local policy');
  assert.equal(inspectReviewModel(root, source('New bundle')).baseline, bundled.text);
});

test('init-backlog reruns after a checkout moves with its setup journal', t => {
  const { root, model } = fixture(t);
  const moved = root + '-moved';
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  git(root, ['init', '--quiet']);
  assert.equal(initialize(root).reviewModel.status, 'created');
  const edited = 'Project policy before the move';
  fs.writeFileSync(model, edited);
  fs.renameSync(root, moved);

  const rerun = initialize(moved);
  assert.equal(rerun.migration.root, fs.realpathSync.native(moved));
  assert.equal(rerun.reviewModel.status, 'preserved');
  assert.equal(fs.readFileSync(path.join(moved, REVIEW_MODEL_PATH), 'utf8'), edited);
  const updated = source('Updated bundle after the move');
  const result = inspectReviewModel(moved, updated);
  assert.equal(result.status, 'merge');
  assert.equal(result.baseline, bundledModel().text);
  assert.equal(applyReviewModel(moved, approve(result, 'Approved merged policy'), updated).status, 'merged');
});

test('init-backlog refuses to reuse a copied checkout setup journal', t => {
  const { root } = fixture(t);
  const copy = root + '-copy';
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  git(root, ['init', '--quiet']);
  initialize(root);
  fs.cpSync(root, copy, { recursive: true });

  const current = fs.realpathSync.native(copy);
  const original = fs.realpathSync.native(root);
  assert.throws(() => initialize(copy), error => error.code === 'wrong-project' &&
    error.message.includes(`The current checkout is ${current}.`) &&
    error.message.includes(`The original setup location was ${original}.`));
  assert.equal(fs.readFileSync(path.join(copy, REVIEW_MODEL_PATH), 'utf8'), bundledModel().text);
});

test('a moved checkout with a completed setup but no review-model lock can establish one at its original path', t => {
  const { root } = fixture(t);
  const moved = root + '-before-review-model';
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  git(root, ['init', '--quiet']);
  const earlierSetup = new Setup(root);
  try {
    // Earlier init-backlog completed the migration without the review-model setup step.
    assert.equal(earlierSetup.apply().status, 'complete');
  } finally { earlierSetup.close(); }
  fs.renameSync(root, moved);
  assert.throws(() => initialize(moved), { code: 'wrong-project' });
  fs.renameSync(moved, root);
  assert.equal(initialize(root).reviewModel.status, 'created');
  fs.renameSync(root, moved);

  assert.equal(initialize(moved).reviewModel.status, 'matching');
});

test('a moved checkout with interrupted migration must resume at its original path', t => {
  const { root } = fixture(t);
  const moved = root + '-interrupted';
  t.after(() => fs.rmSync(moved, { recursive: true, force: true }));
  git(root, ['init', '--quiet']);
  fs.mkdirSync(path.join(root, '.claude'));
  const legacy = path.join(root, '.claude/FEATURES.md');
  fs.writeFileSync(legacy, ['# Features', '', '## Current', ''].join(LF));
  assert.throws(() => initialize(root, { afterCopy() { throw new Error('Interrupted legacy migration'); } }), /Interrupted legacy migration/);
  fs.renameSync(root, moved);

  assert.throws(() => initialize(moved), { code: 'wrong-project' });
  assert.equal(fs.existsSync(path.join(moved, '.claude/FEATURES.md')), true);
  fs.renameSync(moved, root);
  assert.equal(initialize(root).reviewModel.status, 'created');
});

test('setup treats Git checkout line endings as unchanged with or without a journal', t => {
  const { root, model } = fixture(t);
  const lines = ['Prior bundle', 'More guidance', ''];
  const prior = source(lines.join(LF));
  const later = source('Updated bundle');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'core.autocrlf', 'true']);
  applyReviewModel(root, undefined, prior);
  git(root, ['add', REVIEW_MODEL_PATH]);
  fs.unlinkSync(model);
  git(root, ['checkout-index', REVIEW_MODEL_PATH]);
  assert.equal(fs.readFileSync(model, 'utf8'), lines.join(CRLF));
  assert.equal(inspectReviewModel(root, later).status, 'preserved');

  const fresh = fixture(t);
  fs.copyFileSync(model, fresh.model);
  assert.deepEqual(applyReviewModel(fresh.root, undefined, prior), { status: 'matching' });
  assert.equal(fs.readFileSync(fresh.model, 'utf8'), lines.join(CRLF));
  assert.equal(inspectReviewModel(fresh.root, later).status, 'preserved');
});

test('merge approval still binds exact bytes when the project line endings change', t => {
  const { root, model } = fixture(t);
  const bundle = source('Current bundle');
  fs.writeFileSync(model, ['Project policy', 'More guidance', ''].join(LF));
  const decision = approve(inspectReviewModel(root, bundle), 'Approved policy');
  fs.writeFileSync(model, ['Project policy', 'More guidance', ''].join(CRLF));
  assert.throws(() => applyReviewModel(root, decision, bundle), { code: 'review-model-drift' });
});

test('an unreadable stored baseline still permits comparison but refuses an approved write', t => {
  const { root, model } = fixture(t);
  applyReviewModel(root, undefined, source('Old bundled text'));
  fs.writeFileSync(model, 'Edited project model');
  const bundled = source('New bundled text');
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (name, ...args) => {
    if (typeof name === 'string' && path.basename(name) === 'review-model.json') {
      const failure = new Error('Simulated Windows shared-file access refusal');
      failure.code = 'EACCES';
      throw failure;
    }

    return read(name, ...args);
  });
  const report = inspectReviewModel(root, bundled);
  assert.equal(report.status, 'compare');
  assert.equal(report.baseline, null);
  assert.match(report.baselineUnavailableReason, /shared-file access refusal/);
  assert.equal(report.project.text, 'Edited project model');
  assert.equal(report.bundled.text, 'New bundled text');
  assert.deepEqual(applyReviewModel(root, undefined, bundled), report);
  assert.throws(() => applyReviewModel(root, approve(report, 'Merged text'), bundled), { code: 'review-model-baseline-unavailable' });
  assert.equal(fs.readFileSync(model, 'utf8'), 'Edited project model');

  fs.writeFileSync(model, bundled.bytes);
  const matching = applyReviewModel(root, undefined, bundled);
  assert.equal(matching.status, 'unavailable');
  assert.match(matching.reason, /shared-file access refusal/);
});

for (const edit of ['none', 'new-content', 'original-bytes']) test(`setup can recover safely after an interrupted replacement with edit=${edit}`, t => {
  const { root, model } = fixture(t);
  applyReviewModel(root, undefined, source('Prior bundle'));
  fs.writeFileSync(model, 'User policy');
  const bundled = source('New bundle');
  const decision = approve(inspectReviewModel(root, bundled), 'Approved policy');
  const renameSync = fs.renameSync;
  let applied = false;
  const rename = t.mock.method(fs, 'renameSync', (from, to) => {
    if (applied && path.basename(to) === 'review-model.json') throw new Error('interrupted after model replacement');
    renameSync(from, to);
  });
  const move = mockPublication(t, (filename, run) => {
    const moved = run();
    if (filename === model && moved.status === 0) applied = true;

    return moved;
  });
  assert.throws(() => applyReviewModel(root, decision, bundled), /interrupted after model replacement/);
  rename.mock.restore();
  move.mock.restore();
  assert.equal(fs.readFileSync(model, 'utf8'), 'Approved policy');
  if (edit !== 'none') {
    const text = edit === 'original-bytes' ? 'User policy' : 'Approved policy Later user adjustment.';
    fs.writeFileSync(model, text);
    const result = applyReviewModel(root, undefined, bundled);
    assert.equal(result.status, 'compare');
    assert.equal(result.baseline, null);
    assert.equal(inspectReviewModel(root, bundled).baseline, null);
    assert.equal(fs.readFileSync(model, 'utf8'), text);
  } else {
    assert.deepEqual(applyReviewModel(root, undefined, bundled), { status: 'preserved' });
    const next = source('Another bundle');
    assert.deepEqual(inspectReviewModel(root, next), { status: 'preserved' });
    fs.appendFileSync(model, ' A new project change.');
    assert.equal(inspectReviewModel(root, next).baseline, bundled.text);
  }
});

test('cumulative review binds per-task overrides and a skeptic can recover the original model after an edit', t => {
  const { root, model } = fixture(t);
  const tasks = [{ id: 'one', agreement: { reviewModelOverride: 'Cover import of edited files' } }, { id: 'two', agreement: {} }];
  const fallback = captureReviewModel(root, tasks);
  assert.equal(fallback.text, bundledModel().text);
  assert.deepEqual(fallback.scopes.map(({ taskId, override }) => ({ taskId, override })), [{ taskId: 'one', override: 'Cover import of edited files' }, { taskId: 'two', override: null }]);
  fs.writeFileSync(model, 'Project policy at lead assessment');
  const reviewModel = { current: captureReviewModel(root, tasks), originals: [] };
  const artifactDirectory = '.nightshift/runs/reviews/lead';
  fs.mkdirSync(path.join(root, artifactDirectory), { recursive: true });
  fs.writeFileSync(path.join(root, artifactDirectory, 'request.json'), JSON.stringify({ id: 'lead', reviewModel }));
  const state = { workers: [{ id: 'lead', artifactDirectory, reviewModelDigest: reviewModelDigest(reviewModel) }] };
  const finding = { id: 'F1', raisedBy: { requestId: 'lead' } };
  assert.deepEqual(reviewModelInputChange(root, { reviewModel }), []);
  fs.writeFileSync(model, 'Expanded project policy');
  assert.deepEqual(reviewModelInputChange(root, { reviewModel }), [REVIEW_MODEL_PATH]);
  const originals = reviewModelsForFindings(root, state, [finding, { ...finding, id: 'F2' }]);
  assert.deepEqual(originals, [{ findingIds: ['F1', 'F2'], model: reviewModel.current }]);
  assert.match(reviewModelBrief({ current: captureReviewModel(root, tasks), originals }), /Project policy at lead assessment/);
  fs.writeFileSync(model, Buffer.from([255]));
  assert.throws(() => captureReviewModel(root, tasks), { code: 'review-model-unavailable' });
  assert.equal(reviewModelInputChange(root, { reviewModel }), null);
});

test('pre-reviewed spec loses readiness when its effective model widens', t => {
  const { root, model } = fixture(t);
  git(root, ['init', '--quiet']);
  const lines = ['Prior scope', 'More guidance', ''];
  fs.writeFileSync(model, lines.join(LF));
  fs.writeFileSync(path.join(root, 'spec.md'), 'Stable spec text');
  const task = { id: 'code', title: 'Code work', agreement: { source: 'User', outcome: 'Implement agreed work', spec: 'spec.md', specReviewed: true } };
  task.agreement.specReviewModelSha256 = captureReviewModel(root, [task]).scopes[0].sha256;
  const store = new RunStore(root, { create: true });
  try {
    const state = store.create({ objective: 'Reproduce scope widening', authority: 'User', controller: { host: 'codex', session: 'fixture' }, tasks: [task] });
    assert.equal(specReadiness(state, state.tasks[0]).ready, true);
    const reviewModel = { current: captureReviewModel(root, [task]) };
    fs.writeFileSync(model, lines.join(CRLF));
    assert.deepEqual(reviewModelInputChange(root, { reviewModel }), []);
    assert.equal(specReadiness(state, state.tasks[0]).ready, true);
    fs.writeFileSync(model, 'Expanded scope');
    const readiness = specReadiness(state, state.tasks[0]);
    assert.equal(readiness.ready, false);
    assert.match(readiness.cause, /bound to a changed or unreadable review model/);
  } finally { store.close(); }
});

test('legacy evidence without a model binding needs reassessment when an explicit project model appears', t => {
  const { root, model } = fixture(t);
  fs.writeFileSync(path.join(root, 'spec.md'), 'Stable spec text');
  const task = { id: 'code', title: 'Code work', agreement: { source: 'User', outcome: 'Implement agreed work', spec: 'spec.md', specReviewed: true } };
  const store = new RunStore(root, { create: true });
  try {
    const state = store.create({ objective: 'Read earlier review evidence', authority: 'User', controller: { host: 'codex', session: 'fixture' }, tasks: [task] });
    // Earlier development writers recorded the spec snapshot and did not write the model-digest field.
    delete state.tasks[0].agreement.specReviewModelSha256;
    assert.equal(specReadiness(state, state.tasks[0]).ready, true);
    assert.deepEqual(reviewModelInputChange(root, {}), []);
    applyReviewModel(root);
    assert.equal(captureReviewModel(root, []).source, 'project');
    assert.equal(specReadiness(state, state.tasks[0]).ready, true);
    assert.deepEqual(reviewModelInputChange(root, {}), []);
    fs.writeFileSync(model, 'Include hand-edited imports for this project.');
    assert.equal(specReadiness(state, state.tasks[0]).ready, false);
    assert.deepEqual(reviewModelInputChange(root, {}), [REVIEW_MODEL_PATH]);
  } finally { store.close(); }
});

for (const evidence of ['missing', 'stale', 'current']) {
  test(`handover readiness compares the originating review model: ${evidence}`, t => {
    const { root, model } = fixture(t);
    fs.writeFileSync(path.join(root, 'spec.md'), 'Stable spec text');
    fs.writeFileSync(model, 'Policy at standalone spec review');
    const task = { id: 'code', title: 'Code work', agreement: { source: 'User', outcome: 'Implement agreed work', spec: 'spec.md', specReviewed: true } };
    if (evidence !== 'missing') task.agreement.specReviewModelSha256 = captureReviewModel(root, [task]).scopes[0].sha256;
    if (evidence !== 'current') fs.writeFileSync(model, 'Policy expanded before handover');
    const store = new RunStore(root, { create: true });
    try {
      const state = store.create({ objective: 'Deliver assessed work', authority: 'User', controller: { host: 'codex', session: 'fixture' }, tasks: [task] });
      const readiness = specReadiness(state, state.tasks[0]);
      assert.equal(readiness.ready, evidence === 'current');
      if (evidence === 'missing') assert.match(readiness.cause, /without its originating review model identity/);
      if (evidence === 'stale') assert.match(readiness.cause, /bound to a changed or unreadable review model/);
    } finally { store.close(); }
  });
}

test('setup migration preserves the user review model bytes', t => {
  const { root, model } = fixture(t);
  git(root, ['init', '--quiet']);
  fs.mkdirSync(path.join(root, '.claude'));
  fs.writeFileSync(path.join(root, '.claude/FEATURES.md'), ['# Features', '', '## Current', ''].join(LF));
  const old = 'Consult [legacy features](../.claude/FEATURES.md).' + LF;
  fs.writeFileSync(model, old);
  initialize(root);
  assert.equal(fs.existsSync(path.join(root, '.claude/FEATURES.md')), false);
  assert.equal(fs.readFileSync(model, 'utf8'), old);
});

test('an ignored policy remains outside Git discovery while a merge replacement is prepared', t => {
  const { root, model } = fixture(t);
  git(root, ['init', '--quiet']);
  fs.writeFileSync(path.join(root, '.gitignore'), '/.nightshift/REVIEW.md' + LF);
  new Setup(root).close();
  applyReviewModel(root, undefined, source('Prior template'));
  fs.writeFileSync(model, 'Project guidance');
  const bundled = source('Updated template');
  const decision = approve(inspectReviewModel(root, bundled), 'Approved policy');
  let visibleAtPublication;
  mockPublication(t, (filename, run) => {
    if (filename === model) visibleAtPublication = git(root, ['ls-files', '--others', '--exclude-standard']);

    return run();
  });
  assert.equal(applyReviewModel(root, decision, bundled).status, 'merged');
  assert.equal(visibleAtPublication, '.gitignore');
});

for (const merge of [false, true]) {
  test(`a concurrent editor save survives review model publication with merge=${merge}`, t => {
    const { root, model } = fixture(t);
    const bundled = source('New bundled policy');
    let decision;
    if (merge) {
      applyReviewModel(root, undefined, source('Prior bundle'));
      fs.writeFileSync(model, 'Local policy before approval.');
      decision = approve(inspectReviewModel(root, bundled), 'Approved merged policy.');
    }
    const userBytes = 'The editor saved newer policy bytes.';
    let saved = false;
    const saveBefore = (from, to) => {
      if (!saved && (from === model || to === model)) {
        fs.writeFileSync(model, userBytes);
        saved = true;
      }
    };
    const rename = fs.renameSync;
    t.mock.method(fs, 'renameSync', (from, to) => { saveBefore(from, to); rename(from, to); });
    mockPublication(t, (filename, run) => { saveBefore(filename, filename); return run(); });
    assert.throws(() => applyReviewModel(root, decision, bundled), { code: 'review-model-drift' });
    assert.equal(saved, true);
    assert.equal(fs.readFileSync(model, 'utf8'), userBytes);
  });
}

test('a new save at the destination preserves both the live and displaced review policies', t => {
  const { root, model } = fixture(t);
  applyReviewModel(root, undefined, source('Prior bundle'));
  fs.writeFileSync(model, 'Approved starting policy');
  const bundled = source('New bundle');
  const decision = approve(inspectReviewModel(root, bundled), 'Proposed replacement');
  mockPublication(t, (filename, run) => {
    if (filename === model) fs.writeFileSync(model, 'New editor save', { flag: 'wx' });

    return run();
  });
  assert.throws(() => applyReviewModel(root, decision, bundled), { code: 'review-model-drift', message: /Displaced policy is preserved/ });
  const after = inspectReviewModel(root, bundled);
  assert.equal(after.status, 'compare');
  assert.equal(after.project.text, 'New editor save');
  assert.equal(fs.readFileSync(path.join(root, after.preservedPrevious), 'utf8'), 'Approved starting policy');
});

test('setup can seed and merge on a filesystem without hard links', t => {
  const { root, model } = fixture(t);
  const bundled = source('Bundled review model');
  const unsupported = t.mock.method(fs, 'linkSync', () => {
    const error = new Error('Simulated filesystem does not support hard links');
    error.code = 'ENOTSUP';
    throw error;
  });
  assert.deepEqual(applyReviewModel(root, undefined, bundled), { status: 'created' });
  assert.equal(fs.readFileSync(model, 'utf8'), bundled.text);
  fs.writeFileSync(model, 'Edited project model');
  const later = source('New bundled model');
  const decision = approve(inspectReviewModel(root, later), 'Approved combined policy');
  assert.equal(applyReviewModel(root, decision, later).status, 'merged');
  assert.equal(fs.readFileSync(model, 'utf8'), decision.text);
  assert.equal(unsupported.mock.callCount(), 0);
});

test('model capture rechecks an absent observation after a completed merge', t => {
  const { root, model } = fixture(t);
  applyReviewModel(root, undefined, source('Earlier bundle'));
  fs.writeFileSync(model, 'Earlier project model');
  const bundled = source('Next bundle');
  const decision = approve(inspectReviewModel(root, bundled), 'Approved next project model');
  const lstat = fs.lstatSync;
  let modelReads = 0;
  t.mock.method(fs, 'lstatSync', (file, options) => {
    if (file === model && options?.throwIfNoEntry === false && ++modelReads === 2) {
      assert.equal(applyReviewModel(root, decision, bundled).status, 'merged');

      return undefined;
    }

    return lstat(file, options);
  });
  const current = captureReviewModel(root, []);
  assert.equal(current.source, 'project');
  assert.equal(current.text, decision.text);
});

test('a pending merge prevents fallback when the project file is temporarily absent', t => {
  const { root, model } = fixture(t);
  applyReviewModel(root, undefined, source('Earlier bundle'));
  fs.writeFileSync(model, 'Earlier project model');
  const bundled = source('Next bundle');
  const decision = approve(inspectReviewModel(root, bundled), 'Approved next project model');
  const rename = fs.renameSync;
  let attempted = false;
  t.mock.method(fs, 'renameSync', (from, to) => {
    rename(from, to);
    if (from === model) {
      attempted = true;
      assert.throws(() => captureReviewModel(root, []), { code: 'review-model-unavailable', message: /preserved project review policy/ });
    }
  });
  assert.equal(applyReviewModel(root, decision, bundled).status, 'merged');
  assert.equal(attempted, true);
});

test('two readers can select a genuinely absent policy without contending for a writer lock', t => {
  const { root, model } = fixture(t);
  applyReviewModel(root, undefined, source('Bundled model'));
  fs.unlinkSync(model);
  const lstat = fs.lstatSync;
  let modelReads = 0;
  let concurrent;
  t.mock.method(fs, 'lstatSync', (file, options) => {
    if (file === model && options?.throwIfNoEntry === false && ++modelReads === 4) concurrent = captureReviewModel(root, []);

    return lstat(file, options);
  });
  assert.equal(captureReviewModel(root, []).source, 'bundled');
  assert.equal(concurrent?.source, 'bundled');
});

test('reconciling back to the same text still changes the publication journal identity', t => {
  const { root, model } = fixture(t);
  const earlier = source('Earlier bundle');
  const later = source('Later bundle');
  const journal = () => JSON.parse(fs.readFileSync(path.join(root, '.nightshift/setup/review-model.json'), 'utf8'));
  applyReviewModel(root, undefined, earlier);
  const start = journal();
  fs.writeFileSync(model, 'Project edit one');
  applyReviewModel(root, approve(inspectReviewModel(root, later), later.text), later);
  fs.writeFileSync(model, 'Project edit two');
  applyReviewModel(root, approve(inspectReviewModel(root, earlier), earlier.text), earlier);
  const end = journal();
  assert.equal(end.baseline, start.baseline);
  assert.equal(end.projectTextSha256, start.projectTextSha256);
  assert.notEqual(end.journalId, start.journalId);
});

test('a save through a displaced file remains visible when the published text matches the bundle', t => {
  const { root, model } = fixture(t);
  applyReviewModel(root, undefined, source('Prior bundle'));
  fs.writeFileSync(model, 'Approved starting policy');
  const bundled = source('New bundle');
  const decision = approve(inspectReviewModel(root, bundled), bundled.text);
  const rename = fs.renameSync;
  let displaced;
  t.mock.method(fs, 'renameSync', (from, to) => { if (from === model) displaced = to; rename(from, to); });
  mockPublication(t, (filename, run) => {
    const moved = run();
    if (filename === model && moved.status === 0) fs.writeFileSync(displaced, 'Late user save on the displaced file');

    return moved;
  });
  assert.throws(() => applyReviewModel(root, decision, bundled), {
    code: 'review-model-drift',
    message: /The displaced policy differs from the approved version[.] Displaced policy is preserved at .+[.]$/,
  });
  const report = applyReviewModel(root, undefined, bundled);
  assert.equal(report.status, 'recovery');
  assert.equal(fs.readFileSync(model, 'utf8'), bundled.text);
  const preserved = path.join(root, report.preservedPrevious);
  assert.equal(fs.readFileSync(preserved, 'utf8'), 'Late user save on the displaced file');
  const deferred = { text: 'Another ordinary merge', projectSha256: hash(fs.readFileSync(model)), bundledSha256: bundled.sha256 };
  assert.throws(() => applyReviewModel(root, deferred, bundled), { code: 'review-model-recovery-required' });
  assert.deepEqual(inspectReviewModel(root, bundled), report);

  const kept = preserved + '.kept';
  fs.renameSync(preserved, kept);
  assert.deepEqual(applyReviewModel(root, undefined, bundled), { status: 'matching' });
  assert.equal(fs.readFileSync(kept, 'utf8'), 'Late user save on the displaced file');
});

test('a failed publication restores the displaced policy and retains the merge baseline', t => {
  const { root, model } = fixture(t);
  const prior = source('Prior bundle');
  const bundled = source('New bundle');
  applyReviewModel(root, undefined, prior);
  const original = Buffer.from(['User policy', 'Keep this guidance', ''].join(CRLF));
  fs.writeFileSync(model, original);
  const decision = approve(inspectReviewModel(root, bundled), 'Approved merged text');
  const moves = [];
  mockPublication(t, (filename, run, part) => {
    assert.equal(filename, model);
    assert.equal(fs.existsSync(model), false);
    moves.push(part);

    return part === 'next' ? { status: 1, stderr: 'The staged replacement could not be moved' } : run();
  });
  assert.throws(() => applyReviewModel(root, decision, bundled), {
    code: 'review-model-publication-failed',
    message: 'Review model publication could not finish safely: The staged replacement could not be moved.',
  });
  assert.deepEqual(moves, ['next', 'previous']);
  assert.deepEqual(fs.readFileSync(model), original);
  const retry = inspectReviewModel(root, bundled);
  assert.equal(retry.status, 'merge');
  assert.equal(retry.baseline, prior.text);
  assert.equal(retry.preservedPrevious, undefined);
});

test('setup reports a preserved policy when interruption leaves the target absent', t => {
  const { root, model } = fixture(t);
  applyReviewModel(root, undefined, source('Prior bundle'));
  fs.writeFileSync(model, 'User policy');
  const bundled = source('New bundle');
  const decision = approve(inspectReviewModel(root, bundled), 'Approved merged text');
  const stopped = mockPublication(t, (filename, run) => filename === model ? { status: 1, stderr: 'Publication and restoration were unavailable.' } : run());
  assert.throws(() => applyReviewModel(root, decision, bundled), {
    code: 'review-model-publication-failed',
    message: /Publication and restoration were unavailable[.] Restoration needs attention: Publication and restoration were unavailable[.] Check for the displaced policy at .+[.]$/,
  });
  stopped.mock.restore();
  const recovery = applyReviewModel(root, undefined, bundled);
  assert.equal(recovery.status, 'recovery');
  assert.deepEqual(inspectReviewModel(root, bundled), recovery);
  assert.equal(fs.existsSync(model), false);
  assert.equal(fs.readFileSync(path.join(root, recovery.preservedPrevious), 'utf8'), 'User policy');
  assert.throws(() => captureReviewModel(root, []), { code: 'review-model-unavailable', message: /preserved project review policy/ });
});

test('a blocked initial move reports the environment failure and keeps the original merge baseline', t => {
  const { root, model } = fixture(t);
  const prior = source('Prior bundle');
  const bundled = source('New bundle');
  applyReviewModel(root, undefined, prior);
  fs.writeFileSync(model, 'Project guidance');
  const decision = approve(inspectReviewModel(root, bundled), 'Approved merged text');
  const rename = fs.renameSync;
  const blocked = t.mock.method(fs, 'renameSync', (from, to) => {
    if (from === model) throw Object.assign(new Error('The policy is locked by another program'), { code: 'EACCES' });
    rename(from, to);
  });
  assert.throws(() => applyReviewModel(root, decision, bundled), {
    code: 'review-model-publication-failed',
    message: /The policy is locked by another program/,
  });
  blocked.mock.restore();
  const retry = inspectReviewModel(root, bundled);
  assert.equal(retry.status, 'merge');
  assert.equal(retry.baseline, prior.text);
  assert.equal(retry.project.text, 'Project guidance');
  assert.equal(applyReviewModel(root, undefined, bundled).status, 'merge');
  fs.writeFileSync(model, 'New project guidance');
  assert.equal(inspectReviewModel(root, bundled).baseline, prior.text);
});
