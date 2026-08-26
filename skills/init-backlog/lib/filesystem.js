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
  readFileSync,
  readSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} = require('node:fs')
const { isAbsolute, join, relative, sep } = require('node:path')

const { InitBacklogError } = require('./errors')
const { MAX_APPLY_REQUEST_BYTES, assertSafeWindowsScalar, canonicalJson, sha256, validateNonce } = require('./protocol')

const REQUEST_GATE_BASENAME = '.nightshift-init-backlog.request-gate'
const REQUEST_OWNER_STAGE_BASENAME = 'owner.new'
const REQUEST_OWNER_BASENAME = 'owner.json'
const REQUEST_PAYLOAD_BASENAME = 'request.json'
const REQUEST_STATES = [
  'empty-gate',
  'owner-stage',
  'published-owner-stage',
  'reserved',
  'reserved-payload',
  'consuming-stage-payload',
  'consuming-payload',
  'consuming-owner',
]

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
    const canonical = realpathSync.native(root)
    const metadata = lstatSync(canonical)
    if (canonical !== root || !metadata.isDirectory() || metadata.isSymbolicLink()) {
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

function contained(root, target) {
  const relation = relative(root, target)
  return relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation)
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

function comparableIdentity(metadata) {
  return `${metadata.dev.toString()}:${metadata.ino.toString()}`
}

function comparableMode(metadata) {
  if (process.platform === 'win32') {
    return null
  }
  const masked = metadata.mode & 0o7777n
  if (masked < 0n || masked > 4095n) {
    throw new Error('Filesystem mode is out of range')
  }

  return Number(masked)
}

function stableOpenFile(root, target, options = {}) {
  const canonical = canonicalRoot(root)
  assertSafeWindowsScalar(target)
  if (typeof target !== 'string' || !isAbsolute(target) || !contained(canonical, target)) {
    throw new Error('Stable-open target escapes its root')
  }
  const before = lstatSync(target, { bigint: true })
  if (!before.isFile() || before.isSymbolicLink() || (options.requireSingleLink === true && before.nlink !== 1n)) {
    throw new Error('Stable-open target is not an ordinary nonlinked file')
  }
  const beforeReal = realpathSync.native(target)
  if (!contained(canonical, beforeReal) || beforeReal !== target) {
    throw new Error('Stable-open target is not canonically confined')
  }
  const flags = process.platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)
  const descriptor = openSync(target, flags)
  try {
    const openedBefore = fstatSync(descriptor, { bigint: true })
    const pathDuring = lstatSync(target, { bigint: true })
    const duringReal = realpathSync.native(target)
    if (!openedBefore.isFile() || !pathDuring.isFile() || pathDuring.isSymbolicLink() || comparableIdentity(openedBefore) !== comparableIdentity(before) || comparableIdentity(pathDuring) !== comparableIdentity(before) || openedBefore.size !== before.size || openedBefore.mtimeNs !== before.mtimeNs || pathDuring.size !== before.size || pathDuring.mtimeNs !== before.mtimeNs || duringReal !== target || !contained(canonical, duringReal) || (options.requireSingleLink === true && (openedBefore.nlink !== 1n || pathDuring.nlink !== 1n))) {
      throw new Error('Stable-open target identity changed')
    }
    const size = Number(openedBefore.size)
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error('Stable-open target size is invalid')
    }
    if (options.maxBytes !== undefined && size > options.maxBytes) {
      throw new Error('Stable-open target exceeds its byte limit')
    }
    const bytes = Buffer.alloc(size)
    let offset = 0
    while (offset < size) {
      const count = readSync(descriptor, bytes, offset, size - offset, offset)
      if (count === 0) {
        throw new Error('Stable-open target ended early')
      }
      offset += count
    }
    const openedAfter = fstatSync(descriptor, { bigint: true })
    const pathAfter = lstatSync(target, { bigint: true })
    const afterReal = realpathSync.native(target)
    if (!openedAfter.isFile() || !pathAfter.isFile() || pathAfter.isSymbolicLink() || comparableIdentity(openedAfter) !== comparableIdentity(before) || comparableIdentity(pathAfter) !== comparableIdentity(before) || openedAfter.size !== openedBefore.size || openedAfter.mtimeNs !== openedBefore.mtimeNs || pathAfter.size !== openedBefore.size || pathAfter.mtimeNs !== openedBefore.mtimeNs || afterReal !== target || !contained(canonical, afterReal) || (options.requireSingleLink === true && (openedAfter.nlink !== 1n || pathAfter.nlink !== 1n))) {
      throw new Error('Stable-open target changed during the read')
    }

    return {
      bytes,
      identity: comparableIdentity(before),
      mode: comparableMode(before),
      rawSha256: sha256(bytes),
    }
  } finally {
    closeSync(descriptor)
  }
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

function stageBytes(path, bytes, options = {}) {
  const open = options.openSync ?? openSync
  const close = options.closeSync ?? closeSync
  const chmod = options.fchmodSync ?? fchmodSync
  const stat = options.fstatSync ?? fstatSync
  const write = options.writeSync ?? writeSync
  const flush = options.fsyncSync ?? fsyncSync
  const read = options.readFileSync ?? readFileSync
  const descriptor = open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  let closed = false
  try {
    if (process.platform !== 'win32') {
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
  const readback = read(path)
  if (!readback.equals(bytes)) {
    throw new Error('Request stage readback differs')
  }
}

function publishOwnerStage(root, paths, expectedBytes, options = {}) {
  linkSync(paths.ownerStage, paths.owner)
  const stage = stableOpenFile(root, paths.ownerStage)
  const owner = stableOpenFile(root, paths.owner)
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
  const keys = Object.keys(record).sort().join(',')
  const expectedKeys = record.state === 'reserved' ? 'nonce,protocolVersion,root,state' : record.state === 'consuming' ? 'nonce,pid,protocolVersion,root,state' : ''
  if (keys !== expectedKeys || record.protocolVersion !== 1 || record.root !== root || !/^[a-f0-9]{32}$/.test(record.nonce) || (record.state === 'consuming' && (!Number.isSafeInteger(record.pid) || record.pid <= 0))) {
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
    const entries = readdirSync(paths.requestDirectory).sort()
    const allowed = new Set([REQUEST_OWNER_STAGE_BASENAME, REQUEST_OWNER_BASENAME, REQUEST_PAYLOAD_BASENAME])
    if (entries.some((entry) => !allowed.has(entry))) {
      transportError('request-invalid-state', 'Request gate has an extra entry.')
    }

    const ownerStage = entries.includes(REQUEST_OWNER_STAGE_BASENAME) ? stableOpenFile(canonical, paths.ownerStage) : null
    const owner = entries.includes(REQUEST_OWNER_BASENAME) ? stableOpenFile(canonical, paths.owner) : null
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
    } else if (childSet === [REQUEST_OWNER_BASENAME, REQUEST_OWNER_STAGE_BASENAME].sort().join(',') && record?.state === 'reserved' && owner.identity === ownerStage.identity && owner.bytes.equals(ownerStage.bytes)) {
      state = 'published-owner-stage'
    } else if (childSet === REQUEST_OWNER_BASENAME && record?.state === 'reserved') {
      state = 'reserved'
    } else if (childSet === [REQUEST_OWNER_BASENAME, REQUEST_PAYLOAD_BASENAME].sort().join(',') && record?.state === 'reserved') {
      state = 'reserved-payload'
    } else if (childSet === [REQUEST_OWNER_BASENAME, REQUEST_OWNER_STAGE_BASENAME, REQUEST_PAYLOAD_BASENAME].sort().join(',') && record?.state === 'reserved') {
      state = 'consuming-stage-payload'
    } else if (childSet === [REQUEST_OWNER_BASENAME, REQUEST_PAYLOAD_BASENAME].sort().join(',') && record?.state === 'consuming') {
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
  stageBytes(paths.ownerStage, ownerBytes, options)
  publishOwnerStage(canonical, paths, ownerBytes, options)

  return {
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
    const current = stableOpenFile(root, path)
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
    const entries = readdirSync(paths.requestDirectory)
    if (entries.length !== 0) {
      throw new Error('Request gate is not empty')
    }
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
    const pattern = key === 'nonce' ? /^[a-f0-9]{32}$/ : /^[a-f0-9]{64}$/
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
  const owner = stableOpenFile(canonical, paths.owner)
  const payload = stableOpenFile(canonical, paths.payload, { maxBytes: MAX_APPLY_REQUEST_BYTES })
  const reservedRecord = parseOwner(owner.bytes, canonical)
  if (reservedRecord.state !== 'reserved' || reservedRecord.nonce !== nonce || owner.rawSha256 !== inspection.ownerRawSha256 || payload.rawSha256 !== inspection.payloadRawSha256) {
    transportError('request-evidence-mismatch', 'Request payload changed before consume.')
  }
  options.onTransition?.('before-consuming-stage')
  const pid = options.pid ?? process.pid
  const consumingBytes = Buffer.from(canonicalJson({ nonce, pid, protocolVersion: 1, root: canonical, state: 'consuming' }) + '\n', 'utf8')
  const stageOptions = {
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
  const consumingOwner = stableOpenFile(canonical, paths.owner)
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
    }, { owner: stableOpenFile(canonical, paths.owner), ownerStage: null, payload })
  } catch (error) {
    if (error instanceof RequestTransportResidueError) {
      throw error
    }
    throw new RequestTransportResidueError(error)
  }

  return dispatch(payload.bytes)
}

module.exports = {
  REQUEST_GATE_BASENAME,
  REQUEST_OWNER_BASENAME,
  REQUEST_OWNER_STAGE_BASENAME,
  REQUEST_PAYLOAD_BASENAME,
  REQUEST_STATES,
  RequestTransportResidueError,
  canonicalRoot,
  classifyPid,
  cleanRequestResidue,
  consumeRequest,
  inspectRequestResidue,
  reserveRequest,
  stableOpenFile,
}
