'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { runProbe } = require('../internal/runtime/probes');
const { snapshot } = require('../internal/runtime/evidence');
const { execute } = require('../internal/runtime/cli');
const { RunStore } = require('../internal/runtime/store');
const { DIMENSIONS } = require('../internal/runtime/lifecycle');

test('ordinary probe Git commands resolve to the private copy and preserve canonical metadata', t => {
  const parent = path.resolve(__dirname, '../.tmp/probe-git');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = args => spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
  assert.equal(git(['init', '--quiet']).status, 0);
  assert.equal(git(['config', '--local', 'nightshift.probeBoundary', 'canonical']).status, 0);
  fs.writeFileSync(path.join(root, 'subject.txt'), 'Fixture\n');
  const receipt = { requestId: randomUUID(), runId: 'fixture', taskId: 'work', snapshot: snapshot(root, ['subject.txt']) };
  const reference = runProbe(root, receipt, { id: 'git', purpose: 'Observe local Git behavior', executable: 'git', args: ['config', '--local', 'nightshift.probeBoundary', 'private'], files: [], timeoutMs: 10000 });
  const result = JSON.parse(fs.readFileSync(path.join(root, reference.path), 'utf8'));
  assert.equal(result.exitCode, 0);
  assert.equal(result.canonicalUnchanged, true);
  assert.equal(git(['config', '--local', '--get', 'nightshift.probeBoundary']).stdout.trim(), 'canonical');
});

for (const withSelectedArtifact of [false, true]) {
  test(`a read-only assessor receives private execution evidence with selected artifact=${withSelectedArtifact}`, async t => {
    const parent = path.resolve(__dirname, '../.tmp/probe-integration');
    fs.mkdirSync(parent, { recursive: true });
    const root = fs.mkdtempSync(path.join(parent, 'case-'));
    const git = args => {
      const result = spawnSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout.trim();
    };
    git(['init', '--quiet']);
    fs.writeFileSync(path.join(root, 'answer.cjs'), 'module.exports = 41;\n');
    git(['add', 'answer.cjs']);
    git(['-c', 'user.name=Nightshift fixture', '-c', 'user.email=a.stenlund@gmail.com', 'commit', '--quiet', '-m', 'test(fixture): establish probe input']);
    const baseSha = git(['rev-parse', 'HEAD']);
    if (withSelectedArtifact) {
      fs.mkdirSync(path.join(root, '.tmp'));
      fs.writeFileSync(path.join(root, '.tmp/material.txt'), 'Explicit deciding material\r\n');
      fs.writeFileSync(path.join(root, '.tmp/unrelated.txt'), 'Unrelated scratch input\r\n');
    }
    const store = new RunStore(root, { create: true });
    t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
    const actor = { host: 'claude', session: 'controller' };
    store.create({ objective: 'Verify the private probe path', authority: 'User test request', controller: actor, tasks: [{ id: 'work', title: 'Work', agreement: { source: 'User', outcome: 'Canonical inputs remain untouched while independent probes execute' } }] });
    const review = { kind: 'code', baseSha, artifactPaths: withSelectedArtifact ? ['.tmp/material.txt'] : [], requirements: 'Canonical inputs remain untouched', rules: 'Independent reviewer cannot modify canonical project inputs.', candidates: [{ host: 'claude', model: 'claude-fable-5-1', effort: 'high' }] };
    const selectedCheck = withSelectedArtifact ? "const assert = require('node:assert/strict');\nassert.equal(fs.readFileSync('.tmp/material.txt', 'utf8').trim(), 'Explicit deciding material');\nassert.equal(fs.existsSync('.tmp/unrelated.txt'), false);\n" : '';
    const probe = { id: 'mutation', purpose: 'Observe behavior before and after a private fixture mutation', executable: process.execPath, args: ['probe.cjs'], timeoutMs: 10000, files: [{ path: 'probe.cjs', content: "const fs = require('node:fs');\n" + selectedCheck + "const before = require('./answer.cjs');\nfs.writeFileSync('answer.cjs', 'module.exports = 42;\\n');\nconsole.log(JSON.stringify({ before, after: 42 }));\n" }] };
    const agent = (complete, hasEvidence = complete) => options => {
      fs.mkdirSync(options.artifacts, { recursive: true });
      if (hasEvidence) {
        const evidence = JSON.parse(fs.readFileSync(path.join(options.cwd, 'context/probes/1.json'), 'utf8'));
        assert.equal(evidence.canonicalUnchanged, true);
        assert.equal(evidence.exitCode, 0);
        assert.deepEqual(JSON.parse(evidence.output), { before: 41, after: 42 });
      } else assert.equal(fs.existsSync(path.join(options.cwd, 'context/probes')), false);
      const output = { requestId: options.schema.properties.requestId.enum[0], status: complete ? 'complete' : 'incomplete', coverage: DIMENSIONS.code.map(dimension => ({ dimension, evidence: 'Fixture evidence assessed' })), findings: [], summary: complete ? 'Execution evidence resolves the question' : 'Need deciding execution evidence', probes: complete ? [] : [probe] };
      const session = complete ? 'final-assessor' : 'requesting-assessor';
      const events = [{ type: 'assistant', session_id: session, message: { model: options.model, content: [] } }, { type: 'result', session_id: session, subtype: 'success', is_error: false, structured_output: output }];
      fs.writeFileSync(path.join(options.artifacts, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n');
      return { host: options.host, model: options.model, effort: options.effort, session, attributionVerified: true, status: 'complete', output, tokens: 0 };
    };
    const dispatch = async (complete, hasEvidence = complete) => execute(root, { action: 'dispatch', actor, revision: store.read().revision, taskId: 'work', review }, { runAgent: agent(complete, hasEvidence) });
    const first = await dispatch(false);
    assert.equal(first.receipt.status, 'incomplete');
    await execute(root, { action: 'probe', actor, revision: store.read().revision, taskId: 'work', receipt: path.relative(root, first.receiptFile).split(path.sep).join('/'), probeId: 'mutation' });
    assert.equal(fs.readFileSync(path.join(root, 'answer.cjs'), 'utf8'), 'module.exports = 41;\n');
    const second = await dispatch(true);
    assert.equal(second.receipt.status, 'complete');
    assert.equal(second.receipt.probes.length, 0);
    const act = request => execute(root, { actor, revision: store.read().revision, taskId: 'work', ...request });
    const importReview = result => act({ action: 'review', receipt: path.relative(root, result.receiptFile).split(path.sep).join('/') });
    const check = () => act({ action: 'check', check: { name: 'Current fixture verification', executable: process.execPath, args: ['--version'], paths: ['answer.cjs', 'README.md'] } });
    await importReview(second);
    await check();
    await act({ action: 'advance' });
    fs.writeFileSync(path.join(root, 'README.md'), '# Updated documentation\n');
    await assert.rejects(act({ action: 'advance', evidence: 'Documentation updated' }), { code: 'review-required' });
    const refreshed = await dispatch(true, false);
    await importReview(refreshed);
    await check();
    await act({ action: 'advance' });
    await act({ action: 'advance', evidence: 'Documentation updated' });
    await act({ action: 'retrospective', evidence: 'Retrospective completed' });
    await act({ action: 'triage', evidence: 'Triage completed' });
    await act({ action: 'complete' });
    assert.equal(store.read().status, 'complete');
    assert.equal(store.read().tasks[0].probeEvidence.length, 1);
  });
}
