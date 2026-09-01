'use strict'

const { randomBytes } = require('node:crypto')
const { dirname, join, relative } = require('node:path')
const { lstatSync, mkdirSync } = require('node:fs')

const { actionAfter, actionBefore, effectiveActionFileMode, targetMatchesOutput, targetPath } = require('./actions')
const { admitApplyManifest } = require('./apply-manifest')
const { BACKUP_PATTERN, backupStageTarget, backupTarget, retainedBackupPaths } = require('./backups')
const { InitBacklogError, failureRecord, trustedSystemCode } = require('./errors')
const {
  assignAndVerifyMode,
  boundedOpenOptions,
  canonicalRoot,
  createInitialLock,
  initialLockPaths,
  pathExists,
  pathIsContained,
  platformMode,
  publishNoReplace,
  readBackExact,
  removeAndVerify,
  renameVerified,
  stableOpenFile,
  stageFile,
  stableMetadata,
  verifyFinalMode,
  verifyPublishedIdentity,
} = require('./filesystem')
const { acquireReadyCatalog, collectInspection, composeElectionMarker } = require('./inspection')
const { approvedProgress, detectResume, liveHostContext, publishedHostContext, resumeProjectionScope } = require('./resume')
const { BACKUP_DIRECTORY, DIGEST_PATTERN, MAX_INLINE_FILE_BYTES, MAX_MECHANICAL_FILE_BYTES, MAX_RECOVERY_REQUEST_BYTES, NONCE_PATTERN, OPERATION, RECOVERY_GATE_BASENAME, RECOVERY_LOCK_BASENAME: LOCK_BASENAME, RECOVERY_MARKER_BASENAME: ELECTION_BASENAME, canonicalJson, compareOrdinal, electionMarkerTemporaryNames, sha256, validOwnerRecordSchema } = require('./protocol')

const POSIX_DEFAULT_DIRECTORY_MODE = 0o755

function publicationError(detail, fields = {}, cause) {
  throw new InitBacklogError(failureRecord({ code: fields.code ?? 'filesystem', detail, operation: OPERATION.APPLY, phase: fields.phase ?? 'publish', manifestId: fields.manifestId ?? null, actionId: fields.actionId ?? null, target: fields.target ?? null, outcomes: fields.outcomes ?? [], recovery: fields.recovery ?? { retainedBackups: [], status: 'none', warnings: [] }, systemCode: fields.systemCode ?? null }), { cause })
}

function verifyRecoveryGateAbsent(root) {
  const path = join(root, RECOVERY_GATE_BASENAME)
  try {
    lstatSync(path)
    publicationError('Publication is blocked by an existing recovery gate.', { code: 'runtime-lock', phase: 'lock', target: RECOVERY_GATE_BASENAME })
  } catch (error) {
    if (error instanceof InitBacklogError) throw error
    if (error?.code !== 'ENOENT') publicationError('Recovery gate could not be inspected.', { code: 'runtime-lock', phase: 'lock', target: RECOVERY_GATE_BASENAME, systemCode: trustedSystemCode(error) }, error)
  }
}

function throwEnrichedReadyFailure(error, manifestId, outcomes, recovery = error.record.recovery) {
  throw new InitBacklogError(failureRecord({ ...error.record, manifestId, outcomes, recovery }), { cause: error })
}

function relativeArtifact(root, path) {
  return relative(root, path).replaceAll('\\', '/')
}

function recoveryTemporaryTarget(target, recoveryId) {
  const separator = target.includes('/') ? target.slice(0, target.lastIndexOf('/') + 1) : ''

  return `${separator}.nightshift-init-backlog.${recoveryId}.${sha256(Buffer.from(target, 'utf8'))}.tmp`
}

function recoveryTemporaryMatches(target, recoveryId) {
  if (typeof target !== 'string' || typeof recoveryId !== 'string' || !DIGEST_PATTERN.test(recoveryId)) return false
  const basename = target.slice(target.lastIndexOf('/') + 1)
  const prefix = `.nightshift-init-backlog.${recoveryId}.`
  if (!basename.startsWith(prefix) || !basename.endsWith('.tmp')) return false

  const targetHash = basename.slice(prefix.length, -4)

  return DIGEST_PATTERN.test(targetHash)
}

function restoreRepairBatch(root, actions, manifestId, snapshotId, options = {}) {
  for (const action of [...actions].reverse()) {
    const backup = backupTarget(action.target, snapshotId, manifestId)
    const backupPath = targetPath(root, backup)
    const opened = stableOpenFile(root, backupPath, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
    const targetPathValue = targetPath(root, action.target)
    const current = stableOpenFile(root, targetPathValue, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
    const approvedMode = platformMode(options, action.mode)
    publishRecoveryFile(root, targetPathValue, opened.bytes, opened.mode, { ...options, expected: { identity: current.identity, mode: approvedMode, rawSha256: action.afterRawSha256 }, recoveryId: manifestId, temporary: targetPath(root, recoveryTemporaryTarget(action.target, manifestId)) })
  }
}

// Root-level stand-in for callers that want the shape of an action temporary
// without naming a target; any root-level target yields the same directory.
const UNTARGETED_ACTION_TARGET = '.nightshift-init-backlog.untargeted'

// Sole computation of an action's staging temporary. The temporary lives in the
// target's own directory so a nested target stages beside itself rather than at
// the root; targetPath validates root containment before the name is derived.
function actionTemporaryPath(root, manifestId, actionOrdinal, target) {
  return targetPath(root, target) && join(root, target.includes('/') ? target.slice(0, target.lastIndexOf('/')) : '.', `.nightshift-init-backlog.${manifestId}.${actionOrdinal}.tmp`)
}

function temporaryPaths(root, manifestId, actionOrdinal = 1, ownerNonce = randomBytes(16).toString('hex'), snapshotId = '0'.repeat(64), pid = process.pid, actionTarget = UNTARGETED_ACTION_TARGET) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !NONCE_PATTERN.test(ownerNonce) || !DIGEST_PATTERN.test(manifestId) || !DIGEST_PATTERN.test(snapshotId) || !Number.isSafeInteger(actionOrdinal) || actionOrdinal <= 0) {
    throw new TypeError('Temporary identity is invalid')
  }
  const lockPaths = initialLockPaths(root, pid, ownerNonce)
  const markerNames = electionMarkerTemporaryNames(`${ELECTION_BASENAME}.${manifestId}`)
  const electionAlias = join(root, markerNames.alias)

  return {
    action: actionTemporaryPath(root, manifestId, actionOrdinal, actionTarget),
    election: electionAlias,
    electionAlias,
    electionNewWitness: join(root, markerNames.newWitness),
    electionOldWitness: join(root, markerNames.oldWitness),
    electionTombstone: join(root, markerNames.tombstone),
    lock: lockPaths.lock,
    lockNext: join(root, `${LOCK_BASENAME}.${ownerNonce}.next`),
    lockStage: lockPaths.stage,
  }
}

function verifyBackupDirectory(root, options) {
  const directory = targetPath(root, BACKUP_DIRECTORY)
  try {
    const metadata = stableMetadata(directory, { root })
    if (!metadata.metadata.isDirectory() || metadata.metadata.isSymbolicLink()) throw new Error('Backup directory is not an ordinary confined directory')
    if ((options.platform ?? process.platform) !== 'win32' && (metadata.metadata.mode & 0o7777n) !== 0o700n) throw new Error('Backup directory mode is invalid')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    mkdirSync(directory, { mode: 0o700 })
    const created = stableMetadata(directory, { root })
    if (!created.metadata.isDirectory() || created.metadata.isSymbolicLink() || (options.platform ?? process.platform) !== 'win32' && (created.metadata.mode & 0o7777n) !== 0o700n) throw new Error('Backup directory creation is invalid')

    return true
  }

  return false
}

function readRecordBytes(record) {
  if (record?.contentBase64 === null || record?.contentBase64 === undefined) return null

  return Buffer.from(record.contentBase64, 'base64')
}

function inspectionRecordByteLimit(record) {
  return record.contentRole === 'mechanical' ? MAX_MECHANICAL_FILE_BYTES : MAX_INLINE_FILE_BYTES
}

function initialStates(inspection, root, options) {
  return new Map((inspection.targets ?? []).map((record) => {
    const content = readRecordBytes(record)
    const present = !(record.states ?? []).includes('missing')
    const identity = record.kind === 'file' && present ? (() => {
      try { return stableOpenFile(root, targetPath(root, record.target), boundedOpenOptions(options, inspectionRecordByteLimit(record))).identity } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
    })() : null

    return [record.target, { content, identity, kind: record.kind, mode: record.mode, present }]
  }))
}

function hydrateRepairStates(request, actions, states, root, options, backupTargets, existing, resume) {
  const existingInventory = new Set(existing?.record.temporaryPaths ?? [])
  for (const [index, action] of actions.entries()) {
    const state = states.get(action.target)
    if (state?.present !== true) throw new Error('Repair backup source is unavailable')
    try {
      state.content = actionBefore(request, action, root, options)
    } catch (error) {
      const backupTargetValue = backupTargets[index]
      if (resume !== true || !['Mechanical repair input changed before publication', 'Mechanical unwrap input changed before publication'].includes(error?.message) || !existingInventory.has(backupTargetValue)) throw error
      const opened = stableOpenFile(root, targetPath(root, backupTargetValue), boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
      if (opened.rawSha256 !== action.beforeRawSha256 || state.mode !== null && opened.mode !== state.mode) throw new Error('Owned repair backup changed before resume')
      state.content = opened.bytes
    }
    states.set(action.target, state)
  }
}

function stableTarget(root, path, expected, options) {
  if (!expected.present) {
    try {
      lstatSync(path)
    } catch (error) {
      if (error?.code === 'ENOENT') return { present: false }
      throw error
    }
    throw new Error('Expected target is unexpectedly present')
  }
  if (expected.kind === 'directory') {
    const metadata = lstatSync(path, { bigint: true })
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Target directory identity changed')
    verifyFinalMode(path, expected.mode, options)

    return { present: true, kind: 'directory', mode: expected.mode }
  }
  const opened = stableOpenFile(root, path, boundedOpenOptions(options, expected.content?.length ?? MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
  if (expected.content !== null && !opened.bytes.equals(expected.content)) throw new Error('Target bytes changed before publication')
  if (expected.mode !== null && opened.mode !== expected.mode) throw new Error('Target mode changed before publication')
  if (expected.identity !== null && opened.identity !== expected.identity) throw new Error('Target identity changed before publication')

  return { bytes: opened.bytes, kind: 'file', mode: opened.mode, present: true }
}

function transition(options, point) {
  if (options.failAt === point) {
    throw new Error(`Injected publication failure at ${point}`)
  }
  options.onTransition?.(point)
}

function notifyWrite(options, path) {
  options.writeSpy?.(path)
}

function registerTemporary(root, ownedTemporaries, path, bytes, options, requireSingleLink = true, mode = null) {
  const opened = stableOpenFile(root, path, boundedOpenOptions(options, bytes.length, { requireSingleLink }))
  if (!opened.bytes.equals(bytes)) throw new Error('Staged temporary bytes changed')
  if (mode !== null && opened.mode !== mode) throw new Error('Staged temporary mode changed')
  ownedTemporaries.set(path, { bytes: Buffer.from(bytes), destination: null, identity: opened.identity, mode, requireSingleLink })
}

function verifyOwnedTemporary(root, path, owned, options, requireSingleLink = owned.requireSingleLink) {
  const current = stableOpenFile(root, path, boundedOpenOptions(options, owned.bytes.length, { requireSingleLink }))
  if (current.identity !== owned.identity || !current.bytes.equals(owned.bytes) || owned.mode !== null && current.mode !== owned.mode) throw new Error('Reserved temporary changed before publication')
  if (owned.linkCount !== undefined) {
    const metadata = lstatSync(path, { bigint: true })
    if (metadata.nlink !== BigInt(owned.linkCount)) throw new Error('Reserved temporary link count changed')
    for (const peer of owned.peers ?? []) {
      const peerFile = stableOpenFile(root, peer, boundedOpenOptions(options, owned.bytes.length, { requireSingleLink: false }))
      if (peerFile.identity !== owned.identity || !peerFile.bytes.equals(owned.bytes) || owned.mode !== null && peerFile.mode !== owned.mode) throw new Error('Reserved temporary link identity changed')
    }
  }

  return current
}

function removeOwnedTemporary(root, path, options, destination = null) {
  const owned = options.ownedTemporaries?.get(path)
  if (owned === undefined) throw new Error('Reserved temporary ownership is not proven')
  options.verifyLock?.()
  verifyOwnedTemporary(root, path, owned, options, destination === null ? owned.requireSingleLink : false)
  if (destination !== null) {
    const ownedWithDestination = { ...owned, destination }
    verifyOwnedPublishedLink(root, path, ownedWithDestination, options)
  }
  removeAndVerify(path, options)
  options.onTemporaryRemoved?.(path)
}

function verifyOwnedPublishedLink(root, path, owned, options) {
  if (owned.destination === null) return
  const temporaryMetadata = lstatSync(path, { bigint: true })
  const destinationMetadata = lstatSync(owned.destination, { bigint: true })
  const destination = stableOpenFile(root, owned.destination, boundedOpenOptions(options, owned.bytes.length, { requireSingleLink: false }))
  if (temporaryMetadata.nlink !== 2n || destinationMetadata.nlink !== 2n || destination.identity !== owned.identity || !destination.bytes.equals(owned.bytes) || owned.mode !== null && destination.mode !== owned.mode) throw new Error('Published target shares an unexpected temporary identity')
}

function publishContent(root, path, bytes, mode, temp, options, replace, expected) {
  options.verifyLock?.()
  notifyWrite(options, path)
  const fileOptions = { ...options, onTransition: (point) => transition(options, point) }
  const adopted = options.ownedTemporaries?.get(temp)
  if (adopted === undefined) {
    stageFile(temp, bytes, { ...fileOptions, root })
    readBackExact(temp, bytes, fileOptions)
    assignAndVerifyMode(temp, mode, fileOptions)
    verifyFinalMode(temp, mode, fileOptions)
    options.onTemporaryStaged?.(temp, bytes, mode)
  } else {
    verifyOwnedTemporary(root, temp, adopted, options)
  }
  transition(options, 'after-mode-assignment')
  const staged = options.ownedTemporaries?.get(temp)
  if (staged === undefined) throw new Error('Reserved temporary ownership is not proven')
  options.verifyLock?.()
  verifyOwnedTemporary(root, temp, staged, options)
  const { content: expectedContent, identity: expectedIdentity = null, mode: expectedMode } = expected
  stableTarget(root, path, { content: replace ? expectedContent : null, identity: replace ? expectedIdentity : null, kind: 'file', mode: replace ? expectedMode : null, present: replace }, options)
  options.verifyLock?.()
  if (replace) {
    renameVerified(temp, path, bytes, fileOptions)
  } else {
    publishNoReplace(temp, path, fileOptions)
    verifyPublishedIdentity(root, temp, path, bytes)
  }
  try {
    lstatSync(temp)
    removeOwnedTemporary(root, temp, { ...fileOptions, ownedTemporaries: options.ownedTemporaries, onTemporaryRemoved: options.onTemporaryRemoved }, replace ? null : path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    options.onTemporaryRemoved?.(temp)
  }
  const final = stableOpenFile(root, path, boundedOpenOptions(options, bytes.length, { requireSingleLink: true }))
  if (!final.bytes.equals(bytes) || (mode !== null && final.mode !== mode)) throw new Error('Published target verification failed')
  transition(options, 'after-final-verification')
  transition(options, 'after-temporary-cleanup')

  return { final }
}

function targetMatchesPublishedTemporary(root, path, bytes, mode, temporary, options) {
  const owned = options.ownedTemporaries?.get(temporary)
  if (owned?.destination !== path) return false
  verifyOwnedTemporary(root, temporary, owned, options, false)
  const metadata = lstatSync(path, { bigint: true })
  const destination = stableOpenFile(root, path, boundedOpenOptions(options, bytes.length, { requireSingleLink: false }))
  if (metadata.nlink !== 2n || destination.identity !== owned.identity || !destination.bytes.equals(bytes) || mode !== null && destination.mode !== mode) throw new Error('Published target shares an unexpected temporary identity')

  return true
}

function publishDirectory(root, path, mode, options) {
  options.verifyLock?.()
  notifyWrite(options, path)
  mkdirSync(path, { mode: mode ?? POSIX_DEFAULT_DIRECTORY_MODE })
  transition(options, 'after-directory-create')
  if (mode !== null) {
    options.verifyLock?.()
    assignAndVerifyMode(path, mode, options)
  }
  transition(options, 'after-directory-mode')
  verifyFinalMode(path, mode, options)
  transition(options, 'after-directory-verify')
}

function publishRecoveryFile(root, path, bytes, mode, options = {}) {
  const target = relativeArtifact(root, path)
  const temporary = options.temporary ?? targetPath(root, recoveryTemporaryTarget(target, options.recoveryId ?? '0'.repeat(64)))
  const expected = options.expected ?? null
  if (dirname(temporary) !== dirname(path)) throw new Error('Recovery temporary must be in the target directory')
  stageFile(temporary, bytes, { ...options, root })
  readBackExact(temporary, bytes, options)
  assignAndVerifyMode(temporary, mode, options)
  verifyFinalMode(temporary, mode, options)
  options.onTemporaryStaged?.(temporary, bytes, mode)
  if (expected === null) {
    options.verifyLock?.()
    options.writeSpy?.(path)
    publishNoReplace(temporary, path, options)
    verifyPublishedIdentity(root, temporary, path, bytes)
  } else {
    options.onBeforeRename?.(path)
    const current = stableOpenFile(root, path, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
    if (expected.identity !== undefined && current.identity !== expected.identity || expected.rawSha256 !== undefined && current.rawSha256 !== expected.rawSha256 || expected.mode !== undefined && expected.mode !== null && current.mode !== expected.mode) throw new Error('Recovery publication target changed before rename')
    options.verifyLock?.()
    renameVerified(temporary, path, bytes, options)
  }
  const final = stableOpenFile(root, path, boundedOpenOptions(options, bytes.length, { requireSingleLink: expected === null ? false : true }))
  if (!final.bytes.equals(bytes) || mode !== null && final.mode !== mode) throw new Error('Recovery publication verification failed')
  if (expected === null) {
    removeAndVerify(temporary, options)
  }

  return final
}

function removeRecoveryFile(root, path, expected, options = {}) {
  const current = stableOpenFile(root, path, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
  if (expected !== undefined && (current.rawSha256 !== expected.rawSha256 || expected.mode !== null && current.mode !== expected.mode || expected.identity !== undefined && current.identity !== expected.identity)) throw new Error('Recovery removal evidence changed')
  options.onBeforeRemove?.(path)
  const rebound = stableOpenFile(root, path, boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
  if (expected !== undefined && (rebound.rawSha256 !== expected.rawSha256 || expected.mode !== null && rebound.mode !== expected.mode || expected.identity !== undefined && rebound.identity !== expected.identity)) throw new Error('Recovery removal evidence changed')
  options.verifyLock?.()
  const remove = options.removeAndVerify ?? removeAndVerify
  remove(path, options)
}

function completePostInspect(postInspect, admission, request) {
  const incomplete = new Set()
  for (const record of postInspect.targets ?? []) {
    if ((record.states ?? []).includes('missing') || (record.states ?? []).includes('mixed-line-endings') || (record.states ?? []).includes('wrapped') || (record.states ?? []).includes('structurally-invalid')) incomplete.add(record.target)
  }
  for (const decision of request.semanticDecisions ?? []) {
    if (decision.status === 'deferred') incomplete.add(decision.target)
  }
  for (const problem of postInspect.problems ?? []) {
    if (problem.blocking === true) {
      if (problem.target !== null && problem.target !== undefined) incomplete.add(problem.target)
      for (const evidence of problem.evidencePaths ?? []) incomplete.add(evidence)
    }
  }
  const expectedReady = request.inspection?.unwrapReady?.after
  if (expectedReady !== undefined && canonicalJson(postInspect.ready ?? null) !== canonicalJson(expectedReady)) {
    for (const action of request.actions ?? []) {
      if (action.kind === 'unwrap-file') incomplete.add(action.target)
    }
  }
  const git = postInspect.git ?? request.inspection.git
  if (git?.kind === 'git') {
    if (request.versionControlChoice === 'deferred' && git.electionRequired === true) incomplete.add('.gitignore')
    if (git.plansPolicy !== 'satisfied' && git.plansPolicy !== 'not-applicable') incomplete.add('.gitignore')
    if (request.versionControlChoice === 'track') {
      for (const match of git.nonPlanIgnoreMatches ?? []) {
        incomplete.add(match.target)
        incomplete.add('.gitignore')
      }
    }
    if (request.versionControlChoice === 'ignore') {
      for (const path of git.nonPlanUnignoredPaths ?? []) incomplete.add(path)
      for (const path of git.trackedBacklogPaths ?? []) incomplete.add(path)
    }
    for (const path of git.trackedPlanPaths ?? []) incomplete.add(path)
  }

  return [...incomplete].sort(compareOrdinal)
}

function resultRecord(request, admission, postInspect, outcomes, warnings = [], retainedBackups = []) {
  const incompleteTargets = completePostInspect(postInspect, admission, request)
  const effectiveWarnings = [...(postInspect.warnings ?? []), ...warnings].filter((warning, index, all) => all.findIndex((candidate) => candidate.code === warning.code) === index)
  if (!effectiveWarnings.some((warning) => warning.code === 'external-writer-window')) effectiveWarnings.push({ code: 'external-writer-window', detail: 'Controlled targets may change during publication.', target: null })
  effectiveWarnings.sort((left, right) => compareOrdinal(left.code, right.code))

  return {
    complete: incompleteTargets.length === 0,
    host: request.host,
    hostContext: request.hostContext,
    incompleteTargets,
    manifestId: admission.manifestId,
    ok: true,
    operation: OPERATION.APPLY,
    outcomes,
    postInspect,
    protocolVersion: 1,
    retainedBackups,
    root: request.root,
    snapshotId: request.inspection.snapshotId,
    versionControlChoice: request.versionControlChoice,
    warnings: effectiveWarnings,
  }
}

function lockRecord(request, root, pid, ownerNonce, manifestId, temporaryPathsValue, unfinalizedDirectories) {
  return { createdAtUnixMs: Date.now(), manifestId, operation: OPERATION.APPLY, ownerNonce, pid, protocolVersion: 1, recoveryId: null, root, temporaryPaths: temporaryPathsValue.map((path) => relativeArtifact(root, path)).sort(compareOrdinal), unfinalizedDirectories: unfinalizedDirectories.sort((left, right) => compareOrdinal(left.target, right.target)) }
}

function requireReservedTemporariesAbsent(root, temporarySet, authorized = new Set()) {
  for (const path of temporarySet) {
    if (authorized.has(path)) continue
    try {
      lstatSync(path)
      publicationError('A reserved publication temporary already exists.', { code: 'runtime-lock', phase: 'lock', target: relativeArtifact(root, path) })
    } catch (error) {
      if (error instanceof InitBacklogError) throw error
      if (error?.code !== 'ENOENT') publicationError('A reserved publication temporary could not be inspected.', { code: 'runtime-lock', phase: 'lock', target: relativeArtifact(root, path), systemCode: trustedSystemCode(error) }, error)
    }
  }
}

function verifyLockState(root, lock, options) {
  if (lock === null) return
  if (options.skipRecoveryGateCheck !== true) verifyRecoveryGateAbsent(root)
  const current = stableOpenFile(root, lock.paths.lock, boundedOpenOptions(options, lock.bytes?.length ?? MAX_RECOVERY_REQUEST_BYTES, { requireSingleLink: true }))
  if (lock.bytes !== undefined && !current.bytes.equals(lock.bytes) || lock.identity !== undefined && current.identity !== lock.identity || (options.platform ?? process.platform) !== 'win32' && lock.mode !== undefined && current.mode !== lock.mode) throw new Error('Publication lock changed before effect')
}

function cleanupOwner(root, lock, options, ownedTemporaries = new Map()) {
  if (lock === null) return
  try {
    for (const directory of lock.record?.unfinalizedDirectories ?? []) {
      const directoryPath = targetPath(root, directory.target)
      try {
        const metadata = lstatSync(directoryPath, { bigint: true })
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Unfinalized directory kind changed')
        verifyFinalMode(directoryPath, directory.mode, options)
      } catch (error) {
        if (error?.code === 'ENOENT') continue
        throw error
      }
    }
    for (const temporary of lock.record?.temporaryPaths ?? []) {
      if (BACKUP_PATTERN.test(temporary)) {
        continue
      }
      verifyLockState(root, lock, { ...options, skipRecoveryGateCheck: true })
      const temporaryPath = targetPath(root, temporary)
      let present = false
      try {
        lstatSync(temporaryPath)
        present = true
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (!present) continue
      const owned = ownedTemporaries.get(temporaryPath)
      if (owned === undefined) {
        throw new Error('Reserved temporary ownership is not proven')
      }
      verifyOwnedTemporary(root, temporaryPath, owned, options, owned.requireSingleLink)
      verifyOwnedPublishedLink(root, temporaryPath, owned, options)
      removeAndVerify(temporaryPath, options)
      ownedTemporaries.delete(temporaryPath)
    }
    verifyLockState(root, lock, { ...options, skipRecoveryGateCheck: true })
    removeAndVerify(lock.paths.lock, options)
  } catch (error) {
    const retained = retainedBackupPaths(root, lock.record?.temporaryPaths ?? [])
    publicationError('Publication lock cleanup failed.', { code: 'cleanup-failed', phase: 'cleanup', manifestId: lock.manifestId, recovery: { retainedBackups: retained, status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Publication lock requires manual cleanup.', target: relativeArtifact(root, lock.paths.lock) }] } }, error)
  }
}

function markerBytes(request, admission, root) {
  const snapshotId = request.inspection.snapshotId ?? sha256(Buffer.from(canonicalJson(request.inspection.git ?? {}), 'utf8'))
  const marker = composeElectionMarker(admission.electionMarker.state, request.inspection.git?.kind ?? 'git', true, snapshotId, request.inspection.git?.electionMarkerMode ?? 0o600, root)

  return Buffer.from(marker.contentBase64, 'base64')
}

function markerOwnership(root, path, bytes, mode, options, linkCount, peers = []) {
  const openOptions = boundedOpenOptions(options, bytes.length, { requireSingleLink: false })
  const opened = stableOpenFile(root, path, openOptions)
  const metadata = lstatSync(path, { bigint: true })
  if (!opened.bytes.equals(bytes) || mode !== null && opened.mode !== mode || metadata.nlink !== BigInt(linkCount)) throw new Error('Election marker temporary differs from its approved image')
  for (const peer of peers) {
    const peerOpened = stableOpenFile(root, peer, openOptions)
    if (peerOpened.identity !== opened.identity || !peerOpened.bytes.equals(bytes) || mode !== null && peerOpened.mode !== mode) throw new Error('Election marker temporary identity differs from its approved image')
  }
  options.ownedTemporaries?.set(path, { bytes: Buffer.from(bytes), destination: null, identity: opened.identity, linkCount, mode, peers, requireSingleLink: false })

  return opened
}

function markerLinkState(root, first, second, bytes, mode, options) {
  const firstPath = first
  const secondPath = second
  markerOwnership(root, firstPath, bytes, mode, options, 2, [secondPath])
  markerOwnership(root, secondPath, bytes, mode, options, 2, [firstPath])
}

function stageMarkerAlias(root, path, bytes, mode, options) {
  options.verifyLock?.()
  stageFile(path, bytes, { ...options, root, onTransition: (point) => transition(options, point) })
  readBackExact(path, bytes, options)
  assignAndVerifyMode(path, mode, options)
  verifyFinalMode(path, mode, options)
  markerOwnership(root, path, bytes, mode, options, 1)
  transition(options, 'after-mode-assignment')
}

function linkMarkerPath(root, source, destination, bytes, mode, options, point) {
  options.verifyLock?.()
  publishNoReplace(source, destination, { ...options, onPublished: undefined })
  markerOwnership(root, source, bytes, mode, options, 2, [destination])
  markerOwnership(root, destination, bytes, mode, options, 2, [source])
  transition(options, point)
}

function markerOldBytes(request, root) {
  const carriedGit = request.inspection.git ?? {}
  if (carriedGit.electionMarker === undefined || carriedGit.electionMarker === 'absent') return null
  const carriedSnapshotId = carriedGit.electionMarkerSnapshotId ?? request.inspection.snapshotId
  const carried = composeElectionMarker(carriedGit.electionMarker, carriedGit.kind ?? 'git', true, carriedSnapshotId, carriedGit.electionMarkerMode, root)

  return Buffer.from(carried.contentBase64, 'base64')
}

function adoptMarkerTemporaries(root, existing, paths, finalBytes, finalMode, oldBytes, oldMode, options) {
  if (existing === null) return
  const markerByteLimit = Math.max(finalBytes.length, oldBytes?.length ?? 0)
  const read = (path) => {
    try { return stableOpenFile(root, path, boundedOpenOptions(options, markerByteLimit, { requireSingleLink: false })) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
  }
  const alias = read(paths.electionAlias)
  const oldWitness = read(paths.electionOldWitness)
  const newWitness = read(paths.electionNewWitness)
  const tombstone = read(paths.electionTombstone)
  const markerPath = join(root, ELECTION_BASENAME)
  const marker = read(markerPath)
  if (oldWitness !== null) {
    if (oldBytes === null) throw new Error('Unexpected old election marker witness')
    markerOwnership(root, paths.electionOldWitness, oldBytes, oldMode, options, oldWitness.identity === marker?.identity ? 2 : 1, oldWitness.identity === marker?.identity ? [markerPath] : [])
  }
  if (tombstone !== null) {
    if (marker !== null || alias !== null || !tombstone.bytes.equals(finalBytes) || finalMode !== null && tombstone.mode !== finalMode) throw new Error('Election marker tombstone state is invalid')
    if (newWitness !== null) {
      if (tombstone.identity !== newWitness.identity) throw new Error('Election marker witness identity differs from tombstone')
      markerLinkState(root, paths.electionTombstone, paths.electionNewWitness, finalBytes, finalMode, options)
    } else {
      markerOwnership(root, paths.electionTombstone, finalBytes, finalMode, options, 1)
    }

    return
  }
  if (marker !== null && marker.bytes.equals(finalBytes) && (finalMode === null || marker.mode === finalMode) && newWitness !== null && marker.identity === newWitness.identity) {
    if (alias !== null) {
      if (alias.identity !== marker.identity || alias.bytes.length !== finalBytes.length) throw new Error('Election marker alias state is invalid')
      markerOwnership(root, paths.electionAlias, finalBytes, finalMode, options, 3, [paths.electionNewWitness, markerPath])
      markerOwnership(root, paths.electionNewWitness, finalBytes, finalMode, options, 3, [paths.electionAlias, markerPath])
    } else {
      markerLinkState(root, paths.electionNewWitness, markerPath, finalBytes, finalMode, options)
    }

    return
  }
  if (marker !== null && marker.bytes.equals(finalBytes) && (finalMode === null || marker.mode === finalMode) && newWitness !== null && marker.identity !== newWitness.identity) throw new Error(oldBytes === null ? 'Published target shares an unexpected temporary identity' : 'Election marker changed before cleanup')
  if (marker !== null && oldBytes !== null && marker.bytes.equals(oldBytes) && oldMode !== null && marker.mode !== oldMode) throw new Error('Election marker changed before cleanup')
  if (marker !== null && oldBytes !== null && marker.bytes.equals(oldBytes) && oldWitness === null && alias === null && newWitness === null) return
  if (marker !== null && oldBytes !== null && marker.bytes.equals(oldBytes) && oldWitness !== null && marker.identity === oldWitness.identity && alias === null && newWitness === null) return
  if (marker !== null && oldBytes !== null && marker.bytes.equals(oldBytes) && oldWitness !== null && marker.identity === oldWitness.identity && alias !== null && newWitness === null && alias.bytes.equals(finalBytes)) {
    markerOwnership(root, paths.electionAlias, finalBytes, finalMode, options, 1)

    return
  }
  if (marker !== null && oldBytes !== null && marker.bytes.equals(oldBytes) && oldWitness !== null && marker.identity === oldWitness.identity && alias !== null && newWitness !== null && alias.identity === newWitness.identity && alias.bytes.equals(finalBytes) && newWitness.bytes.equals(finalBytes)) {
    markerLinkState(root, paths.electionAlias, paths.electionNewWitness, finalBytes, finalMode, options)

    return
  }
  if (alias !== null && newWitness !== null && alias.identity === newWitness.identity && alias.bytes.equals(finalBytes) && newWitness.bytes.equals(finalBytes)) {
    markerLinkState(root, paths.electionAlias, paths.electionNewWitness, finalBytes, finalMode, options)

    return
  }
  if (alias !== null && marker === null && newWitness === null) {
    markerOwnership(root, paths.electionAlias, finalBytes, finalMode, options, 1)

    return
  }
  if (marker === null && alias === null && newWitness === null && oldWitness === null) return
  throw new Error('Election marker temporary state is invalid')
}

function adoptBootstrapStage(root, path, existingRecord, options, ownedTemporaries) {
  const opened = stableOpenFile(root, path, boundedOpenOptions(options, MAX_RECOVERY_REQUEST_BYTES, { requireSingleLink: true }))
  let record
  try { record = JSON.parse(opened.bytes.toString('utf8')) } catch (error) { throw new Error('Bootstrap stage record is invalid', { cause: error }) }
  const next = join(root, `${LOCK_BASENAME}.${existingRecord.ownerNonce}.next`)
  const expectedPaths = [relativeArtifact(root, path), relativeArtifact(root, next)].sort(compareOrdinal)
  if (!validOwnerRecordSchema(record) || record.manifestId !== null || record.operation !== OPERATION.APPLY || record.ownerNonce !== existingRecord.ownerNonce || record.pid !== existingRecord.pid || record.root !== root || canonicalJson(record.temporaryPaths) !== canonicalJson(expectedPaths) || record.unfinalizedDirectories.length !== 0 || !Buffer.from(`${canonicalJson(record)}\n`, 'utf8').equals(opened.bytes) || (options.platform ?? process.platform) !== 'win32' && opened.mode !== 0o600) throw new Error('Bootstrap stage record is invalid')
  ownedTemporaries.set(path, { bytes: Buffer.from(opened.bytes), destination: null, identity: opened.identity, mode: platformMode(options, 0o600), requireSingleLink: true })
}

function adoptPendingLockUpgrade(root, existing, expectedRecord, path, options, ownedTemporaries) {
  if (existing === null || existing.record.manifestId !== null) return { bytes: Buffer.from(`${canonicalJson(expectedRecord)}\n`, 'utf8'), record: expectedRecord }
  try {
    const opened = stableOpenFile(root, path, boundedOpenOptions(options, MAX_RECOVERY_REQUEST_BYTES, { requireSingleLink: true }))
    const record = JSON.parse(opened.bytes.toString('utf8'))
    const expected = { ...expectedRecord, createdAtUnixMs: record?.createdAtUnixMs }
    if (record === null || typeof record !== 'object' || Array.isArray(record) || !Number.isSafeInteger(record.createdAtUnixMs) || record.createdAtUnixMs < 0 || canonicalJson(record) !== canonicalJson(expected) || (options.platform ?? process.platform) !== 'win32' && opened.mode !== 0o600) throw new Error('Pending lock upgrade differs from the approved manifest')
    ownedTemporaries.set(path, { bytes: Buffer.from(opened.bytes), destination: null, identity: opened.identity, mode: platformMode(options, 0o600), requireSingleLink: true })

    return { bytes: opened.bytes, record }
  } catch (error) {
    if (error?.code === 'ENOENT') return { bytes: Buffer.from(`${canonicalJson(expectedRecord)}\n`, 'utf8'), record: expectedRecord }
    throw error
  }
}

function adoptResumeTemporaries(root, existing, expectedTemporaries, options, ownedTemporaries, bootstrapStage, upgradedLockNext) {
  if (existing === null) return
  if (existing.record.manifestId !== null) {
    try {
      lstatSync(upgradedLockNext)
      throw new Error('Publication lock upgrade temporary remains after upgrade')
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
  for (const relativePath of existing.record.temporaryPaths) {
    const path = targetPath(root, relativePath)
    if (path === bootstrapStage) {
      if (existing.record.manifestId !== null) {
        try { lstatSync(path); adoptBootstrapStage(root, path, existing.record, options, ownedTemporaries) } catch (error) { if (error?.code !== 'ENOENT') throw error }
      }
      continue
    }
    const expected = expectedTemporaries.get(path)
    if (expected === undefined) throw new Error('Publication lock temporary inventory is not recognized')
    if (expected.marker === true) continue
      if (expected.bytes === null) {
      try { lstatSync(path) } catch (error) { if (error?.code === 'ENOENT') continue; throw error }
      throw new Error('Non-publication action temporary is present')
      }
      try {
        let opened
        let requireSingleLink = true
        const openOptions = boundedOpenOptions(options, expected.bytes.length)
        try {
          opened = stableOpenFile(root, path, { ...openOptions, requireSingleLink: true })
        } catch (error) {
          const metadata = lstatSync(path, { bigint: true })
          if (metadata.nlink !== 2n) throw error
          if (expected.destination === null) {
            const stagedPeer = [...expectedTemporaries.entries()].find(([candidate, value]) => value.destination === path && candidate !== path)
            if (stagedPeer === undefined) throw error
            const peer = stableOpenFile(root, stagedPeer[0], { ...openOptions, requireSingleLink: false })
            const final = stableOpenFile(root, path, { ...openOptions, requireSingleLink: false })
            if (peer.identity !== final.identity || !peer.bytes.equals(expected.bytes) || !final.bytes.equals(expected.bytes) || expected.mode !== null && final.mode !== expected.mode) throw error
            removeAndVerify(stagedPeer[0], options)
            opened = final
          } else {
            opened = stableOpenFile(root, path, { ...openOptions, requireSingleLink: false })
            const destination = stableOpenFile(root, expected.destination, { ...openOptions, requireSingleLink: false })
            if (destination.identity !== opened.identity || !destination.bytes.equals(expected.bytes) || expected.mode !== null && destination.mode !== expected.mode) throw error
            requireSingleLink = false
          }
        }
        if (expected.destination !== null && opened.bytes.length === 0) {
          removeAndVerify(path, options)
          continue
        }
        if (!opened.bytes.equals(expected.bytes) || expected.mode !== null && opened.mode !== expected.mode) throw new Error('Resumed temporary differs from its approved image')
      ownedTemporaries.set(path, { bytes: Buffer.from(expected.bytes), destination: requireSingleLink ? null : expected.destination, identity: opened.identity, mode: expected.mode, requireSingleLink })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

function publishMarker(request, admission, root, manifestId, ownerMode, options, paths) {
  if (admission.electionMarker.state === 'absent') return
  const path = join(root, ELECTION_BASENAME)
  const bytes = markerBytes(request, admission, root)
  options.verifyLock?.()
  notifyWrite(options, path)
  const carriedGit = request.inspection.git ?? {}
  const oldBytes = markerOldBytes(request, root)
  const markerByteLimit = Math.max(bytes.length, oldBytes?.length ?? 0)
  const oldMode = platformMode(options, carriedGit.electionMarkerMode ?? 0o600)
  let mode = platformMode(options, ownerMode)
  const markerPresent = pathExists(path)
  const tombstonePresent = pathExists(paths.electionTombstone)
  if (tombstonePresent && !markerPresent && !pathExists(paths.electionAlias)) return false
  if (markerPresent) {
    const current = stableOpenFile(root, path, boundedOpenOptions(options, markerByteLimit, { requireSingleLink: false }))
    if (current.bytes.equals(bytes) && (mode === null || current.mode === mode)) {
      if (pathExists(paths.electionNewWitness)) {
        if (pathExists(paths.electionAlias)) {
          removeOwnedTemporary(root, paths.electionAlias, options)
          markerOwnership(root, paths.electionNewWitness, bytes, mode, options, 2, [path])
        }

        return false
      }
      throw new Error('Election marker witness is missing')
    }
    if (oldBytes === null || !current.bytes.equals(oldBytes) || oldMode !== null && current.mode !== oldMode) throw new Error('Election marker differs from the approved carried marker')
    mode = oldMode
    const oldWitness = options.ownedTemporaries?.get(paths.electionOldWitness)
    if (oldWitness === undefined) {
      linkMarkerPath(root, path, paths.electionOldWitness, oldBytes, oldMode, options, 'after-marker-old-witness')
    }
  }
  if (!pathExists(paths.electionAlias)) stageMarkerAlias(root, paths.electionAlias, bytes, mode, options)
  if (!pathExists(paths.electionNewWitness)) linkMarkerPath(root, paths.electionAlias, paths.electionNewWitness, bytes, mode, options, 'after-marker-new-witness')
  if (pathExists(path)) {
    const current = stableOpenFile(root, path, boundedOpenOptions(options, markerByteLimit, { requireSingleLink: false }))
    if (oldBytes === null || !current.bytes.equals(oldBytes) || oldMode !== null && current.mode !== oldMode) throw new Error('Election marker differs from the approved carried marker')
    const replacementTarget = stableOpenFile(root, path, boundedOpenOptions(options, markerByteLimit, { requireSingleLink: false }))
    if (!replacementTarget.bytes.equals(oldBytes) || replacementTarget.identity !== current.identity || oldMode !== null && replacementTarget.mode !== oldMode) throw new Error('Election marker changed before replacement')
    options.verifyLock?.()
    renameVerified(paths.electionAlias, path, bytes, { ...options, onTransition: (point) => transition(options, point) })
    markerOwnership(root, paths.electionNewWitness, bytes, mode, options, 2, [path])
    markerOwnership(root, paths.electionOldWitness, oldBytes, oldMode, options, 1)
    transition(options, 'after-marker-replacement')
  } else {
    options.verifyLock?.()
    publishNoReplace(paths.electionAlias, path, { ...options, onPublished: undefined })
    markerOwnership(root, paths.electionAlias, bytes, mode, options, 3, [paths.electionNewWitness, path])
    markerOwnership(root, paths.electionNewWitness, bytes, mode, options, 3, [paths.electionAlias, path])
    transition(options, 'after-marker-publication')
    removeOwnedTemporary(root, paths.electionAlias, options)
    markerOwnership(root, paths.electionNewWitness, bytes, mode, options, 2, [path])
    transition(options, 'after-marker-alias-removal')
    options.onPublished?.(path)
  }
  if (options.ownedTemporaries?.has(paths.electionOldWitness)) removeOwnedTemporary(root, paths.electionOldWitness, options)
  transition(options, 'after-final-verification')
  transition(options, 'after-temporary-cleanup')

  return true
}

function removeMarker(request, admission, root, options, paths) {
  const path = join(root, ELECTION_BASENAME)
  const expected = markerBytes(request, admission, root)
  const mode = platformMode(options, request.inspection.git?.electionMarkerMode ?? 0o600)
  options.verifyLock?.()
  if (pathExists(path)) {
    const current = stableOpenFile(root, path, boundedOpenOptions(options, expected.length, { requireSingleLink: false }))
    if (!current.bytes.equals(expected) || mode !== null && current.mode !== mode) throw new Error('Election marker changed before cleanup')
    const witness = options.ownedTemporaries?.get(paths.electionNewWitness)
    if (witness !== undefined && witness.identity !== current.identity) throw new Error(request.inspection.git?.electionMarker === 'absent' ? 'Published target shares an unexpected temporary identity' : 'Election marker changed before cleanup')
    if (pathExists(paths.electionTombstone)) throw new Error('Election marker tombstone state is invalid')
    options.verifyLock?.()
    renameVerified(path, paths.electionTombstone, expected, { ...options, onTransition: (point) => transition(options, point) })
    markerOwnership(root, paths.electionTombstone, expected, mode, options, pathExists(paths.electionNewWitness) ? 2 : 1, pathExists(paths.electionNewWitness) ? [paths.electionNewWitness] : [])
    if (pathExists(paths.electionNewWitness)) markerOwnership(root, paths.electionNewWitness, expected, mode, options, 2, [paths.electionTombstone])
    transition(options, 'after-marker-unlink')
    transition(options, 'after-marker-terminal-rename')
    transition(options, 'after-marker-removal')
  }
  if (pathExists(paths.electionNewWitness)) {
    const owned = options.ownedTemporaries?.get(paths.electionNewWitness)
    if (owned === undefined) throw new Error('Election marker witness ownership is not proven')
    const tombstone = pathExists(paths.electionTombstone) ? paths.electionTombstone : null
    verifyOwnedTemporary(root, paths.electionNewWitness, owned, options)
    if (tombstone !== null) markerOwnership(root, paths.electionNewWitness, expected, mode, options, 2, [tombstone])
    removeOwnedTemporary(root, paths.electionNewWitness, options)
    if (pathExists(paths.electionTombstone)) markerOwnership(root, paths.electionTombstone, expected, mode, options, 1)
    transition(options, 'after-marker-witness-removal')
  }
  if (pathExists(paths.electionTombstone)) {
    const owned = options.ownedTemporaries?.get(paths.electionTombstone)
    if (owned === undefined) throw new Error('Election marker tombstone ownership is not proven')
    verifyOwnedTemporary(root, paths.electionTombstone, owned, options)
    removeOwnedTemporary(root, paths.electionTombstone, options)
    transition(options, 'after-marker-tombstone-removal')
  }
  if (options.ownedTemporaries?.has(paths.electionOldWitness)) removeOwnedTemporary(root, paths.electionOldWitness, options)
}

function currentInspection(request, root, options, hostContext = request.hostContext) {
  if (typeof options.collectInspection === 'function') return options.collectInspection(root, request.host, hostContext, options)

  return collectInspection(root, request.host, hostContext, options)
}

function authenticatedReadyCatalog(root, expectedInspections, options, detail) {
  try {
    return acquireReadyCatalog(root, expectedInspections, options)
  } catch (error) {
    publicationError(detail, { code: 'snapshot-drift', phase: 'prevalidate' }, error)
  }
}

function verifiedPostInspect(request, root, options, admission, outcomes, { electionWitnesses = [], onReadyFailure } = {}) {
  try {
    return currentInspection(request, root, { ...options, electionWitnesses }, publishedHostContext(request, outcomes))
  } catch (error) {
    if (onReadyFailure !== undefined) onReadyFailure(error)
    if (error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify') throwEnrichedReadyFailure(error, admission.manifestId, outcomes)
    publicationError('Post-publication ready verification failed.', { code: 'ready-failed', phase: 'verify', manifestId: admission.manifestId, outcomes }, error)
  }
}

function projectedGuidance(guidance, ownedTargets) {
  if (ownedTargets.size === 0) return guidance
  const retainedPath = (target) => typeof target !== 'string' || !ownedTargets.has(target)

  return {
    ...guidance,
    baseAdapter: retainedPath(guidance.baseAdapter) ? guidance.baseAdapter : null,
    candidates: (guidance.candidates ?? []).filter(retainedPath),
    graphPaths: (guidance.graphPaths ?? []).filter(retainedPath),
    imports: (guidance.imports ?? []).filter((item) => retainedPath(item.source) && retainedPath(item.target)),
    independentPaths: (guidance.independentPaths ?? []).filter(retainedPath),
    resolvedTarget: retainedPath(guidance.resolvedTarget) ? guidance.resolvedTarget : null,
  }
}

function ownedBackup(path, ownedBackupPaths) {
  return ownedBackupPaths.has(path)
}

function ownedProblem(problem, actionTargets, ownedBackupPaths) {
  if (problem.code === 'git-policy') return true
  const evidencePaths = problem.evidencePaths ?? []
  const ownedPath = (path) => actionTargets.has(path) || ownedBackup(path, ownedBackupPaths)
  if (evidencePaths.some((path) => !ownedPath(path))) return false
  if (problem.target !== null) return ownedPath(problem.target)

  return evidencePaths.length > 0
}

function projectedWarnings(warnings, problems, retainedBackups) {
  const projected = (warnings ?? []).filter((warning) => warning.code !== 'manual-cleanup' && warning.code !== 'nonblocking-ready-notice')
  const notices = problems.filter((problem) => problem.code === 'ready-notice')
  if (notices.length > 0) {
    projected.push({ code: 'nonblocking-ready-notice', detail: notices.length === 1 ? '1 ready notice remains.' : `${notices.length} ready notices remain.`, target: notices.length === 1 ? notices[0].target : null })
  }
  if (retainedBackups.length > 0) {
    projected.push({ code: 'manual-cleanup', detail: retainedBackups.length === 1 ? 'One retained mechanical repair backup requires manual cleanup.' : `${retainedBackups.length} retained mechanical repair backups require manual cleanup.`, target: retainedBackups.length === 1 ? retainedBackups[0] : null })
  }

  return projected.sort((left, right) => compareOrdinal(left.code, right.code))
}

// A resumed apply compares two inspections of the same tree at two points of
// one approved transition. The action targets themselves are not compared here
// because `approvedProgress` proves each of them byte-exact against its own
// approved before or after image, which is stronger than record equality; this
// projection covers everything else, so that a third-party change anywhere
// outside the approved transition is still snapshot-drift.
//
// The elided fields are limited to transition outputs this pair of proofs
// already determines from controlled target bytes, the guidance graph, the
// Git index, and the election marker. Inputs that can drift independently,
// including Git newline policy inputs, remain strict comparison evidence.
function resumeInspectionProjection(inspection, actionTargets, markerStates, scope) {
  const git = { ...inspection.git }
  if (git.electionMarker !== undefined && markerStates.values.has(git.electionMarker)) {
    git.electionMarker = markerStates.carried
    git.electionMarkerMode = markerStates.mode
    git.electionMarkerSnapshotId = markerStates.snapshotId
  }
  // Publishing the approved scaffold retires the fresh-scaffold classification
  // and the election requirement that follows from it.
  git.electionRequired = null
  git.freshScaffold = null
  // Non-Git action policies can move from platform defaults to sibling
  // evidence as approved targets appear. Git policies remain strict because
  // repository attributes and configuration can change them independently.
  if (git.kind === 'non-git') git.newlinePolicies = (git.newlinePolicies ?? []).filter((policy) => !actionTargets.has(policy.target))
  const nestedIgnoreEvidence = (git.nonPlanIgnoreMatches ?? []).filter((match) => match.sourcePath !== '.gitignore')
  if (scope.gitignorePublished) {
    // A completed root action can move root-sourced matches and their derived
    // unignored paths. Nested sources remain strict resume evidence.
    git.nonPlanIgnoreMatches = nestedIgnoreEvidence
    git.nonPlanUnignoredPaths = null
    git.plansPolicy = git.plansPolicy === 'nested-conflict' ? 'nested-conflict' : null
  }
  const hasNestedIgnoreEvidence = nestedIgnoreEvidence.length > 0 || inspection.git?.plansPolicy === 'nested-conflict'
  const problems = (inspection.problems ?? []).filter((problem) => (problem.code === 'git-policy' && hasNestedIgnoreEvidence) || !ownedProblem(problem, actionTargets, scope.ownedBackupPaths))
  const retainedBackups = (inspection.retainedBackups ?? []).filter((path) => !ownedBackup(path, scope.ownedBackupPaths))

  return {
    ...inspection,
    git,
    guidance: projectedGuidance(inspection.guidance, scope.guidanceTargets),
    // Both sides are normalized to the one context the resumed inspection
    // resolves guidance under, which the approved manifest and durable
    // presence determine; the two inspections are otherwise incomparable
    // across the guidance file the manifest itself creates.
    hostContext: scope.hostContext,
    problems,
    proposals: null,
    ready: null,
    retainedBackups,
    snapshotId: null,
    targets: (inspection.targets ?? []).map((record) => actionTargets.has(record.target) ? { target: record.target, kind: record.kind, mode: record.mode } : record),
    unwrapReady: null,
    warnings: projectedWarnings(inspection.warnings, problems, retainedBackups),
    wrapFindings: null,
  }
}

function allActionsComplete(request, admission, root, options) {
  const progress = approvedProgress(request, root, options)

  return progress.recognized && progress.applied === admission.actions.length
}

function hasTerminalMarkerEvidence(request, admission, root, existing, paths, expectedBytes, expectedMode, options) {
  if (existing === null || existing.record.manifestId === null) return false
  const inventory = new Set(existing.record.temporaryPaths)
  const requiredPaths = [paths.electionAlias, paths.electionNewWitness, paths.electionTombstone]
  if (request.inspection.git?.electionMarker !== undefined && request.inspection.git.electionMarker !== 'absent') requiredPaths.push(paths.electionOldWitness)
  const required = requiredPaths.map((path) => relativeArtifact(root, path))
  if (required.some((path) => !inventory.has(path))) return false
  const present = (path) => {
    try {
      lstatSync(path)

      return true
    } catch (error) {
      if (error?.code === 'ENOENT') return false
      throw error
    }
  }
  if (present(join(root, ELECTION_BASENAME)) || present(paths.electionAlias) || present(paths.electionOldWitness)) return false
  if (!present(paths.electionTombstone) && !present(paths.electionNewWitness)) return allActionsComplete(request, admission, root, options)
  try {
    const markerOptions = boundedOpenOptions(options, expectedBytes.length, { requireSingleLink: false })
    const tombstone = stableOpenFile(root, paths.electionTombstone, markerOptions)
    if (!tombstone.bytes.equals(expectedBytes) || expectedMode !== null && tombstone.mode !== expectedMode) return false
    const tombstoneMetadata = lstatSync(paths.electionTombstone, { bigint: true })
    if (!present(paths.electionNewWitness)) return tombstoneMetadata.nlink === 1n
    const witness = stableOpenFile(root, paths.electionNewWitness, markerOptions)
    const witnessMetadata = lstatSync(paths.electionNewWitness, { bigint: true })

    return tombstoneMetadata.nlink === 2n && witnessMetadata.nlink === 2n && witness.identity === tombstone.identity && witness.bytes.equals(expectedBytes) && (expectedMode === null || witness.mode === expectedMode)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

// `progressRoot` is the root to classify durable target progress against, or
// null when the caller supplied the live inspection itself and no tree is
// available to classify; the null case also keeps the carried host context
// rather than resolving guidance against the live tree.
function validateResumeInspection(request, liveInspection, admission, { options, progressRoot, terminalMarkerEvidence }) {
  const actionTargets = new Set(admission.actions.map((action) => action.target))
  const carriedGit = request.inspection.git ?? {}
  const markerStates = { carried: carriedGit.electionMarker, mode: carriedGit.electionMarkerMode, snapshotId: carriedGit.electionMarkerSnapshotId, values: new Set([carriedGit.electionMarker, admission.electionMarker.state]) }
  if (terminalMarkerEvidence) markerStates.values.add('absent')
  if (liveInspection.git?.electionMarker !== undefined && !markerStates.values.has(liveInspection.git.electionMarker)) publicationError('Live election marker differs from the approved resume state.', { code: 'snapshot-drift', phase: 'prevalidate', manifestId: admission.manifestId })
  let progress = null
  if (progressRoot !== null) {
    try {
      progress = approvedProgress(request, progressRoot, options)
    } catch (error) {
      publicationError('Durable target state could not be classified against the approved manifest.', { code: 'snapshot-drift', phase: 'prevalidate', manifestId: admission.manifestId }, error)
    }
    if (!progress.recognized) publicationError('Durable target state is not a unique approved prefix of the manifest.', { code: 'snapshot-drift', phase: 'prevalidate', manifestId: admission.manifestId })
  }
  const completedActionTargets = new Set(progress === null ? [] : (request.actions ?? []).slice(0, progress.applied).map((action) => action.target))
  const scope = resumeProjectionScope(request, actionTargets, progressRoot === null ? request.hostContext : liveHostContext(request, progressRoot, true), completedActionTargets, admission.manifestId)
  if (canonicalJson(resumeInspectionProjection(request.inspection, actionTargets, markerStates, scope)) !== canonicalJson(resumeInspectionProjection(liveInspection, actionTargets, markerStates, scope))) {
    publicationError('Live repository differs from the approved resume state.', { code: 'snapshot-drift', phase: 'prevalidate', manifestId: admission.manifestId })
  }
}

function readExistingLock(root, path, options) {
  try {
    const opened = stableOpenFile(root, path, boundedOpenOptions(options, MAX_RECOVERY_REQUEST_BYTES))
    const record = JSON.parse(opened.bytes.toString('utf8'))
    if (!validOwnerRecordSchema(record) || record.operation !== OPERATION.APPLY || record.root !== root) throw new Error('Publication lock schema is invalid')
    if (!Buffer.from(`${canonicalJson(record)}\n`, 'utf8').equals(opened.bytes)) throw new Error('Publication lock bytes are not canonical')
    if ((options.platform ?? process.platform) !== 'win32' && opened.mode !== 0o600) throw new Error('Publication lock mode is invalid')
    const temporaryPathsValue = [...record.temporaryPaths]
    if (temporaryPathsValue.some((item) => !pathIsContained(root, targetPath(root, item)))) throw new Error('Publication lock temporary inventory is invalid')
    if (record.unfinalizedDirectories.some((item) => !pathIsContained(root, targetPath(root, item.target)))) throw new Error('Publication lock directory inventory is invalid')
    const lockMetadata = lstatSync(path, { bigint: true })
    const bootstrapStage = initialLockPaths(root, record.pid, record.ownerNonce).stage
    if (record.manifestId === null) {
      let stage
      try { stage = stableOpenFile(root, bootstrapStage, boundedOpenOptions(options, MAX_RECOVERY_REQUEST_BYTES)) } catch (error) { if (error?.code !== 'ENOENT') throw error }
      if (lockMetadata.nlink !== 1n && lockMetadata.nlink !== 2n || lockMetadata.nlink === 2n && (stage === undefined || stage.identity !== opened.identity || !stage.bytes.equals(opened.bytes))) throw new Error('Bootstrap lock identity is invalid')
      if (lockMetadata.nlink === 1n && stage !== undefined) throw new Error('Bootstrap lock stage is not linked to its owner')
    } else if (lockMetadata.nlink !== 1n) {
      throw new Error('Upgraded publication lock identity is invalid')
    }

    return { bytes: opened.bytes, identity: opened.identity, mode: platformMode(options, opened.mode), record }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function publishApply(request, options = {}) {
  const root = canonicalRoot(request.root)
  let pid = options.pid ?? process.pid
  let ownerNonce = options.ownerNonce ?? randomBytes(16).toString('hex')
  let backupCandidates = []
  let lockHint = null
  verifyRecoveryGateAbsent(root)
  try {
    lockHint = readExistingLock(root, join(root, LOCK_BASENAME), options)
  } catch (error) {
    publicationError('Existing publication lock is not trustworthy.', { code: 'runtime-lock', phase: 'lock', target: LOCK_BASENAME }, error)
  }
  const resume = options.resume ?? detectResume(request, root, lockHint, pid, options)
  if (lockHint !== null && resume === true) {
    ownerNonce = lockHint.record.ownerNonce
    pid = lockHint.record.pid
  }
  const bootstrapPaths = initialLockPaths(root, pid, ownerNonce)
  const bootstrap = lockRecord(request, root, pid, ownerNonce, null, [bootstrapPaths.stage, join(root, `${LOCK_BASENAME}.${ownerNonce}.next`)], [])
  let lock = null
  const ownedTemporaries = new Map()
  const outcomes = []
  let retainedBackups = []
  let backupDirectoryCreated = false
  try {
    if (resume !== true) {
      try {
        lstatSync(bootstrapPaths.lock)
        publicationError('Publication lock is already present.', { code: 'runtime-lock', phase: 'lock', target: LOCK_BASENAME })
      } catch (error) {
        if (error instanceof InitBacklogError) throw error
        if (error?.code !== 'ENOENT') throw error
      }
      const initial = createInitialLock(root, bootstrap, { ...options, beforePublish: () => verifyRecoveryGateAbsent(root), ownerNonce, pid, onTransition: (point) => transition(options, point) })
      const initialReadback = stableOpenFile(root, bootstrapPaths.lock, boundedOpenOptions(options, initial.bytes.length, { requireSingleLink: true }))
      lock = { bytes: initial.bytes, identity: initialReadback.identity, manifestId: null, mode: platformMode(options, initialReadback.mode), ownerNonce, paths: bootstrapPaths, pid, record: bootstrap, temporaryPaths: bootstrap.temporaryPaths }
      verifyRecoveryGateAbsent(root)
    }
  } catch (error) {
    if (error instanceof InitBacklogError) {
      if (lock !== null && options.crash !== true && options.preserveLockOnError !== true) {
        cleanupOwner(root, lock, options, ownedTemporaries)
      }

      throw error
    }
    if (options.preserveLockOnError === true || options.crash === true) throw error
    publicationError('Initial publication lock acquisition failed.', { code: 'runtime-lock', phase: 'lock', target: LOCK_BASENAME }, error)
  }
  let admission
  let liveInspection
  try {
    liveInspection = options.currentInspection ?? currentInspection(request, root, options, liveHostContext(request, root, resume === true))
    verifyRecoveryGateAbsent(root)
    const admissionOptions = { ...options, currentInspection: resume === true ? request.inspection : liveInspection }
    if (options.currentInspection === undefined && options.collectInspection === undefined) {
      const actionTargets = new Set((request.actions ?? []).map((action) => action.target))
      const ignoredStateTargets = resume === true ? actionTargets : new Set()
      const readyExpectations = [{ inspection: liveInspection }, { ignoredStateTargets, inspection: request.inspection }]
      const readyDriftDetail = resume === true ? 'Live repository differs from the approved resume state.' : 'Ready catalog differs from the approved inspection.'
      const readyAcquisition = authenticatedReadyCatalog(root, readyExpectations, options, readyDriftDetail)
      transition(options, 'after-ready-catalog-acquisition')
      const readyRecheck = authenticatedReadyCatalog(root, readyExpectations, options, readyDriftDetail)
      if (canonicalJson(readyAcquisition.evidence) !== canonicalJson(readyRecheck.evidence)) publicationError('Ready catalog identity changed before admission.', { code: 'snapshot-drift', phase: 'prevalidate' })
      admissionOptions.readyCatalog = readyAcquisition.catalog
    }
    admission = admitApplyManifest(request, admissionOptions)
  } catch (error) {
    if (lock !== null && options.crash !== true && options.preserveLockOnError !== true) {
      try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
    }
    if (error instanceof InitBacklogError) throw error
    publicationError('Apply manifest prevalidation failed.', { code: 'manifest-invalid', phase: 'prevalidate' }, error)
  }
  if (lockHint !== null && resume === true) {
    ownerNonce = lockHint.record.ownerNonce
    pid = lockHint.record.pid
  }
  const allActions = request.actions ?? []
  const fixed = temporaryPaths(root, admission.manifestId, 1, ownerNonce, request.inspection.snapshotId, pid)
  const actionTemps = allActions.map((action, index) => actionTemporaryPath(root, admission.manifestId, index + 1, action.target))
  const repairActions = allActions.filter((action) => action.kind === 'repair-file' || action.kind === 'unwrap-file')
  const backupTargets = repairActions.map((action) => backupTarget(action.target, request.inspection.snapshotId, admission.manifestId))
  backupCandidates = backupTargets
  const backupPaths = backupTargets.map((target) => targetPath(root, target))
  const backupStagingPaths = repairActions.map((action) => targetPath(root, backupStageTarget(action.target, request.inspection.snapshotId, admission.manifestId)))
  const rollbackTemporaryPaths = repairActions.map((action) => targetPath(root, recoveryTemporaryTarget(action.target, admission.manifestId)))
  const unfinalizedDirectories = allActions.filter((action) => action.kind === 'ensure-directory').map((action) => ({ mode: action.mode, target: action.target }))
  const markerTemporaries = admission.electionMarker.state === 'absent' ? [] : [fixed.electionAlias, fixed.electionNewWitness, ...(request.inspection.git?.electionMarker !== undefined && request.inspection.git?.electionMarker !== 'absent' ? [fixed.electionOldWitness] : []), fixed.electionTombstone]
  const tempSet = [...actionTemps, ...backupPaths, ...backupStagingPaths, ...rollbackTemporaryPaths, fixed.lockStage, fixed.lockNext, ...markerTemporaries]
  const targets = allActions.map((action) => targetPath(root, action.target))
  const targetSet = new Set(targets)
  const existing = lockHint
  const finalMarkerMode = platformMode(options, request.inspection.git?.electionMarkerMode ?? 0o600)
  let terminalMarkerEvidence = false
  let terminalMarkerComplete = false
  if (resume === true) {
    terminalMarkerEvidence = admission.electionMarker.state !== 'absent' && hasTerminalMarkerEvidence(request, admission, root, existing, fixed, markerBytes(request, admission, root), finalMarkerMode, options)
    terminalMarkerComplete = terminalMarkerEvidence && !pathExists(fixed.electionTombstone) && !pathExists(fixed.electionNewWitness)
    validateResumeInspection(request, liveInspection, admission, { options, progressRoot: options.currentInspection === undefined ? root : null, terminalMarkerEvidence })
  }
  try {
    verifyRecoveryGateAbsent(root)
    if (new Set(tempSet).size !== tempSet.length || tempSet.some((path) => targetSet.has(path))) publicationError('Derived publication temporary collides with a target.', { code: 'manifest-invalid', phase: 'prevalidate', manifestId: admission.manifestId })
    if (resume !== true || lockHint === null) {
      requireReservedTemporariesAbsent(root, tempSet)
    } else if (lockHint.record.manifestId === null) {
      requireReservedTemporariesAbsent(root, tempSet, new Set([fixed.lockStage, fixed.lockNext]))
    }
  } catch (error) {
    if (lock !== null && options.crash !== true && options.preserveLockOnError !== true) {
      try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
    }
    throw error
  }
  let states
  try {
    states = initialStates(request.inspection, root, options)
    hydrateRepairStates(request, repairActions, states, root, options, backupTargets, existing, resume)
    if (existing !== null) {
      if (existing.record.root !== root || (existing.record.manifestId !== null && existing.record.manifestId !== admission.manifestId)) publicationError('Existing publication lock does not match the approved manifest.', { code: 'runtime-lock', phase: 'lock', manifestId: admission.manifestId, target: LOCK_BASENAME })
      ownerNonce = existing.record.ownerNonce
      const resumedPaths = temporaryPaths(root, admission.manifestId, 1, ownerNonce, request.inspection.snapshotId, pid)
      const expectedInventory = existing.record.manifestId === null ? [fixed.lockStage, fixed.lockNext] : tempSet
      const expectedRelative = expectedInventory.map((path) => relativeArtifact(root, path)).sort(compareOrdinal)
      const actualRelative = [...existing.record.temporaryPaths].sort(compareOrdinal)
      if (canonicalJson(expectedRelative) !== canonicalJson(actualRelative)) publicationError('Existing publication lock inventory does not match the approved manifest.', { code: 'runtime-lock', phase: 'lock', manifestId: admission.manifestId, target: LOCK_BASENAME })
      if (existing.record.manifestId !== null && canonicalJson(existing.record.unfinalizedDirectories) !== canonicalJson(unfinalizedDirectories)) publicationError('Existing publication directory inventory does not match the approved manifest.', { code: 'runtime-lock', phase: 'lock', manifestId: admission.manifestId, target: LOCK_BASENAME })
      if (existing.record.manifestId === null) {
        try {
          const stageMetadata = lstatSync(fixed.lockStage, { bigint: true })
          if (stageMetadata.nlink !== 2n) throw new Error('Publication bootstrap stage link count is invalid')
          registerTemporary(root, ownedTemporaries, fixed.lockStage, existing.bytes, options, false, platformMode(options, 0o600))
          const stage = ownedTemporaries.get(fixed.lockStage)
          stage.linkCount = 2
          stage.peers = [fixed.lock]
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
      lock = { bytes: existing.bytes, identity: existing.identity, manifestId: existing.record.manifestId, mode: existing.mode, ownerNonce, paths: resumedPaths, pid, record: existing.record, temporaryPaths: existing.record.temporaryPaths }
    } else if (lock === null) {
      verifyRecoveryGateAbsent(root)
      notifyWrite(options, fixed.lockStage)
      lock = createInitialLock(root, bootstrap, { ...options, beforePublish: () => verifyRecoveryGateAbsent(root), ownerNonce, pid, onTransition: (point) => transition(options, point) })
      const initialReadback = stableOpenFile(root, bootstrapPaths.lock, boundedOpenOptions(options, lock.bytes.length, { requireSingleLink: true }))
      lock.identity = initialReadback.identity
      lock.mode = platformMode(options, initialReadback.mode)
    }
    const generatedUpgrade = lockRecord(request, root, pid, ownerNonce, admission.manifestId, tempSet, unfinalizedDirectories)
    const pendingUpgrade = adoptPendingLockUpgrade(root, existing, generatedUpgrade, fixed.lockNext, options, ownedTemporaries)
    const upgraded = pendingUpgrade.record
    const upgradedBytes = pendingUpgrade.bytes
    const alreadyUpgraded = lock.record?.manifestId === admission.manifestId && canonicalJson(lock.record.temporaryPaths ?? []) === canonicalJson(upgraded.temporaryPaths) && canonicalJson(lock.record.unfinalizedDirectories ?? []) === canonicalJson(upgraded.unfinalizedDirectories)
    if (!alreadyUpgraded) {
      if (ownedTemporaries.has(fixed.lockNext)) {
        verifyOwnedTemporary(root, fixed.lockNext, ownedTemporaries.get(fixed.lockNext), options)
      } else {
        verifyRecoveryGateAbsent(root)
        notifyWrite(options, fixed.lockNext)
        stageFile(fixed.lockNext, upgradedBytes, { ...options, root, onTransition: (point) => transition(options, point) })
        readBackExact(fixed.lockNext, upgradedBytes, options)
        assignAndVerifyMode(fixed.lockNext, 0o600, options)
        registerTemporary(root, ownedTemporaries, fixed.lockNext, upgradedBytes, options, true, platformMode(options, 0o600))
      }
      const expectedUpgradeIdentity = ownedTemporaries.get(fixed.lockNext)?.identity
      const currentLock = stableOpenFile(root, fixed.lock, boundedOpenOptions(options, lock.bytes.length, { requireSingleLink: lock.record?.manifestId !== null }))
      const currentLockMetadata = lstatSync(fixed.lock, { bigint: true })
      if (lock.record?.manifestId !== null && currentLockMetadata.nlink !== 1n || lock.record?.manifestId === null && currentLockMetadata.nlink !== 1n && currentLockMetadata.nlink !== 2n || currentLock.identity !== lock.identity || !currentLock.bytes.equals(lock.bytes) || (options.platform ?? process.platform) !== 'win32' && currentLock.mode !== lock.mode) throw new Error('Publication lock changed before upgrade')
      if (lock.record?.manifestId === null && currentLockMetadata.nlink === 2n) {
        const stage = ownedTemporaries.get(fixed.lockStage)
        if (stage === undefined) throw new Error('Publication bootstrap stage ownership is not proven')
        const currentStage = verifyOwnedTemporary(root, fixed.lockStage, stage, options, false)
        if (currentStage.identity !== currentLock.identity) throw new Error('Publication lock changed before upgrade')
      }
      verifyRecoveryGateAbsent(root)
      renameVerified(fixed.lockNext, fixed.lock, upgradedBytes, options)
      try {
        lstatSync(fixed.lockNext)
        throw new Error('Publication lock upgrade temporary was recreated')
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      if (lock.record?.manifestId === null) {
        const stage = ownedTemporaries.get(fixed.lockStage)
        if (stage !== undefined) {
          stage.linkCount = 1
          stage.peers = []
          stage.requireSingleLink = true
        }
      }
      const upgradedReadback = stableOpenFile(root, fixed.lock, boundedOpenOptions(options, upgradedBytes.length, { requireSingleLink: true }))
      if (!upgradedReadback.bytes.equals(upgradedBytes) || expectedUpgradeIdentity !== undefined && upgradedReadback.identity !== expectedUpgradeIdentity) throw new Error('Upgraded publication lock identity differs')
      lock.bytes = upgradedBytes
      lock.identity = upgradedReadback.identity
      lock.manifestId = admission.manifestId
      lock.mode = platformMode(options, upgradedReadback.mode)
      lock.temporaryPaths = tempSet
      lock.record = upgraded
      verifyRecoveryGateAbsent(root)
      removeAndVerify(fixed.lockNext, options)
      ownedTemporaries.delete(fixed.lockNext)
      transition(options, 'after-lock-upgrade')
    }
    const expectedTemporaries = new Map([[fixed.lockNext, { bytes: upgradedBytes, destination: null, mode: platformMode(options, 0o600) }], [fixed.lockStage, { bytes: null, destination: null, mode: null }]])
    for (let index = 0; index < backupPaths.length; index += 1) {
      const state = states.get(repairActions[index].target)
      if (state?.content === null || state?.content === undefined) throw new Error('Repair backup source is unavailable')
      expectedTemporaries.set(backupPaths[index], { bytes: state.content, destination: null, mode: platformMode(options, state.mode) })
      expectedTemporaries.set(backupStagingPaths[index], { bytes: state.content, destination: backupPaths[index], mode: platformMode(options, state.mode) })
      expectedTemporaries.set(rollbackTemporaryPaths[index], { bytes: state.content, destination: null, mode: platformMode(options, state.mode) })
    }
    for (let index = 0; index < allActions.length; index += 1) {
      const action = allActions[index]
      const bytes = actionAfter(request, action, root, options)
      expectedTemporaries.set(actionTemps[index], { bytes, destination: targetPath(root, action.target), mode: bytes === null ? null : effectiveActionFileMode(action, states.get(action.target)?.mode, options) })
    }
    if (admission.electionMarker.state !== 'absent') {
      const finalMarkerBytes = markerBytes(request, admission, root)
      expectedTemporaries.set(fixed.electionAlias, { bytes: finalMarkerBytes, destination: null, mode: finalMarkerMode, marker: true })
      expectedTemporaries.set(fixed.electionNewWitness, { bytes: finalMarkerBytes, destination: null, mode: finalMarkerMode, marker: true })
      expectedTemporaries.set(fixed.electionTombstone, { bytes: finalMarkerBytes, destination: null, mode: finalMarkerMode, marker: true })
      if (markerTemporaries.includes(fixed.electionOldWitness)) expectedTemporaries.set(fixed.electionOldWitness, { bytes: markerOldBytes(request, root), destination: null, mode: finalMarkerMode, marker: true })
    }
    adoptResumeTemporaries(root, existing, expectedTemporaries, options, ownedTemporaries, fixed.lockStage, fixed.lockNext)
    if (admission.electionMarker.state !== 'absent') {
      adoptMarkerTemporaries(root, existing, fixed, markerBytes(request, admission, root), finalMarkerMode, markerOldBytes(request, root), finalMarkerMode, { ...options, ownedTemporaries })
    }
    const publicationOptions = { ...options, ownedTemporaries, verifyLock: () => verifyLockState(root, lock, options), onTemporaryStaged: (path, bytes, mode) => registerTemporary(root, ownedTemporaries, path, bytes, options, true, mode), onTemporaryRemoved: (path) => { ownedTemporaries.delete(path) } }
    retainedBackups = []
    const cleanupRepairBackups = () => {
      try {
        for (const action of repairActions) {
          const backup = backupTarget(action.target, request.inspection.snapshotId, admission.manifestId)
          removeOwnedTemporary(root, targetPath(root, backup), publicationOptions)
          retainedBackups = retainedBackups.filter((target) => target !== backup)
        }
      } catch (error) {
        retainedBackups = retainedBackupPaths(root, retainedBackups)
        publicationError('Repair backup cleanup failed after ready verification.', { code: 'cleanup-failed', phase: 'cleanup', manifestId: admission.manifestId, outcomes, recovery: { retainedBackups, status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Repair backups require manual cleanup.', target: null }] } }, error)
      }

      retainedBackups = []
    }
    const rollbackRepairAfterVerification = (error = null) => {
      try {
        restoreRepairBatch(root, repairActions, admission.manifestId, request.inspection.snapshotId, publicationOptions)
      } catch (restoreError) {
        retainedBackups = retainedBackupPaths(root, retainedBackups)
        publicationError('Repair restoration failed after ready verification drift.', { code: 'restore-failed', phase: 'restore', manifestId: admission.manifestId, outcomes, recovery: { retainedBackups, status: 'restore-failed', warnings: [{ code: 'manual-cleanup', detail: 'Repair backups require manual cleanup after restoration failure.', target: null }] } }, restoreError)
      }
      cleanupRepairBackups()
      const recovery = { retainedBackups: [], status: 'restored', warnings: [] }
      if (error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify') {
        throwEnrichedReadyFailure(error, admission.manifestId, outcomes, recovery)
      }
      if (error !== null) publicationError('Post-publication ready verification failed.', { code: 'ready-failed', phase: 'verify', manifestId: admission.manifestId, outcomes, recovery }, error)
      publicationError('Predicted ready result differs after mechanical repair publication.', { code: 'ready-delta', phase: 'verify', manifestId: admission.manifestId, outcomes })
    }
    if (backupPaths.length !== 0) {
      publicationOptions.verifyLock?.()
      backupDirectoryCreated = verifyBackupDirectory(root, options)
      for (let index = 0; index < backupPaths.length; index += 1) {
        const action = repairActions[index]
        const state = states.get(action.target)
        if (state?.present !== true || state.content === null) throw new Error('Repair backup source is unavailable')
        const backupPath = backupPaths[index]
        let backupPresent = true
        try {
          lstatSync(backupPath)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
          backupPresent = false
        }
        if (!backupPresent) {
          publishRecoveryFile(root, backupPath, state.content, state.mode, { ...publicationOptions, temporary: backupStagingPaths[index], recoveryId: admission.manifestId })
        }
        registerTemporary(root, ownedTemporaries, backupPath, state.content, options, true, platformMode(options, state.mode))
        retainedBackups.push(backupTargets[index])
      }
    }
    if (!terminalMarkerComplete) {
      if (pathExists(fixed.electionTombstone)) removeMarker(request, admission, root, publicationOptions, fixed)
      else publishMarker(request, admission, root, admission.manifestId, platformMode(options, 0o600), publicationOptions, fixed)
    }
    const publishActions = (startIndex, endIndex) => {
      let index = startIndex
      while (index < endIndex) {
        const firstAction = allActions[index]
        const firstPath = targets[index]
        const state = states.get(firstAction.target) ?? { content: null, kind: firstAction.kind === 'ensure-directory' ? 'directory' : 'file', mode: firstAction.mode, present: false }
        let chainEnd = index + 1
        while (chainEnd < endIndex && allActions[chainEnd].target === firstAction.target) chainEnd += 1
        if (chainEnd - index > 1 && firstAction.kind !== 'ensure-directory') {
          const terminalAction = allActions[chainEnd - 1]
          const terminalBytes = actionAfter(request, terminalAction, root, options)
          const terminalMode = effectiveActionFileMode(terminalAction, state.mode, options)
          if (terminalBytes !== null && targetMatchesOutput(root, firstPath, 'file', terminalBytes, terminalMode, options)) {
            for (let completedIndex = index; completedIndex < chainEnd; completedIndex += 1) {
              const completed = allActions[completedIndex]
              outcomes.push({ actionId: completed.id, status: 'skipped-complete', target: completed.target })
            }
            state.present = true
            state.content = terminalBytes
            states.set(firstAction.target, state)
            index = chainEnd
            continue
          }
        }
        while (index < chainEnd) {
          const action = allActions[index]
          const path = targets[index]
          if (action.kind === 'ensure-directory') {
            const approvedMode = platformMode(options, action.mode)
            const already = state.present || targetMatchesOutput(root, path, 'directory', null, approvedMode, options)
            if (!state.present) {
              if (!already) publishDirectory(root, path, approvedMode, publicationOptions)
              state.present = true
            }
            outcomes.push({ actionId: action.id, status: already ? 'skipped-complete' : 'created', target: action.target })
          } else {
            const bytes = actionAfter(request, action, root, options)
            if (bytes === null) publicationError('Approved action has no content image.', { code: 'manifest-invalid', phase: 'prevalidate', manifestId: admission.manifestId, actionId: action.id, target: action.target })
            const effectiveMode = effectiveActionFileMode(action, state.mode, options)
            const already = targetMatchesPublishedTemporary(root, path, bytes, effectiveMode, actionTemps[index], publicationOptions) || targetMatchesOutput(root, path, 'file', bytes, effectiveMode, options)
            const expectedContent = state.content ?? actionBefore(request, action, root, options)
            let published
            if (!already) published = publishContent(root, path, bytes, effectiveMode, actionTemps[index], publicationOptions, state.present, { content: expectedContent, identity: state.identity, mode: state.mode })
            state.present = true
            state.content = bytes
            if (published !== undefined) {
              state.identity = published.final.identity
              state.mode = published.final.mode
            } else if (already) {
              const adopted = publicationOptions.ownedTemporaries?.get(actionTemps[index])
              if (adopted?.destination === path) {
                state.identity = adopted.identity
                state.mode = adopted.mode
              } else {
                const current = stableOpenFile(root, path, boundedOpenOptions(options, bytes.length, { requireSingleLink: true }))
                state.identity = current.identity
                state.mode = current.mode
              }
            }
            const status = already ? 'skipped-complete' : action.kind === 'repair-file' ? 'repaired' : action.kind === 'unwrap-file' ? 'unwrapped' : action.kind === 'create-from-template' ? 'created' : 'edited'
            outcomes.push({ actionId: action.id, status, target: action.target })
          }
          states.set(action.target, state)
          index += 1
        }
      }
    }
    // The marker temporaries this manifest reserved are the only hard links
    // the published marker may legitimately carry while verification runs.
    const electionWitnesses = [fixed.electionAlias, fixed.electionNewWitness, fixed.electionOldWitness, fixed.electionTombstone]
    const firstRankTwo = allActions.findIndex((action) => action.kind !== 'ensure-directory' && action.kind !== 'repair-file' && action.kind !== 'unwrap-file')
    const hasRepairBatch = repairActions.length !== 0
    const repairEnd = hasRepairBatch && firstRankTwo !== -1 ? firstRankTwo : allActions.length
    publishActions(0, repairEnd)
    let postInspect = verifiedPostInspect(request, root, options, admission, outcomes, {
      electionWitnesses,
      onReadyFailure: (error) => {
        if (repairActions.length !== 0) rollbackRepairAfterVerification(error)
      },
    })
    const expectedRepairReady = request.inspection?.unwrapReady?.after
    if (repairActions.length !== 0 && expectedRepairReady !== undefined && canonicalJson(postInspect.ready ?? null) !== canonicalJson(expectedRepairReady)) {
      rollbackRepairAfterVerification()
    }
    if (repairActions.length !== 0) {
      cleanupRepairBackups()
    }
    if (hasRepairBatch) {
      publishActions(repairEnd, allActions.length)
      postInspect = verifiedPostInspect(request, root, options, admission, outcomes, { electionWitnesses })
    }
    if (canonicalJson(postInspect.ready ?? null) !== canonicalJson(admission.ready ?? null)) publicationError('Predicted ready result differs after semantic publication.', { code: 'ready-delta', phase: 'verify', manifestId: admission.manifestId, outcomes })
    if (admission.electionMarker.state !== 'absent' && postInspect.git?.electionMarker !== 'absent' && request.versionControlChoice !== 'deferred' && completePostInspect(postInspect, admission, request).length === 0) {
      removeMarker(request, admission, root, publicationOptions, fixed)
      postInspect = verifiedPostInspect(request, root, options, admission, outcomes, { electionWitnesses })
    }
    cleanupOwner(root, lock, options, ownedTemporaries)

    const warnings = backupDirectoryCreated ? [{ code: 'runtime-support-created', detail: 'Controller created the shared .tmp directory.', target: BACKUP_DIRECTORY }] : []

    return resultRecord(request, admission, postInspect, outcomes, warnings, retainedBackups)
  } catch (error) {
    if (error instanceof InitBacklogError) {
      if (options.preserveLockOnError === true || options.crash === true) throw error
      try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
      throw error
    }
    if (options.preserveLockOnError === true || options.crash === true || options.failAt !== undefined) throw error
    try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
    const retained = retainedBackupPaths(root, [...new Set([...retainedBackups, ...backupCandidates])])
    publicationError('Publication effect failed.', { code: 'filesystem', phase: 'publish', manifestId: admission.manifestId, outcomes, recovery: retained.length === 0 ? undefined : { retainedBackups: retained, status: 'none', warnings: [{ code: 'manual-cleanup', detail: 'Repair backups remain retained after publication failure.', target: null }] }, systemCode: trustedSystemCode(error) }, error)
  }
}

module.exports = { publishApply, publishRecoveryFile, relativeArtifact, recoveryTemporaryMatches, recoveryTemporaryTarget, removeRecoveryFile, temporaryPaths }
