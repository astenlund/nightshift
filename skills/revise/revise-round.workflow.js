// Keep this file LF-only (enforced by the repo .gitattributes): the Workflow
// tool's approval validator rejects carriage returns as hidden control characters,
// so a CRLF checkout makes Workflow(scriptPath=...) unusable.
export const meta = {
  name: 'revise-round',
  description: 'One revise-loop round: 1 fresh reviewer per active dimension, then a skeptic per finding',
  whenToUse: 'Invoked by the nightshift revise skill; not run standalone.',
  phases: [
    { title: 'Review', detail: '1 fresh reviewer per active dimension' },
    { title: 'Verify', detail: 'one skeptic per finding' },
  ],
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
  required: ['verdict', 'reason', 'runtimeOwned', 'liveProbePerformed'],
  properties: {
    verdict: { enum: ['CONFIRMED', 'REFUTED', 'JUDGMENT_CALL'] },
    reason: { type: 'string' },
    runtimeOwned: { type: 'boolean', description: 'True when the disputed claim is owned by a runtime the repository cannot settle' },
    liveProbePerformed: { type: 'boolean', description: 'True only when a live probe covered every relevant execution context' },
  },
}

const FINGERPRINT_PATTERN = /^sha256:[0-9a-f]{12}$/
const DIMENSION_ID_PATTERN = /^[a-z0-9][a-z0-9._/-]{0,115}$/
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
  if (!Number.isInteger(input.phase) || input.phase <= 0 || !Number.isInteger(input.round) || input.round <= 0 || typeof input.fingerprint !== 'string' || !FINGERPRINT_PATTERN.test(input.fingerprint)) {
    throw new TypeError('revise-round: phase, round, or fingerprint is invalid')
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
    if (typeof id !== 'string' || !DIMENSION_ID_PATTERN.test(id) || ids.has(id) || !name || !payloadFile) {
      throw new TypeError('revise-round: dimension id, name, or payloadFile is invalid')
    }
    ids.add(id)

    return { id, name, payloadFile }
  })

  return dimensions
}

function reviewerPrompt(dimension) {
  return [
    'You are a fresh code/document reviewer with no prior context, reviewing one dimension cell only.',
    '',
    `FIRST ACTION: Read the payload file at ${dimension.payloadFile} in one Read call. It contains the common context and only the criteria assigned to this dimension cell.`,
    '',
    `Your stable dimension cell ID is '${dimension.id}'. Review only the assigned criteria for '${dimension.name}', following the payload's delivery instructions and acknowledgements.`,
    '',
    '## Rules',
    'Report high-confidence issues only. If the artifact is clean for this cell, return lgtm: true with an empty findings array. Either way, verifiedNote must state concretely what you checked.',
  ].join('\n')
}

function skepticPrompt(dimension, finding) {
  return [
    'You are a skeptical verifier with no prior context. Try to refute the finding against the artifact.',
    '',
    `FIRST ACTION: Read the payload file at ${dimension.payloadFile} in one Read call. It contains the common context and only the criteria assigned to this dimension cell.`,
    '',
    `The finding was raised in dimension cell '${dimension.id}' (${dimension.name}).`,
    '',
    '## Finding to verify',
    `Summary: ${finding.summary}`,
    `Location: ${finding.location}`,
    `Evidence claimed: ${finding.evidence}`,
    '',
    'Classify whether the disputed claim is runtime-owned and whether you performed a live probe in every relevant execution context.',
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

function normalizeVerdict(response) {
  if (!isRecord(response) || !VERDICTS.has(response.verdict) || typeof response.runtimeOwned !== 'boolean' || typeof response.liveProbePerformed !== 'boolean') {
    return null
  }
  const reason = trimmed(response.reason)
  if (!reason) {
    return null
  }
  if (response.runtimeOwned && !response.liveProbePerformed && (response.verdict === 'REFUTED' || response.verdict === 'JUDGMENT_CALL')) {
    return { status: 'verified', verdict: 'JUDGMENT_CALL', reason: `${reason} ${LIVE_PROBE_RECOMMENDATION}` }
  }

  return { status: 'verified', verdict: response.verdict, reason }
}

const agentOpts = extra => model ? { ...extra, model } : extra
const input = normalizeInput(args)
const dimensions = validateInput(input)
const { phase, round, fingerprint, model } = input

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

async function verify(cell, dimension) {
  if (cell.status !== 'usable' || cell.findings.length === 0) {
    return cell
  }
  const findings = await parallel(cell.findings.map(finding => async () => {
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
  }))

  return {
    ...cell,
    status: findings.some(finding => finding.verification.status === 'needs-retry') ? 'needs-verification' : 'usable',
    findings,
  }
}

const completed = await pipeline(
  dimensions,
  dimension => review(dimension),
  (cell, dimension) => verify(cell, dimension),
)
const resultById = new Map()
for (const cell of Array.isArray(completed) ? completed : []) {
  if (cell && typeof cell.id === 'string') {
    resultById.set(cell.id, cell)
  }
}

return {
  phase,
  round,
  fingerprint,
  dimensions: dimensions.map(dimension => resultById.get(dimension.id) || needsReviewer(dimension)),
}
