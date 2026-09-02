'use strict'

const { randomUUID } = require('node:crypto')
const nodeFilesystem = require('node:fs')
const nodePath = require('node:path')

const { pathIsContained, resolveTrustedExecutable } = require('../../internal/filesystem-primitives')
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
  if (code === 'dispatch-input' && details && typeof details.field === 'string' && typeof details.reason === 'string' && Object.keys(details).length === 2) return details
  if (code === 'git-command' && details && Array.isArray(details.args) && typeof details.operation === 'string' && (details.status === null || Number.isInteger(details.status)) && typeof details.stderr === 'string' && Object.keys(details).length === 4) return details
  const schemas = {
    'repository-classification': ['cause', 'path'], 'plan-stamp': ['kind'], 'object-format': ['kind', 'objectFormat', 'stampSha', 'storedAuditBase'],
    'ignore-policy': ['expectedPattern', 'observedPattern', 'observedSource', 'path'], 'superpowers-policy': ['expectedPattern', 'observedPattern', 'observedSource', 'path'],
    'history-base': ['auditBase', 'kind'], 'staged-scratch': ['paths'], 'committed-scratch': ['offenders'], 'scratch-allocation': ['cause', 'path'],
    'scratch-tracked': ['path'], 'audit-limit': ['kind', 'limit', 'observed'],
  }
  const expected = schemas[code]
  if (expected && details && Object.keys(details).length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(details, key))) return details
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
  if (typeof repositoryRoot !== 'string' || !nodePath.isAbsolute(repositoryRoot)) throw new CanonicalRootValidationError('root-alias', repositoryRoot)
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
  if (result.error !== null || result.signal !== null || !allowedStatuses.includes(result.status) || result.stderr.length !== 0) throw new Error(`Git command failed for ${operation}`)

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

function gitCommand(repositoryRoot, args, input, operation, options) {
  try {
    let raw
    if (typeof options.git === 'function') raw = options.git(repositoryRoot, args, input ?? null)
    else {
      const trustedGitPath = (options.resolveGitExecutable ?? resolveTrustedExecutable)({ basename: process.platform === 'win32' ? 'git.exe' : 'git', root: repositoryRoot })
      raw = runGit(repositoryRoot, args, { ...(input === undefined ? {} : { input }), ...(options.spawnSync === undefined ? {} : { spawnSync: options.spawnSync }), trustedGitPath })
      raw = normalizeRunGitResult(raw)
    }
    const result = validateGitResultEnvelope(raw, operation)
    if (result.error !== null || result.signal !== null || ![0, 1].includes(result.status) || result.stderr.length !== 0) throw new Error('Git command failed')
    return result
  } catch (error) {
    if (error instanceof ImplementationDispatchError) throw error
    const stderr = error?.stderr instanceof Buffer ? error.stderr.toString('utf8') : ''
    fail('git-command', 'Git command failed', { args, operation, status: null, stderr })
  }
}

function parseExactAsciiLine(bytes, operation, allowed) {
  if (!Buffer.isBuffer(bytes) || !allowed.some((value) => bytes.equals(Buffer.from(`${value}\n`, 'ascii')))) throw new Error(`Malformed ${operation} output`)
  return bytes.toString('ascii').slice(0, -1)
}

function parsePlanStamp(planBytes) {
  const lines = planBytes.toString('utf8').split(/\r?\n/)
  for (const line of lines) {
    if (!line.startsWith('- revise-plan graduated ')) continue
    const match = PLAN_GRADUATION.exec(line)
    if (match === null) fail('plan-stamp', 'Malformed plan stamp', { kind: 'malformed', line })
    const date = line.slice(24, 40)
    const year = Number(date.slice(0, 4)); const month = Number(date.slice(5, 7)); const day = Number(date.slice(8, 10)); const hour = Number(date.slice(11, 13)); const minute = Number(date.slice(14, 16))
    const days = [0, 31, (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month] || hour > 23 || minute > 59) fail('plan-stamp', 'Malformed plan stamp', { kind: 'malformed', line })
    return match[1]
  }
  fail('plan-stamp', 'Plan stamp is missing', { kind: 'missing' })
}

function deriveImplementationTaskBrief(input) {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !['planBytes', 'taskHeading'].includes(key))) fail('dispatch-input', 'Unknown task brief input', { field: Object.keys(input ?? {}).find((key) => !['planBytes', 'taskHeading'].includes(key)) ?? 'input', reason: 'unknown-key' })
  validatePlanBytes(input?.planBytes)
  if (typeof input.taskHeading !== 'string') fail('dispatch-input', 'Task heading is invalid', { field: 'taskId', reason: 'invalid-task-heading' })
  const headingPattern = /^### Task ([1-9][0-9]{0,8}): (.+)$/u
  const match = headingPattern.exec(input.taskHeading)
  if (!match || match[2].length > 1024 || /^\s|\s$/u.test(match[2]) || /\p{Control}/u.test(match[2])) fail('dispatch-input', 'Task heading is invalid', { field: 'taskId', reason: 'invalid-task-heading' })
  const scanned = scanMarkdown(input.planBytes)
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
  let root
  try { root = validateCanonicalRepositoryRoot(input?.repositoryRoot, options.filesystem ?? nodeFilesystem) } catch (error) {
    if (!(error instanceof CanonicalRootValidationError)) throw error
    fail('repository-classification', 'Repository metadata is unavailable', { cause: error.cause === 'root-unavailable' ? 'metadata-unavailable' : 'metadata-not-ordinary', path: error.path })
  }
  try {
    try {
      const marker = (options.filesystem ?? nodeFilesystem).lstatSync(nodePath.join(root, '.git'), { bigint: true })
      if (!marker.isDirectory() && !marker.isFile() || marker.isSymbolicLink() || marker.isReparsePoint?.()) return { kind: 'non-git' }
    } catch {
      return { kind: 'non-git' }
    }
    const result = gitCommand(root, ['rev-parse', '--show-toplevel'], undefined, 'show-toplevel', options)
    if (result.status === 1) return { kind: 'non-git' }
    if (result.stdout.length === 0 || result.stdout[result.stdout.length - 1] !== 0x0a || result.stdout.includes(0x0d) || result.stdout.length < 2) throw new Error('Malformed show-toplevel output')
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
  let root
  try { root = validateCanonicalRepositoryRoot(input.repositoryRoot, options.filesystem ?? nodeFilesystem) } catch (error) {
    if (!(error instanceof CanonicalRootValidationError)) throw error
    fail('dispatch-input', 'Repository root is invalid', { field: 'repositoryRoot', reason: error.cause })
  }
  const stampSha = parsePlanStamp(input.planBytes)
  if (input.storedAuditBase !== null && !input.storedAuditBase.startsWith(stampSha)) fail('object-format', 'Stored audit base does not match stamp', { kind: 'resolved-id-mismatch', objectFormat: null, stampSha, storedAuditBase: input.storedAuditBase })
  const formatResult = gitCommand(root, ['rev-parse', '--show-object-format=storage'], undefined, 'show-object-format', options)
  const objectFormat = parseExactAsciiLine(formatResult.stdout, 'show-object-format', ['sha1', 'sha256'])
  const width = objectFormat === 'sha1' ? 40 : 64
  if (input.storedAuditBase !== null && input.storedAuditBase.length !== width) fail('object-format', 'Audit base width does not match object format', { kind: 'width-mismatch', objectFormat, stampSha, storedAuditBase: input.storedAuditBase })
  const value = input.storedAuditBase ?? stampSha
  const resolved = gitCommand(root, ['rev-parse', '--verify', `${value}^{commit}`], undefined, 'resolve-commit', options)
  let auditBase
  try {
    if (resolved.stdout.length !== width + 1 || resolved.stdout[width] !== 0x0a || !/^[0-9a-f]+$/.test(resolved.stdout.subarray(0, width).toString('ascii'))) throw new Error('Malformed commit id')
    auditBase = resolved.stdout.subarray(0, width).toString('ascii')
  } catch {
    fail('object-format', 'Commit resolution failed', { kind: 'resolution-failed', objectFormat, stampSha, storedAuditBase: input.storedAuditBase })
  }
  if (auditBase.length !== width || (input.storedAuditBase !== null && auditBase !== input.storedAuditBase)) fail('object-format', 'Resolved commit differs', { kind: 'resolved-id-mismatch', objectFormat, stampSha, storedAuditBase: input.storedAuditBase })

  return { auditBase, objectFormat, stampSha }
}

module.exports = { ImplementationDispatchError, classifyImplementationRepository, deriveImplementationTaskBrief, resolveImplementationAuditBase }
