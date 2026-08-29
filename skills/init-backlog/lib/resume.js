'use strict'

const { lstatSync } = require('node:fs')

const { POSIX_DEFAULT_FILE_MODE, actionAfter, actionBefore, targetMatchesOutput, targetPath } = require('./actions')
const { deriveRequestManifestId } = require('./apply-manifest')
const { boundedOpenOptions, classifyPid, pathExists, platformMode, stableOpenFile } = require('./filesystem')

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
    const opened = stableOpenFile(root, path, boundedOpenOptions(options, bytes.length, { requireSingleLink: false }))
    if (!opened.bytes.equals(bytes)) return false

    return mode === null || opened.mode === mode
  } catch {
    return false
  }
}

function matchesApprovedInitial(request, action, root, options) {
  const path = targetPath(root, action.target)
  if (action.kind === 'ensure-directory') {
    return !pathExists(path)
  }
  if (action.kind === 'create-from-template') return !pathExists(path)
  const before = approvedImage(() => actionBefore(request, action, root, options))

  return before !== undefined && before !== null && matchesApprovedFile(root, path, before, platformMode(options, action.mode ?? POSIX_DEFAULT_FILE_MODE), options)
}

function matchesApprovedFinal(request, action, root, options) {
  const path = targetPath(root, action.target)
  if (action.kind === 'ensure-directory') return matchesApprovedDirectory(root, path, platformMode(options, action.mode), options)
  const after = approvedImage(() => actionAfter(request, action, root, options))

  return after !== undefined && after !== null && matchesApprovedFile(root, path, after, platformMode(options, action.mode ?? POSIX_DEFAULT_FILE_MODE), options)
}

// One durable target image represents exactly one boundary of its approved
// action chain: the initial image, or the image after one of its actions. A
// repeated or unknown boundary is ambiguous and therefore cannot prove resume.
function approvedChainProgress(request, actions, root, options) {
  const matches = []
  if (matchesApprovedInitial(request, actions[0], root, options)) matches.push(0)
  for (let index = 0; index < actions.length; index += 1) {
    if (matchesApprovedFinal(request, actions[index], root, options)) matches.push(index + 1)
  }

  return matches.length === 1 ? matches[0] : null
}

// Durable target state is the progress authority: a resubmitted manifest is
// idempotent only when that state proves a unique approved prefix, meaning
// every action up to some point sits at its approved after image and every
// action past it still sits at its approved before image. Anything else is
// ambiguous drift and fails closed.
function approvedProgress(request, root, options) {
  const actions = request.actions ?? []
  const chains = new Map()
  for (const action of actions) {
    if (!chains.has(action.target)) chains.set(action.target, [])
    chains.get(action.target).push(action)
  }
  const targetProgress = new Map()
  for (const [target, chain] of chains) {
    const progress = approvedChainProgress(request, chain, root, options)
    if (progress === null) return { applied: 0, recognized: false }
    targetProgress.set(target, progress)
  }
  let applied = 0
  let pending = false
  const visited = new Map()
  for (const action of actions) {
    const position = (visited.get(action.target) ?? 0) + 1
    visited.set(action.target, position)
    const complete = position <= targetProgress.get(action.target)
    if (complete && pending) return { applied: 0, recognized: false }
    if (complete) {
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
  approvedProgress,
  detectResume,
  liveHostContext,
  publishedHostContext,
  resumeProjectionScope,
}
