'use strict'

const { createHash } = require('node:crypto')
const { isAbsolute } = require('node:path')
const { TextDecoder } = require('node:util')

const { InitBacklogError, SYSTEM_CODE_PATTERN, failureRecord, throwInitBacklogError } = require('./errors')

const MAX_INSPECT_REQUEST_BYTES = 65536
const MAX_INLINE_FILE_BYTES = 65536
const MAX_INSPECT_RESULT_BYTES = 262144
const MAX_APPLY_REQUEST_BYTES = 16777216
const MAX_RECOVERY_REQUEST_BYTES = 1114112
const MAX_APPLY_RESULT_BYTES = 1048576
const MAX_RECOVERY_RESULT_BYTES = 1048576
const MAX_CONFINED_PATH_BYTES = 4096

const LOGICAL_ID_PATTERN = /^(?=.{1,64}$)[a-z](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z](?:[a-z0-9-]*[a-z0-9])?)*$/
const ACTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const DIGEST_PATTERN = /^[a-f0-9]{64}$/
const NONCE_PATTERN = /^[a-f0-9]{32}$/
const RECOVERY_KINDS = ['abandoned-backup', 'election-marker', 'orphan-lock-stage', 'stale-owner', 'stale-recovery-gate']
const RECOVERY_DISPOSITION_ORDER = ['cleanup', 'deferred', 'track', 'ignore', 'abandon', 'restore', 'accept', 'remove']
const RECOVERY_LOCK_BASENAME = '.nightshift-init-backlog.lock'
const RECOVERY_GATE_BASENAME = '.nightshift-init-backlog.recovery-gate'
const RECOVERY_MARKER_BASENAME = '.nightshift-init-backlog-election'
const RECOVERY_BACKUP_PATTERN = /^\.tmp\/nightshift-init-backlog-unwrap-[a-f0-9]{64}-[a-f0-9]{64}-[a-f0-9]{64}\.bak$/
const RECOVERY_LOCK_STAGE_PATTERN = /^\.nightshift-init-backlog\.lock\.[1-9][0-9]*\.[a-f0-9]{32}\.new$/

const OPERATIONS = ['apply', 'inspect', 'recover-apply', 'recover-inspect']
const PHASES = ['decode', 'resolve', 'inspect', 'lock', 'prevalidate', 'publish', 'verify', 'restore', 'cleanup']
const FAILURE_CODES = [
  'cleanup-failed',
  'content-invalid',
  'filesystem',
  'git-policy',
  'guidance-resolution',
  'invalid-json',
  'invalid-request',
  'invalid-target',
  'manifest-invalid',
  'payload-too-large',
  'ready-delta',
  'ready-failed',
  'recovery-invalid',
  'restore-failed',
  'runtime-lock',
  'runtime-marker',
  'snapshot-drift',
  'template-invalid',
]
const PHASE_CODE_ORDER = {
  cleanup: ['cleanup-failed'],
  decode: ['payload-too-large', 'invalid-json', 'invalid-request'],
  inspect: ['template-invalid', 'payload-too-large', 'content-invalid', 'git-policy', 'filesystem', 'ready-failed', 'snapshot-drift', 'invalid-target', 'runtime-marker'],
  lock: ['runtime-lock'],
  prevalidate: ['invalid-target', 'manifest-invalid', 'recovery-invalid', 'snapshot-drift', 'payload-too-large'],
  publish: ['filesystem'],
  resolve: ['guidance-resolution'],
  restore: ['restore-failed'],
  verify: ['ready-failed', 'ready-delta'],
}

function compareOrdinal(left, right) {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0))
  const rightPoints = Array.from(right, (character) => character.codePointAt(0))
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] < rightPoints[index] ? -1 : 1
    }
  }

  return leftPoints.length < rightPoints.length ? -1 : leftPoints.length > rightPoints.length ? 1 : 0
}

function canonicalize(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError('Canonical JSON permits only safe integers')
    }

    return value
  }
  if (typeof value !== 'object') {
    throw new TypeError('Canonical JSON value is unsupported')
  }
  if (ancestors.has(value)) {
    throw new TypeError('Canonical JSON cannot contain cycles')
  }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const result = []
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError('Canonical JSON arrays cannot be sparse')
        }
        result.push(canonicalize(value[index], ancestors))
      }
      const extraKeys = Object.keys(value).filter((key) => !/^(?:0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)
      if (extraKeys.length !== 0) {
        throw new TypeError('Canonical JSON arrays cannot have named properties')
      }

      return result
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('Canonical JSON objects must be plain')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const keys = Object.keys(value).sort(compareOrdinal)
    const result = {}
    for (const key of keys) {
      const descriptor = descriptors[key]
      if (descriptor === undefined || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError('Canonical JSON objects must contain enumerable data properties')
      }
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: canonicalize(descriptor.value, ancestors),
        writable: true,
      })
    }

    return result
  } finally {
    ancestors.delete(value)
  }
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value))
}

function canonicalBytes(value) {
  return Buffer.from(canonicalJson(value), 'utf8')
}

function buildRecoveryApplyRequest(request, recoveryInspection, disposition) {
  return { disposition, host: request.host, hostContext: request.hostContext, operation: 'recover-apply', protocolVersion: 1, recoveryInspection, root: request.root }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function sameKeys(actual, expected) {
  if (!isPlainObject(actual)) {
    return false
  }
  const actualKeys = Object.keys(actual).sort(compareOrdinal)
  const expectedKeys = [...expected].sort(compareOrdinal)

  return actualKeys.length === expectedKeys.length && actualKeys.every((key, index) => key === expectedKeys[index])
}

function invalid(code, phase, detail, fields = {}) {
  throwInitBacklogError({ code, detail, phase, ...fields })
}

function requireRecord(value, keys, label, code = 'invalid-request', phase = 'decode') {
  if (!sameKeys(value, keys)) {
    invalid(code, phase, `${label} has an invalid record shape.`)
  }

  return value
}

function requireString(value, label, options = {}) {
  if (typeof value !== 'string' || (options.nonblank === true && value.length === 0) || (options.values !== undefined && !options.values.includes(value))) {
    invalid(options.code ?? 'invalid-request', options.phase ?? 'decode', `${label} is invalid.`)
  }
  if (options.maxBytes !== undefined && Buffer.byteLength(value, 'utf8') > options.maxBytes) {
    invalid(options.code ?? 'invalid-request', options.phase ?? 'decode', `${label} is too large.`)
  }

  return value
}

function requireBoolean(value, label, options = {}) {
  if (typeof value !== 'boolean') {
    invalid(options.code ?? 'invalid-request', options.phase ?? 'decode', `${label} is invalid.`)
  }

  return value
}

function requireSafeInteger(value, label, options = {}) {
  if (!Number.isSafeInteger(value) || (options.minimum !== undefined && value < options.minimum) || (options.maximum !== undefined && value > options.maximum)) {
    invalid(options.code ?? 'invalid-request', options.phase ?? 'decode', `${label} is invalid.`)
  }

  return value
}

function requireNullable(value, validator) {
  if (value === null) {
    return null
  }

  return validator(value)
}

function requireArray(value, label, itemValidator, options = {}) {
  if (!Array.isArray(value)) {
    invalid(options.code ?? 'invalid-request', options.phase ?? 'decode', `${label} is invalid.`)
  }
  value.forEach((item, index) => itemValidator(item, index))
  if (options.uniqueBy !== undefined) {
    const seen = new Set()
    for (const item of value) {
      const key = options.uniqueBy(item)
      if (seen.has(key)) {
        invalid(options.code ?? 'invalid-request', options.phase ?? 'decode', `${label} contains a duplicate.`)
      }
      seen.add(key)
    }
  }
  if (options.ordinalBy !== undefined) {
    const keys = value.map(options.ordinalBy)
    for (let index = 1; index < keys.length; index += 1) {
      if (compareOrdinal(keys[index - 1], keys[index]) >= 0) {
        invalid(options.code ?? 'invalid-request', options.phase ?? 'decode', `${label} is not ordinal sorted.`)
      }
    }
  }

  return value
}

function recoveryTargetMatches(kind, target) {
  if (kind === 'stale-owner') return target === RECOVERY_LOCK_BASENAME
  if (kind === 'stale-recovery-gate') return target === RECOVERY_GATE_BASENAME
  if (kind === 'election-marker') return target === RECOVERY_MARKER_BASENAME
  if (kind === 'orphan-lock-stage') return RECOVERY_LOCK_STAGE_PATTERN.test(target)
  if (kind === 'abandoned-backup') return RECOVERY_BACKUP_PATTERN.test(target)

  return false
}

function recoveryAllowedDispositions(kind, evidence) {
  if (kind === 'stale-owner' || kind === 'stale-recovery-gate') return ['cleanup']
  if (kind === 'orphan-lock-stage') return ['remove']
  if (kind === 'election-marker') return evidence.marker.classification === 'invalid' && evidence.marker.gitKind === 'git' ? ['deferred', 'track', 'ignore', 'abandon'] : ['abandon']
  if (kind === 'abandoned-backup') return evidence.backup.classification === 'divergent' ? ['restore', 'accept'] : ['remove']

  throw new TypeError('Recovery evidence kind is invalid')
}

function assertSafeWindowsScalar(value, platform = process.platform) {
  if (platform === 'win32' && typeof value === 'string') {
    for (const character of value) {
      if (character.codePointAt(0) === 0x10ffff) {
        throw new TypeError('Windows path contains an unsafe scalar')
      }
    }
  }

  return value
}

function validateLogicalId(value) {
  if (typeof value !== 'string' || !LOGICAL_ID_PATTERN.test(value)) {
    throw new TypeError('Logical identifier is invalid')
  }

  return value
}

function validateDigest(value) {
  if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
    throw new TypeError('Digest is invalid')
  }

  return value
}

function validateNonce(value) {
  if (typeof value !== 'string' || !NONCE_PATTERN.test(value)) {
    throw new TypeError('Nonce is invalid')
  }

  return value
}

function validateTarget(value, options = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Target is invalid')
  }
  assertSafeWindowsScalar(value, options.platform)
  if (Buffer.byteLength(value, 'utf8') > MAX_CONFINED_PATH_BYTES || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    throw new TypeError('Target is invalid')
  }
  const segments = value.split('/')
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    throw new TypeError('Target is invalid')
  }

  return value
}

function validateSelector(value) {
  if (value === '@resolved-guidance') {
    return value
  }

  return validateTarget(value)
}

function validateAbsoluteRoot(value, options = {}) {
  try {
    requireString(value, 'root', { maxBytes: MAX_CONFINED_PATH_BYTES, nonblank: true })
    assertSafeWindowsScalar(value, options.platform)
  } catch {
    invalid('invalid-request', 'decode', 'Repository root is invalid.')
  }
  if (!isAbsolute(value)) {
    invalid('invalid-request', 'decode', 'Repository root is invalid.')
  }

  return value
}

function validateBase64(value, maximumBytes = MAX_INLINE_FILE_BYTES) {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new TypeError('Base64 value is invalid')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value || bytes.length > maximumBytes) {
    throw new TypeError('Base64 value is invalid')
  }

  return bytes
}

function validateHostContext(value, host, options = {}) {
  requireRecord(value, ['claudeRootExclusionStatus', 'claudeContextSource', 'codexProjectInstructions', 'codexProjectDocMaxBytes', 'codexInvocationDirectory', 'codexContextSource'], 'hostContext')
  if (host === 'claude-code') {
    const validPairs = (value.claudeRootExclusionStatus === 'included' && value.claudeContextSource === 'host-observed') || (value.claudeRootExclusionStatus === 'unexcluded-missing' && value.claudeContextSource === 'user-confirmed')
    if (!validPairs || !Array.isArray(value.codexProjectInstructions) || value.codexProjectInstructions.length !== 0 || value.codexProjectDocMaxBytes !== null || value.codexInvocationDirectory !== null || value.codexContextSource !== null) {
      invalid('invalid-request', 'decode', 'Claude host context is invalid.')
    }
  } else if (host === 'codex') {
    if (value.claudeRootExclusionStatus !== null || value.claudeContextSource !== null || value.codexContextSource !== 'user-confirmed' || !Number.isSafeInteger(value.codexProjectDocMaxBytes) || value.codexProjectDocMaxBytes <= 0) {
      invalid('invalid-request', 'decode', 'Codex host context is invalid.')
    }
    requireArray(value.codexProjectInstructions, 'codexProjectInstructions', (item) => {
      requireString(item, 'Codex fallback basename', { nonblank: true })
      assertSafeWindowsScalar(item, options.platform)
      if (item === '.' || item === '..' || item.includes('/') || item.includes('\\') || /^[A-Za-z]:/.test(item)) {
        invalid('invalid-request', 'decode', 'Codex fallback basename is invalid.')
      }
    }, { uniqueBy: (item) => item })
    if (value.codexInvocationDirectory !== '.') {
      try {
        validateTarget(value.codexInvocationDirectory, options)
      } catch {
        invalid('invalid-request', 'decode', 'Codex invocation directory is invalid.')
      }
    }
  } else {
    invalid('invalid-request', 'decode', 'Host is invalid.')
  }

  return value
}

function validateMode(value) {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 4095)) {
    throw new TypeError('Mode is invalid')
  }

  return value
}

function validateAction(value, code = 'invalid-request', phase = 'decode') {
  if (!isPlainObject(value) || typeof value.kind !== 'string') {
    invalid(code, phase, 'Action is invalid.')
  }
  const keysByKind = {
    'create-from-template': ['id', 'kind', 'target', 'templateId', 'newline', 'mode'],
    'ensure-directory': ['id', 'kind', 'target', 'mode'],
    'exact-edit': ['id', 'kind', 'target', 'regionId', 'beforeBase64', 'afterBase64'],
    'unwrap-file': ['id', 'kind', 'target', 'beforeRawSha256', 'afterRawSha256', 'mode'],
  }
  const keys = keysByKind[value.kind]
  if (keys === undefined || !sameKeys(value, keys) || typeof value.id !== 'string' || !ACTION_ID_PATTERN.test(value.id)) {
    invalid(code, phase, 'Action is invalid.')
  }
  try {
    validateTarget(value.target)
    if (value.kind === 'ensure-directory') {
      validateMode(value.mode)
    } else if (value.kind === 'create-from-template') {
      validateLogicalId(value.templateId)
      if (![null, 'crlf', 'lf'].includes(value.newline)) {
        throw new TypeError('Newline is invalid')
      }
      validateMode(value.mode)
    } else if (value.kind === 'exact-edit') {
      validateLogicalId(value.regionId)
      validateBase64(value.beforeBase64)
      validateBase64(value.afterBase64)
    } else {
      validateDigest(value.beforeRawSha256)
      validateDigest(value.afterRawSha256)
      validateMode(value.mode)
    }
  } catch {
    invalid(code, phase, 'Action is invalid.', { actionId: value.id })
  }

  return value
}

function validateProblem(value) {
  requireRecord(value, ['code', 'target', 'evidencePaths', 'detail', 'blocking'], 'problem')
  requireString(value.code, 'problem code', { values: ['git-policy', 'legacy-history-migration', 'ready-notice', 'ready-structural', 'runtime-state'] })
  requireNullable(value.target, validateTarget)
  requireArray(value.evidencePaths, 'evidence paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  requireString(value.detail, 'problem detail', { maxBytes: 4096, nonblank: true })
  requireBoolean(value.blocking, 'problem blocking')
  const expectedBlocking = !['legacy-history-migration', 'ready-notice'].includes(value.code)
  if (value.blocking !== expectedBlocking) {
    invalid('invalid-request', 'decode', 'Problem blocking value is invalid.')
  }
}

function validateWarning(value) {
  requireRecord(value, ['code', 'target', 'detail'], 'warning')
  requireString(value.code, 'warning code', { values: ['external-writer-window', 'manual-cleanup', 'nonblocking-ready-notice', 'runtime-support-created'] })
  requireNullable(value.target, validateTarget)
  requireString(value.detail, 'warning detail', { maxBytes: 4096, nonblank: true })
}

function validateGuidance(value) {
  requireRecord(value, ['candidates', 'baseAdapter', 'resolvedTarget', 'graphPaths', 'independentPaths', 'imports'], 'guidance')
  requireArray(value.candidates, 'guidance candidates', validateTarget)
  requireNullable(value.baseAdapter, validateTarget)
  validateTarget(value.resolvedTarget)
  requireArray(value.graphPaths, 'guidance graph paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  requireArray(value.independentPaths, 'guidance independent paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  requireArray(value.imports, 'guidance imports', (item) => {
    requireRecord(item, ['source', 'target', 'adapterCandidate'], 'guidance import')
    validateTarget(item.source)
    validateTarget(item.target)
    requireBoolean(item.adapterCandidate, 'adapterCandidate')
  }, { ordinalBy: (item) => `${item.source}\0${item.target}`, uniqueBy: (item) => `${item.source}\0${item.target}` })
}

function validateGit(value) {
  requireRecord(value, ['kind', 'objectFormat', 'freshScaffold', 'plansPolicy', 'trackedPlanPaths', 'trackedBacklogPaths', 'nonPlanIgnoreMatches', 'nonPlanUnignoredPaths', 'electionRequired', 'electionMarker', 'electionMarkerSnapshotId', 'electionMarkerMode', 'newlinePolicies'], 'git')
  requireString(value.kind, 'git kind', { values: ['git', 'non-git'] })
  if (value.objectFormat !== null) {
    requireString(value.objectFormat, 'object format', { values: ['sha1', 'sha256'] })
  }
  requireBoolean(value.freshScaffold, 'freshScaffold')
  requireString(value.plansPolicy, 'plansPolicy', { values: ['action-required', 'nested-conflict', 'not-applicable', 'satisfied', 'tracked-conflict'] })
  requireArray(value.trackedPlanPaths, 'tracked plan paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  requireArray(value.trackedBacklogPaths, 'tracked backlog paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  requireArray(value.nonPlanIgnoreMatches, 'non-plan ignore matches', (item) => {
    requireRecord(item, ['target', 'probe', 'sourcePath', 'pattern'], 'non-plan ignore match')
    validateTarget(item.target)
    validateTarget(item.probe)
    validateTarget(item.sourcePath)
    requireString(item.pattern, 'ignore pattern', { maxBytes: 4096, nonblank: true })
  })
  requireArray(value.nonPlanUnignoredPaths, 'non-plan unignored paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  requireBoolean(value.electionRequired, 'electionRequired')
  requireString(value.electionMarker, 'election marker', { values: ['absent', 'deferred', 'ignore', 'track'] })
  requireNullable(value.electionMarkerSnapshotId, validateDigest)
  validateMode(value.electionMarkerMode)
  requireArray(value.newlinePolicies, 'newline policies', (item) => {
    requireRecord(item, ['target', 'source', 'style', 'mode'], 'newline policy')
    validateTarget(item.target)
    requireString(item.source, 'newline source', { values: ['choice', 'git', 'platform', 'siblings'] })
    requireString(item.style, 'newline style', { values: ['choice-required', 'crlf', 'lf'] })
    validateMode(item.mode)
  }, { ordinalBy: (item) => item.target, uniqueBy: (item) => item.target })
}

function validateInspectSuccess(value) {
  requireRecord(value, ['ok', 'protocolVersion', 'operation', 'root', 'host', 'hostContext', 'snapshotId', 'guidance', 'git', 'templates', 'targets', 'wrapFindings', 'proposals', 'ready', 'unwrapReady', 'problems', 'warnings', 'retainedBackups'], 'inspect result')
  if (value.ok !== true || value.protocolVersion !== 1 || value.operation !== 'inspect') {
    invalid('invalid-request', 'decode', 'Inspect result is invalid.')
  }
  validateAbsoluteRoot(value.root)
  requireString(value.host, 'host', { values: ['claude-code', 'codex'] })
  validateHostContext(value.hostContext, value.host)
  validateDigest(value.snapshotId)
  validateGuidance(value.guidance)
  validateGit(value.git)
  requireArray(value.templates, 'templates', (item) => {
    requireRecord(item, ['templateId', 'target', 'logicalSha256', 'conceptIds'], 'template item')
    validateLogicalId(item.templateId)
    validateTarget(item.target)
    validateDigest(item.logicalSha256)
    requireArray(item.conceptIds, 'template concepts', validateLogicalId, { ordinalBy: (entry) => entry, uniqueBy: (entry) => entry })
  }, { ordinalBy: (item) => item.templateId, uniqueBy: (item) => item.templateId })
  requireArray(value.targets, 'targets', (item) => {
    requireRecord(item, ['target', 'kind', 'states', 'contentRole', 'contentBase64', 'rawSha256', 'cleanTextSha256', 'mode', 'templateId', 'templateSha256', 'newline', 'bom', 'finalNewline', 'editableRegions'], 'target item')
    validateTarget(item.target)
    requireString(item.kind, 'target kind', { values: ['directory', 'file'] })
    requireArray(item.states, 'target states', (entry) => requireString(entry, 'target state', { values: ['exact-template', 'missing', 'present', 'structurally-invalid', 'wrapped'] }), { uniqueBy: (entry) => entry })
    const stateKey = item.states.join(',')
    const validFileStates = ['missing', 'present', 'present,exact-template', 'present,wrapped', 'present,structurally-invalid', 'present,wrapped,structurally-invalid']
    const validDirectoryStates = ['missing', 'present']
    if (!(item.kind === 'file' ? validFileStates : validDirectoryStates).includes(stateKey)) {
      invalid('invalid-request', 'decode', 'Target state combination is invalid.')
    }
    requireString(item.contentRole, 'content role', { values: ['mechanical', 'none', 'semantic'] })
    requireNullable(item.contentBase64, validateBase64)
    requireNullable(item.rawSha256, validateDigest)
    requireNullable(item.cleanTextSha256, validateDigest)
    validateMode(item.mode)
    requireNullable(item.templateId, validateLogicalId)
    requireNullable(item.templateSha256, validateDigest)
    if (item.newline !== null) {
      requireString(item.newline, 'newline', { values: ['crlf', 'lf', 'none'] })
    }
    if (item.bom !== null) {
      requireBoolean(item.bom, 'bom')
    }
    if (item.finalNewline !== null) {
      requireBoolean(item.finalNewline, 'finalNewline')
    }
    requireArray(item.editableRegions, 'editable regions', (entry) => {
      requireRecord(entry, ['regionId', 'startByte', 'endByte'], 'editable region')
      validateLogicalId(entry.regionId)
      requireSafeInteger(entry.startByte, 'region start', { minimum: 0 })
      requireSafeInteger(entry.endByte, 'region end', { minimum: entry.startByte })
    }, { ordinalBy: (entry) => entry.regionId, uniqueBy: (entry) => entry.regionId })
  }, { ordinalBy: (item) => item.target, uniqueBy: (item) => item.target })
  requireArray(value.wrapFindings, 'wrap findings', (item) => {
    requireRecord(item, ['target', 'count', 'firstLine', 'beforeRawSha256', 'predictedRawSha256', 'predictedContentBase64', 'predictedEditableRegions'], 'wrap finding')
    validateTarget(item.target)
    requireSafeInteger(item.count, 'wrap count', { minimum: 1 })
    requireSafeInteger(item.firstLine, 'first line', { minimum: 1 })
    validateDigest(item.beforeRawSha256)
    validateDigest(item.predictedRawSha256)
    requireNullable(item.predictedContentBase64, validateBase64)
    requireArray(item.predictedEditableRegions, 'predicted regions', (entry) => {
      requireRecord(entry, ['regionId', 'startByte', 'endByte'], 'predicted region')
      validateLogicalId(entry.regionId)
      requireSafeInteger(entry.startByte, 'region start', { minimum: 0 })
      requireSafeInteger(entry.endByte, 'region end', { minimum: entry.startByte })
    }, { ordinalBy: (entry) => entry.regionId, uniqueBy: (entry) => entry.regionId })
  }, { ordinalBy: (item) => item.target, uniqueBy: (item) => item.target })
  requireArray(value.proposals, 'proposals', (item) => {
    requireRecord(item, ['proposalId', 'reason', 'condition', 'action', 'beforeBase64', 'afterBase64'], 'proposal')
    if (typeof item.proposalId !== 'string' || !/^p-[a-f0-9]{62}$/.test(item.proposalId)) {
      invalid('invalid-request', 'decode', 'Proposal ID is invalid.')
    }
    requireString(item.reason, 'proposal reason', { values: ['elective-ignore', 'empty-target', 'guidance-section', 'hard-wrap', 'missing-target', 'plans-policy'] })
    requireString(item.condition, 'proposal condition', { values: ['always', 'newline-crlf', 'newline-lf', 'version-control-ignore'] })
    validateAction(item.action)
    requireNullable(item.beforeBase64, validateBase64)
    requireNullable(item.afterBase64, validateBase64)
  }, { ordinalBy: (item) => item.proposalId, uniqueBy: (item) => item.proposalId })
  canonicalJson(value.ready)
  requireRecord(value.unwrapReady, ['targets', 'after'], 'unwrapReady')
  requireArray(value.unwrapReady.targets, 'unwrap targets', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  canonicalJson(value.unwrapReady.after)
  requireArray(value.problems, 'problems', validateProblem)
  requireArray(value.warnings, 'warnings', validateWarning, { ordinalBy: (item) => item.code, uniqueBy: (item) => item.code })
  requireArray(value.retainedBackups, 'retained backups', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })

  return value
}

function validateRecoveryInspection(value) {
  requireRecord(value, ['ok', 'protocolVersion', 'operation', 'root', 'host', 'hostContext', 'recoveryId', 'recoveryKind', 'recoveryTarget', 'evidence', 'allowedDispositions'], 'recovery inspection')
  if (value.ok !== true || value.protocolVersion !== 1 || value.operation !== 'recover-inspect') {
    invalid('invalid-request', 'decode', 'Recovery inspection is invalid.')
  }
  validateAbsoluteRoot(value.root)
  requireString(value.host, 'host', { values: ['claude-code', 'codex'] })
  validateHostContext(value.hostContext, value.host)
  validateDigest(value.recoveryId)
  requireString(value.recoveryKind, 'recovery kind', { values: RECOVERY_KINDS })
  validateTarget(value.recoveryTarget)
  requireRecord(value.evidence, ['owner', 'lockStage', 'recoveryGate', 'marker', 'backup'], 'recovery evidence')
  const present = Object.values(value.evidence).filter((item) => item !== null)
  if (present.length !== 1) {
    invalid('recovery-invalid', 'prevalidate', 'Recovery evidence must contain exactly one member.')
  }
  if (value.evidence.lockStage !== null) {
    const item = value.evidence.lockStage
    requireRecord(item, ['pid', 'ownerNonce', 'pidStatus', 'rawSha256', 'mode', 'record'], 'lock stage evidence')
    requireSafeInteger(item.pid, 'pid', { minimum: 1 })
    validateNonce(item.ownerNonce)
    requireString(item.pidStatus, 'pid status', { values: ['absent'] })
    validateDigest(item.rawSha256)
    validateMode(item.mode)
    if (item.record !== null) {
      validateOwnerRecord(item.record)
    }
  }
  if (value.evidence.owner !== null) {
    const item = value.evidence.owner
    requireRecord(item, ['rawSha256', 'mode', 'record', 'pidStatus', 'temporaryStates', 'directoryStates', 'retainedBackups'], 'owner evidence')
    validateDigest(item.rawSha256)
    validateMode(item.mode)
    validateOwnerRecord(item.record)
    requireString(item.pidStatus, 'pid status', { values: ['absent'] })
    requireArray(item.temporaryStates, 'temporary states', (entry) => {
      requireRecord(entry, ['target', 'present', 'rawSha256', 'mode'], 'temporary state')
      validateTarget(entry.target)
      requireBoolean(entry.present, 'temporary present')
      requireNullable(entry.rawSha256, validateDigest)
      validateMode(entry.mode)
    })
    requireArray(item.directoryStates, 'directory states', (entry) => {
      requireRecord(entry, ['target', 'present', 'mode'], 'directory state')
      validateTarget(entry.target)
      requireBoolean(entry.present, 'directory present')
      validateMode(entry.mode)
    })
    requireArray(item.retainedBackups, 'retained backups', validateTarget, { ordinalBy: (entry) => entry, uniqueBy: (entry) => entry })
  }
  if (value.evidence.recoveryGate !== null) {
    const item = value.evidence.recoveryGate
    requireRecord(item, ['mode', 'ownerName', 'ownerRawSha256', 'ownerMode', 'ownerStageRawSha256', 'ownerStageMode', 'record', 'pidStatus'], 'recovery gate evidence')
    validateMode(item.mode)
    if (item.ownerName !== null) {
      requireString(item.ownerName, 'owner name', { values: ['owner.json'] })
    }
    requireNullable(item.ownerRawSha256, validateDigest)
    validateMode(item.ownerMode)
    requireNullable(item.ownerStageRawSha256, validateDigest)
    validateMode(item.ownerStageMode)
    if (item.record !== null) {
      validateOwnerRecord(item.record)
    }
    if (item.pidStatus !== null) {
      requireString(item.pidStatus, 'pid status', { values: ['absent'] })
    }
  }
  if (value.evidence.marker !== null) {
    const item = value.evidence.marker
    requireRecord(item, ['rawSha256', 'mode', 'contentBase64', 'classification', 'gitKind', 'scaffoldPresent', 'policyDigest'], 'marker evidence')
    validateDigest(item.rawSha256)
    validateMode(item.mode)
    validateBase64(item.contentBase64)
    requireString(item.classification, 'marker classification', { values: ['invalid', 'valid-non-git'] })
    requireString(item.gitKind, 'git kind', { values: ['git', 'non-git'] })
    requireBoolean(item.scaffoldPresent, 'scaffoldPresent')
    validateDigest(item.policyDigest)
  }
  if (value.evidence.backup !== null) {
    const item = value.evidence.backup
    requireRecord(item, ['classification', 'backupRawSha256', 'backupMode', 'backupContentBase64', 'currentTarget', 'currentRawSha256', 'currentMode', 'currentContentBase64'], 'backup evidence')
    requireString(item.classification, 'backup classification', { values: ['divergent', 'orphan', 'redundant'] })
    validateDigest(item.backupRawSha256)
    validateMode(item.backupMode)
    validateBase64(item.backupContentBase64)
    requireNullable(item.currentTarget, validateTarget)
    requireNullable(item.currentRawSha256, validateDigest)
    validateMode(item.currentMode)
    requireNullable(item.currentContentBase64, validateBase64)
  }
  requireArray(value.allowedDispositions, 'allowed dispositions', (item) => requireString(item, 'disposition', { values: RECOVERY_DISPOSITION_ORDER }), { uniqueBy: (item) => item })
  let last = -1
  for (const disposition of value.allowedDispositions) {
    const position = RECOVERY_DISPOSITION_ORDER.indexOf(disposition)
    if (position <= last) {
      invalid('invalid-request', 'decode', 'Allowed dispositions are not ordered.')
    }
    last = position
  }

  const expectedEvidence = {
    'abandoned-backup': 'backup',
    'election-marker': 'marker',
    'orphan-lock-stage': 'lockStage',
    'stale-owner': 'owner',
    'stale-recovery-gate': 'recoveryGate',
  }[value.recoveryKind]
  if (!recoveryTargetMatches(value.recoveryKind, value.recoveryTarget)) {
    invalid('recovery-invalid', 'prevalidate', 'Recovery target does not match its recovery kind.', { target: value.recoveryTarget })
  }
  if (value.evidence[expectedEvidence] === null || Object.keys(value.evidence).some((key) => key !== expectedEvidence && value.evidence[key] !== null)) {
    invalid('recovery-invalid', 'prevalidate', 'Recovery evidence does not match its recovery kind.', { target: value.recoveryTarget })
  }
  const evidence = value.evidence[expectedEvidence]
  if (value.recoveryKind === 'stale-owner' && (!OPERATIONS.includes(evidence.record.operation) || evidence.record.root !== value.root)) {
    invalid('recovery-invalid', 'prevalidate', 'Publication lock evidence is invalid.', { target: value.recoveryTarget })
  }
  if (value.recoveryKind === 'orphan-lock-stage' && evidence.record !== null && (!OPERATIONS.includes(evidence.record.operation) || evidence.record.root !== value.root || evidence.record.pid !== evidence.pid || evidence.record.ownerNonce !== evidence.ownerNonce)) {
    invalid('recovery-invalid', 'prevalidate', 'Lock stage evidence is invalid.', { target: value.recoveryTarget })
  }
  if (value.recoveryKind === 'stale-recovery-gate') {
    const empty = evidence.ownerName === null && evidence.ownerRawSha256 === null && evidence.ownerMode === null && evidence.ownerStageRawSha256 === null && evidence.ownerStageMode === null && evidence.record === null && evidence.pidStatus === null
    const stageOnly = evidence.ownerName === null && evidence.ownerRawSha256 === null && evidence.ownerMode === null && evidence.ownerStageRawSha256 !== null && evidence.ownerStageMode !== null && evidence.record === null && evidence.pidStatus === null
    const ownerOnly = evidence.ownerName === 'owner.json' && evidence.ownerRawSha256 !== null && evidence.ownerMode !== null && evidence.ownerStageRawSha256 === null && evidence.ownerStageMode === null && evidence.record !== null && evidence.pidStatus === 'absent'
    const ownerPair = evidence.ownerName === 'owner.json' && evidence.ownerRawSha256 !== null && evidence.ownerMode !== null && evidence.ownerStageRawSha256 !== null && evidence.ownerStageMode !== null && evidence.record !== null && evidence.pidStatus === 'absent'
    if (!(empty || stageOnly || ownerOnly || ownerPair) || evidence.record !== null && (evidence.record.operation !== 'recover-apply' || evidence.record.root !== value.root)) {
      invalid('recovery-invalid', 'prevalidate', 'Recovery gate evidence is invalid.', { target: value.recoveryTarget })
    }
  }
  if (value.recoveryKind === 'election-marker' && !((evidence.classification === 'invalid' && ['git', 'non-git'].includes(evidence.gitKind)) || (evidence.classification === 'valid-non-git' && evidence.gitKind === 'non-git'))) {
    invalid('recovery-invalid', 'prevalidate', 'Election marker classification is invalid.', { target: value.recoveryTarget })
  }
  if (value.recoveryKind === 'abandoned-backup') {
    const orphan = evidence.classification === 'orphan' && evidence.currentTarget === null && evidence.currentRawSha256 === null && evidence.currentMode === null && evidence.currentContentBase64 === null
    const present = evidence.classification !== 'orphan' && evidence.currentTarget !== null && evidence.currentRawSha256 !== null && evidence.currentContentBase64 !== null
    if (!(orphan || present)) {
      invalid('recovery-invalid', 'prevalidate', 'Backup evidence classification is invalid.', { target: value.recoveryTarget })
    }
    if (evidence.classification === 'redundant' && (evidence.currentRawSha256 !== evidence.backupRawSha256 || evidence.currentMode !== evidence.backupMode)) {
      invalid('recovery-invalid', 'prevalidate', 'Redundant backup evidence is invalid.', { target: value.recoveryTarget })
    }
    if (evidence.classification === 'divergent' && evidence.currentRawSha256 === evidence.backupRawSha256 && evidence.currentMode === evidence.backupMode) {
      invalid('recovery-invalid', 'prevalidate', 'Divergent backup evidence is invalid.', { target: value.recoveryTarget })
    }
  }
  const expectedDispositions = recoveryAllowedDispositions(value.recoveryKind, value.evidence)
  if (canonicalJson(value.allowedDispositions) !== canonicalJson(expectedDispositions)) {
    invalid('recovery-invalid', 'prevalidate', 'Recovery dispositions are not legal for its evidence.', { target: value.recoveryTarget })
  }

  return value
}

function validateOwnerRecord(value) {
  requireRecord(value, ['protocolVersion', 'operation', 'pid', 'ownerNonce', 'root', 'createdAtUnixMs', 'manifestId', 'recoveryId', 'temporaryPaths', 'unfinalizedDirectories'], 'owner record')
  if (value.protocolVersion !== 1) {
    invalid('invalid-request', 'decode', 'Owner record is invalid.')
  }
  requireString(value.operation, 'owner operation', { values: OPERATIONS })
  requireSafeInteger(value.pid, 'owner pid', { minimum: 1 })
  validateNonce(value.ownerNonce)
  validateAbsoluteRoot(value.root)
  requireSafeInteger(value.createdAtUnixMs, 'owner creation time', { minimum: 0 })
  requireNullable(value.manifestId, validateDigest)
  requireNullable(value.recoveryId, validateDigest)
  if (['inspect', 'recover-inspect'].includes(value.operation) && (value.manifestId !== null || value.recoveryId !== null) || value.operation === 'apply' && value.recoveryId !== null || value.operation === 'recover-apply' && (value.manifestId !== null || value.recoveryId === null)) {
    invalid('recovery-invalid', 'prevalidate', 'Owner record identity fields do not match its operation.')
  }
  requireArray(value.temporaryPaths, 'temporary paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  requireArray(value.unfinalizedDirectories, 'unfinalized directories', (item) => {
    requireRecord(item, ['target', 'mode'], 'unfinalized directory')
    validateTarget(item.target)
    validateMode(item.mode)
  }, { ordinalBy: (item) => item.target, uniqueBy: (item) => item.target })
}

function validateFailure(value) {
  requireRecord(value, ['ok', 'protocolVersion', 'operation', 'phase', 'actionId', 'target', 'code', 'systemCode', 'detail', 'manifestId', 'outcomes', 'recovery'], 'failure result')
  if (value.ok !== false || value.protocolVersion !== 1) {
    throw new TypeError('Failure result is invalid')
  }
  if (value.operation !== null) {
    requireString(value.operation, 'operation', { values: OPERATIONS })
  }
  requireString(value.phase, 'phase', { values: PHASES })
  if (value.actionId !== null && (typeof value.actionId !== 'string' || !ACTION_ID_PATTERN.test(value.actionId))) {
    throw new TypeError('Failure action ID is invalid')
  }
  requireNullable(value.target, validateTarget)
  requireString(value.code, 'failure code', { values: FAILURE_CODES })
  if (!(PHASE_CODE_ORDER[value.phase] ?? []).includes(value.code)) {
    throw new TypeError('Failure code and phase do not match')
  }
  if (value.systemCode !== null && (typeof value.systemCode !== 'string' || !SYSTEM_CODE_PATTERN.test(value.systemCode))) {
    throw new TypeError('Failure system code is invalid')
  }
  requireString(value.detail, 'failure detail', { maxBytes: 4096, nonblank: true })
  requireNullable(value.manifestId, validateDigest)
  requireArray(value.outcomes, 'outcomes', validateOutcome)
  validateRecovery(value.recovery)

  return value
}

function validateOutcome(value) {
  requireRecord(value, ['actionId', 'target', 'status'], 'outcome')
  if (typeof value.actionId !== 'string' || !ACTION_ID_PATTERN.test(value.actionId)) {
    invalid('invalid-request', 'decode', 'Outcome action ID is invalid.')
  }
  validateTarget(value.target)
  requireString(value.status, 'outcome status', { values: ['created', 'edited', 'skipped-complete', 'unwrapped'] })
}

function validateRecovery(value) {
  requireRecord(value, ['status', 'retainedBackups', 'warnings'], 'recovery')
  requireString(value.status, 'recovery status', { values: ['cleanup-failed', 'none', 'restore-failed', 'restored'] })
  requireArray(value.retainedBackups, 'recovery backups', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
  requireArray(value.warnings, 'recovery warnings', validateWarning, { ordinalBy: (item) => item.code, uniqueBy: (item) => item.code })
}

function validateRequestRecord(value, options = {}) {
  if (!isPlainObject(value) || typeof value.operation !== 'string' || !OPERATIONS.includes(value.operation)) {
    invalid('invalid-request', 'decode', 'Request operation is invalid.')
  }
  const keys = {
    apply: ['protocolVersion', 'operation', 'root', 'host', 'hostContext', 'inspection', 'versionControlChoice', 'semanticDecisions', 'proposalDispositions', 'actions'],
    inspect: ['protocolVersion', 'operation', 'root', 'host', 'hostContext'],
    'recover-apply': ['protocolVersion', 'operation', 'root', 'host', 'hostContext', 'recoveryInspection', 'disposition'],
    'recover-inspect': ['protocolVersion', 'operation', 'root', 'host', 'hostContext', 'recoveryKind', 'recoveryTarget'],
  }[value.operation]
  requireRecord(value, keys, 'request')
  if (value.protocolVersion !== 1) {
    invalid('invalid-request', 'decode', 'Protocol version is invalid.', { operation: value.operation })
  }
  validateAbsoluteRoot(value.root, options)
  requireString(value.host, 'host', { values: ['claude-code', 'codex'] })
  validateHostContext(value.hostContext, value.host, options)
  if (value.operation === 'apply') {
    validateInspectSuccess(value.inspection)
    if (value.inspection.root !== value.root || value.inspection.host !== value.host || canonicalJson(value.inspection.hostContext) !== canonicalJson(value.hostContext)) {
      invalid('manifest-invalid', 'prevalidate', 'Carried inspection identity does not match the request.')
    }
    requireString(value.versionControlChoice, 'version control choice', { values: ['deferred', 'ignore', 'not-required', 'track'] })
    requireArray(value.semanticDecisions, 'semantic decisions', (item) => {
      requireRecord(item, ['target', 'status', 'conceptIds'], 'semantic decision')
      validateTarget(item.target)
      requireString(item.status, 'semantic status', { values: ['deferred', 'satisfied'] })
      requireArray(item.conceptIds, 'semantic concepts', validateLogicalId, { ordinalBy: (entry) => entry, uniqueBy: (entry) => entry })
    }, { ordinalBy: (item) => item.target, uniqueBy: (item) => item.target })
    requireArray(value.proposalDispositions, 'proposal dispositions', (item) => {
      requireRecord(item, ['proposalId', 'disposition'], 'proposal disposition')
      if (typeof item.proposalId !== 'string' || !/^p-[a-f0-9]{62}$/.test(item.proposalId)) {
        invalid('invalid-request', 'decode', 'Proposal disposition ID is invalid.')
      }
      requireString(item.disposition, 'proposal disposition', { values: ['condition-not-selected', 'selected'] })
    }, { uniqueBy: (item) => item.proposalId })
    validateProposalDispositions(value.inspection.proposals, value.proposalDispositions, { versionControlChoice: value.versionControlChoice })
    requireArray(value.actions, 'actions', (item) => validateAction(item), { uniqueBy: (item) => item.id })
  } else if (value.operation === 'recover-inspect') {
    requireString(value.recoveryKind, 'recovery kind', { values: RECOVERY_KINDS })
    try {
      validateTarget(value.recoveryTarget)
    } catch {
      invalid('invalid-request', 'decode', 'Recovery target is invalid.', { operation: value.operation })
    }
    if (!recoveryTargetMatches(value.recoveryKind, value.recoveryTarget)) {
      invalid('recovery-invalid', 'prevalidate', 'Recovery target does not match its recovery kind.', { target: value.recoveryTarget })
    }
  } else if (value.operation === 'recover-apply') {
    try {
      validateRecoveryInspection(value.recoveryInspection)
    } catch (error) {
      if (error instanceof TypeError || error instanceof InitBacklogError && error.record.code === 'invalid-request') {
        invalid('recovery-invalid', 'prevalidate', 'Carried recovery inspection is invalid.', { target: value.recoveryInspection?.recoveryTarget ?? null })
      }

      throw error
    }
    if (value.recoveryInspection.root !== value.root || value.recoveryInspection.host !== value.host || canonicalJson(value.recoveryInspection.hostContext) !== canonicalJson(value.hostContext)) {
      invalid('recovery-invalid', 'prevalidate', 'Carried recovery inspection identity does not match the request.')
    }
    requireString(value.disposition, 'recovery disposition', { values: ['abandon', 'accept', 'cleanup', 'deferred', 'ignore', 'remove', 'restore', 'track'] })
    if (!value.recoveryInspection.allowedDispositions.includes(value.disposition)) {
      invalid('recovery-invalid', 'prevalidate', 'Recovery disposition is not allowed.')
    }
  }

  return value
}

function validateResultRecord(value) {
  if (!isPlainObject(value) || typeof value.ok !== 'boolean') {
    throw new TypeError('Result is invalid')
  }
  if (value.ok === false) {
    return validateFailure(value)
  }
  if (value.operation === 'inspect') {
    return validateInspectSuccess(value)
  }
  if (value.operation === 'apply') {
    requireRecord(value, ['ok', 'protocolVersion', 'operation', 'root', 'host', 'hostContext', 'snapshotId', 'manifestId', 'versionControlChoice', 'complete', 'outcomes', 'incompleteTargets', 'warnings', 'retainedBackups', 'postInspect'], 'apply result')
    if (value.protocolVersion !== 1) {
      throw new TypeError('Apply result is invalid')
    }
    validateAbsoluteRoot(value.root)
    requireString(value.host, 'host', { values: ['claude-code', 'codex'] })
    validateHostContext(value.hostContext, value.host)
    validateDigest(value.snapshotId)
    validateDigest(value.manifestId)
    requireString(value.versionControlChoice, 'version control choice', { values: ['deferred', 'ignore', 'not-required', 'track'] })
    requireBoolean(value.complete, 'complete')
    requireArray(value.outcomes, 'outcomes', validateOutcome)
    requireArray(value.incompleteTargets, 'incomplete targets', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
    requireArray(value.warnings, 'warnings', validateWarning, { ordinalBy: (item) => item.code, uniqueBy: (item) => item.code })
    requireArray(value.retainedBackups, 'retained backups', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
    validateInspectSuccess(value.postInspect)

    return value
  }
  if (value.operation === 'recover-inspect') {
    return validateRecoveryInspection(value)
  }
  if (value.operation === 'recover-apply') {
    requireRecord(value, ['ok', 'protocolVersion', 'operation', 'root', 'host', 'hostContext', 'recoveryId', 'recoveryKind', 'recoveryTarget', 'disposition', 'status', 'changedPaths', 'retainedPaths', 'warnings'], 'recovery apply result')
    if (value.protocolVersion !== 1) {
      throw new TypeError('Recovery apply result is invalid')
    }
    validateAbsoluteRoot(value.root)
    requireString(value.host, 'host', { values: ['claude-code', 'codex'] })
    validateHostContext(value.hostContext, value.host)
    validateDigest(value.recoveryId)
    requireString(value.recoveryKind, 'recovery kind', { values: RECOVERY_KINDS })
    validateTarget(value.recoveryTarget)
    requireString(value.disposition, 'disposition', { values: ['abandon', 'accept', 'cleanup', 'deferred', 'ignore', 'remove', 'restore', 'track'] })
    requireString(value.status, 'status', { values: ['already-complete', 'completed'] })
    requireArray(value.changedPaths, 'changed paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
    requireArray(value.retainedPaths, 'retained paths', validateTarget, { ordinalBy: (item) => item, uniqueBy: (item) => item })
    requireArray(value.warnings, 'warnings', validateWarning, { ordinalBy: (item) => item.code, uniqueBy: (item) => item.code })

    return value
  }
  throw new TypeError('Result operation is invalid')
}

function decodeRequest(rawBytes, options = {}) {
  if (!Buffer.isBuffer(rawBytes)) {
    invalid('invalid-request', 'decode', 'Request transport must be bytes.')
  }
  let body = rawBytes
  if (body.length > 0 && body[body.length - 1] === 0x0a) {
    body = body.subarray(0, body.length - 1)
  }
  if (body.length > MAX_APPLY_REQUEST_BYTES) {
    invalid('payload-too-large', 'decode', 'Request exceeds the maximum size.')
  }
  let text
  let value
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    value = JSON.parse(text)
  } catch (error) {
    throw new InitBacklogError(failureRecord({ code: 'invalid-json', detail: 'Request JSON is invalid.', phase: 'decode' }), { cause: error })
  }
  let canonical
  try {
    canonical = canonicalJson(value)
  } catch {
    invalid('invalid-request', 'decode', 'Request JSON is not canonical.')
  }
  if (canonical !== text) {
    invalid('invalid-request', 'decode', 'Request JSON is not canonical.')
  }
  const operation = isPlainObject(value) && typeof value.operation === 'string' && OPERATIONS.includes(value.operation) ? value.operation : null
  if ((operation === 'inspect' || operation === 'recover-inspect') && body.length > MAX_INSPECT_REQUEST_BYTES) {
    invalid('payload-too-large', 'decode', 'Request exceeds the operation size.', { operation })
  }
  if (operation === 'recover-apply' && body.length > MAX_RECOVERY_REQUEST_BYTES) {
    invalid('payload-too-large', 'decode', 'Request exceeds the operation size.', { operation })
  }

  return validateRequestRecord(value, options)
}

function resultLimit(value) {
  if (value.operation === 'inspect') {
    return MAX_INSPECT_RESULT_BYTES
  }
  if (value.operation === 'recover-inspect' || value.operation === 'recover-apply') {
    return MAX_RECOVERY_RESULT_BYTES
  }

  return MAX_APPLY_RESULT_BYTES
}

function resultOverflowPhase(value) {
  return value.operation === 'inspect' || value.operation === 'recover-inspect' ? 'inspect' : 'prevalidate'
}

function encodeResult(value) {
  validateResultRecord(value)
  const body = canonicalBytes(value)
  if (body.length > resultLimit(value)) {
    invalid('payload-too-large', resultOverflowPhase(value), 'Result exceeds the maximum size.', { operation: value.operation ?? null })
  }

  return Buffer.concat([body, Buffer.from('\n', 'ascii')])
}

function validateProposalDispositions(proposals, dispositions, context) {
  if (!Array.isArray(proposals) || !Array.isArray(dispositions) || proposals.length !== dispositions.length) {
    invalid('manifest-invalid', 'prevalidate', 'Proposal dispositions do not cover inspection.')
  }
  const seen = new Set()
  const newlineAlternatives = new Map()
  for (let index = 0; index < proposals.length; index += 1) {
    const proposal = proposals[index]
    const disposition = dispositions[index]
    if (!isPlainObject(disposition) || !sameKeys(disposition, ['proposalId', 'disposition']) || disposition.proposalId !== proposal.proposalId || seen.has(disposition.proposalId)) {
      invalid('manifest-invalid', 'prevalidate', 'Proposal dispositions do not match inspection order.')
    }
    seen.add(disposition.proposalId)
    const target = proposal.target ?? proposal.action?.target
    let selected
    if (proposal.condition === 'always') {
      selected = true
    } else if (proposal.condition === 'version-control-ignore') {
      selected = context.versionControlChoice === 'ignore'
    } else if (proposal.condition === 'newline-lf' || proposal.condition === 'newline-crlf') {
      if (typeof target !== 'string') {
        invalid('manifest-invalid', 'prevalidate', 'Newline proposal target is invalid.')
      }
      const alternatives = newlineAlternatives.get(target) ?? new Map()
      if (alternatives.has(proposal.condition)) {
        invalid('manifest-invalid', 'prevalidate', 'Newline proposal alternatives are duplicated.')
      }
      alternatives.set(proposal.condition, disposition)
      newlineAlternatives.set(target, alternatives)
      continue
    } else {
      invalid('manifest-invalid', 'prevalidate', 'Proposal condition is invalid.')
    }
    const expected = selected ? 'selected' : 'condition-not-selected'
    if (disposition.disposition !== expected) {
      invalid('manifest-invalid', 'prevalidate', 'Proposal disposition selects the wrong condition.')
    }
  }

  for (const alternatives of newlineAlternatives.values()) {
    if (!alternatives.has('newline-lf') || !alternatives.has('newline-crlf')) {
      invalid('manifest-invalid', 'prevalidate', 'Newline proposal alternatives are incomplete.')
    }
    const lfSelected = alternatives.get('newline-lf').disposition === 'selected'
    const crlfSelected = alternatives.get('newline-crlf').disposition === 'selected'
    if (lfSelected === crlfSelected) {
      invalid('manifest-invalid', 'prevalidate', 'Newline proposal alternatives must select exactly one condition.')
    }
    const unselected = lfSelected ? alternatives.get('newline-crlf') : alternatives.get('newline-lf')
    if (unselected.disposition !== 'condition-not-selected') {
      invalid('manifest-invalid', 'prevalidate', 'Newline proposal alternatives have an invalid complementary disposition.')
    }
  }

  return dispositions
}

function actionRank(action) {
  if (action.kind === 'ensure-directory') {
    return 0
  }
  if (action.kind === 'unwrap-file') {
    return 1
  }

  return 2
}

function rankTwoChainOrder(actions) {
  const exactEdits = actions.filter((action) => action.kind === 'exact-edit')
  if (exactEdits.length <= 1) {
    return actions.toSorted((left, right) => (left.kind === 'create-from-template' ? -1 : right.kind === 'create-from-template' ? 1 : 0))
  }
  const byBefore = new Map()
  const afterValues = new Set()
  for (const action of exactEdits) {
    if (byBefore.has(action.beforeBase64) || afterValues.has(action.afterBase64)) {
      throw new TypeError('Rank-two action chain is not unique')
    }
    byBefore.set(action.beforeBase64, action)
    afterValues.add(action.afterBase64)
  }
  const starts = exactEdits.filter((action) => !afterValues.has(action.beforeBase64))
  if (starts.length !== 1) {
    throw new TypeError('Rank-two action chain has no unique start')
  }
  const ordered = []
  let current = starts[0]
  while (current !== undefined) {
    ordered.push(current)
    current = byBefore.get(current.afterBase64)
  }
  if (ordered.length !== exactEdits.length) {
    throw new TypeError('Rank-two action chain is disconnected or cyclic')
  }
  const exactIndex = new Map(ordered.map((action, index) => [action.id, index]))

  return actions.toSorted((left, right) => (exactIndex.get(left.id) ?? -1) - (exactIndex.get(right.id) ?? -1))
}

function canonicalActionOrder(actions) {
  if (!Array.isArray(actions)) {
    throw new TypeError('Actions must be an array')
  }
  const seen = new Set()
  const positioned = actions.map((action, index) => {
    validateAction(action, 'manifest-invalid', 'prevalidate')
    if (seen.has(action.id)) {
      throw new TypeError('Action ID is duplicated')
    }
    seen.add(action.id)

    return { action, index }
  })
  positioned.sort((left, right) => {
    const leftRank = actionRank(left.action)
    const rightRank = actionRank(right.action)
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }
    if (leftRank === 0) {
      const depth = left.action.target.split('/').length - right.action.target.split('/').length
      if (depth !== 0) {
        return depth
      }
    }
    const targetOrder = compareOrdinal(left.action.target, right.action.target)
    if (targetOrder !== 0) {
      return targetOrder
    }

    return left.index - right.index
  })
  const ordered = positioned.map((item) => item.action)
  const rankTwoTargets = new Set(ordered.filter((action) => actionRank(action) === 2).map((action) => action.target))
  for (const target of rankTwoTargets) {
    const targetActions = ordered.filter((action) => actionRank(action) === 2 && action.target === target)
    const chain = rankTwoChainOrder(targetActions)
    let targetIndex = 0
    for (let index = 0; index < ordered.length; index += 1) {
      if (actionRank(ordered[index]) === 2 && ordered[index].target === target) {
        ordered[index] = chain[targetIndex]
        targetIndex += 1
      }
    }
  }

  return ordered
}

function deriveProposalId(value) {
  return `p-${sha256(canonicalBytes(value)).slice(0, 62)}`
}

function deriveSemanticActionId(actionWithoutId) {
  return `s-${sha256(canonicalBytes(actionWithoutId)).slice(0, 62)}`
}

function deriveSnapshotId(inspectWithNullId) {
  return sha256(canonicalBytes(inspectWithNullId))
}

function deriveManifestId(manifestProjection) {
  return sha256(canonicalBytes(manifestProjection))
}

function deriveRecoveryId(recoveryWithNullId) {
  return sha256(canonicalBytes(recoveryWithNullId))
}

function selectFailure(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError('At least one failure is required')
  }
  for (const candidate of candidates) {
    if (!isPlainObject(candidate) || !PHASES.includes(candidate.phase) || !FAILURE_CODES.includes(candidate.code) || !(PHASE_CODE_ORDER[candidate.phase] ?? []).includes(candidate.code)) {
      throw new TypeError('Failure candidate is invalid')
    }
  }

  return [...candidates].sort((left, right) => {
    const phaseOrder = PHASES.indexOf(left.phase) - PHASES.indexOf(right.phase)
    if (phaseOrder !== 0) {
      return phaseOrder
    }
    const codes = PHASE_CODE_ORDER[left.phase] ?? []

    return codes.indexOf(left.code) - codes.indexOf(right.code)
  })[0]
}

module.exports = {
  ACTION_ID_PATTERN,
  BACKUP_PATTERN,
  BACKUP_STAGE_PATTERN,
  DIGEST_PATTERN,
  FAILURE_CODES,
  LOGICAL_ID_PATTERN,
  MAX_APPLY_REQUEST_BYTES,
  MAX_APPLY_RESULT_BYTES,
  MAX_CONFINED_PATH_BYTES,
  MAX_INLINE_FILE_BYTES,
  MAX_INSPECT_REQUEST_BYTES,
  MAX_INSPECT_RESULT_BYTES,
  MAX_RECOVERY_REQUEST_BYTES,
  MAX_RECOVERY_RESULT_BYTES,
  NONCE_PATTERN,
  OPERATIONS,
  PHASES,
  RECOVERY_GATE_BASENAME,
  RECOVERY_LOCK_BASENAME,
  RECOVERY_MARKER_BASENAME,
  assertSafeWindowsScalar,
  canonicalActionOrder,
  canonicalBytes,
  canonicalJson,
  compareOrdinal,
  buildRecoveryApplyRequest,
  decodeRequest,
  deriveManifestId,
  deriveProposalId,
  deriveRecoveryId,
  deriveSemanticActionId,
  deriveSnapshotId,
  encodeResult,
  recoveryAllowedDispositions,
  recoveryTargetMatches,
  selectFailure,
  sha256,
  validateAbsoluteRoot,
  validateAction,
  validateBase64,
  validateDigest,
  validateLogicalId,
  validateNonce,
  validateProposalDispositions,
  validateRequestRecord,
  validateResultRecord,
  validateSelector,
  validateTarget,
}
