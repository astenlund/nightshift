'use strict'

const { createHash } = require('node:crypto')

const BYTE_BOUNDS = Object.freeze({
  MAX_EVIDENCE_LEAF_BYTES: 201326592,
  MAX_EVIDENCE_ROOT_BYTES: 1073741824,
  MAX_HOST_LINE_BYTES: 4194304,
  MAX_PROCESS_STDERR_BYTES: 4194304,
  MAX_PROCESS_STDOUT_BYTES: 33554432,
  MAX_PROXY_TRACE_BYTES: 67108864,
  MAX_RUNNER_FRAME_BYTES: 5592576,
  MAX_TRANSCRIPT_BYTES: 67108864,
})

const DEADLINES = Object.freeze({
  NATURAL_CLOSURE_MILLISECONDS: 5000,
  PRE_SESSION_MILLISECONDS: 60000,
  TURN_NANOSECONDS: 900000000000n,
  WORKER_CALL_MILLISECONDS: 300000,
  WORKER_STARTUP_MILLISECONDS: 60000,
})

const INFRASTRUCTURE_PHASES = Object.freeze(['import-probe', 'version', 'authentication', 'plugin-setup', 'initial-turn', 'interaction-turn', 'post-session'])

const PRIMARY_INITIAL_CODES = Object.freeze(['preflight-timeout', 'invalid-host-version', 'authentication-unavailable', 'session-input', 'session-timeout'])

const INFRASTRUCTURE_DETAIL_CODES = Object.freeze(['spawn', 'child-process', 'containment-unavailable', 'proxy', 'proxy-authorization', 'output-capacity', 'termination', 'stream-closure', 'evidence-copy', 'evidence-verification', 'repository-attestation', 'cleanup'])

const POST_SESSION_ONLY_DETAIL_CODES = Object.freeze(['repository-attestation', 'evidence-copy', 'evidence-verification', 'cleanup'])

const PROCESS_ADAPTER_EVENTS = Object.freeze(['start', 'input', 'close-input', 'terminate', 'closure-proof'])

const SESSION_FAILURE_CODES = Object.freeze(['session-input', 'session-timeout'])

const HOSTS = Object.freeze(['claude-code', 'codex'])

const APPROVAL_BRANCHES = Object.freeze(['approved', 'denied', 'deferred', 'unavailable', 'auto-denied'])

const VERSION_CONTROL_OPTION_ORDER = Object.freeze(['track', 'ignore', 'deferred', 'not-required'])

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireHost(host) {
  if (!HOSTS.includes(host)) {
    throw new Error(`host is not a closed host name: ${host}`)
  }

  return host
}

function infrastructureFailure({ detailCode, host, initialCode, phase, retainedRunRoot }) {
  requireHost(host)
  if (!INFRASTRUCTURE_PHASES.includes(phase)) {
    throw new Error(`phase is not a closed phase: ${phase}`)
  }
  if (initialCode !== null && !PRIMARY_INITIAL_CODES.includes(initialCode)) {
    throw new Error(`initialCode is not a closed primary code or null: ${initialCode}`)
  }
  if (!INFRASTRUCTURE_DETAIL_CODES.includes(detailCode)) {
    throw new Error(`detailCode is not a closed detail code: ${detailCode}`)
  }
  if (POST_SESSION_ONLY_DETAIL_CODES.includes(detailCode) && (phase !== 'post-session' || initialCode !== null)) {
    throw new Error(`${detailCode} always carries phase post-session with a null initialCode`)
  }
  if (retainedRunRoot !== null && typeof retainedRunRoot !== 'string') {
    throw new Error('retainedRunRoot must be a canonical absolute path or null')
  }

  return { ok: false, host, code: 'harness-infrastructure', phase, initialCode, detailCode, retainedRunRoot }
}

function createInfrastructureAccount({ host }) {
  requireHost(host)
  let identity = null
  let postSession = false
  let retainedRunRoot = null
  const accounting = []

  return {
    accounting() {
      return [...accounting]
    },
    enterPostSession() {
      postSession = true
    },
    finalizeRetainedRunRoot(value) {
      retainedRunRoot = value
    },
    hasFailure() {
      return identity !== null
    },
    recordFailure({ detailCode, initialCode = null, phase }) {
      const resolvedPhase = postSession && phase === undefined ? 'post-session' : phase
      const resolvedInitialCode = postSession && phase === undefined ? null : initialCode
      if (identity === null) {
        identity = infrastructureFailure({ detailCode, host, initialCode: resolvedInitialCode, phase: resolvedPhase, retainedRunRoot: null })

        return { first: true }
      }
      accounting.push({ detailCode, initialCode: resolvedInitialCode, phase: resolvedPhase })

      return { first: false }
    },
    result() {
      if (identity === null) {
        throw new Error('no infrastructure failure has been recorded')
      }

      return infrastructureFailure({ detailCode: identity.detailCode, host, initialCode: identity.initialCode, phase: identity.phase, retainedRunRoot })
    },
  }
}

function createSessionLatch(host) {
  requireHost(host)
  let state = 'open'
  let primaryResult = null

  return {
    claimFailure({ code, phase }) {
      if (!SESSION_FAILURE_CODES.includes(code)) {
        throw new Error(`session failure code is not closed: ${code}`)
      }
      if (state !== 'open') {
        return { claimed: false }
      }
      state = 'terminating'
      primaryResult = { ok: false, host, code, phase }

      return { claimed: true, record: primaryResult }
    },
    completeWithPlatformProof() {
      if (state !== 'open') {
        return false
      }
      state = 'completed'

      return true
    },
    primaryResult() {
      return primaryResult
    },
    state() {
      return state
    },
  }
}

function createWriteState() {
  let value = { callbackSucceeded: false, drained: false, needsDrain: null }

  return {
    admitted() {
      return value.callbackSucceeded && (value.needsDrain === false || value.drained)
    },
    recordCallbackSuccess() {
      value = { ...value, callbackSucceeded: true }
    },
    recordDrain() {
      if (value.needsDrain === true) {
        value = { ...value, drained: true }
      }
    },
    recordSyncReturn(returnValue) {
      value = { ...value, needsDrain: returnValue !== true }
    },
    reset() {
      value = { callbackSucceeded: false, drained: false, needsDrain: null }
    },
    value() {
      return { ...value }
    },
  }
}

function createTurnSequencer({ latch, now, writeTurn }) {
  const writeState = createWriteState()
  let slot = null
  let pending = null

  const advance = () => {
    if (pending === null || !writeState.admitted()) {
      return null
    }
    if (latch.state() !== 'open') {
      const dropped = { accounting: true, written: false }
      pending = null

      return dropped
    }
    const sample = now()
    if (sample >= slot.deadlineAt) {
      latch.claimFailure({ code: 'session-timeout', phase: slot.phase })
      pending = null

      return { timedOut: true, written: false }
    }
    const payload = pending.nextInput
    pending = null
    slot = { deadlineAt: sample + DEADLINES.TURN_NANOSECONDS, handle: null, phase: 'interaction-turn' }
    writeState.reset()
    writeTurn(payload)

    return { written: true }
  }

  return {
    claimDeadline() {
      if (slot === null || now() < slot.deadlineAt) {
        return { claimed: false }
      }

      return latch.claimFailure({ code: 'session-timeout', phase: slot.phase })
    },
    recordCallbackSuccess() {
      writeState.recordCallbackSuccess()

      return advance()
    },
    recordDrain() {
      writeState.recordDrain()

      return advance()
    },
    recordInputFailure() {
      return latch.claimFailure({ code: 'session-input', phase: slot.phase })
    },
    recordSyncReturn(returnValue) {
      writeState.recordSyncReturn(returnValue)

      return advance()
    },
    receiveStructuredResult({ nextInput }) {
      if (latch.state() !== 'open') {
        return { accounting: true, written: false }
      }
      pending = { nextInput }
      if (!writeState.admitted()) {
        return { retained: true, written: false }
      }

      return advance()
    },
    slot() {
      return slot === null ? null : { ...slot }
    },
    start(phase, payload) {
      if (phase !== 'initial-turn' && phase !== 'interaction-turn') {
        throw new Error(`turn phase is not a session turn phase: ${phase}`)
      }
      writeState.reset()
      slot = { deadlineAt: now() + DEADLINES.TURN_NANOSECONDS, handle: null, phase }
      writeTurn(payload)

      return { ...slot }
    },
    writeState() {
      return writeState.value()
    },
  }
}

function createLaunchState() {
  let state = 'pre-spawn'
  let failureClassified = false

  return {
    classifyError() {
      if (state === 'pre-spawn') {
        return { detailCode: 'spawn', initialCode: null }
      }
      if (!failureClassified) {
        failureClassified = true

        return { detailCode: 'child-process' }
      }

      return { accounting: true }
    },
    recordSpawn(pid) {
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        return { ok: false }
      }
      state = 'spawned'

      return { ok: true }
    },
    state() {
      return state
    },
  }
}

function createByteBudget({ limit, limitName }) {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(`byte budget limit is invalid: ${limitName}`)
  }
  let count = 0

  return {
    admit(byteLength) {
      if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
        throw new Error(`byte budget admission length is invalid: ${limitName}`)
      }
      const observedBytes = count + byteLength
      if (observedBytes > limit) {
        return { overflow: { limitName, observedBytes } }
      }
      count = observedBytes

      return { ok: true }
    },
    count() {
      return count
    },
  }
}

function createLineDecoder({ limit, limitName, onLine, onOverflow }) {
  let buffered = Buffer.alloc(0)
  let overflowed = false

  return {
    bufferedBytes() {
      return buffered.length
    },
    push(chunk) {
      if (overflowed) {
        return
      }
      buffered = Buffer.concat([buffered, Buffer.from(chunk)])
      let terminator = buffered.indexOf(0x0a)
      while (terminator !== -1) {
        const line = buffered.subarray(0, terminator)
        buffered = buffered.subarray(terminator + 1)
        if (line.length > limit) {
          overflowed = true
          onOverflow({ limitName, observedBytes: line.length })

          return
        }
        onLine(line)
        terminator = buffered.indexOf(0x0a)
      }
      if (buffered.length > limit) {
        overflowed = true
        onOverflow({ limitName, observedBytes: buffered.length })
      }
    },
  }
}

module.exports = {
  APPROVAL_BRANCHES,
  BYTE_BOUNDS,
  DEADLINES,
  HOSTS,
  INFRASTRUCTURE_DETAIL_CODES,
  INFRASTRUCTURE_PHASES,
  PRIMARY_INITIAL_CODES,
  PROCESS_ADAPTER_EVENTS,
  VERSION_CONTROL_OPTION_ORDER,
  compareOrdinal,
  createByteBudget,
  createInfrastructureAccount,
  createLaunchState,
  createLineDecoder,
  createSessionLatch,
  createTurnSequencer,
  createWriteState,
  infrastructureFailure,
  isPlainObject,
  sha256,
}
