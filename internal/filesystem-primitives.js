'use strict'

const { createHash } = require('node:crypto')
const { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, openSync, readSync, realpathSync, writeSync } = require('node:fs')
const nodePath = require('node:path')

function assertSafeWindowsScalar(value, platform = process.platform) {
  if (platform === 'win32' && typeof value === 'string') {
    for (const character of value) {
      if (character.codePointAt(0) === 0x10ffff) throw new TypeError('Windows path contains an unsafe scalar')
    }
  }

  return value
}

function pathIsContained(root, target, pathModule = nodePath) {
  const relation = pathModule.relative(root, target)

  return relation !== '' && relation !== '..' && !relation.startsWith(`..${pathModule.sep}`) && !pathModule.isAbsolute(relation)
}

function comparableIdentity(metadata) {
  return `${metadata.dev.toString()}:${metadata.ino.toString()}`
}

function comparableMode(metadata, platform = process.platform) {
  if (platform === 'win32') return null
  if (typeof metadata?.mode !== 'bigint') throw new Error('Filesystem mode is not BigInt')
  const masked = metadata.mode & 0o7777n
  if (masked < 0n || masked > 4095n) throw new Error('Filesystem mode is out of range')

  return Number(masked)
}

function canonicalRoot(root) {
  assertSafeWindowsScalar(root)
  if (typeof root !== 'string' || !nodePath.isAbsolute(root)) throw new Error('Stable-open root is invalid')
  const canonical = realpathSync.native(root)
  const metadata = lstatSync(canonical)
  if (canonical !== root || !metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Stable-open root is not canonical')

  return canonical
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function filesystemIdentityError(message) {
  const error = new Error(message)
  error.code = 'identity-changed'

  return error
}

function stableOpenDirectoryState(canonical, path, label) {
  const metadata = lstatSync(path, { bigint: true })
  const resolved = realpathSync.native(path)
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || resolved !== path || path !== canonical && !pathIsContained(canonical, resolved)) throw filesystemIdentityError(`Stable-open ${label} identity changed`)

  return metadata
}

function stableOpenFile(root, target, options = {}) {
  const canonicalizeRoot = options.canonicalizeRoot ?? canonicalRoot
  const canonical = canonicalizeRoot(root)
  const platform = options.platform ?? process.platform
  assertSafeWindowsScalar(target)
  if (typeof target !== 'string' || !nodePath.isAbsolute(target) || !pathIsContained(canonical, target)) throw new Error('Stable-open target escapes its root')
  const rootBefore = stableOpenDirectoryState(canonical, canonical, 'root')
  const parent = nodePath.dirname(target)
  const parentBefore = parent === canonical ? rootBefore : stableOpenDirectoryState(canonical, parent, 'parent')
  const before = lstatSync(target, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || options.requireSingleLink === true && before.nlink !== 1n) throw new Error('Stable-open target is not an ordinary nonlinked file')
  const beforeReal = realpathSync.native(target)
  if (!pathIsContained(canonical, beforeReal) || beforeReal !== target) throw new Error('Stable-open target is not canonically confined')
  const flags = platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  const validateDirectories = () => {
    const rootState = stableOpenDirectoryState(canonical, canonical, 'root')
    if (comparableIdentity(rootState) !== comparableIdentity(rootBefore)) throw filesystemIdentityError('Stable-open root identity changed')
    const parentState = parent === canonical ? rootState : stableOpenDirectoryState(canonical, parent, 'parent')
    if (comparableIdentity(parentState) !== comparableIdentity(parentBefore)) throw filesystemIdentityError('Stable-open parent identity changed')
  }
  options.beforeOpen?.()
  const descriptor = openSync(target, flags)
  try {
    validateDirectories()
    const openedBefore = fstatSync(descriptor, { bigint: true })
    const pathDuring = lstatSync(target, { bigint: true })
    const duringReal = realpathSync.native(target)
    if (!openedBefore.isFile() || !pathDuring.isFile() || pathDuring.isSymbolicLink() || comparableIdentity(openedBefore) !== comparableIdentity(before) || comparableIdentity(pathDuring) !== comparableIdentity(before) || openedBefore.size !== before.size || openedBefore.mtimeNs !== before.mtimeNs || pathDuring.size !== before.size || pathDuring.mtimeNs !== before.mtimeNs || duringReal !== target || !pathIsContained(canonical, duringReal) || options.requireSingleLink === true && (openedBefore.nlink !== 1n || pathDuring.nlink !== 1n)) {
      throw filesystemIdentityError('Stable-open target identity changed')
    }
    const size = Number(openedBefore.size)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Stable-open target size is invalid')
    if (options.maxBytes !== undefined && size > options.maxBytes) {
      const error = new Error('Stable-open target exceeds its byte limit')
      error.code = 'file-too-large'
      throw error
    }
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset)
      if (count === 0) throw new Error('Stable-open target ended early')
      offset += count
    }
    validateDirectories()
    const openedAfter = fstatSync(descriptor, { bigint: true })
    const pathAfter = lstatSync(target, { bigint: true })
    const afterReal = realpathSync.native(target)
    if (!openedAfter.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink() || comparableIdentity(openedAfter) !== comparableIdentity(before) || comparableIdentity(pathAfter) !== comparableIdentity(before) || openedAfter.size !== openedBefore.size || openedAfter.mtimeNs !== openedBefore.mtimeNs || pathAfter.size !== openedBefore.size || pathAfter.mtimeNs !== openedBefore.mtimeNs || afterReal !== target || !pathIsContained(canonical, afterReal) || options.requireSingleLink === true && (openedAfter.nlink !== 1n || pathAfter.nlink !== 1n)) {
      throw filesystemIdentityError('Stable-open target changed during the read')
    }

    return { bytes, identity: comparableIdentity(before), mode: comparableMode(before, platform), rawSha256: sha256(bytes) }
  } finally {
    closeSync(descriptor)
  }
}

function stableRewriteFile(root, target, transform, options = {}) {
  if (typeof transform !== 'function') throw new TypeError('Stable-rewrite transform must be a function')
  const canonical = canonicalRoot(root)
  const platform = options.platform ?? process.platform
  assertSafeWindowsScalar(target)
  if (typeof target !== 'string' || !nodePath.isAbsolute(target) || !pathIsContained(canonical, target)) throw filesystemIdentityError('Stable-rewrite target escapes its root')
  const rootBefore = lstatSync(canonical, { bigint: true })
  const parent = nodePath.dirname(target)
  const parentBefore = lstatSync(parent, { bigint: true })
  const before = lstatSync(target, { bigint: true })
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink() || options.expectedRootIdentity !== undefined && comparableIdentity(rootBefore) !== options.expectedRootIdentity) throw filesystemIdentityError('Stable-rewrite root identity changed')
  if (!parentBefore.isDirectory() || parentBefore.isSymbolicLink() || realpathSync.native(parent) !== parent || !pathIsContained(canonical, parent) && parent !== canonical || options.expectedParentIdentity !== undefined && comparableIdentity(parentBefore) !== options.expectedParentIdentity) throw filesystemIdentityError('Stable-rewrite parent identity changed')
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || realpathSync.native(target) !== target || options.expectedTargetIdentity !== undefined && comparableIdentity(before) !== options.expectedTargetIdentity) throw filesystemIdentityError('Stable-rewrite target identity changed')
  const flags = constants.O_RDWR | (platform === 'win32' ? 0 : constants.O_NOFOLLOW ?? 0)
  const descriptor = openSync(target, flags)
  const validate = (compareContents) => {
    const rootState = lstatSync(canonical, { bigint: true })
    const parentState = lstatSync(parent, { bigint: true })
    const targetState = lstatSync(target, { bigint: true })
    const openedState = fstatSync(descriptor, { bigint: true })
    if (!rootState.isDirectory() || rootState.isSymbolicLink() || realpathSync.native(canonical) !== canonical || comparableIdentity(rootState) !== comparableIdentity(rootBefore)) throw filesystemIdentityError('Stable-rewrite root identity changed')
    if (!parentState.isDirectory() || parentState.isSymbolicLink() || realpathSync.native(parent) !== parent || comparableIdentity(parentState) !== comparableIdentity(parentBefore)) throw filesystemIdentityError('Stable-rewrite parent identity changed')
    if (!targetState.isFile() || targetState.isSymbolicLink() || targetState.nlink !== 1n || realpathSync.native(target) !== target || comparableIdentity(targetState) !== comparableIdentity(before) || !openedState.isFile() || openedState.nlink !== 1n || comparableIdentity(openedState) !== comparableIdentity(before)) throw filesystemIdentityError('Stable-rewrite target identity changed')
    if (compareContents && (targetState.size !== before.size || targetState.mtimeNs !== before.mtimeNs || openedState.size !== before.size || openedState.mtimeNs !== before.mtimeNs)) throw filesystemIdentityError('Stable-rewrite target changed during the read')

    return openedState
  }
  try {
    const openedBefore = validate(true)
    const size = Number(openedBefore.size)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Stable-rewrite target size is invalid')
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset)
      if (count === 0) throw new Error('Stable-rewrite target ended early')
      offset += count
    }
    validate(true)
    const replacement = transform(bytes)
    if (replacement === null || replacement === undefined || Buffer.isBuffer(replacement) && replacement.equals(bytes)) return { bytes, changed: false, identity: comparableIdentity(before), mode: comparableMode(before, platform), rawSha256: sha256(bytes) }
    if (!Buffer.isBuffer(replacement)) throw new TypeError('Stable-rewrite transform must return a Buffer or null')
    options.beforeWrite?.()
    validate(true)
    ftruncateSync(descriptor, 0)
    offset = 0
    while (offset < replacement.length) {
      const count = writeSync(descriptor, replacement, offset, replacement.length - offset, offset)
      if (count === 0) throw new Error('Stable-rewrite target write ended early')
      offset += count
    }
    fsyncSync(descriptor)
    const openedAfter = validate(false)
    if (openedAfter.size !== BigInt(replacement.length)) throw new Error('Stable-rewrite target size is invalid after mutation')

    return { bytes: replacement, changed: true, identity: comparableIdentity(before), mode: comparableMode(before, platform), rawSha256: sha256(replacement) }
  } finally {
    closeSync(descriptor)
  }
}

function stableMetadata(path, options = {}) {
  const metadata = lstatSync(path, { bigint: true })
  if (metadata.isSymbolicLink() || !metadata.isFile() && !metadata.isDirectory()) throw new Error('Path is not an ordinary filesystem object')
  const resolved = realpathSync.native(path)
  if (resolved !== path || options.root !== undefined && !pathIsContained(options.root, resolved)) throw new Error('Path is not canonically confined')

  return { metadata, resolved }
}

function buildProtectedRoots(options, pathModule) {
  return [options.root, ...(options.protectedRoots ?? [])].filter((value) => typeof value === 'string' && value.length > 0).map((value) => pathModule.resolve(value))
}

function candidateInProtectedRoots(roots, candidate, pathModule) {
  return roots.some((root) => pathIsContained(root, candidate, pathModule) || root === candidate)
}

function resolveTrustedExecutable(options = {}) {
  const platform = options.platform ?? process.platform
  const pathModule = platform === 'win32' ? nodePath.win32 : nodePath
  const pathValue = options.pathValue ?? options.path ?? process.env.PATH ?? ''
  const basename = options.basename ?? (platform === 'win32' ? 'git.exe' : 'git')
  const roots = buildProtectedRoots(options, pathModule)
  const entries = Array.isArray(pathValue) ? pathValue : pathValue.split(pathModule.delimiter)
  for (const entry of entries) {
    if (entry.length === 0 || !pathModule.isAbsolute(entry)) continue
    try {
      const directory = realpathSync.native(entry)
      const candidate = pathModule.join(directory, basename)
      if (candidateInProtectedRoots(roots, candidate, pathModule)) continue
      const first = stableMetadata(candidate)
      const second = stableMetadata(candidate)
      if (!first.metadata.isFile() || !second.metadata.isFile() || first.resolved !== second.resolved || comparableIdentity(first.metadata) !== comparableIdentity(second.metadata)) continue
      if (platform !== 'win32' && (first.metadata.mode & 0o111n) === 0n) continue

      return first.resolved
    } catch {
      // Unusable PATH entries are ignored; the resolver fails below if none qualify.
    }
  }

  throw new Error('No trusted executable was found')
}

module.exports = {
  buildProtectedRoots,
  candidateInProtectedRoots,
  comparableIdentity,
  comparableMode,
  pathIsContained,
  resolveTrustedExecutable,
  stableMetadata,
  stableOpenFile,
  stableRewriteFile,
}
