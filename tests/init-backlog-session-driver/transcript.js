'use strict'

const { BYTE_BOUNDS, compareOrdinal } = require('./primitives')
const { createByteBudget } = require('./state')

const PROXY_TRACE_BASE64_MEMBERS = Object.freeze(['requestBase64', 'stderrBase64', 'stdoutBase64'])
const PROXY_TRACE_MEMBERS = Object.freeze(['exitCode', 'ordinal', ...PROXY_TRACE_BASE64_MEMBERS])
const MAX_PARSED_JSON_DEPTH = 64

// Well-formed base64 spelling only. Canonicity (no over-long final group) is a
// strictly stronger check and is layered on top by `isCanonicalBase64`.
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

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

function parseJsonWithDepthLimit(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false }
  }
  const pending = [{ depth: 0, value }]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current.value === null || typeof current.value !== 'object') {
      continue
    }
    const depth = current.depth + 1
    if (depth > MAX_PARSED_JSON_DEPTH) {
      return { ok: false }
    }
    for (const child of Array.isArray(current.value) ? current.value : Object.values(current.value)) {
      if (child !== null && typeof child === 'object') {
        pending.push({ depth, value: child })
      }
    }
  }

  return { ok: true, value }
}

function isCanonicalBase64(value) {
  if (typeof value !== 'string' || !BASE64_PATTERN.test(value)) {
    return false
  }

  return Buffer.from(value, 'base64').toString('base64') === value
}

function aggregateLines(lines) {
  return Buffer.concat(lines)
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
    lineCount() {
      return lines.length
    },
    lines() {
      return lines.map((line) => Buffer.from(line))
    },
    toBuffer() {
      return aggregateLines(lines)
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
    toBuffer() {
      return aggregateLines(lines)
    },
  }
}

module.exports = { BASE64_PATTERN, MAX_PARSED_JSON_DEPTH, PROXY_TRACE_BASE64_MEMBERS, PROXY_TRACE_MEMBERS, canonicalJson, canonicalJsonLine, createProxyTrace, createTranscript, isCanonicalBase64, parseJsonWithDepthLimit }
