'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, realpathSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')

const hostEvents = require('../init-backlog-session-driver/host-events')
const dialogue = require('../init-backlog-session-driver/dialogue')
const adjudication = require('../init-backlog-session-driver/adjudication')
const driver = require('../init-backlog-session-driver')
const applyRequest = require('../../skills/init-backlog/lib/apply-request')
const protocol = require('../../skills/init-backlog/lib/protocol')
const { inspect } = require('../../skills/init-backlog/init-backlog')
const { CLAUDE_ROOT_EXCLUSION_CONFIRMATION, CODEX_HOST_CONTEXT_CONFIRMATION, HOST_CONTROL_RECORDS } = require('./election-oracles')
const { HOST_CONTEXTS, buildExpectedImportCases } = require('./host-fixture-oracles')
const { canonicalJson, sha256 } = require('./helpers')

const FIXED_OPTIONS = ['track', 'ignore', 'deferred', 'not-required']
const TEN_SKILLS = ['exploring', 'handover', 'init-backlog', 'ready', 'revise-code', 'revise-docs', 'revise-lore', 'revise-plan', 'revise-spec', 'spec-agreement']
const SYNTHETIC_ROOT = '/eval/run/repo'
const SYNTHETIC_PLUGIN_ROOT = '/eval/run/enabled-plugin'

function eventLine(value) {
  return Buffer.from(JSON.stringify(value), 'utf8')
}

function claudeInit(sessionPluginRoot, overrides = {}) {
  return {
    mcp_servers: [],
    plugins: [{ name: 'nightshift', path: sessionPluginRoot, source: 'nightshift@astenlund' }],
    skills: TEN_SKILLS.map((name) => `nightshift:${name}`),
    slash_commands: TEN_SKILLS.map((name) => `nightshift:${name}`),
    subtype: 'init',
    tools: [],
    type: 'system',
    ...overrides,
  }
}

function probeInit(overrides = {}) {
  return { mcp_servers: [], plugins: [], subtype: 'init', tools: [], type: 'system', ...overrides }
}

function makeTurn({ ambiguityIds = [], disclosureCodes = [], disclosures = [], gateId = null, manifestProposal = null, phase = 'awaiting-response', result = null, semanticClassifications = [] } = {}) {
  return {
    gateId: phase === 'finished' ? null : gateId,
    phase,
    presentation: { actionDisclosures: disclosures, ambiguityIds, disclosureCodes, manifestProposal, result },
    semanticClassifications,
  }
}

function inspectRequestBytes({ host, hostContext, root }) {
  return Buffer.from(canonicalJson({ host, hostContext, operation: 'inspect', protocolVersion: 1, root }), 'utf8')
}

function proposalSelected(proposal) {
  return proposal.condition === 'always' || proposal.condition === 'newline-lf'
}

function manifestProposalFrom(inspection) {
  const proposalDispositions = inspection.proposals.map((proposal) => ({ disposition: proposalSelected(proposal) ? 'selected' : 'condition-not-selected', proposalId: proposal.proposalId }))
  const actions = protocol.canonicalActionOrder(inspection.proposals.filter(proposalSelected).map((proposal) => proposal.action))

  return { actions, proposalDispositions, semanticDecisions: [], versionControlChoice: 'not-required', versionControlOptions: [...FIXED_OPTIONS] }
}

function carriersFrom(inspection) {
  return inspection.proposals.map((proposal) => {
    if (proposal.action.kind === 'ensure-directory') {
      return { actionId: proposal.action.id, kind: 'structural-action', target: proposal.action.target }
    }
    if (proposal.action.kind === 'unwrap-file') {
      return { actionId: proposal.action.id, afterRawSha256: proposal.action.afterRawSha256, beforeRawSha256: proposal.action.beforeRawSha256, kind: 'breakout-digest', target: proposal.action.target }
    }

    return {
      actionId: proposal.action.id,
      afterBytes: Buffer.from(proposal.afterBase64, 'base64'),
      beforeBytes: proposal.beforeBase64 === null ? null : Buffer.from(proposal.beforeBase64, 'base64'),
      kind: 'decoded',
      target: proposal.action.target,
    }
  })
}

function withRealInspection(consumer) {
  const scratch = mkdtempSync(join(tmpdir(), 'nightshift-dialogue-'))
  try {
    const canonicalScratch = realpathSync.native(scratch)
    const inspection = inspect(canonicalScratch, 'codex', HOST_CONTEXTS.codex, { candidates: [], ownerNonce: 'a'.repeat(32) })
    assert.equal(inspection.ok, true, 'the fresh-root production inspection must succeed')
    assert.ok(inspection.proposals.length > 0, 'a fresh empty root must yield scaffold proposals')
    consumer({ inspection, root: inspection.root })
  } finally {
    rmSync(scratch, { force: true, recursive: true })
  }
}

function enabledCodexWalk({ gate, root, overrides = {} }) {
  return dialogue.createGateWalk({
    approvalBranch: 'denied',
    approvalResponse: 'Do not apply this manifest.',
    gate,
    host: 'codex',
    hostContext: HOST_CONTEXTS.codex,
    hostOutcome: 'none',
    mode: 'enabled',
    onlineDisclosureCheck: () => ({ ok: true }),
    preApprovalTurns: [],
    scenarioRoot: root,
    verifyDisclosureSequence: () => ({ ok: true }),
    ...overrides,
  })
}

function syntheticProposal(overrides = {}) {
  return {
    actions: [],
    proposalDispositions: [],
    semanticDecisions: [],
    versionControlChoice: 'not-required',
    versionControlOptions: [...FIXED_OPTIONS],
    ...overrides,
  }
}

function runDialogueCases(repositoryRoot) {
  void repositoryRoot

  test('the dialogue engine modules export exactly their closed surfaces', () => {
    assert.deepEqual(Object.keys(applyRequest).sort(), ['VERSION_CONTROL_OPTION_ORDER', 'buildApprovedApplyRequest'])
    assert.deepEqual(Object.keys(hostEvents).sort(), [
      'CLAUDE_PUBLIC_SKILL_INVENTORY',
      'createClaudeSessionConductor',
      'createCodexTurnConductor',
      'isHookEvent',
      'parseHostEventLine',
      'validateClaudeSessionInit',
      'validateImportProbeInit',
      'validateImportProbeSession',
      'verifyTurnOutputEquality',
    ])
    assert.deepEqual(Object.keys(dialogue).sort(), ['buildApprovedApplyRequest', 'createGateWalk'])
    assert.equal(dialogue.buildApprovedApplyRequest, applyRequest.buildApprovedApplyRequest, 'the harness delegates approved apply-request construction to the shipped builder')
    assert.deepEqual(Object.keys(adjudication).sort(), [
      'buildExpectedDisclosureSequence',
      'compareSemanticClassifications',
      'deriveAllActionsDisclosed',
      'deriveAmbiguityCoverage',
      'deriveApprovalFacts',
      'deriveDeterministicDigest',
      'deriveElectionPresented',
      'deriveResultPresentation',
      'deriveWriterDisclosure',
      'verifyDisabledSemanticOwnership',
      'verifyDisclosureSequence',
      'verifyEnabledSemanticOwnership',
      'verifyInspectionBoundDisclosure',
    ])
    assert.deepEqual(hostEvents.CLAUDE_PUBLIC_SKILL_INVENTORY, TEN_SKILLS)
  })

  test('the Claude session conductor pins inline-plugin isolation and the exact ten-skill inventory', () => {
    const accept = (initOverrides) => {
      const conductor = hostEvents.createClaudeSessionConductor({ sessionPluginRoot: SYNTHETIC_PLUGIN_ROOT })

      return conductor.acceptLine(eventLine(claudeInit(SYNTHETIC_PLUGIN_ROOT, initOverrides)))
    }
    assert.deepEqual(accept({}), { accepted: { event: claudeInit(SYNTHETIC_PLUGIN_ROOT), kind: 'system-init' } })
    assert.equal(accept({ plugins: [{ name: 'nightshift', path: SYNTHETIC_PLUGIN_ROOT }, { name: 'superpowers', path: '/ambient' }] }).failure.reason, 'plugin-inventory')
    assert.equal(accept({ plugins: [{ name: 'nightshift', path: '/some/other/root' }] }).failure.reason, 'plugin-inventory')
    assert.equal(accept({ plugins: [] }).failure.reason, 'plugin-inventory')
    assert.equal(accept({ mcp_servers: [{ name: 'ambient', status: 'connected' }] }).failure.reason, 'mcp-server')
    assert.equal(accept({ skills: TEN_SKILLS.slice(1).map((name) => `nightshift:${name}`) }).failure.reason, 'skill-inventory')
    assert.equal(accept({ skills: [...TEN_SKILLS.map((name) => `nightshift:${name}`), 'nightshift:extra'] }).failure.reason, 'skill-inventory')
    assert.equal(accept({ slash_commands: [...TEN_SKILLS.map((name) => `nightshift:${name}`), 'nightshift:legacy-command'] }).failure.reason, 'legacy-command')
    const ambientExtras = accept({ skills: ['sync-gists', ...TEN_SKILLS.map((name) => `nightshift:${name}`)], slash_commands: ['compact', ...TEN_SKILLS.map((name) => `nightshift:${name}`)] })
    assert.equal(ambientExtras.accepted.kind, 'system-init', 'entries outside the nightshift namespace are not part of the closed plugin inventory')
  })

  test('the Claude conductor rejects hook events, duplicate init, and any event before init', () => {
    const conductor = hostEvents.createClaudeSessionConductor({ sessionPluginRoot: SYNTHETIC_PLUGIN_ROOT })
    assert.equal(conductor.acceptLine(eventLine({ subtype: 'hook_started', type: 'system' })).failure.reason, 'hook-event')
    assert.equal(conductor.acceptLine(eventLine({ message: {}, type: 'assistant' })).failure.reason, 'missing-init')
    const raw = eventLine(claudeInit(SYNTHETIC_PLUGIN_ROOT))
    const before = Buffer.from(raw)
    assert.equal(conductor.acceptLine(raw).accepted.kind, 'system-init')
    assert.deepEqual(raw, before, 'the conductor never mutates the raw line bytes')
    assert.equal(conductor.acceptLine(eventLine(claudeInit(SYNTHETIC_PLUGIN_ROOT))).failure.reason, 'duplicate-init')
    assert.equal(conductor.acceptLine(eventLine({ subtype: 'hook_response', type: 'system' })).failure.reason, 'hook-event')
    assert.equal(conductor.acceptLine(Buffer.from('not json', 'utf8')).failure.reason, 'unparseable-event')
    assert.equal(conductor.acceptLine(eventLine([1, 2])).failure.reason, 'unparseable-event')
    assert.equal(conductor.acceptLine(eventLine({ noType: true })).failure.reason, 'unparseable-event')
  })

  test('the Claude conductor extracts each structured turn and the final structured result', () => {
    const conductor = hostEvents.createClaudeSessionConductor({ sessionPluginRoot: SYNTHETIC_PLUGIN_ROOT })
    assert.equal(conductor.acceptLine(eventLine(claudeInit(SYNTHETIC_PLUGIN_ROOT))).accepted.kind, 'system-init')
    assert.equal(conductor.acceptLine(eventLine({ message: { content: [] }, type: 'assistant' })).accepted.kind, 'host-event')
    const first = conductor.acceptLine(eventLine({ structured_output: { gateId: 'g-one', phase: 'awaiting-response' }, subtype: 'success', type: 'result' }))
    assert.equal(first.accepted.kind, 'structured-result')
    assert.deepEqual(first.accepted.structuredOutput, { gateId: 'g-one', phase: 'awaiting-response' })
    assert.equal(conductor.acceptLine(eventLine({ subtype: 'success', type: 'result' })).failure.reason, 'missing-structured-output')
    assert.equal(conductor.acceptLine(eventLine({ structured_output: [1], type: 'result' })).failure.reason, 'missing-structured-output')
    assert.equal(conductor.acceptLine(eventLine({ structured_output: { phase: 'finished' }, type: 'result' })).accepted.kind, 'structured-result')
    assert.deepEqual(conductor.structuredResults(), [{ gateId: 'g-one', phase: 'awaiting-response' }, { phase: 'finished' }])
    assert.deepEqual(conductor.finalStructuredResult(), { phase: 'finished' })
    assert.deepEqual(conductor.initEvent(), claudeInit(SYNTHETIC_PLUGIN_ROOT))
  })

  test('the Codex turn conductor captures the unique thread id and exactly one structured result', () => {
    const conductor = hostEvents.createCodexTurnConductor()
    assert.equal(conductor.finish().reason, 'missing-thread-started')
    assert.equal(conductor.acceptLine(eventLine({ thread_id: '', type: 'thread.started' })).failure.reason, 'thread-id-invalid')
    assert.deepEqual(conductor.acceptLine(eventLine({ thread_id: 't-1', type: 'thread.started' })).accepted.threadId, 't-1')
    assert.equal(conductor.acceptLine(eventLine({ thread_id: 't-1', type: 'thread.started' })).failure.reason, 'duplicate-thread-started')
    assert.equal(conductor.finish().reason, 'missing-structured-result')
    assert.equal(conductor.acceptLine(eventLine({ item: { text: 'not json', type: 'agent_message' }, type: 'item.completed' })).failure.reason, 'structured-result-invalid')
    const structured = conductor.acceptLine(eventLine({ item: { text: '{"phase":"finished"}', type: 'agent_message' }, type: 'item.completed' }))
    assert.deepEqual(structured.accepted.structuredOutput, { phase: 'finished' })
    assert.equal(conductor.acceptLine(eventLine({ item: { text: '{"phase":"finished"}', type: 'agent_message' }, type: 'item.completed' })).failure.reason, 'duplicate-structured-result')
    assert.deepEqual(conductor.finish(), { ok: true, structuredResult: { phase: 'finished' }, threadId: 't-1' })
    assert.equal(conductor.acceptLine(eventLine({ message: 'boom', type: 'error' })).failure.reason, 'host-error-event')

    const resume = hostEvents.createCodexTurnConductor({ expectedThreadId: 't-1' })
    assert.equal(resume.acceptLine(eventLine({ thread_id: 't-2', type: 'thread.started' })).failure.reason, 'thread-id-mismatch')
    const resumeMatching = hostEvents.createCodexTurnConductor({ expectedThreadId: 't-1' })
    assert.equal(resumeMatching.acceptLine(eventLine({ item: { text: '{"ok":true}', type: 'agent_message' }, type: 'item.completed' })).accepted.kind, 'structured-result')
    assert.deepEqual(resumeMatching.finish(), { ok: true, structuredResult: { ok: true }, threadId: 't-1' })
  })

  test('the Codex turn output file must equal the one extracted structured result', () => {
    const structuredResult = { gateId: null, phase: 'finished' }
    assert.deepEqual(hostEvents.verifyTurnOutputEquality({ structuredResult, turnOutputBytes: Buffer.from('{"phase":"finished","gateId":null}', 'utf8') }), { ok: true })
    assert.equal(hostEvents.verifyTurnOutputEquality({ structuredResult, turnOutputBytes: Buffer.from('{"phase":"finished","gateId":"g"}', 'utf8') }).reason, 'output-file-disagreement')
    assert.equal(hostEvents.verifyTurnOutputEquality({ structuredResult, turnOutputBytes: Buffer.from('not json', 'utf8') }).reason, 'output-file-disagreement')
  })

  test('a conforming import-probe stream passes its case verdict for sentinel and null cases', () => {
    const cases = buildExpectedImportCases()
    const sentinelCase = cases.find((item) => item.caseId === 'start')
    const nullCase = cases.find((item) => item.caseId === 'tilde-bare')
    assert.notEqual(sentinelCase, undefined)
    assert.equal(nullCase.expectedSentinel, null)
    const stream = (sentinel) => Buffer.concat([
      eventLine(probeInit()), Buffer.from('\n'),
      eventLine({ message: { content: [{ text: 'ok', type: 'text' }] }, type: 'assistant' }), Buffer.from('\n'),
      eventLine({ structured_output: { sentinel }, subtype: 'success', type: 'result' }), Buffer.from('\n'),
    ])
    assert.deepEqual(hostEvents.validateImportProbeSession({
      expectedSentinel: sentinelCase.expectedSentinel,
      exitCode: 0,
      stderrBytes: Buffer.alloc(0),
      stdoutBytes: stream(sentinelCase.expectedSentinel),
    }), { passed: true })
    assert.deepEqual(hostEvents.validateImportProbeSession({
      expectedSentinel: null,
      exitCode: 0,
      stderrBytes: Buffer.alloc(0),
      stdoutBytes: stream(null),
    }), { passed: true })
  })

  test('the import-probe verdict fails for the named reason on each contract violation', () => {
    const sentinel = 'a1'.repeat(16)
    const baseEvents = [
      probeInit(),
      { message: { content: [{ text: 'ok', type: 'text' }] }, type: 'assistant' },
      { structured_output: { sentinel }, subtype: 'success', type: 'result' },
    ]
    const stdout = (events) => Buffer.concat(events.flatMap((event) => [eventLine(event), Buffer.from('\n')]))
    const verdict = (overrides = {}) => hostEvents.validateImportProbeSession({
      expectedSentinel: sentinel,
      exitCode: 0,
      stderrBytes: Buffer.alloc(0),
      stdoutBytes: stdout(baseEvents),
      ...overrides,
    })
    assert.deepEqual(verdict(), { passed: true })
    assert.equal(verdict({ exitCode: 1 }).reason, 'nonzero-exit')
    assert.equal(verdict({ stderrBytes: Buffer.from('warning\n') }).reason, 'stderr')
    assert.equal(verdict({ stdoutBytes: stdout([probeInit({ tools: ['Bash'] }), baseEvents[2]]) }).reason, 'probe-isolation')
    assert.equal(verdict({ stdoutBytes: stdout([probeInit({ mcp_servers: [{ name: 'x' }] }), baseEvents[2]]) }).reason, 'probe-isolation')
    assert.equal(verdict({ stdoutBytes: stdout([probeInit({ plugins: [{ name: 'x' }] }), baseEvents[2]]) }).reason, 'probe-isolation')
    assert.equal(verdict({ stdoutBytes: stdout([baseEvents[0], { subtype: 'hook_started', type: 'system' }, baseEvents[2]]) }).reason, 'hook-event')
    assert.equal(verdict({ stdoutBytes: stdout([baseEvents[0], { message: { content: [{ id: 't', type: 'tool_use' }] }, type: 'assistant' }, baseEvents[2]]) }).reason, 'tool-call')
    assert.equal(verdict({ stdoutBytes: stdout([baseEvents[1], baseEvents[2]]) }).reason, 'missing-init')
    assert.equal(verdict({ stdoutBytes: stdout([baseEvents[0], probeInit(), baseEvents[2]]) }).reason, 'duplicate-init')
    assert.equal(verdict({ stdoutBytes: stdout([baseEvents[0], baseEvents[1]]) }).reason, 'missing-result')
    assert.equal(verdict({ stdoutBytes: stdout([...baseEvents, baseEvents[2]]) }).reason, 'duplicate-result')
    assert.equal(verdict({ stdoutBytes: stdout([baseEvents[0], { subtype: 'success', type: 'result' }]) }).reason, 'missing-structured-output')
    assert.equal(verdict({ stdoutBytes: stdout([baseEvents[0], { structured_output: { sentinel: 'b2'.repeat(16) }, type: 'result' }]) }).reason, 'structured-output-mismatch')
    assert.equal(verdict({ stdoutBytes: stdout([baseEvents[0], { structured_output: { sentinel: null }, type: 'result' }]) }).reason, 'structured-output-mismatch')
    assert.equal(verdict({ stdoutBytes: Buffer.from('{"type":"x"}', 'utf8') }).reason, 'unparseable-event')
    assert.equal(verdict({ stdoutBytes: Buffer.from('nonsense\n', 'utf8') }).reason, 'unparseable-event')
    assert.throws(() => hostEvents.validateImportProbeSession({ expectedSentinel: 'UPPER', exitCode: 0, stderrBytes: Buffer.alloc(0), stdoutBytes: Buffer.alloc(0) }), /expectedSentinel/)
  })

  test('the enabled Codex walk drives the exact gate order and installs the production-built apply bytes', () => {
    withRealInspection(({ inspection, root }) => {
      const gate = driver.createAuthorizationGate({ host: 'codex', hostContext: HOST_CONTEXTS.codex, scenarioRoot: root })
      const manifestProposal = manifestProposalFrom(inspection)
      const expected = adjudication.buildExpectedDisclosureSequence({ manifestProposal, proposalCarriers: carriersFrom(inspection) })
      assert.ok(Array.isArray(expected.items) && expected.items.length > 0)
      const expectedApplyBytes = Buffer.concat([
        protocol.canonicalBytes({
          actions: manifestProposal.actions,
          host: 'codex',
          hostContext: HOST_CONTEXTS.codex,
          inspection,
          operation: 'apply',
          proposalDispositions: manifestProposal.proposalDispositions,
          protocolVersion: 1,
          root,
          semanticDecisions: [],
          versionControlChoice: 'not-required',
        }),
        Buffer.from('\n', 'ascii'),
      ])
      const faultAdmissions = []
      const onlineChecks = []
      const walk = dialogue.createGateWalk({
        applyFault: () => { faultAdmissions.push(gate.admit(expectedApplyBytes)) },
        approvalBranch: 'approved',
        approvalResponse: 'Approve this manifest.',
        faultSchedule: 'after-approval-create-features',
        gate,
        host: 'codex',
        hostContext: HOST_CONTEXTS.codex,
        hostOutcome: 'none',
        mode: 'enabled',
        onlineDisclosureCheck: (item, index) => {
          onlineChecks.push(index)

          return { ok: canonicalJson(item) === canonicalJson(expected.items[index]) }
        },
        preApprovalTurns: [],
        scenarioRoot: root,
        verifyDisclosureSequence: ({ items }) => adjudication.verifyDisclosureSequence({ expected: expected.items, observed: items }),
      })
      const inspectRequest = inspectRequestBytes({ host: 'codex', hostContext: HOST_CONTEXTS.codex, root })
      assert.equal(gate.admit(inspectRequest).ok, false, 'no controller request is authorized before the host-context gate')
      const contextResponse = walk.receiveTurn(makeTurn({ gateId: 'host-context-confirmation' }))
      assert.deepEqual(contextResponse, { action: 'respond', kind: 'host-context', response: CODEX_HOST_CONTEXT_CONFIRMATION })
      assert.deepEqual(gate.admit(inspectRequest), { ok: true, operation: 'inspect' }, 'the host-context response authorizes exactly the inspect request')
      gate.recordInspectSuccess(Buffer.from(canonicalJson(inspection) + '\n', 'utf8'))
      for (const item of expected.items) {
        assert.deepEqual(walk.receiveTurn(makeTurn({ disclosures: [item], gateId: 'action-disclosure' })), {
          action: 'respond',
          kind: 'host-control',
          response: HOST_CONTROL_RECORDS.disclosureAcknowledgement,
        })
      }
      assert.deepEqual(onlineChecks, expected.items.map((item, index) => index))
      const approval = walk.receiveTurn(makeTurn({ gateId: 'manifest-approval', manifestProposal }))
      assert.deepEqual(approval, { action: 'respond', kind: 'approval', response: 'Approve this manifest.' })
      assert.equal(faultAdmissions.length, 1, 'the drift fault runs exactly once')
      assert.deepEqual(faultAdmissions[0], { ok: true, operation: 'apply' }, 'the apply authorization is fixed before the fault runs')
      assert.deepEqual(gate.admit(expectedApplyBytes), { ok: true, operation: 'apply' })
      assert.equal(gate.admit(Buffer.concat([expectedApplyBytes, Buffer.from(' ')])).reason, 'request-byte')
      const done = walk.receiveTurn(makeTurn({ phase: 'finished', result: { complete: true, ok: true } }))
      assert.deepEqual(done, { done: true, result: { complete: true, ok: true } })
      assert.equal(walk.receiveTurn(makeTurn({ gateId: 'manifest-approval', manifestProposal })).failure.reason, 'extra-turn')
    })
  })

  test('the production apply-request builder rejects hand-shaped proposals and duplicate actions', () => {
    withRealInspection(({ inspection, root }) => {
      const manifestProposal = manifestProposalFrom(inspection)
      const bytes = dialogue.buildApprovedApplyRequest({ host: 'codex', hostContext: HOST_CONTEXTS.codex, inspection, manifestProposal, root })
      assert.equal(bytes[bytes.length - 1], 0x0a, 'the request bytes end with one LF')
      const parsed = JSON.parse(bytes.toString('utf8'))
      assert.equal(parsed.operation, 'apply')
      assert.equal(canonicalJson(parsed.actions), canonicalJson(manifestProposal.actions), 'the actions array uses the production canonical order')
      assert.throws(() => dialogue.buildApprovedApplyRequest({
        host: 'codex',
        hostContext: HOST_CONTEXTS.codex,
        inspection,
        manifestProposal: { ...manifestProposal, versionControlOptions: ['ignore', 'track', 'deferred', 'not-required'] },
        root,
      }), /fixed order/)
      assert.throws(() => dialogue.buildApprovedApplyRequest({
        host: 'codex',
        hostContext: HOST_CONTEXTS.codex,
        inspection,
        manifestProposal: { ...manifestProposal, extra: true },
        root,
      }), /closed proposal members/)
      const flipped = manifestProposal.proposalDispositions.map((item, index) => index === 0 ? { ...item, disposition: item.disposition === 'selected' ? 'condition-not-selected' : 'selected' } : item)
      assert.throws(() => dialogue.buildApprovedApplyRequest({
        host: 'codex',
        hostContext: HOST_CONTEXTS.codex,
        inspection,
        manifestProposal: { ...manifestProposal, proposalDispositions: flipped },
        root,
      }), (error) => error.record?.code === 'manifest-invalid')
      assert.throws(() => dialogue.buildApprovedApplyRequest({
        host: 'codex',
        hostContext: HOST_CONTEXTS.codex,
        inspection,
        manifestProposal: { ...manifestProposal, actions: [...manifestProposal.actions, manifestProposal.actions[0]] },
        root,
      }), /duplicated/)
    })
  })

  test('the walk consumes each preapproval gate exactly once in fixture order', () => {
    const makeWalk = () => dialogue.createGateWalk({
      approvalBranch: 'denied',
      approvalResponse: 'Do not apply this manifest.',
      host: 'codex',
      hostOutcome: 'none',
      mode: 'disabled',
      preApprovalTurns: [
        { gateId: 'version-control-choice', response: 'Track the non-plan backlog files.' },
        { gateId: 'semantic-quick-wins', response: 'Apply the exact repair.' },
      ],
      verifyDisclosureSequence: () => ({ ok: true }),
    })
    const ordered = makeWalk()
    assert.deepEqual(ordered.receiveTurn(makeTurn({ gateId: 'version-control-choice' })), { action: 'respond', kind: 'scripted', response: 'Track the non-plan backlog files.' })
    assert.deepEqual(ordered.receiveTurn(makeTurn({ gateId: 'semantic-quick-wins' })), { action: 'respond', kind: 'scripted', response: 'Apply the exact repair.' })
    assert.deepEqual(ordered.receiveTurn(makeTurn({ gateId: 'manifest-approval', manifestProposal: syntheticProposal() })), { action: 'respond', kind: 'approval', response: 'Do not apply this manifest.' })
    assert.equal(makeWalk().receiveTurn(makeTurn({ gateId: 'semantic-quick-wins' })).failure.reason, 'wrong-gate')
    const repeated = makeWalk()
    repeated.receiveTurn(makeTurn({ gateId: 'version-control-choice' }))
    assert.equal(repeated.receiveTurn(makeTurn({ gateId: 'version-control-choice' })).failure.reason, 'wrong-gate')
    const skipping = makeWalk()
    skipping.receiveTurn(makeTurn({ gateId: 'version-control-choice' }))
    assert.equal(skipping.receiveTurn(makeTurn({ gateId: 'action-disclosure', disclosures: [{ actionId: 'a-one', kind: 'structural-action', proposalDigest: 'c'.repeat(64), selection: 'selected', target: '.claude' }] })).failure.reason, 'missing-gate')
    assert.equal(makeWalk().receiveTurn(makeTurn({ gateId: 'unknown-gate' })).failure.reason, 'wrong-gate')
  })

  test('host-context gates are scoped to their exact host, mode, and root state', () => {
    const codexGate = () => driver.createAuthorizationGate({ host: 'codex', hostContext: HOST_CONTEXTS.codex, scenarioRoot: SYNTHETIC_ROOT })
    const misordered = enabledCodexWalk({ gate: codexGate(), root: SYNTHETIC_ROOT, overrides: { preApprovalTurns: [{ gateId: 'version-control-choice', response: 'Track the non-plan backlog files.' }] } })
    assert.equal(misordered.receiveTurn(makeTurn({ gateId: 'version-control-choice' })).failure.reason, 'wrong-gate')
    const disabledContext = dialogue.createGateWalk({
      approvalBranch: 'denied',
      approvalResponse: 'Do not apply this manifest.',
      host: 'codex',
      hostOutcome: 'none',
      mode: 'disabled',
      preApprovalTurns: [],
      verifyDisclosureSequence: () => ({ ok: true }),
    })
    assert.equal(disabledContext.receiveTurn(makeTurn({ gateId: 'host-context-confirmation' })).failure.reason, 'wrong-gate')

    const missingRootWalk = (response) => {
      const gate = driver.createAuthorizationGate({ host: 'claude-code', hostContext: HOST_CONTEXTS.claudeMissingRoot, scenarioRoot: SYNTHETIC_ROOT })

      return {
        gate,
        walk: dialogue.createGateWalk({
          approvalBranch: 'denied',
          approvalResponse: 'Do not apply this manifest.',
          claudeRootExclusion: { present: false, response, verifiedLoadedMemory: null },
          gate,
          host: 'claude-code',
          hostContext: HOST_CONTEXTS.claudeMissingRoot,
          hostOutcome: 'none',
          mode: 'enabled',
          onlineDisclosureCheck: () => ({ ok: true }),
          preApprovalTurns: [],
          scenarioRoot: SYNTHETIC_ROOT,
          verifyDisclosureSequence: () => ({ ok: true }),
        }),
      }
    }
    const claudeInspect = inspectRequestBytes({ host: 'claude-code', hostContext: HOST_CONTEXTS.claudeMissingRoot, root: SYNTHETIC_ROOT })
    const confirmed = missingRootWalk(CLAUDE_ROOT_EXCLUSION_CONFIRMATION)
    assert.deepEqual(confirmed.walk.receiveTurn(makeTurn({ gateId: 'claude-root-exclusion-confirmation' })), { action: 'respond', kind: 'host-context', response: CLAUDE_ROOT_EXCLUSION_CONFIRMATION })
    assert.deepEqual(confirmed.gate.admit(claudeInspect), { ok: true, operation: 'inspect' })
    const denied = missingRootWalk('Do not confirm the exclusion.')
    assert.deepEqual(denied.walk.receiveTurn(makeTurn({ gateId: 'claude-root-exclusion-confirmation' })), { action: 'respond', kind: 'scripted', response: 'Do not confirm the exclusion.' })
    assert.equal(denied.gate.admit(claudeInspect).ok, false, 'a denied missing-root response authorizes no request')
    assert.equal(denied.walk.receiveTurn(makeTurn({ gateId: 'version-control-choice' })).failure.reason, 'wrong-gate')
    const unresponsive = missingRootWalk(null)
    assert.deepEqual(unresponsive.walk.receiveTurn(makeTurn({ gateId: 'claude-root-exclusion-confirmation' })), { action: 'respond', kind: 'host-control', response: HOST_CONTROL_RECORDS.unavailable })
    assert.equal(unresponsive.gate.admit(claudeInspect).ok, false)
    assert.deepEqual(unresponsive.walk.receiveTurn(makeTurn({ phase: 'finished', result: { approvalBranch: 'unavailable', reasonCode: 'guidance-resolution' } })), {
      done: true,
      result: { approvalBranch: 'unavailable', reasonCode: 'guidance-resolution' },
    })
    assert.equal(missingRootWalk('Do not confirm the exclusion.').walk.receiveTurn(makeTurn({ gateId: 'claude-root-exclusion-confirmation' })).action, 'respond')

    const presentWalk = (verifiedLoadedMemory) => {
      const gate = driver.createAuthorizationGate({ host: 'claude-code', hostContext: HOST_CONTEXTS.claudePresentRoot, scenarioRoot: SYNTHETIC_ROOT })
      const walk = dialogue.createGateWalk({
        approvalBranch: 'denied',
        approvalResponse: 'Do not apply this manifest.',
        claudeRootExclusion: { present: true, response: null, verifiedLoadedMemory },
        gate,
        host: 'claude-code',
        hostContext: HOST_CONTEXTS.claudePresentRoot,
        hostOutcome: 'none',
        mode: 'enabled',
        onlineDisclosureCheck: () => ({ ok: true }),
        preApprovalTurns: [{ gateId: 'semantic-quick-wins', response: 'Apply the exact repair.' }],
        scenarioRoot: SYNTHETIC_ROOT,
        verifyDisclosureSequence: () => ({ ok: true }),
      })

      return { gate, walk }
    }
    const presentInspect = inspectRequestBytes({ host: 'claude-code', hostContext: HOST_CONTEXTS.claudePresentRoot, root: SYNTHETIC_ROOT })
    const verified = presentWalk(true)
    assert.deepEqual(verified.gate.admit(presentInspect), { ok: true, operation: 'inspect' }, 'a verified present root authorizes inspect before the first model gate')
    assert.deepEqual(verified.walk.receiveTurn(makeTurn({ gateId: 'semantic-quick-wins' })), { action: 'respond', kind: 'scripted', response: 'Apply the exact repair.' })
    const unverified = presentWalk(false)
    assert.equal(unverified.gate.admit(presentInspect).ok, false, 'an unverified present root authorizes no inspect')
    assert.equal(unverified.walk.receiveTurn(makeTurn({ gateId: 'semantic-quick-wins' })).failure.reason, 'wrong-gate')
    const stopped = presentWalk(false)
    assert.equal(stopped.walk.receiveTurn(makeTurn({ phase: 'finished', result: { approvalBranch: 'unavailable', reasonCode: 'denied' } })).failure.reason, 'context-result')
    const stoppedClean = presentWalk(false)
    assert.equal(stoppedClean.walk.receiveTurn(makeTurn({ phase: 'finished', result: { approvalBranch: 'unavailable', reasonCode: 'guidance-resolution' } })).done, true)
  })

  test('disclosure turns are acknowledged only with the fixed host-control record and bind one digest', () => {
    const digest = sha256(Buffer.from(canonicalJson(syntheticProposal()), 'utf8'))
    const item = (overrides = {}) => ({ actionId: 'a-one', kind: 'structural-action', proposalDigest: digest, selection: 'selected', target: '.claude', ...overrides })
    const walkWith = (overrides = {}) => enabledCodexWalk({ gate: driver.createAuthorizationGate({ host: 'codex', hostContext: HOST_CONTEXTS.codex, scenarioRoot: SYNTHETIC_ROOT }), root: SYNTHETIC_ROOT, overrides })
    const contextTurn = makeTurn({ gateId: 'host-context-confirmation' })

    const acknowledged = walkWith()
    acknowledged.receiveTurn(contextTurn)
    assert.deepEqual(acknowledged.receiveTurn(makeTurn({ disclosures: [item()], gateId: 'action-disclosure' })), {
      action: 'respond',
      kind: 'host-control',
      response: HOST_CONTROL_RECORDS.disclosureAcknowledgement,
    })
    assert.equal(acknowledged.receiveTurn(makeTurn({ disclosures: [item({ proposalDigest: 'd'.repeat(64) })], gateId: 'action-disclosure' })).failure.reason, 'proposal-digest')

    const twoItems = walkWith()
    twoItems.receiveTurn(contextTurn)
    assert.equal(twoItems.receiveTurn(makeTurn({ disclosures: [item(), item({ actionId: 'a-two' })], gateId: 'action-disclosure' })).failure.reason, 'disclosure-cardinality')

    const rejectedOnline = walkWith({ onlineDisclosureCheck: () => ({ ok: false }) })
    rejectedOnline.receiveTurn(contextTurn)
    assert.equal(rejectedOnline.receiveTurn(makeTurn({ disclosures: [item()], gateId: 'action-disclosure' })).failure.reason, 'disclosure-online-check')

    const premature = walkWith()
    premature.receiveTurn(contextTurn)
    assert.equal(premature.receiveTurn(makeTurn({ disclosures: [item()], gateId: 'action-disclosure', manifestProposal: syntheticProposal() })).failure.reason, 'premature-proposal')

    const misplaced = walkWith({ preApprovalTurns: [{ gateId: 'version-control-choice', response: 'Track the non-plan backlog files.' }] })
    misplaced.receiveTurn(contextTurn)
    assert.equal(misplaced.receiveTurn(makeTurn({ disclosures: [item()], gateId: 'version-control-choice' })).failure.reason, 'unexpected-disclosure')
  })

  test('manifest approval verifies digest identity and the disclosure sequence before any response', () => {
    const proposal = syntheticProposal()
    const digest = sha256(Buffer.from(canonicalJson(proposal), 'utf8'))
    const sequenceCalls = []
    const walkWith = (overrides = {}) => enabledCodexWalk({
      gate: driver.createAuthorizationGate({ host: 'codex', hostContext: HOST_CONTEXTS.codex, scenarioRoot: SYNTHETIC_ROOT }),
      root: SYNTHETIC_ROOT,
      overrides: { verifyDisclosureSequence: (input) => { sequenceCalls.push(input); return { ok: true } }, ...overrides },
    })
    const contextTurn = makeTurn({ gateId: 'host-context-confirmation' })
    const foreignItem = { actionId: 'a-one', kind: 'structural-action', proposalDigest: 'e'.repeat(64), selection: 'selected', target: '.claude' }

    const mismatched = walkWith()
    mismatched.receiveTurn(contextTurn)
    mismatched.receiveTurn(makeTurn({ disclosures: [foreignItem], gateId: 'action-disclosure' }))
    sequenceCalls.length = 0
    assert.equal(mismatched.receiveTurn(makeTurn({ gateId: 'manifest-approval', manifestProposal: proposal })).failure.reason, 'proposal-digest')
    assert.equal(sequenceCalls.length, 0, 'the sequence verifier never runs after a digest identity failure')

    const failingSequence = walkWith({ verifyDisclosureSequence: () => ({ ok: false, reason: 'disclosure-sequence' }) })
    failingSequence.receiveTurn(contextTurn)
    failingSequence.receiveTurn(makeTurn({ disclosures: [{ actionId: 'a-one', kind: 'structural-action', proposalDigest: digest, selection: 'selected', target: '.claude' }], gateId: 'action-disclosure' }))
    assert.equal(failingSequence.receiveTurn(makeTurn({ gateId: 'manifest-approval', manifestProposal: proposal })).failure.reason, 'disclosure-sequence')

    const nonEmptyApproval = walkWith()
    nonEmptyApproval.receiveTurn(contextTurn)
    assert.equal(nonEmptyApproval.receiveTurn(makeTurn({
      disclosures: [{ actionId: 'a-one', kind: 'structural-action', proposalDigest: digest, selection: 'selected', target: '.claude' }],
      gateId: 'manifest-approval',
      manifestProposal: proposal,
    })).failure.reason, 'approval-disclosures-nonempty')

    const missingProposal = walkWith()
    missingProposal.receiveTurn(contextTurn)
    assert.equal(missingProposal.receiveTurn(makeTurn({ gateId: 'manifest-approval' })).failure.reason, 'missing-proposal')

    const missingInspection = walkWith({ approvalBranch: 'approved', approvalResponse: 'Approve this manifest.' })
    missingInspection.receiveTurn(contextTurn)
    assert.equal(missingInspection.receiveTurn(makeTurn({ gateId: 'manifest-approval', manifestProposal: proposal })).failure.reason, 'missing-inspection')
  })

  test('every non-approved branch permanently authorizes no apply and dispatches its exact record', () => {
    const proposal = syntheticProposal()
    const walkFor = (approvalBranch, gate, overrides = {}) => enabledCodexWalk({
      gate,
      root: SYNTHETIC_ROOT,
      overrides: {
        approvalBranch,
        approvalResponse: ['approved', 'denied', 'deferred'].includes(approvalBranch) ? 'Scripted approval-branch response.' : null,
        hostOutcome: ['approved', 'denied', 'deferred'].includes(approvalBranch) ? 'none' : approvalBranch,
        ...overrides,
      },
    })
    const drive = (approvalBranch) => {
      const gate = driver.createAuthorizationGate({ host: 'codex', hostContext: HOST_CONTEXTS.codex, scenarioRoot: SYNTHETIC_ROOT })
      const walk = walkFor(approvalBranch, gate)
      walk.receiveTurn(makeTurn({ gateId: 'host-context-confirmation' }))
      gate.recordInspectSuccess(Buffer.from('{"ok":true}', 'utf8'))

      return { gate, response: walk.receiveTurn(makeTurn({ gateId: 'manifest-approval', manifestProposal: proposal })) }
    }
    const denied = drive('denied')
    assert.deepEqual(denied.response, { action: 'respond', kind: 'approval', response: 'Scripted approval-branch response.' })
    assert.throws(() => denied.gate.installApplyAuthorization(Buffer.from('{}')), /non-approved branch/)
    const unavailable = drive('unavailable')
    assert.deepEqual(unavailable.response, { action: 'respond', kind: 'host-control', response: HOST_CONTROL_RECORDS.unavailable })
    const autoDenied = drive('auto-denied')
    assert.deepEqual(autoDenied.response, { action: 'respond', kind: 'host-control', response: HOST_CONTROL_RECORDS.autoDenied })
  })

  test('the walk constructor enforces the closed fixture pairings and mode wiring', () => {
    const base = {
      approvalBranch: 'denied',
      approvalResponse: 'Do not apply this manifest.',
      host: 'codex',
      hostOutcome: 'none',
      mode: 'disabled',
      preApprovalTurns: [],
      verifyDisclosureSequence: () => ({ ok: true }),
    }
    assert.doesNotThrow(() => dialogue.createGateWalk(base))
    assert.throws(() => dialogue.createGateWalk({ ...base, approvalBranch: 'approved', approvalResponse: null }), /approvalResponse/)
    assert.throws(() => dialogue.createGateWalk({ ...base, approvalBranch: 'unavailable' }), /approvalResponse|hostOutcome/)
    assert.throws(() => dialogue.createGateWalk({ ...base, approvalBranch: 'unavailable', approvalResponse: null, hostOutcome: 'auto-denied' }), /hostOutcome/)
    assert.throws(() => dialogue.createGateWalk({ ...base, hostOutcome: 'unavailable' }), /hostOutcome/)
    assert.throws(() => dialogue.createGateWalk({ ...base, approvalBranch: 'refused' }), /approvalBranch/)
    assert.throws(() => dialogue.createGateWalk({ ...base, faultSchedule: 'sometimes' }), /faultSchedule/)
    assert.throws(() => dialogue.createGateWalk({ ...base, faultSchedule: 'after-approval-create-features' }), /applyFault/)
    assert.throws(() => dialogue.createGateWalk({ ...base, preApprovalTurns: [{ gateId: 'manifest-approval', response: 'x' }] }), /reserved/)
    assert.throws(() => dialogue.createGateWalk({ ...base, preApprovalTurns: [{ gateId: 'g', response: 'x' }, { gateId: 'g', response: 'y' }] }), /unique/)
    assert.throws(() => dialogue.createGateWalk({ ...base, preApprovalTurns: [{ gateId: '', response: 'x' }] }), /nonblank/)
    assert.throws(() => dialogue.createGateWalk({ ...base, gate: {} }), /gate/)
    assert.throws(() => dialogue.createGateWalk({ ...base, mode: 'enabled' }), /gate|scenarioRoot|onlineDisclosureCheck|hostContext/)
    assert.throws(() => dialogue.createGateWalk({ ...base, claudeRootExclusion: { present: false, response: null, verifiedLoadedMemory: null } }), /claudeRootExclusion/)
    assert.throws(() => enabledCodexWalk({ gate: driver.createAuthorizationGate({ host: 'claude-code', hostContext: HOST_CONTEXTS.claudePresentRoot, scenarioRoot: SYNTHETIC_ROOT }), root: SYNTHETIC_ROOT, overrides: { host: 'claude-code', hostContext: HOST_CONTEXTS.claudePresentRoot } }), /claudeRootExclusion/)
  })

  test('a result before the scripted branch or an extra gate after approval fails the walk', () => {
    const walkWith = () => enabledCodexWalk({ gate: driver.createAuthorizationGate({ host: 'codex', hostContext: HOST_CONTEXTS.codex, scenarioRoot: SYNTHETIC_ROOT }), root: SYNTHETIC_ROOT })
    const early = walkWith()
    assert.equal(early.receiveTurn(makeTurn({ phase: 'finished', result: { ok: true } })).failure.reason, 'early-result')
    assert.equal(early.receiveTurn(makeTurn({ gateId: 'host-context-confirmation' })).failure.reason, 'walk-failed')
    const schema = walkWith()
    assert.equal(schema.receiveTurn({ phase: 'awaiting-response' }).failure.reason, 'turn-schema')
    const extra = walkWith()
    extra.receiveTurn(makeTurn({ gateId: 'host-context-confirmation' }))
    extra.receiveTurn(makeTurn({ gateId: 'manifest-approval', manifestProposal: syntheticProposal() }))
    assert.equal(extra.receiveTurn(makeTurn({ gateId: 'action-disclosure', disclosures: [{ actionId: 'a-one', kind: 'structural-action', proposalDigest: 'c'.repeat(64), selection: 'selected', target: '.claude' }] })).failure.reason, 'extra-gate')
  })

  test('approval ordering and apply cardinality derive only from input and proxy ordinals', () => {
    const facts = (input) => adjudication.deriveApprovalFacts(input)
    assert.deepEqual(facts({ applyCalls: [{ proxyOrdinal: 2, transcriptWatermark: 9 }], approvalBranch: 'approved', approvalInputOrdinal: 7 }), {
      approvalApplyCardinality: true,
      approvalBeforeApply: true,
      denialNoApply: true,
    })
    assert.equal(facts({ applyCalls: [{ proxyOrdinal: 2, transcriptWatermark: 5 }], approvalBranch: 'approved', approvalInputOrdinal: 7 }).approvalBeforeApply, false)
    assert.equal(facts({ applyCalls: [], approvalBranch: 'approved', approvalInputOrdinal: 7 }).approvalApplyCardinality, false)
    assert.equal(facts({ applyCalls: [{ proxyOrdinal: 2, transcriptWatermark: 9 }, { proxyOrdinal: 3, transcriptWatermark: 10 }], approvalBranch: 'approved', approvalInputOrdinal: 7 }).approvalApplyCardinality, false)
    const deniedWithApply = facts({ applyCalls: [{ proxyOrdinal: 2, transcriptWatermark: 9 }], approvalBranch: 'denied', approvalInputOrdinal: 7 })
    assert.deepEqual(deniedWithApply, { approvalApplyCardinality: false, approvalBeforeApply: false, denialNoApply: false })
    assert.deepEqual(facts({ applyCalls: [], approvalBranch: 'deferred', approvalInputOrdinal: 7 }), { approvalApplyCardinality: true, approvalBeforeApply: true, denialNoApply: true })
    assert.deepEqual(facts({ applyCalls: [], approvalBranch: 'unavailable', approvalInputOrdinal: null }), { approvalApplyCardinality: true, approvalBeforeApply: true, denialNoApply: true })
    assert.equal(facts({ applyCalls: [{ proxyOrdinal: 2, transcriptWatermark: 9 }], approvalBranch: 'approved', approvalInputOrdinal: null }).approvalBeforeApply, false)
    assert.throws(() => facts({ applyCalls: [{ proxyOrdinal: 0, transcriptWatermark: 9 }], approvalBranch: 'approved', approvalInputOrdinal: 7 }), /proxyOrdinal/)
    assert.throws(() => facts({ applyCalls: [], approvalBranch: 'refused', approvalInputOrdinal: null }), /approvalBranch/)
  })

  test('ambiguity coverage requires every presented ambiguity to be asked as a gate', () => {
    assert.equal(adjudication.deriveAmbiguityCoverage({ ambiguityIdSequences: [['semantic-quick-wins']], gateIds: ['host-context-confirmation', 'semantic-quick-wins', 'manifest-approval'] }), true)
    assert.equal(adjudication.deriveAmbiguityCoverage({ ambiguityIdSequences: [['semantic-quick-wins'], ['semantic-features']], gateIds: ['semantic-quick-wins', 'manifest-approval'] }), false)
    assert.equal(adjudication.deriveAmbiguityCoverage({ ambiguityIdSequences: [], gateIds: [] }), true)
    assert.throws(() => adjudication.deriveAmbiguityCoverage({ ambiguityIdSequences: [['x', 3]], gateIds: [] }), /ambiguity/)
  })

  test('election presentation derives from the manifest proposal alone', () => {
    assert.equal(adjudication.deriveElectionPresented({ electionRequired: false, manifestProposal: null }), true)
    assert.equal(adjudication.deriveElectionPresented({ electionRequired: true, manifestProposal: null }), false)
    assert.equal(adjudication.deriveElectionPresented({ electionRequired: true, manifestProposal: syntheticProposal({ versionControlChoice: 'track' }) }), true)
    assert.equal(adjudication.deriveElectionPresented({ electionRequired: true, manifestProposal: syntheticProposal({ versionControlChoice: 'deferred' }) }), true)
    assert.equal(adjudication.deriveElectionPresented({ electionRequired: true, manifestProposal: syntheticProposal() }), false)
    assert.equal(adjudication.deriveElectionPresented({ electionRequired: false, manifestProposal: syntheticProposal() }), true)
    assert.equal(adjudication.deriveElectionPresented({ electionRequired: false, manifestProposal: syntheticProposal({ versionControlChoice: 'track' }) }), false)
    assert.equal(adjudication.deriveElectionPresented({ electionRequired: true, manifestProposal: syntheticProposal({ versionControlChoice: 'track', versionControlOptions: ['ignore', 'track', 'deferred', 'not-required'] }) }), false)
  })

  test('the independently rebuilt disclosure sequence pins every carrier grammar', () => {
    const manifestProposal = syntheticProposal({
      proposalDispositions: [
        { disposition: 'selected', proposalId: `p-${'a'.repeat(62)}` },
        { disposition: 'condition-not-selected', proposalId: `p-${'b'.repeat(62)}` },
      ],
    })
    const digest = sha256(Buffer.from(canonicalJson(manifestProposal), 'utf8'))
    const built = adjudication.buildExpectedDisclosureSequence({
      manifestProposal,
      proposalCarriers: [
        { actionId: 'dir-claude', kind: 'structural-action', target: '.claude' },
        { actionId: 'create-features', afterBytes: Buffer.from('hello\n', 'utf8'), beforeBytes: null, kind: 'decoded', target: '.claude/FEATURES.md' },
      ],
      semanticCarriers: [
        { actionId: 'edit-quick-wins', afterBytes: Buffer.from('new\n', 'utf8'), beforeBytes: Buffer.from('old\n', 'utf8'), kind: 'decoded', target: '.claude/QUICK_WINS.md' },
      ],
    })
    assert.deepEqual(built.items, [
      { actionId: 'dir-claude', kind: 'structural-action', proposalDigest: digest, selection: 'selected', target: '.claude' },
      { actionId: 'create-features', chunkCount: 1, chunkIndex: 0, endByte: 6, image: 'after', kind: 'decoded-content', proposalDigest: digest, rawSha256: sha256(Buffer.from('hello\n', 'utf8')), selection: 'condition-not-selected', startByte: 0, target: '.claude/FEATURES.md', text: 'hello\n' },
      { actionId: 'edit-quick-wins', chunkCount: 1, chunkIndex: 0, endByte: 4, image: 'before', kind: 'decoded-content', proposalDigest: digest, rawSha256: sha256(Buffer.from('old\n', 'utf8')), selection: 'selected', startByte: 0, target: '.claude/QUICK_WINS.md', text: 'old\n' },
      { actionId: 'edit-quick-wins', chunkCount: 1, chunkIndex: 0, endByte: 4, image: 'after', kind: 'decoded-content', proposalDigest: digest, rawSha256: sha256(Buffer.from('new\n', 'utf8')), selection: 'selected', startByte: 0, target: '.claude/QUICK_WINS.md', text: 'new\n' },
    ])
    const breakoutProposal = syntheticProposal({ proposalDispositions: [{ disposition: 'selected', proposalId: `p-${'c'.repeat(62)}` }] })
    const breakoutDigest = sha256(Buffer.from(canonicalJson(breakoutProposal), 'utf8'))
    const breakout = adjudication.buildExpectedDisclosureSequence({
      manifestProposal: breakoutProposal,
      proposalCarriers: [{ actionId: 'unwrap-bugs', afterRawSha256: 'b'.repeat(64), beforeRawSha256: 'a'.repeat(64), kind: 'breakout-digest', target: '.claude/BUGS.md' }],
    })
    assert.deepEqual(breakout.items, [{
      actionId: 'unwrap-bugs',
      afterRawSha256: 'b'.repeat(64),
      beforeRawSha256: 'a'.repeat(64),
      extent: 'complete-file',
      kind: 'breakout-digest',
      notice: 'Decoded before and after images are withheld for mechanical breakout unwrap.',
      proposalDigest: breakoutDigest,
      selection: 'selected',
      target: '.claude/BUGS.md',
    }])
    const emptyAfter = adjudication.buildExpectedDisclosureSequence({
      manifestProposal: breakoutProposal,
      proposalCarriers: [{ actionId: 'create-gitkeep', afterBytes: Buffer.alloc(0), beforeBytes: null, kind: 'decoded', target: '.claude/plans/.gitkeep' }],
    })
    assert.deepEqual(emptyAfter.items, [{
      actionId: 'create-gitkeep',
      byteLength: 0,
      image: 'after',
      kind: 'decoded-empty',
      proposalDigest: breakoutDigest,
      rawSha256: sha256(Buffer.alloc(0)),
      selection: 'selected',
      target: '.claude/plans/.gitkeep',
    }])
    assert.throws(() => adjudication.buildExpectedDisclosureSequence({ manifestProposal, proposalCarriers: [{ actionId: 'dir-claude', kind: 'structural-action', target: '.claude' }] }), /cover every proposal disposition/)
    assert.throws(() => adjudication.buildExpectedDisclosureSequence({ manifestProposal: breakoutProposal, proposalCarriers: [{ actionId: 'x-one', kind: 'unknown', target: '.claude' }] }), /carrier kind/)

    assert.deepEqual(adjudication.verifyDisclosureSequence({ expected: built.items, observed: built.items.map((entry) => ({ ...entry })) }), { ok: true })
    assert.equal(adjudication.verifyDisclosureSequence({ expected: built.items, observed: [...built.items].reverse() }).ok, false)
    assert.equal(adjudication.verifyDisclosureSequence({ expected: built.items, observed: built.items.slice(1) }).ok, false)
    const mutated = built.items.map((entry, index) => index === 1 ? { ...entry, text: 'HELLO\n' } : entry)
    assert.equal(adjudication.verifyDisclosureSequence({ expected: built.items, observed: mutated }).ok, false)
    assert.equal(adjudication.deriveAllActionsDisclosed({ expected: built.items, observed: built.items }), true)
    assert.equal(adjudication.deriveAllActionsDisclosed({ expected: built.items, observed: mutated }), false)
  })

  test('online disclosure checks bind only facts available from inspection', () => {
    const decodedBytes = Buffer.from('hello\n', 'utf8')
    const carriers = [
      { actionId: 'dir-claude', kind: 'structural-action', target: '.claude' },
      { actionId: 'unwrap-bugs', afterRawSha256: 'b'.repeat(64), beforeRawSha256: 'a'.repeat(64), kind: 'breakout-digest', target: '.claude/BUGS.md' },
      { actionId: 'create-features', afterBytes: decodedBytes, beforeBytes: null, kind: 'decoded', target: '.claude/FEATURES.md' },
      { actionId: 'create-gitkeep', afterBytes: Buffer.alloc(0), beforeBytes: null, kind: 'decoded', target: '.claude/plans/.gitkeep' },
    ]
    const proposalBinding = { proposalDigest: 'f'.repeat(64), selection: 'condition-not-selected' }
    assert.equal(adjudication.verifyInspectionBoundDisclosure({
      item: { actionId: 'dir-claude', kind: 'structural-action', target: '.claude', ...proposalBinding },
      proposalCarriers: carriers,
    }).ok, true, 'the later manifest owns selection and proposal digest validation')
    assert.equal(adjudication.verifyInspectionBoundDisclosure({
      item: { actionId: 'dir-claude', kind: 'structural-action', target: '.claude/other', ...proposalBinding },
      proposalCarriers: carriers,
    }).ok, false)
    assert.equal(adjudication.verifyInspectionBoundDisclosure({
      item: {
        actionId: 'unwrap-bugs',
        afterRawSha256: 'b'.repeat(64),
        beforeRawSha256: 'a'.repeat(64),
        extent: 'complete-file',
        kind: 'breakout-digest',
        notice: 'Decoded before and after images are withheld for mechanical breakout unwrap.',
        target: '.claude/BUGS.md',
        ...proposalBinding,
      },
      proposalCarriers: carriers,
    }).ok, true)
    const content = {
      actionId: 'create-features',
      chunkCount: 1,
      chunkIndex: 0,
      endByte: decodedBytes.length,
      image: 'after',
      kind: 'decoded-content',
      rawSha256: sha256(decodedBytes),
      startByte: 0,
      target: '.claude/FEATURES.md',
      text: decodedBytes.toString('utf8'),
      ...proposalBinding,
    }
    assert.equal(adjudication.verifyInspectionBoundDisclosure({ item: content, proposalCarriers: carriers }).ok, true)
    assert.equal(adjudication.verifyInspectionBoundDisclosure({ item: { ...content, text: 'HELLO\n' }, proposalCarriers: carriers }).ok, false)
    assert.equal(adjudication.verifyInspectionBoundDisclosure({
      item: { actionId: 'create-gitkeep', byteLength: 0, image: 'after', kind: 'decoded-empty', rawSha256: sha256(Buffer.alloc(0)), target: '.claude/plans/.gitkeep', ...proposalBinding },
      proposalCarriers: carriers,
    }).ok, true)
    assert.deepEqual(adjudication.verifyInspectionBoundDisclosure({
      item: { actionId: 'semantic-edit', kind: 'structural-action', target: '.claude/QUICK_WINS.md', ...proposalBinding },
      proposalCarriers: carriers,
    }), { deferred: true, ok: true }, 'semantic repair carriers are knowable only from the later manifest')
  })

  test('semantic ownership evidence distinguishes enabled and disabled modes', () => {
    const enabledOk = adjudication.verifyEnabledSemanticOwnership({
      classificationRequired: true,
      firstClassifiedTurnOrdinal: 8,
      firstProposalTurnOrdinal: 12,
      inspection: { ok: true, proposals: [] },
      inspectWatermark: 5,
    })
    assert.deepEqual(enabledOk, { ok: true, semanticDecisionSource: 'model' })
    assert.equal(adjudication.verifyEnabledSemanticOwnership({
      classificationRequired: true,
      firstClassifiedTurnOrdinal: 8,
      firstProposalTurnOrdinal: 12,
      inspection: { ok: true, semanticDecisions: [] },
      inspectWatermark: 5,
    }).reason, 'inspection-owns-decision')
    assert.equal(adjudication.verifyEnabledSemanticOwnership({
      classificationRequired: true,
      firstClassifiedTurnOrdinal: 4,
      firstProposalTurnOrdinal: 12,
      inspection: {},
      inspectWatermark: 5,
    }).reason, 'classification-before-inspect')
    assert.equal(adjudication.verifyEnabledSemanticOwnership({
      classificationRequired: true,
      firstClassifiedTurnOrdinal: 13,
      firstProposalTurnOrdinal: 12,
      inspection: {},
      inspectWatermark: 5,
    }).reason, 'classification-after-manifest')
    assert.equal(adjudication.verifyEnabledSemanticOwnership({
      classificationRequired: true,
      firstClassifiedTurnOrdinal: null,
      firstProposalTurnOrdinal: 12,
      inspection: {},
      inspectWatermark: 5,
    }).reason, 'missing-classification')
    assert.equal(adjudication.verifyEnabledSemanticOwnership({
      classificationRequired: false,
      firstClassifiedTurnOrdinal: null,
      firstProposalTurnOrdinal: null,
      inspection: {},
      inspectWatermark: 5,
    }).ok, true)

    assert.deepEqual(adjudication.verifyDisabledSemanticOwnership({
      classificationRequired: true,
      controllerArtifactPaths: [],
      firstClassifiedTurnOrdinal: 3,
      firstProposalTurnOrdinal: 6,
      proxyCallCount: 0,
    }), { ok: true, semanticDecisionSource: 'model' })
    assert.equal(adjudication.verifyDisabledSemanticOwnership({
      classificationRequired: true,
      controllerArtifactPaths: [],
      firstClassifiedTurnOrdinal: 3,
      firstProposalTurnOrdinal: 6,
      proxyCallCount: 1,
    }).reason, 'controller-invocation')
    assert.equal(adjudication.verifyDisabledSemanticOwnership({
      classificationRequired: true,
      controllerArtifactPaths: ['.nightshift-init-backlog-election'],
      firstClassifiedTurnOrdinal: 3,
      firstProposalTurnOrdinal: 6,
      proxyCallCount: 0,
    }).reason, 'controller-artifact')
    assert.equal(adjudication.verifyDisabledSemanticOwnership({
      classificationRequired: true,
      controllerArtifactPaths: [],
      firstClassifiedTurnOrdinal: 6,
      firstProposalTurnOrdinal: 6,
      proxyCallCount: 0,
    }).reason, 'classification-after-proposal')
    assert.equal(adjudication.verifyDisabledSemanticOwnership({
      classificationRequired: true,
      controllerArtifactPaths: [],
      firstClassifiedTurnOrdinal: null,
      firstProposalTurnOrdinal: 6,
      proxyCallCount: 0,
    }).reason, 'missing-classification')
  })

  test('result and unresolved presentation derive from the exact structured result', () => {
    assert.deepEqual(adjudication.deriveResultPresentation({ approvalBranch: 'denied', structuredResult: { approvalBranch: 'denied', reasonCode: 'denied' } }), { resultPresented: true, unresolvedPresented: true })
    assert.equal(adjudication.deriveResultPresentation({ approvalBranch: 'denied', structuredResult: { approvalBranch: 'denied', reasonCode: 'deferred' } }).resultPresented, false)
    assert.equal(adjudication.deriveResultPresentation({ approvalBranch: 'unavailable', structuredResult: { approvalBranch: 'unavailable', reasonCode: 'guidance-resolution' } }).resultPresented, true)
    assert.equal(adjudication.deriveResultPresentation({ approvalBranch: 'unavailable', structuredResult: { approvalBranch: 'unavailable', reasonCode: 'unavailable' } }).resultPresented, true)
    assert.equal(adjudication.deriveResultPresentation({ approvalBranch: 'deferred', structuredResult: { approvalBranch: 'deferred', reasonCode: 'guidance-resolution' } }).resultPresented, false)
    assert.deepEqual(adjudication.deriveResultPresentation({ approvalBranch: 'approved', structuredResult: { complete: true, ok: true } }), { resultPresented: true, unresolvedPresented: true })
    assert.deepEqual(adjudication.deriveResultPresentation({ approvalBranch: 'approved', structuredResult: { complete: false, incompleteTargets: ['.claude/QUICK_WINS.md'], ok: true } }), { resultPresented: true, unresolvedPresented: true })
    assert.equal(adjudication.deriveResultPresentation({ approvalBranch: 'approved', structuredResult: { complete: false, incompleteTargets: [], ok: true } }).unresolvedPresented, false)
    assert.deepEqual(adjudication.deriveResultPresentation({ approvalBranch: 'approved', structuredResult: { code: 'snapshot-drift', ok: false } }), { resultPresented: true, unresolvedPresented: true })
    assert.equal(adjudication.deriveResultPresentation({ approvalBranch: 'approved', structuredResult: { complete: true } }).resultPresented, false)
    assert.equal(adjudication.deriveResultPresentation({ approvalBranch: 'approved', structuredResult: null }).resultPresented, false)
  })

  test('the external-writer-window fact derives from disclosureCodes alone', () => {
    assert.equal(adjudication.deriveWriterDisclosure({ observedCodes: ['external-writer-window'], windowExpected: true }), true)
    assert.equal(adjudication.deriveWriterDisclosure({ observedCodes: [], windowExpected: true }), false)
    assert.equal(adjudication.deriveWriterDisclosure({ observedCodes: [], windowExpected: false }), true)
    assert.equal(adjudication.deriveWriterDisclosure({ observedCodes: ['external-writer-window'], windowExpected: false }), false)
    assert.throws(() => adjudication.deriveWriterDisclosure({ observedCodes: ['other-code'], windowExpected: false }), /disclosure code/)
  })

  test('the deterministic digest preimage enforces the exact null rules', () => {
    const proposals = [{ action: { id: 'a-one', kind: 'ensure-directory', mode: null, target: '.claude' }, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: `p-${'a'.repeat(62)}`, reason: 'missing-target' }]
    const manifest = { actions: [], proposalDispositions: [], semanticDecisions: [], versionControlChoice: 'not-required' }
    const finalTargets = [{ kind: 'directory', mode: null, rawSha256: null, target: '.claude' }]
    const approved = adjudication.deriveDeterministicDigest({ applyOk: true, approvalBranch: 'approved', finalTargets, manifest, proposals })
    assert.equal(approved, sha256(Buffer.from(canonicalJson({ finalTargets, manifest, proposals }), 'utf8')))
    const mutatedManifest = adjudication.deriveDeterministicDigest({ applyOk: true, approvalBranch: 'approved', finalTargets, manifest: { ...manifest, versionControlChoice: 'track' }, proposals })
    assert.notEqual(mutatedManifest, approved, 'the digest binds the manifest projection')
    const approvedFailure = adjudication.deriveDeterministicDigest({ applyOk: false, approvalBranch: 'approved', finalTargets: null, manifest, proposals })
    assert.equal(approvedFailure, sha256(Buffer.from(canonicalJson({ finalTargets: null, manifest, proposals }), 'utf8')))
    const denied = adjudication.deriveDeterministicDigest({ applyOk: null, approvalBranch: 'denied', finalTargets, manifest: null, proposals })
    assert.equal(denied, sha256(Buffer.from(canonicalJson({ finalTargets, manifest: null, proposals }), 'utf8')))
    assert.throws(() => adjudication.deriveDeterministicDigest({ applyOk: true, approvalBranch: 'approved', finalTargets, manifest: null, proposals }), /approved branch/)
    assert.throws(() => adjudication.deriveDeterministicDigest({ applyOk: false, approvalBranch: 'approved', finalTargets, manifest, proposals }), /null finalTargets/)
    assert.throws(() => adjudication.deriveDeterministicDigest({ applyOk: null, approvalBranch: 'denied', finalTargets, manifest, proposals }), /non-approved branch/)
    assert.throws(() => adjudication.deriveDeterministicDigest({ applyOk: null, approvalBranch: 'denied', finalTargets: null, manifest: null, proposals }), /finalTargets/)
    assert.throws(() => adjudication.deriveDeterministicDigest({ applyOk: true, approvalBranch: 'approved', finalTargets, manifest: { ...manifest, extra: 1 }, proposals }), /digest manifest/)
    assert.throws(() => adjudication.deriveDeterministicDigest({ applyOk: true, approvalBranch: 'approved', finalTargets: [{ kind: 'directory', target: '.claude' }], manifest, proposals }), /final target/)
    assert.throws(() => adjudication.deriveDeterministicDigest({ applyOk: true, approvalBranch: 'approved', finalTargets: [finalTargets[0], finalTargets[0]], manifest, proposals }), /sorted|duplicate/)
    assert.throws(() => adjudication.deriveDeterministicDigest({ applyOk: true, approvalBranch: 'approved', finalTargets, manifest, proposals: null }), /proposals/)
  })

  test('semantic classification comparison is canonical equality with the independent oracle', () => {
    const observed = [{ conceptIds: ['quick-wins.line-discipline'], status: 'missing-concepts', target: '.claude/QUICK_WINS.md' }]
    const reordered = [{ target: '.claude/QUICK_WINS.md', status: 'missing-concepts', conceptIds: ['quick-wins.line-discipline'] }]
    assert.equal(adjudication.compareSemanticClassifications({ observed, oracle: reordered }), true)
    assert.equal(adjudication.compareSemanticClassifications({ observed, oracle: [] }), false)
    assert.equal(adjudication.compareSemanticClassifications({ observed: [], oracle: [] }), true)
    assert.throws(() => adjudication.compareSemanticClassifications({ observed: null, oracle: [] }), /array/)
  })
}

module.exports = { runDialogueCases }
