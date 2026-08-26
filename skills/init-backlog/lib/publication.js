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
const RECOVERY_GATE_BASENAME = '.nightshift-init-backlog.recovery-gate'
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

function throwEnrichedReadyFailure(error, manifestId, outcomes) {
  throw new InitBacklogError(failureRecord({ ...error.record, manifestId, outcomes }), { cause: error })
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

function initialStates(inspection, root, options) {
  return new Map((inspection.targets ?? []).map((record) => [record.target, {
    content: readRecordBytes(record),
    identity: record.kind === 'file' && !(record.states ?? []).includes('missing') ? (() => {
      try { return stableOpenFile(root, targetPath(root, record.target), options).identity } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
    })() : null,
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

function allActionsComplete(request, root, options) {
  for (const action of request.actions ?? []) {
    const path = targetPath(root, action.target)
    if (action.kind === 'ensure-directory') {
      const mode = (options.platform ?? process.platform) === 'win32' ? null : action.mode
      if (!targetMatchesOutput(root, path, 'directory', null, mode, options)) return false
      continue
    }
    const bytes = actionAfter(request, action)
    const mode = (options.platform ?? process.platform) === 'win32' ? null : action.mode ?? POSIX_DEFAULT_FILE_MODE
    if (bytes === null || !targetMatchesOutput(root, path, 'file', bytes, mode, options)) return false
  }

  return true
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

function registerTemporary(root, ownedTemporaries, path, bytes, options, requireSingleLink = true) {
  const opened = stableOpenFile(root, path, { ...options, requireSingleLink })
  if (!opened.bytes.equals(bytes)) throw new Error('Staged temporary bytes changed')
  ownedTemporaries.set(path, { bytes: Buffer.from(bytes), identity: opened.identity, requireSingleLink })
}

function verifyOwnedTemporary(root, path, owned, options, requireSingleLink = owned.requireSingleLink) {
  const current = stableOpenFile(root, path, { ...options, requireSingleLink })
  if (current.identity !== owned.identity || !current.bytes.equals(owned.bytes) || owned.mode !== null && current.mode !== owned.mode) throw new Error('Reserved temporary changed before publication')

  return current
}

function removeOwnedTemporary(root, path, options, destination = null) {
  const owned = options.ownedTemporaries?.get(path)
  if (owned === undefined) throw new Error('Reserved temporary ownership is not proven')
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
  notifyWrite(options, path)
  const fileOptions = { ...options, onTransition: (point) => transition(options, point) }
  const adopted = options.ownedTemporaries?.get(temp)
  if (adopted === undefined) {
    stageFile(temp, bytes, fileOptions)
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
  verifyOwnedTemporary(root, temp, staged, options)
  stableTarget(root, path, { content: replace ? expectedContent : null, identity: replace ? expectedIdentity : null, kind: 'file', mode: replace ? expectedMode : null, present: replace }, options)
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

function targetMatchesPublishedTemporary(root, path, bytes, mode, temporary, options) {
  const owned = options.ownedTemporaries?.get(temporary)
  if (owned?.destination !== path) return false
  verifyOwnedTemporary(root, temporary, owned, options, false)
  const metadata = lstatSync(path, { bigint: true })
  const destination = stableOpenFile(root, path, { ...options, requireSingleLink: false })
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
  const effectiveWarnings = [...(postInspect.warnings ?? []), ...warnings]
  if (!effectiveWarnings.some((warning) => warning.code === 'external-writer-window')) effectiveWarnings.push({ code: 'external-writer-window', detail: 'Controlled targets may change during publication.', target: null })
  effectiveWarnings.sort((left, right) => compareOrdinal(left.code, right.code))

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
    warnings: effectiveWarnings,
  }
}

function lockRecord(request, root, pid, ownerNonce, manifestId, temporaryPathsValue, unfinalizedDirectories) {
  return { createdAtUnixMs: Date.now(), manifestId, operation: 'apply', ownerNonce, pid, protocolVersion: 1, recoveryId: null, root, temporaryPaths: temporaryPathsValue.map((path) => relativeArtifact(root, path)).sort(compareOrdinal), unfinalizedDirectories: unfinalizedDirectories.sort((left, right) => compareOrdinal(left.target, right.target)) }
}

function requireReservedTemporariesAbsent(root, temporarySet) {
  for (const path of temporarySet) {
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
      if (owned === undefined) throw new Error('Reserved temporary ownership is not proven')
      const currentTemporary = stableOpenFile(root, temporaryPath, { ...options, requireSingleLink: owned.requireSingleLink })
      if (currentTemporary.identity !== owned.identity || !currentTemporary.bytes.equals(owned.bytes)) throw new Error('Reserved temporary changed before cleanup')
      removeAndVerify(temporaryPath, options)
      ownedTemporaries.delete(temporaryPath)
    }
    verifyLockState(root, lock, { ...options, skipRecoveryGateCheck: true })
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

function adoptResumeTemporaries(root, existing, expectedTemporaries, options, ownedTemporaries, bootstrapStage) {
  if (existing === null) return
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

function publishMarker(request, admission, root, manifestId, ownerMode, options) {
  if (admission.electionMarker.state === 'absent') return
  const path = join(root, ELECTION_BASENAME)
  const temp = join(root, `.nightshift-init-backlog-election.${manifestId}.tmp`)
  const bytes = markerBytes(request, admission, root)
  if (targetMatchesPublishedTemporary(root, path, bytes, ownerMode, temp, options)) return false
  let replace = false
  let mode = ownerMode
  let expectedContent = null
  let expectedIdentity = null
  const carriedGit = request.inspection.git ?? {}
  const carriedState = carriedGit.electionMarker
  const approvedState = carriedState === 'absent' && options.resume === true ? admission.electionMarker.state : carriedState
  const carriedSnapshotId = carriedGit.electionMarkerSnapshotId ?? request.inspection.snapshotId
  const carriedMarker = approvedState === 'absent' ? null : composeElectionMarker(approvedState, carriedGit.kind ?? 'git', true, carriedSnapshotId, carriedGit.electionMarkerMode, root)
  const carriedMode = (options.platform ?? process.platform) === 'win32' ? null : carriedGit.electionMarkerMode ?? 0o600
  try {
    const existing = stableOpenFile(root, path, { ...options, requireSingleLink: true })
    const carriedBytes = carriedMarker === null ? null : Buffer.from(carriedMarker.contentBase64, 'base64')
    if (carriedBytes !== null && existing.bytes.equals(carriedBytes) && (carriedMode === null || existing.mode === carriedMode)) {
      replace = true
      mode = carriedMode
      expectedContent = existing.bytes
      expectedIdentity = existing.identity
    } else if (options.resume === true && existing.bytes.equals(bytes) && (carriedMode === null || existing.mode === carriedMode)) {
      verifyFinalMode(path, carriedMode, options)

      return false
    } else {
      throw new Error('Election marker differs from the approved carried marker')
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    const existing = stableOpenFile(root, path, { ...options, requireSingleLink: true })
    if (existing.bytes.equals(bytes)) {
      verifyFinalMode(path, mode, options)

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
  publishContent(root, path, bytes, mode, temp, options, replace, expectedContent, mode, expectedIdentity)

  return true
}

function removeMarker(request, admission, root, options) {
  const path = join(root, ELECTION_BASENAME)
  const expected = markerBytes(request, admission, root)
  const temporary = join(root, `.nightshift-init-backlog-election.${admission.manifestId}.tmp`)
  if (targetMatchesPublishedTemporary(root, path, expected, null, temporary, options)) {
    removeAndVerify(path, options)
    const owned = options.ownedTemporaries?.get(temporary)
    verifyOwnedTemporary(root, temporary, owned, options, true)
    removeAndVerify(temporary, options)
    options.onTemporaryRemoved?.(temporary)
    transition(options, 'after-marker-removal')

    return
  }
  const current = stableOpenFile(root, path, { ...options, requireSingleLink: true })
  if (!current.bytes.equals(expected)) throw new Error('Election marker changed before cleanup')
  removeAndVerify(path, options)
  transition(options, 'after-marker-removal')
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

function validateResumeInspection(request, liveInspection, admission) {
  const actionTargets = new Set(admission.actions.map((action) => action.target))
  const carriedGit = request.inspection.git ?? {}
  const markerStates = { carried: carriedGit.electionMarker, mode: carriedGit.electionMarkerMode, snapshotId: carriedGit.electionMarkerSnapshotId, values: new Set([carriedGit.electionMarker, admission.electionMarker.state]) }
  if (liveInspection.git?.electionMarker !== undefined && !markerStates.values.has(liveInspection.git.electionMarker)) publicationError('Live election marker differs from the approved resume state.', { code: 'snapshot-drift', phase: 'prevalidate', manifestId: admission.manifestId })
  if (canonicalJson(resumeInspectionProjection(request.inspection, actionTargets, markerStates)) !== canonicalJson(resumeInspectionProjection(liveInspection, actionTargets, markerStates))) {
    publicationError('Live repository differs from the approved resume state.', { code: 'snapshot-drift', phase: 'prevalidate', manifestId: admission.manifestId })
  }
}

function readExistingLock(root, path, options) {
  try {
    const opened = stableOpenFile(root, path, options)
    const record = JSON.parse(opened.bytes.toString('utf8'))
    const keys = ['createdAtUnixMs', 'manifestId', 'operation', 'ownerNonce', 'pid', 'protocolVersion', 'recoveryId', 'root', 'temporaryPaths', 'unfinalizedDirectories']
    if (record === null || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).sort(compareOrdinal).join('\0') !== keys.sort(compareOrdinal).join('\0') || record.protocolVersion !== 1 || record.operation !== 'apply' || record.root !== root || !Number.isSafeInteger(record.pid) || record.pid <= 0 || !/^[a-f0-9]{32}$/.test(record.ownerNonce) || !Number.isSafeInteger(record.createdAtUnixMs) || record.createdAtUnixMs < 0 || record.manifestId !== null && !/^[a-f0-9]{64}$/.test(record.manifestId) || record.recoveryId !== null || !Array.isArray(record.temporaryPaths) || !Array.isArray(record.unfinalizedDirectories)) throw new Error('Publication lock schema is invalid')
    if (!Buffer.from(`${canonicalJson(record)}\n`, 'utf8').equals(opened.bytes)) throw new Error('Publication lock bytes are not canonical')
    if ((options.platform ?? process.platform) !== 'win32' && opened.mode !== 0o600) throw new Error('Publication lock mode is invalid')
    const temporaryPathsValue = [...record.temporaryPaths]
    if (temporaryPathsValue.some((item) => typeof item !== 'string' || !pathIsContained(root, targetPath(root, item))) || new Set(temporaryPathsValue).size !== temporaryPathsValue.length || temporaryPathsValue.some((item, index) => index > 0 && compareOrdinal(temporaryPathsValue[index - 1], item) >= 0)) throw new Error('Publication lock temporary inventory is invalid')
    if (record.unfinalizedDirectories.some((item) => item === null || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).sort(compareOrdinal).join('\0') !== 'mode\0target' || typeof item.target !== 'string' || !Number.isSafeInteger(item.mode) && item.mode !== null || item.mode !== null && (item.mode < 0 || item.mode > 4095) || !pathIsContained(root, targetPath(root, item.target))) || record.unfinalizedDirectories.some((item, index) => index > 0 && compareOrdinal(record.unfinalizedDirectories[index - 1].target, item.target) >= 0)) throw new Error('Publication lock directory inventory is invalid')
    const lockMetadata = lstatSync(path, { bigint: true })
    const bootstrapStage = initialLockPaths(root, record.pid, record.ownerNonce).stage
    if (record.manifestId === null) {
      let stage
      try { stage = stableOpenFile(root, bootstrapStage, options) } catch (error) { if (error?.code !== 'ENOENT') throw error }
      if (lockMetadata.nlink !== 1n && lockMetadata.nlink !== 2n || lockMetadata.nlink === 2n && (stage === undefined || stage.identity !== opened.identity || !stage.bytes.equals(opened.bytes))) throw new Error('Bootstrap lock identity is invalid')
      if (lockMetadata.nlink === 1n && stage !== undefined) throw new Error('Bootstrap lock stage is not linked to its owner')
    } else if (lockMetadata.nlink !== 1n) {
      throw new Error('Upgraded publication lock identity is invalid')
    }

    return { bytes: opened.bytes, identity: opened.identity, mode: (options.platform ?? process.platform) === 'win32' ? null : opened.mode, record }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function publishApply(request, options = {}) {
  const root = canonicalRoot(request.root)
  let pid = options.pid ?? process.pid
  let ownerNonce = options.ownerNonce ?? randomBytes(16).toString('hex')
  let lockHint = null
  verifyRecoveryGateAbsent(root)
  try {
    lockHint = readExistingLock(root, join(root, LOCK_BASENAME), options)
  } catch (error) {
    publicationError('Existing publication lock is not trustworthy.', { code: 'runtime-lock', phase: 'lock', target: LOCK_BASENAME }, error)
  }
  if (lockHint !== null && options.resume === true) {
    ownerNonce = lockHint.record.ownerNonce
    pid = lockHint.record.pid
  }
  const bootstrapPaths = initialLockPaths(root, pid, ownerNonce)
  const bootstrap = lockRecord(request, root, pid, ownerNonce, null, [bootstrapPaths.stage, join(root, `.nightshift-init-backlog.lock.${ownerNonce}.next`)], [])
  let lock = null
  const ownedTemporaries = new Map()
  const outcomes = []
  try {
    if (options.resume !== true) {
      try {
        lstatSync(bootstrapPaths.lock)
        publicationError('Publication lock is already present.', { code: 'runtime-lock', phase: 'lock', target: LOCK_BASENAME })
      } catch (error) {
        if (error instanceof InitBacklogError) throw error
        if (error?.code !== 'ENOENT') throw error
      }
      const initial = createInitialLock(root, bootstrap, { ...options, beforePublish: () => verifyRecoveryGateAbsent(root), ownerNonce, pid, onTransition: (point) => transition(options, point) })
      const initialReadback = stableOpenFile(root, bootstrapPaths.lock, { ...options, requireSingleLink: true })
      lock = { bytes: initial.bytes, identity: initialReadback.identity, manifestId: null, mode: (options.platform ?? process.platform) === 'win32' ? null : initialReadback.mode, ownerNonce, paths: bootstrapPaths, pid, record: bootstrap, temporaryPaths: bootstrap.temporaryPaths }
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
    liveInspection = options.currentInspection ?? currentInspection(request, root, options)
    verifyRecoveryGateAbsent(root)
    admission = admitApplyManifest(request, { ...options, currentInspection: options.resume === true ? request.inspection : liveInspection })
    if (options.resume === true) validateResumeInspection(request, liveInspection, admission)
  } catch (error) {
    if (lock !== null && options.crash !== true && options.preserveLockOnError !== true) {
      try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
    }
    if (error instanceof InitBacklogError) throw error
    publicationError('Apply manifest prevalidation failed.', { code: 'manifest-invalid', phase: 'prevalidate' }, error)
  }
  if (lockHint !== null && options.resume === true) {
    ownerNonce = lockHint.record.ownerNonce
    pid = lockHint.record.pid
  }
  const allActions = request.actions ?? []
  const fixed = temporaryPaths(root, admission.manifestId, 1, ownerNonce, request.inspection.snapshotId, pid)
  const actionTemps = allActions.map((action, index) => targetPath(root, action.target) && join(root, action.target.includes('/') ? action.target.slice(0, action.target.lastIndexOf('/')) : '.', `.nightshift-init-backlog.${admission.manifestId}.${index + 1}.tmp`))
  const unfinalizedDirectories = allActions.filter((action) => action.kind === 'ensure-directory').map((action) => ({ mode: action.mode, target: action.target }))
  const markerTemporaries = admission.electionMarker.state === 'absent' ? [] : [fixed.electionAlias, fixed.electionNewWitness, ...(request.inspection.git?.electionMarker !== undefined && request.inspection.git?.electionMarker !== 'absent' ? [fixed.electionOldWitness] : []), fixed.electionTombstone]
  const tempSet = [...actionTemps, fixed.lockStage, fixed.lockNext, ...markerTemporaries]
  const targets = allActions.map((action) => targetPath(root, action.target))
  try {
    verifyRecoveryGateAbsent(root)
    if (new Set(tempSet).size !== tempSet.length || tempSet.some((path) => targets.includes(path))) publicationError('Derived publication temporary collides with a target.', { code: 'manifest-invalid', phase: 'prevalidate', manifestId: admission.manifestId })
    if (options.resume !== true) requireReservedTemporariesAbsent(root, tempSet)
  } catch (error) {
    if (lock !== null && options.crash !== true && options.preserveLockOnError !== true) {
      try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
    }
    throw error
  }
  const states = initialStates(request.inspection, root, options)
  try {
    const existing = lockHint
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
          lstatSync(fixed.lockStage)
          registerTemporary(root, ownedTemporaries, fixed.lockStage, existing.bytes, options, false)
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
      }
      lock = { bytes: existing.bytes, manifestId: existing.record.manifestId, ownerNonce, paths: resumedPaths, pid, record: existing.record, temporaryPaths: existing.record.temporaryPaths }
    } else {
      notifyWrite(options, fixed.lockStage)
      lock = createInitialLock(root, bootstrap, { ...options, beforePublish: () => verifyRecoveryGateAbsent(root), ownerNonce, pid, onTransition: (point) => transition(options, point) })
      const initialReadback = stableOpenFile(root, bootstrapPaths.lock, { ...options, requireSingleLink: true })
      lock.identity = initialReadback.identity
      lock.mode = (options.platform ?? process.platform) === 'win32' ? null : initialReadback.mode
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
        stageFile(fixed.lockNext, upgradedBytes, { ...options, onTransition: (point) => transition(options, point) })
        readBackExact(fixed.lockNext, upgradedBytes, options)
        assignAndVerifyMode(fixed.lockNext, 0o600, options)
        registerTemporary(root, ownedTemporaries, fixed.lockNext, upgradedBytes, options, true, (options.platform ?? process.platform) === 'win32' ? null : 0o600)
      }
      const currentLock = stableOpenFile(root, fixed.lock, { ...options, requireSingleLink: lock.record?.manifestId !== null })
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
      const upgradedReadback = stableOpenFile(root, fixed.lock, { ...options, requireSingleLink: true })
      if (!upgradedReadback.bytes.equals(upgradedBytes)) throw new Error('Upgraded publication lock differs')
      lock.bytes = upgradedBytes
      lock.identity = upgradedReadback.identity
      lock.manifestId = admission.manifestId
      lock.mode = (options.platform ?? process.platform) === 'win32' ? null : upgradedReadback.mode
      lock.temporaryPaths = tempSet
      lock.record = upgraded
      verifyRecoveryGateAbsent(root)
      removeAndVerify(fixed.lockNext, options)
      ownedTemporaries.delete(fixed.lockNext)
      transition(options, 'after-lock-upgrade')
    }
    const expectedTemporaries = new Map([[fixed.lockNext, { bytes: upgradedBytes, destination: null, mode: 0o600 }], [fixed.lockStage, { bytes: null, destination: null, mode: null }]])
    for (let index = 0; index < allActions.length; index += 1) {
      const action = allActions[index]
      const bytes = actionAfter(request, action)
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
        const bytes = actionAfter(request, action)
        if (bytes === null) publicationError('Approved action has no content image.', { code: 'manifest-invalid', phase: 'prevalidate', manifestId: admission.manifestId, actionId: action.id, target: action.target })
        let already = false
        const effectiveMode = (options.platform ?? process.platform) === 'win32' ? null : action.mode ?? state.mode ?? POSIX_DEFAULT_FILE_MODE
        already = targetMatchesPublishedTemporary(root, path, bytes, effectiveMode, actionTemps[index], publicationOptions) || targetMatchesOutput(root, path, 'file', bytes, effectiveMode, options)
        const expectedContent = state.content ?? (action.beforeBase64 === null || action.beforeBase64 === undefined ? null : Buffer.from(action.beforeBase64, 'base64'))
        if (!already) publishContent(root, path, bytes, effectiveMode, actionTemps[index], publicationOptions, state.present, expectedContent, state.mode, state.identity)
        state.present = true
        state.content = bytes
        const status = already ? 'skipped-complete' : action.kind === 'unwrap-file' ? 'unwrapped' : action.kind === 'create-from-template' ? 'created' : 'edited'
        outcomes.push({ actionId: action.id, status, target: action.target })
      }
      states.set(action.target, state)
    }
    let postInspect
    try {
      postInspect = currentInspection(request, root, options)
    } catch (error) {
      if (error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify') throw error
      publicationError('Post-publication ready verification failed.', { code: 'ready-failed', phase: 'verify', manifestId: admission.manifestId, outcomes }, error)
    }
    if (admission.electionMarker.state !== 'absent' && postInspect.git?.electionMarker !== 'absent' && request.versionControlChoice !== 'deferred' && completePostInspect(postInspect, admission, request).length === 0) {
      removeMarker(request, admission, root, publicationOptions)
      try {
        postInspect = currentInspection(request, root, options)
      } catch (error) {
        if (error instanceof InitBacklogError && error.record.code === 'ready-failed' && error.record.phase === 'verify') throw error
        publicationError('Post-publication ready verification failed.', { code: 'ready-failed', phase: 'verify', manifestId: admission.manifestId, outcomes }, error)
      }
    }
    cleanupOwner(root, lock, options, ownedTemporaries)

    return resultRecord(request, admission, postInspect, outcomes)
  } catch (error) {
    if (error instanceof InitBacklogError) {
      if (options.preserveLockOnError === true || options.crash === true) throw error
      try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
      throw error
    }
    if (options.preserveLockOnError === true || options.crash === true || options.failAt !== undefined) throw error
    try { cleanupOwner(root, lock, options, ownedTemporaries) } catch (cleanupError) { throw cleanupError }
    publicationError('Publication effect failed.', { code: 'filesystem', phase: 'publish', manifestId: admission.manifestId, outcomes, systemCode: trustedSystemCode(error) }, error)
  }
}

module.exports = { deriveTemporaryPaths, publishApply, temporaryPaths }
