'use strict'

const { canonicalJson } = require('./transcript')

const CLAUDE_PUBLIC_SKILL_INVENTORY = Object.freeze(['exploring', 'handover', 'init-backlog', 'ready', 'revise-code', 'revise-docs', 'revise-lore', 'revise-plan', 'revise-spec', 'spec-agreement'])

const CLAUDE_PLUGIN_NAME = 'nightshift'
const NIGHTSHIFT_NAMESPACE = `${CLAUDE_PLUGIN_NAME}:`
const SENTINEL_PATTERN = /^[0-9a-f]{32}$/

function decodeStrictUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

function parseHostEventLine(lineBytes) {
  const text = decodeStrictUtf8(lineBytes)
  if (text === null) {
    return { failure: { reason: 'unparseable-event' } }
  }
  let event
  try {
    event = JSON.parse(text)
  } catch {
    return { failure: { reason: 'unparseable-event' } }
  }
  if (event === null || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string' || event.type === '') {
    return { failure: { reason: 'unparseable-event' } }
  }

  return { event }
}

function isHookEvent(event) {
  return event.type === 'system' && typeof event.subtype === 'string' && event.subtype.startsWith('hook')
}

function isSystemInit(event) {
  return event.type === 'system' && event.subtype === 'init'
}

function nightshiftEntries(values) {
  return values.filter((entry) => typeof entry === 'string' && entry.startsWith(NIGHTSHIFT_NAMESPACE))
}

function validateClaudeSessionInit(event, { sessionPluginRoot }) {
  if (!isSystemInit(event)) {
    return { ok: false, reason: 'not-init' }
  }
  const plugins = event.plugins
  if (!Array.isArray(plugins) || plugins.length !== 1) {
    return { ok: false, reason: 'plugin-inventory' }
  }
  const [plugin] = plugins
  if (plugin === null || typeof plugin !== 'object' || Array.isArray(plugin) || plugin.name !== CLAUDE_PLUGIN_NAME || plugin.path !== sessionPluginRoot) {
    return { ok: false, reason: 'plugin-inventory' }
  }
  if (!Array.isArray(event.mcp_servers) || event.mcp_servers.length !== 0) {
    return { ok: false, reason: 'mcp-server' }
  }
  if (!Array.isArray(event.skills)) {
    return { ok: false, reason: 'skill-inventory' }
  }
  const expected = CLAUDE_PUBLIC_SKILL_INVENTORY.map((name) => `${NIGHTSHIFT_NAMESPACE}${name}`)
  const observed = nightshiftEntries(event.skills).toSorted()
  if (observed.length !== expected.length || observed.some((entry, index) => entry !== expected[index])) {
    return { ok: false, reason: 'skill-inventory' }
  }
  const skillSet = new Set(expected)
  if (!Array.isArray(event.slash_commands) || nightshiftEntries(event.slash_commands).some((entry) => !skillSet.has(entry))) {
    return { ok: false, reason: 'legacy-command' }
  }

  return { ok: true }
}

function validateImportProbeInit(event) {
  if (!isSystemInit(event)) {
    return { ok: false, reason: 'not-init' }
  }
  for (const key of ['tools', 'mcp_servers', 'plugins']) {
    if (!Array.isArray(event[key]) || event[key].length !== 0) {
      return { ok: false, reason: 'probe-isolation' }
    }
  }

  return { ok: true }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function createClaudeSessionConductor({ sessionPluginRoot }) {
  let initEvent = null
  const structuredResults = []

  return {
    acceptLine(lineBytes) {
      const parsed = parseHostEventLine(lineBytes)
      if (parsed.failure !== undefined) {
        return parsed
      }
      const event = parsed.event
      if (isHookEvent(event)) {
        return { failure: { reason: 'hook-event' } }
      }
      if (isSystemInit(event)) {
        if (initEvent !== null) {
          return { failure: { reason: 'duplicate-init' } }
        }
        const verdict = validateClaudeSessionInit(event, { sessionPluginRoot })
        if (verdict.ok !== true) {
          return { failure: { reason: verdict.reason } }
        }
        initEvent = event

        return { accepted: { event, kind: 'system-init' } }
      }
      if (initEvent === null) {
        return { failure: { reason: 'missing-init' } }
      }
      if (event.type === 'result') {
        if (!isPlainObject(event.structured_output)) {
          return { failure: { reason: 'missing-structured-output' } }
        }
        structuredResults.push(event.structured_output)

        return { accepted: { event, kind: 'structured-result', structuredOutput: event.structured_output } }
      }

      return { accepted: { event, kind: 'host-event' } }
    },
    finalStructuredResult() {
      return structuredResults.length === 0 ? null : structuredResults[structuredResults.length - 1]
    },
    initEvent() {
      return initEvent
    },
    structuredResults() {
      return [...structuredResults]
    },
  }
}

function createCodexTurnConductor({ expectedThreadId = null } = {}) {
  let threadId = null
  let structuredResult = null

  return {
    acceptLine(lineBytes) {
      const parsed = parseHostEventLine(lineBytes)
      if (parsed.failure !== undefined) {
        return parsed
      }
      const event = parsed.event
      if (event.type === 'thread.started') {
        if (typeof event.thread_id !== 'string' || event.thread_id.trim() === '') {
          return { failure: { reason: 'thread-id-invalid' } }
        }
        if (threadId !== null) {
          return { failure: { reason: 'duplicate-thread-started' } }
        }
        if (expectedThreadId !== null && event.thread_id !== expectedThreadId) {
          return { failure: { reason: 'thread-id-mismatch' } }
        }
        threadId = event.thread_id

        return { accepted: { event, kind: 'thread-started', threadId } }
      }
      if (event.type === 'error') {
        return { failure: { reason: 'host-error-event' } }
      }
      if (event.type === 'item.completed' && isPlainObject(event.item) && event.item.type === 'agent_message') {
        if (structuredResult !== null) {
          return { failure: { reason: 'duplicate-structured-result' } }
        }
        let value = null
        if (typeof event.item.text === 'string') {
          try {
            value = JSON.parse(event.item.text)
          } catch {
            value = null
          }
        }
        if (!isPlainObject(value)) {
          return { failure: { reason: 'structured-result-invalid' } }
        }
        structuredResult = value

        return { accepted: { event, kind: 'structured-result', structuredOutput: value } }
      }

      return { accepted: { event, kind: 'host-event' } }
    },
    finish() {
      if (expectedThreadId === null && threadId === null) {
        return { ok: false, reason: 'missing-thread-started' }
      }
      if (structuredResult === null) {
        return { ok: false, reason: 'missing-structured-result' }
      }

      return { ok: true, structuredResult, threadId: threadId ?? expectedThreadId }
    },
  }
}

function verifyTurnOutputEquality({ structuredResult, turnOutputBytes }) {
  const text = decodeStrictUtf8(turnOutputBytes)
  if (text === null) {
    return { ok: false, reason: 'output-file-disagreement' }
  }
  let value
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'output-file-disagreement' }
  }
  if (!isPlainObject(value) || canonicalJson(value) !== canonicalJson(structuredResult)) {
    return { ok: false, reason: 'output-file-disagreement' }
  }

  return { ok: true }
}

function validateImportProbeSession({ expectedSentinel, exitCode, stderrBytes, stdoutBytes }) {
  if (expectedSentinel !== null && (typeof expectedSentinel !== 'string' || !SENTINEL_PATTERN.test(expectedSentinel))) {
    throw new Error('expectedSentinel must be null or 32 lowercase hexadecimal characters')
  }
  if (exitCode !== 0) {
    return { passed: false, reason: 'nonzero-exit' }
  }
  if (!Buffer.isBuffer(stderrBytes) || stderrBytes.length !== 0) {
    return { passed: false, reason: 'stderr' }
  }
  const text = decodeStrictUtf8(stdoutBytes)
  if (text === null) {
    return { passed: false, reason: 'unparseable-event' }
  }
  const rawLines = text.split('\n')
  if (rawLines.length === 0 || rawLines[rawLines.length - 1] !== '') {
    return { passed: false, reason: 'unparseable-event' }
  }
  const events = []
  for (const rawLine of rawLines.slice(0, -1)) {
    const parsed = parseHostEventLine(Buffer.from(rawLine, 'utf8'))
    if (parsed.failure !== undefined) {
      return { passed: false, reason: 'unparseable-event' }
    }
    events.push(parsed.event)
  }
  let initSeen = false
  for (const event of events) {
    if (isHookEvent(event)) {
      return { passed: false, reason: 'hook-event' }
    }
    if (isSystemInit(event)) {
      if (initSeen) {
        return { passed: false, reason: 'duplicate-init' }
      }
      if (validateImportProbeInit(event).ok !== true) {
        return { passed: false, reason: 'probe-isolation' }
      }
      initSeen = true
      continue
    }
    if (event.type === 'assistant') {
      const content = event.message?.content
      if (Array.isArray(content) && content.some((item) => isPlainObject(item) && item.type === 'tool_use')) {
        return { passed: false, reason: 'tool-call' }
      }
    }
  }
  if (!initSeen) {
    return { passed: false, reason: 'missing-init' }
  }
  const results = events.filter((event) => event.type === 'result')
  if (results.length === 0) {
    return { passed: false, reason: 'missing-result' }
  }
  if (results.length > 1) {
    return { passed: false, reason: 'duplicate-result' }
  }
  if (!isPlainObject(results[0].structured_output)) {
    return { passed: false, reason: 'missing-structured-output' }
  }
  if (canonicalJson(results[0].structured_output) !== canonicalJson({ sentinel: expectedSentinel })) {
    return { passed: false, reason: 'structured-output-mismatch' }
  }

  return { passed: true }
}

module.exports = {
  CLAUDE_PUBLIC_SKILL_INVENTORY,
  createClaudeSessionConductor,
  createCodexTurnConductor,
  isHookEvent,
  parseHostEventLine,
  validateClaudeSessionInit,
  validateImportProbeInit,
  validateImportProbeSession,
  verifyTurnOutputEquality,
}
