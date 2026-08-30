'use strict'

const { timingSafeEqual } = require('node:crypto')

const { BYTE_BOUNDS, DEADLINES } = require('./primitives')
const { canonicalJson, canonicalJsonLine, isCanonicalBase64, parseJsonWithDepthLimit } = require('./transcript')

const CLIENT_FRAME_MEMBERS = 'requestBase64,token'
const WORKER_REPLY_MEMBERS = 'exitCode,ordinal,stderrBase64,stdoutBase64'

// Mirrors the production spool's MAX_APPLY_REQUEST_BYTES without importing
// production controller modules into the driver process.
const MAX_APPLY_REQUEST_BYTES = 16777216
// Fixed allowance for the token member, JSON punctuation, and member names
// around the Base64 request payload in one client frame.
const PROXY_CLIENT_FRAME_ENVELOPE_ALLOWANCE_BYTES = 1024
const MAX_PROXY_CLIENT_FRAME_BYTES = 4 * Math.ceil(MAX_APPLY_REQUEST_BYTES / 3) + PROXY_CLIENT_FRAME_ENVELOPE_ALLOWANCE_BYTES
const MAX_PROXY_CONNECTIONS = 4

function parseCanonicalObject(bytes, expectedMemberKey) {
  const result = parseJsonWithDepthLimit(bytes.toString('utf8'))
  if (result.ok !== true) {
    return null
  }
  const parsed = result.value
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }
  if (Object.keys(parsed).sort().join(',') !== expectedMemberKey) {
    return null
  }

  return parsed
}

function isValidWorkerReply(frame, expectedOrdinal) {
  return frame !== null
    && frame.ordinal === expectedOrdinal
    && isCanonicalBase64(frame.stdoutBase64)
    && isCanonicalBase64(frame.stderrBase64)
    && Number.isSafeInteger(frame.exitCode)
    && frame.exitCode >= 0
    && frame.exitCode <= 255
}

// Compares a client-supplied token against the per-run token without leaking
// the matching prefix length through comparison timing. timingSafeEqual throws
// on unequal lengths, so a non-string or differently sized candidate is
// rejected before it reaches the constant-time compare.
function tokenMatches(candidate, expected) {
  if (typeof candidate !== 'string') {
    return false
  }
  const candidateBytes = Buffer.from(candidate, 'utf8')
  const expectedBytes = Buffer.from(expected, 'utf8')
  if (candidateBytes.length !== expectedBytes.length) {
    return false
  }

  return timingSafeEqual(candidateBytes, expectedBytes)
}

function createAuthorizationGate({ host, hostContext, scenarioRoot }) {
  const expectedHostContext = canonicalJson(hostContext)
  let authorizedOperation = null
  let inspectClosed = false
  let applyClosedForever = false
  let authorizedApplyBytes = null
  let storedInspection = null

  return {
    admit(requestBytes) {
      const parsed = parseJsonWithDepthLimit(Buffer.from(requestBytes).toString('utf8'))
      if (parsed.ok !== true) {
        return { ok: false, reason: 'field' }
      }
      const request = parsed.value
      if (request === null || typeof request !== 'object' || Array.isArray(request)) {
        return { ok: false, reason: 'field' }
      }
      if (authorizedOperation === null && !inspectClosed && authorizedApplyBytes === null) {
        if (request.operation === 'apply' && (applyClosedForever || storedInspection !== null)) {
          return { ok: false, reason: 'approval-state' }
        }

        return { ok: false, reason: 'order' }
      }
      if (request.root !== scenarioRoot) {
        return { ok: false, reason: 'root' }
      }
      if (request.protocolVersion !== 1 || request.host !== host || canonicalJson(request.hostContext ?? null) !== expectedHostContext) {
        return { ok: false, reason: 'field' }
      }
      if (request.operation === 'inspect') {
        if (inspectClosed) {
          return { ok: false, reason: 'duplicate-call' }
        }
        if (authorizedOperation !== 'inspect') {
          return { ok: false, reason: 'operation' }
        }

        return { ok: true, operation: 'inspect' }
      }
      if (request.operation === 'apply') {
        if (authorizedOperation === 'inspect') {
          return { ok: false, reason: 'operation' }
        }
        if (authorizedApplyBytes === null) {
          return { ok: false, reason: 'approval-state' }
        }
        if (!Buffer.from(requestBytes).equals(authorizedApplyBytes)) {
          return { ok: false, reason: 'request-byte' }
        }

        return { ok: true, operation: 'apply' }
      }

      return { ok: false, reason: 'operation' }
    },
    authorizeInspect() {
      if (inspectClosed) {
        throw new Error('inspect admission is already closed')
      }
      authorizedOperation = 'inspect'
    },
    closeApplyForever() {
      applyClosedForever = true
      authorizedOperation = authorizedOperation === 'apply' ? null : authorizedOperation
    },
    installApplyAuthorization(exactRequestBytes) {
      if (applyClosedForever) {
        throw new Error('a non-approved branch permanently authorizes no apply')
      }
      if (storedInspection === null) {
        throw new Error('apply authorization requires the stored inspection')
      }
      if (authorizedApplyBytes !== null) {
        throw new Error('apply authorization is installed at most once')
      }
      authorizedApplyBytes = Buffer.from(exactRequestBytes)
      authorizedOperation = 'apply'
    },
    recordInspectSuccess(resultBytes) {
      storedInspection = Buffer.from(resultBytes)
      inspectClosed = true
      authorizedOperation = authorizedOperation === 'inspect' ? null : authorizedOperation
    },
    storedInspectionBytes() {
      return storedInspection === null ? null : Buffer.from(storedInspection)
    },
  }
}

function createProxyServer({
  callDeadlineMilliseconds = DEADLINES.WORKER_CALL_MILLISECONDS,
  clock,
  connectionDeadlineMilliseconds = DEADLINES.WORKER_STARTUP_MILLISECONDS,
  connectionLimit = MAX_PROXY_CONNECTIONS,
  gate,
  onFailure,
  termination,
  token,
  trace,
  worker,
}) {
  if (!Number.isSafeInteger(connectionDeadlineMilliseconds) || connectionDeadlineMilliseconds <= 0 || !Number.isSafeInteger(connectionLimit) || connectionLimit <= 0) {
    throw new Error('proxy connection bounds must be positive safe integers')
  }
  let admissionOpen = true
  let closeRequested = false
  let proxyFailureRecorded = false
  let hostTerminationStarted = false
  let workerTerminationStarted = false
  let nextOrdinal = 1
  let activeCall = null
  const completedCalls = []
  const connections = new Map()

  const clearConnectionDeadline = (record) => {
    if (record !== undefined && record.deadlineHandle !== null) {
      clock.clearTimeout(record.deadlineHandle)
      record.deadlineHandle = null
    }
  }

  const releaseConnection = (connection) => {
    const record = connections.get(connection)
    if (record === undefined) {
      return undefined
    }
    clearConnectionDeadline(record)
    connections.delete(connection)

    return record
  }

  const destroyConnection = (connection) => {
    try {
      if (typeof connection.destroy === 'function') {
        connection.destroy()
      } else {
        connection.end()
      }
    } catch {
      // The connection is already unusable, which is the required state.
    }
  }

  const clearCallDeadline = (call) => {
    if (call !== null && call.deadlineHandle !== null) {
      clock.clearTimeout(call.deadlineHandle)
      call.deadlineHandle = null
    }
  }

  const startTerminations = () => {
    if (!hostTerminationStarted) {
      hostTerminationStarted = true
      termination.startHost()
    }
    if (!workerTerminationStarted) {
      workerTerminationStarted = true
      termination.startWorker()
    }
  }

  const serverFailure = (detailCode) => {
    clearCallDeadline(activeCall)
    if (proxyFailureRecorded) {
      return
    }
    proxyFailureRecorded = true
    admissionOpen = false
    onFailure({ detailCode })
    startTerminations()
  }

  const proxyFailure = () => {
    serverFailure('proxy')
  }

  const clientFrameCapacityFailure = (connection) => {
    releaseConnection(connection)
    connection.end()
    serverFailure('output-capacity')
  }

  const rejectAuthorization = (connection) => {
    releaseConnection(connection)
    onFailure({ detailCode: 'proxy-authorization' })
    connection.end()
  }

  const server = {
    activeOrdinal() {
      return activeCall === null ? null : activeCall.ordinal
    },
    admissionOpen() {
      return admissionOpen
    },
    close(callback) {
      if (closeRequested) {
        throw new Error('proxy admission is closed exactly once')
      }
      closeRequested = true
      admissionOpen = false
      for (const [connection, record] of connections) {
        if (!record.authenticated || (activeCall?.connection !== connection && record.pendingDrainOrdinal === null)) {
          connection.end()
        }
      }
      callback()
    },
    connectionClosed(connection) {
      const record = releaseConnection(connection)
      if (record === undefined) {
        return
      }
      if (activeCall?.connection === connection) {
        clearCallDeadline(activeCall)
        activeCall = null
        proxyFailure()

        return
      }
      if (record.pendingDrainOrdinal !== null) {
        proxyFailure()
      }
    },
    connectionCount() {
      return connections.size
    },
    connectionLimit() {
      return connectionLimit
    },
    connectionDrained(connection) {
      const record = connections.get(connection)
      if (record !== undefined && record.pendingDrainOrdinal !== null) {
        const completed = completedCalls.find((call) => call.ordinal === record.pendingDrainOrdinal)
        if (completed !== undefined) {
          completed.replyFlushed = true
        }
        record.pendingDrainOrdinal = null
      }
    },
    handleConnection(connection) {
      if (!admissionOpen || connections.size >= connectionLimit) {
        connection.end()

        return { admitted: false }
      }
      const record = { authenticated: false, buffered: Buffer.alloc(0), deadlineHandle: null, framed: false, pendingDrainOrdinal: null }
      connections.set(connection, record)
      record.deadlineHandle = clock.setTimeout(() => {
        releaseConnection(connection)
        destroyConnection(connection)
      }, connectionDeadlineMilliseconds)
      if (typeof connection.on === 'function') {
        connection.on('data', (chunk) => server.receiveData(connection, chunk))
        connection.on('drain', () => server.connectionDrained(connection))
        connection.on('close', () => server.connectionClosed(connection))
        connection.on('error', () => server.connectionClosed(connection))
      }

      return { admitted: true }
    },
    receiveData(connection, chunk) {
      const record = connections.get(connection)
      if (record === undefined) {
        connection.end()

        return
      }
      record.buffered = Buffer.concat([record.buffered, Buffer.from(chunk)])
      const terminator = record.buffered.indexOf(0x0a)
      if (terminator === -1) {
        if (record.buffered.length > MAX_PROXY_CLIENT_FRAME_BYTES) {
          record.buffered = Buffer.alloc(0)
          clientFrameCapacityFailure(connection)
        }

        return
      }
      if (terminator > MAX_PROXY_CLIENT_FRAME_BYTES) {
        record.buffered = Buffer.alloc(0)
        clientFrameCapacityFailure(connection)

        return
      }
      const lineBytes = record.buffered.subarray(0, terminator)
      const remainder = record.buffered.subarray(terminator + 1)
      record.buffered = Buffer.alloc(0)
      if (record.framed || remainder.length !== 0) {
        rejectAuthorization(connection)

        return
      }
      record.framed = true
      const frame = parseCanonicalObject(lineBytes, CLIENT_FRAME_MEMBERS)
      if (frame === null || !tokenMatches(frame.token, token) || !isCanonicalBase64(frame.requestBase64)) {
        rejectAuthorization(connection)

        return
      }
      record.authenticated = true
      clearConnectionDeadline(record)
      if (activeCall !== null) {
        rejectAuthorization(connection)

        return
      }
      const requestBytes = Buffer.from(frame.requestBase64, 'base64')
      const admitted = gate.admit(requestBytes)
      if (admitted.ok !== true) {
        rejectAuthorization(connection)

        return
      }
      const ordinal = nextOrdinal
      nextOrdinal += 1
      const call = {
        connection,
        deadlineHandle: null,
        operation: admitted.operation,
        ordinal,
        replyFlushed: false,
        requestBase64: frame.requestBase64,
        traceFlushed: false,
      }
      activeCall = call
      try {
        worker.send(canonicalJsonLine({ ordinal, requestBase64: frame.requestBase64 }))
      } catch {
        activeCall = null
        proxyFailure()

        return
      }
      call.deadlineHandle = clock.setTimeout(() => {
        call.deadlineHandle = null
        activeCall = null
        proxyFailure()
      }, callDeadlineMilliseconds)
    },
    receiveWorkerLine(lineBytes) {
      if (activeCall === null) {
        proxyFailure()

        return
      }
      const call = activeCall
      if (lineBytes.length > BYTE_BOUNDS.MAX_RUNNER_FRAME_BYTES) {
        clearCallDeadline(call)
        activeCall = null
        proxyFailure()

        return
      }
      const frame = parseCanonicalObject(lineBytes, WORKER_REPLY_MEMBERS)
      if (!isValidWorkerReply(frame, call.ordinal)) {
        clearCallDeadline(call)
        activeCall = null
        proxyFailure()

        return
      }
      const traceRecord = { exitCode: frame.exitCode, ordinal: frame.ordinal, requestBase64: call.requestBase64, stderrBase64: frame.stderrBase64, stdoutBase64: frame.stdoutBase64 }
      try {
        trace.append(traceRecord)
      } catch {
        clearCallDeadline(call)
        activeCall = null
        proxyFailure()

        return
      }
      call.traceFlushed = true
      let writeReturn
      try {
        writeReturn = call.connection.write(canonicalJsonLine(traceRecord))
      } catch {
        clearCallDeadline(call)
        activeCall = null
        proxyFailure()

        return
      }
      if (writeReturn === true) {
        call.replyFlushed = true
      } else {
        const record = connections.get(call.connection)
        if (record !== undefined) {
          record.pendingDrainOrdinal = call.ordinal
        }
      }
      clearCallDeadline(call)
      if (call.operation === 'inspect' && frame.exitCode === 0) {
        gate.recordInspectSuccess(Buffer.from(frame.stdoutBase64, 'base64'))
      }
      completedCalls.push(call)
      activeCall = null
    },
    dispose() {
      admissionOpen = false
      clearCallDeadline(activeCall)
      activeCall = null
      for (const connection of [...connections.keys()]) {
        releaseConnection(connection)
        destroyConnection(connection)
      }
    },
    verifiedClosure() {
      return closeRequested && activeCall === null && connections.size === 0 && completedCalls.every((call) => call.traceFlushed && call.replyFlushed)
    },
    workerDisconnected() {
      if (closeRequested && activeCall === null) {
        return
      }
      const interrupted = activeCall
      clearCallDeadline(interrupted)
      activeCall = null
      proxyFailure()
    },
  }

  return server
}

module.exports = { MAX_PROXY_CLIENT_FRAME_BYTES, PROXY_CLIENT_FRAME_ENVELOPE_ALLOWANCE_BYTES, createAuthorizationGate, createProxyServer }
