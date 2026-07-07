// Keep this file LF-only (enforced by the repo .gitattributes): the Workflow
// tool's approval validator rejects carriage returns as hidden control characters,
// so a CRLF checkout makes Workflow(scriptPath=...) unusable.
export const meta = {
  name: 'revise-iteration',
  description: 'One revise-loop iteration: 2 fresh reviewers per active dimension, then a skeptic per non-LGTM finding',
  whenToUse: 'Invoked by the nightshift revise skill; not run standalone.',
  phases: [
    { title: 'Review', detail: '2 fresh reviewers per active dimension' },
    { title: 'Verify', detail: 'one skeptic per non-LGTM finding' },
  ],
}

// args shape (all strings unless noted):
// {
//   dimensions: [{ name, text }],   // active (non-graduated, non-N/A) dimensions with full prompt text
//   model,                          // the artifact file's model pin ('sonnet' | 'opus'); omit to inherit
//   artifact: { description, deliveryInstructions },
//   ackList: [string],              // acknowledgements & caveats, verbatim lines
//   context,                        // project context paragraph (incl. CLAUDE.md excerpts, PATTERNS index)
//   additionalRules,                // the artifact file's additional prompt rules, preformatted
// }

const FINDINGS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['lgtm', 'verifiedNote', 'findings'],
  properties: {
    lgtm: { type: 'boolean' },
    verifiedNote: { type: 'string', description: 'One sentence on what was concretely verified (content claims, not vague verdicts)' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'location', 'evidence'],
        properties: {
          summary: { type: 'string', description: 'One-sentence statement of the issue' },
          location: { type: 'string', description: 'File/section and line or heading the finding anchors to' },
          evidence: { type: 'string', description: 'The concrete content that establishes the issue' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reason'],
  properties: {
    verdict: { enum: ['CONFIRMED', 'REFUTED', 'JUDGMENT_CALL'] },
    reason: { type: 'string' },
  },
}

// Tolerate args arriving as a JSON-encoded string (observed when the
// invoking harness stringifies the args value) as well as a plain object.
const input = typeof args === 'string' ? JSON.parse(args) : args
const { dimensions, model, artifact, ackList, context, additionalRules } = input

const ackBlock = (ackList && ackList.length)
  ? `Acknowledged and deliberate (do NOT re-flag these):\n${ackList.map(a => `- ${a}`).join('\n')}\n\n`
  : ''

function reviewerPrompt(d) {
  return [
    `You are a fresh code/document reviewer with no prior context, reviewing one dimension only.`,
    ``,
    `## Project context`,
    context || '(none provided)',
    ``,
    `## Artifact under review`,
    artifact.description,
    ``,
    artifact.deliveryInstructions,
    ``,
    `## Your dimension: ${d.name}`,
    d.text,
    ``,
    ackBlock,
    `## Rules`,
    `Report HIGH confidence issues only. If the artifact is clean for your dimension, return lgtm: true with an empty findings array. Either way, verifiedNote must state concretely what you checked (content claims, not vague verdicts).`,
    additionalRules || '',
  ].join('\n')
}

function skepticPrompt(d, f) {
  return [
    `You are a skeptical verifier with no prior context. A reviewer reported the following finding under the dimension "${d.name}". Your job is to try to REFUTE it against the artifact.`,
    ``,
    `## Project context`,
    context || '(none provided)',
    ``,
    `## Artifact`,
    artifact.description,
    ``,
    artifact.deliveryInstructions,
    ``,
    `## Dimension text`,
    d.text,
    ``,
    ackBlock,
    `## Finding to verify`,
    `Summary: ${f.summary}`,
    `Location: ${f.location}`,
    `Evidence claimed: ${f.evidence}`,
    ``,
    `## Verdict rules`,
    `CONFIRMED: the issue is real; cite the artifact evidence. REFUTED: the finding is wrong; cite the artifact evidence. JUDGMENT_CALL: not factually decidable (taste, balance, or priority). Check the artifact yourself; do not take the claimed evidence at face value.`,
  ].join('\n')
}

const agentOpts = (extra) => model ? { ...extra, model } : extra

const results = await pipeline(
  dimensions,
  d => parallel([1, 2].map(n => () =>
    agent(reviewerPrompt(d), agentOpts({
      label: `review:${d.name}:${n}`,
      phase: 'Review',
      schema: FINDINGS_SCHEMA,
      agentType: 'Explore',
    })),
  )),
  (pair, d) => {
    const reviewers = (pair || []).filter(Boolean)
    const findings = reviewers.flatMap((r, i) =>
      (r.findings || []).map(f => ({ ...f, reviewer: i + 1 })))
    return parallel(findings.map(f => () =>
      agent(skepticPrompt(d, f), agentOpts({
        label: `verify:${d.name}`,
        phase: 'Verify',
        schema: VERDICT_SCHEMA,
        agentType: 'Explore',
      })).then(v => ({
        ...f,
        verdict: v ? v.verdict : 'JUDGMENT_CALL',
        verdictReason: v ? v.reason : 'skeptic unavailable; treat as unverified',
      })),
    )).then(verified => ({
      dimension: d.name,
      reviewerCount: reviewers.length,
      lgtmCount: reviewers.filter(r => r.lgtm).length,
      verifiedNotes: reviewers.map(r => r.verifiedNote),
      findings: verified,
    }))
  },
)

return { dimensions: results.filter(Boolean) }
