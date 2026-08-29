'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')

const driver = require('../init-backlog-session-driver')
const workerModule = require('../init-backlog-controller-worker')
const proxyClient = require('../fixtures/init-backlog-eval/controller-proxy.js')
const { canonicalJson, sha256 } = require('./helpers')
const { ELECTION_MARKER_PATH } = require('./election-oracles')

const REQUEST_GATE_BASENAME = '.nightshift-init-backlog.request-gate'
const HEX64 = /^[a-f0-9]{64}$/

const FIXTURE_HOST_CONTEXT = {
  claudeContextSource: 'host-observed',
  claudeRootExclusionStatus: 'included',
  codexContextSource: null,
  codexInvocationDirectory: null,
  codexProjectDocMaxBytes: null,
  codexProjectInstructions: [],
}

function tempRoot(prefix = 'nightshift-session-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

function canonicalLine(value) {
  return Buffer.from(canonicalJson(value) + '\n', 'utf8')
}

function inspectRequestBytes(root, overrides = {}) {
  return Buffer.from(canonicalJson({ host: 'claude-code', hostContext: FIXTURE_HOST_CONTEXT, operation: 'inspect', protocolVersion: 1, root, ...overrides }), 'utf8')
}

function fakeClock() {
  const timers = []

  return {
    clearTimeout(handle) {
      const index = timers.indexOf(handle)
      if (index !== -1) {
        timers.splice(index, 1)
      }
    },
    fire(index = 0) {
      const handle = timers.splice(index, 1)[0]
      handle.fn()
    },
    setTimeout(fn, milliseconds) {
      const handle = { fn, milliseconds }
      timers.push(handle)

      return handle
    },
    timers,
  }
}

function fakeConnection() {
  return {
    end() {
      this.ended = true
    },
    ended: false,
    write(bytes) {
      this.written.push(Buffer.from(bytes))

      return this.writeReturn
    },
    writeReturn: true,
    written: [],
  }
}

function buildServerHarness(overrides = {}) {
  const scenarioRoot = overrides.scenarioRoot ?? '/eval/run/repo'
  const gate = driver.createAuthorizationGate({ host: 'claude-code', hostContext: FIXTURE_HOST_CONTEXT, scenarioRoot })
  const clock = fakeClock()
  const workerFrames = []
  const traceLines = []
  const failures = []
  const termination = { host: 0, worker: 0 }
  const server = driver.createProxyServer({
    clock,
    gate,
    onFailure(failure) {
      failures.push(failure)
    },
    termination: {
      startHost() {
        termination.host += 1
      },
      startWorker() {
        termination.worker += 1
      },
    },
    token: overrides.token ?? 'a'.repeat(64),
    trace: overrides.trace ?? {
      append(line) {
        traceLines.push(line)
      },
    },
    worker: overrides.worker ?? {
      send(bytes) {
        workerFrames.push(Buffer.from(bytes))
      },
    },
  })

  return { clock, failures, gate, scenarioRoot, server, termination, traceLines, workerFrames }
}

function admitInspectCall(harness, options = {}) {
  const request = inspectRequestBytes(harness.scenarioRoot)
  harness.gate.authorizeInspect()
  const connection = fakeConnection()
  if (options.writeReturn !== undefined) {
    connection.writeReturn = options.writeReturn
  }
  harness.server.handleConnection(connection)
  harness.server.receiveData(connection, canonicalLine({ requestBase64: request.toString('base64'), token: 'a'.repeat(64) }))

  return { connection, request }
}

function workerReplyLine(overrides = {}) {
  return canonicalLine({
    exitCode: 0,
    ordinal: 1,
    stderrBase64: '',
    stdoutBase64: Buffer.from('{"ok":true}', 'utf8').toString('base64'),
    ...overrides,
  })
}

function runSessionCases(repositoryRoot) {
  const controllerEntryPath = join(repositoryRoot, 'skills', 'init-backlog', 'init-backlog.js')

  test('the session driver package is closed to its eleven private modules and pins the process adapter events', () => {
    const privateModules = readdirSync(join(repositoryRoot, 'tests', 'init-backlog-session-driver')).sort()
    assert.deepEqual(privateModules, ['adjudication.js', 'aggregation.js', 'cleanup.js', 'dialogue.js', 'evidence.js', 'host-events.js', 'primitives.js', 'process.js', 'proxy.js', 'state.js', 'transcript.js'])
    assert.deepEqual(driver.PROCESS_ADAPTER_EVENTS, ['start', 'input', 'close-input', 'terminate', 'closure-proof'])
    assert.deepEqual(Object.keys(driver).sort(), [
      'BYTE_BOUNDS',
      'DEADLINES',
      'INFRASTRUCTURE_DETAIL_CODES',
      'INFRASTRUCTURE_PHASES',
      'MAX_PROXY_CLIENT_FRAME_BYTES',
      'PRIMARY_INITIAL_CODES',
      'PROCESS_ADAPTER_EVENTS',
      'RUNNER_CLOSE_MILLISECONDS',
      'WINDOWS_RUNNER_INPUT_FRAME_KINDS',
      'WINDOWS_RUNNER_OUTPUT_FRAME_KINDS',
      'attestTerminalRepository',
      'buildClosedProjection',
      'buildHarnessGitEnvironment',
      'buildLeafPath',
      'buildResultRecord',
      'buildSummary',
      'buildWorkerProjection',
      'collectControllerRuntimeClosure',
      'createAuthorizationGate',
      'createByteBudget',
      'createDirectPosixFallbackAdapter',
      'createFinalizationBarrier',
      'createGitIsolationInputs',
      'createHostTempChild',
      'createInfrastructureAccount',
      'createLaunchState',
      'createLineDecoder',
      'createProductionProcessAdapter',
      'createProxyServer',
      'createProxyTrace',
      'createSessionLatch',
      'createTranscript',
      'createTurnSequencer',
      'createWindowsJobRunnerAdapter',
      'createWriteState',
      'evaluateLinuxContainment',
      'finalizeRunRoot',
      'infrastructureFailure',
      'materializeScenario',
      'parseNulTerminatedTrackedPaths',
      'parseTrackedSetOutput',
      'publishEvidenceLeaf',
      'scenarioRootDigest',
      'verifyScenarioFileSet',
      'windowsJobRunnerPath',
    ])
  })

  test('every byte bound and deadline literal is pinned', () => {
    assert.deepEqual(driver.BYTE_BOUNDS, {
      MAX_EVIDENCE_LEAF_BYTES: 201326592,
      MAX_EVIDENCE_ROOT_BYTES: 1073741824,
      MAX_HOST_LINE_BYTES: 4194304,
      MAX_PROCESS_STDERR_BYTES: 4194304,
      MAX_PROCESS_STDOUT_BYTES: 33554432,
      MAX_PROXY_TRACE_BYTES: 67108864,
      MAX_RUNNER_FRAME_BYTES: 5592576,
      MAX_TRANSCRIPT_BYTES: 67108864,
    })
    assert.deepEqual(driver.DEADLINES, {
      NATURAL_CLOSURE_MILLISECONDS: 5000,
      PRE_SESSION_MILLISECONDS: 60000,
      TURN_NANOSECONDS: 900000000000n,
      WORKER_CALL_MILLISECONDS: 300000,
      WORKER_STARTUP_MILLISECONDS: 60000,
    })
  })

  test('every capacity literal admits at its bound and overflows one byte above with bounded diagnostics', () => {
    for (const [limitName, limit] of Object.entries(driver.BYTE_BOUNDS)) {
      const budget = driver.createByteBudget({ limit, limitName })
      assert.deepEqual(budget.admit(limit - 1), { ok: true })
      assert.deepEqual(budget.admit(1), { ok: true })
      assert.equal(budget.count(), limit)
      const overflow = budget.admit(1)
      assert.deepEqual(overflow, { overflow: { limitName, observedBytes: limit + 1 } })
      assert.deepEqual(Object.keys(overflow.overflow).sort(), ['limitName', 'observedBytes'], 'overflow diagnostics carry only the limit name and bounded counter')
      assert.equal(budget.count(), limit, 'a rejected admission must not advance the counter')
    }
  })

  test('the line decoder rejects an unterminated line as soon as buffered bytes exceed the limit', () => {
    const lines = []
    const overflows = []
    const decoder = driver.createLineDecoder({
      limit: 8,
      limitName: 'MAX_HOST_LINE_BYTES',
      onLine(line) {
        lines.push(Buffer.from(line))
      },
      onOverflow(overflow) {
        overflows.push(overflow)
      },
    })
    decoder.push(Buffer.from('12345678\n', 'utf8'))
    assert.equal(lines.length, 1)
    assert.equal(lines[0].toString('utf8'), '12345678')
    assert.deepEqual(overflows, [])
    decoder.push(Buffer.from('12345678', 'utf8'))
    assert.deepEqual(overflows, [], 'an unterminated line exactly at the limit is still admissible')
    decoder.push(Buffer.from('9', 'utf8'))
    assert.deepEqual(overflows, [{ limitName: 'MAX_HOST_LINE_BYTES', observedBytes: 9 }])
    decoder.push(Buffer.from('ignored\n', 'utf8'))
    assert.equal(lines.length, 1, 'no line is delivered after the first overflow')
  })

  test('a rapid valid-event flood is delivered completely and in order', () => {
    const lines = []
    const decoder = driver.createLineDecoder({
      limit: driver.BYTE_BOUNDS.MAX_HOST_LINE_BYTES,
      limitName: 'MAX_HOST_LINE_BYTES',
      onLine(line) {
        lines.push(line.toString('utf8'))
      },
      onOverflow() {
        throw new Error('flood must not overflow')
      },
    })
    const flood = []
    for (let index = 0; index < 5000; index += 1) {
      flood.push(`event-${index}`)
    }
    decoder.push(Buffer.from(flood.join('\n') + '\n', 'utf8'))
    assert.deepEqual(lines, flood)
  })

  test('a terminated line one byte above the host line limit overflows at the real literal', () => {
    const overflows = []
    const decoder = driver.createLineDecoder({
      limit: driver.BYTE_BOUNDS.MAX_HOST_LINE_BYTES,
      limitName: 'MAX_HOST_LINE_BYTES',
      onLine() {},
      onOverflow(overflow) {
        overflows.push(overflow)
      },
    })
    decoder.push(Buffer.alloc(driver.BYTE_BOUNDS.MAX_HOST_LINE_BYTES, 0x61))
    assert.deepEqual(overflows, [])
    decoder.push(Buffer.from('a', 'utf8'))
    assert.deepEqual(overflows, [{ limitName: 'MAX_HOST_LINE_BYTES', observedBytes: driver.BYTE_BOUNDS.MAX_HOST_LINE_BYTES + 1 }])
  })

  test('the session latch admits exactly one failure claimant from open with the exact record shape', () => {
    const latch = driver.createSessionLatch('claude-code')
    assert.equal(latch.state(), 'open')
    const first = latch.claimFailure({ code: 'session-input', phase: 'initial-turn' })
    assert.equal(first.claimed, true)
    assert.deepEqual(Object.keys(first.record), ['ok', 'host', 'code', 'phase'])
    assert.deepEqual(first.record, { code: 'session-input', host: 'claude-code', ok: false, phase: 'initial-turn' })
    assert.equal(latch.state(), 'terminating')
    const second = latch.claimFailure({ code: 'session-timeout', phase: 'interaction-turn' })
    assert.equal(second.claimed, false, 'a later claimant performs accounting only')
    assert.deepEqual(latch.primaryResult(), first.record)
    assert.equal(latch.completeWithPlatformProof(), false, 'completion cannot replace a claimed failure')
  })

  test('platform proof completes the latch first and a queued failure claimant cannot replace success', () => {
    const latch = driver.createSessionLatch('codex')
    assert.equal(latch.completeWithPlatformProof(), true)
    assert.equal(latch.state(), 'completed')
    const raced = latch.claimFailure({ code: 'session-timeout', phase: 'interaction-turn' })
    assert.equal(raced.claimed, false, 'the timeout race after completion is accounting only')
    assert.equal(latch.primaryResult(), null)
  })

  test('the write state machine admits a write only after callback success and drain resolution', () => {
    const writeState = driver.createWriteState()
    assert.deepEqual(writeState.value(), { callbackSucceeded: false, drained: false, needsDrain: null })
    assert.equal(writeState.admitted(), false)
    writeState.recordSyncReturn(false)
    assert.equal(writeState.value().needsDrain, true)
    writeState.recordCallbackSuccess()
    assert.equal(writeState.admitted(), false, 'a pending drain blocks admission')
    writeState.recordDrain()
    assert.equal(writeState.value().drained, true)
    assert.equal(writeState.admitted(), true)
    writeState.reset()
    assert.deepEqual(writeState.value(), { callbackSucceeded: false, drained: false, needsDrain: null })
    writeState.recordSyncReturn(true)
    assert.equal(writeState.admitted(), false, 'callback success is always required')
    writeState.recordCallbackSuccess()
    assert.equal(writeState.admitted(), true, 'a true synchronous return admits without drain')
  })

  test('the turn sequencer arms the exact turn deadline and retains a structured result until admission', () => {
    let sample = 100n
    const writes = []
    const latch = driver.createSessionLatch('claude-code')
    const sequencer = driver.createTurnSequencer({
      latch,
      now: () => sample,
      writeTurn(payload) {
        writes.push(payload)
      },
    })
    const slot = sequencer.start('initial-turn', 'first-input')
    assert.equal(slot.phase, 'initial-turn')
    assert.equal(slot.deadlineAt, 100n + 900000000000n)
    assert.deepEqual(writes, ['first-input'])
    sequencer.recordSyncReturn(false)
    sequencer.recordCallbackSuccess()
    const retained = sequencer.receiveStructuredResult({ nextInput: 'second-input' })
    assert.deepEqual(retained, { retained: true, written: false })
    assert.deepEqual(writes, ['first-input'], 'a result before admission issues no write')
    sample = 200n
    sequencer.recordDrain()
    assert.deepEqual(writes, ['first-input', 'second-input'], 'admission advances the retained turn')
    assert.equal(sequencer.slot().phase, 'interaction-turn')
    assert.equal(sequencer.slot().deadlineAt, 200n + 900000000000n)
    assert.equal(latch.state(), 'open')
  })

  test('an admitted later-turn boundary at or past the deadline claims session-timeout and issues no write', () => {
    let sample = 0n
    const writes = []
    const latch = driver.createSessionLatch('codex')
    const sequencer = driver.createTurnSequencer({
      latch,
      now: () => sample,
      writeTurn(payload) {
        writes.push(payload)
      },
    })
    sequencer.start('interaction-turn', 'input-a')
    sequencer.recordSyncReturn(true)
    sequencer.recordCallbackSuccess()
    sample = 900000000000n
    const outcome = sequencer.receiveStructuredResult({ nextInput: 'input-b' })
    assert.equal(outcome.timedOut, true)
    assert.deepEqual(writes, ['input-a'])
    assert.deepEqual(latch.primaryResult(), { code: 'session-timeout', host: 'codex', ok: false, phase: 'interaction-turn' })
    const after = sequencer.receiveStructuredResult({ nextInput: 'input-c' })
    assert.equal(after.accounting, true, 'a closed latch turns later results into accounting only')
    assert.deepEqual(writes, ['input-a'])
  })

  test('a session input failure claims the latch with the exact session-input record', () => {
    const latch = driver.createSessionLatch('claude-code')
    const sequencer = driver.createTurnSequencer({ latch, now: () => 5n, writeTurn() {} })
    sequencer.start('initial-turn', 'payload')
    const claim = sequencer.recordInputFailure()
    assert.equal(claim.claimed, true)
    assert.deepEqual(claim.record, { code: 'session-input', host: 'claude-code', ok: false, phase: 'initial-turn' })
    assert.equal(sequencer.recordInputFailure().claimed, false)
  })

  test('the launch state classifies spawn-boundary errors by state', () => {
    const launch = driver.createLaunchState()
    assert.equal(launch.state(), 'pre-spawn')
    assert.deepEqual(launch.classifyError(), { detailCode: 'spawn', initialCode: null })
    assert.equal(launch.recordSpawn(0).ok, false)
    assert.equal(launch.recordSpawn(2.5).ok, false)
    assert.equal(launch.state(), 'pre-spawn')
    assert.equal(launch.recordSpawn(4242).ok, true)
    assert.equal(launch.state(), 'spawned')
    assert.deepEqual(launch.classifyError(), { detailCode: 'child-process' })
    assert.deepEqual(launch.classifyError(), { accounting: true }, 'later errors are accounting only')
  })

  test('the infrastructure carrier uses the exact field order and closed code sets', () => {
    assert.deepEqual(driver.INFRASTRUCTURE_PHASES, ['import-probe', 'version', 'authentication', 'plugin-setup', 'initial-turn', 'interaction-turn', 'post-session'])
    assert.deepEqual(driver.PRIMARY_INITIAL_CODES, ['preflight-timeout', 'invalid-host-version', 'authentication-unavailable', 'session-input', 'session-timeout'])
    assert.deepEqual(driver.INFRASTRUCTURE_DETAIL_CODES, ['spawn', 'child-process', 'containment-unavailable', 'proxy', 'proxy-authorization', 'output-capacity', 'termination', 'stream-closure', 'evidence-copy', 'evidence-verification', 'repository-attestation', 'cleanup'])
    const carrier = driver.infrastructureFailure({ detailCode: 'proxy', host: 'claude-code', initialCode: 'session-timeout', phase: 'interaction-turn', retainedRunRoot: null })
    assert.deepEqual(Object.keys(carrier), ['ok', 'host', 'code', 'phase', 'initialCode', 'detailCode', 'retainedRunRoot'])
    assert.deepEqual(carrier, { code: 'harness-infrastructure', detailCode: 'proxy', host: 'claude-code', initialCode: 'session-timeout', ok: false, phase: 'interaction-turn', retainedRunRoot: null })
    assert.throws(() => driver.infrastructureFailure({ detailCode: 'not-a-code', host: 'codex', initialCode: null, phase: 'version', retainedRunRoot: null }), /detailCode/)
    assert.throws(() => driver.infrastructureFailure({ detailCode: 'proxy', host: 'codex', initialCode: 'other', phase: 'version', retainedRunRoot: null }), /initialCode/)
    for (const detailCode of ['repository-attestation', 'evidence-copy', 'evidence-verification', 'cleanup']) {
      assert.throws(() => driver.infrastructureFailure({ detailCode, host: 'codex', initialCode: null, phase: 'interaction-turn', retainedRunRoot: null }), /post-session/)
      assert.throws(() => driver.infrastructureFailure({ detailCode, host: 'codex', initialCode: 'session-input', phase: 'post-session', retainedRunRoot: null }), /post-session/)
      const fixed = driver.infrastructureFailure({ detailCode, host: 'codex', initialCode: null, phase: 'post-session', retainedRunRoot: '/kept/root' })
      assert.equal(fixed.phase, 'post-session')
      assert.equal(fixed.initialCode, null)
      assert.equal(fixed.retainedRunRoot, '/kept/root')
    }
  })

  test('the infrastructure account fixes identity on the first failure and keeps later ones as accounting', () => {
    const account = driver.createInfrastructureAccount({ host: 'claude-code' })
    assert.equal(account.hasFailure(), false)
    const first = account.recordFailure({ detailCode: 'output-capacity', initialCode: 'session-timeout', phase: 'interaction-turn' })
    assert.equal(first.first, true)
    const second = account.recordFailure({ detailCode: 'proxy', initialCode: null, phase: 'post-session' })
    assert.equal(second.first, false)
    assert.equal(account.accounting().length, 1)
    account.finalizeRetainedRunRoot('/run/root')
    const result = account.result()
    assert.deepEqual(result, { code: 'harness-infrastructure', detailCode: 'output-capacity', host: 'claude-code', initialCode: 'session-timeout', ok: false, phase: 'interaction-turn', retainedRunRoot: '/run/root' })
    assert.deepEqual(Object.keys(result), ['ok', 'host', 'code', 'phase', 'initialCode', 'detailCode', 'retainedRunRoot'])
  })

  test('post-session entry fixes the phase for every attestation, evidence, and cleanup failure', () => {
    const account = driver.createInfrastructureAccount({ host: 'codex' })
    account.enterPostSession()
    const first = account.recordFailure({ detailCode: 'repository-attestation' })
    assert.equal(first.first, true)
    account.finalizeRetainedRunRoot('/kept')
    assert.deepEqual(account.result(), { code: 'harness-infrastructure', detailCode: 'repository-attestation', host: 'codex', initialCode: null, ok: false, phase: 'post-session', retainedRunRoot: '/kept' })
    for (const detailCode of ['evidence-copy', 'evidence-verification', 'cleanup']) {
      const late = account.recordFailure({ detailCode })
      assert.equal(late.first, false, `${detailCode} after the first failure is accounting only`)
    }
    assert.equal(account.accounting().length, 3)
  })

  test('the closed projection copies only eligible keys and binds all three temp variables to the run-local child', () => {
    const projection = driver.buildClosedProjection({
      ambientEnvironment: {
        HOME: '/home/user',
        INIT_CWD: '/somewhere',
        LANG: 'C.UTF-8',
        NODE_PATH: '/poison',
        OLDPWD: '/old',
        PATH: '/usr/bin:/opt/tools',
        PWD: '/cwd',
        SECRET_UNLISTED: 'x',
        TEMP: '/ambient/temp',
        TMP: '/ambient/tmp',
        TMPDIR: '/ambient/tmpdir',
      },
      checkoutRoot: '/checkout/nightshift',
      platform: 'linux',
      temporaryPath: '/run/1/host-temp',
    })
    assert.equal(projection.PATH, '/usr/bin:/opt/tools')
    assert.equal(projection.HOME, '/home/user')
    assert.equal(projection.LANG, 'C.UTF-8')
    assert.equal(projection.TEMP, '/run/1/host-temp')
    assert.equal(projection.TMP, '/run/1/host-temp')
    assert.equal(projection.TMPDIR, '/run/1/host-temp')
    for (const key of ['PWD', 'OLDPWD', 'INIT_CWD', 'NODE_PATH', 'SECRET_UNLISTED']) {
      assert.equal(key in projection, false, `${key} must be omitted`)
    }
    assert.equal(Object.keys(projection).some((key) => key.startsWith('NIGHTSHIFT_')), false, 'a pre-session projection carries no proxy key')
  })

  test('an enabled session projection carries exactly the three proxy keys and rejects malformed values', () => {
    const base = {
      ambientEnvironment: { PATH: '/usr/bin' },
      checkoutRoot: '/checkout/nightshift',
      platform: 'linux',
      temporaryPath: '/run/1/host-temp',
    }
    const token = 'f'.repeat(64)
    const projection = driver.buildClosedProjection({ ...base, proxySession: { port: 4321, token } })
    assert.equal(projection.NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS, '127.0.0.1')
    assert.equal(projection.NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT, '4321')
    assert.equal(projection.NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN, token)
    assert.throws(() => driver.buildClosedProjection({ ...base, proxySession: { port: 0, token } }), /port/)
    assert.throws(() => driver.buildClosedProjection({ ...base, proxySession: { port: 65536, token } }), /port/)
    assert.throws(() => driver.buildClosedProjection({ ...base, proxySession: { port: 80.5, token } }), /port/)
    assert.throws(() => driver.buildClosedProjection({ ...base, proxySession: { port: 4321, token: 'F'.repeat(64) } }), /token/)
    assert.throws(() => driver.buildClosedProjection({ ...base, proxySession: { port: 4321, token: 'f'.repeat(63) } }), /token/)
  })

  test('the projection removes checkout PATH entries and rejects checkout-bearing values', () => {
    const projection = driver.buildClosedProjection({
      ambientEnvironment: { PATH: '/usr/bin:/checkout/nightshift/node_modules/.bin:/checkout/nightshift:/opt' },
      checkoutRoot: '/checkout/nightshift',
      platform: 'linux',
      temporaryPath: '/run/1/host-temp',
    })
    assert.equal(projection.PATH, '/usr/bin:/opt')
    assert.throws(() => driver.buildClosedProjection({
      ambientEnvironment: { HOME: '/checkout/nightshift/home' },
      checkoutRoot: '/checkout/nightshift',
      platform: 'linux',
      temporaryPath: '/run/1/host-temp',
    }), /checkout/)
    assert.throws(() => driver.buildClosedProjection({
      ambientEnvironment: { PATH: '/usr/bin' },
      checkoutRoot: '/checkout/nightshift',
      controllerPath: '/driver/controller/init-backlog.js',
      overrides: { HINT: '/driver/controller/init-backlog.js' },
      platform: 'linux',
      temporaryPath: '/run/1/host-temp',
    }), /controller/)
  })

  test('windows key matching is ordinal case-insensitive and rejects duplicate-case aliases', () => {
    const projection = driver.buildClosedProjection({
      ambientEnvironment: { patH: 'C:\\tools', SystemRoot: 'C:\\Windows' },
      checkoutRoot: 'C:\\checkout\\nightshift',
      platform: 'win32',
      temporaryPath: 'C:\\run\\1\\host-temp',
    })
    assert.equal(projection.PATH, 'C:\\tools')
    assert.equal(projection.SystemRoot, 'C:\\Windows')
    assert.throws(() => driver.buildClosedProjection({
      ambientEnvironment: { PATH: 'C:\\one', Path: 'C:\\two' },
      checkoutRoot: 'C:\\checkout\\nightshift',
      platform: 'win32',
      temporaryPath: 'C:\\run\\1\\host-temp',
    }), /duplicate/)
  })

  test('the worker projection carries exactly the harness Git isolation set and no ambient GIT_ key or credential', () => {
    const projection = driver.buildWorkerProjection({
      ambientEnvironment: {
        ANTHROPIC_API_KEY: 'secret-a',
        CLAUDE_CODE_OAUTH_TOKEN: 'secret-b',
        GIT_CONFIG_GLOBAL: '/ambient/gitconfig',
        GIT_DIR: '/ambient/gitdir',
        OPENAI_API_KEY: 'secret-c',
        PATH: '/usr/bin',
        git_template_dir: '/ambient/template',
      },
      checkoutRoot: '/checkout/nightshift',
      gitIsolation: {
        attributesPath: '/run/1/git-global.attributes',
        configPath: '/run/1/git-global.config',
        templatePath: '/run/1/git-template',
      },
      platform: 'linux',
      temporaryPath: '/run/1/host-temp',
    })
    const gitKeys = Object.keys(projection).filter((key) => key.toUpperCase().startsWith('GIT_')).sort()
    assert.deepEqual(gitKeys, ['GIT_ATTR_NOSYSTEM', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_NOSYSTEM', 'GIT_CONFIG_VALUE_0', 'GIT_OPTIONAL_LOCKS', 'GIT_PAGER', 'GIT_TEMPLATE_DIR', 'GIT_TERMINAL_PROMPT'])
    assert.equal(projection.GIT_CONFIG_NOSYSTEM, '1')
    assert.equal(projection.GIT_CONFIG_GLOBAL, '/run/1/git-global.config')
    assert.equal(projection.GIT_ATTR_NOSYSTEM, '1')
    assert.equal(projection.GIT_CONFIG_COUNT, '1')
    assert.equal(projection.GIT_CONFIG_KEY_0, 'core.attributesFile')
    assert.equal(projection.GIT_CONFIG_VALUE_0, '/run/1/git-global.attributes')
    assert.equal(projection.GIT_TEMPLATE_DIR, '/run/1/git-template')
    assert.equal(projection.GIT_OPTIONAL_LOCKS, '0')
    assert.equal(projection.GIT_TERMINAL_PROMPT, '0')
    assert.equal(projection.GIT_PAGER, '')
    assert.equal('git_template_dir' in projection, false)
    for (const key of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN']) {
      assert.equal(key in projection, false, `${key} must not reach the worker`)
    }
    assert.equal(projection.PATH, '/usr/bin')
    assert.equal(projection.TMPDIR, '/run/1/host-temp')
  })

  test('the harness Git environment scrubs every ambient GIT_ key under platform key identity and is reused unchanged', () => {
    const inputs = {
      attributesPath: '/run/2/git-global.attributes',
      configPath: '/run/2/git-global.config',
      templatePath: '/run/2/git-template',
    }
    const environment = driver.buildHarnessGitEnvironment({
      ambientEnvironment: {
        GIT_CONFIG_COUNT: '3',
        GIT_CONFIG_KEY_0: 'core.autocrlf',
        GIT_CONFIG_SYSTEM: '/ambient/system',
        GIT_CONFIG_VALUE_0: 'true',
        GIT_DIR: '/ambient/gitdir',
        HOME: '/home/user',
        PATH: '/usr/bin',
      },
      platform: 'linux',
      ...inputs,
    })
    assert.equal(environment.PATH, '/usr/bin')
    assert.equal(environment.HOME, '/home/user')
    assert.equal(environment.GIT_CONFIG_COUNT, '1')
    assert.equal(environment.GIT_CONFIG_KEY_0, 'core.attributesFile')
    assert.equal(environment.GIT_CONFIG_VALUE_0, inputs.attributesPath)
    assert.equal(environment.GIT_CONFIG_GLOBAL, inputs.configPath)
    assert.equal(environment.GIT_TEMPLATE_DIR, inputs.templatePath)
    assert.equal('GIT_DIR' in environment, false)
    assert.equal('GIT_CONFIG_SYSTEM' in environment, false)
    assert.equal(Object.isFrozen(environment), true, 'the harness Git environment is constructed once and reused unchanged')
    const windowsEnvironment = driver.buildHarnessGitEnvironment({
      ambientEnvironment: { Git_Dir: 'C:\\ambient', PATH: 'C:\\tools' },
      attributesPath: 'C:\\run\\git-global.attributes',
      configPath: 'C:\\run\\git-global.config',
      platform: 'win32',
      templatePath: 'C:\\run\\git-template',
    })
    assert.equal('Git_Dir' in windowsEnvironment, false, 'windows key identity removes case-variant GIT_ keys')
  })

  test('the Linux containment branch is an immediate containment-unavailable decision point', () => {
    assert.deepEqual(driver.evaluateLinuxContainment(), { detailCode: 'containment-unavailable', ok: false })
  })

  test('the host temp child is created empty, stable-verified, and binds all three temp variables', () => {
    const runRoot = tempRoot()
    try {
      const child = driver.createHostTempChild({ platform: process.platform, runRoot })
      assert.equal(child.path, join(runRoot, 'host-temp'))
      assert.deepEqual(readdirSync(child.path), [])
      const metadata = lstatSync(child.path)
      assert.equal(metadata.isDirectory(), true)
      if (process.platform !== 'win32') {
        assert.equal(metadata.mode & 0o7777, 0o700)
      }
      assert.deepEqual(child.environmentBindings, { TEMP: child.path, TMP: child.path, TMPDIR: child.path })
      assert.throws(() => driver.createHostTempChild({ platform: process.platform, runRoot }), /host temp/i, 'a second creation in the same run root must fail')
    } finally {
      rmSync(runRoot, { force: true, recursive: true })
    }
  })

  test('ambient temp values and prior retained-run residue never reach the next repetition', () => {
    const decoyTemp = tempRoot('nightshift-decoy-')
    const retainedRun = tempRoot('nightshift-retained-')
    const nextRun = tempRoot('nightshift-next-')
    try {
      const retainedChild = driver.createHostTempChild({ platform: process.platform, runRoot: retainedRun })
      writeFileSync(join(retainedChild.path, 'residue.txt'), 'residue\n')
      const decoyBefore = readdirSync(decoyTemp)
      const nextChild = driver.createHostTempChild({ platform: process.platform, runRoot: nextRun })
      const projection = driver.buildClosedProjection({
        ambientEnvironment: { PATH: '/usr/bin', TEMP: decoyTemp, TMP: decoyTemp, TMPDIR: retainedChild.path },
        checkoutRoot: '/checkout/nightshift',
        platform: 'linux',
        temporaryPath: nextChild.path,
      })
      assert.equal(projection.TEMP, nextChild.path)
      assert.equal(projection.TMP, nextChild.path)
      assert.equal(projection.TMPDIR, nextChild.path)
      assert.deepEqual(readdirSync(nextChild.path), [], 'prior retained residue does not reach the next repetition')
      assert.deepEqual(readdirSync(decoyTemp), decoyBefore, 'the ambient temp decoy is untouched')
      assert.deepEqual(readdirSync(join(retainedRun, 'host-temp')), ['residue.txt'], 'the retained run root remains unchanged')
    } finally {
      for (const root of [decoyTemp, retainedRun, nextRun]) {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('the three run-local Git isolation objects are created empty and stable-verified before first use', () => {
    const runRoot = tempRoot()
    try {
      const inputs = driver.createGitIsolationInputs({ runRoot })
      assert.equal(inputs.configPath, join(runRoot, 'git-global.config'))
      assert.equal(inputs.attributesPath, join(runRoot, 'git-global.attributes'))
      assert.equal(inputs.templatePath, join(runRoot, 'git-template'))
      assert.equal(readFileSync(inputs.configPath).length, 0)
      assert.equal(readFileSync(inputs.attributesPath).length, 0)
      assert.deepEqual(readdirSync(inputs.templatePath), [])
      assert.throws(() => driver.createGitIsolationInputs({ runRoot }), /isolation/i, 'the isolation inputs are created exactly once per run')
      const otherRun = tempRoot()
      try {
        writeFileSync(join(otherRun, 'git-global.config'), 'poison\n')
        assert.throws(() => driver.createGitIsolationInputs({ runRoot: otherRun }), /isolation/i, 'a preexisting nonempty object fails stable verification')
      } finally {
        rmSync(otherRun, { force: true, recursive: true })
      }
    } finally {
      rmSync(runRoot, { force: true, recursive: true })
    }
  })

  test('the tracked-set query parser rejects every mutated transport tuple', () => {
    const expected = ['.claude/plans/in-flight.md', 'README.md']
    const good = { exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('.claude/plans/in-flight.md\u0000README.md\u0000', 'utf8') }
    assert.deepEqual(driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: expected }), { trackedPaths: expected })
    assert.deepEqual(driver.parseTrackedSetOutput({ exitCode: 0, expectedTrackedPaths: [], stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) }), { trackedPaths: [] })
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, exitCode: 1, expectedTrackedPaths: expected }), /exit/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: expected, stderr: Buffer.from('warning\n') }), /stderr/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: expected, stdout: Buffer.from('.claude/plans/in-flight.md\u0000README.md', 'utf8') }), /NUL/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: expected, stdout: Buffer.concat([Buffer.from([0xff, 0xfe]), good.stdout]) }), /UTF-8/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: expected, stdout: Buffer.from('\u0000README.md\u0000', 'utf8') }), /empty/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: ['../escape', 'README.md'], stdout: Buffer.from('../escape\u0000README.md\u0000', 'utf8') }), /confined/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: expected, stdout: Buffer.from('README.md\u0000.claude/plans/in-flight.md\u0000', 'utf8') }), /order/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: expected, stdout: Buffer.from('README.md\u0000README.md\u0000', 'utf8') }), /order/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: ['README.md'], stdout: good.stdout }), /equal/)
    assert.throws(() => driver.parseTrackedSetOutput({ ...good, expectedTrackedPaths: [...expected, 'extra.md'] }), /equal/)
  })

  test('scenario materialization verifies the exact file set and digest and re-verification catches drift', () => {
    const runRoot = tempRoot()
    try {
      const repository = {
        entries: [
          { contentBase64: null, kind: 'directory', mode: 493, path: '.claude' },
          { contentBase64: Buffer.from('# Quick wins\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: '.claude/QUICK_WINS.md' },
        ],
        git: { kind: 'non-git', trackedPaths: [] },
      }
      const scenarioRoot = join(runRoot, 'repo')
      const outcome = driver.materializeScenario({ platform: process.platform, repository, scenarioRoot })
      assert.equal(outcome.scenarioRoot, scenarioRoot)
      assert.equal(outcome.scenarioRootDigest, driver.scenarioRootDigest(repository, process.platform))
      const expectedDigest = sha256(Buffer.from(canonicalJson(process.platform === 'win32' ? { entries: repository.entries.map((entry) => ({ ...entry, mode: null })), git: repository.git } : repository), 'utf8'))
      assert.equal(outcome.scenarioRootDigest, expectedDigest)
      driver.verifyScenarioFileSet({ platform: process.platform, repository, scenarioRoot })
      writeFileSync(join(scenarioRoot, '.claude', 'extra.md'), 'drift\n')
      assert.throws(() => driver.verifyScenarioFileSet({ platform: process.platform, repository, scenarioRoot }), /file set/i, 'an added entry fails pre-spawn revalidation')
      rmSync(join(scenarioRoot, '.claude', 'extra.md'))
      writeFileSync(join(scenarioRoot, '.claude', 'QUICK_WINS.md'), 'changed\n')
      assert.throws(() => driver.verifyScenarioFileSet({ platform: process.platform, repository, scenarioRoot }), /byte/i, 'a changed entry fails pre-spawn revalidation')
    } finally {
      rmSync(runRoot, { force: true, recursive: true })
    }
  })

  test('a Git scenario runs the exact harness argv sequence through the injected runner', () => {
    const runRoot = tempRoot()
    try {
      const repository = {
        entries: [{ contentBase64: Buffer.from('tracked\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'tracked.md' }],
        git: { kind: 'git', trackedPaths: ['tracked.md'] },
      }
      const calls = []
      const runGit = (argv) => {
        calls.push(argv)
        if (argv[0] === 'ls-files') {
          return { exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.from('tracked.md\u0000', 'utf8') }
        }

        return { exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) }
      }
      const outcome = driver.materializeScenario({ platform: process.platform, repository, runGit, scenarioRoot: join(runRoot, 'repo') })
      assert.deepEqual(calls, [
        ['init', '--quiet', '--initial-branch=main'],
        ['add', '--', 'tracked.md'],
        ['ls-files', '-z'],
      ])
      assert.deepEqual(outcome.trackedPaths, ['tracked.md'])
      const emptyCalls = []
      const emptyRepository = { entries: [], git: { kind: 'git', trackedPaths: [] } }
      driver.materializeScenario({
        platform: process.platform,
        repository: emptyRepository,
        runGit: (argv) => {
          emptyCalls.push(argv)

          return { exitCode: 0, stderr: Buffer.alloc(0), stdout: Buffer.alloc(0) }
        },
        scenarioRoot: join(runRoot, 'repo-empty'),
      })
      assert.deepEqual(emptyCalls, [
        ['init', '--quiet', '--initial-branch=main'],
        ['ls-files', '-z'],
      ], 'an empty tracked array runs no add command')
    } finally {
      rmSync(runRoot, { force: true, recursive: true })
    }
  })

  test('the controller runtime closure inventory is ordinal, digest-stable, and byte-sensitive', () => {
    const closure = driver.collectControllerRuntimeClosure({ entryPath: controllerEntryPath })
    assert.match(closure.controllerRuntimeSha256, HEX64)
    assert.equal(closure.files[0].path, 'init-backlog.js')
    assert.ok(closure.files.length > 5)
    const paths = closure.files.map((file) => file.path)
    assert.deepEqual(paths, [...paths].sort(), 'the inventory is ordinal path sorted')
    assert.ok(paths.slice(1).every((path) => path.startsWith('lib/')))
    const again = driver.collectControllerRuntimeClosure({ entryPath: controllerEntryPath })
    assert.equal(again.controllerRuntimeSha256, closure.controllerRuntimeSha256, 'stable revalidation returns the identical digest')
    const copyRoot = tempRoot()
    try {
      const copiedEntry = join(copyRoot, 'init-backlog.js')
      cpSync(controllerEntryPath, copiedEntry)
      cpSync(join(dirname(controllerEntryPath), 'lib'), join(copyRoot, 'lib'), { recursive: true })
      const copied = driver.collectControllerRuntimeClosure({ entryPath: copiedEntry })
      assert.equal(copied.controllerRuntimeSha256, closure.controllerRuntimeSha256)
      writeFileSync(join(copyRoot, 'lib', 'errors.js'), readFileSync(join(copyRoot, 'lib', 'errors.js')) + '\n')
      const mutated = driver.collectControllerRuntimeClosure({ entryPath: copiedEntry })
      assert.notEqual(mutated.controllerRuntimeSha256, closure.controllerRuntimeSha256, 'a closure-member byte change changes the digest')
    } finally {
      rmSync(copyRoot, { force: true, recursive: true })
    }
  })

  test('transcript ordinals are contiguous, shared across kinds, and capacity-bounded before append', () => {
    const transcript = driver.createTranscript()
    const input = Buffer.from('{"scenarioPrompt":"x"}', 'utf8')
    const hostEvent = Buffer.from('{"type":"assistant"}', 'utf8')
    const structured = Buffer.from('{"phase":"finished"}', 'utf8')
    assert.deepEqual(transcript.appendInput(input), { ordinal: 1 })
    assert.deepEqual(transcript.appendHostEvent(hostEvent), { ordinal: 2 })
    assert.deepEqual(transcript.appendStructuredOutput(structured), { ordinal: 3 })
    const lines = transcript.lines().map((line) => JSON.parse(line.toString('utf8')))
    assert.deepEqual(lines, [
      { kind: 'input', ordinal: 1, payloadBase64: input.toString('base64') },
      { kind: 'host-event', ordinal: 2, payloadBase64: hostEvent.toString('base64') },
      { kind: 'structured-output', ordinal: 3, payloadBase64: structured.toString('base64') },
    ])
    for (const line of transcript.lines()) {
      const text = line.toString('utf8')
      assert.equal(text.endsWith('\n'), true)
      assert.equal(text, canonicalJson(JSON.parse(text)) + '\n')
    }
    const probeLine = canonicalLine({ kind: 'input', ordinal: 1, payloadBase64: input.toString('base64') })
    const exact = driver.createTranscript({ limit: probeLine.length })
    assert.deepEqual(exact.appendInput(input), { ordinal: 1 }, 'a transcript exactly at its limit fits')
    const under = driver.createTranscript({ limit: probeLine.length - 1 })
    const overflow = under.appendInput(input)
    assert.deepEqual(overflow, { overflow: { limitName: 'MAX_TRANSCRIPT_BYTES', observedBytes: probeLine.length } })
    assert.equal(under.lines().length, 0, 'a rejected append writes nothing')
  })

  test('the proxy trace flushes each canonical line and enforces its capacity before append', () => {
    const flushed = []
    const trace = driver.createProxyTrace({
      flush(line) {
        flushed.push(Buffer.from(line))
      },
    })
    const record = { exitCode: 0, ordinal: 1, requestBase64: 'aGk=', stderrBase64: '', stdoutBase64: 'aGk=' }
    trace.append(record)
    assert.equal(flushed.length, 1)
    assert.equal(flushed[0].toString('utf8'), canonicalJson(record) + '\n')
    assert.throws(() => trace.append({ ...record, extra: true }), /members/)
    const line = canonicalLine(record)
    const bounded = driver.createProxyTrace({ flush() {}, limit: line.length - 1 })
    assert.throws(() => bounded.append(record), /MAX_PROXY_TRACE_BYTES/)
  })

  test('the authorization gate authorizes nothing initially and admits only the exact staged operation', () => {
    const scenarioRoot = '/eval/run/repo'
    const gate = driver.createAuthorizationGate({ host: 'claude-code', hostContext: FIXTURE_HOST_CONTEXT, scenarioRoot })
    const inspect = inspectRequestBytes(scenarioRoot)
    assert.deepEqual(gate.admit(inspect), { ok: false, reason: 'order' }, 'initially no controller request is authorized')
    gate.authorizeInspect()
    assert.deepEqual(gate.admit(inspectRequestBytes('/other/root')), { ok: false, reason: 'root' })
    assert.deepEqual(gate.admit(inspectRequestBytes(scenarioRoot, { host: 'codex' })), { ok: false, reason: 'field' })
    assert.deepEqual(gate.admit(inspectRequestBytes(scenarioRoot, { hostContext: { ...FIXTURE_HOST_CONTEXT, claudeRootExclusionStatus: 'unexcluded-missing' } })), { ok: false, reason: 'field' })
    assert.deepEqual(gate.admit(inspectRequestBytes(scenarioRoot, { operation: 'apply' })), { ok: false, reason: 'operation' })
    assert.deepEqual(gate.admit(inspectRequestBytes(scenarioRoot, { operation: 'recover-inspect' })), { ok: false, reason: 'operation' })
    assert.deepEqual(gate.admit(Buffer.from('not json', 'utf8')), { ok: false, reason: 'field' })
    assert.deepEqual(gate.admit(inspect), { ok: true, operation: 'inspect' })
    const inspectionBytes = Buffer.from('{"ok":true,"operation":"inspect"}', 'utf8')
    gate.recordInspectSuccess(inspectionBytes)
    assert.deepEqual(gate.storedInspectionBytes(), inspectionBytes)
    assert.deepEqual(gate.admit(inspect), { ok: false, reason: 'duplicate-call' }, 'a successful inspect closes inspect admission')
    const applyBytes = Buffer.from(canonicalJson({ host: 'claude-code', hostContext: FIXTURE_HOST_CONTEXT, manifest: {}, operation: 'apply', protocolVersion: 1, root: scenarioRoot }), 'utf8')
    assert.deepEqual(gate.admit(applyBytes), { ok: false, reason: 'approval-state' }, 'apply before approval is rejected')
    gate.installApplyAuthorization(applyBytes)
    assert.deepEqual(gate.admit(Buffer.concat([applyBytes, Buffer.from(' ')])), { ok: false, reason: 'request-byte' })
    assert.deepEqual(gate.admit(applyBytes), { ok: true, operation: 'apply' })
  })

  test('a non-approved branch permanently authorizes no apply', () => {
    const scenarioRoot = '/eval/run/repo'
    const gate = driver.createAuthorizationGate({ host: 'codex', hostContext: FIXTURE_HOST_CONTEXT, scenarioRoot })
    gate.authorizeInspect()
    gate.admit(inspectRequestBytes(scenarioRoot, { host: 'codex' }))
    gate.recordInspectSuccess(Buffer.from('{}', 'utf8'))
    gate.closeApplyForever()
    assert.throws(() => gate.installApplyAuthorization(Buffer.from('{}', 'utf8')), /approv/i)
    const applyBytes = Buffer.from(canonicalJson({ host: 'codex', hostContext: FIXTURE_HOST_CONTEXT, operation: 'apply', protocolVersion: 1, root: scenarioRoot }), 'utf8')
    assert.deepEqual(gate.admit(applyBytes), { ok: false, reason: 'approval-state' })
  })

  test('the proxy server rejects missing, extra, malformed, and token-mismatched frames before any worker effect', () => {
    const harness = buildServerHarness()
    harness.gate.authorizeInspect()
    const request = inspectRequestBytes(harness.scenarioRoot)
    const rejections = [
      canonicalLine({ requestBase64: request.toString('base64'), token: 'b'.repeat(64) }),
      canonicalLine({ requestBase64: request.toString('base64') }),
      canonicalLine({ extra: 1, requestBase64: request.toString('base64'), token: 'a'.repeat(64) }),
      Buffer.from('not json\n', 'utf8'),
      canonicalLine({ requestBase64: 'not*base64', token: 'a'.repeat(64) }),
    ]
    for (const frame of rejections) {
      const connection = fakeConnection()
      harness.server.handleConnection(connection)
      harness.server.receiveData(connection, frame)
      assert.equal(connection.ended, true)
    }
    assert.equal(harness.workerFrames.length, 0, 'no rejected frame reaches the worker')
    assert.equal(harness.failures.length, rejections.length)
    assert.ok(harness.failures.every((failure) => failure.detailCode === 'proxy-authorization'))
    assert.deepEqual(harness.traceLines, [], 'a rejection cannot mutate trace evidence')
  })

  test('an authorization mismatch is rejected pre-effect as proxy-authorization', () => {
    const harness = buildServerHarness()
    harness.gate.authorizeInspect()
    const connection = fakeConnection()
    harness.server.handleConnection(connection)
    harness.server.receiveData(connection, canonicalLine({ requestBase64: inspectRequestBytes('/wrong/root').toString('base64'), token: 'a'.repeat(64) }))
    assert.deepEqual(harness.failures, [{ detailCode: 'proxy-authorization' }])
    assert.equal(harness.workerFrames.length, 0)
    assert.equal(harness.termination.host, 0, 'a pre-effect rejection is not the proxy failure path')
  })

  test('an admitted call assigns ordinals in connection order, frames the worker, traces, then replies', () => {
    const harness = buildServerHarness()
    const { connection, request } = admitInspectCall(harness)
    assert.equal(harness.workerFrames.length, 1)
    const workerFrame = harness.workerFrames[0].toString('utf8')
    assert.equal(workerFrame, canonicalJson({ ordinal: 1, requestBase64: request.toString('base64') }) + '\n')
    assert.equal(harness.clock.timers.length, 1)
    assert.equal(harness.clock.timers[0].milliseconds, 300000, 'the worker call deadline is exactly 300000 milliseconds')
    assert.deepEqual(harness.traceLines, [], 'no trace line exists before the worker returns')
    harness.server.receiveWorkerLine(workerReplyLine())
    assert.equal(harness.traceLines.length, 1)
    assert.deepEqual(Object.keys(harness.traceLines[0]).sort(), ['exitCode', 'ordinal', 'requestBase64', 'stderrBase64', 'stdoutBase64'])
    assert.equal(harness.traceLines[0].requestBase64, request.toString('base64'), 'the server composes the trace from the admitted requestBase64, not a worker echo')
    assert.equal(connection.written.length, 1)
    const reply = JSON.parse(connection.written[0].toString('utf8'))
    assert.deepEqual(reply, { ...harness.traceLines[0] })
    assert.equal(connection.written[0].toString('utf8'), canonicalJson(reply) + '\n')
    assert.equal(harness.failures.length, 0)
    assert.equal(harness.clock.timers.length, 0, 'the reply clears the call deadline')
    assert.deepEqual(harness.gate.storedInspectionBytes(), Buffer.from('{"ok":true}', 'utf8'), 'a successful inspect stores its exact result bytes')
  })

  test('the server admits at most one controller call at a time', () => {
    const harness = buildServerHarness()
    const { request } = admitInspectCall(harness)
    const second = fakeConnection()
    harness.server.handleConnection(second)
    harness.server.receiveData(second, canonicalLine({ requestBase64: request.toString('base64'), token: 'a'.repeat(64) }))
    assert.equal(second.ended, true)
    assert.deepEqual(harness.failures, [{ detailCode: 'proxy-authorization' }], 'a concurrent duplicate is rejected pre-effect')
    assert.equal(harness.workerFrames.length, 1)
  })

  test('a worker disconnect during an admitted call is the proxy failure path exactly once', () => {
    const harness = buildServerHarness()
    admitInspectCall(harness)
    harness.server.workerDisconnected()
    assert.deepEqual(harness.failures, [{ detailCode: 'proxy' }])
    assert.equal(harness.termination.host, 1)
    assert.equal(harness.termination.worker, 1)
    assert.equal(harness.server.admissionOpen(), false)
    assert.equal(harness.clock.timers.length, 0, 'an active worker disconnect clears the call deadline')
    harness.server.workerDisconnected()
    assert.deepEqual(harness.failures, [{ detailCode: 'proxy' }], 'later worker failures are accounting only')
    assert.equal(harness.termination.host, 1)
    assert.equal(harness.termination.worker, 1)
  })

  test('a malformed, mismatched-ordinal, or oversized worker frame is the proxy failure path', () => {
    for (const mutate of [
      () => Buffer.from('not json\n', 'utf8'),
      () => workerReplyLine({ ordinal: 2 }),
      () => workerReplyLine({ stdoutBase64: 'not*base64' }),
      () => workerReplyLine({ exitCode: 1.5 }),
      (request) => canonicalLine({ ...JSON.parse(workerReplyLine().subarray(0, -1).toString('utf8')), requestBase64: request.toString('base64') }),
      () => Buffer.concat([Buffer.alloc(driver.BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES, 0x61), Buffer.from('\n')]),
    ]) {
      const harness = buildServerHarness()
      const { request } = admitInspectCall(harness)
      harness.server.receiveWorkerLine(mutate(request))
      assert.deepEqual(harness.failures, [{ detailCode: 'proxy' }])
      assert.equal(harness.termination.host, 1)
      assert.equal(harness.termination.worker, 1)
      assert.deepEqual(harness.traceLines, [])
      assert.equal(harness.clock.timers.length, 0, 'an invalid worker frame clears the call deadline')
    }
  })

  test('a never-returning controller call is claimed by the 300000 millisecond deadline and starts both terminations', () => {
    const harness = buildServerHarness()
    admitInspectCall(harness)
    assert.equal(harness.clock.timers[0].milliseconds, driver.DEADLINES.WORKER_CALL_MILLISECONDS)
    harness.clock.fire()
    assert.deepEqual(harness.failures, [{ detailCode: 'proxy' }])
    assert.equal(harness.termination.host, 1)
    assert.equal(harness.termination.worker, 1)
    assert.equal(harness.server.admissionOpen(), false)
    harness.server.receiveWorkerLine(workerReplyLine())
    assert.deepEqual(harness.failures, [{ detailCode: 'proxy' }], 'a late worker reply is accounting only')
  })

  test('a trace append failure or result write failure is the proxy failure path', () => {
    const traceFailure = buildServerHarness({
      trace: {
        append() {
          throw new Error('trace write failed')
        },
      },
    })
    const traced = admitInspectCall(traceFailure)
    traceFailure.server.receiveWorkerLine(workerReplyLine())
    assert.deepEqual(traceFailure.failures, [{ detailCode: 'proxy' }])
    assert.equal(traced.connection.written.length, 0, 'no reply is sent when the trace flush fails')
    assert.equal(traceFailure.clock.timers.length, 0, 'a trace failure clears the call deadline')
    const writeFailure = buildServerHarness()
    const admitted = admitInspectCall(writeFailure)
    admitted.connection.write = () => {
      throw new Error('reply write failed')
    }
    writeFailure.server.receiveWorkerLine(workerReplyLine())
    assert.deepEqual(writeFailure.failures, [{ detailCode: 'proxy' }])
    assert.equal(writeFailure.clock.timers.length, 0, 'a reply failure clears the call deadline')
  })

  test('result-reply backpressure defers verified closure until the connection drains', () => {
    const harness = buildServerHarness()
    const { connection, request } = admitInspectCall(harness, { writeReturn: false })
    harness.server.receiveWorkerLine(workerReplyLine())
    assert.equal(harness.failures.length, 0)
    let closed = false
    harness.server.close(() => {
      closed = true
    })
    assert.equal(closed, true)
    assert.equal(harness.server.verifiedClosure(), false, 'an unflushed result reply blocks verified closure')
    harness.server.connectionDrained(connection)
    assert.equal(harness.server.verifiedClosure(), true)
  })

  test('closed admission refuses later connections and cannot mutate trace evidence', () => {
    const harness = buildServerHarness()
    const { request } = admitInspectCall(harness)
    harness.server.receiveWorkerLine(workerReplyLine())
    harness.server.close(() => {})
    assert.equal(harness.server.verifiedClosure(), true)
    const late = fakeConnection()
    const outcome = harness.server.handleConnection(late)
    assert.deepEqual(outcome, { admitted: false })
    assert.equal(late.ended, true)
    harness.server.receiveData(late, canonicalLine({ requestBase64: request.toString('base64'), token: 'a'.repeat(64) }))
    assert.equal(harness.traceLines.length, 1, 'a post-closure client cannot mutate trace evidence')
    assert.equal(harness.workerFrames.length, 1)
  })

  test('the client-frame bound is derived from the apply ceiling and behaves exactly at its boundary', () => {
    assert.equal(driver.MAX_PROXY_CLIENT_FRAME_BYTES, 4 * Math.ceil(16777216 / 3) + 1024)
    assert.equal(driver.MAX_PROXY_CLIENT_FRAME_BYTES, 22370648)
    const budget = driver.createByteBudget({ limit: driver.MAX_PROXY_CLIENT_FRAME_BYTES, limitName: 'MAX_PROXY_CLIENT_FRAME_BYTES' })
    assert.deepEqual(budget.admit(driver.MAX_PROXY_CLIENT_FRAME_BYTES - 1), { ok: true })
    assert.deepEqual(budget.admit(1), { ok: true })
    assert.deepEqual(budget.admit(1), { overflow: { limitName: 'MAX_PROXY_CLIENT_FRAME_BYTES', observedBytes: driver.MAX_PROXY_CLIENT_FRAME_BYTES + 1 } })
  })

  test('an oversized terminated client frame is rejected before parsing as output-capacity', () => {
    const harness = buildServerHarness()
    harness.gate.authorizeInspect()
    const connection = fakeConnection()
    harness.server.handleConnection(connection)
    harness.server.receiveData(connection, Buffer.concat([Buffer.alloc(driver.MAX_PROXY_CLIENT_FRAME_BYTES + 1, 0x61), Buffer.from('\n')]))
    assert.deepEqual(harness.failures, [{ detailCode: 'output-capacity' }])
    assert.equal(connection.ended, true)
    assert.equal(harness.server.admissionOpen(), false)
    assert.equal(harness.termination.host, 1)
    assert.equal(harness.termination.worker, 1)
    assert.equal(harness.workerFrames.length, 0, 'an over-bound frame never reaches JSON parsing or the worker')
    assert.deepEqual(harness.traceLines, [])
  })

  test('an unterminated client-frame flood is rejected as soon as buffered bytes exceed the bound', () => {
    const harness = buildServerHarness()
    harness.gate.authorizeInspect()
    const connection = fakeConnection()
    harness.server.handleConnection(connection)
    harness.server.receiveData(connection, Buffer.alloc(driver.MAX_PROXY_CLIENT_FRAME_BYTES, 0x61))
    assert.deepEqual(harness.failures, [], 'an unterminated accumulation exactly at the bound is still admissible')
    harness.server.receiveData(connection, Buffer.from('a', 'utf8'))
    assert.deepEqual(harness.failures, [{ detailCode: 'output-capacity' }])
    assert.equal(connection.ended, true)
    assert.equal(harness.server.admissionOpen(), false)
    assert.equal(harness.termination.host, 1)
    assert.equal(harness.termination.worker, 1)
  })

  test('the checked-in worker loads the production closure and emits the exact ready frame', () => {
    const runtime = workerModule.createWorkerRuntime({ entryPath: controllerEntryPath })
    const expected = driver.collectControllerRuntimeClosure({ entryPath: controllerEntryPath })
    const readyLine = runtime.readyFrameBytes().toString('utf8')
    assert.equal(readyLine, canonicalJson({ controllerRuntimeSha256: expected.controllerRuntimeSha256, ready: true }) + '\n')
  })

  test('the worker answers an exact request frame with the exact four-member result frame', () => {
    const runtime = workerModule.createWorkerRuntime({ entryPath: controllerEntryPath })
    const requestBase64 = Buffer.from('definitely not json', 'utf8').toString('base64')
    const reply = runtime.handleFrameLine(canonicalLine({ ordinal: 7, requestBase64 }).subarray(0, -1))
    const replyText = reply.toString('utf8')
    assert.equal(replyText.endsWith('\n'), true)
    const frame = JSON.parse(replyText)
    assert.deepEqual(Object.keys(frame).sort(), ['exitCode', 'ordinal', 'stderrBase64', 'stdoutBase64'], 'the worker reply carries exactly the four plan-pinned members and never echoes the request')
    assert.equal(replyText, canonicalJson(frame) + '\n')
    assert.equal(frame.ordinal, 7)
    assert.equal(frame.exitCode, 2, 'a decode failure exits 2 through the closed protocol')
    assert.equal(frame.stderrBase64, '')
    const stdout = JSON.parse(Buffer.from(frame.stdoutBase64, 'base64').toString('utf8'))
    assert.equal(stdout.ok, false)
    assert.equal(stdout.phase, 'decode')
  })

  test('the worker rejects malformed input frames', () => {
    const runtime = workerModule.createWorkerRuntime({ entryPath: controllerEntryPath })
    assert.throws(() => runtime.handleFrameLine(Buffer.from('not json', 'utf8')), /frame/i)
    assert.throws(() => runtime.handleFrameLine(canonicalLine({ ordinal: 0, requestBase64: 'aGk=' }).subarray(0, -1)), /frame/i)
    assert.throws(() => runtime.handleFrameLine(canonicalLine({ ordinal: 1, requestBase64: 'not*base64' }).subarray(0, -1)), /frame/i)
    assert.throws(() => runtime.handleFrameLine(canonicalLine({ extra: 1, ordinal: 1, requestBase64: 'aGk=' }).subarray(0, -1)), /frame/i)
  })

  test('the finalization barrier is the exact conjunction of host, enabled, and termination-proof facts', () => {
    const barrier = driver.createFinalizationBarrier({ enabled: true })
    barrier.requireTerminationProof('host')
    const facts = ['host-process-close', 'host-stdout-eof', 'host-stderr-eof', 'host-tree-proof', 'proxy-closure', 'worker-process-close', 'worker-stdout-eof', 'worker-stderr-eof', 'worker-containment-empty', 'termination-proven:host']
    for (const fact of facts) {
      assert.equal(barrier.complete(), false, `barrier must be incomplete before ${fact}`)
      barrier.satisfy(fact)
    }
    assert.equal(barrier.complete(), true)
    assert.deepEqual(barrier.missing(), [])
    assert.throws(() => barrier.satisfy('unknown-fact'), /fact/)
    const disabled = driver.createFinalizationBarrier({ enabled: false })
    for (const fact of ['host-process-close', 'host-stdout-eof', 'host-stderr-eof', 'host-tree-proof']) {
      disabled.satisfy(fact)
    }
    assert.equal(disabled.complete(), true, 'a disabled run needs no proxy or worker facts')
  })

  test('unproven termination or expired stream closure retains the run root untouched', () => {
    const runRoot = tempRoot()
    try {
      writeFileSync(join(runRoot, 'evidence.bin'), 'bytes\n')
      const unproven = driver.finalizeRunRoot({ runRoot, terminationProven: false })
      assert.deepEqual(unproven, { attempted: false, retainedRunRoot: runRoot })
      assert.equal(existsSync(join(runRoot, 'evidence.bin')), true, 'an unproven termination leaves the root untouched')
      const expired = driver.finalizeRunRoot({ runRoot, streamClosureExpired: true, terminationProven: true })
      assert.deepEqual(expired, { attempted: false, retainedRunRoot: runRoot })
      assert.equal(existsSync(join(runRoot, 'evidence.bin')), true)
      const proven = driver.finalizeRunRoot({ runRoot, terminationProven: true })
      assert.deepEqual(proven, { attempted: true, retainedRunRoot: null })
      assert.equal(existsSync(runRoot), false, 'a proven cleanup removes and absence-verifies the complete root')
    } finally {
      rmSync(runRoot, { force: true, recursive: true })
    }
  })

  test('a cleanup failure or surviving residue reports the retained root with detail cleanup', () => {
    const runRoot = tempRoot()
    try {
      writeFileSync(join(runRoot, 'residue.bin'), 'bytes\n')
      const outcome = driver.finalizeRunRoot({
        filesystem: {
          existsSync,
          rmSync() {
            throw new Error('removal failed')
          },
        },
        runRoot,
        terminationProven: true,
      })
      assert.deepEqual(outcome, { attempted: true, detailCode: 'cleanup', retainedRunRoot: runRoot })
      const survivor = driver.finalizeRunRoot({
        filesystem: { existsSync: () => true, rmSync() {} },
        runRoot,
        terminationProven: true,
      })
      assert.deepEqual(survivor, { attempted: true, detailCode: 'cleanup', retainedRunRoot: runRoot }, 'absence verification failure retains the root')
    } finally {
      rmSync(runRoot, { force: true, recursive: true })
    }
  })

  test('the evidence leaf path grammar is closed', () => {
    assert.equal(driver.buildLeafPath({ host: 'claude-code', mode: 'enabled', repetition: 3, scenario: 'fresh-empty-track-approved' }), 'claude-code/fresh-empty-track-approved/enabled/3')
    assert.equal(driver.buildLeafPath({ host: 'codex', mode: 'disabled', repetition: 1, scenario: 'fresh-empty-track-approved' }), 'codex/fresh-empty-track-approved/disabled/1')
    assert.throws(() => driver.buildLeafPath({ host: 'other', mode: 'enabled', repetition: 1, scenario: 's' }), /host/)
    assert.throws(() => driver.buildLeafPath({ host: 'codex', mode: 'disabled', repetition: 2, scenario: 's' }), /repetition/)
    assert.throws(() => driver.buildLeafPath({ host: 'codex', mode: 'enabled', repetition: 4, scenario: 's' }), /repetition/)
    assert.throws(() => driver.buildLeafPath({ host: 'codex', mode: 'other', repetition: 1, scenario: 's' }), /mode/)
  })

  test('evidence publication stages, verifies, and atomically renames the leaf with its exact manifest', () => {
    const outputRoot = tempRoot()
    try {
      const files = [
        { bytes: canonicalLine({ host: 'claude-code' }), path: 'run.json' },
        { bytes: Buffer.from('raw-stdout', 'utf8'), path: 'streams/host.stdout.bin' },
      ]
      const outcome = driver.publishEvidenceLeaf({ files, host: 'claude-code', mode: 'enabled', outputRoot, repetition: 1, scenario: 'fresh-empty-track-approved' })
      assert.equal(outcome.ok, true)
      const leafPath = join(outputRoot, 'claude-code', 'fresh-empty-track-approved', 'enabled', '1')
      assert.equal(outcome.leafPath, leafPath)
      assert.deepEqual(readdirSync(dirname(leafPath)), ['1'], 'no staging sibling survives publication')
      assert.deepEqual(readFileSync(join(leafPath, 'run.json')), files[0].bytes)
      assert.deepEqual(readFileSync(join(leafPath, 'streams', 'host.stdout.bin')), files[1].bytes)
      const manifest = JSON.parse(readFileSync(join(leafPath, 'manifest.json'), 'utf8'))
      assert.deepEqual(Object.keys(manifest).sort(), ['evidenceManifestSha256', 'files'])
      assert.deepEqual(manifest.files, [
        { path: 'run.json', sha256: sha256(files[0].bytes) },
        { path: 'streams/host.stdout.bin', sha256: sha256(files[1].bytes) },
      ])
      assert.equal(manifest.evidenceManifestSha256, sha256(Buffer.from(canonicalJson({ files: manifest.files }), 'utf8')))
      assert.equal(outcome.evidenceManifestSha256, manifest.evidenceManifestSha256)
      const manifestBytes = readFileSync(join(leafPath, 'manifest.json'))
      assert.equal(outcome.leafBytes, files[0].bytes.length + files[1].bytes.length + manifestBytes.length)
    } finally {
      rmSync(outputRoot, { force: true, recursive: true })
    }
  })

  test('leaf and root capacity, including the staging reservation, refuse publication before any copy', () => {
    const outputRoot = tempRoot()
    try {
      const files = [{ bytes: Buffer.from('0123456789', 'utf8'), path: 'run.json' }]
      const base = { files, host: 'codex', mode: 'disabled', outputRoot, repetition: 1, scenario: 'fresh-empty-track-approved' }
      const sized = driver.publishEvidenceLeaf({ ...base })
      rmSync(join(outputRoot, 'codex'), { force: true, recursive: true })
      const leafOverflow = driver.publishEvidenceLeaf({ ...base, leafLimit: sized.leafBytes - 1 })
      assert.deepEqual(leafOverflow, { detailCode: 'output-capacity', limitName: 'MAX_EVIDENCE_LEAF_BYTES', observedBytes: sized.leafBytes, ok: false })
      assert.equal(existsSync(join(outputRoot, 'codex')), false, 'a refused leaf leaves no final leaf')
      const exactLeaf = driver.publishEvidenceLeaf({ ...base, leafLimit: sized.leafBytes })
      assert.equal(exactLeaf.ok, true, 'a leaf exactly at its limit publishes')
      rmSync(join(outputRoot, 'codex'), { force: true, recursive: true })
      const rootOverflow = driver.publishEvidenceLeaf({ ...base, rootLimit: sized.leafBytes, rootUsedBytes: 1 })
      assert.deepEqual(rootOverflow, { detailCode: 'output-capacity', limitName: 'MAX_EVIDENCE_ROOT_BYTES', observedBytes: sized.leafBytes + 1, ok: false })
      assert.equal(existsSync(join(outputRoot, 'codex')), false, 'the staging reservation counts against the root limit before a copy starts')
      const exactRoot = driver.publishEvidenceLeaf({ ...base, rootLimit: sized.leafBytes + 1, rootUsedBytes: 1 })
      assert.equal(exactRoot.ok, true)
    } finally {
      rmSync(outputRoot, { force: true, recursive: true })
    }
  })

  test('an evidence copy failure and a verification mismatch leave no final leaf', () => {
    const outputRoot = tempRoot()
    try {
      const files = [{ bytes: Buffer.from('payload\n', 'utf8'), path: 'run.json' }]
      const base = { files, host: 'claude-code', mode: 'disabled', outputRoot, repetition: 1, scenario: 'existing-enriched-denied' }
      const copyFailure = driver.publishEvidenceLeaf({
        ...base,
        filesystem: {
          existsSync,
          mkdirSync,
          readFileSync,
          renameSync,
          rmSync,
          writeFileSync() {
            throw new Error('disk full')
          },
        },
      })
      assert.equal(copyFailure.ok, false)
      assert.equal(copyFailure.detailCode, 'evidence-copy')
      assert.equal(existsSync(join(outputRoot, 'claude-code')), false)
      const verifyFailure = driver.publishEvidenceLeaf({
        ...base,
        filesystem: {
          existsSync,
          mkdirSync,
          readFileSync(path, ...rest) {
            const bytes = readFileSync(path, ...rest)

            return String(path).endsWith('run.json') ? Buffer.from('tampered\n', 'utf8') : bytes
          },
          renameSync,
          rmSync,
          writeFileSync,
        },
      })
      assert.equal(verifyFailure.ok, false)
      assert.equal(verifyFailure.detailCode, 'evidence-verification')
      assert.equal(existsSync(join(outputRoot, 'claude-code')), false, 'a failed verification publishes no final leaf')
    } finally {
      rmSync(outputRoot, { force: true, recursive: true })
    }
  })

  test('published evidence bytes carry zero credential evidence', () => {
    const outputRoot = tempRoot()
    try {
      const token = 'c'.repeat(64)
      const files = [
        { bytes: canonicalLine({ exitCode: 0, ordinal: 1, requestBase64: 'aGk=', stderrBase64: '', stdoutBase64: 'aGk=' }), path: 'proxy.jsonl' },
        { bytes: canonicalLine({ kind: 'input', ordinal: 1, payloadBase64: 'aGk=' }), path: 'transcript.jsonl' },
      ]
      const outcome = driver.publishEvidenceLeaf({ files, host: 'codex', mode: 'enabled', outputRoot, repetition: 2, scenario: 'fresh-empty-track-approved' })
      assert.equal(outcome.ok, true)
      const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(directory, entry.name)) : [join(directory, entry.name)])
      for (const leaf of walk(outputRoot)) {
        assert.equal(readFileSync(leaf).includes(token), false, `published evidence must not contain the proxy token: ${leaf}`)
      }
    } finally {
      rmSync(outputRoot, { force: true, recursive: true })
    }
  })

  test('terminal repository attestation matches stable enabled and disabled collections including the marker rule', () => {
    const scenarioRoot = '/eval/run/repo'
    const baseEntries = [
      { contentBase64: null, kind: 'directory', mode: 493, path: '.claude' },
      { contentBase64: Buffer.from('# Quick wins\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: '.claude/QUICK_WINS.md' },
    ]
    const git = { kind: 'git', trackedPaths: [] }
    const guidanceEntry = { contentBase64: Buffer.from('# CLAUDE.md\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'CLAUDE.md' }
    const markerBytes = canonicalLine({ protocolVersion: 1, root: scenarioRoot, snapshotId: 'ab'.repeat(32), state: 'deferred' })
    const member = {
      base: { entries: baseEntries, git },
      hostEntries: { 'claude-code': [guidanceEntry], codex: [] },
      marker: { state: 'deferred' },
    }
    const markerEntry = { contentBase64: markerBytes.toString('base64'), kind: 'file', mode: 384, path: ELECTION_MARKER_PATH }
    const observed = { entries: [markerEntry, ...baseEntries, guidanceEntry].sort((left, right) => left.path < right.path ? -1 : 1), git }
    const outcome = driver.attestTerminalRepository({
      collectRepository: () => JSON.parse(JSON.stringify(observed)),
      host: 'claude-code',
      member,
      platform: 'linux',
      scenarioRoot,
    })
    assert.equal(outcome.passed, true)
    assert.deepEqual(Object.keys(outcome.record).sort(), ['expectedSha256', 'observed', 'observedSha256'])
    assert.deepEqual(outcome.record.observed, observed)
    assert.equal(outcome.record.observedSha256, sha256(Buffer.from(canonicalJson(observed), 'utf8')))
    assert.equal(outcome.terminalRepositorySha256, outcome.record.observedSha256)
    const expectedImage = { entries: [...baseEntries, guidanceEntry].sort((left, right) => left.path < right.path ? -1 : 1), git }
    assert.equal(outcome.record.expectedSha256, sha256(Buffer.from(canonicalJson(expectedImage), 'utf8')), 'the expected digest excludes the marker and covers the merged host image')
    const disabledMember = { base: { entries: baseEntries, git }, hostEntries: { 'claude-code': [], codex: [] }, marker: null }
    const disabledOutcome = driver.attestTerminalRepository({
      collectRepository: () => ({ entries: [...baseEntries], git }),
      host: 'codex',
      member: disabledMember,
      platform: 'linux',
      scenarioRoot,
    })
    assert.equal(disabledOutcome.passed, true)
  })

  test('windows attestation applies the manifest platform-mode normalization to the merged expected image', () => {
    const scenarioRoot = 'C:\\eval\\run\\repo'
    const entry = { contentBase64: Buffer.from('bytes\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'file.md' }
    const member = { base: { entries: [entry], git: { kind: 'non-git', trackedPaths: [] } }, hostEntries: { 'claude-code': [], codex: [] }, marker: null }
    const observed = { entries: [{ ...entry, mode: null }], git: { kind: 'non-git', trackedPaths: [] } }
    const outcome = driver.attestTerminalRepository({
      collectRepository: () => JSON.parse(JSON.stringify(observed)),
      host: 'claude-code',
      member,
      platform: 'win32',
      scenarioRoot,
    })
    assert.equal(outcome.passed, true, 'windows observed null modes match the normalized expectation')
  })

  test('every terminal mismatch publishes passed false while unstable collection takes the infrastructure path', () => {
    const scenarioRoot = '/eval/run/repo'
    const entryA = { contentBase64: Buffer.from('a\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'a.md' }
    const entryB = { contentBase64: Buffer.from('b\n', 'utf8').toString('base64'), kind: 'file', mode: 420, path: 'b.md' }
    const git = { kind: 'git', trackedPaths: ['a.md'] }
    const member = { base: { entries: [entryA], git }, hostEntries: { 'claude-code': [], codex: [] }, marker: null }
    const mismatches = [
      { entries: [entryA, entryB], git },
      { entries: [{ ...entryA, contentBase64: Buffer.from('modified\n', 'utf8').toString('base64') }], git },
      { entries: [], git: { kind: 'git', trackedPaths: [] } },
      { entries: [entryA], git: { kind: 'git', trackedPaths: [] } },
      { entries: [entryA], git: { kind: 'git', trackedPaths: ['a.md', 'b.md'] } },
    ]
    for (const observed of mismatches) {
      const outcome = driver.attestTerminalRepository({
        collectRepository: () => JSON.parse(JSON.stringify(observed)),
        host: 'claude-code',
        member,
        platform: 'linux',
        scenarioRoot,
      })
      assert.equal(outcome.passed, false, `mismatch must publish passed false: ${canonicalJson(observed)}`)
      assert.equal(outcome.record.observedSha256, sha256(Buffer.from(canonicalJson(observed), 'utf8')), 'the false row still carries the attestation evidence')
    }
    const markerWhenNoneExpected = driver.attestTerminalRepository({
      collectRepository: () => ({
        entries: [entryA, { contentBase64: canonicalLine({ protocolVersion: 1, root: scenarioRoot, snapshotId: 'cd'.repeat(32), state: 'track' }).toString('base64'), kind: 'file', mode: 384, path: ELECTION_MARKER_PATH }].sort((left, right) => left.path < right.path ? -1 : 1),
        git,
      }),
      host: 'claude-code',
      member,
      platform: 'linux',
      scenarioRoot,
    })
    assert.equal(markerWhenNoneExpected.passed, false, 'a disabled-mode or unauthorized marker is a failing extra mutation')
    let flip = 0
    const unstable = driver.attestTerminalRepository({
      collectRepository: () => ({ entries: flip++ === 0 ? [entryA] : [entryA, entryB], git }),
      host: 'claude-code',
      member,
      platform: 'linux',
      scenarioRoot,
    })
    assert.deepEqual(unstable, { failure: { detailCode: 'repository-attestation', initialCode: null, phase: 'post-session' } })
    const throwing = driver.attestTerminalRepository({
      collectRepository: () => {
        throw new Error('query failed')
      },
      host: 'claude-code',
      member,
      platform: 'linux',
      scenarioRoot,
    })
    assert.deepEqual(throwing, { failure: { detailCode: 'repository-attestation', initialCode: null, phase: 'post-session' } })
  })

  test('an expected marker is judged by the structural marker rule alone', () => {
    const scenarioRoot = '/eval/run/repo'
    const git = { kind: 'git', trackedPaths: [] }
    const member = { base: { entries: [], git }, hostEntries: { 'claude-code': [], codex: [] }, marker: { state: 'deferred' } }
    const markerCase = (bytes, mode = 384) => driver.attestTerminalRepository({
      collectRepository: () => ({ entries: [{ contentBase64: bytes.toString('base64'), kind: 'file', mode, path: ELECTION_MARKER_PATH }], git }),
      host: 'codex',
      member,
      platform: 'linux',
      scenarioRoot,
    })
    const valid = canonicalLine({ protocolVersion: 1, root: scenarioRoot, snapshotId: 'ef'.repeat(32), state: 'deferred' })
    assert.equal(markerCase(valid).passed, true)
    assert.equal(markerCase(canonicalLine({ protocolVersion: 1, root: scenarioRoot, snapshotId: 'ef'.repeat(32), state: 'track' })).passed, false, 'a wrong marker state fails')
    assert.equal(markerCase(canonicalLine({ protocolVersion: 1, root: '/other/root', snapshotId: 'ef'.repeat(32), state: 'deferred' })).passed, false, 'a wrong marker root fails')
    assert.equal(markerCase(valid, 420).passed, false, 'a wrong marker mode fails')
    const absentMarker = driver.attestTerminalRepository({
      collectRepository: () => ({ entries: [], git }),
      host: 'codex',
      member,
      platform: 'linux',
      scenarioRoot,
    })
    assert.equal(absentMarker.passed, false, 'an expected marker must be present')
  })

  test('result records use the closed key set and summary rows order false before true', () => {
    const digest = '7'.repeat(64)
    const record = driver.buildResultRecord({
      deterministicDigest: digest,
      dialogueFacts: { allActionsDisclosed: true, ambiguitiesAsked: true, approvalBeforeApply: true, denialNoApply: true, electionPresented: true },
      lifecycleFacts: { approvalApplyCardinality: true, externalWriterWindowDisclosed: true, resultPresented: true, unresolvedPresented: true },
      passed: false,
      semanticActionDispositions: [],
      semanticClassifications: [],
      semanticDecisionSource: 'model',
      semanticDecisions: [],
      semanticRepairOracles: [],
      structuredResult: { approvalBranch: 'denied', reasonCode: 'denied' },
      terminalRepositorySha256: digest,
    })
    assert.deepEqual(Object.keys(record).sort(), ['deterministicDigest', 'dialogueFacts', 'lifecycleFacts', 'passed', 'semanticActionDispositions', 'semanticClassifications', 'semanticDecisionSource', 'semanticDecisions', 'semanticRepairOracles', 'structuredResult', 'terminalRepositorySha256'])
    assert.equal(record.passed, false, 'a repository mismatch forces passed false even with valid controller evidence')
    assert.throws(() => driver.buildResultRecord({ ...record, extra: 1 }), /keys/)
    assert.throws(() => driver.buildResultRecord({ ...record, passed: 'yes' }), /passed/)
    const scenarioIds = ['fresh-empty-track-approved', 'fresh-structural-ignore-approved']
    const row = (host, scenario, controllerEnabled) => ({ controllerEnabled, host, scenario })
    const rows = [
      row('claude-code', 'fresh-empty-track-approved', false),
      row('claude-code', 'fresh-empty-track-approved', true),
      row('claude-code', 'fresh-structural-ignore-approved', false),
      row('codex', 'fresh-empty-track-approved', true),
    ]
    const manifests = [
      { evidenceManifestSha256: digest, host: 'claude-code', mode: 'disabled', repetition: 1, scenario: 'fresh-empty-track-approved' },
      { evidenceManifestSha256: digest, host: 'claude-code', mode: 'enabled', repetition: 1, scenario: 'fresh-empty-track-approved' },
      { evidenceManifestSha256: digest, host: 'claude-code', mode: 'enabled', repetition: 2, scenario: 'fresh-empty-track-approved' },
    ]
    assert.deepEqual(driver.buildSummary({ evidenceManifests: manifests, rows, scenarioIds }), { evidenceManifests: manifests, rows })
    assert.throws(() => driver.buildSummary({ evidenceManifests: manifests, rows: [rows[1], rows[0]], scenarioIds }), /false before true/)
    assert.throws(() => driver.buildSummary({ evidenceManifests: manifests, rows: [rows[2], rows[0]], scenarioIds }), /scenario/)
    assert.throws(() => driver.buildSummary({ evidenceManifests: manifests, rows: [rows[3], rows[0]], scenarioIds }), /host/)
    assert.throws(() => driver.buildSummary({ evidenceManifests: [manifests[2], manifests[1]], rows, scenarioIds }), /sorted/)
  })

  const clientEnvironment = (overrides = {}) => ({
    NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS: '127.0.0.1',
    NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT: '43210',
    NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN: 'd'.repeat(64),
    ...overrides,
  })

  function streamCollector() {
    return {
      bytes() {
        return Buffer.concat(this.chunks)
      },
      chunks: [],
      write(chunk) {
        this.chunks.push(Buffer.from(chunk))

        return true
      },
    }
  }

  async function runClient(options) {
    const stdout = streamCollector()
    const stderr = streamCollector()
    const exitCode = await proxyClient.runCli({ stderr, stdout, ...options })

    return { exitCode, stderr: stderr.bytes(), stdout: stdout.bytes() }
  }

  function canonicalTempRoot() {
    return require('node:fs').realpathSync.native(tempRoot('nightshift-client-'))
  }

  function gatePath(root, ...names) {
    return join(root, REQUEST_GATE_BASENAME, ...names)
  }

  function stageGate(root, children = {}) {
    mkdirSync(gatePath(root), { mode: 0o700 })
    for (const [name, bytes] of Object.entries(children)) {
      writeFileSync(gatePath(root, name), bytes, { mode: 0o600 })
    }
  }

  function ownerRecordBytes(root, nonce, state, pid = null) {
    const record = state === 'consuming' ? { nonce, pid, protocolVersion: 1, root, state } : { nonce, protocolVersion: 1, root, state }

    return canonicalLine(record)
  }

  const NONCE_A = '0123456789abcdef0123456789abcdef'
  const liveKill = () => {}
  const absentKill = () => {
    const error = new Error('no such process')
    error.code = 'ESRCH'
    throw error
  }

  test('the fixed client validates its proxy environment before connecting or touching the gate', async () => {
    const root = canonicalTempRoot()
    try {
      stageGate(root, { 'owner.json': ownerRecordBytes(root, NONCE_A, 'reserved'), 'request.json': Buffer.from('{"x":1}\n', 'utf8') })
      const rejects = [
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS: undefined },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_ADDRESS: 'localhost' },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT: undefined },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT: '0080' },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT: '0' },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT: '65536' },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_PORT: '80 ' },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN: undefined },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN: 'D'.repeat(64) },
        { NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN: 'd'.repeat(63) },
      ]
      for (const override of rejects) {
        let connected = false
        const outcome = await runClient({
          argv: ['--consume-request', root, NONCE_A],
          connect: async () => {
            connected = true
            throw new Error('unreachable')
          },
          env: clientEnvironment(override),
        })
        assert.equal(outcome.exitCode, 2, `environment rejection must exit 2: ${canonicalJson(override)}`)
        assert.equal(outcome.stderr.toString('ascii'), 'nightshift-init-backlog: invalid request transport invocation\n')
        assert.equal(outcome.stdout.length, 0)
        assert.equal(connected, false, 'no connection is attempted')
      }
      assert.equal(existsSync(gatePath(root, 'request.json')), true, 'the reserved payload is untouched by environment rejection')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('the client accepts only the four exact public argv grammars', async () => {
    const root = canonicalTempRoot()
    try {
      const invalid = [
        [],
        ['--reserve-request'],
        ['--reserve-request', root, 'extra'],
        ['--consume-request', root],
        ['--consume-request', root, 'XYZ'],
        ['--consume-request', root, NONCE_A, 'extra'],
        ['--inspect-request-residue'],
        ['--clean-request-residue', root, 'null', 'null', 'null'],
        ['--clean-request-residue', root, 'null', 'null', 'null', 'zz'],
        ['--unknown', root],
      ]
      for (const argv of invalid) {
        const outcome = await runClient({ argv, env: clientEnvironment() })
        assert.equal(outcome.exitCode, 2, `invalid argv must exit 2: ${JSON.stringify(argv)}`)
        assert.equal(outcome.stderr.toString('ascii'), 'nightshift-init-backlog: invalid request transport invocation\n')
        assert.equal(outcome.stdout.length, 0)
      }
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('reservation publishes the fixed gate through the one-path contract with no support directory', async () => {
    const root = canonicalTempRoot()
    try {
      const first = await runClient({ argv: ['--reserve-request', root], env: clientEnvironment(), nonce: NONCE_A })
      assert.equal(first.exitCode, 0)
      assert.equal(first.stderr.length, 0)
      const record = JSON.parse(first.stdout.toString('utf8'))
      assert.deepEqual(record, { maxRequestBytes: 16777216, nonce: NONCE_A, requestDirectory: REQUEST_GATE_BASENAME, requestPath: `${REQUEST_GATE_BASENAME}/request.json` })
      assert.equal(first.stdout.toString('utf8'), canonicalJson(record) + '\n')
      assert.deepEqual(readdirSync(root), [REQUEST_GATE_BASENAME], 'reservation creates only the fixed gate and no support directory')
      assert.deepEqual(readdirSync(gatePath(root)).sort(), ['owner.json'])
      assert.deepEqual(readFileSync(gatePath(root, 'owner.json')), ownerRecordBytes(root, NONCE_A, 'reserved'))
      const second = await runClient({ argv: ['--reserve-request', root], env: clientEnvironment(), nonce: 'f'.repeat(32) })
      assert.equal(second.exitCode, 1, 'concurrent reservation loses on the one fixed path')
      assert.deepEqual(JSON.parse(second.stdout.toString('utf8')), { code: 'request-residue', ok: false })
      assert.deepEqual(readFileSync(gatePath(root, 'owner.json')), ownerRecordBytes(root, NONCE_A, 'reserved'), 'the losing reserver mutates nothing')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('a live consuming owner makes reservation busy rather than residue', async () => {
    const root = canonicalTempRoot()
    try {
      stageGate(root, { 'owner.json': ownerRecordBytes(root, NONCE_A, 'consuming', 4242) })
      const outcome = await runClient({ argv: ['--reserve-request', root], env: clientEnvironment(), killProcess: liveKill, nonce: 'f'.repeat(32) })
      assert.equal(outcome.exitCode, 1)
      assert.deepEqual(JSON.parse(outcome.stdout.toString('utf8')), { code: 'request-busy', ok: false })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('inspection reports every durable residue state with exact owner-stage evidence', async () => {
    const payload = Buffer.from('{"payload":true}\n', 'utf8')
    const partialStage = Buffer.from('{"partial"', 'utf8')
    const reserved = (root) => ownerRecordBytes(root, NONCE_A, 'reserved')
    const consuming = (root) => ownerRecordBytes(root, NONCE_A, 'consuming', 4242)
    const cases = [
      { children: () => ({}), expect: { cleanupAllowed: true, nonce: null, ownerStageRawSha256: null, payloadRawSha256: null, pidStatus: 'not-applicable', state: 'empty-gate' } },
      { children: () => ({ 'owner.new': partialStage }), expect: { cleanupAllowed: true, nonce: null, ownerStageRawSha256: sha256(partialStage), payloadRawSha256: null, pidStatus: 'not-applicable', state: 'owner-stage' } },
      { children: (root) => ({ 'owner.new': reserved(root) }), expect: { cleanupAllowed: true, nonce: NONCE_A, ownerStageRawSha256: null, payloadRawSha256: null, pidStatus: 'not-applicable', state: 'published-owner-stage' }, link: true },
      { children: (root) => ({ 'owner.json': reserved(root) }), expect: { cleanupAllowed: true, nonce: NONCE_A, ownerStageRawSha256: null, payloadRawSha256: null, pidStatus: 'not-applicable', state: 'reserved' } },
      { children: (root) => ({ 'owner.json': reserved(root), 'request.json': payload }), expect: { cleanupAllowed: true, nonce: NONCE_A, ownerStageRawSha256: null, payloadRawSha256: sha256(payload), pidStatus: 'not-applicable', state: 'reserved-payload' } },
      { children: (root) => ({ 'owner.json': reserved(root), 'owner.new': partialStage, 'request.json': payload }), expect: { cleanupAllowed: true, nonce: NONCE_A, ownerStageRawSha256: sha256(partialStage), payloadRawSha256: sha256(payload), pidStatus: 'not-applicable', state: 'consuming-stage-payload' } },
      { children: (root) => ({ 'owner.json': consuming(root), 'request.json': payload }), expect: { cleanupAllowed: true, nonce: NONCE_A, ownerStageRawSha256: null, payloadRawSha256: sha256(payload), pidStatus: 'absent', state: 'consuming-payload' }, killProcess: absentKill },
      { children: (root) => ({ 'owner.json': consuming(root) }), expect: { cleanupAllowed: false, nonce: NONCE_A, ownerStageRawSha256: null, payloadRawSha256: null, pidStatus: 'live', state: 'consuming-owner' }, killProcess: liveKill },
    ]
    for (const item of cases) {
      const root = canonicalTempRoot()
      try {
        const children = item.children(root)
        stageGate(root, children)
        if (item.link === true) {
          linkSync(gatePath(root, 'owner.new'), gatePath(root, 'owner.json'))
        }
        const outcome = await runClient({ argv: ['--inspect-request-residue', root], env: clientEnvironment(), killProcess: item.killProcess })
        assert.equal(outcome.exitCode, 0, `inspect must succeed for ${item.expect.state}`)
        const result = JSON.parse(outcome.stdout.toString('utf8'))
        assert.deepEqual(Object.keys(result).sort(), ['cleanupAllowed', 'nonce', 'ownerRawSha256', 'ownerStageRawSha256', 'payloadRawSha256', 'payloadSize', 'pidStatus', 'requestDirectory', 'state'])
        assert.equal(result.state, item.expect.state)
        assert.equal(result.nonce, item.expect.nonce)
        assert.equal(result.ownerStageRawSha256, item.link === true ? sha256(item.children(root)['owner.new']) : item.expect.ownerStageRawSha256)
        assert.equal(result.payloadRawSha256, item.expect.payloadRawSha256)
        assert.equal(result.payloadSize, item.expect.payloadRawSha256 === null ? null : payload.length)
        assert.equal(result.pidStatus, item.expect.pidStatus)
        assert.equal(result.cleanupAllowed, item.expect.cleanupAllowed)
        assert.equal(result.requestDirectory, REQUEST_GATE_BASENAME)
        assert.equal(result.ownerRawSha256, 'owner.json' in children || item.link === true ? sha256(item.link === true ? children['owner.new'] : children['owner.json']) : null)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('cleanup removes stage first, maps every prefix, and honors the empty-gate and absent-gate branches', async () => {
    const payload = Buffer.from('{"payload":true}\n', 'utf8')
    const partialStage = Buffer.from('{"partial"', 'utf8')
    const root = canonicalTempRoot()
    try {
      stageGate(root, { 'owner.json': ownerRecordBytes(root, NONCE_A, 'reserved'), 'owner.new': partialStage, 'request.json': payload })
      const full = await runClient({
        argv: ['--clean-request-residue', root, NONCE_A, sha256(ownerRecordBytes(root, NONCE_A, 'reserved')), sha256(partialStage), sha256(payload)],
        env: clientEnvironment(),
      })
      assert.equal(full.exitCode, 0)
      assert.deepEqual(JSON.parse(full.stdout.toString('utf8')), { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME })
      assert.deepEqual(readdirSync(root), [], 'approved stage-first cleanup removes the complete gate')
      stageGate(root, {})
      const emptyGate = await runClient({ argv: ['--clean-request-residue', root, 'null', 'null', 'null', 'null'], env: clientEnvironment() })
      assert.equal(emptyGate.exitCode, 0)
      assert.deepEqual(JSON.parse(emptyGate.stdout.toString('utf8')), { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME })
      const replay = await runClient({ argv: ['--clean-request-residue', root, 'null', 'null', 'null', 'null'], env: clientEnvironment() })
      assert.equal(replay.exitCode, 0, 'the all-null empty-gate replay is the terminal response-loss shape')
      assert.deepEqual(JSON.parse(replay.stdout.toString('utf8')), { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME })
      const staleEvidence = await runClient({ argv: ['--clean-request-residue', root, NONCE_A, 'null', 'null', 'null'], env: clientEnvironment() })
      assert.equal(staleEvidence.exitCode, 1)
      assert.deepEqual(JSON.parse(staleEvidence.stdout.toString('utf8')), { code: 'request-evidence-mismatch', ok: false }, 'nonnull evidence against an absent gate is rejected because consume-and-dispatch produces the same absence')
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('cleanup refuses changed evidence and live consumers without mutation', async () => {
    const root = canonicalTempRoot()
    try {
      const owner = ownerRecordBytes(root, NONCE_A, 'reserved')
      stageGate(root, { 'owner.json': owner })
      const changed = await runClient({ argv: ['--clean-request-residue', root, NONCE_A, 'e'.repeat(64), 'null', 'null'], env: clientEnvironment() })
      assert.equal(changed.exitCode, 1)
      assert.deepEqual(JSON.parse(changed.stdout.toString('utf8')), { code: 'request-evidence-mismatch', ok: false })
      assert.deepEqual(readFileSync(gatePath(root, 'owner.json')), owner, 'refused cleanup mutates nothing')
      rmSync(gatePath(root), { force: true, recursive: true })
      const consuming = ownerRecordBytes(root, NONCE_A, 'consuming', 4242)
      stageGate(root, { 'owner.json': consuming })
      const live = await runClient({ argv: ['--clean-request-residue', root, NONCE_A, sha256(consuming), 'null', 'null'], env: clientEnvironment(), killProcess: liveKill })
      assert.equal(live.exitCode, 1)
      assert.deepEqual(JSON.parse(live.stdout.toString('utf8')), { code: 'request-live', ok: false })
      assert.equal(existsSync(gatePath(root, 'owner.json')), true)
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('an admitted consume cleans the gate before connecting and replays the unchanged controller result', async () => {
    const root = canonicalTempRoot()
    try {
      const payload = Buffer.from(canonicalJson({ operation: 'inspect', protocolVersion: 1 }) + '\n', 'utf8')
      stageGate(root, { 'owner.json': ownerRecordBytes(root, NONCE_A, 'reserved'), 'request.json': payload })
      const token = clientEnvironment().NIGHTSHIFT_INIT_BACKLOG_PROXY_TOKEN
      const stdoutBytes = Buffer.from('{"ok":true,"operation":"inspect"}\n', 'utf8')
      const stderrBytes = Buffer.from('', 'utf8')
      const sentFrames = []
      const connectCalls = []
      const outcome = await runClient({
        argv: ['--consume-request', root, NONCE_A],
        connect: async ({ address, port }) => {
          connectCalls.push({ address, gatePresent: existsSync(gatePath(root)), port })

          return {
            end() {},
            async sendFrame(frameBytes) {
              sentFrames.push(Buffer.from(frameBytes))
              const frame = JSON.parse(frameBytes.toString('utf8'))

              return canonicalLine({ exitCode: 0, ordinal: 1, requestBase64: frame.requestBase64, stderrBase64: stderrBytes.toString('base64'), stdoutBase64: stdoutBytes.toString('base64') })
            },
          }
        },
        env: clientEnvironment(),
      })
      assert.deepEqual(connectCalls, [{ address: '127.0.0.1', gatePresent: false, port: 43210 }], 'cleanup completes before the client connects')
      assert.equal(sentFrames.length, 1)
      assert.equal(sentFrames[0].toString('utf8'), canonicalJson({ requestBase64: payload.toString('base64'), token }) + '\n', 'the authenticated consume frame is exactly token plus requestBase64')
      assert.equal(outcome.exitCode, 0)
      assert.deepEqual(outcome.stdout, stdoutBytes, 'the controller stdout is replayed unchanged')
      assert.deepEqual(outcome.stderr, stderrBytes)
      assert.deepEqual(readdirSync(root), [], 'zero gate or payload residue remains after the admitted result')
      const postConsumeCleanup = await runClient({ argv: ['--clean-request-residue', root, NONCE_A, 'null', 'null', sha256(payload)], env: clientEnvironment() })
      assert.equal(postConsumeCleanup.exitCode, 1, 'nonnull evidence after consume-and-dispatch is rejected')
      assert.deepEqual(JSON.parse(postConsumeCleanup.stdout.toString('utf8')), { code: 'request-evidence-mismatch', ok: false })
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  test('every public stream and exit mapping is replayed unchanged', async () => {
    for (const exitCode of [0, 1, 2, 3]) {
      const root = canonicalTempRoot()
      try {
        const payload = Buffer.from(`{"case":${exitCode}}\n`, 'utf8')
        stageGate(root, { 'owner.json': ownerRecordBytes(root, NONCE_A, 'reserved'), 'request.json': payload })
        const stdoutBytes = Buffer.from(`stdout-for-${exitCode}\n`, 'utf8')
        const stderrBytes = exitCode === 3 ? Buffer.from('nightshift-init-backlog: internal process failure\n', 'ascii') : Buffer.alloc(0)
        const outcome = await runClient({
          argv: ['--consume-request', root, NONCE_A],
          connect: async () => ({
            end() {},
            async sendFrame(frameBytes) {
              const frame = JSON.parse(frameBytes.toString('utf8'))

              return canonicalLine({ exitCode, ordinal: 1, requestBase64: frame.requestBase64, stderrBase64: stderrBytes.toString('base64'), stdoutBase64: stdoutBytes.toString('base64') })
            },
          }),
          env: clientEnvironment(),
        })
        assert.equal(outcome.exitCode, exitCode)
        assert.deepEqual(outcome.stdout, stdoutBytes)
        assert.deepEqual(outcome.stderr, stderrBytes)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
  })

  test('consume rejects transport-state mismatches before connecting and protocol mutations after', async () => {
    const missingGate = canonicalTempRoot()
    try {
      const absent = await runClient({ argv: ['--consume-request', missingGate, NONCE_A], env: clientEnvironment() })
      assert.equal(absent.exitCode, 1)
      assert.deepEqual(JSON.parse(absent.stdout.toString('utf8')), { code: 'request-invalid-state', ok: false })
    } finally {
      rmSync(missingGate, { force: true, recursive: true })
    }
    const wrongNonce = canonicalTempRoot()
    try {
      stageGate(wrongNonce, { 'owner.json': ownerRecordBytes(wrongNonce, NONCE_A, 'reserved'), 'request.json': Buffer.from('{}\n', 'utf8') })
      const outcome = await runClient({ argv: ['--consume-request', wrongNonce, 'f'.repeat(32)], env: clientEnvironment() })
      assert.equal(outcome.exitCode, 1)
      assert.deepEqual(JSON.parse(outcome.stdout.toString('utf8')), { code: 'request-evidence-mismatch', ok: false })
      assert.equal(existsSync(gatePath(wrongNonce, 'request.json')), true, 'a refused consume mutates nothing')
    } finally {
      rmSync(wrongNonce, { force: true, recursive: true })
    }
    const mutations = [
      (frame, line) => canonicalLine({ ...JSON.parse(line.toString('utf8')), requestBase64: Buffer.from('other', 'utf8').toString('base64') }),
      (frame, line) => {
        const parsed = JSON.parse(line.toString('utf8'))
        delete parsed.stderrBase64

        return canonicalLine(parsed)
      },
      (frame, line) => canonicalLine({ ...JSON.parse(line.toString('utf8')), extra: 1 }),
      (frame, line) => canonicalLine({ ...JSON.parse(line.toString('utf8')), stdoutBase64: 'not*base64' }),
      (frame, line) => canonicalLine({ ...JSON.parse(line.toString('utf8')), exitCode: 1.5 }),
      () => Buffer.from('not json\n', 'utf8'),
    ]
    for (const mutate of mutations) {
      const root = canonicalTempRoot()
      try {
        const payload = Buffer.from('{"m":1}\n', 'utf8')
        stageGate(root, { 'owner.json': ownerRecordBytes(root, NONCE_A, 'reserved'), 'request.json': payload })
        const outcome = await runClient({
          argv: ['--consume-request', root, NONCE_A],
          connect: async () => ({
            end() {},
            async sendFrame(frameBytes) {
              const frame = JSON.parse(frameBytes.toString('utf8'))

              return mutate(frame, canonicalLine({ exitCode: 0, ordinal: 1, requestBase64: frame.requestBase64, stderrBase64: '', stdoutBase64: 'aGk=' }))
            },
          }),
          env: clientEnvironment(),
        })
        assert.equal(outcome.exitCode, 3, 'a mutated result frame fails the caller')
        assert.equal(outcome.stderr.toString('ascii'), 'nightshift-init-backlog: internal process failure\n')
        assert.equal(outcome.stdout.length, 0)
      } finally {
        rmSync(root, { force: true, recursive: true })
      }
    }
    const closedRoot = canonicalTempRoot()
    try {
      stageGate(closedRoot, { 'owner.json': ownerRecordBytes(closedRoot, NONCE_A, 'reserved'), 'request.json': Buffer.from('{}\n', 'utf8') })
      const refused = await runClient({
        argv: ['--consume-request', closedRoot, NONCE_A],
        connect: async () => {
          throw new Error('connection refused after closure')
        },
        env: clientEnvironment(),
      })
      assert.equal(refused.exitCode, 3, 'a client that cannot connect after closure fails its caller')
      assert.equal(refused.stderr.toString('ascii'), 'nightshift-init-backlog: internal process failure\n')
    } finally {
      rmSync(closedRoot, { force: true, recursive: true })
    }
  })

  if (process.argv.includes('--verify-harness-git-isolation')) {
    test('seeded ambient Git configuration cannot reach a harness Git launch', () => {
      const { spawnSync } = require('node:child_process')
      const locator = process.platform === 'win32' ? 'where' : 'which'
      const gitPath = execFileSync(locator, ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim()
      const base = tempRoot('nightshift-git-isolation-')
      try {
        const ambientDir = join(base, 'ambient')
        mkdirSync(ambientDir)
        const evilAttributes = join(ambientDir, 'evil.gitattributes')
        writeFileSync(evilAttributes, '* filter=evil\n')
        const evilConfig = join(ambientDir, 'evil.gitconfig')
        writeFileSync(evilConfig, `[core]\n\tautocrlf = true\n\tattributesFile = ${evilAttributes.split('\\').join('/')}\n[filter "evil"]\n\tclean = evil-clean-must-never-run\n\trequired = true\n`)
        const evilTemplate = join(ambientDir, 'template')
        mkdirSync(join(evilTemplate, 'info'), { recursive: true })
        writeFileSync(join(evilTemplate, 'info', 'attributes'), '* filter=evil\n')
        const runRoot = join(base, 'run')
        mkdirSync(runRoot)
        const isolation = driver.createGitIsolationInputs({ runRoot })
        const environment = driver.buildHarnessGitEnvironment({
          ambientEnvironment: {
            ...process.env,
            GIT_CONFIG_COUNT: '2',
            GIT_CONFIG_GLOBAL: evilConfig,
            GIT_CONFIG_KEY_0: 'core.autocrlf',
            GIT_CONFIG_KEY_1: 'filter.evil.clean',
            GIT_CONFIG_SYSTEM: evilConfig,
            GIT_CONFIG_VALUE_0: 'true',
            GIT_CONFIG_VALUE_1: 'evil-clean-must-never-run',
            GIT_DIR: join(ambientDir, 'redirected.git'),
            GIT_TEMPLATE_DIR: evilTemplate,
          },
          attributesPath: isolation.attributesPath,
          configPath: isolation.configPath,
          platform: process.platform,
          templatePath: isolation.templatePath,
        })
        const scenarioRoot = join(runRoot, 'repo')
        const crlfBytes = Buffer.from('line-one\r\nline-two\r\n', 'utf8')
        const repository = {
          entries: [{ contentBase64: crlfBytes.toString('base64'), kind: 'file', mode: 420, path: 'file.md' }],
          git: { kind: 'git', trackedPaths: ['file.md'] },
        }
        const runGit = (argv) => {
          const result = spawnSync(gitPath, argv, { cwd: scenarioRoot, env: environment, windowsHide: true })

          return { exitCode: result.status, stderr: result.stderr, stdout: result.stdout }
        }
        const outcome = driver.materializeScenario({ platform: process.platform, repository, runGit, scenarioRoot })
        assert.deepEqual(outcome.trackedPaths, ['file.md'], 'tracked-set parsing remains exact under the isolated environment')
        const indexed = spawnSync(gitPath, ['cat-file', 'blob', ':0:file.md'], { cwd: scenarioRoot, env: environment, windowsHide: true })
        assert.equal(indexed.status, 0)
        assert.deepEqual(indexed.stdout, crlfBytes, 'indexed bytes stay exact: the seeded clean filter and autocrlf never ran')
        const configList = spawnSync(gitPath, ['config', '--show-origin', '--list'], { cwd: scenarioRoot, env: environment, windowsHide: true })
        assert.equal(configList.status, 0)
        const configText = configList.stdout.toString('utf8')
        assert.equal(configText.includes('autocrlf'), false, 'the ambient autocrlf seed is invisible to harness Git')
        assert.equal(configText.includes('evil'), false, 'the ambient filter seed is invisible to harness Git')
        const templatedAttributes = join(scenarioRoot, '.git', 'info', 'attributes')
        if (existsSync(templatedAttributes)) {
          assert.equal(readFileSync(templatedAttributes, 'utf8').includes('evil'), false, 'the ambient template info/attributes never reaches init')
        }
        driver.verifyScenarioFileSet({ platform: process.platform, repository, runGit, scenarioRoot })
      } finally {
        rmSync(base, { force: true, recursive: true })
      }
    })
  }
}

module.exports = { runSessionCases }
