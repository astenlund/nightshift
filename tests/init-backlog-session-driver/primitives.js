'use strict'

const { createHash } = require('node:crypto')

const { VERSION_CONTROL_OPTION_ORDER } = require('../../skills/init-backlog/lib/apply-request')

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

class OutputCapacityError extends Error {
  constructor({ limitName, observed }) {
    super(`output capacity exceeded: ${limitName} at ${observed}`)
    this.detailCode = 'output-capacity'
    this.limitName = limitName
    this.name = 'OutputCapacityError'
    this.observed = String(observed)
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

module.exports = {
  APPROVAL_BRANCHES,
  BYTE_BOUNDS,
  DEADLINES,
  HOSTS,
  INFRASTRUCTURE_DETAIL_CODES,
  INFRASTRUCTURE_PHASES,
  OutputCapacityError,
  POST_SESSION_ONLY_DETAIL_CODES,
  PRIMARY_INITIAL_CODES,
  PROCESS_ADAPTER_EVENTS,
  SESSION_FAILURE_CODES,
  VERSION_CONTROL_OPTION_ORDER,
  compareOrdinal,
  isPlainObject,
  sha256,
}
