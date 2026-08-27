'use strict'

const { BYTE_BOUNDS, createByteBudget } = require('./state')

const PROXY_TRACE_MEMBERS = Object.freeze(['exitCode', 'ordinal', 'requestBase64', 'stderrBase64', 'stdoutBase64'])

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort(compareOrdinal).map((key) => [key, canonicalize(value[key])]))
  }

  return value
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function canonicalJsonLine(value) {
  return Buffer.from(canonicalJson(value) + '\n', 'utf8')
}

function createTranscript({ limit = BYTE_BOUNDS.MAX_TRANSCRIPT_BYTES } = {}) {
  const budget = createByteBudget({ limit, limitName: 'MAX_TRANSCRIPT_BYTES' })
  const lines = []
  let nextOrdinal = 1

  const append = (kind, payloadBytes) => {
    const ordinal = nextOrdinal
    const line = canonicalJsonLine({ kind, ordinal, payloadBase64: Buffer.from(payloadBytes).toString('base64') })
    const admission = budget.admit(line.length)
    if (admission.ok !== true) {
      return admission
    }
    nextOrdinal += 1
    lines.push(line)

    return { ordinal }
  }

  return {
    appendHostEvent(payloadBytes) {
      return append('host-event', payloadBytes)
    },
    appendInput(payloadBytes) {
      return append('input', payloadBytes)
    },
    appendStructuredOutput(payloadBytes) {
      return append('structured-output', payloadBytes)
    },
    byteLength() {
      return budget.count()
    },
    lines() {
      return lines.map((line) => Buffer.from(line))
    },
  }
}

function createProxyTrace({ flush, limit = BYTE_BOUNDS.MAX_PROXY_TRACE_BYTES } = {}) {
  const budget = createByteBudget({ limit, limitName: 'MAX_PROXY_TRACE_BYTES' })
  const lines = []

  return {
    append(record) {
      if (record === null || typeof record !== 'object' || Object.keys(record).sort(compareOrdinal).join(',') !== PROXY_TRACE_MEMBERS.join(',')) {
        throw new Error('a proxy trace line carries exactly the five closed members')
      }
      const line = canonicalJsonLine(record)
      const admission = budget.admit(line.length)
      if (admission.ok !== true) {
        throw new Error(`proxy trace capacity exceeded: ${admission.overflow.limitName} at ${admission.overflow.observedBytes}`)
      }
      lines.push(line)
      flush(line)
    },
    byteLength() {
      return budget.count()
    },
    lines() {
      return lines.map((line) => Buffer.from(line))
    },
  }
}

module.exports = { canonicalJson, canonicalJsonLine, createProxyTrace, createTranscript }
