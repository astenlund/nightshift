'use strict'

const assert = require('node:assert/strict')

const { VERSION_CONTROL_OPTION_ORDER } = require('../../skills/init-backlog/lib/apply-request')
const { OPERATION, validateResultRecord } = require('../../skills/init-backlog/lib/protocol')
const { canonicalJson, compareOrdinal, sha256 } = require('./helpers')

const MAX_PRESENTATION_CANONICAL_BYTES = 320000

const HOST_CONTROL_RECORDS = {
  autoDenied: '[nightshift-eval-host-control] manifest approval was auto-denied without a user decision.',
  disclosureAcknowledgement: '[nightshift-eval-host-control] disclosure recorded; continue.',
  unavailable: '[nightshift-eval-host-control] no user response is available.',
}
const CODEX_HOST_CONTEXT_CONFIRMATION = 'Confirm fixed guidance candidates AGENTS.override.md and AGENTS.md, no additional fallback guidance names, project_doc_max_bytes 32768, no project_doc_fallback_filenames override, and invocation directory repository root (.).'
const CLAUDE_ROOT_EXCLUSION_CONFIRMATION = 'Confirm that no effective claudeMdExcludes pattern matches the future root CLAUDE.md path shown above.'
const BREAKOUT_DIGEST_NOTICE = 'Decoded before and after images are withheld for mechanical breakout repair.'

const ELECTION_MARKER_PATH = '.nightshift-init-backlog-election'

const HEX64_PATTERN = /^[0-9a-f]{64}$/
const ACTION_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
const NO_APPLY_RESULT_PAIRS = new Set(['auto-denied:auto-denied', 'deferred:deferred', 'denied:denied', 'unavailable:guidance-resolution', 'unavailable:unavailable'])

const LIST_SEPARATOR = String.fromCharCode(0)

function utf8ByteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort(compareOrdinal).join(LIST_SEPARATOR) === [...keys].sort(compareOrdinal).join(LIST_SEPARATOR)
}

function requireExactKeys(value, keys, label) {
  if (!hasExactKeys(value, keys)) {
    throw new Error(`${label} must carry exactly the keys ${JSON.stringify([...keys].sort(compareOrdinal))}`)
  }
}

function selectTerminalExpectation(member, host) {
  return {
    entries: [...member.base.entries, ...member.hostEntries[host]].sort((left, right) => compareOrdinal(left.path, right.path)),
    git: member.base.git,
  }
}

function validateLiveElectionMarker({ bytes, expectedState, mode, platform, root }) {
  if (bytes.length === 0 || bytes[bytes.length - 1] !== 0x0a) {
    throw new Error('election marker bytes must end with one LF')
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error('election marker bytes must carry no BOM')
  }
  const text = bytes.toString('utf8')
  const object = JSON.parse(text)
  requireExactKeys(object, ['protocolVersion', 'root', 'snapshotId', 'state'], 'election marker')
  if (text !== canonicalJson(object) + '\n') {
    throw new Error('election marker bytes must be canonical JSON plus one LF')
  }
  if (object.protocolVersion !== 1 || object.state !== expectedState || object.root !== root || !HEX64_PATTERN.test(object.snapshotId)) {
    throw new Error('election marker fields differ from the structural expectation')
  }
  if (platform === 'win32' ? mode !== null : mode !== 384) {
    throw new Error('election marker mode must be exactly 0o600 on POSIX and null on Windows')
  }
}

function windowsRepositoryImage(repository) {
  return { entries: repository.entries.map((entry) => ({ ...entry, mode: null })), git: repository.git }
}

function validateTurnObject(turn) {
  requireExactKeys(turn, ['gateId', 'phase', 'presentation', 'semanticClassifications'], 'turn')
  if (turn.phase !== 'awaiting-response' && turn.phase !== 'finished') {
    throw new Error('turn phase is invalid')
  }
  if (turn.phase === 'finished' ? turn.gateId !== null : typeof turn.gateId !== 'string' || turn.gateId === '') {
    throw new Error('turn gateId must be null exactly under finished')
  }
  if (!Array.isArray(turn.semanticClassifications)) {
    throw new Error('turn semanticClassifications must be an array')
  }
  for (const item of turn.semanticClassifications) {
    requireExactKeys(item, ['conceptIds', 'status', 'target'], 'turn classification')
  }
  const presentation = turn.presentation
  requireExactKeys(presentation, ['actionDisclosures', 'ambiguityIds', 'disclosureCodes', 'manifestProposal', 'result'], 'turn presentation')
  if (!Array.isArray(presentation.ambiguityIds) || new Set(presentation.ambiguityIds).size !== presentation.ambiguityIds.length) {
    throw new Error('turn ambiguityIds must be a duplicate-free array')
  }
  const codes = presentation.disclosureCodes
  if (!Array.isArray(codes) || (codes.length !== 0 && (codes.length !== 1 || codes[0] !== 'external-writer-window'))) {
    throw new Error('turn disclosureCodes must be [] or ["external-writer-window"]')
  }
  if (turn.phase === 'awaiting-response' && presentation.result !== null) {
    throw new Error('turn result must be null under awaiting-response')
  }
  if (turn.phase === 'finished' && presentation.result === null) {
    throw new Error('turn result must be present under finished')
  }
  if (presentation.result !== null && (Object.hasOwn(presentation.result, 'approvalBranch') || Object.hasOwn(presentation.result, 'reasonCode'))) {
    requireExactKeys(presentation.result, ['approvalBranch', 'reasonCode'], 'turn result')
    if (!NO_APPLY_RESULT_PAIRS.has(`${presentation.result.approvalBranch}:${presentation.result.reasonCode}`)) {
      throw new Error('turn result approval branch and reason code are inconsistent')
    }
  } else if (presentation.result !== null) {
    validateResultRecord(presentation.result)
    if (presentation.result.ok === true && presentation.result.operation !== OPERATION.APPLY) {
      throw new Error('turn result success operation must be apply')
    }
  }
  if (presentation.manifestProposal !== null) {
    requireExactKeys(presentation.manifestProposal, ['actions', 'proposalDispositions', 'semanticDecisions', 'versionControlChoice', 'versionControlOptions'], 'turn manifestProposal')
    const options = presentation.manifestProposal.versionControlOptions
    if (!Array.isArray(options) || options.length !== VERSION_CONTROL_OPTION_ORDER.length || options.some((value, index) => value !== VERSION_CONTROL_OPTION_ORDER[index])) {
      throw new Error('turn manifestProposal versionControlOptions must use the fixed order')
    }
  }
  for (const item of presentation.actionDisclosures) {
    const kind = item !== null && typeof item === 'object' ? item.kind : null
    if (kind === 'decoded-content') {
      requireExactKeys(item, ['actionId', 'chunkCount', 'chunkIndex', 'endByte', 'image', 'kind', 'proposalDigest', 'rawSha256', 'selection', 'startByte', 'target', 'text'], 'decoded-content disclosure')
      if (typeof item.text !== 'string' || item.text === '') {
        throw new Error('decoded-content disclosure text must be nonempty')
      }
    } else if (kind === 'decoded-empty') {
      requireExactKeys(item, ['actionId', 'byteLength', 'image', 'kind', 'proposalDigest', 'rawSha256', 'selection', 'target'], 'decoded-empty disclosure')
      if (item.byteLength !== 0) {
        throw new Error('decoded-empty disclosure byteLength must be literal zero')
      }
    } else if (kind === 'breakout-digest') {
      requireExactKeys(item, ['actionId', 'afterRawSha256', 'beforeRawSha256', 'extent', 'firstLine', 'kind', 'mode', 'newline', 'notice', 'proposalDigest', 'selection', 'target', 'unwrap', 'wrapCount'], 'breakout-digest disclosure')
      const validMode = item.mode === null || Number.isSafeInteger(item.mode) && item.mode >= 0 && item.mode <= 4095
      const validWrap = typeof item.unwrap === 'boolean' && Number.isSafeInteger(item.wrapCount) && (item.unwrap ? item.wrapCount >= 1 && Number.isSafeInteger(item.firstLine) && item.firstLine >= 1 : item.wrapCount === 0 && item.firstLine === null)
      if (item.extent !== 'complete-file' || item.notice !== BREAKOUT_DIGEST_NOTICE || !validMode || !['crlf', 'lf'].includes(item.newline) || !validWrap) {
        throw new Error('breakout-digest disclosure literals are invalid')
      }
    } else if (kind === 'structural-action') {
      requireExactKeys(item, ['actionId', 'kind', 'proposalDigest', 'selection', 'target'], 'structural-action disclosure')
    } else {
      throw new Error('actionDisclosures item kind is invalid')
    }
    if (!['selected', 'condition-not-selected'].includes(item.selection)) {
      throw new Error('actionDisclosures selection is invalid')
    }
    if (!HEX64_PATTERN.test(item.proposalDigest) || !ACTION_ID_PATTERN.test(item.actionId)) {
      throw new Error('actionDisclosures digest or action ID grammar is invalid')
    }
  }
}

function disclosureTurnByteLength(item, semanticClassifications) {
  return utf8ByteLength(canonicalJson({
    gateId: 'action-disclosure',
    phase: 'awaiting-response',
    presentation: { actionDisclosures: [item], ambiguityIds: [], disclosureCodes: [], manifestProposal: null, result: null },
    semanticClassifications,
  }))
}

function buildDecodedContentDisclosures({ actionId, budget = MAX_PRESENTATION_CANONICAL_BYTES, bytes, image, proposalDigest, selection, semanticClassifications = [], target }) {
  const rawSha256 = sha256(bytes)
  if (bytes.length === 0) {
    return { items: [{ actionId, byteLength: 0, image, kind: 'decoded-empty', proposalDigest, rawSha256, selection, target }] }
  }
  const text = bytes.toString('utf8')
  assert.deepEqual(Buffer.from(text, 'utf8'), bytes, 'decoded-content disclosure requires strict UTF-8 bytes')
  const codePoints = [...text]
  const pointCount = codePoints.length
  const chunks = []
  let pointOffset = 0
  let byteOffset = 0
  while (pointOffset < pointCount) {
    const remaining = pointCount - pointOffset
    const candidate = (takePoints) => ({
      actionId,
      chunkCount: pointCount,
      chunkIndex: pointCount - 1,
      endByte: byteOffset + utf8ByteLength(codePoints.slice(pointOffset, pointOffset + takePoints).join('')),
      image,
      kind: 'decoded-content',
      proposalDigest,
      rawSha256,
      selection,
      startByte: byteOffset,
      target,
      text: codePoints.slice(pointOffset, pointOffset + takePoints).join(''),
    })
    if (disclosureTurnByteLength(candidate(1), semanticClassifications) > budget) {
      return { presentationCapacity: true }
    }
    let low = 1
    let high = remaining
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      if (disclosureTurnByteLength(candidate(middle), semanticClassifications) <= budget) {
        low = middle
      } else {
        high = middle - 1
      }
    }
    const chosen = candidate(low)
    chunks.push({ chosen, pointsTaken: low })
    pointOffset += low
    byteOffset = chosen.endByte
  }
  const items = chunks.map(({ chosen }, index) => ({ ...chosen, chunkCount: chunks.length, chunkIndex: index }))
  for (const item of items) {
    assert.ok(disclosureTurnByteLength(item, semanticClassifications) <= budget, 'final decoded-content disclosure turn must still fit after re-indexing')
  }

  return { items }
}

module.exports = {
  BREAKOUT_DIGEST_NOTICE,
  CLAUDE_ROOT_EXCLUSION_CONFIRMATION,
  CODEX_HOST_CONTEXT_CONFIRMATION,
  ELECTION_MARKER_PATH,
  HEX64_PATTERN,
  HOST_CONTROL_RECORDS,
  LIST_SEPARATOR,
  MAX_PRESENTATION_CANONICAL_BYTES,
  buildDecodedContentDisclosures,
  disclosureTurnByteLength,
  requireExactKeys,
  selectTerminalExpectation,
  validateLiveElectionMarker,
  validateTurnObject,
  windowsRepositoryImage,
}
