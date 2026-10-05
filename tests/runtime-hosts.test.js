'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { executable, pluginVersion, runAgent } = require('../internal/runtime/hosts');
const { resolveTrustedExecutable } = require('../internal/filesystem-primitives');
const { lingeringProcesses, spawnWindowsJob, startFailure } = require('../internal/runtime/windows-job');
const { HOOK_INSPECTION_BUDGET_MS, INSPECTION_BUDGET_MS, information, runContained } = require('../internal/releases/processes');
const { OUTPUT_LOOP_MIN_DELTAS, OUTPUT_LOOP_MIN_MS, outputLoopDetector, outputLoopMessage } = require('../internal/runtime/output-loop');
const { artifactFailure } = require('./fixtures/artifact-failure');

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

test('Claude resumes the named session from the new copy and attributes only that session', async t => {
  // Arrange
  const options = fixture(t, 'claude');

  // Act
  const resumed = await runAgent({ ...options, session: 'earlier-session' });
  const args = JSON.parse(fs.readFileSync(path.join(options.cwd, 'claude-args.json'), 'utf8'));
  const switched = await runAgent({ ...fixture(t, 'claude', 'resume-new-session'), session: 'earlier-session' });
  const missing = await runAgent({ ...fixture(t, 'claude', 'resume-missing'), session: 'earlier-session' });

  // Assert
  assert.equal(args[args.indexOf('--resume') + 1], 'earlier-session');
  for (const flag of ['--print', '--safe-mode', '--strict-mcp-config', '--system-prompt-file', '--tools']) assert.ok(args.includes(flag), flag);
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.session, 'earlier-session');
  assert.equal(resumed.attributionVerified, true);
  assert.equal(switched.session, 'unrequested-session');
  assert.equal(switched.attributionVerified, false);
  assert.equal(missing.status, 'failed');
});

test('Codex resumes the thread in the new copy with the dispatch policy and charges only its own turn', async t => {
  // Arrange
  const options = fixture(t, 'codex');

  // Act
  const resumed = await runAgent({ ...options, session: 'earlier-thread' });
  const params = JSON.parse(fs.readFileSync(path.join(options.cwd, 'resume-params.json'), 'utf8'));
  const fromPrior = await runAgent({ ...fixture(t, 'codex', 'resume-no-baseline'), session: 'earlier-thread', priorThreadTokens: 100 });
  const unknown = await runAgent({ ...fixture(t, 'codex', 'resume-no-baseline'), session: 'earlier-thread' });
  const switched = await runAgent({ ...fixture(t, 'codex', 'resume-new-session'), session: 'earlier-thread' });
  const fresh = await runAgent(fixture(t, 'codex'));

  // Assert
  assert.deepEqual({ threadId: params.threadId, cwd: params.cwd, model: params.model, approvalPolicy: params.approvalPolicy, sandbox: params.sandbox, excludeTurns: params.excludeTurns }, { threadId: 'earlier-thread', cwd: options.cwd, model: 'gpt-6-astra', approvalPolicy: 'never', sandbox: 'read-only', excludeTurns: true });
  assert.deepEqual(params.config, { project_doc_max_bytes: 0, model_reasoning_effort: 'high', features: { multi_agent: false, plugins: false, hooks: false, apps: false } });
  assert.equal(params.baseInstructions, 'Fixture instructions.\r\n');
  assert.equal(Object.hasOwn(params, 'allowProviderModelFallback'), false);
  assert.equal(resumed.status, 'complete');
  assert.equal(resumed.session, 'earlier-thread');
  assert.equal(resumed.attributionVerified, true);
  assert.deepEqual({ tokens: resumed.tokens, threadTokens: resumed.threadTokens }, { tokens: 30, threadTokens: 130 });
  assert.equal(fromPrior.tokens, 30);
  assert.equal(unknown.tokens, null);
  assert.equal(switched.attributionVerified, false);
  assert.deepEqual({ tokens: fresh.tokens, threadTokens: fresh.threadTokens }, { tokens: 17, threadTokens: 17 });
});

test('Claude charges a resumed attempt only its own usage and leaves doubtful figures unknown', async t => {
  // Arrange
  const resume = (priorThreadTokens, mode) => runAgent({ ...fixture(t, 'claude', mode), session: 'earlier-session', priorThreadTokens });

  // Act
  const fresh = await runAgent(fixture(t, 'claude'));
  const resumed = await resume(100);
  const doubtful = {
    unknownBaseline: await resume(null),
    negative: await resume(130),
    belowInvocation: await resume(110),
    newSession: await resume(100, 'resume-new-session'),
    unreportedInvocation: await resume(100, 'missing-invocation-usage'),
  };

  // Assert
  assert.deepEqual({ tokens: fresh.tokens, threadTokens: fresh.threadTokens }, { tokens: 14, threadTokens: 14 });
  assert.deepEqual({ tokens: resumed.tokens, threadTokens: resumed.threadTokens }, { tokens: 20, threadTokens: 120 });
  for (const [name, result] of Object.entries(doubtful)) assert.equal(result.tokens, null, name);
});

for (const basename of ['stderr.txt', 'events.jsonl']) {
  test(`a ${basename} write failure after the host starts ends the attempt with its operating-system error on both hosts`, async t => {
    // Arrange
    const inject = artifactFailure(t, basename);
    const failures = {};

    // Act
    for (const host of ['claude', 'codex']) failures[host] = await runAgent({ ...fixture(t, host, 'timeout'), onProcess: inject }).then(() => null, error => error);

    // Assert
    for (const host of ['claude', 'codex']) assert.deepEqual({ code: failures[host]?.code, errno: failures[host]?.errno }, { code: 'ENOSPC', errno: -4055 }, host);
  });
}

// A direct spawn reports its start before any artifact file can fail to open; a Windows job reports it later, through its runner.
test('an artifact write failure before the host starts stays a start failure on both hosts', { skip: process.platform !== 'win32' }, async t => {
  // Arrange
  artifactFailure(t, 'stderr.txt', { onCreate: true });
  const failures = {};

  // Act
  for (const host of ['claude', 'codex']) failures[host] = await runAgent({ ...fixture(t, host, 'timeout'), directProcess: false, timeoutMs: 60000 }).then(() => null, error => error);

  // Assert
  for (const host of ['claude', 'codex']) assert.equal(failures[host]?.code, 'host-start-failed', host);
});

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

test('a Codex attempt ended as an output loop keeps the usage its host reported, as its own increment when resumed', async t => {
  // Arrange
  const outputLoop = { minMs: 200, minDeltas: 10 };
  const loop = options => runAgent({ ...options, outputLoop }).then(() => null, error => error);

  // Act
  const fresh = await loop(fixture(t, 'codex', 'whitespace-loop'));
  const resumed = await loop({ ...fixture(t, 'codex', 'whitespace-loop'), session: 'earlier-thread' });
  const unmetered = await loop(fixture(t, 'codex', 'whitespace-loop-unmetered'));

  // Assert
  assert.deepEqual([fresh, resumed, unmetered].map(error => ({ code: error?.code, tokens: error?.tokens })), [
    { code: 'output-loop', tokens: 17 },
    { code: 'output-loop', tokens: 30 },
    { code: 'output-loop', tokens: null },
  ]);
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

test('the native ancestry walk names where it reached an exited parent and still identifies live owners', { skip: process.platform !== 'win32' }, t => {
  const root = path.resolve(__dirname, '..');
  const started = spawnSync(process.execPath, [path.join(__dirname, 'fixtures/orphan-parent.js')], { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  assert.equal(started.status, 0, started.stderr);
  const orphan = Number(started.stdout.trim());
  t.after(() => { try { process.kill(orphan); } catch { /* The orphan already ended. */ } });
  const observed = information(orphan, 'claude', root);
  assert.equal(observed.found, false);
  assert.equal(observed.exitedParent.child, 'node.exe');
  assert.ok(Number.isSafeInteger(observed.exitedParent.pid) && observed.exitedParent.pid > 0);
  assert.deepEqual(Object.keys(observed).sort(), ['exitedParent', 'found']);
  const self = information(process.pid, 'node', root);
  assert.equal(self.found, true);
  assert.equal(self.pid, process.pid);
  assert.equal(information(orphan, null, root).found, true);
});

// Simulated inspection attempts: each answer is a spawnSync-shaped result, optionally after blocking for delayMs.
function scriptedInspection(answers) {
  const timeouts = [];
  const run = (executable, args, options) => {
    timeouts.push(options.timeout);
    const { delayMs = 0, ...answer } = answers.shift();
    if (delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);

    return answer;
  };

  return { run, timeouts };
}

const found = { found: true, pid: 4321, created: '638000000000000000', name: 'node.exe' };
const timedOut = () => ({ status: null, signal: 'SIGTERM', stdout: '', stderr: '', error: Object.assign(new Error('spawnSync pwsh.exe ETIMEDOUT'), { code: 'ETIMEDOUT' }) });

test('a slow inspection is admitted within the budget that allows for a loaded PowerShell start', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '..');
  const { run, timeouts } = scriptedInspection([{ delayMs: 300, status: 0, stdout: JSON.stringify(found) }]);
  const failures = [];
  assert.deepEqual(information(found.pid, null, root, { run, onFailure: cause => failures.push(cause) }), found);
  assert.equal(timeouts.length, 1);
  // The first attempt may use the whole budget, which is three times the bound that refused checks under load.
  assert.ok(timeouts[0] > INSPECTION_BUDGET_MS - 1000 && timeouts[0] <= INSPECTION_BUDGET_MS, `first attempt allowed ${timeouts[0]} ms`);
  assert.equal(INSPECTION_BUDGET_MS, 30000);
  assert.deepEqual(failures, []);
});

test('an inspection that fails quickly is retried once within the remaining budget', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '..');
  const { run, timeouts } = scriptedInspection([
    { delayMs: 300, status: 1, stdout: '', stderr: 'Get-CimInstance : Call was canceled by the message filter.' },
    { status: 0, stdout: JSON.stringify(found) },
  ]);
  const failures = [];
  assert.deepEqual(information(found.pid, null, root, { budgetMs: 5000, run, onFailure: cause => failures.push(cause) }), found);
  assert.equal(timeouts.length, 2);
  assert.ok(timeouts[1] <= 5000 - 300, `the retry was allowed ${timeouts[1]} ms after a 300 ms failure`);
  assert.deepEqual(failures, []);
});

test('a failed inspection grants nothing and reports the cause of each attempt', { skip: process.platform !== 'win32' }, async t => {
  const root = path.resolve(__dirname, '..');
  await t.test('a persistent failure', () => {
    const noisy = 'Get-CimInstance :\r\n   Invalid   class ' + 'x'.repeat(400);
    const { run, timeouts } = scriptedInspection([{ status: 1, stdout: '', stderr: noisy }, { status: 0, stdout: 'Update available\r\n{"found":true' }]);
    const failures = [];
    assert.equal(information(found.pid, 'claude', root, { run, onFailure: cause => failures.push(cause) }), null);
    assert.equal(timeouts.length, 2);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /^PowerShell exited with code 1: Get-CimInstance : Invalid class x+\.\.\.; retry: unreadable output: Update available \{"found":true$/);
    assert.ok(failures[0].split('; retry: ')[0].length < 260, 'the excerpt of noisy output is bounded');
  });
  await t.test('a timeout spends the budget and is not retried', () => {
    const { run, timeouts } = scriptedInspection([timedOut()]);
    const failures = [];
    assert.equal(information(found.pid, null, root, { run, onFailure: cause => failures.push(cause) }), null);
    assert.equal(timeouts.length, 1);
    assert.deepEqual(failures, [`timed out after ${timeouts[0]} ms`]);
  });
  await t.test('a malformed process record and a failed start', () => {
    const { run } = scriptedInspection([{ status: 0, stdout: '{"found":true,"pid":"4321"}' }, { status: null, stdout: '', stderr: '', error: Object.assign(new Error('spawnSync pwsh.exe EACCES'), { code: 'EACCES' }) }]);
    const failures = [];
    assert.equal(information(found.pid, null, root, { run, onFailure: cause => failures.push(cause) }), null);
    assert.deepEqual(failures, ['unreadable output: {"found":true,"pid":"4321"}; retry: could not run PowerShell: spawnSync pwsh.exe EACCES']);
  });
  await t.test('a not-found observation is an answer, not a failure', () => {
    const { run, timeouts } = scriptedInspection([{ status: 0, stdout: '{"found":false}' }]);
    const failures = [];
    assert.deepEqual(information(found.pid, null, root, { run, onFailure: cause => failures.push(cause) }), { found: false });
    assert.equal(timeouts.length, 1);
    assert.deepEqual(failures, []);
  });
});

test('a hook-path inspection keeps its shorter total, retry included', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(__dirname, '..');
  const { run, timeouts } = scriptedInspection([{ delayMs: 200, status: 1, stdout: '', stderr: 'transient' }, timedOut()]);
  const failures = [];
  assert.equal(information(found.pid, null, root, { budgetMs: HOOK_INSPECTION_BUDGET_MS, run, onFailure: cause => failures.push(cause) }), null);
  assert.equal(HOOK_INSPECTION_BUDGET_MS, 10000);
  assert.ok(timeouts[0] <= HOOK_INSPECTION_BUDGET_MS && timeouts[1] <= HOOK_INSPECTION_BUDGET_MS - 200, `attempts allowed ${timeouts.join(' and ')} ms`);
  assert.deepEqual(failures, [`PowerShell exited with code 1: transient; retry: timed out after ${timeouts[1]} ms`]);
});

test('a real inspection that runs out of time reports a timeout', { skip: process.platform !== 'win32' }, () => {
  const failures = [];
  assert.equal(information(process.pid, null, path.resolve(__dirname, '..'), { budgetMs: 1, onFailure: cause => failures.push(cause) }), null);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /^timed out after \d+ ms$/);
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
      // The duplex kill only guards against a hang; a loaded machine can take far longer than an idle one to move 2 MiB through the runner.
      timer = setTimeout(() => child.kill(), leaf === '--duplex-leaf' ? 90000 : 500);
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

test('Windows job start failures name the executable, the failing stage and the Windows error', { skip: process.platform !== 'win32' }, async t => {
  // Arrange
  const options = fixture(t, 'codex');
  const missing = path.join(options.cwd, 'missing-host.exe');
  const expected = new RegExp(`could not start the host ${missing.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(create-process\\): Windows error 2: \\S`);

  // Act
  const child = spawnWindowsJob(missing, [], { cwd: options.cwd, env: process.env });
  const errors = [];
  child.on('error', error => errors.push(error.message));
  await new Promise(resolve => child.once('close', resolve));
  const hostFailures = [];
  for (const host of ['claude', 'codex']) hostFailures.push(await runAgent({ ...fixture(t, host), executable: missing, commandPrefix: [], directProcess: false }).then(() => null, error => error));
  let contained;
  const operation = await runContained(missing, [], { cwd: options.cwd, env: process.env, timeoutMs: 15000, onFinished: exit => { contained = exit; } }).then(() => null, error => error);

  // Assert
  assert.equal(errors.length, 1);
  assert.match(errors[0], expected);
  assert.equal(child.jobEmpty, true);
  assert.deepEqual(child.diagnostics.map(item => item.kind), ['start-failed']);
  for (const failure of hostFailures) {
    assert.equal(failure?.code, 'host-start-failed');
    assert.match(failure.message, expected);
    assert.equal(failure.descendantsReclaimed, true);
  }
  assert.match(operation?.message, expected);
  assert.match(contained.error, expected);
  assert.equal(contained.descendantsReclaimed, true);
});

test('a host whose job runner cannot start reports unproven cleanup with its cause on both hosts', { skip: process.platform !== 'win32' }, async t => {
  // Arrange
  const hosts = ['claude', 'codex'].map(host => {
    const options = fixture(t, host);

    return { ...options, cwd: path.join(options.cwd, 'missing-directory'), commandPrefix: [], directProcess: false };
  });

  // Act
  const failures = [];
  for (const options of hosts) failures.push(await runAgent(options).then(() => null, error => error));

  // Assert
  for (const failure of failures) {
    assert.equal(failure?.code, 'termination-unverified');
    assert.match(failure.message, /did not provide termination evidence; the host failed: \S/);
  }
});

test('Windows job start failure frames are validated before they become errors', () => {
  // Arrange
  const executablePath = 'C:\\tools\\host.exe';
  const basic = { detailCode: 'spawn', kind: 'start-failed', stage: 'create-process' };
  const detailed = { ...basic, win32Error: 193, win32Message: '%1 is not a valid Win32 application.' };
  const invalid = [
    { detailCode: 'spawn', kind: 'start-failed' },
    { ...basic, stage: 'unknown' },
    { ...basic, extra: true },
    { ...basic, win32Error: 2 },
    { ...basic, win32Message: 'orphan' },
    { ...detailed, win32Error: 0 },
    { ...detailed, win32Error: -1 },
    { ...detailed, win32Error: 1.5 },
    { ...detailed, win32Message: null },
    { ...detailed, win32Message: 'x'.repeat(1025) },
    { detailCode: 'termination', kind: 'start-failed', pid: 0 },
    { detailCode: 'termination', kind: 'start-failed', pid: 42, stage: 'resume' },
  ];

  // Act
  const staged = ['command', 'setup', 'create-process', 'job-assignment', 'resume'].map(stage => startFailure(executablePath, { ...basic, stage }).message);
  const windows = startFailure(executablePath, detailed).message;
  const termination = startFailure(executablePath, { detailCode: 'termination', kind: 'start-failed', pid: 42 }).message;
  const share = startFailure('C:\\odd$&dir\\host.exe', detailed).message;

  // Assert
  for (const message of staged) assert.ok(message.startsWith(`Windows job could not start the host ${executablePath} (`));
  assert.equal(windows, `Windows job could not start the host ${executablePath} (create-process): Windows error 193: ${executablePath} is not a valid Win32 application.`);
  assert.ok(share.endsWith('Windows error 193: C:\\odd$&dir\\host.exe is not a valid Win32 application.'));
  assert.ok(termination.includes(executablePath));
  for (const frame of invalid) assert.throws(() => startFailure(executablePath, frame), /Invalid Windows job start failure/);
});

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

// A stop that comes before the command has started its descendant proves nothing, and the stop clock starts before the job runner, whose
// startup takes seconds on a loaded machine, so the bound escalates until the descendant existed when the command was stopped.
// stop(timeoutMs) runs one stopped attempt and returns the file where the command records its descendant's pid.
async function stoppedAfterDescendantStarted(stop) {
  for (const timeoutMs of [2500, 10000, 40000]) {
    const pidFile = await stop(timeoutMs);
    const recorded = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : '';
    if (/^\d+$/.test(recorded)) return Number(recorded);
  }
  assert.fail('The command never started its descendant within the escalated timeouts');
}

test('Windows job containment carries the actual host protocol and proves descendants have ended', { skip: process.platform !== 'win32' }, async t => {
  // Bounds are generous because the timeout clock starts before the job runner, whose startup takes seconds on a loaded machine.
  const normal = await runAgent({ ...fixture(t, 'claude'), directProcess: false, timeoutMs: 60000 });
  assert.equal(normal.status, 'complete', JSON.stringify({ exit: normal.exit, output: normal.output }));
  assert.equal(normal.exit.descendantsReclaimed, true);
  const codex = await runAgent({ ...fixture(t, 'codex'), directProcess: false, timeoutMs: 60000 });
  assert.equal(codex.status, 'complete');
  assert.equal(codex.exit.descendantsReclaimed, true);
  const pid = await stoppedAfterDescendantStarted(async timeoutMs => {
    const options = { ...fixture(t, 'claude', 'descendant'), directProcess: false, timeoutMs };
    const stopped = await runAgent(options);
    assert.equal(stopped.status, 'failed');
    assert.equal(stopped.exit.descendantsReclaimed, true);

    return path.join(options.cwd, 'descendant.pid');
  });
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

const lingeringFixture = path.join(__dirname, 'fixtures/lingering-descendant.cjs');

for (const [mode, exitCode] of [['holds-output', 0], ['ignores-output', 7]]) {
  test(`a contained command whose descendant outlives it completes with its exit code and names the reclaimed descendant: ${mode}`, { skip: process.platform !== 'win32' }, async t => {
    // Arrange
    const options = fixture(t, 'claude');

    // Act
    // Without the reclaim the descendant would hold the job until this bound, so completing at all shows it was reclaimed.
    const exit = await runContained(process.execPath, [lingeringFixture, mode, String(exitCode)], { cwd: options.cwd, env: process.env, timeoutMs: 60000, reclaimAfterMs: 500 });

    // Assert
    const leaf = Number(fs.readFileSync(path.join(options.cwd, 'lingering.pid'), 'utf8').trim());
    assert.equal(exit.code, exitCode);
    assert.equal(exit.descendantsReclaimed, true);
    assert.equal(exit.error, null);
    assert.match(exit.stdout, /command finished/);
    const named = exit.lingering.processes.find(item => item.pid === leaf);
    assert.ok(named, JSON.stringify(exit.lingering));
    assert.equal(path.basename(named.image).toLowerCase(), path.basename(process.execPath).toLowerCase());
    assert.ok(exit.lingering.total >= exit.lingering.processes.length);
    assert.throws(() => process.kill(leaf, 0), { code: 'ESRCH' });
  });
}

test('a contained command without a reclaim grace still waits for its job to empty', { skip: process.platform !== 'win32' }, async t => {
  // Arrange
  const attempts = [];

  // Act
  const leaf = await stoppedAfterDescendantStarted(async timeoutMs => {
    const options = fixture(t, 'claude');
    let finished;
    const failure = await runContained(process.execPath, [lingeringFixture, 'ignores-output', '0'], { cwd: options.cwd, env: process.env, timeoutMs, onFinished: exit => { finished = exit; } }).then(() => null, error => error);
    attempts.push({ failure, finished });

    return path.join(options.cwd, 'lingering.pid');
  });

  // Assert
  for (const { failure, finished } of attempts) {
    assert.equal(failure?.code, 'operation-timeout');
    assert.equal(failure.descendantsReclaimed, true);
    assert.equal(finished.lingering, null);
  }
  assert.throws(() => process.kill(leaf, 0), { code: 'ESRCH' });
});

test('Windows job lingering reports and reclaim graces are validated', () => {
  // Arrange
  const valid = { kind: 'lingering', processes: [{ image: 'C:\\tools\\server.exe', pid: 42 }, { image: null, pid: 43 }], total: 3 };
  const invalid = [
    { kind: 'lingering', processes: [] },
    { ...valid, extra: true },
    { ...valid, total: 1 },
    { ...valid, total: -1 },
    { ...valid, total: 2.5 },
    { ...valid, processes: {} },
    { ...valid, processes: [null] },
    { ...valid, processes: [{ image: 'x.exe' }] },
    { ...valid, processes: [{ image: 'x.exe', pid: 0 }] },
    { ...valid, processes: [{ image: 7, pid: 42 }] },
    { ...valid, processes: [{ image: 'x.exe', pid: 42, name: 'x' }] },
    { ...valid, processes: Array.from({ length: 65 }, (_, index) => ({ image: null, pid: index + 1 })), total: 65 },
  ];

  // Act
  const accepted = lingeringProcesses(valid);
  const unknownTotal = lingeringProcesses({ ...valid, total: null });

  // Assert
  assert.deepEqual(accepted, { total: 3, processes: [{ pid: 42, image: 'C:\\tools\\server.exe' }, { pid: 43, image: null }] });
  assert.equal(unknownTotal.total, null);
  for (const frame of invalid) assert.throws(() => lingeringProcesses(frame), /Invalid Windows job lingering report/);
  for (const reclaimAfterMs of [-1, 1.5, 3600001, '500']) assert.throws(() => spawnWindowsJob(process.execPath, [], { cwd: __dirname, reclaimAfterMs }), /reclaim grace/);
});
