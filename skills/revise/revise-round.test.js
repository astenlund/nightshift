const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { basename, join } = require('node:path')

const SCRIPT_NAME = basename(__filename, '.js')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const SOURCE_PATH = join(__dirname, 'revise-round.workflow.js')
const CASES = [
  'one clean reviewer produces one usable LGTM cell',
  'one finding receives one skeptic verdict',
  'lgtm true with findings becomes needs-reviewer',
  'lgtm false without findings becomes needs-reviewer',
  'missing reviewer output becomes needs-reviewer',
  'rejected reviewer execution becomes needs-reviewer',
  'two dimensions isolate payloads and preserve a usable sibling when one reviewer rejects',
  'missing skeptic output preserves the reviewer and makes the cell need verification',
  'rejected skeptic execution preserves the reviewer and makes the cell need verification',
  'two findings preserve one completed skeptic while selecting only the failed skeptic for repair',
  'two dimensions isolate skeptic repair while preserving a usable sibling',
  'harmless surrounding whitespace is normalized without losing a clear result',
  'blank verifiedNote cannot certify LGTM',
  'blank finding summary location or evidence requires reviewer clarification',
  'invalid reviewer field types require reviewer clarification',
  'a judgment call preserves a runtime-owned finding and requests a live probe',
  'repo-only refutation of a runtime-owned claim becomes a judgment call',
  'an unclear runtime-evidence classification remains unverified',
  'an invalid skeptic verdict remains unverified',
  'a blank skeptic reason cannot certify a verdict',
  'a short fingerprint is rejected before launch',
  'a long fingerprint is rejected before launch',
  'a fingerprint without the sha256 prefix is rejected before launch',
  'an uppercase fingerprint is rejected before launch',
  'a non-hexadecimal fingerprint is rejected before launch',
  'phase and round identity are echoed unchanged',
  'a nonpositive or noninteger phase or round is rejected before launch',
  'an empty dimensions array is rejected before launch',
  'invalid dimension cell ids are rejected before launch',
  'duplicate dimension cell ids are rejected before launch',
  'blank dimension names are rejected before launch',
  'blank payload paths are rejected before launch',
  'two cells in one dimension keep unique ids and isolated payloads',
  'valid stringified args normalize before launch',
  'malformed stringified args are rejected before launch',
  'stringified non-object args are rejected before launch',
  'multiple findings receive distinct stable skeptic ids',
  'a missing final pipeline cell is returned as needs-reviewer',
]

function argsFor(dimensions = [dimension('correctness')]) {
  return {
    phase: 2,
    round: 5,
    fingerprint: 'sha256:a1b2c3d4e5f6',
    dimensions,
    model: 'sonnet',
  }
}

function dimension(id, name = 'Correctness', payloadFile = `C:/repo/.tmp/revise-payload-${id}.md`) {
  return { id, name, payloadFile }
}

function clean(note = 'Traced the changed validation branches and their tests.') {
  return { lgtm: true, verifiedNote: note, findings: [] }
}

function finding(summary = 'The empty-input branch skips validation.') {
  return {
    lgtm: false,
    verifiedNote: 'Traced the changed validation branches and their tests.',
    findings: [{ summary, location: 'src/parser.js validateInput', evidence: 'The early return precedes the validation call.' }],
  }
}

function verdict(verdictValue = 'CONFIRMED', reason = 'The early return is reachable for an empty input.', runtimeOwned = false, liveProbePerformed = false) {
  return { verdict: verdictValue, reason, runtimeOwned, liveProbePerformed }
}

async function loadWorkflow() {
  const source = await readFile(SOURCE_PATH, 'utf8')
  const executable = source.replace('export const meta =', 'const meta =')

  return new AsyncFunction('args', 'pipeline', 'parallel', 'agent', executable)
}

async function runWorkflow(args, options = {}) {
  const workflow = await loadWorkflow()
  const agentCalls = []
  const reviewerReplies = [...(options.reviewerReplies || [clean()])]
  const skepticReplies = [...(options.skepticReplies || [verdict()])]
  const parallel = async (tasks) => Promise.all(tasks.map(task => task()))
  const pipeline = async (items, ...stages) => {
    const results = []
    for (const item of items) {
      let value = item
      for (const stage of stages) {
        value = await stage(value, item)
      }
      results.push(value)
    }

    return options.dropFinalCell ? results.slice(0, -1) : results
  }
  const agent = async (prompt, optionsForAgent) => {
    agentCalls.push({ prompt, options: optionsForAgent })
    const replies = optionsForAgent.phase === 'Review' ? reviewerReplies : skepticReplies
    const next = replies.shift()
    if (next instanceof Error) {
      throw next
    }

    return next
  }

  const result = await workflow(args, pipeline, parallel, agent)

  return { result, agentCalls }
}

function getCell(result, id = 'correctness') {
  assert.equal(result.dimensions.length, 1)
  assert.equal(result.dimensions[0].id, id)

  return result.dimensions[0]
}

function assertRetrySafety(cell) {
  assert.notEqual(cell.lgtm, true)
  for (const item of cell.findings || []) {
    if (item.verification?.status === 'needs-retry') {
      assert.deepEqual(Object.keys(item.verification).sort(), ['issue', 'status'])
      assert.equal(typeof item.verification.issue, 'string')
      assert.match(item.verification.issue, /\S/)
    }
  }
}

async function replacePendingSkeptic(cell, id, manualSkeptic) {
  const pending = cell.findings.find(item => item.id === id && item.verification.status === 'needs-retry')
  assert.ok(pending)
  const verification = await manualSkeptic(id)

  return {
    ...cell,
    findings: cell.findings.map(item => item.id === id ? { ...item, verification } : item),
  }
}

const TESTS = {
  async 'one clean reviewer produces one usable LGTM cell'() {
    const { result, agentCalls } = await runWorkflow(argsFor())
    const cell = getCell(result)
    assert.equal(cell.status, 'usable')
    assert.equal(cell.lgtm, true)
    assert.deepEqual(cell.findings, [])
    assert.equal(agentCalls.length, 1)
  },
  async 'one finding receives one skeptic verdict'() {
    const { result, agentCalls } = await runWorkflow(argsFor(), { reviewerReplies: [finding()] })
    const cell = getCell(result)
    assert.equal(cell.status, 'usable')
    assert.deepEqual(cell.findings[0].verification, { status: 'verified', verdict: 'CONFIRMED', reason: 'The early return is reachable for an empty input.' })
    assert.equal(agentCalls.length, 2)
  },
  async 'lgtm true with findings becomes needs-reviewer'() {
    const contradictory = finding()
    contradictory.lgtm = true
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [contradictory] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-reviewer')
    assertRetrySafety(cell)
  },
  async 'lgtm false without findings becomes needs-reviewer'() {
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [{ ...clean(), lgtm: false }] })
    assert.equal(getCell(result).status, 'needs-reviewer')
  },
  async 'missing reviewer output becomes needs-reviewer'() {
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [undefined] })
    assert.equal(getCell(result).status, 'needs-reviewer')
  },
  async 'rejected reviewer execution becomes needs-reviewer'() {
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [new Error('reviewer execution failed')] })
    assert.equal(getCell(result).status, 'needs-reviewer')
  },
  async 'two dimensions isolate payloads and preserve a usable sibling when one reviewer rejects'() {
    const dimensions = [dimension('correctness', 'Correctness', 'C:/repo/.tmp/a.md'), dimension('safety', 'Safety', 'C:/repo/.tmp/b.md')]
    const { result, agentCalls } = await runWorkflow(argsFor(dimensions), { reviewerReplies: [new Error('reviewer execution failed'), clean('Checked safety rules.')] })
    assert.equal(agentCalls.length, 2)
    assert.match(agentCalls[0].prompt, /C:\/repo\/.tmp\/a\.md/)
    assert.doesNotMatch(agentCalls[0].prompt, /C:\/repo\/.tmp\/b\.md/)
    assert.match(agentCalls[1].prompt, /C:\/repo\/.tmp\/b\.md/)
    assert.doesNotMatch(agentCalls[1].prompt, /C:\/repo\/.tmp\/a\.md/)
    assert.deepEqual(result.dimensions.map(cell => cell.id), ['correctness', 'safety'])
    assert.equal(result.dimensions[0].status, 'needs-reviewer')
    assert.equal(result.dimensions[1].status, 'usable')
    assert.equal(result.dimensions[1].verifiedNote, 'Checked safety rules.')
  },
  async 'missing skeptic output preserves the reviewer and makes the cell need verification'() {
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [undefined] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-verification')
    assert.equal(cell.verifiedNote, 'Traced the changed validation branches and their tests.')
    assert.equal(cell.findings.length, 1)
    assert.equal(cell.findings[0].verification.status, 'needs-retry')
    assertRetrySafety(cell)
  },
  async 'rejected skeptic execution preserves the reviewer and makes the cell need verification'() {
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [new Error('skeptic execution failed')] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-verification')
    assert.equal(cell.findings.length, 1)
    assertRetrySafety(cell)
  },
  async 'two findings preserve one completed skeptic while selecting only the failed skeptic for repair'() {
    const twoFindings = finding('First issue')
    twoFindings.findings.push({ summary: 'Second issue', location: 'src/parser.js parseValue', evidence: 'Concrete evidence for the second issue.' })
    const { result, agentCalls } = await runWorkflow(argsFor(), { reviewerReplies: [twoFindings], skepticReplies: [verdict(), new Error('skeptic execution failed')] })
    const partial = JSON.parse(JSON.stringify(getCell(result)))
    const pending = partial.findings.filter(item => item.verification.status === 'needs-retry')
    assert.equal(pending.length, 1)
    const completed = structuredClone(partial.findings.find(item => item.verification.status === 'verified'))
    const manualSkepticCalls = []
    const repaired = await replacePendingSkeptic(partial, pending[0].id, async id => {
      manualSkepticCalls.push(id)

      return { status: 'verified', ...verdict() }
    })
    assert.deepEqual(manualSkepticCalls, [pending[0].id])
    assert.equal(repaired.findings[0].verification.status, 'verified')
    assert.deepEqual(repaired.findings.find(item => item.id === completed.id), completed)
    assert.equal(agentCalls.filter(call => call.options.phase === 'Review').length, 1)
    assert.equal(agentCalls.filter(call => call.options.label === `verify:${completed.id}`).length, 1)
    assert.equal(agentCalls.filter(call => call.options.phase === 'Verify').length, 2)
  },
  async 'two dimensions isolate skeptic repair while preserving a usable sibling'() {
    const a = finding('First issue')
    a.findings.push({ summary: 'Second issue', location: 'src/parser.js parseValue', evidence: 'Concrete evidence for the second issue.' })
    const dimensions = [dimension('correctness', 'Correctness', 'C:/repo/.tmp/a.md'), dimension('safety', 'Safety', 'C:/repo/.tmp/b.md')]
    const { result, agentCalls } = await runWorkflow(argsFor(dimensions), { reviewerReplies: [a, clean('Checked safety rules.')], skepticReplies: [verdict(), new Error('skeptic execution failed')] })
    const partial = JSON.parse(JSON.stringify(result))
    const safetyBefore = structuredClone(partial.dimensions[1])
    const pending = partial.dimensions[0].findings.find(item => item.verification.status === 'needs-retry')
    const completed = structuredClone(partial.dimensions[0].findings.find(item => item.verification.status === 'verified'))
    const manualSkepticCalls = []
    partial.dimensions[0] = await replacePendingSkeptic(partial.dimensions[0], pending.id, async id => {
      manualSkepticCalls.push(id)

      return { status: 'verified', ...verdict() }
    })
    assert.deepEqual(manualSkepticCalls, [pending.id])
    assert.equal(agentCalls.filter(call => call.options.phase === 'Review').length, 2)
    assert.equal(agentCalls.filter(call => call.options.label === `verify:${completed.id}`).length, 1)
    assert.equal(agentCalls.filter(call => call.options.phase === 'Verify').length, 2)
    const reviewerCalls = agentCalls.filter(call => call.options.phase === 'Review')
    assert.match(reviewerCalls[0].prompt, /C:\/repo\/.tmp\/a\.md/)
    assert.doesNotMatch(reviewerCalls[0].prompt, /C:\/repo\/.tmp\/b\.md/)
    assert.match(reviewerCalls[1].prompt, /C:\/repo\/.tmp\/b\.md/)
    assert.doesNotMatch(reviewerCalls[1].prompt, /C:\/repo\/.tmp\/a\.md/)
    for (const call of agentCalls.filter(call => call.options.phase === 'Verify')) {
      assert.match(call.prompt, /C:\/repo\/.tmp\/a\.md/)
      assert.doesNotMatch(call.prompt, /C:\/repo\/.tmp\/b\.md/)
    }
    assert.deepEqual(partial.dimensions[0].findings.find(item => item.id === completed.id), completed)
    assert.deepEqual(partial.dimensions[1], safetyBefore)
    assert.deepEqual(partial.dimensions.map(cell => cell.id), ['correctness', 'safety'])
  },
  async 'harmless surrounding whitespace is normalized without losing a clear result'() {
    const response = clean('  Checked parser paths.  ')
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [response] })
    assert.equal(getCell(result).verifiedNote, 'Checked parser paths.')
  },
  async 'blank verifiedNote cannot certify LGTM'() {
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [clean('   ')] })
    assert.equal(getCell(result).status, 'needs-reviewer')
  },
  async 'blank finding summary location or evidence requires reviewer clarification'() {
    for (const field of ['summary', 'location', 'evidence']) {
      const response = finding()
      response.findings[0][field] = ' '
      const { result } = await runWorkflow(argsFor(), { reviewerReplies: [response] })
      assert.equal(getCell(result).status, 'needs-reviewer')
    }
  },
  async 'invalid reviewer field types require reviewer clarification'() {
    for (const response of [{ lgtm: 'yes', verifiedNote: 'Checked.', findings: [] }, { lgtm: true, verifiedNote: 3, findings: [] }, { lgtm: true, verifiedNote: 'Checked.', findings: {} }]) {
      const { result } = await runWorkflow(argsFor(), { reviewerReplies: [response] })
      assert.equal(getCell(result).status, 'needs-reviewer')
    }
  },
  async 'a judgment call preserves a runtime-owned finding and requests a live probe'() {
    const reason = 'Repository evidence cannot settle the live UI label.'
    const { result, agentCalls } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [verdict('JUDGMENT_CALL', reason, true)] })
    const cell = getCell(result)
    assert.equal(cell.status, 'usable')
    assert.equal(cell.findings[0].verification.status, 'verified')
    assert.equal(cell.findings[0].verification.verdict, 'JUDGMENT_CALL')
    assert.match(cell.findings[0].verification.reason, /Repository evidence cannot settle/)
    assert.match(cell.findings[0].verification.reason, /live probe/)
    assert.match(cell.findings[0].verification.reason, /every relevant execution context/)
    const skepticCall = agentCalls.find(call => call.options.phase === 'Verify')
    assert.ok(skepticCall)
    assert.deepEqual(skepticCall.options.schema.properties.verdict.enum, ['CONFIRMED', 'REFUTED', 'JUDGMENT_CALL'])
    assert.match(skepticCall.prompt, /runtime-owned/)
    assert.match(skepticCall.prompt, /live probe/)
    assert.match(skepticCall.prompt, /every relevant execution context/)
  },
  async 'repo-only refutation of a runtime-owned claim becomes a judgment call'() {
    const reason = 'Repository design records show a different UI label.'
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [verdict('REFUTED', reason, true)] })
    const verification = getCell(result).findings[0].verification
    assert.equal(verification.status, 'verified')
    assert.equal(verification.verdict, 'JUDGMENT_CALL')
    assert.match(verification.reason, /Repository design records/)
    assert.match(verification.reason, /live probe/)
    assert.match(verification.reason, /every relevant execution context/)
  },
  async 'an unclear runtime-evidence classification remains unverified'() {
    const response = { verdict: 'REFUTED', reason: 'The available evidence is inconclusive.', runtimeOwned: true }
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [response] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-verification')
    assertRetrySafety(cell)
  },
  async 'an invalid skeptic verdict remains unverified'() {
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [verdict('MAYBE')] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-verification')
    assertRetrySafety(cell)
  },
  async 'a blank skeptic reason cannot certify a verdict'() {
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [verdict('CONFIRMED', ' ')] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-verification')
    assertRetrySafety(cell)
  },
  async 'a short fingerprint is rejected before launch'() {
    const invalid = { ...argsFor(), fingerprint: 'sha256:a1b2' }
    await assertInvalid(invalid)
  },
  async 'a long fingerprint is rejected before launch'() {
    const invalid = { ...argsFor(), fingerprint: 'sha256:a1b2c3d4e5f67' }
    await assertInvalid(invalid)
  },
  async 'a fingerprint without the sha256 prefix is rejected before launch'() {
    await assertInvalid({ ...argsFor(), fingerprint: 'md5:a1b2c3d4e5f6' })
  },
  async 'an uppercase fingerprint is rejected before launch'() {
    await assertInvalid({ ...argsFor(), fingerprint: 'sha256:A1B2C3D4E5F6' })
  },
  async 'a non-hexadecimal fingerprint is rejected before launch'() {
    await assertInvalid({ ...argsFor(), fingerprint: 'sha256:a1b2c3d4e5fg' })
  },
  async 'phase and round identity are echoed unchanged'() {
    const input = { ...argsFor(), phase: 3, round: 7 }
    const { result } = await runWorkflow(input)
    assert.equal(result.phase, 3)
    assert.equal(result.round, 7)
    assert.equal(result.fingerprint, input.fingerprint)
  },
  async 'a nonpositive or noninteger phase or round is rejected before launch'() {
    for (const invalid of [{ ...argsFor(), phase: 0 }, { ...argsFor(), round: -1 }, { ...argsFor(), phase: 1.5 }, { ...argsFor(), round: '5' }]) {
      await assertInvalid(invalid)
    }
  },
  async 'an empty dimensions array is rejected before launch'() {
    await assertInvalid(argsFor([]))
  },
  async 'invalid dimension cell ids are rejected before launch'() {
    for (const id of ['', ' Correctness', 'correctness ', 'Correctness', 'correctness|parser', 'a'.repeat(117)]) {
      await assertInvalid(argsFor([dimension(id)]))
    }
  },
  async 'duplicate dimension cell ids are rejected before launch'() {
    await assertInvalid(argsFor([dimension('correctness'), dimension('correctness', 'Safety')]))
  },
  async 'blank dimension names are rejected before launch'() {
    await assertInvalid(argsFor([dimension('correctness', ' ')]))
  },
  async 'blank payload paths are rejected before launch'() {
    await assertInvalid(argsFor([dimension('correctness', 'Correctness', ' ')]))
  },
  async 'two cells in one dimension keep unique ids and isolated payloads'() {
    const dimensions = [dimension('correctness/cluster-parser', 'Correctness', 'C:/repo/.tmp/parser.md'), dimension('correctness/cluster-renderer', 'Correctness', 'C:/repo/.tmp/renderer.md')]
    const { result, agentCalls } = await runWorkflow(argsFor(dimensions), { reviewerReplies: [clean('Parser checked.'), clean('Renderer checked.')] })
    assert.deepEqual(result.dimensions.map(cell => cell.id), dimensions.map(cell => cell.id))
    assert.equal(agentCalls.length, 2)
    assert.match(agentCalls[0].options.label, /correctness\/cluster-parser/)
    assert.match(agentCalls[1].options.label, /correctness\/cluster-renderer/)
    assert.match(agentCalls[0].prompt, /parser\.md/)
    assert.doesNotMatch(agentCalls[0].prompt, /renderer\.md/)
    assert.match(agentCalls[1].prompt, /renderer\.md/)
    assert.doesNotMatch(agentCalls[1].prompt, /parser\.md/)
  },
  async 'valid stringified args normalize before launch'() {
    const objectResult = await runWorkflow(argsFor())
    const stringResult = await runWorkflow(JSON.stringify(argsFor()))
    assert.deepEqual(stringResult.result, objectResult.result)
  },
  async 'malformed stringified args are rejected before launch'() {
    await assertInvalid('{')
  },
  async 'stringified non-object args are rejected before launch'() {
    await assertInvalid('[]')
  },
  async 'multiple findings receive distinct stable skeptic ids'() {
    const response = finding('First issue')
    response.findings.push({ summary: 'Second issue', location: 'src/parser.js parseValue', evidence: 'Concrete evidence for the second issue.' })
    const { result, agentCalls } = await runWorkflow(argsFor(), { reviewerReplies: [response], skepticReplies: [verdict(), verdict('REFUTED', 'The finding does not occur.')] })
    const findings = getCell(result).findings
    assert.deepEqual(findings.map(item => item.id), ['correctness/finding-1', 'correctness/finding-2'])
    assert.notEqual(agentCalls[1].options.label, agentCalls[2].options.label)
  },
  async 'a missing final pipeline cell is returned as needs-reviewer'() {
    const { result } = await runWorkflow(argsFor(), { dropFinalCell: true })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-reviewer')
    assert.equal(cell.id, 'correctness')
    assert.equal(cell.name, 'Correctness')
  },
}

async function assertInvalid(invalidArgs) {
  const workflow = await loadWorkflow()
  const agentCalls = []
  const pipeline = async () => { throw new Error('pipeline must not launch') }
  const parallel = async () => { throw new Error('parallel must not launch') }
  const agent = async () => {
    agentCalls.push(true)
    throw new Error('agent must not launch')
  }
  await assert.rejects(workflow(invalidArgs, pipeline, parallel, agent), TypeError)
  assert.equal(agentCalls.length, 0)
}

async function main() {
  for (const testCase of CASES) {
    try {
      await TESTS[testCase]()
    } catch (error) {
      error.message = `${SCRIPT_NAME}: ${testCase}: ${error.message}`
      throw error
    }
  }

  console.log(`${SCRIPT_NAME}: all ${CASES.length} named cases passed`)
}

main().catch(error => {
  console.error(error.stack || error)
  process.exitCode = 1
})
