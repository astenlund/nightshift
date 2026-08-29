'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const { admitApplyManifest, buildAdmissionIndexes, simulateReady } = require('../../skills/init-backlog/lib/apply-manifest')
const { analyzeCatalog } = require('../../skills/ready/ready')
const { deriveManifestId, deriveSemanticActionId, deriveSnapshotId, validateResultRecord } = require('../../skills/init-backlog/lib/protocol')

const ROOT = 'C:/admission-fixture'
const HOST_CONTEXT = {
  claudeContextSource: 'host-observed',
  claudeRootExclusionStatus: 'included',
  codexContextSource: null,
  codexInvocationDirectory: null,
  codexProjectDocMaxBytes: null,
  codexProjectInstructions: [],
}

function target(targetName, kind, state, mode = 493) {
  return {
    bom: kind === 'file' ? false : null,
    cleanTextSha256: null,
    contentBase64: kind === 'file' ? Buffer.from('# Features\n', 'utf8').toString('base64') : null,
    contentRole: kind === 'file' ? 'semantic' : 'none',
    editableRegions: kind === 'file' ? [{ endByte: 11, regionId: 'features.document-preamble', startByte: 0 }] : [],
    finalNewline: kind === 'file' ? true : null,
    kind,
    mode,
    newline: kind === 'file' ? 'lf' : null,
    rawSha256: kind === 'file' ? 'b'.repeat(64) : null,
    states: [state],
    target: targetName,
    templateId: kind === 'file' ? 'backlog.features' : null,
    templateSha256: kind === 'file' ? 'c'.repeat(64) : null,
  }
}

function baseInspection() {
  const inspection = {
    git: {
      electionMarker: 'absent',
      electionMarkerMode: null,
      electionMarkerSnapshotId: null,
      electionRequired: false,
      freshScaffold: false,
      kind: 'non-git',
      newlinePolicies: [],
      nonPlanIgnoreMatches: [],
      nonPlanUnignoredPaths: [],
      objectFormat: null,
      plansPolicy: 'not-applicable',
      trackedBacklogPaths: [],
      trackedPlanPaths: [],
    },
    guidance: { baseAdapter: null, candidates: [], graphPaths: [], imports: [], independentPaths: [], resolvedTarget: 'AGENTS.md' },
    host: 'claude-code',
    hostContext: HOST_CONTEXT,
    ok: true,
    operation: 'inspect',
    problems: [],
    proposals: [],
    protocolVersion: 1,
    ready: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: [] },
    retainedBackups: [],
    root: ROOT,
    snapshotId: null,
    targets: [target('.claude', 'directory', 'missing'), target('.claude/features', 'directory', 'missing')],
    templates: [],
    unwrapReady: { after: { blocked: [], external: [], found: [], indexes: { found: [], missing: [] }, ready: [] }, targets: [] },
    warnings: [],
    wrapFindings: [],
  }
  inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })

  return inspection
}

function request(overrides = {}) {
  const inspection = overrides.inspection ?? baseInspection()
  return {
    actions: [],
    host: 'claude-code',
    hostContext: HOST_CONTEXT,
    inspection,
    operation: 'apply',
    proposalDispositions: [],
    protocolVersion: 1,
    root: ROOT,
    semanticDecisions: [],
    versionControlChoice: 'not-required',
    ...overrides,
  }
}

function edit(id, before, after) {
  return { afterBase64: after.toString('base64'), beforeBase64: before.toString('base64'), id, kind: 'exact-edit', regionId: 'gitignore.policy-append', target: '.gitignore' }
}

function expectManifestError(callback, code = 'manifest-invalid') {
  assert.throws(callback, (error) => error?.record?.code === code || error?.code === code)
}

function runAdmissionCases() {
  test('builds reusable admission indexes with linear proposal reads', () => {
    let targetReads = 0
    const proposals = Array.from({ length: 200 }, (_, index) => {
      const targetName = `.claude/features/item-${index}.md`
      const beforeBase64 = Buffer.from(`before-${index}\n`, 'utf8').toString('base64')
      const afterBase64 = Buffer.from(`after-${index}\n`, 'utf8').toString('base64')
      const action = { afterBase64, beforeBase64, id: `p-index-${index}`, kind: 'exact-edit', regionId: 'features.document-preamble' }
      Object.defineProperty(action, 'target', { enumerable: true, get() {
        targetReads += 1

        return targetName
      } })

      return { action, afterBase64, beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' }
    })
    const recordsByTarget = new Map(proposals.map((item) => [item.action.target, {}]))
    const templates = proposals.map((item, index) => ({ target: item.action.target, templateId: `template-${index}` }))
    const wrapFindings = proposals.map((item) => ({ target: item.action.target }))
    targetReads = 0
    const indexes = buildAdmissionIndexes({ proposals, templates, wrapFindings }, recordsByTarget)

    assert.ok(targetReads <= proposals.length * 4, `proposal targets were read ${targetReads} times`)
    assert.equal(indexes.chainHeadByTarget.size, proposals.length)
    assert.equal(indexes.proposalByActionId.size, proposals.length)
    assert.equal(indexes.proposalsByTarget.size, proposals.length)
    assert.equal(indexes.recordsByTarget, recordsByTarget)
    assert.equal(indexes.templateByTarget.size, proposals.length)
    assert.equal(indexes.wrapByTarget.size, proposals.length)
  })

  test('seeds a chained mechanical target from the chain head in either proposal order', () => {
    const first = Buffer.from('seed\n', 'utf8')
    const middle = Buffer.from('seed\nmandatory\n', 'utf8')
    const last = Buffer.from('seed\nmandatory\nelective\n', 'utf8')
    const head = edit('p-chain-head', first, middle)
    const tail = edit('p-chain-tail', middle, last)
    const asProposal = (action) => ({ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'plans-policy' })

    // The carried order is a digest artifact, so both orders must admit
    // identically and reach the same terminal content.
    for (const order of [[head, tail], [tail, head]]) {
      const inspection = baseInspection()
      // A mechanical target withholds its content image, which is exactly when
      // admission has to recover the starting bytes from the proposals.
      inspection.targets = [target('.claude', 'directory', 'present'), { ...target('.gitignore', 'file', 'present'), contentBase64: null, contentRole: 'mechanical', editableRegions: [{ endByte: first.length, regionId: 'gitignore.policy-append', startByte: first.length }], templateId: null, templateSha256: null }]
      inspection.proposals = order.map(asProposal)
      inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })

      const result = admitApplyManifest(request({
        actions: [head, tail],
        inspection,
        proposalDispositions: inspection.proposals.map((item) => ({ disposition: 'selected', proposalId: item.proposalId })),
      }), { rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'gitignore.policy-append', startByte: content.length }] })

      assert.equal(result.states.find((item) => item.target === '.gitignore').content.toString('utf8'), last.toString('utf8'))
    }
  })

  test('refuses a chained mechanical target whose proposals expose no unique head', () => {
    const first = Buffer.from('seed\n', 'utf8')
    const left = edit('p-chain-left', first, Buffer.from('seed\nleft\n', 'utf8'))
    // Chain-head candidacy is a property of every carried sibling, selected or
    // not, so the ambiguity is built from an unselected second proposal. Two
    // selected same-target edits would be refused earlier, by the transition
    // graph, and would never reach the chain-head decision.
    const rightEditFor = (before) => edit('p-chain-right', before, Buffer.concat([before, Buffer.from('right\n', 'utf8')]))
    const inspectionFor = (right) => {
      const inspection = baseInspection()
      inspection.targets = [target('.claude', 'directory', 'present'), { ...target('.gitignore', 'file', 'present'), contentBase64: null, contentRole: 'mechanical', editableRegions: [{ endByte: first.length, regionId: 'gitignore.policy-append', startByte: first.length }], templateId: null, templateSha256: null }]
      inspection.proposals = [
        { action: left, afterBase64: left.afterBase64, beforeBase64: left.beforeBase64, condition: 'always', proposalId: left.id, reason: 'plans-policy' },
        { action: right, afterBase64: right.afterBase64, beforeBase64: right.beforeBase64, condition: 'version-control-ignore', proposalId: right.id, reason: 'plans-policy' },
      ]
      inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })

      return inspection
    }
    const admit = (inspection) => admitApplyManifest(request({
      actions: [left],
      inspection,
      // `not-required` leaves the version-control-ignore sibling unselected.
      proposalDispositions: [{ disposition: 'selected', proposalId: left.id }, { disposition: 'condition-not-selected', proposalId: 'p-chain-right' }],
    }), { rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'gitignore.policy-append', startByte: content.length }] })

    // Two candidate heads, so the starting bytes are ambiguous, admission seeds
    // nothing, and the edit's own input check refuses the manifest.
    assert.throws(
      () => admit(inspectionFor(rightEditFor(Buffer.from('other\n', 'utf8')))),
      (error) => error?.record?.code === 'manifest-invalid' && error?.record?.detail === 'Exact edit input differs from inspection or prior action.',
    )

    // Control: the same shape with the sibling chained onto the left output
    // exposes one head, seeds the target, and admits.
    const seeded = admit(inspectionFor(rightEditFor(Buffer.from('seed\nleft\n', 'utf8'))))
    assert.equal(seeded.states.find((item) => item.target === '.gitignore').content.toString('utf8'), 'seed\nleft\n')
  })

  test('admits an empty direct manifest and returns a stable identity', () => {
    const result = admitApplyManifest(request())

    assert.match(result.manifestId, /^[a-f0-9]{64}$/)
    assert.deepEqual(result.actions, [])
    assert.deepEqual(result.ready, baseInspection().ready)
  })

  test('admits deferred, unwrap-only, track, ignore, and safe partial branches', () => {
    const inspection = baseInspection()
    const cases = [
      { name: 'deferred', versionControlChoice: 'deferred', electionRequired: true },
      { name: 'unwrap-only', versionControlChoice: 'not-required' },
      { name: 'track', versionControlChoice: 'track', electionRequired: true },
      { name: 'ignore', versionControlChoice: 'ignore', electionRequired: true },
      { name: 'partial', versionControlChoice: 'not-required' },
    ]
    for (const item of cases) {
      const current = { ...inspection, git: { ...inspection.git, electionRequired: item.electionRequired === true, kind: item.electionRequired === true ? 'git' : 'non-git', objectFormat: item.electionRequired === true ? 'sha1' : null, plansPolicy: item.electionRequired === true ? 'satisfied' : 'not-applicable' } }
      current.snapshotId = deriveSnapshotId({ ...current, snapshotId: null })
      const result = admitApplyManifest(request({ inspection: current, semanticDecisions: item.semanticDecisions ?? [], versionControlChoice: item.versionControlChoice }))
      assert.equal(typeof result.manifestId, 'string', item.name)
    }
  })

  test('rejects missing, extra, duplicate, reordered, inapplicable, and inverted actions', () => {
    const inspection = baseInspection()
    const create = { id: 'p-create', kind: 'ensure-directory', mode: 493, target: '.claude' }
    inspection.proposals = [{ action: create, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: create.id, reason: 'missing-target' }]
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const selected = request({ inspection, proposalDispositions: [{ disposition: 'selected', proposalId: create.id }], actions: [create] })
    admitApplyManifest(selected)
    for (const mutation of [
      { ...selected, actions: [] },
      { ...selected, actions: [create, { ...create, id: 'p-extra', target: '.claude/features' }] },
      { ...selected, actions: [{ ...create, id: create.id }, create] },
      { ...selected, actions: [{ ...create, id: 'p-other', target: '.gitignore' }] },
      { ...selected, actions: [{ ...create, id: 'p-child', target: '.claude/features' }, create] },
    ]) {
      expectManifestError(() => admitApplyManifest(mutation))
    }
  })

  test('rejects drift in snapshot, content, mode, semantic attestation, and election marker', () => {
    const inspection = baseInspection()
    const action = { id: 'p-directory', kind: 'ensure-directory', mode: 493, target: '.claude' }
    inspection.proposals = [{ action, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: action.id, reason: 'missing-target' }]
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const valid = request({ inspection, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], actions: [action] })
    admitApplyManifest(valid)
    expectManifestError(() => admitApplyManifest({ ...valid, inspection: { ...inspection, snapshotId: 'd'.repeat(64) } }), 'snapshot-drift')
    for (const mutation of [
      { ...valid, actions: [{ ...action, mode: 420 }] },
      { ...valid, semanticDecisions: [{ conceptIds: [], status: 'satisfied', target: 'AGENTS.md' }] },
      { ...valid, actions: [{ ...action, target: '.claude/unknown' }] },
    ]) expectManifestError(() => admitApplyManifest(mutation), 'manifest-invalid')
    const markerInspection = { ...inspection, git: { ...inspection.git, electionMarker: 'track', electionMarkerMode: 384, electionRequired: true } }
    markerInspection.snapshotId = deriveSnapshotId({ ...markerInspection, snapshotId: null })
    const markerRequest = request({ inspection: markerInspection, versionControlChoice: 'track', proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], actions: [action], currentInspection: { ...markerInspection, git: { ...markerInspection.git, electionMarkerMode: 420 } } })
    expectManifestError(() => admitApplyManifest(markerRequest), 'snapshot-drift')
  })

  test('simulates the complete transition graph before the write adapter is called', () => {
    const inspection = baseInspection()
    const first = { id: 'p-first', kind: 'ensure-directory', mode: 493, target: '.claude' }
    const second = { id: 'p-second', kind: 'ensure-directory', mode: 493, target: '.claude/features' }
    inspection.proposals = [
      { action: first, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: first.id, reason: 'missing-target' },
      { action: second, afterBase64: null, beforeBase64: null, condition: 'always', proposalId: second.id, reason: 'missing-target' },
    ]
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    let writes = 0
    const valid = request({ inspection, proposalDispositions: inspection.proposals.map((item) => ({ disposition: 'selected', proposalId: item.proposalId })), actions: [first, second] })
    const admitted = admitApplyManifest(valid, { writeAdapter: () => { writes += 1 } })
    assert.equal(writes, 0)
    assert.deepEqual(admitted.actions.map((item) => item.target), ['.claude', '.claude/features'])
    expectManifestError(() => admitApplyManifest({ ...valid, actions: [second, first] }, { writeAdapter: () => { writes += 1 } }))
    assert.equal(writes, 0)
  })

  test('binds manifest identity to the exact snapshot and marker projection', () => {
    const inspection = baseInspection()
    const result = admitApplyManifest(request({ inspection }))
    const expected = deriveManifestId({
      actions: [],
      electionMarker: { mode: null, snapshotId: null, state: 'absent' },
      proposalDispositions: [],
      semanticDecisions: [],
      snapshotId: inspection.snapshotId,
      versionControlChoice: 'not-required',
    })

    assert.equal(result.manifestId, expected)
    assert.deepEqual(result.electionMarker, { mode: null, snapshotId: null, state: 'absent' })
  })

  test('admits mandatory missing gitignore creation followed by elective append', () => {
    const inspection = baseInspection()
    inspection.git = { ...inspection.git, electionMarker: 'absent', electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'action-required' }
    inspection.targets = [target('.claude', 'directory', 'present'), { ...target('.gitignore', 'file', 'missing', 420), contentBase64: null, contentRole: 'mechanical', editableRegions: [], templateId: 'gitignore.plans', templateSha256: null, rawSha256: null, newline: null, bom: null, finalNewline: null }]
    const mandatory = { id: 'p-mandatory', kind: 'create-from-template', mode: 420, newline: 'lf', target: '.gitignore', templateId: 'gitignore.plans' }
    const mandatoryBytes = Buffer.from('# plans\n', 'utf8').toString('base64')
    const electiveBytes = Buffer.from('# plans\nfeatures/\n', 'utf8').toString('base64')
    const elective = { afterBase64: electiveBytes, beforeBase64: mandatoryBytes, id: 'p-elective', kind: 'exact-edit', regionId: 'gitignore-append', target: '.gitignore' }
    inspection.proposals = [
      { action: mandatory, afterBase64: mandatoryBytes, beforeBase64: null, condition: 'always', proposalId: mandatory.id, reason: 'plans-policy' },
      { action: elective, afterBase64: electiveBytes, beforeBase64: mandatoryBytes, condition: 'always', proposalId: elective.id, reason: 'elective-ignore' },
    ]
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const selected = request({
      inspection,
      proposalDispositions: inspection.proposals.map((item) => ({ disposition: 'selected', proposalId: item.proposalId })),
      actions: [mandatory, elective],
      versionControlChoice: 'ignore',
    })

    admitApplyManifest(selected)
  })

  test('simulates parser-visible semantic ready changes exactly', () => {
    const beforeText = '# Features\n'
    const afterText = '# Featurez\n'
    const inspection = baseInspection()
    inspection.targets = [target('.claude', 'directory', 'present'), { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: Buffer.from(beforeText, 'utf8').toString('base64'), editableRegions: [{ endByte: Buffer.byteLength(beforeText), regionId: 'features.document-preamble', startByte: 0 }] }]
    inspection.templates = [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' }]
    inspection.ready = analyzeCatalog([{ contents: beforeText, target: 'FEATURES.md' }])
    const actionWithoutId = { afterBase64: Buffer.from(afterText, 'utf8').toString('base64'), beforeBase64: Buffer.from(beforeText, 'utf8').toString('base64'), kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
    const action = { ...actionWithoutId, id: deriveSemanticActionId(actionWithoutId) }
    inspection.proposals = [{ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' }]
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const expected = analyzeCatalog([{ contents: afterText, target: 'FEATURES.md' }])
    const result = admitApplyManifest(request({ inspection, proposalDispositions: [{ disposition: 'selected', proposalId: action.id }], actions: [action], semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: '.claude/FEATURES.md' }] }), { readyCatalog: [{ contents: beforeText, target: 'FEATURES.md' }], rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'features.document-preamble', startByte: 0 }] })

    assert.deepEqual(result.ready, expected)
  })

  test('rescans exact edit output and uses only the authoritative regions', () => {
    const inspection = baseInspection()
    const before = Buffer.from('# Features\n', 'utf8')
    const middle = Buffer.from('# Features\nexpanded\n', 'utf8')
    const after = Buffer.from('# Features\nexpanded\nfinal\n', 'utf8')
    inspection.targets = [target('.claude', 'directory', 'present'), { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: before.toString('base64'), editableRegions: [{ endByte: before.length, regionId: 'features.document-preamble', startByte: 0 }], templateId: null, templateSha256: null }]
    inspection.ready = analyzeCatalog([{ contents: after.toString('utf8'), target: 'FEATURES.md' }])
    const first = { afterBase64: middle.toString('base64'), beforeBase64: before.toString('base64'), id: 'p-first-edit', kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
    const second = { afterBase64: after.toString('base64'), beforeBase64: middle.toString('base64'), id: 'p-second-edit', kind: 'exact-edit', regionId: 'features.next-region', target: '.claude/FEATURES.md' }
    inspection.proposals = [first, second].map((action) => ({ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' }))
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const requestValue = request({ inspection, proposalDispositions: inspection.proposals.map((item) => ({ disposition: 'selected', proposalId: item.proposalId })), actions: [first, second] })

    admitApplyManifest(requestValue, { rescanRegions: ({ action }) => action.id === first.id ? [{ endByte: middle.length, regionId: 'features.next-region', startByte: 0 }] : [{ endByte: after.length, regionId: 'features.final-region', startByte: 0 }] })
  })

  test('maps invalid rank-two transition graphs to typed manifest errors', () => {
    const inspection = baseInspection()
    const before = Buffer.from('# Features\n', 'utf8').toString('base64')
    const first = { afterBase64: Buffer.from('# One\n', 'utf8').toString('base64'), beforeBase64: before, id: 'p-graph-one', kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
    const second = { afterBase64: Buffer.from('# Two\n', 'utf8').toString('base64'), beforeBase64: before, id: 'p-graph-two', kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
    inspection.targets = [target('.claude', 'directory', 'present'), { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: before, editableRegions: [{ endByte: 11, regionId: 'features.document-preamble', startByte: 0 }], templateId: null, templateSha256: null }]
    inspection.proposals = [first, second].map((action) => ({ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' }))
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const value = request({ inspection, proposalDispositions: inspection.proposals.map((item) => ({ disposition: 'selected', proposalId: item.proposalId })), actions: [first, second] })

    expectManifestError(() => admitApplyManifest(value), 'manifest-invalid')
  })

  test('returns complete election marker state for every approved branch', () => {
    for (const state of ['absent', 'deferred', 'track', 'ignore']) {
      const inspection = baseInspection()
      const marker = state === 'absent' ? { electionMarker: 'absent', electionMarkerMode: null, electionMarkerSnapshotId: null } : { electionMarker: state, electionMarkerMode: 384, electionMarkerSnapshotId: 'a'.repeat(64) }
      inspection.git = { ...inspection.git, electionRequired: state !== 'absent', kind: state === 'absent' ? 'non-git' : 'git', objectFormat: state === 'absent' ? null : 'sha1', plansPolicy: state === 'absent' ? 'not-applicable' : 'satisfied', ...marker }
      inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
      const result = admitApplyManifest(request({ inspection, versionControlChoice: state === 'absent' ? 'not-required' : state }))

      assert.deepEqual(result.electionMarker, { mode: marker.electionMarkerMode, snapshotId: state === 'absent' ? null : inspection.snapshotId, state })
    }
  })

  test('derives the final ready result after an unwrap and semantic edit chain', () => {
    const wrappedText = '## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\nwrapped\n'
    const unwrappedText = '## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\n'
    const finalText = unwrappedText
    const inspection = baseInspection()
    const record = { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: Buffer.from(wrappedText, 'utf8').toString('base64'), rawSha256: 'b'.repeat(64), editableRegions: [{ endByte: Buffer.byteLength(wrappedText), regionId: 'features.document-preamble', startByte: 0 }] }
    inspection.targets = [target('.claude', 'directory', 'present'), record]
    inspection.templates = [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' }]
    const unwrap = { afterRawSha256: 'd'.repeat(64), beforeRawSha256: 'b'.repeat(64), id: 'p-unwrap-compound', kind: 'unwrap-file', mode: 493, target: '.claude/FEATURES.md' }
    const semanticWithoutId = { afterBase64: Buffer.from(finalText, 'utf8').toString('base64'), beforeBase64: Buffer.from(unwrappedText, 'utf8').toString('base64'), kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
    const semantic = { ...semanticWithoutId, id: deriveSemanticActionId(semanticWithoutId) }
    inspection.proposals = [{ action: unwrap, afterBase64: Buffer.from(unwrappedText, 'utf8').toString('base64'), beforeBase64: record.contentBase64, condition: 'always', proposalId: unwrap.id, reason: 'hard-wrap' }]
    inspection.wrapFindings = [{ predictedContentBase64: Buffer.from(unwrappedText, 'utf8').toString('base64'), predictedEditableRegions: [{ endByte: Buffer.byteLength(unwrappedText), regionId: 'features.document-preamble', startByte: 0 }], target: '.claude/FEATURES.md' }]
    inspection.ready = analyzeCatalog([{ contents: wrappedText, target: 'FEATURES.md' }, { contents: '# Alpha\n', target: 'features/alpha.md' }])
    inspection.unwrapReady = { after: analyzeCatalog([{ contents: unwrappedText, target: 'FEATURES.md' }, { contents: '# Alpha\n', target: 'features/alpha.md' }]), targets: ['.claude/FEATURES.md'] }
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const value = request({
      actions: [unwrap, semantic],
      inspection,
      proposalDispositions: [{ disposition: 'selected', proposalId: unwrap.id }],
      semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: '.claude/FEATURES.md' }],
    })
    const result = admitApplyManifest(value, { readyCatalog: [{ contents: wrappedText, target: 'FEATURES.md' }, { contents: '# Alpha\n', target: 'features/alpha.md' }], rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'features.document-preamble', startByte: 0 }] })

    assert.deepEqual(result.ready, inspection.unwrapReady.after)
  })

  test('carries complete ready state across compound semantic and mechanical unwraps', () => {
    const wrappedFeature = '# Features\n## Requires lines\n\n## Exploring\n\n## Slicing\n\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\nwrapped\n'
    const unwrappedFeature = wrappedFeature.replace('wrapped\n', '')
    const finalFeature = unwrappedFeature.replace('## Requires lines', '##\tRequires lines')
    const wrappedBreakout = '# Alpha\n\n**Requires:** none.\nwrapped\n'
    const unwrappedBreakout = wrappedBreakout.replace('wrapped\n', '')
    const inspection = baseInspection()
    const feature = { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: Buffer.from(wrappedFeature, 'utf8').toString('base64'), rawSha256: 'b'.repeat(64), editableRegions: [
      { endByte: Buffer.byteLength(wrappedFeature), regionId: 'features.document-preamble', startByte: 0 },
    ] }
    const breakout = { ...target('.claude/features/alpha.md', 'file', 'present'), contentBase64: null, contentRole: 'mechanical', editableRegions: [], rawSha256: 'e'.repeat(64), templateId: null, templateSha256: null }
    inspection.targets = [target('.claude', 'directory', 'present'), feature, breakout]
    inspection.templates = [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' }]
    const featureUnwrap = { afterRawSha256: 'd'.repeat(64), beforeRawSha256: 'b'.repeat(64), id: 'p-feature-unwrap', kind: 'unwrap-file', mode: 493, target: '.claude/FEATURES.md' }
    const breakoutUnwrap = { afterRawSha256: 'f'.repeat(64), beforeRawSha256: 'e'.repeat(64), id: 'p-breakout-unwrap', kind: 'unwrap-file', mode: 493, target: '.claude/features/alpha.md' }
    const semanticWithoutId = { afterBase64: Buffer.from(finalFeature, 'utf8').toString('base64'), beforeBase64: Buffer.from(unwrappedFeature, 'utf8').toString('base64'), kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
    const semantic = { ...semanticWithoutId, id: deriveSemanticActionId(semanticWithoutId) }
    inspection.proposals = [
      { action: featureUnwrap, afterBase64: Buffer.from(unwrappedFeature, 'utf8').toString('base64'), beforeBase64: feature.contentBase64, condition: 'always', proposalId: featureUnwrap.id, reason: 'hard-wrap' },
      { action: breakoutUnwrap, afterBase64: null, beforeBase64: Buffer.from(wrappedBreakout, 'utf8').toString('base64'), condition: 'always', proposalId: breakoutUnwrap.id, reason: 'hard-wrap' },
    ]
    inspection.wrapFindings = [
      { predictedContentBase64: Buffer.from(unwrappedFeature, 'utf8').toString('base64'), predictedEditableRegions: [{ endByte: Buffer.byteLength(unwrappedFeature), regionId: 'features.document-preamble', startByte: 0 }], target: '.claude/FEATURES.md' },
      { predictedContentBase64: null, predictedEditableRegions: [], target: '.claude/features/alpha.md' },
    ]
    inspection.ready = analyzeCatalog([{ contents: wrappedFeature, target: 'FEATURES.md' }, { contents: wrappedBreakout, target: 'features/alpha.md' }])
    inspection.unwrapReady = { after: analyzeCatalog([{ contents: unwrappedFeature, target: 'FEATURES.md' }, { contents: unwrappedBreakout, target: 'features/alpha.md' }]), targets: ['.claude/FEATURES.md', '.claude/features/alpha.md'] }
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const value = request({
      actions: [featureUnwrap, breakoutUnwrap, semantic],
      inspection,
      proposalDispositions: [{ disposition: 'selected', proposalId: featureUnwrap.id }, { disposition: 'selected', proposalId: breakoutUnwrap.id }],
      semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: '.claude/FEATURES.md' }],
    })
    const finalReady = analyzeCatalog([{ contents: finalFeature, target: 'FEATURES.md' }, { contents: unwrappedBreakout, target: 'features/alpha.md' }])
    const result = admitApplyManifest(value, { readyCatalog: [{ contents: unwrappedFeature, target: 'FEATURES.md' }, { contents: unwrappedBreakout, target: 'features/alpha.md' }], rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'features.document-preamble', startByte: 0 }] })

    assert.deepEqual(result.ready, finalReady)
  })

  test('reparses semantic effects over the carried mechanical unwrap catalog', () => {
    const wrappedFeature = '## Area\n### [Alpha](features/alpha.md)\n\n**Requires:** none.\nwrapped\n'
    const unwrappedFeature = wrappedFeature.replace('wrapped\n', '')
    const finalFeature = unwrappedFeature.replace('[Alpha]', '[Beta]')
    const wrappedBreakout = '# Alpha\n\n**Requires:** none.\nwrapped\n'
    const unwrappedBreakout = wrappedBreakout.replace('wrapped\n', '')
    const inspection = baseInspection()
    const feature = { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: Buffer.from(wrappedFeature, 'utf8').toString('base64'), rawSha256: 'b'.repeat(64), editableRegions: [
      { endByte: Buffer.byteLength(wrappedFeature), regionId: 'features.document-preamble', startByte: 0 },
    ] }
    const breakout = { ...target('.claude/features/alpha.md', 'file', 'present'), contentBase64: null, contentRole: 'mechanical', editableRegions: [], rawSha256: 'e'.repeat(64), templateId: null, templateSha256: null }
    inspection.targets = [target('.claude', 'directory', 'present'), feature, breakout]
    inspection.templates = [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' }]
    const featureUnwrap = { afterRawSha256: 'd'.repeat(64), beforeRawSha256: 'b'.repeat(64), id: 'p-feature-unwrap-final', kind: 'unwrap-file', mode: 493, target: '.claude/FEATURES.md' }
    const breakoutUnwrap = { afterRawSha256: 'f'.repeat(64), beforeRawSha256: 'e'.repeat(64), id: 'p-breakout-unwrap-final', kind: 'unwrap-file', mode: 493, target: '.claude/features/alpha.md' }
    const semanticWithoutId = { afterBase64: Buffer.from(finalFeature, 'utf8').toString('base64'), beforeBase64: Buffer.from(unwrappedFeature, 'utf8').toString('base64'), kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
    const semantic = { ...semanticWithoutId, id: deriveSemanticActionId(semanticWithoutId) }
    inspection.proposals = [
      { action: featureUnwrap, afterBase64: Buffer.from(unwrappedFeature, 'utf8').toString('base64'), beforeBase64: feature.contentBase64, condition: 'always', proposalId: featureUnwrap.id, reason: 'hard-wrap' },
      { action: breakoutUnwrap, afterBase64: null, beforeBase64: Buffer.from(wrappedBreakout, 'utf8').toString('base64'), condition: 'always', proposalId: breakoutUnwrap.id, reason: 'hard-wrap' },
    ]
    inspection.wrapFindings = [
      { predictedContentBase64: Buffer.from(unwrappedFeature, 'utf8').toString('base64'), predictedEditableRegions: [{ endByte: Buffer.byteLength(unwrappedFeature), regionId: 'features.document-preamble', startByte: 0 }], target: '.claude/FEATURES.md' },
      { predictedContentBase64: null, predictedEditableRegions: [], target: '.claude/features/alpha.md' },
    ]
    inspection.ready = analyzeCatalog([{ contents: wrappedFeature, target: 'FEATURES.md' }, { contents: wrappedBreakout, target: 'features/alpha.md' }])
    inspection.unwrapReady = { after: analyzeCatalog([{ contents: unwrappedFeature, target: 'FEATURES.md' }, { contents: unwrappedBreakout, target: 'features/alpha.md' }]), targets: ['.claude/FEATURES.md', '.claude/features/alpha.md'] }
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const value = request({
      actions: [featureUnwrap, breakoutUnwrap, semantic],
      inspection,
      proposalDispositions: [{ disposition: 'selected', proposalId: featureUnwrap.id }, { disposition: 'selected', proposalId: breakoutUnwrap.id }],
      semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: '.claude/FEATURES.md' }],
    })
    const states = new Map([
      ['.claude/FEATURES.md', { content: Buffer.from(finalFeature, 'utf8'), kind: 'file' }],
      ['.claude/features/alpha.md', { content: Buffer.from(wrappedBreakout, 'utf8'), kind: 'file' }],
    ])
    const finalReady = analyzeCatalog([{ contents: finalFeature, target: 'FEATURES.md' }, { contents: unwrappedBreakout, target: 'features/alpha.md' }])
    const simulated = simulateReady(value.inspection, value.actions, states, { readyCatalog: [{ contents: unwrappedFeature, target: 'FEATURES.md' }, { contents: unwrappedBreakout, target: 'features/alpha.md' }] })

    assert.deepEqual(simulated, finalReady)
    let writes = 0
    assert.throws(() => admitApplyManifest(value, { readyCatalog: [{ contents: unwrappedFeature, target: 'FEATURES.md' }, { contents: unwrappedBreakout, target: 'features/alpha.md' }], rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'features.document-preamble', startByte: 0 }], writeAdapter: () => { writes += 1 } }), (error) => {
      assert.equal(error?.record?.code, 'manifest-invalid')
      assert.equal(error?.record?.phase, 'prevalidate')

      return true
    })
    assert.equal(writes, 0)

    let missingCatalogError
    assert.throws(() => admitApplyManifest(value, { rescanRegions: ({ content }) => [{ endByte: content.length, regionId: 'features.document-preamble', startByte: 0 }], writeAdapter: () => { writes += 1 } }), (error) => {
      missingCatalogError = error

      return true
    })
    assert.equal(missingCatalogError?.record?.code, 'manifest-invalid')
    assert.equal(missingCatalogError?.record?.phase, 'prevalidate')
    assert.doesNotThrow(() => validateResultRecord(missingCatalogError.record))
    assert.equal(writes, 0)
  })

  test('rejects default rescan output missing required declarations', () => {
    const beforeText = '# Features\n## Exploring\n\n## Requires lines\n\n## Slicing\n'
    const cases = [
      { name: 'document-preamble', afterText: '## Exploring\n\n## Requires lines\n\n## Slicing\n' },
      { name: 'requires-lines', afterText: '# Features\n## Exploring\n\n## Slicing\n' },
    ]
    for (const item of cases) {
      const inspection = baseInspection()
      const before = Buffer.from(beforeText, 'utf8')
      const after = Buffer.from(item.afterText, 'utf8')
      const record = { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: before.toString('base64'), editableRegions: [{ endByte: before.length, regionId: 'features.document-preamble', startByte: 0 }] }
      inspection.targets = [target('.claude', 'directory', 'present'), record]
      const action = { afterBase64: after.toString('base64'), beforeBase64: before.toString('base64'), id: `p-missing-${item.name}`, kind: 'exact-edit', regionId: 'features.document-preamble', target: '.claude/FEATURES.md' }
      inspection.proposals = [{ action, afterBase64: action.afterBase64, beforeBase64: action.beforeBase64, condition: 'always', proposalId: action.id, reason: 'guidance-section' }]
      inspection.ready = analyzeCatalog([{ contents: beforeText, target: 'FEATURES.md' }])
      inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
      let writes = 0
      const value = request({ inspection, actions: [action], proposalDispositions: [{ disposition: 'selected', proposalId: action.id }] })

      expectManifestError(() => admitApplyManifest(value, { writeAdapter: () => { writes += 1 } }), 'manifest-invalid')
      assert.equal(writes, 0, item.name)
    }
  })

  test('uses the owning region scanner by default for exact edit output', () => {
    const beforeText = '# Features\n## Exploring\n\n## Requires lines\nentry\n## Slicing\n'
    const middleText = '# Features\n## Exploring\nentry\n## Requires lines\nentry\n## Slicing\n'
    const afterText = '# Features\n## Exploring\nentry\n## Requires lines\nitems\n## Slicing\n'
    const inspection = baseInspection()
    const record = { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: Buffer.from(beforeText, 'utf8').toString('base64'), editableRegions: [
      { endByte: 12, regionId: 'features.exploring-preamble', startByte: 12 },
      { endByte: 12, regionId: 'features.requires-lines', startByte: 12 },
      { endByte: 12, regionId: 'features.slicing', startByte: 12 },
    ] }
    inspection.targets = [target('.claude', 'directory', 'present'), record]
    inspection.templates = [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' }]
    const first = { afterBase64: Buffer.from(middleText, 'utf8').toString('base64'), beforeBase64: Buffer.from(beforeText, 'utf8').toString('base64'), id: 'p-default-scan', kind: 'exact-edit', regionId: 'features.exploring-preamble', target: '.claude/FEATURES.md' }
    const secondWithoutId = { afterBase64: Buffer.from(afterText, 'utf8').toString('base64'), beforeBase64: Buffer.from(middleText, 'utf8').toString('base64'), kind: 'exact-edit', regionId: 'features.requires-lines', target: '.claude/FEATURES.md' }
    const second = { ...secondWithoutId, id: deriveSemanticActionId(secondWithoutId) }
    inspection.proposals = [{ action: first, afterBase64: first.afterBase64, beforeBase64: first.beforeBase64, condition: 'always', proposalId: first.id, reason: 'guidance-section' }]
    inspection.ready = analyzeCatalog([{ contents: afterText, target: 'FEATURES.md' }])
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const result = admitApplyManifest(request({ actions: [first, second], inspection, proposalDispositions: [{ disposition: 'selected', proposalId: first.id }], semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: '.claude/FEATURES.md' }] }), { readyCatalog: [{ contents: beforeText, target: 'FEATURES.md' }] })

    assert.equal(result.states.find((item) => item.target === '.claude/FEATURES.md').content.toString('utf8'), afterText)

    const malformedText = '# Features\n## Requires lines\n## Requires lines\nitems\n'
    const malformedFirst = { ...first, afterBase64: Buffer.from(malformedText, 'utf8').toString('base64'), id: 'p-default-structural' }
    const malformedInspection = { ...inspection, proposals: [{ ...inspection.proposals[0], action: malformedFirst, afterBase64: malformedFirst.afterBase64, proposalId: malformedFirst.id }] }
    malformedInspection.snapshotId = deriveSnapshotId({ ...malformedInspection, snapshotId: null })
    expectManifestError(() => admitApplyManifest(request({ actions: [malformedFirst], inspection: malformedInspection, proposalDispositions: [{ disposition: 'selected', proposalId: malformedFirst.id }] })))

    const removedText = '## Requires lines\nitems\n'
    const removedFirst = { ...first, afterBase64: Buffer.from(removedText, 'utf8').toString('base64'), id: 'p-default-removed' }
    const removedSecondWithoutId = { ...secondWithoutId, afterBase64: Buffer.from(removedText, 'utf8').toString('base64'), beforeBase64: Buffer.from(removedText, 'utf8').toString('base64'), regionId: 'features.document-preamble' }
    const removedSecond = { ...removedSecondWithoutId, id: deriveSemanticActionId(removedSecondWithoutId) }
    const removedInspection = { ...inspection, proposals: [{ ...inspection.proposals[0], action: removedFirst, afterBase64: removedFirst.afterBase64, proposalId: removedFirst.id }] }
    removedInspection.snapshotId = deriveSnapshotId({ ...removedInspection, snapshotId: null })
    expectManifestError(() => admitApplyManifest(request({ actions: [removedFirst, removedSecond], inspection: removedInspection, proposalDispositions: [{ disposition: 'selected', proposalId: removedFirst.id }], semanticDecisions: [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: '.claude/FEATURES.md' }] })))
  })

  test('rejects direct semantic actions without authorized template evidence', () => {
    const cases = [
      { name: 'null-template', templateId: null, templates: [], regionId: 'features.document-preamble' },
      { name: 'missing-template', templateId: 'backlog.features', templates: [], regionId: 'features.document-preamble' },
      { name: 'empty-concepts', templateId: 'backlog.features', templates: [{ conceptIds: [], logicalSha256: 'c'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' }], regionId: 'features.document-preamble' },
      { name: 'unauthorized-region', templateId: 'backlog.features', templates: [{ conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' }], regionId: 'features.unapproved' },
    ]
    for (const item of cases) {
      const inspection = baseInspection()
      const before = Buffer.from('# Features\n', 'utf8')
      const record = { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: before.toString('base64'), editableRegions: [{ endByte: before.length, regionId: item.regionId, startByte: 0 }], templateId: item.templateId, templateSha256: item.templateId === null ? null : 'c'.repeat(64) }
      inspection.targets = [target('.claude', 'directory', 'present'), record]
      inspection.templates = item.templates
      const actionWithoutId = { afterBase64: before.toString('base64'), beforeBase64: before.toString('base64'), kind: 'exact-edit', regionId: item.regionId, target: '.claude/FEATURES.md' }
      const action = { ...actionWithoutId, id: deriveSemanticActionId(actionWithoutId) }
      inspection.ready = analyzeCatalog([{ contents: before.toString('utf8'), target: 'FEATURES.md' }])
      inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
      let writes = 0
      const value = request({ actions: [action], inspection, semanticDecisions: item.templateId === null || item.templates.length === 0 || item.templates[0].conceptIds.length === 0 ? [] : [{ conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: '.claude/FEATURES.md' }] })
      expectManifestError(() => admitApplyManifest(value, { writeAdapter: () => { writes += 1 } }))
      assert.equal(writes, 0, item.name)
    }
  })

  test('rebases carried deferred election markers to the approved branch and snapshot', () => {
    for (const choice of ['track', 'ignore']) {
      const inspection = baseInspection()
      inspection.git = { ...inspection.git, electionMarker: 'deferred', electionMarkerMode: 384, electionMarkerSnapshotId: 'a'.repeat(64), electionRequired: true, kind: 'git', objectFormat: 'sha1', plansPolicy: 'satisfied' }
      inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
      const result = admitApplyManifest(request({ inspection, versionControlChoice: choice }))
      assert.deepEqual(result.electionMarker, { mode: 384, snapshotId: inspection.snapshotId, state: choice })
      assert.equal(result.manifestId, deriveManifestId({ actions: [], electionMarker: result.electionMarker, proposalDispositions: [], semanticDecisions: [], snapshotId: inspection.snapshotId, versionControlChoice: choice }))
    }
  })

  test('rejects extra semantic fields and unsorted decision arrays', () => {
    const inspection = baseInspection()
    const first = { ...target('.claude/BUGS.md', 'file', 'present'), contentBase64: Buffer.from('# Bugs\n', 'utf8').toString('base64'), templateId: 'backlog.bugs', templateSha256: 'c'.repeat(64), editableRegions: [{ endByte: 7, regionId: 'bugs.document-preamble', startByte: 0 }] }
    const second = { ...target('.claude/FEATURES.md', 'file', 'present'), contentBase64: Buffer.from('# Features\n', 'utf8').toString('base64'), templateId: 'backlog.features', templateSha256: 'c'.repeat(64), editableRegions: [{ endByte: 11, regionId: 'features.document-preamble', startByte: 0 }] }
    inspection.targets = [target('.claude', 'directory', 'present'), first, second]
    inspection.templates = [
      { conceptIds: ['bugs.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: '.claude/BUGS.md', templateId: 'backlog.bugs' },
      { conceptIds: ['features.dependency-grammar'], logicalSha256: 'c'.repeat(64), target: '.claude/FEATURES.md', templateId: 'backlog.features' },
    ]
    inspection.ready = analyzeCatalog([
      { contents: '# Bugs\n', target: 'BUGS.md' },
      { contents: '# Features\n', target: 'FEATURES.md' },
    ])
    inspection.snapshotId = deriveSnapshotId({ ...inspection, snapshotId: null })
    const decisions = [
      { conceptIds: ['features.dependency-grammar'], status: 'satisfied', target: '.claude/FEATURES.md' },
      { conceptIds: ['bugs.dependency-grammar'], status: 'satisfied', target: '.claude/BUGS.md' },
    ]
    expectManifestError(() => admitApplyManifest(request({ inspection, semanticDecisions: [{ ...decisions[1], extra: true }, decisions[0]] })))
    expectManifestError(() => admitApplyManifest(request({ inspection, semanticDecisions: decisions })))
  })
}

module.exports = { runAdmissionCases }
