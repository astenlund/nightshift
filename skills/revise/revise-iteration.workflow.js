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

// args shapes. FILE-DELIVERED form (preferred): the inline args channel has been
// observed to corrupt payloads over ~2 kB in transit (a dropped structural character
// makes JSON.parse fail; resumed runs may also deliver args stringified), so the
// controller writes the bulky payload to a file that the REVIEWER AGENTS read (the
// script itself has no filesystem access) and passes only a tiny args object:
// {
//   payloadFile,                    // absolute path to the payload file written by the controller
//   dimensionNames: [string],       // active dimension names; each must have a '## Dimension: <name>' section in the payload
//   model,                          // the artifact file's model pin ('sonnet' | 'opus'); omit to inherit
// }
// The payload file must contain these markdown sections, in any order:
//   ## Project context
//   ## Artifact                     (description of the changeset/document under review)
//   ## Delivery                     (how to obtain the artifact: patch path, in-scope files, read discipline)
//   ## Acknowledgements             (bulleted known-deliberate facts reviewers must NOT re-flag)
//   ## Additional rules
//   ## Dimension: <name>            (one per active dimension, full dimension text)
//
// INLINE form (back-compat, safe only for small payloads):
// {
//   dimensions: [{ name, text }],   // active (non-graduated, non-N/A) dimensions with full prompt text
//   model,
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
let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch (e) {
    throw new Error('revise-iteration: args arrived as a string that failed JSON.parse (' + e + '; length ' + input.length + '). The inline args channel is known to corrupt payloads over ~2 kB in transit. Re-invoke with the file-delivered shape ({ payloadFile, dimensionNames, model }) documented at the top of this script, or fall back to the manual Agent engine.')
  }
}
const { model, ackList, context, additionalRules, payloadFile } = input
const dimensions = payloadFile
  ? input.dimensionNames.map(n => ({ name: n, text: null }))
  : input.dimensions

const ackBlock = (ackList && ackList.length)
  ? `Acknowledged and deliberate (do NOT re-flag these):\n${ackList.map(a => `- ${a}`).join('\n')}\n\n`
  : ''

const payloadPreamble = payloadFile
  ? [
    `FIRST ACTION: Read the payload file at ${payloadFile} in one Read call. It contains the project context, an '## Artifact' section describing what is under review, a '## Delivery' section telling you how to obtain the artifact, an '## Acknowledgements' list of known-deliberate facts you must NOT re-flag, an '## Additional rules' section, and one '## Dimension: <name>' section per dimension.`,
    ``,
  ]
  : null

function reviewerPrompt(d) {
  const closing = [
    `## Rules`,
    `Report HIGH confidence issues only. If the artifact is clean for your dimension, return lgtm: true with an empty findings array. Either way, verifiedNote must state concretely what you checked (content claims, not vague verdicts).`,
  ]
  if (payloadFile) {
    return [
      `You are a fresh code/document reviewer with no prior context, reviewing one dimension only.`,
      ``,
      ...payloadPreamble,
      `Your dimension is '## Dimension: ${d.name}'. Review the artifact ONLY per that section's instructions, honoring the delivery instructions, the acknowledgements, and the additional rules from the payload file.`,
      ``,
      ...closing,
    ].join('\n')
  }

  return [
    `You are a fresh code/document reviewer with no prior context, reviewing one dimension only.`,
    ``,
    `## Project context`,
    context || '(none provided)',
    ``,
    `## Artifact under review`,
    input.artifact.description,
    ``,
    input.artifact.deliveryInstructions,
    ``,
    `## Your dimension: ${d.name}`,
    d.text,
    ``,
    ackBlock,
    ...closing,
    additionalRules || '',
  ].join('\n')
}

function skepticPrompt(d, f) {
  const finding = [
    `## Finding to verify`,
    `Summary: ${f.summary}`,
    `Location: ${f.location}`,
    `Evidence claimed: ${f.evidence}`,
    ``,
    `## Verdict rules`,
    `CONFIRMED: the issue is real; cite the artifact evidence. REFUTED: the finding is wrong; cite the artifact evidence. JUDGMENT_CALL: not factually decidable (taste, balance, or priority). Check the artifact yourself; do not take the claimed evidence at face value.`,
  ]
  if (payloadFile) {
    return [
      `You are a skeptical verifier with no prior context. A reviewer reported the following finding under the dimension "${d.name}". Your job is to try to REFUTE it against the artifact.`,
      ``,
      ...payloadPreamble,
      `The finding was raised under '## Dimension: ${d.name}'; read that section for the reviewer's mandate, and honor the delivery instructions and acknowledgements from the payload file.`,
      ``,
      ...finding,
    ].join('\n')
  }

  return [
    `You are a skeptical verifier with no prior context. A reviewer reported the following finding under the dimension "${d.name}". Your job is to try to REFUTE it against the artifact.`,
    ``,
    `## Project context`,
    context || '(none provided)',
    ``,
    `## Artifact`,
    input.artifact.description,
    ``,
    input.artifact.deliveryInstructions,
    ``,
    `## Dimension text`,
    d.text,
    ``,
    ackBlock,
    ...finding,
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
