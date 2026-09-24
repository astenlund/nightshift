'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createHash } = require('node:crypto');
const { executable, pluginVersion, runAgent } = require('../internal/runtime/hosts');
const { resolveTrustedExecutable } = require('../internal/filesystem-primitives');
const { spawnWindowsJob } = require('../internal/runtime/windows-job');
const { OUTPUT_LOOP_MIN_DELTAS, OUTPUT_LOOP_MIN_MS, outputLoopDetector, outputLoopMessage } = require('../internal/runtime/output-loop');

function fixture(t, host, mode = 'success') {
  const parent = path.resolve(__dirname, '../.tmp/host-protocol-tests');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'project');
  fs.mkdirSync(cwd);
  const systemFile = path.join(root, 'system.md');
  fs.writeFileSync(systemFile, 'Fixture instructions.\r\n');
  return { host, cwd, artifacts: path.join(root, 'artifacts'), systemFile, prompt: 'Fixture assessment', executable: process.execPath, commandPrefix: [path.join(__dirname, 'fixtures/runtime-host.cjs')], model: host === 'claude' ? 'claude-fable-5-1' : 'gpt-6-astra', timeoutMs: 2000, directProcess: true, env: { ...process.env, NIGHTSHIFT_TEST_HOST_MODE: mode } };
}

for (const host of ['claude', 'codex']) {
  test(`${host} protocol reports actual attribution, usage and early process/session identity`, async t => {
    const options = fixture(t, host);
    let pid;
    let session;
    const result = await runAgent({ ...options, onProcess: value => { pid = value; }, onSession: value => { session = value; } });
    assert.equal(result.status, 'complete');
    assert.equal(result.attributionVerified, true);
    assert.equal(result.tokens, host === 'claude' ? 14 : 17);
    assert.ok(Number.isInteger(pid));
    assert.equal(session, 'fixture-session');
  });

  test(`${host} attribution mismatch and malformed output cannot be clean evidence`, async t => {
    const wrong = await runAgent(fixture(t, host, 'wrong-model'));
    assert.equal(wrong.attributionVerified, false);
    try {
      const malformed = await runAgent(fixture(t, host, 'malformed'));
      assert.equal(malformed.status, 'failed');
    } catch (error) { assert.match(error.message, /closed/); }
  });

  test(`${host} missing executable rejects or fails promptly without leaking a timer`, async t => {
    const options = fixture(t, host);
    const started = Date.now();
    let result;
    try { result = await runAgent({ ...options, executable: path.join(options.cwd, 'missing.exe'), commandPrefix: [] }); }
    catch (error) { assert.match(error.message, /failed to start|closed/); }
    if (result) assert.equal(result.status, 'failed');
    assert.ok(Date.now() - started < 1500);
  });

  test(`${host} timeout and early closure are incomplete and reclaim the direct process`, async t => {
    for (const mode of ['timeout', 'early-close']) {
      const options = fixture(t, host, mode);
      let pid;
      let result;
      try { result = await runAgent({ ...options, timeoutMs: 150, onProcess: value => { pid = value; } }); }
      catch (error) { assert.match(error.message, /closed|timed out|failed/); }
      if (result) assert.equal(result.status, 'failed');
      if (pid) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
  });
}

test('Codex handshake identifies the plugin with the manifest version', async t => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(pluginVersion(), manifest.version);
  const accepted = fixture(t, 'codex');
  const result = await runAgent({ ...accepted, env: { ...accepted.env, NIGHTSHIFT_TEST_EXPECTED_VERSION: manifest.version } });
  assert.equal(result.status, 'complete');
  const rejected = fixture(t, 'codex');
  await assert.rejects(runAgent({ ...rejected, env: { ...rejected.env, NIGHTSHIFT_TEST_EXPECTED_VERSION: 'not-the-manifest-version' } }), /fixture rejected client version/);
});

test('Codex request rejection is collected and the process is reclaimed', async t => {
  await assert.rejects(runAgent(fixture(t, 'codex', 'request-error')), /fixture request rejected/);
});

for (const mode of ['reroute-away', 'reroute-back', 'reroute-return-only', 'reroute-foreign', 'reroute-same']) {
  test(`Codex model attribution retains scoped reroute evidence: ${mode}`, async t => {
    const result = await runAgent(fixture(t, 'codex', mode));
    assert.equal(result.attributionVerified, mode === 'reroute-foreign' || mode === 'reroute-same');
    assert.equal(result.model, mode === 'reroute-away' ? 'other-model' : 'gpt-6-astra');
    assert.equal(result.output, 'Fixture assessment');
    assert.equal(result.tokens, 17);
  });
}

test('output-loop detection needs both the duration and the delta count of one whitespace-only run', () => {
  const feed = (detect, deltas) => deltas.map(delta => detect(delta)).filter(Boolean);
  const whitespace = (count, start, spanMs, itemId = 'message') => Array.from({ length: count }, (_, index) => ({ itemId, delta: '\n', at: start + Math.round(index * spanMs / Math.max(1, count - 1)) }));
  // The longest whitespace stretch in a completed recorded review: 220 deltas over 6.6 s.
  assert.deepEqual(feed(outputLoopDetector(), [{ itemId: 'message', delta: '{', at: 0 }, ...whitespace(220, 1, 6618)]), []);
  assert.deepEqual(feed(outputLoopDetector(), whitespace(5000, 0, OUTPUT_LOOP_MIN_MS - 1)), []);
  assert.deepEqual(feed(outputLoopDetector(), whitespace(OUTPUT_LOOP_MIN_DELTAS - 1, 0, 600000)), []);
  const detected = feed(outputLoopDetector(), [{ itemId: 'message', delta: 'text', at: 1000 }, ...whitespace(OUTPUT_LOOP_MIN_DELTAS, 2000, OUTPUT_LOOP_MIN_MS)]);
  assert.deepEqual(detected, [{ deltas: OUTPUT_LOOP_MIN_DELTAS, durationMs: OUTPUT_LOOP_MIN_MS, lastTextAt: 1000 }]);
  assert.match(outputLoopMessage(detected[0]), /only whitespace for 120 s \(1000 deltas\) after its last text at 1970-01-01T00:00:01.000Z/);
  const interrupted = [...whitespace(900, 0, 100000), { itemId: 'message', delta: 'x', at: 100001 }, ...whitespace(900, 100002, 100000)];
  assert.deepEqual(feed(outputLoopDetector(), interrupted), []);
  const newMessage = [...whitespace(900, 0, 100000), ...whitespace(900, 100001, 100000, 'next-message')];
  assert.deepEqual(feed(outputLoopDetector(), newMessage), []);
});

test('Codex attempts end on a sustained whitespace-only message but tolerate a brief whitespace burst', async t => {
  const outputLoop = { minMs: 200, minDeltas: 10 };
  await assert.rejects(runAgent({ ...fixture(t, 'codex', 'whitespace-loop'), outputLoop }), { code: 'output-loop', message: /only whitespace for \d+ s \(\d+ deltas\) after its last text at / });
  const burst = await runAgent({ ...fixture(t, 'codex', 'whitespace-burst'), outputLoop });
  assert.equal(burst.status, 'complete');
});

test('server request ids cannot collide with pending client response ids', async t => {
  const result = await runAgent(fixture(t, 'codex', 'colliding-request'));
  assert.equal(result.status, 'complete');
  assert.equal(result.output, 'Fixture assessment');
});

test('the canonical project is excluded from host and PowerShell executable resolution', { skip: process.platform !== 'win32' }, t => {
  const options = fixture(t, 'claude');
  const canonical = options.cwd;
  const workspace = path.join(canonical, 'review-workspace');
  const toolsDirectory = path.join(canonical, 'tools');
  fs.mkdirSync(workspace);
  fs.mkdirSync(toolsDirectory);
  for (const name of ['claude.exe', 'pwsh.exe']) fs.writeFileSync(path.join(toolsDirectory, name), 'Harmless resolver marker; do not execute.\n');
  const previousPath = process.env.PATH;
  process.env.PATH = toolsDirectory + path.delimiter + previousPath;
  const assertProtected = (resolve, marker) => {
    let selected;
    try { selected = resolve(); }
    catch (error) { assert.equal(error.message, 'No trusted executable was found'); return; }
    assert.notEqual(selected, marker);
  };
  try {
    assert.equal(executable('claude', workspace), path.join(toolsDirectory, 'claude.exe'));
    assertProtected(() => executable('claude', canonical), path.join(toolsDirectory, 'claude.exe'));
    assert.equal(resolveTrustedExecutable({ root: workspace, basename: 'pwsh.exe' }), path.join(toolsDirectory, 'pwsh.exe'));
    assertProtected(() => resolveTrustedExecutable({ root: canonical, basename: 'pwsh.exe' }), path.join(toolsDirectory, 'pwsh.exe'));
  } finally { process.env.PATH = previousPath; }
});

for (const leaf of ['--duplex-leaf', '--no-input-leaf']) {
  test(`Windows pipes keep output and cancellation live while stdin is pending: ${leaf}`, { skip: process.platform !== 'win32' }, async t => {
    const options = fixture(t, 'codex');
    const child = spawnWindowsJob(process.execPath, [path.join(__dirname, 'fixtures/runtime-host.cjs'), leaf], { cwd: options.cwd, env: process.env });
    let outputBytes = 0;
    let tail = '';
    const errors = [];
    child.on('error', error => errors.push(error.message));
    child.stdin.on('error', error => errors.push(error.message));
    child.stdout.on('data', bytes => { outputBytes += bytes.length; tail = (tail + bytes.toString()).slice(-100); });
    child.stderr.resume();
    let timer;
    const input = Buffer.from(Array.from({ length: 256 * 1024 }, (_, index) => index % 251));
    child.once('spawn', () => {
      child.stdin.end(input);
      timer = setTimeout(() => child.kill(), leaf === '--duplex-leaf' ? 12000 : 500);
    });
    await new Promise(resolve => child.once('close', resolve));
    clearTimeout(timer);
    assert.equal(child.jobEmpty, true, errors.join('; '));
    assert.deepEqual(errors, []);
    if (leaf === '--duplex-leaf') {
      assert.equal(child.exitCode, 0);
      assert.ok(outputBytes > 2 * 1024 * 1024);
      assert.ok(tail.endsWith('READ:262144:' + createHash('sha256').update(input).digest('hex') + '\n'));
      assert.equal(child.diagnostics.filter(item => item.kind === 'input-accepted').length, 16);
    } else assert.equal(child.signalCode, 'SIGTERM');
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
  });
}

for (const mode of ['missing-params', 'missing-item', 'missing-usage']) {
  test(`Codex malformed ${mode} is bounded failure evidence and reclaims the host`, async t => {
    let pid;
    try {
      const result = await runAgent({ ...fixture(t, 'codex', mode), onProcess: value => { pid = value; } });
      assert.equal(result.status, 'failed');
      assert.ok(result.exit.error);
    } catch (error) { assert.match(error.message, /closed/); }
    assert.ok(pid);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  });
}

test('Claude native is_error is incomplete even when subtype says success', async t => {
  assert.equal((await runAgent(fixture(t, 'claude', 'error-result'))).status, 'failed');
});

test('Windows job containment carries the actual host protocol and proves descendants have ended', { skip: process.platform !== 'win32' }, async t => {
  const normal = await runAgent({ ...fixture(t, 'claude'), directProcess: false, timeoutMs: 10000 });
  assert.equal(normal.status, 'complete', JSON.stringify({ exit: normal.exit, output: normal.output }));
  assert.equal(normal.exit.descendantsReclaimed, true);
  const codex = await runAgent({ ...fixture(t, 'codex'), directProcess: false, timeoutMs: 10000 });
  assert.equal(codex.status, 'complete');
  assert.equal(codex.exit.descendantsReclaimed, true);
  const options = { ...fixture(t, 'claude', 'descendant'), directProcess: false, timeoutMs: 2500 };
  const stopped = await runAgent(options);
  assert.equal(stopped.status, 'failed');
  assert.equal(stopped.exit.descendantsReclaimed, true);
  const pid = Number(fs.readFileSync(path.join(options.cwd, 'descendant.pid'), 'utf8').trim());
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
