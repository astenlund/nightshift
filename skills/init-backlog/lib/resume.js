'use strict'

const { lstatSync } = require('node:fs')

const { deriveRequestManifestId } = require('./apply-manifest')
const { classifyPid, containedTargetPath, pathExists, platformMode, stableOpenFile, verifyFinalMode } = require('./filesystem')
const { canonicalJson } = require('./protocol')
const { unwrapText } = require('../unwrap')

const POSIX_DEFAULT_FILE_MODE = 0o644

function targetPath(root, target) {
  return containedTargetPath(root, target, 'Publication target escapes its root')
}

function proposalAfter(request, action) {
  const canonicalAction = canonicalJson(action)
  const proposal = (request.inspection.proposals ?? []).find((item) => canonicalJson(item.action) === canonicalAction)
  if (proposal?.afterBase64 !== null && proposal?.afterBase64 !== undefined) return Buffer.from(proposal.afterBase64, 'base64')
  if (action.afterBase64 !== null && action.afterBase64 !== undefined) return Buffer.from(action.afterBase64, 'base64')

  return null
}

function resolveUnwrapFinding(request, action) {
  return (request.inspection.wrapFindings ?? []).find((item) => item.target === action.target)
}

function validateUnwrapDigest(finding, action) {
  if (finding === undefined || finding.beforeRawSha256 !== action.beforeRawSha256) throw new Error('Mechanical unwrap digest evidence is invalid')
}

function openUnwrapTarget(root, action, options) {
  return stableOpenFile(root, targetPath(root, action.target), { ...options, requireSingleLink: true })
}

function actionAfter(request, action, root, options) {
  if (action.kind === 'unwrap-file') {
    const finding = resolveUnwrapFinding(request, action)
    if (finding?.predictedContentBase64 !== null && finding?.predictedContentBase64 !== undefined) return Buffer.from(finding.predictedContentBase64, 'base64')
    validateUnwrapDigest(finding, action)
    const opened = openUnwrapTarget(root, action, options)
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
  const finding = resolveUnwrapFinding(request, action)
  validateUnwrapDigest(finding, action)
  const opened = openUnwrapTarget(root, action, options)
  if (opened.rawSha256 !== action.beforeRawSha256) throw new Error('Mechanical unwrap input changed before publication')

  return opened.bytes
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

function approvedGuidanceCreation(request) {
  const rootGuidance = request.inspection?.guidance?.baseAdapter
  if (typeof rootGuidance !== 'string') return null

  return (request.actions ?? []).find((action) => action.kind === 'create-from-template' && action.target === rootGuidance) ?? null
}

// An inspection that observes the root guidance file this manifest itself
// creates must resolve guidance under the published status, not the request's
// original `unexcluded-missing` one, or the apply rejects its own durable
// effect. This fails closed: only the manifest's own approved creation lifts
// the status, so a guidance file no approved action produced still fails.
function guidanceResolvedHostContext(request, published) {
  const hostContext = request.hostContext
  if (request.host !== 'claude-code' || hostContext.claudeRootExclusionStatus !== 'unexcluded-missing' || !published) return hostContext

  return { ...hostContext, claudeContextSource: 'host-observed', claudeRootExclusionStatus: 'included' }
}

function publishedHostContext(request, admission, outcomes) {
  const creation = approvedGuidanceCreation(request)

  return guidanceResolvedHostContext(request, creation !== null && outcomes.some((outcome) => outcome.actionId === creation.id))
}

// Before publication the same allowance applies only on a resume, where the
// guidance file is already present because a prior run of this same manifest
// published it.
function liveHostContext(request, root, resuming) {
  const creation = approvedGuidanceCreation(request)

  return guidanceResolvedHostContext(request, resuming && creation !== null && pathExists(targetPath(root, creation.target)))
}

function resumeProjectionScope(request, actionTargets, hostContext) {
  const guidance = request.inspection?.guidance ?? {}

  return {
    gitignore: actionTargets.has('.gitignore'),
    guidance: [guidance.resolvedTarget, guidance.baseAdapter].some((target) => typeof target === 'string' && actionTargets.has(target)),
    hostContext,
    unwrap: (request.actions ?? []).some((action) => action.kind === 'unwrap-file'),
  }
}

function approvedImage(read) {
  try {
    return read()
  } catch {
    // The live bytes cannot present this image, which is itself the answer.
    return undefined
  }
}

function matchesApprovedDirectory(root, path, mode, options) {
  try {
    return targetMatchesOutput(root, path, 'directory', null, mode, options)
  } catch {
    return false
  }
}

// A response-loss prefix can leave a published target still hard-linked to the
// controller temporary that produced it, which is a recognized intermediate
// state rather than drift. Classification therefore compares bytes and mode
// only; publication stays the authority on link identity and still refuses a
// link it cannot prove it owns.
function matchesApprovedFile(root, path, bytes, mode, options) {
  try {
    const metadata = lstatSync(path, { bigint: true })
    if (metadata.isSymbolicLink() || !metadata.isFile()) return false
    const opened = stableOpenFile(root, path, { ...options, requireSingleLink: false })
    if (!opened.bytes.equals(bytes)) return false

    return mode === null || opened.mode === mode
  } catch {
    return false
  }
}

// Classifies one approved action's durable target state as its approved after
// image (`final`), its approved before image (`initial`), or neither.
function approvedActionState(request, action, root, options) {
  const path = targetPath(root, action.target)
  if (action.kind === 'ensure-directory') {
    if (!pathExists(path)) return 'initial'

    return matchesApprovedDirectory(root, path, platformMode(options, action.mode), options) ? 'final' : 'unrecognized'
  }
  const mode = platformMode(options, action.mode ?? POSIX_DEFAULT_FILE_MODE)
  const after = approvedImage(() => actionAfter(request, action, root, options))
  if (after !== undefined && after !== null && matchesApprovedFile(root, path, after, mode, options)) return 'final'
  if (action.kind === 'create-from-template') return pathExists(path) ? 'unrecognized' : 'initial'
  const before = approvedImage(() => actionBefore(request, action, root, options))
  if (before !== undefined && before !== null && matchesApprovedFile(root, path, before, mode, options)) return 'initial'

  return 'unrecognized'
}

// Durable target state is the progress authority: a resubmitted manifest is
// idempotent only when that state proves a unique approved prefix, meaning
// every action up to some point sits at its approved after image and every
// action past it still sits at its approved before image. Anything else is
// ambiguous drift and fails closed.
function approvedProgress(request, root, options) {
  let applied = 0
  let pending = false
  for (const action of request.actions ?? []) {
    const state = approvedActionState(request, action, root, options)
    if (state === 'unrecognized' || state === 'final' && pending) return { applied: 0, recognized: false }
    if (state === 'final') {
      applied += 1
    } else {
      pending = true
    }
  }

  return { applied, recognized: true }
}

// Resume is a property of durable state, never of a caller flag. Two durable
// facts prove that a prior run of this same manifest already began: an owner
// record naming this manifest identity, or target state that already sits at a
// nonempty approved prefix of it. Ownership adoption additionally requires the
// recorded owner to be this process or provably gone; a different live owner
// blocks, which is the stale-owner rule recovery owns. Anything unprovable
// leaves resume off, so the ordinary snapshot-drift gate decides.
function detectResume(request, root, lockHint, pid, options) {
  if (lockHint !== null) {
    if (lockHint.record.pid !== pid && classifyPid(lockHint.record.pid, options.killProcess) !== 'absent') return false
    let manifestId
    try {
      manifestId = deriveRequestManifestId(request)
    } catch {
      return false
    }

    return lockHint.record.manifestId === manifestId
  }
  try {
    const progress = approvedProgress(request, root, options)

    return progress.recognized && progress.applied > 0
  } catch {
    return false
  }
}

module.exports = {
  POSIX_DEFAULT_FILE_MODE,
  actionAfter,
  actionBefore,
  approvedProgress,
  detectResume,
  liveHostContext,
  publishedHostContext,
  resumeProjectionScope,
  targetMatchesOutput,
  targetPath,
}
