'use strict'

const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const processModule = require('../init-backlog-session-driver/process')
const driver = require('../init-backlog-session-driver')
const { canonicalJson } = require('./helpers')
const { trustedWindowsPowerShellPath } = require('../../skills/init-backlog/lib/filesystem')

const onWindows = process.platform === 'win32'
const NUL = String.fromCharCode(0)

function canonicalLine(value) {
  return Buffer.from(canonicalJson(value) + '\n', 'utf8')
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

function fakeChild({ pid = 4321, stdin = true } = {}) {
  const accessLog = []
  const listeners = { close: [], error: [], spawn: [] }
  const streamListeners = { stderrData: [], stdinError: [], stdoutData: [], stdoutEnd: [] }
  const stdinWrites = []
  const kills = []
  const child = {
    kill(signal) {
      kills.push(signal ?? 'SIGTERM')

      return true
    },
    on(name, fn) {
      accessLog.push(`on:${name}`)
      listeners[name].push(fn)

      return child
    },
    get pid() {
      accessLog.push('pid')

      return pid
    },
    stderr: {
      on(name, fn) {
        if (name === 'data') {
          streamListeners.stderrData.push(fn)
        }

        return this
      },
    },
    stdin: stdin ? {
      end() {
        stdinWrites.push(null)
      },
      on(name, fn) {
        accessLog.push(`stdin:on:${name}`)
        if (name === 'error') {
          streamListeners.stdinError.push(fn)
        }

        return this
      },
      write(bytes) {
        stdinWrites.push(Buffer.from(bytes))

        return true
      },
    } : null,
    stdout: {
      on(name, fn) {
        if (name === 'data') {
          streamListeners.stdoutData.push(fn)
        }
        if (name === 'end') {
          streamListeners.stdoutEnd.push(fn)
        }

        return this
      },
    },
  }

  return {
    accessLog,
    child,
    emitClose(code) {
      for (const fn of listeners.close) {
        fn(code)
      }
    },
    emitError(error) {
      for (const fn of listeners.error) {
        fn(error)
      }
    },
    emitSpawn() {
      for (const fn of listeners.spawn) {
        fn()
      }
    },
    emitStdinError(error) {
      for (const fn of streamListeners.stdinError) {
        fn(error)
      }
    },
    endStdout() {
      for (const fn of streamListeners.stdoutEnd) {
        fn()
      }
    },
    kills,
    pushStderr(bytes) {
      for (const fn of streamListeners.stderrData) {
        fn(Buffer.from(bytes))
      }
    },
    pushStdout(bytes) {
      for (const fn of streamListeners.stdoutData) {
        fn(Buffer.from(bytes))
      }
    },
    stdinWrites,
  }
}

const START_PAYLOAD = Object.freeze({
  args: Object.freeze(['--version']),
  environment: Object.freeze({ PATH: 'C:\\bin' }),
  executable: 'C:\\hosts\\claude.exe',
})

function windowsHarness(overrides = {}) {
  const clock = fakeClock()
  const runner = fakeChild(overrides.child)
  const events = { accepted: [], failures: [], started: [], stderr: [], stdout: [] }
  const spawnCalls = []
  const adapter = processModule.createWindowsJobRunnerAdapter({
    clock,
    cwd: overrides.cwd ?? 'C:\\run\\repo',
    mode: overrides.mode ?? 'session',
    onFailure(failure) {
      events.failures.push(failure)
    },
    onHostStderr(bytes) {
      events.stderr.push(Buffer.from(bytes))
    },
    onHostStdout(bytes) {
      events.stdout.push(Buffer.from(bytes))
    },
    onInputAccepted(record) {
      events.accepted.push(record)
    },
    onStarted(record) {
      events.started.push(record)
    },
    powerShellPath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    runnerPath: 'C:\\checkout\\tests\\windows-job-runner.ps1',
    spawn(...spawnArguments) {
      spawnCalls.push(spawnArguments)
      if (overrides.spawnThrows === true) {
        throw new Error('spawn failed synchronously')
      }

      return runner.child
    },
    ...(overrides.limits ?? {}),
  })

  return { adapter, clock, events, runner, spawnCalls }
}

function startedWindowsHarness(overrides = {}) {
  const harness = windowsHarness(overrides)
  assert.equal(harness.adapter.start(START_PAYLOAD).ok, true)
  harness.runner.emitSpawn()
  harness.runner.pushStdout(canonicalLine({ kind: 'started', pid: 777 }))

  return harness
}

function posixHarness(overrides = {}) {
  const clock = fakeClock()
  const child = fakeChild(overrides.child)
  const events = { failures: [], spawned: [] }
  const spawnCalls = []
  const killCalls = []
  const killPlan = overrides.killPlan ?? (() => {})
  const adapter = processModule.createDirectPosixFallbackAdapter({
    clock,
    kill(pid, signal) {
      killCalls.push([pid, signal])
      killPlan(pid, signal, killCalls)
    },
    mode: overrides.mode ?? 'session',
    onFailure(failure) {
      events.failures.push(failure)
    },
    onSpawned(record) {
      events.spawned.push(record)
    },
    spawn(...spawnArguments) {
      spawnCalls.push(spawnArguments)
      if (overrides.spawnThrows === true) {
        throw new Error('spawn failed synchronously')
      }

      return child.child
    },
  })

  return { adapter, child, clock, events, killCalls, spawnCalls }
}

function esrch() {
  const error = new Error('no such process')
  error.code = 'ESRCH'

  return error
}

function eperm() {
  const error = new Error('operation not permitted')
  error.code = 'EPERM'

  return error
}

function runProcessCases(repositoryRoot) {
  const runnerPath = join(repositoryRoot, 'tests', 'windows-job-runner.ps1')

  test('the process module pins its frame grammars, deadline literal, and runner path', () => {
    assert.equal(processModule.RUNNER_CLOSE_MILLISECONDS, 1000)
    assert.equal(driver.RUNNER_CLOSE_MILLISECONDS, 1000)
    assert.deepEqual(processModule.WINDOWS_RUNNER_INPUT_FRAME_KINDS, ['start', 'host-input', 'close-input', 'terminate'])
    assert.deepEqual(processModule.WINDOWS_RUNNER_OUTPUT_FRAME_KINDS, ['start-failed', 'started', 'host-stdout', 'host-stderr', 'input-accepted', 'host-exit', 'job-empty'])
    assert.deepEqual(driver.WINDOWS_RUNNER_INPUT_FRAME_KINDS, processModule.WINDOWS_RUNNER_INPUT_FRAME_KINDS)
    assert.deepEqual(driver.WINDOWS_RUNNER_OUTPUT_FRAME_KINDS, processModule.WINDOWS_RUNNER_OUTPUT_FRAME_KINDS)
    assert.equal(processModule.windowsJobRunnerPath(), runnerPath)
    assert.equal(driver.windowsJobRunnerPath(), runnerPath)
    const runnerSource = readFileSync(runnerPath, 'utf8')
    assert.equal(runnerSource.includes('\r'), false, 'the runner is committed with LF line endings')
    assert.equal(/[^\t\n -~]/.test(runnerSource), false, 'the runner is pure ASCII')
    assert.equal(runnerSource.endsWith('\n'), true)
  })

  test('PID-only taskkill is never invoked by the process layer or the runner', () => {
    const moduleSource = readFileSync(join(repositoryRoot, 'tests', 'init-backlog-session-driver', 'process.js'), 'utf8')
    const runnerSource = readFileSync(runnerPath, 'utf8')
    assert.equal(/taskkill/i.test(moduleSource), false)
    assert.equal(/taskkill/i.test(runnerSource), false)
  })

  test('both adapters expose exactly the five process adapter events as methods', () => {
    const posix = posixHarness().adapter
    const windows = windowsHarness().adapter
    for (const adapter of [posix, windows]) {
      for (const method of ['start', 'input', 'closeInput', 'terminate', 'closureProof']) {
        assert.equal(typeof adapter[method], 'function', `${method} must be a function`)
      }
    }
    assert.deepEqual(driver.PROCESS_ADAPTER_EVENTS, ['start', 'input', 'close-input', 'terminate', 'closure-proof'])
  })

  test('the direct POSIX fallback launches detached with no shell and mode-exact stdio', () => {
    const session = posixHarness({ mode: 'session' })
    assert.equal(session.adapter.start({ args: ['--run'], cwd: '/run/repo', environment: { PATH: '/bin' }, executable: '/hosts/claude' }).ok, true)
    assert.equal(session.spawnCalls.length, 1)
    const [executable, args, options] = session.spawnCalls[0]
    assert.equal(executable, '/hosts/claude')
    assert.deepEqual(args, ['--run'])
    assert.equal(options.detached, true)
    assert.equal(options.shell, false)
    assert.equal(options.cwd, '/run/repo')
    assert.deepEqual(options.env, { PATH: '/bin' })
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe'])
    const preSession = posixHarness({ mode: 'pre-session' })
    assert.equal(preSession.adapter.start({ args: [], cwd: '/run/repo', environment: {}, executable: '/hosts/codex' }).ok, true)
    assert.deepEqual(preSession.spawnCalls[0][2].stdio, ['ignore', 'pipe', 'pipe'])
  })

  test('the POSIX fallback installs error, spawn, and close listeners before touching pid', () => {
    const harness = posixHarness()
    harness.adapter.start({ args: [], cwd: '/run', environment: {}, executable: '/bin/host' })
    harness.child.emitSpawn()
    const firstPidAccess = harness.child.accessLog.indexOf('pid')
    assert.notEqual(firstPidAccess, -1)
    for (const name of ['on:error', 'on:spawn', 'on:close']) {
      const listenerIndex = harness.child.accessLog.indexOf(name)
      assert.notEqual(listenerIndex, -1, `${name} must be installed`)
      assert.ok(listenerIndex < firstPidAccess, `${name} must be installed before pid access`)
    }
    assert.deepEqual(harness.events.spawned, [{ pid: 4321 }])
  })

  test('POSIX spawn-boundary failures classify as spawn with a null initial code', () => {
    const thrown = posixHarness({ spawnThrows: true })
    const outcome = thrown.adapter.start({ args: [], cwd: '/run', environment: {}, executable: '/bin/host' })
    assert.equal(outcome.ok, false)
    assert.deepEqual(thrown.events.failures, [{ detailCode: 'spawn', initialCode: null }])
    const preSpawnError = posixHarness()
    preSpawnError.adapter.start({ args: [], cwd: '/run', environment: {}, executable: '/bin/host' })
    preSpawnError.child.emitError(new Error('launch failed'))
    assert.deepEqual(preSpawnError.events.failures, [{ detailCode: 'spawn', initialCode: null }])
    const invalidPid = posixHarness({ child: { pid: 0 } })
    invalidPid.adapter.start({ args: [], cwd: '/run', environment: {}, executable: '/bin/host' })
    invalidPid.child.emitSpawn()
    assert.deepEqual(invalidPid.events.failures, [{ detailCode: 'spawn', initialCode: null }])
    assert.deepEqual(invalidPid.events.spawned, [])
  })

  test('POSIX termination signals the negative-PID group and proves absence through ESRCH probes', () => {
    const gone = new Set()
    const harness = posixHarness({
      killPlan(pid, signal) {
        if (gone.has(pid)) {
          throw esrch()
        }
        if (pid === -4321 && signal === 'SIGKILL') {
          gone.add(pid)
        }
      },
    })
    harness.adapter.start({ args: [], cwd: '/run', environment: {}, executable: '/bin/host' })
    harness.child.emitSpawn()
    assert.equal(harness.adapter.terminate().ok, true)
    assert.deepEqual(harness.killCalls, [[-4321, 'SIGTERM']])
    assert.equal(harness.clock.timers.length, 1)
    assert.equal(harness.clock.timers[0].milliseconds, 5000, 'the SIGTERM window is exactly 5000 milliseconds')
    harness.clock.fire()
    assert.deepEqual(harness.killCalls, [[-4321, 'SIGTERM'], [-4321, 0], [-4321, 'SIGKILL']], 'the group-absence probe precedes escalation')
    assert.equal(harness.clock.timers[0].milliseconds, 5000, 'the post-SIGKILL absence window is exactly 5000 milliseconds')
    harness.clock.fire()
    assert.deepEqual(harness.killCalls[3], [-4321, 0])
    assert.equal(harness.adapter.groupTerminationProven(), true)
    assert.equal(harness.adapter.retainsRunRoot(), false)
    assert.deepEqual(harness.events.failures, [])
  })

  test('a SIGTERM-window ESRCH probe completes group termination without SIGKILL', () => {
    const harness = posixHarness({
      killPlan(pid, signal) {
        if (signal === 0) {
          throw esrch()
        }
      },
    })
    harness.adapter.start({ args: [], cwd: '/run', environment: {}, executable: '/bin/host' })
    harness.child.emitSpawn()
    harness.adapter.terminate()
    harness.clock.fire()
    assert.deepEqual(harness.killCalls, [[-4321, 'SIGTERM'], [-4321, 0]])
    assert.equal(harness.adapter.groupTerminationProven(), true)
    assert.equal(harness.clock.timers.length, 0, 'a proven group needs no SIGKILL window')
  })

  test('an EPERM probe means the group is still present and unproven expiry retains the root', () => {
    const harness = posixHarness({
      killPlan(pid, signal) {
        if (signal === 0) {
          throw eperm()
        }
      },
    })
    harness.adapter.start({ args: [], cwd: '/run', environment: {}, executable: '/bin/host' })
    harness.child.emitSpawn()
    harness.adapter.terminate()
    harness.clock.fire()
    harness.clock.fire()
    assert.equal(harness.adapter.groupTerminationProven(), false)
    assert.equal(harness.adapter.retainsRunRoot(), true, 'bounded post-SIGKILL absence failure retains the run root')
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
  })

  test('the POSIX fallback can terminate a group but never produces closure proof', () => {
    const harness = posixHarness({
      killPlan(pid, signal) {
        if (signal === 0) {
          throw esrch()
        }
      },
    })
    harness.adapter.start({ args: [], cwd: '/run', environment: {}, executable: '/bin/host' })
    harness.child.emitSpawn()
    harness.adapter.terminate()
    harness.clock.fire()
    assert.equal(harness.adapter.groupTerminationProven(), true)
    const proof = harness.adapter.closureProof()
    assert.equal(proof.proven, false, 'a proven-absent group is still not process-tree proof')
    assert.match(proof.reason, /setsid/, 'the fail-closed reason names the setsid descendant escape')
    const barrier = driver.createFinalizationBarrier({ enabled: false })
    for (const fact of ['host-process-close', 'host-stdout-eof', 'host-stderr-eof']) {
      barrier.satisfy(fact)
    }
    if (harness.adapter.closureProof().proven) {
      barrier.satisfy('host-tree-proof')
    }
    assert.equal(barrier.complete(), false, 'a run supervised by the direct fallback can never complete')
  })

  test('production selection fails closed as containment-unavailable on every non-Windows platform', () => {
    for (const platform of ['linux', 'darwin', 'freebsd', 'aix']) {
      const outcome = processModule.createProductionProcessAdapter({ cwd: '/run/repo', mode: 'session', platform })
      assert.deepEqual(outcome, { detailCode: 'containment-unavailable', ok: false })
    }
    assert.deepEqual(processModule.evaluateLinuxContainment(), { detailCode: 'containment-unavailable', ok: false })
    assert.equal(driver.evaluateLinuxContainment, processModule.evaluateLinuxContainment, 'the facade re-exports the process-module decision point')
  })

  test('production containment rejects caller injection', () => {
    for (const key of ['clock', 'containment', 'kill', 'powerShellPath', 'runnerPath', 'spawn']) {
      assert.throws(() => processModule.createProductionProcessAdapter({ cwd: '/run', mode: 'session', platform: 'linux', [key]: () => {} }), /injection/i, `${key} injection must be rejected`)
      assert.throws(() => processModule.createProductionProcessAdapter({ cwd: 'C:\\run', mode: 'session', platform: 'win32', [key]: () => {} }), /injection/i)
    }
  })

  test('the win32 production branch resolves trusted PowerShell and the canonical runner', { skip: !onWindows }, () => {
    const outcome = processModule.createProductionProcessAdapter({ cwd: repositoryRoot, mode: 'pre-session', platform: 'win32' })
    assert.equal(outcome.ok, true)
    assert.equal(outcome.powerShellPath, trustedWindowsPowerShellPath({ platform: 'win32', root: repositoryRoot }))
    assert.equal(outcome.runnerPath, runnerPath)
    assert.equal(typeof outcome.adapter.start, 'function')
    assert.equal(typeof outcome.adapter.closureProof, 'function')
  })

  test('the Windows adapter launches the runner with the exact brokered argv and options', () => {
    const harness = windowsHarness()
    assert.equal(harness.adapter.start(START_PAYLOAD).ok, true)
    assert.equal(harness.spawnCalls.length, 1)
    const [executable, args, options] = harness.spawnCalls[0]
    assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    assert.deepEqual(args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', 'C:\\checkout\\tests\\windows-job-runner.ps1'])
    assert.equal(options.cwd, 'C:\\run\\repo')
    assert.equal(options.detached, false)
    assert.equal(options.shell, false)
    assert.equal(options.windowsHide, true)
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe'])
    const firstPidAccess = harness.runner.accessLog.indexOf('pid')
    for (const name of ['stdin:on:error', 'on:error', 'on:spawn', 'on:close']) {
      const listenerIndex = harness.runner.accessLog.indexOf(name)
      assert.notEqual(listenerIndex, -1)
      if (firstPidAccess !== -1) {
        assert.ok(listenerIndex < firstPidAccess, `${name} must be installed before pid access`)
      }
    }
    assert.ok(harness.runner.accessLog.indexOf('stdin:on:error') < harness.runner.accessLog.indexOf('on:spawn'), 'stdin errors must be observed before the spawn callback can write')
    assert.deepEqual(harness.runner.stdinWrites, [], 'no start frame is written before spawn confirmation')
    harness.runner.emitSpawn()
    assert.equal(harness.runner.stdinWrites.length, 1)
    assert.deepEqual(harness.runner.stdinWrites[0], canonicalLine({ args: ['--version'], cwd: 'C:\\run\\repo', environment: { PATH: 'C:\\bin' }, executable: 'C:\\hosts\\claude.exe', kind: 'start' }))
  })

  test('an over-bound start frame or duplicate-case environment is a spawn failure before any launch', () => {
    const oversized = windowsHarness()
    const padding = 'x'.repeat(driver.BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES)
    const outcome = oversized.adapter.start({ args: [], environment: { PAD: padding }, executable: 'C:\\hosts\\claude.exe' })
    assert.equal(outcome.ok, false)
    assert.deepEqual(oversized.events.failures, [{ detailCode: 'spawn', initialCode: null }])
    assert.equal(oversized.spawnCalls.length, 0, 'an over-bound start frame never spawns the runner')
    const duplicate = windowsHarness()
    const duplicateOutcome = duplicate.adapter.start({ args: [], environment: { PATH: 'C:\\one', Path: 'C:\\two' }, executable: 'C:\\hosts\\claude.exe' })
    assert.equal(duplicateOutcome.ok, false)
    assert.deepEqual(duplicate.events.failures, [{ detailCode: 'spawn', initialCode: null }])
    assert.equal(duplicate.spawnCalls.length, 0, 'ordinal-case-insensitive duplicate rejection is mandatory at the driver level')
    const thrown = windowsHarness({ spawnThrows: true })
    assert.equal(thrown.adapter.start(START_PAYLOAD).ok, false)
    assert.deepEqual(thrown.events.failures, [{ detailCode: 'spawn', initialCode: null }])
  })

  test('only a valid started frame confirms containment and a mutated one is a termination failure', () => {
    const harness = startedWindowsHarness()
    assert.deepEqual(harness.events.started, [{ pid: 777 }])
    assert.deepEqual(harness.events.failures, [])
    for (const mutated of [
      { kind: 'started' },
      { extra: 1, kind: 'started', pid: 7 },
      { kind: 'started', pid: 0 },
      { kind: 'started', pid: 2.5 },
      { kind: 'started', pid: 7 },
    ]) {
      const rejecting = mutated.pid === 7 && mutated.extra === undefined ? harness : windowsHarness()
      if (rejecting !== harness) {
        rejecting.adapter.start(START_PAYLOAD)
        rejecting.runner.emitSpawn()
      }
      rejecting.runner.pushStdout(canonicalLine(mutated))
      assert.deepEqual(rejecting.events.failures, [{ detailCode: 'termination' }], `mutated started frame must fail: ${canonicalJson(mutated)}`)
    }
  })

  test('inherited output-frame kind names fail through protocol cleanup', () => {
    const harness = startedWindowsHarness()

    assert.doesNotThrow(() => harness.runner.pushStdout(canonicalLine({ kind: '__proto__' })))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
    assert.deepEqual(harness.runner.stdinWrites[1], canonicalLine({ kind: 'terminate' }), 'the malformed frame starts contained cleanup')
    assert.equal(harness.clock.timers.length, 1, 'cleanup arms the job-empty deadline')
    harness.runner.pushStderr(Buffer.from('late'))
    assert.deepEqual(harness.adapter.accounting(), [{ detailCode: 'termination' }], 'later runner failures remain accounting only')
  })

  test('a pre-session command sends close-input immediately after started and a session retains stdin', () => {
    const preSession = windowsHarness({ mode: 'pre-session' })
    preSession.adapter.start(START_PAYLOAD)
    preSession.runner.emitSpawn()
    preSession.runner.pushStdout(canonicalLine({ kind: 'started', pid: 9 }))
    assert.equal(preSession.runner.stdinWrites.length, 2)
    assert.deepEqual(preSession.runner.stdinWrites[1], canonicalLine({ kind: 'close-input' }))
    const session = startedWindowsHarness()
    assert.equal(session.runner.stdinWrites.length, 1, 'a session command sends no automatic close-input')
    const closed = session.adapter.closeInput()
    assert.equal(closed.ok, true)
    assert.deepEqual(session.runner.stdinWrites[1], canonicalLine({ kind: 'close-input' }))
    assert.deepEqual(session.adapter.closeInput(), { alreadyClosed: true, ok: true }, 'the host input is closed exactly once')
    assert.equal(session.runner.stdinWrites.length, 2)
  })

  test('host streams are reconstructed only from ordinal-ordered frames', () => {
    const harness = startedWindowsHarness()
    harness.runner.pushStdout(canonicalLine({ dataBase64: Buffer.from('out-1').toString('base64'), kind: 'host-stdout', ordinal: 1 }))
    harness.runner.pushStdout(canonicalLine({ dataBase64: Buffer.from('err-1').toString('base64'), kind: 'host-stderr', ordinal: 1 }))
    harness.runner.pushStdout(canonicalLine({ dataBase64: Buffer.from('out-2').toString('base64'), kind: 'host-stdout', ordinal: 2 }))
    assert.deepEqual(harness.events.stdout.map((bytes) => bytes.toString('utf8')), ['out-1', 'out-2'])
    assert.deepEqual(harness.events.stderr.map((bytes) => bytes.toString('utf8')), ['err-1'])
    assert.deepEqual(harness.events.failures, [])
    for (const mutated of [
      { dataBase64: 'aGk=', kind: 'host-stdout', ordinal: 4 },
      { dataBase64: 'not*base64', kind: 'host-stdout', ordinal: 3 },
      { dataBase64: 'aGk=', kind: 'host-stdout' },
      { dataBase64: 'aGk=', extra: 1, kind: 'host-stdout', ordinal: 3 },
    ]) {
      const rejecting = startedWindowsHarness()
      rejecting.runner.pushStdout(canonicalLine(mutated))
      assert.deepEqual(rejecting.events.failures, [{ detailCode: 'termination' }], `mutated data frame must fail: ${canonicalJson(mutated)}`)
    }
  })

  test('decoded stream capacity overflows exactly one byte over and triggers termination once', () => {
    const defaults = windowsHarness()
    assert.equal(defaults.adapter.limits().stdoutLimit, driver.BYTE_BOUNDS.MAX_PROCESS_STDOUT_BYTES)
    assert.equal(defaults.adapter.limits().stderrLimit, driver.BYTE_BOUNDS.MAX_PROCESS_STDERR_BYTES)
    const harness = startedWindowsHarness({ limits: { stdoutLimit: 8 } })
    harness.runner.pushStdout(canonicalLine({ dataBase64: Buffer.from('12345678').toString('base64'), kind: 'host-stdout', ordinal: 1 }))
    assert.deepEqual(harness.events.failures, [], 'a stream exactly at its limit is admissible')
    harness.runner.pushStdout(canonicalLine({ dataBase64: Buffer.from('9').toString('base64'), kind: 'host-stdout', ordinal: 2 }))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'output-capacity' }])
    assert.deepEqual(harness.runner.stdinWrites[1], canonicalLine({ kind: 'terminate' }), 'capacity overflow starts termination')
    assert.equal(harness.clock.timers[0].milliseconds, 5000, 'the terminate job-empty deadline is exactly 5000 milliseconds')
    harness.runner.pushStdout(canonicalLine({ dataBase64: Buffer.from('more').toString('base64'), kind: 'host-stdout', ordinal: 3 }))
    assert.equal(harness.events.failures.length, 1, 'later signals are accounting only')
    assert.equal(harness.adapter.accounting().length, 0, 'an already-terminating stream forward is dropped, not re-failed')
  })

  test('a runner frame one byte over the transport bound is rejected before parsing', () => {
    const harness = startedWindowsHarness()
    const exact = Buffer.alloc(driver.BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES, 0x61)
    harness.runner.pushStdout(exact)
    assert.deepEqual(harness.events.failures, [], 'an unterminated accumulation exactly at the bound is still admissible')
    harness.runner.pushStdout(Buffer.from('a'))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'output-capacity' }])
  })

  test('session input frames carry contiguous ordinals and are accepted only by matching acknowledgement', () => {
    const harness = startedWindowsHarness()
    const first = harness.adapter.input(Buffer.from('turn-one\n'))
    assert.deepEqual(first, { ok: true, ordinal: 1 })
    assert.deepEqual(harness.runner.stdinWrites[1], canonicalLine({ dataBase64: Buffer.from('turn-one\n').toString('base64'), kind: 'host-input', ordinal: 1 }))
    assert.deepEqual(harness.events.accepted, [])
    harness.runner.pushStdout(canonicalLine({ kind: 'input-accepted', ordinal: 1 }))
    assert.deepEqual(harness.events.accepted, [{ ordinal: 1 }])
    const second = harness.adapter.input(Buffer.from('turn-two\n'))
    assert.equal(second.ordinal, 2)
    harness.runner.pushStdout(canonicalLine({ kind: 'input-accepted', ordinal: 9 }))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }], 'a mismatched acknowledgement ordinal is malformed')
    const preStarted = windowsHarness()
    preStarted.adapter.start(START_PAYLOAD)
    preStarted.runner.emitSpawn()
    assert.equal(preStarted.adapter.input(Buffer.from('early')).ok, false, 'input before started is refused')
    const preSession = windowsHarness({ mode: 'pre-session' })
    preSession.adapter.start(START_PAYLOAD)
    preSession.runner.emitSpawn()
    preSession.runner.pushStdout(canonicalLine({ kind: 'started', pid: 5 }))
    assert.equal(preSession.adapter.input(Buffer.from('never')).ok, false, 'a pre-session command accepts no input')
  })

  test('an over-bound outgoing input frame is refused without a write', () => {
    const harness = startedWindowsHarness()
    const oversized = Buffer.alloc(driver.BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES, 0x61)
    const outcome = harness.adapter.input(oversized)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.overflow.limitName, 'MAX_RUNNER_FRAME_BYTES')
    assert.equal(harness.runner.stdinWrites.length, 1, 'no over-bound frame reaches the runner')
    assert.deepEqual(harness.adapter.input(Buffer.from('next')), { ok: true, ordinal: 1 }, 'the refused frame does not consume an ordinal')
  })

  test('any runner stderr byte is a termination failure', () => {
    const harness = startedWindowsHarness()
    harness.runner.pushStderr(Buffer.from('x'))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
  })

  test('runner stdout rejects a residual frame at clean EOF', () => {
    const harness = startedWindowsHarness()
    harness.runner.pushStdout(Buffer.from('{"kind":"host-exit"', 'utf8'))
    harness.runner.endStdout()

    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
    assert.equal(harness.adapter.closureProof().proven, false)
  })

  test('natural completion is the exact conjunction and any missing conjunct fails closed', () => {
    const complete = startedWindowsHarness()
    complete.runner.pushStdout(canonicalLine({ dataBase64: Buffer.from('bytes').toString('base64'), kind: 'host-stdout', ordinal: 1 }))
    complete.runner.pushStdout(canonicalLine({ exitCode: 0, kind: 'host-exit' }))
    assert.equal(complete.adapter.closureProof().proven, false)
    complete.runner.pushStdout(canonicalLine({ kind: 'job-empty' }))
    assert.equal(complete.adapter.closureProof().proven, false, 'job-empty alone is not the conjunction')
    complete.runner.endStdout()
    assert.equal(complete.adapter.closureProof().proven, false)
    complete.runner.emitClose(0)
    assert.equal(complete.adapter.closureProof().proven, true)
    assert.equal(complete.adapter.retainsRunRoot(), false)
    assert.deepEqual(complete.events.failures, [])
    const missingJobEmpty = startedWindowsHarness()
    missingJobEmpty.runner.pushStdout(canonicalLine({ exitCode: 0, kind: 'host-exit' }))
    missingJobEmpty.runner.endStdout()
    missingJobEmpty.runner.emitClose(0)
    assert.equal(missingJobEmpty.adapter.closureProof().proven, false, 'active-process-zero proof is required')
    assert.deepEqual(missingJobEmpty.events.failures, [{ detailCode: 'termination' }], 'an exit-zero close missing a terminal frame records the termination failure')
    assert.equal(missingJobEmpty.adapter.retainsRunRoot(), true, 'a missing terminal frame retains the run root')
    const missingHostExit = startedWindowsHarness()
    missingHostExit.runner.endStdout()
    missingHostExit.runner.emitClose(0)
    assert.equal(missingHostExit.adapter.closureProof().proven, false)
    assert.deepEqual(missingHostExit.events.failures, [{ detailCode: 'termination' }], 'an exit-zero close with no terminal frame at all records the termination failure')
    const nonzeroRunner = startedWindowsHarness()
    nonzeroRunner.runner.pushStdout(canonicalLine({ exitCode: 0, kind: 'host-exit' }))
    nonzeroRunner.runner.pushStdout(canonicalLine({ kind: 'job-empty' }))
    nonzeroRunner.runner.endStdout()
    nonzeroRunner.runner.emitClose(3)
    assert.equal(nonzeroRunner.adapter.closureProof().proven, false)
    assert.deepEqual(nonzeroRunner.events.failures, [{ detailCode: 'termination' }], 'a nonzero runner exit is a termination failure')
  })

  test('frame ordering violations are termination failures', () => {
    const beforeStarted = windowsHarness()
    beforeStarted.adapter.start(START_PAYLOAD)
    beforeStarted.runner.emitSpawn()
    beforeStarted.runner.pushStdout(canonicalLine({ exitCode: 0, kind: 'host-exit' }))
    assert.deepEqual(beforeStarted.events.failures, [{ detailCode: 'termination' }], 'host-exit before started is malformed')
    const jobEmptyFirst = startedWindowsHarness()
    jobEmptyFirst.runner.pushStdout(canonicalLine({ kind: 'job-empty' }))
    assert.deepEqual(jobEmptyFirst.events.failures, [{ detailCode: 'termination' }], 'job-empty before host-exit is malformed')
    const afterJobEmpty = startedWindowsHarness()
    afterJobEmpty.runner.pushStdout(canonicalLine({ exitCode: 0, kind: 'host-exit' }))
    afterJobEmpty.runner.pushStdout(canonicalLine({ kind: 'job-empty' }))
    afterJobEmpty.runner.pushStdout(canonicalLine({ dataBase64: 'aGk=', kind: 'host-stdout', ordinal: 1 }))
    assert.deepEqual(afterJobEmpty.events.failures, [{ detailCode: 'termination' }], 'no frame is legal after job-empty')
    const lateStartFailed = startedWindowsHarness()
    lateStartFailed.runner.pushStdout(canonicalLine({ detailCode: 'spawn', kind: 'start-failed' }))
    assert.deepEqual(lateStartFailed.events.failures, [{ detailCode: 'termination' }], 'start-failed is legal only before started')
    const notJson = startedWindowsHarness()
    notJson.runner.pushStdout(Buffer.from('not json\n'))
    assert.deepEqual(notJson.events.failures, [{ detailCode: 'termination' }])
  })

  test('a start-failed spawn frame proves child absence and retains nothing after runner closure', () => {
    const harness = windowsHarness()
    harness.adapter.start(START_PAYLOAD)
    harness.runner.emitSpawn()
    harness.runner.pushStdout(canonicalLine({ detailCode: 'spawn', kind: 'start-failed' }))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'spawn' }])
    harness.runner.endStdout()
    harness.runner.emitClose(0)
    assert.equal(harness.adapter.retainsRunRoot(), false, 'a proved spawn failure retains no run root')
    assert.equal(harness.adapter.closureProof().proven, false, 'a spawn failure never produces a live row')
    assert.deepEqual(harness.runner.kills, [], 'the runner is never force-closed on the spawn branch')
  })

  test('a start-failed termination frame retains the root and forbids force-closing the runner', () => {
    const harness = windowsHarness()
    harness.adapter.start(START_PAYLOAD)
    harness.runner.emitSpawn()
    harness.runner.pushStdout(canonicalLine({ detailCode: 'termination', kind: 'start-failed' }))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
    assert.equal(harness.adapter.retainsRunRoot(), true)
    const terminated = harness.adapter.terminate()
    assert.equal(terminated.ok, false, 'the unproved pre-assignment branch never terminates the runner')
    assert.equal(harness.runner.stdinWrites.length, 1, 'no terminate frame is sent to a retained runner')
    assert.deepEqual(harness.runner.kills, [], 'the retained runner is never force-closed')
    assert.equal(harness.clock.timers.length, 0, 'no forced-close deadline is armed without Job Object containment')
  })

  test('terminate sends one frame, arms the 5000 millisecond job-empty deadline, and proves through job-empty', () => {
    const harness = startedWindowsHarness()
    assert.equal(harness.adapter.terminate().ok, true)
    assert.deepEqual(harness.runner.stdinWrites[1], canonicalLine({ kind: 'terminate' }))
    assert.equal(harness.adapter.terminate().ok, false, 'terminate is sent exactly once')
    assert.equal(harness.runner.stdinWrites.length, 2)
    assert.equal(harness.clock.timers.length, 1)
    assert.equal(harness.clock.timers[0].milliseconds, 5000)
    harness.runner.pushStdout(canonicalLine({ exitCode: 1, kind: 'host-exit' }))
    harness.runner.pushStdout(canonicalLine({ kind: 'job-empty' }))
    harness.runner.endStdout()
    harness.runner.emitClose(0)
    assert.equal(harness.adapter.closureProof().proven, true, 'a terminate completed by job-empty and runner closure is proven')
    assert.equal(harness.adapter.retainsRunRoot(), false)
    assert.deepEqual(harness.runner.kills, [])
  })

  test('job-empty deadline expiry after containment forces runner close without claiming tree proof', () => {
    const harness = startedWindowsHarness()
    harness.adapter.terminate()
    harness.clock.fire()
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
    assert.deepEqual(harness.runner.kills, ['SIGTERM'], 'the runner is closed through its retained ChildProcess handle')
    assert.equal(harness.clock.timers.length, 1)
    assert.equal(harness.clock.timers[0].milliseconds, 1000, 'the runner-close deadline is exactly 1000 milliseconds')
    harness.runner.emitClose(1)
    assert.equal(harness.adapter.closureProof().proven, false, 'a forced close never claims process-tree proof')
    assert.equal(harness.adapter.retainsRunRoot(), true, 'the complete run root is retained')
  })

  test('job-empty deadline expiry before containment never force-closes the runner', () => {
    const harness = windowsHarness()
    harness.adapter.start(START_PAYLOAD)
    harness.runner.emitSpawn()
    harness.adapter.terminate()
    harness.clock.fire()
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
    assert.deepEqual(harness.runner.kills, [], 'no Job Object contains that child, so the runner is never force-closed')
    assert.equal(harness.adapter.retainsRunRoot(), true)
  })

  test('job-empty arms the 5000 millisecond stream-closure deadline whose expiry retains the root', () => {
    const harness = startedWindowsHarness()
    harness.runner.pushStdout(canonicalLine({ exitCode: 0, kind: 'host-exit' }))
    harness.runner.pushStdout(canonicalLine({ kind: 'job-empty' }))
    assert.equal(harness.clock.timers.length, 1)
    assert.equal(harness.clock.timers[0].milliseconds, 5000, 'the stream-closure deadline is exactly 5000 milliseconds')
    harness.clock.fire()
    assert.deepEqual(harness.events.failures, [{ detailCode: 'stream-closure' }])
    assert.equal(harness.adapter.retainsRunRoot(), true)
    const closing = startedWindowsHarness()
    closing.runner.pushStdout(canonicalLine({ exitCode: 0, kind: 'host-exit' }))
    closing.runner.pushStdout(canonicalLine({ kind: 'job-empty' }))
    closing.runner.endStdout()
    closing.runner.emitClose(0)
    assert.equal(closing.clock.timers.length, 0, 'runner closure clears the stream-closure deadline')
    assert.equal(closing.adapter.closureProof().proven, true)
  })

  test('the first failure fixes identity and every later failure is accounting only', () => {
    const harness = startedWindowsHarness()
    harness.runner.pushStdout(Buffer.from('not json\n'))
    harness.runner.pushStderr(Buffer.from('late'))
    harness.runner.emitClose(7)
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
    assert.ok(harness.adapter.accounting().length >= 1, 'later failures are recorded as accounting')
  })

  test('asynchronous runner stdin failures terminate containment and remain once-only', () => {
    const harness = startedWindowsHarness()
    harness.runner.emitStdinError(new Error('EOF'))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
    assert.equal(harness.clock.timers.length, 1)
    harness.runner.emitStdinError(new Error('EPIPE'))
    assert.deepEqual(harness.events.failures, [{ detailCode: 'termination' }])
    assert.ok(harness.adapter.accounting().some((entry) => entry.detailCode === 'termination'))
    harness.clock.fire()
    assert.deepEqual(harness.runner.kills, ['SIGTERM'])
  })

  if (onWindows) {
    const powerShellPath = trustedWindowsPowerShellPath({ platform: 'win32', root: repositoryRoot })

    function runDeterministicRunnerDriver() {
      const scratch = mkdtempSync(join(tmpdir(), 'nightshift-runner-pins-'))
      try {
        const driverPath = join(scratch, 'runner-driver.ps1')
        writeFileSync(driverPath, buildDeterministicDriverSource())
        const result = spawnSync(powerShellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', driverPath, runnerPath], { encoding: 'utf8', windowsHide: true })
        assert.equal(result.status, 0, `runner driver failed: ${result.stderr}`)

        return JSON.parse(result.stdout)
      } finally {
        rmSync(scratch, { force: true, recursive: true })
      }
    }

    let deterministicReport = null
    const report = () => {
      if (deterministicReport === null) {
        deterministicReport = runDeterministicRunnerDriver()
      }

      return deterministicReport
    }

    test('the runner serializes CreateProcessW command lines by the inverse CRT quoting algorithm', () => {
      const commandLines = Object.fromEntries(report().commandLine.map((entry) => [entry.id, entry]))
      const expectations = {
        'backslash-before-quote': { ok: true, value: 'app.exe "' + '\\'.repeat(5) + '"x"' },
        'backslash-run-inside': { ok: true, value: 'app.exe "a\\ b"' },
        'backslash-trailing-quoted': { ok: true, value: 'app.exe "a ' + '\\'.repeat(2) + '"' },
        'backslash-trailing-unquoted': { ok: true, value: 'app.exe ends\\' },
        'compact-json': { ok: true, value: 'app.exe "{\\"type\\":\\"object\\"}"' },
        'embedded-quote': { ok: true, value: 'app.exe "a\\"b"' },
        'empty-element': { ok: true, value: 'app.exe ""' },
        plain: { ok: true, value: 'C:\\tools\\app.exe alpha beta' },
        space: { ok: true, value: 'app.exe "a b"' },
        tab: { ok: true, value: 'app.exe "a\tb"' },
        unicode: { ok: true, value: 'app.exe sm' + String.fromCharCode(0xf6) + 'rg' + String.fromCharCode(0xe5) + 's' },
      }
      for (const [id, expected] of Object.entries(expectations)) {
        assert.ok(commandLines[id], `missing command line case: ${id}`)
        assert.equal(commandLines[id].ok, expected.ok, id)
        assert.equal(commandLines[id].value, expected.value, id)
      }
      assert.deepEqual({ length: commandLines['length-32765'].length, ok: commandLines['length-32765'].ok }, { length: 32765, ok: true })
      assert.deepEqual({ length: commandLines['length-32766'].length, ok: commandLines['length-32766'].ok }, { length: 32766, ok: true })
      assert.equal(commandLines['length-32767'].ok, false, '32767 code units are rejected before CreateProcessW')
      assert.equal(commandLines['nul-argument'].ok, false, 'NUL is rejected independently of length')
      assert.equal(commandLines['nul-executable'].ok, false)
    })

    test('the runner builds sorted custom Unicode environment blocks with exact terminators', () => {
      const blocks = Object.fromEntries(report().environmentBlock.map((entry) => [entry.id, entry]))
      const utf16 = (text) => Buffer.from(text, 'utf16le').toString('base64')
      assert.deepEqual({ base64: blocks.sorted.base64, ok: blocks.sorted.ok }, { base64: utf16('a=1' + NUL + 'B=2' + NUL + NUL), ok: true }, 'items sort by locale-independent ordinal case-insensitive name comparison')
      assert.deepEqual({ base64: blocks.empty.base64, ok: blocks.empty.ok }, { base64: utf16(NUL + NUL), ok: true }, 'an empty object is the non-NULL two-NUL block')
      assert.deepEqual({ base64: blocks['value-equals'].base64, ok: blocks['value-equals'].ok }, { base64: utf16('K=v=w' + NUL + NUL), ok: true })
      for (const id of ['empty-name', 'equals-name', 'nul-name', 'nul-value', 'duplicate-names', 'block-over']) {
        assert.equal(blocks[id].ok, false, `${id} must be rejected`)
      }
      assert.equal(blocks['block-exact'].ok, true, 'a block exactly at 32767 code units including terminators is accepted')
    })

    test('the runner rejects faulted and canceled stream tasks instead of reporting EOF', () => {
      const taskCounts = Object.fromEntries(report().taskCounts.map((entry) => [entry.id, entry]))
      assert.deepEqual(taskCounts.completed, { errorType: null, id: 'completed', ok: true, value: 0 })
      assert.deepEqual(taskCounts.faulted, { errorType: 'System.IO.IOException', id: 'faulted', ok: false, value: null })
      assert.deepEqual(taskCounts.canceled, { errorType: 'System.Threading.Tasks.TaskCanceledException', id: 'canceled', ok: false, value: null })
    })

    test('the runner creates and configures the kill-on-close Job Object before process creation and assigns before resume', () => {
      const scenario = report().scenarios.find((entry) => entry.id === 'success')
      assert.ok(scenario)
      assert.equal(scenario.status, 'started')
      const names = scenario.calls.map((call) => call.name)
      const indexOf = (name) => names.indexOf(name)
      assert.ok(indexOf('CreateJob') !== -1)
      assert.ok(indexOf('CreateJob') < indexOf('ConfigureJobKillOnClose'))
      assert.ok(indexOf('ConfigureJobKillOnClose') < indexOf('CreateSuspendedProcess'), 'the Job Object is configured before process creation')
      assert.ok(indexOf('AssignToJob') < indexOf('Resume'), 'assignment precedes resume')
      const create = scenario.calls.find((call) => call.name === 'CreateSuspendedProcess')
      assert.equal(create.args.applicationName, 'C:\\fake\\app.exe')
      assert.equal(create.args.commandLine, 'C:\\fake\\app.exe one "two words"')
      assert.equal(create.args.workingDirectory, 'C:\\work')
      assert.equal(create.args.creationFlags, 0x4 | 0x400 | 0x80000 | 0x08000000, 'CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT, EXTENDED_STARTUPINFO_PRESENT, and CREATE_NO_WINDOW exactly')
      assert.equal(create.args.environmentBase64, Buffer.from('PATH=C:\\x' + NUL + NUL, 'utf16le').toString('base64'))
      const pipes = scenario.calls.filter((call) => call.name === 'CreateInheritablePipe')
      assert.equal(pipes.length, 3)
      const [stdinPipe, stdoutPipe, stderrPipe] = scenario.pipes
      const clearInherit = scenario.calls.filter((call) => call.name === 'ClearInherit').map((call) => call.args.handle)
      assert.deepEqual(clearInherit.sort((left, right) => left - right), [stdinPipe.writeHandle, stdoutPipe.readHandle, stderrPipe.readHandle].sort((left, right) => left - right), 'HANDLE_FLAG_INHERIT is cleared on exactly the parent-owned ends')
      const attributeList = scenario.calls.find((call) => call.name === 'CreateAttributeListWithHandles')
      assert.deepEqual(attributeList.args.handles, [stdinPipe.readHandle, stdoutPipe.writeHandle, stderrPipe.writeHandle], 'the inherited-handle list carries exactly the three child handles')
      assert.deepEqual([create.args.stdinHandle, create.args.stdoutHandle, create.args.stderrHandle], [stdinPipe.readHandle, stdoutPipe.writeHandle, stderrPipe.writeHandle], 'the standard-handle assignments are exactly the child pipe ends')
      const childCloses = scenario.calls.map((call, index) => ({ call, index })).filter((entry) => entry.call.name === 'CloseHandle' && [stdinPipe.readHandle, stdoutPipe.writeHandle, stderrPipe.writeHandle].includes(entry.call.args.handle))
      assert.equal(childCloses.length, 3, 'the parent closes its copies of all three child-owned handles')
      assert.ok(childCloses.every((entry) => entry.index > indexOf('CreateSuspendedProcess') && entry.index < indexOf('AssignToJob')), 'child-handle copies close after creation and before assignment')
      assert.ok(names.includes('DeleteAttributeList'))
    })

    test('a creation failure closes every created handle and emits no started state', () => {
      for (const id of ['create-failed', 'attribute-list-failed']) {
        const scenario = report().scenarios.find((entry) => entry.id === id)
        assert.ok(scenario, id)
        assert.equal(scenario.status, 'spawn-failed', id)
        assert.equal(scenario.calls.some((call) => call.name === 'Terminate'), false, 'nothing was created to terminate')
        const closed = scenario.calls.filter((call) => call.name === 'CloseHandle').map((call) => call.args.handle)
        for (const pipe of scenario.pipes) {
          assert.ok(closed.includes(pipe.readHandle), `${id} closes both ends of all pipes`)
          assert.ok(closed.includes(pipe.writeHandle), `${id} closes both ends of all pipes`)
        }
        assert.ok(closed.includes(scenario.jobHandle), `${id} closes the Job Object handle`)
      }
    })

    test('a pre-assignment failure terminates the suspended child with exit code 1 and a 5000 millisecond signaled proof', () => {
      const scenario = report().scenarios.find((entry) => entry.id === 'assign-failed')
      assert.equal(scenario.status, 'spawn-failed')
      const terminate = scenario.calls.find((call) => call.name === 'Terminate')
      assert.equal(terminate.args.exitCode, 1, 'TerminateProcess uses exit code 1 exactly')
      assert.equal(terminate.args.handle, scenario.processHandle)
      const wait = scenario.calls.find((call) => call.name === 'WaitForProcess')
      assert.equal(wait.args.milliseconds, 5000, 'the process-signaled deadline is exactly 5000 milliseconds')
      const closed = scenario.calls.filter((call) => call.name === 'CloseHandle').map((call) => call.args.handle)
      assert.ok(closed.includes(scenario.processHandle))
      assert.ok(closed.includes(scenario.threadHandle))
      assert.ok(closed.includes(scenario.jobHandle))
    })

    test('unproved termination retains every child-containment handle', () => {
      for (const id of ['terminate-unproven', 'wait-unproven']) {
        const scenario = report().scenarios.find((entry) => entry.id === id)
        assert.equal(scenario.status, 'termination-unproven', id)
        const closed = scenario.calls.filter((call) => call.name === 'CloseHandle').map((call) => call.args.handle)
        assert.equal(closed.includes(scenario.processHandle), false, `${id} retains the process handle`)
        assert.equal(closed.includes(scenario.jobHandle), false, `${id} retains the Job Object handle`)
      }
    })

    test('a resume failure after assignment is owned by Job Object termination', () => {
      const scenario = report().scenarios.find((entry) => entry.id === 'resume-failed')
      assert.equal(scenario.status, 'spawn-failed')
      assert.ok(scenario.calls.some((call) => call.name === 'TerminateJob'), 'after confirmed assignment Job Object termination owns the failure')
      assert.equal(scenario.calls.some((call) => call.name === 'Terminate'), false, 'no bare TerminateProcess after assignment')
    })

    function liveAdapter({ cwd, mode }) {
      const events = { accepted: [], failures: [], started: [], stderr: [], stdout: [] }
      const adapter = processModule.createWindowsJobRunnerAdapter({
        cwd,
        mode,
        onFailure(failure) {
          events.failures.push(failure)
        },
        onHostStderr(bytes) {
          events.stderr.push(Buffer.from(bytes))
        },
        onHostStdout(bytes) {
          events.stdout.push(Buffer.from(bytes))
        },
        onInputAccepted(record) {
          events.accepted.push(record)
        },
        onStarted(record) {
          events.started.push(record)
        },
        powerShellPath,
        runnerPath,
      })

      return { adapter, events }
    }

    async function waitFor(predicate, description, milliseconds = 30000) {
      const deadline = Date.now() + milliseconds
      while (!predicate()) {
        if (Date.now() > deadline) {
          throw new Error(`timed out waiting for ${description}`)
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50))
      }
    }

    const comSpec = process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe'

    test('the live runner completes a pre-session command with the full natural conjunction', async () => {
      const scratch = mkdtempSync(join(tmpdir(), 'nightshift-runner-live-'))
      const { adapter, events } = liveAdapter({ cwd: scratch, mode: 'pre-session' })
      try {
        assert.equal(adapter.start({ args: ['/d', '/s', '/c', 'echo nightshift-runner-live'], environment: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }, executable: comSpec }).ok, true)
        await waitFor(() => adapter.closureProof().proven || events.failures.length > 0, 'natural completion')
        assert.deepEqual(events.failures, [])
        assert.equal(events.started.length, 1)
        assert.ok(Number.isSafeInteger(events.started[0].pid) && events.started[0].pid > 0)
        assert.match(Buffer.concat(events.stdout).toString('utf8'), /nightshift-runner-live/)
        assert.equal(adapter.closureProof().proven, true)
        assert.equal(adapter.retainsRunRoot(), false)
      } finally {
        adapter.dispose()
        rmSync(scratch, { force: true, recursive: true })
      }
    })

    test('the live runner accepts session input, acknowledges it, and echoes it back', async () => {
      const scratch = mkdtempSync(join(tmpdir(), 'nightshift-runner-live-'))
      const { adapter, events } = liveAdapter({ cwd: scratch, mode: 'session' })
      try {
        assert.equal(adapter.start({ args: ['/d', '/s', '/c', 'findstr', '.'], environment: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }, executable: comSpec }).ok, true)
        await waitFor(() => events.started.length === 1, 'the started frame')
        const written = adapter.input(Buffer.from('nightshift-live-input\r\n'))
        assert.equal(written.ok, true)
        await waitFor(() => events.accepted.length === 1, 'the input acknowledgement')
        assert.deepEqual(events.accepted, [{ ordinal: 1 }])
        assert.equal(adapter.closeInput().ok, true)
        await waitFor(() => adapter.closureProof().proven || events.failures.length > 0, 'session completion')
        assert.deepEqual(events.failures, [])
        assert.match(Buffer.concat(events.stdout).toString('utf8'), /nightshift-live-input/)
        assert.equal(adapter.closureProof().proven, true)
      } finally {
        adapter.dispose()
        rmSync(scratch, { force: true, recursive: true })
      }
    })

    test('the live runner terminates a hung child through the Job Object and proves job-empty', async () => {
      const scratch = mkdtempSync(join(tmpdir(), 'nightshift-runner-live-'))
      const { adapter, events } = liveAdapter({ cwd: scratch, mode: 'pre-session' })
      try {
        assert.equal(adapter.start({ args: ['/d', '/s', '/c', 'ping', '-n', '60', '127.0.0.1'], environment: { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }, executable: comSpec }).ok, true)
        await waitFor(() => events.started.length === 1 && events.stdout.length > 0, 'the child to produce output')
        const childPid = events.started[0].pid
        assert.equal(adapter.terminate().ok, true)
        await waitFor(() => adapter.closureProof().proven || events.failures.length > 0, 'terminate completion', 15000)
        assert.deepEqual(events.failures, [])
        assert.equal(adapter.closureProof().proven, true, 'job-empty plus runner closure proves the terminate path')
        assert.throws(() => process.kill(childPid, 0), 'the contained child is gone after job termination')
      } finally {
        adapter.dispose()
        rmSync(scratch, { force: true, recursive: true })
      }
    })

    test('the live runner reports a start-failed spawn frame for a missing executable and closes', async () => {
      const scratch = mkdtempSync(join(tmpdir(), 'nightshift-runner-live-'))
      const { adapter, events } = liveAdapter({ cwd: scratch, mode: 'pre-session' })
      try {
        assert.equal(adapter.start({ args: [], environment: {}, executable: 'C:\\nightshift-does-not-exist\\missing.exe' }).ok, true)
        await waitFor(() => events.failures.length > 0, 'the start-failed frame')
        assert.deepEqual(events.failures, [{ detailCode: 'spawn' }])
        await waitFor(() => adapter.runnerClosed(), 'runner closure')
        assert.equal(adapter.retainsRunRoot(), false, 'a proved spawn failure retains nothing')
      } finally {
        adapter.dispose()
        rmSync(scratch, { force: true, recursive: true })
      }
    })
  }
}

function buildDeterministicDriverSource() {
  const lines = [
    'param([string]$RunnerPath)',
    "$ErrorActionPreference = 'Stop'",
    '. $RunnerPath',
    '',
    'function Invoke-CommandLineCase([string]$Id, [string[]]$Elements) {',
    '    try {',
    '        $value = ConvertTo-RunnerCommandLine $Elements',
    '        return @{ id = $Id; ok = $true; value = $value; length = $value.Length }',
    '    } catch {',
    '        return @{ id = $Id; ok = $false; value = $null; length = $null }',
    '    }',
    '}',
    '',
    'function Invoke-EnvironmentCase([string]$Id, $Pairs) {',
    '    try {',
    '        $block = ConvertTo-RunnerEnvironmentBlock $Pairs',
    '        $bytes = [System.Text.Encoding]::Unicode.GetBytes($block)',
    '        return @{ id = $Id; ok = $true; base64 = [Convert]::ToBase64String($bytes) }',
    '    } catch {',
    '        return @{ id = $Id; ok = $false; base64 = $null }',
    '    }',
    '}',
    '',
    'function New-EnvironmentPair([string]$Name, [string]$Value) {',
    '    return New-Object psobject -Property @{ Name = $Name; Value = $Value }',
    '}',
    '',
    'function Invoke-TaskCountCase([string]$Id, $Task) {',
    '    try {',
    '        return @{ errorType = $null; id = $Id; ok = $true; value = (Read-RunnerTaskCount $Task) }',
    '    } catch {',
    '        return @{ errorType = $_.Exception.GetType().FullName; id = $Id; ok = $false; value = $null }',
    '    }',
    '}',
    '',
    'function New-FakeInterop([string[]]$Failures) {',
    '    $interop = New-Object psobject',
    '    Add-Member -InputObject $interop -MemberType NoteProperty -Name Calls -Value (New-Object System.Collections.ArrayList)',
    '    Add-Member -InputObject $interop -MemberType NoteProperty -Name Failures -Value $Failures',
    '    Add-Member -InputObject $interop -MemberType NoteProperty -Name NextHandle -Value ([long]100)',
    '    Add-Member -InputObject $interop -MemberType NoteProperty -Name CreatedProcessHandle -Value $null',
    '    Add-Member -InputObject $interop -MemberType NoteProperty -Name CreatedThreadHandle -Value $null',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name TakeHandle -Value {',
    '        $handle = $this.NextHandle',
    '        $this.NextHandle = $this.NextHandle + 1',
    '        return [long]$handle',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name Record -Value {',
    '        param($Name, $Arguments)',
    '        [void]$this.Calls.Add(@{ name = $Name; args = $Arguments })',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name CreateJob -Value {',
    '        $this.Record(\'CreateJob\', @{})',
    "        if ($this.Failures -contains 'CreateJob') { return [long]0 }",
    '        return $this.TakeHandle()',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name ConfigureJobKillOnClose -Value {',
    '        param([long]$Job)',
    '        $this.Record(\'ConfigureJobKillOnClose\', @{ handle = $Job })',
    "        return -not ($this.Failures -contains 'ConfigureJobKillOnClose')",
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name CreateInheritablePipe -Value {',
    '        $read = $this.TakeHandle()',
    '        $write = $this.TakeHandle()',
    '        $this.Record(\'CreateInheritablePipe\', @{ readHandle = $read; writeHandle = $write })',
    '        return New-Object psobject -Property @{ ReadHandle = $read; WriteHandle = $write }',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name ClearInherit -Value {',
    '        param([long]$Handle)',
    '        $this.Record(\'ClearInherit\', @{ handle = $Handle })',
    '        return $true',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name CreateAttributeListWithHandles -Value {',
    '        param([long]$First, [long]$Second, [long]$Third)',
    '        $this.Record(\'CreateAttributeListWithHandles\', @{ handles = @($First, $Second, $Third) })',
    "        if ($this.Failures -contains 'CreateAttributeListWithHandles') { return [long]0 }",
    '        return $this.TakeHandle()',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name DeleteAttributeList -Value {',
    '        param([long]$List)',
    '        $this.Record(\'DeleteAttributeList\', @{ handle = $List })',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name CreateSuspendedProcess -Value {',
    '        param([string]$ApplicationName, [string]$CommandLine, [string]$EnvironmentBlock, [string]$WorkingDirectory, [long]$StdinHandle, [long]$StdoutHandle, [long]$StderrHandle, [long]$AttributeList, [long]$CreationFlags)',
    '        $environmentBase64 = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($EnvironmentBlock))',
    '        $this.Record(\'CreateSuspendedProcess\', @{ applicationName = $ApplicationName; commandLine = $CommandLine; environmentBase64 = $environmentBase64; workingDirectory = $WorkingDirectory; stdinHandle = $StdinHandle; stdoutHandle = $StdoutHandle; stderrHandle = $StderrHandle; attributeList = $AttributeList; creationFlags = $CreationFlags })',
    "        if ($this.Failures -contains 'CreateSuspendedProcess') { return $null }",
    '        $process = $this.TakeHandle()',
    '        $thread = $this.TakeHandle()',
    '        $this.CreatedProcessHandle = $process',
    '        $this.CreatedThreadHandle = $thread',
    '        return New-Object psobject -Property @{ ProcessHandle = $process; ThreadHandle = $thread; ProcessId = [long]5150 }',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name AssignToJob -Value {',
    '        param([long]$Job, [long]$Process)',
    '        $this.Record(\'AssignToJob\', @{ jobHandle = $Job; processHandle = $Process })',
    "        return -not ($this.Failures -contains 'AssignToJob')",
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name Resume -Value {',
    '        param([long]$Thread)',
    '        $this.Record(\'Resume\', @{ handle = $Thread })',
    "        if ($this.Failures -contains 'Resume') { return [long](-1) }",
    '        return [long]1',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name Terminate -Value {',
    '        param([long]$Process, [long]$ExitCode)',
    '        $this.Record(\'Terminate\', @{ handle = $Process; exitCode = $ExitCode })',
    "        return -not ($this.Failures -contains 'Terminate')",
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name WaitForProcess -Value {',
    '        param([long]$Process, [long]$Milliseconds)',
    '        $this.Record(\'WaitForProcess\', @{ handle = $Process; milliseconds = $Milliseconds })',
    "        if ($this.Failures -contains 'WaitForProcess') { return [long]258 }",
    '        return [long]0',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name TerminateJob -Value {',
    '        param([long]$Job, [long]$ExitCode)',
    '        $this.Record(\'TerminateJob\', @{ handle = $Job; exitCode = $ExitCode })',
    '        return $true',
    '    }',
    '    Add-Member -InputObject $interop -MemberType ScriptMethod -Name CloseHandle64 -Value {',
    '        param([long]$Handle)',
    '        $this.Record(\'CloseHandle\', @{ handle = $Handle })',
    '        return $true',
    '    }',
    '    return $interop',
    '}',
    '',
    'function Invoke-Scenario([string]$Id, [string[]]$Failures) {',
    '    $interop = New-FakeInterop $Failures',
    '    $pairs = @((New-EnvironmentPair \'PATH\' \'C:\\x\'))',
    "    $outcome = Start-RunnerChild -Interop $interop -Executable 'C:\\fake\\app.exe' -ArgumentList @('one', 'two words') -EnvironmentPairs $pairs -WorkingDirectory 'C:\\work'",
    '    $pipes = @()',
    '    foreach ($call in $interop.Calls) {',
    "        if ($call.name -eq 'CreateInheritablePipe') {",
    '            $pipes += @{ readHandle = $call.args.readHandle; writeHandle = $call.args.writeHandle }',
    '        }',
    '    }',
    '    $jobHandle = $null',
    "    $jobCall = @($interop.Calls | Where-Object { $_.name -eq 'ConfigureJobKillOnClose' })",
    '    if ($jobCall.Count -gt 0) { $jobHandle = $jobCall[0].args.handle }',
    '    return @{ id = $Id; status = $outcome.Status; calls = @($interop.Calls); pipes = $pipes; processHandle = $interop.CreatedProcessHandle; threadHandle = $interop.CreatedThreadHandle; jobHandle = $jobHandle }',
    '}',
    '',
    '$commandLineCases = @()',
    "$commandLineCases += Invoke-CommandLineCase 'plain' @('C:\\tools\\app.exe', 'alpha', 'beta')",
    "$commandLineCases += Invoke-CommandLineCase 'empty-element' @('app.exe', '')",
    "$commandLineCases += Invoke-CommandLineCase 'space' @('app.exe', 'a b')",
    '$commandLineCases += Invoke-CommandLineCase \'tab\' @(\'app.exe\', ("a" + [char]9 + "b"))',
    '$commandLineCases += Invoke-CommandLineCase \'embedded-quote\' @(\'app.exe\', \'a"b\')',
    '$commandLineCases += Invoke-CommandLineCase \'compact-json\' @(\'app.exe\', \'{"type":"object"}\')',
    "$commandLineCases += Invoke-CommandLineCase 'backslash-trailing-unquoted' @('app.exe', 'ends\\')",
    "$commandLineCases += Invoke-CommandLineCase 'backslash-trailing-quoted' @('app.exe', 'a \\')",
    '$commandLineCases += Invoke-CommandLineCase \'backslash-before-quote\' @(\'app.exe\', (\'\\\\"x\'))',
    "$commandLineCases += Invoke-CommandLineCase 'backslash-run-inside' @('app.exe', 'a\\ b')",
    '$commandLineCases += Invoke-CommandLineCase \'unicode\' @(\'app.exe\', ("sm" + [char]0xf6 + "rg" + [char]0xe5 + "s"))',
    "$commandLineCases += Invoke-CommandLineCase 'length-32765' @('C:\\a.exe', ('x' * 32756))",
    "$commandLineCases += Invoke-CommandLineCase 'length-32766' @('C:\\a.exe', ('x' * 32757))",
    "$commandLineCases += Invoke-CommandLineCase 'length-32767' @('C:\\a.exe', ('x' * 32758))",
    '$commandLineCases += Invoke-CommandLineCase \'nul-argument\' @(\'app.exe\', ("a" + [char]0 + "b"))',
    '$commandLineCases += Invoke-CommandLineCase \'nul-executable\' @(("app" + [char]0 + ".exe"), \'a\')',
    '',
    '$environmentCases = @()',
    "$environmentCases += Invoke-EnvironmentCase 'sorted' @((New-EnvironmentPair 'B' '2'), (New-EnvironmentPair 'a' '1'))",
    "$environmentCases += Invoke-EnvironmentCase 'empty' @()",
    "$environmentCases += Invoke-EnvironmentCase 'value-equals' @((New-EnvironmentPair 'K' 'v=w'))",
    "$environmentCases += Invoke-EnvironmentCase 'empty-name' @((New-EnvironmentPair '' 'v'))",
    "$environmentCases += Invoke-EnvironmentCase 'equals-name' @((New-EnvironmentPair 'A=B' 'v'))",
    '$environmentCases += Invoke-EnvironmentCase \'nul-name\' @((New-EnvironmentPair ("A" + [char]0) \'v\'))',
    '$environmentCases += Invoke-EnvironmentCase \'nul-value\' @((New-EnvironmentPair \'A\' ("v" + [char]0)))',
    "$environmentCases += Invoke-EnvironmentCase 'duplicate-names' @((New-EnvironmentPair 'Path' 'a'), (New-EnvironmentPair 'PATH' 'b'))",
    "$environmentCases += Invoke-EnvironmentCase 'block-exact' @((New-EnvironmentPair 'N' ('v' * 32763)))",
    "$environmentCases += Invoke-EnvironmentCase 'block-over' @((New-EnvironmentPair 'N' ('v' * 32764)))",
    '',
    "$completedTask = New-Object 'System.Threading.Tasks.TaskCompletionSource[int]'",
    '$completedTask.SetResult(0)',
    "$faultedTask = New-Object 'System.Threading.Tasks.TaskCompletionSource[int]'",
    "$faultedTask.SetException((New-Object System.IO.IOException -ArgumentList 'stream failed'))",
    "$canceledTask = New-Object 'System.Threading.Tasks.TaskCompletionSource[int]'",
    '$canceledTask.SetCanceled()',
    '$taskCountCases = @()',
    "$taskCountCases += Invoke-TaskCountCase 'completed' $completedTask.Task",
    "$taskCountCases += Invoke-TaskCountCase 'faulted' $faultedTask.Task",
    "$taskCountCases += Invoke-TaskCountCase 'canceled' $canceledTask.Task",
    '',
    '$scenarios = @()',
    "$scenarios += Invoke-Scenario 'success' @()",
    "$scenarios += Invoke-Scenario 'create-failed' @('CreateSuspendedProcess')",
    "$scenarios += Invoke-Scenario 'attribute-list-failed' @('CreateAttributeListWithHandles')",
    "$scenarios += Invoke-Scenario 'assign-failed' @('AssignToJob')",
    "$scenarios += Invoke-Scenario 'terminate-unproven' @('AssignToJob', 'Terminate')",
    "$scenarios += Invoke-Scenario 'wait-unproven' @('AssignToJob', 'WaitForProcess')",
    "$scenarios += Invoke-Scenario 'resume-failed' @('Resume')",
    '',
    '$reportDocument = @{ commandLine = $commandLineCases; environmentBlock = $environmentCases; scenarios = $scenarios; taskCounts = $taskCountCases }',
    '[Console]::Out.Write((ConvertTo-Json -InputObject $reportDocument -Depth 8 -Compress))',
    '',
  ]

  return lines.join('\n')
}

module.exports = { runProcessCases }
