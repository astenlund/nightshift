// Keep this file LF-only (enforced by the repo .gitattributes): the Workflow
// tool's approval validator rejects carriage returns as hidden control characters,
// so a CRLF checkout makes Workflow(scriptPath=...) unusable.
export const meta = {
  name: 'revise-round',
  description: 'One revise-loop round: concurrent reviewer-to-skeptic pipelines per active dimension',
  phases: [
    { title: 'Review', detail: 'all active-dimension reviewers are submitted concurrently' },
    { title: 'Verify', detail: 'each finding fan-out is submitted when its reviewer returns, overlapping unfinished reviews' },
  ],
  whenToUse: 'Invoked by the nightshift revise skill; not run standalone.',
}

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lgtm', 'verifiedNote', 'findings'],
  properties: {
    lgtm: { type: 'boolean' },
    verifiedNote: { type: 'string', description: 'One sentence on what was concretely verified' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'location', 'evidence'],
        properties: {
          summary: { type: 'string', description: 'One-sentence statement of the issue' },
          location: { type: 'string', description: 'File/section and line or heading the finding anchors to' },
          evidence: { type: 'string', description: 'Concrete artifact evidence for the issue' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason', 'runtimeOwned', 'liveProbePerformed', 'liveProbeEvidence'],
  properties: {
    verdict: { enum: ['CONFIRMED', 'REFUTED', 'JUDGMENT_CALL'] },
    reason: { type: 'string' },
    runtimeOwned: { type: 'boolean', description: 'True when the disputed claim is owned by a runtime the repository cannot settle' },
    liveProbePerformed: { type: 'boolean', description: 'True only when a live probe covered every relevant execution context' },
    liveProbeEvidence: { type: 'string', description: 'Concrete evidence from every relevant live execution context, or an empty string when no probe was performed' },
  },
}

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{12}$/
const CELL_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,115}$/
const VERDICTS = new Set(['CONFIRMED', 'REFUTED', 'JUDGMENT_CALL'])
const LIVE_PROBE_RECOMMENDATION = 'Run a live probe in every relevant execution context.'

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : null
}

function normalizeInput(rawInput) {
  let input = rawInput
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    } catch {
      throw new TypeError('revise-round: args must be a valid JSON object')
    }
  }
  if (!isRecord(input)) {
    throw new TypeError('revise-round: args must be an object')
  }

  return input
}

function validateInput(input) {
  if (!Number.isInteger(input.round) || input.round <= 0 || typeof input.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(input.fingerprint)) {
    throw new TypeError('revise-round: round or fingerprint is invalid')
  }
  if (!Array.isArray(input.dimensions) || input.dimensions.length === 0) {
    throw new TypeError('revise-round: dimensions must be a nonempty array')
  }

  const ids = new Set()
  const dimensions = input.dimensions.map((dimension) => {
    if (!isRecord(dimension)) {
      throw new TypeError('revise-round: every dimension must be an object')
    }
    const id = dimension.id
    const name = trimmed(dimension.name)
    const payloadFile = trimmed(dimension.payloadFile)
    if (typeof id !== 'string' || !CELL_ID_PATTERN.test(id) || ids.has(id) || !name || !payloadFile) {
      throw new TypeError('revise-round: dimension id, name, or payloadFile is invalid')
    }
    ids.add(id)

    return { id, name, payloadFile }
  })

  return dimensions
}

function reviewerPrompt(dimension) {
  return [
    'You are a fresh code/document reviewer with no prior context, reviewing one review cell only.',
    '',
    `FIRST ACTION: Read the payload file at ${dimension.payloadFile} in one Read call. It contains the common context and only the criteria assigned to this cell.`,
    '',
    `Your stable cell ID is '${dimension.id}'. Review only the assigned criteria for '${dimension.name}', following the payload's delivery instructions and acknowledgements.`,
    '',
    '## Rules',
    'Report high-confidence issues only. If the artifact is clean for this cell, return lgtm: true with an empty findings array. Either way, verifiedNote must state concretely what you checked.',
  ].join('\n')
}

function skepticPrompt(dimension, finding) {
  return [
    'You are a skeptical verifier with no prior context. Try to refute the finding against the artifact.',
    '',
    `FIRST ACTION: Read the payload file at ${dimension.payloadFile} in one Read call. It contains the common context and only the criteria assigned to this cell.`,
    '',
    `The finding was raised in cell '${dimension.id}' (${dimension.name}).`,
    '',
    '## Finding to verify',
    `Summary: ${finding.summary}`,
    `Location: ${finding.location}`,
    `Evidence claimed: ${finding.evidence}`,
    '',
    'Classify whether the disputed claim is runtime-owned and whether you performed a live probe in every relevant execution context.',
    'Set liveProbePerformed true only after that complete probe and put concrete, nonblank evidence from every relevant execution context in liveProbeEvidence. Otherwise set liveProbePerformed false and liveProbeEvidence to an empty string.',
    'Repository or design-record evidence cannot refute a runtime-owned claim. Without a live probe in every relevant execution context, return JUDGMENT_CALL and recommend that probe, not REFUTED.',
    'Any live probe must reproduce the real module or script scope, framework call path, and execution context.',
    'Return CONFIRMED when the issue is real, REFUTED when concrete evidence proves it wrong, or JUDGMENT_CALL when it is not factually decidable from available evidence. Give a concrete, nonblank reason.',
  ].join('\n')
}

function needsReviewer(dimension) {
  return { id: dimension.id, name: dimension.name, status: 'needs-reviewer' }
}

function normalizeReviewer(dimension, response) {
  if (!isRecord(response) || typeof response.lgtm !== 'boolean' || !Array.isArray(response.findings)) {
    return needsReviewer(dimension)
  }
  const verifiedNote = trimmed(response.verifiedNote)
  if (!verifiedNote || (response.lgtm && response.findings.length > 0) || (!response.lgtm && response.findings.length === 0)) {
    return needsReviewer(dimension)
  }
  const findings = response.findings.map((finding, index) => {
    if (!isRecord(finding)) {
      return null
    }
    const summary = trimmed(finding.summary)
    const location = trimmed(finding.location)
    const evidence = trimmed(finding.evidence)
    if (!summary || !location || !evidence) {
      return null
    }

    return { id: `${dimension.id}/finding-${index + 1}`, summary, location, evidence }
  })
  if (findings.some(finding => finding === null)) {
    return needsReviewer(dimension)
  }

  return { id: dimension.id, name: dimension.name, status: 'usable', verifiedNote, lgtm: response.lgtm, findings }
}

function retryVerification(issue) {
  return { status: 'needs-retry', issue }
}

function resultsById(results) {
  const byId = new Map()
  for (const result of Array.isArray(results) ? results : []) {
    if (isRecord(result) && typeof result.id === 'string') {
      byId.set(result.id, result)
    }
  }

  return byId
}

function normalizeVerdict(response) {
  if (!isRecord(response) || !VERDICTS.has(response.verdict) || typeof response.runtimeOwned !== 'boolean' || typeof response.liveProbePerformed !== 'boolean' || typeof response.liveProbeEvidence !== 'string') {
    return null
  }
  const reason = trimmed(response.reason)
  if (!reason) {
    return null
  }
  const liveProbeEvidence = trimmed(response.liveProbeEvidence)
  if (response.liveProbePerformed !== Boolean(liveProbeEvidence)) {
    return null
  }
  let verdict = response.verdict
  let normalizedReason = reason
  if (response.runtimeOwned && !response.liveProbePerformed && (response.verdict === 'REFUTED' || response.verdict === 'JUDGMENT_CALL')) {
    verdict = 'JUDGMENT_CALL'
    normalizedReason = `${reason} ${LIVE_PROBE_RECOMMENDATION}`
  }

  return { status: 'verified', verdict, reason: normalizedReason, runtimeOwned: response.runtimeOwned, liveProbePerformed: response.liveProbePerformed, liveProbeEvidence: liveProbeEvidence || null }
}

const agentOpts = extra => model ? { ...extra, model } : extra
const input = normalizeInput(args)
const dimensions = validateInput(input)
const { round, fingerprint, model } = input

async function review(dimension) {
  try {
    const response = await agent(reviewerPrompt(dimension), agentOpts({
      label: `review:${dimension.id}`,
      phase: 'Review',
      schema: FINDINGS_SCHEMA,
      agentType: 'Explore',
    }))

    return normalizeReviewer(dimension, response)
  } catch {
    return needsReviewer(dimension)
  }
}

async function verifyFinding(dimension, finding) {
  try {
    const response = await agent(skepticPrompt(dimension, finding), agentOpts({
      label: `verify:${finding.id}`,
      phase: 'Verify',
      schema: VERDICT_SCHEMA,
      agentType: 'Explore',
    }))
    const verification = normalizeVerdict(response)

    return { ...finding, verification: verification || retryVerification('skeptic output was missing or invalid') }
  } catch {
    return { ...finding, verification: retryVerification('skeptic execution failed') }
  }
}

async function verify(cell, dimension) {
  if (cell.status !== 'usable' || cell.findings.length === 0) {
    return cell
  }
  const completedFindings = await parallel(cell.findings.map(finding => () => verifyFinding(dimension, finding)))
  const findingById = resultsById(completedFindings)
  const findings = cell.findings.map(finding => findingById.get(finding.id) || {
    ...finding,
    verification: retryVerification('skeptic result was missing'),
  })

  return {
    ...cell,
    status: findings.some(finding => finding.verification.status === 'needs-retry') ? 'needs-verification' : 'usable',
    findings,
  }
}

async function runDimension(dimension) {
  const cell = await review(dimension)

  return verify(cell, dimension)
}

const completed = await parallel(dimensions.map(dimension => () => runDimension(dimension)))
const resultById = resultsById(completed)

return {
  round,
  fingerprint,
  dimensions: dimensions.map(dimension => resultById.get(dimension.id) || needsReviewer(dimension)),
}
