'use strict'

const { randomBytes } = require('node:crypto')
const {
  closeSync,
  chmodSync,
  constants,
  fstatSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} = require('node:fs')
const { spawnSync } = require('node:child_process')
const { TextDecoder } = require('node:util')
const { dirname, isAbsolute, join } = require('node:path')

const { InitBacklogError } = require('./errors')
const { DIGEST_PATTERN, MAX_APPLY_REQUEST_BYTES, MAX_INSPECT_REQUEST_BYTES, MAX_RECOVERY_REQUEST_BYTES, NONCE_PATTERN, OWNER_BASENAME: REQUEST_OWNER_BASENAME, OWNER_STAGE_BASENAME: REQUEST_OWNER_STAGE_BASENAME, RECOVERY_LOCK_BASENAME, assertSafeWindowsScalar, canonicalJson, compareOrdinal, sameKeys, validateNonce } = require('./protocol')
const {
  buildProtectedRoots,
  candidateInProtectedRoots,
  comparableIdentity,
  comparableMode,
  pathIsContained,
  resolveTrustedExecutable: resolveTrustedExecutablePrimitive,
  stableMetadata,
  stableOpenFile: stableOpenFilePrimitive,
} = require('../../../internal/filesystem-primitives')

const REQUEST_GATE_BASENAME = '.nightshift-init-backlog.request-gate'
const REQUEST_PAYLOAD_BASENAME = 'request.json'
const OWNER_STAGE_CHILDREN = [REQUEST_OWNER_BASENAME, REQUEST_OWNER_STAGE_BASENAME].sort().join(',')
const OWNER_PAYLOAD_CHILDREN = [REQUEST_OWNER_BASENAME, REQUEST_PAYLOAD_BASENAME].sort().join(',')
const OWNER_STAGE_PAYLOAD_CHILDREN = [REQUEST_OWNER_BASENAME, REQUEST_OWNER_STAGE_BASENAME, REQUEST_PAYLOAD_BASENAME].sort().join(',')

class RequestTransportResidueError extends Error {
  constructor(cause) {
    super('Request transport cleanup left residue.', { cause })
    this.name = 'RequestTransportResidueError'
  }
}

function transportError(code, detail, cause) {
  throw new InitBacklogError({ code, ok: false }, { cause: cause ?? new Error(detail) })
}

function canonicalRoot(root) {
  try {
    assertSafeWindowsScalar(root)
    if (typeof root !== 'string' || !isAbsolute(root)) {
      transportError('request-filesystem', 'Request root is invalid.')
    }
    const nativeSpelling = process.platform === 'win32' ? root.replaceAll('/', '\\') : root
    const canonical = realpathSync.native(nativeSpelling)
    const metadata = lstatSync(canonical)
    if (canonical !== nativeSpelling || !metadata.isDirectory() || metadata.isSymbolicLink()) {
      transportError('request-filesystem', 'Request root is not canonical.')
    }

    return canonical
  } catch (error) {
    if (error instanceof InitBacklogError) {
      throw error
    }
    transportError('request-filesystem', 'Request root validation failed.', error)
  }
}

function pathExists(path) {
  try {
    lstatSync(path)

    return true
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') {
      return false
    }

    throw error
  }
}

function platformMode(options, mode) {
  return (options.platform ?? process.platform) === 'win32' ? null : mode
}

function stableOpenFile(root, target, options = {}) {
  return stableOpenFilePrimitive(root, target, { ...options, canonicalizeRoot: canonicalRoot })
}

function boundedOpenOptions(options, maxBytes, overrides = {}) {
  return { ...options, ...overrides, maxBytes: Math.min(options.maxBytes ?? maxBytes, maxBytes) }
}

function readExactFile(path, expectedBytes, options = {}, requireSingleLink = true) {
  const actual = options.readFileSync === undefined
    ? stableOpenFile(dirname(path), path, boundedOpenOptions(options, expectedBytes.length, { requireSingleLink })).bytes
    : options.readFileSync(path)
  if (!actual.equals(expectedBytes)) throw new Error('Staged file readback differs')

  return actual
}

function decodeDirectoryName(name, platform = process.platform) {
  if (platform === 'win32') {
    assertSafeWindowsScalar(name, platform)

    return name
  }
  if (!Buffer.isBuffer(name)) {
    throw new TypeError('Directory names must be returned as bytes')
  }
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(name)
  } catch (error) {
    const invalidName = new TypeError('Directory name is not valid UTF-8', { cause: error })
    invalidName.code = 'invalid-directory-name'
    throw invalidName
  }
  if (!Buffer.from(decoded, 'utf8').equals(name)) {
    const invalidName = new TypeError('Directory name does not round-trip as UTF-8')
    invalidName.code = 'invalid-directory-name'
    throw invalidName
  }

  return decoded
}

function directoryNameComparator(platform) {
  return platform === 'win32' ? compareOrdinal : (left, right) => Buffer.from(left, 'utf8').compare(Buffer.from(right, 'utf8'))
}

function directoryNameFilter(options) {
  if (options.includeName !== undefined && typeof options.includeName !== 'function') {
    throw new TypeError('Directory name filter must be a function')
  }

  return options.includeName ?? (() => true)
}

function visitDirectoryNames(directory, options, visit) {
  const platform = options.platform ?? process.platform
  const injectedReadDirectory = options.readdirSync ?? options.readdir
  if (options.maxEntries !== undefined && (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 0)) {
    throw new TypeError('maxEntries must be a nonnegative safe integer')
  }
  let entryCount = 0
  const accept = (rawName) => {
    entryCount += 1
    if (options.maxEntries !== undefined && entryCount > options.maxEntries) {
      const error = new Error('Directory exceeds its entry limit')
      error.code = 'directory-too-large'
      throw error
    }
    const name = decodeDirectoryName(rawName, platform)
    assertSafeWindowsScalar(name, platform)
    visit(name)
  }
  if (injectedReadDirectory) {
    for (const rawName of injectedReadDirectory(directory, platform === 'win32' ? { encoding: 'utf8' } : { encoding: 'buffer' })) accept(rawName)
  } else {
    const openDirectory = options.opendirSync ?? opendirSync
    const handle = openDirectory(directory, platform === 'win32' ? { encoding: 'utf8' } : { encoding: 'buffer' })
    try {
      while (true) {
        const entry = handle.readSync()
        if (entry === null) break
        accept(entry.name)
      }
    } finally {
      handle.closeSync()
    }
  }
}

function readDirectoryNames(directory, options = {}) {
  const platform = options.platform ?? process.platform
  const includeName = directoryNameFilter(options)
  if (options.maxSelectedEntries !== undefined && (!Number.isSafeInteger(options.maxSelectedEntries) || options.maxSelectedEntries < 0)) {
    throw new TypeError('maxSelectedEntries must be a nonnegative safe integer')
  }
  const selected = []
  visitDirectoryNames(directory, options, (name) => {
    if (!includeName(name)) return
    if (options.maxSelectedEntries !== undefined && selected.length >= options.maxSelectedEntries) {
      const error = new Error('Directory exceeds its selected entry limit')
      error.code = 'directory-too-large'
      throw error
    }
    selected.push(name)
  })
  selected.sort(directoryNameComparator(platform))

  return selected
}

function readOrdinalFirstDirectoryName(directory, options = {}) {
  const platform = options.platform ?? process.platform
  const includeName = directoryNameFilter(options)
  const compare = directoryNameComparator(platform)
  let first = null
  visitDirectoryNames(directory, options, (name) => {
    if (!includeName(name)) return
    if (first === null || compare(name, first) < 0) first = name
  })

  return first
}

function enumerateDirectory(directory, options = {}) {
  const platform = options.platform ?? process.platform
  if (platform === 'win32' && typeof options.attributeProbe !== 'function') {
    throw new Error('Windows directory enumeration requires an attribute probe')
  }
  const entries = readDirectoryNames(directory, options).map((name) => {
    const target = join(directory, name)
    const metadata = lstatSync(target, { bigint: true })
    if (metadata.isSymbolicLink() || (!metadata.isFile() && !metadata.isDirectory())) {
      throw new Error('Directory contains a link or special object')
    }

    return { metadata, name, path: target }
  })

  if (platform === 'win32' && entries.length > 0) {
    const paths = entries.map((entry) => entry.path)
    const before = options.attributeProbe(paths)
    validateAttributeProbe(before, paths)
    const after = options.attributeProbe(paths)
    validateAttributeProbe(after, paths)
    if (before.systemDirectory.toLowerCase() !== after.systemDirectory.toLowerCase() || before.items.some((item, index) => item.attributes !== after.items[index].attributes || item.path !== after.items[index].path || item.reparsePoint !== after.items[index].reparsePoint)) {
      throw new Error('Windows directory attributes changed during enumeration')
    }
  }

  return entries
}

function targetPath(root, target) {
  return join(root, ...target.split('/'))
}

function containedTargetPath(root, target, message) {
  const path = targetPath(root, target)
  if (!pathIsContained(root, path)) {
    throw new Error(message)
  }

  return path
}

function canonicalAbsolutePath(path, platform) {
  const pathModule = platform === 'win32' ? require('node:path').win32 : require('node:path')
  assertSafeWindowsScalar(path, platform)
  return typeof path === 'string' && pathModule.isAbsolute(path) && pathModule.normalize(path) === path
}

function validateAttributeProbe(response, paths) {
  if (response === null || typeof response !== 'object') {
    throw new Error('Windows attribute helper response is invalid')
  }
  const responseKeys = Object.keys(response).sort(compareOrdinal)
  const successKeys = ['items', 'ok', 'systemDirectory'].sort(compareOrdinal)
  if (response.ok !== true && response.ok !== false) {
    throw new Error('Windows attribute helper response is invalid')
  }
  if (response.ok === false) {
    if (responseKeys.join('\0') !== ['code', 'index', 'ok'].sort(compareOrdinal).join('\0') || response.code !== 'attribute-read-failed' || !Number.isSafeInteger(response.index) || response.index < 0 || response.index >= paths.length) {
      throw new Error('Windows attribute helper failure is invalid')
    }
    throw new Error('Windows attribute helper reported a read failure')
  }
  if (responseKeys.join('\0') !== successKeys.join('\0') || !Array.isArray(response.items) || response.items.length !== paths.length || !canonicalAbsolutePath(response.systemDirectory, 'win32')) {
    throw new Error('Windows attribute helper response is invalid')
  }
  response.items.forEach((item, index) => {
    if (!sameKeys(item, ['attributes', 'path', 'reparsePoint']) || item.path !== paths[index] || !Number.isSafeInteger(item.attributes) || item.attributes < 0 || item.reparsePoint !== ((item.attributes & 0x400) === 0x400)) {
      throw new Error('Windows attribute helper item is invalid')
    }
    if (item.reparsePoint) {
      throw new Error('Windows reparse point is not allowed')
    }
  })

  return response
}

function resolveTrustedExecutable(options = {}) {
  return resolveTrustedExecutablePrimitive(options)
}

function trustedWindowsPowerShellPath(options = {}) {
  const platform = options.platform ?? process.platform
  const pathModule = require('node:path').win32
  const systemRoot = options.systemRoot ?? process.env.SystemRoot
  if (platform !== 'win32' || typeof systemRoot !== 'string' || systemRoot.length === 0 || !pathModule.isAbsolute(systemRoot)) {
    throw new Error('SystemRoot is invalid')
  }
  const root = realpathSync.native(systemRoot)
  const candidate = pathModule.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const roots = buildProtectedRoots(options, pathModule)
  if (candidateInProtectedRoots(roots, candidate, pathModule)) {
    throw new Error('Trusted Windows PowerShell path differs')
  }
  const first = stableMetadata(candidate)
  const second = stableMetadata(candidate)
  if (first.resolved !== candidate || second.resolved !== candidate || comparableIdentity(first.metadata) !== comparableIdentity(second.metadata) || !first.metadata.isFile() || !second.metadata.isFile()) {
    throw new Error('Trusted Windows PowerShell path is not stable')
  }

  return candidate
}

function runBoundedReadOnlyHelper(executable, args, input, options = {}) {
  const spawn = options.spawnSync ?? spawnSync
  const result = spawn(executable, args, {
    input: Buffer.isBuffer(input) ? input : Buffer.from(input ?? '', 'utf8'),
    killSignal: 'SIGKILL',
    maxBuffer: options.maxBuffer ?? 1048577,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: options.timeout ?? 30000,
    windowsHide: true,
  })
  if (result.error || result.signal !== null || result.status !== 0 || !Buffer.isBuffer(result.stdout) || !Buffer.isBuffer(result.stderr) || result.stderr.length > (options.maxStderr ?? 65536)) {
    throw new Error('Bounded helper failed')
  }

  return { stderr: result.stderr, stdout: result.stdout }
}

function probeWindowsAttributes(paths, options = {}) {
  const platform = options.platform ?? process.platform
  if (!Array.isArray(paths) || paths.some((path) => !canonicalAbsolutePath(path, platform)) || paths.some((path, index) => index > 0 && compareOrdinal(paths[index - 1], path) >= 0)) {
    throw new Error('Windows attribute paths are invalid')
  }
  const request = { operation: 'attributes', paths: paths.slice() }
  let response
  if (typeof options.runHelper === 'function') {
    response = options.runHelper(request)
  } else {
    const executable = options.trustedWindowsPowerShellPath ?? trustedWindowsPowerShellPath(options)
    const helperPath = options.helperPath ?? join(__dirname, '..', 'windows-attributes.ps1')
    const details = runBoundedReadOnlyHelper(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', helperPath], Buffer.from(canonicalJson(request) + '\n', 'utf8'), options)
    if (!details.stdout.equals(Buffer.from(details.stdout.toString('utf8'), 'utf8')) || !details.stdout.toString('utf8').endsWith('\n') || details.stdout.toString('utf8').slice(0, -1).includes('\n')) {
      throw new Error('Windows helper output is not UTF-8')
    }
    const outputText = details.stdout.toString('utf8').slice(0, -1)
    response = JSON.parse(outputText)
    if (canonicalJson(response) !== outputText) {
      throw new Error('Windows helper output is not canonical')
    }
  }
  validateAttributeProbe(response, paths)

  return response
}

function withAttributeProbe(options = {}) {
  const platform = options.platform ?? process.platform

  return platform === 'win32' && typeof options.attributeProbe !== 'function' ? { ...options, attributeProbe: (paths) => probeWindowsAttributes(paths, options) } : options
}

function requestPaths(root) {
  const requestDirectory = join(root, REQUEST_GATE_BASENAME)

  return {
    owner: join(requestDirectory, REQUEST_OWNER_BASENAME),
    ownerStage: join(requestDirectory, REQUEST_OWNER_STAGE_BASENAME),
    payload: join(requestDirectory, REQUEST_PAYLOAD_BASENAME),
    requestDirectory,
  }
}

function verifyDirectory(path, expectedMode = 0o700) {
  const metadata = lstatSync(path, { bigint: true })
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Request gate is not an ordinary directory')
  }
  if (process.platform !== 'win32' && comparableMode(metadata) !== expectedMode) {
    throw new Error('Request gate mode is invalid')
  }

  return metadata
}

function verifyRuntimeFile(opened) {
  if (process.platform !== 'win32' && opened.mode !== 0o600) {
    throw new Error('Request owner mode is invalid')
  }
}

function validateStageParent(root, stagePath, expectedIdentity = null) {
  const canonical = canonicalRoot(root)
  if (typeof stagePath !== 'string' || !isAbsolute(stagePath) || !pathIsContained(canonical, stagePath)) throw new Error('Staging path is not confined to its root')
  const parent = dirname(stagePath)
  const metadata = lstatSync(parent, { bigint: true })
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Staging parent is not an ordinary directory')
  const resolved = realpathSync.native(parent)
  if (resolved !== parent || resolved !== canonical && !pathIsContained(canonical, resolved)) throw new Error('Staging parent is not canonically confined')
  const identity = comparableIdentity(metadata)
  if (expectedIdentity !== null && identity !== expectedIdentity) throw new Error('Staging parent identity changed before write')

  return { identity, root: canonical }
}

function validateOpenedStage(root, stagePath, descriptorMetadata, parentIdentity) {
  validateStageParent(root, stagePath, parentIdentity)
  const pathMetadata = lstatSync(stagePath, { bigint: true })
  const resolved = realpathSync.native(stagePath)
  if (!descriptorMetadata.isFile() || !pathMetadata.isFile() || pathMetadata.isSymbolicLink() || descriptorMetadata.nlink !== 1n || pathMetadata.nlink !== 1n || comparableIdentity(descriptorMetadata) !== comparableIdentity(pathMetadata) || resolved !== stagePath || !pathIsContained(root, resolved)) {
    throw new Error('Staging descriptor identity is invalid')
  }
}

function removeUnwrittenStage(stagePath, descriptorIdentity, options) {
  let metadata
  try {
    metadata = lstatSync(stagePath, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }
  if (!metadata.isFile() || metadata.isSymbolicLink() || comparableIdentity(metadata) !== descriptorIdentity) throw new Error('Unwritten staging artifact identity changed before cleanup')
  const remove = options.unlinkSync ?? unlinkSync
  remove(stagePath)
  if ((options.pathExists ?? pathExists)(stagePath)) throw new Error('Unwritten staging artifact remains after cleanup')
}

function stageBytes(stagePath, bytes, options = {}) {
  const parent = validateStageParent(options.root ?? dirname(stagePath), stagePath)
  const open = options.openSync ?? openSync
  const close = options.closeSync ?? closeSync
  const chmod = options.fchmodSync ?? fchmodSync
  const stat = options.fstatSync ?? fstatSync
  const write = options.writeSync ?? writeSync
  const flush = options.fsyncSync ?? fsyncSync
  const descriptor = open(stagePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  let closed = false
  try {
    const descriptorMetadata = stat(descriptor, { bigint: true })
    try {
      validateOpenedStage(parent.root, stagePath, descriptorMetadata, parent.identity)
    } catch (error) {
      close(descriptor)
      closed = true
      try {
        removeUnwrittenStage(stagePath, comparableIdentity(descriptorMetadata), options)
      } catch (cleanupError) {
        throw new Error('Unwritten staging artifact cleanup failed', { cause: new AggregateError([error, cleanupError]) })
      }
      throw error
    }
    if ((options.platform ?? process.platform) !== 'win32') {
      chmod(descriptor, 0o600)
      const metadata = stat(descriptor, { bigint: true })
      if (comparableMode(metadata) !== 0o600) {
        throw new Error('Request stage mode is invalid')
      }
    }
    options.onTransition?.('after-owner-stage-create')
    let offset = 0
    while (offset < bytes.length) {
      const count = write(descriptor, bytes, offset, bytes.length - offset, offset)
      if (count <= 0) {
        throw new Error('Request stage write made no progress')
      }
      offset += count
    }
    flush(descriptor)
    close(descriptor)
    closed = true
    options.onTransition?.('after-owner-stage-write')
  } finally {
    if (!closed) {
      close(descriptor)
    }
  }
  try {
    readExactFile(stagePath, bytes, options)
  } catch (error) {
    if (error.message === 'Staged file readback differs') throw new Error('Request stage readback differs', { cause: error })
    throw error
  }
}

function writeFlushedFile(path, bytes, options = {}) {
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  stageBytes(path, value, { ...options, onTransition: options.onTransition })

  return Buffer.from(value)
}

function readBackExact(path, expectedBytes, options = {}) {
  return readExactFile(path, expectedBytes, options)
}

function assignAndVerifyMode(path, mode, options = {}) {
  if (mode === null || mode === undefined) {
    if (options.platform === 'win32' || process.platform === 'win32') {
      return null
    }
    throw new Error('A POSIX publication mode is required')
  }
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 4095) {
    throw new Error('Publication mode is invalid')
  }
  if ((options.platform ?? process.platform) !== 'win32') {
    const chmod = options.chmodSync ?? chmodSync
    chmod(path, mode)
    const metadata = (options.lstatSync ?? lstatSync)(path, { bigint: true })
    if (comparableMode(metadata, options.platform) !== mode) {
      throw new Error('Publication mode verification failed')
    }
  }

  return mode
}

function verifyFinalMode(path, mode, options = {}) {
  if ((options.platform ?? process.platform) === 'win32' || mode === null) {
    return true
  }
  const metadata = (options.lstatSync ?? lstatSync)(path, { bigint: true })
  if (comparableMode(metadata, options.platform) !== mode) {
    throw new Error('Final publication mode differs')
  }

  return true
}

function renameVerified(source, destination, expectedBytes, options = {}) {
  const rename = options.renameSync ?? renameSync
  rename(source, destination)
  if ((options.pathExists ?? pathExists)(source)) {
    throw new Error('Publication source remains after rename')
  }
  try {
    readExactFile(destination, expectedBytes, options, false)
  } catch (error) {
    if (error.message === 'Staged file readback differs') throw new Error('Renamed publication readback differs', { cause: error })
    throw error
  }
  options.onRenamed?.(destination)

  return destination
}

function publishNoReplace(source, destination, options = {}) {
  try {
    (options.linkSync ?? linkSync)(source, destination)
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new Error('No-replace publication collided', { cause: error })
    }
    throw error
  }
  if (!(options.pathExists ?? pathExists)(destination)) {
    throw new Error('No-replace publication is absent')
  }
  options.onPublished?.(destination)

  return destination
}

function verifyPublishedIdentity(root, source, destination, expectedBytes, expectedIdentity, expectedMode) {
  const openOptions = boundedOpenOptions({}, expectedBytes.length)
  const sourceFile = stableOpenFile(root, source, openOptions)
  const destinationFile = stableOpenFile(root, destination, openOptions)
  const sourceLinks = lstatSync(source, { bigint: true }).nlink
  const destinationLinks = lstatSync(destination, { bigint: true }).nlink
  const platform = process.platform
  const modeMatches = expectedMode === undefined || platform === 'win32' || sourceFile.mode === expectedMode && destinationFile.mode === expectedMode
  if (sourceLinks !== 2n || destinationLinks !== 2n || expectedIdentity !== undefined && (sourceFile.identity !== expectedIdentity || destinationFile.identity !== expectedIdentity) || !sourceFile.bytes.equals(expectedBytes) || !destinationFile.bytes.equals(expectedBytes) || !modeMatches) {
    throw new Error('Published identity differs from staged identity')
  }

  return destinationFile
}

function removeAndVerify(path, options = {}) {
  const exists = options.pathExists ?? pathExists
  if (!exists(path)) return true
  const remove = options.unlinkSync ?? unlinkSync
  remove(path)
  if (exists(path)) {
    throw new Error('Path remains after removal')
  }

  return true
}

function initialLockPaths(root, pid, ownerNonce) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !NONCE_PATTERN.test(ownerNonce)) throw new TypeError('Initial lock identity is invalid')
  const stage = join(root, `${RECOVERY_LOCK_BASENAME}.${pid}.${ownerNonce}.new`)

  return { lock: join(root, RECOVERY_LOCK_BASENAME), stage }
}

function createInitialLock(root, record, options = {}) {
  const pid = options.pid ?? record.pid ?? process.pid
  const ownerNonce = options.ownerNonce ?? record.ownerNonce ?? randomBytes(16).toString('hex')
  if (record.pid !== pid || record.ownerNonce !== ownerNonce) throw new TypeError('Initial lock record identity differs from its stage')
  const paths = initialLockPaths(root, pid, ownerNonce)
  const bytes = Buffer.from(`${canonicalJson(record)}\n`, 'utf8')
  const exists = options.pathExists ?? pathExists
  let stagedIdentity
  let stageWriteProgress = false
  let stageWriteFinished = false
  try {
    stageBytes(paths.stage, bytes, {
      ...options,
      root,
      onTransition: (point) => {
        if (point === 'after-owner-stage-create') stagedIdentity = stableOpenFile(root, paths.stage, boundedOpenOptions(options, bytes.length, { requireSingleLink: true })).identity
        if (point === 'after-owner-stage-write') stageWriteFinished = true
        options.onTransition?.(point)
      },
      writeSync: (...args) => {
        const count = (options.writeSync ?? writeSync)(...args)
        if (count > 0) stageWriteProgress = true

        return count
      },
    })
    readBackExact(paths.stage, bytes, options)
    const preparedStage = stableOpenFile(root, paths.stage, boundedOpenOptions(options, bytes.length, { requireSingleLink: true }))
    const stageModeMatches = (options.platform ?? process.platform) === 'win32' || preparedStage.mode === 0o600
    if (preparedStage.identity !== stagedIdentity || !preparedStage.bytes.equals(bytes) || !stageModeMatches) throw new Error('Initial lock stage changed before publication')
    options.beforePublish?.()
    publishNoReplace(paths.stage, paths.lock, { ...options, onPublished: undefined })
    verifyPublishedIdentity(root, paths.stage, paths.lock, bytes, stagedIdentity, 0o600)
    options.onPublished?.(paths.lock)
    verifyPublishedIdentity(root, paths.stage, paths.lock, bytes, stagedIdentity, 0o600)
    removeAndVerify(paths.stage, options)
    const finalLock = stableOpenFile(root, paths.lock, boundedOpenOptions(options, bytes.length, { requireSingleLink: true }))
    const finalLockModeMatches = (options.platform ?? process.platform) === 'win32' || finalLock.mode === 0o600
    if (finalLock.identity !== stagedIdentity || !finalLock.bytes.equals(bytes) || !finalLockModeMatches) throw new Error('Initial lock changed after stage removal')
  } catch (error) {
    if (exists(paths.stage) && stagedIdentity !== undefined && !(options.crashAfterOwnerPublish === true && exists(paths.lock)) && !(options.crashBeforeOwnerPublish === true && !exists(paths.lock))) {
      try {
        let currentStage
        try {
          currentStage = stableOpenFile(root, paths.stage, boundedOpenOptions(options, bytes.length, { requireSingleLink: true }))
        } catch (error) {
          if (!stageWriteFinished || !exists(paths.lock)) throw error
          currentStage = stableOpenFile(root, paths.stage, boundedOpenOptions(options, bytes.length, { requireSingleLink: false }))
          const currentLock = stableOpenFile(root, paths.lock, boundedOpenOptions(options, bytes.length, { requireSingleLink: false }))
          const stageLinks = (options.lstatSync ?? lstatSync)(paths.stage, { bigint: true }).nlink
          const lockLinks = (options.lstatSync ?? lstatSync)(paths.lock, { bigint: true }).nlink
          if (stageLinks !== 2n || lockLinks !== 2n || currentStage.identity !== stagedIdentity || currentLock.identity !== stagedIdentity || !currentLock.bytes.equals(bytes)) throw error
        }
        const modeMatches = (options.platform ?? process.platform) === 'win32' || currentStage.mode === 0o600
        const expectedBytes = stageWriteFinished || stageWriteProgress ? bytes : Buffer.alloc(0)
        if (currentStage.identity === stagedIdentity && currentStage.bytes.equals(expectedBytes) && modeMatches) removeAndVerify(paths.stage, options)
      } catch {
        /* Preserve the original failure and retain any stage whose ownership changed. */
      }
    }
    throw error
  }

  return { bytes, ownerNonce, paths, pid }
}

function removeInitialLock(root, paths, expectedBytes, options = {}) {
  const open = options.stableOpenFile ?? stableOpenFile
  const opened = open(root, paths.lock, boundedOpenOptions(options, expectedBytes?.length ?? MAX_RECOVERY_REQUEST_BYTES))
  if (expectedBytes !== undefined && !opened.bytes.equals(expectedBytes)) throw new Error('Initial lock changed before removal')
  const remove = options.removeAndVerify ?? removeAndVerify
  remove(paths.lock, options)
}

function publishOwnerStage(root, paths, expectedBytes, options = {}) {
  linkSync(paths.ownerStage, paths.owner)
  const openOptions = boundedOpenOptions(options, expectedBytes.length)
  const stage = stableOpenFile(root, paths.ownerStage, openOptions)
  const owner = stableOpenFile(root, paths.owner, openOptions)
  verifyRuntimeFile(stage)
  verifyRuntimeFile(owner)
  if (stage.identity !== owner.identity || !stage.bytes.equals(expectedBytes) || !owner.bytes.equals(expectedBytes)) {
    throw new Error('Published request owner differs from its stage')
  }
  options.onTransition?.('after-owner-publish')
  unlinkSync(paths.ownerStage)
  if (pathExists(paths.ownerStage)) {
    throw new Error('Request owner stage was not removed')
  }
  options.onTransition?.('after-owner-stage-remove')
}

function parseOwner(bytes, root) {
  let record
  try {
    const text = bytes.toString('utf8')
    if (!text.endsWith('\n') || text.slice(0, -1).includes('\n')) {
      throw new Error('Owner record line is invalid')
    }
    record = JSON.parse(text.slice(0, -1))
    if (Buffer.from(canonicalJson(record) + '\n', 'utf8').equals(bytes) === false) {
      throw new Error('Owner record is not canonical')
    }
  } catch (error) {
    throw new Error('Published request owner is malformed', { cause: error })
  }
  const consuming = sameKeys(record, ['nonce', 'pid', 'protocolVersion', 'root', 'state'])
  const shaped = consuming || sameKeys(record, ['nonce', 'protocolVersion', 'root', 'state'])
  if (!shaped || record.state !== (consuming ? 'consuming' : 'reserved') || record.protocolVersion !== 1 || record.root !== root || !NONCE_PATTERN.test(record.nonce) || (consuming && (!Number.isSafeInteger(record.pid) || record.pid <= 0))) {
    throw new Error('Published request owner schema is invalid')
  }

  return record
}

function classifyPid(pid, killProcess = process.kill.bind(process)) {
  try {
    killProcess(pid, 0)

    return 'live'
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ESRCH') {
      return 'absent'
    }

    return 'indeterminate'
  }
}

function collectRequestResidue(root, options = {}) {
  const canonical = canonicalRoot(root)
  const paths = requestPaths(canonical)
  try {
    if (!pathExists(paths.requestDirectory)) {
      transportError('request-invalid-state', 'Request gate is absent.')
    }
    verifyDirectory(paths.requestDirectory)
    const allowed = new Set([REQUEST_OWNER_STAGE_BASENAME, REQUEST_OWNER_BASENAME, REQUEST_PAYLOAD_BASENAME])
    const entries = readDirectoryNames(paths.requestDirectory, { ...options, includeName: (entry) => {
      if (!allowed.has(entry)) transportError('request-invalid-state', 'Request gate has an extra entry.')

      return true
    }, maxSelectedEntries: allowed.size })

    const ownerStage = entries.includes(REQUEST_OWNER_STAGE_BASENAME) ? stableOpenFile(canonical, paths.ownerStage, boundedOpenOptions(options, MAX_INSPECT_REQUEST_BYTES)) : null
    const owner = entries.includes(REQUEST_OWNER_BASENAME) ? stableOpenFile(canonical, paths.owner, boundedOpenOptions(options, MAX_INSPECT_REQUEST_BYTES)) : null
    const payloadPresent = entries.includes(REQUEST_PAYLOAD_BASENAME)
    if (ownerStage !== null) {
      verifyRuntimeFile(ownerStage)
    }
    if (owner !== null) {
      verifyRuntimeFile(owner)
    }
    const record = owner === null ? null : parseOwner(owner.bytes, canonical)
    const childSet = entries.join(',')
    let state
    if (childSet === '') {
      state = 'empty-gate'
    } else if (childSet === REQUEST_OWNER_STAGE_BASENAME) {
      state = 'owner-stage'
    } else if (childSet === OWNER_STAGE_CHILDREN && record?.state === 'reserved' && owner.identity === ownerStage.identity && owner.bytes.equals(ownerStage.bytes)) {
      state = 'published-owner-stage'
    } else if (childSet === REQUEST_OWNER_BASENAME && record?.state === 'reserved') {
      state = 'reserved'
    } else if (childSet === OWNER_PAYLOAD_CHILDREN && record?.state === 'reserved') {
      state = 'reserved-payload'
    } else if (childSet === OWNER_STAGE_PAYLOAD_CHILDREN && record?.state === 'reserved') {
      state = 'consuming-stage-payload'
    } else if (childSet === OWNER_PAYLOAD_CHILDREN && record?.state === 'consuming') {
      state = 'consuming-payload'
    } else if (childSet === REQUEST_OWNER_BASENAME && record?.state === 'consuming') {
      state = 'consuming-owner'
    } else {
      transportError('request-invalid-state', 'Request gate child state is invalid.')
    }
    const pidStatus = record?.state === 'consuming' && options.classifyPid !== false ? classifyPid(record.pid, options.killProcess) : 'not-applicable'
    const payload = payloadPresent && options.openPayload !== false ? stableOpenFile(canonical, paths.payload, { maxBytes: MAX_APPLY_REQUEST_BYTES }) : null
    const cleanupAllowed = pidStatus === 'not-applicable' || pidStatus === 'absent'

    return {
      owner,
      ownerStage,
      paths,
      payload,
      payloadPresent,
      record,
      result: {
        cleanupAllowed,
        nonce: record?.nonce ?? null,
        ownerRawSha256: owner?.rawSha256 ?? null,
        ownerStageRawSha256: ownerStage?.rawSha256 ?? null,
        payloadRawSha256: payload?.rawSha256 ?? null,
        payloadSize: payload?.bytes.length ?? null,
        pidStatus,
        requestDirectory: REQUEST_GATE_BASENAME,
        state,
      },
    }
  } catch (error) {
    if (error instanceof InitBacklogError) {
      throw error
    }
    transportError('request-filesystem', 'Request residue inspection failed.', error)
  }
}

function inspectRequestResidue(root, options = {}) {
  return collectRequestResidue(root, options).result
}

function reserveRequest(root, options = {}) {
  const canonical = canonicalRoot(root)
  const paths = requestPaths(canonical)
  let nonce
  try {
    nonce = options.nonce ?? randomBytes(16).toString('hex')
    validateNonce(nonce)
  } catch (error) {
    transportError('request-filesystem', 'Request nonce generation failed.', error)
  }
  try {
    mkdirSync(paths.requestDirectory, { mode: 0o700 })
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'EEXIST') {
      const inspection = inspectRequestResidue(canonical, options)
      if ((inspection.pidStatus === 'live' || inspection.pidStatus === 'indeterminate') && inspection.state.startsWith('consuming')) {
        transportError('request-busy', 'Request consumer is active.')
      }
      transportError('request-residue', 'Request gate already exists.', error)
    }
    transportError('request-filesystem', 'Request gate creation failed.', error)
  }
  if (process.platform !== 'win32') {
    chmodSync(paths.requestDirectory, 0o700)
  }
  verifyDirectory(paths.requestDirectory)
  options.onTransition?.('after-gate-create')
  const ownerBytes = Buffer.from(canonicalJson({ nonce, protocolVersion: 1, root: canonical, state: 'reserved' }) + '\n', 'utf8')
  stageBytes(paths.ownerStage, ownerBytes, { ...options, root: canonical })
  publishOwnerStage(canonical, paths, ownerBytes, options)

  return {
    canonicalRoot: canonical,
    maxRequestBytes: MAX_APPLY_REQUEST_BYTES,
    nonce,
    requestDirectory: REQUEST_GATE_BASENAME,
    requestPath: `${REQUEST_GATE_BASENAME}/${REQUEST_PAYLOAD_BASENAME}`,
  }
}

function cleanupPath(root, path, transition, options, state, expected) {
  if (!pathExists(path)) {
    return state
  }
  try {
    if (expected === null || expected === undefined) {
      throw new Error('Request cleanup found an unexpected artifact')
    }
    const current = stableOpenFile(root, path, boundedOpenOptions(options, expected.bytes.length))
    if (current.identity !== expected.identity || current.rawSha256 !== expected.rawSha256) {
      throw new Error('Request cleanup artifact changed before removal')
    }
    unlinkSync(path)
    if (pathExists(path)) {
      throw new Error('Removed request artifact is still present')
    }
    state.mutated = true
    options.onTransition?.(transition)

    return state
  } catch (error) {
    if (state.mutated) {
      throw new RequestTransportResidueError(error)
    }
    throw error
  }
}

function cleanupGate(root, paths, options, expected, initialMutated = false) {
  const state = { mutated: initialMutated }
  cleanupPath(root, paths.ownerStage, 'after-owner-stage-remove', options, state, expected.ownerStage)
  cleanupPath(root, paths.payload, 'after-payload-remove', options, state, expected.payload)
  cleanupPath(root, paths.owner, 'after-owner-remove', options, state, expected.owner)
  try {
    readDirectoryNames(paths.requestDirectory, { ...options, maxSelectedEntries: 0 })
    rmdirSync(paths.requestDirectory)
    if (pathExists(paths.requestDirectory)) {
      throw new Error('Request gate is still present')
    }
    state.mutated = true
    options.onTransition?.('after-gate-remove')
  } catch (error) {
    if (state.mutated) {
      throw new RequestTransportResidueError(error)
    }
    throw error
  }
}

function cleanRequestResidue(root, evidence, options = {}) {
  const canonical = canonicalRoot(root)
  const paths = requestPaths(canonical)
  const carried = {
    nonce: evidence.nonce ?? null,
    ownerRawSha256: evidence.ownerRawSha256 ?? null,
    ownerStageRawSha256: evidence.ownerStageRawSha256 ?? null,
    payloadRawSha256: evidence.payloadRawSha256 ?? null,
  }
  for (const [key, value] of Object.entries(carried)) {
    const pattern = key === 'nonce' ? NONCE_PATTERN : DIGEST_PATTERN
    if (value !== null && (typeof value !== 'string' || !pattern.test(value))) {
      transportError('request-evidence-mismatch', 'Request cleanup evidence is malformed.')
    }
  }
  let requestDirectoryPresent
  try {
    requestDirectoryPresent = pathExists(paths.requestDirectory)
  } catch (error) {
    transportError('request-filesystem', 'Request gate validation failed.', error)
  }
  if (!requestDirectoryPresent) {
    if (Object.values(carried).every((value) => value === null)) {
      return { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME }
    }
    transportError('request-evidence-mismatch', 'Absent request gate has non-null evidence.')
  }
  const collection = collectRequestResidue(canonical, { ...options, classifyPid: false, openPayload: false })
  const current = collection.result
  const currentEvidence = {
    nonce: current.nonce,
    ownerRawSha256: current.ownerRawSha256,
    ownerStageRawSha256: current.ownerStageRawSha256,
  }
  for (const [key, currentValue] of Object.entries(currentEvidence)) {
    if (carried[key] !== currentValue) {
      transportError('request-evidence-mismatch', 'Request cleanup evidence changed.')
    }
  }
  if (collection.payloadPresent !== (carried.payloadRawSha256 !== null)) {
    transportError('request-evidence-mismatch', 'Request cleanup payload nullability changed.')
  }
  if (collection.record?.state === 'consuming') {
    const pidStatus = classifyPid(collection.record.pid, options.killProcess)
    if (pidStatus !== 'absent') {
      transportError('request-live', 'Request consumer is live or indeterminate.')
    }
  }
  if (collection.payloadPresent) {
    const payload = stableOpenFile(canonical, paths.payload, { maxBytes: MAX_APPLY_REQUEST_BYTES })
    if (payload.rawSha256 !== carried.payloadRawSha256) {
      transportError('request-evidence-mismatch', 'Request cleanup payload changed.')
    }
    collection.payload = payload
  }
  try {
    cleanupGate(canonical, paths, options, { owner: collection.owner, ownerStage: collection.ownerStage, payload: collection.payload })
  } catch (error) {
    if (error instanceof RequestTransportResidueError) {
      throw error
    }
    transportError('request-filesystem', 'Request cleanup failed before mutation.', error)
  }

  return { cleaned: true, requestDirectory: REQUEST_GATE_BASENAME }
}

function consumeRequest(root, nonce, dispatch, options = {}) {
  const canonical = canonicalRoot(root)
  try {
    validateNonce(nonce)
  } catch (error) {
    transportError('request-evidence-mismatch', 'Request nonce is invalid.', error)
  }
  const paths = requestPaths(canonical)
  const inspection = inspectRequestResidue(canonical, options)
  if (inspection.state !== 'reserved-payload' || inspection.nonce !== nonce) {
    transportError('request-evidence-mismatch', 'Request payload is not reserved by this nonce.')
  }
  const owner = stableOpenFile(canonical, paths.owner, boundedOpenOptions(options, MAX_INSPECT_REQUEST_BYTES))
  const payload = stableOpenFile(canonical, paths.payload, { maxBytes: MAX_APPLY_REQUEST_BYTES })
  const reservedRecord = parseOwner(owner.bytes, canonical)
  if (reservedRecord.state !== 'reserved' || reservedRecord.nonce !== nonce || owner.rawSha256 !== inspection.ownerRawSha256 || payload.rawSha256 !== inspection.payloadRawSha256) {
    transportError('request-evidence-mismatch', 'Request payload changed before consume.')
  }
  options.onTransition?.('before-consuming-stage')
  const pid = options.pid ?? process.pid
  const consumingBytes = Buffer.from(canonicalJson({ nonce, pid, protocolVersion: 1, root: canonical, state: 'consuming' }) + '\n', 'utf8')
  const stageOptions = {
    root: canonical,
    onTransition: (point) => {
      if (point === 'after-owner-stage-create') {
        options.onTransition?.('after-consuming-stage-create')
      } else if (point === 'after-owner-stage-write') {
        options.onTransition?.('after-consuming-stage-write')
      }
    },
  }
  stageBytes(paths.ownerStage, consumingBytes, stageOptions)
  renameSync(paths.ownerStage, paths.owner)
  const consumingOwner = stableOpenFile(canonical, paths.owner, boundedOpenOptions(options, consumingBytes.length))
  verifyRuntimeFile(consumingOwner)
  if (!consumingOwner.bytes.equals(consumingBytes)) {
    throw new Error('Consuming owner differs after atomic rename')
  }
  options.onTransition?.('after-consuming-owner-publish')
  try {
    cleanupGate(canonical, paths, {
      onTransition: (point) => {
        if (point === 'after-payload-remove') {
          options.onTransition?.('after-payload-remove')
        } else if (point === 'after-owner-remove') {
          options.onTransition?.('after-owner-remove')
        } else if (point === 'after-gate-remove') {
          options.onTransition?.('after-gate-remove')
        }
      },
    }, { owner: stableOpenFile(canonical, paths.owner, boundedOpenOptions(options, consumingBytes.length)), ownerStage: null, payload })
  } catch (error) {
    if (error instanceof RequestTransportResidueError) {
      throw error
    }
    throw new RequestTransportResidueError(error)
  }

  return dispatch(payload.bytes, canonical)
}

module.exports = {
  REQUEST_GATE_BASENAME,
  REQUEST_OWNER_BASENAME,
  REQUEST_OWNER_STAGE_BASENAME,
  REQUEST_PAYLOAD_BASENAME,
  RequestTransportResidueError,
  boundedOpenOptions,
  canonicalRoot,
  classifyPid,
  cleanRequestResidue,
  comparableIdentity,
  comparableMode,
  consumeRequest,
  containedTargetPath,
  decodeDirectoryName,
  enumerateDirectory,
  inspectRequestResidue,
  createInitialLock,
  initialLockPaths,
  pathExists,
  pathIsContained,
  platformMode,
  probeWindowsAttributes,
  readDirectoryNames,
  readOrdinalFirstDirectoryName,
  publishNoReplace,
  readBackExact,
  assignAndVerifyMode,
  verifyFinalMode,
  renameVerified,
  removeAndVerify,
  removeInitialLock,
  reserveRequest,
  resolveTrustedExecutable,
  runBoundedReadOnlyHelper,
  stableMetadata,
  stableOpenFile,
  stageFile: stageBytes,
  targetPath,
  trustedWindowsPowerShellPath,
  verifyPublishedIdentity,
  withAttributeProbe,
  writeFlushedFile,
}
