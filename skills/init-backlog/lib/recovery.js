'use strict'

const { join } = require('node:path')
const { randomBytes } = require('node:crypto')
const { existsSync, linkSync, lstatSync, mkdirSync, rmdirSync, unlinkSync } = require('node:fs')

const { InitBacklogError, failureRecord, trustedSystemCode } = require('./errors')
const { BACKUP_PATTERN, backupParts, classifyBackup } = require('./backups')
const {
  boundedOpenOptions,
  canonicalRoot,
  classifyPid,
  comparableIdentity,
  containedTargetPath,
  createInitialLock,
  initialLockPaths,
  pathExists,
  platformMode,
  readDirectoryNames,
  removeAndVerify,
  removeInitialLock,
  stableOpenFile,
  stageFile,
} = require('./filesystem')
const { DIGEST_PATTERN, MAX_INLINE_FILE_BYTES, MAX_MECHANICAL_FILE_BYTES, MAX_RECOVERY_REQUEST_BYTES, MAX_RECOVERY_RESULT_BYTES, NONCE_PATTERN, OWNER_BASENAME: RECOVERY_OWNER_BASENAME, OWNER_STAGE_BASENAME: RECOVERY_OWNER_STAGE_BASENAME, RECOVERY_GATE_BASENAME, RECOVERY_LOCK_BASENAME: LOCK_BASENAME, RECOVERY_LOCK_STAGE_PATTERN: LOCK_STAGE_PATTERN, RECOVERY_MARKER_BASENAME: MARKER_BASENAME, WARNING_CODES, buildRecoveryApplyRequest, canonicalBytes, canonicalJson, compareOrdinal, deriveRecoveryId, electionMarkerTemporaryNames, recoveryAllowedDispositions, sameCanonical, sameKeys, sha256, validateTarget, validOwnerRecordSchema } = require('./protocol')
const { collectInspection, validateElectionMarkerRecord } = require('./inspection')
const { createOwnerInventoryIndex, validateOwnerInventoryStates } = require('./owner-inventory')
const { publishRecoveryFile, recoveryTemporaryMatches, recoveryTemporaryTarget, relativeArtifact, removeRecoveryFile } = require('./publication')

const MARKER_TARGET_HASH = sha256(Buffer.from(MARKER_BASENAME, 'utf8'))

function recoveryGateEntries(gate, options = {}) {
  const allowed = new Set([RECOVERY_OWNER_STAGE_BASENAME, RECOVERY_OWNER_BASENAME])

  return readDirectoryNames(gate, { ...options, includeName: (entry) => {
    if (!allowed.has(entry)) throw new Error('Recovery gate has an extra entry')

    return true
  }, maxSelectedEntries: allowed.size })
}

function directoryIsEmpty(path, options = {}) {
  try {
    readDirectoryNames(path, { ...options, maxSelectedEntries: 0 })

    return true
  } catch (error) {
    if (error?.code === 'directory-too-large') return false

    throw error
  }
}

function failure(operation, phase, code, detail, target = null, cause = undefined, fields = {}) {
  throw new InitBacklogError(failureRecord({ ...fields, code, detail, operation, phase, target, systemCode: trustedSystemCode(cause) }), { cause })
}

function artifactPath(root, target) {
  validateTarget(target)

  return containedTargetPath(root, target, 'Recovery artifact escapes its root')
}

function modeFor(opened, platform = process.platform) {
  return platform === 'win32' || opened === null ? null : opened.mode
}

function targetDirectory(target) {
  const separator = target.lastIndexOf('/')

  return separator === -1 ? '' : target.slice(0, separator)
}

function ownerArtifactByteLimit(target, record) {
  const initialLockStage = `${LOCK_BASENAME}.${record.pid}.${record.ownerNonce}.new`
  const nextLockStage = `${LOCK_BASENAME}.${record.ownerNonce}.next`

  return target === LOCK_BASENAME || target === initialLockStage || target === nextLockStage ? MAX_RECOVERY_REQUEST_BYTES : MAX_MECHANICAL_FILE_BYTES
}

function ownerArtifactOpenOptions(target, record, options, requireSingleLink) {
  const limit = ownerArtifactByteLimit(target, record)

  return boundedOpenOptions(options, limit, { requireSingleLink })
}

function recoveryArtifactByteLimit(target) {
  if (target === LOCK_BASENAME || target.startsWith(`${RECOVERY_GATE_BASENAME}/`) || LOCK_STAGE_PATTERN.test(target)) return MAX_RECOVERY_REQUEST_BYTES
  if (target === MARKER_BASENAME) return MAX_INLINE_FILE_BYTES

  return MAX_MECHANICAL_FILE_BYTES
}

function recoveryTemporaryParts(target, recoveryId) {
  if (!recoveryTemporaryMatches(target, recoveryId)) return null
  const basename = target.slice(target.lastIndexOf('/') + 1)
  const prefix = `.nightshift-init-backlog.${recoveryId}.`

  return { directory: targetDirectory(target), targetHash: basename.slice(prefix.length, -4) }
}

function validRecoveryTemporaryTarget(target, record, inventory) {
  const parts = recoveryTemporaryParts(target, record.recoveryId ?? record.manifestId)
  if (parts === null) return false
  if (parts.directory === '' && parts.targetHash === MARKER_TARGET_HASH) return true

  return inventory.backupTargetHashes.has(parts.targetHash)
}

function readArtifact(root, target, options = {}, requireSingleLink = true) {
  const path = artifactPath(root, target)
  const openFile = options.artifactOpenFile ?? stableOpenFile
  try {
    return openFile(root, path, boundedOpenOptions(options, recoveryArtifactByteLimit(target), { requireSingleLink }))
  } catch (error) {
    if (error?.code === 'ENOENT') return null

    throw error
  }
}

function parseCanonicalRecord(opened) {
  if (opened === null || opened.bytes.length === 0 || opened.bytes[opened.bytes.length - 1] !== 0x0a || opened.bytes.subarray(0, -1).includes(0x0a)) return null
  if (opened.bytes[0] === 0xef && opened.bytes[1] === 0xbb && opened.bytes[2] === 0xbf) return null
  try {
    const value = JSON.parse(opened.bytes.subarray(0, -1).toString('utf8'))
    return canonicalJson(value) === opened.bytes.subarray(0, -1).toString('utf8') ? value : null
  } catch {
    return null
  }
}

function pidEvidence(pid, options = {}) {
  return classifyPid(pid, options.killProcess)
}

function recoveryGatePath(root) {
  return join(root, RECOVERY_GATE_BASENAME)
}

function gateEvidence(root, options = {}) {
  const gate = recoveryGatePath(root)
  let metadata
  try {
    metadata = lstatSync(gate, { bigint: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return null

    throw error
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Recovery gate is not an ordinary directory')
  if ((options.platform ?? process.platform) !== 'win32' && (metadata.mode & 0o7777n) !== 0o700n) throw new Error('Recovery gate mode is invalid')
  const entries = recoveryGateEntries(gate, options)
  const stage = entries.includes(RECOVERY_OWNER_STAGE_BASENAME) ? stableOpenFile(root, join(gate, RECOVERY_OWNER_STAGE_BASENAME), boundedOpenOptions(options, MAX_RECOVERY_REQUEST_BYTES, { requireSingleLink: false })) : null
  const owner = entries.includes(RECOVERY_OWNER_BASENAME) ? stableOpenFile(root, join(gate, RECOVERY_OWNER_BASENAME), boundedOpenOptions(options, MAX_RECOVERY_REQUEST_BYTES, { requireSingleLink: false })) : null
  const stageLinks = stage === null ? null : lstatSync(join(gate, RECOVERY_OWNER_STAGE_BASENAME), { bigint: true }).nlink
  const ownerLinks = owner === null ? null : lstatSync(join(gate, RECOVERY_OWNER_BASENAME), { bigint: true }).nlink
  if (stage !== null && owner === null && stageLinks !== 1n || stage === null && owner !== null && ownerLinks !== 1n) throw new Error('Recovery owner singleton link count is invalid')
  if (stage !== null && ((options.platform ?? process.platform) !== 'win32' && stage.mode !== 0o600)) throw new Error('Recovery owner stage mode is invalid')
  if (owner !== null && ((options.platform ?? process.platform) !== 'win32' && owner.mode !== 0o600)) throw new Error('Recovery owner mode is invalid')
  if (stage !== null && owner !== null && !stage.bytes.equals(owner.bytes)) throw new Error('Recovery owner identity differs')
  const record = parseCanonicalRecord(owner)
  if (owner !== null && record === null) throw new Error('Recovery owner record is malformed')
  if (owner !== null && !ownerRecordValid(record, root)) throw new Error('Recovery owner record schema is invalid')
  if (stage !== null && owner !== null) {
    if (stage.identity !== owner.identity || stageLinks !== 2n || ownerLinks !== 2n) throw new Error('Recovery owner link identity is invalid')
  }
  const pidStatus = record === null ? null : pidEvidence(record.pid, options)

  return {
    mode: platformMode(options, Number(metadata.mode & 0o7777n)),
    ownerName: owner === null ? null : RECOVERY_OWNER_BASENAME,
    ownerRawSha256: owner?.rawSha256 ?? null,
    ownerMode: modeFor(owner, options.platform),
    ownerStageRawSha256: stage?.rawSha256 ?? null,
    ownerStageMode: modeFor(stage, options.platform),
    record,
    pidStatus,
  }
}

function ownerRecordValid(record, root) {
  return validOwnerRecordSchema(record) && record.operation === 'recover-apply' && record.root === root && record.temporaryPaths.length === 0 && record.unfinalizedDirectories.length === 0
}

function markerTopology(root, target, record, inventory) {
  if (record.manifestId === null) return null
  const markerPrefix = `${MARKER_BASENAME}.${record.manifestId}`
  const paths = {
    ...electionMarkerTemporaryNames(markerPrefix),
    marker: MARKER_BASENAME,
  }
  const present = (candidate) => inventory.temporaryTargets.has(candidate) && pathExists(artifactPath(root, candidate))
  const markerPresent = pathExists(artifactPath(root, paths.marker))
  const peers = []

  if (target === paths.alias) {
    if (present(paths.newWitness)) peers.push(paths.newWitness)
    if (markerPresent) peers.push(paths.marker)
  } else if (target === paths.newWitness) {
    if (present(paths.alias)) peers.push(paths.alias)
    if (markerPresent) peers.push(paths.marker)
    if (present(paths.tombstone)) {
      if (markerPresent || peers.length !== 0) return { expectedLinkCount: 0, peers, valid: false }
      peers.push(paths.tombstone)
    }
  } else if (target === paths.oldWitness) {
    if (markerPresent) peers.push(paths.marker)
  } else if (target === paths.tombstone) {
    if (markerPresent || present(paths.alias)) return { expectedLinkCount: 0, peers, valid: false }
    if (present(paths.newWitness)) peers.push(paths.newWitness)
  } else {
    return null
  }

  return { expectedLinkCount: peers.length + 1, peers, valid: true }
}

function hardLinkTopology(root, target, record, inventory) {
  const initial = `${LOCK_BASENAME}.${record.pid}.${record.ownerNonce}.new`
  if (target === LOCK_BASENAME || target === initial) {
    const peer = target === LOCK_BASENAME ? initial : LOCK_BASENAME
    const peerPresent = pathExists(artifactPath(root, peer))

    return { expectedLinkCount: peerPresent ? 2 : 1, peers: peerPresent ? [peer] : [], valid: true }
  }
  const parts = backupParts(target)
  if (parts !== null) {
    const peer = inventory.backupPeerByTarget.get(target)
    const peerPresent = peer !== undefined && pathExists(artifactPath(root, peer))

    return { expectedLinkCount: peerPresent ? 2 : 1, peers: peerPresent ? [peer] : [], valid: true }
  }
  const marker = markerTopology(root, target, record, inventory)
  if (marker !== null) return marker

  return { expectedLinkCount: 1, peers: [], valid: true }
}

function validateHardLinkTopology(root, target, opened, options, record, inventory) {
  const path = artifactPath(root, target)
  const before = lstatSync(path, { bigint: true })
  const after = lstatSync(path, { bigint: true })
  if (before.nlink !== after.nlink) throw new Error('Recovery artifact link count changed')
  const topology = hardLinkTopology(root, target, record, inventory)
  if (!topology.valid || after.nlink !== BigInt(topology.expectedLinkCount)) throw new Error('Recovery artifact has an unexpected hard-link topology')
  if (topology.peers.length === 0) {
    if (after.nlink !== 1n) throw new Error('Recovery artifact has an unexpected hard-link topology')

    return opened
  }
  for (const peerTarget of topology.peers) {
    let peerMetadata
    try {
      peerMetadata = lstatSync(artifactPath(root, peerTarget), { bigint: true })
    } catch (error) {
      if (error?.code === 'ENOENT') throw new Error('Recovery artifact has an unexpected hard-link topology')

      throw error
    }
    const peer = stableOpenFile(root, artifactPath(root, peerTarget), ownerArtifactOpenOptions(peerTarget, record, options, false))
    if (peerMetadata.nlink !== BigInt(topology.expectedLinkCount) || peer.identity !== opened.identity || !peer.bytes.equals(opened.bytes) || peer.mode !== opened.mode) throw new Error('Recovery artifact hard-link identity differs')
  }

  return opened
}

function readOwnerArtifact(root, target, options, record, inventory) {
  try {
    const opened = stableOpenFile(root, artifactPath(root, target), ownerArtifactOpenOptions(target, record, options, false))

    return validateHardLinkTopology(root, target, opened, options, record, inventory)
  } catch (error) {
    if (error?.code === 'ENOENT') return null

    throw error
  }
}

function validOwnerTemporary(root, target, record, inventory) {
  if (typeof target !== 'string') return false
  try {
    validateTarget(target)
    artifactPath(root, target)
  } catch {
    return false
  }
  const initial = `${LOCK_BASENAME}.${record.pid}.${record.ownerNonce}.new`
  const next = `${LOCK_BASENAME}.${record.ownerNonce}.next`
  if (target === initial) return true
  if (record.operation === 'apply' && target === next) return true
  if (record.operation === 'recover-apply') {
    if (validRecoveryTemporaryTarget(target, record, inventory)) return true
    return backupParts(target) !== null
  }
  if (record.operation !== 'apply' || record.manifestId === null) return false
  if (validRecoveryTemporaryTarget(target, { ...record, recoveryId: record.manifestId }, inventory)) return true
  const backup = backupParts(target)
  if (backup !== null) return backup.manifestId === record.manifestId
  const basename = target.slice(target.lastIndexOf('/') + 1)
  const actionPrefix = `.nightshift-init-backlog.${record.manifestId}.`
  if (basename.startsWith(actionPrefix) && basename.endsWith('.tmp')) {
    const ordinal = basename.slice(actionPrefix.length, -4)
    if (/^[1-9][0-9]*$/.test(ordinal)) return true
  }
  const markerNames = Object.values(electionMarkerTemporaryNames(`${MARKER_BASENAME}.${record.manifestId}`))

  return markerNames.includes(target)
}

function validOwnerRecord(record, root, opened, inventory, platform = process.platform) {
  return validOwnerRecordShape(record, root, inventory) && (platform === 'win32' || opened.mode === 0o600)
}

function validOwnerRecordShape(record, root, inventory) {
  return validOwnerRecordSchema(record) && record.root === root && inventory.temporaryTargets.size === record.temporaryPaths.length && !record.temporaryPaths.some((item) => !validOwnerTemporary(root, item, record, inventory))
}

function ownerEvidence(root, options = {}) {
  const lock = join(root, LOCK_BASENAME)
  const openFile = options.stableOpenFile ?? stableOpenFile
  const opened = openFile(root, lock, { ...options, maxBytes: MAX_RECOVERY_REQUEST_BYTES, requireSingleLink: false })
  const record = parseCanonicalRecord(opened)
  const inventory = Array.isArray(record?.temporaryPaths) ? createOwnerInventoryIndex(record.temporaryPaths) : null
  if (inventory === null || !validOwnerRecord(record, root, opened, inventory, options.platform)) throw new Error('Publication lock record is malformed')
  validateHardLinkTopology(root, LOCK_BASENAME, opened, options, record, inventory)
  const pidStatus = pidEvidence(record.pid, options)
  if (pidStatus !== 'absent') throw new Error('Publication lock owner is live or indeterminate')
  const temporaryStates = record.temporaryPaths.map((target) => {
    const current = readOwnerArtifact(root, target, options, record, inventory)
    return { mode: current === null ? null : modeFor(current, options.platform), present: current !== null, rawSha256: current?.rawSha256 ?? null, target }
  })
  const directoryStates = record.unfinalizedDirectories.map((item) => {
    const path = artifactPath(root, item.target)
    try {
      const metadata = lstatSync(path, { bigint: true })
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Unfinalized directory is invalid')
      const mode = platformMode(options, Number(metadata.mode & 0o7777n))
      if (mode !== item.mode) throw new Error('Unfinalized directory mode changed')

      return { mode, present: true, target: item.target }
    } catch (error) {
      if (error?.code === 'ENOENT') return { mode: null, present: false, target: item.target }

      throw error
    }
  })

  validateOwnerInventoryStates(record, inventory, temporaryStates, directoryStates, (target) => validRecoveryTemporaryTarget(target, record, inventory))

  return { mode: modeFor(opened, options.platform), pidStatus, rawSha256: opened.rawSha256, record, temporaryStates, directoryStates, retainedBackups: temporaryStates.filter((item) => item.present && BACKUP_PATTERN.test(item.target)).map((item) => item.target).sort(compareOrdinal) }
}

function stageEvidence(root, target, options = {}) {
  const match = LOCK_STAGE_PATTERN.exec(target)
  if (match === null) failure('recover-inspect', 'inspect', 'runtime-lock', 'Lock stage basename is invalid.', null)
  let opened
  try {
    opened = readArtifact(root, target, { ...options, maxBytes: MAX_RECOVERY_REQUEST_BYTES }, true)
  } catch (error) {
    if (error?.code === 'file-too-large') failure('recover-inspect', 'inspect', 'payload-too-large', 'Lock stage exceeds the maximum size.', target, error)

    throw error
  }
  if (opened === null) failure('recover-inspect', 'inspect', 'runtime-lock', 'Lock stage is absent.', target)
  const pid = Number(match[1])
  const ownerNonce = match[2]
  const pidStatus = pidEvidence(pid, options)
  if (pidStatus !== 'absent') failure('recover-inspect', 'lock', 'runtime-lock', 'Lock stage owner is live or indeterminate.', target)
  const parsedRecord = parseCanonicalRecord(opened)
  if (parsedRecord !== null && (parsedRecord.pid !== pid || parsedRecord.ownerNonce !== ownerNonce)) failure('recover-inspect', 'inspect', 'runtime-lock', 'Lock stage identity differs from its basename.', target)
  const inventory = Array.isArray(parsedRecord?.temporaryPaths) ? createOwnerInventoryIndex(parsedRecord.temporaryPaths) : null
  const record = parsedRecord !== null && inventory !== null && validOwnerRecord(parsedRecord, root, opened, inventory, options.platform) ? parsedRecord : null

  return { pid, ownerNonce, pidStatus, rawSha256: opened.rawSha256, mode: modeFor(opened, options.platform), record }
}

function markerEvidence(root, options = {}) {
  let opened
  try {
    opened = readArtifact(root, MARKER_BASENAME, { ...options, maxBytes: MAX_INLINE_FILE_BYTES }, true)
  } catch (error) {
    if (error?.code === 'file-too-large') failure('recover-inspect', 'inspect', 'payload-too-large', 'Election marker exceeds the maximum inline size.', MARKER_BASENAME, error)

    throw error
  }
  if (opened === null) failure('recover-inspect', 'inspect', 'runtime-marker', 'Election marker is absent.', MARKER_BASENAME)
  const parsed = parseCanonicalRecord(opened)
  const inspection = options.currentInspection
  const policyProjection = recoveryPolicyProjection(inspection)
  const gitKind = inspection?.git?.kind ?? 'git'
  const validRecord = validateElectionMarkerRecord(parsed, root)
  if (!['git', 'non-git'].includes(gitKind)) failure('recover-inspect', 'inspect', 'runtime-marker', 'Election marker Git context is invalid.', MARKER_BASENAME)
  if (validRecord && gitKind === 'git') failure('recover-inspect', 'inspect', 'runtime-marker', 'Election marker is valid in the current Git root.', MARKER_BASENAME)
  const classification = validRecord ? 'valid-non-git' : 'invalid'
  return {
    rawSha256: opened.rawSha256,
    mode: modeFor(opened, options.platform),
    contentBase64: opened.bytes.toString('base64'),
    classification,
    gitKind,
    scaffoldPresent: inspection?.git?.freshScaffold === false,
    policyDigest: sha256(Buffer.from(canonicalJson(policyProjection), 'utf8')),
  }
}

function recoveryPolicyProjection(inspection) {
  if (inspection?.git === undefined) return {}
  const git = inspection.git

  return { kind: git.kind ?? null, objectFormat: git.objectFormat ?? null, scaffoldPresent: git.freshScaffold === false, plansPolicy: git.plansPolicy ?? null, trackedPlanPaths: git.trackedPlanPaths ?? [], trackedBacklogPaths: git.trackedBacklogPaths ?? [], nonPlanIgnoreMatches: git.nonPlanIgnoreMatches ?? [], nonPlanUnignoredPaths: git.nonPlanUnignoredPaths ?? [], newlinePolicies: git.newlinePolicies ?? [] }
}

function backupEvidence(root, target, options = {}) {
  const match = BACKUP_PATTERN.exec(target)
  if (match === null) failure('recover-inspect', 'inspect', 'filesystem', 'Backup basename is invalid.', null)
  let backup
  try {
    backup = readArtifact(root, target, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES), true)
  } catch (error) {
    if (error?.code === 'file-too-large') failure('recover-inspect', 'inspect', 'payload-too-large', 'Backup exceeds the maximum mechanical size.', target, error)

    throw error
  }
  if (backup === null) failure('recover-inspect', 'inspect', 'filesystem', 'Backup is absent.', target)
  const inspectionTargets = options.currentInspection?.targets ?? []
  const candidate = inspectionTargets.find((item) => sha256(Buffer.from(item.target, 'utf8')) === match[3])
  const candidateTarget = candidate?.target ?? null
  let current
  try {
    current = candidateTarget === null ? null : readArtifact(root, candidateTarget, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES), true)
  } catch (error) {
    if (error?.code === 'file-too-large') failure('recover-inspect', 'inspect', 'payload-too-large', 'Current recovery target exceeds the maximum mechanical size.', candidateTarget, error)

    throw error
  }
  const currentTarget = current === null ? null : candidateTarget
  const classification = classifyBackup(backup, current)
  return { classification, backupRawSha256: backup.rawSha256, backupMode: modeFor(backup, options.platform), backupContentBase64: backup.bytes.toString('base64'), currentTarget, currentRawSha256: current?.rawSha256 ?? null, currentMode: modeFor(current, options.platform), currentContentBase64: current?.bytes.toString('base64') ?? null }
}

function allowedDispositionsFor(recoveryKind, evidence) {
  return recoveryAllowedDispositions(recoveryKind, evidence)
}

function buildRecoveryResult(request, recoveryKind, recoveryTarget, evidence, allowedDispositions) {
  const value = { allowedDispositions, evidence: { backup: evidence.backup ?? null, lockStage: evidence.lockStage ?? null, marker: evidence.marker ?? null, owner: evidence.owner ?? null, recoveryGate: evidence.recoveryGate ?? null }, host: request.host, hostContext: request.hostContext, ok: true, operation: 'recover-inspect', protocolVersion: 1, recoveryId: null, recoveryKind, recoveryTarget, root: request.root }
  value.recoveryId = deriveRecoveryId(value)

  return value
}

function withTransientRecoveryLock(root, request, options, callback, lockContext = {}) {
  const lock = join(root, LOCK_BASENAME)
  const gate = recoveryGatePath(root)
  const lockPresent = pathExists(lock)
  const gatePresent = pathExists(gate)
  if (lockPresent || gatePresent) failure(request.operation, 'lock', 'runtime-lock', 'Recovery is blocked by existing coordination state.', lockPresent ? LOCK_BASENAME : RECOVERY_GATE_BASENAME)
  const pid = recoveryPidFor(options, request)
  const ownerNonce = ownerNonceFor(options, request)
  const paths = initialLockPaths(root, pid, ownerNonce)
  const temporaryPaths = [relativeArtifact(root, paths.stage), ...(lockContext.temporaryPaths ?? [])].sort(compareOrdinal)
  const record = { createdAtUnixMs: Date.now(), manifestId: null, operation: lockContext.operation ?? 'recover-inspect', ownerNonce, pid, protocolVersion: 1, recoveryId: lockContext.recoveryId ?? null, root, temporaryPaths, unfinalizedDirectories: [] }
  const lockCleanupOptions = { ...options }
  delete lockCleanupOptions.unlinkSync
  let acquired
  let acquiredIdentity
  let callbackError
  let callbackResult
  try {
    acquired = createInitialLock(root, record, { ...lockCleanupOptions, ownerNonce, pid })
    acquiredIdentity = stableOpenFile(root, acquired.paths.lock, boundedOpenOptions(lockCleanupOptions, acquired.bytes.length, { requireSingleLink: true })).identity
    if (pathExists(gate)) {
      removeInitialLock(root, acquired.paths, acquired.bytes, lockCleanupOptions)
      acquired = undefined
      failure(request.operation, 'lock', 'runtime-lock', 'Recovery gate appeared while acquiring the transient lock.', RECOVERY_GATE_BASENAME)
    }

    try {
      const verifyLock = () => {
        try {
          const current = stableOpenFile(root, acquired.paths.lock, boundedOpenOptions(lockCleanupOptions, acquired.bytes.length, { requireSingleLink: true }))
          if (current.identity !== acquiredIdentity || !current.bytes.equals(acquired.bytes) || (lockCleanupOptions.platform ?? process.platform) !== 'win32' && current.mode !== 0o600) throw new Error('Transient recovery lock changed before subject mutation')
        } catch (error) {
          failure(request.operation, 'prevalidate', 'snapshot-drift', 'Recovery lock changed before subject mutation.', request.recoveryTarget, error)
        }
      }

      callbackResult = callback(verifyLock)

      return callbackResult
    } catch (error) {
      callbackError = error
      throw error
    }
  } finally {
    if (acquired !== undefined) {
      try {
        const cleanupInventory = lockContext.cleanupInventory ?? temporaryPaths
        const retainsInventory = cleanupInventory.some((target) => pathExists(artifactPath(root, target)))
        if (!retainsInventory) removeInitialLock(root, acquired.paths, acquired.bytes, lockCleanupOptions)
      } catch (error) {
        if (callbackError !== undefined) {
          const combinedCause = new AggregateError([callbackError, error], 'Transient recovery cleanup failed after subject failure.')
          const cleanupSystemCode = trustedSystemCode(error)
          if (cleanupSystemCode !== null) combinedCause.code = cleanupSystemCode
          failure(request.operation, 'cleanup', 'cleanup-failed', 'cleanup-failed: Transient recovery lock cleanup failed.', LOCK_BASENAME, combinedCause, { recovery: { retainedBackups: [], status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Manual cleanup is required for retained recovery residue.', target: LOCK_BASENAME }] } })
        }

        failure(request.operation, 'cleanup', 'cleanup-failed', 'cleanup-failed: Transient recovery lock cleanup failed.', LOCK_BASENAME, error, { recovery: { retainedBackups: lockContext.retainedBackups ?? callbackResult?.retainedPaths ?? [], status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Manual cleanup is required for retained recovery residue.', target: LOCK_BASENAME }] } })
      }
    }
  }
}

function ownerNonceFor(options, request) {
  try {
    const ownerNonce = options.ownerNonce ?? randomBytes(16).toString('hex')
    if (!NONCE_PATTERN.test(ownerNonce)) throw new TypeError('Owner nonce is invalid')

    return ownerNonce
  } catch (error) {
    failure(request.operation, 'lock', 'runtime-lock', 'Owner nonce generation failed.', LOCK_BASENAME, error)
  }
}

function recoveryPidFor(options, request) {
  const pid = options.pid ?? process.pid
  if (!Number.isSafeInteger(pid) || pid <= 0) failure(request.operation, 'lock', 'runtime-lock', 'Recovery owner PID is invalid.', LOCK_BASENAME)

  return pid
}

function collectRecoveryInspections(root, request, options) {
  if (options.currentInspection !== undefined) return { first: options.currentInspection, second: options.currentInspection }
  const collect = options.collectInspection ?? collectInspection
  const first = collect(root, request.host, request.hostContext, options)
  const second = collect(root, request.host, request.hostContext, options)
  if (canonicalJson(first) !== canonicalJson(second)) failure(request.operation, 'inspect', 'snapshot-drift', 'snapshot-drift: Independent recovery collections differ.', request.recoveryTarget)

  return { first, second }
}

function inspectRecoveryOnce(request, options, currentInspection) {
  try {
    let evidence
    let allowed
    if (request.recoveryKind === 'stale-owner') {
      if (request.recoveryTarget !== LOCK_BASENAME) failure('recover-inspect', 'inspect', 'runtime-lock', 'Stale owner target is invalid.', request.recoveryTarget)
      try {
        evidence = { owner: ownerEvidence(options.root, options) }
      } catch (error) {
        if (error?.message === 'Publication lock owner is live or indeterminate') failure('recover-inspect', 'lock', 'runtime-lock', 'Publication lock owner is live or indeterminate.', request.recoveryTarget, error)

        failure('recover-inspect', 'lock', 'runtime-lock', 'Publication lock is malformed: directory or inventory validation failed.', request.recoveryTarget, error)
      }
      allowed = ['cleanup']
    } else if (request.recoveryKind === 'stale-recovery-gate') {
      if (request.recoveryTarget !== RECOVERY_GATE_BASENAME) failure('recover-inspect', 'inspect', 'runtime-lock', 'Recovery gate target is invalid.', request.recoveryTarget)
      let gate
      try {
        gate = gateEvidence(options.root, options)
      } catch (error) {
        failure('recover-inspect', 'lock', 'runtime-lock', 'Recovery gate is malformed: link, identity, or extra entry validation failed.', request.recoveryTarget, error)
      }
      if (gate === null) failure('recover-inspect', 'inspect', 'runtime-lock', 'Recovery gate is absent.', request.recoveryTarget)
      if (gate.record !== null && gate.pidStatus !== 'absent') failure('recover-inspect', 'lock', 'runtime-lock', 'Recovery gate owner is live or indeterminate.', request.recoveryTarget)
      evidence = { recoveryGate: gate }
      allowed = ['cleanup']
    } else if (request.recoveryKind === 'orphan-lock-stage') {
      evidence = { lockStage: stageEvidence(options.root, request.recoveryTarget, options) }
      allowed = ['remove']
    } else if (request.recoveryKind === 'election-marker') {
      const marker = markerEvidence(options.root, { ...options, currentInspection })
      evidence = { marker }
    } else if (request.recoveryKind === 'abandoned-backup') {
      const backup = backupEvidence(options.root, request.recoveryTarget, { ...options, currentInspection })
      evidence = { backup }
    } else {
      failure('recover-inspect', 'inspect', 'invalid-request', 'Recovery kind is invalid.', null)
    }

    allowed ??= allowedDispositionsFor(request.recoveryKind, evidence)

    const result = buildRecoveryResult(request, request.recoveryKind, request.recoveryTarget, evidence, allowed)
    if (canonicalBytes(result).length > MAX_RECOVERY_RESULT_BYTES) failure('recover-inspect', 'inspect', 'payload-too-large', 'Recovery inspection result exceeds the maximum size.', request.recoveryTarget)
    for (const disposition of allowed) {
      const applyRequest = buildRecoveryApplyRequest(request, result, disposition)
      if (canonicalBytes(applyRequest).length > MAX_RECOVERY_REQUEST_BYTES) failure('recover-inspect', 'inspect', 'payload-too-large', 'Recovery apply request exceeds the maximum size.', request.recoveryTarget)
    }

    return result
  } catch (error) {
    if (error instanceof InitBacklogError) throw error
    failure('recover-inspect', 'inspect', 'filesystem', 'Recovery evidence inspection failed.', request.recoveryTarget, error)
  }
}

function inspectRecovery(request, options = {}) {
  let root
  try {
    root = canonicalRoot(request.root)
  } catch (error) {
    failure('recover-inspect', 'inspect', 'filesystem', 'Recovery root validation failed.', null, error)
  }
  const kind = request.recoveryKind
  const target = request.recoveryTarget
  if (['orphan-lock-stage', 'election-marker', 'abandoned-backup'].includes(kind) && options.skipTransientLock !== true) {
    return withTransientRecoveryLock(root, request, options, () => {
      const collections = ['election-marker', 'abandoned-backup'].includes(kind) ? collectRecoveryInspections(root, request, options) : { first: undefined, second: undefined }
      const first = inspectRecoveryOnce(request, { ...options, root, skipTransientLock: true }, collections.first)
      const second = inspectRecoveryOnce(request, { ...options, root, skipTransientLock: true }, collections.second)
      if (canonicalJson(first.evidence) !== canonicalJson(second.evidence)) failure('recover-inspect', 'inspect', 'snapshot-drift', 'snapshot-drift: Recovery evidence collections differ.', target)

      return second
    })
  }
  const currentInspection = options.currentInspection ?? (['election-marker', 'abandoned-backup'].includes(kind) ? collectRecoveryInspections(root, request, options).second : undefined)

  return inspectRecoveryOnce(request, { ...options, root }, currentInspection)
}

function sameEvidence(left, right) {
  return sameCanonical(left.evidence, right.evidence)
}

function sameRecoveryGate(left, right) {
  return sameCanonical(left, right)
}

function emptyRecoveryGate(gate) {
  return gate.ownerName === null && gate.ownerRawSha256 === null && gate.ownerMode === null && gate.ownerStageRawSha256 === null && gate.ownerStageMode === null && gate.record === null && gate.pidStatus === null
}

function recoveryGateTransition(expected, current) {
  if (sameRecoveryGate(expected, current)) return 'unchanged'
  if (expected.mode !== current.mode) return null
  const expectedStage = expected.ownerStageRawSha256 !== null
  const expectedOwner = expected.ownerRawSha256 !== null
  const currentStage = current.ownerStageRawSha256 !== null
  const currentOwner = current.ownerRawSha256 !== null
  if (expectedStage && expectedOwner && !currentStage && currentOwner && sameRecoveryGate({ ...expected, ownerStageRawSha256: null, ownerStageMode: null }, { ...current, ownerStageRawSha256: null, ownerStageMode: null })) return 'stage-removed'
  if (expectedStage && expectedOwner && currentStage && !currentOwner && sameRecoveryGate({ ...expected, ownerName: null, ownerRawSha256: null, ownerMode: null, record: null, pidStatus: null }, { ...current, ownerName: null, ownerRawSha256: null, ownerMode: null, record: null, pidStatus: null })) return 'owner-removed'
  if ((expectedStage || expectedOwner) && !currentStage && !currentOwner && emptyRecoveryGate(current)) return 'complete'
  if (expectedStage && !expectedOwner && currentStage && currentOwner && current.ownerName === RECOVERY_OWNER_BASENAME && current.ownerRawSha256 === expected.ownerStageRawSha256 && current.ownerMode === expected.ownerStageMode && current.ownerStageRawSha256 === expected.ownerStageRawSha256 && current.ownerStageMode === expected.ownerStageMode && current.record !== null && current.pidStatus === 'absent') return 'owner-published'
  if (expectedStage && !expectedOwner && !currentStage && currentOwner && current.ownerName === RECOVERY_OWNER_BASENAME && current.ownerRawSha256 === expected.ownerStageRawSha256 && current.ownerMode === expected.ownerStageMode && current.record !== null && current.pidStatus === 'absent') return 'stage-removed-after-owner-publish'

  return null
}

function validateStaleOwnerReplay(root, owner, options, inventory) {
  const recordValid = validOwnerRecordShape(owner.record, root, inventory)
  const rawValid = sha256(Buffer.from(`${canonicalJson(owner.record)}\n`, 'utf8')) === owner.rawSha256
  const modeValid = (options.platform ?? process.platform) === 'win32' || owner.mode === 0o600
  if (!recordValid || !rawValid || !modeValid) throw new Error(`Stale owner record is not a valid inventory authority (${recordValid},${rawValid},${modeValid})`)
  const temporaryTargets = owner.record.temporaryPaths
  if (canonicalJson(owner.temporaryStates.map((item) => item.target)) !== canonicalJson(temporaryTargets)) throw new Error('Stale owner temporary inventory differs from its lock record')
  const directoryTargets = owner.record.unfinalizedDirectories.map((item) => item.target)
  if (canonicalJson(owner.directoryStates.map((item) => item.target)) !== canonicalJson(directoryTargets)) throw new Error('Stale owner directory inventory differs from its lock record')

  let presentObserved = false
  const retainedBackups = []
  for (const item of owner.temporaryStates) {
    const current = readOwnerArtifact(root, item.target, options, owner.record, inventory)
    if (!item.present) {
      if (current !== null) throw new Error('Stale owner temporary appeared after inspection')
      continue
    }
    if (current === null) {
      if (BACKUP_PATTERN.test(item.target)) throw new Error('Validated stale owner backup is missing')
      if (presentObserved) throw new Error('Stale owner temporary removal is not a contiguous prefix')
      continue
    }
    if (current.rawSha256 !== item.rawSha256 || modeFor(current, options.platform) !== item.mode) throw new Error('Stale owner temporary changed before cleanup')
    if (BACKUP_PATTERN.test(item.target)) retainedBackups.push(item.target)
    presentObserved = true
  }
  if (canonicalJson(retainedBackups.sort(compareOrdinal)) !== canonicalJson(owner.retainedBackups)) throw new Error('Stale owner retained backup inventory changed')
  for (const item of owner.directoryStates) {
    const path = artifactPath(root, item.target)
    let current
    try {
      const metadata = lstatSync(path, { bigint: true })
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Stale owner directory is invalid')
      current = { mode: platformMode(options, Number(metadata.mode & 0o7777n)), present: true }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error

      current = { mode: null, present: false }
    }
    if (current.present !== item.present || current.mode !== item.mode) throw new Error('Stale owner directory changed before cleanup')
  }
}

function validateStaleOwnerLock(root, owner, options, inventory) {
  const current = readOwnerArtifact(root, LOCK_BASENAME, options, owner.record, inventory)
  if (current === null) return
  if (current.rawSha256 !== owner.rawSha256 || modeFor(current, options.platform) !== owner.mode) throw new Error('Stale owner lock changed before cleanup')
}

function removeArtifact(root, target, expected, options = {}, requireSingleLink = true) {
  const path = artifactPath(root, target)
  if (!pathExists(path)) return false
  const current = stableOpenFile(root, path, boundedOpenOptions(options, recoveryArtifactByteLimit(target), { requireSingleLink }))
  if (expected !== null && (current.rawSha256 !== expected.rawSha256 || expected.mode !== null && current.mode !== expected.mode || expected.identity !== undefined && current.identity !== expected.identity || expected.recoveryId !== undefined && parseCanonicalRecord(current)?.recoveryId !== expected.recoveryId)) throw new Error('Recovery artifact changed before removal')
  const remove = options.removeAndVerify ?? removeAndVerify
  options.verifyLock?.()
  remove(path, options)

  return true
}

function removeOwnerArtifact(root, target, expected, options, record, inventory) {
  const path = artifactPath(root, target)
  if (!pathExists(path)) return false
  const current = readOwnerArtifact(root, target, options, record, inventory)
  if (current === null || expected !== null && (current.rawSha256 !== expected.rawSha256 || expected.mode !== null && current.mode !== expected.mode || expected.identity !== undefined && current.identity !== expected.identity)) throw new Error('Recovery artifact changed before removal')
  const remove = options.removeAndVerify ?? removeAndVerify
  options.verifyLock?.()
  remove(path, options)

  return true
}

function recoverySuccess(request, inspection, disposition, status, changedPaths, retainedPaths) {
  return { changedPaths: [...new Set(changedPaths)].sort(compareOrdinal), disposition, host: request.host, hostContext: request.hostContext, ok: true, operation: 'recover-apply', protocolVersion: 1, recoveryId: inspection.recoveryId, recoveryKind: inspection.recoveryKind, recoveryTarget: inspection.recoveryTarget, retainedPaths: [...new Set(retainedPaths)].sort(compareOrdinal), root: request.root, status, warnings: [] }
}

function directoryIdentity(path) {
  const metadata = lstatSync(path, { bigint: true })

  return comparableIdentity(metadata)
}

function verifyRecoveryGateDirectory(path, options, expectedIdentity = null) {
  const metadata = lstatSync(path, { bigint: true })
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Recovery gate is not an ordinary directory')
  if ((options.platform ?? process.platform) !== 'win32' && Number(metadata.mode & 0o7777n) !== 0o700) throw new Error('Recovery gate mode is invalid')
  const identity = comparableIdentity(metadata)
  if (expectedIdentity !== null && identity !== expectedIdentity) throw new Error('Recovery gate identity changed before owner staging')

  return identity
}

function removeOwnedRecoveryGate(path, expectedIdentity, options = {}) {
  try {
    const metadata = lstatSync(path, { bigint: true })
    const identity = comparableIdentity(metadata)
    if (!metadata.isDirectory() || metadata.isSymbolicLink() || identity !== expectedIdentity || !directoryIsEmpty(path, options)) return

    rmdirSync(path)
  } catch {
    // Retain residue when ownership or emptiness cannot be proved.
  }
}

function writeRecoveryGateStage(root, stage, bytes, options) {
  stageFile(stage, bytes, { ...options, onTransition: undefined })
  const opened = stableOpenFile(root, stage, boundedOpenOptions(options, bytes.length, { requireSingleLink: true }))
  if (!opened.bytes.equals(bytes) || (options.platform ?? process.platform) !== 'win32' && opened.mode !== 0o600) throw new Error('Recovery gate stage readback differs')

  return opened
}

function claimRecoveryGate(root, inspection, options = {}) {
  const gate = recoveryGatePath(root)
  const stage = join(gate, RECOVERY_OWNER_STAGE_BASENAME)
  const owner = join(gate, RECOVERY_OWNER_BASENAME)
  const pid = recoveryPidFor(options, { operation: 'recover-apply' })
  const nonce = ownerNonceFor(options, { operation: 'recover-apply' })
  const record = { createdAtUnixMs: Date.now(), manifestId: null, operation: 'recover-apply', ownerNonce: nonce, pid, protocolVersion: 1, recoveryId: inspection.recoveryId, root, temporaryPaths: [], unfinalizedDirectories: [] }
  const bytes = Buffer.from(`${canonicalJson(record)}\n`, 'utf8')
  let created = false
  let createdIdentity = null
  try {
    try {
      mkdirSync(gate, { mode: 0o700 })
      created = true
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
    }
    if (!created) {
      const existing = gateEvidence(root, options)
      if (existing === null || existing.record === null || existing.record.recoveryId !== inspection.recoveryId || existing.ownerRawSha256 === null || existing.pidStatus !== 'absent') failure('recover-apply', 'lock', 'runtime-lock', 'Recovery gate is owned by another operation.', RECOVERY_GATE_BASENAME)
      if (existing.ownerStageRawSha256 !== null) failure('recover-apply', 'lock', 'runtime-lock', 'Recovery gate is owned by another operation.', RECOVERY_GATE_BASENAME)

      const existingOwner = stableOpenFile(root, owner, boundedOpenOptions(options, MAX_RECOVERY_REQUEST_BYTES, { requireSingleLink: false }))
      const gateIdentity = directoryIdentity(gate)
      try {
        linkSync(owner, stage)
      } catch (error) {
        failure('recover-apply', 'lock', 'runtime-lock', 'Recovery gate is owned by another operation.', RECOVERY_GATE_BASENAME, error)
      }
      const existingStage = stableOpenFile(root, stage, boundedOpenOptions(options, existingOwner.bytes.length, { requireSingleLink: false }))
      const stageMetadata = lstatSync(stage, { bigint: true })
      const ownerMetadata = lstatSync(owner, { bigint: true })
      if (stageMetadata.nlink !== 2n || ownerMetadata.nlink !== 2n || existingStage.identity !== existingOwner.identity || !existingStage.bytes.equals(existingOwner.bytes) || modeFor(existingStage, options.platform) !== modeFor(existingOwner, options.platform)) throw new Error('Recovery gate owner identity differs from its stage')
      const claim = { bytes: existingOwner.bytes, gate, gateIdentity, owner: join(gate, RECOVERY_OWNER_BASENAME), ownerIdentity: existingOwner.identity, ownerMode: existingOwner.mode, recoveryId: inspection.recoveryId, stage, stageBytes: existingStage.bytes, stageIdentity: existingStage.identity, stageMode: existingStage.mode }
      verifyClaimedRecoveryGate(root, claim, options)
      options.onTransition?.('after-recovery-gate-reuse-claim')

      return claim
    }
    createdIdentity = directoryIdentity(gate)
    verifyRecoveryGateDirectory(gate, options, createdIdentity)
    const staged = writeRecoveryGateStage(root, stage, bytes, options)
    linkSync(stage, owner)
    const published = stableOpenFile(root, owner, boundedOpenOptions(options, bytes.length, { requireSingleLink: false }))
    const stageMetadata = lstatSync(stage, { bigint: true })
    const ownerMetadata = lstatSync(owner, { bigint: true })
    if (stageMetadata.nlink !== 2n || ownerMetadata.nlink !== 2n || published.identity !== staged.identity || !published.bytes.equals(bytes)) throw new Error('Recovery gate owner identity differs from its stage')
    unlinkSync(stage)
    if (pathExists(stage)) throw new Error('Recovery gate owner stage was not removed')
    options.onTransition?.('after-recovery-gate-owner-publish')
  } catch (error) {
    if (created && createdIdentity !== null) removeOwnedRecoveryGate(gate, createdIdentity, options)
    if (error instanceof InitBacklogError) throw error

    throw new Error('Recovery gate ownership could not be claimed', { cause: error })
  }

  const finalOwner = stableOpenFile(root, owner, boundedOpenOptions(options, bytes.length, { requireSingleLink: false }))
  const claim = { bytes, gate, gateIdentity: directoryIdentity(gate), owner, ownerIdentity: finalOwner.identity, ownerMode: finalOwner.mode, recoveryId: inspection.recoveryId, stage: null, stageBytes: null, stageIdentity: null, stageMode: null }
  verifyClaimedRecoveryGate(root, claim, options)

  return claim
}

function verifyClaimedRecoveryGate(root, claim, options) {
  if (claim.gateIdentity !== directoryIdentity(claim.gate)) throw new Error('Recovery gate identity changed after ownership claim')
  const expectedEntries = claim.stage === null ? [RECOVERY_OWNER_BASENAME] : [RECOVERY_OWNER_BASENAME, RECOVERY_OWNER_STAGE_BASENAME]
  const entries = readDirectoryNames(claim.gate, { ...options, maxSelectedEntries: expectedEntries.length + 1 })
  if (entries.length !== expectedEntries.length || entries.some((entry, index) => entry !== expectedEntries[index])) throw new Error('Recovery gate ownership has unexpected entries')
  const owner = stableOpenFile(root, claim.owner, boundedOpenOptions(options, claim.bytes.length, { requireSingleLink: false }))
  if (owner.identity !== claim.ownerIdentity || !owner.bytes.equals(claim.bytes)) throw new Error('Recovery gate owner changed after ownership claim')
  if (claim.stage !== null) {
    const stage = stableOpenFile(root, claim.stage, boundedOpenOptions(options, claim.stageBytes.length, { requireSingleLink: false }))
    const stageMetadata = lstatSync(claim.stage, { bigint: true })
    const ownerMetadata = lstatSync(claim.owner, { bigint: true })
    if (stage.identity !== claim.stageIdentity || !stage.bytes.equals(claim.stageBytes) || stage.identity !== owner.identity || stageMetadata.nlink !== 2n || ownerMetadata.nlink !== 2n || modeFor(owner, options.platform) !== claim.ownerMode || modeFor(stage, options.platform) !== claim.stageMode) throw new Error('Recovery gate owner pair changed after ownership claim')
  }
}

function releaseRecoveryGate(claim, options = {}) {
  try {
    if (!existsSync(claim.gate)) return
    if (claim.gateIdentity !== directoryIdentity(claim.gate)) throw new Error('Recovery gate identity changed before cleanup')
    if (claim.stage !== null) {
      const entries = readDirectoryNames(claim.gate, { ...options, maxSelectedEntries: 3 })
      if (entries.length !== 2 || entries[0] !== RECOVERY_OWNER_BASENAME || entries[1] !== RECOVERY_OWNER_STAGE_BASENAME) throw new Error('Recovery gate owner pair changed before cleanup')
      const stage = stableOpenFile(claim.gate, claim.stage, boundedOpenOptions(options, claim.stageBytes.length, { requireSingleLink: false }))
      const owner = stableOpenFile(claim.gate, claim.owner, boundedOpenOptions(options, claim.bytes.length, { requireSingleLink: false }))
      const stageMetadata = lstatSync(claim.stage, { bigint: true })
      const ownerMetadata = lstatSync(claim.owner, { bigint: true })
      if (stage.identity !== claim.stageIdentity || owner.identity !== claim.ownerIdentity || !stage.bytes.equals(claim.stageBytes) || !owner.bytes.equals(claim.bytes) || stage.identity !== owner.identity || stageMetadata.nlink !== 2n || ownerMetadata.nlink !== 2n || modeFor(owner, options.platform) !== claim.ownerMode || modeFor(stage, options.platform) !== claim.stageMode) throw new Error('Recovery gate owner pair changed before cleanup')
    }
    for (const artifact of [{ bytes: claim.stageBytes, identity: claim.stageIdentity, mode: claim.stageMode, path: claim.stage }, { bytes: claim.bytes, identity: claim.ownerIdentity, mode: claim.ownerMode, path: claim.owner }]) {
      if (artifact.path === null || !existsSync(artifact.path)) continue
      const current = stableOpenFile(claim.gate, artifact.path, boundedOpenOptions(options, artifact.bytes.length, { requireSingleLink: false }))
      const record = parseCanonicalRecord(current)
      if (artifact.identity !== null && current.identity !== artifact.identity || artifact.bytes !== null && !current.bytes.equals(artifact.bytes) || artifact.mode !== null && current.mode !== artifact.mode || record === null || record.recoveryId !== claim.recoveryId) throw new Error('Recovery gate owner changed before cleanup')
      unlinkSync(artifact.path)
      if (existsSync(artifact.path)) throw new Error('Recovery gate owner remains after cleanup')
    }
    if (!directoryIsEmpty(claim.gate, options)) throw new Error('Recovery gate is not empty')
    rmdirSync(claim.gate)
    if (existsSync(claim.gate)) throw new Error('Recovery gate remains after cleanup')
  } catch {
    // Retain the gate for stale-recovery-gate inspection when cleanup cannot complete.
    throw new Error('Recovery gate cleanup failed')
  }
}

function applyBackup(root, inspection, disposition, options = {}) {
  const evidence = inspection.evidence.backup
  const remove = options.removeAndVerify ?? removeAndVerify
  const backupPath = artifactPath(root, inspection.recoveryTarget)
  const backup = stableOpenFile(root, backupPath, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
  if (backup.rawSha256 !== evidence.backupRawSha256 || modeFor(backup, options.platform) !== evidence.backupMode) throw new Error('Backup evidence changed')
  if (disposition === 'remove' || disposition === 'accept') {
    if (disposition === 'accept' && evidence.currentTarget !== null) {
      const current = readArtifact(root, evidence.currentTarget, options, true)
      if (current === null || current.rawSha256 !== evidence.currentRawSha256 || modeFor(current, options.platform) !== evidence.currentMode) throw new Error('Accepted target changed')
    }
    removeRecoveryBackup(root, backupPath, evidence, options, remove)

    return { changed: [inspection.recoveryTarget], retained: evidence.currentTarget !== null ? [evidence.currentTarget] : [] }
  }
  if (disposition !== 'restore' || evidence.currentTarget === null) throw new Error('Backup disposition is invalid')
  const targetPathValue = artifactPath(root, evidence.currentTarget)
  const current = readArtifact(root, evidence.currentTarget, options, true)
  const temporary = artifactPath(root, recoveryTemporaryTarget(evidence.currentTarget, inspection.recoveryId))
  const mode = evidence.backupMode
  if (current === null) throw new Error('Target changed before recovery publication')
  if (current.rawSha256 === evidence.backupRawSha256 && modeFor(current, options.platform) === evidence.backupMode) {
    removeRecoveryBackup(root, backupPath, evidence, options, remove)

    return { changed: [evidence.currentTarget, inspection.recoveryTarget], retained: [] }
  }
  if (current.rawSha256 !== evidence.currentRawSha256 || modeFor(current, options.platform) !== evidence.currentMode) throw new Error('Target changed before recovery publication')
  publishRecoveryFile(root, targetPathValue, backup.bytes, mode, { ...options, expected: current, recoveryId: inspection.recoveryId, temporary })
  removeRecoveryBackup(root, backupPath, evidence, options, remove)

  return { changed: [evidence.currentTarget, inspection.recoveryTarget], retained: [] }
}

function removeRecoveryBackup(root, backupPath, evidence, options, remove) {
  try {
    removeRecoveryFile(root, backupPath, { mode: evidence.backupMode, rawSha256: evidence.backupRawSha256 }, { ...options, removeAndVerify: remove })
  } catch (error) {
    if (error instanceof InitBacklogError) throw error

    error.recoveryCleanupAfterRestore = true

    throw error
  }
}

function invalidatedMarkerRecord(root, marker, state) {
  return { protocolVersion: 1, root, snapshotId: sha256(Buffer.from(canonicalJson({ invalidMarkerSha256: marker.rawSha256, protocolVersion: 1, root, state }), 'utf8')), state }
}

function markerAlreadyApplied(root, inspection, disposition, options = {}) {
  const path = artifactPath(root, MARKER_BASENAME)
  try {
    if (disposition === 'abandon') return !pathExists(path)
    const current = readArtifact(root, MARKER_BASENAME, options, true)
    if (current === null) return false
    const marker = inspection.evidence.marker
    const expected = invalidatedMarkerRecord(root, marker, disposition)

    return current.bytes.equals(Buffer.from(`${canonicalJson(expected)}\n`, 'utf8')) && (marker.mode === null || current.mode === marker.mode)
  } catch {
    return false
  }
}

function collectFreshRecoveryProjection(root, request, options, carriedTargets) {
  if (options.currentInspection !== undefined) return { inspection: options.currentInspection, authoritative: false }
  if (options.collectInspection === undefined && options.currentInspection === undefined) return { inspection: { git: {}, targets: carriedTargets }, authoritative: false }
  const collect = options.collectInspection ?? collectInspection
  const first = collect(root, request.host, request.hostContext, options)
  const second = collect(root, request.host, request.hostContext, options)
  if (canonicalJson({ ...first, snapshotId: null }) !== canonicalJson({ ...second, snapshotId: null })) failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', request.recoveryTarget)

  return { inspection: second, authoritative: true }
}

function verifyTerminalRecovery(root, request, inspection, fresh, options) {
  if (inspection.recoveryKind === 'abandoned-backup') {
    const evidence = inspection.evidence.backup
    const match = BACKUP_PATTERN.exec(inspection.recoveryTarget)
    const candidate = fresh.inspection.targets?.find((item) => sha256(Buffer.from(item.target, 'utf8')) === match[3])
    if (candidate?.target !== (evidence.currentTarget ?? null)) throw new Error('Recovery target mapping changed')
    if (evidence.currentTarget !== null) {
      const current = readArtifact(root, evidence.currentTarget, options, true)
      if (current === null || request.disposition === 'restore' && (current.rawSha256 !== evidence.backupRawSha256 || modeFor(current, options.platform) !== evidence.backupMode) || request.disposition !== 'restore' && (current.rawSha256 !== evidence.currentRawSha256 || modeFor(current, options.platform) !== evidence.currentMode)) throw new Error('Recovery target changed')
    }
    if (request.disposition === 'restore') {
      const backup = readArtifact(root, inspection.recoveryTarget, options, true)
      if (backup !== null && (backup.rawSha256 !== evidence.backupRawSha256 || modeFor(backup, options.platform) !== evidence.backupMode)) throw new Error('Recovery backup changed')
    }
    if (request.disposition !== 'restore' && pathExists(artifactPath(root, inspection.recoveryTarget))) throw new Error('Recovery backup successor is present')
  } else if (inspection.recoveryKind === 'election-marker') {
    const marker = inspection.evidence.marker
    if (fresh.authoritative && sha256(Buffer.from(canonicalJson(recoveryPolicyProjection(fresh.inspection)), 'utf8')) !== marker.policyDigest) throw new Error('Recovery policy changed')
    if (!markerAlreadyApplied(root, inspection, request.disposition, options)) throw new Error('Recovery marker terminal state changed')
  }
}

function backupRestoreState(root, inspection, options = {}) {
  const evidence = inspection.evidence.backup
  if (evidence.currentTarget === null) return null
  const current = readArtifact(root, evidence.currentTarget, options, true)
  if (current === null || current.rawSha256 !== evidence.backupRawSha256 || modeFor(current, options.platform) !== evidence.backupMode) return null
  const backup = readArtifact(root, inspection.recoveryTarget, options, true)
  if (backup === null) return 'target-restored-backup-absent'
  if (backup.rawSha256 !== evidence.backupRawSha256 || modeFor(backup, options.platform) !== evidence.backupMode) return null

  return 'target-restored-backup-retained'
}

function recoveryTemporaryPaths(root, inspection, disposition, ownerNonce, pid) {
  const paths = [initialLockPaths(root, pid, ownerNonce).stage]
  if (inspection.recoveryKind === 'election-marker' && disposition !== 'abandon') paths.push(artifactPath(root, recoveryTemporaryTarget(MARKER_BASENAME, inspection.recoveryId)))
  if (inspection.recoveryKind === 'abandoned-backup' && disposition === 'restore' && inspection.evidence.backup.currentTarget !== null) {
    paths.push(artifactPath(root, recoveryTemporaryTarget(inspection.evidence.backup.currentTarget, inspection.recoveryId)))
    paths.push(artifactPath(root, inspection.recoveryTarget))
  }

  return paths.map((path) => relativeArtifact(root, path)).sort(compareOrdinal)
}

function recoveryCapacityPaths(root, inspection, temporaryPaths) {
  const paths = new Set([LOCK_BASENAME, RECOVERY_GATE_BASENAME, `${RECOVERY_GATE_BASENAME}/${RECOVERY_OWNER_STAGE_BASENAME}`, `${RECOVERY_GATE_BASENAME}/${RECOVERY_OWNER_BASENAME}`, inspection.recoveryTarget, ...temporaryPaths])
  const evidence = inspection.evidence
  for (const item of evidence.owner?.temporaryStates ?? []) paths.add(item.target)
  for (const item of evidence.owner?.directoryStates ?? []) paths.add(item.target)
  for (const target of evidence.owner?.retainedBackups ?? []) paths.add(target)
  if (evidence.backup?.currentTarget !== null && evidence.backup?.currentTarget !== undefined) paths.add(evidence.backup.currentTarget)
  if (inspection.recoveryKind === 'stale-owner') {
    for (const item of evidence.owner?.temporaryStates ?? []) if (item.present) paths.add(item.target)
  }

  return [...paths].sort(compareOrdinal)
}

function recoveryCapacityWarnings(paths) {
  const capacityWarningTarget = paths.length === 0 ? null : [...paths].sort((left, right) => {
    const length = Buffer.byteLength(canonicalJson(left), 'utf8') - Buffer.byteLength(canonicalJson(right), 'utf8')

    return length === 0 ? compareOrdinal(left, right) : length
  }).at(-1)
  const capacityDetail = '\u0000'.repeat(4096)

  return [...WARNING_CODES].sort(compareOrdinal).map((code) => ({ code, detail: capacityDetail, target: capacityWarningTarget }))
}

function enforceRecoveryResultCapacity(request, inspection, disposition, options) {
  const pid = recoveryPidFor(options, request)
  const ownerNonce = ownerNonceFor(options, request)
  const temporaryPaths = recoveryTemporaryPaths(request.root, inspection, disposition, ownerNonce, pid)
  const paths = recoveryCapacityPaths(request.root, inspection, temporaryPaths)
  const warnings = recoveryCapacityWarnings(paths)
  const success = recoverySuccess(request, inspection, disposition, 'completed', paths, paths)
  success.warnings = warnings
  const failureResult = { actionId: null, code: 'payload-too-large', detail: '\u0000'.repeat(4096), manifestId: null, ok: false, operation: 'recover-apply', outcomes: [], phase: 'prevalidate', protocolVersion: 1, recovery: { retainedBackups: paths, status: 'cleanup-failed', warnings }, systemCode: null, target: inspection.recoveryTarget }
  if (canonicalBytes(success).length > MAX_RECOVERY_RESULT_BYTES || canonicalBytes(failureResult).length > MAX_RECOVERY_RESULT_BYTES) failure('recover-apply', 'prevalidate', 'payload-too-large', 'Recovery result exceeds the maximum size.', inspection.recoveryTarget)

  return temporaryPaths
}

function throwRecoveryCleanupFailure(inspection, error) {
  const retainedBackups = inspection.recoveryKind === 'stale-owner' ? inspection.evidence.owner?.retainedBackups ?? [] : inspection.recoveryKind === 'abandoned-backup' ? [inspection.recoveryTarget] : []
  failure('recover-apply', 'cleanup', 'cleanup-failed', 'cleanup-failed: Recovery publication cleanup failed.', inspection.recoveryTarget, error, { recovery: { retainedBackups, status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Manual cleanup is required for retained recovery residue.', target: inspection.recoveryTarget }] } })
}

function applyRecovery(request, options = {}) {
  const inspection = request.recoveryInspection
  if (inspection === null || inspection === undefined || deriveRecoveryId({ ...inspection, recoveryId: null }) !== inspection.recoveryId || !inspection.allowedDispositions.includes(request.disposition)) failure('recover-apply', 'prevalidate', 'recovery-invalid', 'Recovery inspection or disposition is invalid.', inspection?.recoveryTarget ?? null)
  if (options.unattended === true && (options.authority === undefined || canonicalJson(options.authority) !== canonicalJson(inspection))) failure('recover-apply', 'prevalidate', 'recovery-invalid', 'Unattended recovery requires captured surrounding authority.', inspection.recoveryTarget)
  const root = canonicalRoot(request.root)
  if (root !== inspection.root) failure('recover-apply', 'prevalidate', 'recovery-invalid', 'Recovery inspection root differs from the apply root.', inspection.recoveryTarget)
  if (inspection.recoveryKind === 'election-marker' && inspection.recoveryTarget !== MARKER_BASENAME) failure('recover-apply', 'prevalidate', 'recovery-invalid', 'Election marker target is invalid.', inspection.recoveryTarget)
  const recoveryOwnerOptions = { ...options, ownerNonce: ownerNonceFor(options, request), pid: recoveryPidFor(options, request) }
  options = recoveryOwnerOptions
  const recoveryLockTemporaryPaths = enforceRecoveryResultCapacity(request, inspection, request.disposition, recoveryOwnerOptions)
  if (['orphan-lock-stage', 'election-marker', 'abandoned-backup'].includes(inspection.recoveryKind) && options.skipTransientLock !== true) {
    const stageTarget = relativeArtifact(root, initialLockPaths(root, recoveryOwnerOptions.pid, recoveryOwnerOptions.ownerNonce).stage)
    const lockContext = ['election-marker', 'abandoned-backup'].includes(inspection.recoveryKind) ? { cleanupInventory: recoveryLockTemporaryPaths.filter((target) => target !== stageTarget && target !== inspection.recoveryTarget), operation: 'recover-apply', recoveryId: inspection.recoveryId, temporaryPaths: recoveryLockTemporaryPaths.filter((target) => target !== stageTarget) } : {}

    try {
      return withTransientRecoveryLock(root, request, recoveryOwnerOptions, (verifyLock) => applyRecovery(request, { ...recoveryOwnerOptions, skipTransientLock: true, verifyLock }), lockContext)
    } catch (error) {
      const cleanupSubject = inspection.recoveryKind === 'election-marker' && request.disposition === 'abandon' || inspection.recoveryKind === 'abandoned-backup' && request.disposition !== 'restore'
      if (cleanupSubject && !(error instanceof InitBacklogError)) {
        throwRecoveryCleanupFailure(inspection, error)
      }

      throw error
    }
  }
  const remove = options.removeAndVerify ?? removeAndVerify
  try {
    if (inspection.recoveryKind === 'orphan-lock-stage' && !pathExists(artifactPath(root, inspection.recoveryTarget))) return recoverySuccess(request, inspection, request.disposition, 'already-complete', [], [])
    if (inspection.recoveryKind === 'stale-recovery-gate' && !pathExists(recoveryGatePath(root))) return recoverySuccess(request, inspection, request.disposition, 'already-complete', [], [])
    const carriedTargets = inspection.evidence.backup?.currentTarget === null || inspection.evidence.backup?.currentTarget === undefined ? [] : [{ target: inspection.evidence.backup.currentTarget }]
    const lockAbsentStaleOwner = inspection.recoveryKind === 'stale-owner' && !pathExists(join(root, LOCK_BASENAME))
    if (lockAbsentStaleOwner) {
      try {
        const inventory = createOwnerInventoryIndex(inspection.evidence.owner.record.temporaryPaths)
        validateStaleOwnerReplay(root, inspection.evidence.owner, options, inventory)
      } catch (error) {
        failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget, error)
      }
    }
    const restoreState = inspection.recoveryKind === 'abandoned-backup' && request.disposition === 'restore' ? backupRestoreState(root, inspection, options) : null
    const terminalBackup = inspection.recoveryKind === 'abandoned-backup' && !pathExists(artifactPath(root, inspection.recoveryTarget)) && ['accept', 'remove'].includes(request.disposition)
    const terminalMarker = inspection.recoveryKind === 'election-marker' && (request.disposition === 'abandon' && !pathExists(artifactPath(root, MARKER_BASENAME)) || request.disposition !== 'abandon' && markerAlreadyApplied(root, inspection, request.disposition, options))
    if (terminalBackup || terminalMarker || restoreState !== null) {
      const fresh = collectFreshRecoveryProjection(root, request, options, carriedTargets)
      try {
        verifyTerminalRecovery(root, request, inspection, fresh, options)
      } catch (error) {
        failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget, error)
      }

      if (restoreState === 'target-restored-backup-retained') {
        const result = applyBackup(root, inspection, request.disposition, options)

        return recoverySuccess(request, inspection, request.disposition, 'completed', result.changed, result.retained)
      }

      return recoverySuccess(request, inspection, request.disposition, 'already-complete', [], [])
    }
    const freshOptions = options.currentInspection === undefined && options.collectInspection === undefined ? { ...options, currentInspection: { git: inspection.recoveryKind === 'election-marker' ? { kind: 'git', freshScaffold: true } : undefined, targets: carriedTargets } } : options
    const freshRequest = { ...request, operation: 'recover-inspect', recoveryKind: inspection.recoveryKind, recoveryTarget: inspection.recoveryTarget }
    let fresh = null
    if (!(lockAbsentStaleOwner || inspection.recoveryKind === 'stale-recovery-gate')) {
      try {
        fresh = inspectRecovery(freshRequest, freshOptions)
      } catch (error) {
        if (error instanceof InitBacklogError && error.record.code === 'snapshot-drift') failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget, error)

        throw error
      }
    }
    if (fresh !== null && !sameEvidence(fresh, inspection)) failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget)
    const currentEvidence = fresh?.evidence ?? inspection.evidence
    const allowedDispositions = allowedDispositionsFor(inspection.recoveryKind, currentEvidence)
    if (canonicalJson(allowedDispositions) !== canonicalJson(inspection.allowedDispositions)) failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget)
    let changed = []
    let retained = []
    let mutated = false
    if (inspection.recoveryKind === 'orphan-lock-stage') {
      if (removeArtifact(root, inspection.recoveryTarget, inspection.evidence.lockStage, options)) { changed = [inspection.recoveryTarget]; mutated = true }
    } else if (inspection.recoveryKind === 'stale-recovery-gate') {
      const gate = recoveryGatePath(root)
      const expectedGate = inspection.evidence.recoveryGate
      let currentGate
      try {
        currentGate = gateEvidence(root, options)
      } catch (error) {
        failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget, error)
      }
      if (currentGate === null) return recoverySuccess(request, inspection, request.disposition, 'already-complete', [], [])
      const transitionState = recoveryGateTransition(expectedGate, currentGate)
      if (transitionState === null) failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget)
      const recoveryId = expectedGate.record?.recoveryId ?? currentGate.record?.recoveryId
      if (currentGate.ownerStageRawSha256 !== null) { removeArtifact(root, `${RECOVERY_GATE_BASENAME}/${RECOVERY_OWNER_STAGE_BASENAME}`, { mode: currentGate.ownerStageMode, rawSha256: currentGate.ownerStageRawSha256, recoveryId }, options, false); mutated = true }
      if (currentGate.ownerRawSha256 !== null) { removeArtifact(root, `${RECOVERY_GATE_BASENAME}/${RECOVERY_OWNER_BASENAME}`, { mode: currentGate.ownerMode, rawSha256: currentGate.ownerRawSha256, recoveryId }, options, false); mutated = true }
      if (directoryIsEmpty(gate, options)) {
        rmdirSync(gate)
        mutated = true
      }
    } else if (inspection.recoveryKind === 'stale-owner') {
      const owner = inspection.evidence.owner
      const gate = recoveryGatePath(root)
      const lockPresent = existsSync(join(root, LOCK_BASENAME))
      const presentTemporary = owner.temporaryStates.some((item) => item.present && !BACKUP_PATTERN.test(item.target))
      if (!lockPresent && !presentTemporary && existsSync(gate)) {
        const currentGate = gateEvidence(root, options)
        if (currentGate.ownerName === null && currentGate.ownerStageRawSha256 === null) {
          rmdirSync(gate)
          if (existsSync(gate)) throw new Error('Recovery gate remains after empty cleanup')

          return recoverySuccess(request, inspection, request.disposition, 'already-complete', [], owner.retainedBackups)
        }
      }
      let claim
      const inventory = createOwnerInventoryIndex(owner.record.temporaryPaths)
      try {
        claim = claimRecoveryGate(root, inspection, options)
        validateStaleOwnerLock(root, owner, options, inventory)
        validateStaleOwnerReplay(root, owner, options, inventory)
      } catch (error) {
        if (error instanceof InitBacklogError) throw error

        failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget, error)
      }
      for (const item of owner.temporaryStates) if (item.present && !BACKUP_PATTERN.test(item.target) && removeOwnerArtifact(root, item.target, item, { ...options, removeAndVerify: remove }, owner.record, inventory)) mutated = true
      if (existsSync(join(root, LOCK_BASENAME))) { removeArtifact(root, LOCK_BASENAME, { mode: owner.mode, rawSha256: owner.rawSha256 }, options); mutated = true }
      releaseRecoveryGate(claim, options)
      changed = [LOCK_BASENAME, ...owner.temporaryStates.filter((item) => item.present && !BACKUP_PATTERN.test(item.target)).map((item) => item.target)]
      retained = owner.retainedBackups
    } else if (inspection.recoveryKind === 'abandoned-backup') {
      const result = applyBackup(root, inspection, request.disposition, options)
      changed = result.changed
      retained = result.retained
      mutated = true
    } else if (inspection.recoveryKind === 'election-marker') {
      const markerPath = artifactPath(root, MARKER_BASENAME)
      const marker = inspection.evidence.marker
      if (request.disposition === 'abandon') {
        try {
          removeRecoveryFile(root, markerPath, { mode: marker.mode, rawSha256: marker.rawSha256 }, { ...options, unlinkSync: options.unlinkSync ?? unlinkSync })
        } catch (error) {
          if (error?.message === 'Recovery removal evidence changed') failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget, error)

          throw error
        }
        if (pathExists(markerPath)) throw new Error('Election marker remains after cleanup')
        mutated = true
      } else {
        const temporary = artifactPath(root, recoveryTemporaryTarget(MARKER_BASENAME, inspection.recoveryId))
        const state = request.disposition
        const valid = invalidatedMarkerRecord(root, marker, state)
        if (existsSync(temporary)) {
          const validBytes = Buffer.from(`${canonicalJson(valid)}\n`, 'utf8')
          const staged = stableOpenFile(root, temporary, boundedOpenOptions(options, validBytes.length, { requireSingleLink: true }))
          if (!staged.bytes.equals(validBytes) || marker.mode !== null && staged.mode !== marker.mode) throw new Error('Marker recovery temporary changed')
          removeAndVerify(temporary, options)
        }
        try {
          publishRecoveryFile(root, markerPath, Buffer.from(`${canonicalJson(valid)}\n`, 'utf8'), marker.mode, { ...options, expected: { mode: marker.mode, rawSha256: marker.rawSha256 }, recoveryId: inspection.recoveryId, temporary })
        } catch (error) {
          if (error?.message === 'Recovery publication target changed before rename') failure('recover-apply', 'prevalidate', 'snapshot-drift', 'Recovery evidence changed before publication.', inspection.recoveryTarget, error)

          throw error
        }
        mutated = true
      }
      changed = [inspection.recoveryTarget]
    } else {
      failure('recover-apply', 'prevalidate', 'recovery-invalid', 'Recovery kind is invalid.', inspection.recoveryTarget)
    }

    return recoverySuccess(request, inspection, request.disposition, mutated ? 'completed' : 'already-complete', changed, retained)
  } catch (error) {
    if (error instanceof InitBacklogError && ['recovery-invalid', 'runtime-lock'].includes(error.record.code)) throw error
    if (inspection.recoveryKind === 'abandoned-backup' && error?.recoveryCleanupAfterRestore === true) {
      throwRecoveryCleanupFailure(inspection, error)
    }
    if (inspection.recoveryKind === 'abandoned-backup' && (error instanceof InitBacklogError ? !['restore-failed', 'cleanup-failed', 'snapshot-drift'].includes(error.record.code) : true)) {
      const status = request.disposition === 'restore' ? 'restore-failed' : 'cleanup-failed'
      failure('recover-apply', request.disposition === 'restore' ? 'restore' : 'cleanup', status, `${status}: Recovery publication failed.`, inspection.recoveryTarget, error, { recovery: { retainedBackups: [inspection.recoveryTarget], status, warnings: [{ code: 'manual-cleanup', detail: 'Manual cleanup is required for retained recovery residue.', target: inspection.recoveryTarget }] } })
    }
    if (error instanceof InitBacklogError && error.record.code === 'snapshot-drift') throw error

    const cleanupSubject = inspection.recoveryKind === 'stale-owner' || inspection.recoveryKind === 'stale-recovery-gate' || inspection.recoveryKind === 'orphan-lock-stage' || inspection.recoveryKind === 'election-marker' && request.disposition === 'abandon' || inspection.recoveryKind === 'abandoned-backup' && request.disposition !== 'restore'
    if (cleanupSubject) {
      throwRecoveryCleanupFailure(inspection, error)
    }

    failure('recover-apply', 'publish', 'filesystem', 'Recovery publication failed.', inspection.recoveryTarget, error)
  }
}

module.exports = {
  BACKUP_PATTERN,
  LOCK_STAGE_PATTERN,
  RECOVERY_GATE_BASENAME,
  applyRecovery,
  inspectRecovery,
}
