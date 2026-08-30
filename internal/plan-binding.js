'use strict'

const nodeFilesystem = require('node:fs')
const { constants: filesystemConstants } = require('node:fs')
const nodePath = require('node:path')

const { resolveTrustedExecutable } = require('../skills/init-backlog/lib/filesystem')
const { runGit } = require('../skills/init-backlog/lib/git-policy')
const { prepareProvenanceWrite, productionBindingAdapter, productionFsAdapter, writeBoundProvenanceStamp } = require('../skills/spec-agreement/spec-agreement')

const MAX_PLAN_BYTES = 2_097_152
const MAX_PLAN_CANDIDATES = 128
const MAX_PLAN_CANDIDATE_BYTES = 16_777_216
const READ_CHUNK_BYTES = 65_536
const BINDING_KEYS = Object.freeze([
  'classification',
  'ctimeNs',
  'declaredBoundary',
  'dev',
  'exactUserPath',
  'globalPlansRoot',
  'ino',
  'logicalPath',
  'mode',
  'mtimeNs',
  'nlink',
  'realPath',
  'repositoryRelativePath',
  'repositoryRoot',
  'size',
])
const NUMERIC_BINDING_KEYS = Object.freeze(['ctimeNs', 'dev', 'ino', 'mode', 'mtimeNs', 'nlink', 'size'])

class PlanBindingError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`)
    this.name = 'PlanBindingError'
    this.code = code
    this.details = details
  }
}

function fail(code, message, details) {
  throw new PlanBindingError(code, message, details)
}

function hasExactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value).sort()
  const expectedKeys = [...expected].sort()

  return keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
}

function comparablePath(path, platform = process.platform) {
  const normalized = nodePath.normalize(path)

  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function samePath(left, right, platform = process.platform) {
  return comparablePath(left, platform) === comparablePath(right, platform)
}

function pathIsContained(root, target, platform = process.platform) {
  const pathApi = platform === 'win32' ? nodePath.win32 : nodePath
  const relation = pathApi.relative(root, target)

  return relation !== '' && relation !== '..' && !relation.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relation)
}

function canonicalDirectory(path, filesystem, allowMissing = false) {
  if (typeof path !== 'string' || path === '' || !nodePath.isAbsolute(path)) {
    fail('plan-input', 'Plan roots must be absolute paths')
  }
  const absolute = nodePath.resolve(path)
  try {
    const realPath = filesystem.realpathSync.native(absolute)
    const metadata = filesystem.lstatSync(realPath, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      fail('plan-boundary', 'Plan boundary is not an ordinary directory', { path: absolute })
    }

    return realPath
  } catch (error) {
    if (allowMissing && error.code === 'ENOENT') {
      return absolute
    }
    if (error instanceof PlanBindingError) {
      throw error
    }
    fail('plan-boundary', 'Plan boundary cannot be resolved', { path: absolute })
  }
}

function requireCanonicalComponents(boundary, realPath, filesystem) {
  const relation = nodePath.relative(boundary, realPath)
  if (relation === '' || relation === '..' || relation.startsWith(`..${nodePath.sep}`) || nodePath.isAbsolute(relation)) {
    fail('plan-containment', 'Plan is outside its declared boundary', { boundary, realPath })
  }
  let current = boundary
  const segments = relation.split(nodePath.sep)
  for (let index = 0; index < segments.length; index += 1) {
    current = nodePath.join(current, segments[index])
    let metadata
    try {
      metadata = filesystem.lstatSync(current, { bigint: true })
    } catch {
      fail('plan-unreadable', 'Plan component cannot be inspected', { path: current })
    }
    const leaf = index === segments.length - 1
    if (metadata.isSymbolicLink() || (leaf ? !metadata.isFile() : !metadata.isDirectory())) {
      fail('plan-link', 'Plan components must be ordinary direct filesystem objects', { path: current })
    }
    let resolved
    try {
      resolved = filesystem.realpathSync.native(current)
    } catch {
      fail('plan-unreadable', 'Plan component cannot be resolved', { path: current })
    }
    if (!samePath(current, resolved)) {
      fail('plan-link', 'Plan components cannot use aliases or reparse points', { path: current })
    }
  }
}

function classifyPlan(input, filesystem) {
  if (!hasExactKeys(input, ['exactUserPath', 'globalPlansRoot', 'logicalPath', 'repositoryRoot'])
    || typeof input.exactUserPath !== 'boolean'
    || typeof input.logicalPath !== 'string'
    || !nodePath.isAbsolute(input.logicalPath)) {
    fail('plan-input', 'Plan binding input is invalid')
  }
  const repositoryRoot = canonicalDirectory(input.repositoryRoot, filesystem)
  const globalPlansRoot = canonicalDirectory(input.globalPlansRoot, filesystem, true)
  const logicalPath = nodePath.resolve(input.logicalPath)
  let realPath
  try {
    realPath = filesystem.realpathSync.native(logicalPath)
  } catch {
    fail('plan-unreadable', 'Plan cannot be resolved', { path: logicalPath })
  }
  if (!samePath(logicalPath, realPath)) {
    fail('plan-link', 'Plan logical path must be its direct physical path', { logicalPath, realPath })
  }
  let classification
  let declaredBoundary
  let repositoryRelativePath = null
  if (pathIsContained(repositoryRoot, realPath)) {
    classification = 'repository'
    declaredBoundary = repositoryRoot
    repositoryRelativePath = nodePath.relative(repositoryRoot, realPath).split(nodePath.sep).join('/')
  } else if (pathIsContained(globalPlansRoot, realPath)) {
    classification = 'global'
    declaredBoundary = globalPlansRoot
  } else {
    if (!input.exactUserPath) {
      fail('plan-external-authority', 'External plan requires an exact user path', { path: logicalPath })
    }
    classification = 'external'
    declaredBoundary = canonicalDirectory(nodePath.dirname(realPath), filesystem)
  }
  requireCanonicalComponents(declaredBoundary, realPath, filesystem)

  return { classification, declaredBoundary, exactUserPath: input.exactUserPath, globalPlansRoot, logicalPath, realPath, repositoryRelativePath, repositoryRoot }
}

function metadataRecord(metadata) {
  return Object.fromEntries(NUMERIC_BINDING_KEYS.map((key) => [key, metadata[key].toString()]))
}

function requireOrdinarySingleLink(metadata, realPath) {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) {
    fail('plan-file-kind', 'Plan must be one ordinary single-linked file', { path: realPath })
  }
}

function stateMatches(metadata, expected) {
  return NUMERIC_BINDING_KEYS.every((key) => metadata[key].toString() === expected[key])
}

function readAtMost(descriptor, maximumBytes, filesystem) {
  const chunks = []
  let position = 0
  while (position <= maximumBytes) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maximumBytes + 1 - position))
    const count = filesystem.readSync(descriptor, chunk, 0, chunk.length, position)
    if (count === 0) {
      break
    }
    chunks.push(Buffer.from(chunk.subarray(0, count)))
    position += count
  }
  if (position > maximumBytes) {
    fail('plan-too-large', 'Plan exceeds the maximum byte size', { maximumBytes, observedBytes: position })
  }

  return Buffer.concat(chunks, position)
}

function compareSecondRead(descriptor, expected, maximumBytes, filesystem) {
  let position = 0
  let equal = true
  while (position <= maximumBytes) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, maximumBytes + 1 - position))
    const count = filesystem.readSync(descriptor, chunk, 0, chunk.length, position)
    if (count === 0) {
      break
    }
    if (position + count > expected.length || !chunk.subarray(0, count).equals(expected.subarray(position, position + count))) {
      equal = false
    }
    position += count
  }
  if (position > maximumBytes) {
    fail('plan-too-large', 'Plan exceeds the maximum byte size', { maximumBytes, observedBytes: position })
  }

  return equal && position === expected.length
}

function captureStableBytes(realPath, expectedState, filesystem) {
  if (BigInt(expectedState.size) > BigInt(MAX_PLAN_BYTES)) {
    fail('plan-too-large', 'Plan exceeds the maximum byte size', { maximumBytes: MAX_PLAN_BYTES, observedBytes: Number(expectedState.size), path: realPath })
  }
  const noFollow = process.platform === 'win32' ? 0 : filesystemConstants.O_NOFOLLOW ?? 0
  let descriptor
  try {
    descriptor = filesystem.openSync(realPath, filesystemConstants.O_RDONLY | noFollow)
  } catch {
    fail('plan-unreadable', 'Plan cannot be opened through a no-follow handle', { path: realPath })
  }
  try {
    const before = filesystem.fstatSync(descriptor, { bigint: true })
    requireOrdinarySingleLink(before, realPath)
    if (!stateMatches(before, expectedState)) {
      fail('plan-stale', 'Plan binding changed before capture', { path: realPath })
    }
    const bytes = readAtMost(descriptor, MAX_PLAN_BYTES, filesystem)
    const between = filesystem.fstatSync(descriptor, { bigint: true })
    if (!stateMatches(between, expectedState) || !compareSecondRead(descriptor, bytes, MAX_PLAN_BYTES, filesystem)) {
      fail('plan-stale', 'Plan changed between stable reads', { path: realPath })
    }
    const after = filesystem.fstatSync(descriptor, { bigint: true })
    if (!stateMatches(after, expectedState)) {
      fail('plan-stale', 'Plan changed during stable capture', { path: realPath })
    }

    return bytes
  } catch (error) {
    if (error instanceof PlanBindingError) {
      throw error
    }
    fail('plan-unreadable', 'Plan could not be captured through its retained handle', { path: realPath })
  } finally {
    try {
      filesystem.closeSync(descriptor)
    } catch {
      fail('plan-unreadable', 'Plan handle could not be closed', { path: realPath })
    }
  }
}

function defaultGitPolicy(request, options) {
  const gitExecutable = options.gitExecutable ?? resolveTrustedExecutable({
    basename: process.platform === 'win32' ? 'git.exe' : 'git',
    protectedRoots: [request.globalPlansRoot],
    root: request.repositoryRoot,
  })
  const run = (args) => runGit(request.repositoryRoot, args, { trustedGitPath: gitExecutable })
  const tracked = run(['ls-files', '-z', '--', request.repositoryRelativePath])
  if (tracked.error || tracked.signal || tracked.status !== 0 || tracked.stderr.length !== 0) {
    fail('plan-git-policy', 'Repository tracking state could not be established', { path: request.repositoryRelativePath })
  }
  if (tracked.stdout.length !== 0) {
    fail('plan-git-policy', 'Repository plan must be untracked', { path: request.repositoryRelativePath })
  }
  const ignored = run(['check-ignore', '--quiet', '--', request.repositoryRelativePath])
  if (ignored.error || ignored.signal || ignored.status !== 0 || ignored.stderr.length !== 0) {
    fail('plan-git-policy', 'Repository plan is not ignored', { path: request.repositoryRelativePath })
  }
}

function createBinding(classified, metadata) {
  const state = metadataRecord(metadata)

  return {
    classification: classified.classification,
    ctimeNs: state.ctimeNs,
    declaredBoundary: classified.declaredBoundary,
    dev: state.dev,
    exactUserPath: classified.exactUserPath,
    globalPlansRoot: classified.globalPlansRoot,
    ino: state.ino,
    logicalPath: classified.logicalPath,
    mode: state.mode,
    mtimeNs: state.mtimeNs,
    nlink: state.nlink,
    realPath: classified.realPath,
    repositoryRelativePath: classified.repositoryRelativePath,
    repositoryRoot: classified.repositoryRoot,
    size: state.size,
  }
}

function validateBinding(binding) {
  if (!hasExactKeys(binding, BINDING_KEYS)
    || !['repository', 'global', 'external'].includes(binding.classification)
    || typeof binding.declaredBoundary !== 'string'
    || typeof binding.exactUserPath !== 'boolean'
    || typeof binding.globalPlansRoot !== 'string'
    || typeof binding.logicalPath !== 'string'
    || typeof binding.realPath !== 'string'
    || !(binding.repositoryRelativePath === null || typeof binding.repositoryRelativePath === 'string')
    || typeof binding.repositoryRoot !== 'string'
    || NUMERIC_BINDING_KEYS.some((key) => typeof binding[key] !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(binding[key]))) {
    fail('plan-binding-shape', 'Plan binding is not canonical')
  }
}

function authorityInput(binding) {
  return {
    exactUserPath: binding.exactUserPath,
    globalPlansRoot: binding.globalPlansRoot,
    logicalPath: binding.logicalPath,
    repositoryRoot: binding.repositoryRoot,
  }
}

function establishPlanBinding(input, options = {}) {
  const filesystem = options.filesystem ?? nodeFilesystem
  const classified = classifyPlan(input, filesystem)
  let metadata
  try {
    metadata = filesystem.lstatSync(classified.realPath, { bigint: true })
  } catch {
    fail('plan-unreadable', 'Plan cannot be inspected', { path: classified.realPath })
  }
  requireOrdinarySingleLink(metadata, classified.realPath)
  const binding = createBinding(classified, metadata)
  if (binding.classification === 'repository') {
    const gitPolicy = options.gitPolicy ?? ((request) => defaultGitPolicy(request, options))
    gitPolicy({
      globalPlansRoot: classified.globalPlansRoot,
      repositoryRelativePath: binding.repositoryRelativePath,
      repositoryRoot: classified.repositoryRoot,
    })
  }
  const bytes = captureStableBytes(binding.realPath, binding, filesystem)
  let after
  let afterRealPath
  try {
    after = filesystem.lstatSync(binding.realPath, { bigint: true })
    afterRealPath = filesystem.realpathSync.native(binding.logicalPath)
  } catch {
    fail('plan-stale', 'Plan changed after stable capture', { path: binding.logicalPath })
  }
  if (!stateMatches(after, binding) || !samePath(afterRealPath, binding.realPath)) {
    fail('plan-stale', 'Plan changed after stable capture', { path: binding.logicalPath })
  }

  return { binding, bytes }
}

function sameBinding(left, right) {
  return BINDING_KEYS.every((key) => left[key] === right[key])
}

function revalidatePlanBinding(binding, options = {}) {
  validateBinding(binding)
  const current = establishPlanBinding(authorityInput(binding), options)
  if (!sameBinding(binding, current.binding)) {
    fail('plan-stale', 'Retained plan binding is stale', { current: current.binding, expected: binding })
  }

  return { binding, bytes: current.bytes }
}

function refreshPlanBinding(input, options = {}) {
  if (!hasExactKeys(input, ['binding', 'expectedBytes']) || !Buffer.isBuffer(input.expectedBytes)) {
    fail('plan-input', 'Plan refresh input is invalid')
  }
  validateBinding(input.binding)
  const refreshed = establishPlanBinding(authorityInput(input.binding), options)
  for (const key of ['classification', 'declaredBoundary', 'exactUserPath', 'globalPlansRoot', 'logicalPath', 'repositoryRelativePath', 'repositoryRoot']) {
    if (refreshed.binding[key] !== input.binding[key]) {
      fail('plan-authority-changed', 'Plan authority changed during refresh', { key })
    }
  }
  if (!refreshed.bytes.equals(input.expectedBytes)) {
    fail('plan-replacement-mismatch', 'Plan replacement bytes differ from the intended result')
  }

  return refreshed
}

function toProvenanceBinding(binding) {
  validateBinding(binding)

  return {
    ctimeNs: binding.ctimeNs,
    dev: binding.dev,
    ino: binding.ino,
    mode: binding.mode,
    mtimeNs: binding.mtimeNs,
    nlink: binding.nlink,
    realPath: binding.realPath,
    size: binding.size,
  }
}

function writePlanProvenanceStamp(input, options = {}) {
  if (!hasExactKeys(input, ['baselineHash', 'binding', 'stamp']) || typeof input.baselineHash !== 'string' || typeof input.stamp !== 'string') {
    fail('plan-input', 'Plan provenance input is invalid')
  }
  const current = revalidatePlanBinding(input.binding, options)
  const prepared = prepareProvenanceWrite(current.bytes, input.stamp, input.baselineHash)
  if (prepared.nextBytes.length > MAX_PLAN_BYTES) {
    fail('plan-too-large', 'Plan provenance would exceed the maximum byte size', { maximumBytes: MAX_PLAN_BYTES, observedBytes: prepared.nextBytes.length })
  }
  const writer = options.provenanceWriter ?? writeBoundProvenanceStamp
  const relativePath = nodePath.relative(current.binding.declaredBoundary, current.binding.realPath).split(nodePath.sep).join('/')
  const written = writer({
    projectRoot: current.binding.declaredBoundary,
    path: relativePath,
    stamp: input.stamp,
    baselineHash: input.baselineHash,
    binding: toProvenanceBinding(current.binding),
  }, {
    fsAdapter: options.provenanceFsAdapter ?? productionFsAdapter(),
    bindingAdapter: options.provenanceBindingAdapter ?? productionBindingAdapter(),
  })
  if (written === null || typeof written !== 'object' || !Buffer.isBuffer(written.bytes) || typeof written.alreadyApplied !== 'boolean') {
    fail('plan-provenance-result', 'Plan provenance writer returned an invalid result')
  }
  const refreshed = refreshPlanBinding({ binding: current.binding, expectedBytes: written.bytes }, options)

  return { alreadyApplied: written.alreadyApplied, binding: refreshed.binding, bytes: refreshed.bytes }
}

function deleteBoundPlan(binding, options = {}) {
  validateBinding(binding)
  const filesystem = options.filesystem ?? nodeFilesystem
  try {
    filesystem.lstatSync(binding.logicalPath, { bigint: true })
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { alreadyAbsent: true, binding: null }
    }
    fail('plan-unreadable', 'Plan deletion target cannot be inspected', { path: binding.logicalPath })
  }
  const current = revalidatePlanBinding(binding, options)
  try {
    filesystem.unlinkSync(current.binding.realPath)
  } catch {
    fail('plan-delete-failed', 'Plan could not be removed', { path: current.binding.realPath })
  }
  try {
    filesystem.lstatSync(current.binding.logicalPath, { bigint: true })
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { alreadyAbsent: false, binding: null }
    }
    fail('plan-delete-failed', 'Plan absence could not be verified', { path: current.binding.logicalPath })
  }
  fail('plan-delete-failed', 'Plan still exists after removal', { path: current.binding.logicalPath })
}

function validateCandidate(candidate) {
  if (!hasExactKeys(candidate, ['exactUserPath', 'logicalPath']) || typeof candidate.exactUserPath !== 'boolean' || typeof candidate.logicalPath !== 'string') {
    fail('plan-candidate-shape', 'Plan candidate is invalid')
  }
}

function capturePlanCandidateEvidence(input, options = {}) {
  if (!hasExactKeys(input, ['enumerateCandidates', 'globalPlansRoot', 'repositoryRoot']) || typeof input.enumerateCandidates !== 'function') {
    fail('plan-input', 'Plan candidate evidence input is invalid')
  }
  const first = input.enumerateCandidates()
  if (!Array.isArray(first) || first.length > MAX_PLAN_CANDIDATES) {
    fail('plan-candidate-count', 'Plan candidate count exceeds its limit', { maximumCandidates: MAX_PLAN_CANDIDATES, observedCandidates: Array.isArray(first) ? first.length : null })
  }
  first.forEach(validateCandidate)
  const firstSignature = JSON.stringify(first.map((candidate) => [candidate.logicalPath, candidate.exactUserPath]))
  if (new Set(first.map((candidate) => `${candidate.logicalPath}\u0000${candidate.exactUserPath}`)).size !== first.length) {
    fail('plan-candidate-duplicate', 'Plan candidate enumeration contains duplicates')
  }
  const evidence = []
  let aggregateBytes = 0
  for (const candidate of first) {
    const captured = establishPlanBinding({
      exactUserPath: candidate.exactUserPath,
      globalPlansRoot: input.globalPlansRoot,
      logicalPath: candidate.logicalPath,
      repositoryRoot: input.repositoryRoot,
    }, options)
    aggregateBytes += captured.bytes.length
    if (aggregateBytes > MAX_PLAN_CANDIDATE_BYTES) {
      fail('plan-candidate-aggregate-bytes', 'Plan candidate aggregate-bytes limit was exceeded', { maximumBytes: MAX_PLAN_CANDIDATE_BYTES, observedBytes: aggregateBytes })
    }
    evidence.push(captured)
  }
  const second = input.enumerateCandidates()
  if (!Array.isArray(second) || second.length > MAX_PLAN_CANDIDATES) {
    fail('plan-candidate-shape', 'Plan candidate enumeration is invalid')
  }
  second.forEach(validateCandidate)
  const secondSignature = JSON.stringify(second.map((candidate) => [candidate.logicalPath, candidate.exactUserPath]))
  if (firstSignature !== secondSignature) {
    fail('plan-candidate-drift', 'Plan candidate set changed during capture')
  }

  return { aggregateBytes, evidence }
}

module.exports = {
  BINDING_KEYS,
  MAX_PLAN_BYTES,
  MAX_PLAN_CANDIDATE_BYTES,
  MAX_PLAN_CANDIDATES,
  PlanBindingError,
  capturePlanCandidateEvidence,
  deleteBoundPlan,
  establishPlanBinding,
  refreshPlanBinding,
  revalidatePlanBinding,
  toProvenanceBinding,
  writePlanProvenanceStamp,
}
