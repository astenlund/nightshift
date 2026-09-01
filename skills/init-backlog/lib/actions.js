'use strict'

const { lstatSync } = require('node:fs')

const { boundedOpenOptions, containedTargetPath, platformMode, stableOpenFile, verifyFinalMode } = require('./filesystem')
const { repairFileBytes } = require('./file-repair')
const { InitBacklogError, failureRecord } = require('./errors')
const { MAX_MECHANICAL_FILE_BYTES, OPERATION, canonicalJson, proposalsByCanonicalAction, sha256 } = require('./protocol')
const { validateUnwrapPrediction } = require('./unwrap-prediction')
const { unwrapText } = require('../unwrap')

const POSIX_DEFAULT_FILE_MODE = 0o644

function targetPath(root, target) {
  return containedTargetPath(root, target, 'Publication target escapes its root')
}

function effectiveActionFileMode(action, priorMode, options) {
  return platformMode(options, action.mode ?? priorMode ?? POSIX_DEFAULT_FILE_MODE)
}

function proposalAfter(request, action) {
  const proposals = request.inspection.proposals ?? []
  const proposal = proposals.length === 0 ? undefined : proposalsByCanonicalAction(proposals).get(canonicalJson(action))
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

function validatedUnwrapPrediction(action, finding, computedOutput = undefined) {
  try {
    return validateUnwrapPrediction(action, finding, computedOutput)
  } catch (error) {
    throw new InitBacklogError(failureRecord({ actionId: action.id, code: 'manifest-invalid', detail: 'Mechanical unwrap prediction integrity is invalid.', operation: OPERATION.APPLY, phase: 'prevalidate', target: action.target }), { cause: error })
  }
}

function openMechanicalTarget(root, action, options, openedTarget = undefined) {
  if (openedTarget === null) throw new Error('Mechanical repair target is not an ordinary file')
  if (openedTarget !== undefined) return openedTarget

  return stableOpenFile(root, targetPath(root, action.target), boundedOpenOptions(options, MAX_MECHANICAL_FILE_BYTES, { requireSingleLink: true }))
}

function actionAfter(request, action, root, options, openedTarget = undefined) {
  if (action.kind === 'repair-file') {
    const opened = openMechanicalTarget(root, action, options, openedTarget)
    if (opened.rawSha256 === action.afterRawSha256) return opened.bytes
    if (opened.rawSha256 !== action.beforeRawSha256) throw new Error('Mechanical repair input changed before publication')
    const computed = repairFileBytes(opened.bytes, action)
    if (sha256(computed) !== action.afterRawSha256) throw new Error('Mechanical repair output differs from inspection')

    return computed
  }
  if (action.kind === 'unwrap-file') {
    const finding = resolveUnwrapFinding(request, action)
    const predicted = validatedUnwrapPrediction(action, finding)
    if (predicted !== null) return predicted
    const opened = openMechanicalTarget(root, action, options, openedTarget)
    if (opened.rawSha256 === action.afterRawSha256) return opened.bytes
    if (opened.rawSha256 !== action.beforeRawSha256) throw new Error('Mechanical unwrap input changed before publication')
    const computed = Buffer.from(unwrapText(opened.bytes.toString('utf8')), 'utf8')

    return validatedUnwrapPrediction(action, finding, computed)
  }

  return proposalAfter(request, action)
}

function actionBefore(request, action, root, options, openedTarget = undefined) {
  if (action.kind !== 'repair-file' && action.kind !== 'unwrap-file') {
    if (action.beforeBase64 === null || action.beforeBase64 === undefined) return null

    return Buffer.from(action.beforeBase64, 'base64')
  }
  if (action.kind === 'unwrap-file') {
    const finding = resolveUnwrapFinding(request, action)
    validateUnwrapDigest(finding, action)
  }
  const opened = openMechanicalTarget(root, action, options, openedTarget)
  if (opened.rawSha256 !== action.beforeRawSha256) throw new Error(action.kind === 'repair-file' ? 'Mechanical repair input changed before publication' : 'Mechanical unwrap input changed before publication')

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
    if (metadata.size !== BigInt(bytes.length)) return false
    const opened = stableOpenFile(root, path, boundedOpenOptions(options, bytes.length, { requireSingleLink: true }))
    if (!opened.bytes.equals(bytes)) return false
    if (mode !== null && opened.mode !== mode) throw new Error('Publication target mode changed')

    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

module.exports = {
  POSIX_DEFAULT_FILE_MODE,
  actionAfter,
  actionBefore,
  effectiveActionFileMode,
  targetMatchesOutput,
  targetPath,
}
