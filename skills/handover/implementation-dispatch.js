'use strict'

const nodeFilesystem = require('node:fs')
const nodePath = require('node:path')

const { resolveTrustedExecutable } = require('../../internal/filesystem-primitives')
const { runGit } = require('../../internal/git-runner')
const { scanMarkdown } = require('../spec-agreement/spec-agreement')

const MAX_PLAN_BYTES = 2097152
const OPTION_KEYS = ['filesystem', 'git', 'resolveGitExecutable', 'spawnSync']
const PLAN_GRADUATION = /^- revise-plan graduated \d{4}-\d{2}-\d{2} \d{2}:\d{2} at ([0-9a-f]{7,40}), scope: \S(?:.*\S)?, content: (?:[0-9a-f]{8}|p-[0-9a-f]{12})$/

class ImplementationDispatchError extends Error {
  constructor(code, message, details) {
    super(`${code}: ${message}`)
    this.name = 'ImplementationDispatchError'
    this.code = code
    this.details = validateErrorDetails(code, details)
  }
}

class CanonicalRootValidationError extends Error {
  constructor(cause, path) {
    super(`Canonical root validation failed: ${cause}`)
    this.cause = cause
    this.path = path
  }
}

function fail(code, message, details) {
  throw new ImplementationDispatchError(code, message, details)
}

function validateErrorDetails(code, details) {
  const exact = (keys) => details && isPlainObject(details) && Object.keys(details).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(details, key))
  const enums = {
    'dispatch-input': ['conflicting-seams', 'empty-buffer', 'invalid-audit-base', 'invalid-option', 'invalid-plan-fingerprint', 'invalid-task-heading', 'invalid-task-id', 'invalid-dispatch-id', 'invalid-scratch-path', 'not-buffer', 'not-canonical-root', 'root-alias', 'root-not-ordinary', 'root-unavailable', 'too-large', 'unknown-key'],
    'repository-classification': ['kind-changed', 'metadata-unavailable', 'metadata-not-ordinary', 'root-mismatch'],
    'object-format': ['unsupported-format', 'width-mismatch', 'resolution-failed', 'resolved-id-mismatch'],
    'history-base': ['missing-object', 'non-ancestor', 'tip-changed'],
    'audit-limit': ['commit-count', 'offender-count', 'offender-bytes'],
  }
  if (code === 'dispatch-input' && exact(['field', 'reason']) && typeof details.field === 'string' && enums[code].includes(details.reason)) return details
  if (code === 'git-command' && exact(['args', 'operation', 'status', 'stderr']) && Array.isArray(details.args) && details.args.every((arg) => typeof arg === 'string') && typeof details.operation === 'string' && (details.status === null || Number.isInteger(details.status)) && typeof details.stderr === 'string') return details
  if (code === 'repository-classification' && exact(['cause', 'path']) && enums[code].includes(details.cause) && typeof details.path === 'string') return details
  if (code === 'plan-stamp' && (exact(['kind']) && details.kind === 'missing' || exact(['kind', 'line']) && details.kind === 'malformed' && typeof details.line === 'string')) return details
  if (code === 'object-format' && exact(['kind', 'objectFormat', 'stampSha', 'storedAuditBase']) && enums[code].includes(details.kind) && (details.objectFormat === null || typeof details.objectFormat === 'string') && /^[0-9a-f]{7,40}$/.test(details.stampSha) && (details.storedAuditBase === null || /^[0-9a-f]{40}$/.test(details.storedAuditBase) || /^[0-9a-f]{64}$/.test(details.storedAuditBase))) return details
  if (code === 'ignore-policy' && exact(['expectedPattern', 'observedPattern', 'observedSource', 'path']) && details.expectedPattern === '/.tmp/' && (details.observedPattern === null || typeof details.observedPattern === 'string') && (details.observedSource === null || typeof details.observedSource === 'string') && typeof details.path === 'string') return details
  if (code === 'superpowers-policy' && exact(['expectedPattern', 'observedPattern', 'observedSource', 'path']) && details.expectedPattern === null && details.path === '.superpowers/' && (details.observedPattern === null || typeof details.observedPattern === 'string') && (details.observedSource === null || typeof details.observedSource === 'string')) return details
  if (code === 'history-base' && exact(['auditBase', 'kind']) && typeof details.auditBase === 'string' && (details.kind === 'missing-object' || details.kind === 'non-ancestor')) return details
  if (code === 'history-base' && exact(['auditBase', 'expectedTip', 'kind', 'observedTip']) && typeof details.auditBase === 'string' && typeof details.expectedTip === 'string' && typeof details.observedTip === 'string' && details.kind === 'tip-changed') return details
  if (code === 'staged-scratch' && exact(['paths']) && Array.isArray(details.paths) && details.paths.every((value) => typeof value === 'string') && details.paths.every((value, index) => index === 0 || details.paths[index - 1] < value)) return details
  if (code === 'committed-scratch' && exact(['offenders']) && Array.isArray(details.offenders) && details.offenders.every((value) => isPlainObject(value) && Object.keys(value).length === 2 && typeof value.commit === 'string' && typeof value.path === 'string') && details.offenders.every((value, index) => index === 0 || details.offenders[index - 1].commit < value.commit || details.offenders[index - 1].commit === value.commit && details.offenders[index - 1].path < value.path)) return details
  if (code === 'scratch-allocation' && exact(['cause', 'path']) && typeof details.cause === 'string' && typeof details.path === 'string') return details
  if (code === 'scratch-tracked' && exact(['path']) && typeof details.path === 'string') return details
  if (code === 'audit-limit' && exact(['kind', 'limit', 'observed']) && enums[code].includes(details.kind) && Number.isSafeInteger(details.limit) && Number.isSafeInteger(details.observed)) return details
  throw new TypeError(`Invalid ${code} error details`)
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

function validateOptions(options, allowed = OPTION_KEYS) {
  if (options === undefined) options = {}
  if (!isPlainObject(options)) fail('dispatch-input', 'Options are invalid', { field: 'options', reason: 'invalid-option' })
  for (const key of Object.keys(options)) {
    if (!allowed.includes(key)) fail('dispatch-input', 'Unknown option', { field: `options.${key}`, reason: 'unknown-key' })
  }
  for (const key of Object.keys(options)) {
    if (key === 'filesystem' && (!isPlainObject(options[key]) || typeof options[key].lstatSync !== 'function' || typeof options[key].realpathSync?.native !== 'function')) fail('dispatch-input', 'Filesystem option is invalid', { field: 'options.filesystem', reason: 'invalid-option' })
    if (key === 'git' && typeof options[key] !== 'function') fail('dispatch-input', 'Git option is invalid', { field: 'options.git', reason: 'invalid-option' })
    if (key === 'resolveGitExecutable' && typeof options[key] !== 'function') fail('dispatch-input', 'Executable resolver is invalid', { field: 'options.resolveGitExecutable', reason: 'invalid-option' })
    if (key === 'spawnSync' && typeof options[key] !== 'function') fail('dispatch-input', 'Spawn option is invalid', { field: 'options.spawnSync', reason: 'invalid-option' })
  }
  if (typeof options.git === 'function' && (options.resolveGitExecutable !== undefined || options.spawnSync !== undefined)) fail('dispatch-input', 'Git seams conflict', { field: 'options', reason: 'conflicting-seams' })

  return options
}

function validatePlanBytes(value) {
  if (!Buffer.isBuffer(value)) fail('dispatch-input', 'Plan bytes are not a Buffer', { field: 'planBytes', reason: 'not-buffer' })
  if (value.length === 0) fail('dispatch-input', 'Plan bytes are empty', { field: 'planBytes', reason: 'empty-buffer' })
  if (value.length > MAX_PLAN_BYTES) fail('dispatch-input', 'Plan bytes are too large', { field: 'planBytes', reason: 'too-large' })
}

function validateCanonicalRepositoryRoot(repositoryRoot, filesystem = nodeFilesystem) {
  if (nodePath.resolve(repositoryRoot) !== repositoryRoot) throw new CanonicalRootValidationError('root-alias', repositoryRoot)
  try {
    const resolved = filesystem.realpathSync.native(repositoryRoot)
    if (resolved !== repositoryRoot) throw new CanonicalRootValidationError('root-alias', repositoryRoot)
    const metadata = filesystem.lstatSync(repositoryRoot, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.isReparsePoint?.()) throw new CanonicalRootValidationError('root-not-ordinary', repositoryRoot)
    return repositoryRoot
  } catch (error) {
    if (error instanceof CanonicalRootValidationError) throw error
    throw new CanonicalRootValidationError('root-unavailable', repositoryRoot)
  }
}

function normalizeRunGitResult(raw) {
  return { error: raw?.error ?? null, signal: raw?.signal ?? null, status: Number.isInteger(raw?.status) ? raw.status : null, stderr: Buffer.from(raw?.stderr ?? []), stdout: Buffer.from(raw?.stdout ?? []) }
}

function requireGitStatus(result, operation, allowedStatuses) {
  validateGitResultEnvelope(result, operation)
  if (result.error !== null || result.signal !== null || !allowedStatuses.includes(result.status) || result.stderr.length !== 0) {
    const error = new Error(`Git command failed for ${operation}`)
    error.status = result.status
    error.stderr = result.stderr
    throw error
  }

  return result
}

function decodeStrictUtf8(bytes, operation) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new Error(`Malformed UTF-8 for ${operation}`) }
}

function parseCheckIgnoreRecords(bytes, operation = 'check-ignore') {
  const text = decodeStrictUtf8(bytes, operation)
  if (text.length === 0 || !text.endsWith('\0')) throw new Error(`Malformed check-ignore output for ${operation}`)

  return text.slice(0, -1).split('\0')
}

function parseNulPathList(bytes, operation = 'path-list') {
  const text = decodeStrictUtf8(bytes, operation)
  if (text.length === 0 || !text.endsWith('\0')) throw new Error(`Malformed NUL path list for ${operation}`)

  return text.slice(0, -1).split('\0')
}

function parseLfObjectIds(bytes, operation = 'object-ids') {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a || bytes[bytes.length - 2] === 0x0a) throw new Error(`Malformed object ids for ${operation}`)
  const text = decodeStrictUtf8(bytes, operation)
  return text.slice(0, -1).split('\n')
}

function validateGitResultEnvelope(result, operation) {
  if (!isPlainObject(result) || Object.keys(result).join(',') !== 'error,signal,status,stderr,stdout' || !(result.error === null || result.error instanceof Error) || !(result.signal === null || typeof result.signal === 'string') || !(result.status === null || Number.isInteger(result.status)) || !Buffer.isBuffer(result.stderr) || !Buffer.isBuffer(result.stdout)) throw new Error(`Malformed Git result for ${operation}`)
  return result
}

function gitCommand(repositoryRoot, args, input, operation, options, allowedStatuses = [0]) {
  try {
    let raw
    if (typeof options.git === 'function') raw = options.git(repositoryRoot, args, input ?? null)
    else {
      const trustedGitPath = (options.resolveGitExecutable ?? resolveTrustedExecutable)({ basename: process.platform === 'win32' ? 'git.exe' : 'git', root: repositoryRoot })
      raw = runGit(repositoryRoot, args, { ...(input === undefined ? {} : { input }), ...(options.spawnSync === undefined ? {} : { spawnSync: options.spawnSync }), trustedGitPath })
      raw = normalizeRunGitResult(raw)
    }
    const result = requireGitStatus(raw, operation, allowedStatuses)
    return result
  } catch (error) {
    if (error instanceof ImplementationDispatchError) throw error
    const stderr = error?.stderr instanceof Buffer ? error.stderr.toString('utf8') : ''
    const status = Number.isInteger(error?.status) ? error.status : null
    fail('git-command', 'Git command failed', { args, operation, status, stderr })
  }
}

function parseExactAsciiLine(bytes, operation, allowed) {
  if (!Buffer.isBuffer(bytes) || bytes.some((byte) => byte > 0x7f) || !allowed.some((value) => bytes.equals(Buffer.from(`${value}\n`, 'ascii')))) throw new Error(`Malformed ${operation} output`)
  return bytes.toString('ascii').slice(0, -1)
}

function parsePlanStamp(planBytes) {
  const lines = planBytes.toString('utf8').split(/\r?\n/)
  let firstStampSha = null
  for (const line of lines) {
    if (!line.startsWith('- revise-plan graduated ')) continue
    const match = PLAN_GRADUATION.exec(line)
    if (match === null) fail('plan-stamp', 'Malformed plan stamp', { kind: 'malformed', line })
    const date = line.slice(24, 40)
    const year = Number(date.slice(0, 4)); const month = Number(date.slice(5, 7)); const day = Number(date.slice(8, 10)); const hour = Number(date.slice(11, 13)); const minute = Number(date.slice(14, 16))
    const days = [0, 31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month] || hour > 23 || minute > 59) fail('plan-stamp', 'Malformed plan stamp', { kind: 'malformed', line })
    if (firstStampSha === null) firstStampSha = match[1]
  }
  if (firstStampSha !== null) return firstStampSha
  fail('plan-stamp', 'Plan stamp is missing', { kind: 'missing' })
}

function deriveImplementationTaskBrief(input) {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !['planBytes', 'taskHeading'].includes(key))) fail('dispatch-input', 'Unknown task brief input', { field: Object.keys(input ?? {}).find((key) => !['planBytes', 'taskHeading'].includes(key)) ?? 'input', reason: 'unknown-key' })
  validatePlanBytes(input?.planBytes)
  if (typeof input.taskHeading !== 'string') fail('dispatch-input', 'Task heading is invalid', { field: 'taskId', reason: 'invalid-task-heading' })
  const headingPattern = /^### Task ([1-9][0-9]{0,8}): (.+)$/u
  const match = headingPattern.exec(input.taskHeading)
  if (!match || match[2].length > 1024 || /^[\s]|[\s]$/u.test(match[2]) || /\p{Control}/u.test(match[2]) || /[\r\n\u2028\u2029]/u.test(input.taskHeading)) fail('dispatch-input', 'Task heading is invalid', { field: 'taskId', reason: 'invalid-task-heading' })
  let scanned
  try { scanned = scanMarkdown(input.planBytes) } catch { fail('dispatch-input', 'Task heading is invalid', { field: 'taskId', reason: 'invalid-task-heading' }) }
  const taskRecords = scanned.lines.filter((line) => line.outsideFence && line.heading?.level === 3 && /^### Task /.test(line.content))
  const canonical = taskRecords.filter((line) => headingPattern.test(line.content))
  if (canonical.some((line, index) => canonical.findIndex((other) => other.content.slice(other.content.indexOf(': ') + 2) === line.content.slice(line.content.indexOf(': ') + 2)) !== index)) fail('dispatch-input', 'Task heading is invalid', { field: 'taskId', reason: 'invalid-task-heading' })
  const selected = scanned.lines.filter((line) => line.outsideFence && line.heading?.level === 3 && line.content === input.taskHeading)
  if (selected.length !== 1) fail('dispatch-input', 'Task heading is invalid', { field: 'taskId', reason: 'invalid-task-heading' })
  const start = selected[0].rawStart
  const endRecord = scanned.lines.find((line) => line.rawStart > start && line.outsideFence && (line.heading?.level === 2 || canonical.some((candidate) => candidate.rawStart === line.rawStart)))

  return { briefBytes: Buffer.from(input.planBytes.subarray(start, endRecord?.rawStart ?? input.planBytes.length)), taskTitle: match[2] }
}

function classifyImplementationRepository(input, suppliedOptions = {}) {
  if (!isPlainObject(input) || Object.keys(input).some((key) => key !== 'repositoryRoot')) fail('dispatch-input', 'Unknown classifier input', { field: Object.keys(input ?? {}).find((key) => key !== 'repositoryRoot') ?? 'input', reason: 'unknown-key' })
  const options = validateOptions(suppliedOptions)
  if (typeof input.repositoryRoot !== 'string' || !nodePath.isAbsolute(input.repositoryRoot)) fail('dispatch-input', 'Repository root is invalid', { field: 'repositoryRoot', reason: 'not-canonical-root' })
  let root
  try { root = validateCanonicalRepositoryRoot(input?.repositoryRoot, options.filesystem ?? nodeFilesystem) } catch (error) {
    if (!(error instanceof CanonicalRootValidationError)) throw error
    fail('repository-classification', 'Repository metadata is unavailable', { cause: error.cause === 'root-unavailable' ? 'metadata-unavailable' : 'metadata-not-ordinary', path: error.path })
  }
  try {
    const filesystem = options.filesystem ?? nodeFilesystem
    let current = root
    let markerFound = false
    while (true) {
      const markerPath = nodePath.join(current, '.git')
      try {
        const marker = filesystem.lstatSync(markerPath, { bigint: true })
        if (!marker.isDirectory() && !marker.isFile() || marker.isSymbolicLink() || marker.isReparsePoint?.()) fail('repository-classification', 'Git metadata is not ordinary', { cause: 'metadata-not-ordinary', path: markerPath })
        markerFound = true
        break
      } catch (error) {
        if (error instanceof ImplementationDispatchError) throw error
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') fail('repository-classification', 'Git metadata is unavailable', { cause: 'metadata-unavailable', path: markerPath })
      }
      const parent = nodePath.dirname(current)
      if (parent === current) break
      current = parent
    }
    if (!markerFound) return { kind: 'non-git' }
    const result = gitCommand(root, ['rev-parse', '--show-toplevel'], undefined, 'show-toplevel', options)
    if (result.stdout.length === 0 || result.stdout[result.stdout.length - 1] !== 0x0a || result.stdout.subarray(0, -1).includes(0x0a) || result.stdout.includes(0x0d) || result.stdout.length < 2 || result.stdout.some((byte) => byte > 0x7f)) fail('git-command', 'Malformed Git output', { args: ['rev-parse', '--show-toplevel'], operation: 'show-toplevel', status: result.status, stderr: '' })
    const top = result.stdout.subarray(0, -1).toString('utf8')
    if (top !== root) fail('repository-classification', 'Git root differs', { cause: 'root-mismatch', path: root })
    return { kind: 'git' }
  } catch (error) {
    if (error instanceof ImplementationDispatchError) throw error
    fail('repository-classification', 'Repository classification failed', { cause: 'metadata-unavailable', path: root })
  }
}

function resolveImplementationAuditBase(input, suppliedOptions = {}) {
  if (!isPlainObject(input)) fail('dispatch-input', 'Audit input is invalid', { field: 'input', reason: 'unknown-key' })
  const unknown = Object.keys(input).find((key) => !['planBytes', 'repositoryRoot', 'storedAuditBase'].includes(key)); if (unknown) fail('dispatch-input', 'Unknown audit input', { field: unknown, reason: 'unknown-key' })
  validatePlanBytes(input.planBytes)
  if (input.storedAuditBase !== null && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.storedAuditBase ?? '')) fail('dispatch-input', 'Audit base is invalid', { field: 'storedAuditBase', reason: 'invalid-audit-base' })
  const options = validateOptions(suppliedOptions)
  if (typeof input.repositoryRoot !== 'string' || !nodePath.isAbsolute(input.repositoryRoot)) fail('dispatch-input', 'Repository root is invalid', { field: 'repositoryRoot', reason: 'not-canonical-root' })
  let root
  try { root = validateCanonicalRepositoryRoot(input.repositoryRoot, options.filesystem ?? nodeFilesystem) } catch (error) {
    if (!(error instanceof CanonicalRootValidationError)) throw error
    fail('dispatch-input', 'Repository root is invalid', { field: 'repositoryRoot', reason: error.cause })
  }
  const stampSha = parsePlanStamp(input.planBytes)
  if (input.storedAuditBase !== null && !input.storedAuditBase.startsWith(stampSha)) fail('object-format', 'Stored audit base does not match stamp', { kind: 'resolved-id-mismatch', objectFormat: null, stampSha, storedAuditBase: input.storedAuditBase })
  const formatArgs = ['rev-parse', '--show-object-format=storage']
  const formatResult = gitCommand(root, formatArgs, undefined, 'show-object-format', options)
  let objectFormat
  try { objectFormat = parseExactAsciiLine(formatResult.stdout, 'show-object-format', ['sha1', 'sha256']) } catch { fail('git-command', 'Malformed Git output', { args: formatArgs, operation: 'show-object-format', status: formatResult.status, stderr: '' }) }
  const width = objectFormat === 'sha1' ? 40 : 64
  if (input.storedAuditBase !== null && input.storedAuditBase.length !== width) fail('object-format', 'Audit base width does not match object format', { kind: 'width-mismatch', objectFormat, stampSha, storedAuditBase: input.storedAuditBase })
  const value = input.storedAuditBase ?? stampSha
  const resolveArgs = ['rev-parse', '--verify', `${value}^{commit}`]
  let resolved
  try { resolved = gitCommand(root, resolveArgs, undefined, 'resolve-commit', options, [0, 1]) } catch (error) {
    if (error instanceof ImplementationDispatchError && error.code === 'git-command' && error.details.status === 1) fail('object-format', 'Commit abbreviation could not be resolved', { kind: 'resolution-failed', objectFormat, stampSha, storedAuditBase: input.storedAuditBase })
    throw error
  }
  if (resolved.status === 1) fail('object-format', 'Commit abbreviation could not be resolved', { kind: 'resolution-failed', objectFormat, stampSha, storedAuditBase: input.storedAuditBase })
  let auditBase
  if (resolved.stdout.length !== width + 1 || resolved.stdout[width] !== 0x0a || resolved.stdout.some((byte) => byte > 0x7f) || !/^[0-9a-f]+$/.test(resolved.stdout.subarray(0, width).toString('ascii'))) fail('git-command', 'Malformed Git output', { args: resolveArgs, operation: 'resolve-commit', status: resolved.status, stderr: '' })
  auditBase = resolved.stdout.subarray(0, width).toString('ascii')
  if (auditBase.length !== width || (input.storedAuditBase !== null && auditBase !== input.storedAuditBase)) fail('object-format', 'Resolved commit differs', { kind: 'resolved-id-mismatch', objectFormat, stampSha, storedAuditBase: input.storedAuditBase })
  const mergeArgs = ['merge-base', '--is-ancestor', auditBase, 'HEAD']
  const mergeResult = gitCommand(root, mergeArgs, undefined, 'merge-base', options, [0, 1])
  if (mergeResult.status === 1) fail('history-base', 'Audit base is not an ancestor of HEAD', { auditBase, kind: 'non-ancestor' })

  return { auditBase, objectFormat, stampSha }
}

const MAX_AUDIT_COMMITS = 256
const MAX_AUDIT_OFFENDERS = 4096
const MAX_AUDIT_OFFENDER_UTF8_BYTES = 1048576
const GENERATED_SCRATCH_PATH = /^\.tmp\/implementation-[0-9a-f]{12}-[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function startsWithUtf8Bom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
}

function parseStrictPathList(bytes, operation) {
  if (bytes.length === 0) return []
  if (startsWithUtf8Bom(bytes)) throw new Error(`Malformed UTF-8 for ${operation}`)
  const values = parseNulPathList(bytes, operation)
  if (values.some((value) => value.length === 0 || value.includes('\\') || value.includes('\r') || value.includes('\n') || value.startsWith('/') || value.split('/').some((part) => part === '.' || part === '..') || nodePath.posix.normalize(value) !== value)) throw new Error(`Noncanonical path for ${operation}`)

  return values
}

function parseFullCommit(bytes, width, operation) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== width + 1 || bytes[width] !== 0x0a) throw new Error(`Malformed commit for ${operation}`)
  const value = bytes.subarray(0, width).toString('ascii')
  if (!/^[0-9a-f]+$/.test(value) || bytes.some((byte, index) => index < width && byte > 0x7f)) throw new Error(`Malformed commit for ${operation}`)

  return value
}

function parseIgnoreRecord(bytes, expectedPath, expectedPattern) {
  const fields = parseCheckIgnoreRecords(bytes, 'check-ignore')
  if (fields.length !== 4 || fields.some((field) => field.length === 0) || !/^[1-9][0-9]*$/.test(fields[1]) || fields[3] !== expectedPath || (expectedPattern !== null && fields[2] !== expectedPattern)) throw new Error('Malformed check-ignore output')

  return fields
}

function inspectImplementationBoundary(input, suppliedOptions = {}) {
  if (!isPlainObject(input)) fail('dispatch-input', 'Audit input is invalid', { field: 'input', reason: 'unknown-key' })
  const keys = ['auditBase', 'objectFormat', 'repositoryRoot', 'scratchRelativePath']
  const unknown = Object.keys(input).find((key) => !keys.includes(key)); if (unknown) fail('dispatch-input', 'Unknown audit input', { field: unknown, reason: 'unknown-key' })
  const options = validateOptions(suppliedOptions)
  const objectFormat = input.objectFormat
  if (typeof input.objectFormat !== 'string' || !['sha1', 'sha256'].includes(input.objectFormat)) fail('dispatch-input', 'Object format is invalid', { field: 'objectFormat', reason: 'invalid-audit-base' })
  const width = objectFormat === 'sha1' ? 40 : 64
  if (typeof input.auditBase !== 'string' || !new RegExp(`^[0-9a-f]{${width}}$`).test(input.auditBase)) fail('dispatch-input', 'Audit base is invalid', { field: 'auditBase', reason: 'invalid-audit-base' })
  if (typeof input.repositoryRoot !== 'string' || !nodePath.isAbsolute(input.repositoryRoot)) fail('dispatch-input', 'Repository root is invalid', { field: 'repositoryRoot', reason: 'not-canonical-root' })
  try { validateCanonicalRepositoryRoot(input.repositoryRoot, options.filesystem ?? nodeFilesystem) } catch (error) { if (error instanceof CanonicalRootValidationError) fail('dispatch-input', 'Repository root is invalid', { field: 'repositoryRoot', reason: error.cause }) ; throw error }
  if (input.scratchRelativePath !== null && (typeof input.scratchRelativePath !== 'string' || !GENERATED_SCRATCH_PATH.test(input.scratchRelativePath))) fail('dispatch-input', 'Scratch path is invalid', { field: 'scratchRelativePath', reason: 'invalid-scratch-path' })
  const root = input.repositoryRoot
  const formatArgs = ['rev-parse', '--show-object-format=storage']
  let result = gitCommand(root, formatArgs, undefined, 'show-object-format', options)
  try { if (parseExactAsciiLine(result.stdout, 'show-object-format', ['sha1', 'sha256']) !== objectFormat) throw new Error('Object format mismatch') } catch { fail('git-command', 'Malformed Git output', { args: formatArgs, operation: 'show-object-format', status: result.status, stderr: '' }) }
  const topArgs = ['rev-parse', '--show-toplevel']; result = gitCommand(root, topArgs, undefined, 'show-toplevel', options)
  try { const top = decodeStrictUtf8(result.stdout.subarray(0, -1), 'show-toplevel'); if (result.stdout.length < 2 || result.stdout[result.stdout.length - 1] !== 0x0a || result.stdout.subarray(0, -1).includes(0x0a) || result.stdout.includes(0x0d) || nodePath.normalize(top) !== nodePath.normalize(root)) throw new Error('Root mismatch') } catch { fail('git-command', 'Malformed Git output', { args: topArgs, operation: 'show-toplevel', status: result.status, stderr: '' }) }
  const checkIgnore = (path, operation, expectedPattern) => {
    const args = ['check-ignore', '-z', '-v', '--no-index', '--stdin']; result = gitCommand(root, args, Buffer.from(`${path}\0`, 'utf8'), operation, options, [0, 1])
    if (result.status === 1) { if (result.stdout.length !== 0) fail('git-command', 'Unexpected Git output', { args, operation, status: result.status, stderr: '' }); fail(operation === 'check-root-ignore' ? 'ignore-policy' : 'superpowers-policy', 'Ignore policy is missing', operation === 'check-root-ignore' ? { expectedPattern: expectedPattern ?? '/.tmp/', observedPattern: null, observedSource: null, path: '.tmp/' } : { expectedPattern: null, observedPattern: null, observedSource: null, path: '.superpowers/' }) }
    let fields
    try { fields = parseIgnoreRecord(result.stdout, path, null) } catch { fail('git-command', 'Malformed Git output', { args, operation, status: result.status, stderr: '' }) }
    if (operation === 'check-root-ignore' && (fields[0] !== '.gitignore' || fields[2] !== expectedPattern)) fail('ignore-policy', 'Root ignore policy is invalid', { expectedPattern, observedPattern: fields[2], observedSource: fields[0], path: '.tmp/' })
  }
  checkIgnore('.tmp/nightshift-implementation-policy-probe', 'check-root-ignore', '/.tmp/')
  checkIgnore('.superpowers/nightshift-implementation-policy-probe', 'check-superpowers-ignore', null)
  const stagedArgs = ['diff', '--cached', '--name-only', '-z', '--', ':(top).tmp']
  result = gitCommand(root, stagedArgs, undefined, 'list-staged-scratch', options)
  let staged
  try { staged = parseStrictPathList(result.stdout, 'list-staged-scratch').sort() } catch { fail('git-command', 'Malformed Git output', { args: stagedArgs, operation: 'list-staged-scratch', status: result.status, stderr: '' }) }
  if (staged.length > 0) fail('staged-scratch', 'Staged scratch paths found', { paths: staged })
  const tipArgs = ['rev-parse', '--verify', 'HEAD^{commit}']; result = gitCommand(root, tipArgs, undefined, 'resolve-tip', options); let auditTip; try { auditTip = parseFullCommit(result.stdout, width, 'resolve-tip') } catch { fail('git-command', 'Malformed Git output', { args: tipArgs, operation: 'resolve-tip', status: result.status, stderr: '' }) }
  const objectArgs = ['cat-file', '-e', `${input.auditBase}^{commit}`]; result = gitCommand(root, objectArgs, undefined, 'check-object', options, [0, 1]); if (result.status === 1) fail('history-base', 'Audit base object is missing', { auditBase: input.auditBase, kind: 'missing-object' })
  const ancestryArgs = ['merge-base', '--is-ancestor', input.auditBase, auditTip]; result = gitCommand(root, ancestryArgs, undefined, 'check-ancestry', options, [0, 1]); if (result.status === 1) fail('history-base', 'Audit base is not an ancestor', { auditBase: input.auditBase, kind: 'non-ancestor' })
  const listArgs = ['rev-list', '--reverse', `${input.auditBase}..${auditTip}`]; result = gitCommand(root, listArgs, undefined, 'list-commits', options); let commits; try { if (startsWithUtf8Bom(result.stdout)) throw new Error('BOM'); commits = result.stdout.length === 0 ? [] : parseLfObjectIds(result.stdout, 'list-commits'); if (commits.some((id) => id.length !== width || !/^[0-9a-f]+$/.test(id))) throw new Error('width') } catch { fail('git-command', 'Malformed Git output', { args: listArgs, operation: 'list-commits', status: result.status, stderr: '' }) }
  if (commits.length > MAX_AUDIT_COMMITS) fail('audit-limit', 'Audit commit limit exceeded', { kind: 'commit-count', limit: MAX_AUDIT_COMMITS, observed: commits.length })
  const offenders = []; let offenderBytes = 0
  for (const commit of commits) {
    const args = ['diff-tree', '-m', '--root', '--no-commit-id', '--name-only', '-z', '-r', commit, '--', ':(top).tmp']; result = gitCommand(root, args, undefined, 'list-commit-paths', options); let paths; try { paths = [...new Set(parseStrictPathList(result.stdout, 'list-commit-paths'))].sort() } catch { fail('git-command', 'Malformed Git output', { args, operation: 'list-commit-paths', status: result.status, stderr: '' }) }
    for (const path of paths) { const nextCount = offenders.length + 1; const nextBytes = offenderBytes + Buffer.byteLength(commit, 'utf8') + Buffer.byteLength(path, 'utf8'); if (nextCount > MAX_AUDIT_OFFENDERS) fail('audit-limit', 'Audit offender limit exceeded', { kind: 'offender-count', limit: MAX_AUDIT_OFFENDERS, observed: nextCount }); if (nextBytes > MAX_AUDIT_OFFENDER_UTF8_BYTES) fail('audit-limit', 'Audit offender bytes exceeded', { kind: 'offender-bytes', limit: MAX_AUDIT_OFFENDER_UTF8_BYTES, observed: nextBytes }); offenders.push({ commit, path }); offenderBytes = nextBytes }
  }
  if (offenders.length > 0) { offenders.sort((left, right) => left.commit < right.commit || left.commit === right.commit && left.path < right.path ? -1 : 1); fail('committed-scratch', 'Committed scratch paths found', { offenders }) }
  if (input.scratchRelativePath !== null) {
    const args = ['ls-files', '-z', '--', `:(literal)${input.scratchRelativePath}`]
    result = gitCommand(root, args, undefined, 'check-scratch-tracked', options)
    let tracked
    try { tracked = parseStrictPathList(result.stdout, 'check-scratch-tracked') } catch { fail('git-command', 'Malformed Git output', { args, operation: 'check-scratch-tracked', status: result.status, stderr: '' }) }
    if (tracked.length > 0) fail('scratch-tracked', 'Scratch path is tracked', { path: input.scratchRelativePath })
  }
  const finalArgs = ['rev-parse', '--verify', 'HEAD^{commit}']; result = gitCommand(root, finalArgs, undefined, 'recheck-tip', options); let observedTip; try { observedTip = parseFullCommit(result.stdout, width, 'recheck-tip') } catch { fail('git-command', 'Malformed Git output', { args: finalArgs, operation: 'recheck-tip', status: result.status, stderr: '' }) }
  if (observedTip !== auditTip) fail('history-base', 'Audit tip changed', { auditBase: input.auditBase, expectedTip: auditTip, kind: 'tip-changed', observedTip })

  return { commitsChecked: commits.length, scratchTracked: false }
}

module.exports = { ImplementationDispatchError, classifyImplementationRepository, deriveImplementationTaskBrief, inspectImplementationBoundary, resolveImplementationAuditBase }
