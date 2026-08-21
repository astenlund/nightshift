const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { basename, join } = require('node:path')

const SCRIPT_NAME = basename(__filename, '.js')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const ENGINE_PATH = join(__dirname, 'SKILL.md')
const SOURCE_PATH = join(__dirname, 'revise-round.workflow.js')
const CASES = [
  'agreement boundary blocks dispatch',
  'workflow metadata describes completion-driven concurrency',
  'all reviewer submissions start before any reviewer completion is observed',
  'one reviewer starts every skeptic while another reviewer remains blocked',
  'missing or malformed nested skeptic results are returned as needs-retry',
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
  'a claimed live probe without structured evidence remains unverified',
  'a performed live probe with blank evidence remains unverified',
  'an unperformed live probe carrying evidence remains unverified',
  'a performed live probe preserves the canonical verification shape',
  'an unclear runtime-evidence classification remains unverified',
  'an invalid skeptic verdict remains unverified',
  'a blank skeptic reason cannot certify a verdict',
  'a short fingerprint is rejected before launch',
  'a long fingerprint is rejected before launch',
  'a fingerprint without the sha256 prefix is rejected before launch',
  'an uppercase fingerprint is rejected before launch',
  'a non-hexadecimal fingerprint is rejected before launch',
  'round identity is echoed unchanged',
  'a nonpositive or noninteger round is rejected before launch',
  'an empty dimensions array is rejected before launch',
  'invalid dimension cell ids are rejected before launch',
  'duplicate dimension cell ids are rejected before launch',
  'blank dimension names are rejected before launch',
  'blank payload paths are rejected before launch',
  'two cells in one dimension keep unique ids and isolated payloads',
  'valid stringified args normalize before launch',
  'malformed stringified args are rejected before launch',
  'stringified non-object args are rejected before launch',
  'a maximum-length cell id derives an uncapped finding id and distinct skeptic label',
  'multiple findings receive distinct stable skeptic ids',
  'dedup judge uses sonnet while reviewers and skeptics keep the profile model',
  'a duplicate finding shares its sibling verdict without a second skeptic',
  'a failed dedup judge falls open to a fresh skeptic',
  'a malformed or out-of-range dedup judgment falls open to a fresh skeptic',
  'a shared verdict chains through a second-hop duplicate with a non-zero candidate index',
  'a missing final concurrent cell is returned as needs-reviewer',
]

function argsFor(dimensions = [dimension('correctness')]) {
  return {
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

function verdict(verdictValue = 'CONFIRMED', reason = 'The early return is reachable for an empty input.', runtimeOwned = false, liveProbePerformed = false, liveProbeEvidence = '') {
  return { verdict: verdictValue, reason, runtimeOwned, liveProbePerformed, liveProbeEvidence }
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
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
  const dedupReplies = [...(options.dedupReplies || [])]
  let parallelCallIndex = 0
  const parallel = async (tasks) => {
    const currentCallIndex = parallelCallIndex
    parallelCallIndex += 1
    const results = await Promise.all(tasks.map(task => task()))

    if (options.dropFinalCell && currentCallIndex === 0) {
      return results.slice(0, -1)
    }
    if (currentCallIndex === 1) {
      if (options.findingResultShape === 'short') {
        return results.slice(0, -1)
      }
      if (options.findingResultShape === 'sparse') {
        const sparseResults = [...results]
        delete sparseResults[sparseResults.length - 1]

        return sparseResults
      }
      if (options.findingResultShape === 'non-array') {
        return null
      }
      if (options.findingResultShape === 'reordered') {
        return [...results].reverse()
      }
    }

    return results
  }
  const pipeline = async () => {
    throw new Error('pipeline must not launch')
  }
  const agent = async (prompt, optionsForAgent) => {
    const call = { prompt, options: optionsForAgent }
    agentCalls.push(call)
    options.onAgentCall?.(call)
    const isDedup = isDedupCall(call)
    const replies = optionsForAgent.phase === 'Review' ? reviewerReplies : isDedup ? dedupReplies : skepticReplies
    const next = replies.length > 0 ? replies.shift() : isDedup ? { duplicateOf: -1 } : undefined
    if (next instanceof Error) {
      throw next
    }
    const response = await next
    options.onAgentResult?.(call, response)

    return response
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

function isSkepticCall(call) {
  return call.options.label.startsWith('verify:')
}

function isDedupCall(call) {
  return call.options.label.startsWith('dedup:')
}

function verifyCalls(agentCalls) {
  return agentCalls.filter(isSkepticCall)
}

function dedupCalls(agentCalls) {
  return agentCalls.filter(isDedupCall)
}

function normalizeManualVerdict(response) {
  const liveProbeEvidence = response.liveProbeEvidence.trim() || null
  const needsProbe = response.runtimeOwned && !response.liveProbePerformed && (response.verdict === 'REFUTED' || response.verdict === 'JUDGMENT_CALL')

  return {
    status: 'verified',
    verdict: needsProbe ? 'JUDGMENT_CALL' : response.verdict,
    reason: needsProbe ? `${response.reason.trim()} Run a live probe in every relevant execution context.` : response.reason.trim(),
    runtimeOwned: response.runtimeOwned,
    liveProbePerformed: response.liveProbePerformed,
    liveProbeEvidence,
  }
}

async function replacePendingSkeptic(cell, id, manualSkeptic) {
  const pending = cell.findings.find(item => item.id === id && item.verification.status === 'needs-retry')
  assert.ok(pending)
  const response = await manualSkeptic(id)
  const verification = normalizeManualVerdict(response)

  return {
    ...cell,
    findings: cell.findings.map(item => item.id === id ? { ...item, verification } : item),
  }
}

const TESTS = {
  async 'agreement boundary blocks dispatch'() {
    const engine = await readFile(ENGINE_PATH, 'utf8')
    const checkpointStart = engine.indexOf('# Revise state')
    const checkpointEnd = engine.indexOf('\n```', checkpointStart + 3)
    const checkpoint = engine.slice(checkpointStart, checkpointEnd)
    assert.equal(checkpoint.includes('Agreement boundary:'), true, 'revise checkpoint must declare Agreement boundary')
    assert.equal(checkpoint.includes('Agreement boundary: none'), true, 'new checkpoints must start with no unresolved agreement boundary')
    assert.equal((checkpoint.match(/^Agreement boundary:/gm) || []).length, 1, 'revise checkpoint must contain exactly one agreement boundary field')

    const durableAgreementFieldPrefixes = [
      'Agreement target:',
      'Governing scopes:',
      'Candidate:',
      'Candidate bytes:',
      'Candidate token:',
      'Digest:',
      'Digest bytes:',
      'Source bytes:',
      'Response:',
      'Semantic verdict:',
      'Semantic evidence:',
      'Fit verdict:',
      'Fit evidence:',
      'Agreement record:',
      'Agreement verdict:',
      'Agreement evidence:',
      'Agreement authority:',
      'Agreement satisfied:',
    ]
    const forbiddenAgreementFields = source => source
      .split(/\r?\n/)
      .filter(line => durableAgreementFieldPrefixes.some(prefix => line.startsWith(prefix)))
    assert.deepEqual(forbiddenAgreementFields(checkpoint), [], 'revise checkpoint must persist no agreement-owned durable fields')
    assert.equal(checkpoint.includes('\nEvidence: none'), true, 'generic controller-mutation evidence must remain allowed')
    for (const prefix of durableAgreementFieldPrefixes) {
      const mutant = `${checkpoint}\n${prefix} forbidden fixture value`
      assert.deepEqual(forbiddenAgreementFields(mutant), [`${prefix} forbidden fixture value`], `durable-field mutation probe must reject ${prefix}`)
    }

    const boundaryStart = engine.indexOf('### Governing agreement boundary')
    const boundaryEnd = engine.indexOf('\n## ', boundaryStart)
    assert.notEqual(boundaryStart, -1, 'revise engine must define the governing agreement boundary')
    assert.notEqual(boundaryEnd, -1, 'revise agreement boundary must be a complete subsection')
    const boundary = engine.slice(boundaryStart, boundaryEnd)
    const requiredContracts = [
      'Agreement boundary: none|fit-check|agreement',
      'controller fixes and pending user requests as one complete mutation batch',
      'reconstruct exactly once and classify exactly once',
      'reviewer, skeptic, verifier, post-review, planning, implementation, or downstream dispatch',
      'post-mutation',
      'Agreement boundary: fit-check',
      'Agreement boundary: agreement',
      'Agreement boundary: none',
      'exact match, validated compatible refresh, renewed agreement replacement, or `not-applicable`',
      'reconstruction, classification, and volatile-state storage failures retain the last non-`none` marker',
      'a request that arrives after the drain remains pending',
      'a repair launch and the round-internal skeptic fan-out proceed under a pending user request',
      'normal entry gate and never authorizes dispatch by itself',
    ]
    for (const contract of requiredContracts) {
      assert.equal(boundary.includes(contract), true, `revise agreement boundary must state ${contract}`)
    }

    const fitCheckWrite = boundary.indexOf('atomically rewrite the checkpoint to `Agreement boundary: fit-check`')
    const agreementWrite = boundary.indexOf('atomically rewrite the checkpoint to `Agreement boundary: agreement`')
    const noneWrite = boundary.indexOf('restore `Agreement boundary: none`')
    assert.notEqual(fitCheckWrite, -1, 'agreement boundary must contain the fit-check transition')
    assert.notEqual(agreementWrite, -1, 'agreement boundary must contain the agreement transition')
    assert.notEqual(noneWrite, -1, 'agreement boundary must contain the none transition')
    assert.equal(fitCheckWrite < agreementWrite && agreementWrite < noneWrite, true, 'agreement boundary writes must preserve fit-check then agreement then none ordering')

    const interruptionPoints = [
      'before writing `fit-check`',
      'after writing `fit-check`',
      'before writing `agreement`',
      'after writing `agreement`',
      'before writing `none`',
      'after writing `none`',
    ]
    for (const point of interruptionPoints) {
      assert.equal(boundary.includes(point), true, `revise agreement boundary must cover interruption ${point}`)
    }

    const dispatchCondition = 'Only with `Agreement boundary: none`, no pending request or mutation, and a current successful normal entry or post-mutation gate result may the controller resolve the transition'
    const blockedDispatchClasses = 'While the marker is `fit-check` or `agreement`, prohibit every reviewer, skeptic, verifier, post-review, planning, implementation, or downstream dispatch.'
    const assertDispatchContract = source => {
      assert.equal(source.includes(dispatchCondition), true, 'real dispatch transition must require durable none, no pending work, and a current successful gate')
      assert.equal(source.includes(blockedDispatchClasses), true, 'fit-check and agreement must prohibit every named dispatch class')
    }
    assertDispatchContract(engine)

    const dispatchGuardMutant = engine.replace(dispatchCondition, 'Only when the controller is ready may it resolve the transition')
    assert.notEqual(dispatchGuardMutant, engine, 'dispatch-condition mutation probe must alter the real instruction surface')
    assert.throws(() => assertDispatchContract(dispatchGuardMutant), /real dispatch transition must require durable none/)
  },
  async 'workflow metadata describes completion-driven concurrency'() {
    const source = await readFile(SOURCE_PATH, 'utf8')
    const expectedMetadata = [
      "  description: 'One revise-loop round: concurrent reviewer-to-skeptic pipelines per active dimension',",
      '  phases: [',
      "    { title: 'Review', detail: 'all active-dimension reviewers are submitted concurrently' },",
      "    { title: 'Verify', detail: 'each finding fan-out is submitted when its reviewer returns, overlapping unfinished reviews; duplicate-shape findings share one skeptic via a dedup judge' },",
      '  ],',
    ].join('\n')
    assert.equal(source.includes(expectedMetadata), true)
  },
  async 'all reviewer submissions start before any reviewer completion is observed'() {
    const firstReviewer = deferred()
    const secondReviewer = deferred()
    const allReviewersSubmitted = deferred()
    const events = []
    let reviewerSubmissions = 0
    const dimensions = [dimension('correctness'), dimension('safety', 'Safety')]
    const execution = runWorkflow(argsFor(dimensions), {
      reviewerReplies: [firstReviewer.promise, secondReviewer.promise],
      onAgentCall(call) {
        events.push(`submit:${call.options.label}`)
        if (call.options.phase === 'Review') {
          reviewerSubmissions += 1
          if (reviewerSubmissions === 2) {
            allReviewersSubmitted.resolve()
          }
        }
      },
      onAgentResult: call => events.push(`observe:${call.options.label}`),
    })
    const submissionDeadline = setTimeout(
      () => allReviewersSubmitted.reject(new Error('timed out waiting for both reviewer submissions')),
      1000,
    )

    try {
      await allReviewersSubmitted.promise
      firstReviewer.resolve(clean('Correctness checked.'))
      secondReviewer.resolve(clean('Safety checked.'))
    } finally {
      clearTimeout(submissionDeadline)
      firstReviewer.resolve(clean('Correctness checked.'))
      secondReviewer.resolve(clean('Safety checked.'))
    }

    await execution
    const secondSubmission = events.indexOf('submit:review:safety')
    const firstObservation = events.findIndex(event => event.startsWith('observe:review:'))
    assert.notEqual(secondSubmission, -1)
    assert.notEqual(firstObservation, -1)
    assert.ok(secondSubmission < firstObservation)
  },
  async 'one reviewer starts every skeptic while another reviewer remains blocked'() {
    const firstReviewer = deferred()
    const blockedReviewer = deferred()
    const allReviewersSubmitted = deferred()
    const firstSkeptic = deferred()
    const secondSkeptic = deferred()
    const allSkepticsSubmitted = deferred()
    const events = []
    let reviewerSubmissions = 0
    let skepticSubmissions = 0
    const twoFindings = finding('First issue')
    twoFindings.findings.push({ summary: 'Second issue', location: 'src/parser.js parseValue', evidence: 'Concrete evidence for the second issue.' })
    const dimensions = [dimension('correctness'), dimension('safety', 'Safety')]
    const execution = runWorkflow(argsFor(dimensions), {
      reviewerReplies: [firstReviewer.promise, blockedReviewer.promise],
      skepticReplies: [firstSkeptic.promise, secondSkeptic.promise],
      onAgentCall(call) {
        events.push(`submit:${call.options.label}`)
        if (call.options.phase === 'Review') {
          reviewerSubmissions += 1
          if (reviewerSubmissions === 2) {
            allReviewersSubmitted.resolve()
          }
        }
        if (isSkepticCall(call)) {
          skepticSubmissions += 1
          if (skepticSubmissions === 2) {
            allSkepticsSubmitted.resolve()
          }
        }
      },
      onAgentResult: call => events.push(`observe:${call.options.label}`),
    })
    const reviewerSubmissionDeadline = setTimeout(
      () => allReviewersSubmitted.reject(new Error('timed out waiting for both reviewer submissions')),
      1000,
    )
    const skepticSubmissionDeadline = setTimeout(
      () => allSkepticsSubmitted.reject(new Error('timed out waiting for both skeptic submissions')),
      1000,
    )

    try {
      await allReviewersSubmitted.promise
      firstReviewer.resolve(twoFindings)
      await allSkepticsSubmitted.promise
      const blockedSubmission = events.indexOf('submit:review:safety')
      const firstReviewObservation = events.indexOf('observe:review:correctness')
      assert.notEqual(blockedSubmission, -1)
      assert.notEqual(firstReviewObservation, -1)
      assert.ok(blockedSubmission < firstReviewObservation)
      assert.deepEqual(events.filter(event => event.startsWith('submit:verify:')), [
        'submit:verify:correctness/finding-1',
        'submit:verify:correctness/finding-2',
      ])
      assert.equal(events.some(event => event.startsWith('observe:verify:')), false)
    } finally {
      clearTimeout(reviewerSubmissionDeadline)
      clearTimeout(skepticSubmissionDeadline)
      firstReviewer.resolve(twoFindings)
      firstSkeptic.resolve(verdict())
      secondSkeptic.resolve(verdict())
      blockedReviewer.resolve(clean('Safety stayed blocked through the first skeptic fan-out.'))
    }

    const { result } = await execution
    assert.deepEqual(result.dimensions.map(cell => cell.id), ['correctness', 'safety'])
  },
  async 'missing or malformed nested skeptic results are returned as needs-retry'() {
    const twoFindings = finding('First issue')
    twoFindings.findings.push({ summary: 'Second issue', location: 'src/parser.js parseValue', evidence: 'Concrete evidence for the second issue.' })
    const scenarios = [
      { shape: 'short', expectedCellStatus: 'needs-verification', expectedStatuses: ['verified', 'needs-retry'], expectedReasons: ['First result.', null] },
      { shape: 'sparse', expectedCellStatus: 'needs-verification', expectedStatuses: ['verified', 'needs-retry'], expectedReasons: ['First result.', null] },
      { shape: 'non-array', expectedCellStatus: 'needs-verification', expectedStatuses: ['needs-retry', 'needs-retry'], expectedReasons: [null, null] },
      { shape: 'reordered', expectedCellStatus: 'usable', expectedStatuses: ['verified', 'verified'], expectedReasons: ['First result.', 'Second result.'] },
    ]

    for (const scenario of scenarios) {
      const { result } = await runWorkflow(argsFor([dimension('correctness')]), {
        reviewerReplies: [twoFindings],
        skepticReplies: [verdict('CONFIRMED', 'First result.'), verdict('REFUTED', 'Second result.')],
        findingResultShape: scenario.shape,
      })
      const cell = result.dimensions[0]
      assert.equal(cell.status, scenario.expectedCellStatus, scenario.shape)
      assert.deepEqual(cell.findings.map(item => item.id), ['correctness/finding-1', 'correctness/finding-2'], scenario.shape)
      assert.deepEqual(cell.findings.map(item => item.verification.status), scenario.expectedStatuses, scenario.shape)
      assert.deepEqual(cell.findings.map(item => item.verification.reason ?? null), scenario.expectedReasons, scenario.shape)
      for (const missingFinding of cell.findings.filter(item => item.verification.status === 'needs-retry')) {
        assert.deepEqual(missingFinding.verification, { status: 'needs-retry', issue: 'skeptic result was missing' }, scenario.shape)
      }
    }
  },
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
    assert.deepEqual(cell.findings[0].verification, {
      status: 'verified',
      verdict: 'CONFIRMED',
      reason: 'The early return is reachable for an empty input.',
      runtimeOwned: false,
      liveProbePerformed: false,
      liveProbeEvidence: null,
    })
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

      return verdict()
    })
    assert.deepEqual(manualSkepticCalls, [pending[0].id])
    assert.deepEqual(repaired.findings.find(item => item.id === pending[0].id).verification, completed.verification)
    assert.deepEqual(repaired.findings.find(item => item.id === completed.id), completed)
    assert.equal(agentCalls.filter(call => call.options.phase === 'Review').length, 1)
    assert.equal(agentCalls.filter(call => call.options.label === `verify:${completed.id}`).length, 1)
    assert.equal(verifyCalls(agentCalls).length, 2)
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

      return verdict()
    })
    assert.deepEqual(manualSkepticCalls, [pending.id])
    assert.deepEqual(partial.dimensions[0].findings.find(item => item.id === pending.id).verification, completed.verification)
    assert.equal(agentCalls.filter(call => call.options.phase === 'Review').length, 2)
    assert.equal(agentCalls.filter(call => call.options.label === `verify:${completed.id}`).length, 1)
    assert.equal(verifyCalls(agentCalls).length, 2)
    const reviewerCalls = agentCalls.filter(call => call.options.phase === 'Review')
    assert.match(reviewerCalls[0].prompt, /C:\/repo\/.tmp\/a\.md/)
    assert.doesNotMatch(reviewerCalls[0].prompt, /C:\/repo\/.tmp\/b\.md/)
    assert.match(reviewerCalls[1].prompt, /C:\/repo\/.tmp\/b\.md/)
    assert.doesNotMatch(reviewerCalls[1].prompt, /C:\/repo\/.tmp\/a\.md/)
    for (const call of verifyCalls(agentCalls)) {
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
    assert.deepEqual(cell.findings[0].verification, {
      status: 'verified',
      verdict: 'JUDGMENT_CALL',
      reason: 'Repository evidence cannot settle the live UI label. Run a live probe in every relevant execution context.',
      runtimeOwned: true,
      liveProbePerformed: false,
      liveProbeEvidence: null,
    })
    const skepticCall = agentCalls.find(isSkepticCall)
    assert.ok(skepticCall)
    assert.deepEqual(skepticCall.options.schema.properties.verdict.enum, ['CONFIRMED', 'REFUTED', 'JUDGMENT_CALL'])
    assert.ok(skepticCall.options.schema.required.includes('liveProbeEvidence'))
    assert.match(skepticCall.prompt, /runtime-owned/)
    assert.match(skepticCall.prompt, /live probe/)
    assert.match(skepticCall.prompt, /every relevant execution context/)
    assert.match(skepticCall.prompt, /liveProbeEvidence/)
  },
  async 'repo-only refutation of a runtime-owned claim becomes a judgment call'() {
    const reason = 'Repository design records show a different UI label.'
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [verdict('REFUTED', reason, true)] })
    const verification = getCell(result).findings[0].verification
    assert.deepEqual(verification, {
      status: 'verified',
      verdict: 'JUDGMENT_CALL',
      reason: 'Repository design records show a different UI label. Run a live probe in every relevant execution context.',
      runtimeOwned: true,
      liveProbePerformed: false,
      liveProbeEvidence: null,
    })
  },
  async 'a claimed live probe without structured evidence remains unverified'() {
    const response = { verdict: 'REFUTED', reason: 'Repository design records are the only evidence.', runtimeOwned: true, liveProbePerformed: true }
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [response] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-verification')
    assertRetrySafety(cell)
  },
  async 'a performed live probe with blank evidence remains unverified'() {
    const response = verdict('REFUTED', 'The live label differs.', true, true, ' ')
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [response] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-verification')
    assertRetrySafety(cell)
  },
  async 'an unperformed live probe carrying evidence remains unverified'() {
    const response = verdict('CONFIRMED', 'The finding is real.', false, false, 'Unexpected probe evidence.')
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [response] })
    const cell = getCell(result)
    assert.equal(cell.status, 'needs-verification')
    assertRetrySafety(cell)
  },
  async 'a performed live probe preserves the canonical verification shape'() {
    const response = verdict('REFUTED', 'The live UI uses the expected label.', true, true, '  Observed the expected label on the home and settings pages.  ')
    const { result } = await runWorkflow(argsFor(), { reviewerReplies: [finding()], skepticReplies: [response] })
    assert.deepEqual(getCell(result).findings[0].verification, {
      status: 'verified',
      verdict: 'REFUTED',
      reason: 'The live UI uses the expected label.',
      runtimeOwned: true,
      liveProbePerformed: true,
      liveProbeEvidence: 'Observed the expected label on the home and settings pages.',
    })
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
  async 'round identity is echoed unchanged'() {
    const input = { ...argsFor(), round: 7 }
    const { result } = await runWorkflow(input)
    assert.equal(result.round, 7)
    assert.equal(result.fingerprint, input.fingerprint)
  },
  async 'a nonpositive or noninteger round is rejected before launch'() {
    for (const invalid of [{ ...argsFor(), round: 0 }, { ...argsFor(), round: -1 }, { ...argsFor(), round: 1.5 }, { ...argsFor(), round: '5' }]) {
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
  async 'a maximum-length cell id derives an uncapped finding id and distinct skeptic label'() {
    const cellId = 'a'.repeat(116)
    const expectedFindingId = `${cellId}/finding-1`
    const { result, agentCalls } = await runWorkflow(argsFor([dimension(cellId)]), { reviewerReplies: [finding()] })
    const cell = getCell(result, cellId)
    assert.equal(cellId.length, 116)
    assert.equal(expectedFindingId.length, 126)
    assert.equal(cell.findings[0].id, expectedFindingId)
    assert.equal(agentCalls[0].options.label, `review:${cellId}`)
    assert.equal(agentCalls[1].options.label, `verify:${expectedFindingId}`)
    assert.notEqual(agentCalls[0].options.label, agentCalls[1].options.label)
  },
  async 'multiple findings receive distinct stable skeptic ids'() {
    const response = finding('First issue')
    response.findings.push({ summary: 'Second issue', location: 'src/parser.js parseValue', evidence: 'Concrete evidence for the second issue.' })
    const { result, agentCalls } = await runWorkflow(argsFor(), { reviewerReplies: [response], skepticReplies: [verdict(), verdict('REFUTED', 'The finding does not occur.')] })
    const findings = getCell(result).findings
    assert.deepEqual(findings.map(item => item.id), ['correctness/finding-1', 'correctness/finding-2'])
    const skepticLabels = verifyCalls(agentCalls).map(call => call.options.label)
    assert.deepEqual(skepticLabels, ['verify:correctness/finding-1', 'verify:correctness/finding-2'])
  },
  async 'dedup judge uses sonnet while reviewers and skeptics keep the profile model'() {
    const dimensions = [dimension('correctness'), dimension('safety', 'Safety')]
    const input = { ...argsFor(dimensions), model: 'opus' }
    const { agentCalls } = await runWorkflow(input, {
      reviewerReplies: [finding('First issue'), finding('Possibly duplicate issue')],
      skepticReplies: [verdict(), verdict('REFUTED', 'The second finding does not occur.')],
      dedupReplies: [{ duplicateOf: -1 }],
    })

    const [dedupCall] = dedupCalls(agentCalls)
    assert.deepEqual(agentCalls.filter(call => call.options.phase === 'Review').map(call => call.options.model), ['opus', 'opus'])
    assert.deepEqual(verifyCalls(agentCalls).map(call => call.options.model), ['opus', 'opus'])
    assert.ok(dedupCall)
    assert.equal(dedupCall.options.model, 'sonnet')
    assert.equal(dedupCall.options.effort, 'low')
  },
  async 'a duplicate finding shares its sibling verdict without a second skeptic'() {
    const dimensions = [dimension('correctness'), dimension('safety', 'Safety')]
    const { result, agentCalls } = await runWorkflow(argsFor(dimensions), {
      reviewerReplies: [finding('Shared issue'), finding('The same issue, differently framed')],
      skepticReplies: [verdict()],
      dedupReplies: [{ duplicateOf: 0 }],
    })
    const [correctness, safety] = result.dimensions
    assert.equal(correctness.status, 'usable')
    assert.equal(safety.status, 'usable')
    assert.deepEqual(safety.findings[0].verification, correctness.findings[0].verification)
    assert.equal(safety.findings[0].sharedVerdictFrom, 'correctness/finding-1')
    assert.equal(correctness.findings[0].sharedVerdictFrom, undefined)
    assert.deepEqual(verifyCalls(agentCalls).map(call => call.options.label), ['verify:correctness/finding-1'])
    assert.deepEqual(dedupCalls(agentCalls).map(call => call.options.label), ['dedup:safety/finding-1'])
  },
  async 'a failed dedup judge falls open to a fresh skeptic'() {
    const dimensions = [dimension('correctness'), dimension('safety', 'Safety')]
    const { result, agentCalls } = await runWorkflow(argsFor(dimensions), {
      reviewerReplies: [finding('First issue'), finding('Possibly duplicate issue')],
      skepticReplies: [verdict(), verdict('REFUTED', 'The second finding does not occur.')],
      dedupReplies: [new Error('dedup judge failed')],
    })
    const [correctness, safety] = result.dimensions
    assert.equal(correctness.findings[0].verification.verdict, 'CONFIRMED')
    assert.equal(safety.findings[0].verification.verdict, 'REFUTED')
    assert.equal(safety.findings[0].sharedVerdictFrom, undefined)
    assert.equal(verifyCalls(agentCalls).length, 2)
  },
  async 'a malformed or out-of-range dedup judgment falls open to a fresh skeptic'() {
    for (const malformed of [null, {}, { duplicateOf: 'x' }, { duplicateOf: 1.5 }, { duplicateOf: 5 }]) {
      const dimensions = [dimension('correctness'), dimension('safety', 'Safety')]
      const { result, agentCalls } = await runWorkflow(argsFor(dimensions), {
        reviewerReplies: [finding('First issue'), finding('Possibly duplicate issue')],
        skepticReplies: [verdict(), verdict('REFUTED', 'The second finding does not occur.')],
        dedupReplies: [malformed],
      })
      const [correctness, safety] = result.dimensions
      const label = JSON.stringify(malformed) ?? 'null'
      assert.equal(correctness.findings[0].verification.verdict, 'CONFIRMED', label)
      assert.equal(safety.findings[0].verification.verdict, 'REFUTED', label)
      assert.equal(safety.findings[0].sharedVerdictFrom, undefined, label)
      assert.equal(dedupCalls(agentCalls).length, 1, label)
      assert.equal(verifyCalls(agentCalls).length, 2, label)
    }
  },
  async 'a shared verdict chains through a second-hop duplicate with a non-zero candidate index'() {
    const dimensions = [dimension('correctness'), dimension('safety', 'Safety'), dimension('style', 'Style')]
    const { result, agentCalls } = await runWorkflow(argsFor(dimensions), {
      reviewerReplies: [finding('Shared issue'), finding('The same issue again'), finding('The same issue a third way')],
      skepticReplies: [verdict()],
      dedupReplies: [{ duplicateOf: 0 }, { duplicateOf: 1 }],
    })
    const [correctness, safety, style] = result.dimensions
    assert.equal(correctness.status, 'usable')
    assert.equal(safety.status, 'usable')
    assert.equal(style.status, 'usable')
    assert.deepEqual(safety.findings[0].verification, correctness.findings[0].verification)
    assert.deepEqual(style.findings[0].verification, correctness.findings[0].verification)
    assert.equal(safety.findings[0].sharedVerdictFrom, 'correctness/finding-1')
    assert.equal(style.findings[0].sharedVerdictFrom, 'safety/finding-1')
    assert.deepEqual(verifyCalls(agentCalls).map(call => call.options.label), ['verify:correctness/finding-1'])
    assert.deepEqual(dedupCalls(agentCalls).map(call => call.options.label), ['dedup:safety/finding-1', 'dedup:style/finding-1'])
  },
  async 'a missing final concurrent cell is returned as needs-reviewer'() {
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
