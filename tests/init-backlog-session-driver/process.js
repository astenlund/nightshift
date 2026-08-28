'use strict'

const { spawn: nodeSpawn } = require('node:child_process')
const { join } = require('node:path')

const { BYTE_BOUNDS, DEADLINES, createByteBudget, createLaunchState, createLineDecoder } = require('./state')
const { canonicalJsonLine } = require('./transcript')

const RUNNER_CLOSE_MILLISECONDS = 1000

const WINDOWS_RUNNER_INPUT_FRAME_KINDS = Object.freeze(['start', 'host-input', 'close-input', 'terminate'])

const WINDOWS_RUNNER_OUTPUT_FRAME_KINDS = Object.freeze(['start-failed', 'started', 'host-stdout', 'host-stderr', 'input-accepted', 'host-exit', 'job-empty'])

const WINDOWS_RUNNER_ARGV_PREFIX = Object.freeze(['-NoLogo', '-NoProfile', '-NonInteractive', '-File'])

const OUTPUT_FRAME_MEMBERS = Object.freeze({
  'host-exit': Object.freeze(['exitCode', 'kind']),
  'host-stderr': Object.freeze(['dataBase64', 'kind', 'ordinal']),
  'host-stdout': Object.freeze(['dataBase64', 'kind', 'ordinal']),
  'input-accepted': Object.freeze(['kind', 'ordinal']),
  'job-empty': Object.freeze(['kind']),
  'start-failed': Object.freeze(['detailCode', 'kind']),
  started: Object.freeze(['kind', 'pid']),
})

const ADAPTER_MODES = Object.freeze(['session', 'pre-session'])

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

function realClock() {
  return {
    clearTimeout(handle) {
      clearTimeout(handle)
    },
    setTimeout(fn, milliseconds) {
      return setTimeout(fn, milliseconds)
    },
  }
}

function requireMode(mode) {
  if (!ADAPTER_MODES.includes(mode)) {
    throw new Error(`process adapter mode is not closed: ${mode}`)
  }

  return mode
}

function evaluateLinuxContainment() {
  return { detailCode: 'containment-unavailable', ok: false }
}

function windowsJobRunnerPath() {
  return join(__dirname, '..', 'windows-job-runner.ps1')
}

function decodeStrictBase64(text) {
  if (typeof text !== 'string' || !BASE64_PATTERN.test(text)) {
    return null
  }

  return Buffer.from(text, 'base64')
}

function createDirectPosixFallbackAdapter({ clock = realClock(), kill = (pid, signal) => process.kill(pid, signal), mode, onFailure = () => {}, onSpawned = () => {}, spawn = nodeSpawn }) {
  requireMode(mode)
  const launch = createLaunchState()
  let child = null
  let pid = null
  let terminateStarted = false
  let groupAbsent = false
  let terminationUnproven = false

  const recordLaunchFailure = () => {
    const classification = launch.classifyError()
    if (classification.accounting !== true) {
      onFailure(classification)
    }
  }

  const probeGroupAbsent = () => {
    try {
      kill(-pid, 0)

      return false
    } catch (error) {
      return error.code === 'ESRCH'
    }
  }

  const signalGroup = (signal) => {
    try {
      kill(-pid, signal)

      return { delivered: true }
    } catch (error) {
      if (error.code === 'ESRCH') {
        groupAbsent = true

        return { delivered: false }
      }
      terminationUnproven = true
      onFailure({ detailCode: 'termination' })

      return { delivered: false, failed: true }
    }
  }

  return {
    closeInput() {
      if (mode === 'session' && child !== null && child.stdin !== null) {
        child.stdin.end()

        return { ok: true }
      }

      return { ok: false }
    },
    closureProof() {
      return { proven: false, reason: 'a setsid descendant can escape the process group, so group absence is never process-tree proof' }
    },
    groupTerminationProven() {
      return groupAbsent
    },
    hostExitCode() {
      return null
    },
    input(bytes) {
      if (mode !== 'session' || launch.state() !== 'spawned' || child === null || child.stdin === null) {
        return { ok: false }
      }
      child.stdin.write(bytes)

      return { ok: true }
    },
    retainsRunRoot() {
      return terminationUnproven
    },
    start({ args, cwd, environment, executable }) {
      if (launch.state() !== 'pre-spawn') {
        throw new Error('the direct POSIX fallback launches exactly once')
      }
      let spawned
      try {
        spawned = spawn(executable, args, {
          cwd,
          detached: true,
          env: environment,
          shell: false,
          stdio: mode === 'session' ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        })
      } catch {
        // The synchronous spawn boundary maps to the universal spawn classification below.
        recordLaunchFailure()

        return { ok: false }
      }
      child = spawned
      child.on('error', () => {
        recordLaunchFailure()
      })
      child.on('spawn', () => {
        const record = launch.recordSpawn(child.pid)
        if (record.ok !== true) {
          recordLaunchFailure()

          return
        }
        pid = child.pid
        onSpawned({ pid })
      })
      child.on('close', () => {})

      return { ok: true }
    },
    terminate() {
      if (launch.state() !== 'spawned' || terminateStarted) {
        return { ok: false }
      }
      terminateStarted = true
      const term = signalGroup('SIGTERM')
      if (groupAbsent || term.failed === true) {
        return { ok: true }
      }
      clock.setTimeout(() => {
        if (probeGroupAbsent()) {
          groupAbsent = true

          return
        }
        const escalation = signalGroup('SIGKILL')
        if (groupAbsent || escalation.failed === true) {
          return
        }
        clock.setTimeout(() => {
          if (probeGroupAbsent()) {
            groupAbsent = true

            return
          }
          terminationUnproven = true
          onFailure({ detailCode: 'termination' })
        }, DEADLINES.NATURAL_CLOSURE_MILLISECONDS)
      }, DEADLINES.NATURAL_CLOSURE_MILLISECONDS)

      return { ok: true }
    },
  }
}

function createWindowsJobRunnerAdapter({
  clock = realClock(),
  cwd,
  mode,
  onFailure = () => {},
  onHostStderr = () => {},
  onHostStdout = () => {},
  onInputAccepted = () => {},
  onStarted = () => {},
  powerShellPath,
  runnerPath,
  spawn = nodeSpawn,
  stderrLimit = BYTE_BOUNDS.MAX_PROCESS_STDERR_BYTES,
  stdoutLimit = BYTE_BOUNDS.MAX_PROCESS_STDOUT_BYTES,
}) {
  requireMode(mode)
  if (typeof cwd !== 'string' || typeof powerShellPath !== 'string' || typeof runnerPath !== 'string') {
    throw new Error('the Windows runner adapter requires cwd, powerShellPath, and runnerPath')
  }
  const launch = createLaunchState()
  const accounting = []
  const budgets = {
    'host-stderr': createByteBudget({ limit: stderrLimit, limitName: 'MAX_PROCESS_STDERR_BYTES' }),
    'host-stdout': createByteBudget({ limit: stdoutLimit, limitName: 'MAX_PROCESS_STDOUT_BYTES' }),
  }
  const forward = { 'host-stderr': onHostStderr, 'host-stdout': onHostStdout }
  const nextDataOrdinal = { 'host-stderr': 1, 'host-stdout': 1 }
  const pendingInputOrdinals = []
  let child = null
  let primaryFailure = null
  let startedSeen = false
  let startFailed = null
  let hostExitCode = null
  let jobEmpty = false
  let runnerClosed = false
  let runnerExitCode = null
  let runnerStdoutEof = false
  let terminateSent = false
  let closeInputSent = false
  let forcedClose = false
  let nextInputOrdinal = 1
  let jobEmptyTimer = null
  let runnerCloseTimer = null
  let streamClosureTimer = null
  let disposed = false

  const recordFailure = (failure) => {
    if (primaryFailure !== null) {
      accounting.push(failure)

      return
    }
    primaryFailure = failure
    onFailure(failure)
  }

  const clearTimer = (handle) => {
    if (handle !== null) {
      clock.clearTimeout(handle)
    }

    return null
  }

  const writeFrameLine = (line) => {
    try {
      child.stdin.write(line)

      return true
    } catch {
      // A broken runner stdin means the runner side of the protocol is gone.
      recordFailure({ detailCode: 'termination' })

      return false
    }
  }

  const writeFrame = (frame) => writeFrameLine(canonicalJsonLine(frame))

  const naturalConjunction = () => startedSeen && hostExitCode !== null && jobEmpty && runnerStdoutEof && runnerClosed && runnerExitCode === 0 && !forcedClose && primaryFailure === null

  const maybeSettleStreamClosure = () => {
    if (jobEmpty && runnerClosed && runnerStdoutEof) {
      streamClosureTimer = clearTimer(streamClosureTimer)
    }
  }

  const startTermination = () => {
    if (terminateSent || startFailed === 'termination' || launch.state() === 'pre-spawn' || runnerClosed) {
      return { ok: false }
    }
    terminateSent = true
    if (!writeFrame({ kind: 'terminate' })) {
      return { ok: false }
    }
    jobEmptyTimer = clock.setTimeout(() => {
      jobEmptyTimer = null
      if (jobEmpty && runnerClosed) {
        return
      }
      recordFailure({ detailCode: 'termination' })
      if (!startedSeen) {
        return
      }
      forcedClose = true
      child.kill()
      runnerCloseTimer = clock.setTimeout(() => {
        runnerCloseTimer = null
      }, RUNNER_CLOSE_MILLISECONDS)
    }, DEADLINES.NATURAL_CLOSURE_MILLISECONDS)

    return { ok: true }
  }

  const protocolFailure = () => {
    recordFailure({ detailCode: 'termination' })
    startTermination()
  }

  const handleFrame = (lineBuffer) => {
    if (primaryFailure !== null) {
      return
    }
    let frame
    try {
      frame = JSON.parse(lineBuffer.toString('utf8'))
    } catch {
      // A non-JSON runner line is a malformed frame under the closed grammar.
      protocolFailure()

      return
    }
    if (frame === null || typeof frame !== 'object' || Array.isArray(frame)) {
      protocolFailure()

      return
    }
    const members = OUTPUT_FRAME_MEMBERS[frame.kind]
    if (members === undefined || Object.keys(frame).sort().join(',') !== members.join(',')) {
      protocolFailure()

      return
    }
    if (jobEmpty) {
      protocolFailure()

      return
    }
    switch (frame.kind) {
      case 'started': {
        if (startedSeen || startFailed !== null || !Number.isSafeInteger(frame.pid) || frame.pid <= 0) {
          protocolFailure()

          return
        }
        startedSeen = true
        onStarted({ pid: frame.pid })
        if (mode === 'pre-session' && !closeInputSent) {
          closeInputSent = true
          writeFrame({ kind: 'close-input' })
        }

        return
      }
      case 'start-failed': {
        if (startedSeen || startFailed !== null || !['spawn', 'termination'].includes(frame.detailCode)) {
          protocolFailure()

          return
        }
        startFailed = frame.detailCode
        recordFailure({ detailCode: frame.detailCode })

        return
      }
      case 'host-stdout':
      case 'host-stderr': {
        if (!startedSeen || frame.ordinal !== nextDataOrdinal[frame.kind]) {
          protocolFailure()

          return
        }
        const decoded = decodeStrictBase64(frame.dataBase64)
        if (decoded === null) {
          protocolFailure()

          return
        }
        const admission = budgets[frame.kind].admit(decoded.length)
        if (admission.ok !== true) {
          recordFailure({ detailCode: 'output-capacity' })
          startTermination()

          return
        }
        nextDataOrdinal[frame.kind] += 1
        forward[frame.kind](decoded)

        return
      }
      case 'input-accepted': {
        if (mode !== 'session' || !startedSeen || pendingInputOrdinals[0] !== frame.ordinal) {
          protocolFailure()

          return
        }
        pendingInputOrdinals.shift()
        onInputAccepted({ ordinal: frame.ordinal })

        return
      }
      case 'host-exit': {
        if (!startedSeen || hostExitCode !== null || !Number.isSafeInteger(frame.exitCode)) {
          protocolFailure()

          return
        }
        hostExitCode = frame.exitCode

        return
      }
      case 'job-empty': {
        if (!startedSeen || hostExitCode === null) {
          protocolFailure()

          return
        }
        jobEmpty = true
        jobEmptyTimer = clearTimer(jobEmptyTimer)
        if (!(runnerClosed && runnerStdoutEof)) {
          streamClosureTimer = clock.setTimeout(() => {
            streamClosureTimer = null
            recordFailure({ detailCode: 'stream-closure' })
          }, DEADLINES.NATURAL_CLOSURE_MILLISECONDS)
        }

        return
      }
      default:
        protocolFailure()
    }
  }

  const decoder = createLineDecoder({
    limit: BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES,
    limitName: 'MAX_RUNNER_FRAME_BYTES',
    onLine: handleFrame,
    onOverflow() {
      recordFailure({ detailCode: 'output-capacity' })
      startTermination()
    },
  })

  return {
    accounting() {
      return [...accounting]
    },
    closeInput() {
      if (!startedSeen || primaryFailure !== null) {
        return { ok: false }
      }
      if (closeInputSent) {
        return { alreadyClosed: true, ok: true }
      }
      closeInputSent = true
      writeFrame({ kind: 'close-input' })

      return { ok: true }
    },
    closureProof() {
      if (naturalConjunction()) {
        return { proven: true }
      }

      return { proven: false, reason: 'the natural-completion conjunction is incomplete' }
    },
    hostExitCode() {
      return hostExitCode
    },
    dispose() {
      if (disposed) {
        return
      }
      disposed = true
      jobEmptyTimer = clearTimer(jobEmptyTimer)
      runnerCloseTimer = clearTimer(runnerCloseTimer)
      streamClosureTimer = clearTimer(streamClosureTimer)
      if (child !== null && !runnerClosed) {
        try {
          child.kill()
        } catch {
          // Disposal is a test-harness safety net; a dead runner is the goal state.
        }
      }
    },
    input(bytes) {
      if (mode !== 'session' || !startedSeen || primaryFailure !== null || startFailed !== null || terminateSent || closeInputSent) {
        return { ok: false }
      }
      const ordinal = nextInputOrdinal
      const frame = canonicalJsonLine({ dataBase64: Buffer.from(bytes).toString('base64'), kind: 'host-input', ordinal })
      if (frame.length > BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES) {
        return { ok: false, overflow: { limitName: 'MAX_RUNNER_FRAME_BYTES', observedBytes: frame.length } }
      }
      nextInputOrdinal += 1
      pendingInputOrdinals.push(ordinal)
      if (!writeFrameLine(frame)) {
        return { ok: false }
      }

      return { ok: true, ordinal }
    },
    limits() {
      return { stderrLimit, stdoutLimit }
    },
    retainsRunRoot() {
      if (naturalConjunction()) {
        return false
      }
      if (startFailed === 'spawn') {
        return false
      }
      if (startFailed === 'termination' || forcedClose) {
        return true
      }
      if (primaryFailure !== null) {
        return primaryFailure.detailCode !== 'spawn'
      }

      return launch.state() !== 'pre-spawn'
    },
    runnerClosed() {
      return runnerClosed
    },
    start({ args, environment, executable }) {
      if (launch.state() !== 'pre-spawn' || child !== null) {
        throw new Error('the Windows runner adapter launches exactly once')
      }
      const seenNames = new Set()
      for (const name of Object.keys(environment)) {
        const comparable = name.toUpperCase()
        if (seenNames.has(comparable)) {
          recordFailure({ detailCode: 'spawn', initialCode: null })

          return { ok: false }
        }
        seenNames.add(comparable)
      }
      const startFrame = canonicalJsonLine({ args, cwd, environment, executable, kind: 'start' })
      if (startFrame.length > BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES) {
        recordFailure({ detailCode: 'spawn', initialCode: null })

        return { ok: false }
      }
      let spawned
      try {
        spawned = spawn(powerShellPath, [...WINDOWS_RUNNER_ARGV_PREFIX, runnerPath], {
          cwd,
          detached: false,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        })
      } catch {
        // The synchronous spawn boundary maps to the universal spawn classification.
        recordFailure(launch.classifyError())

        return { ok: false }
      }
      child = spawned
      child.on('error', () => {
        const classification = launch.classifyError()
        if (classification.accounting === true) {
          accounting.push({ detailCode: 'child-process' })

          return
        }
        recordFailure(classification)
      })
      child.on('spawn', () => {
        const record = launch.recordSpawn(child.pid)
        if (record.ok !== true) {
          recordFailure({ detailCode: 'spawn', initialCode: null })

          return
        }
        writeFrame(JSON.parse(startFrame.subarray(0, -1).toString('utf8')))
      })
      child.on('close', (code) => {
        runnerClosed = true
        runnerExitCode = code
        runnerCloseTimer = clearTimer(runnerCloseTimer)
        if (jobEmpty) {
          jobEmptyTimer = clearTimer(jobEmptyTimer)
        }
        maybeSettleStreamClosure()
        if (code !== 0 && primaryFailure === null && startFailed === null) {
          recordFailure({ detailCode: 'termination' })

          return
        }
        if (code !== 0 && primaryFailure !== null) {
          accounting.push({ detailCode: 'termination' })

          return
        }
        if (code === 0 && startedSeen && startFailed === null && primaryFailure === null && (hostExitCode === null || !jobEmpty)) {
          recordFailure({ detailCode: 'termination' })
        }
      })
      child.stdout.on('data', (chunk) => {
        decoder.push(chunk)
      })
      child.stdout.on('end', () => {
        runnerStdoutEof = true
        maybeSettleStreamClosure()
      })
      child.stderr.on('data', (chunk) => {
        if (chunk.length === 0) {
          return
        }
        if (primaryFailure !== null) {
          accounting.push({ detailCode: 'termination' })

          return
        }
        recordFailure({ detailCode: 'termination' })
        startTermination()
      })

      return { ok: true }
    },
    terminate() {
      return startTermination()
    },
  }
}

function createProductionProcessAdapter(options = {}) {
  for (const key of ['clock', 'containment', 'kill', 'powerShellPath', 'runnerPath', 'spawn']) {
    if (key in options) {
      throw new Error(`production containment rejects caller injection: ${key}`)
    }
  }
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') {
    return evaluateLinuxContainment()
  }
  const { trustedWindowsPowerShellPath } = require('../../skills/init-backlog/lib/filesystem')
  const powerShellPath = trustedWindowsPowerShellPath({ platform: 'win32', root: join(__dirname, '..', '..') })
  const runnerPath = windowsJobRunnerPath()
  const adapter = createWindowsJobRunnerAdapter({
    cwd: options.cwd,
    mode: options.mode,
    onFailure: options.onFailure,
    onHostStderr: options.onHostStderr,
    onHostStdout: options.onHostStdout,
    onInputAccepted: options.onInputAccepted,
    onStarted: options.onStarted,
    powerShellPath,
    runnerPath,
  })

  return { adapter, ok: true, powerShellPath, runnerPath }
}

module.exports = {
  RUNNER_CLOSE_MILLISECONDS,
  WINDOWS_RUNNER_INPUT_FRAME_KINDS,
  WINDOWS_RUNNER_OUTPUT_FRAME_KINDS,
  createDirectPosixFallbackAdapter,
  createProductionProcessAdapter,
  createWindowsJobRunnerAdapter,
  evaluateLinuxContainment,
  windowsJobRunnerPath,
}
