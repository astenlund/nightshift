'use strict'

const { createHash } = require('node:crypto')
const { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } = require('node:fs')
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

function stableOpenFile(root, target, options = {}) {
  const canonicalizeRoot = options.canonicalizeRoot ?? canonicalRoot
  const canonical = canonicalizeRoot(root)
  const platform = options.platform ?? process.platform
  assertSafeWindowsScalar(target)
  if (typeof target !== 'string' || !nodePath.isAbsolute(target) || !pathIsContained(canonical, target)) throw new Error('Stable-open target escapes its root')
  const before = lstatSync(target, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || options.requireSingleLink === true && before.nlink !== 1n) throw new Error('Stable-open target is not an ordinary nonlinked file')
  const beforeReal = realpathSync.native(target)
  if (!pathIsContained(canonical, beforeReal) || beforeReal !== target) throw new Error('Stable-open target is not canonically confined')
  const flags = platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  const descriptor = openSync(target, flags)
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true })
    const pathDuring = lstatSync(target, { bigint: true })
    const duringReal = realpathSync.native(target)
    if (!openedBefore.isFile() || !pathDuring.isFile() || pathDuring.isSymbolicLink() || comparableIdentity(openedBefore) !== comparableIdentity(before) || comparableIdentity(pathDuring) !== comparableIdentity(before) || openedBefore.size !== before.size || openedBefore.mtimeNs !== before.mtimeNs || pathDuring.size !== before.size || pathDuring.mtimeNs !== before.mtimeNs || duringReal !== target || !pathIsContained(canonical, duringReal) || options.requireSingleLink === true && (openedBefore.nlink !== 1n || pathDuring.nlink !== 1n)) {
      throw new Error('Stable-open target identity changed')
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
    const openedAfter = fstatSync(descriptor, { bigint: true })
    const pathAfter = lstatSync(target, { bigint: true })
    const afterReal = realpathSync.native(target)
    if (!openedAfter.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink() || comparableIdentity(openedAfter) !== comparableIdentity(before) || comparableIdentity(pathAfter) !== comparableIdentity(before) || openedAfter.size !== openedBefore.size || openedAfter.mtimeNs !== openedBefore.mtimeNs || pathAfter.size !== openedBefore.size || pathAfter.mtimeNs !== openedBefore.mtimeNs || afterReal !== target || !pathIsContained(canonical, afterReal) || options.requireSingleLink === true && (openedAfter.nlink !== 1n || pathAfter.nlink !== 1n)) {
      throw new Error('Stable-open target changed during the read')
    }

    return { bytes, identity: comparableIdentity(before), mode: comparableMode(before, platform), rawSha256: sha256(bytes) }
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
}
