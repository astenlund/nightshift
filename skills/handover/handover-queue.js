'use strict'

const { TextDecoder } = require('node:util')

const MAX_QUEUE_BYTES = 16_384
const QUEUE_PROTOCOL_VERSION = 1
const QUEUE_ENTRY_STEPS = Object.freeze([1, 2, 3, 4, 5])
const QUEUE_STEPS = Object.freeze([
  'Spec gate',
  'Write the implementation plan',
  'Revise plan',
  'Implement the plan',
  'Revise code',
  'Verify end-to-end',
  'Revise docs',
  'Backlog bookkeeping check',
  'Revise lore',
  'Persist workflow edits',
  'Full test suite',
  'Morning report',
])

class HandoverQueueError extends Error {
  constructor(message) {
    super(message)
    this.name = 'HandoverQueueError'
  }
}

function exactKeyMembership(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function exactOrderedKeys(value, keys) {
  return exactKeyMembership(value, keys) && Object.keys(value).every((key, index) => key === keys[index])
}

function fail(message) {
  throw new HandoverQueueError(message)
}

function validText(value, maximumLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength && !/[\u0000-\u001f\u007f]/.test(value)
}

function validArtifactPath(value) {
  return validText(value, 1_024) && !value.includes('\\') && !value.startsWith('/') && !/^[A-Za-z]:/.test(value) && value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
}

function validateAuthority(authority) {
  if (!exactKeyMembership(authority, ['artifactPath', 'planFingerprint', 'targetScope'])
    || !validArtifactPath(authority.artifactPath)
    || !(authority.planFingerprint === 'none' || /^sha256:[0-9a-f]{64}$/.test(authority.planFingerprint))
    || !validText(authority.targetScope, 1_024)) {
    fail('Queue authority is invalid')
  }
}

function validateEvidence(evidence) {
  if (!exactKeyMembership(evidence, ['ignored', 'ordinary', 'singleLink', 'stable', 'tracked'])
    || evidence.ignored !== true
    || evidence.ordinary !== true
    || evidence.singleLink !== true
    || evidence.stable !== true
    || evidence.tracked !== false) {
    fail('Queue file evidence is not trusted')
  }
}

function validateEntryStep(entryStep) {
  if (!QUEUE_ENTRY_STEPS.includes(entryStep)) {
    fail('Queue entry step is invalid')
  }
}

function authorityHeader(authority, entryStep) {
  return {
    artifactPath: authority.artifactPath,
    entryStep,
    planFingerprint: authority.planFingerprint,
    protocolVersion: QUEUE_PROTOCOL_VERSION,
    targetScope: authority.targetScope,
  }
}

function serializeQueue(authority, entryStep, completedSteps) {
  validateAuthority(authority)
  validateEntryStep(entryStep)
  const completed = new Set(completedSteps)
  const lines = [JSON.stringify(authorityHeader(authority, entryStep))]
  for (let step = entryStep; step <= QUEUE_STEPS.length; step += 1) {
    lines.push(`- [${completed.has(step) ? 'x' : ' '}] ${step}. ${QUEUE_STEPS[step - 1]}`)
  }

  return Buffer.from(`${lines.join('\n')}\n`, 'utf8')
}

function createQueue(input) {
  if (!exactKeyMembership(input, ['authority', 'entryStep'])) {
    fail('Queue creation input is invalid')
  }
  validateAuthority(input.authority)
  validateEntryStep(input.entryStep)

  return serializeQueue(input.authority, input.entryStep, [])
}

function parseSource(sourceBuffer) {
  if (!Buffer.isBuffer(sourceBuffer) || sourceBuffer.length === 0 || sourceBuffer.length > MAX_QUEUE_BYTES) {
    fail('Queue source size is invalid')
  }
  let text
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(sourceBuffer)
  } catch {
    fail('Queue source is not UTF-8')
  }
  if (text.startsWith('\uFEFF') || text.includes('\r') || !text.endsWith('\n') || text.slice(0, -1).includes('\n\n')) {
    fail('Queue source encoding is not canonical')
  }
  const lines = text.slice(0, -1).split('\n')
  let header
  try {
    header = JSON.parse(lines[0])
  } catch {
    fail('Queue header is malformed')
  }
  if (!exactOrderedKeys(header, ['artifactPath', 'entryStep', 'planFingerprint', 'protocolVersion', 'targetScope'])
    || JSON.stringify(header) !== lines[0]
    || header.protocolVersion !== QUEUE_PROTOCOL_VERSION) {
    fail('Queue header is not canonical')
  }
  const authority = { artifactPath: header.artifactPath, planFingerprint: header.planFingerprint, targetScope: header.targetScope }
  validateAuthority(authority)
  validateEntryStep(header.entryStep)
  if (lines.length !== QUEUE_STEPS.length - header.entryStep + 2) {
    fail('Queue step inventory is incomplete')
  }
  const completedSteps = []
  for (let step = header.entryStep; step <= QUEUE_STEPS.length; step += 1) {
    const line = lines[step - header.entryStep + 1]
    const unchecked = `- [ ] ${step}. ${QUEUE_STEPS[step - 1]}`
    const checked = `- [x] ${step}. ${QUEUE_STEPS[step - 1]}`
    if (line === checked) {
      completedSteps.push(step)
    } else if (line !== unchecked) {
      fail('Queue step inventory is not canonical')
    }
  }

  return { authority, completedSteps, entryStep: header.entryStep }
}

function queueState(parsed) {
  const completed = new Set(parsed.completedSteps)
  const allSteps = Array.from({ length: QUEUE_STEPS.length - parsed.entryStep + 1 }, (_, index) => parsed.entryStep + index)
  if (allSteps.every((step) => completed.has(step))) {
    return { complete: true, nextStep: null }
  }
  if (completed.has(10) || completed.has(12)) {
    fail('Queue tail marks are not coupled')
  }
  const beforeTail = allSteps.filter((step) => step <= 9)
  let frontier = parsed.entryStep
  for (const step of beforeTail) {
    if (!completed.has(step)) {
      frontier = step
      break
    }
    frontier = step + 1
  }
  if (beforeTail.some((step) => step >= frontier && completed.has(step))) {
    fail('Queue completion marks do not form a frontier')
  }
  if (frontier <= 9) {
    if (completed.has(11)) {
      fail('Queue completion marks do not form a frontier')
    }

    return { complete: false, nextStep: frontier }
  }
  const unexpected = parsed.completedSteps.filter((step) => step !== 11 && step <= 12 && step > 9)
  if (unexpected.length > 0) {
    fail('Queue tail marks are invalid')
  }

  return { complete: false, nextStep: completed.has(11) ? 12 : 11 }
}

function sameAuthority(left, right) {
  return left.artifactPath === right.artifactPath && left.planFingerprint === right.planFingerprint && left.targetScope === right.targetScope
}

function resumeQueue(input) {
  if (!exactKeyMembership(input, ['detectedEntryStep', 'evidence', 'expectedAuthority', 'sourceBuffer'])) {
    fail('Queue resume input is invalid')
  }
  if (!QUEUE_ENTRY_STEPS.includes(input.detectedEntryStep)) {
    fail('Detected entry step is invalid')
  }
  validateEvidence(input.evidence)
  validateAuthority(input.expectedAuthority)
  const parsed = parseSource(input.sourceBuffer)
  if (!sameAuthority(parsed.authority, input.expectedAuthority)) {
    fail('Queue authority does not match the current run')
  }
  const state = queueState(parsed)
  if (state.complete) {
    return { kind: 'dead', nextStep: input.detectedEntryStep, sourceBuffer: createQueue({ authority: input.expectedAuthority, entryStep: input.detectedEntryStep }) }
  }
  if (state.nextStep > input.detectedEntryStep) {
    return { kind: 'restart', nextStep: input.detectedEntryStep, sourceBuffer: createQueue({ authority: input.expectedAuthority, entryStep: input.detectedEntryStep }) }
  }

  return { kind: 'live', nextStep: state.nextStep, sourceBuffer: input.sourceBuffer }
}

function advanceQueue(input) {
  if (!exactKeyMembership(input, ['completedStep', 'currentAuthority', 'evidence', 'nextAuthority', 'sourceBuffer'])) {
    fail('Queue update input is invalid')
  }
  validateEvidence(input.evidence)
  validateAuthority(input.currentAuthority)
  validateAuthority(input.nextAuthority)
  const parsed = parseSource(input.sourceBuffer)
  if (!sameAuthority(parsed.authority, input.currentAuthority)) {
    fail('Queue authority changed before update')
  }
  const state = queueState(parsed)
  if (parsed.completedSteps.includes(input.completedStep)) {
    if (!sameAuthority(input.currentAuthority, input.nextAuthority)) {
      fail('An idempotent queue update cannot change authority')
    }

    return { complete: state.complete, nextStep: state.nextStep, sourceBuffer: input.sourceBuffer }
  }
  if (state.complete || input.completedStep !== state.nextStep || input.completedStep === 10) {
    fail('Queue update does not complete the next actionable step')
  }
  const completedSteps = [...parsed.completedSteps, input.completedStep]
  if (input.completedStep === 12) {
    completedSteps.push(10)
  }
  completedSteps.sort((left, right) => left - right)
  const sourceBuffer = serializeQueue(input.nextAuthority, parsed.entryStep, completedSteps)
  const nextState = queueState(parseSource(sourceBuffer))

  return { complete: nextState.complete, nextStep: nextState.nextStep, sourceBuffer }
}

module.exports = { HandoverQueueError, MAX_QUEUE_BYTES, QUEUE_ENTRY_STEPS, QUEUE_PROTOCOL_VERSION, QUEUE_STEPS, advanceQueue, createQueue, resumeQueue }
