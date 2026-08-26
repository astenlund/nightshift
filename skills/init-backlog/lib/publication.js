'use strict'

const { randomBytes } = require('node:crypto')
const { join, relative } = require('node:path')
const { lstatSync, mkdirSync } = require('node:fs')

const { admitApplyManifest } = require('./apply-manifest')
const { InitBacklogError, failureRecord, trustedSystemCode } = require('./errors')
const { unwrapText } = require('../unwrap')
const {
  assignAndVerifyMode,
  canonicalRoot,
  createInitialLock,
  initialLockPaths,
  pathIsContained,
  publishNoReplace,
  readBackExact,
  removeAndVerify,
  renameVerified,
  stableOpenFile,
  stageFile,
  verifyFinalMode,
  verifyPublishedIdentity,
} = require('./filesystem')
const { collectInspection, composeElectionMarker } = require('./inspection')
const { canonicalJson, compareOrdinal, sha256 } = require('./protocol')

const LOCK_BASENAME = '.nightshift-init-backlog.lock'
const ELECTION_BASENAME = '.nightshift-init-backlog-election'
const POSIX_DEFAULT_FILE_MODE = 0o644
const POSIX_DEFAULT_DIRECTORY_MODE = 0o755

function publicationError(detail, fields = {}, cause) {
  throw new InitBacklogError(failureRecord({ code: fields.code ?? 'filesystem', detail, operation: 'apply', phase: fields.phase ?? 'publish', manifestId: fields.manifestId ?? null, actionId: fields.actionId ?? null, target: fields.target ?? null, outcomes: fields.outcomes ?? [], recovery: fields.recovery ?? { retainedBackups: [], status: 'none', warnings: [] }, systemCode: fields.systemCode ?? null }), { cause })
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

function temporaryPaths(root, manifestId, actionOrdinal = 1, ownerNonce = '0'.repeat(32), snapshotId = '0'.repeat(64), pid = process.pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || !/^[a-f0-9]{32}$/.test(ownerNonce) || !/^[a-f0-9]{64}$/.test(manifestId) || !/^[a-f0-9]{64}$/.test(snapshotId) || !Number.isSafeInteger(actionOrdinal) || actionOrdinal <= 0) {
    throw new TypeError('Temporary identity is invalid')
  }
  const lockPaths = initialLockPaths(root, pid, ownerNonce)
  const electionAlias = join(root, `.nightshift-init-backlog-election.${manifestId}.tmp`)

  return {
    action: join(root, `.nightshift-init-backlog.${manifestId}.${actionOrdinal}.tmp`),
    election: electionAlias,
    electionAlias,
    electionNewWitness: join(root, `.nightshift-init-backlog-election.${manifestId}.new.tmp`),
    electionOldWitness: join(root, `.nightshift-init-backlog-election.${manifestId}.old.tmp`),
    electionTombstone: join(root, `.nightshift-init-backlog-election.${manifestId}.tombstone.tmp`),
    lock: lockPaths.lock,
    lockNext: join(root, `.nightshift-init-backlog.lock.${ownerNonce}.next`),
    lockStage: lockPaths.stage,
  }
}

function deriveTemporaryPaths(root, manifestId, actionOrdinal, ownerNonce, snapshotId, pid) {
  return temporaryPaths(root, manifestId, actionOrdinal, ownerNonce, snapshotId, pid)
}

function targetPath(root, target) {
  const path = join(root, ...target.split('/'))
  if (!pathIsContained(root, path)) {
    throw new Error('Publication target escapes its root')
  }

  return path
}

function readRecordBytes(record) {
  if (record?.contentBase64 === null || record?.contentBase64 === undefined) return null

  return Buffer.from(record.contentBase64, 'base64')
}

function initialStates(inspection) {
  return new Map((inspection.targets ?? []).map((record) => [record.target, {
    content: readRecordBytes(record),
    kind: record.kind,
    mode: record.mode,
    present: !(record.states ?? []).includes('missing'),
  }]))
}

function proposalAfter(request, action) {
  const proposal = (request.inspection.proposals ?? []).find((item) => canonicalJson(item.action) === canonicalJson(action))
  if (proposal?.afterBase64 !== null && proposal?.afterBase64 !== undefined) return Buffer.from(proposal.afterBase64, 'base64')
  if (action.afterBase64 !== null && action.afterBase64 !== undefined) return Buffer.from(action.afterBase64, 'base64')

  return null
}

function actionAfter(request, action, root, options) {
  if (action.kind === 'unwrap-file') {
    const finding = (request.inspection.wrapFindings ?? []).find((item) => item.target === action.target)
    if (finding?.predictedContentBase64 !== null && finding?.predictedContentBase64 !== undefined) return Buffer.from(finding.predictedContentBase64, 'base64')
    if (finding === undefined || finding.beforeRawSha256 !== action.beforeRawSha256) throw new Error('Mechanical unwrap digest evidence is invalid')
    const opened = stableOpenFile(root, targetPath(root, action.target), { ...options, requireSingleLink: true })
    if (opened.rawSha256 === action.afterRawSha256) return opened.bytes
    if (opened.rawSha256 !== action.beforeRawSha256) throw new Error('Mechanical unwrap input changed before publication')

    return Buffer.from(unwrapText(opened.bytes.toString('utf8')), 'utf8')
  }

  return proposalAfter(request, action)
}

function actionBefore(request, action, root, options) {
  if (action.kind !== 'unwrap-file') {
    if (action.beforeBase64 === null || action.beforeBase64 === undefined) return null

    return Buffer.from(action.beforeBase64, 'base64')
  }
  const finding = (request.inspection.wrapFindings ?? []).find((item) => item.target === action.target)
  if (finding === undefined || finding.beforeRawSha256 !== action.beforeRawSha256) throw new Error('Mechanical unwrap digest evidence is invalid')
  const opened = stableOpenFile(root, targetPath(root, action.target), { ...options, requireSingleLink: true })
  if (opened.rawSha256 !== action.beforeRawSha256) throw new Error('Mechanical unwrap input changed before publication')

  return opened.bytes
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
  const opened = stableOpenFile(root, path, { ...options, requireSingleLink: true })
  if (expected.content !== null && !opened.bytes.equals(expected.content)) throw new Error('Target bytes changed before publication')
  if (expected.mode !== null && opened.mode !== expected.mode) throw new Error('Target mode changed before publication')

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
  const opened = stableOpenFile(root, path, { ...options, requireSingleLink })
  if (!opened.bytes.equals(bytes)) throw new Error('Staged temporary bytes changed')
  if (mode !== null && opened.mode !== mode) throw new Error('Staged temporary mode changed')
  ownedTemporaries.set(path, { bytes: Buffer.from(bytes), destination: null, identity: opened.identity, mode, requireSingleLink })
}

function verifyOwnedTemporary(root, path, owned, options, requireSingleLink = owned.requireSingleLink) {
  const current = stableOpenFile(root, path, { ...options, requireSingleLink })
  if (current.identity !== owned.identity || !current.bytes.equals(owned.bytes) || owned.mode !== null && current.mode !== owned.mode) throw new Error('Reserved temporary changed before publication')
  if (owned.linkCount !== undefined) {
    const metadata = lstatSync(path, { bigint: true })
    if (metadata.nlink !== BigInt(owned.linkCount)) throw new Error('Reserved temporary link count changed')
    for (const peer of owned.peers ?? []) {
      const peerFile = stableOpenFile(root, peer, { ...options, requireSingleLink: false })
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
  const destination = stableOpenFile(root, owned.destination, { ...options, requireSingleLink: false })
  if (temporaryMetadata.nlink !== 2n || destinationMetadata.nlink !== 2n || destination.identity !== owned.identity || !destination.bytes.equals(owned.bytes) || owned.mode !== null && destination.mode !== owned.mode) throw new Error('Published target shares an unexpected temporary identity')
}

function publishContent(root, path, bytes, mode, temp, options, replace, expectedContent, expectedMode, expectedIdentity = null) {
  options.verifyLock?.()
  notifyWrite(options, path)
  const fileOptions = { ...options, onTransition: (point) => transition(options, point) }
  stageFile(temp, bytes, fileOptions)
  readBackExact(temp, bytes, fileOptions)
  assignAndVerifyMode(temp, mode, fileOptions)
  verifyFinalMode(temp, mode, fileOptions)
  transition(options, 'after-mode-assignment')
  const staged = options.ownedTemporaries?.get(temp)
  if (staged === undefined) throw new Error('Reserved temporary ownership is not proven')
  options.verifyLock?.()
  verifyOwnedTemporary(root, temp, staged, options)
  stableTarget(root, path, { content: replace ? expectedContent : null, identity: replace ? expectedIdentity : null, kind: 'file', mode: replace ? expectedMode : null, present: replace }, options)
  options.verifyLock?.()
  if (replace) {
    renameVerified(temp, path, bytes, fileOptions)
  } else {
    publishNoReplace(temp, path, fileOptions)
    verifyPublishedIdentity(root, temp, path, bytes)
  }
  removeAndVerify(temp, fileOptions)
  const final = stableOpenFile(root, path, { ...options, requireSingleLink: true })
  if (!final.bytes.equals(bytes) || (mode !== null && final.mode !== mode)) throw new Error('Published target verification failed')
  transition(options, 'after-final-verification')
  transition(options, 'after-temporary-cleanup')

  return { final }
}

function targetMatchesOutput(root, path, kind, bytes, mode, options) {
  try {
    const metadata = lstatSync(path, { bigint: true })
    if (metadata.isSymbolicLink()) throw new Error('Publication target is linked')
    if (kind === 'directory') {
      if (!metadata.isDirectory()) throw new Error('Publication target kind changed')
      verifyFinalMode(path, mode, options)

      return true
    }
    if (!metadata.isFile()) throw new Error('Publication target kind changed')
    const opened = stableOpenFile(root, path, { ...options, requireSingleLink: true })
    if (!opened.bytes.equals(bytes)) return false
    if (mode !== null && opened.mode !== mode) throw new Error('Publication target mode changed')

    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
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

function completePostInspect(postInspect, admission, request) {
  const incomplete = new Set()
  for (const record of postInspect.targets ?? []) {
    if ((record.states ?? []).includes('missing') || (record.states ?? []).includes('wrapped') || (record.states ?? []).includes('structurally-invalid')) incomplete.add(record.target)
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
  const git = postInspect.git ?? request.inspection.git
  if (git?.kind === 'git') {
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

  return {
    complete: incompleteTargets.length === 0,
    host: request.host,
    hostContext: request.hostContext,
    incompleteTargets,
    manifestId: admission.manifestId,
    ok: true,
    operation: 'apply',
    outcomes,
    postInspect,
    protocolVersion: 1,
    retainedBackups,
    root: request.root,
    snapshotId: request.inspection.snapshotId,
    versionControlChoice: request.versionControlChoice,
    warnings,
  }
}

function lockRecord(request, root, pid, ownerNonce, manifestId, temporaryPathsValue, unfinalizedDirectories) {
  return { createdAtUnixMs: Date.now(), manifestId, operation: 'apply', ownerNonce, pid, protocolVersion: 1, recoveryId: null, root, temporaryPaths: temporaryPathsValue.map((path) => relativeArtifact(root, path)).sort(compareOrdinal), unfinalizedDirectories: unfinalizedDirectories.sort((left, right) => compareOrdinal(left.target, right.target)) }
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
  const current = stableOpenFile(root, lock.paths.lock, { ...options, requireSingleLink: true })
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
      verifyLockState(root, lock, options)
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
    }
    verifyLockState(root, lock, options)
    removeAndVerify(lock.paths.lock, options)
  } catch (error) {
    publicationError('Publication lock cleanup failed.', { code: 'cleanup-failed', phase: 'cleanup', manifestId: lock.manifestId, recovery: { retainedBackups: [], status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Publication lock requires manual cleanup.', target: relativeArtifact(root, lock.paths.lock) }] } }, error)
  }
}

function markerBytes(request, admission, root) {
  const snapshotId = request.inspection.snapshotId ?? sha256(Buffer.from(canonicalJson(request.inspection.git ?? {}), 'utf8'))
  const marker = composeElectionMarker(admission.electionMarker.state, request.inspection.git?.kind ?? 'git', true, snapshotId, request.inspection.git?.electionMarkerMode ?? 0o600, root)

  return Buffer.from(marker.contentBase64, 'base64')
}

function markerMode(options, mode) {
  return (options.platform ?? process.platform) === 'win32' ? null : mode
}

function markerOwnership(root, path, bytes, mode, options, linkCount, peers = []) {
  const opened = stableOpenFile(root, path, { ...options, requireSingleLink: false })
  const metadata = lstatSync(path, { bigint: true })
  if (!opened.bytes.equals(bytes) || mode !== null && opened.mode !== mode || metadata.nlink !== BigInt(linkCount)) throw new Error('Election marker temporary differs from its approved image')
  for (const peer of peers) {
    const peerOpened = stableOpenFile(root, peer, { ...options, requireSingleLink: false })
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
  stageFile(path, bytes, { ...options, onTransition: (point) => transition(options, point) })
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

function markerPathPresent(path) {
  try {
    lstatSync(path)

    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function markerOldBytes(request, root) {
  const carriedGit = request.inspection.git ?? {}
  if (carriedGit.electionMarker === undefined || carriedGit.electionMarker === 'absent') return null
  const carriedSnapshotId = carriedGit.electionMarkerSnapshotId ?? request.inspection.snapshotId
  const carried = composeElectionMarker(carriedGit.electionMarker, carriedGit.kind ?? 'git', true, carriedSnapshotId, carriedGit.electionMarkerMode, root)

  return Buffer.from(carried.contentBase64, 'base64')
}

function adoptMarkerTemporaries(root, existing, paths, finalBytes, finalMode, oldBytes, oldMode, options, ownedTemporaries) {
  if (existing === null) return
  const read = (path) => {
    try { return stableOpenFile(root, path, { ...options, requireSingleLink: false }) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
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
  const opened = stableOpenFile(root, path, { ...options, requireSingleLink: true })
  let record
  try { record = JSON.parse(opened.bytes.toString('utf8')) } catch (error) { throw new Error('Bootstrap stage record is invalid', { cause: error }) }
  const next = join(root, `.nightshift-init-backlog.lock.${existingRecord.ownerNonce}.next`)
  const expectedPaths = [relativeArtifact(root, path), relativeArtifact(root, next)].sort(compareOrdinal)
  const expectedKeys = ['createdAtUnixMs', 'manifestId', 'operation', 'ownerNonce', 'pid', 'protocolVersion', 'recoveryId', 'root', 'temporaryPaths', 'unfinalizedDirectories'].sort(compareOrdinal)
  if (record === null || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).sort(compareOrdinal).join('\0') !== expectedKeys.join('\0') || record.createdAtUnixMs < 0 || !Number.isSafeInteger(record.createdAtUnixMs) || record.manifestId !== null || record.operation !== 'apply' || record.ownerNonce !== existingRecord.ownerNonce || record.pid !== existingRecord.pid || record.protocolVersion !== 1 || record.recoveryId !== null || record.root !== root || canonicalJson(record.temporaryPaths) !== canonicalJson(expectedPaths) || canonicalJson(record.unfinalizedDirectories) !== '[]' || !Buffer.from(`${canonicalJson(record)}\n`, 'utf8').equals(opened.bytes) || (options.platform ?? process.platform) !== 'win32' && opened.mode !== 0o600) throw new Error('Bootstrap stage record is invalid')
  ownedTemporaries.set(path, { bytes: Buffer.from(opened.bytes), destination: null, identity: opened.identity, mode: (options.platform ?? process.platform) === 'win32' ? null : 0o600, requireSingleLink: true })
}

function adoptPendingLockUpgrade(root, existing, expectedRecord, path, options, ownedTemporaries) {
  if (existing === null || existing.record.manifestId !== null) return { bytes: Buffer.from(`${canonicalJson(expectedRecord)}\n`, 'utf8'), record: expectedRecord }
  try {
    const opened = stableOpenFile(root, path, { ...options, requireSingleLink: true })
    const record = JSON.parse(opened.bytes.toString('utf8'))
    const expected = { ...expectedRecord, createdAtUnixMs: record?.createdAtUnixMs }
    if (record === null || typeof record !== 'object' || Array.isArray(record) || !Number.isSafeInteger(record.createdAtUnixMs) || record.createdAtUnixMs < 0 || canonicalJson(record) !== canonicalJson(expected) || (options.platform ?? process.platform) !== 'win32' && opened.mode !== 0o600) throw new Error('Pending lock upgrade differs from the approved manifest')
    ownedTemporaries.set(path, { bytes: Buffer.from(opened.bytes), destination: null, identity: opened.identity, mode: (options.platform ?? process.platform) === 'win32' ? null : 0o600, requireSingleLink: true })

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
      try {
        opened = stableOpenFile(root, path, { ...options, requireSingleLink: true })
      } catch (error) {
        const metadata = lstatSync(path, { bigint: true })
        if (expected.destination === null || metadata.nlink !== 2n) throw error
        opened = stableOpenFile(root, path, { ...options, requireSingleLink: false })
        const destination = stableOpenFile(root, expected.destination, { ...options, requireSingleLink: false })
        if (destination.identity !== opened.identity || !destination.bytes.equals(expected.bytes) || expected.mode !== null && destination.mode !== expected.mode) throw error
        requireSingleLink = false
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
  const carriedState = carriedGit.electionMarker
  const oldBytes = markerOldBytes(request, root)
  const oldMode = markerMode(options, carriedGit.electionMarkerMode ?? 0o600)
  let mode = markerMode(options, ownerMode)
  const markerPresent = markerPathPresent(path)
  const tombstonePresent = markerPathPresent(paths.electionTombstone)
  if (tombstonePresent && !markerPresent && !markerPathPresent(paths.electionAlias)) return false
  if (markerPresent) {
    const current = stableOpenFile(root, path, { ...options, requireSingleLink: false })
    if (current.bytes.equals(bytes) && (mode === null || current.mode === mode)) {
      if (markerPathPresent(paths.electionNewWitness)) {
        if (markerPathPresent(paths.electionAlias)) {
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
  if (!markerPathPresent(paths.electionAlias)) stageMarkerAlias(root, paths.electionAlias, bytes, mode, options)
  if (!markerPathPresent(paths.electionNewWitness)) linkMarkerPath(root, paths.electionAlias, paths.electionNewWitness, bytes, mode, options, 'after-marker-new-witness')
  if (markerPathPresent(path)) {
    const current = stableOpenFile(root, path, { ...options, requireSingleLink: false })
    if (oldBytes === null || !current.bytes.equals(oldBytes) || oldMode !== null && current.mode !== oldMode) throw new Error('Election marker differs from the approved carried marker')
    const replacementTarget = stableOpenFile(root, path, { ...options, requireSingleLink: false })
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
  const mode = markerMode(options, request.inspection.git?.electionMarkerMode ?? 0o600)
  options.verifyLock?.()
  if (markerPathPresent(path)) {
    const current = stableOpenFile(root, path, { ...options, requireSingleLink: false })
    if (!current.bytes.equals(expected) || mode !== null && current.mode !== mode) throw new Error('Election marker changed before cleanup')
    const witness = options.ownedTemporaries?.get(paths.electionNewWitness)
    if (witness !== undefined && witness.identity !== current.identity) throw new Error(request.inspection.git?.electionMarker === 'absent' ? 'Published target shares an unexpected temporary identity' : 'Election marker changed before cleanup')
    if (markerPathPresent(paths.electionTombstone)) throw new Error('Election marker tombstone state is invalid')
    options.verifyLock?.()
    renameVerified(path, paths.electionTombstone, expected, { ...options, onTransition: (point) => transition(options, point) })
    markerOwnership(root, paths.electionTombstone, expected, mode, options, markerPathPresent(paths.electionNewWitness) ? 2 : 1, markerPathPresent(paths.electionNewWitness) ? [paths.electionNewWitness] : [])
    if (markerPathPresent(paths.electionNewWitness)) markerOwnership(root, paths.electionNewWitness, expected, mode, options, 2, [paths.electionTombstone])
    transition(options, 'after-marker-unlink')
    transition(options, 'after-marker-terminal-rename')
    transition(options, 'after-marker-removal')
  }
  if (markerPathPresent(paths.electionNewWitness)) {
    const owned = options.ownedTemporaries?.get(paths.electionNewWitness)
    if (owned === undefined) throw new Error('Election marker witness ownership is not proven')
    const tombstone = markerPathPresent(paths.electionTombstone) ? paths.electionTombstone : null
    verifyOwnedTemporary(root, paths.electionNewWitness, owned, options)
    if (tombstone !== null) markerOwnership(root, paths.electionNewWitness, expected, mode, options, 2, [tombstone])
    removeOwnedTemporary(root, paths.electionNewWitness, options)
    if (markerPathPresent(paths.electionTombstone)) markerOwnership(root, paths.electionTombstone, expected, mode, options, 1)
    transition(options, 'after-marker-witness-removal')
  }
  if (markerPathPresent(paths.electionTombstone)) {
    const owned = options.ownedTemporaries?.get(paths.electionTombstone)
    if (owned === undefined) throw new Error('Election marker tombstone ownership is not proven')
    verifyOwnedTemporary(root, paths.electionTombstone, owned, options)
    removeOwnedTemporary(root, paths.electionTombstone, options)
    transition(options, 'after-marker-tombstone-removal')
  }
  if (options.ownedTemporaries?.has(paths.electionOldWitness)) removeOwnedTemporary(root, paths.electionOldWitness, options)
}

function currentInspection(request, root, options) {
  if (typeof options.collectInspection === 'function') return options.collectInspection(root, request.host, request.hostContext, options)

  return collectInspection(root, request.host, request.hostContext, options)
}

function resumeInspectionProjection(inspection, actionTargets, markerStates) {
  const git = { ...inspection.git }
  if (git.electionMarker !== undefined && markerStates.values.has(git.electionMarker)) {
    git.electionMarker = markerStates.carried
    git.electionMarkerMode = markerStates.mode
    git.electionMarkerSnapshotId = markerStates.snapshotId
  }

  return {
    ...inspection,
    git,
    snapshotId: null,
    targets: (inspection.targets ?? []).map((record) => actionTargets.has(record.target) ? { target: record.target, kind: record.kind, mode: record.mode } : record),
  }
}

function allActionsComplete(request, admission, root, options) {
  for (const action of admission.actions) {
    const path = targetPath(root, action.target)
    if (action.kind === 'ensure-directory') {
      const mode = (options.platform ?? process.platform) === 'win32' ? null : action.mode
      if (!targetMatchesOutput(root, path, 'directory', null, mode, options)) return false
      continue
    }
    const bytes = actionAfter(request, action, root, options)
    const mode = (options.platform ?? process.platform) === 'win32' ? null : action.mode ?? POSIX_DEFAULT_FILE_MODE
    if (bytes === null || !targetMatchesOutput(root, path, 'file', bytes, mode, options)) return false
  }

  return true
}

function hasTerminalMarkerEvidence(request, admission, root, existing, paths, expectedBytes, expectedMode, options) {
  if (existing === null || existing.record.manifestId === null) return false
  const inventory = new Set(existing.record.temporaryPaths)
  const requiredPaths = [paths.electionAlias, paths.electionNewWitness, paths.electionTombstone]
  if (request.inspection.git?.electionMarker !== undefined && request.inspection.git.electionMarker !== 'absent') requiredPaths.push(paths.electionOldWitness)
  const required = requiredPaths.map((path) => relativeArtifact(root, path))
  if (required.some((path) => !inventory.has(path))) return false
  const relativeTombstone = relativeArtifact(root, paths.electionTombstone)
  const relativeWitness = relativeArtifact(root, paths.electionNewWitness)
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
    const tombstone = stableOpenFile(root, paths.electionTombstone, { ...options, requireSingleLink: false })
    if (!tombstone.bytes.equals(expectedBytes) || expectedMode !== null && tombstone.mode !== expectedMode) return false
    const tombstoneMetadata = lstatSync(paths.electionTombstone, { bigint: true })
    if (!present(paths.electionNewWitness)) return tombstoneMetadata.nlink === 1n
    const witness = stableOpenFile(root, paths.electionNewWitness, { ...options, requireSingleLink: false })
    const witnessMetadata = lstatSync(paths.electionNewWitness, { bigint: true })

    return tombstoneMetadata.nlink === 2n && witnessMetadata.nlink === 2n && witness.identity === tombstone.identity && witness.bytes.equals(expectedBytes) && (expectedMode === null || witness.mode === expectedMode)
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function validateResumeInspection(request, liveInspection, admission, terminalMarkerEvidence = false) {
  const actionTargets = new Set(admission.actions.map((action) => action.target))
  const carriedGit = request.inspection.git ?? {}
  const markerStates = { carried: carriedGit.electionMarker, mode: carriedGit.electionMarkerMode, snapshotId: carriedGit.electionMarkerSnapshotId, values: new Set([carriedGit.electionMarker, admission.electionMarker.state]) }
  if (terminalMarkerEvidence) markerStates.values.add('absent')
  if (liveInspection.git?.electionMarker !== undefined && !markerStates.values.has(liveInspection.git.electionMarker)) publicationError('Live election marker differs from the approved resume state.', { code: 'snapshot-drift', phase: 'prevalidate', manifestId: admission.manifestId })
  if (canonicalJson(resumeInspectionProjection(request.inspection, actionTargets, markerStates)) !== canonicalJson(resumeInspectionProjection(liveInspection, actionTargets, markerStates))) {
    publicationError('Live repository differs from the approved resume state.', { code: 'snapshot-drift', phase: 'prevalidate', manifestId: admission.manifestId })
  }
}

function readExistingLock(root, path, options) {
  try {
    const opened = stableOpenFile(root, path, options)
    const record = JSON.parse(opened.bytes.toString('utf8'))

    return { bytes: opened.bytes, record }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function publishApply(request, options = {}) {
  const root = canonicalRoot(request.root)
  let admission
  try {
    liveInspection = options.currentInspection ?? currentInspection(request, root, options)
    admission = admitApplyManifest(request, { ...options, currentInspection: options.resume === true ? request.inspection : liveInspection })
  } catch (error) {
    if (error instanceof InitBacklogError) throw error
    publicationError('Apply manifest prevalidation failed.', { code: 'manifest-invalid', phase: 'prevalidate' }, error)
  }
  const pid = options.pid ?? process.pid
  let ownerNonce = options.ownerNonce ?? randomBytes(16).toString('hex')
  let lockHint = null
  try {
    lockHint = options.resume === true ? readExistingLock(root, join(root, LOCK_BASENAME), options) : null
  } catch (error) {
    publicationError('Existing publication lock is not trustworthy.', { code: 'runtime-lock', phase: 'lock', manifestId: admission.manifestId, target: LOCK_BASENAME }, error)
  }
  if (lockHint !== null) ownerNonce = lockHint.record.ownerNonce
  const allActions = request.actions ?? []
  const fixed = temporaryPaths(root, admission.manifestId, 1, ownerNonce, request.inspection.snapshotId, pid)
  const actionTemps = allActions.map((action, index) => targetPath(root, action.target) && join(root, action.target.includes('/') ? action.target.slice(0, action.target.lastIndexOf('/')) : '.', `.nightshift-init-backlog.${admission.manifestId}.${index + 1}.tmp`))
  const unfinalizedDirectories = allActions.filter((action) => action.kind === 'ensure-directory').map((action) => ({ mode: action.mode, target: action.target }))
  const markerTemporaries = admission.electionMarker.state === 'absent' ? [] : [fixed.electionAlias, fixed.electionNewWitness, ...(request.inspection.git?.electionMarker !== undefined && request.inspection.git?.electionMarker !== 'absent' ? [fixed.electionOldWitness] : []), fixed.electionTombstone]
  const tempSet = [...actionTemps, fixed.lockStage, fixed.lockNext, ...markerTemporaries]
  const targets = allActions.map((action) => targetPath(root, action.target))
  const existing = lockHint
  let terminalMarkerEvidence = false
  let terminalMarkerComplete = false
  if (options.resume === true) {
    terminalMarkerEvidence = admission.electionMarker.state !== 'absent' && hasTerminalMarkerEvidence(request, admission, root, existing, fixed, markerBytes(request, admission, root), markerMode(options, request.inspection.git?.electionMarkerMode ?? 0o600), options)
    terminalMarkerComplete = terminalMarkerEvidence && !markerPathPresent(fixed.electionTombstone) && !markerPathPresent(fixed.electionNewWitness)
    validateResumeInspection(request, liveInspection, admission, terminalMarkerEvidence)
  }
  try {
    if (new Set(tempSet).size !== tempSet.length || tempSet.some((path) => targets.includes(path))) publicationError('Derived publication temporary collides with a target.', { code: 'manifest-invalid', phase: 'prevalidate', manifestId: admission.manifestId })
    if (options.resume !== true) requireReservedTemporariesAbsent(root, tempSet)
    if (options.resume === true && lockHint?.record.manifestId === null) requireReservedTemporariesAbsent(root, tempSet, new Set([fixed.lockStage, fixed.lockNext]))
  } catch (error) {
    if (lock !== null && options.crash !== true && options.preserveLockOnError !== true) {
      try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
    }
    throw error
  }
  let states
  try {
    states = initialStates(request.inspection, root, options)
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
          registerTemporary(root, ownedTemporaries, fixed.lockStage, existing.bytes, options, false, (options.platform ?? process.platform) === 'win32' ? null : 0o600)
          const stage = ownedTemporaries.get(fixed.lockStage)
          stage.linkCount = 2
          stage.peers = [fixed.lock]
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
      lock = { bytes: existing.bytes, identity: existing.identity, manifestId: existing.record.manifestId, mode: existing.mode, ownerNonce, paths: resumedPaths, pid, record: existing.record, temporaryPaths: existing.record.temporaryPaths }
    } else if (lock === null) {
      notifyWrite(options, fixed.lockStage)
      lock = createInitialLock(root, bootstrap, { ...options, ownerNonce, pid, onTransition: (point) => transition(options, point) })
    }
    const upgraded = lockRecord(request, root, pid, ownerNonce, admission.manifestId, tempSet, unfinalizedDirectories)
    const upgradedBytes = Buffer.from(`${canonicalJson(upgraded)}\n`, 'utf8')
    const alreadyUpgraded = lock.record?.manifestId === admission.manifestId && canonicalJson(lock.record.temporaryPaths ?? []) === canonicalJson(upgraded.temporaryPaths) && canonicalJson(lock.record.unfinalizedDirectories ?? []) === canonicalJson(upgraded.unfinalizedDirectories)
    if (!alreadyUpgraded) {
      if (ownedTemporaries.has(fixed.lockNext)) {
        verifyOwnedTemporary(root, fixed.lockNext, ownedTemporaries.get(fixed.lockNext), options)
      } else {
        notifyWrite(options, fixed.lockNext)
        stageFile(fixed.lockNext, upgradedBytes, { ...options, onTransition: (point) => transition(options, point) })
        readBackExact(fixed.lockNext, upgradedBytes, options)
        assignAndVerifyMode(fixed.lockNext, 0o600, options)
        registerTemporary(root, ownedTemporaries, fixed.lockNext, upgradedBytes, options, true, (options.platform ?? process.platform) === 'win32' ? null : 0o600)
      }
      const expectedUpgradeIdentity = ownedTemporaries.get(fixed.lockNext)?.identity
      const currentLock = stableOpenFile(root, fixed.lock, { ...options, requireSingleLink: lock.record?.manifestId !== null })
      const currentLockMetadata = lstatSync(fixed.lock, { bigint: true })
      if (lock.record?.manifestId !== null && currentLockMetadata.nlink !== 1n || lock.record?.manifestId === null && currentLockMetadata.nlink !== 1n && currentLockMetadata.nlink !== 2n || currentLock.identity !== lock.identity || !currentLock.bytes.equals(lock.bytes) || (options.platform ?? process.platform) !== 'win32' && currentLock.mode !== lock.mode) throw new Error('Publication lock changed before upgrade')
      if (lock.record?.manifestId === null && currentLockMetadata.nlink === 2n) {
        const stage = ownedTemporaries.get(fixed.lockStage)
        if (stage === undefined) throw new Error('Publication bootstrap stage ownership is not proven')
        const currentStage = verifyOwnedTemporary(root, fixed.lockStage, stage, options, false)
        if (currentStage.identity !== currentLock.identity) throw new Error('Publication lock changed before upgrade')
      }
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
      const upgradedReadback = stableOpenFile(root, fixed.lock, { ...options, requireSingleLink: true })
      if (!upgradedReadback.bytes.equals(upgradedBytes) || expectedUpgradeIdentity !== undefined && upgradedReadback.identity !== expectedUpgradeIdentity) throw new Error('Upgraded publication lock identity differs')
      lock.bytes = upgradedBytes
      lock.manifestId = admission.manifestId
      lock.temporaryPaths = tempSet
      lock.record = upgraded
      removeAndVerify(fixed.lockNext, options)
      transition(options, 'after-lock-upgrade')
    }
    const expectedTemporaries = new Map([[fixed.lockNext, { bytes: upgradedBytes, destination: null, mode: (options.platform ?? process.platform) === 'win32' ? null : 0o600 }], [fixed.lockStage, { bytes: null, destination: null, mode: null }]])
    for (let index = 0; index < allActions.length; index += 1) {
      const action = allActions[index]
      const bytes = actionAfter(request, action, root, options)
      expectedTemporaries.set(actionTemps[index], { bytes, destination: targetPath(root, action.target), mode: bytes === null || (options.platform ?? process.platform) === 'win32' ? null : action.mode ?? POSIX_DEFAULT_FILE_MODE })
    }
    if (admission.electionMarker.state !== 'absent') {
      const finalMarkerBytes = markerBytes(request, admission, root)
      const finalMarkerMode = markerMode(options, request.inspection.git?.electionMarkerMode ?? 0o600)
      expectedTemporaries.set(fixed.electionAlias, { bytes: finalMarkerBytes, destination: null, mode: finalMarkerMode, marker: true })
      expectedTemporaries.set(fixed.electionNewWitness, { bytes: finalMarkerBytes, destination: null, mode: finalMarkerMode, marker: true })
      expectedTemporaries.set(fixed.electionTombstone, { bytes: finalMarkerBytes, destination: null, mode: finalMarkerMode, marker: true })
      if (markerTemporaries.includes(fixed.electionOldWitness)) expectedTemporaries.set(fixed.electionOldWitness, { bytes: markerOldBytes(request, root), destination: null, mode: markerMode(options, request.inspection.git?.electionMarkerMode ?? 0o600), marker: true })
    }
    adoptResumeTemporaries(root, existing, expectedTemporaries, options, ownedTemporaries, fixed.lockStage, fixed.lockNext)
    if (admission.electionMarker.state !== 'absent') {
      adoptMarkerTemporaries(root, existing, fixed, markerBytes(request, admission, root), markerMode(options, request.inspection.git?.electionMarkerMode ?? 0o600), markerOldBytes(request, root), markerMode(options, request.inspection.git?.electionMarkerMode ?? 0o600), { ...options, ownedTemporaries }, ownedTemporaries)
    }
    const publicationOptions = { ...options, ownedTemporaries, verifyLock: () => verifyLockState(root, lock, options), onTemporaryStaged: (path, bytes, mode) => registerTemporary(root, ownedTemporaries, path, bytes, options, true, mode), onTemporaryRemoved: (path) => { ownedTemporaries.delete(path) } }
    retainedBackups = []
    const cleanupUnwrapBackups = () => {
      try {
        for (const action of unwrapActions) {
          const backup = backupTarget(action.target, request.inspection.snapshotId, admission.manifestId)
          removeOwnedTemporary(root, targetPath(root, backup), publicationOptions)
          retainedBackups = retainedBackups.filter((target) => target !== backup)
        }
      } catch (error) {
        retainedBackups = retainedBackupPaths(root, retainedBackups)
        publicationError('Unwrap backup cleanup failed after ready verification.', { code: 'cleanup-failed', phase: 'cleanup', manifestId: admission.manifestId, outcomes, recovery: { retainedBackups, status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Unwrap backups require manual cleanup.', target: null }] } }, error)
      }

      retainedBackups = []
    }
    const rollbackUnwrapAfterVerification = (error = null) => {
      try {
        restoreUnwrapBatch(root, unwrapActions, admission.manifestId, request.inspection.snapshotId, publicationOptions)
      } catch (restoreError) {
        retainedBackups = retainedBackupPaths(root, retainedBackups)
        publicationError('Unwrap restoration failed after ready verification drift.', { code: 'restore-failed', phase: 'restore', manifestId: admission.manifestId, outcomes, recovery: { retainedBackups, status: 'restore-failed', warnings: [{ code: 'manual-cleanup', detail: 'Unwrap backups require manual cleanup after restoration failure.', target: null }] } }, restoreError)
      }
      cleanupUnwrapBackups()
      const recovery = { retainedBackups: [], status: 'restored', warnings: [] }
      if (error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify') {
        throwEnrichedReadyFailure(error, admission.manifestId, outcomes, recovery)
      }
      if (error !== null) publicationError('Post-publication ready verification failed.', { code: 'ready-failed', phase: 'verify', manifestId: admission.manifestId, outcomes, recovery }, error)
      publicationError('Predicted ready result differs after unwrap publication.', { code: 'ready-delta', phase: 'verify', manifestId: admission.manifestId, outcomes })
    }
    if (backupPaths.length !== 0) {
      publicationOptions.verifyLock?.()
      backupDirectoryCreated = verifyBackupDirectory(root, options)
      for (let index = 0; index < backupPaths.length; index += 1) {
        const action = unwrapActions[index]
        const state = states.get(action.target)
        if (state?.present !== true || state.content === null) throw new Error('Unwrap backup source is unavailable')
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
        registerTemporary(root, ownedTemporaries, backupPath, state.content, options, true, (options.platform ?? process.platform) === 'win32' ? null : state.mode)
        retainedBackups.push(backupTargets[index])
      }
    }
    if (!terminalMarkerComplete) {
      if (markerPathPresent(fixed.electionTombstone)) removeMarker(request, admission, root, publicationOptions, fixed)
      else publishMarker(request, admission, root, admission.manifestId, (options.platform ?? process.platform) === 'win32' ? null : 0o600, publicationOptions, fixed)
    }
    const publishActions = (startIndex, endIndex) => {
      for (let index = startIndex; index < endIndex; index += 1) {
        const action = allActions[index]
        const path = targets[index]
        const state = states.get(action.target) ?? { content: null, kind: action.kind === 'ensure-directory' ? 'directory' : 'file', mode: action.mode, present: false }
        const chain = []
        for (let chainIndex = index; chainIndex < endIndex && allActions[chainIndex].target === action.target; chainIndex += 1) chain.push(allActions[chainIndex])
        if (chain.length > 1 && action.kind !== 'ensure-directory') {
          const terminalBytes = actionAfter(request, chain[chain.length - 1], root, options)
          const terminalMode = (options.platform ?? process.platform) === 'win32' ? null : chain[chain.length - 1].mode ?? state.mode ?? POSIX_DEFAULT_FILE_MODE
          if (terminalBytes !== null && targetMatchesOutput(root, path, 'file', terminalBytes, terminalMode, options)) {
            for (const completed of chain) outcomes.push({ actionId: completed.id, status: 'skipped-complete', target: completed.target })
            state.present = true
            state.content = terminalBytes
            states.set(action.target, state)
            index += chain.length - 1
            continue
          }
        }
        if (action.kind === 'ensure-directory') {
          const approvedMode = (options.platform ?? process.platform) === 'win32' ? null : action.mode
          const already = state.present || targetMatchesOutput(root, path, 'directory', null, approvedMode, options)
          if (!state.present) {
            if (!already) publishDirectory(root, path, approvedMode, publicationOptions)
            state.present = true
          }
          outcomes.push({ actionId: action.id, status: already ? 'skipped-complete' : 'created', target: action.target })
        } else {
          const bytes = actionAfter(request, action, root, options)
          if (bytes === null) publicationError('Approved action has no content image.', { code: 'manifest-invalid', phase: 'prevalidate', manifestId: admission.manifestId, actionId: action.id, target: action.target })
          let already = false
          const effectiveMode = (options.platform ?? process.platform) === 'win32' ? null : action.mode ?? state.mode ?? POSIX_DEFAULT_FILE_MODE
          already = targetMatchesPublishedTemporary(root, path, bytes, effectiveMode, actionTemps[index], publicationOptions) || targetMatchesOutput(root, path, 'file', bytes, effectiveMode, options)
          const expectedContent = state.content ?? actionBefore(request, action, root, options)
          let published
          if (!already) published = publishContent(root, path, bytes, effectiveMode, actionTemps[index], publicationOptions, state.present, expectedContent, state.mode, state.identity)
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
              const current = stableOpenFile(root, path, { ...options, requireSingleLink: true })
              state.identity = current.identity
              state.mode = current.mode
            }
          }
          const status = already ? 'skipped-complete' : action.kind === 'unwrap-file' ? 'unwrapped' : action.kind === 'create-from-template' ? 'created' : 'edited'
          outcomes.push({ actionId: action.id, status, target: action.target })
        }
        states.set(action.target, state)
      }
    }
    const firstRankTwo = allActions.findIndex((action) => action.kind !== 'ensure-directory' && action.kind !== 'unwrap-file')
    const hasUnwrapBatch = unwrapActions.length !== 0
    const unwrapEnd = hasUnwrapBatch && firstRankTwo !== -1 ? firstRankTwo : allActions.length
    publishActions(0, unwrapEnd)
    let postInspect
    try {
      postInspect = currentInspection(request, root, options)
    } catch (error) {
      if (unwrapActions.length !== 0) rollbackUnwrapAfterVerification(error)
      if (error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify') throwEnrichedReadyFailure(error, admission.manifestId, outcomes)
      publicationError('Post-publication ready verification failed.', { code: 'ready-failed', phase: 'verify', manifestId: admission.manifestId, outcomes }, error)
    }
    const expectedUnwrapReady = request.inspection?.unwrapReady?.after
    if (unwrapActions.length !== 0 && expectedUnwrapReady !== undefined && canonicalJson(postInspect.ready ?? null) !== canonicalJson(expectedUnwrapReady)) {
      rollbackUnwrapAfterVerification()
    }
    if (unwrapActions.length !== 0 && expectedUnwrapReady !== undefined) {
      try {
        for (const action of unwrapActions) {
          const backup = backupTarget(action.target, request.inspection.snapshotId, admission.manifestId)
          removeOwnedTemporary(root, targetPath(root, backup), publicationOptions)
          retainedBackups = retainedBackups.filter((target) => target !== backup)
        }
      } catch (error) {
        retainedBackups = retainedBackupPaths(root, retainedBackups)
        publicationError('Unwrap backup cleanup failed after ready verification.', { code: 'cleanup-failed', phase: 'cleanup', manifestId: admission.manifestId, outcomes, recovery: { retainedBackups, status: 'cleanup-failed', warnings: [{ code: 'manual-cleanup', detail: 'Unwrap backups require manual cleanup.', target: null }] } }, error)
      }
      retainedBackups = []
    }
    if (hasUnwrapBatch) {
      publishActions(unwrapEnd, allActions.length)
      try {
        postInspect = currentInspection(request, root, options)
      } catch (error) {
        if (error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify') throwEnrichedReadyFailure(error, admission.manifestId, outcomes)
        publicationError('Post-publication ready verification failed.', { code: 'ready-failed', phase: 'verify', manifestId: admission.manifestId, outcomes }, error)
      }
    }
    if (canonicalJson(postInspect.ready ?? null) !== canonicalJson(admission.ready ?? null)) publicationError('Predicted ready result differs after semantic publication.', { code: 'ready-delta', phase: 'verify', manifestId: admission.manifestId, outcomes })
    if (admission.electionMarker.state !== 'absent' && postInspect.git?.electionMarker !== 'absent' && request.versionControlChoice !== 'deferred' && completePostInspect(postInspect, admission, request).length === 0) {
      removeMarker(request, admission, root, publicationOptions, fixed)
      try {
        postInspect = currentInspection(request, root, options)
      } catch (error) {
        if (error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify') throwEnrichedReadyFailure(error, admission.manifestId, outcomes)
        publicationError('Post-publication ready verification failed.', { code: 'ready-failed', phase: 'verify', manifestId: admission.manifestId, outcomes }, error)
      }
    }
    cleanupOwner(root, lock, options, ownedTemporaries)

    return resultRecord(request, admission, postInspect, outcomes)
  } catch (error) {
    if (error instanceof InitBacklogError) {
      if (options.preserveLockOnError === true || options.crash === true) throw error
      try { cleanupOwner(root, lock, options) } catch { /* Preserve the original typed publication failure. */ }
      throw error
    }
    if (options.preserveLockOnError === true || options.crash === true || options.failAt !== undefined) throw error
    try { cleanupOwner(root, lock, options) } catch (cleanupError) { throw cleanupError }
    publicationError('Publication effect failed.', { code: 'filesystem', phase: 'publish', manifestId: admission.manifestId, outcomes, systemCode: trustedSystemCode(error) }, error)
  }
}

module.exports = { deriveTemporaryPaths, publishApply, temporaryPaths }
